import React, { useMemo, useState, useEffect } from 'react';
import { UserWithStatus } from '../../types.js';
import { SINGLE_PLAYER_MISSIONS } from '../../constants/singlePlayerConstants.js';
import Button from '../Button.js';
import { useAppContext } from '../../hooks/useAppContext.js';
import TrainingQuestLevelUpModal from './TrainingQuestLevelUpModal.js';
import ClaimAllTrainingQuestRewardsModal from './ClaimAllTrainingQuestRewardsModal.js';

interface TrainingQuestPanelProps {
    currentUser: UserWithStatus;
}

const TrainingQuestPanel: React.FC<TrainingQuestPanelProps> = ({ currentUser }) => {
    const { handlers } = useAppContext();
    const [selectedMissionForUpgrade, setSelectedMissionForUpgrade] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [levelUpResult, setLevelUpResult] = useState<{
        missionName: string;
        previousLevel: number;
        newLevel: number;
    } | null>(null);
    const [claimAllRewards, setClaimAllRewards] = useState<{
        rewards: Array<{ missionId: string; missionName: string; rewardType: 'gold' | 'diamonds'; rewardAmount: number }>;
        totalGold: number;
        totalDiamonds: number;
    } | null>(null);
    const [isClaimingAll, setIsClaimingAll] = useState(false);

    // 실시간 타이머 업데이트 (1초마다)
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);
    
    // currentUser가 변경되면 currentTime을 강제로 업데이트하여 claimableQuestsCount 재계산
    useEffect(() => {
        setCurrentTime(Date.now());
    }, [currentUser]);

    // 미션 언락 확인
    const isMissionUnlocked = (unlockStageId: string, clearedStages: string[]): boolean => {
        return clearedStages.includes(unlockStageId);
    };

    // 사용자의 수련 과제 상태
    const trainingQuests = useMemo(() => {
        const userMissions = (currentUser as any).singlePlayerMissions || {};
        const clearedStages = (currentUser as any).clearedSinglePlayerStages || [];
        return SINGLE_PLAYER_MISSIONS.map(mission => {
            const missionState = userMissions[mission.id];
            const currentLevel = missionState?.level || 0;
            const levelInfo = currentLevel > 0 && currentLevel <= mission.levels.length 
                ? mission.levels[currentLevel - 1] 
                : null;
            const isUnlocked = isMissionUnlocked(mission.unlockStageId, clearedStages);
            
            return {
                ...mission,
                missionState,
                currentLevel,
                levelInfo,
                isUnlocked,
                isStarted: missionState?.isStarted || false,
            };
        });
    }, [currentUser]);

    // 실시간 재화 계산 (막대그래프용)
    const calculateRewardAndProgress = (quest: any) => {
        if (!quest.isUnlocked || !quest.isStarted || !quest.levelInfo) {
            return { reward: 0, progress: 0, timeUntilNext: 0, isMax: false };
        }
        
        const productionRateMs = quest.levelInfo.productionRateMinutes * 60 * 1000;
        const lastCollectionTime = quest.missionState?.lastCollectionTime || currentTime;
        const elapsed = currentTime - lastCollectionTime;
        const cycles = Math.floor(elapsed / productionRateMs);
        const accumulatedAmount = quest.missionState?.accumulatedAmount || 0;
        
        // Max 상태 확인 (서버에서도 체크하지만 클라이언트에서도 확인)
        const isMax = accumulatedAmount >= quest.levelInfo.maxCapacity;
        
        // Max일 때는 타이머 멈춤
        if (isMax) {
            return {
                reward: accumulatedAmount,
                progress: 100,
                timeUntilNext: 0,
                isMax: true,
            };
        }
        
        // 생산량 계산
        let reward = accumulatedAmount;
        if (cycles > 0) {
            const generatedAmount = cycles * quest.levelInfo.rewardAmount;
            reward = Math.min(quest.levelInfo.maxCapacity, accumulatedAmount + generatedAmount);
        }
        
        // 진행도 계산 (0-100%)
        const progress = (reward / quest.levelInfo.maxCapacity) * 100;
        
        // 다음 생산까지 남은 시간 계산
        const timeSinceLastCycle = elapsed % productionRateMs;
        const timeUntilNext = productionRateMs - timeSinceLastCycle;
        
        return {
            reward,
            progress: Math.min(100, progress),
            timeUntilNext,
            isMax: reward >= quest.levelInfo.maxCapacity,
        };
    };
    
    // 레벨업 조건 계산
    const getLevelUpInfo = (quest: any) => {
        if (!quest.isStarted || quest.currentLevel >= 10) return null;
        
        // 다음 레벨 정보 확인 (필수)
        const nextLevelInfo = quest.levels && quest.levels[quest.currentLevel];
        if (!nextLevelInfo) return null;
        
        // 레벨 0일 때는 현재 레벨 정보가 없으므로 다음 레벨 정보를 사용
        const currentLevelInfo = quest.levelInfo || (quest.currentLevel === 0 ? null : (quest.levels && quest.levels[quest.currentLevel - 1]));
        
        // 레벨 0에서 레벨 1로 올릴 때는 수집 요구사항 없음
        const requiredCollection = quest.currentLevel === 0 ? 0 : (currentLevelInfo ? currentLevelInfo.maxCapacity * quest.currentLevel * 10 : 0);
        const accumulatedCollection = quest.missionState?.accumulatedCollection || 0;
        const progress = requiredCollection === 0 ? 100 : Math.min(100, (accumulatedCollection / requiredCollection) * 100);
        
        // 레벨업 비용 (레벨 0일 때는 다음 레벨의 maxCapacity 사용)
        const costBaseCapacity = currentLevelInfo ? currentLevelInfo.maxCapacity : nextLevelInfo.maxCapacity;
        let upgradeCost: number;
        if (quest.rewardType === 'gold') {
            upgradeCost = costBaseCapacity * 5;
        } else {
            upgradeCost = costBaseCapacity * 1000;
        }
        
        // 다음 레벨 오픈조건 확인
        const clearedStages = (currentUser as any).clearedSinglePlayerStages || [];
        // 레벨 0에서 레벨 1로 올릴 때는 항상 가능 (수집 요구사항 없음)
        const canLevelUp = quest.currentLevel === 0 ? 
            (!nextLevelInfo?.unlockStageId || clearedStages.includes(nextLevelInfo.unlockStageId)) :
            (accumulatedCollection >= requiredCollection && 
            (!nextLevelInfo?.unlockStageId || clearedStages.includes(nextLevelInfo.unlockStageId)));
        
        return {
            requiredCollection,
            accumulatedCollection,
            progress,
            upgradeCost,
            canLevelUp,
            nextLevelUnlockStage: nextLevelInfo?.unlockStageId,
        };
    };

    // 시간 포맷팅 (분:초)
    const formatTime = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // 미션 시작
    const handleStartMission = (missionId: string) => {
        handlers.handleAction({
            type: 'START_SINGLE_PLAYER_MISSION',
            payload: { missionId }
        });
    };

    // 재화 수령
    const handleCollectReward = async (missionId: string) => {
        try {
            // 액션만 호출하고 모달은 useApp에서 처리
            await handlers.handleAction({
                type: 'CLAIM_SINGLE_PLAYER_MISSION_REWARD',
                payload: { missionId }
            });
        } catch (error) {
            console.error('[TrainingQuestPanel] Collect reward error:', error);
        }
    };

    // 레벨업 모달 열기
    const handleLevelUpClick = (missionId: string) => {
        setSelectedMissionForUpgrade(missionId);
    };

    // 레벨업 확인
    const handleLevelUpConfirm = async (missionId: string) => {
        try {
            const result = await handlers.handleAction({
                type: 'LEVEL_UP_TRAINING_QUEST',
                payload: { missionId }
            });
            
            // 강화 완료 결과 확인
            const levelUpData = (result as any)?.trainingQuestLevelUp;
            if (levelUpData) {
                setLevelUpResult({
                    missionName: levelUpData.missionName,
                    previousLevel: levelUpData.previousLevel,
                    newLevel: levelUpData.newLevel
                });
                // 3초 후 자동으로 닫기
                setTimeout(() => {
                    setLevelUpResult(null);
                }, 3000);
            }
            
            // 모달을 닫지 않고 유지하여 강화된 정보로 동기화되도록 함
            // WebSocket 업데이트를 기다려서 인벤토리가 업데이트되면 모달이 자동으로 강화된 정보를 표시
            // 모달은 사용자가 직접 닫을 때까지 열려있음
            await new Promise(resolve => setTimeout(resolve, 200)); // WebSocket 업데이트 대기
        } catch (error) {
            console.error('[TrainingQuestPanel] Level up error:', error);
        }
    };

    // 선택된 미션 정보
    const selectedQuest = selectedMissionForUpgrade 
        ? trainingQuests.find(q => q.id === selectedMissionForUpgrade)
        : null;
    const selectedLevelUpInfo = selectedQuest ? getLevelUpInfo(selectedQuest) : null;
    
    // 수령 가능한 과제 수 계산
    const claimableQuestsCount = useMemo(() => {
        return trainingQuests.filter(quest => {
            if (!quest.isUnlocked || !quest.isStarted || !quest.levelInfo) return false;
            const { reward } = calculateRewardAndProgress(quest);
            return reward > 0;
        }).length;
    }, [trainingQuests, currentTime]);
    
    // 일괄 수령 핸들러
    const handleClaimAllRewards = async () => {
        if (isClaimingAll) return; // 중복 클릭 방지
        
        setIsClaimingAll(true);
        try {
            const result = await handlers.handleAction({
                type: 'CLAIM_ALL_TRAINING_QUEST_REWARDS'
            }) as any;
            
            // 응답 구조 확인: handleAction에서 반환된 값
            const claimAllData = result?.claimAllTrainingQuestRewards;
            
            if (claimAllData) {
                setClaimAllRewards({
                    rewards: claimAllData.rewards || [],
                    totalGold: claimAllData.totalGold || 0,
                    totalDiamonds: claimAllData.totalDiamonds || 0
                });
            } else {
                console.warn('[TrainingQuestPanel] Claim all rewards - No claimAllTrainingQuestRewards in response:', result);
            }
        } catch (error) {
            console.error('[TrainingQuestPanel] Claim all rewards error:', error);
        } finally {
            setIsClaimingAll(false);
        }
    };

    return (
        <>
            <div className="bg-panel rounded-lg shadow-lg p-1.5 sm:p-2 h-full flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-1 sm:mb-1.5 border-b border-color pb-0.5 sm:pb-1 flex-shrink-0">
                    <h2 className="text-base sm:text-lg font-bold text-on-panel">수련 과제</h2>
                    {claimableQuestsCount > 0 && (
                        <Button
                            onClick={handleClaimAllRewards}
                            colorScheme="green"
                            className="!text-[10px] !py-0.5 !px-1.5 sm:!text-xs sm:!py-1 sm:!px-2 whitespace-nowrap"
                            disabled={isClaimingAll}
                        >
                            {isClaimingAll ? '수령 중...' : `일괄 수령 (${claimableQuestsCount})`}
                        </Button>
                    )}
                </div>
                
                {/* 2x3 그리드 */}
                <div className="flex-1 overflow-hidden min-h-0">
                    <div className="grid grid-cols-2 gap-1 sm:gap-1.5 h-full">
                        {trainingQuests.map((quest) => {
                            const { reward, progress, timeUntilNext, isMax } = calculateRewardAndProgress(quest);
                            const isMaxLevel = quest.currentLevel >= 10;
                            const levelUpInfo = getLevelUpInfo(quest);
                            const canCollect = reward > 0;

                            return (
                                <div
                                    key={quest.id}
                                    className={`
                                        relative bg-tertiary rounded-lg p-1 sm:p-1.5 border-2 flex flex-col min-h-0 overflow-hidden
                                        ${quest.isUnlocked ? 'border-primary' : 'border-gray-600'}
                                    `}
                                >
                                    {!quest.isUnlocked && (
                                        <>
                                            {/* 잠김 오버레이 - 반투명 배경 (버튼 클릭은 막지만 UI는 보이도록) */}
                                            <div className="absolute inset-0 bg-gray-900/50 rounded-lg z-30 pointer-events-none" />
                                            {/* 잠김 아이콘 및 텍스트 - 우상단에 작게 표시 */}
                                            <div className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 z-40 pointer-events-none">
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <div className="text-lg sm:text-xl filter drop-shadow-lg">🔒</div>
                                                    <div className="bg-black/80 rounded px-1.5 py-0.5 sm:px-2 sm:py-1 border border-gray-600">
                                                        <span className="text-white font-bold text-[8px] sm:text-[9px] text-center block whitespace-nowrap">
                                                            {quest.unlockStageId} 필요
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* 이미지 */}
                                    <div className={`w-full aspect-square max-w-[50px] sm:max-w-[60px] mx-auto rounded-lg overflow-hidden bg-gray-700 mb-0.5 sm:mb-1 flex-shrink-0 ${!quest.isUnlocked ? 'opacity-50' : ''}`}>
                                        <img 
                                            src={quest.image} 
                                            alt={quest.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                target.style.display = 'none';
                                            }}
                                        />
                                    </div>

                                    {/* 제목 및 레벨 */}
                                    <div className="mb-0.5 sm:mb-1 flex-shrink-0">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <h3 className={`font-bold text-[10px] sm:text-xs truncate ${quest.isUnlocked ? 'text-on-panel' : 'text-gray-400'}`}>
                                                {quest.name}
                                            </h3>
                                            <span className={`text-[8px] sm:text-[9px] ml-0.5 sm:ml-1 whitespace-nowrap ${quest.isUnlocked ? 'text-tertiary' : 'text-gray-500'}`}>
                                                Lv.{quest.currentLevel || 0}/10
                                            </span>
                                        </div>
                                    </div>

                                    {/* 막대그래프 및 재화 정보 - 항상 표시, 잠김 상태일 때는 비활성화 */}
                                    <div className={`space-y-0.5 sm:space-y-1 mb-0.5 sm:mb-1 flex-shrink-0 ${!quest.isUnlocked ? 'opacity-50' : ''}`}>
                                        {quest.levelInfo ? (
                                            <>
                                                {/* 막대그래프 */}
                                                <div className="relative">
                                                    <div className="w-full bg-gray-700 rounded-full h-3 sm:h-3.5 overflow-hidden">
                                                        {quest.isUnlocked && quest.isStarted ? (
                                                            <div 
                                                                className={`h-full transition-all duration-300 ${
                                                                    isMax ? 'bg-green-500' : 'bg-blue-500'
                                                                }`}
                                                                style={{ width: `${progress}%` }}
                                                            />
                                                        ) : (
                                                            <div 
                                                                className="h-full bg-gray-600"
                                                                style={{ width: '0%' }}
                                                            />
                                                        )}
                                                    </div>
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <span className={`text-[8px] sm:text-[9px] font-bold drop-shadow-md ${
                                                            !quest.isUnlocked ? 'text-gray-500' : 'text-white'
                                                        }`}>
                                                            {quest.isUnlocked && quest.isStarted 
                                                                ? `${reward.toLocaleString()} / ${quest.levelInfo.maxCapacity.toLocaleString()}`
                                                                : `0 / ${quest.levelInfo.maxCapacity.toLocaleString()}`
                                                            }
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* 생산 정보 */}
                                                <div className="flex items-center justify-between text-[8px] sm:text-[9px] leading-tight">
                                                    <span className={`flex items-center gap-0.5 ${quest.isUnlocked ? 'text-tertiary' : 'text-gray-500'}`}>
                                                        <span>{quest.levelInfo.productionRateMinutes}분/</span>
                                                        <span className="flex items-center gap-0.5">
                                                            <span>{quest.levelInfo.rewardAmount}</span>
                                                            <img 
                                                                src={quest.rewardType === 'gold' ? '/images/icon/Gold.png' : '/images/icon/Zem.png'} 
                                                                alt={quest.rewardType === 'gold' ? '골드' : '다이아'} 
                                                                className="w-2.5 h-2.5 sm:w-3 sm:h-3 object-contain"
                                                            />
                                                        </span>
                                                    </span>
                                                    {quest.isUnlocked && quest.isStarted && !isMax && timeUntilNext > 0 && (
                                                        <span className="text-gray-400">
                                                            {formatTime(timeUntilNext)}
                                                        </span>
                                                    )}
                                                    {quest.isUnlocked && quest.isStarted && isMax && (
                                                        <span className="text-green-400 font-semibold">
                                                            MAX
                                                        </span>
                                                    )}
                                                    {!quest.isUnlocked && (
                                                        <span className="text-gray-500">
                                                            잠김
                                                        </span>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            /* 레벨 0일 때 기본 표시 */
                                            <div className="space-y-0.5 sm:space-y-1">
                                                <div className="relative">
                                                    <div className="w-full bg-gray-700 rounded-full h-3 sm:h-3.5 overflow-hidden">
                                                        <div className="h-full bg-gray-600" style={{ width: '0%' }} />
                                                    </div>
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <span className={`text-[8px] sm:text-[9px] font-bold drop-shadow-md ${
                                                            !quest.isUnlocked ? 'text-gray-500' : 'text-white'
                                                        }`}>
                                                            0 / -
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between text-[8px] sm:text-[9px]">
                                                    <span className={`flex items-center gap-0.5 ${quest.isUnlocked ? 'text-tertiary' : 'text-gray-500'}`}>
                                                        <span>시작 후 표시</span>
                                                    </span>
                                                    {!quest.isUnlocked && (
                                                        <span className="text-gray-500">
                                                            잠김
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* 버튼 - 항상 표시, 잠김 상태일 때는 비활성화 */}
                                    <div className="mt-auto flex flex-col gap-0.5 sm:gap-1 flex-shrink-0">
                                        {!quest.isUnlocked ? (
                                            <>
                                                {/* 잠김 상태: 수령 및 강화 버튼 표시 (비활성화) */}
                                                <Button
                                                    disabled
                                                    colorScheme="green"
                                                    className="w-full !text-[9px] sm:!text-[10px] !py-0.5 sm:!py-0.5 opacity-50 flex items-center justify-center"
                                                >
                                                    <span className="flex items-center gap-1">
                                                        <span>수령</span>
                                                        <img 
                                                            src={quest.rewardType === 'gold' ? '/images/icon/Gold.png' : '/images/icon/Zem.png'} 
                                                            alt={quest.rewardType === 'gold' ? '골드' : '다이아'} 
                                                            className="w-3 h-3 object-contain"
                                                        />
                                                        <span>0</span>
                                                    </span>
                                                </Button>
                                                <Button
                                                    disabled
                                                    colorScheme="accent"
                                                    className="w-full !text-[9px] sm:!text-[10px] !py-0.5 sm:!py-0.5 opacity-50 flex items-center justify-center gap-1 !whitespace-nowrap"
                                                >
                                                    {quest.levelInfo && quest.currentLevel > 0 ? (
                                                        <div className="w-full flex items-center gap-1 min-w-0">
                                                            <div className="flex-1 flex items-center gap-1 min-w-0">
                                                                <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden min-w-0">
                                                                    <div 
                                                                        className="h-full bg-gradient-to-r from-yellow-400/50 to-yellow-500/50 transition-all duration-300"
                                                                        style={{ width: '0%' }}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <span className="text-sm font-bold flex-shrink-0">↑</span>
                                                        </div>
                                                    ) : (
                                                        <span>강화</span>
                                                    )}
                                                </Button>
                                            </>
                                        ) : !quest.isStarted ? (
                                            <Button
                                                onClick={() => handleStartMission(quest.id)}
                                                colorScheme="blue"
                                                className="w-full !text-[9px] sm:!text-[10px] !py-0.5 sm:!py-0.5"
                                            >
                                                시작
                                            </Button>
                                        ) : (
                                            <>
                                                <Button
                                                    onClick={() => handleCollectReward(quest.id)}
                                                    colorScheme="green"
                                                    className="w-full !text-[9px] sm:!text-[10px] !py-0.5 sm:!py-0.5 flex items-center justify-center"
                                                    disabled={!canCollect}
                                                >
                                                    <span className="flex items-center gap-1">
                                                        <span>수령</span>
                                                        <img 
                                                            src={quest.rewardType === 'gold' ? '/images/icon/Gold.png' : '/images/icon/Zem.png'} 
                                                            alt={quest.rewardType === 'gold' ? '골드' : '다이아'} 
                                                            className="w-3 h-3 object-contain flex-shrink-0"
                                                        />
                                                        <span>{reward > 0 ? reward.toLocaleString() : 0}</span>
                                                    </span>
                                                </Button>
                                                <Button
                                                    onClick={() => handleLevelUpClick(quest.id)}
                                                    colorScheme="accent"
                                                    className="w-full !text-[9px] sm:!text-[10px] !py-0.5 sm:!py-0.5 flex items-center justify-center gap-0.5 relative !whitespace-nowrap"
                                                    disabled={isMaxLevel}
                                                >
                                                    {levelUpInfo && !isMaxLevel ? (
                                                        <div className="w-full flex items-center gap-0.5 min-w-0">
                                                            <div className="flex-1 flex items-center gap-0.5 min-w-0">
                                                                <div className="flex-1 bg-gray-700/70 rounded-full h-1.5 sm:h-2 overflow-hidden min-w-0">
                                                                    <div 
                                                                        className="h-full bg-gradient-to-r from-yellow-400 to-yellow-500 transition-all duration-300"
                                                                        style={{ width: `${levelUpInfo.progress}%` }}
                                                                    />
                                                                </div>
                                                                <span className="text-[8px] sm:text-[9px] text-white font-bold whitespace-nowrap flex-shrink-0">{Math.floor(levelUpInfo.progress)}%</span>
                                                            </div>
                                                            <span className="text-xs sm:text-sm font-bold flex-shrink-0">↑</span>
                                                        </div>
                                                    ) : (
                                                        <span>강화</span>
                                                    )}
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 레벨업 모달 */}
            {selectedQuest && (
                <TrainingQuestLevelUpModal
                    mission={selectedQuest}
                    currentLevel={selectedQuest.currentLevel}
                    upgradeCost={selectedLevelUpInfo?.upgradeCost || 0}
                    canLevelUp={selectedLevelUpInfo?.canLevelUp || false}
                    nextLevelUnlockStage={selectedLevelUpInfo?.nextLevelUnlockStage}
                    currentUserGold={currentUser.gold}
                    accumulatedCollection={selectedLevelUpInfo?.accumulatedCollection ?? 0}
                    requiredCollection={selectedLevelUpInfo?.requiredCollection ?? 0}
                    progressPercent={selectedLevelUpInfo?.progress ?? 0}
                    onConfirm={() => handleLevelUpConfirm(selectedQuest.id)}
                    onClose={() => setSelectedMissionForUpgrade(null)}
                />
            )}

            {/* 강화 완료 토스트 */}
            {levelUpResult && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 w-full max-w-md z-[100] animate-slide-down">
                    <div className="bg-success border-2 border-green-400 rounded-lg shadow-2xl p-6 text-center">
                        <div className="text-6xl mb-3 animate-bounce">🎉</div>
                        <h3 className="text-2xl font-bold text-green-400 mb-2">강화 완료!</h3>
                        <p className="text-white text-lg mb-1">
                            <span className="font-semibold">{levelUpResult.missionName}</span>
                        </p>
                        <div className="flex items-center justify-center gap-3 text-xl font-bold">
                            <span className="text-yellow-400">Lv.{levelUpResult.previousLevel}</span>
                            <span className="text-white">→</span>
                            <span className="text-green-400">Lv.{levelUpResult.newLevel}</span>
                        </div>
                    </div>
                </div>
            )}
            
            {/* 일괄 수령 모달 */}
            {claimAllRewards && (
                <ClaimAllTrainingQuestRewardsModal
                    rewards={claimAllRewards.rewards}
                    totalGold={claimAllRewards.totalGold}
                    totalDiamonds={claimAllRewards.totalDiamonds}
                    onClose={() => setClaimAllRewards(null)}
                    isTopmost={true}
                />
            )}
        </>
    );
};

export default TrainingQuestPanel;
