import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useAppContext } from '../hooks/useAppContext.js';
import { LeagueTier, User, TournamentType } from '../types.js';
import { LEAGUE_DATA, RANKING_TIERS, AVATAR_POOL, BORDER_POOL, TOURNAMENT_DEFINITIONS } from '../constants';
import Avatar from './Avatar.js';
import LeagueTierInfoModal from './LeagueTierInfoModal.js';

interface RankItemProps {
    user: User;
    rank: number;
    isMyRankDisplay: boolean;
}

const RankItem: React.FC<RankItemProps> = ({ user, rank, isMyRankDisplay }) => {
    const { currentUserWithStatus, handlers } = useAppContext();
    if (!currentUserWithStatus) return null;

    const score = user.cumulativeTournamentScore || 0;

    const rankDisplay = useMemo(() => {
        if (rank === 1) return <span className="text-3xl" role="img" aria-label="Gold Trophy">🥇</span>;
        if (rank === 2) return <span className="text-3xl" role="img" aria-label="Silver Trophy">🥈</span>;
        if (rank === 3) return <span className="text-3xl" role="img" aria-label="Bronze Trophy">🥉</span>;
        return <span className="text-2xl font-bold text-gray-300">{rank}</span>;
    }, [rank]);

    const isCurrentUserInList = !isMyRankDisplay && user.id === currentUserWithStatus.id;
    const baseClass = 'flex items-center rounded-lg';
    const myRankClass = 'bg-yellow-900/40 border border-yellow-700';
    const highlightClass = 'bg-blue-900/60 border border-blue-600';
    const defaultClass = 'bg-gray-900/50';
    
    const isClickable = !isMyRankDisplay && user.id !== currentUserWithStatus.id;
    const finalClass = `${baseClass} ${isMyRankDisplay ? myRankClass : (isCurrentUserInList ? highlightClass : defaultClass)} p-1.5 lg:p-2 ${isClickable ? 'cursor-pointer hover:bg-gray-700/50' : ''}`;
    const avatarUrl = AVATAR_POOL.find(a => a.id === user.avatarId)?.url;
    const borderUrl = BORDER_POOL.find(b => b.id === user.borderId)?.url;

    return (
        <li
            className={finalClass}
            onClick={isClickable ? () => handlers.openViewingUser(user.id) : undefined}
            title={isClickable ? `${user.nickname} 프로필 보기` : ''}
        >
            <div className="w-12 text-center flex-shrink-0 flex flex-col items-center justify-center">
                {rankDisplay}
            </div>
            <Avatar userId={user.id} userName={user.nickname} size={32} avatarUrl={avatarUrl} borderUrl={borderUrl} />
            <div className="ml-2 lg:ml-3 flex-grow overflow-hidden">
                <p className="font-semibold text-sm truncate">{user.nickname}</p>
                <p className="text-xs text-yellow-400 font-mono">{score.toLocaleString()}점</p>
            </div>
        </li>
    );
};

const ChampionshipRankingPanel: React.FC = () => {
    const { currentUserWithStatus, allUsers, handlers } = useAppContext();
    const [selectedTab, setSelectedTab] = useState<TournamentType>('neighborhood');
    
    // 선택된 탭에 따른 랭킹 데이터 가져오기 (일일 랭킹 사용)
    const sortedUsers = useMemo(() => {
        if (!currentUserWithStatus) return [];
        
        // 일일 랭킹 데이터가 있으면 사용 (0시에 업데이트된 고정 랭킹)
        const usersWithRanking = allUsers
            .filter(u => {
                if (!u.dailyRankings?.championship?.[selectedTab]) return false;
                // 해당 던전 타입의 진행 상태가 있는 유저만 필터링
                if (!u.dungeonProgress || !u.dungeonProgress[selectedTab]) return false;
                const progress = u.dungeonProgress[selectedTab];
                return progress && progress.currentStage > 0;
            })
            .map(u => {
                const rankingData = u.dailyRankings!.championship![selectedTab]!;
                return {
                    user: u,
                    rank: rankingData.rank,
                    maxStage: rankingData.maxStage,
                    maxScoreDiff: rankingData.maxScoreDiff,
                    totalAbility: rankingData.totalAbility,
                };
            })
            .sort((a, b) => {
                // 랭킹 순서대로 정렬
                return a.rank - b.rank;
            })
            .map(entry => entry.user);
        
        // 일일 랭킹 데이터가 없으면 실시간 계산 (마이그레이션 기간)
        if (usersWithRanking.length === 0) {
            return [...allUsers]
                .filter(u => {
                    if (!u.dungeonProgress || !u.dungeonProgress[selectedTab]) return false;
                    const progress = u.dungeonProgress[selectedTab];
                    return progress && progress.currentStage > 0;
                })
                .map(u => {
                    const progress = u.dungeonProgress![selectedTab];
                    let maxStage = progress.currentStage || 0;
                    let maxScoreDiff = -Infinity;
                    
                    for (const [stage, result] of Object.entries(progress.stageResults || {})) {
                        if (result.cleared && parseInt(stage) === maxStage) {
                            if (result.scoreDiff > maxScoreDiff) {
                                maxScoreDiff = result.scoreDiff;
                            }
                        }
                    }
                    
                    let totalAbility = 0;
                    if (u.baseStats) {
                        totalAbility = Object.values(u.baseStats).reduce((sum, stat) => sum + (stat || 0), 0);
                    }
                    
                    return {
                        user: u,
                        maxStage,
                        maxScoreDiff: maxScoreDiff === -Infinity ? 0 : maxScoreDiff,
                        totalAbility,
                    };
                })
                .sort((a, b) => {
                    if (a.maxStage !== b.maxStage) {
                        return b.maxStage - a.maxStage;
                    }
                    if (a.maxScoreDiff !== b.maxScoreDiff) {
                        return b.maxScoreDiff - a.maxScoreDiff;
                    }
                    return b.totalAbility - a.totalAbility;
                })
                .map(entry => entry.user);
        }
        
        return usersWithRanking;
    }, [allUsers, currentUserWithStatus, selectedTab]);
    
    const myOwnRankData = useMemo(() => {
        if (!currentUserWithStatus) return { rank: -1, user: currentUserWithStatus, maxStage: 0, score: 0 };
        
        // 일일 랭킹 데이터 사용
        const rankingData = currentUserWithStatus.dailyRankings?.championship?.[selectedTab];
        let rank = -1;
        let maxStage = 0;
        let score = 0;
        
        if (rankingData) {
            rank = rankingData.rank;
            maxStage = rankingData.maxStage;
            // 점수 계산: 해당 던전 타입의 단계별 점수 합산
            const progress = currentUserWithStatus.dungeonProgress?.[selectedTab];
            if (progress && progress.stageResults) {
                for (const [stageStr, result] of Object.entries(progress.stageResults)) {
                    if (result.cleared && result.dailyScore) {
                        score += result.dailyScore;
                    }
                }
            }
        } else {
            // 일일 랭킹 데이터가 없으면 실시간 계산
            const myRankIndex = sortedUsers.findIndex(u => u.id === currentUserWithStatus.id);
            if (myRankIndex !== -1) {
                rank = myRankIndex + 1;
                const user = sortedUsers[myRankIndex];
                const progress = user.dungeonProgress?.[selectedTab];
                maxStage = progress?.currentStage || 0;
                
                // 점수 계산
                if (progress && progress.stageResults) {
                    for (const [stageStr, result] of Object.entries(progress.stageResults)) {
                        if (result.cleared && result.dailyScore) {
                            score += result.dailyScore;
                        }
                    }
                }
            } else {
                // 랭킹에 없으면 단계 정보만 확인
                const progress = currentUserWithStatus.dungeonProgress?.[selectedTab];
                maxStage = progress?.currentStage || 0;
                
                // 점수 계산
                if (progress && progress.stageResults) {
                    for (const [stageStr, result] of Object.entries(progress.stageResults)) {
                        if (result.cleared && result.dailyScore) {
                            score += result.dailyScore;
                        }
                    }
                }
            }
        }
        
        return { 
            rank, 
            user: currentUserWithStatus, 
            maxStage, 
            score 
        };
    }, [sortedUsers, currentUserWithStatus, selectedTab]);
    
    if (!currentUserWithStatus) {
        return (
             <div className="bg-gray-800 rounded-lg p-4 flex flex-col shadow-lg h-full min-h-0 items-center justify-center text-gray-500">
                랭킹 정보를 불러오는 중...
            </div>
        );
    }

    // 페이지네이션: 초기 10명, 스크롤 시 10명씩 추가
    const [displayCount, setDisplayCount] = useState(10);
    const loadMoreRef = useRef<HTMLLIElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        if (loadMoreRef.current && displayCount < sortedUsers.length) {
            observerRef.current = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        setDisplayCount(prev => Math.min(prev + 10, sortedUsers.length));
                    }
                },
                { threshold: 0.1 }
            );
            observerRef.current.observe(loadMoreRef.current);
        }

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [displayCount, sortedUsers.length]);

    const topUsers = sortedUsers.slice(0, displayCount);

    // 탭별 업데이트 시간 표시
    const getLastUpdatedText = () => {
        if (!currentUserWithStatus) return '';
        const rankingData = currentUserWithStatus.dailyRankings?.championship?.[selectedTab];
        if (rankingData && rankingData.lastUpdated) {
            const updateDate = new Date(rankingData.lastUpdated);
            const now = new Date();
            const isToday = updateDate.toDateString() === now.toDateString();
            if (isToday) {
                return '오늘 0시 업데이트';
            }
            return `${updateDate.getMonth() + 1}/${updateDate.getDate()} 0시 업데이트`;
        }
        return '업데이트 대기 중';
    };
    
    return (
        <div className="bg-gray-800 rounded-lg p-4 flex flex-col shadow-lg h-full min-h-0">
            <div className="flex justify-between items-center mb-3 border-b border-gray-700 pb-2 flex-shrink-0">
                <h2 className="text-xl font-bold">챔피언십 랭킹</h2>
                <span className="text-xs text-gray-400">{getLastUpdatedText()}</span>
            </div>
            
            {/* 탭 메뉴 */}
            <div className="flex gap-2 mb-3 flex-shrink-0">
                {(['neighborhood', 'national', 'world'] as TournamentType[]).map(type => (
                    <button
                        key={type}
                        onClick={() => setSelectedTab(type)}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                            selectedTab === type
                                ? 'bg-purple-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        {TOURNAMENT_DEFINITIONS[type].name}
                    </button>
                ))}
            </div>
            {/* 내 랭킹 - 항상 최상단에 표시 */}
            {myOwnRankData.user && (
              <div className="flex-shrink-0 mb-3">
                  <div className="flex items-center rounded-lg bg-yellow-900/40 border border-yellow-700 p-1.5 lg:p-2">
                      <div className="w-12 text-center flex-shrink-0 flex flex-col items-center justify-center">
                          {myOwnRankData.rank === -1 ? (
                              <span className="text-2xl font-bold text-gray-400">-</span>
                          ) : myOwnRankData.rank === 1 ? (
                              <span className="text-3xl">🥇</span>
                          ) : myOwnRankData.rank === 2 ? (
                              <span className="text-3xl">🥈</span>
                          ) : myOwnRankData.rank === 3 ? (
                              <span className="text-3xl">🥉</span>
                          ) : (
                              <span className="text-2xl font-bold text-gray-300">{myOwnRankData.rank}</span>
                          )}
                      </div>
                      <Avatar userId={myOwnRankData.user.id} userName={myOwnRankData.user.nickname} size={32} 
                              avatarUrl={AVATAR_POOL.find(a => a.id === myOwnRankData.user!.avatarId)?.url}
                              borderUrl={BORDER_POOL.find(b => b.id === myOwnRankData.user!.borderId)?.url} />
                      <div className="ml-2 lg:ml-3 flex-grow overflow-hidden">
                          <p className="font-semibold text-sm truncate">{myOwnRankData.user.nickname}</p>
                          <div className="flex gap-2 text-xs">
                              <span className="text-yellow-400">최고 {myOwnRankData.maxStage}단계</span>
                              <span className="text-blue-400">{myOwnRankData.score.toLocaleString()}점</span>
                          </div>
                      </div>
                  </div>
              </div>
            )}
            <ul className="space-y-2 overflow-y-auto pr-2 flex-grow min-h-0">
                 {topUsers.length > 0 ? (
                     <>
                         {topUsers
                             .filter(user => user.id !== currentUserWithStatus?.id) // 내 랭킹은 제외 (이미 위에 표시됨)
                             .map((user, index) => {
                             // 일일 랭킹 데이터 사용
                             const rankingData = user.dailyRankings?.championship?.[selectedTab];
                             let maxStage = 0;
                             let score = 0;
                             
                             if (rankingData) {
                                 maxStage = rankingData.maxStage;
                                 // 점수 계산
                                 const progress = user.dungeonProgress?.[selectedTab];
                                 if (progress && progress.stageResults) {
                                     for (const [stageStr, result] of Object.entries(progress.stageResults)) {
                                         if (result.cleared && result.dailyScore) {
                                             score += result.dailyScore;
                                         }
                                     }
                                 }
                             } else {
                                 // 일일 랭킹 데이터가 없으면 실시간 계산
                                 const progress = user.dungeonProgress?.[selectedTab];
                                 if (progress) {
                                     maxStage = progress.currentStage || 0;
                                     // 점수 계산
                                     if (progress.stageResults) {
                                         for (const [stageStr, result] of Object.entries(progress.stageResults)) {
                                             if (result.cleared && result.dailyScore) {
                                                 score += result.dailyScore;
                                             }
                                         }
                                     }
                                 }
                             }
                             
                             const rank = rankingData?.rank || (index + 1);
                             const rankDisplay = useMemo(() => {
                                 if (rank === 1) return <span className="text-3xl">🥇</span>;
                                 if (rank === 2) return <span className="text-3xl">🥈</span>;
                                 if (rank === 3) return <span className="text-3xl">🥉</span>;
                                 return <span className="text-2xl font-bold text-gray-300">{rank}</span>;
                             }, [rank]);
                             
                             const isCurrentUser = user.id === currentUserWithStatus?.id;
                             const avatarUrl = AVATAR_POOL.find(a => a.id === user.avatarId)?.url;
                             const borderUrl = BORDER_POOL.find(b => b.id === user.borderId)?.url;
                             const isClickable = !isCurrentUser;
                             
                             return (
                                 <li
                                     key={user.id}
                                     className={`flex items-center rounded-lg ${isCurrentUser ? 'bg-yellow-900/40 border border-yellow-700' : 'bg-gray-900/50'} p-1.5 lg:p-2 ${isClickable ? 'cursor-pointer hover:bg-gray-700/50' : ''}`}
                                     onClick={isClickable ? () => handlers.openViewingUser(user.id) : undefined}
                                     title={isClickable ? `${user.nickname} 프로필 보기` : ''}
                                 >
                                     <div className="w-12 text-center flex-shrink-0 flex flex-col items-center justify-center">
                                         {rankDisplay}
                                     </div>
                                     <Avatar userId={user.id} userName={user.nickname} size={32} avatarUrl={avatarUrl} borderUrl={borderUrl} />
                                     <div className="ml-2 lg:ml-3 flex-grow overflow-hidden">
                                         <p className="font-semibold text-sm truncate">{user.nickname}</p>
                                         <div className="flex gap-2 text-xs">
                                             <span className="text-yellow-400">최고 {maxStage}단계</span>
                                             <span className="text-blue-400">{score.toLocaleString()}점</span>
                                         </div>
                                     </div>
                                 </li>
                             );
                         })}
                         {displayCount < sortedUsers.length && (
                             <li ref={loadMoreRef} className="text-center text-gray-500 py-2 text-xs">
                                 로딩 중...
                             </li>
                         )}
                     </>
                 ) : (
                    <p className="text-center text-gray-500 pt-8">랭크된 유저가 없습니다.</p>
                 )}
            </ul>
        </div>
    );
};

export default ChampionshipRankingPanel;
