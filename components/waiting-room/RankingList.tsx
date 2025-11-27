import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { User, UserWithStatus, GameMode } from '../../types.js';
import Avatar from '../Avatar.js';
import { RANKING_TIERS, AVATAR_POOL, BORDER_POOL, SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../../constants';
import { useAppContext } from '../../hooks/useAppContext.js';
import { useRanking } from '../../hooks/useRanking.js';
import Button from '../Button.js';

interface RankingListProps {
    currentUser: UserWithStatus;
    mode: GameMode | 'strategic' | 'playful';
    onViewUser: (userId: string) => void;
    onShowTierInfo: () => void;
    onShowPastRankings: (info: { user: UserWithStatus; mode: GameMode | 'strategic' | 'playful' }) => void;
    lobbyType: 'strategic' | 'playful';
}

const getTier = (score: number, rank: number, totalGames: number) => {
    for (const tier of RANKING_TIERS) {
        if (tier.threshold(score, rank, totalGames)) {
            return tier;
        }
    }
    return RANKING_TIERS[RANKING_TIERS.length - 1];
};

const getCurrentSeasonName = () => {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = now.getMonth(); // 0-11
    let season;
    if (month < 3) season = 1;      // Jan, Feb, Mar
    else if (month < 6) season = 2; // Apr, May, Jun
    else if (month < 9) season = 3; // Jul, Aug, Sep
    else season = 4;                // Oct, Nov, Dec
    return `${year}-${season}시즌`;
};


const RankingList: React.FC<RankingListProps> = ({ currentUser, mode, onViewUser, onShowTierInfo, onShowPastRankings, lobbyType }) => {
    const rankingType = lobbyType === 'strategic' ? 'strategic' : 'playful';
    // 대기실에서는 시즌별 티어 랭킹 점수 사용 (매 시즌 시작일에 1200점 부여, 랭킹전을 통해 얻거나 잃은 점수)
    const { rankings, loading, error, total } = useRanking(rankingType, undefined, undefined, true);
    
    const allRankedUsers = useMemo(() => {
        return rankings.map(entry => ({
            id: entry.id,
            nickname: entry.nickname,
            avatarId: entry.avatarId,
            borderId: entry.borderId,
            avgScore: entry.score,
            rank: entry.rank,
            totalGames: entry.totalGames,
            wins: entry.wins,
            losses: entry.losses,
            league: entry.league,
            // User 타입 호환성을 위한 더미 필드
            stats: {} as any,
            dailyRankings: {} as any
        }));
    }, [rankings]);

    const eligibleRankedUsers = allRankedUsers.filter(u => u.totalGames >= 10);
    const totalEligiblePlayers = eligibleRankedUsers.length;
    const sproutTier = RANKING_TIERS[RANKING_TIERS.length - 1];

    const myRankIndex = allRankedUsers.findIndex(u => u.id === currentUser.id);
    const myRankData = myRankIndex !== -1 ? { 
        user: allRankedUsers[myRankIndex], 
        rank: allRankedUsers[myRankIndex].rank || (myRankIndex + 1), 
        score: allRankedUsers[myRankIndex].avgScore 
    } : null;

    // 페이지네이션: 초기 10명, 스크롤 시 10명씩 추가
    const [displayCount, setDisplayCount] = useState(10);
    const loadMoreRef = useRef<HTMLLIElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        // displayCount가 변경되면 observer 재설정
        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        if (loadMoreRef.current && displayCount < allRankedUsers.length) {
            observerRef.current = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        setDisplayCount(prev => Math.min(prev + 10, allRankedUsers.length));
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
    }, [displayCount, allRankedUsers.length]);

    // 탭 변경 시 displayCount 리셋
    useEffect(() => {
        setDisplayCount(10);
    }, [lobbyType]);

    const topUsers = allRankedUsers.slice(0, displayCount);

    const getTierForUser = useCallback((user: { id: string; avgScore: number; totalGames: number }) => {
        const rankAmongEligible = eligibleRankedUsers.findIndex(u => u.id === user.id) + 1;
        if (rankAmongEligible === 0) { // Should not happen if they are eligible, but as a fallback
            return sproutTier;
        }

        return getTier(user.avgScore, rankAmongEligible, user.totalGames);
    }, [eligibleRankedUsers, sproutTier]);


    const renderRankItem = useCallback((user: { id: string; nickname: string; avatarId: string; borderId: string; avgScore: number; totalGames: number; wins: number; losses: number }, rank: number, isMyRankDisplay: boolean) => {
        const wins = user.wins || 0;
        const losses = user.losses || 0;
        const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
        const score = user.avgScore;
        const tier = getTierForUser(user);
        
        const isCurrentUserInList = !isMyRankDisplay && user.id === currentUser.id;
        const baseClass = 'flex items-center gap-2 rounded-lg';
        const myRankClass = 'bg-yellow-900/40 border border-yellow-700';
        const highlightClass = 'bg-blue-900/60 border border-blue-600';
        const defaultClass = 'bg-tertiary/50';

        const isClickable = !isMyRankDisplay && user.id !== currentUser.id;
        const finalClass = `${baseClass} ${isMyRankDisplay ? myRankClass : (isCurrentUserInList ? highlightClass : defaultClass)} p-1.5 ${isClickable ? 'cursor-pointer hover:bg-secondary/50' : ''}`;
        const avatarUrl = AVATAR_POOL.find(a => a.id === user.avatarId)?.url;
        const borderUrl = BORDER_POOL.find(b => b.id === user.borderId)?.url;
        
        return (
            <li 
                key={user.id} 
                className={finalClass}
                onClick={isClickable ? () => onViewUser(user.id) : undefined}
                title={isClickable ? `${user.nickname} 프로필 보기` : ''}
            >
                <span className="w-8 text-center font-mono text-sm">{rank}</span>
                <img src={tier.icon} alt={tier.name} className="w-8 h-8 flex-shrink-0" title={tier.name}/>
                <Avatar userId={user.id} userName={user.nickname} size={32} avatarUrl={avatarUrl} borderUrl={borderUrl} />
                <div className="flex-grow overflow-hidden">
                    <p className="font-semibold text-sm truncate">{user.nickname}</p>
                    <p className="text-xs text-highlight font-mono">{Math.round(score)}점</p>
                </div>
                <div className="text-right text-[10px] lg:text-xs flex-shrink-0 w-20 text-tertiary">
                    <p>{wins}승 {losses}패</p>
                    <p className="font-semibold">{winRate}%</p>
                </div>
            </li>
        );
    }, [lobbyType, currentUser.id, getTierForUser, onViewUser]);

    const rankingTitle = lobbyType === 'strategic' ? '전략바둑 랭킹' : lobbyType === 'playful' ? '놀이바둑 랭킹' : `${mode} 랭킹`;

    return (
        <div className="p-4 flex flex-col text-on-panel">
            <div className="flex justify-between items-center mb-3 border-b border-color pb-2 flex-shrink-0 flex-wrap gap-2">
                <h2 className="text-xl font-semibold">{rankingTitle} ({getCurrentSeasonName()})</h2>
                <div className="flex items-center gap-2">
                    <Button 
                        onClick={() => onShowPastRankings({ user: currentUser, mode })}
                        colorScheme="none"
                        className="!text-xs !py-1 bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-700 hover:to-blue-600 text-white font-bold rounded-lg shadow-lg transition-all duration-200"
                    >
                        지난 랭킹
                    </Button>
                    <Button 
                        onClick={onShowTierInfo}
                        colorScheme="none"
                        className="!text-xs !py-1 bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-700 hover:to-blue-600 text-white font-bold rounded-lg shadow-lg transition-all duration-200"
                    >
                        티어 안내
                    </Button>
                </div>
            </div>
            
            {myRankData && (
                <div className="flex-shrink-0 mb-3">
                    {renderRankItem(myRankData.user, myRankData.rank, true)}
                </div>
            )}

            <ul className="space-y-2 overflow-y-auto pr-2 h-72">
                 {loading ? (
                     <p className="text-center text-tertiary pt-8">랭킹을 불러오는 중...</p>
                 ) : error ? (
                     <p className="text-center text-red-500 pt-8">랭킹을 불러오는데 실패했습니다.</p>
                 ) : topUsers.length > 0 ? (
                     <>
                         {topUsers.map((user) => {
                             const rank = user.rank || 1;
                             return renderRankItem(user, rank, false);
                         })}
                         {displayCount < allRankedUsers.length && (
                             <li ref={loadMoreRef} className="text-center text-tertiary py-2 text-xs">
                                 로딩 중...
                             </li>
                         )}
                     </>
                 ) : (
                     <p className="text-center text-tertiary pt-8">랭킹 정보가 없습니다.</p>
                 )}
            </ul>
        </div>
    );
};

export default RankingList;