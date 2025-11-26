import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, InventoryItem, Quest, QuestLog, InventoryItemType, TournamentType, TournamentState, QuestReward } from '../../types/index.js';
import { updateQuestProgress } from '../questService.js';
import { SHOP_ITEMS } from '../shop.js';
import { 
    CONSUMABLE_ITEMS, 
    MATERIAL_ITEMS, 
    DAILY_MILESTONE_REWARDS, 
    DAILY_MILESTONE_THRESHOLDS,
    WEEKLY_MILESTONE_REWARDS,
    WEEKLY_MILESTONE_THRESHOLDS,
    MONTHLY_MILESTONE_REWARDS,
    MONTHLY_MILESTONE_THRESHOLDS,
    BASE_TOURNAMENT_REWARDS,
    TOURNAMENT_SCORE_REWARDS
} from '../../constants/index.js';
import { calculateRanks } from '../tournamentService.js';
import { addItemsToInventory, createItemInstancesFromReward } from '../../utils/inventoryUtils.js';
import { getSelectiveUserUpdate } from '../utils/userUpdateHelper.js';

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

type HandleActionResult = {
    clientResponse?: any;
    error?: string;
};

export const handleRewardAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;

    switch (type) {
        case 'CLAIM_MAIL_ATTACHMENTS': {
            const { mailId } = payload;
            const mail = user.mail.find(m => m.id === mailId);
        
            if (!mail) return { error: 'Mail not found.' };
            if (mail.attachmentsClaimed) return { error: 'Attachments already claimed.' };
            if (!mail.attachments) return { error: 'No attachments to claim.' };
        
            const itemsToCreate: InventoryItem[] = [];
            if (mail.attachments.items) {
                 const createdItems = createItemInstancesFromReward(mail.attachments.items as { itemId: string; quantity: number }[]);
                 itemsToCreate.push(...createdItems);
            }
        
            const { success, finalItemsToAdd } = addItemsToInventory([...user.inventory], user.inventorySlots, itemsToCreate);
            if (!success) return { error: '인벤토리 공간이 부족합니다.' };
        
            const reward: QuestReward = {
                gold: mail.attachments.gold || 0,
                diamonds: mail.attachments.diamonds || 0,
                actionPoints: mail.attachments.actionPoints || 0,
            };

            if (reward.gold) user.gold += reward.gold;
            if (reward.diamonds) user.diamonds += reward.diamonds;
            if (reward.actionPoints) {
                user.actionPoints.current += reward.actionPoints;
            }
        
            user.inventory = finalItemsToAdd;
        
            mail.attachmentsClaimed = true;
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'CLAIM_MAIL_ATTACHMENTS');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[CLAIM_MAIL_ATTACHMENTS] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['inventory', 'mail', 'gold', 'diamonds', 'actionPoints']);
            
            return {
                clientResponse: {
                    rewardSummary: {
                        reward,
                        items: itemsToCreate,
                        title: '우편 보상'
                    },
                    updatedUser
                }
            };
        }
        case 'CLAIM_ALL_MAIL_ATTACHMENTS': {
            const mailsToClaim = user.mail.filter(m => m.attachments && !m.attachmentsClaimed);
            if (mailsToClaim.length === 0) return { error: '수령할 아이템이 없습니다.' };

            let totalGold = 0;
            let totalDiamonds = 0;
            let totalActionPoints = 0;
            const allItemsToCreate: InventoryItem[] = [];

            for (const mail of mailsToClaim) {
                totalGold += mail.attachments!.gold || 0;
                totalDiamonds += mail.attachments!.diamonds || 0;
                totalActionPoints += mail.attachments!.actionPoints || 0;
                if (mail.attachments!.items) {
                    const createdItems = createItemInstancesFromReward(mail.attachments!.items as { itemId: string; quantity: number }[]);
                    allItemsToCreate.push(...createdItems);
                }
            }

            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory([...user.inventory], user.inventorySlots, allItemsToCreate);
            if (!success) {
                return { error: '모든 아이템을 받기에 가방 공간이 부족합니다.' };
            }

            user.gold += totalGold;
            user.diamonds += totalDiamonds;
            user.actionPoints.current += totalActionPoints;
            user.inventory = updatedInventory;

            for (const mail of mailsToClaim) mail.attachmentsClaimed = true;

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'CLAIM_ALL_MAIL_ATTACHMENTS');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[CLAIM_ALL_MAIL_ATTACHMENTS] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['inventory', 'mail', 'gold', 'diamonds', 'actionPoints']);
            
            const reward: QuestReward = {
                gold: totalGold,
                diamonds: totalDiamonds,
                actionPoints: totalActionPoints,
            };

            // If only currency is being awarded, send a simpler response for the dedicated modal.
            if (allItemsToCreate.length === 0 && (totalGold > 0 || totalDiamonds > 0 || totalActionPoints > 0)) {
                return {
                    clientResponse: {
                        claimAllSummary: {
                            gold: totalGold,
                            diamonds: totalDiamonds,
                            actionPoints: totalActionPoints
                        },
                        updatedUser
                    }
                };
            }

            return {
                clientResponse: {
                    rewardSummary: {
                        reward,
                        items: allItemsToCreate,
                        title: '우편 일괄 수령'
                    },
                    updatedUser
                }
            };
        }
        case 'CLAIM_QUEST_REWARD': {
            const { questId } = payload;
            const questCategories = ['daily', 'weekly', 'monthly'] as const;
            let foundQuest: Quest | undefined;
            let questType: 'daily' | 'weekly' | 'monthly' | undefined;

            for (const category of questCategories) {
                const questList = user.quests[category]?.quests;
                if (questList) {
                    foundQuest = questList.find(q => q.id === questId);
                    if (foundQuest) {
                        questType = category;
                        break;
                    }
                }
            }

            if (!foundQuest) return { error: '퀘스트를 찾을 수 없습니다.' };
            if (foundQuest.isClaimed) return { error: '이미 보상을 수령했습니다.' };
            if (foundQuest.progress < foundQuest.target) return { error: '퀘스트를 아직 완료하지 않았습니다.' };
            
            const { reward, activityPoints } = foundQuest;
            const itemsToCreate: InventoryItem[] = [];
            if (reward.items) {
                const createdItems = createItemInstancesFromReward(reward.items as { itemId: string; quantity: number }[]);
                itemsToCreate.push(...createdItems);
            }

            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory([...user.inventory], user.inventorySlots, itemsToCreate);
            if (!success) {
                return { error: '보상을 받기에 인벤토리 공간이 부족합니다.' };
            }
            
            foundQuest.isClaimed = true;
            
            if (reward.gold) user.gold += reward.gold;
            if (reward.diamonds) user.diamonds += reward.diamonds;
            if (reward.actionPoints) user.actionPoints.current += reward.actionPoints;
            user.inventory = updatedInventory;
            
            if (activityPoints > 0 && user.quests[questType!]) {
                user.quests[questType!]!.activityProgress += activityPoints;
            }

            // 깊은 복사로 updatedUser 생성하여 React가 변경을 확실히 감지하도록 함
            const updatedUser = JSON.parse(JSON.stringify(user));
            
            // DB 업데이트와 WebSocket 브로드캐스트를 병렬로 처리하여 응답 속도 개선
            const updatePromise = db.updateUser(user);
            const { broadcastUserUpdate } = await import('../socket.js');
            const broadcastPromise = broadcastUserUpdate(updatedUser, ['inventory', 'equipment', 'quests', 'gold', 'diamonds', 'actionPoints']);
            
            // rewardSummary를 즉시 반환하여 모달이 빠르게 표시되도록 함
            // DB 업데이트는 백그라운드에서 완료되도록 함
            Promise.all([updatePromise, broadcastPromise]).catch((error) => {
                console.error(`[CLAIM_QUEST_REWARD] Error updating user or broadcasting:`, error);
            });
            
            return { 
                clientResponse: { 
                    rewardSummary: {
                        reward,
                        items: itemsToCreate,
                        title: `${questType === 'daily' ? '일일' : questType === 'weekly' ? '주간' : '월간'} 퀘스트 보상`
                    },
                    updatedUser
                } 
            };
        }
        case 'CLAIM_ACTIVITY_MILESTONE': {
            const { milestoneIndex, questType } = payload as { milestoneIndex: number; questType: 'daily' | 'weekly' | 'monthly' };
            
            const questDataMap = {
                daily: { data: user.quests.daily, thresholds: DAILY_MILESTONE_THRESHOLDS, rewards: DAILY_MILESTONE_REWARDS },
                weekly: { data: user.quests.weekly, thresholds: WEEKLY_MILESTONE_THRESHOLDS, rewards: WEEKLY_MILESTONE_REWARDS },
                monthly: { data: user.quests.monthly, thresholds: MONTHLY_MILESTONE_THRESHOLDS, rewards: MONTHLY_MILESTONE_REWARDS },
            };

            const selectedQuest = questDataMap[questType];
            if (!selectedQuest || !selectedQuest.data) return { error: "유효하지 않은 퀘스트 타입입니다." };

            const { data, thresholds, rewards } = selectedQuest;
            
            if (milestoneIndex < 0 || milestoneIndex >= rewards.length) return { error: "유효하지 않은 마일스톤입니다." };
            if (data.claimedMilestones[milestoneIndex]) return { error: "이미 수령한 보상입니다." };

            const requiredProgress = thresholds[milestoneIndex];
            if (data.activityProgress < requiredProgress) return { error: "활약도 점수가 부족합니다." };

            const reward = rewards[milestoneIndex];
            
            const itemsToCreate: InventoryItem[] = [];
            if (reward.items) {
                 const createdItems = createItemInstancesFromReward(reward.items as {itemId: string, quantity: number}[]);
                 itemsToCreate.push(...createdItems);
            }

            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory([...user.inventory], user.inventorySlots, itemsToCreate);
            if (!success) return { error: '보상을 받기에 인벤토리 공간이 부족합니다.' };
            
            user.gold += reward.gold || 0;
            user.diamonds += reward.diamonds || 0;
            user.actionPoints.current += reward.actionPoints || 0;
            user.inventory = updatedInventory;
            
            data.claimedMilestones[milestoneIndex] = true;

            if (milestoneIndex === 4) { // 100 activity points milestone is at index 4
                if (questType === 'daily') {
                    updateQuestProgress(user, 'claim_daily_milestone_100');
                } else if (questType === 'weekly') {
                    updateQuestProgress(user, 'claim_weekly_milestone_100');
                }
            }

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'CLAIM_QUEST_REWARD');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[CLAIM_QUEST_REWARD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['inventory', 'quests', 'gold', 'diamonds', 'actionPoints']);
            
            return { 
                clientResponse: { 
                    rewardSummary: {
                        reward,
                        items: itemsToCreate,
                        title: `${questType === 'daily' ? '일일' : questType === 'weekly' ? '주간' : '월간'} 활약도 보상`
                    },
                    updatedUser
                } 
            };
        }
        case 'DELETE_MAIL': {
            const { mailId } = payload;
            const mailIndex = user.mail.findIndex(m => m.id === mailId);
            if (mailIndex === -1) return { error: 'Mail not found.' };

            const mail = user.mail[mailIndex];
            if (mail.attachments && !mail.attachmentsClaimed) {
                return { error: '수령하지 않은 아이템이 있는 메일은 삭제할 수 없습니다.' };
            }

            user.mail.splice(mailIndex, 1);
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'DELETE_MAIL');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[DELETE_MAIL] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['mail']);
            
            // HTTP 응답에도 updatedUser 포함 (즉시 클라이언트 상태 업데이트)
            return { clientResponse: { updatedUser } };
        }
        case 'DELETE_ALL_CLAIMED_MAIL': {
            // user.mail이 없거나 배열이 아닌 경우 초기화
            if (!user.mail || !Array.isArray(user.mail)) {
                user.mail = [];
            }
            
            // 수령 완료된 메일만 삭제 (attachments가 있고 attachmentsClaimed가 true인 것)
            const beforeCount = user.mail.length;
            user.mail = user.mail.filter(m => {
                // attachments가 없거나 attachmentsClaimed가 false인 것만 남김
                return !(m && m.attachments && m.attachmentsClaimed);
            });
            const deletedCount = beforeCount - user.mail.length;
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'DELETE_ALL_CLAIMED_MAIL');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[DELETE_ALL_CLAIMED_MAIL] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['mail']);
            
            return { 
                clientResponse: { 
                    updatedUser,
                    deletedCount 
                } 
            };
        }
        case 'MARK_MAIL_AS_READ': {
            if (!payload || typeof payload !== 'object') {
                return { error: 'Invalid payload for MARK_MAIL_AS_READ.' };
            }
            const { mailId } = payload as { mailId?: string };
            if (!mailId || typeof mailId !== 'string') {
                return { error: 'mailId is required and must be a string.' };
            }
            
            if (!user.mail || !Array.isArray(user.mail)) {
                return { error: 'User mail array not found.' };
            }
            
            const mail = user.mail.find(m => m.id === mailId);
            if (!mail) {
                return { error: 'Mail not found.' };
            }
            
            mail.isRead = true;
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'MARK_MAIL_AS_READ');
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[MARK_MAIL_AS_READ] Failed to save user ${user.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['mail']);
            
            return { clientResponse: { updatedUser } };
        }
        case 'CLAIM_TOURNAMENT_REWARD': {
            const { tournamentType } = payload as { tournamentType: TournamentType };
            
            let statusKey: keyof User;
            let tourneyKey: keyof User;

            switch (tournamentType) {
                case 'neighborhood':
                    statusKey = 'neighborhoodRewardClaimed';
                    tourneyKey = 'lastNeighborhoodTournament';
                    break;
                case 'national':
                    statusKey = 'nationalRewardClaimed';
                    tourneyKey = 'lastNationalTournament';
                    break;
                case 'world':
                    statusKey = 'worldRewardClaimed';
                    tourneyKey = 'lastWorldTournament';
                    break;
                default:
                    return { error: 'Invalid tournament type.' };
            }

            // DB에서 최신 상태를 다시 확인하여 중복 보상 지급 방지
            const freshUser = await db.getUser(user.id);
            if (!freshUser) return { error: '사용자를 찾을 수 없습니다.' };
            
            if ((freshUser as any)[statusKey]) {
                console.warn(`[CLAIM_TOURNAMENT_REWARD] User ${user.id} already claimed reward for ${tournamentType}`);
                return { error: '이미 보상을 수령했습니다.' };
            }
            
            // freshUser를 사용하도록 변경
            const tournamentState = (freshUser as any)[tourneyKey] as TournamentState | null;
            if (!tournamentState || (tournamentState.status !== 'complete' && tournamentState.status !== 'eliminated')) {
                 return { error: '토너먼트가 아직 종료되지 않았습니다.' };
            }
            
            const itemRewardInfo = BASE_TOURNAMENT_REWARDS[tournamentType];
            if (!itemRewardInfo) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Item reward info not found for tournament type:`, tournamentType);
                return { error: `토너먼트 보상 정보를 찾을 수 없습니다. (타입: ${tournamentType})` };
            }
            
            let rankings;
            try {
                rankings = calculateRanks(tournamentState);
            } catch (error: any) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Error calculating ranks:`, error);
                console.error(`[CLAIM_TOURNAMENT_REWARD] Tournament state:`, JSON.stringify(tournamentState, null, 2));
                return { error: `순위 계산 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}` };
            }
            
            if (!rankings || rankings.length === 0) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] No rankings calculated for tournament:`, tournamentState);
                return { error: '순위를 계산할 수 없습니다.' };
            }
            
            const userRanking = rankings.find(r => r.id === freshUser.id);
            if (!userRanking) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] User ranking not found. User ID: ${freshUser.id}, Rankings:`, rankings);
                return { error: '순위를 결정할 수 없습니다.' };
            }
            const userRank = userRanking.rank;

            let itemRewardKey: number;
            if (tournamentType === 'neighborhood') itemRewardKey = userRank <= 3 ? userRank : 4;
            else if (tournamentType === 'national') itemRewardKey = userRank <= 4 ? userRank : 5;
            else { // world
                if (userRank <= 4) itemRewardKey = userRank;
                else if (userRank <= 8) itemRewardKey = 5;
                else itemRewardKey = 9;
            }
            
            const scoreRewardInfo = TOURNAMENT_SCORE_REWARDS[tournamentType];
            let scoreRewardKey: number;
            if (tournamentType === 'neighborhood') {
                scoreRewardKey = userRank;
            } else if (tournamentType === 'national') {
                scoreRewardKey = userRank <= 4 ? userRank : 5;
            } else { // world
                if (userRank <= 4) scoreRewardKey = userRank;
                else if (userRank <= 8) scoreRewardKey = 5;
                else scoreRewardKey = 9;
            }
            const scoreReward = scoreRewardInfo[scoreRewardKey];
            if (scoreReward === undefined) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Invalid scoreRewardKey: ${scoreRewardKey} for tournamentType: ${tournamentType}, userRank: ${userRank}`);
                return { error: `순위에 대한 점수 보상이 정의되지 않았습니다. (순위: ${userRank})` };
            }
            
            console.log(`[CLAIM_TOURNAMENT_REWARD] tournamentType: ${tournamentType}, userRank: ${userRank}, scoreRewardKey: ${scoreRewardKey}, scoreReward: ${scoreReward}, currentTournamentScore: ${freshUser.tournamentScore || 0}`);
            
            const itemReward = itemRewardInfo.rewards?.[itemRewardKey];

            if (!itemReward) {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Item reward not found. tournamentType: ${tournamentType}, itemRewardKey: ${itemRewardKey}, userRank: ${userRank}`);
                console.error(`[CLAIM_TOURNAMENT_REWARD] Available reward keys:`, itemRewardInfo.rewards ? Object.keys(itemRewardInfo.rewards) : 'none');
                // itemReward가 없어도 점수 보상은 지급해야 하므로 계속 진행
            }
            
            if (!itemReward) {
                // 동네바둑리그: 누적 골드 추가
                let accumulatedGold = 0;
                if (tournamentType === 'neighborhood' && tournamentState.accumulatedGold) {
                    accumulatedGold = tournamentState.accumulatedGold;
                }
                
                // 전국바둑대회: 누적 재료 추가
                let accumulatedMaterials: InventoryItem[] = [];
                if (tournamentType === 'national' && tournamentState.accumulatedMaterials) {
                    const materialItems = Object.entries(tournamentState.accumulatedMaterials).map(([materialName, quantity]) => ({
                        itemId: materialName,
                        quantity: quantity
                    }));
                    accumulatedMaterials = createItemInstancesFromReward(materialItems);
                }
                
                // 월드챔피언십: 누적 장비상자 추가
                let accumulatedEquipmentBoxes: InventoryItem[] = [];
                if (tournamentType === 'world' && tournamentState.accumulatedEquipmentBoxes) {
                    const boxItems = Object.entries(tournamentState.accumulatedEquipmentBoxes).map(([boxName, quantity]) => ({
                        itemId: boxName,
                        quantity: quantity
                    }));
                    accumulatedEquipmentBoxes = createItemInstancesFromReward(boxItems);
                }
                
                // 재료와 장비상자를 함께 인벤토리에 추가
                const allAccumulatedItems = [...accumulatedMaterials, ...accumulatedEquipmentBoxes];
                if (allAccumulatedItems.length > 0) {
                    const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory([...freshUser.inventory], freshUser.inventorySlots, allAccumulatedItems);
                    if (!success) {
                        return { error: '보상을 받기에 가방 공간이 부족합니다. 가방을 비우고 다시 시도해주세요.' };
                    }
                    freshUser.inventory = updatedInventory;
                }
                
                (freshUser as any)[statusKey] = true;
                // 토너먼트 완료 시점에 이미 점수가 추가되었을 수 있으므로, 보상 수령 시에는 점수를 추가하지 않음
                // (중복 추가 방지)
                const currentCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                const currentScore = freshUser.tournamentScore || 0;
                
                // 점수가 아직 추가되지 않았으면 추가 (토너먼트 완료 시점에 점수가 추가되지 않은 경우 대비)
                if (currentCumulativeScore < scoreReward || currentScore < scoreReward) {
                    const oldCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                    freshUser.cumulativeTournamentScore = oldCumulativeScore + scoreReward;
                    // tournamentScore는 주간 점수로 유지 (주간 리셋용)
                    const oldScore = freshUser.tournamentScore || 0;
                    freshUser.tournamentScore = oldScore + scoreReward;
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Added score (was missing): cumulativeTournamentScore: ${oldCumulativeScore} -> ${freshUser.cumulativeTournamentScore}, tournamentScore: ${oldScore} -> ${freshUser.tournamentScore}`);
                } else {
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Score already added at tournament completion. Skipping duplicate addition.`);
                }
                freshUser.gold += accumulatedGold;
                if (accumulatedGold > 0) {
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Added accumulated gold: ${accumulatedGold}`);
                }
                if (accumulatedMaterials.length > 0) {
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Added accumulated materials:`, accumulatedMaterials.map(m => `${m.name} x${m.quantity}`).join(', '));
                }
                if (accumulatedEquipmentBoxes.length > 0) {
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Added accumulated equipment boxes:`, accumulatedEquipmentBoxes.map(b => `${b.name} x${b.quantity}`).join(', '));
                }
                updateQuestProgress(freshUser, 'tournament_complete');
                
                // 보상 수령 후에도 토너먼트 상태를 유지하기 위해 DB에 저장
                (freshUser as any)[tourneyKey] = tournamentState;
                
                // 사용자 캐시 업데이트 (즉시 반영)
                const { updateUserCache } = await import('../gameCache.js');
                updateUserCache(freshUser);
                
                // 선택적 필드만 반환 (메시지 크기 최적화)
                const updatedUser = getSelectiveUserUpdate(freshUser, 'CLAIM_TOURNAMENT_REWARD', { includeAll: true });
                
                // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화: 변경된 필드만 전송)
                const fullUserForBroadcast = JSON.parse(JSON.stringify(freshUser));
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(fullUserForBroadcast, ['inventory', 'equipment', 'quests', 'gold', 'diamonds', 'actionPoints', 'mail']);
                
                // DB 저장은 비동기로 처리하여 응답 지연 최소화
                db.updateUser(freshUser).catch((error: any) => {
                    console.error(`[CLAIM_TOURNAMENT_REWARD] Error updating user ${freshUser.id}:`, error);
                });
                
                const allObtainedItems: any[] = [...accumulatedMaterials, ...accumulatedEquipmentBoxes];
                if (accumulatedGold > 0) {
                    allObtainedItems.unshift({ name: `${accumulatedGold} 골드 (경기 보상)`, image: '/images/icon/Gold.png' });
                }
                
                // oldCumulativeScore를 먼저 정의 (나중에 사용하기 위해)
                const oldCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                return { clientResponse: { obtainedItemsBulk: allObtainedItems, updatedUser, tournamentScoreChange: { oldScore: oldCumulativeScore, newScore: freshUser.cumulativeTournamentScore, scoreReward: scoreReward } }};
            }

            // 골드 꾸러미와 다이아 꾸러미는 모두 아이템으로 지급 (사용자가 직접 사용하여 랜덤 골드/다이아 획득)
            const regularItems: { itemId: string; quantity: number }[] = [];
            
            if (itemReward.items) {
                for (const itemRef of itemReward.items as { itemId: string; quantity: number }[]) {
                    // 모든 아이템을 그대로 아이템으로 추가
                    regularItems.push(itemRef);
                }
            }
            
            const itemsToCreate = regularItems.length > 0 ? createItemInstancesFromReward(regularItems) : [];
            
            // 전국바둑대회: 누적 재료 추가
            if (tournamentType === 'national' && tournamentState.accumulatedMaterials) {
                const materialItems = Object.entries(tournamentState.accumulatedMaterials).map(([materialName, quantity]) => ({
                    itemId: materialName,
                    quantity: quantity
                }));
                const createdMaterials = createItemInstancesFromReward(materialItems);
                itemsToCreate.push(...createdMaterials);
            }
            
            // 월드챔피언십: 누적 장비상자 추가
            if (tournamentType === 'world' && tournamentState.accumulatedEquipmentBoxes) {
                const boxItems = Object.entries(tournamentState.accumulatedEquipmentBoxes).map(([boxName, quantity]) => ({
                    itemId: boxName,
                    quantity: quantity
                }));
                const createdBoxes = createItemInstancesFromReward(boxItems);
                itemsToCreate.push(...createdBoxes);
            }
            
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory([...freshUser.inventory], freshUser.inventorySlots, itemsToCreate);
            if (!success) {
                return { error: '보상을 받기에 가방 공간이 부족합니다. 가방을 비우고 다시 시도해주세요.' };
            }
            
            // If we'vepassed the check, apply all changes
                (freshUser as any)[statusKey] = true;
                // 토너먼트 완료 시점에 이미 점수가 추가되었을 수 있으므로, 보상 수령 시에는 점수를 추가하지 않음
                // (중복 추가 방지)
                const currentCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                const currentScore = freshUser.tournamentScore || 0;
                
                // oldCumulativeScore를 먼저 정의 (나중에 사용하기 위해)
                const oldCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                
                // 점수가 아직 추가되지 않았으면 추가 (토너먼트 완료 시점에 점수가 추가되지 않은 경우 대비)
                if (currentCumulativeScore < scoreReward || currentScore < scoreReward) {
                    freshUser.cumulativeTournamentScore = oldCumulativeScore + scoreReward;
                    // tournamentScore는 주간 점수로 유지 (주간 리셋용)
                    const oldScore = freshUser.tournamentScore || 0;
                    freshUser.tournamentScore = oldScore + scoreReward;
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Added score (was missing): cumulativeTournamentScore: ${oldCumulativeScore} -> ${freshUser.cumulativeTournamentScore}, tournamentScore: ${oldScore} -> ${freshUser.tournamentScore}`);
                } else {
                    console.log(`[CLAIM_TOURNAMENT_REWARD] Score already added at tournament completion. Skipping duplicate addition.`);
                }
            
            // 동네바둑리그: 누적 골드 추가
            let accumulatedGold = 0;
            if (tournamentType === 'neighborhood' && tournamentState.accumulatedGold) {
                accumulatedGold = tournamentState.accumulatedGold;
            }
            
            freshUser.gold += (itemReward.gold || 0) + accumulatedGold;
            freshUser.diamonds += (itemReward.diamonds || 0);
            freshUser.inventory = updatedInventory;
            
            updateQuestProgress(freshUser, 'tournament_complete');

            // 보상 수령 후에도 토너먼트 상태를 유지하기 위해 DB에 저장
            (freshUser as any)[tourneyKey] = tournamentState;
            
            // 사용자 캐시 업데이트 (즉시 반영)
            const { updateUserCache } = await import('../gameCache.js');
            updateUserCache(freshUser);
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(freshUser, 'CLAIM_TOURNAMENT_REWARD', { includeAll: true });
            
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(freshUser).catch((error: any) => {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Failed to save user ${freshUser.id}:`, error);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(freshUser, ['inventory', 'gold', 'diamonds', 'tournamentScore', 'neighborhoodRewardClaimed', 'nationalRewardClaimed', 'worldRewardClaimed', 'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament']);
            const fullUserForBroadcast = JSON.parse(JSON.stringify(freshUser));
            const { broadcast } = await import('../socket.js');
            broadcast({ type: 'USER_UPDATE', payload: { [freshUser.id]: fullUserForBroadcast } });
            
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(freshUser).catch((error: any) => {
                console.error(`[CLAIM_TOURNAMENT_REWARD] Error updating user ${freshUser.id}:`, error);
            });

            const allObtainedItems: InventoryItem[] = itemsToCreate.map(item => ({
                ...item,
                id: `display-${item.id}`,
                createdAt: Date.now(),
                isEquipped: false,
                stars: item.stars || 0,
                level: item.level || 1,
            }));

            if (accumulatedGold > 0) {
                allObtainedItems.unshift({
                    id: `display-gold-${Date.now()}`,
                    name: `${accumulatedGold} 골드 (경기 보상)`,
                    description: '경기에서 획득한 골드입니다.',
                    type: 'consumable',
                    slot: null,
                    image: '/images/icon/Gold.png',
                    grade: 'rare',
                    quantity: accumulatedGold,
                    createdAt: Date.now(),
                    isEquipped: false,
                    level: 1,
                    stars: 0,
                } as InventoryItem);
            }

            if ((itemReward.gold || 0) > 0) {
                allObtainedItems.unshift({
                    id: `display-gold-direct-${Date.now()}`,
                    name: `${itemReward.gold} 골드`,
                    description: '순위 보상으로 획득한 골드입니다.',
                    type: 'consumable',
                    slot: null,
                    image: '/images/icon/Gold.png',
                    grade: 'rare',
                    quantity: itemReward.gold || 0,
                    createdAt: Date.now(),
                    isEquipped: false,
                    level: 1,
                    stars: 0,
                } as InventoryItem);
            }
            if ((itemReward.diamonds || 0) > 0) {
                allObtainedItems.unshift({
                    id: `display-diamond-direct-${Date.now()}`,
                    name: `${itemReward.diamonds} 다이아`,
                    description: '순위 보상으로 획득한 다이아입니다.',
                    type: 'consumable',
                    slot: null,
                    image: '/images/icon/Zem.png',
                    grade: 'epic',
                    quantity: itemReward.diamonds || 0,
                    createdAt: Date.now(),
                    isEquipped: false,
                    level: 1,
                    stars: 0,
                } as InventoryItem);
            }

            if (allObtainedItems.length === 0 && itemReward.items?.length) {
                const fallbackDisplayItems = createItemInstancesFromReward(itemReward.items as { itemId: string; quantity: number }[]).map(item => ({
                    ...item,
                    id: `display-fallback-${item.id}`,
                }));
                allObtainedItems.push(...fallbackDisplayItems);
            }

            return { clientResponse: { obtainedItemsBulk: allObtainedItems, updatedUser, tournamentScoreChange: { oldScore: oldCumulativeScore, newScore: freshUser.cumulativeTournamentScore, scoreReward: scoreReward } }};
        }
        default:
            return { error: 'Unknown reward action.' };
    }
};