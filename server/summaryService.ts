
// FIX: Import missing types from the centralized types file.
import { LiveGameSession, Player, User, GameSummary, StatChange, GameMode, InventoryItem, SpecialStat, WinReason, SinglePlayerStageInfo, QuestReward, Mail } from '../types/index.js';
import * as db from './db.js';
import { clearAiSession } from './aiSessionManager.js';
import { SPECIAL_GAME_MODES, NO_CONTEST_MANNER_PENALTY, NO_CONTEST_RANKING_PENALTY, CONSUMABLE_ITEMS, PLAYFUL_GAME_MODES, SINGLE_PLAYER_STAGES } from '../constants';
import { TOWER_STAGES } from '../constants/towerConstants.js';
import { updateQuestProgress } from './questService.js';
import { getSelectiveUserUpdate } from './utils/userUpdateHelper.js';
import * as mannerService from './mannerService.js';
import { openEquipmentBox1 } from './shop.js';
import * as effectService from './effectService.js';
import { randomUUID } from 'crypto';
// FIX: Correctly import aiUser and getAiUser.
import { aiUserId, getAiUser } from './aiPlayer.js';
import { createItemInstancesFromReward, addItemsToInventory } from '../utils/inventoryUtils.js';
import * as guildService from './guildService.js';

const getXpForLevel = (level: number): number => {
    if (level < 1) return 0;
    if (level > 100) return Infinity; // Max level
    
    // 레벨 1~10: 200 + (레벨 x 100)
    if (level <= 10) {
        return 200 + (level * 100);
    }
    
    // 레벨 11~20: 300 + (레벨 x 150)
    if (level <= 20) {
        return 300 + (level * 150);
    }
    
    // 레벨 21~50: 이전 필요경험치 x 1.2
    // 레벨 51~100: 이전 필요경험치 x 1.3
    // 레벨 20의 필요 경험치를 먼저 계산
    let xp = 300 + (20 * 150); // 레벨 20의 필요 경험치
    
    // 레벨 21부터 현재 레벨까지 반복
    for (let l = 21; l <= level; l++) {
        if (l <= 50) {
            xp = Math.round(xp * 1.2);
        } else {
            xp = Math.round(xp * 1.3);
        }
    }
    
    return xp;
};

const processSinglePlayerGameSummary = async (game: LiveGameSession) => {
    // DB에서 최신 사용자 데이터를 가져와서 clearedSinglePlayerStages가 정확한지 확인
    const freshUser = await db.getUser(game.player1.id);
    if (!freshUser) {
        console.error(`[SP Summary] Could not find user ${game.player1.id} in database`);
        return;
    }
    
    const user = freshUser; // 최신 사용자 데이터 사용
    const isWinner = game.winner === Player.Black; // Human is always black
    
    // 디버깅: 승자 판정 로그
    console.log(`[processSinglePlayerGameSummary] Game ${game.id}: game.winner=${game.winner === Player.Black ? 'Black' : game.winner === Player.White ? 'White' : 'None'}, isWinner=${isWinner}, finalScores=${JSON.stringify(game.finalScores)}`);
    const stage = SINGLE_PLAYER_STAGES.find(s => s.id === game.stageId);

    if (!stage) {
        console.error(`[SP Summary] Could not find stage with id: ${game.stageId}`);
        return;
    }

    // Initialize with a base structure
    const summary: GameSummary = {
        xp: { initial: user.strategyXp, change: 0, final: user.strategyXp },
        rating: { initial: 1200, change: 0, final: 1200 }, // Not applicable
        manner: { initial: user.mannerScore, change: 0, final: user.mannerScore },
        gold: 0,
        items: [],
    };
    
    const stageIndex = SINGLE_PLAYER_STAGES.findIndex(s => s.id === stage.id);
    const currentProgress = user.singlePlayerProgress ?? 0;
    
    // clearedSinglePlayerStages 배열 초기화 (없는 경우)
    if (!user.clearedSinglePlayerStages) {
        user.clearedSinglePlayerStages = [];
    }
    
    // 배열이 아닌 경우 배열로 변환 (데이터 무결성 보장)
    if (!Array.isArray(user.clearedSinglePlayerStages)) {
        console.warn(`[SP Summary] clearedSinglePlayerStages is not an array for user ${user.id}, resetting to empty array`);
        user.clearedSinglePlayerStages = [];
    }
    
    // 최초 클리어 여부 확인: clearedSinglePlayerStages에 스테이지 ID가 없으면 최초 클리어
    const isFirstClear = !user.clearedSinglePlayerStages.includes(stage.id);
    const isRepeatAttempt = !isFirstClear; // 재도전 여부
    
    console.log(`[SP Summary] Stage ${stage.id} - isFirstClear: ${isFirstClear}, clearedStages: ${JSON.stringify(user.clearedSinglePlayerStages)}`);
    
    if (isWinner) {
        const rewards = isFirstClear 
            ? stage.rewards.firstClear 
            : stage.rewards.repeatClear;
        
        console.log(`[SP Summary] Stage ${stage.id} - isFirstClear: ${isFirstClear}, rewards: gold=${rewards.gold}, exp=${rewards.exp}`);
        
        // 최초 클리어인 경우 clearedSinglePlayerStages에 추가
        if (isFirstClear) {
            user.clearedSinglePlayerStages.push(stage.id);
            console.log(`[SP Summary] Added stage ${stage.id} to clearedSinglePlayerStages`);
        }
        
        // singlePlayerProgress는 순차 진행 여부를 추적 (다음 스테이지 언락용)
        if (currentProgress === stageIndex) {
            user.singlePlayerProgress = currentProgress + 1;
        }

        // 골드와 경험치는 항상 지급 (아이템과 독립적)
        const initialXp = user.strategyXp;
        user.gold += rewards.gold;
        user.strategyXp += rewards.exp;
        
        summary.gold = rewards.gold;
        summary.xp = { initial: initialXp, change: rewards.exp, final: user.strategyXp };
        
        console.log(`[SP Summary] Rewards applied - summary.gold=${summary.gold}, summary.xp.change=${summary.xp.change}, user.gold=${user.gold}, user.strategyXp=${user.strategyXp}`);
        
        // 아이템 보상 처리
        const itemsToCreate = rewards.items ? createItemInstancesFromReward(rewards.items) : [];
        const { success, updatedInventory } = addItemsToInventory([...user.inventory], user.inventorySlots, itemsToCreate);
        
        if (!success) {
            console.error(`[SP Summary] Insufficient inventory space for user ${user.id} on stage ${stage.id}. Items not granted.`);
            summary.items = []; // 아이템은 지급하지 않음
            // Optionally, send items via mail here in the future
        } else {
            // Update inventory with the returned updatedInventory
            user.inventory = updatedInventory;
            summary.items = itemsToCreate;
        }

        // 보너스 스탯 처리
        if (rewards.bonus && rewards.bonus.startsWith('스탯')) {
            const points = parseInt(rewards.bonus.replace('스탯', ''), 10);
            if (!isNaN(points)) {
                user.bonusStatPoints = (user.bonusStatPoints || 0) + points;
                if (!summary.items) summary.items = [];
                summary.items.push({
                    id: `stat-points-${Date.now()}`,
                    name: `보너스 스탯`,
                    image: '/images/icons/stat_point.png',
                    type: 'consumable',
                    grade: 'rare',
                    quantity: points
                } as any);
            }
        }
    } else {
        // 실패시 보상: 재도전이고 기권이 아닌 경우에만 성공 보상의 10% 지급
        const isResign = game.winReason === 'resign';
        
        if (isRepeatAttempt && !isResign && !game.isAiGame) {
            // 재도전 실패 보상: 성공시 보상의 10% (골드, 경험치만)
            const successRewards = stage.rewards.repeatClear;
            
            const failureRewards = {
                gold: Math.round(successRewards.gold * 0.1),
                exp: Math.round(successRewards.exp * 0.1)
            };
            
            console.log(`[SP Summary] Stage ${stage.id} - Failure reward (10% of success): gold=${failureRewards.gold}, exp=${failureRewards.exp}`);
            
            user.gold += failureRewards.gold;
            const initialXp = user.strategyXp;
            user.strategyXp += failureRewards.exp;
            
            summary.gold = failureRewards.gold;
            summary.xp = { initial: initialXp, change: failureRewards.exp, final: user.strategyXp };
            summary.items = [];
        }
    }

    // Always create a summary object, even on loss (with no rewards)
    if (!game.summary) game.summary = {};
    game.summary[user.id] = summary;
    
    console.log(`[SP Summary] Final summary for user ${user.id}:`, JSON.stringify(summary));
    
    // Handle level up logic after potentially adding XP
    let currentLevel = user.strategyLevel;
    let currentXp = user.strategyXp;
    let requiredXp = getXpForLevel(currentLevel);
    while (currentXp >= requiredXp) {
        currentXp -= requiredXp;
        currentLevel++;
        requiredXp = getXpForLevel(currentLevel);
    }
    user.strategyLevel = currentLevel;
    user.strategyXp = currentXp;

    await db.updateUser(user);
    
    // 사용자 업데이트를 클라이언트에 브로드캐스트 (clearedSinglePlayerStages 업데이트 포함)
    const { broadcast } = await import('./socket.js');
    broadcast({ type: 'USER_UPDATE', payload: { [user.id]: user } });
};

const processTowerGameSummary = async (game: LiveGameSession) => {
    // DB에서 최신 사용자 데이터를 가져와서 towerFloor가 정확한지 확인
    const freshUser = await db.getUser(game.player1.id);
    if (!freshUser) {
        console.error(`[Tower Summary] Could not find user ${game.player1.id} in database`);
        return;
    }
    
    const user = freshUser; // 최신 사용자 데이터 사용
    const isWinner = game.winner === Player.Black; // Human is always black
    
    // 디버깅: 승자 판정 로그
    console.log(`[processTowerGameSummary] Game ${game.id}: game.winner=${game.winner === Player.Black ? 'Black' : game.winner === Player.White ? 'White' : 'None'}, isWinner=${isWinner}, finalScores=${JSON.stringify(game.finalScores)}`);
    
    const floor = game.towerFloor ?? 1;
    const userTowerFloor = user.towerFloor ?? 0;
    const stage = TOWER_STAGES.find(s => {
        const stageFloor = parseInt(s.id.replace('tower-', ''));
        return stageFloor === floor;
    });

    if (!stage) {
        console.error(`[Tower Summary] Could not find stage for floor: ${floor}`);
        return;
    }

    // Initialize with a base structure
    const summary: GameSummary = {
        xp: { initial: user.strategyXp, change: 0, final: user.strategyXp },
        rating: { initial: 1200, change: 0, final: 1200 }, // Not applicable
        manner: { initial: user.mannerScore, change: 0, final: user.mannerScore },
        gold: 0,
        items: [],
    };
    
    if (isWinner) {
        // 클리어한 층 재도전 여부 확인
        const isCleared = floor <= userTowerFloor;
        const userMonthlyTowerFloor = (user as any).monthlyTowerFloor ?? 0;
        
        // towerFloor 업데이트 (현재 층이 사용자의 최고 층수보다 높으면 업데이트)
        if (floor > userTowerFloor) {
            user.towerFloor = floor;
            user.lastTowerClearTime = Date.now();
            console.log(`[Tower Summary] Updating towerFloor: ${userTowerFloor} -> ${floor}`);
        }
        
        // monthlyTowerFloor 업데이트 (현재 층이 사용자의 월간 최고 층수보다 높으면 업데이트)
        if (floor > userMonthlyTowerFloor) {
            (user as any).monthlyTowerFloor = floor;
            console.log(`[Tower Summary] Updating monthlyTowerFloor: ${userMonthlyTowerFloor} -> ${floor}`);
        }
        
        if (isCleared) {
            // 클리어한 층 재도전 시 보상 없음
            console.log(`[Tower Summary] Floor ${floor} - Already cleared, no reward on retry`);
        } else {
            // 최초 클리어 시에만 보상 지급
            const rewards = stage.rewards.firstClear;
            
            user.gold += rewards.gold;
            const initialXp = user.strategyXp;
            user.strategyXp += rewards.exp;
            
            summary.gold = rewards.gold;
            summary.xp = { initial: initialXp, change: rewards.exp, final: user.strategyXp };
            
            // 아이템 보상 처리
            if (rewards.items && rewards.items.length > 0) {
                const itemInstances = createItemInstancesFromReward(rewards.items);
                const { success, updatedInventory, finalItemsToAdd } = addItemsToInventory([...user.inventory], user.inventorySlots, itemInstances);
                
                if (success) {
                    user.inventory = updatedInventory;
                    summary.items = finalItemsToAdd;
                } else {
                    console.error(`[Tower Summary] Insufficient inventory space for user ${user.id} on floor ${floor}. Items not granted.`);
                    summary.items = [];
                }
            }
            
            // 도전의 탑 아이템 획득 로직 (30% 확률)
            const towerItemDropChance = Math.random();
            if (towerItemDropChance < 0.3) {
                // 도전의 탑 아이템 정의 (maxOwned 정보 포함)
                const towerItems = [
                    { name: '턴 추가', weight: 10, maxOwned: 3 },
                    { name: '미사일', weight: 10, maxOwned: 2 },
                    { name: '히든', weight: 5, maxOwned: 2 },
                    { name: '스캔', weight: 30, maxOwned: 5 },
                    { name: '배치변경', weight: 45, maxOwned: 5 },
                ];
                
                // 현재 보유량 확인 및 최대 보유수량에 도달하지 않은 아이템만 필터링
                const availableItems = towerItems.filter(towerItem => {
                    const inventoryItem = user.inventory.find(inv => inv.name === towerItem.name && inv.type === 'consumable');
                    const currentQuantity = inventoryItem?.quantity || 0;
                    return currentQuantity < towerItem.maxOwned;
                });
                
                // 사용 가능한 아이템이 있으면 획득
                if (availableItems.length > 0) {
                    // 가중치 기반 랜덤 선택
                    const totalWeight = availableItems.reduce((sum, item) => sum + item.weight, 0);
                    let random = Math.random() * totalWeight;
                    
                    let selectedItem = availableItems[0];
                    for (const item of availableItems) {
                        random -= item.weight;
                        if (random <= 0) {
                            selectedItem = item;
                            break;
                        }
                    }
                    
                    // 선택된 아이템 생성
                    const towerItemInstance = createConsumableItemInstance(selectedItem.name);
                    if (towerItemInstance) {
                        const { success, updatedInventory, finalItemsToAdd } = addItemsToInventory([...user.inventory], user.inventorySlots, [towerItemInstance]);
                        
                        if (success) {
                            user.inventory = updatedInventory;
                            if (!summary.items) summary.items = [];
                            summary.items.push(...finalItemsToAdd);
                            console.log(`[Tower Summary] Floor ${floor} - Tower item dropped: ${selectedItem.name}`);
                        } else {
                            console.error(`[Tower Summary] Insufficient inventory space for tower item ${selectedItem.name} on floor ${floor}`);
                        }
                    }
                } else {
                    console.log(`[Tower Summary] Floor ${floor} - Tower item drop chance hit, but all items at max owned`);
                }
            }
            
            console.log(`[Tower Summary] Floor ${floor} - First clear reward: gold=${rewards.gold}, exp=${rewards.exp}, items=${summary.items?.length || 0}`);
        }
    } else {
        // 실패 시 보상 없음
        console.log(`[Tower Summary] Floor ${floor} - Failed, no reward`);
    }

    // Always create a summary object, even on loss (with no rewards)
    if (!game.summary) game.summary = {};
    game.summary[user.id] = summary;
    
    // Handle level up logic after potentially adding XP (승리 시에만)
    if (isWinner) {
        let currentLevel = user.strategyLevel;
        let currentXp = user.strategyXp;
        let requiredXp = getXpForLevel(currentLevel);
        while (currentXp >= requiredXp) {
            currentXp -= requiredXp;
            currentLevel++;
            requiredXp = getXpForLevel(currentLevel);
        }
        user.strategyLevel = currentLevel;
        user.strategyXp = currentXp;
    }

    // towerFloor 또는 monthlyTowerFloor가 업데이트되었거나, 보상이 지급된 경우 DB 저장
    const towerFloorUpdated = isWinner && (floor > userTowerFloor || floor > ((user as any).monthlyTowerFloor ?? 0));
    const hasRewards = summary.gold > 0 || summary.xp.change > 0 || (summary.items && summary.items.length > 0);
    const levelUpOccurred = user.strategyLevel !== (freshUser.strategyLevel ?? 0);
    
    // towerFloor 업데이트가 있으면 즉시 저장하고 브로드캐스트 (다음 층 도전 버튼 활성화를 위해)
    if (towerFloorUpdated) {
        await db.updateUser(user);
        console.log(`[Tower Summary] User ${user.nickname} towerFloor updated immediately: ${userTowerFloor} -> ${user.towerFloor}, monthlyTowerFloor=${(user as any).monthlyTowerFloor}`);
        
        // towerFloor 업데이트를 즉시 브로드캐스트 (다음 층 도전 버튼 활성화)
        const { broadcastUserUpdate } = await import('./socket.js');
        broadcastUserUpdate(user, ['towerFloor', 'monthlyTowerFloor']);
    }
    
    // 보상이 있으면 즉시 저장하고 브로드캐스트 (지연 방지)
    if (hasRewards) {
        if (!towerFloorUpdated) {
            await db.updateUser(user);
        }
        console.log(`[Tower Summary] User ${user.nickname} rewards saved immediately: gold=${user.gold}, xp=${user.strategyXp}, level=${user.strategyLevel}`);
        
        // 사용자 업데이트를 즉시 브로드캐스트 (보상 지급 확인)
        const { broadcastUserUpdate } = await import('./socket.js');
        const fieldsToUpdate = ['gold', 'diamonds', 'strategyXp', 'strategyLevel', 'inventory'];
        if (!towerFloorUpdated) {
            fieldsToUpdate.push('towerFloor', 'monthlyTowerFloor');
        }
        broadcastUserUpdate(user, fieldsToUpdate);
    }
    
    // 레벨업이 있으면 추가로 저장 (towerFloor나 보상이 없었던 경우)
    if (levelUpOccurred && !towerFloorUpdated && !hasRewards) {
        await db.updateUser(user);
        console.log(`[Tower Summary] User ${user.nickname} level up saved: level=${user.strategyLevel}`);
        
        const { broadcastUserUpdate } = await import('./socket.js');
        broadcastUserUpdate(user, ['strategyLevel', 'strategyXp']);
    }
    
    if (!towerFloorUpdated && !hasRewards && !levelUpOccurred) {
        console.log(`[Tower Summary] No changes to save for user ${user.nickname} (floor ${floor}, already cleared: ${floor <= userTowerFloor})`);
    }
};

export const endGame = async (game: LiveGameSession, winner: Player, winReason: WinReason): Promise<void> => {
    if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') {
        return; // Game already ended, do nothing
    }
    
    const now = Date.now();
    const gameStartTime = game.gameStartTime || game.createdAt || now;
    const gameDuration = now - gameStartTime;
    const moveCount = game.moveHistory?.filter(m => m.x !== -1 && m.y !== -1).length || 0;
    
    // 조기 종료 조건 확인 (10턴 이내 또는 1분 이내 기권/접속 끊김)
    const isEarlyTermination = (moveCount <= 10 || gameDuration < 60000) && 
                                (winReason === 'resign' || winReason === 'disconnect');
    
    // 비매너 행동자 식별 (조기 종료를 한 사람)
    let badMannerPlayerId: string | null = null;
    if (isEarlyTermination) {
        if (winReason === 'resign') {
            // 기권한 사람이 비매너 행동자
            badMannerPlayerId = winner === Player.Black ? game.whitePlayerId! : game.blackPlayerId!;
        } else if (winReason === 'disconnect') {
            // 접속 끊긴 사람이 비매너 행동자
            const disconnectedPlayerId = game.lastTimeoutPlayerId || 
                                        (winner === Player.Black ? game.whitePlayerId! : game.blackPlayerId!);
            badMannerPlayerId = disconnectedPlayerId;
        }
    }
    
    game.winner = winner;
    game.winReason = winReason;
    game.gameStatus = 'ended';
    
    // 디버깅: 승자 설정 로그
    console.log(`[endGame] Game ${game.id} ended: winner=${winner === Player.Black ? 'Black' : winner === Player.White ? 'White' : 'None'}, winReason=${winReason}, finalScores=${JSON.stringify(game.finalScores)}`);
    game.isEarlyTermination = isEarlyTermination; // 조기 종료 플래그
    game.badMannerPlayerId = badMannerPlayerId ?? undefined; // 비매너 행동자 ID

    // 도전의 탑 게임 처리는 processTowerGameSummary에서만 수행 (중복 업데이트 방지)
    if (game.gameCategory === 'tower') {
        await processTowerGameSummary(game);
    } else if (game.isSinglePlayer) {
        await processSinglePlayerGameSummary(game);
    } else {
        const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
        const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
        // 놀이바둑과 전략바둑은 항상 processGameSummary 호출 (statsUpdated 체크 제거)
        if (isPlayful || isStrategic) {
            if (!game.statsUpdated) {
                await processGameSummary(game);
            }
        }
    }

    game.statsUpdated = true;
    await db.saveGame(game);
    
    // summary가 설정된 후 최신 게임 상태를 다시 가져와서 브로드캐스트
    const freshGame = await db.getLiveGame(game.id);
    if (!freshGame) {
        console.error(`[endGame] Could not retrieve fresh game ${game.id} after summary processing`);
        return;
    }
    
    clearAiSession(game.id);
    
    // AI 처리 큐에서도 제거
    if (game.isSinglePlayer) {
        const { aiProcessingQueue } = await import('./aiProcessingQueue.js');
        aiProcessingQueue.dequeue(game.id);
    }
    
    // 조기 종료인 경우 행동력 환불 처리 및 패널티 메일 발송
    // 도전의 탑, 싱글플레이, AI 게임, 친선전에서는 패널티 없음
    const isNoPenaltyGame = game.isSinglePlayer || game.gameCategory === 'tower' || game.isAiGame || !game.isRankedGame;
    if (isEarlyTermination && !isNoPenaltyGame) {
        await refundActionPointsForEarlyTermination(freshGame, badMannerPlayerId);
        if (badMannerPlayerId) {
            await sendBadMannerPenaltyMail(freshGame, badMannerPlayerId);
        }
    }
    
    // 게임 종료 및 분석 결과 브로드캐스트 (게임 참가자에게만 전송, summary 포함)
    const { broadcastToGameParticipants } = await import('./socket.js');
    console.log(`[endGame] Broadcasting game ${freshGame.id} with summary: ${JSON.stringify(freshGame.summary)}`);
    broadcastToGameParticipants(freshGame.id, { type: 'GAME_UPDATE', payload: { [freshGame.id]: freshGame } }, freshGame);
};

// 행동력 환불 함수
const refundActionPointsForEarlyTermination = async (
    game: LiveGameSession, 
    badMannerPlayerId: string | null
): Promise<void> => {
    const { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, STRATEGIC_ACTION_POINT_COST, PLAYFUL_ACTION_POINT_COST } = await import('../constants');
    
    const getActionPointCost = (mode: GameMode): number => {
        if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
            return STRATEGIC_ACTION_POINT_COST;
        }
        if (PLAYFUL_GAME_MODES.some(m => m.mode === mode)) {
            return PLAYFUL_ACTION_POINT_COST;
        }
        return STRATEGIC_ACTION_POINT_COST;
    };
    
    const cost = getActionPointCost(game.mode);
    const player1 = await db.getUser(game.player1.id);
    const player2 = await db.getUser(game.player2.id);
    
    if (!player1 || !player2) return;
    
    // 비매너 행동자가 아닌 사람에게만 환불
    if (badMannerPlayerId !== player1.id && !player1.isAdmin) {
        player1.actionPoints.current = Math.min(
            player1.actionPoints.max, 
            player1.actionPoints.current + cost
        );
        player1.lastActionPointUpdate = Date.now();
        await db.updateUser(player1);
    }
    
    if (badMannerPlayerId !== player2.id && !player2.isAdmin) {
        player2.actionPoints.current = Math.min(
            player2.actionPoints.max, 
            player2.actionPoints.current + cost
        );
        player2.lastActionPointUpdate = Date.now();
        await db.updateUser(player2);
    }
    
    // 환불된 사용자에게 브로드캐스트
    const { broadcast } = await import('./socket.js');
    if (badMannerPlayerId !== player1.id) {
        broadcast({ type: 'USER_UPDATE', payload: { [player1.id]: player1 } });
    }
    if (badMannerPlayerId !== player2.id) {
        broadcast({ type: 'USER_UPDATE', payload: { [player2.id]: player2 } });
    }
};

// 패널티 메일 발송 함수
const sendBadMannerPenaltyMail = async (
    game: LiveGameSession,
    badMannerPlayerId: string
): Promise<void> => {
    const badMannerPlayer = await db.getUser(badMannerPlayerId);
    if (!badMannerPlayer) return;
    
    const opponent = game.player1.id === badMannerPlayerId ? 
                     await db.getUser(game.player2.id) : 
                     await db.getUser(game.player1.id);
    
    if (!opponent) return;
    
    const moveCount = game.moveHistory?.filter(m => m.x !== -1 && m.y !== -1).length || 0;
    const gameStartTime = game.gameStartTime || game.createdAt || Date.now();
    const gameDuration = Date.now() - gameStartTime;
    
    let penaltyReason = '';
    if (moveCount <= 10) {
        penaltyReason = `게임 시작 후 10턴 이내에 종료하여`;
    } else if (gameDuration < 60000) {
        penaltyReason = `게임 시작 후 1분 이내에 종료하여`;
    }
    
    if (game.winReason === 'resign') {
        penaltyReason += ' 기권';
    } else if (game.winReason === 'disconnect') {
        penaltyReason += ' 접속 끊김';
    }
    
    const isRanked = game.isRankedGame ?? false;
    const title = isRanked ? '랭킹전 비매너 행동 패널티 안내' : '비매너 행동 패널티 안내';
    const penaltyDescription = isRanked 
        ? `- 랭킹 점수 대폭 하락\n- 매너 점수 감소\n- 행동력 환불 불가 (상대방에게만 환불됨)`
        : `- 매너 점수 감소\n- 행동력 환불 불가 (상대방에게만 환불됨)`;
    
    const penaltyMail: Mail = {
        id: `mail-penalty-${randomUUID()}`,
        from: '시스템',
        title: title,
        message: `안녕하세요, ${badMannerPlayer.nickname}님.\n\n` +
                 `대국 중 비매너 행동으로 인해 패널티가 적용되었습니다.\n\n` +
                 `[패널티 사유]\n` +
                 `${penaltyReason}로 인해 게임이 조기 종료되었습니다.\n\n` +
                 `[적용된 패널티]\n` +
                 `${penaltyDescription}\n\n` +
                 `정상적인 게임 진행을 위해 협조 부탁드립니다.`,
        receivedAt: Date.now(),
        expiresAt: undefined, // 무제한
        isRead: false,
        attachmentsClaimed: false,
    };
    
    if (!badMannerPlayer.mail) {
        badMannerPlayer.mail = [];
    }
    badMannerPlayer.mail.unshift(penaltyMail);
    
    await db.updateUser(badMannerPlayer);
    
    const { broadcast } = await import('./socket.js');
    broadcast({ type: 'USER_UPDATE', payload: { [badMannerPlayer.id]: badMannerPlayer } });
};

const createConsumableItemInstance = (name: string): InventoryItem | null => {
    const template = CONSUMABLE_ITEMS.find(item => item.name === name);
    if (!template) {
        console.error(`[Reward] Consumable item template not found for: ${name}`);
        return null;
    }

    return {
        ...template,
        id: `item-${randomUUID()}`,
        quantity: 1,
        createdAt: Date.now(),
        isEquipped: false,
        level: 1,
        stars: 0,
    };
};

// --- START NEW REWARD CONSTANTS ---

// Strategic Loot Table
const STRATEGIC_LOOT_TABLE: { name: string; chance: number; type: 'equipment' | 'material' }[] = [
    { name: '재료 상자 IV', chance: 0.1, type: 'material' },
    { name: '장비 상자 IV', chance: 0.1, type: 'equipment' },
    { name: '재료 상자 III', chance: 1, type: 'material' },
    { name: '장비 상자 III', chance: 1, type: 'equipment' },
    { name: '재료 상자 II', chance: 3, type: 'material' },
    { name: '장비 상자 II', chance: 3, type: 'equipment' },
    { name: '재료 상자 I', chance: 15, type: 'material' },
    { name: '장비 상자 I', chance: 15, type: 'equipment' },
];

// Playful Loot Tables
const PLAYFUL_LOOT_TABLE_3_ROUNDS: { name: string; chance: number; type: 'equipment' | 'material' }[] = [
    { name: '재료 상자 IV', chance: 0.05, type: 'material' },
    { name: '장비 상자 IV', chance: 0.05, type: 'equipment' },
    { name: '재료 상자 III', chance: 0.1, type: 'material' },
    { name: '장비 상자 III', chance: 0.1, type: 'equipment' },
    { name: '재료 상자 II', chance: 1, type: 'material' },
    { name: '장비 상자 II', chance: 1, type: 'equipment' },
    { name: '재료 상자 I', chance: 10, type: 'material' },
    { name: '장비 상자 I', chance: 10, type: 'equipment' },
];

const PLAYFUL_LOOT_TABLE_2_ROUNDS: { name: string; chance: number; type: 'equipment' | 'material' }[] = [
    { name: '재료 상자 IV', chance: 0.03, type: 'material' },
    { name: '장비 상자 IV', chance: 0.03, type: 'equipment' },
    { name: '재료 상자 III', chance: 0.05, type: 'material' },
    { name: '장비 상자 III', chance: 0.05, type: 'equipment' },
    { name: '재료 상자 II', chance: 0.5, type: 'material' },
    { name: '장비 상자 II', chance: 0.5, type: 'equipment' },
    { name: '재료 상자 I', chance: 5, type: 'material' },
    { name: '장비 상자 I', chance: 5, type: 'equipment' },
];

const PLAYFUL_LOOT_TABLE_1_ROUND: { name: string; chance: number; type: 'equipment' | 'material' }[] = [
    { name: '재료 상자 IV', chance: 0.01, type: 'material' },
    { name: '장비 상자 IV', chance: 0.01, type: 'equipment' },
    { name: '재료 상자 III', chance: 0.03, type: 'material' },
    { name: '장비 상자 III', chance: 0.03, type: 'equipment' },
    { name: '재료 상자 II', chance: 0.1, type: 'material' },
    { name: '장비 상자 II', chance: 0.1, type: 'equipment' },
    { name: '재료 상자 I', chance: 2, type: 'material' },
    { name: '장비 상자 I', chance: 2, type: 'equipment' },
];

// Strategic Gold Map
const STRATEGIC_GOLD_REWARDS: Record<number, number> = {
    19: 1500, 17: 1300, 15: 1100, 13: 900, 11: 700, 9: 500, 7: 300
};

// Playful Gold Map
const PLAYFUL_GOLD_REWARDS: Record<number, number> = {
    3: 800, 2: 500, 1: 200,
};

// --- END NEW REWARD CONSTANTS ---


const calculateGameRewards = (
    game: LiveGameSession, 
    player: User,
    isWinner: boolean, 
    isDraw: boolean,
    itemDropBonus: number,
    materialDropBonus: number,
    rewardMultiplier: number,
    effects: effectService.CalculatedEffects
): { gold: number; items: InventoryItem[] } => {
    const { mode, settings, isAiGame } = game;

    let baseGold = 0;
    let lootTable: { name: string; chance: number; type: 'equipment' | 'material' }[] = [];
    
    if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
        baseGold = STRATEGIC_GOLD_REWARDS[settings.boardSize as keyof typeof STRATEGIC_GOLD_REWARDS] || STRATEGIC_GOLD_REWARDS[19];
        lootTable = STRATEGIC_LOOT_TABLE;
    } else {
        let rounds = 1; // Default for Omok/Ttamok
        if (mode === GameMode.Dice) rounds = settings.diceGoRounds || 3;
        else if (mode === GameMode.Alkkagi) rounds = settings.alkkagiRounds || 1;
        else if (mode === GameMode.Curling) rounds = settings.curlingRounds || 3;
        else if (mode === GameMode.Thief) rounds = 2;

        baseGold = PLAYFUL_GOLD_REWARDS[rounds as keyof typeof PLAYFUL_GOLD_REWARDS] || PLAYFUL_GOLD_REWARDS[1];
        if (rounds === 3) lootTable = PLAYFUL_LOOT_TABLE_3_ROUNDS;
        else if (rounds === 2) lootTable = PLAYFUL_LOOT_TABLE_2_ROUNDS;
        else lootTable = PLAYFUL_LOOT_TABLE_1_ROUND;
    }

    // Determine gold multiplier
    const outcomeMultiplier = isWinner ? 1.0 : isDraw ? 0 : 0.25;
    let goldReward = Math.round(baseGold * outcomeMultiplier);
    
    // Apply monthly gold buff
    if (player.monthlyGoldBuffExpiresAt && player.monthlyGoldBuffExpiresAt > Date.now()) {
        goldReward = Math.round(goldReward * 1.5);
    }
    
    // Apply AI game penalty
    if (isAiGame) {
        goldReward = Math.round(goldReward * 0.2);
    }
    
    // Apply reward multiplier for all games
    goldReward = Math.round(goldReward * rewardMultiplier);

    // Apply manner penalties and bonuses
    goldReward = Math.round(goldReward * effects.goldRewardMultiplier);
    if (isWinner && effects.winGoldBonusPercent !== 0) {
        goldReward = Math.round(goldReward * (1 + effects.winGoldBonusPercent / 100));
    }

    // Determine item drop logic
    const itemsDropped: InventoryItem[] = [];
    // No items from AI games
    const canDropItem = (isWinner || !isDraw) && !isAiGame; 
    
    if (canDropItem && lootTable.length > 0) {
        const dropChanceMultiplier = (isWinner ? 1.0 : 0.5) * rewardMultiplier * effects.dropChanceMultiplier;

        for (const loot of lootTable) {
            const bonus = loot.type === 'equipment' ? itemDropBonus : materialDropBonus;
            const baseChance = loot.chance * dropChanceMultiplier;
            const additionalPercent = bonus + (isWinner ? effects.winDropBonusPercent : 0) + effects.itemDropRateBonus;
            const effectiveChance = baseChance * (1 + additionalPercent / 100);
            
            if (Math.random() * 100 < effectiveChance) {
                const droppedItem = createConsumableItemInstance(loot.name);
                if (droppedItem) itemsDropped.push(droppedItem);
                break; // only one item can be dropped
            }
        }
    }
    
    return { gold: goldReward, items: itemsDropped };
};


export const calculateEloChange = (playerRating: number, opponentRating: number, result: 'win' | 'loss' | 'draw'): number => {
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    const actualScore = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    const ratingChange = K * (actualScore - expectedScore);
    return Math.round(ratingChange);
};

const processPlayerSummary = async (
    player: User,
    opponent: User,
    isWinner: boolean,
    isDraw: boolean,
    game: LiveGameSession,
    isNoContest: boolean,
    isInitiator: boolean
): Promise<{ summary: GameSummary; updatedPlayer: User }> => {
    
    const updatedPlayer: User = JSON.parse(JSON.stringify(player)); // Create a deep mutable copy
    const { mode, winReason, isAiGame } = game;

    // --- XP and Level ---
    const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === mode);
    const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === mode);
    const initialLevel = isStrategic ? updatedPlayer.strategyLevel : updatedPlayer.playfulLevel;
    const opponentLevel = isStrategic ? opponent.strategyLevel : opponent.playfulLevel;
    const initialXp = isStrategic ? updatedPlayer.strategyXp : updatedPlayer.playfulXp;
    let xpGain = isNoContest ? 0 : (isWinner ? 100 : (isDraw ? 0 : 25)); // Loss XP increased to 25

    // Apply AI game penalty before other multipliers
    if (isAiGame) {
        xpGain = Math.round(xpGain * 0.2);
    }

    // Level difference multiplier
    const levelDiff = opponentLevel - initialLevel;
    let levelMultiplier = 1 + (levelDiff * 0.1); // 10% per level difference
    levelMultiplier = Math.max(0.5, Math.min(1.5, levelMultiplier)); // Cap between 50% and 150%
    xpGain = Math.round(xpGain * levelMultiplier);

    const effects = effectService.calculateUserEffects(updatedPlayer);

    const xpBonusPercent = isStrategic 
        ? effects.specialStatBonuses[SpecialStat.StrategyXpBonus].percent 
        : effects.specialStatBonuses[SpecialStat.PlayfulXpBonus].percent;

    if (xpBonusPercent > 0) {
        xpGain = Math.round(xpGain * (1 + xpBonusPercent / 100));
    }

    // --- Reward Multiplier ---
    let rewardMultiplier = 1.0;
    if (isStrategic && !isNoContest) {
        // Base move count for 100% reward, scaled by board size. 19x19 is 100 moves.
        const baseMoveCount = Math.round(100 * Math.pow(game.settings.boardSize / 19, 2));
        const actualMoveCount = game.moveHistory.length;
        
        // Calculate the reward multiplier, capped at 100%
        rewardMultiplier = Math.min(1, actualMoveCount / baseMoveCount);
    } else if (isPlayful && !isNoContest) {
        const gameDurationSeconds = (Date.now() - game.createdAt) / 1000;
        if (gameDurationSeconds < 30) {
            rewardMultiplier = 0.05;
        } else {
            rewardMultiplier = Math.min(1, gameDurationSeconds / 300);
        }
    }
    
    // Apply the multiplier to XP
    xpGain = Math.round(xpGain * rewardMultiplier);
    // --- END NEW LOGIC ---

    let currentXp = initialXp + xpGain;
    let currentLevel = initialLevel;
    const requiredXpForInitialLevel = getXpForLevel(currentLevel);

    let requiredXpForCurrentLevel = requiredXpForInitialLevel;
    while (currentXp >= requiredXpForCurrentLevel) {
        currentXp -= requiredXpForCurrentLevel;
        currentLevel++;
        requiredXpForCurrentLevel = getXpForLevel(currentLevel);
    }
    
    const xpSummary: StatChange = { initial: initialXp, change: xpGain, final: currentXp };
    const levelSummary = {
        initial: initialLevel,
        final: currentLevel,
        progress: { 
            initial: initialXp, 
            final: currentXp, 
            max: requiredXpForInitialLevel 
        }
    };

    if (isStrategic) {
        updatedPlayer.strategyLevel = currentLevel;
        updatedPlayer.strategyXp = currentXp;
    } else {
        updatedPlayer.playfulLevel = currentLevel;
        updatedPlayer.playfulXp = currentXp;
    }

    // --- Rating ---
    if (!updatedPlayer.stats) updatedPlayer.stats = {};
    const gameStats = updatedPlayer.stats[mode] ?? { wins: 0, losses: 0, rankingScore: 1200 };
    
    const initialRating = gameStats.rankingScore;
    const opponentStats = opponent.stats?.[mode] ?? { wins: 0, losses: 0, rankingScore: 1200 };
    const opponentRating = opponent.id === aiUserId ? (initialRating - 50 + Math.random() * 100) : opponentStats.rankingScore;
    
    let ratingChange = 0;
    // 랭킹전이 아니면 랭킹 점수 변동 없음 (친선전)
    if (game.isRankedGame && !isNoContest && !isAiGame) {
        // 랭킹전에서 조기 종료 시 대폭 하락
        const isRankedEarlyTermination = game.isEarlyTermination && game.badMannerPlayerId === player.id;
        if (isRankedEarlyTermination) {
            ratingChange = -100; // 랭킹전 조기 종료 시 -100점 하락
        } else {
            const result = isWinner ? 'win' : isDraw ? 'draw' : 'loss';
            ratingChange = calculateEloChange(initialRating, opponentRating, result);
            
            // 클래식바둑 특별 처리: 승리시 2배, 패배시 절반
            if (mode === GameMode.Standard) {
                if (isWinner) {
                    ratingChange = ratingChange * 2;
                } else if (!isDraw) {
                    ratingChange = Math.round(ratingChange / 2);
                }
            }
        }
    }
    
    gameStats.rankingScore = Math.max(0, initialRating + ratingChange);
    const ratingSummary: StatChange = { initial: initialRating, change: ratingChange, final: gameStats.rankingScore };
    
    // --- Manner Score ---
    const isDisconnectLoss = winReason === 'disconnect' && !isWinner && !isDraw;
    const mannerChangeFromActions = game.mannerScoreChanges?.[player.id] || 0;
    const initialMannerBeforeGame = player.mannerScore - mannerChangeFromActions;

    let mannerChangeFromGameEnd = 0;
    // 랭킹전에서 조기 종료 시 추가 매너 점수 하락
    const isRankedEarlyTermination = game.isRankedGame && game.isEarlyTermination && game.badMannerPlayerId === player.id;
    if (isRankedEarlyTermination) {
        mannerChangeFromGameEnd = -50; // 랭킹전 조기 종료 시 더 큰 패널티
    } else if (isDisconnectLoss) {
        mannerChangeFromGameEnd = -20;
    } else if (!isNoContest) {
        // mannerChangeFromGameEnd = 2; // +2 for completing a game (win, loss, or draw)
    }

    const finalMannerScore = player.mannerScore + mannerChangeFromGameEnd;
    updatedPlayer.mannerScore = Math.max(0, finalMannerScore);
    
    const totalMannerChange = mannerChangeFromActions + mannerChangeFromGameEnd;

    const mannerSummary: StatChange = {
        initial: initialMannerBeforeGame,
        change: totalMannerChange,
        final: updatedPlayer.mannerScore
    };

    await mannerService.applyMannerRankChange(updatedPlayer, initialMannerBeforeGame);

    // --- Wins/Losses ---
    if (!isNoContest) {
        if (isWinner) gameStats.wins++;
        else if (!isDraw) gameStats.losses++;
    }
    
    updatedPlayer.stats[mode] = gameStats;
    
    // --- Update cumulativeRankingScore for strategic/playful modes ---
    if (!isNoContest && !isAiGame) {
        if (!updatedPlayer.cumulativeRankingScore) {
            updatedPlayer.cumulativeRankingScore = {};
        }
        
        const ELO_BASE_SCORE = 1200; // ELO 기준 점수
        
        if (isStrategic) {
            // 전략바둑: 모든 전략바둑 모드의 rankingScore 평균 계산 후 1200에서의 차이를 저장
            let totalScore = 0;
            let modeCount = 0;
            for (const strategicMode of SPECIAL_GAME_MODES) {
                const modeStats = updatedPlayer.stats?.[strategicMode.mode];
                if (modeStats && modeStats.rankingScore !== undefined) {
                    totalScore += modeStats.rankingScore;
                    modeCount++;
                }
            }
            if (modeCount > 0) {
                const averageScore = Math.round(totalScore / modeCount);
                // 1200에서의 차이를 저장 (예: 826점이면 -374점)
                updatedPlayer.cumulativeRankingScore['standard'] = averageScore - ELO_BASE_SCORE;
            }
        } else if (isPlayful) {
            // 놀이바둑: 모든 놀이바둑 모드의 rankingScore 평균 계산 후 1200에서의 차이를 저장
            let totalScore = 0;
            let modeCount = 0;
            for (const playfulMode of PLAYFUL_GAME_MODES) {
                const modeStats = updatedPlayer.stats?.[playfulMode.mode];
                if (modeStats && modeStats.rankingScore !== undefined) {
                    totalScore += modeStats.rankingScore;
                    modeCount++;
                }
            }
            if (modeCount > 0) {
                const averageScore = Math.round(totalScore / modeCount);
                // 1200에서의 차이를 저장 (예: 826점이면 -374점)
                updatedPlayer.cumulativeRankingScore['playful'] = averageScore - ELO_BASE_SCORE;
            }
        }
    }
    
    // Apply rewards
    const itemDropBonus = effects.specialStatBonuses[SpecialStat.ItemDropRate].percent;
    const materialDropBonus = effects.specialStatBonuses[SpecialStat.MaterialDropRate].percent;
    let rewards = isNoContest
        ? { gold: 0, items: [] }
        : calculateGameRewards(game, updatedPlayer, isWinner, isDraw, itemDropBonus, materialDropBonus, rewardMultiplier, effects);

    // 친선전(랭킹전 제외)에서는 골드 보상만 절반으로 감소 (아이템 획득 확률은 유지)
    if (!isNoContest && !game.isRankedGame && !isAiGame) {
        rewards.gold = Math.round(rewards.gold * 0.5);
    }

    // PVP 게임에서 변경권 획득 로직 (전략바둑, 놀이바둑 PVP 모드만)
    if (!isNoContest && !isAiGame && !game.isSinglePlayer && game.gameCategory !== 'tower') {
        const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
        const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
        
        if (isStrategic || isPlayful) {
            // 승리: 30% 확률, 패배: 5% 확률
            const dropChance = isWinner ? 0.3 : 0.05;
            if (Math.random() < dropChance) {
                // 획득 확정 시: 수치 변경권(60%), 종류 변경권(25%), 신화 변경권(15%)
                const ticketRandom = Math.random();
                let ticketName: string;
                if (ticketRandom < 0.6) {
                    ticketName = '옵션 수치 변경권';
                } else if (ticketRandom < 0.85) {
                    ticketName = '옵션 종류 변경권';
                } else {
                    ticketName = '신화 옵션 변경권';
                }
                
                const ticketItem = createConsumableItemInstance(ticketName);
                if (ticketItem) {
                    rewards.items.push(ticketItem);
                    console.log(`[PVP Reward] User ${updatedPlayer.nickname} acquired ${ticketName} from ${isWinner ? 'win' : 'loss'}`);
                }
            }
        }
    }

    updatedPlayer.gold += rewards.gold;

    // Add dropped items to inventory
    if (rewards.items.length > 0) {
        const { success, updatedInventory } = addItemsToInventory(updatedPlayer.inventory, updatedPlayer.inventorySlots, rewards.items);
        if (success) {
            // Update inventory with the returned updatedInventory (includes stacked items)
            updatedPlayer.inventory = updatedInventory;
        } else {
            console.error(`[Summary] Insufficient inventory space for user ${updatedPlayer.id}. Items not granted.`);
            // Optionally, send items via mail here in the future
        }
    }
    
    // Update Quests
    if (!isNoContest && !isAiGame) {
        updateQuestProgress(updatedPlayer, 'participate', mode, 1);
        if (isWinner) {
            updateQuestProgress(updatedPlayer, 'win', mode, 1);
            
            // Update Guild Mission Progress for wins
            if (updatedPlayer.guildId) {
                const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                if (isStrategic) {
                    await guildService.updateGuildMissionProgress(updatedPlayer.guildId, 'strategicWins', 1, guilds);
                } else if (isPlayful) {
                    await guildService.updateGuildMissionProgress(updatedPlayer.guildId, 'playfulWins', 1, guilds);
                }
            }
        }
    }

    const summary: GameSummary = {
        xp: xpSummary,
        rating: ratingSummary,
        manner: mannerSummary,
        mannerActionChange: mannerChangeFromActions,
        overallRecord: {
            wins: gameStats.wins,
            losses: gameStats.losses,
        },
        gold: rewards.gold,
        items: rewards.items,
        level: levelSummary
    };

    return { summary, updatedPlayer };
};

export const processGameSummary = async (game: LiveGameSession): Promise<void> => {
    const { winner, player1, player2, blackPlayerId, whitePlayerId, noContestInitiatorIds, winReason } = game;
    if (!player1 || !player2) {
        console.error(`[Summary] Missing player data for game ${game.id}`);
        return;
    }
    
    const isDraw = winner === Player.None;
    const isNoContest = game.gameStatus === 'no_contest';
    const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);

    const p1 = player1.id === aiUserId ? getAiUser(game.mode) : await db.getUser(player1.id);
    // 싱글플레이 게임의 경우 player2는 이미 스테이지별로 설정된 AI 유저이므로 덮어쓰지 않음
    const p2 = game.isSinglePlayer 
        ? player2  // 싱글플레이: 기존 player2 유지
        : (player2.id === aiUserId ? getAiUser(game.mode) : await db.getUser(player2.id));

    if (!p1 || !p2) {
        console.error(`[Summary] Could not find one or more users from DB for game ${game.id}`);
        // Still save the game so we don't retry this every tick
        game.statsUpdated = true;
        await db.saveGame(game);
        return;
    }

    const p1IsWinner = !isDraw && !isNoContest && ((winner === Player.Black && p1.id === blackPlayerId) || (winner === Player.White && p1.id === whitePlayerId));
    const p2IsWinner = !isDraw && !isNoContest && ((winner === Player.Black && p2.id === blackPlayerId) || (winner === Player.White && p2.id === whitePlayerId));
    
    const p1IsNoContestInitiator = isNoContest && (noContestInitiatorIds?.includes(p1.id) ?? false);
    const p2IsNoContestInitiator = isNoContest && (noContestInitiatorIds?.includes(p2.id) ?? false);

    // 전략바둑 무효처리 시 행동력 환불 처리
    if (isNoContest && isStrategic && !game.isSinglePlayer && !game.isAiGame) {
        const { STRATEGIC_ACTION_POINT_COST } = await import('../constants');
        const cost = STRATEGIC_ACTION_POINT_COST;
        
        // 기권으로 무효처리된 경우: 기권한 유저는 행동력 소모 유지, 상대방은 행동력 환불
        if (winReason === 'resign' && winner !== Player.None) {
            // 기권한 사람은 winner의 상대방
            const resignedPlayerId = (winner === Player.Black && p1.id === blackPlayerId) || (winner === Player.White && p1.id === whitePlayerId)
                ? p2.id
                : p1.id;
            
            // 기권한 사람이 아닌 상대방에게 행동력 환불
            if (resignedPlayerId === p1.id && p2.id !== aiUserId && !p2.isAdmin) {
                p2.actionPoints.current = Math.min(
                    p2.actionPoints.max,
                    p2.actionPoints.current + cost
                );
                p2.lastActionPointUpdate = Date.now();
                await db.updateUser(p2);
                const { broadcast } = await import('./socket.js');
                broadcast({ type: 'USER_UPDATE', payload: { [p2.id]: p2 } });
            } else if (resignedPlayerId === p2.id && p1.id !== aiUserId && !p1.isAdmin) {
                p1.actionPoints.current = Math.min(
                    p1.actionPoints.max,
                    p1.actionPoints.current + cost
                );
                p1.lastActionPointUpdate = Date.now();
                await db.updateUser(p1);
                const { broadcast } = await import('./socket.js');
                broadcast({ type: 'USER_UPDATE', payload: { [p1.id]: p1 } });
            }
        } else if (winReason === 'disconnect' && game.moveHistory.length < 20) {
            // 20수 이내 접속장애로 무효처리된 경우: 접속이 끊어진 유저는 행동력 소모 유지, 무효처리를 당한 유저는 행동력 환불
            // 접속이 끊어진 유저 찾기 (disconnectionCounts가 있는 유저)
            const disconnectedPlayerId = game.disconnectionCounts?.[p1.id] > 0 ? p1.id : p2.id;
            
            // 접속이 끊어진 유저가 아닌 상대방에게 행동력 환불
            if (disconnectedPlayerId === p1.id && p2.id !== aiUserId && !p2.isAdmin) {
                p2.actionPoints.current = Math.min(
                    p2.actionPoints.max,
                    p2.actionPoints.current + cost
                );
                p2.lastActionPointUpdate = Date.now();
                await db.updateUser(p2);
                const { broadcast } = await import('./socket.js');
                broadcast({ type: 'USER_UPDATE', payload: { [p2.id]: p2 } });
            } else if (disconnectedPlayerId === p2.id && p1.id !== aiUserId && !p1.isAdmin) {
                p1.actionPoints.current = Math.min(
                    p1.actionPoints.max,
                    p1.actionPoints.current + cost
                );
                p1.lastActionPointUpdate = Date.now();
                await db.updateUser(p1);
                const { broadcast } = await import('./socket.js');
                broadcast({ type: 'USER_UPDATE', payload: { [p1.id]: p1 } });
            }
        } else {
            // 기권이 아닌 경우 (예: 1분 경과 후 무효처리): 양쪽 모두 행동력 환불
            if (p1.id !== aiUserId && !p1.isAdmin) {
                p1.actionPoints.current = Math.min(
                    p1.actionPoints.max,
                    p1.actionPoints.current + cost
                );
                p1.lastActionPointUpdate = Date.now();
                await db.updateUser(p1);
            }
            if (p2.id !== aiUserId && !p2.isAdmin) {
                p2.actionPoints.current = Math.min(
                    p2.actionPoints.max,
                    p2.actionPoints.current + cost
                );
                p2.lastActionPointUpdate = Date.now();
                await db.updateUser(p2);
            }
            const { broadcast } = await import('./socket.js');
            if (p1.id !== aiUserId && !p1.isAdmin) {
                broadcast({ type: 'USER_UPDATE', payload: { [p1.id]: p1 } });
            }
            if (p2.id !== aiUserId && !p2.isAdmin) {
                broadcast({ type: 'USER_UPDATE', payload: { [p2.id]: p2 } });
            }
            if (p1.id !== aiUserId && !p1.isAdmin) {
                broadcast({ type: 'USER_UPDATE', payload: { [p1.id]: p1 } });
            }
            if (p2.id !== aiUserId && !p2.isAdmin) {
                broadcast({ type: 'USER_UPDATE', payload: { [p2.id]: p2 } });
            }
        }
    }

    if (!game.summary) game.summary = {}; // Initialize summary object

    const { broadcast } = await import('./socket.js');

    try {
        if (p1.id !== aiUserId) {
            const { summary: p1Summary, updatedPlayer: updatedP1 } = await processPlayerSummary(p1, p2, p1IsWinner, isDraw, game, isNoContest, p1IsNoContestInitiator);
            await db.updateUser(updatedP1);
            game.summary[p1.id] = p1Summary;
            const selectiveUpdate = getSelectiveUserUpdate(updatedP1, '', { includeAll: true });
            broadcast({ type: 'USER_UPDATE', payload: { [updatedP1.id]: selectiveUpdate } });
        }
    } catch (e) {
        console.error(`[Summary] Error processing summary for player 1 (${p1.id}) in game ${game.id}:`, e);
    }
    
    try {
        if (p2.id !== aiUserId) {
            const { summary: p2Summary, updatedPlayer: updatedP2 } = await processPlayerSummary(p2, p1, p2IsWinner, isDraw, game, isNoContest, p2IsNoContestInitiator);
            await db.updateUser(updatedP2);
            game.summary[p2.id] = p2Summary;
            const selectiveUpdate = getSelectiveUserUpdate(updatedP2, '', { includeAll: true });
            broadcast({ type: 'USER_UPDATE', payload: { [updatedP2.id]: selectiveUpdate } });
        }
    } catch (e) {
        console.error(`[Summary] Error processing summary for player 2 (${p2.id}) in game ${game.id}:`, e);
    }
    
    game.statsUpdated = true;
    await db.saveGame(game);
};