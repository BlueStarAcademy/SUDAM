import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { UserWithStatus, TournamentState, TournamentType, User, LeagueTier, EquipmentSlot, InventoryItem, CoreStat } from '../types.js';
import { TOURNAMENT_DEFINITIONS, AVATAR_POOL, LEAGUE_DATA, BORDER_POOL, GRADE_LEVEL_REQUIREMENTS, emptySlotImages } from '../constants';
import Avatar from './Avatar.js';
import { isSameDayKST } from '../utils/timeUtils.js';
import { useAppContext } from '../hooks/useAppContext.js';
import LeagueTierInfoModal from './LeagueTierInfoModal.js';
import QuickAccessSidebar from './QuickAccessSidebar.js';
import ChatWindow from './waiting-room/ChatWindow.js';
import PointsInfoPanel from './PointsInfoPanel.js';
import Button from './Button.js';
import { calculateUserEffects } from '../services/effectService.js';
import ChampionshipHelpModal from './ChampionshipHelpModal.js';
import ChampionshipRankingPanel from './ChampionshipRankingPanel.js';

const stringToSeed = (str: string): number => {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

const seededRandom = (seed: number): number => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
};

// WeeklyCompetitorsPanel 제거됨 - 던전 시스템으로 변경
const DungeonStageSelector: React.FC<{ dungeonType: TournamentType; currentUser: UserWithStatus; onSelectStage: (stage: number) => void }> = ({ dungeonType, currentUser, onSelectStage }) => {
    const dungeonProgress = currentUser?.dungeonProgress?.[dungeonType] || {
        currentStage: 0,
        unlockedStages: [1],
        stageResults: {},
        dailyStageAttempts: {},
    };
    
    return (
        <div className="bg-gray-800 rounded-lg p-4 flex flex-col shadow-lg h-full min-h-0">
            <h2 className="text-xl font-bold mb-3 border-b border-gray-700 pb-2 flex-shrink-0">
                {TOURNAMENT_DEFINITIONS[dungeonType].name} 단계 선택
            </h2>
            <div className="grid grid-cols-5 gap-2 overflow-y-auto flex-grow min-h-0">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(stage => {
                    const isUnlocked = dungeonProgress.unlockedStages.includes(stage);
                    const isCleared = dungeonProgress.stageResults[stage]?.cleared || false;
                    const isCurrentMax = stage === dungeonProgress.currentStage + 1;
                    
                    return (
                        <button
                            key={stage}
                            onClick={() => isUnlocked && onSelectStage(stage)}
                            disabled={!isUnlocked}
                            className={`p-3 rounded-lg text-center transition-all ${
                                isUnlocked
                                    ? isCurrentMax
                                        ? 'bg-purple-600 hover:bg-purple-700 cursor-pointer'
                                        : isCleared
                                        ? 'bg-green-800/50 hover:bg-green-700/50 cursor-pointer'
                                        : 'bg-gray-700 hover:bg-gray-600 cursor-pointer'
                                    : 'bg-gray-900/50 cursor-not-allowed opacity-50'
                            }`}
                        >
                            <div className="font-bold text-lg">{stage}단계</div>
                            {isCleared && <div className="text-xs text-green-400">✓</div>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const WeeklyCompetitorsPanel_DEPRECATED: React.FC<{ setHasRankChanged: (changed: boolean) => void }> = ({ setHasRankChanged }) => {
    const { currentUserWithStatus, allUsers, handlers } = useAppContext();
    const prevRankRef = useRef<number | null>(null);
    const [timeLeft, setTimeLeft] = useState('');

    const [currentKstDayStart, setCurrentKstDayStart] = useState(() => {
        const KST_OFFSET = 9 * 60 * 60 * 1000;
        const now = Date.now();
        const kstNow = new Date(now + KST_OFFSET);
        return new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()).getTime();
    });

    useEffect(() => {
        const KST_OFFSET = 9 * 60 * 60 * 1000;
        const timer = setInterval(() => {
            const now = Date.now();
            const kstNow = new Date(now + KST_OFFSET);
            const newKstDayStart = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()).getTime();
            if (newKstDayStart !== currentKstDayStart) {
                setCurrentKstDayStart(newKstDayStart);
            }
        }, 1000 * 60); // Check every minute
        return () => clearInterval(timer);
    }, [currentKstDayStart]);

    useEffect(() => {
        const calculateTimeLeft = () => {
            const now = new Date();
            const dayOfWeek = now.getDay();
            const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
            const nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday);
            nextMonday.setHours(0, 0, 0, 0);

            const diff = nextMonday.getTime() - now.getTime();
            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeLeft(`${d}D ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
        };
        calculateTimeLeft();
        const interval = setInterval(calculateTimeLeft, 1000);
        return () => clearInterval(interval);
    }, []);

    const liveCompetitors = useMemo(() => {
        if (!currentUserWithStatus?.weeklyCompetitors) {
            return [];
        }
    
        const KST_OFFSET = 9 * 60 * 60 * 1000;
    
        const lastUpdateTs = currentUserWithStatus.lastWeeklyCompetitorsUpdate || currentKstDayStart; // Use currentKstDayStart as fallback
        
        const startOfWeek = new Date(lastUpdateTs + KST_OFFSET);
        startOfWeek.setHours(0, 0, 0, 0);

        const diffTime = Math.max(0, currentKstDayStart - startOfWeek.getTime()); // Use currentKstDayStart here
        const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
        let competitors = (currentUserWithStatus.weeklyCompetitors).map(competitor => {
            if (competitor.id.startsWith('bot-')) {
                // 서버에 저장된 봇 점수 사용
                const botScoreData = currentUserWithStatus.weeklyCompetitorsBotScores?.[competitor.id];
                const liveScore = botScoreData?.score || 0;
                // 어제 점수를 기준으로 변화량 계산 (yesterdayScore가 없으면 0으로 간주)
                const yesterdayScore = botScoreData?.yesterdayScore ?? 0;
                const scoreChange = liveScore - yesterdayScore;
                return { ...competitor, liveScore, scoreChange };
            } else {
                const liveData = allUsers.find(u => u.id === competitor.id);
                // cumulativeTournamentScore를 사용하여 일주일 동안의 모든 경기장 점수 합계 표시
                const liveScore = liveData ? (liveData.cumulativeTournamentScore || 0) : competitor.initialScore;
                // 어제 점수를 기준으로 변화량 계산
                // yesterdayTournamentScore가 있으면 그것을 사용, 없으면 dailyRankings.championship.score를 사용
                // 둘 다 없으면 현재 점수를 어제 점수로 간주 (변화 없음)
                let yesterdayScore: number;
                if (liveData?.yesterdayTournamentScore !== undefined && liveData.yesterdayTournamentScore !== null) {
                    yesterdayScore = liveData.yesterdayTournamentScore;
                } else if (liveData?.dailyRankings?.championship?.score !== undefined) {
                    yesterdayScore = liveData.dailyRankings.championship.score;
                } else {
                    // 어제 점수가 없으면 현재 점수를 어제 점수로 간주 (변화 없음)
                    yesterdayScore = liveScore;
                }
                const scoreChange = liveScore - yesterdayScore;
                return { ...competitor, liveScore, scoreChange };
            }
        });

        // Add bots if less than 16 competitors
        const NUM_COMPETITORS = 16;
        if (competitors.length < NUM_COMPETITORS) {
            const botsToAdd = NUM_COMPETITORS - competitors.length;
            for (let i = 0; i < botsToAdd; i++) {
                const botId = `bot-${currentKstDayStart}-${i}`; // Use currentKstDayStart for bot ID to make it stable for the day
                const botSeed = stringToSeed(botId);
                // 봇들은 월요일 0시에 점수가 0으로 초기화되므로 initialScore를 0으로 설정
                const botInitialScore = 0;
                const randomAvatar = AVATAR_POOL[Math.floor(seededRandom(botSeed + 1) * AVATAR_POOL.length)];
                const randomBorder = BORDER_POOL[Math.floor(seededRandom(botSeed + 2) * BORDER_POOL.length)];

                // 서버에 저장된 봇 점수 사용 (없으면 0)
                const botScoreData = currentUserWithStatus.weeklyCompetitorsBotScores?.[botId];
                const liveScore = botScoreData?.score || 0;
                // 어제 점수를 기준으로 변화량 계산 (yesterdayScore가 없으면 0으로 간주)
                const yesterdayScore = botScoreData?.yesterdayScore ?? 0;
                const scoreChange = liveScore - yesterdayScore;

                // Static list of possible bot nicknames
                const botNicknames = [
                    "바둑사랑꾼", "묘수장인", "신의한수", "돌가루", "흑백의춤",
                    "고수킬러", "초읽기", "천재기사", "바둑왕", "행마의달인",
                    "돌의속삭임", "궁극의수", "침착맨", "승률100%", "패왕", "기성", "조훈현", "이창호", "알파고"
                ];

                let assignedNickname = `Bot ${i + 1}`;
                // Assign a nickname that hasn't been taken by other bots generated in this session
                const usedBotNicknames = competitors.filter(c => c.id.startsWith('bot-')).map(c => c.nickname);
                const availableNicknames = botNicknames.filter(name => !usedBotNicknames.includes(name));
                
                if (availableNicknames.length > 0) {
                    // Use a seeded random to pick a nickname from the available ones
                    const nicknameSeed = stringToSeed(botId + 'nickname');
                    assignedNickname = availableNicknames[Math.floor(seededRandom(nicknameSeed) * availableNicknames.length)];
                } else if (botNicknames.length > 0) {
                    // If all static nicknames are used, cycle through them or append a number
                    assignedNickname = `${botNicknames[i % botNicknames.length]} ${Math.floor(Math.random() * 100)}`;
                }

                competitors.push({
                    id: botId,
                    nickname: assignedNickname,
                    avatarId: randomAvatar.id,
                    borderId: randomBorder.id,
                    initialScore: botInitialScore,
                    liveScore: liveScore,
                    scoreChange: scoreChange,
                    league: currentUserWithStatus.league, // Bots should be in the current user's league
                });
            }
        }

        return competitors.sort((a, b) => b.liveScore - a.liveScore);
    }, [currentUserWithStatus?.weeklyCompetitors, currentUserWithStatus?.lastWeeklyCompetitorsUpdate, allUsers, currentKstDayStart]);


    useEffect(() => {
        if (!currentUserWithStatus) return;
        const myRank = liveCompetitors.findIndex(c => c.id === currentUserWithStatus.id) + 1;
        if (myRank > 0) {
            if (prevRankRef.current !== null && prevRankRef.current !== myRank) {
                setHasRankChanged(true);
            }
            prevRankRef.current = myRank;
        }
    }, [liveCompetitors, currentUserWithStatus, setHasRankChanged]);

    if (!currentUserWithStatus || !currentUserWithStatus.weeklyCompetitors || currentUserWithStatus.weeklyCompetitors.length === 0) {
        return (
             <div className="bg-gray-800 rounded-lg p-4 flex flex-col shadow-lg h-full min-h-0 items-center justify-center text-gray-500">
                주간 경쟁 상대 정보를 불러오는 중...
            </div>
        );
    }

    return (
         <div className="bg-gray-800 rounded-lg p-4 flex flex-col shadow-lg h-full min-h-0">
            <div className="flex-shrink-0 text-center mb-3 border-b border-gray-700 pb-2">
                <h2 className="text-xl font-bold">이번주 경쟁 상대</h2>
                <p className="text-sm text-yellow-300 font-mono">{timeLeft}</p>
            </div>
            <ul className="space-y-1.5 overflow-y-auto pr-2 flex-grow min-h-0">
                {liveCompetitors.map((competitor, index) => {
                    const rank = index + 1;
                    const isCurrentUser = competitor.id === currentUserWithStatus.id;
                    const scoreChangeColor = competitor.scoreChange > 0 ? 'text-green-400' : competitor.scoreChange < 0 ? 'text-red-400' : 'text-gray-400';
                    const scoreChangeSign = competitor.scoreChange > 0 ? '▲' : competitor.scoreChange < 0 ? '▼' : '변화없음';
                    
                    const avatarUrl = AVATAR_POOL.find(a => a.id === competitor.avatarId)?.url;
                    const borderUrl = BORDER_POOL.find(b => b.id === competitor.borderId)?.url;
                    const isClickable = !isCurrentUser && !competitor.id.startsWith('bot-');

                    return (
                        <li 
                            key={competitor.id} 
                            className={`flex items-center gap-3 p-1.5 rounded-md ${isCurrentUser ? 'bg-blue-900/50' : 'bg-gray-900/50'} ${isClickable ? 'transition-colors cursor-pointer hover:bg-gray-700/50' : ''}`}
                            onClick={isClickable ? () => handlers.openViewingUser(competitor.id) : undefined}
                            title={isClickable ? `${competitor.nickname} 프로필 보기` : ''}
                        >
                            <span className="font-bold text-lg w-6 text-center flex-shrink-0">{rank}</span>
                             <Avatar userId={competitor.id} userName={competitor.nickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={28} />
                            <span className="flex-grow font-semibold text-sm truncate">{competitor.nickname}</span>
                            <div className="flex items-baseline gap-1 text-xs">
                                <span className="font-mono text-yellow-300">{competitor.liveScore.toLocaleString()}</span>
                                <span className={scoreChangeColor}>
                                    {competitor.scoreChange === 0 ? `(${scoreChangeSign})` : `(${scoreChangeSign}${Math.abs(competitor.scoreChange)})`}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

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

// ChampionshipRankingPanel은 별도 파일에서 import

const TournamentCard: React.FC<{ 
    type: TournamentType; 
    onClick: (stage?: number) => void;
    onContinue: () => void;
    inProgress: TournamentState | null;
    currentUser: UserWithStatus;
}> = ({ type, onClick, onContinue, inProgress, currentUser }) => {
    const definition = TOURNAMENT_DEFINITIONS[type];
    const isSimulationInProgress = inProgress && inProgress.status === 'round_in_progress';
    const hasResultToView = inProgress && (inProgress.status === 'complete' || inProgress.status === 'eliminated');
    // 경기가 완료된 경우에는 계속하기 버튼을 표시하지 않음
    const isReadyToContinue = inProgress && !hasResultToView && (inProgress.status === 'bracket_ready' || inProgress.status === 'round_complete');

    // 입장 가능 횟수 계산 (남은 횟수)
    const now = Date.now();
    let playedDateKey: keyof UserWithStatus;
    let rewardClaimedKey: keyof UserWithStatus;
    switch (type) {
        case 'neighborhood':
            playedDateKey = 'lastNeighborhoodPlayedDate';
            rewardClaimedKey = 'neighborhoodRewardClaimed';
            break;
        case 'national':
            playedDateKey = 'lastNationalPlayedDate';
            rewardClaimedKey = 'nationalRewardClaimed';
            break;
        case 'world':
            playedDateKey = 'lastWorldPlayedDate';
            rewardClaimedKey = 'worldRewardClaimed';
            break;
    }
    const lastPlayedDate = currentUser[playedDateKey as keyof UserWithStatus] as number | null | undefined;
    const hasPlayedToday = lastPlayedDate && isSameDayKST(lastPlayedDate, now);
    // 입장 가능 횟수: 오늘 플레이하지 않았으면 1, 플레이했으면 0
    const availableEntries = hasPlayedToday ? 0 : 1;

    // 보상 미수령 여부 확인 (토너먼트가 완료되었지만 보상을 받지 않은 경우)
    const rewardClaimed = currentUser[rewardClaimedKey as keyof UserWithStatus] as boolean | undefined;
    const hasUnclaimedReward = hasResultToView && !rewardClaimed;

    // 던전 진행 상태 확인
    const dungeonProgress = currentUser?.dungeonProgress?.[type] || {
        currentStage: 0,
        unlockedStages: [1],
        stageResults: {},
        dailyStageAttempts: {},
    };
    
    // 도전 가능한 최고 단계 계산 (언락된 단계 중 가장 높은 단계)
    const maxUnlockedStage = useMemo(() => {
        return dungeonProgress.unlockedStages.length > 0 
            ? Math.max(...dungeonProgress.unlockedStages) 
            : 1;
    }, [dungeonProgress.unlockedStages]);
    
    const [selectedStage, setSelectedStage] = useState(maxUnlockedStage);
    
    // maxUnlockedStage가 변경되면 selectedStage도 업데이트
    useEffect(() => {
        setSelectedStage(maxUnlockedStage);
    }, [maxUnlockedStage]);
    
    // 던전 타입에 따른 입장 텍스트
    const getEntryText = () => {
        switch (type) {
            case 'neighborhood':
                return '리그 입장';
            case 'national':
                return '대회 입장';
            case 'world':
                return '대회 입장';
            default:
                return '입장';
        }
    };
    
    let buttonText = getEntryText();
    
    // 던전 모드인지 확인 (currentStageAttempt가 있으면 던전 모드)
    const isDungeonMode = inProgress && inProgress.currentStageAttempt !== undefined && inProgress.currentStageAttempt !== null;
    
    // 던전 진행 중인 경우
    if (isDungeonMode) {
        if (inProgress.status === 'complete' || inProgress.status === 'eliminated') {
            buttonText = '결과 보기';
        } else {
            buttonText = '이어서 보기';
        }
    }
    
    return (
        <div 
            className="group bg-gray-800 rounded-lg p-2 sm:p-3 flex flex-col text-center transition-all transform hover:-translate-y-1 shadow-lg hover:shadow-purple-500/30 h-full relative"
        >
            {/* 보상 미수령 표시: 붉은 점 */}
            {hasUnclaimedReward && (
                <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 rounded-full z-10 border-2 border-gray-800"></div>
            )}
            <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                <h2 className="text-xs sm:text-sm lg:text-lg font-bold">{definition.name}</h2>
                {dungeonProgress.currentStage > 0 && (
                    <span className="text-[10px] sm:text-xs text-yellow-400">최고 {dungeonProgress.currentStage}단계</span>
                )}
            </div>
            <div className="w-full aspect-video bg-gray-700 rounded-md flex items-center justify-center text-gray-500 overflow-hidden relative flex-grow">
                <img src={definition.image} alt={definition.name} className="w-full h-full object-cover" />
            </div>
            
            {/* 단계 선택 드롭다운 - 던전 모드가 아닐 때만 표시 */}
            {!isDungeonMode && (
                <div className="mt-1.5 sm:mt-2 relative">
                    <div className="flex gap-1 items-center">
                        <select
                            value={selectedStage}
                            onChange={(e) => {
                                setSelectedStage(Number(e.target.value));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 text-[10px] sm:text-xs bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-purple-500"
                        >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(stage => {
                                const isUnlocked = dungeonProgress.unlockedStages.includes(stage);
                                const isCleared = dungeonProgress.stageResults[stage]?.cleared || false;
                                return (
                                    <option 
                                        key={stage} 
                                        value={stage}
                                        disabled={!isUnlocked}
                                        className={!isUnlocked ? 'text-gray-500' : isCleared ? 'text-green-400' : ''}
                                    >
                                        {stage}단계 {isCleared ? '✓' : ''} {!isUnlocked ? '(잠김)' : ''}
                                    </option>
                                );
                            })}
                        </select>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onClick(selectedStage);
                            }}
                            className="font-bold text-[10px] sm:text-xs lg:text-sm px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
                        >
                            {buttonText} &rarr;
                        </button>
                    </div>
                </div>
            )}
            
            {/* 던전 진행 중인 경우 기존 버튼 */}
            {isDungeonMode && (
                <span 
                    className="font-bold text-[10px] sm:text-xs lg:text-sm mt-1.5 sm:mt-2 text-yellow-300 cursor-pointer"
                    onClick={onContinue}
                >
                    {buttonText} &rarr;
                </span>
            )}
        </div>
    );
};


const PlaceholderCard: React.FC<{ title: string; description: string; imageUrl: string; }> = ({ title, description, imageUrl }) => {
    return (
        <div className="bg-gray-800 rounded-lg p-3 flex flex-col text-center shadow-lg opacity-60 cursor-not-allowed h-full">
            <div className="w-full aspect-video bg-gray-700 rounded-md flex items-center justify-center text-gray-500 overflow-hidden">
                <img src={imageUrl} alt={title} className="w-full h-full object-cover grayscale" />
            </div>
        </div>
    );
};

const filterInProgress = (state: TournamentState | null | undefined): TournamentState | null => {
    if (!state) return null;
    // Keep completed/eliminated states to show "Result" button
    return state;
};

const gradeBackgrounds: Record<string, string> = {
    normal: '/images/equipments/normalbgi.png',
    uncommon: '/images/equipments/uncommonbgi.png',
    rare: '/images/equipments/rarebgi.png',
    epic: '/images/equipments/epicbgi.png',
    legendary: '/images/equipments/legendarybgi.png',
    mythic: '/images/equipments/mythicbgi.png',
};

const getStarDisplayInfo = (stars: number) => {
    if (stars >= 10) {
        return { text: `(★${stars})`, colorClass: "prism-text-effect" };
    } else if (stars >= 7) {
        return { text: `(★${stars})`, colorClass: "text-purple-400" };
    } else if (stars >= 4) {
        return { text: `(★${stars})`, colorClass: "text-amber-400" };
    } else if (stars >= 1) {
        return { text: `(★${stars})`, colorClass: "text-white" };
    }
    return { text: "", colorClass: "text-white" };
};

const coreStatAbbreviations: Record<CoreStat, string> = {
    [CoreStat.Concentration]: '집중',
    [CoreStat.ThinkingSpeed]: '사고',
    [CoreStat.Judgment]: '판단',
    [CoreStat.Calculation]: '계산',
    [CoreStat.CombatPower]: '전투',
    [CoreStat.Stability]: '안정',
};

const StatsDisplayPanel: React.FC<{ currentUser: UserWithStatus; isMobile?: boolean }> = ({ currentUser, isMobile = false }) => {
    const { coreStatBonuses } = useMemo(() => calculateUserEffects(currentUser), [currentUser]);
    
    return (
        <div className="grid grid-cols-2 gap-1 sm:gap-1.5 lg:gap-2">
            {Object.values(CoreStat).map(stat => {
                const baseValue = (currentUser.baseStats[stat] || 0) + (currentUser.spentStatPoints?.[stat] || 0);
                // Align with calculateTotalStats: final = floor((base + flat) * (1 + percent/100))
                const finalValue = Math.floor((baseValue + coreStatBonuses[stat].flat) * (1 + coreStatBonuses[stat].percent / 100));
                const bonus = finalValue - baseValue;
                // 숫자 자릿수에 따라 텍스트 크기 조정 (4자리 이상이면 작게)
                const valueDigits = finalValue.toString().length;
                const bonusDigits = bonus > 0 ? bonus.toString().length : 0;
                const totalDigits = valueDigits + (bonus > 0 ? bonusDigits + 4 : 0); // (+N) 포함
                
                // 4자리 이상이면 텍스트 크기를 줄임
                const getValueTextSize = () => {
                    if (isMobile) {
                        return valueDigits >= 4 ? 'text-[7px]' : 'text-[8px]';
                    }
                    if (valueDigits >= 4) {
                        return 'text-[9px] sm:text-[10px]';
                    }
                    return 'text-[10px] sm:text-xs';
                };
                
                const getBonusTextSize = () => {
                    if (isMobile) {
                        return totalDigits >= 7 ? 'text-[6px]' : 'text-[7px]';
                    }
                    if (totalDigits >= 7) {
                        return 'text-[8px] sm:text-[9px]';
                    }
                    return 'text-[9px] sm:text-xs';
                };
                
                return (
                    <div key={stat} className={`bg-gray-700/50 ${isMobile ? 'p-1' : 'p-1.5 sm:p-2'} rounded-md flex items-center justify-between ${isMobile ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}>
                        <span className="font-semibold text-gray-300 whitespace-nowrap">{coreStatAbbreviations[stat]}</span>
                        <span className={`font-mono font-bold whitespace-nowrap ${getValueTextSize()}`} title={`기본: ${baseValue}, 장비: ${bonus}`}>
                            {finalValue}
                            {bonus > 0 && <span className={`text-green-400 ${getBonusTextSize()} ml-0.5`}>(+{bonus})</span>}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

const EquipmentSlotDisplay: React.FC<{ slot: EquipmentSlot; item?: InventoryItem; onClick?: () => void; }> = ({ slot, item, onClick }) => {
    const clickableClass = item && onClick ? 'cursor-pointer hover:scale-105 transition-transform' : '';
    
    if (item) {
        const requiredLevel = GRADE_LEVEL_REQUIREMENTS[item.grade];
        const titleText = `${item.name} (착용 레벨 합: ${requiredLevel}) - 클릭하여 상세보기`;
        const starInfo = getStarDisplayInfo(item.stars);
        return (
            <div
                className={`relative w-full aspect-square rounded-lg border-2 border-gray-600/50 bg-gray-700/50 ${clickableClass}`}
                title={titleText}
                onClick={onClick}
            >
                <img src={gradeBackgrounds[item.grade]} alt={item.grade} className="absolute inset-0 w-full h-full object-cover rounded-md" />
                {item.stars > 0 && (
                    <div className={`absolute top-1 right-1.5 text-sm font-bold z-10 ${starInfo.colorClass}`} style={{ textShadow: '1px 1px 2px black' }}>
                        ★{item.stars}
                    </div>
                )}
                {item.image && <img src={item.image} alt={item.name} className="absolute object-contain p-2" style={{ width: '70%', height: '70%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />}
            </div>
        );
    } else {
         return (
             <img src={emptySlotImages[slot]} alt={`${slot} empty slot`} className="w-full aspect-square rounded-lg bg-gray-700/50 border-2 border-gray-600/50" />
        );
    }
};

const TournamentLobby: React.FC = () => {
    const { currentUserWithStatus, allUsers, handlers, waitingRoomChats, presets } = useAppContext();
    
    const [viewingTournament, setViewingTournament] = useState<TournamentState | null>(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [hasRankChanged, setHasRankChanged] = useState(false);
    const [enrollingIn, setEnrollingIn] = useState<TournamentType | null>(null);
    const [selectedPreset, setSelectedPreset] = useState(0);
    const [isChampionshipHelpOpen, setIsChampionshipHelpOpen] = useState(false);

    useEffect(() => {
        const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    if (!currentUserWithStatus) {
        return (
            <div className="p-4 sm:p-6 lg:p-8 max-w-screen-2xl mx-auto flex flex-col h-full relative text-gray-500 items-center justify-center min-h-0">
                로비 정보를 불러오는 중...
            </div>
        );
    }

    const neighborhoodState = filterInProgress(currentUserWithStatus.lastNeighborhoodTournament);
    const nationalState = filterInProgress(currentUserWithStatus.lastNationalTournament);
    const worldState = filterInProgress(currentUserWithStatus.lastWorldTournament);

    const handleEnterArena = useCallback(async (type: TournamentType, stage?: number) => {
        console.log('[TournamentLobby] handleEnterArena called:', { type, stage, stageType: typeof stage });
        
        if (stage !== undefined && stage !== null && typeof stage === 'number' && stage >= 1 && stage <= 10) {
            // 던전 단계 시작
            const actionPayload = { dungeonType: type, stage };
            console.log('[TournamentLobby] Starting dungeon stage with payload:', actionPayload);
            try {
                const result = await handlers.handleAction({ type: 'START_DUNGEON_STAGE', payload: actionPayload });
                console.log('[TournamentLobby] START_DUNGEON_STAGE result:', result);
                if (result && 'error' in result) {
                    console.error('[TournamentLobby] START_DUNGEON_STAGE returned error:', result.error);
                    return;
                }
                window.location.hash = `#/tournament/${type}`;
            } catch (error) {
                console.error('[TournamentLobby] Failed to start dungeon stage:', error);
                throw error;
            }
        } else {
            console.log('[TournamentLobby] Starting regular tournament session (no stage provided)');
            // 기존 토너먼트 세션 시작 (호환성 유지)
            await handlers.handleAction({ type: 'START_TOURNAMENT_SESSION', payload: { type: type } });
            window.location.hash = `#/tournament/${type}`;
        }
    }, [handlers]);

    const handleContinueTournament = useCallback(async (type: TournamentType) => {
        await handlers.handleAction({ type: 'START_TOURNAMENT_ROUND', payload: { type: type } });
        window.location.hash = `#/tournament/${type}`;
    }, [handlers]);

    const equippedItems = useMemo(() => {
        if (!currentUserWithStatus?.inventory) return [];
        return currentUserWithStatus.inventory.filter(item => item.isEquipped);
    }, [currentUserWithStatus?.inventory]);

    const getItemForSlot = (slot: EquipmentSlot) => {
        return equippedItems.find(item => item.slot === slot);
    };

    const handlePresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const presetIndex = Number(event.target.value);
        setSelectedPreset(presetIndex);
        const selectedPresetData = presets?.[presetIndex];
        // 프리셋이 있으면 적용하고, 없으면(빈 프리셋) 빈 장비 세트를 적용
        if (selectedPresetData) {
            handlers.applyPreset(selectedPresetData);
        } else if (presets) {
            handlers.applyPreset({ name: `프리셋 ${presetIndex + 1}`, equipment: {} });
        }
    };

    const containerClass = isMobile
        ? 'h-full overflow-y-auto'
        : 'h-full overflow-hidden min-h-0';

    return (
        <div className={`p-4 sm:p-6 lg:p-8 w-full flex flex-col relative ${containerClass}`}>
            <header className="flex justify-between items-center mb-4 sm:mb-6 flex-shrink-0">
                <button onClick={() => window.location.hash = '#/profile'} className="transition-transform active:scale-90 filter hover:drop-shadow-lg">
                    <img src="/images/button/back.png" alt="Back" className="w-10 h-10 sm:w-12 sm:h-12" />
                </button>
                <div className="flex-1 text-center">
                    <h1 className="text-xl sm:text-2xl lg:text-4xl font-bold">챔피언십</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setIsChampionshipHelpOpen(true)}
                        className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center transition-transform hover:scale-110"
                        aria-label="도움말"
                        title="도움말"
                    >
                        <img src="/images/button/help.png" alt="도움말" className="w-full h-full" />
                    </button>
                    {isMobile && (
                        <button 
                            onClick={() => setIsMobileSidebarOpen(true)}
                            className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center bg-gray-800/80 backdrop-blur-sm rounded-lg hover:bg-gray-700/80 transition-colors"
                            aria-label="메뉴 열기"
                        >
                            <span className="text-lg sm:text-2xl font-bold text-white">{'<'}</span>
                        </button>
                    )}
                </div>
            </header>
            
            <div className={`${isMobile ? '' : 'flex-1'} flex flex-col lg:flex-row gap-6 min-h-0 ${isMobile ? '' : 'overflow-hidden'}`}>
                <main className="flex-grow flex flex-col gap-6 min-h-0 overflow-hidden">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4 flex-shrink-0">
                        <TournamentCard type="neighborhood" onClick={(stage) => handleEnterArena('neighborhood', stage)} onContinue={() => handleContinueTournament('neighborhood')} inProgress={neighborhoodState || null} currentUser={currentUserWithStatus} />
                        <TournamentCard type="national" onClick={(stage) => handleEnterArena('national', stage)} onContinue={() => handleContinueTournament('national')} inProgress={nationalState || null} currentUser={currentUserWithStatus} />
                        <TournamentCard type="world" onClick={(stage) => handleEnterArena('world', stage)} onContinue={() => handleContinueTournament('world')} inProgress={worldState || null} currentUser={currentUserWithStatus} />
                    </div>
                    
                    {/* 모바일: 장착 장비 + 능력치 + 일일 획득 가능점수 패널 */}
                    <div className="lg:hidden grid grid-cols-2 gap-3 sm:gap-4 flex-shrink-0">
                        {/* 장착 장비 + 능력치 패널 (모바일) */}
                        <div className="bg-gray-800/50 rounded-lg p-2 sm:p-3 shadow-lg min-h-0 flex flex-col overflow-hidden">
                            <div className="flex flex-col gap-2 h-full min-h-0">
                                {/* 장착 장비 섹션 */}
                                <div className="flex flex-col gap-2 flex-shrink-0">
                                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                                        {(['fan', 'top', 'bottom', 'board', 'bowl', 'stones'] as EquipmentSlot[]).map(slot => {
                                            const item = getItemForSlot(slot);
                                            return (
                                                <div key={slot} className="w-full">
                                                    <EquipmentSlotDisplay
                                                        slot={slot}
                                                        item={item}
                                                        onClick={() => item && handlers.openViewingItem(item, true)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <Button 
                                            onClick={handlers.openEquipmentEffectsModal} 
                                            colorScheme="blue" 
                                            className={`${isMobile ? '!text-[9px]' : '!text-[10px] sm:!text-xs'} w-full ${isMobile ? '!py-0.5 !px-1.5' : '!py-1 !px-2'}`}
                                        >
                                            장비 효과 보기
                                        </Button>
                                        <div>
                                            <select
                                                value={selectedPreset}
                                                onChange={handlePresetChange}
                                                className={`bg-gray-700 border border-gray-600 ${isMobile ? 'text-[9px] p-0.5' : 'text-[10px] sm:text-xs p-1 sm:p-1.5'} rounded-md focus:ring-purple-500 focus:border-purple-500 w-full text-gray-200`}
                                            >
                                                {presets && presets.map((preset, index) => (
                                                    <option key={index} value={index}>{preset.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* 능력치 섹션 */}
                                <div className="flex flex-col gap-2 flex-1 min-h-0">
                                    <div className="flex-1 min-h-0">
                                        <StatsDisplayPanel currentUser={currentUserWithStatus} isMobile={isMobile} />
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* 일일 획득 가능점수 패널 (모바일) */}
                        <div className="flex flex-col min-h-0 overflow-hidden">
                            <PointsInfoPanel />
                        </div>
                    </div>
                    
                    {/* 채팅창 - 모바일에서는 아래에 */}
                    <div className={`lg:hidden flex-1 bg-gray-800/50 rounded-lg shadow-lg min-h-0 flex flex-col overflow-hidden min-h-[300px]`}>
                        <ChatWindow
                            messages={waitingRoomChats.global || []}
                            mode="global"
                            onAction={handlers.handleAction}
                            onViewUser={handlers.openViewingUser}
                            locationPrefix="[챔피언십]"
                        />
                    </div>
                    
                    {/* 데스크톱: 일일 획득 가능점수 / 채팅창 가로 배치 */}
                    <div className="hidden lg:flex flex-1 flex-row gap-3 sm:gap-4 lg:gap-6 min-h-0 overflow-hidden">
                        {/* 일일 획득 가능점수 패널 (데스크톱) */}
                        <div className="w-80 flex-shrink-0 flex flex-col min-h-0 overflow-hidden">
                            <PointsInfoPanel />
                        </div>
                        
                        {/* 채팅창 (데스크톱) */}
                        <div className="flex-1 bg-gray-800/50 rounded-lg shadow-lg min-h-0 flex flex-col overflow-hidden">
                            <ChatWindow
                                messages={waitingRoomChats.global || []}
                                mode="global"
                                onAction={handlers.handleAction}
                                onViewUser={handlers.openViewingUser}
                                locationPrefix="[챔피언십]"
                            />
                        </div>
                    </div>
                </main>
                 <aside className="hidden lg:flex flex-col lg:w-[500px] flex-shrink-0 gap-4 min-h-0 overflow-hidden">
                    {/* 상단: 장비+능력치 패널 + 퀵메뉴 */}
                    <div className="flex-shrink-0 flex flex-row gap-3 items-stretch">
                        {/* 장비 + 능력치 패널 */}
                        <div className="flex-1 min-w-0 bg-gray-800/50 rounded-lg p-4 shadow-lg">
                            <div className="flex flex-col gap-3">
                                {/* 장착 장비 섹션 */}
                                <div className="flex flex-col gap-2.5">
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['fan', 'top', 'bottom', 'board', 'bowl', 'stones'] as EquipmentSlot[]).map(slot => {
                                            const item = getItemForSlot(slot);
                                            return (
                                                <div key={slot} className="w-full">
                                                    <EquipmentSlotDisplay
                                                        slot={slot}
                                                        item={item}
                                                        onClick={() => item && handlers.openViewingItem(item, true)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Button 
                                            onClick={handlers.openEquipmentEffectsModal} 
                                            colorScheme="blue" 
                                            className="!text-xs w-full !py-1.5"
                                        >
                                            장비 효과 보기
                                        </Button>
                                        <div>
                                            <select
                                                value={selectedPreset}
                                                onChange={handlePresetChange}
                                                className="bg-gray-700 border border-gray-600 text-xs rounded-md p-2 focus:ring-purple-500 focus:border-purple-500 w-full text-gray-200"
                                            >
                                                {presets && presets.map((preset, index) => (
                                                    <option key={index} value={index}>{preset.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* 능력치 섹션 */}
                                <div className="flex flex-col gap-2">
                                    <StatsDisplayPanel currentUser={currentUserWithStatus} />
                                </div>
                            </div>
                        </div>
                        {/* 퀵메뉴 - 장비 패널과 높이 맞춤 */}
                        <div className="w-24 flex-shrink-0">
                            <QuickAccessSidebar fillHeight={true} compact={true} />
                        </div>
                    </div>
                    
                    {/* 하단: 챔피언십 랭킹 */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <ChampionshipRankingPanel />
                    </div>
                </aside>
            </div>

            {/* Mobile Sidebar - 오른쪽에서 왼쪽으로 열림 */}
            {isMobile && (
                <>
                    <div className={`fixed top-0 right-0 h-full w-[320px] sm:w-[360px] bg-gray-800 shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
                        <div className="flex justify-between items-center p-2 sm:p-3 border-b border-gray-600 flex-shrink-0">
                            <h3 className="text-base sm:text-lg font-bold">메뉴</h3>
                            <button onClick={() => setIsMobileSidebarOpen(false)} className="text-xl sm:text-2xl font-bold text-gray-300 hover:text-white">×</button>
                        </div>
                        <div className="flex flex-col gap-2 p-2 flex-grow min-h-0 overflow-y-auto">
                            {/* Quick Access Sidebar - Horizontal */}
                            <div className="flex-shrink-0 p-1.5 sm:p-2 bg-gray-900/50 rounded-lg border border-gray-700">
                                <QuickAccessSidebar mobile={true} />
                            </div>
                            {/* Championship Ranking Panel */}
                            <div className="flex-1 min-h-[250px] sm:min-h-[300px] bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
                                <ChampionshipRankingPanel />
                            </div>
                        </div>
                    </div>
                    {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                </>
            )}
            {isChampionshipHelpOpen && <ChampionshipHelpModal onClose={() => setIsChampionshipHelpOpen(false)} />}
        </div>
    );
};

export default TournamentLobby;
