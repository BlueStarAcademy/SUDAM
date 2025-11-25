import React, { useState, useEffect, useCallback, useMemo, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { UserWithStatus, TournamentState, PlayerForTournament, ServerAction, User, CoreStat, Match, Round, CommentaryLine, TournamentType, LeagueTier } from '../types.js';
import Button from './Button.js';
import { useButtonClickThrottle } from '../hooks/useButtonClickThrottle.js';
import { useTournamentSimulation } from '../hooks/useTournamentSimulation.js';
import { TOURNAMENT_DEFINITIONS, BASE_TOURNAMENT_REWARDS, TOURNAMENT_SCORE_REWARDS, CONSUMABLE_ITEMS, MATERIAL_ITEMS, AVATAR_POOL, BORDER_POOL, CORE_STATS_DATA, LEAGUE_DATA } from '../constants';
import Avatar from './Avatar.js';
import RadarChart from './RadarChart.js';
import SgfViewer from './SgfViewer.js';
import { audioService } from '../services/audioService.js';
import ConditionPotionModal from './ConditionPotionModal.js';
import { calculateTotalStats } from '../services/statService.js';
import SimulationArenaHelpModal from './SimulationArenaHelpModal.js';

// Error Boundary for PlayerProfilePanel
class PlayerProfilePanelErrorBoundary extends Component<
    { children: ReactNode; fallback?: ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: ReactNode; fallback?: ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        if (import.meta.env.DEV) {
            console.error('[PlayerProfilePanelErrorBoundary] Error caught:', error, errorInfo);
        }
    }

    componentDidUpdate(prevProps: { children: ReactNode }) {
        // props가 변경되면 에러 상태 리셋
        if (prevProps.children !== this.props.children && this.state.hasError) {
            this.setState({ hasError: false, error: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="p-2 text-center text-gray-500 flex items-center justify-center h-full bg-gray-900/50 rounded-lg">
                    선수 정보를 불러오는 중 오류가 발생했습니다.
                </div>
            );
        }

        return this.props.children;
    }
}

const KEY_STATS_BY_PHASE: Record<'early' | 'mid' | 'end', CoreStat[]> = {
    early: [CoreStat.CombatPower, CoreStat.ThinkingSpeed, CoreStat.Concentration],
    mid: [CoreStat.CombatPower, CoreStat.Judgment, CoreStat.Concentration, CoreStat.Stability],
    end: [CoreStat.Calculation, CoreStat.Stability, CoreStat.Concentration],
};

// 서버의 STAT_WEIGHTS와 동일한 가중치 정의
const STAT_WEIGHTS: Record<'early' | 'mid' | 'end', Partial<Record<CoreStat, number>>> = {
    early: {
        [CoreStat.CombatPower]: 0.4,
        [CoreStat.ThinkingSpeed]: 0.3,
        [CoreStat.Concentration]: 0.3,
    },
    mid: {
        [CoreStat.CombatPower]: 0.3,
        [CoreStat.Judgment]: 0.3,
        [CoreStat.Concentration]: 0.2,
        [CoreStat.Stability]: 0.2,
    },
    end: {
        [CoreStat.Calculation]: 0.5,
        [CoreStat.Stability]: 0.3,
        [CoreStat.Concentration]: 0.2,
    },
};

const getMaxStatValueForLeague = (league: LeagueTier): number => {
    switch (league) {
        case LeagueTier.Sprout:
        case LeagueTier.Rookie:
        case LeagueTier.Rising:
            return 250;
        case LeagueTier.Ace:
        case LeagueTier.Diamond:
            return 300;
        case LeagueTier.Master:
        case LeagueTier.Grandmaster:
            return 400;
        case LeagueTier.Challenger:
            return 500;
        default:
            return 250;
    }
};

interface TournamentBracketProps {
    tournament: TournamentState;
    currentUser: UserWithStatus;
    onBack: () => void;
    allUsersForRanking: User[];
    onViewUser: (userId: string) => void;
    onAction: (action: ServerAction) => void;
    onStartNextRound: () => void;
    onReset: () => void;
    onSkip: () => void;
    onOpenShop?: () => void;
    isMobile: boolean;
}

const PlayerProfilePanel: React.FC<{ 
    player: PlayerForTournament | null, 
    initialPlayer: PlayerForTournament | null,
    allUsers: User[], 
    currentUserId: string, 
    onViewUser: (userId: string) => void,
    highlightPhase: 'early' | 'mid' | 'end' | 'none';
    isUserMatch?: boolean;
    onUseConditionPotion?: () => void;
    onOpenShop?: () => void;
    timeElapsed?: number;
    tournamentStatus?: string;
    isMobile?: boolean;
}> = ({ player, initialPlayer, allUsers, currentUserId, onViewUser, highlightPhase, isUserMatch, onUseConditionPotion, onOpenShop, timeElapsed = 0, tournamentStatus, isMobile = false }) => {
    // 모든 hooks는 조건부 return 전에 선언되어야 함
    const [previousCondition, setPreviousCondition] = useState<number | undefined>(undefined);
    const [showConditionIncrease, setShowConditionIncrease] = useState(false);
    const [conditionIncreaseAmount, setConditionIncreaseAmount] = useState(0);
    const [statChanges, setStatChanges] = useState<Record<CoreStat, number>>({} as Record<CoreStat, number>);
    const prevStatsRef = useRef<Record<CoreStat, number>>({} as Record<CoreStat, number>);
    const initialStatsKeyRef = useRef<string>('');
    
    // player가 변경되면 previousCondition 초기화
    useEffect(() => {
        // player가 null이 아니고 condition이 유효한 경우에만 설정
        if (player && player.condition !== undefined && player.condition !== null) {
            setPreviousCondition(player.condition);
        } else {
            setPreviousCondition(undefined);
        }
    }, [player?.id, player?.condition]);
    
    // initialStats를 useMemo로 변경하여 player.originalStats나 initialPlayer가 변경될 때마다 업데이트되도록 함
    const initialStats = useMemo<Record<CoreStat, number>>(() => {
        // player가 없으면 모든 CoreStat을 0으로 초기화
        if (!player) {
            const emptyStats: Record<CoreStat, number> = {} as Record<CoreStat, number>;
            Object.values(CoreStat).forEach(stat => {
                emptyStats[stat] = 0;
            });
            return emptyStats;
        }
        try {
            // player가 존재하는 경우에만 접근
            const p = player; // 로컬 변수로 안전하게 참조
            
            // 다음 경기로 넘어갔을 때 originalStats로 초기화된 값을 사용
            if (p.originalStats && typeof p.originalStats === 'object' && Object.keys(p.originalStats).length > 0) {
                return { ...p.originalStats };
            }
            // initialPlayer가 있으면 그것을 사용 (경기 시작 시점의 상태)
            if (initialPlayer?.stats && typeof initialPlayer.stats === 'object' && Object.keys(initialPlayer.stats).length > 0) {
                return { ...initialPlayer.stats };
            }
            // 그 외에는 현재 player.stats 사용
            if (p.stats && typeof p.stats === 'object' && Object.keys(p.stats).length > 0) {
                return { ...p.stats };
            }
            // 모든 것이 실패하면 기본값 반환 (모든 CoreStat을 0으로)
            const defaultStats: Record<CoreStat, number> = {} as Record<CoreStat, number>;
            Object.values(CoreStat).forEach(stat => {
                defaultStats[stat] = 0;
            });
            return defaultStats;
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[PlayerProfilePanel] Error in initialStats calculation:', error);
            }
            // 에러 발생 시 기본값 반환
            const defaultStats: Record<CoreStat, number> = {} as Record<CoreStat, number>;
            Object.values(CoreStat).forEach(stat => {
                defaultStats[stat] = 0;
            });
            return defaultStats;
        }
    }, [player?.id, player?.originalStats, initialPlayer?.stats, player?.stats]);
    
    // initialStats가 변경되면 prevStatsRef 리셋 (새 경기 시작)
    useEffect(() => {
        if (!player) return;
        const currentKey = JSON.stringify(initialStats);
        if (initialStatsKeyRef.current !== currentKey) {
            initialStatsKeyRef.current = currentKey;
            prevStatsRef.current = { ...initialStats };
            setStatChanges({} as Record<CoreStat, number>);
        }
    }, [initialStats, player?.id]);
    
    // 컨디션 변화 감지 및 애니메이션 트리거
    useEffect(() => {
        // player가 null이거나 condition이 유효하지 않으면 early return
        if (!player || player.condition === undefined || player.condition === null) {
            // player가 없으면 previousCondition도 초기화
            if (!player) {
                setPreviousCondition(undefined);
            }
            return;
        }
        
        // player를 로컬 변수로 캡처하여 안전하게 참조
        const currentPlayer = player;
        const currentCondition = currentPlayer.condition;
        
        // currentCondition이 유효하지 않으면 early return
        if (currentCondition === undefined || currentCondition === null) {
            return;
        }
        
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        
        // 안전 체크: previousCondition이 유효하고 증가한 경우에만 애니메이션
        if (previousCondition !== undefined && 
            currentCondition !== 1000 && 
            previousCondition !== 1000 &&
            currentCondition > previousCondition) {
            const increase = currentCondition - previousCondition;
            if (increase > 0) {
                setConditionIncreaseAmount(increase);
                setShowConditionIncrease(true);
                timeoutId = setTimeout(() => {
                    setShowConditionIncrease(false);
                }, 2000);
            }
        }
        // currentCondition을 previousCondition으로 업데이트
        setPreviousCondition(currentCondition);
        
        // cleanup 함수
        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [player?.id, player?.condition, previousCondition]);

    // 모든 hooks는 조건부 return 전에 선언되어야 함 (React hooks 규칙)
    // player가 null일 수 있으므로 안전하게 처리
    const fullUserData = useMemo(() => {
        if (!player || !player.id) return undefined;
        return allUsers.find(u => u.id === player.id);
    }, [allUsers, player?.id]);
    const leagueInfo = useMemo(() => {
        if (!player || player.league === undefined) return undefined;
        return LEAGUE_DATA.find(league => league.tier === player.league);
    }, [player?.league]);

    const cumulativeStats = useMemo(() => {
        const result = { wins: 0, losses: 0 };
        if (fullUserData?.stats) {
            Object.values(fullUserData.stats).forEach(s => {
                result.wins += s.wins;
                result.losses += s.losses;
            });
        }
        return result;
    }, [fullUserData]);

    // player가 null이 아니라는 것을 확인했지만, 안전성을 위해 옵셔널 체이닝 사용
    const isClickable = player ? (!player.id.startsWith('bot-') && player.id !== currentUserId) : false;
    const avatarUrl = useMemo(() => {
        if (!player || !player.avatarId) return undefined;
        return AVATAR_POOL.find(a => a.id === player.avatarId)?.url;
    }, [player?.avatarId]);
    const borderUrl = useMemo(() => {
        if (!player || !player.borderId) return undefined;
        return BORDER_POOL.find(b => b.id === player.borderId)?.url;
    }, [player?.borderId]);
    const isCurrentUser = player ? (player.id === currentUserId) : false;
    
    // 컨디션 회복제 보유 개수 확인
    const potionCounts = useMemo(() => {
        const counts: Record<string, number> = { small: 0, medium: 0, large: 0 };
        if (fullUserData?.inventory) {
            fullUserData.inventory
                .filter(item => item.type === 'consumable' && item.name.startsWith('컨디션회복제'))
                .forEach(item => {
                    if (item.name === '컨디션회복제(소)') {
                        counts.small += item.quantity || 1;
                    } else if (item.name === '컨디션회복제(중)') {
                        counts.medium += item.quantity || 1;
                    } else if (item.name === '컨디션회복제(대)') {
                        counts.large += item.quantity || 1;
                    }
                });
        }
        return counts;
    }, [fullUserData?.inventory]);
    
    const totalPotionCount = potionCounts.small + potionCounts.medium + potionCounts.large;
    
    // 능력치 변화 감지 (경기 진행 중일 때만) - 모든 hooks는 조건부 return 전에 선언되어야 함
    useEffect(() => {
        // player와 player.stats가 없으면 early return
        if (!player || !player.stats || typeof player.stats !== 'object' || tournamentStatus !== 'round_in_progress') {
            // 경기가 진행 중이 아니면 statChanges 초기화
            if (tournamentStatus !== 'round_in_progress') {
                setStatChanges({} as Record<CoreStat, number>);
            }
            return;
        }
        
        // player를 로컬 변수로 캡처하여 안전하게 참조
        const currentPlayer = player;
        if (!currentPlayer || !currentPlayer.stats || typeof currentPlayer.stats !== 'object') {
            return;
        }
        
        // player.stats가 유효한 객체인지 확인
        const currentStats = currentPlayer.stats as Record<CoreStat, number>;
        if (!currentStats || typeof currentStats !== 'object') {
            return;
        }
        
        // 초기화: prevStatsRef가 비어있거나 initialStats가 변경되었으면 초기화
        const initialKey = JSON.stringify(initialStats);
        if (Object.keys(prevStatsRef.current).length === 0 || initialStatsKeyRef.current !== initialKey) {
            prevStatsRef.current = { ...initialStats };
            initialStatsKeyRef.current = initialKey;
            // 초기화 시에는 변화가 없으므로 statChanges도 초기화
            setStatChanges({} as Record<CoreStat, number>);
            // 초기화 후에는 현재 stats를 저장하고 종료
            prevStatsRef.current = { ...currentStats } as Record<CoreStat, number>;
            return;
        }
        
        // 각 능력치를 개별적으로 비교하여 변화 감지
        const changes: Record<CoreStat, number> = {} as Record<CoreStat, number>;
        let hasChanges = false;
        
        Object.values(CoreStat).forEach(stat => {
            const prev = prevStatsRef.current[stat] ?? initialStats[stat] ?? 0;
            const curr = currentStats[stat] ?? 0;
            const diff = curr - prev;
            // 변화가 있으면 감지 (0이 아닌 변화만)
            if (diff !== 0) {
                changes[stat] = diff;
                hasChanges = true;
            }
        });
        
        // 현재 stats를 깊은 복사로 저장 (다음 비교를 위해, 변화가 있든 없든 항상 업데이트)
        prevStatsRef.current = { ...currentStats } as Record<CoreStat, number>;
        
        // 변화가 있으면 애니메이션 트리거
        if (hasChanges) {
            // 개발 모드에서만 상세 로그 출력
            if (import.meta.env.DEV && Object.keys(changes).length > 0 && currentPlayer?.nickname) {
                console.log(`[PlayerProfilePanel] Stat changes detected for ${currentPlayer.nickname}:`, changes);
            }
            // 새로운 변화를 설정하여 애니메이션 트리거
            setStatChanges(changes);
            // 2초 후 애니메이션 초기화 (fade out)
            const timeoutId = setTimeout(() => {
                setStatChanges({} as Record<CoreStat, number>);
            }, 2000);
            // cleanup 함수에서 timeout 정리
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [
        player?.id, // 플레이어가 변경되면 초기화
        player?.stats?.[CoreStat.CombatPower],
        player?.stats?.[CoreStat.ThinkingSpeed],
        player?.stats?.[CoreStat.Judgment],
        player?.stats?.[CoreStat.Calculation],
        player?.stats?.[CoreStat.Concentration],
        player?.stats?.[CoreStat.Stability],
        timeElapsed,
        tournamentStatus,
        initialStats
    ]);

    const isStatHighlighted = (stat: CoreStat) => {
        if (highlightPhase === 'none') return false;
        return KEY_STATS_BY_PHASE[highlightPhase].includes(stat);
    };
    
    // 경기 시작 전에는 홈 화면과 동일한 능력치 계산 (calculateTotalStats 사용)
    // 경기 중에는 player.stats를 사용 (컨디션으로 인한 변화 반영)
    const displayStats = useMemo(() => {
        // player가 없으면 기본값 반환
        if (!player) {
            const defaultStats: Record<CoreStat, number> = {} as Record<CoreStat, number>;
            Object.values(CoreStat).forEach(stat => {
                defaultStats[stat] = 0;
            });
            return defaultStats;
        }
        
        // player를 로컬 변수로 캡처하여 안전하게 참조
        const currentPlayer = player;
        if (!currentPlayer) {
            const defaultStats: Record<CoreStat, number> = {} as Record<CoreStat, number>;
            Object.values(CoreStat).forEach(stat => {
                defaultStats[stat] = 0;
            });
            return defaultStats;
        }
        
        if (tournamentStatus === 'round_in_progress') {
            // 경기 중에는 현재 능력치 사용 (컨디션 변화 반영)
            return currentPlayer.stats || initialStats;
        }

        if (currentPlayer.originalStats && typeof currentPlayer.originalStats === 'object') {
            // 토너먼트 생성 시점의 고정 능력치 사용
            return currentPlayer.originalStats;
        }

        if (fullUserData) {
            // 유저 정보가 있으면 최신 능력치 계산
            try {
                return calculateTotalStats(fullUserData);
            } catch (error) {
                if (import.meta.env.DEV) {
                    console.error('[PlayerProfilePanel] Error calculating total stats:', error);
                }
                return currentPlayer.stats || initialStats;
            }
        }

        return currentPlayer.stats || initialStats;
    }, [player?.id, player?.stats, player?.originalStats, fullUserData, tournamentStatus, initialStats]);
    
    // 바둑능력 점수 계산 (모든 능력치의 합계, 정수로 반올림)
    const totalAbilityScore = useMemo(() => {
        try {
            if (!displayStats || typeof displayStats !== 'object') {
                return 0;
            }
            return Math.round(Object.values(displayStats).reduce((sum, stat) => sum + (stat || 0), 0));
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[PlayerProfilePanel] Error calculating total ability score:', error);
            }
            return 0;
        }
    }, [displayStats]);
    
    // 초반/중반/종반 능력치 계산 (서버의 calculatePower와 동일한 로직)
    // 각 능력치에 가중치를 곱한 후 합산
    const phaseStats = useMemo(() => {
        try {
            if (!displayStats || typeof displayStats !== 'object') {
                return { early: 0, mid: 0, end: 0 };
            }
            
            const calculatePhasePower = (phase: 'early' | 'mid' | 'end') => {
                const weights = STAT_WEIGHTS[phase];
                if (!weights || typeof weights !== 'object') {
                    return 0;
                }
                let power = 0;
                for (const stat in weights) {
                    const statKey = stat as CoreStat;
                    const weight = weights[statKey];
                    if (weight !== undefined && weight !== null) {
                        power += (displayStats[statKey] || 0) * weight;
                    }
                }
                return power;
            };
            
            return {
                early: Math.round(calculatePhasePower('early')),
                mid: Math.round(calculatePhasePower('mid')),
                end: Math.round(calculatePhasePower('end'))
            };
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('[PlayerProfilePanel] Error calculating phase stats:', error);
            }
            return { early: 0, mid: 0, end: 0 };
        }
    }, [displayStats, player?.condition]);
    
    // player가 null이면 early return (이미 위에서 처리했지만 안전성을 위해 다시 확인)
    // 이 시점에서 player가 null이면 모든 hooks가 실행되었지만 안전하게 처리되었으므로 안전함
    if (!player) {
        return <div className="p-2 text-center text-gray-500 flex items-center justify-center h-full bg-gray-900/50 rounded-lg">선수 대기 중...</div>;
    }
    
    // player가 확실히 존재하므로 안전하게 접근 가능
    // 하지만 경기 종료 시점에 player 객체의 속성이 예상치 못하게 변경될 수 있으므로
    // 모든 접근을 안전하게 처리
    const playerId = player?.id;
    const playerNickname = player?.nickname;
    const playerCondition = (player?.condition !== undefined && player?.condition !== null) ? player.condition : 1000;
    
    // 모든 필수 값이 유효한지 확인
    if (!playerId || !playerNickname) {
        return <div className="p-2 text-center text-gray-500 flex items-center justify-center h-full bg-gray-900/50 rounded-lg">선수 정보를 불러올 수 없습니다.</div>;
    }
    
    return (
        <div className={`bg-gray-900/50 p-1.5 md:p-2 rounded-lg flex flex-col gap-0.5 md:gap-1 h-full min-h-0 ${isClickable ? 'cursor-pointer hover:bg-gray-700/50' : ''}`} onClick={isClickable ? () => onViewUser(playerId) : undefined} title={isClickable ? `${playerNickname} 프로필 보기` : ''} style={{ maxHeight: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
            <div className="flex items-center gap-1 md:gap-2 w-full flex-shrink-0">
                {leagueInfo && (
                    <img
                        key={`league-${playerId}-${leagueInfo.tier}`}
                        src={leagueInfo.icon}
                        alt={leagueInfo.name}
                        className="w-6 h-6 md:w-9 md:h-9 object-contain drop-shadow-lg"
                        loading="lazy"
                    />
                )}
                 <Avatar key={`avatar-${playerId}`} userId={playerId} userName={playerNickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={isMobile ? 24 : 32} className={`${isMobile ? 'w-6 h-6' : 'md:w-10 md:h-10'} flex-shrink-0`} />
                 <div className="min-w-0 flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1 md:gap-1.5">
                        <h4 className={`font-bold ${isMobile ? 'text-[10px]' : 'text-xs md:text-base'} truncate`}>{playerNickname}</h4>
                        <span className={`${isMobile ? 'text-[8px]' : 'text-[10px] md:text-xs'} text-blue-300 font-semibold whitespace-nowrap`}>바둑능력: {totalAbilityScore}</span>
                    </div>
                    <p className={`${isMobile ? 'text-[8px]' : 'text-[10px] md:text-xs'} text-gray-400 truncate`}>({cumulativeStats.wins}승 {cumulativeStats.losses}패)</p>
                 </div>
            </div>
            {/* 컨디션 표시 영역 - 항상 동일한 공간 유지 (경기 종료 후에는 숨김) */}
            <div className={`font-bold ${isMobile ? 'text-[8px]' : 'text-xs md:text-sm'} mt-0 relative flex items-center gap-1 md:gap-2 w-full justify-center flex-shrink-0`} style={{ 
                visibility: (tournamentStatus === 'round_in_progress' || tournamentStatus === 'bracket_ready') ? 'visible' : 'hidden',
                height: (tournamentStatus === 'round_in_progress' || tournamentStatus === 'bracket_ready') ? 'auto' : '1.25rem',
                minHeight: '1.25rem'
            }}>
                <span className={isMobile ? 'text-[8px]' : 'text-[10px] md:text-sm'}>컨디션:</span> 
                <span className={`text-yellow-300 ${isMobile ? 'text-[8px]' : 'text-xs md:text-sm'} relative transition-all duration-300 ${
                    showConditionIncrease ? 'scale-125 text-green-300' : ''
                }`}>
                    {playerCondition === 1000 ? '-' : playerCondition}
                </span>
                {showConditionIncrease && conditionIncreaseAmount > 0 && (
                    <span className={`absolute ${isMobile ? 'text-[10px]' : 'text-sm md:text-base'} font-bold text-green-400 pointer-events-none whitespace-nowrap ${
                        isMobile ? 'top-[-12px]' : 'top-[-16px] md:top-[-20px]'
                    }`} style={{
                        animation: 'fadeUp 2s ease-out forwards',
                        textShadow: '0 0 8px rgba(34, 197, 94, 0.8)'
                    }}>
                        +{conditionIncreaseAmount}
                    </span>
                )}
                {/* 회복제 사용 버튼 (현재 유저이고, bracket_ready 상태일 때만 표시, 컨디션이 100이면 비활성화) */}
                {isCurrentUser && isUserMatch && tournamentStatus === 'bracket_ready' && totalPotionCount > 0 && onUseConditionPotion && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (playerCondition >= 100) return; // 컨디션이 100이면 클릭 무시
                            onUseConditionPotion();
                        }}
                        disabled={playerCondition >= 100}
                        className={`ml-1 md:ml-2 ${isMobile ? 'text-[7px] px-1 py-0.5' : 'text-[9px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1'} ${playerCondition >= 100 ? 'bg-gray-600 cursor-not-allowed opacity-50' : 'bg-green-600 hover:bg-green-700'} text-white rounded transition-colors flex-shrink-0`}
                        title={playerCondition >= 100 ? "컨디션이 이미 최대입니다" : "컨디션 회복제 사용"}
                    >
                        회복제
                    </button>
                )}
            </div>
            <div className={`w-full grid grid-cols-2 md:grid-cols-4 gap-x-0.5 md:gap-x-1 lg:gap-x-3 gap-y-0.5 ${isMobile ? 'text-[8px]' : 'text-[10px] md:text-xs'} mt-0 border-t border-gray-600 pt-0.5 flex-shrink-0 overflow-hidden`}>
                {Object.values(CoreStat).map(stat => {
                    try {
                        // 초기값: initialPlayer가 있으면 그것을 사용, 없으면 initialStats 사용
                        // player가 null이 아니지만 안전성을 위해 옵셔널 체이닝 사용
                        const initialValue = tournamentStatus === 'round_in_progress' 
                            ? (initialPlayer?.stats?.[stat] ?? initialStats[stat] ?? player?.originalStats?.[stat] ?? displayStats?.[stat] ?? 0)
                            : (displayStats?.[stat] ?? 0);
                        const currentValue = displayStats?.[stat] ?? 0;
                        const change = tournamentStatus === 'round_in_progress' ? (currentValue - initialValue) : 0;

                    return (
                        <React.Fragment key={stat}>
                            <span className={`text-gray-400 truncate whitespace-nowrap ${isStatHighlighted(stat) ? 'text-yellow-400 font-bold' : ''}`}>{stat}</span>
                            <div className="flex justify-end items-baseline relative min-w-0">
                                <span className={`font-mono text-white ${isStatHighlighted(stat) ? 'text-yellow-400 font-bold' : ''} ${isMobile ? 'min-w-[20px] text-[8px]' : 'min-w-[25px] sm:min-w-[30px] md:min-w-[40px] text-right text-[9px] sm:text-[10px] md:text-xs'} whitespace-nowrap`}>{currentValue}</span>
                                {/* [N]: 항상 보이는 누적된 변화값 (초기값 대비 현재까지 누적된 변화) */}
                                <span className={`ml-0.5 md:ml-1 font-bold ${isMobile ? 'text-[7px] min-w-[22px]' : 'text-[8px] sm:text-[9px] md:text-xs min-w-[28px] sm:min-w-[35px] md:min-w-[45px]'} text-right whitespace-nowrap`}>
                                    {tournamentStatus === 'round_in_progress' && change !== 0 ? (
                                        <span className={`${change > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            [{change > 0 ? '+' : ''}{change}]
                                        </span>
                                    ) : null}
                                </span>
                                {/* (N): 1초마다 발생한 즉각적인 변화값을 잠시 보여주는 용도 (애니메이션으로 사라짐) */}
                                {/* 애니메이션이 레이아웃에 영향을 주지 않도록 absolute positioning 사용 및 고정 공간 확보 */}
                                <span className="ml-0.5 md:ml-1 font-bold text-[9px] sm:text-[10px] md:text-sm min-w-[32px] sm:min-w-[40px] md:min-w-[50px] text-right relative">
                                    <span 
                                        className="absolute right-0 top-0 whitespace-nowrap"
                                        style={{ 
                                            animation: statChanges[stat] !== undefined && statChanges[stat] !== 0 && tournamentStatus === 'round_in_progress' ? 'statChangeFade 2s ease-out forwards' : 'none',
                                            opacity: statChanges[stat] !== undefined && statChanges[stat] !== 0 && tournamentStatus === 'round_in_progress' ? 1 : 0,
                                            pointerEvents: 'none' // 클릭 이벤트 방지
                                        }}
                                    >
                                        {statChanges[stat] !== undefined && statChanges[stat] !== 0 && tournamentStatus === 'round_in_progress' ? (
                                            <span className={`text-[9px] sm:text-[10px] md:text-sm ${statChanges[stat] > 0 ? 'text-green-300' : 'text-red-300'}`}>
                                                ({statChanges[stat] > 0 ? '+' : ''}{statChanges[stat]})
                                            </span>
                                        ) : null}
                                    </span>
                                    {/* 공간 확보를 위한 투명한 플레이스홀더 */}
                                    <span className="invisible whitespace-nowrap text-[9px] sm:text-[10px] md:text-sm">
                                        (+99)
                                    </span>
                                </span>
                                </div>
                            </React.Fragment>
                        );
                    } catch (error) {
                        if (import.meta.env.DEV) {
                            console.error(`[PlayerProfilePanel] Error rendering stat ${stat}:`, error);
                        }
                        return (
                            <React.Fragment key={stat}>
                                <span className="text-gray-400 truncate whitespace-nowrap">{stat}</span>
                                <div className="flex justify-end items-baseline relative min-w-0">
                                    <span className="font-mono text-white">-</span>
                                </div>
                            </React.Fragment>
                        );
                    }
                })}
            </div>
            {/* 초반/중반/종반 능력치 표시 */}
            {phaseStats && typeof phaseStats === 'object' && (
                <div className="w-full border-t border-gray-600 mt-0 pt-0.5 flex-shrink-0">
                    <div className={`grid grid-cols-3 gap-0.5 md:gap-1 ${isMobile ? 'text-[8px]' : 'text-[9px] md:text-xs'}`}>
                        <div className={`bg-blue-900/30 rounded ${isMobile ? 'px-0.5 py-0.5' : 'px-1 py-0.5'} text-center border border-blue-700/50`}>
                            <div className={`text-gray-300 font-semibold ${isMobile ? 'mb-0' : 'mb-0'}`}>초반능력</div>
                            <div className={`text-blue-300 font-bold ${isMobile ? 'text-[8px]' : 'text-[10px] md:text-sm'}`}>{phaseStats?.early ?? 0}</div>
                        </div>
                        <div className={`bg-purple-900/30 rounded ${isMobile ? 'px-0.5 py-0.5' : 'px-1 py-0.5'} text-center border border-purple-700/50`}>
                            <div className={`text-gray-300 font-semibold ${isMobile ? 'mb-0' : 'mb-0'}`}>중반능력</div>
                            <div className={`text-purple-300 font-bold ${isMobile ? 'text-[8px]' : 'text-[10px] md:text-sm'}`}>{phaseStats?.mid ?? 0}</div>
                        </div>
                        <div className={`bg-orange-900/30 rounded ${isMobile ? 'px-0.5 py-0.5' : 'px-1 py-0.5'} text-center border border-orange-700/50`}>
                            <div className={`text-gray-300 font-semibold ${isMobile ? 'mb-0' : 'mb-0'}`}>종반능력</div>
                            <div className={`text-orange-300 font-bold ${isMobile ? 'text-[8px]' : 'text-[10px] md:text-sm'}`}>{phaseStats?.end ?? 0}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const SimulationProgressBar: React.FC<{ timeElapsed: number; totalDuration: number }> = ({ timeElapsed, totalDuration }) => {
    const progress = (timeElapsed / totalDuration) * 100;
    // totalDuration에 맞게 동적으로 계산 (초반 15초, 중반 20초, 종반 15초 비율 유지)
    const EARLY_GAME_DURATION = 15;
    const MID_GAME_DURATION = 20;
    const END_GAME_DURATION = 15;
    const BASE_TOTAL = EARLY_GAME_DURATION + MID_GAME_DURATION + END_GAME_DURATION; // 50
    
    // totalDuration이 BASE_TOTAL과 다를 경우 비율로 스케일링
    const earlyDuration = (EARLY_GAME_DURATION / BASE_TOTAL) * totalDuration;
    const midDuration = (MID_GAME_DURATION / BASE_TOTAL) * totalDuration;
    const endDuration = (END_GAME_DURATION / BASE_TOTAL) * totalDuration;
    
    const earlyStage = Math.min(progress, (earlyDuration / totalDuration) * 100);
    const midStage = Math.min(Math.max(0, progress - (earlyDuration / totalDuration) * 100), (midDuration / totalDuration) * 100);
    const endStage = Math.min(Math.max(0, progress - ((earlyDuration + midDuration) / totalDuration) * 100), (endDuration / totalDuration) * 100);

    return (
        <div>
            <div className="w-full bg-gray-900 rounded-full h-2 flex border border-gray-600 overflow-hidden">
                <div 
                    className="bg-green-500 h-full rounded-l-full transition-all duration-1000 ease-linear" 
                    style={{ width: `${earlyStage}%` }} 
                    title="초반전"
                ></div>
                <div 
                    className="bg-yellow-500 h-full transition-all duration-1000 ease-linear" 
                    style={{ width: `${midStage}%` }} 
                    title="중반전"
                ></div>
                <div 
                    className="bg-red-500 h-full rounded-r-full transition-all duration-1000 ease-linear" 
                    style={{ width: `${endStage}%` }} 
                    title="끝내기"
                ></div>
            </div>
            <div className="flex text-xs text-gray-400 mt-1">
                <div style={{ width: `${(earlyDuration / totalDuration) * 100}%` }}>초반</div>
                <div style={{ width: `${(midDuration / totalDuration) * 100}%` }} className="text-center">중반</div>
                <div style={{ width: `${(endDuration / totalDuration) * 100}%` }} className="text-right">종반</div>
            </div>
        </div>
    );
};

const ScoreGraph: React.FC<{ 
    p1Percent: number; 
    p2Percent: number; 
    p1Nickname?: string; 
    p2Nickname?: string; 
    p1Cumulative?: number; 
    p2Cumulative?: number; 
    p1Player?: PlayerForTournament | null; 
    p2Player?: PlayerForTournament | null; 
    lastScoreIncrement?: { 
        player1: { base: number; actual: number; isCritical: boolean } | null; 
        player2: { base: number; actual: number; isCritical: boolean } | null; 
    } | null;
}> = ({ p1Percent, p2Percent, p1Nickname, p2Nickname, p1Cumulative = 0, p2Cumulative = 0, p1Player, p2Player, lastScoreIncrement }) => {
    const [p1Animations, setP1Animations] = useState<Array<{ value: number; isCritical: boolean; key: string }>>([]);
    const [p2Animations, setP2Animations] = useState<Array<{ value: number; isCritical: boolean; key: string }>>([]);
    const [p1DisplayScore, setP1DisplayScore] = useState(p1Cumulative);
    const [p2DisplayScore, setP2DisplayScore] = useState(p2Cumulative);
    const prevP1ValueRef = useRef<string | null>(null); // 중복 방지를 위한 키 저장
    const prevP2ValueRef = useRef<string | null>(null); // 중복 방지를 위한 키 저장
    const scoreBoardRef = useRef<HTMLDivElement>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const p1GraphProfileRef = useRef<HTMLDivElement>(null); // 그래프 내부의 프로필 참조
    const p2GraphProfileRef = useRef<HTMLDivElement>(null); // 그래프 내부의 프로필 참조
    const isFirstMountP1Ref = useRef(true);
    const isFirstMountP2Ref = useRef(true);
    const timeoutRefsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
    const p1AnimationFrameRef = useRef<number | null>(null);
    const p2AnimationFrameRef = useRef<number | null>(null);
    const p1AnimationStartRef = useRef<number | null>(null);
    const p2AnimationStartRef = useRef<number | null>(null);
    const lastAnimationTimeRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 });
    
    // 아바타 URL 계산
    const p1AvatarUrl = useMemo(() => p1Player ? AVATAR_POOL.find(a => a.id === p1Player.avatarId)?.url : undefined, [p1Player?.avatarId]);
    const p1BorderUrl = useMemo(() => p1Player ? BORDER_POOL.find(b => b.id === p1Player.borderId)?.url : undefined, [p1Player?.borderId]);
    const p2AvatarUrl = useMemo(() => p2Player ? AVATAR_POOL.find(a => a.id === p2Player.avatarId)?.url : undefined, [p2Player?.avatarId]);
    const p2BorderUrl = useMemo(() => p2Player ? BORDER_POOL.find(b => b.id === p2Player.borderId)?.url : undefined, [p2Player?.borderId]);
    
    // 점수 숫자 애니메이션 (스코어보드에 더해질 때)
    useEffect(() => {
        // 초기화 시에는 즉시 설정 (애니메이션 없이)
        if (p1AnimationStartRef.current === null) {
            p1AnimationStartRef.current = p1Cumulative;
            setP1DisplayScore(p1Cumulative);
            return;
        }
        
        const duration = 500; // 0.5초 동안 증가
        const startScore = p1AnimationStartRef.current;
        const targetScore = p1Cumulative;
        const difference = targetScore - startScore;
        
        if (Math.abs(difference) < 0.01) return;
        
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // easeOutCubic 함수 사용
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            const currentScore = Math.round(startScore + difference * easedProgress);
            
            setP1DisplayScore(currentScore);
            
            if (progress < 1) {
                p1AnimationFrameRef.current = requestAnimationFrame(animate);
            } else {
                setP1DisplayScore(targetScore);
                p1AnimationStartRef.current = targetScore;
            }
        };
        
        // 기존 애니메이션 취소
        if (p1AnimationFrameRef.current !== null) {
            cancelAnimationFrame(p1AnimationFrameRef.current);
        }
        
        animate();
        
        return () => {
            if (p1AnimationFrameRef.current !== null) {
                cancelAnimationFrame(p1AnimationFrameRef.current);
            }
        };
    }, [p1Cumulative]);
    
    useEffect(() => {
        // 초기화 시에는 즉시 설정 (애니메이션 없이)
        if (p2AnimationStartRef.current === null) {
            p2AnimationStartRef.current = p2Cumulative;
            setP2DisplayScore(p2Cumulative);
            return;
        }
        
        const duration = 500;
        const startScore = p2AnimationStartRef.current;
        const targetScore = p2Cumulative;
        const difference = targetScore - startScore;
        
        if (Math.abs(difference) < 0.01) return;
        
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            const currentScore = Math.round(startScore + difference * easedProgress);
            
            setP2DisplayScore(currentScore);
            
            if (progress < 1) {
                p2AnimationFrameRef.current = requestAnimationFrame(animate);
            } else {
                setP2DisplayScore(targetScore);
                p2AnimationStartRef.current = targetScore;
            }
        };
        
        // 기존 애니메이션 취소
        if (p2AnimationFrameRef.current !== null) {
            cancelAnimationFrame(p2AnimationFrameRef.current);
        }
        
        animate();
        
        return () => {
            if (p2AnimationFrameRef.current !== null) {
                cancelAnimationFrame(p2AnimationFrameRef.current);
            }
        };
    }, [p2Cumulative]);
    
    // lastScoreIncrement가 변경되면 애니메이션 트리거 (스코어보드 양쪽에서 나타남)
    useEffect(() => {
        if (isFirstMountP1Ref.current) {
            // 첫 마운트 시에는 현재 값 저장만 하고 애니메이션 트리거하지 않음
            if (lastScoreIncrement?.player1) {
                prevP1ValueRef.current = `${lastScoreIncrement.player1.actual}-${lastScoreIncrement.player1.isCritical}`;
            }
            isFirstMountP1Ref.current = false;
            return;
        }
        
        // lastScoreIncrement.player1이 있고, 값이 0보다 크면 애니메이션 트리거
        // 1초마다 한 번만 트리거 (중복 방지)
        if (lastScoreIncrement?.player1 && lastScoreIncrement.player1.actual > 0) {
            const now = Date.now();
            const timeSinceLastAnimation = now - lastAnimationTimeRef.current.p1;
            
            // 1초 이상 경과했거나, 이전 값과 다르면 새로운 애니메이션 트리거
            const increment = lastScoreIncrement.player1.actual;
            const isCritical = lastScoreIncrement.player1.isCritical;
            const currentKey = `${increment}-${isCritical}`;
            
            if (timeSinceLastAnimation >= 1000 || prevP1ValueRef.current !== currentKey) {
                const animationKey = `p1-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                const newAnimation = { 
                    value: increment, // 증가량 표시
                    isCritical: isCritical,
                    key: animationKey
                };
                
                setP1Animations(prev => [...prev, newAnimation]);
                prevP1ValueRef.current = currentKey;
                lastAnimationTimeRef.current.p1 = now;
                
                // 1초 후 애니메이션 제거
                const timeoutId = setTimeout(() => {
                    setP1Animations(prev => prev.filter(anim => anim.key !== animationKey));
                }, 1000);
                
                timeoutRefsRef.current.push(timeoutId);
            }
        } else if (!lastScoreIncrement?.player1) {
            // 점수 증가가 없으면 prevP1ValueRef 초기화
            prevP1ValueRef.current = null;
        }
    }, [lastScoreIncrement?.player1]);
    
    // lastScoreIncrement가 변경되면 애니메이션 트리거 (스코어보드 양쪽에서 나타남)
    useEffect(() => {
        if (isFirstMountP2Ref.current) {
            // 첫 마운트 시에는 현재 값 저장만 하고 애니메이션 트리거하지 않음
            if (lastScoreIncrement?.player2) {
                prevP2ValueRef.current = `${lastScoreIncrement.player2.actual}-${lastScoreIncrement.player2.isCritical}`;
            }
            isFirstMountP2Ref.current = false;
            return;
        }
        
        // lastScoreIncrement.player2가 있고, 값이 0보다 크면 애니메이션 트리거
        // 1초마다 한 번만 트리거 (중복 방지)
        if (lastScoreIncrement?.player2 && lastScoreIncrement.player2.actual > 0) {
            const now = Date.now();
            const timeSinceLastAnimation = now - lastAnimationTimeRef.current.p2;
            
            // 1초 이상 경과했거나, 이전 값과 다르면 새로운 애니메이션 트리거
            const increment = lastScoreIncrement.player2.actual;
            const isCritical = lastScoreIncrement.player2.isCritical;
            const currentKey = `${increment}-${isCritical}`;
            
            if (timeSinceLastAnimation >= 1000 || prevP2ValueRef.current !== currentKey) {
                const animationKey = `p2-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                const newAnimation = { 
                    value: increment, // 증가량 표시
                    isCritical: isCritical,
                    key: animationKey
                };
                
                setP2Animations(prev => [...prev, newAnimation]);
                prevP2ValueRef.current = currentKey;
                lastAnimationTimeRef.current.p2 = now;
                
                // 1초 후 애니메이션 제거
                const timeoutId = setTimeout(() => {
                    setP2Animations(prev => prev.filter(anim => anim.key !== animationKey));
                }, 1000);
                
                timeoutRefsRef.current.push(timeoutId);
            }
        } else if (!lastScoreIncrement?.player2) {
            // 점수 증가가 없으면 prevP2ValueRef 초기화
            prevP2ValueRef.current = null;
        }
    }, [lastScoreIncrement?.player2]);
    
    // 컴포넌트 언마운트 시 모든 timeout 정리
    useEffect(() => {
        return () => {
            timeoutRefsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
            timeoutRefsRef.current = [];
            if (p1AnimationFrameRef.current !== null) {
                cancelAnimationFrame(p1AnimationFrameRef.current);
            }
            if (p2AnimationFrameRef.current !== null) {
                cancelAnimationFrame(p2AnimationFrameRef.current);
            }
        };
    }, []);
    
    // 공유 애니메이션 스타일 (한 번만 추가)
    useEffect(() => {
        if (typeof document !== 'undefined' && !document.getElementById('score-popup-animation')) {
            const style = document.createElement('style');
            style.id = 'score-popup-animation';
            style.textContent = `
                @keyframes scorePopUp {
                    0% {
                        opacity: 0;
                        transform: translateY(-50%) translateY(-10px) scale(0.8);
                    }
                    20% {
                        opacity: 1;
                        transform: translateY(-50%) translateY(0) scale(1.1);
                    }
                    80% {
                        opacity: 1;
                        transform: translateY(-50%) translateY(0) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translateY(-50%) translateY(-10px) scale(0.8);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        return () => {
            // 컴포넌트 언마운트 시 스타일 제거하지 않음 (다른 인스턴스에서 사용할 수 있음)
        };
    }, []);
    
    return (
        <div ref={graphContainerRef} className="relative w-full">
            {/* 프로필과 스코어 보드 */}
            <div className="relative mb-3">
                {/* 양쪽 끝 프로필과 중앙 스코어 보드 */}
                <div className="flex items-center justify-between gap-2 mb-2">
                    {/* 왼쪽 프로필 (흑) */}
                    <div ref={p1GraphProfileRef} className="flex items-center gap-2 flex-shrink-0">
                        {p1Player && (
                            <>
                                <Avatar userId={p1Player.id} userName={p1Nickname || ''} avatarUrl={p1AvatarUrl} borderUrl={p1BorderUrl} size={40} />
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-gray-200 truncate">흑: {p1Nickname}</div>
                                </div>
                            </>
                        )}
                    </div>
                    
                    {/* 중앙 스코어 보드 */}
                    <div className="flex-1 flex justify-center items-center min-w-0 mx-2 relative" style={{ minHeight: '60px' }}>
                        <div 
                            ref={scoreBoardRef}
                            className="bg-gray-900/95 border-2 border-yellow-500/50 rounded-lg px-4 py-2 shadow-lg shadow-yellow-500/30 relative z-20"
                            style={{ overflow: 'visible' }}
                        >
                            <div className="flex items-center gap-4">
                                {/* 플레이어 1 점수 */}
                                <div className="text-center min-w-[70px]" data-player="p1">
                                    <div className="text-xs text-gray-400 mb-0.5">흑</div>
                                    <div className="text-lg font-bold text-white">
                                        <span className="tabular-nums">{Math.round(p1DisplayScore)}</span>
                                        <span className="text-xs text-gray-400 ml-1">({p1Percent.toFixed(1)}%)</span>
                                    </div>
                                </div>
                                
                                {/* 구분선 */}
                                <div className="w-px h-8 bg-gray-600"></div>
                                
                                {/* 플레이어 2 점수 */}
                                <div className="text-center min-w-[70px]" data-player="p2">
                                    <div className="text-xs text-gray-400 mb-0.5">백</div>
                                    <div className="text-lg font-bold text-white">
                                        <span className="tabular-nums">{Math.round(p2DisplayScore)}</span>
                                        <span className="text-xs text-gray-400 ml-1">({p2Percent.toFixed(1)}%)</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 점수 상승 애니메이션 (스코어보드 왼쪽) */}
                            {p1Animations.map((animation) => (
                                <div
                                    key={`p1-${animation.key}`}
                                    className="absolute pointer-events-none z-[15] whitespace-nowrap"
                                    style={{
                                        right: '100%',
                                        marginRight: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        animation: 'scorePopUp 1s ease-out forwards',
                                    }}
                                >
                                    <div className={`px-2 py-1 rounded-lg ${
                                        animation.isCritical 
                                            ? 'bg-black border-2 border-yellow-400 shadow-lg shadow-yellow-500/50' 
                                            : 'bg-black border-2 border-gray-600 shadow-lg'
                                    }`}>
                                        <span className={`font-bold text-sm ${
                                            animation.isCritical 
                                                ? 'text-yellow-300 animate-pulse' 
                                                : 'text-white'
                                        }`}>
                                            {animation.isCritical ? `+${Math.round(animation.value)}!` : `+${Math.round(animation.value)}`}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            
                            {/* 점수 상승 애니메이션 (스코어보드 오른쪽) */}
                            {p2Animations.map((animation) => (
                                <div
                                    key={`p2-${animation.key}`}
                                    className="absolute pointer-events-none z-[15] whitespace-nowrap"
                                    style={{
                                        left: '100%',
                                        marginLeft: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        animation: 'scorePopUp 1s ease-out forwards',
                                    }}
                                >
                                    <div className={`px-2 py-1 rounded-lg ${
                                        animation.isCritical 
                                            ? 'bg-white border-2 border-red-500 shadow-lg shadow-red-500/50' 
                                            : 'bg-white border-2 border-gray-400 shadow-lg'
                                    }`}>
                                        <span className={`font-bold text-sm ${
                                            animation.isCritical 
                                                ? 'text-red-600 animate-pulse' 
                                                : 'text-black'
                                        }`}>
                                            {animation.isCritical ? `+${Math.round(animation.value)}!` : `+${Math.round(animation.value)}`}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* 오른쪽 프로필 (백) */}
                    <div ref={p2GraphProfileRef} className="flex items-center gap-2 flex-shrink-0">
                        {p2Player && (
                            <>
                                <div className="min-w-0 text-right">
                                    <div className="text-xs font-bold text-gray-200 truncate">백: {p2Nickname}</div>
                                </div>
                                <Avatar userId={p2Player.id} userName={p2Nickname || ''} avatarUrl={p2AvatarUrl} borderUrl={p2BorderUrl} size={40} />
                            </>
                        )}
                    </div>
                </div>
                
                {/* 그래프 바 */}
                <div className="flex w-full h-3 bg-gray-700 rounded-full overflow-hidden border-2 border-black/30 relative">
                    <div className="bg-black transition-all duration-500 ease-in-out" style={{ width: `${p1Percent}%` }}></div>
                    <div className="bg-white transition-all duration-500 ease-in-out" style={{ width: `${p2Percent}%` }}></div>
                    <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-gray-400/50" title="중앙"></div>
                </div>
            </div>
            
        </div>
    );
};

const parseCommentary = (commentaryLine: CommentaryLine) => {
    const { text, isRandomEvent } = commentaryLine;
    
    // 초반전/중반전/종반전 시작 메시지에만 색상 적용 (정확한 텍스트 매칭)
    let phaseColorClass = '';
    if (text === '초반전이 시작되었습니다. (필요능력치: 전투력, 사고속도, 집중력)') {
        phaseColorClass = 'text-green-400'; // 초록색
    } else if (text === '중반전이 시작되었습니다. (필요능력치: 전투력, 판단력, 집중력, 안정감)') {
        phaseColorClass = 'text-yellow-400'; // 노란색
    } else if (text === '종반전이 시작되었습니다. (필요능력치: 계산력, 안정감, 집중력)') {
        phaseColorClass = 'text-red-400'; // 빨간색
    }
    
    if (text.startsWith('최종 결과 발표!') || text.startsWith('[최종결과]')) {
        return <strong className="text-yellow-400">{text}</strong>;
    }
    
    const leadRegex = /(\d+\.\d+집|\d+\.5집)/g;
    const parts = text.split(leadRegex);
    
    // phase 시작 메시지에만 색상 적용, 그 외는 기본 색상
    const baseColorClass = phaseColorClass || (isRandomEvent ? 'text-cyan-400' : '');
    
    return (
        <span className={baseColorClass}>
            {parts.map((part, index) => 
                leadRegex.test(part) ? (
                    <strong key={index} className="text-yellow-400">{part}</strong>
                ) : (
                    <span key={index}>{part}</span>
                )
            )}
        </span>
    );
};

const CommentaryPanel: React.FC<{ commentary: CommentaryLine[], isSimulating: boolean }> = ({ commentary, isSimulating }) => {
    const commentaryContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (commentaryContainerRef.current) {
            commentaryContainerRef.current.scrollTop = commentaryContainerRef.current.scrollHeight;
        }
    }, [commentary]);

    return (
        <div className="h-full flex flex-col min-h-0" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h4 className="text-center font-bold text-sm mb-2 text-gray-400 py-1 flex-shrink-0">
                실시간 중계
                {isSimulating && <span className="ml-2 text-yellow-400 animate-pulse">경기 진행 중...</span>}
            </h4>
            <div 
                ref={commentaryContainerRef} 
                className="flex-1 min-h-0 overflow-y-auto space-y-2 text-sm text-gray-300 p-2 bg-gray-900/40 rounded-md"
                style={{ 
                    overflowY: 'auto', 
                    WebkitOverflowScrolling: 'touch',
                    flex: '1 1 0',
                    minHeight: 0,
                    maxHeight: '100%'
                }}
            >
                {commentary.length > 0 ? (
                    commentary.map((line, index) => <p key={index} className="animate-fade-in break-words">{parseCommentary(line)}</p>)
                ) : (
                    <p className="text-gray-500 text-center h-full flex items-center justify-center">경기 시작 대기 중...</p>
                )}
            </div>
        </div>
    );
};

const FinalRewardPanel: React.FC<{ tournamentState: TournamentState; currentUser: UserWithStatus; onAction: (action: ServerAction) => void }> = ({ tournamentState, currentUser, onAction }) => {
    const { type, rounds } = tournamentState;
    
    // 모든 경기가 완료되었는지 확인
    const allMatchesFinished = rounds.every(r => r.matches.every(m => m.isFinished));
    
    // 토너먼트가 완전히 완료되었는지 확인 (status가 complete이거나, 모든 경기가 완료된 경우)
    const isTournamentFullyComplete = tournamentState.status === 'complete' || (allMatchesFinished && tournamentState.status !== 'round_in_progress');
    const isUserEliminated = tournamentState.status === 'eliminated';
    const isInProgress = tournamentState.status === 'round_in_progress' || tournamentState.status === 'bracket_ready';
    const isRoundComplete = tournamentState.status === 'round_complete';
    const definition = TOURNAMENT_DEFINITIONS[type];
    const rewardInfo = BASE_TOURNAMENT_REWARDS[type];
    
    // 현재 순위 계산 (경기 진행 중에도 업데이트)
    let userRank = -1;

    if (type === 'neighborhood') {
        const wins: Record<string, number> = {};
        tournamentState.players.forEach(p => { wins[p.id] = 0; });

        rounds[0].matches.forEach(m => {
            if (m.winner) {
                wins[m.winner.id] = (wins[m.winner.id] || 0) + 1;
            }
        });

        const sortedPlayers = [...tournamentState.players].sort((a, b) => wins[b.id] - wins[a.id]);
        
        let currentRank = -1;
        for (let i = 0; i < sortedPlayers.length; i++) {
            if (i === 0) {
                currentRank = 1;
            } else {
                if (wins[sortedPlayers[i].id] < wins[sortedPlayers[i-1].id]) {
                    currentRank = i + 1;
                }
            }
            if (sortedPlayers[i].id === currentUser.id) {
                userRank = currentRank;
                break;
            }
        }
    } else {
        const totalRounds = rounds.length;
        let lostInRound = -1;
        
        for (let i = 0; i < totalRounds; i++) {
            const round = rounds[i];
            const userMatch = round.matches.find(m => m.isUserMatch);
            if (userMatch && userMatch.winner?.id !== currentUser.id) {
                lostInRound = i;
                break;
            }
        }

        if (lostInRound === -1) {
            userRank = 1; // Winner
        } else {
            const playersInLostRound = definition.players / Math.pow(2, lostInRound);
            if (totalRounds === 3 && lostInRound === 1) { // 8-player, lost in semis
                 const thirdPlaceMatch = rounds.find(r => r.name === "3,4위전");
                 if (thirdPlaceMatch) {
                     const userWasIn3rdPlaceMatch = thirdPlaceMatch.matches.some(m => m.isUserMatch);
                     if (userWasIn3rdPlaceMatch) {
                         const won3rdPlace = thirdPlaceMatch.matches.some(m => m.isUserMatch && m.winner?.id === currentUser.id);
                         userRank = won3rdPlace ? 3 : 4;
                     } else {
                         userRank = 4;
                     }
                 } else {
                     userRank = 4;
                 }
            } else {
                 userRank = playersInLostRound;
            }
        }
    }
    
    // 동네바둑리그: 누적 골드 표시 (경기 진행 중에도 표시)
    const accumulatedGold = tournamentState.type === 'neighborhood' ? (tournamentState.accumulatedGold || 0) : 0;
    
    // 전국바둑대회: 누적 재료 표시 (경기 진행 중에도 표시)
    const accumulatedMaterials = tournamentState.type === 'national' ? (tournamentState.accumulatedMaterials || {}) : {};
    
    // 월드챔피언십: 누적 장비상자 표시 (경기 진행 중에도 표시)
    const accumulatedEquipmentBoxes = tournamentState.type === 'world' ? (tournamentState.accumulatedEquipmentBoxes || {}) : {};
    
    // 랭킹 점수 계산 (현재 순위 기준, 경기 진행 중에도 표시)
    const scoreRewardInfo = TOURNAMENT_SCORE_REWARDS[type];
    let scoreRewardKey: number = 9; // 기본값 (최하위)
    if (userRank > 0) {
        if (type === 'neighborhood') {
            scoreRewardKey = userRank;
        } else if (type === 'national') {
            scoreRewardKey = userRank <= 4 ? userRank : 5;
        } else { // world
            if (userRank <= 4) scoreRewardKey = userRank;
            else if (userRank <= 8) scoreRewardKey = 5;
            else scoreRewardKey = 9;
        }
    }
    const scoreReward = scoreRewardInfo?.[scoreRewardKey] || 0;
    
    // 최종 순위 보상 (경기 종료 후에만 표시)
    let rewardKey: number;
    if (userRank > 0) {
        if (type === 'neighborhood') rewardKey = userRank <= 3 ? userRank : 4;
        else if (type === 'national') rewardKey = userRank <= 4 ? userRank : 5;
        else { // world
            if (userRank <= 4) rewardKey = userRank;
            else if (userRank <= 8) rewardKey = 5;
            else rewardKey = 9;
        }
    } else {
        rewardKey = type === 'neighborhood' ? 4 : type === 'national' ? 5 : 9;
    }
    
    const reward = rewardInfo?.rewards[rewardKey];
    const rewardClaimedKey = `${type}RewardClaimed` as keyof User;
    const isClaimed = !!currentUser[rewardClaimedKey];
    const canClaimReward = (isTournamentFullyComplete || isUserEliminated) && !isClaimed;

    const handleClaim = () => {
        if (canClaimReward) {
            audioService.claimReward();
            onAction({ type: 'CLAIM_TOURNAMENT_REWARD', payload: { tournamentType: type } });
        }
    };
    
    return (
        <div className="h-full flex flex-col min-h-0" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <h4 className="text-center font-bold text-sm mb-1 text-gray-400 py-0.5 flex-shrink-0">획득 보상</h4>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1 p-1.5 bg-gray-900/40 rounded-md" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: '1 1 0', minHeight: 0, maxHeight: '100%' }}>
            {/* 수령 완료 메시지 - 경기 종료 후에만 표시 */}
            {(isTournamentFullyComplete || isUserEliminated) && isClaimed && (
                <div className="mb-1 px-1.5 py-1 bg-green-900/30 rounded-lg border border-green-700/50">
                    <p className="text-[10px] text-green-400 text-center font-semibold">✓ 보상을 수령했습니다.</p>
                </div>
            )}
            
            {/* 경기 진행 중 안내 */}
            {isInProgress && (
                <div className="mb-1 px-1.5 py-1 bg-blue-900/30 rounded-lg border border-blue-700/50">
                    <p className="text-[10px] text-blue-400 text-center">경기 진행 중 - 누적 보상 표시</p>
                </div>
            )}
            
            {/* 랭킹 점수 (경기 진행 중에도 표시) */}
            {scoreReward > 0 && (
                <div className={`mb-1 bg-green-900/30 px-1.5 py-1 rounded-lg border border-green-700/50 ${isClaimed ? 'opacity-75' : ''}`}>
                    <div className="flex items-center gap-1.5">
                        <span className="text-base">🏆</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-green-300">랭킹 점수: +{scoreReward}점</div>
                            {userRank > 0 && (
                                <div className="text-[10px] text-gray-400">(현재 순위: {userRank}위)</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            {/* 누적 골드 (동네바둑리그, 경기 진행 중에도 표시) */}
            {accumulatedGold > 0 && (
                <div className={`mb-1 bg-yellow-900/30 px-1.5 py-1 rounded-lg border border-yellow-700/50 ${isClaimed ? 'opacity-75' : ''}`}>
                    <div className="flex items-center gap-1.5">
                        <img src="/images/icon/Gold.png" alt="골드" className="w-5 h-5 flex-shrink-0" loading="lazy" decoding="async" />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-yellow-300">경기 보상: {accumulatedGold.toLocaleString()} 골드</div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* 누적 재료 (전국바둑대회, 경기 진행 중에도 표시) */}
            {Object.keys(accumulatedMaterials).length > 0 && (
                <div className={`mb-1 ${isClaimed ? 'opacity-75' : ''}`}>
                    <div className="text-xs font-semibold text-blue-300 mb-1">
                        경기 보상 (재료):
                    </div>
                    <div className="flex flex-col gap-1">
                        {Object.entries(accumulatedMaterials).map(([materialName, quantity]) => {
                            const materialTemplate = MATERIAL_ITEMS[materialName];
                            const imageUrl = materialTemplate?.image || '';
                            return (
                                <div key={materialName} className="flex items-center gap-1.5 bg-blue-900/30 px-1.5 py-1 rounded-lg border border-blue-700/50">
                                    <img src={imageUrl} alt={materialName} className="w-5 h-5 flex-shrink-0" loading="lazy" decoding="async" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-blue-300 truncate">{materialName} x{quantity}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            {/* 누적 장비상자 (월드챔피언십, 경기 진행 중에도 표시) */}
            {Object.keys(accumulatedEquipmentBoxes).length > 0 && (
                <div className={`mb-1 ${isClaimed ? 'opacity-75' : ''}`}>
                    <div className="text-xs font-semibold text-purple-300 mb-1">
                        경기 보상 (장비상자):
                    </div>
                    <div className="flex flex-col gap-1">
                        {Object.entries(accumulatedEquipmentBoxes).map(([boxName, quantity]) => {
                            const boxTemplate = CONSUMABLE_ITEMS.find(i => i.name === boxName);
                            const imageUrl = boxTemplate?.image || '';
                            return (
                                <div key={boxName} className="flex items-center gap-1.5 bg-purple-900/30 px-1.5 py-1 rounded-lg border border-purple-700/50">
                                    <img src={imageUrl} alt={boxName} className="w-5 h-5 flex-shrink-0" loading="lazy" decoding="async" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-purple-300 truncate">{boxName} x{quantity}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            {/* 최종 순위 보상 (경기 종료 후 또는 보상 수령 후에도 표시) - 가로 막대 형태 */}
            {((isTournamentFullyComplete || isUserEliminated || isClaimed) && reward) && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="text-xs font-semibold text-gray-300 mb-1 text-center">최종 순위 보상</div>
                    <div className="flex flex-col gap-1">
                        {(reward.items || []).map((item, index) => {
                            const itemName = 'itemId' in item ? item.itemId : (item as any).name;
                            const itemTemplate = CONSUMABLE_ITEMS.find(i => i.name === itemName);
                            const imageUrl = itemTemplate?.image || '';
                            // 골드 꾸러미인지 다이아 꾸러미인지에 따라 색상 결정
                            const isGold = itemName.includes('골드');
                            const isDiamond = itemName.includes('다이아');
                            const bgColor = isGold ? 'bg-yellow-900/30' : isDiamond ? 'bg-blue-900/30' : 'bg-purple-900/30';
                            const borderColor = isGold ? 'border-yellow-700/50' : isDiamond ? 'border-blue-700/50' : 'border-purple-700/50';
                            const textColor = isGold ? 'text-yellow-300' : isDiamond ? 'text-blue-300' : 'text-purple-300';
                            
                            return (
                                <div key={index} className={`flex items-center gap-1.5 ${bgColor} px-1.5 py-1 rounded-lg border ${borderColor} ${isClaimed ? 'opacity-75' : ''}`}>
                                    <img src={imageUrl} alt={itemName} className="w-5 h-5 flex-shrink-0" loading="lazy" decoding="async" />
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-xs font-semibold ${textColor} truncate`}>{itemName} x{item.quantity}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            {/* 경기 진행 중이면서 최종 보상이 아직 없는 경우 */}
            {isInProgress && (!reward || (reward.items || []).length === 0) && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-[10px] text-gray-500 text-center">최종 순위 보상은 경기 종료 후 표시됩니다.</p>
                </div>
            )}
            
            {/* 보상이 하나도 없는 경우 */}
            {scoreReward === 0 && accumulatedGold === 0 && Object.keys(accumulatedMaterials).length === 0 && Object.keys(accumulatedEquipmentBoxes).length === 0 && (!reward || (reward.items || []).length === 0) && (
                <div className="flex items-center justify-center h-full">
                    <p className="text-[10px] text-gray-500 text-center">획득한 보상이 없습니다.</p>
                </div>
            )}
            </div>
            
            {/* 하단 보상받기 버튼 영역 */}
            <div className="flex-shrink-0 pt-1.5 border-t border-gray-700 mt-1.5">
                {/* 경기 종료 후 보상받기 버튼 */}
                {(isTournamentFullyComplete || isUserEliminated) && reward && (
                    <>
                        {isClaimed ? (
                            <button
                                disabled
                                className="w-full bg-green-600/50 text-green-300 py-1.5 px-3 rounded-lg font-semibold text-xs cursor-not-allowed opacity-75"
                            >
                                ✓ 보상 수령 완료
                            </button>
                        ) : (
                            <button
                                onClick={handleClaim}
                                disabled={!canClaimReward}
                                className={`w-full py-1.5 px-3 rounded-lg font-semibold text-xs transition-colors ${
                                    canClaimReward 
                                        ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer' 
                                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                }`}
                            >
                                {canClaimReward ? '보상받기' : '경기 종료 후 수령 가능'}
                            </button>
                        )}
                    </>
                )}
                
                {/* 경기 진행 중 또는 다음경기 버튼이 있을 때 안내 메시지 (보상 수령 전에만 표시) */}
                {(isInProgress || isRoundComplete) && !isClaimed && !((isTournamentFullyComplete || isUserEliminated) && reward) && (
                    <div className="w-full bg-blue-900/30 text-blue-300 py-1.5 px-3 rounded-lg font-semibold text-xs text-center border border-blue-700/50">
                        모든 경기 완료 후 보상수령
                    </div>
                )}
            </div>
        </div>
    );
};


const MatchBox: React.FC<{ match: Match; currentUser: UserWithStatus; tournamentState?: TournamentState }> = ({ match, currentUser, tournamentState }) => {
    const p1 = match.players[0];
    const p2 = match.players[1];

    // 사용자 진행상태 계산
    const getUserProgressStatus = (playerId: string): string | null => {
        if (playerId !== currentUser.id || !tournamentState) return null;
        
        const isNationalTournament = tournamentState.type === 'national';
        const isWorldTournament = tournamentState.type === 'world';
        
        if (isNationalTournament || isWorldTournament) {
            // 전국바둑대회/월드챔피언십: 토너먼트 형식 (N강 진출, 결승 진출 등)
            const currentRound = tournamentState.rounds.find(r => r.matches.some(m => m.id === match.id));
            if (!currentRound || !match.isFinished) return null;
            
            const isWinner = match.winner?.id === playerId;
            if (!isWinner) return null; // 패자는 표시하지 않음
            
            const roundName = currentRound.name;
            if (roundName === '16강') {
                return '8강 진출';
            } else if (roundName === '8강') {
                return '4강 진출';
            } else if (roundName === '4강') {
                return '결승 진출';
            } else if (roundName === '결승') {
                return '우승';
            } else if (roundName === '3,4위전') {
                return '3/4위전 진출';
            }
            return null;
        } else {
            // 동네바둑리그: 기존 형식
            const allUserMatches = tournamentState.rounds.flatMap(r => r.matches).filter(m => 
                m.isUserMatch && m.players.some(p => p?.id === playerId)
            );
            const finishedMatches = allUserMatches.filter(m => m.isFinished);
            const wins = finishedMatches.filter(m => m.winner?.id === playerId).length;
            const losses = finishedMatches.length - wins;
            
            if (finishedMatches.length === 0) return null;
            
            const lastMatch = finishedMatches[finishedMatches.length - 1];
            const lastMatchWon = lastMatch.winner?.id === playerId;
            const matchNumber = finishedMatches.length;
            
            return `${matchNumber}차전 ${lastMatchWon ? '승리' : '패배'}! (${wins}승 ${losses}패)`;
        }
    };

    // 결승전 우승자 확인
    const isFinalMatch = useMemo(() => {
        if (!tournamentState) return false;
        const finalRound = tournamentState.rounds.find(r => r.name === '결승');
        return finalRound?.matches.some(m => m.id === match.id) || false;
    }, [tournamentState, match.id]);
    
    const isTournamentComplete = tournamentState?.status === 'complete';

    const PlayerDisplay: React.FC<{ player: PlayerForTournament | null, isWinner: boolean }> = ({ player, isWinner }) => {
        const isNationalTournament = tournamentState?.type === 'national';
        const isWorldTournament = tournamentState?.type === 'world';
        const isTournamentFormat = isNationalTournament || isWorldTournament;
        
        if (!player) {
            return (
                <div className={`${isTournamentFormat ? 'h-16' : 'h-10'} flex items-center justify-center ${isTournamentFormat ? 'px-4' : 'px-2'}`}>
                    <span className={`text-gray-500 italic ${isTournamentFormat ? 'text-base' : 'text-sm'}`}>경기 대기중...</span>
                </div>
            );
        }
        
        const avatarUrl = AVATAR_POOL.find(a => a.id === player.avatarId)?.url;
        const borderUrl = BORDER_POOL.find(b => b.id === player.borderId)?.url;
        const progressStatus = getUserProgressStatus(player.id);
        const showTrophy = isFinalMatch && isTournamentComplete && isWinner && player.id === match.winner?.id && match.isFinished;

        if (isTournamentFormat) {
            // 전국바둑대회/월드챔피언십: 가로 배치용 컴팩트 레이아웃
            const winMarginText = isWinner && match.isFinished ? (() => {
                if (!match.finalScore) return '승';
                const p1Percent = match.finalScore.player1;
                const diffPercent = Math.abs(p1Percent - 50) * 2;
                const scoreDiff = diffPercent / 2;
                const roundedDiff = Math.round(scoreDiff);
                const finalDiff = roundedDiff + 0.5;
                const winMargin = finalDiff < 0.5 ? '0.5' : finalDiff.toFixed(1);
                return `${winMargin}집 승`;
            })() : null;
            
            return (
                <div className={`relative flex flex-col items-center justify-center ${isWinner ? 'px-3 py-2' : 'px-2 py-1.5'} rounded-lg transition-all ${
                    isWinner 
                        ? 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-400/50 shadow-lg shadow-yellow-500/20' 
                        : match.isFinished 
                            ? 'opacity-50' 
                            : 'hover:bg-gray-700/30'
                }`}>
                    {/* 승리 표시 오버레이 (우측 상단) */}
                    {match.isFinished && isWinner && (winMarginText || showTrophy) && (
                        <div className="absolute -top-2 -right-2 flex items-center gap-1 z-10">
                            {winMarginText && (
                                <span className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black font-bold text-[10px] px-1.5 py-0.5 rounded-full shadow-lg flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                                    <span>🏆</span>
                                    <span>{winMarginText}</span>
                                </span>
                            )}
                            {showTrophy && (
                                <img 
                                    key={`trophy-${player.id}-${match.id}`}
                                    src="/images/championship/Ranking.png" 
                                    alt="Trophy" 
                                    className="w-5 h-5 flex-shrink-0 drop-shadow-lg"
                                    loading="lazy"
                                    decoding="async"
                                />
                            )}
                        </div>
                    )}
                    
                    {/* Avatar */}
                    <div className="flex-shrink-0 mb-1.5">
                        <Avatar key={`avatar-${player.id}-${match.id}`} userId={player.id} userName={player.nickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={36} />
                    </div>
                    
                    {/* 텍스트 영역 */}
                    <div className="flex flex-col items-center justify-center gap-1 w-full min-w-0">
                        {/* 닉네임 */}
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                            <span className={`text-center font-semibold text-sm truncate ${
                                isWinner 
                                    ? 'text-yellow-300 font-bold' 
                                    : match.isFinished 
                                        ? 'text-gray-400' 
                                        : 'text-gray-200'
                            }`}>
                                {player.nickname}
                            </span>
                        </div>
                        
                        {/* 진행 상태 (전국바둑대회/월드챔피언십: 승자에게만 표시) */}
                        {progressStatus && (
                            <div className="text-yellow-400 font-semibold text-xs text-center break-words">
                                {progressStatus}
                            </div>
                        )}
                    </div>
                </div>
            );
        } else {
            // 동네바둑리그: 기본 레이아웃
            const winMargin = isWinner && match.isFinished ? (() => {
                if (!match.finalScore) return '';
                const p1Percent = match.finalScore.player1;
                const diffPercent = Math.abs(p1Percent - 50) * 2;
                const scoreDiff = diffPercent / 2;
                const roundedDiff = Math.round(scoreDiff);
                const finalDiff = roundedDiff + 0.5;
                const margin = finalDiff < 0.5 ? '0.5' : finalDiff.toFixed(1);
                return margin;
            })() : '';
            
            return (
                <div className={`relative flex items-center gap-2 ${isWinner ? 'px-2 py-2' : 'px-2 py-1.5'} rounded-md transition-all ${
                    isWinner 
                        ? 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-400/50 shadow-lg shadow-yellow-500/20' 
                        : match.isFinished 
                            ? 'opacity-50' 
                            : 'hover:bg-gray-700/30'
                }`}>
                    {/* 승리 표시 오버레이 (우측 상단) */}
                    {match.isFinished && isWinner && (winMargin || showTrophy) && (
                        <div className="absolute -top-2 -right-2 flex items-center gap-1 z-10">
                            {winMargin && (
                                <span className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black font-bold text-[10px] px-1.5 py-0.5 rounded-full shadow-lg flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                                    <span>🏆</span>
                                    <span>{winMargin}집 승</span>
                                </span>
                            )}
                            {showTrophy && (
                                <img 
                                    key={`trophy-${player.id}-${match.id}`}
                                    src="/images/championship/Ranking.png" 
                                    alt="Trophy" 
                                    className="w-5 h-5 flex-shrink-0 drop-shadow-lg"
                                    loading="lazy"
                                    decoding="async"
                                />
                            )}
                        </div>
                    )}
                    
                    <Avatar key={`avatar-${player.id}-${match.id}`} userId={player.id} userName={player.nickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={32} />
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                            <span className={`truncate font-semibold text-sm ${
                                isWinner 
                                    ? 'text-yellow-300 font-bold' 
                                    : match.isFinished 
                                        ? 'text-gray-400' 
                                        : 'text-gray-200'
                            }`}>
                                {player.nickname}
                            </span>
                        </div>
                        {progressStatus && (
                            <span className="text-yellow-400 font-semibold text-xs truncate">
                                {progressStatus}
                            </span>
                        )}
                    </div>
                </div>
            );
        }
    };
    
    const p1IsWinner = match.isFinished && match.winner?.id === p1?.id;
    const p2IsWinner = match.isFinished && match.winner?.id === p2?.id;
    const isMyMatch = p1?.id === currentUser.id || p2?.id === currentUser.id;
    const isFinished = match.isFinished;

    // finalScore에서 집 차이 계산 (finishMatch 함수의 로직과 동일)
    const calculateWinMargin = (): string => {
        if (!isFinished || !match.finalScore) return '';
        const p1Percent = match.finalScore.player1;
        const diffPercent = Math.abs(p1Percent - 50) * 2;
        const scoreDiff = diffPercent / 2;
        const roundedDiff = Math.round(scoreDiff);
        const finalDiff = roundedDiff + 0.5;
        return finalDiff < 0.5 ? '0.5' : finalDiff.toFixed(1);
    };

    const winMargin = calculateWinMargin();

    // 전국바둑대회/월드챔피언십인지 확인 (tournamentState의 type으로 판단)
    const isNationalTournament = tournamentState?.type === 'national';
    const isWorldTournament = tournamentState?.type === 'world';
    const isTournamentFormat = isNationalTournament || isWorldTournament;
    
    return (
        <div className={`relative w-full rounded-xl overflow-visible transition-all duration-300 ${
            isMyMatch 
                ? 'bg-gradient-to-br from-blue-900/60 via-blue-800/50 to-indigo-900/60 border-2 border-blue-500/70 shadow-lg shadow-blue-500/20' 
                : 'bg-gradient-to-br from-gray-800/80 via-gray-700/70 to-gray-800/80 border border-gray-600/50 shadow-md'
        } ${isFinished ? '' : 'hover:scale-[1.02] hover:shadow-xl'}`}>
            {/* 승리 배지 (동네바둑리그만 표시, 전국바둑대회/월드챔피언십은 PlayerDisplay에 표시) */}
            {isTournamentFormat ? (
                // 전국바둑대회/월드챔피언십: 가로 배치 (1번선수 vs 2번선수)
                <div className="p-3">
                    <div className="flex items-center justify-center gap-3">
                        <div className="flex-1 min-w-0 flex justify-center">
                            <PlayerDisplay player={p1} isWinner={p1IsWinner} />
                        </div>
                        {!isFinished && (
                            <div className="text-sm text-gray-400 font-semibold flex-shrink-0">VS</div>
                        )}
                        <div className="flex-1 min-w-0 flex justify-center">
                            <PlayerDisplay player={p2} isWinner={p2IsWinner} />
                        </div>
                    </div>
                </div>
            ) : (
                // 동네바둑리그: 세로 배치
                <div className="p-3 space-y-2">
                    <PlayerDisplay player={p1} isWinner={p1IsWinner} />
                    {!isFinished && (
                        <div className="flex items-center justify-center py-1">
                            <div className="text-xs text-gray-400 font-semibold">VS</div>
                        </div>
                    )}
                    <PlayerDisplay player={p2} isWinner={p2IsWinner} />
                </div>
            )}
        </div>
    );
};

const RoundColumn: React.FC<{ name: string; matches: Match[] | undefined; currentUser: UserWithStatus; tournamentState?: TournamentState }> = ({ name, matches, currentUser, tournamentState }) => {
    const isFinalRound = name.includes('결승') || name.includes('3,4위전');
    const isNationalTournament = tournamentState?.type === 'national';
    const isWorldTournament = tournamentState?.type === 'world';
    const isTournamentFormat = isNationalTournament || isWorldTournament;
    
    return (
        <div className={`flex flex-col justify-around h-full ${isTournamentFormat ? 'gap-6' : 'gap-4'} flex-shrink-0 ${isTournamentFormat ? 'min-w-[280px]' : 'min-w-[200px]'}`}>
            <div className={`text-center font-bold ${isTournamentFormat ? 'text-lg py-3 px-5' : 'text-base py-2 px-4'} rounded-lg ${
                isFinalRound
                    ? 'bg-gradient-to-r from-purple-600/80 to-pink-600/80 text-white shadow-lg shadow-purple-500/30 border-2 border-purple-400/50'
                    : 'bg-gradient-to-r from-gray-700/80 to-gray-600/80 text-gray-200 shadow-md border border-gray-500/50'
            }`}>
                {name}
            </div>
            <div className={`flex flex-col justify-around h-full ${isTournamentFormat ? 'gap-6' : 'gap-4'}`}>
                {matches?.map(match => (
                    <MatchBox key={match.id} match={match} currentUser={currentUser} tournamentState={tournamentState} />
                ))}
            </div>
        </div>
    );
};

const RoundRobinDisplay: React.FC<{
    tournamentState: TournamentState;
    currentUser: UserWithStatus;
}> = ({ tournamentState, currentUser }) => {
    const [activeTab, setActiveTab] = useState<'round' | 'ranking'>('round');
    const { players, rounds, status, currentRoundRobinRound, type: tournamentType } = tournamentState;
    
    // 경기가 완료된 경우 마지막 회차(5회차)를 초기값으로 설정
    const initialRound = status === 'complete' ? 5 : (currentRoundRobinRound || 1);
    const [selectedRound, setSelectedRound] = useState<number>(initialRound);
    
    // 모든 매치를 수집 (5회차 전체)
    const allMatches = useMemo(() => {
        return rounds.flatMap(round => round.matches);
    }, [rounds]);

    const playerStats = useMemo(() => {
        const stats: Record<string, { wins: number; losses: number }> = {};
        players.forEach(p => { stats[p.id] = { wins: 0, losses: 0 }; });
        allMatches.forEach(match => {
            if (match.isFinished && match.winner) {
                const winnerId = match.winner.id;
                if (stats[winnerId]) stats[winnerId].wins++;
                const loser = match.players.find(p => p && p.id !== winnerId);
                if (loser && stats[loser.id]) stats[loser.id].losses++;
            }
        });
        return stats;
    }, [players, allMatches]);

    const sortedPlayers = useMemo(() => {
        return [...players].sort((a, b) => {
            const aWins = playerStats[a.id]?.wins || 0;
            const bWins = playerStats[b.id]?.wins || 0;
            if (aWins !== bWins) return bWins - aWins;
            // 승수가 같으면 패수로 정렬 (패수가 적을수록 좋음)
            const aLosses = playerStats[a.id]?.losses || 0;
            const bLosses = playerStats[b.id]?.losses || 0;
            return aLosses - bLosses;
        });
    }, [players, playerStats]);

    // 현재 표시할 회차 결정
    // 동네바둑리그: 
    // - round_complete 상태일 때는 완료된 회차를 표시 (1회차 완료 후 1회차 표시) - 경기 종료 화면 유지
    // - bracket_ready 상태일 때는 현재 회차를 표시 (다음 경기 버튼을 눌러 2회차로 넘어간 후 2회차 표시) - 다음 회차 대진표로 이동
    // - complete 상태일 때는 마지막 회차(5회차)를 표시 (경기 종료 후 재입장 시) - 마지막 경기 종료 화면 유지
    const roundForDisplay = status === 'complete' ? 5 : (currentRoundRobinRound || 1);
    
    // rounds 배열에서 선택된 회차의 라운드 찾기 (name이 "1회차", "2회차" 등인 라운드)
    const currentRoundObj = useMemo(() => {
        return rounds.find(round => round.name === `${selectedRound}회차`);
    }, [rounds, selectedRound]);
    
    const currentRoundMatches = currentRoundObj?.matches || [];

    // 현재 회차가 변경되고 사용자가 수동으로 선택하지 않은 경우에만 선택된 회차 업데이트
    // 사용자가 지난 회차 탭을 클릭한 경우에는 그대로 유지
    const isManualSelection = useRef(false);
    useEffect(() => {
        if (!isManualSelection.current && roundForDisplay && selectedRound !== roundForDisplay) {
            setSelectedRound(roundForDisplay);
        }
        isManualSelection.current = false;
    }, [roundForDisplay, selectedRound]);
    
    const handleRoundSelect = (roundNum: number) => {
        isManualSelection.current = true;
        setSelectedRound(roundNum);
    };

    return (
        <div className="h-full flex flex-col min-h-0">
            <h4 className="font-bold text-center mb-2 flex-shrink-0 text-gray-300">풀리그 대진표</h4>
            <div className="flex bg-gray-900/70 p-1 rounded-lg mb-2 flex-shrink-0">
                <button onClick={() => setActiveTab('round')} className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${activeTab === 'round' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>대진표</button>
                <button onClick={() => setActiveTab('ranking')} className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${activeTab === 'ranking' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>{status === 'complete' ? '최종 순위' : '현재 순위'}</button>
            </div>
            <div className="overflow-y-auto pr-2 flex-grow min-h-0">
                {activeTab === 'round' ? (
                    <div className="flex flex-col h-full">
                        {/* 회차 선택 탭 */}
                        <div className="flex gap-1 mb-2 flex-shrink-0">
                            {[1, 2, 3, 4, 5].map(roundNum => (
                                <button
                                    key={roundNum}
                                    onClick={() => handleRoundSelect(roundNum)}
                                    className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${
                                        selectedRound === roundNum
                                            ? 'bg-blue-700 text-white'
                                            : roundNum <= roundForDisplay
                                                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    }`}
                                    disabled={roundNum > roundForDisplay}
                                >
                                    {roundNum}회차
                                </button>
                            ))}
                        </div>
                        {/* 선택된 회차의 매치 표시 */}
                        <div className="flex flex-col items-center justify-around flex-grow gap-4 min-h-0 px-2">
                            {currentRoundMatches.length > 0 ? (
                                currentRoundMatches.map(match => (
                                    <div key={match.id} className="w-full max-w-md">
                                        <MatchBox match={match} currentUser={currentUser} tournamentState={tournamentState} />
                                    </div>
                                ))
                            ) : (
                                <div className="text-gray-400 text-sm italic">경기가 없습니다.</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {sortedPlayers.map((player, index) => {
                             const stats = playerStats[player.id];
                             const isCurrentUser = player.id === currentUser.id;
                             const isTopThree = index < 3;
                             // hooks는 map 내부에서 호출할 수 없으므로 일반 변수로 계산
                             const avatarUrl = AVATAR_POOL.find(a => a.id === player.avatarId)?.url;
                             const borderUrl = BORDER_POOL.find(b => b.id === player.borderId)?.url;
                             const isWinner = status === 'complete' && index === 0;
                             
                             return (
                                 <li key={player.id} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                                     isCurrentUser 
                                         ? 'bg-gradient-to-r from-blue-600/60 to-indigo-600/60 border-2 border-blue-400/70 shadow-lg' 
                                         : isTopThree
                                             ? 'bg-gradient-to-r from-yellow-900/40 to-amber-900/40 border border-yellow-600/50 shadow-md'
                                             : 'bg-gray-700/50 border border-gray-600/30 hover:bg-gray-700/70'
                                 }`}>
                                     <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm flex-shrink-0 ${
                                         index === 0 
                                             ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-black shadow-lg'
                                             : index === 1
                                                 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800 shadow-md'
                                                 : index === 2
                                                     ? 'bg-gradient-to-br from-amber-600 to-orange-600 text-white shadow-md'
                                                     : 'bg-gray-600 text-gray-200'
                                     }`}>
                                         {index + 1}
                                     </div>
                                     <Avatar key={`avatar-rr-${player.id}`} userId={player.id} userName={player.nickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={36} />
                                     <span className={`flex-grow font-semibold text-sm truncate ${
                                         isCurrentUser ? 'text-blue-200' : 'text-gray-200'
                                     }`}>
                                         {player.nickname}
                                     </span>
                                     {isWinner && (
                                         <img 
                                             key={`trophy-rr-${player.id}`}
                                             src="/images/championship/Ranking.png" 
                                             alt="Trophy" 
                                             className="w-6 h-6 flex-shrink-0"
                                             loading="lazy"
                                             decoding="async"
                                         />
                                     )}
                                     <div className="flex items-baseline gap-2 text-xs font-semibold">
                                         <span className="text-green-400">{stats.wins}승</span>
                                         <span className="text-gray-400">/</span>
                                         <span className="text-red-400">{stats.losses}패</span>
                                     </div>
                                 </li>
                             );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};


const TournamentRoundViewer: React.FC<{ 
    rounds: Round[]; 
    currentUser: UserWithStatus; 
    tournamentType: TournamentType; 
    tournamentState?: TournamentState;
    nextRoundTrigger?: number;
    nextRoundStartTime?: number | null;
}> = ({ rounds, currentUser, tournamentType, tournamentState, nextRoundTrigger, nextRoundStartTime }) => {
    // FIX: Define the type for tab data to help TypeScript's inference.
    type TabData = { name: string; matches: Match[]; isInProgress: boolean; };
    
    const getRoundsForTabs = useMemo((): TabData[] | null => {
        const roundMap = new Map<string, Match[]>();
        rounds.forEach(r => roundMap.set(r.name, r.matches));
        
        let availableTabs: string[] = [];
        if (tournamentType === 'world') {
            availableTabs = ["16강", "8강", "4강전", "결승&3/4위전"];
        } else if (tournamentType === 'national') {
            availableTabs = ["8강", "4강전", "결승&3/4위전"];
        } else {
            return null;
        }

        const tabData = availableTabs.map((tabName): TabData => {
            let roundMatches: Match[] = [];
            let roundNames: string[] = [];
            if (tabName === "결승 및 3/4위전" || tabName === "결승&3/4위전") {
                roundNames = ["결승", "3,4위전"];
                roundMatches = (roundMap.get("결승") || []).concat(roundMap.get("3,4위전") || []);
            } else if (tabName === "4강전") {
                roundNames = ["4강"];
                roundMatches = roundMap.get("4강") || [];
            } else {
                roundNames = [tabName];
                roundMatches = roundMap.get(tabName) || [];
            }
            return {
                name: tabName,
                matches: roundMatches,
                isInProgress: roundMatches.length > 0 && roundMatches.some(m => !m.isFinished)
            };
        });
        // 경기가 없어도 탭을 표시하도록 filter 제거
        
        return tabData;
    }, [rounds, tournamentType]);

    // 초기 탭 인덱스 계산 (컴포넌트 마운트 시 한 번만 사용)
    // useState의 초기값 함수는 첫 렌더링 시에만 실행되므로 안전함
    const getInitialTabIndex = () => {
        if (!getRoundsForTabs) return 0;
        
        // 경기가 완료된 경우(complete 또는 eliminated) 마지막 탭을 선택
        if (tournamentState && (tournamentState.status === 'complete' || tournamentState.status === 'eliminated')) {
            return Math.max(0, getRoundsForTabs.length - 1);
        }
        
        // 진행 중인 경기가 있는 탭을 찾음 (초기 입장 시에만)
        const inProgressIndex = getRoundsForTabs.findIndex(tab => tab.isInProgress);
        if (inProgressIndex !== -1) {
            return inProgressIndex;
        }
        
        // 그 외의 경우 첫 번째 탭 선택
        return 0;
    };

    const [activeTab, setActiveTab] = useState(getInitialTabIndex);

    // nextRoundTrigger가 변경되면 다음 탭으로 이동
    const prevNextRoundTrigger = useRef(nextRoundTrigger || 0);
    useEffect(() => {
        if (nextRoundTrigger !== undefined && nextRoundTrigger > prevNextRoundTrigger.current && getRoundsForTabs) {
            const currentTabName = getRoundsForTabs[activeTab]?.name;
            
            // 전국바둑대회
            if (tournamentType === 'national') {
                if (currentTabName === "8강") {
                    // 8강 탭에서 다음경기 버튼을 누르면 4강전 탭으로 이동
                    const nextTabIndex = getRoundsForTabs.findIndex(tab => tab.name === "4강전");
                    if (nextTabIndex !== -1) {
                        setActiveTab(nextTabIndex);
                    }
                } else if (currentTabName === "4강전") {
                    // 4강전 탭에서 다음경기 버튼을 누르면 결승&3/4위전 탭으로 이동
                    const nextTabIndex = getRoundsForTabs.findIndex(tab => tab.name === "결승&3/4위전");
                    if (nextTabIndex !== -1) {
                        setActiveTab(nextTabIndex);
                    }
                }
            }
            // 월드챔피언십
            else if (tournamentType === 'world') {
                if (currentTabName === "16강") {
                    // 16강 탭에서 다음경기 버튼을 누르면 8강 탭으로 이동
                    const nextTabIndex = getRoundsForTabs.findIndex(tab => tab.name === "8강");
                    if (nextTabIndex !== -1) {
                        setActiveTab(nextTabIndex);
                    }
                } else if (currentTabName === "8강") {
                    // 8강 탭에서 다음경기 버튼을 누르면 4강전 탭으로 이동
                    const nextTabIndex = getRoundsForTabs.findIndex(tab => tab.name === "4강전");
                    if (nextTabIndex !== -1) {
                        setActiveTab(nextTabIndex);
                    }
                } else if (currentTabName === "4강전") {
                    // 4강전 탭에서 다음경기 버튼을 누르면 결승&3/4위전 탭으로 이동
                    const nextTabIndex = getRoundsForTabs.findIndex(tab => tab.name === "결승&3/4위전");
                    if (nextTabIndex !== -1) {
                        setActiveTab(nextTabIndex);
                    }
                }
            }
            
            prevNextRoundTrigger.current = nextRoundTrigger;
        } else if (nextRoundTrigger !== undefined) {
            // nextRoundTrigger가 변경되었지만 탭 변경 조건을 만족하지 않으면 ref만 업데이트
            prevNextRoundTrigger.current = nextRoundTrigger;
        }
    }, [nextRoundTrigger, activeTab, getRoundsForTabs, tournamentType]);

    // nextRoundStartTime이 설정되면 다음 경기가 있는 탭으로 자동 이동
    const prevNextRoundStartTime = useRef<number | null | undefined>(nextRoundStartTime);
    useEffect(() => {
        if (nextRoundStartTime && nextRoundStartTime !== prevNextRoundStartTime.current && getRoundsForTabs && tournamentState) {
            // 다음 경기가 있는 탭 찾기
            const nextUserMatch = rounds
                .flatMap((round, rIdx) => round.matches.map((match, mIdx) => ({ match, roundIndex: rIdx, matchIndex: mIdx })))
                .find(({ match }) => !match.isFinished && match.isUserMatch);
            
            if (nextUserMatch) {
                // 다음 경기가 있는 라운드 찾기
                const nextRound = rounds[nextUserMatch.roundIndex];
                if (nextRound) {
                    // 해당 라운드가 포함된 탭 찾기
                    const targetTabIndex = getRoundsForTabs.findIndex(tab => {
                        if (tab.name === "결승&3/4위전") {
                            return nextRound.name === "결승" || nextRound.name === "3,4위전";
                        } else if (tab.name === "4강전") {
                            return nextRound.name === "4강";
                        } else {
                            return tab.name === nextRound.name;
                        }
                    });
                    
                    if (targetTabIndex !== -1 && targetTabIndex !== activeTab) {
                        setActiveTab(targetTabIndex);
                    }
                }
            }
            
            prevNextRoundStartTime.current = nextRoundStartTime;
        } else if (nextRoundStartTime !== prevNextRoundStartTime.current) {
            prevNextRoundStartTime.current = nextRoundStartTime;
        }
    }, [nextRoundStartTime, getRoundsForTabs, tournamentState, rounds, activeTab]);

    if (!getRoundsForTabs) {
        const desiredOrder = ["16강", "8강", "4강", "3,4위전", "결승"];
        const sortedRounds = [...rounds].sort((a, b) => desiredOrder.indexOf(a.name) - desiredOrder.indexOf(b.name));
        return (
            <div className="h-full flex flex-col min-h-0">
                <h4 className="font-bold text-center mb-2 flex-shrink-0 text-gray-300">대진표</h4>
                <div className="flex-grow overflow-auto flex items-center justify-center p-2 space-x-4">
                    {sortedRounds.map((round) => (
                        <RoundColumn key={round.id} name={round.name} matches={round.matches} currentUser={currentUser} tournamentState={tournamentState} />
                    ))}
                </div>
            </div>
        );
    }
    
    const activeTabData = getRoundsForTabs[activeTab];

    // 전국바둑대회 전체 토너먼트 브래킷 렌더링 (8강 → 4강 → 결승)
    const renderNationalTournamentBracket = () => {
        const roundMap = new Map<string, Match[]>();
        rounds.forEach(r => roundMap.set(r.name, r.matches));
        
        const quarterFinals = roundMap.get("8강") || [];
        const semiFinals = roundMap.get("4강") || [];
        const final = roundMap.get("결승") || [];
        const thirdPlace = roundMap.get("3,4위전") || [];
        
        const containerRef = useRef<HTMLDivElement>(null);
        const [lines, setLines] = useState<React.ReactNode[]>([]);
        const matchRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
        
        const setMatchRef = useCallback((matchId: string) => (el: HTMLDivElement | null) => {
            matchRefs.current.set(matchId, el);
        }, []);
        
        useEffect(() => {
            const calculateLines = () => {
                const containerElem = containerRef.current;
                if (!containerElem) return;
                
                const containerRect = containerElem.getBoundingClientRect();
                const newLines: React.ReactNode[] = [];
                
                // 8강 → 4강 연결선 (왼쪽 8강 → 오른쪽 4강, V자 형태로 가운데에서 만남)
                quarterFinals.forEach((qfMatch, qfIndex) => {
                    if (!qfMatch.isFinished || !qfMatch.winner) return;
                    
                    // 위쪽 8강(0,1) → 첫 번째 4강(0), 아래쪽 8강(2,3) → 두 번째 4강(1)
                    const semiIndex = Math.floor(qfIndex / 2);
                    const semiMatch = semiFinals[semiIndex];
                    if (!semiMatch) return;
                    
                    const qfElem = matchRefs.current.get(qfMatch.id);
                    const semiElem = matchRefs.current.get(semiMatch.id);
                    
                    if (qfElem && semiElem) {
                        const qfRect = qfElem.getBoundingClientRect();
                        const semiRect = semiElem.getBoundingClientRect();
                        
                        // 승자 위치 계산 (MatchBox 내부에서 위쪽/아래쪽 플레이어)
                        const qfWinnerIsP1 = qfMatch.winner.id === qfMatch.players[0]?.id;
                        const qfY = qfRect.top + (qfWinnerIsP1 ? qfRect.height * 0.25 : qfRect.height * 0.75) - containerRect.top;
                        
                        // 4강의 위치: 위쪽 8강이면 4강의 위쪽, 아래쪽 8강이면 4강의 아래쪽
                        const isUpperQuarter = qfIndex < 2;
                        const semiY = semiRect.top + (isUpperQuarter ? semiRect.height * 0.25 : semiRect.height * 0.75) - containerRect.top;
                        
                        const startX = qfRect.right - containerRect.left;
                        const endX = semiRect.left - containerRect.left;
                        const midX = startX + (endX - startX) * 0.5; // 가운데 지점
                        const midY = qfRect.top + qfRect.height / 2 - containerRect.top; // 8강 박스의 중간 높이
                        const targetMidY = semiRect.top + semiRect.height / 2 - containerRect.top; // 4강 박스의 중간 높이
                        
                        // V자 형태: 8강에서 아래로 내려가서 가운데에서 만나고, 다시 4강으로 올라감
                        newLines.push(
                            <path key={`qf-${qfMatch.id}`} 
                                d={`M ${startX} ${qfY} V ${midY} H ${midX} V ${targetMidY} H ${endX} V ${semiY}`} 
                                stroke="rgba(251, 146, 60, 0.8)" 
                                strokeWidth="3" 
                                fill="none" 
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        );
                    }
                });
                
                // 4강 → 결승 연결선 (역 V자 형태로 가운데에서 나뉨)
                semiFinals.forEach((semiMatch, semiIndex) => {
                    if (!semiMatch.isFinished || !semiMatch.winner) return;
                    
                    const finalMatch = final[0];
                    if (!finalMatch) return;
                    
                    const semiElem = matchRefs.current.get(semiMatch.id);
                    const finalElem = matchRefs.current.get(finalMatch.id);
                    
                    if (semiElem && finalElem) {
                        const semiRect = semiElem.getBoundingClientRect();
                        const finalRect = finalElem.getBoundingClientRect();
                        
                        const semiWinnerIsP1 = semiMatch.winner.id === semiMatch.players[0]?.id;
                        const semiY = semiRect.top + (semiWinnerIsP1 ? semiRect.height * 0.25 : semiRect.height * 0.75) - containerRect.top;
                        const finalY = finalRect.top + finalRect.height * 0.5 - containerRect.top;
                        
                        const startX = semiRect.left + semiRect.width / 2 - containerRect.left;
                        const endX = finalRect.left + finalRect.width / 2 - containerRect.left;
                        const midX = (startX + endX) / 2; // 가운데 지점
                        const midY = semiRect.bottom - containerRect.top; // 4강 박스 아래
                        const targetMidY = finalRect.top - containerRect.top; // 결승 박스 위
                        
                        // 역 V자 형태: 4강에서 아래로 내려가서 가운데에서 나뉘고, 다시 결승으로 올라감
                        newLines.push(
                            <path key={`semi-${semiMatch.id}`} 
                                d={`M ${startX} ${semiY} V ${midY} H ${midX} V ${targetMidY} H ${endX} V ${finalY}`} 
                                stroke="rgba(251, 146, 60, 0.8)" 
                                strokeWidth="3" 
                                fill="none" 
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        );
                    }
                });
                
                setLines(newLines);
            };
            
            const timeoutId = setTimeout(calculateLines, 50);
            const resizeObserver = new ResizeObserver(calculateLines);
            if (containerRef.current) {
                resizeObserver.observe(containerRef.current);
            }
            
            return () => {
                clearTimeout(timeoutId);
                resizeObserver.disconnect();
            };
        }, [quarterFinals, semiFinals, final]);
        
        // 이 함수는 더 이상 사용되지 않음 - 탭별로 개별 렌더링
        return null;
    };

    const renderBracketForTab = (tab: typeof activeTabData) => {
        // 전국바둑대회/월드챔피언십: 탭별로 세로 배치
        if (tournamentType === 'national' || tournamentType === 'world') {
            if (tab.name === "결승&3/4위전") {
                const finalMatch = tab.matches.filter(m => rounds.find(r => r.matches.includes(m))?.name === '결승');
                const thirdPlaceMatch = tab.matches.filter(m => rounds.find(r => r.matches.includes(m))?.name === '3,4위전');
                // 부모 컨테이너의 높이가 자동으로 조정되므로 h-full 사용
                return (
                    <div className="flex flex-col items-center justify-start gap-4 p-4 overflow-y-auto overflow-x-visible h-full">
                        {finalMatch.length > 0 && (
                            <div className="w-full max-w-[280px] pb-2">
                                <MatchBox match={finalMatch[0]} currentUser={currentUser} tournamentState={tournamentState} />
                            </div>
                        )}
                        {thirdPlaceMatch.length > 0 && (
                            <div className="w-full max-w-[280px] pb-2">
                                <MatchBox match={thirdPlaceMatch[0]} currentUser={currentUser} tournamentState={tournamentState} />
                            </div>
                        )}
                    </div>
                );
            }
            
            // 16강, 8강, 4강전: 세로로 배치
            // 부모 컨테이너의 높이가 자동으로 조정되므로 h-full 사용하여 모든 공간 활용
            // 승자 패널이 잘리지 않도록 overflow-x-visible 및 패딩 추가
            // 보상 패널은 사이드바 레이아웃에서 flex-shrink-0으로 고정되어 있어 자동으로 공간 확보됨
            return (
                <div className="flex flex-col items-center justify-start gap-4 p-4 overflow-y-auto overflow-x-visible h-full">
                    {tab.matches.map((match) => (
                        <div key={match.id} className="w-full max-w-[280px] pb-2">
                            <MatchBox match={match} currentUser={currentUser} tournamentState={tournamentState} />
                        </div>
                    ))}
                </div>
            );
        }

        // 동네바둑리그: 기존 방식 유지
        if (tab.name === "결승 및 3/4위전") {
             const finalMatch = tab.matches.filter(m => rounds.find(r => r.matches.includes(m))?.name === '결승');
             const thirdPlaceMatch = tab.matches.filter(m => rounds.find(r => r.matches.includes(m))?.name === '3,4위전');
             return (
                <div className="flex flex-col justify-center items-center h-full gap-8 p-4">
                    {finalMatch.length > 0 && (
                        <div className="w-full max-w-[200px]">
                            <MatchBox match={finalMatch[0]} currentUser={currentUser} tournamentState={tournamentState} />
                        </div>
                    )}
                    {thirdPlaceMatch.length > 0 && (
                        <div className="w-full max-w-[200px]">
                            <MatchBox match={thirdPlaceMatch[0]} currentUser={currentUser} tournamentState={tournamentState} />
                        </div>
                    )}
                </div>
             );
        }

        return (
             <div className="flex justify-center items-center h-full gap-4 p-4">
                <RoundColumn name={tab.name} matches={tab.matches} currentUser={currentUser} tournamentState={tournamentState} />
            </div>
        );
    }

    // 보상 패널이 표시될 때 대진표가 적절히 조정되도록 함
    // 사이드바의 flex 레이아웃이 자동으로 높이를 조정하므로, 내부에서 추가로 높이 제한하지 않음
    return (
        <div className="h-full flex flex-col min-h-0">
            <h4 className="font-bold text-center mb-3 flex-shrink-0 text-gray-200 text-lg">대진표</h4>
            <div className="flex bg-gradient-to-r from-gray-800/90 to-gray-700/90 p-1 rounded-xl mb-3 flex-shrink-0 border border-gray-600/50 shadow-lg">
                {getRoundsForTabs.map((tab, index) => (
                    <button
                        key={tab.name}
                        onClick={() => setActiveTab(index)}
                        className={`flex-1 py-2 font-semibold rounded-lg transition-all duration-200 whitespace-nowrap ${
                            tab.name === "결승&3/4위전" ? 'text-[10px]' : 'text-xs'
                        } ${
                            activeTab === index 
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg scale-105' 
                                : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                        }`}
                    >
                        {tab.name}
                    </button>
                ))}
            </div>
            {/* 대진표 내용 영역 - flex-grow로 남은 공간을 모두 사용하고, 스크롤 가능하도록 설정 */}
            <div className="flex-1 overflow-hidden overflow-x-visible min-h-0">
                {activeTabData && renderBracketForTab(activeTabData)}
            </div>
        </div>
    );
};

export const TournamentBracket: React.FC<TournamentBracketProps> = (props) => {
    const { tournament, currentUser, onBack, allUsersForRanking, onViewUser, onAction, onStartNextRound, onReset, onSkip, onOpenShop, isMobile } = props;
    
    // React 훅 규칙: 모든 훅은 조건문 밖에서 호출되어야 함
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [lastUserMatchSgfIndex, setLastUserMatchSgfIndex] = useState<number | null>(null);
    const [initialMatchPlayers, setInitialMatchPlayers] = useState<{ p1: PlayerForTournament | null, p2: PlayerForTournament | null }>({ p1: null, p2: null });
    const [showConditionPotionModal, setShowConditionPotionModal] = useState(false);
    const [isSimulationHelpOpen, setIsSimulationHelpOpen] = useState(false);
    const prevStatusRef = useRef(tournament?.status || 'bracket_ready');
    const initialMatchPlayersSetRef = useRef(false);
    const [nextRoundTrigger, setNextRoundTrigger] = useState(0);
    const [sgfViewerSize, setSgfViewerSize] = useState<25 | 50>(50); // 모바일에서 SGF 뷰어 크기 (25=50% 표시, 50=100% 표시)
    const p1ProfileRef = useRef<HTMLDivElement>(null);
    const p2ProfileRef = useRef<HTMLDivElement>(null);
    const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null); // 자동 다음 경기 카운트다운
    const autoNextTimerRef = useRef<NodeJS.Timeout | null>(null);
    const nextRoundStartTimeCheckRef = useRef<NodeJS.Timeout | null>(null);
    const countdownRef = useRef<number>(0); // 카운트다운 값을 저장하는 ref
    const hasAutoStartedRef = useRef(false); // 오늘 처음 입장했는지 확인
    
    // 안전성 검사: tournament가 없으면 로딩 메시지 표시
    if (!tournament) {
        return (
            <div className="p-4 text-center">
                <p>토너먼트 정보를 불러오는 중입니다...</p>
            </div>
        );
    }
    
    // 안전성 검사: currentUser가 없으면 에러 메시지 표시
    if (!currentUser || !currentUser.id) {
        return (
            <div className="p-4 text-center">
                <p>사용자 정보를 불러오는 중입니다...</p>
            </div>
        );
    }
    
    // 클라이언트에서 시뮬레이션 실행
    const simulatedTournament = useTournamentSimulation(tournament, currentUser);
    const displayTournament = simulatedTournament || tournament;
    
    const safeRounds = useMemo(() => {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds;
    }, [tournament?.rounds]);
    
    // 토너먼트 상태 로깅
    useEffect(() => {
        if (tournament) {
            console.log('[TournamentBracket] 토너먼트 상태:', tournament.status, '타입:', tournament.type, '현재 회차:', tournament.currentRoundRobinRound);
        }
    }, [tournament?.status, tournament?.type, tournament?.currentRoundRobinRound]);

    useEffect(() => {
        if (currentUser?.id) {
            console.log('[TournamentBracket] ENTER_TOURNAMENT_VIEW 호출');
            onAction({ type: 'ENTER_TOURNAMENT_VIEW' });
            return () => {
                console.log('[TournamentBracket] LEAVE_TOURNAMENT_VIEW 호출');
                onAction({ type: 'LEAVE_TOURNAMENT_VIEW' });
            };
        }
    }, [onAction, currentUser?.id]);

    // 자동 다음 경기 진행 로직
    useEffect(() => {
        // 안전성 검사: 필수 props와 데이터 확인
        if (!tournament || !onAction || !onStartNextRound || !Array.isArray(safeRounds)) {
            console.log('[TournamentBracket] useEffect 스킵 - 필수 데이터 없음:', {
                tournament: !!tournament,
                onAction: !!onAction,
                onStartNextRound: !!onStartNextRound,
                safeRounds: Array.isArray(safeRounds)
            });
            return;
        }
        
        const status = tournament.status;
        const prevStatus = prevStatusRef.current;
        
        // 상태 변경 로깅
        if (status !== prevStatus) {
            console.log('[TournamentBracket] 상태 변경:', prevStatus, '->', status, 'tournament.type:', tournament.type);
        } else {
            console.log('[TournamentBracket] 현재 상태:', status, '이전 상태:', prevStatus);
        }
        
        // bracket_ready 상태에서 자동으로 경기 시작
        // 첫 경기는 수동 시작 (유저가 경기 시작 버튼을 눌러야 함)
        // 두 번째 경기부터는 자동 시작
        if (status === 'bracket_ready' && prevStatus !== 'bracket_ready') {
            // 다음 경기가 있는지 확인
            const hasUnfinishedUserMatch = safeRounds.some(r =>
                Array.isArray(r?.matches) && r.matches.some(m => m.isUserMatch && !m.isFinished)
            );
            
            if (hasUnfinishedUserMatch && currentUser?.id && Array.isArray(tournament.players)) {
                // 완료된 유저 경기 수 확인 (첫 경기인지 판단)
                const finishedUserMatches = safeRounds.reduce((count, r) => {
                    if (!Array.isArray(r?.matches)) return count;
                    return count + r.matches.filter(m => m.isUserMatch && m.isFinished).length;
                }, 0);
                
                const isFirstMatch = finishedUserMatches === 0;
                
                // 첫 경기는 자동 시작하지 않음 (유저가 수동으로 시작 버튼을 눌러야 함)
                if (isFirstMatch) {
                    console.log('[TournamentBracket] 첫 경기 - 수동 시작 대기 중');
                    return;
                }
                
                // 두 번째 경기부터는 자동 시작
                // 오늘 처음 입장했는지 확인 (컨디션이 유효한지 확인)
                const userPlayer = tournament.players.find(p => p.id === currentUser.id);
                const hasValidCondition = userPlayer && 
                    userPlayer.condition !== undefined && 
                    userPlayer.condition !== null && 
                    userPlayer.condition !== 1000 && 
                    userPlayer.condition >= 40 && 
                    userPlayer.condition <= 100;
                
                // 컨디션이 유효하면 자동으로 경기 시작
                // round_complete에서 bracket_ready로 변경된 경우 (카운트다운 후) 바로 시작
                // 오늘 처음 입장한 경우 컨디션 조절 시간을 확보하기 위해 2초 후 시작
                if (hasValidCondition && tournament.type) {
                    const delay = prevStatus === 'round_complete' ? 500 : 2000; // round_complete에서 온 경우 0.5초, 처음 입장한 경우 2초
                    console.log('[TournamentBracket] bracket_ready 상태, 자동 경기 시작 예약:', delay, 'ms 후');
                    const autoStartTimer = setTimeout(() => {
                        try {
                            console.log('[TournamentBracket] 자동 경기 시작 실행');
                            onAction({ type: 'START_TOURNAMENT_MATCH', payload: { type: tournament.type } });
                        } catch (error) {
                            console.error('[TournamentBracket] 자동 경기 시작 오류:', error);
                        }
                    }, delay);
                    
                    return () => {
                        clearTimeout(autoStartTimer);
                    };
                }
            }
        }
        
        // round_complete 상태로 변경되었을 때 자동으로 다음 경기 시작
        if (status === 'round_complete' && prevStatus !== 'round_complete') {
            console.log('[TournamentBracket] round_complete 상태 감지, 다음 경기 확인 중...');
            
            // 기존 타이머가 있으면 정리
            if (autoNextTimerRef.current) {
                clearInterval(autoNextTimerRef.current);
                autoNextTimerRef.current = null;
            }
            
            // 다음 경기가 있는지 확인
            let hasNextMatch = false;
            const tournamentType = tournament?.type;
            
            if (tournamentType === 'neighborhood') {
                // 동네바둑리그: 5경기 연속 진행
                const currentRound = tournament.currentRoundRobinRound || 1;
                hasNextMatch = currentRound < 5;
                console.log('[TournamentBracket] 동네바둑리그 - 현재 회차:', currentRound, '다음 경기 있음:', hasNextMatch);
            } else if (tournamentType === 'national') {
                // 전국바둑대회: 8강, 4강, 결승 또는 3/4위전이 유저가 질 때까지 진행
                const hasNextUserMatch = safeRounds.some(r => 
                    Array.isArray(r?.matches) && r.matches.some(m => !m.isFinished && m.isUserMatch)
                );
                hasNextMatch = hasNextUserMatch;
                console.log('[TournamentBracket] 전국바둑대회 - 다음 경기 있음:', hasNextMatch);
            } else if (tournamentType === 'world') {
                // 월드챔피언십: 16강부터 유저가 질 때까지 진행
                const hasNextUserMatch = safeRounds.some(r => 
                    Array.isArray(r?.matches) && r.matches.some(m => !m.isFinished && m.isUserMatch)
                );
                hasNextMatch = hasNextUserMatch;
                console.log('[TournamentBracket] 월드챔피언십 - 다음 경기 있음:', hasNextMatch);
            }
            
            console.log('[TournamentBracket] hasNextMatch:', hasNextMatch, 'tournamentType:', tournamentType);
            
            if (hasNextMatch && tournamentType) {
                // 기존 타이머가 있으면 정리
                if (autoNextTimerRef.current) {
                    clearInterval(autoNextTimerRef.current);
                    autoNextTimerRef.current = null;
                }
                
                // 5초 카운트다운 시작
                countdownRef.current = 5;
                setAutoNextCountdown(5);
                const tournamentTypeRef = tournamentType; // 클로저를 위한 로컬 변수
                
                console.log('[TournamentBracket] 카운트다운 시작:', countdownRef.current);
                
                autoNextTimerRef.current = setInterval(() => {
                    countdownRef.current--;
                    setAutoNextCountdown(countdownRef.current);
                    console.log('[TournamentBracket] 카운트다운:', countdownRef.current);
                    
                    if (countdownRef.current <= 0) {
                        console.log('[TournamentBracket] 카운트다운 완료, 다음 경기 시작');
                        if (autoNextTimerRef.current) {
                            clearInterval(autoNextTimerRef.current);
                            autoNextTimerRef.current = null;
                        }
                        setAutoNextCountdown(null);
                        
                        // 상태 초기화: SGF 뷰어, 실시간 중계, 스코어 보드, 선수 정보 클리어
                        setLastUserMatchSgfIndex(null);
                        setInitialMatchPlayers({ p1: null, p2: null });
                        initialMatchPlayersSetRef.current = false;
                        
                        // 다음 경기 시작: START_TOURNAMENT_ROUND 액션 호출
                        // bracket_ready 상태로 변경되면 자동으로 경기 시작하는 로직이 별도 useEffect에서 처리됨
                        try {
                            if (typeof onStartNextRound === 'function') {
                                console.log('[TournamentBracket] onStartNextRound 호출');
                                onStartNextRound();
                                // 전국바둑대회/월드챔피언십의 경우 다음 라운드 트리거 업데이트
                                if (tournamentTypeRef === 'national' || tournamentTypeRef === 'world') {
                                    setNextRoundTrigger(prev => prev + 1);
                                }
                            }
                        } catch (error) {
                            console.error('[TournamentBracket] 자동 다음경기 오류:', error);
                        }
                    }
                }, 1000);
            } else {
                // 다음 경기가 없으면 카운트다운 초기화
                setAutoNextCountdown(null);
            }
        }
        
        // 상태가 변경되면 카운트다운 취소
        if (status !== 'round_complete' && autoNextTimerRef.current) {
            clearInterval(autoNextTimerRef.current);
            autoNextTimerRef.current = null;
            setAutoNextCountdown(null);
        }
        
        // prevStatusRef 업데이트
        prevStatusRef.current = status;
        
        return () => {
            if (autoNextTimerRef.current) {
                clearInterval(autoNextTimerRef.current);
                autoNextTimerRef.current = null;
            }
        };
    }, [tournament?.status, tournament?.type, tournament?.currentRoundRobinRound, safeRounds, onStartNextRound, onAction, currentUser?.id]);
    
    // nextRoundStartTime 체크하여 자동으로 다음 경기 시작 (시뮬레이션 경기 완료 후)
    useEffect(() => {
        if (!tournament || !tournament.nextRoundStartTime) {
            if (nextRoundStartTimeCheckRef.current) {
                clearInterval(nextRoundStartTimeCheckRef.current);
                nextRoundStartTimeCheckRef.current = null;
            }
            return;
        }
        
        // bracket_ready, round_in_progress, round_complete 상태에서 nextRoundStartTime이 설정되어 있으면 체크 시작
        // (시뮬레이션 경기장에서는 round_in_progress나 round_complete 상태에서도 자동 시작이 필요)
        const shouldCheckNextRound = tournament.nextRoundStartTime && (
            tournament.status === 'bracket_ready' || 
            tournament.status === 'round_in_progress' || 
            tournament.status === 'round_complete'
        );
        
        if (shouldCheckNextRound) {
            const checkNextRound = () => {
                const now = Date.now();
                const timeUntilStart = tournament.nextRoundStartTime! - now;
                
                if (timeUntilStart <= 0) {
                    // 시간이 지났으면 다음 경기 시작
                    console.log('[TournamentBracket] nextRoundStartTime 도달, 자동 경기 시작', { status: tournament.status });
                    if (nextRoundStartTimeCheckRef.current) {
                        clearInterval(nextRoundStartTimeCheckRef.current);
                        nextRoundStartTimeCheckRef.current = null;
                    }
                    // 자동 경기 시작
                    onAction({ type: 'START_TOURNAMENT_MATCH', payload: { type: tournament.type } });
                } else {
                    // 남은 시간 표시 (최대 5초)
                    const remainingSeconds = Math.ceil(timeUntilStart / 1000);
                    if (remainingSeconds <= 5) {
                        setAutoNextCountdown(remainingSeconds);
                    }
                }
            };
            
            // 즉시 한 번 체크
            checkNextRound();
            
            // 100ms마다 체크
            nextRoundStartTimeCheckRef.current = setInterval(checkNextRound, 100);
        } else {
            if (nextRoundStartTimeCheckRef.current) {
                clearInterval(nextRoundStartTimeCheckRef.current);
                nextRoundStartTimeCheckRef.current = null;
            }
        }
        
        return () => {
            if (nextRoundStartTimeCheckRef.current) {
                clearInterval(nextRoundStartTimeCheckRef.current);
                nextRoundStartTimeCheckRef.current = null;
            }
        };
    }, [tournament?.status, tournament?.nextRoundStartTime, tournament?.type, onAction]);
    
    useEffect(() => {
        // 안전성 검사
        if (!tournament || !Array.isArray(safeRounds)) {
            return;
        }
        
        const status = tournament.status;
        const prevStatus = prevStatusRef.current;
    
        // 경기가 완료되면 마지막 유저 경기의 SGF 인덱스 저장 (모든 회차에서 동일하게 적용)
        if (status === 'round_complete' || status === 'eliminated' || status === 'complete') {
            const lastFinishedUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
            if (lastFinishedUserMatch && lastFinishedUserMatch.sgfFileIndex !== undefined) {
                setLastUserMatchSgfIndex(lastFinishedUserMatch.sgfFileIndex);
            }
        } else if (status === 'bracket_ready') {
            // bracket_ready 상태일 때는 다음 경기가 있으면 준비 상태, 없으면 마지막 경기 완료 상태
            // 다음 경기가 있으면 SGF 인덱스 초기화 (빈 바둑판 표시)
            // 다음 경기가 없으면 (마지막 경기였으면) 마지막 완료된 경기의 SGF를 유지
            const hasNextMatch = safeRounds.some(r => 
                r.matches.some(m => m.isUserMatch && !m.isFinished)
            );
            
            // round_complete에서 bracket_ready로 변경될 때 (다음경기 버튼을 눌렀을 때) 상태 초기화
            if (prevStatus === 'round_complete' && hasNextMatch && tournament && Array.isArray(tournament.players)) {
                // 다음 회차의 선수 정보로 갱신하기 위해 초기화
                setInitialMatchPlayers({ p1: null, p2: null });
                initialMatchPlayersSetRef.current = false;
                
                // 다음 경기의 선수 정보를 즉시 설정
                let nextMatch: Match | undefined = undefined;
                if (tournament.type === 'neighborhood') {
                    const currentRound = tournament.currentRoundRobinRound || 1;
                    const currentRoundObj = safeRounds.find(r => r.name === `${currentRound}회차`);
                    if (currentRoundObj) {
                        nextMatch = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                    }
                } else {
                    // 전국/월드챔피언십: 다음 경기 찾기
                    nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
                }
                
                if (nextMatch) {
                    const p1 = tournament.players.find(p => p.id === nextMatch.players[0]?.id) || null;
                    const p2 = tournament.players.find(p => p.id === nextMatch.players[1]?.id) || null;
                    if (p1 || p2) {
                        const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                            const statsToUse = player.originalStats || player.stats;
                            return {
                                ...player,
                                stats: statsToUse ? { ...statsToUse } : player.stats,
                                originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                            };
                        };
                        
                        setInitialMatchPlayers({
                            p1: p1 ? createPlayerCopy(p1) : null,
                            p2: p2 ? createPlayerCopy(p2) : null,
                        });
                        initialMatchPlayersSetRef.current = true;
                    }
                }
            }
            
            if (!hasNextMatch) {
                // 마지막 경기였으면 완료된 경기 화면 유지
                const lastFinishedUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
                if (lastFinishedUserMatch && lastFinishedUserMatch.sgfFileIndex !== undefined) {
                    setLastUserMatchSgfIndex(lastFinishedUserMatch.sgfFileIndex);
                }
            } else {
                // 다음 경기가 있으면 SGF 인덱스 초기화
                setLastUserMatchSgfIndex(null);
            }
        } else if (status === 'round_in_progress' && tournament) {
            // 경기가 시작되면 초기 플레이어 상태 저장
            // timeElapsed가 0이거나 1일 때, 또는 이전 상태가 round_in_progress가 아니었을 때
            const matchInfo = tournament.currentSimulatingMatch;
            const isNewMatch = prevStatus !== 'round_in_progress';
            const isEarlyTime = tournament.timeElapsed === 0 || tournament.timeElapsed === 1;
            
            if (matchInfo && (isNewMatch || (isEarlyTime && !initialMatchPlayersSetRef.current))) {
                const match = safeRounds[matchInfo.roundIndex]?.matches[matchInfo.matchIndex];
                if (match) {
                    const p1 = tournament.players.find(p => p.id === match.players[0]?.id) || null;
                    const p2 = tournament.players.find(p => p.id === match.players[1]?.id) || null;
                    // originalStats를 포함한 깊은 복사로 초기 상태 저장
                    // originalStats가 있으면 그것을 사용, 없으면 현재 stats 사용
                    if (p1 || p2) {
                        const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                            const statsToUse = player.originalStats || player.stats;
                            return {
                                ...player,
                                stats: statsToUse ? { ...statsToUse } : player.stats,
                                originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                            };
                        };
                        
                        setInitialMatchPlayers({
                            p1: p1 ? createPlayerCopy(p1) : null,
                            p2: p2 ? createPlayerCopy(p2) : null,
                        });
                        initialMatchPlayersSetRef.current = true;
                    }
                }
            }
        } else {
            // status가 'round_in_progress'가 아닌 다른 상태일 때
            // 경기가 막 끝났지만 아직 서버에서 상태가 업데이트되지 않은 경우 (currentSimulatingMatch가 있지만 status가 round_in_progress가 아님)
            // 이 경우에도 마지막 경기의 선수 정보를 유지
            if (tournament.currentSimulatingMatch && (tournament.status !== 'round_in_progress')) {
                const matchInfo = tournament.currentSimulatingMatch;
                const match = safeRounds[matchInfo.roundIndex]?.matches[matchInfo.matchIndex];
                if (match) {
                    const p1 = tournament.players.find(p => p.id === match.players[0]?.id) || null;
                    const p2 = tournament.players.find(p => p.id === match.players[1]?.id) || null;
                    if (p1 || p2) {
                        const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                            const statsToUse = player.originalStats || player.stats;
                            return {
                                ...player,
                                stats: statsToUse ? { ...statsToUse } : player.stats,
                                originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                            };
                        };
                        
                        // 이미 설정되어 있지 않거나 선수가 변경된 경우에만 업데이트
                        // 컨디션 변경도 감지하여 업데이트 (회복제 사용 등)
                        const conditionChanged = (initialMatchPlayers.p1 && p1 && initialMatchPlayers.p1.condition !== p1.condition) ||
                                                 (initialMatchPlayers.p2 && p2 && initialMatchPlayers.p2.condition !== p2.condition);
                        
                        const shouldUpdate = !initialMatchPlayersSetRef.current || 
                            initialMatchPlayers.p1?.id !== p1?.id || 
                            initialMatchPlayers.p2?.id !== p2?.id ||
                            conditionChanged;
                        
                        if (shouldUpdate) {
                            setInitialMatchPlayers({
                                p1: p1 ? createPlayerCopy(p1) : null,
                                p2: p2 ? createPlayerCopy(p2) : null,
                            });
                            initialMatchPlayersSetRef.current = true;
                        }
                    }
                }
            }
            // round_complete 상태일 때는 마지막 완료된 경기의 선수 정보를 유지
            if (tournament.status === 'round_complete' || tournament.status === 'complete' || tournament.status === 'eliminated') {
                // 마지막 완료된 경기의 선수 정보를 찾아서 유지
                const lastFinishedUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
                if (lastFinishedUserMatch) {
                    const p1 = tournament.players.find(p => p.id === lastFinishedUserMatch.players[0]?.id) || null;
                    const p2 = tournament.players.find(p => p.id === lastFinishedUserMatch.players[1]?.id) || null;
                    if (p1 || p2) {
                        const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                            const statsToUse = player.originalStats || player.stats;
                            return {
                                ...player,
                                stats: statsToUse ? { ...statsToUse } : player.stats,
                                originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                            };
                        };
                        
                        // 이미 설정되어 있지 않거나 선수가 변경된 경우에만 업데이트
                        // 컨디션 변경도 감지하여 업데이트 (회복제 사용 등)
                        const conditionChanged = (initialMatchPlayers.p1 && p1 && initialMatchPlayers.p1.condition !== p1.condition) ||
                                                 (initialMatchPlayers.p2 && p2 && initialMatchPlayers.p2.condition !== p2.condition);
                        
                        const shouldUpdate = !initialMatchPlayersSetRef.current || 
                            initialMatchPlayers.p1?.id !== p1?.id || 
                            initialMatchPlayers.p2?.id !== p2?.id ||
                            conditionChanged;
                        
                        if (shouldUpdate) {
                            setInitialMatchPlayers({
                                p1: p1 ? createPlayerCopy(p1) : null,
                                p2: p2 ? createPlayerCopy(p2) : null,
                            });
                            initialMatchPlayersSetRef.current = true;
                        }
                    }
                }
            } else if (tournament.status === 'bracket_ready') {
                // bracket_ready 상태일 때는 다음 경기의 선수 정보를 설정
                // 동네바둑리그의 경우 현재 회차의 다음 경기를 찾기
                let nextMatch: Match | undefined = undefined;
                if (tournament.type === 'neighborhood') {
                    const currentRound = tournament.currentRoundRobinRound || 1;
                    const currentRoundObj = safeRounds.find(r => r.name === `${currentRound}회차`);
                    if (currentRoundObj) {
                        nextMatch = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                    }
                } else {
                    // 전국/월드챔피언십: 다음 경기 찾기
                    nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
                }
                
                if (nextMatch) {
                    const p1 = tournament.players.find(p => p.id === nextMatch.players[0]?.id) || null;
                    const p2 = tournament.players.find(p => p.id === nextMatch.players[1]?.id) || null;
                    if (p1 || p2) {
                        const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                            const statsToUse = player.originalStats || player.stats;
                            return {
                                ...player,
                                stats: statsToUse ? { ...statsToUse } : player.stats,
                                originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                            };
                        };
                        
                        // 컨디션 변경도 감지하여 업데이트 (회복제 사용 등)
                        const conditionChanged = (initialMatchPlayers.p1 && p1 && initialMatchPlayers.p1.condition !== p1.condition) ||
                                                 (initialMatchPlayers.p2 && p2 && initialMatchPlayers.p2.condition !== p2.condition);
                        
                        // round_complete에서 bracket_ready로 변경될 때 (다음경기 버튼을 눌렀을 때) 강제로 갱신
                        const isTransitionFromRoundComplete = prevStatus === 'round_complete';
                        
                        // 선수 ID가 변경되었거나, 컨디션이 변경되었거나, initialMatchPlayersSetRef가 false이면 업데이트
                        // 특히 전국/월드챔피언십에서 다음 라운드로 이동할 때 선수 ID가 변경되므로 항상 확인
                        // round_complete에서 bracket_ready로 변경될 때는 항상 업데이트 (이전 경기 정보가 남아있을 수 있음)
                        const shouldUpdate = isTransitionFromRoundComplete ||
                            !initialMatchPlayersSetRef.current || 
                            initialMatchPlayers.p1?.id !== p1?.id || 
                            initialMatchPlayers.p2?.id !== p2?.id ||
                            conditionChanged ||
                            // rounds가 변경되었을 때도 업데이트 (다음 라운드 대진표가 생성되었을 때)
                            (tournament.type !== 'neighborhood' && safeRounds.length > 0);
                        
                        if (shouldUpdate) {
                            setInitialMatchPlayers({
                                p1: p1 ? createPlayerCopy(p1) : null,
                                p2: p2 ? createPlayerCopy(p2) : null,
                            });
                            initialMatchPlayersSetRef.current = true;
                        }
                    }
                } else {
                    // 다음 경기가 없으면 마지막 완료된 경기의 선수 정보 유지
                    const lastFinishedUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
                    if (lastFinishedUserMatch) {
                        const p1 = tournament.players.find(p => p.id === lastFinishedUserMatch.players[0]?.id) || null;
                        const p2 = tournament.players.find(p => p.id === lastFinishedUserMatch.players[1]?.id) || null;
                        if (p1 || p2) {
                            const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                                const statsToUse = player.originalStats || player.stats;
                                return {
                                    ...player,
                                    stats: statsToUse ? { ...statsToUse } : player.stats,
                                    originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                                };
                            };
                            
                            const shouldUpdate = !initialMatchPlayersSetRef.current || 
                                initialMatchPlayers.p1?.id !== p1?.id || 
                                initialMatchPlayers.p2?.id !== p2?.id;
                            
                            if (shouldUpdate) {
                                setInitialMatchPlayers({
                                    p1: p1 ? createPlayerCopy(p1) : null,
                                    p2: p2 ? createPlayerCopy(p2) : null,
                                });
                                initialMatchPlayersSetRef.current = true;
                            }
                        }
                    } else {
                        // 완료된 경기도 없으면 초기화하지 않음 (이전 정보 유지)
                    }
                }
            }
        }
    
        prevStatusRef.current = status;
    }, [tournament?.status, tournament?.type, safeRounds]);
    
    // nextRoundTrigger가 변경되면 다음 경기의 선수 정보를 강제로 업데이트
    useEffect(() => {
        if (nextRoundTrigger > 0 && tournament.status === 'bracket_ready') {
            // 다음 경기 찾기
            let nextMatch: Match | undefined = undefined;
            if (tournament.type === 'neighborhood') {
                const currentRound = tournament.currentRoundRobinRound || 1;
                const currentRoundObj = safeRounds.find(r => r.name === `${currentRound}회차`);
                if (currentRoundObj) {
                    nextMatch = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                }
            } else {
                // 전국/월드챔피언십: 다음 경기 찾기
                nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
            }
            
            if (nextMatch) {
                const p1 = tournament.players.find(p => p.id === nextMatch.players[0]?.id) || null;
                const p2 = tournament.players.find(p => p.id === nextMatch.players[1]?.id) || null;
                if (p1 || p2) {
                    const createPlayerCopy = (player: PlayerForTournament): PlayerForTournament => {
                        const statsToUse = player.originalStats || player.stats;
                        return {
                            ...player,
                            stats: statsToUse ? { ...statsToUse } : player.stats,
                            originalStats: player.originalStats ? { ...player.originalStats } : (player.stats ? { ...player.stats } : undefined)
                        };
                    };
                    
                    // nextRoundTrigger가 변경되었으므로 강제로 업데이트
                    setInitialMatchPlayers({
                        p1: p1 ? createPlayerCopy(p1) : null,
                        p2: p2 ? createPlayerCopy(p2) : null,
                    });
                    initialMatchPlayersSetRef.current = true;
                }
            }
        }
    }, [nextRoundTrigger, tournament.status, tournament.type, tournament.players, safeRounds]);
    
    const handleBackClickRaw = useCallback(() => {
        if (tournament.status === 'round_in_progress') {
            if (window.confirm('경기가 진행 중입니다. 현재 경기를 기권하시겠습니까? 현재 경기는 패배 처리됩니다.')) {
                onAction({ type: 'FORFEIT_CURRENT_MATCH', payload: { type: tournament.type } });
            }
        } else {
            onBack();
        }
    }, [onBack, onAction, tournament.status, tournament.type]);

    const handleForfeitClickRaw = useCallback(() => {
        if (window.confirm('토너먼트를 포기하고 나가시겠습니까? 오늘의 참가 기회는 사라집니다.')) {
            onAction({ type: 'FORFEIT_TOURNAMENT', payload: { type: tournament.type } });
        }
    }, [onAction, tournament.type]);

    // 버튼 클릭 스로틀링 적용
    const { onClick: handleBackClick } = useButtonClickThrottle(handleBackClickRaw);
    const { onClick: handleForfeitClick } = useButtonClickThrottle(handleForfeitClickRaw);

    // 경기가 진행 중이거나, 경기가 막 끝났지만 아직 서버에서 상태가 업데이트되지 않은 경우
    // currentSimulatingMatch가 있으면 시뮬레이션 중으로 간주
    const isSimulating = displayTournament.status === 'round_in_progress' || 
        (displayTournament.currentSimulatingMatch !== null && displayTournament.currentSimulatingMatch !== undefined);
    const currentSimMatch = displayTournament.currentSimulatingMatch 
        ? safeRounds[displayTournament.currentSimulatingMatch.roundIndex]?.matches[displayTournament.currentSimulatingMatch.matchIndex] || null
        : null;
        
    const lastFinishedUserMatch = useMemo(() => {
        return [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
    }, [safeRounds]);
    
    // 경기 종료 화면 유지 로직
    const matchForDisplay = useMemo(() => {
        if (isSimulating) {
            return currentSimMatch;
        }
        
        // round_complete 상태일 때는 마지막 완료된 경기 화면을 그대로 유지
        // (전국바둑대회, 월드챔피언십, 동네바둑리그 모두 동일하게 처리)
        if (tournament.status === 'round_complete') {
            // lastFinishedUserMatch가 있으면 우선적으로 사용
            if (lastFinishedUserMatch) {
                return lastFinishedUserMatch;
            }
            // lastFinishedUserMatch가 없으면 완료된 경기 중 첫 번째 찾기
            const finishedMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
            if (finishedMatch) {
                return finishedMatch;
            }
        }
        
        // bracket_ready 상태일 때는 다음 경기를 표시 (경기 시작 버튼이 표시됨)
        // 동네바둑리그의 경우 다음 회차의 경기를 표시해야 함
        if (tournament.status === 'bracket_ready') {
            // 동네바둑리그: 현재 회차의 다음 경기를 찾기
            if (tournament.type === 'neighborhood') {
                const currentRound = tournament.currentRoundRobinRound || 1;
                const currentRoundObj = safeRounds.find(r => r.name === `${currentRound}회차`);
                if (currentRoundObj) {
                    const nextMatch = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                    if (nextMatch) {
                        return nextMatch;
                    }
                }
            } else {
                // 전국/월드챔피언십: 다음 경기 찾기
                const nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
                if (nextMatch) {
                    return nextMatch;
                }
            }
            // 다음 경기가 없으면 마지막 완료된 경기 표시
            if (lastFinishedUserMatch) {
                return lastFinishedUserMatch;
            }
            // 완료된 경기 찾기
            const finishedMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
            if (finishedMatch) {
                return finishedMatch;
            }
        }
        
        // 그 외의 경우: 다음 경기, 마지막 완료된 경기, 또는 첫 경기 순서로 표시
        const nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
        if (nextMatch) {
            return nextMatch;
        }
        if (lastFinishedUserMatch) {
            return lastFinishedUserMatch;
        }
        const anyFinishedMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
        if (anyFinishedMatch) {
            return anyFinishedMatch;
        }
        const anyUserMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch);
        if (anyUserMatch) {
            return anyUserMatch;
        }
        return safeRounds[0]?.matches[0] || null;
    }, [isSimulating, currentSimMatch, tournament.status, safeRounds, lastFinishedUserMatch]);
    
    // 유저의 다음 경기 찾기 (경기 시작 전 상태 확인용)
    const upcomingUserMatch = useMemo(() => {
        return safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
    }, [safeRounds]);

    // 현재 유저의 컨디션 찾기
    const userPlayer = useMemo(() => {
        if (!tournament || !Array.isArray(tournament.players) || !currentUser?.id) {
            return undefined;
        }
        return tournament.players.find(p => p.id === currentUser.id);
    }, [tournament?.players, currentUser?.id]);
    
    const winner = useMemo(() => {
        if (!tournament || tournament.status !== 'complete') return null;
        if (!Array.isArray(tournament.players) || safeRounds.length === 0) return null;
        
        if (tournament.type === 'neighborhood') {
             const wins: Record<string, number> = {};
            tournament.players.forEach(p => wins[p.id] = 0);
            if (safeRounds[0]?.matches) {
                safeRounds[0].matches.forEach(m => { if(m.winner) wins[m.winner.id]++; });
            }
            return [...tournament.players].sort((a,b) => wins[b.id] - wins[a.id])[0];
        } else {
            const finalMatch = safeRounds.find(r => r.name === '결승');
            return finalMatch?.matches[0]?.winner;
        }
    }, [tournament?.status, tournament?.type, tournament?.players, safeRounds]);
    
    const myResultText = useMemo(() => {
        if (!tournament || !currentUser?.id) return '';
        if (tournament.status === 'complete' || tournament.status === 'eliminated') {
            if (tournament.type === 'neighborhood') {
                if (!Array.isArray(tournament.players) || safeRounds.length === 0) return '';
                const allMyMatches = safeRounds.flatMap(r => r.matches).filter(m => m.isUserMatch && m.isFinished);
                const winsCount = allMyMatches.filter(m => m.winner?.id === currentUser.id).length;
                const lossesCount = allMyMatches.length - winsCount;

                const playerWins: Record<string, number> = {};
                tournament.players.forEach(p => { playerWins[p.id] = 0; });
                if (safeRounds[0]?.matches) {
                    safeRounds[0].matches.forEach(m => {
                        if (m.winner) playerWins[m.winner.id] = (playerWins[m.winner.id] || 0) + 1;
                    });
                }

                const sortedPlayers = [...tournament.players].sort((a, b) => playerWins[b.id] - playerWins[a.id]);
                let myRank = -1; let currentRankValue = 1;
                for (let i = 0; i < sortedPlayers.length; i++) {
                    if (i > 0 && playerWins[sortedPlayers[i].id] < playerWins[sortedPlayers[i-1].id]) currentRankValue = i + 1;
                    if (sortedPlayers[i].id === currentUser.id) { myRank = currentRankValue; break; }
                }
                return `${winsCount}승 ${lossesCount}패! ${myRank}위`;
            }

            if (winner?.id === currentUser.id) return "🏆 우승!";

            const lastUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
            if (lastUserMatch) {
                const roundOfLastMatch = safeRounds.find(r => r.matches.some(m => m.id === lastUserMatch.id));
                if (roundOfLastMatch?.name === '결승') return "준우승!";

                if (roundOfLastMatch?.name === '4강') {
                    const thirdPlaceMatch = safeRounds.flatMap(r => r.matches).find(m => {
                        const round = safeRounds.find(r => r.matches.some(match => match.id === m.id));
                        return m.isUserMatch && round?.name === '3,4위전';
                    });
                    if (thirdPlaceMatch) {
                        const won3rdPlace = thirdPlaceMatch.winner?.id === currentUser.id;
                        return won3rdPlace ? "3위" : "4위";
                    }
                }
                return `${roundOfLastMatch?.name || ''}에서 탈락`;
            }
            return "토너먼트 탈락";
        }

        if (tournament.status === 'round_complete' || tournament.status === 'bracket_ready') {
            const lastFinishedUserMatch = [...safeRounds].reverse().flatMap(r => r.matches).find(m => m.isUserMatch && m.isFinished);
            if (lastFinishedUserMatch) {
                const userWonLastMatch = lastFinishedUserMatch.winner?.id === currentUser.id;
                if (tournament.type === 'neighborhood') {
                    const allMyMatches = safeRounds.flatMap(r => r.matches).filter(m => m.isUserMatch && m.isFinished);
                    const wins = allMyMatches.filter(m => m.winner?.id === currentUser.id).length;
                    const losses = allMyMatches.length - wins;
                    return `${allMyMatches.length}차전 ${userWonLastMatch ? '승리' : '패배'}! (${wins}승 ${losses}패)`;
                } else if (userWonLastMatch) {
                    const nextUnplayedRound = safeRounds.find(r => r.matches.some(m => !m.isFinished && m.players.some(p => p?.id === currentUser.id)));
                    if (nextUnplayedRound) return `${nextUnplayedRound.name} 진출!`;
                }
            }
        }
        
        const currentRound = safeRounds.find(r => r.matches.some(m => m.isUserMatch && !m.isFinished));
        return currentRound ? `${currentRound.name} 진행 중` : "대회 준비 중";
    }, [currentUser.id, tournament, winner, safeRounds]);
    
    const p1_from_match = matchForDisplay?.players?.[0] || null;
    const p2_from_match = matchForDisplay?.players?.[1] || null;

    const p1 = p1_from_match && Array.isArray(displayTournament?.players) 
        ? displayTournament.players.find(p => p.id === p1_from_match.id) || p1_from_match 
        : null;
    const p2 = p2_from_match && Array.isArray(displayTournament?.players) 
        ? displayTournament.players.find(p => p.id === p2_from_match.id) || p2_from_match 
        : null;

    // 경기 시작 전에는 홈 화면과 동일한 능력치 계산 (calculateTotalStats 사용)
    // 경기 중에는 player.stats를 사용 (컨디션으로 인한 변화 반영)
    const p1Stats = useMemo(() => {
        if (!displayTournament) return {};
        if (displayTournament.status === 'round_in_progress') {
            return p1?.stats || {};
        }
        if (p1?.originalStats) {
            return p1.originalStats;
        }
            const p1User = allUsersForRanking.find(u => u.id === p1?.id);
            if (p1User) {
                return calculateTotalStats(p1User);
            }
            return p1?.stats || {};
    }, [p1?.stats, p1?.originalStats, p1?.id, displayTournament?.status, allUsersForRanking]);

    const p2Stats = useMemo(() => {
        if (!displayTournament) return {};
        if (displayTournament.status === 'round_in_progress') {
            return p2?.stats || {};
        }
        if (p2?.originalStats) {
            return p2.originalStats;
        }
            const p2User = allUsersForRanking.find(u => u.id === p2?.id);
            if (p2User) {
                return calculateTotalStats(p2User);
            }
            return p2?.stats || {};
    }, [p2?.stats, p2?.originalStats, p2?.id, displayTournament?.status, allUsersForRanking]);

    const radarDatasets = useMemo(() => [
        { stats: p1Stats, color: '#60a5fa', fill: 'rgba(59, 130, 246, 0.4)' },
        { stats: p2Stats, color: '#f87171', fill: 'rgba(239, 68, 68, 0.4)' },
    ], [p1Stats, p2Stats]);

    const maxStatValue = useMemo(() => {
        if (!p1Stats || !p2Stats || Object.keys(p1Stats).length === 0 || Object.keys(p2Stats).length === 0) {
            return 200; // A reasonable default
        }
        const allStats: number[] = [
            ...(Object.values(p1Stats) as number[]),
            ...(Object.values(p2Stats) as number[])
        ];
        const maxStat = Math.max(...allStats, 0);
        return Math.ceil((maxStat + 50) / 50) * 50; // Round up to nearest 50
    }, [p1Stats, p2Stats]);

    const currentPhase = useMemo((): 'early' | 'mid' | 'end' | 'none' => {
        if (!displayTournament || displayTournament.status !== 'round_in_progress') return 'none';
        const time = displayTournament.timeElapsed || 0;
        if (time <= 15) return 'early';
        if (time <= 35) return 'mid';
        if (time <= 50) return 'end';
        return 'none';
    }, [displayTournament?.timeElapsed, displayTournament?.status]);

    // 서버에서 매초 누적된 능력치 점수를 가져옴
    // 초반(1-15초): 초반전 능력치 합계 누적
    // 중반(16-35초): 중반전 능력치 합계 누적
    // 종반(36-50초): 종반전 능력치 합계 누적
    const p1Cumulative = displayTournament?.currentMatchScores?.player1 || 0;
    const p2Cumulative = displayTournament?.currentMatchScores?.player2 || 0;
    const totalCumulative = p1Cumulative + p2Cumulative;
    
    // 누적 점수를 비율로 변환하여 그래프에 표시
    const p1Percent = totalCumulative > 0 ? (p1Cumulative / totalCumulative) * 100 : 50;
    const p2Percent = totalCumulative > 0 ? (p2Cumulative / totalCumulative) * 100 : 50;

    const renderFooterButton = () => {
        if (!tournament) return null;
        
        const { status } = tournament;

        if (status === 'round_in_progress') {
            return (
                <Button disabled colorScheme="green" className="!text-sm !py-2 !px-4">경기 진행 중...</Button>
            );
        }
        
        if (status === 'complete') {
            return null; // 이미 헤더에 뒤로가기 버튼이 있으므로 버튼 제거
        }

        if (status === 'eliminated') {
            return null; // 이미 헤더에 뒤로가기 버튼이 있으므로 버튼 제거
        }

        // "다음 경기" 버튼 제거 - 자동 진행으로 대체됨

        const hasUnfinishedUserMatch = safeRounds.some(r =>
            Array.isArray(r?.matches) && r.matches.some(m => m.isUserMatch && !m.isFinished)
        );

        if ((status === 'round_complete' || status === 'bracket_ready') && hasUnfinishedUserMatch) {
            // 다음 경기의 선수 정보가 준비되었는지 확인
            let nextMatch: Match | undefined = undefined;
            if (tournament.type === 'neighborhood') {
                const currentRound = tournament.currentRoundRobinRound || 1;
                const currentRoundObj = safeRounds.find(r => r.name === `${currentRound}회차`);
                if (currentRoundObj) {
                    nextMatch = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                }
            } else {
                nextMatch = safeRounds.flatMap(r => r.matches).find(m => m.isUserMatch && !m.isFinished);
            }
            
            // 선수 정보 준비 여부 확인
            const p1 = nextMatch && Array.isArray(tournament.players) 
                ? tournament.players.find(p => p.id === nextMatch.players[0]?.id) 
                : null;
            const p2 = nextMatch && Array.isArray(tournament.players) 
                ? tournament.players.find(p => p.id === nextMatch.players[1]?.id) 
                : null;
            const playersReady = p1 && p2 && p1.stats && p2.stats && 
                                 Object.keys(p1.stats).length > 0 && Object.keys(p2.stats).length > 0;
            
            if (!playersReady) {
                return (
                    <>
                        <Button 
                            disabled
                            colorScheme="gray" 
                            className="!text-sm !py-2 !px-4 cursor-not-allowed opacity-50"
                        >
                            다음 상대를 기다리는 중...
                        </Button>
                    </>
                );
            }
            
            return (
                <>
                    <Button 
                        onClick={() => onAction({ type: 'START_TOURNAMENT_MATCH', payload: { type: tournament.type } })} 
                        colorScheme="green" 
                        className="animate-pulse !text-sm !py-2 !px-4"
                    >
                        경기 시작
                    </Button>
                </>
            );
        }
        
        // 시뮬레이션이 끝나고 경기가 초기화되기 전에 다시 입장한 경우, 버튼을 표시하지 않음 (나가기 전 화면과 동일)
        // This is the default case, meaning user's matches are done but tournament isn't 'complete' or 'eliminated'
        return null;
    };

    const footerButtons = renderFooterButton();
    
    // 자동 다음 경기 카운트다운 표시
    // 경기가 진행 중일 때는 "경기 진행중" 표시
    const countdownDisplay = tournament?.status === 'round_in_progress' ? (
        <div className="flex items-center justify-center gap-2 text-blue-400 font-bold text-lg">
            <span>경기 진행중</span>
        </div>
    ) : autoNextCountdown !== null ? (
        <div className="flex items-center justify-center gap-2 text-yellow-400 font-bold text-lg">
            <span>다음 경기 {autoNextCountdown}초 뒤 시작...</span>
        </div>
    ) : null;

    const sidebarContent = (
        <div className="h-full w-full flex flex-col" style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            {/* 대진표/라운드 뷰어 - 스크롤 가능 영역 (버튼 패널 공간 확보) */}
            <div 
                className="overflow-y-auto" 
                style={{ 
                    flex: footerButtons ? '1 1 0' : '1 1 auto', 
                    minHeight: 0, 
                    maxHeight: footerButtons ? 'calc(100% - 100px)' : '100%',
                    overflowY: 'auto', 
                    overflowX: 'hidden', 
                    width: '100%',
                    WebkitOverflowScrolling: 'touch'
                }}
            >
            {tournament.type === 'neighborhood' ? (
                <RoundRobinDisplay tournamentState={tournament} currentUser={currentUser} />
            ) : (
                <TournamentRoundViewer 
                    rounds={safeRounds} 
                    currentUser={currentUser} 
                    tournamentType={tournament.type} 
                    tournamentState={tournament}
                    nextRoundTrigger={nextRoundTrigger}
                    nextRoundStartTime={tournament.nextRoundStartTime}
                />
            )}
            </div>
            {/* 버튼 패널 - 대진표 하단에 고정된 작은 패널 */}
            {(footerButtons || countdownDisplay) && (
                <div 
                    className="flex-shrink-0 bg-gray-800/95 rounded-lg p-2 sm:p-3 mt-2 mb-2 border-2 border-gray-600 shadow-xl flex items-center justify-center" 
                    style={{ 
                        flexShrink: 0, 
                        flexGrow: 0, 
                        width: '100%', 
                        minHeight: '60px',
                        maxHeight: '90px',
                        position: 'relative',
                        zIndex: 10,
                        marginTop: '8px',
                        marginBottom: '8px'
                    }}
                >
                    <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap h-full w-full">
                        {countdownDisplay || footerButtons}
                    </div>
                </div>
            )}
        </div>
    );

    const mainContent = (
        <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col lg:flex-row gap-2 ${isMobile ? '' : 'min-h-0 overflow-hidden'}`} style={isMobile ? {} : { height: '100%', display: 'flex' }}>
            <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col gap-2 ${isMobile ? '' : 'min-h-0 min-w-0 overflow-hidden'}`}>
                {/* 플레이어 프로필 섹션 */}
                {matchForDisplay && (p1 || p2) ? (
                    <section className={`flex-shrink-0 flex flex-row gap-1 md:gap-2 items-stretch p-1.5 md:p-2 bg-gray-800/50 rounded-lg ${isMobile ? 'mt-2 mb-2' : 'h-[280px] md:h-[300px]'} ${isMobile ? '' : 'overflow-hidden'}`} style={isMobile ? {} : { minHeight: '280px', maxHeight: '280px' }}>
                        <div ref={p1ProfileRef} className="flex-1 min-w-0 min-h-0 overflow-hidden">
                            <PlayerProfilePanelErrorBoundary>
                                <PlayerProfilePanel 
                                    player={p1} 
                                    initialPlayer={initialMatchPlayers.p1} 
                                    allUsers={allUsersForRanking} 
                                    currentUserId={currentUser.id} 
                                    onViewUser={onViewUser} 
                                    highlightPhase={currentPhase}
                                    isUserMatch={(currentSimMatch?.isUserMatch || (upcomingUserMatch && upcomingUserMatch.players.some(p => p?.id === p1?.id))) || false}
                                    onUseConditionPotion={() => {
                                        setShowConditionPotionModal(true);
                                    }}
                                    timeElapsed={tournament.timeElapsed}
                                    tournamentStatus={tournament.status}
                                    isMobile={isMobile}
                                />
                            </PlayerProfilePanelErrorBoundary>
                        </div>
                        {!isMobile && (
                            <div className="flex-shrink-0 w-32 sm:w-40 md:w-44 xl:w-52 flex flex-col items-center justify-center min-w-0">
                                <RadarChart datasets={radarDatasets} maxStatValue={maxStatValue} size={isMobile ? 120 : undefined} />
                                <div className="flex justify-center gap-1 sm:gap-2 text-[9px] sm:text-[10px] md:text-xs mt-1">
                                    <span className="flex items-center gap-0.5"><div className="w-2 h-2 sm:w-2.5 sm:h-2.5 md:w-3 md:h-3 rounded-sm" style={{backgroundColor: 'rgba(59, 130, 246, 0.6)'}}></div><span className="truncate max-w-[40px] sm:max-w-none">{p1?.nickname || '선수 1'}</span></span>
                                    <span className="flex items-center gap-0.5"><div className="w-2 h-2 sm:w-2.5 sm:h-2.5 md:w-3 md:h-3 rounded-sm" style={{backgroundColor: 'rgba(239, 68, 68, 0.6)'}}></div><span className="truncate max-w-[40px] sm:max-w-none">{p2?.nickname || '선수 2'}</span></span>
                                </div>
                            </div>
                        )}
                        <div ref={p2ProfileRef} className="flex-1 min-w-0 min-h-0 overflow-hidden">
                            <PlayerProfilePanelErrorBoundary>
                                <PlayerProfilePanel 
                                    player={p2} 
                                    initialPlayer={initialMatchPlayers.p2} 
                                    allUsers={allUsersForRanking} 
                                    currentUserId={currentUser.id} 
                                    onViewUser={onViewUser} 
                                    highlightPhase={currentPhase}
                                    isUserMatch={(currentSimMatch?.isUserMatch || (upcomingUserMatch && upcomingUserMatch.players.some(p => p?.id === p2?.id))) || false}
                                    onUseConditionPotion={() => {
                                        setShowConditionPotionModal(true);
                                    }}
                                    timeElapsed={tournament.timeElapsed}
                                    tournamentStatus={tournament.status}
                                    isMobile={isMobile}
                                />
                            </PlayerProfilePanelErrorBoundary>
                        </div>
                    </section>
                ) : (
                    // matchForDisplay가 null이거나 플레이어가 없는 경우 로딩 화면 표시
                    <section className={`flex-shrink-0 flex flex-row gap-1 md:gap-2 items-stretch p-1.5 md:p-2 bg-gray-800/50 rounded-lg ${isMobile ? 'mt-2 mb-2' : 'h-[280px] md:h-[300px]'} ${isMobile ? '' : 'overflow-hidden'}`} style={isMobile ? {} : { minHeight: '280px', maxHeight: '280px' }}>
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                            경기 정보를 불러오는 중...
                        </div>
                    </section>
                )}
                
                {/* SGF뷰어 및 중계패널 섹션 */}
                <div className={`${isMobile ? 'w-full mt-4' : 'flex-1'} flex ${isMobile ? 'flex-col' : 'flex-row'} gap-2 ${isMobile ? '' : 'min-h-0 max-h-full overflow-hidden'}`}>
                    {/* SGF뷰어 */}
                    <div 
                        className={`${isMobile ? 'flex-shrink-0' : 'lg:w-2/5'} bg-gray-800/50 rounded-lg p-1 md:p-2 flex flex-col items-center justify-center overflow-auto relative`}
                        style={isMobile ? { 
                            height: sgfViewerSize === 25 ? '30vh' : '50vh',
                            minHeight: '200px',
                            maxHeight: 'none'
                        } : undefined}
                    >
                        <div className="flex-1 w-full flex items-center justify-center min-h-0 relative">
                            {isMobile && (
                                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex gap-1 opacity-50 hover:opacity-100 transition-opacity">
                                    {([
                                        { value: 25, label: '50%' },
                                        { value: 50, label: '100%' }
                                    ] as const).map(({ value, label }) => (
                                        <button
                                            key={value}
                                            onClick={() => setSgfViewerSize(value)}
                                            className={`px-2 py-1 text-xs rounded transition-colors ${
                                                sgfViewerSize === value
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-700/80 text-gray-300 hover:bg-gray-600/80'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <SgfViewer 
                                timeElapsed={
                                    isSimulating 
                                        ? (displayTournament.timeElapsed || 0)
                                        : (tournament.status === 'round_complete' || tournament.status === 'complete' || tournament.status === 'eliminated')
                                            ? 50 // 경기 종료 후에는 마지막 시간(50초)으로 고정하여 모든 수 표시
                                            : 0
                                } 
                                fileIndex={
                                    isSimulating 
                                        ? currentSimMatch?.sgfFileIndex 
                                        : (() => {
                                            // round_complete 상태일 때는 마지막 완료된 경기의 SGF 표시 (경기 종료 화면 유지)
                                            if (tournament.status === 'round_complete') {
                                                return lastUserMatchSgfIndex !== null ? lastUserMatchSgfIndex : (matchForDisplay?.sgfFileIndex !== undefined ? matchForDisplay.sgfFileIndex : null);
                                            }
                                            // bracket_ready 상태일 때는 다음 경기가 있으면 그 경기의 SGF, 없으면 빈 바둑판 또는 마지막 완료된 경기
                                            if (tournament.status === 'bracket_ready') {
                                                if (upcomingUserMatch?.sgfFileIndex !== undefined) {
                                                    return upcomingUserMatch.sgfFileIndex;
                                                }
                                                // 다음 경기가 없으면 (마지막 경기였으면) 마지막 완료된 경기의 SGF 표시
                                                if (lastUserMatchSgfIndex !== null) {
                                                    return lastUserMatchSgfIndex;
                                                }
                                                return null;
                                            }
                                            // 그 외의 경우: 마지막 완료된 경기 또는 다음 경기
                                            return lastUserMatchSgfIndex !== null ? lastUserMatchSgfIndex : (matchForDisplay?.sgfFileIndex !== undefined ? matchForDisplay.sgfFileIndex : null);
                                        })()
                                }
                                showLastMoveOnly={!isSimulating && (tournament.status === 'round_complete' || tournament.status === 'complete' || tournament.status === 'eliminated')}
                            />
                        </div>
                    </div>
                    
                    {/* 중계패널 (점수 그래프 + 실시간 중계 + 획득 보상) */}
                    <div 
                        className={`${isMobile ? 'w-full' : 'w-full lg:w-3/5'} flex flex-col gap-2 ${isMobile ? '' : 'overflow-hidden'}`}
                        style={isMobile ? {} : { height: '100%', minHeight: 0 }}
                    >
                        <section className="flex-shrink-0 bg-gray-800/50 rounded-lg p-1.5 md:p-2">
                            <ScoreGraph 
                                p1Percent={p1Percent} 
                                p2Percent={p2Percent} 
                                p1Nickname={p1?.nickname} 
                                p2Nickname={p2?.nickname}
                                p1Cumulative={p1Cumulative}
                                p2Cumulative={p2Cumulative}
                                p1Player={p1}
                                p2Player={p2}
                                lastScoreIncrement={displayTournament.lastScoreIncrement}
                            />
                            <div className="mt-1.5"><SimulationProgressBar timeElapsed={displayTournament.timeElapsed} totalDuration={50} /></div>
                        </section>
                        {/* 실시간 중계 + 획득 보상 (가로 분할) */}
                        <div 
                            className={`${isMobile ? 'flex-col' : 'flex-row'} ${isMobile ? 'w-full' : 'flex-1 min-h-0'} gap-2 ${isMobile ? '' : 'overflow-hidden'}`}
                            style={isMobile ? {} : { display: 'flex' }}
                        >
                            {/* 왼쪽: 실시간 중계 (넓은 패널) */}
                            <div 
                                className={`${isMobile ? 'w-full' : 'flex-[2] min-w-0'} bg-gray-800/50 rounded-lg p-1 md:p-2 flex flex-col ${isMobile ? '' : 'overflow-hidden'}`}
                                style={isMobile ? { height: '400px', minHeight: '400px', maxHeight: '500px', display: 'flex', flexDirection: 'column' } : { display: 'flex', flexDirection: 'column' }}
                            >
                                <CommentaryPanel commentary={displayTournament.currentMatchCommentary} isSimulating={displayTournament.status === 'round_in_progress'} />
                            </div>
                            {/* 오른쪽: 획득 보상 (좁은 패널) */}
                            <div 
                                className={`${isMobile ? 'w-full' : 'flex-[1] min-w-0'} bg-gray-800/50 rounded-lg p-1 md:p-2 flex flex-col ${isMobile ? '' : 'overflow-hidden'}`}
                                style={isMobile ? { height: '400px', minHeight: '400px', maxHeight: '500px', display: 'flex', flexDirection: 'column' } : { display: 'flex', flexDirection: 'column' }}
                            >
                                <FinalRewardPanel tournamentState={tournament} currentUser={currentUser} onAction={onAction} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            {!isMobile && (
                <aside className="flex flex-col w-[320px] xl:w-[380px] flex-shrink-0 bg-gray-800 rounded-lg p-2 border-2 border-gray-600 shadow-lg" style={{ height: '100%', minHeight: 0, maxHeight: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {sidebarContent}
                </aside>
            )}
        </div>
    );
    
    return (
        <div className="w-full h-full flex flex-col gap-1 sm:gap-2 bg-gray-900 text-white relative overflow-hidden" style={{ height: '100%', minHeight: 0 }}>
            <header className="flex justify-between items-center p-2 sm:p-3 flex-shrink-0 border-b border-gray-700">
                <button onClick={handleBackClick} className="transition-transform active:scale-90 filter hover:drop-shadow-lg">
                    <img src="/images/button/back.png" alt="Back" className="w-10 h-10 sm:w-12 sm:h-12" loading="lazy" decoding="async" />
                </button>
                <div className="flex-1 text-center">
                    <h1 className="text-lg sm:text-xl lg:text-2xl font-bold">{TOURNAMENT_DEFINITIONS[tournament.type].name}</h1>
                </div>
                <button 
                    onClick={() => setIsSimulationHelpOpen(true)}
                    className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center transition-transform hover:scale-110"
                    aria-label="도움말"
                    title="도움말"
                >
                    <img src="/images/button/help.png" alt="도움말" className="w-full h-full" loading="lazy" decoding="async" />
                </button>
            </header>
            {isMobile ? (
                <>
                    <div className="flex-1 flex flex-col gap-1 sm:gap-2 min-h-0 relative overflow-y-auto p-1 sm:p-2 pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                        <div className="absolute top-1/2 -translate-y-1/2 right-2 z-20">
                            <button 
                                onClick={() => setIsMobileSidebarOpen(true)} 
                                className="w-8 h-12 bg-gray-800/80 backdrop-blur-sm rounded-l-lg flex items-center justify-center text-white shadow-lg hover:bg-gray-700/80"
                                aria-label="메뉴 열기"
                            >
                                <span className="relative font-bold text-lg">{'<<'}</span>
                            </button>
                        </div>
                        <div className="w-full pb-2" style={{ minHeight: 'min-content' }}>
                            {mainContent}
                        </div>
                    </div>
                    <div className={`fixed top-0 right-0 h-full w-[320px] bg-gray-800 shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`} style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                        <div className="flex justify-between items-center p-2 border-b border-gray-600 flex-shrink-0">
                            <h3 className="text-lg font-bold">대진표</h3>
                            <button onClick={() => setIsMobileSidebarOpen(false)} className="text-2xl font-bold text-gray-300 hover:text-white">×</button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-2 pt-2 pb-0" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {sidebarContent}
                        </div>
                    </div>
                    {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                </>
            ) : (
                <div className="flex-1 min-h-0 overflow-hidden p-1 sm:p-2 pb-2">
                    {mainContent}
                </div>
            )}
            {showConditionPotionModal && userPlayer && tournament && tournament.status !== 'complete' && tournament.status !== 'eliminated' && (
                <ConditionPotionModal
                    currentUser={currentUser}
                    currentCondition={userPlayer.condition}
                    onClose={() => setShowConditionPotionModal(false)}
                    onConfirm={(potionType) => {
                        if (tournament?.type) {
                            onAction({ type: 'USE_CONDITION_POTION', payload: { tournamentType: tournament.type, potionType } });
                        }
                    }}
                    isTopmost={true}
                />
            )}
            {isSimulationHelpOpen && <SimulationArenaHelpModal onClose={() => setIsSimulationHelpOpen(false)} />}
        </div>
    );
};