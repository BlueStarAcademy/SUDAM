import * as summaryService from '../summaryService.js';
import { LiveGameSession, RPSChoice, GameStatus, HandleActionResult, VolatileState, ServerAction, User, Player, ChatMessage, UserStatus } from '../../types/index.js';
import * as db from '../db.js';
import { randomUUID } from 'crypto';
import { ALKKAGI_PLACEMENT_TIME_LIMIT, ALKKAGI_SIMULTANEOUS_PLACEMENT_TIME_LIMIT, CURLING_TURN_TIME_LIMIT, PLAYFUL_MODE_FOUL_LIMIT, SPECIAL_GAME_MODES } from '../../constants';
import { aiUserId } from '../aiPlayer.js';
import { updateQuestProgress } from '../questService.js';
import * as types from '../../types/index.js';
import { broadcast } from '../socket.js';

// FIX: Corrected the type definition for `rpsStatusMap`. `Partial` takes one type argument, and the original code provided two. This also fixes a typo with an extra '>' and resolves subsequent parsing errors on the following lines.
const rpsStatusMap: Partial<Record<types.GameMode, types.GameStatus>> = {
    [types.GameMode.Alkkagi]: 'alkkagi_rps',
    [types.GameMode.Curling]: 'curling_rps',
    [types.GameMode.Omok]: 'omok_rps',
    [types.GameMode.Ttamok]: 'ttamok_rps',
    [types.GameMode.Thief]: 'thief_rps',
};

export const transitionToPlaying = (game: types.LiveGameSession, now: number) => {
    game.gameStatus = 'playing';
    game.currentPlayer = types.Player.Black;
    game.turnStartTime = now;
    // 게임 시작 시간 설정 (처음 playing 상태로 전환될 때만)
    if (!game.gameStartTime) {
        game.gameStartTime = now;
    }
    if (game.settings.timeLimit > 0) {
        game.turnDeadline = now + game.blackTimeLeft * 1000;
    } else {
        game.turnDeadline = undefined;
    }

    game.revealEndTime = undefined;
    game.preGameConfirmations = {};
};

/**
 * 게임 타이머를 일시정지하고 아이템 사용 시간을 부여합니다.
 * 히든/미사일/스캔 아이템 사용 시 호출됩니다.
 * @param game 게임 세션
 * @param now 현재 시간 (밀리초)
 * @param itemUseDurationMs 아이템 사용 시간 (밀리초, 기본값: 30000)
 * @returns 일시정지된 시간 (초)
 */
export const pauseGameTimer = (game: types.LiveGameSession, now: number, itemUseDurationMs: number = 30000): number => {
    // 현재 턴의 남은 시간 저장
    let pausedTimeLeft = 0;
    if (game.turnDeadline) {
        pausedTimeLeft = Math.max(0, (game.turnDeadline - now) / 1000);
    } else if (game.settings.timeLimit > 0) {
        // turnDeadline이 없으면 현재 플레이어의 남은 시간 사용
        const currentPlayerTimeKey = game.currentPlayer === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
        pausedTimeLeft = game[currentPlayerTimeKey] ?? 0;
    }
    
    game.pausedTurnTimeLeft = pausedTimeLeft;
    game.turnDeadline = undefined;
    game.turnStartTime = undefined;
    game.itemUseDeadline = now + itemUseDurationMs;
    
    return pausedTimeLeft;
};

/**
 * 게임 타이머를 재개합니다.
 * 아이템 사용 완료 후 호출됩니다.
 * @param game 게임 세션
 * @param now 현재 시간 (밀리초)
 * @param playerEnum 타이머를 재개할 플레이어 (기본값: 현재 플레이어)
 * @returns 타이머가 성공적으로 재개되었는지 여부
 */
export const resumeGameTimer = (game: types.LiveGameSession, now: number, playerEnum?: types.Player): boolean => {
    const playerToResume = playerEnum ?? game.currentPlayer;
    
    // pausedTurnTimeLeft가 없으면 재개 불가
    if (game.pausedTurnTimeLeft === undefined) {
        console.warn(`[resumeGameTimer] No pausedTurnTimeLeft found for game ${game.id}, cannot resume timer`);
        return false;
    }
    
    const currentPlayerTimeKey = playerToResume === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
    game[currentPlayerTimeKey] = game.pausedTurnTimeLeft;
    
    // 타이머 재설정
    if (game.settings.timeLimit > 0) {
        const timeLeft = game[currentPlayerTimeKey] ?? 0;
        if (timeLeft > 0) {
            game.turnDeadline = now + timeLeft * 1000;
            game.turnStartTime = now;
        } else {
            // 시간이 0이면 초읽기 모드 확인
            const isFischer = game.mode === types.GameMode.Speed || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Speed));
            const byoyomiKey = playerToResume === types.Player.Black ? 'blackByoyomiPeriodsLeft' : 'whiteByoyomiPeriodsLeft';
            const isInByoyomi = game[byoyomiKey] > 0 && game.settings.byoyomiCount > 0 && !isFischer;
            
            if (isInByoyomi) {
                game.turnDeadline = now + game.settings.byoyomiTime * 1000;
            } else {
                game.turnDeadline = undefined;
            }
            game.turnStartTime = now;
        }
    } else {
        game.turnDeadline = undefined;
        game.turnStartTime = undefined;
    }
    
    // 아이템 사용 관련 필드 정리
    game.itemUseDeadline = undefined;
    game.pausedTurnTimeLeft = undefined;
    
    return true;
};


const transitionFromTurnPreference = (game: LiveGameSession, p1Choice: 'first' | 'second', p2Choice: 'first' | 'second', now: number) => {
    const p1Id = game.player1.id;
    const p2Id = game.player2.id;

    if (p1Choice !== p2Choice) { // No tie
        const p1IsBlack = p1Choice === 'first';
        game.blackPlayerId = p1IsBlack ? p1Id : p2Id;
        game.whitePlayerId = p1IsBlack ? p2Id : p1Id;
        
        if (game.mode === types.GameMode.Alkkagi) {
            game.gameStatus = 'alkkagi_start_confirmation';
            game.revealEndTime = now + 30000;
            game.preGameConfirmations = { [p1Id]: false, [p2Id]: false };
            if (game.isAiGame) game.preGameConfirmations[aiUserId] = true;
        } else if (game.mode === types.GameMode.Curling) {
            game.gameStatus = 'curling_start_confirmation';
            game.revealEndTime = now + 30000;
            game.preGameConfirmations = { [p1Id]: false, [p2Id]: false };
            if (game.isAiGame) game.preGameConfirmations[aiUserId] = true;
        } else { // Omok, Ttamok - direct start
            transitionToPlaying(game, now);
        }
        game.turnChoices = undefined;
    } else { // Tie, proceed to RPS tiebreaker
        const rpsStatus = rpsStatusMap[game.mode];
        if (rpsStatus) {
            game.gameStatus = rpsStatus;
            game.rpsState = { [p1Id]: null, [p2Id]: null };
            game.rpsRound = 1;
            game.turnDeadline = now + 30000;
        }
    }
    game.turnChoiceDeadline = undefined;
};

export const updateSharedGameState = (game: LiveGameSession, now: number): boolean => {
    const p1Id = game.player1.id;
    const p2Id = game.player2.id;
    
    if (game.gameStatus === 'turn_preference_selection') {
        const p1Choice = game.turnChoices?.[p1Id];
        const p2Choice = game.turnChoices?.[p2Id];
        const deadlinePassed = game.turnChoiceDeadline && now > game.turnChoiceDeadline;

        // 양쪽 선택이 완료되면 즉시 다음 단계로 전환 (타임아웃 대기 불필요)
        if (p1Choice && p2Choice) {
            transitionFromTurnPreference(game, p1Choice, p2Choice, now);
            return true;
        }
        
        // 타임아웃 처리 (30초 초과 시 랜덤 선택)
        if (deadlinePassed) {
            const choices = ['first', 'second'] as const;
            if (!game.turnChoices) game.turnChoices = {};
            const finalP1Choice = p1Choice || choices[Math.floor(Math.random() * 2)];
            const finalP2Choice = p2Choice || choices[Math.floor(Math.random() * 2)];
            
            transitionFromTurnPreference(game, finalP1Choice, finalP2Choice, now);
            return true;
        }
    }
    
    const rpsRevealStatus = game.gameStatus.endsWith('_rps_reveal');
    if (rpsRevealStatus && game.revealEndTime && now > game.revealEndTime) {
        const p1Choice = game.rpsState?.[p1Id];
        const p2Choice = game.rpsState?.[p2Id];

        if (p1Choice && p2Choice) {
            let winnerId: string;
            const p1Wins = (p1Choice === 'rock' && p2Choice === 'scissors') || (p1Choice === 'scissors' && p2Choice === 'paper') || (p1Choice === 'paper' && p2Choice === 'rock');
            
            if (p1Choice === p2Choice) { // Draw
                if ((game.rpsRound || 1) < 3) {
                    game.rpsRound = (game.rpsRound || 1) + 1;
                    game.gameStatus = game.gameStatus.replace('_reveal', '') as types.GameStatus;
                    game.rpsState = { [p1Id]: null, [p2Id]: null };
                    game.turnDeadline = now + 30000;
                    return true;
                } else { // Final draw, random winner
                    winnerId = Math.random() < 0.5 ? p1Id : p2Id;
                }
            } else { // Clear winner
                winnerId = p1Wins ? p1Id : p2Id;
            }

            if (game.turnChoices) {
                const loserId = winnerId === p1Id ? p2Id : p1Id;
                const winnerChoice = game.turnChoices[winnerId]!;
                
                const winnerIsBlack = winnerChoice === 'first';
                game.blackPlayerId = winnerIsBlack ? winnerId : loserId;
                game.whitePlayerId = winnerIsBlack ? loserId : winnerId;
                
                game.turnChoices[loserId] = winnerChoice === 'first' ? 'second' : 'first';
            }
            
            if (game.mode === types.GameMode.Alkkagi) {
                game.gameStatus = 'alkkagi_start_confirmation';
                game.revealEndTime = now + 30000;
                game.preGameConfirmations = { [p1Id]: false, [p2Id]: false };
                if (game.isAiGame) game.preGameConfirmations[aiUserId] = true;
            } else if (game.mode === types.GameMode.Curling) {
                game.gameStatus = 'curling_start_confirmation';
                game.revealEndTime = now + 30000;
                game.preGameConfirmations = { [p1Id]: false, [p2Id]: false };
                if (game.isAiGame) game.preGameConfirmations[aiUserId] = true;
            } else if (game.mode === types.GameMode.Thief) {
                const loserId = winnerId === p1Id ? p2Id : p1Id;
                const winnerChoice = game.roleChoices![winnerId]!;
                
                if(winnerChoice === 'thief') {
                    game.thiefPlayerId = winnerId;
                    game.policePlayerId = loserId;
                } else {
                    game.policePlayerId = winnerId;
                    game.thiefPlayerId = loserId;
                }
                
                game.blackPlayerId = game.thiefPlayerId;
                game.whitePlayerId = game.policePlayerId;
                game.gameStatus = 'thief_role_confirmed';
                game.revealEndTime = now + 10000;
                if (game.isAiGame) game.preGameConfirmations = { [aiUserId]: true };
            } else { // Omok, Ttamok
                transitionToPlaying(game, now);
            }
            return true;
        }
    } else if (game.gameStatus.endsWith('_rps')) {
        const p1RpsChoice = game.rpsState?.[p1Id];
        const p2RpsChoice = game.rpsState?.[p2Id];
        const bothRpsChosen = p1RpsChoice && p2RpsChoice;
        const deadlinePassedRps = game.turnDeadline && now > game.turnDeadline;
    
        if (bothRpsChosen || deadlinePassedRps) {
            if (deadlinePassedRps) {
                const choices: types.RPSChoice[] = ['rock', 'paper', 'scissors'];
                if(!p1RpsChoice) game.rpsState![p1Id] = choices[Math.floor(Math.random()*3)];
                if(!p2RpsChoice) game.rpsState![p2Id] = choices[Math.floor(Math.random()*3)];
            }
            game.gameStatus = game.gameStatus.replace('_rps', '_rps_reveal') as types.GameStatus;
            game.revealEndTime = now + 4000;
            game.turnDeadline = undefined;
            return true;
        }
    }

    return false;
};


export const handleSharedAction = async (volatileState: VolatileState, game: LiveGameSession, action: ServerAction, user: User): Promise<HandleActionResult | null> => {
    const { type, payload } = action as any;
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const now = Date.now();
    
    switch (type) {
        case 'USE_ACTION_BUTTON': {
            if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') {
                return { error: 'Game has already ended.' };
            }
            const myButtons = game.currentActionButtons?.[user.id];
            const button = myButtons?.find(b => b.name === payload.buttonName);
            if (!button) return { error: 'Invalid action button.' };
            
            if (game.actionButtonUsedThisCycle?.[user.id]) return { error: 'Action button already used this cycle.' };
            if ((game.actionButtonUses?.[user.id] ?? 0) >= (game.maxActionButtonUses ?? 5)) {
                return { error: `You have used all your action buttons for this game (${game.maxActionButtonUses ?? 5}).` };
            }

            const getRandomInt = (min: number, max: number) => {
                return Math.floor(Math.random() * (max - min + 1)) + min;
            };

            const scoreChange = button.type === 'manner' 
                ? getRandomInt(1, 5) 
                : getRandomInt(-7, -1);
            
            const message: ChatMessage = {
                id: `msg-${randomUUID()}`,
                user: { id: user.id, nickname: user.nickname },
                system: true,
                timestamp: now,
                actionInfo: {
                    message: button.message,
                    scoreChange: scoreChange
                },
            };
            if (!volatileState.gameChats[game.id]) volatileState.gameChats[game.id] = [];
            volatileState.gameChats[game.id].push(message);

            user.mannerScore = Math.max(0, user.mannerScore + scoreChange);
            
            // 게임의 mannerScoreChanges에 매너 점수 변경 기록
            if (!game.mannerScoreChanges) game.mannerScoreChanges = {};
            game.mannerScoreChanges[user.id] = (game.mannerScoreChanges[user.id] || 0) + scoreChange;
            
            if (!game.actionButtonUses) game.actionButtonUses = {};
            game.actionButtonUses[user.id] = (game.actionButtonUses[user.id] ?? 0) + 1;
            if (!game.actionButtonUsedThisCycle) game.actionButtonUsedThisCycle = {};
            game.actionButtonUsedThisCycle[user.id] = true;
            
            updateQuestProgress(user, 'action_button');

            await db.updateUser(user);
            await db.saveGame(game);
            
            // 채팅 메시지 브로드캐스트
            broadcast({ 
                type: 'GAME_CHAT_UPDATE', 
                payload: { 
                    [game.id]: volatileState.gameChats[game.id] 
                } 
            });
            
            // 매너 점수 변경 브로드캐스트
            const updatedUser = JSON.parse(JSON.stringify(user));
            broadcast({ 
                type: 'USER_UPDATE', 
                payload: { 
                    [user.id]: updatedUser 
                } 
            });
            
            // 게임 상태 업데이트 브로드캐스트 (액션 버튼 사용 정보 포함)
            broadcast({ 
                type: 'GAME_UPDATE', 
                payload: { 
                    [game.id]: game 
                } 
            });
            
            return { clientResponse: { updatedUser } };
        }

        case 'CHOOSE_TURN_PREFERENCE': {
            const { choice } = payload;
            if (game.gameStatus !== 'turn_preference_selection' || !game.turnChoices || typeof game.turnChoices[user.id] === 'string') {
                return { error: 'Cannot choose turn now.' };
            }
            game.turnChoices[user.id] = choice;

            const p1Id = game.player1.id;
            const p2Id = game.player2.id;
            const p1Choice = game.turnChoices[p1Id];
            const p2Choice = game.turnChoices[p2Id];

            if (p1Choice && p2Choice) {
                transitionFromTurnPreference(game, p1Choice, p2Choice, now);
            }
            return {};
        }

        case 'SUBMIT_RPS_CHOICE': {
            const { choice } = payload as { choice: RPSChoice };
            if (!game.rpsState || typeof game.rpsState[user.id] === 'string') {
                return { error: 'Cannot make RPS choice now.' };
            }
            game.rpsState[user.id] = choice;
            return {};
        }

        case 'RESIGN_GAME': {
            if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') {
                return { error: 'Game has already ended.' };
            }
            
            // 싱글플레이 게임 또는 도전의 탑 게임인 경우 특별 처리
            if (game.isSinglePlayer || game.gameCategory === 'tower') {
                // 싱글플레이/도전의 탑에서 기권하면 AI(White)가 승리, 유저(Black)가 패배
                // 유저는 항상 Black이므로 White가 승리
                await summaryService.endGame(game, types.Player.White, 'resign');
                
                if (volatileState.userStatuses[user.id]) {
                    volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode: game.mode };
                }
                return {};
            }
            
            // 2-player games, if one player resigns, the other wins.
            const winner = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
            await summaryService.endGame(game, winner, 'resign');

            if (payload?.andLeave) {
                if (volatileState.userStatuses[user.id]) {
                    volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode: game.mode };
                }
            }
            return {};
        }

        default:
            return null; // Action was not a shared one
    }
};


export const handleTimeoutFoul = (game: LiveGameSession, timedOutPlayerId: string, now: number): boolean => {
    if (!game.timeoutFouls) game.timeoutFouls = {};
    game.timeoutFouls[timedOutPlayerId] = (game.timeoutFouls[timedOutPlayerId] || 0) + 1;
    
    const foulPlayer = game.player1.id === timedOutPlayerId ? game.player1 : game.player2;
    game.foulInfo = { message: `${foulPlayer.nickname}님의 타임오버 파울!`, expiry: now + 4000 };

    if (game.timeoutFouls[timedOutPlayerId] >= PLAYFUL_MODE_FOUL_LIMIT) {
        const winnerId = game.player1.id === timedOutPlayerId ? game.player2.id : game.player1.id;
        const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : types.Player.White;
        summaryService.endGame(game, winnerEnum, 'foul_limit');
        return true; // Game ended
    }
    return false; // Game continues
};