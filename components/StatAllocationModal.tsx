import React, { useState, useMemo, useEffect } from 'react';
import { UserWithStatus, CoreStat, ServerAction } from '../types.js';
import DraggableWindow from './DraggableWindow.js';
import Button from './Button.js';
import RadarChart from './RadarChart.js';
import { CORE_STATS_DATA } from '../constants';

interface StatAllocationModalProps {
    currentUser: UserWithStatus;
    onClose: () => void;
    onAction: (action: ServerAction) => void;
    isTopmost?: boolean;
}

const StatAllocationModal: React.FC<StatAllocationModalProps> = ({ currentUser, onClose, onAction, isTopmost }) => {
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // 모달이 열릴 때: spentStatPoints가 있고 분배된 포인트가 있으면 편집 모드 비활성화
    const [isEditing, setIsEditing] = useState(() => {
        if (!currentUser.spentStatPoints || Object.keys(currentUser.spentStatPoints).length === 0) {
            return true; // 분배된 포인트가 없으면 편집 모드
        }
        const totalSpent = Object.values(currentUser.spentStatPoints).reduce((sum, points) => sum + points, 0);
        return totalSpent === 0; // 분배된 포인트가 없으면 편집 모드, 있으면 읽기 전용
    });
    const [tempPoints, setTempPoints] = useState<Record<CoreStat, number>>(() => {
        if (currentUser.spentStatPoints && Object.keys(currentUser.spentStatPoints).length > 0) {
            return currentUser.spentStatPoints;
        } else {
            return {
                [CoreStat.Concentration]: 0,
                [CoreStat.ThinkingSpeed]: 0,
                [CoreStat.Judgment]: 0,
                [CoreStat.Calculation]: 0,
                [CoreStat.CombatPower]: 0,
                [CoreStat.Stability]: 0,
            };
        }
    });

    const resetCost = 1000;
    const maxDailyResets = 2;
    const currentDay = new Date().toDateString();
    const lastResetDate = currentUser.lastStatResetDate;
    const statResetCountToday = currentUser.statResetCountToday || 0;

    const canReset = useMemo(() => {
        if (currentUser.gold < resetCost) return false;
        if (lastResetDate === currentDay && statResetCountToday >= maxDailyResets) return false;
        return true;
    }, [currentUser.gold, lastResetDate, statResetCountToday, currentDay, resetCost]);

    const levelPoints = useMemo(() => {
        return (currentUser.strategyLevel - 1) * 2 + (currentUser.playfulLevel - 1) * 2;
    }, [currentUser.strategyLevel, currentUser.playfulLevel]);
    
    const bonusPoints = useMemo(() => {
        return currentUser.bonusStatPoints || 0;
    }, [currentUser.bonusStatPoints]);
    
    const totalBonusPoints = useMemo(() => {
        return levelPoints + bonusPoints;
    }, [levelPoints, bonusPoints]);

    const spentPoints = useMemo(() => {
        return Object.values(tempPoints).reduce((sum, points) => sum + points, 0);
    }, [tempPoints]);

    const availablePoints = useMemo(() => {
        // 항상 실제 사용 가능한 포인트를 계산하여 표시 (읽기 전용 모드에서도)
        return totalBonusPoints - spentPoints;
    }, [totalBonusPoints, spentPoints]);

    const handlePointChange = (stat: CoreStat, value: string) => {
        const newValue = Number(value) || 0;
        setTempPoints(prev => {
            const currentSpentOnOthers = Object.entries(prev)
                .filter(([key]) => key !== stat)
                .reduce((sum, [, val]) => sum + val, 0);

            const maxForThisStat = totalBonusPoints - currentSpentOnOthers;
            const finalValue = Math.max(0, Math.min(newValue, maxForThisStat));
            
            return { ...prev, [stat]: finalValue };
        });
    };

    // currentUser가 업데이트되면 tempPoints와 isEditing 업데이트
    useEffect(() => {
        // tempPoints 업데이트
        if (currentUser.spentStatPoints && Object.keys(currentUser.spentStatPoints).length > 0) {
            setTempPoints(currentUser.spentStatPoints);
        } else {
            // spentStatPoints가 없으면 초기화
            setTempPoints({
                [CoreStat.Concentration]: 0,
                [CoreStat.ThinkingSpeed]: 0,
                [CoreStat.Judgment]: 0,
                [CoreStat.Calculation]: 0,
                [CoreStat.CombatPower]: 0,
                [CoreStat.Stability]: 0,
            });
        }
        
        // isEditing 업데이트: 분배된 포인트가 있으면 편집 모드 비활성화
        if (!currentUser.spentStatPoints || Object.keys(currentUser.spentStatPoints).length === 0) {
            setIsEditing(true);
        } else {
            const totalSpent = Object.values(currentUser.spentStatPoints).reduce((sum, points) => sum + points, 0);
            setIsEditing(totalSpent === 0); // 분배된 포인트가 없으면 편집 모드, 있으면 읽기 전용
        }
    }, [currentUser.spentStatPoints, currentUser.bonusStatPoints, currentUser.strategyLevel, currentUser.playfulLevel]);

    const handleReset = () => {
        if (!canReset) {
            alert("능력치 초기화 조건을 충족하지 못했습니다. 골드가 부족하거나 일일 초기화 횟수를 초과했습니다.");
            return;
        }
        if (window.confirm(`골드 ${resetCost}개를 사용하여 모든 보너스 포인트를 초기화하시겠습니까? (오늘 ${maxDailyResets - statResetCountToday}회 남음)`)) {
            onAction({ type: 'RESET_STAT_POINTS' });
            setTempPoints({
                [CoreStat.Concentration]: 0,
                [CoreStat.ThinkingSpeed]: 0,
                [CoreStat.Judgment]: 0,
                [CoreStat.Calculation]: 0,
                [CoreStat.CombatPower]: 0,
                [CoreStat.Stability]: 0,
            });
            setIsEditing(true);
        }
    };
    
    const hasChanges = useMemo(() => {
        if (!currentUser.spentStatPoints) return spentPoints > 0; // If no points spent, any spent points means changes
        return Object.values(CoreStat).some(stat => tempPoints[stat] !== currentUser.spentStatPoints![stat]);
    }, [tempPoints, currentUser.spentStatPoints, spentPoints]);

    const handleConfirm = () => {
        onAction({ type: 'CONFIRM_STAT_ALLOCATION', payload: { newStatPoints: tempPoints } });
        setIsEditing(false); // 저장 후 편집 모드 비활성화
        onClose();
    };

    const chartStats = useMemo(() => {
        const result: Record<string, number> = {};
        for (const key of Object.values(CoreStat)) {
            result[key] = (currentUser.baseStats[key] || 0) + (tempPoints[key] || 0);
        }
        return result;
    }, [currentUser.baseStats, tempPoints]);

    const radarDatasets = useMemo(() => [
        { stats: chartStats, color: '#60a5fa', fill: 'rgba(59, 130, 246, 0.4)' }
    ], [chartStats]);

    const statColors: Record<CoreStat, string> = {
        [CoreStat.Concentration]: 'from-blue-500 to-cyan-400',
        [CoreStat.ThinkingSpeed]: 'from-purple-500 to-pink-400',
        [CoreStat.Judgment]: 'from-amber-500 to-yellow-400',
        [CoreStat.Calculation]: 'from-emerald-500 to-green-400',
        [CoreStat.CombatPower]: 'from-red-500 to-orange-400',
        [CoreStat.Stability]: 'from-indigo-500 to-blue-400',
    };

    // 능력치를 3개씩 양쪽으로 나누기
    const leftStats = [CoreStat.Concentration, CoreStat.ThinkingSpeed, CoreStat.Judgment];
    const rightStats = [CoreStat.Calculation, CoreStat.CombatPower, CoreStat.Stability];

    return (
        <DraggableWindow title="능력치 포인트 분배" onClose={onClose} windowId="stat-allocation" initialWidth={isMobile ? 400 : 1000} isTopmost={isTopmost}>
            <div className={`flex flex-col ${isMobile ? 'gap-2' : 'gap-4'} ${isMobile ? 'h-auto' : 'h-auto'} min-h-0 ${isMobile ? 'overflow-y-auto max-h-[calc(100vh-120px)]' : ''}`}>
                {/* 상단: 보너스 포인트 표시 */}
                <div className={`bg-gradient-to-r from-purple-900/60 via-indigo-900/60 to-blue-900/60 ${isMobile ? 'p-1.5' : 'p-3'} rounded-xl border border-purple-500/30 shadow-lg backdrop-blur-sm text-center flex-shrink-0`}>
                    <p className={`${isMobile ? 'text-[10px]' : 'text-xs'} text-purple-200 mb-0.5`}>사용 가능한 보너스 포인트</p>
                    <p className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent`}>{availablePoints}</p>
                </div>

                {/* 중앙: 육각형 그래프를 가운데, 양쪽에 능력치 3개씩 */}
                <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} ${isMobile ? 'gap-2' : 'gap-4'} ${isMobile ? 'items-stretch' : 'items-center'} justify-center flex-shrink-0`}>
                    {/* 왼쪽: 능력치 3개 */}
                    <div className={`${isMobile ? 'w-full' : 'w-1/3'} flex flex-col ${isMobile ? 'gap-1.5' : 'gap-2'}`}>
                        {leftStats.map(stat => {
                            const currentSpent = tempPoints[stat] || 0;
                            const maxForThisSlider = currentSpent + availablePoints;
                            const statName = CORE_STATS_DATA[stat].name;
                            const colorClass = statColors[stat];
                            
                            return (
                                <div key={stat} className={`bg-gradient-to-br from-gray-900/70 to-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-lg border border-gray-700/50 shadow-lg backdrop-blur-sm hover:border-cyan-400/50 transition-all duration-200`}>
                                    <div className={`flex justify-between items-center ${isMobile ? 'mb-1' : 'mb-1.5'}`}>
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-1.5 h-1.5 rounded-full bg-gradient-to-r ${colorClass} shadow-lg`}></div>
                                            <span className={`font-bold ${isMobile ? 'text-[10px]' : 'text-xs'} text-gray-100`}>{statName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`${isMobile ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>{currentUser.baseStats[stat] || 0}</span>
                                            <span className={`font-mono font-bold ${isMobile ? 'text-xs' : 'text-sm'} bg-gradient-to-r ${colorClass} bg-clip-text text-transparent`}>
                                                {chartStats[stat]}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
                                        <input
                                            type="range"
                                            min="0"
                                            max={maxForThisSlider}
                                            value={currentSpent}
                                            onChange={(e) => handlePointChange(stat, e.target.value)}
                                            className={`flex-1 ${isMobile ? 'h-1' : 'h-1.5'} rounded-full appearance-none cursor-pointer`}
                                            style={{
                                                background: maxForThisSlider > 0 
                                                    ? `linear-gradient(to right, rgb(34, 211, 238) 0%, rgb(34, 211, 238) ${(currentSpent / maxForThisSlider) * 100}%, rgba(75, 85, 99, 0.5) ${(currentSpent / maxForThisSlider) * 100}%, rgba(75, 85, 99, 0.5) 100%)`
                                                    : 'rgba(75, 85, 99, 0.5)'
                                            }}
                                            disabled={!isEditing}
                                        />
                                        <input
                                            type="number"
                                            value={currentSpent}
                                            onChange={(e) => handlePointChange(stat, e.target.value)}
                                            className={`${isMobile ? 'w-12 text-[10px] p-0.5' : 'w-16 text-xs p-1'} bg-gray-800/80 border border-cyan-500/30 rounded-md text-center text-cyan-200 font-bold focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all`}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 가운데: 육각형 그래프 */}
                    <div className={`${isMobile ? 'w-full' : 'w-1/3'} flex flex-col items-center justify-center bg-gradient-to-br from-gray-900/80 via-gray-800/60 to-gray-900/80 ${isMobile ? 'p-2' : 'p-4'} rounded-xl border border-cyan-500/20 shadow-2xl backdrop-blur-sm flex-shrink-0`}>
                        <div className={isMobile ? 'scale-75' : 'scale-90'}>
                            <RadarChart datasets={radarDatasets} maxStatValue={300} size={isMobile ? 180 : 220} />
                        </div>
                    </div>

                    {/* 오른쪽: 능력치 3개 */}
                    <div className={`${isMobile ? 'w-full' : 'w-1/3'} flex flex-col ${isMobile ? 'gap-1.5' : 'gap-2'}`}>
                        {rightStats.map(stat => {
                            const currentSpent = tempPoints[stat] || 0;
                            const maxForThisSlider = currentSpent + availablePoints;
                            const statName = CORE_STATS_DATA[stat].name;
                            const colorClass = statColors[stat];
                            
                            return (
                                <div key={stat} className={`bg-gradient-to-br from-gray-900/70 to-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-lg border border-gray-700/50 shadow-lg backdrop-blur-sm hover:border-cyan-400/50 transition-all duration-200`}>
                                    <div className={`flex justify-between items-center ${isMobile ? 'mb-1' : 'mb-1.5'}`}>
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-1.5 h-1.5 rounded-full bg-gradient-to-r ${colorClass} shadow-lg`}></div>
                                            <span className={`font-bold ${isMobile ? 'text-[10px]' : 'text-xs'} text-gray-100`}>{statName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`${isMobile ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>{currentUser.baseStats[stat] || 0}</span>
                                            <span className={`font-mono font-bold ${isMobile ? 'text-xs' : 'text-sm'} bg-gradient-to-r ${colorClass} bg-clip-text text-transparent`}>
                                                {chartStats[stat]}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
                                        <input
                                            type="range"
                                            min="0"
                                            max={maxForThisSlider}
                                            value={currentSpent}
                                            onChange={(e) => handlePointChange(stat, e.target.value)}
                                            className={`flex-1 ${isMobile ? 'h-1' : 'h-1.5'} rounded-full appearance-none cursor-pointer`}
                                            style={{
                                                background: maxForThisSlider > 0 
                                                    ? `linear-gradient(to right, rgb(34, 211, 238) 0%, rgb(34, 211, 238) ${(currentSpent / maxForThisSlider) * 100}%, rgba(75, 85, 99, 0.5) ${(currentSpent / maxForThisSlider) * 100}%, rgba(75, 85, 99, 0.5) 100%)`
                                                    : 'rgba(75, 85, 99, 0.5)'
                                            }}
                                            disabled={!isEditing}
                                        />
                                        <input
                                            type="number"
                                            value={currentSpent}
                                            onChange={(e) => handlePointChange(stat, e.target.value)}
                                            className={`${isMobile ? 'w-12 text-[10px] p-0.5' : 'w-16 text-xs p-1'} bg-gray-800/80 border border-cyan-500/30 rounded-md text-center text-cyan-200 font-bold focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all`}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 하단: 버튼들 */}
                <div className={`flex ${isMobile ? 'flex-col' : 'justify-between items-center'} ${isMobile ? 'gap-2' : ''} ${isMobile ? 'pt-2' : 'pt-3'} border-t border-gray-700/50 flex-shrink-0`}>
                    <div className={`flex flex-col ${isMobile ? 'items-stretch w-full' : 'items-start'} ${isMobile ? 'gap-1' : ''}`}>
                        <Button 
                            onClick={handleReset} 
                            colorScheme="red" 
                            disabled={!canReset}
                            className={`${isMobile ? '!text-xs !py-2 !px-3 w-full min-h-[40px]' : '!text-xs !py-1 !px-2'} bg-gradient-to-r from-red-600/90 to-orange-600/90 hover:from-red-500 hover:to-orange-500 border border-red-400/50 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            초기화 (<img src="/images/icon/Gold.png" alt="골드" className={`${isMobile ? 'w-3 h-3' : 'w-3 h-3'} inline-block`} />{resetCost})
                        </Button>
                        <p className={`${isMobile ? 'text-[10px]' : 'text-[10px]'} text-gray-400 ${isMobile ? 'mt-0 text-center' : 'mt-0.5'}`}>일일 변경제한: {maxDailyResets - statResetCountToday}/{maxDailyResets}</p>
                    </div>
                    <div className={`flex ${isMobile ? 'w-full' : ''} ${isMobile ? 'gap-2' : 'gap-2'} ${isMobile ? 'mt-1' : ''}`}>
                        <Button 
                            onClick={onClose} 
                            colorScheme="gray" 
                            className={`${isMobile ? '!text-xs !py-2 !px-3 flex-1 min-h-[40px]' : '!text-xs !py-1 !px-3'} bg-gradient-to-r from-gray-700/90 to-gray-600/90 hover:from-gray-600 hover:to-gray-500 border border-gray-500/50 shadow-lg`}
                        >
                            취소
                        </Button>
                        {isEditing ? (
                            <Button 
                                onClick={handleConfirm} 
                                colorScheme="green" 
                                disabled={!hasChanges} 
                                className={`${isMobile ? '!text-xs !py-2 !px-3 flex-1 min-h-[40px]' : '!text-xs !py-1 !px-3'} bg-gradient-to-r from-emerald-600/90 to-green-600/90 hover:from-emerald-500 hover:to-green-500 border border-emerald-400/50 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                분배
                            </Button>
                        ) : (
                            <Button 
                                onClick={onClose} 
                                colorScheme="gray" 
                                className={`${isMobile ? '!text-xs !py-2 !px-3 flex-1 min-h-[40px]' : '!text-xs !py-1 !px-3'} bg-gradient-to-r from-gray-700/90 to-gray-600/90 hover:from-gray-600 hover:to-gray-500 border border-gray-500/50 shadow-lg`}
                            >
                                닫기
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default StatAllocationModal;