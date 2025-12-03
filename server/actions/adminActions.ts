import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, AdminLog, Announcement, OverrideAnnouncement, GameMode, LiveGameSession, UserStatusInfo, InventoryItem, InventoryItemType, UserStatus, TournamentType, CoreStat } from '../../types/index.js';
import * as types from '../../types/index.js';
import { defaultStats, createDefaultBaseStats, createDefaultSpentStatPoints, createDefaultInventory, createDefaultQuests, createDefaultUser } from '../initialData.js';
import * as summaryService from '../summaryService.js';
import { createItemFromTemplate } from '../shop.js';
import { EQUIPMENT_POOL, CONSUMABLE_ITEMS, MATERIAL_ITEMS, TOURNAMENT_DEFINITIONS, BOT_NAMES, AVATAR_POOL, BORDER_POOL, SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '../../constants';
import * as mannerService from '../mannerService.js';
import { containsProfanity } from '../../profanity.js';
import { broadcast } from '../socket.js';
import { calculateTotalStats } from '../statService.js';
import * as tournamentService from '../tournamentService.js';
import { getStartOfDayKST } from '../../utils/timeUtils.js';
import { clearAiSession } from '../aiSessionManager.js';
import { getCachedUser, updateUserCache, removeUserFromCache } from '../gameCache.js';
import { invalidateUserCache } from '../db.js';

type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

const createAdminLog = async (admin: User, action: AdminLog['action'], target: User | { id: string; nickname: string }, backupData: any) => {
    const log: AdminLog = {
        id: `log-${randomUUID()}`,
        timestamp: Date.now(),
        adminId: admin.id,
        adminNickname: admin.nickname,
        targetUserId: target.id,
        targetNickname: target.nickname,
        action: action,
        backupData: backupData
    };

    const logs = await db.getKV<AdminLog[]>('adminLogs') || [];
    logs.unshift(log);
    if (logs.length > 200) logs.length = 200;
    await db.setKV('adminLogs', logs);
};

export const handleAdminAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    if (!user.isAdmin) {
        return { error: 'Permission denied.' };
    }
    const { type, payload } = action;

    switch (type) {
        case 'ADMIN_APPLY_SANCTION': {
            const { targetUserId, sanctionType, durationMinutes } = payload;
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            const now = Date.now();
            const banUntil = now + durationMinutes * 60 * 1000;

            if (sanctionType === 'chat') {
                targetUser.chatBanUntil = banUntil;
            } else if (sanctionType === 'connection') {
                targetUser.connectionBanUntil = banUntil;
                
                // 사용자가 게임 중인 경우 게임 종료 처리
                const userStatus = volatileState.userStatuses[targetUserId];
                if (userStatus?.gameId) {
                    const activeGame = await db.getLiveGame(userStatus.gameId);
                    // scoring 상태의 게임은 연결 끊김으로 처리하지 않음 (자동계가 진행 중)
                    if (activeGame && activeGame.gameStatus !== 'ended' && activeGame.gameStatus !== 'no_contest' && activeGame.gameStatus !== 'scoring') {
                        // 상대방이 승리하도록 게임 종료
                        const opponentId = activeGame.player1.id === targetUserId ? activeGame.player2.id : activeGame.player1.id;
                        const winner = activeGame.blackPlayerId === opponentId ? types.Player.Black : types.Player.White;
                        await summaryService.endGame(activeGame, winner, 'disconnect');
                        await db.saveGame(activeGame);
                        
                        // 상대방 상태 업데이트
                        if (volatileState.userStatuses[opponentId]) {
                            const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === activeGame.mode);
                            const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === activeGame.mode);
                            const lobbyMode: GameMode | undefined = isStrategic ? undefined : isPlayful ? undefined : activeGame.mode;
                            volatileState.userStatuses[opponentId].status = UserStatus.Waiting;
                            volatileState.userStatuses[opponentId].mode = lobbyMode;
                            delete volatileState.userStatuses[opponentId].gameId;
                        }
                        
                        const { broadcastToGameParticipants } = await import('../socket.js');
                        broadcastToGameParticipants(activeGame.id, { type: 'GAME_UPDATE', payload: { [activeGame.id]: activeGame } }, activeGame);
                    }
                }
                
                // Also log them out
                delete volatileState.userConnections[targetUserId];
                delete volatileState.userStatuses[targetUserId];
                
                // 사용자 상태 업데이트 브로드캐스트
                broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            }

            await db.updateUser(targetUser);
            await createAdminLog(user, 'apply_sanction', targetUser, { sanctionType, durationMinutes });
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const updatedUser = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUser);
            
            return {};
        }

        case 'ADMIN_LIFT_SANCTION': {
            const { targetUserId, sanctionType } = payload;
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            if (sanctionType === 'chat') {
                targetUser.chatBanUntil = undefined;
            } else if (sanctionType === 'connection') {
                targetUser.connectionBanUntil = undefined;
            }

            await db.updateUser(targetUser);
            await createAdminLog(user, 'lift_sanction', targetUser, { sanctionType });
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const updatedUser = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUser);
            
            return {};
        }
        case 'ADMIN_RESET_USER_DATA': {
            const { targetUserId, resetType } = payload;
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            const backupData = JSON.parse(JSON.stringify(targetUser));

            if (resetType === 'full') {
                targetUser.strategyLevel = 1;
                targetUser.strategyXp = 0;
                targetUser.playfulLevel = 1;
                targetUser.playfulXp = 0;
                targetUser.spentStatPoints = createDefaultSpentStatPoints();
            }
            targetUser.stats = JSON.parse(JSON.stringify(defaultStats));

            await db.updateUser(targetUser);
            await createAdminLog(user, resetType === 'full' ? 'reset_full' : 'reset_stats', targetUser, backupData);
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const updatedUser = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUser);
            
            return {};
        }
        case 'ADMIN_DELETE_USER': {
            const { targetUserId } = payload;
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };
            if (targetUser.isAdmin) return { error: '관리자 계정은 삭제할 수 없습니다.' };

            // 사용자가 게임 중인 경우 게임 종료 처리
            const userStatus = volatileState.userStatuses[targetUserId];
            if (userStatus?.gameId) {
                const activeGame = await db.getLiveGame(userStatus.gameId);
                if (activeGame && activeGame.gameStatus !== 'ended' && activeGame.gameStatus !== 'no_contest') {
                    // 상대방이 승리하도록 게임 종료
                    const opponentId = activeGame.player1.id === targetUserId ? activeGame.player2.id : activeGame.player1.id;
                    const winner = activeGame.blackPlayerId === opponentId ? types.Player.Black : types.Player.White;
                    await summaryService.endGame(activeGame, winner, 'disconnect');
                    await db.saveGame(activeGame);
                    
                    // 상대방 상태 업데이트
                    if (volatileState.userStatuses[opponentId]) {
                        const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === activeGame.mode);
                        const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === activeGame.mode);
                        const lobbyMode: GameMode | undefined = isStrategic ? undefined : isPlayful ? undefined : activeGame.mode;
                        volatileState.userStatuses[opponentId].status = UserStatus.Waiting;
                        volatileState.userStatuses[opponentId].mode = lobbyMode;
                        delete volatileState.userStatuses[opponentId].gameId;
                    }
                    
                    broadcast({ type: 'GAME_UPDATE', payload: { [activeGame.id]: activeGame } });
                }
            }

            const backupData = JSON.parse(JSON.stringify(targetUser));
            await db.deleteUser(targetUserId);

            delete volatileState.userConnections[targetUserId];
            delete volatileState.userStatuses[targetUserId];

            // 사용자 상태 업데이트 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });

            await createAdminLog(user, 'delete_user', targetUser, backupData);
            return {};
        }
        case 'ADMIN_CREATE_USER': {
            const { username, password, nickname } = payload;
            if (!username || !password || !nickname) { return { error: '모든 필드를 입력해야 합니다.' }; }
            if (nickname.trim().length < NICKNAME_MIN_LENGTH || nickname.trim().length > NICKNAME_MAX_LENGTH) {
                return { error: `닉네임은 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH}자여야 합니다.` };
            }

            const existingByUsername = await db.getUserCredentials(username);
            if (existingByUsername) return { error: '이미 사용 중인 아이디입니다.' };

            const allUsers = await db.getAllUsers();
            if (allUsers.some(u => u.nickname.toLowerCase() === nickname.toLowerCase())) {
                return { error: '이미 사용 중인 닉네임입니다.' };
            }
            
            const newUser = createDefaultUser(`user-${randomUUID()}`, username, nickname, false);
            await db.createUser(newUser);
            await db.createUserCredentials(username, password, newUser.id);
            return {};
        }
        case 'ADMIN_FORCE_LOGOUT': {
            const { targetUserId } = payload;
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            // 사용자가 게임 중인 경우 게임 종료 처리
            const userStatus = volatileState.userStatuses[targetUserId];
            if (userStatus?.gameId) {
                const activeGame = await db.getLiveGame(userStatus.gameId);
                if (activeGame && activeGame.gameStatus !== 'ended' && activeGame.gameStatus !== 'no_contest') {
                    // 상대방이 승리하도록 게임 종료
                    const opponentId = activeGame.player1.id === targetUserId ? activeGame.player2.id : activeGame.player1.id;
                    const winner = activeGame.blackPlayerId === opponentId ? types.Player.Black : types.Player.White;
                    await summaryService.endGame(activeGame, winner, 'disconnect');
                    await db.saveGame(activeGame);
                    
                    // 상대방 상태 업데이트
                    if (volatileState.userStatuses[opponentId]) {
                        const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === activeGame.mode);
                        const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === activeGame.mode);
                        const lobbyMode: GameMode | undefined = isStrategic ? undefined : isPlayful ? undefined : activeGame.mode;
                        volatileState.userStatuses[opponentId].status = UserStatus.Waiting;
                        volatileState.userStatuses[opponentId].mode = lobbyMode;
                        delete volatileState.userStatuses[opponentId].gameId;
                    }
                    
                    broadcast({ type: 'GAME_UPDATE', payload: { [activeGame.id]: activeGame } });
                }
            }
            
            const backupData = { status: volatileState.userStatuses[targetUserId] };
            delete volatileState.userConnections[targetUserId];
            delete volatileState.userStatuses[targetUserId];
            
            // 사용자 상태 업데이트 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            
            await createAdminLog(user, 'force_logout', targetUser, backupData);
            return {};
        }
        case 'ADMIN_SEND_MAIL': {
            const { targetSpecifier, title, message, expiresInDays, attachments } = payload as {
                targetSpecifier: string;
                title: string;
                message: string;
                expiresInDays: number;
                attachments: {
                    gold: number;
                    diamonds: number;
                    actionPoints: number;
                    items: { name: string; quantity: number; type: InventoryItemType }[];
                }
            };
            let targetUsers: User[] = [];

            if (targetSpecifier === 'all') {
                targetUsers = await db.getAllUsers();
            } else {
                const foundUser = (await db.getAllUsers()).find(u => u.nickname === targetSpecifier || u.username === targetSpecifier);
                if (foundUser) targetUsers.push(foundUser);
            }

            if (targetUsers.length === 0) return { error: '메일을 보낼 사용자를 찾을 수 없습니다.' };

            for (const target of targetUsers) {
                 const userAttachments: types.Mail['attachments'] = {
                    gold: attachments.gold,
                    diamonds: attachments.diamonds,
                    actionPoints: attachments.actionPoints,
                    items: []
                };

                if (attachments.items && attachments.items.length > 0) {
                    for (const attachedItem of attachments.items) {
                        const { name, quantity, type } = attachedItem;
                        if (type === 'equipment') {
                            for (let i = 0; i < quantity; i++) {
                                const template = EQUIPMENT_POOL.find(t => t.name === name);
                                if (template) {
                                    userAttachments.items!.push(createItemFromTemplate(template));
                                }
                            }
                        } else { // Stackable items (consumable or material)
                            const template = [...CONSUMABLE_ITEMS, ...Object.values(MATERIAL_ITEMS)].find(t => t.name === name);
                            if (template) {
                                (userAttachments.items as InventoryItem[]).push({
                                    ...(template as any),
                                    id: `item-${randomUUID()}`,
                                    createdAt: Date.now(),
                                    isEquipped: false,
                                    level: 1,
                                    stars: 0,
                                    quantity: quantity,
                                });
                            }
                        }
                    }
                }
                
                const newMail: types.Mail = {
                    id: `mail-${randomUUID()}`,
                    from: user.nickname,
                    title, message,
                    attachments: userAttachments,
                    receivedAt: Date.now(),
                    expiresAt: expiresInDays > 0 ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000 : undefined,
                    isRead: false,
                    attachmentsClaimed: false
                };
                target.mail.unshift(newMail);
                await db.updateUser(target);
                
                // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
                const updatedUser = JSON.parse(JSON.stringify(target));
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(updatedUser, ['mail']);
            }
             await createAdminLog(user, 'send_mail', { id: targetSpecifier, nickname: targetSpecifier }, { mailTitle: title });
            return {};
        }
        case 'ADMIN_REORDER_ANNOUNCEMENTS': {
            await db.setKV('announcements', payload.announcements);
            return {};
        }
        case 'ADMIN_ADD_ANNOUNCEMENT': {
            const announcements = await db.getKV<Announcement[]>('announcements') || [];
            const newAnnouncement: Announcement = { id: `ann-${randomUUID()}`, message: payload.message };
            announcements.push(newAnnouncement);
            await db.setKV('announcements', announcements);
            return {};
        }
        case 'ADMIN_REMOVE_ANNOUNCEMENT': {
            const announcements = await db.getKV<Announcement[]>('announcements') || [];
            const updatedAnnouncements = announcements.filter(a => a.id !== payload.id);
            await db.setKV('announcements', updatedAnnouncements);
            return {};
        }
        case 'ADMIN_SET_ANNOUNCEMENT_INTERVAL': {
            await db.setKV('announcementInterval', payload.interval);
            return {};
        }
        case 'ADMIN_SET_OVERRIDE_ANNOUNCEMENT': {
            const override: OverrideAnnouncement = { message: payload.message, modes: 'all' };
            await db.setKV('globalOverrideAnnouncement', override);
            return {};
        }
        case 'ADMIN_CLEAR_OVERRIDE_ANNOUNCEMENT': {
            await db.setKV('globalOverrideAnnouncement', null);
            return {};
        }
        case 'ADMIN_TOGGLE_GAME_MODE': {
            const { mode, isAvailable } = payload;
            const availability = await db.getKV<Record<GameMode, boolean>>('gameModeAvailability') || {} as Record<GameMode, boolean>;
            availability[mode as GameMode] = isAvailable;
            await db.setKV('gameModeAvailability', availability);
            return {};
        }
        case 'ADMIN_SET_GAME_DESCRIPTION': {
            const { gameId, description } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) return { error: 'Game not found.' };
            game.description = description;
            await db.saveGame(game);
            
            // 게임 업데이트 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants } = await import('../socket.js');
            broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
            
            await createAdminLog(user, 'set_game_description', game.player1, { mailTitle: `Game ${game.id}`});
            return {};
        }
        case 'ADMIN_FORCE_DELETE_GAME': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) return { error: 'Game not found.' };

            const backupData = JSON.parse(JSON.stringify(game));

            // 게임을 강제 종료 (no_contest 상태로 설정)
            game.gameStatus = 'no_contest';
            game.winReason = 'disconnect';
            await db.saveGame(game);

            // 사용자 상태 업데이트 및 로비 모드 결정
            const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
            const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
            const lobbyMode: GameMode | undefined = isStrategic ? undefined : isPlayful ? undefined : game.mode;

            // 플레이어 상태 업데이트
            if (volatileState.userStatuses[game.player1.id]) {
                volatileState.userStatuses[game.player1.id].status = UserStatus.Waiting;
                volatileState.userStatuses[game.player1.id].mode = lobbyMode;
                delete volatileState.userStatuses[game.player1.id].gameId;
            }
            if (volatileState.userStatuses[game.player2.id]) {
                volatileState.userStatuses[game.player2.id].status = UserStatus.Waiting;
                volatileState.userStatuses[game.player2.id].mode = lobbyMode;
                delete volatileState.userStatuses[game.player2.id].gameId;
            }

            // 관전자 상태 업데이트
            Object.values(volatileState.userStatuses).forEach(status => {
                if (status.spectatingGameId === gameId) {
                    delete status.spectatingGameId;
                }
            });

            // 게임 삭제 (DB에서 완전히 제거)
            clearAiSession(gameId);
            await db.deleteGame(gameId);

            // 브로드캐스트
            broadcast({ type: 'GAME_DELETED', payload: { gameId, gameCategory: game.gameCategory } });
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });

            await createAdminLog(user, 'force_delete_game', game.player1, backupData);
            return {};
        }
        case 'ADMIN_FORCE_WIN': {
            const { gameId, winnerId } = payload as { gameId: string; winnerId: string };
            const game = await db.getLiveGame(gameId);
            if (!game) return { error: 'Game not found.' };
            if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') {
                return { error: 'Game has already ended.' };
            }

            const winnerEnum = game.blackPlayerId === winnerId ? types.Player.Black : types.Player.White;
            const winnerUser = game.player1.id === winnerId ? game.player1 : game.player2;

            // 게임을 정상적으로 종료 (승자 지정)
            await summaryService.endGame(game, winnerEnum, 'resign');
            await db.saveGame(game);

            // 사용자 상태 업데이트 및 로비 모드 결정
            const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
            const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
            const lobbyMode: GameMode | undefined = isStrategic ? undefined : isPlayful ? undefined : game.mode;

            // 플레이어 상태 업데이트
            if (volatileState.userStatuses[game.player1.id]) {
                volatileState.userStatuses[game.player1.id].status = UserStatus.Waiting;
                volatileState.userStatuses[game.player1.id].mode = lobbyMode;
                delete volatileState.userStatuses[game.player1.id].gameId;
            }
            if (volatileState.userStatuses[game.player2.id]) {
                volatileState.userStatuses[game.player2.id].status = UserStatus.Waiting;
                volatileState.userStatuses[game.player2.id].mode = lobbyMode;
                delete volatileState.userStatuses[game.player2.id].gameId;
            }

            // 관전자 상태 업데이트
            Object.values(volatileState.userStatuses).forEach(status => {
                if (status.spectatingGameId === gameId) {
                    delete status.spectatingGameId;
                }
            });

            // 브로드캐스트
            broadcast({ type: 'GAME_UPDATE', payload: { [gameId]: game } });
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            
            await createAdminLog(user, 'force_win', winnerUser, { gameId, winnerId });
            return {};
        }
        case 'ADMIN_UPDATE_USER_DETAILS': {
            const { targetUserId, updatedDetails } = payload as { targetUserId: string; updatedDetails: User };
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            if (user.id === targetUserId && targetUser.isAdmin && !updatedDetails.isAdmin) {
                return { error: '자신의 관리자 권한을 해제할 수 없습니다.' };
            }

            const backupData = JSON.parse(JSON.stringify(targetUser));
            
            // NICKNAME CHANGE VALIDATION
            if (updatedDetails.nickname && updatedDetails.nickname !== targetUser.nickname) {
                const newNickname = updatedDetails.nickname.trim();
                if (newNickname.length < NICKNAME_MIN_LENGTH || newNickname.length > NICKNAME_MAX_LENGTH) {
                    return { error: `닉네임은 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH}자여야 합니다.` };
                }
                if (containsProfanity(newNickname)) {
                    return { error: '닉네임에 부적절한 단어가 포함되어 있습니다.' };
                }
                const allUsers = await db.getAllUsers();
                if (allUsers.some(u => u.id !== targetUserId && u.nickname.toLowerCase() === newNickname.toLowerCase())) {
                    return { error: '이미 사용 중인 닉네임입니다.' };
                }
                // If all checks pass, update the nickname
                targetUser.nickname = newNickname;
            }

            const oldMannerScore = targetUser.mannerScore;

            targetUser.isAdmin = !!updatedDetails.isAdmin;
            targetUser.strategyLevel = Number(updatedDetails.strategyLevel) || 1;
            targetUser.strategyXp = Number(updatedDetails.strategyXp) || 0;
            targetUser.playfulLevel = Number(updatedDetails.playfulLevel) || 1;
            targetUser.playfulXp = Number(updatedDetails.playfulXp) || 0;
            targetUser.gold = Number(updatedDetails.gold) || 0;
            targetUser.diamonds = Number(updatedDetails.diamonds) || 0;
            targetUser.mannerScore = Number(updatedDetails.mannerScore) || 200;
            
            // 챔피언십 점수 업데이트 (editedUser 전체를 보내므로 값이 있어야 함)
            // 0도 유효한 값이므로 명시적으로 처리
            if ('cumulativeTournamentScore' in updatedDetails) {
                const numValue = Number(updatedDetails.cumulativeTournamentScore);
                targetUser.cumulativeTournamentScore = isNaN(numValue) ? 0 : numValue;
            }
            if ('tournamentScore' in updatedDetails) {
                const numValue = Number(updatedDetails.tournamentScore);
                targetUser.tournamentScore = isNaN(numValue) ? 0 : numValue;
            }
            
            if (updatedDetails.quests) {
                targetUser.quests = updatedDetails.quests;
            }
            
            if (updatedDetails.stats) {
                for (const mode in updatedDetails.stats) {
                    const modeKey = mode as GameMode;
                    if (targetUser.stats && targetUser.stats[modeKey] && updatedDetails.stats[modeKey]) {
                        targetUser.stats[modeKey]!.rankingScore = Number(updatedDetails.stats[modeKey]!.rankingScore) || 1200;
                    }
                }
            }
            
            await mannerService.applyMannerRankChange(targetUser, oldMannerScore);
            await db.updateUser(targetUser);
            await createAdminLog(user, 'update_user_details', targetUser, backupData);
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const updatedUser = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUser);
            
            // HTTP 응답에도 업데이트된 사용자 데이터 포함 (관리자 패널에서 즉시 반영을 위해)
            return {
                clientResponse: {
                    updatedUser,
                    targetUserId: targetUser.id
                }
            };
        }
        
        case 'ADMIN_RESET_TOURNAMENT_SESSION': {
            const { targetUserId, tournamentType } = payload as { targetUserId: string; tournamentType: TournamentType };
            const targetUser = await getCachedUser(targetUserId) || await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            // 토너먼트 타입에 따른 stateKey 결정
            let stateKey: keyof types.User;
            let playedDateKey: keyof types.User;
            switch (tournamentType) {
                case 'neighborhood':
                    stateKey = 'lastNeighborhoodTournament';
                    playedDateKey = 'lastNeighborhoodPlayedDate';
                    break;
                case 'national':
                    stateKey = 'lastNationalTournament';
                    playedDateKey = 'lastNationalPlayedDate';
                    break;
                case 'world':
                    stateKey = 'lastWorldTournament';
                    playedDateKey = 'lastWorldPlayedDate';
                    break;
                default:
                    return { error: 'Invalid tournament type.' };
            }

            // 1. 기존 토너먼트 세션 초기화
            (targetUser as any)[stateKey] = null;
            (targetUser as any)[playedDateKey] = 0;
            
            // volatileState에서도 제거 (해당 토너먼트 타입만)
            if (volatileState.activeTournaments?.[targetUserId]) {
                if (volatileState.activeTournaments[targetUserId].type === tournamentType) {
                    delete volatileState.activeTournaments[targetUserId];
                }
            }
            
            // 캐시 무효화
            invalidateUserCache(targetUserId);
            removeUserFromCache(targetUserId);
            
            await db.updateUser(targetUser);

            // 2. 새로운 토너먼트 세션 생성
            const definition = TOURNAMENT_DEFINITIONS[tournamentType];
            if (!definition) return { error: '유효하지 않은 토너먼트 타입입니다.' };

            // 캐시에서 최신 데이터 가져오기
            const freshUser = await getCachedUser(targetUserId) || await db.getUser(targetUserId);
            if (!freshUser) return { error: '사용자를 찾을 수 없습니다.' };

            const allUsers = await db.getAllUsers();
            const myLeague = freshUser.league;
            const myId = freshUser.id;
        
            const potentialOpponents = allUsers
                .filter(u => u.id !== myId && u.league === myLeague)
                .sort(() => 0.5 - Math.random());
            
            const neededOpponents = definition.players - 1;
            const selectedOpponents = potentialOpponents.slice(0, neededOpponents);
        
            const botsToCreate = neededOpponents - selectedOpponents.length;
            const botNames = [...BOT_NAMES].sort(() => 0.5 - Math.random());
            
            // 봇 생성 함수 import
            const { createBotUser } = await import('./tournamentActions.js');
            
            const botUsers: types.User[] = [];
            for (let i = 0; i < botsToCreate; i++) {
                const botName = botNames[i % botNames.length];
                const botAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
                const botBorder = BORDER_POOL[Math.floor(Math.random() * BORDER_POOL.length)];
                const botId = `bot-${botName}-${i}`;
                
                // 봇 생성 함수 사용
                const botUser = createBotUser(myLeague, tournamentType, botId, botName, botAvatar, botBorder);
                botUsers.push(botUser);
                
                selectedOpponents.push({
                    id: botId,
                    nickname: botName,
                    avatarId: botAvatar.id,
                    borderId: botBorder.id,
                    league: myLeague,
                } as any);
            }
            
            // 오늘 0시 기준 타임스탬프 (능력치 고정용)
            const now = Date.now();
            const todayStartKST = getStartOfDayKST(now);
            
            const participants: types.PlayerForTournament[] = [freshUser, ...selectedOpponents].map(p => {
                let initialStats: Record<CoreStat, number>;
                if (p.id.startsWith('bot-')) {
                    const botUser = botUsers.find(b => b.id === p.id);
                    if (botUser) {
                        // calculateTotalStats로 봇의 최종 능력치 계산
                        initialStats = calculateTotalStats(botUser);
                    } else {
                        // 폴백: 기본 능력치 생성
                        const baseStatValue = 100;
                        const stats: Partial<Record<CoreStat, number>> = {};
                        for (const key of Object.values(CoreStat)) {
                            stats[key] = baseStatValue;
                        }
                        initialStats = stats as Record<CoreStat, number>;
                    }
                } else {
                    const realUser = allUsers.find((u: any) => u.id === p.id);
                    if (realUser) {
                        initialStats = calculateTotalStats(realUser);
                    } else {
                        const baseStatValue = 100;
                        const stats: Partial<Record<CoreStat, number>> = {};
                        for (const key of Object.values(CoreStat)) {
                            stats[key] = baseStatValue;
                        }
                        initialStats = stats as Record<CoreStat, number>;
                    }
                }
                
                return {
                    id: p.id,
                    nickname: p.nickname,
                    avatarId: p.avatarId,
                    borderId: p.borderId,
                    league: p.league,
                    stats: JSON.parse(JSON.stringify(initialStats)),
                    originalStats: initialStats,
                    wins: 0,
                    losses: 0,
                    condition: 1000,
                    statsTimestamp: todayStartKST, // 오늘 0시 기준 타임스탬프 저장
                };
            });
            
            // 참가자를 완전히 무작위로 섞기 (첫 번째 플레이어도 포함하여 섞음)
            // 하지만 freshUser가 토너먼트에 포함되는지 확인
            const allParticipantsShuffled = [...participants].sort(() => 0.5 - Math.random());
            
            // freshUser가 참가자 목록에 있는지 확인 (필수)
            const userInParticipants = allParticipantsShuffled.find(p => p.id === freshUser.id);
            if (!userInParticipants) {
                // 만약 freshUser가 목록에 없다면 첫 번째 위치에 추가
                allParticipantsShuffled.unshift(participants.find(p => p.id === freshUser.id)!);
            }
            
            const newState = tournamentService.createTournament(tournamentType, freshUser, allParticipantsShuffled);
            (freshUser as any)[stateKey] = newState;
            (freshUser as any)[playedDateKey] = now;
            
            await db.updateUser(freshUser);
            
            // 캐시 업데이트
            updateUserCache(freshUser);

            // volatileState에 새로운 토너먼트 추가
            if (!volatileState.activeTournaments) {
                volatileState.activeTournaments = {};
            }
            volatileState.activeTournaments[targetUserId] = newState;

            await createAdminLog(user, 'reset_tournament_session', targetUser, { tournamentType });

            // 최신 사용자 데이터를 다시 가져와서 브로드캐스트 (토너먼트 상태가 반영된 최신 데이터)
            const latestUser = await getCachedUser(targetUserId) || await db.getUser(targetUserId);
            if (latestUser) {
                // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
                const updatedUserCopy = JSON.parse(JSON.stringify(latestUser));
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(updatedUserCopy, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament', 'dungeonProgress']);
                
                // HTTP 응답에도 업데이트된 사용자 데이터 포함 (즉시 반영을 위해)
                return { 
                    clientResponse: { 
                        message: '토너먼트 세션이 성공적으로 재생성되었습니다.', 
                        tournamentType,
                        updatedUser: updatedUserCopy // 클라이언트에서 즉시 업데이트할 수 있도록
                    } 
                };
            } else {
                // 사용자를 찾을 수 없는 경우에도 기본 브로드캐스트 (최적화: 변경된 필드만 전송)
                const updatedUserCopy = JSON.parse(JSON.stringify(freshUser));
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(updatedUserCopy, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament', 'dungeonProgress']);
                
                return { 
                    clientResponse: { 
                        message: '토너먼트 세션이 성공적으로 재생성되었습니다.', 
                        tournamentType,
                        updatedUser: updatedUserCopy
                    } 
                };
            }
        }
        
        case 'ADMIN_RESET_DUNGEON_PROGRESS': {
            const { targetUserId, dungeonType } = payload as { targetUserId: string; dungeonType?: TournamentType };
            const targetUser = await getCachedUser(targetUserId) || await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            // 던전 진행 상태 초기화
            if (!targetUser.dungeonProgress) {
                targetUser.dungeonProgress = {
                    neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                };
            } else {
                if (dungeonType) {
                    // 특정 던전 타입만 초기화
                    targetUser.dungeonProgress[dungeonType] = {
                        currentStage: 0,
                        unlockedStages: [1],
                        stageResults: {},
                        dailyStageAttempts: {},
                    };
                } else {
                    // 모든 던전 타입 초기화
                    targetUser.dungeonProgress = {
                        neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                        national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                        world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    };
                }
            }

            // 캐시 무효화 및 업데이트
            invalidateUserCache(targetUserId);
            removeUserFromCache(targetUserId);
            await db.updateUser(targetUser);
            updateUserCache(targetUser);

            await createAdminLog(user, 'reset_dungeon_progress', targetUser, { dungeonType: dungeonType || 'all' });

            // 브로드캐스트
            const updatedUserCopy = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUserCopy, ['dungeonProgress']);

            return {
                clientResponse: {
                    message: dungeonType 
                        ? `${TOURNAMENT_DEFINITIONS[dungeonType].name} 던전 진행 상태가 초기화되었습니다.`
                        : '모든 던전 진행 상태가 초기화되었습니다.',
                    updatedUser: updatedUserCopy
                }
            };
        }
        
        case 'ADMIN_RESET_CHAMPIONSHIP_ALL': {
            const { targetUserId } = payload as { targetUserId: string };
            const targetUser = await getCachedUser(targetUserId) || await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            // 1. 던전 진행 상태 초기화
            targetUser.dungeonProgress = {
                neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
            };

            // 2. 토너먼트 상태 초기화
            targetUser.lastNeighborhoodTournament = null;
            targetUser.lastNationalTournament = null;
            targetUser.lastWorldTournament = null;
            targetUser.lastNeighborhoodPlayedDate = 0;
            targetUser.lastNationalPlayedDate = 0;
            targetUser.lastWorldPlayedDate = 0;

            // 3. 보상 수령 상태 초기화
            targetUser.neighborhoodRewardClaimed = false;
            targetUser.nationalRewardClaimed = false;
            targetUser.worldRewardClaimed = false;

            // 4. volatileState에서 제거
            if (volatileState.activeTournaments?.[targetUserId]) {
                delete volatileState.activeTournaments[targetUserId];
            }

            // 캐시 무효화 및 업데이트
            invalidateUserCache(targetUserId);
            removeUserFromCache(targetUserId);
            await db.updateUser(targetUser);
            updateUserCache(targetUser);

            await createAdminLog(user, 'reset_championship_all', targetUser, {});

            // 브로드캐스트
            const updatedUserCopy = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUserCopy, [
                'dungeonProgress',
                'lastNeighborhoodTournament',
                'lastNationalTournament',
                'lastWorldTournament',
                'lastNeighborhoodPlayedDate',
                'lastNationalPlayedDate',
                'lastWorldPlayedDate',
                'neighborhoodRewardClaimed',
                'nationalRewardClaimed',
                'worldRewardClaimed'
            ]);

            return {
                clientResponse: {
                    message: '챔피언십 관련 모든 데이터가 초기화되었습니다.',
                    updatedUser: updatedUserCopy
                }
            };
        }
        
        case 'ADMIN_CREATE_HOME_BOARD_POST': {
            const { title, content, isPinned } = payload;
            if (!title || !content) {
                return { error: '제목과 내용을 입력해주세요.' };
            }

            const post = await db.createHomeBoardPost({
                title,
                content,
                authorId: user.id,
                isPinned: isPinned || false
            });

            await createAdminLog(user, 'create_home_board_post', { id: user.id, nickname: user.nickname }, { postId: post.id, title });

            // 모든 게시글을 다시 로드하고 브로드캐스트
            const allPosts = await db.getAllHomeBoardPosts();
            broadcast({ type: 'HOME_BOARD_POSTS_UPDATE', payload: { homeBoardPosts: allPosts } });

            return { clientResponse: { message: '게시글이 작성되었습니다.', post } };
        }

        case 'ADMIN_UPDATE_HOME_BOARD_POST': {
            const { postId, title, content, isPinned } = payload;
            if (!title || !content) {
                return { error: '제목과 내용을 입력해주세요.' };
            }

            const existingPost = await db.getHomeBoardPost(postId);
            if (!existingPost) {
                return { error: '게시글을 찾을 수 없습니다.' };
            }

            const updatedPost = await db.updateHomeBoardPost(postId, {
                title,
                content,
                isPinned: isPinned || false
            });

            await createAdminLog(user, 'update_home_board_post', { id: user.id, nickname: user.nickname }, { postId, title });

            // 모든 게시글을 다시 로드하고 브로드캐스트
            const allPosts = await db.getAllHomeBoardPosts();
            broadcast({ type: 'HOME_BOARD_POSTS_UPDATE', payload: { homeBoardPosts: allPosts } });

            return { clientResponse: { message: '게시글이 수정되었습니다.', post: updatedPost } };
        }

        case 'ADMIN_DELETE_HOME_BOARD_POST': {
            const { postId } = payload;

            const existingPost = await db.getHomeBoardPost(postId);
            if (!existingPost) {
                return { error: '게시글을 찾을 수 없습니다.' };
            }

            await db.deleteHomeBoardPost(postId);
            await createAdminLog(user, 'delete_home_board_post', { id: user.id, nickname: user.nickname }, { postId, title: existingPost.title });

            // 모든 게시글을 다시 로드하고 브로드캐스트
            const allPosts = await db.getAllHomeBoardPosts();
            broadcast({ type: 'HOME_BOARD_POSTS_UPDATE', payload: { homeBoardPosts: allPosts } });

            return { clientResponse: { message: '게시글이 삭제되었습니다.' } };
        }
        
        case 'ADMIN_CLEAR_USER_GUILD': {
            const { targetUserId } = payload as { targetUserId: string };
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) return { error: '대상 사용자를 찾을 수 없습니다.' };

            const backupData = JSON.parse(JSON.stringify(targetUser));
            const oldGuildId = targetUser.guildId;

            // Clear guildId
            targetUser.guildId = undefined;
            await db.updateUser(targetUser);
            await createAdminLog(user, 'clear_user_guild', targetUser, { oldGuildId });

            // WebSocket으로 사용자 업데이트 브로드캐스트
            const updatedUser = JSON.parse(JSON.stringify(targetUser));
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(updatedUser, ['guildId']);

            return {
                clientResponse: {
                    message: '사용자의 길드 정보가 초기화되었습니다.',
                    updatedUser,
                    targetUserId: targetUser.id
                }
            };
        }
        
        default:
            return { error: 'Unknown admin action type.' };
    }
};