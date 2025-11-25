import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Guild as GuildType, UserWithStatus, GuildBossInfo, QuestReward, GuildMember, GuildMemberRole, CoreStat, GuildResearchId, GuildResearchCategory, ItemGrade, ServerAction } from '../../types/index.js';
import { useAppContext } from '../../hooks/useAppContext.js';
import BackButton from '../BackButton.js';
import Button from '../Button.js';
import GuildHomePanel from './GuildHomePanel.js';
import GuildMembersPanel from './GuildMembersPanel.js';
import GuildManagementPanel from './GuildManagementPanel.js';
import { GUILD_XP_PER_LEVEL, GUILD_BOSSES, GUILD_RESEARCH_PROJECTS, AVATAR_POOL, BORDER_POOL, emptySlotImages, slotNames, GUILD_BOSS_MAX_ATTEMPTS, GUILD_INITIAL_MEMBER_LIMIT, GUILD_DONATION_GOLD_LIMIT, GUILD_DONATION_DIAMOND_LIMIT, GUILD_DONATION_GOLD_COST, GUILD_DONATION_DIAMOND_COST, GUILD_CHECK_IN_MILESTONE_REWARDS, GUILD_DONATION_GOLD_REWARDS, GUILD_DONATION_DIAMOND_REWARDS } from '../../constants/index.js';
import DraggableWindow from '../DraggableWindow.js';
import GuildResearchPanel from './GuildResearchPanel.js';
import GuildMissionsPanel from './GuildMissionsPanel.js';
import NineSlicePanel from '../ui/NineSlicePanel.js';
import GuildShopModal from './GuildShopModal.js';
import { BOSS_SKILL_ICON_MAP } from '../../assets.js';
import HelpModal from '../HelpModal.js';
import { getTimeUntilNextMondayKST, isSameDayKST, isDifferentWeekKST } from '../../utils/timeUtils.js';

// 길드 아이콘 경로 수정 함수
const getGuildIconPath = (icon: string | undefined): string => {
    if (!icon) return '/images/guild/profile/icon1.png';
    // 기존 경로가 /images/guild/icon으로 시작하면 /images/guild/profile/icon으로 변환
    if (icon.startsWith('/images/guild/icon')) {
        return icon.replace('/images/guild/icon', '/images/guild/profile/icon');
    }
    // 이미 올바른 경로이거나 다른 경로인 경우 그대로 반환
    return icon;
};

const GuildDonationPanel: React.FC<{ guildDonationAnimation: { coins: number; research: number; type: 'gold' | 'diamond' } | null; onDonationComplete?: (coins: number, research: number, type: 'gold' | 'diamond') => void; goldButtonRef: React.RefObject<HTMLDivElement>; diamondButtonRef: React.RefObject<HTMLDivElement> }> = ({ guildDonationAnimation, onDonationComplete, goldButtonRef, diamondButtonRef }) => {
    const { handlers, currentUserWithStatus } = useAppContext();
    const [isDonating, setIsDonating] = useState(false);
    const [donationType, setDonationType] = useState<'gold' | 'diamond' | null>(null);
    const donationInFlight = useRef(false);
    const now = Date.now();
    const dailyDonations = (currentUserWithStatus?.dailyDonations && isSameDayKST(currentUserWithStatus.dailyDonations.date, now))
        ? currentUserWithStatus.dailyDonations
        : { gold: 0, diamond: 0, date: now };

    const goldDonationsLeft = GUILD_DONATION_GOLD_LIMIT - dailyDonations.gold;
    const diamondDonationsLeft = GUILD_DONATION_DIAMOND_LIMIT - dailyDonations.diamond;

    const canDonateGold = goldDonationsLeft > 0 && (currentUserWithStatus?.gold ?? 0) >= GUILD_DONATION_GOLD_COST;
    const canDonateDiamond = diamondDonationsLeft > 0 && (currentUserWithStatus?.diamonds ?? 0) >= GUILD_DONATION_DIAMOND_COST;

    const handleDonate = async (type: 'GUILD_DONATE_GOLD' | 'GUILD_DONATE_DIAMOND') => {
        console.log('handleDonate called', type);
        if (donationInFlight.current) return;
        donationInFlight.current = true;
        setIsDonating(true);
        setDonationType(type === 'GUILD_DONATE_GOLD' ? 'gold' : 'diamond');
        try {
            const result = await handlers.handleAction({ type }) as any;
            console.log('[GuildDonationPanel] Donation result:', result);
            console.log('[GuildDonationPanel] result.clientResponse:', result?.clientResponse);
            console.log('[GuildDonationPanel] result.donationResult:', result?.donationResult);
            console.log('[GuildDonationPanel] result.clientResponse?.donationResult:', result?.clientResponse?.donationResult);
            
            if (result?.error) {
                console.error('[GuildDonationPanel] Donation failed:', result.error);
                alert(result.error);
                setDonationType(null);
            } else {
                // donationResult는 clientResponse 안에 있거나 직접 result에 있을 수 있음
                const donationResult = result?.clientResponse?.donationResult || result?.donationResult;
                if (donationResult) {
                    const { coins, research } = donationResult;
                    console.log('[GuildDonationPanel] Donation success:', { coins, research });
                    if (onDonationComplete) {
                        onDonationComplete(coins, research, type === 'GUILD_DONATE_GOLD' ? 'gold' : 'diamond');
                    }
                } else {
                    console.warn('[GuildDonationPanel] No donationResult in response, but no error either. Result:', result);
                }
                // 성공 시 길드 정보를 다시 가져옴
                await handlers.handleAction({ type: 'GET_GUILD_INFO' });
            }
        } catch(error) {
            console.error("Donation failed:", error);
            alert('기부 중 오류가 발생했습니다.');
            setDonationType(null);
        } finally {
            setIsDonating(false);
            donationInFlight.current = false;
        }
    };

    return (
        <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-3 rounded-xl flex flex-col relative overflow-visible border-2 border-stone-600/60 shadow-2xl backdrop-blur-md flex-shrink-0" style={{ minHeight: '240px' }}>
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none rounded-xl"></div>
            <h3 className="font-bold text-base text-highlight mb-3 text-center relative z-10 flex items-center justify-center gap-2 drop-shadow-lg flex-shrink-0">
                <span className="text-lg">💎</span>
                <span>길드 기부</span>
            </h3>
            
            {/* 획득 가능한 보상 정보 */}
            <div className="grid grid-cols-2 gap-3 mb-3 relative z-10">
                {/* 골드 기부 보상 */}
                <div className="bg-gradient-to-br from-amber-900/40 to-amber-800/30 rounded-lg p-2 border border-amber-600/30">
                    <div className="text-xs font-semibold text-amber-200 mb-1.5 text-center">골드 기부 보상</div>
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                        <img src="/images/guild/tokken.png" alt="길드코인" className="w-4 h-4" />
                        <span className="text-xs text-amber-100 font-bold">{GUILD_DONATION_GOLD_REWARDS.guildCoins[0]}~{GUILD_DONATION_GOLD_REWARDS.guildCoins[1]}</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                        <img src="/images/guild/button/guildlab.png" alt="연구포인트" className="w-4 h-4" />
                        <span className="text-xs text-amber-100 font-bold">{GUILD_DONATION_GOLD_REWARDS.researchPoints[0]}~{GUILD_DONATION_GOLD_REWARDS.researchPoints[1]} RP</span>
                    </div>
                </div>
                
                {/* 다이아 기부 보상 */}
                <div className="bg-gradient-to-br from-blue-900/40 to-indigo-800/30 rounded-lg p-2 border border-blue-600/30">
                    <div className="text-xs font-semibold text-blue-200 mb-1.5 text-center">다이아 기부 보상</div>
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                        <img src="/images/guild/tokken.png" alt="길드코인" className="w-4 h-4" />
                        <span className="text-xs text-blue-100 font-bold">{GUILD_DONATION_DIAMOND_REWARDS.guildCoins[0]}~{GUILD_DONATION_DIAMOND_REWARDS.guildCoins[1]}</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                        <img src="/images/guild/button/guildlab.png" alt="연구포인트" className="w-4 h-4" />
                        <span className="text-xs text-blue-100 font-bold">{GUILD_DONATION_DIAMOND_REWARDS.researchPoints[0]}~{GUILD_DONATION_DIAMOND_REWARDS.researchPoints[1]} RP</span>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 relative z-10 flex-1 min-h-0 overflow-visible">
                {/* 골드 기부 버튼 */}
                <div ref={goldButtonRef} className="flex flex-col justify-center h-full relative overflow-visible">
                    <Button 
                        onClick={() => handleDonate('GUILD_DONATE_GOLD')}
                        disabled={!canDonateGold || isDonating}
                        colorScheme="none"
                        className={`w-full h-full justify-center rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-400/90 via-amber-300/90 to-amber-500/90 text-slate-900 font-semibold tracking-wide shadow-[0_12px_32px_-18px_rgba(251,191,36,0.85)] hover:from-amber-300 hover:to-amber-500 ${!canDonateGold || isDonating ? 'opacity-50 cursor-not-allowed' : ''}`}
                        style={{ minHeight: '90px', height: '90px' }}
                    >
                        <div className="flex flex-col items-center justify-center gap-1 h-full">
                            {isDonating ? (
                                <div className="flex items-center justify-center gap-1 h-full">
                                    <span className="animate-spin text-sm">⏳</span>
                                    <span className="text-sm">기부 중...</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-base font-bold">
                                        <img src="/images/icon/Gold.png" alt="골드" className="w-6 h-6 drop-shadow-md" />
                                        <span>{GUILD_DONATION_GOLD_COST.toLocaleString()}</span>
                                    </div>
                                    <span className="text-xs text-slate-700/90 tracking-wide font-semibold">
                                        일일 한도 {goldDonationsLeft}/{GUILD_DONATION_GOLD_LIMIT}
                                    </span>
                                </>
                            )}
                        </div>
                    </Button>
                </div>

                {/* 다이아 기부 버튼 */}
                <div ref={diamondButtonRef} className="flex flex-col justify-center h-full relative overflow-visible">
                    <Button
                        onClick={() => handleDonate('GUILD_DONATE_DIAMOND')}
                        disabled={!canDonateDiamond || isDonating}
                        colorScheme="none"
                        className={`w-full h-full justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-400/90 via-blue-500/90 to-indigo-500/90 text-white font-semibold tracking-wide shadow-[0_12px_32px_-18px_rgba(56,189,248,0.85)] hover:from-sky-300 hover:to-indigo-500 ${!canDonateDiamond || isDonating ? 'opacity-50 cursor-not-allowed' : ''}`}
                        style={{ minHeight: '90px', height: '90px' }}
                    >
                        <div className="flex flex-col items-center justify-center gap-1 h-full">
                            {isDonating ? (
                                <div className="flex items-center justify-center gap-1 h-full">
                                    <span className="animate-spin text-sm">⏳</span>
                                    <span className="text-sm">기부 중...</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-base font-bold">
                                        <img src="/images/icon/Zem.png" alt="다이아" className="w-6 h-6 drop-shadow-md" />
                                        <span>{GUILD_DONATION_DIAMOND_COST.toLocaleString()}</span>
                                    </div>
                                    <span className="text-xs text-white/90 tracking-wide font-semibold">
                                        일일 한도 {diamondDonationsLeft}/{GUILD_DONATION_DIAMOND_LIMIT}
                                    </span>
                                </>
                            )}
                        </div>
                    </Button>
                </div>
            </div>
        </div>
    );
};

const ActivityPanel: React.FC<{ onOpenMissions: () => void; onOpenResearch: () => void; onOpenShop: () => void; missionNotification: boolean; onOpenBossGuide: () => void; }> = ({ onOpenMissions, onOpenResearch, onOpenShop, missionNotification, onOpenBossGuide }) => {
    const activities = [
        { name: '길드 미션', icon: '/images/guild/button/guildmission.png', action: onOpenMissions, notification: missionNotification },
        { name: '길드 연구소', icon: '/images/guild/button/guildlab.png', action: onOpenResearch },
        { name: '길드 상점', icon: '/images/guild/button/guildstore.png', action: onOpenShop },
        { name: '보스 도감', icon: '/images/guild/button/bossraid1.png', action: onOpenBossGuide },
    ];
    return (
        <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-3 rounded-xl border-2 border-stone-600/60 shadow-2xl backdrop-blur-md flex-shrink-0">
            <h3 className="font-bold text-base text-highlight mb-2 text-center flex items-center justify-center gap-2 flex-shrink-0">
                <span className="text-xl">⚡</span>
                <span>길드 활동</span>
            </h3>
            <div className="flex justify-around items-center gap-2">
                {activities.map(act => (
                    <button 
                        key={act.name} 
                        onClick={act.action}
                        className={`flex flex-col items-center gap-2 p-3 rounded-xl bg-gradient-to-br from-stone-800/50 to-stone-700/30 border border-stone-600/40 transition-all hover:brightness-110 hover:shadow-lg relative group flex-1`}
                    >
                        <div className="w-16 h-16 bg-gradient-to-br from-stone-700/60 to-stone-800/50 rounded-xl flex items-center justify-center shadow-md group-hover:shadow-xl transition-shadow border border-stone-600/40">
                            <img src={act.icon} alt={act.name} className="w-14 h-14 drop-shadow-lg" />
                        </div>
                        <span className="text-xs font-semibold text-highlight">{act.name}</span>
                        {act.notification && (
                            <div className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse border-2 border-secondary shadow-lg flex items-center justify-center">
                                <span className="text-[8px] text-white font-bold">!</span>
                            </div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

const BossPanel: React.FC<{ guild: GuildType, className?: string }> = ({ guild, className }) => {
    const { currentUserWithStatus } = useAppContext();
    
    // 나의 기록과 랭킹 계산
    const { myDamage, myRank, top3Ranking } = useMemo(() => {
        if (!guild.guildBossState?.totalDamageLog || !currentUserWithStatus) {
            return { myDamage: 0, myRank: null, top3Ranking: [] };
        }
        
        const damageLog = guild.guildBossState.totalDamageLog || {} as Record<string, number>;
        const fullRanking = Object.entries(damageLog)
            .map(([userId, damage]: [string, any]) => {
                const member = guild.members?.find((m: GuildMember) => m.userId === userId);
                return { userId, nickname: member?.nickname || '알 수 없음', damage: typeof damage === 'number' ? damage : 0 };
            })
            .sort((a, b) => b.damage - a.damage);
        
        const myRankIndex = fullRanking.findIndex(r => r.userId === currentUserWithStatus.id);
        const myData = myRankIndex !== -1 ? { ...fullRanking[myRankIndex], rank: myRankIndex + 1 } : null;
        const top3 = fullRanking.slice(0, 3);
        
        return {
            myDamage: myData?.damage || 0,
            myRank: myData?.rank || null,
            top3Ranking: top3
        };
    }, [guild.guildBossState?.totalDamageLog, guild.members, currentUserWithStatus]);
    const currentBoss = useMemo(() => {
        if (!guild.guildBossState) return GUILD_BOSSES[0];
        return GUILD_BOSSES.find(b => b.id === guild.guildBossState!.currentBossId) || GUILD_BOSSES[0];
    }, [guild.guildBossState]);
    
    const currentHp = guild.guildBossState?.currentBossHp ?? guild.guildBossState?.hp ?? currentBoss?.maxHp ?? 0;
    const hpPercent = (currentHp / currentBoss.maxHp) * 100;
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        const calculateTimeLeft = () => {
            const msLeft = getTimeUntilNextMondayKST();
            const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
            setTimeLeft(`${days}일 ${String(hours).padStart(2, '0')}시간 ${String(minutes).padStart(2, '0')}분`);
        };
        calculateTimeLeft();
        const interval = setInterval(calculateTimeLeft, 60000);
        return () => clearInterval(interval);
    }, []);

    // 보스 속성에 따른 색상 테마
    const getBossTheme = (bossId: string) => {
        switch (bossId) {
            case 'boss_1': // 청해 (물)
                return {
                    bg: 'from-blue-900/95 via-cyan-800/90 to-blue-900/95',
                    border: 'border-blue-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
                    overlay: 'from-blue-500/20 via-cyan-400/10 to-blue-500/15',
                    iconBg: 'from-blue-600/40 to-cyan-800/30',
                    iconBorder: 'border-blue-500/40',
                    hpBar: 'from-blue-500 via-cyan-400 to-blue-500',
                    hpShadow: 'shadow-[0_0_8px_rgba(59,130,246,0.5)]',
                    text: 'text-blue-300',
                };
            case 'boss_2': // 홍염 (불)
                return {
                    bg: 'from-red-900/95 via-orange-800/90 to-red-900/95',
                    border: 'border-red-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(239,68,68,0.4)]',
                    overlay: 'from-red-500/20 via-orange-400/10 to-red-500/15',
                    iconBg: 'from-red-600/40 to-orange-800/30',
                    iconBorder: 'border-red-500/40',
                    hpBar: 'from-red-500 via-orange-600 to-red-700',
                    hpShadow: 'shadow-[0_0_8px_rgba(239,68,68,0.5)]',
                    text: 'text-red-300',
                };
            case 'boss_3': // 녹수 (풀)
                return {
                    bg: 'from-green-900/95 via-emerald-800/90 to-green-900/95',
                    border: 'border-green-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(34,197,94,0.4)]',
                    overlay: 'from-green-500/20 via-emerald-400/10 to-green-500/15',
                    iconBg: 'from-green-600/40 to-emerald-800/30',
                    iconBorder: 'border-green-500/40',
                    hpBar: 'from-green-500 via-emerald-600 to-green-700',
                    hpShadow: 'shadow-[0_0_8px_rgba(34,197,94,0.5)]',
                    text: 'text-green-300',
                };
            case 'boss_4': // 현묘 (어둠)
                return {
                    bg: 'from-purple-900/95 via-indigo-800/90 to-purple-900/95',
                    border: 'border-purple-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(168,85,247,0.4)]',
                    overlay: 'from-purple-500/20 via-indigo-400/10 to-purple-500/15',
                    iconBg: 'from-purple-600/40 to-indigo-800/30',
                    iconBorder: 'border-purple-500/40',
                    hpBar: 'from-purple-500 via-indigo-600 to-purple-700',
                    hpShadow: 'shadow-[0_0_8px_rgba(168,85,247,0.5)]',
                    text: 'text-purple-300',
                };
            case 'boss_5': // 백광 (빛)
                return {
                    bg: 'from-yellow-900/95 via-amber-800/90 to-yellow-900/95',
                    border: 'border-yellow-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(234,179,8,0.4)]',
                    overlay: 'from-yellow-500/20 via-amber-400/10 to-yellow-500/15',
                    iconBg: 'from-yellow-600/40 to-amber-800/30',
                    iconBorder: 'border-yellow-500/40',
                    hpBar: 'from-yellow-500 via-amber-600 to-yellow-700',
                    hpShadow: 'shadow-[0_0_8px_rgba(234,179,8,0.5)]',
                    text: 'text-yellow-300',
                };
            default:
                return {
                    bg: 'from-gray-900/95 via-gray-800/90 to-gray-900/95',
                    border: 'border-gray-400/80',
                    shadow: 'shadow-[0_0_20px_rgba(156,163,175,0.4)]',
                    overlay: 'from-gray-500/20 via-gray-400/10 to-gray-500/15',
                    iconBg: 'from-gray-600/40 to-gray-800/30',
                    iconBorder: 'border-gray-500/40',
                    hpBar: 'from-gray-500 via-gray-600 to-gray-700',
                    hpShadow: 'shadow-[0_0_8px_rgba(156,163,175,0.5)]',
                    text: 'text-gray-300',
                };
        }
    };

    const theme = getBossTheme(currentBoss.id);

    return (
        <button 
            onClick={() => window.location.hash = '#/guildboss'}
            className={`bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-3 rounded-xl border-2 border-stone-600/60 shadow-lg flex flex-col items-center text-center transition-all hover:brightness-110 w-full relative overflow-hidden h-full ${className || ''}`}
        >
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
            <div className="relative z-10 w-full flex flex-col h-full">
                <h3 className="font-bold text-base text-highlight mb-2 flex items-center justify-center gap-2 flex-shrink-0">
                    <span className="text-xl">⚔️</span>
                    <span>길드 보스전</span>
                </h3>
                <div className="w-28 h-28 bg-gradient-to-br from-stone-700/50 to-stone-800/40 rounded-xl flex items-center justify-center my-2 mx-auto border border-stone-600/50 shadow-lg flex-shrink-0">
                    <img src={currentBoss.image} alt={currentBoss.name} className="w-24 h-24 drop-shadow-lg" />
                </div>
                <div className="w-full flex-1 flex flex-col justify-between min-h-0">
                    <div className="flex-shrink-0">
                        <p className="text-sm font-bold text-highlight mb-1.5">{currentBoss.name}</p>
                        <div className="w-full bg-gray-700/50 rounded-full h-2 border border-gray-600/50 overflow-hidden shadow-inner mb-1">
                            <div 
                                className="bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(217,119,6,0.5)]"
                                style={{ width: `${hpPercent}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] text-amber-300 font-semibold">{hpPercent.toFixed(1)}% 남음</p>
                        <p className="text-[9px] text-tertiary mt-1 bg-gray-800/50 px-1.5 py-0.5 rounded-md inline-block">교체까지: {timeLeft}</p>
                    </div>
                    
                    {/* 나의 기록 및 랭킹 */}
                    <div className="flex-shrink-0 mt-2 pt-2 border-t border-stone-600/40 space-y-1.5">
                        {myRank !== null && (
                            <div className="bg-stone-800/50 rounded-md px-2 py-1">
                                <div className="text-[9px] text-stone-400 mb-0.5">나의 기록</div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-highlight">랭킹 {myRank}위</span>
                                    <span className="text-[10px] font-bold text-amber-300">{myDamage.toLocaleString()}</span>
                                </div>
                            </div>
                        )}
                        {top3Ranking.length > 0 && (
                            <div className="bg-stone-800/50 rounded-md px-2 py-1">
                                <div className="text-[9px] text-stone-400 mb-0.5">길드 Top 3</div>
                                <div className="space-y-0.5">
                                    {top3Ranking.map((rank, idx) => (
                                        <div key={rank.userId} className="flex items-center justify-between text-[9px]">
                                            <span className="text-stone-300 truncate flex-1">{idx + 1}. {rank.nickname}</span>
                                            <span className="text-amber-300 font-semibold ml-1">{rank.damage.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
};

const WarPanel: React.FC<{ guild: GuildType, className?: string }> = ({ guild, className }) => {
    // 전쟁 데이터 (임시로 예시 데이터 사용, 실제로는 guild.guildWarState 등에서 가져와야 함)
    const ourGuildOccupancy = 45; // 우리 길드 점령률 (%)
    const enemyGuildOccupancy = 55; // 상대 길드 점령률 (%)
    const enemyGuildName = "상대 길드"; // 실제로는 매칭된 길드 이름
    
    return (
        <button 
            onClick={() => window.location.hash = '#/guildwar'}
            className={`bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-3 rounded-xl border-2 border-stone-600/60 shadow-lg flex flex-col items-center text-center transition-all hover:brightness-110 w-full relative overflow-hidden h-full ${className || ''}`}
        >
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
            <div className="relative z-10 w-full flex flex-col h-full">
                <h3 className="font-bold text-base text-highlight mb-2 flex items-center justify-center gap-2 flex-shrink-0">
                    <span className="text-xl">🛡️</span>
                    <span>길드 전쟁</span>
                </h3>
                <div className="w-28 h-28 bg-gradient-to-br from-stone-700/50 to-stone-800/40 rounded-xl flex items-center justify-center my-2 mx-auto border border-stone-600/50 shadow-lg flex-shrink-0">
                    <img src="/images/guild/button/guildwar.png" alt="길드 전쟁" className="w-24 h-24 drop-shadow-lg" />
                </div>
                
                <div className="w-full flex-1 flex flex-col justify-between min-h-0">
                    {/* 점령률 표시 */}
                    <div className="flex-shrink-0 space-y-2">
                        <div className="bg-stone-800/50 rounded-md px-2 py-1.5">
                            <div className="text-[9px] text-stone-400 mb-1.5 text-center">현재 점령률</div>
                            <div className="space-y-1.5">
                                {/* 우리 길드 */}
                                <div>
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[9px] font-semibold text-blue-300 truncate">{guild.name}</span>
                                        <span className="text-[9px] font-bold text-blue-300">{ourGuildOccupancy}%</span>
                                    </div>
                                    <div className="w-full bg-gray-700/50 rounded-full h-2 border border-gray-600/50 overflow-hidden">
                                        <div 
                                            className="bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${ourGuildOccupancy}%` }}
                                        ></div>
                                    </div>
                                </div>
                                
                                {/* 상대 길드 */}
                                <div>
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[9px] font-semibold text-red-300 truncate">{enemyGuildName}</span>
                                        <span className="text-[9px] font-bold text-red-300">{enemyGuildOccupancy}%</span>
                                    </div>
                                    <div className="w-full bg-gray-700/50 rounded-full h-2 border border-gray-600/50 overflow-hidden">
                                        <div 
                                            className="bg-gradient-to-r from-red-500 via-orange-400 to-red-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${enemyGuildOccupancy}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex-shrink-0 mt-2">
                        <span className="text-xs font-semibold text-highlight">입장하기</span>
                    </div>
                </div>
            </div>
        </button>
    );
};

const GuildBossGuideModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [selectedBoss, setSelectedBoss] = useState<GuildBossInfo>(GUILD_BOSSES[0]);

    const getBossTheme = (bossId: string) => {
        switch (bossId) {
            case 'boss_1': return { color: 'from-blue-600 to-cyan-600', border: 'border-blue-400/60', text: 'text-blue-300' };
            case 'boss_2': return { color: 'from-red-600 to-orange-600', border: 'border-red-400/60', text: 'text-red-300' };
            case 'boss_3': return { color: 'from-green-600 to-emerald-600', border: 'border-green-400/60', text: 'text-green-300' };
            case 'boss_4': return { color: 'from-purple-600 to-indigo-600', border: 'border-purple-400/60', text: 'text-purple-300' };
            case 'boss_5': return { color: 'from-yellow-600 to-amber-600', border: 'border-yellow-400/60', text: 'text-yellow-300' };
            default: return { color: 'from-gray-600 to-slate-600', border: 'border-gray-400/60', text: 'text-gray-300' };
        }
    };

    const theme = getBossTheme(selectedBoss.id);

    return (
        <DraggableWindow title="길드 보스 도감" onClose={onClose} windowId="guild-boss-guide" initialWidth={1100} initialHeight={800} variant="store">
            <div className="flex gap-4 h-full relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-stone-950/50 via-neutral-900/30 to-stone-950/50 pointer-events-none"></div>
                <div className="relative z-10 flex gap-4 w-full">
                <div className="w-1/3 flex flex-col gap-2 overflow-y-auto pr-2">
                    {GUILD_BOSSES.map(boss => {
                        const bossTheme = getBossTheme(boss.id);
                        const isSelected = selectedBoss.id === boss.id;
                        return (
                            <button
                                key={boss.id}
                                onClick={() => setSelectedBoss(boss)}
                                className={`flex items-center gap-2.5 p-3 rounded-xl transition-all w-full border-2 relative overflow-hidden ${
                                    isSelected 
                                        ? `bg-gradient-to-br ${bossTheme.color} ${bossTheme.border} shadow-xl` 
                                        : 'bg-gradient-to-br from-stone-900/90 to-stone-800/80 border-stone-600/60 hover:border-stone-500/80 hover:shadow-lg'
                                }`}
                            >
                                {isSelected && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none"></div>
                                )}
                                <div className={`w-12 h-12 bg-gradient-to-br ${isSelected ? 'from-white/20 to-white/10' : 'from-stone-800/80 to-stone-900/80'} rounded-lg flex items-center justify-center border-2 ${isSelected ? 'border-white/30' : 'border-stone-600/60'} shadow-lg flex-shrink-0 relative z-10`}>
                                    <img src={boss.image} alt={boss.name} className="w-10 h-10 object-contain drop-shadow-xl" />
                                </div>
                                <span className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-stone-300'} relative z-10 truncate`}>{boss.name}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="w-2/3 bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-4 rounded-xl overflow-y-auto border-2 border-stone-600/60 shadow-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
                    <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-4 pb-4 border-b-2 border-stone-700/60">
                        <div className={`w-24 h-24 bg-gradient-to-br ${theme.color} rounded-xl flex items-center justify-center border-2 ${theme.border} shadow-xl relative overflow-hidden flex-shrink-0`}>
                            <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent pointer-events-none"></div>
                            <img src={selectedBoss.image} alt={selectedBoss.name} className="w-20 h-20 object-contain drop-shadow-xl relative z-10" />
                        </div>
                        <div className="flex-grow min-w-0">
                            <h3 className="text-xl font-bold text-white mb-1 drop-shadow-lg truncate">{selectedBoss.name}</h3>
                            <p className="text-sm text-stone-300 leading-relaxed line-clamp-2">{selectedBoss.description}</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="bg-gradient-to-br from-amber-900/60 via-yellow-800/50 to-amber-900/60 p-3 rounded-xl border-2 border-amber-500/60 shadow-xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-yellow-400/5 to-amber-500/10 pointer-events-none"></div>
                            <div className="relative z-10">
                                <h4 className="font-bold text-sm text-amber-300 mb-2 flex items-center gap-1.5">
                                    <span className="text-base">📖</span>
                                    공략 가이드
                                </h4>
                                <p className="text-xs text-stone-200 leading-relaxed">{selectedBoss.strategyGuide}</p>
                            </div>
                        </div>
                        <div className="bg-gradient-to-br from-stone-800/80 to-stone-900/80 p-3 rounded-xl border-2 border-stone-600/60 shadow-xl">
                            <h4 className="font-bold text-sm text-cyan-300 mb-3 flex items-center gap-1.5">
                                <span className="text-base">⚔️</span>
                                주요 스킬
                            </h4>
                            <ul className="space-y-2">
                                {selectedBoss.skills.map(skill => (
                                    <li key={skill.id} className="flex items-start gap-3 bg-gradient-to-br from-stone-900/80 to-stone-800/60 p-2.5 rounded-lg border border-stone-700/50 shadow-lg">
                                        <div className="w-12 h-12 bg-gradient-to-br from-stone-800/90 to-stone-900/90 rounded-lg flex items-center justify-center border-2 border-stone-600/60 shadow-lg flex-shrink-0">
                                            <img src={skill.image || ''} alt={skill.name} className="w-10 h-10 object-contain drop-shadow-lg" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-white text-sm mb-0.5">{skill.name}</p>
                                            <p className="text-xs text-stone-300 leading-relaxed">{skill.description}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gradient-to-br from-blue-900/60 via-indigo-800/50 to-blue-900/60 p-3 rounded-xl border-2 border-blue-500/60 shadow-xl relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-indigo-400/5 to-blue-500/10 pointer-events-none"></div>
                                <div className="relative z-10">
                                    <h4 className="font-bold text-xs text-blue-300 mb-1.5 flex items-center gap-1.5">
                                        <span className="text-sm">💪</span>
                                        추천 능력치
                                    </h4>
                                    <p className="text-xs text-stone-200 leading-relaxed">{selectedBoss.recommendedStats.join(', ')}</p>
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-purple-900/60 via-violet-800/50 to-purple-900/60 p-3 rounded-xl border-2 border-purple-500/60 shadow-xl relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-violet-400/5 to-purple-500/10 pointer-events-none"></div>
                                <div className="relative z-10">
                                    <h4 className="font-bold text-xs text-purple-300 mb-1.5 flex items-center gap-1.5">
                                        <span className="text-sm">🔬</span>
                                        추천 연구
                                    </h4>
                                    <p className="text-xs text-stone-200 leading-relaxed">
                                        {selectedBoss.recommendedResearch.length > 0 
                                            ? selectedBoss.recommendedResearch.map(id => GUILD_RESEARCH_PROJECTS[id]?.name).join(', ')
                                            : '없음'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
                </div>
            </div>
        </DraggableWindow>
    );
};

const GuildIconSelectModal: React.FC<{ guild: GuildType; onClose: () => void; onSelect: (icon: string) => void }> = ({ guild, onClose, onSelect }) => {
    const guildIcons = Array.from({ length: 11 }, (_, i) => `/images/guild/profile/icon${i + 1}.png`);
    const [selectedIcon, setSelectedIcon] = useState<string>(getGuildIconPath(guild.icon));

    return (
        <DraggableWindow title="길드 마크 선택" onClose={onClose} windowId="guild-icon-select" initialWidth={600} variant="store">
            <div className="space-y-4">
                <div className="text-sm text-tertiary mb-4">
                    변경할 길드 마크를 선택하세요.
                </div>
                <div className="grid grid-cols-4 gap-4">
                    {guildIcons.map((icon, index) => {
                        const isSelected = selectedIcon === icon;
                        return (
                            <button
                                key={icon}
                                onClick={() => setSelectedIcon(icon)}
                                className={`relative p-3 rounded-xl border-2 transition-all ${
                                    isSelected
                                        ? 'bg-accent/20 border-accent shadow-lg shadow-accent/30'
                                        : 'bg-stone-800/50 border-stone-600/50 hover:bg-stone-700/70 hover:border-stone-500/70'
                                }`}
                            >
                                <img src={icon} alt={`길드 마크 ${index + 1}`} className="w-full h-full object-cover rounded-lg" />
                                {isSelected && (
                                    <div className="absolute top-1 right-1 w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                                        <span className="text-xs">✓</span>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-stone-600/50">
                    <Button onClick={onClose} colorScheme="gray">취소</Button>
                    <Button onClick={() => onSelect(selectedIcon)} colorScheme="green">적용</Button>
                </div>
            </div>
        </DraggableWindow>
    );
};

interface GuildDashboardProps {
    guild: GuildType;
    guildDonationAnimation: { coins: number; research: number; type: 'gold' | 'diamond' } | null;
    onDonationComplete?: (coins: number, research: number, type: 'gold' | 'diamond') => void;
}

type GuildTab = 'home' | 'members' | 'management';

export const GuildDashboard: React.FC<GuildDashboardProps> = ({ guild, guildDonationAnimation, onDonationComplete }) => {
    const { currentUserWithStatus, handlers } = useAppContext();
    const [activeTab, setActiveTab] = useState<GuildTab>('home');
    const [isMissionsOpen, setIsMissionsOpen] = useState(false);
    const [isResearchOpen, setIsResearchOpen] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [isBossGuideOpen, setIsBossGuideOpen] = useState(false);
    const [isShopOpen, setIsShopOpen] = useState(false);
    const [isIconSelectOpen, setIsIconSelectOpen] = useState(false);
    const goldButtonRef = useRef<HTMLDivElement>(null);
    const diamondButtonRef = useRef<HTMLDivElement>(null);
    const [goldButtonPos, setGoldButtonPos] = useState<{ top: number; left: number } | null>(null);
    const [diamondButtonPos, setDiamondButtonPos] = useState<{ top: number; left: number } | null>(null);

    const myMemberInfo = useMemo(() => {
        if (!currentUserWithStatus?.id) return undefined;
        let member = guild.members?.find(m => m.userId === currentUserWithStatus.id);

        // Workaround for admin user ID mismatch
        if (!member && currentUserWithStatus.id === 'user-admin-static-id') {
            member = guild.members?.find(m => m.nickname === '관리자');
        }
        return member;
    }, [guild.members, currentUserWithStatus?.id, currentUserWithStatus?.nickname]);

    const canManage = myMemberInfo?.role === 'leader' || myMemberInfo?.role === 'officer';



    const xpForNextLevel = GUILD_XP_PER_LEVEL(guild.level);
    const xpProgress = Math.min(((guild.xp ?? 0) / xpForNextLevel) * 100, 100);
    const myGuildCoins = currentUserWithStatus?.guildCoins ?? 0;
    const myBossTickets = currentUserWithStatus?.guildBossAttempts !== undefined ? GUILD_BOSS_MAX_ATTEMPTS - currentUserWithStatus.guildBossAttempts : GUILD_BOSS_MAX_ATTEMPTS;
    
    const missionTabNotification = useMemo(() => {
        if (!currentUserWithStatus || !myMemberInfo || !guild.weeklyMissions) return false;
        
        const now = Date.now();
        const isExpired = guild.lastMissionReset && isDifferentWeekKST(guild.lastMissionReset, now);
        if (isExpired) return false; // 초기화된 경우 보상 받을 수 없음
        
        // 초기화 전 보상 받을 내역이 있는지 확인
        return guild.weeklyMissions.some(m => {
            const isComplete = (m.progress ?? 0) >= (m.target ?? 0);
            const isClaimed = m.claimedBy?.includes(currentUserWithStatus.id) ?? false;
            return isComplete && !isClaimed;
        });
    }, [guild.weeklyMissions, guild.lastMissionReset, myMemberInfo, currentUserWithStatus]);

    // 버튼 위치 계산 (애니메이션용)
    useEffect(() => {
        if (!guildDonationAnimation) return;
        
        const updatePositions = () => {
            if (goldButtonRef.current) {
                const rect = goldButtonRef.current.getBoundingClientRect();
                setGoldButtonPos({ top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 });
            }
            if (diamondButtonRef.current) {
                const rect = diamondButtonRef.current.getBoundingClientRect();
                setDiamondButtonPos({ top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 });
            }
        };
        
        // 약간의 지연을 두고 위치 계산 (DOM이 업데이트된 후)
        const timeoutId = setTimeout(updatePositions, 100);
        window.addEventListener('resize', updatePositions);
        window.addEventListener('scroll', updatePositions);
        
        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', updatePositions);
            window.removeEventListener('scroll', updatePositions);
        };
    }, [guildDonationAnimation]);

    // 애니메이션 컴포넌트
    const goldAnimation = useMemo(() => {
        if (!guildDonationAnimation || guildDonationAnimation.type !== 'gold' || !goldButtonPos) return null;
        return (
            <div 
                className="fixed -translate-x-1/2 -translate-y-full animate-float-up-and-fade z-[100] pointer-events-none whitespace-nowrap" 
                style={{ 
                    animationDelay: '0ms',
                    top: `${goldButtonPos.top}px`,
                    left: `${goldButtonPos.left}px`
                }}
            >
                <div className="flex items-center gap-2 bg-gradient-to-r from-amber-900/95 via-yellow-900/95 to-amber-800/95 px-4 py-2 rounded-lg border-2 border-amber-400/60 shadow-[0_4px_12px_rgba(251,191,36,0.6)] backdrop-blur-sm">
                    <img src="/images/guild/tokken.png" alt="Coin" className="w-5 h-5 drop-shadow-md flex-shrink-0" />
                    <span className="text-sm font-bold text-yellow-300 drop-shadow-lg whitespace-nowrap">+{guildDonationAnimation.coins}</span>
                    <img src="/images/guild/button/guildlab.png" alt="Research" className="w-5 h-5 drop-shadow-md flex-shrink-0" />
                    <span className="text-sm font-bold text-blue-300 drop-shadow-lg whitespace-nowrap">+{guildDonationAnimation.research} RP</span>
                </div>
            </div>
        );
    }, [guildDonationAnimation, goldButtonPos]);

    const diamondAnimation = useMemo(() => {
        if (!guildDonationAnimation || guildDonationAnimation.type !== 'diamond' || !diamondButtonPos) return null;
        return (
            <div 
                className="fixed -translate-x-1/2 -translate-y-full animate-float-up-and-fade z-[100] pointer-events-none whitespace-nowrap" 
                style={{ 
                    animationDelay: '0ms',
                    top: `${diamondButtonPos.top}px`,
                    left: `${diamondButtonPos.left}px`
                }}
            >
                <div className="flex items-center gap-2 bg-gradient-to-r from-blue-900/95 via-indigo-900/95 to-purple-900/95 px-4 py-2 rounded-lg border-2 border-blue-400/60 shadow-[0_4px_12px_rgba(59,130,246,0.6)] backdrop-blur-sm">
                    <img src="/images/guild/tokken.png" alt="Coin" className="w-5 h-5 drop-shadow-md flex-shrink-0" />
                    <span className="text-sm font-bold text-yellow-300 drop-shadow-lg whitespace-nowrap">+{guildDonationAnimation.coins}</span>
                    <img src="/images/guild/button/guildlab.png" alt="Research" className="w-5 h-5 drop-shadow-md flex-shrink-0" />
                    <span className="text-sm font-bold text-blue-300 drop-shadow-lg whitespace-nowrap">+{guildDonationAnimation.research} RP</span>
                </div>
            </div>
        );
    }, [guildDonationAnimation, diamondButtonPos]);

    const tabs = [
        { id: 'home' as GuildTab, label: '길드홈' },
        { id: 'members' as GuildTab, label: '길드원' },
    ];
    if (canManage) {
        tabs.push({ id: 'management' as GuildTab, label: '관리' });
    }
    
    const RightPanel: React.FC<{ guildDonationAnimation: { coins: number; research: number; type: 'gold' | 'diamond' } | null; onDonationComplete?: (coins: number, research: number, type: 'gold' | 'diamond') => void; goldButtonRef: React.RefObject<HTMLDivElement>; diamondButtonRef: React.RefObject<HTMLDivElement> }> = ({ guildDonationAnimation, onDonationComplete, goldButtonRef, diamondButtonRef }) => (
        <div className="lg:col-span-2 xl:col-span-2 flex flex-col gap-3 h-full min-h-0 overflow-visible">
            <GuildDonationPanel guildDonationAnimation={guildDonationAnimation} onDonationComplete={onDonationComplete} goldButtonRef={goldButtonRef} diamondButtonRef={diamondButtonRef} />
            <ActivityPanel 
                onOpenMissions={() => setIsMissionsOpen(true)} 
                onOpenResearch={() => setIsResearchOpen(true)} 
                onOpenShop={() => setIsShopOpen(true)} 
                missionNotification={missionTabNotification} 
                onOpenBossGuide={() => setIsBossGuideOpen(true)} 
            />
            <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">
                <BossPanel guild={guild} className="flex-1" />
                <WarPanel guild={guild} className="flex-1" />
            </div>
        </div>
    );    return (
        <div 
            className="p-4 w-full max-w-[95%] xl:max-w-[98%] mx-auto h-full flex flex-col relative"
        >
            <div className="relative z-10 h-full flex flex-col">
            {isMissionsOpen && <GuildMissionsPanel guild={guild} myMemberInfo={myMemberInfo} onClose={() => setIsMissionsOpen(false)} />}
            {isResearchOpen && <GuildResearchPanel guild={guild} myMemberInfo={myMemberInfo} onClose={() => setIsResearchOpen(false)} />}
            {isShopOpen && <GuildShopModal onClose={() => setIsShopOpen(false)} isTopmost={true} />}
            {isHelpOpen && <HelpModal mode="guild" onClose={() => setIsHelpOpen(false)} />}
            {isBossGuideOpen && <GuildBossGuideModal onClose={() => setIsBossGuideOpen(false)} />}
            {isIconSelectOpen && <GuildIconSelectModal guild={guild} onClose={() => setIsIconSelectOpen(false)} onSelect={(icon) => {
                handlers.handleAction({ type: 'GUILD_UPDATE_PROFILE', payload: { guildId: guild.id, icon } });
                setIsIconSelectOpen(false);
            }} />}
            
            <header className="relative flex justify-center items-center mb-4 flex-shrink-0 py-3 bg-gradient-to-r from-secondary/80 via-secondary/60 to-secondary/80 rounded-xl border border-accent/20 shadow-lg">
                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                    <BackButton onClick={() => window.location.hash = '#/profile'} />
                </div>
                
                <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-3">
                        <div className="relative group flex-shrink-0">
                            <div className="absolute inset-0 bg-gradient-to-br from-accent/30 to-accent/10 rounded-xl blur-sm"></div>
                            <img src={getGuildIconPath(guild.icon)} alt="Guild Icon" className="w-16 h-16 bg-tertiary rounded-xl border-2 border-accent/30 shadow-lg relative z-10" />
                            {canManage && (
                                <button
                                    onClick={() => setIsIconSelectOpen(true)}
                                    className="absolute -bottom-1 -right-1 w-6 h-6 bg-accent rounded-full flex items-center justify-center shadow-lg hover:bg-accent/80 transition-all z-20 border-2 border-secondary"
                                    title="길드 마크 변경"
                                >
                                    <span className="text-xs">✏️</span>
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-highlight to-accent bg-clip-text text-transparent">{guild.name}</h1>
                            <div className="text-sm text-secondary">레벨 {guild.level}</div>
                        </div>
                    </div>
                    <div className="w-64">
                        <div className="flex justify-between text-xs text-secondary mb-1.5">
                            <span className="font-semibold">경험치</span>
                            <span className="font-semibold">{(guild.xp ?? 0).toLocaleString()} / {xpForNextLevel.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-gray-700/50 rounded-full h-3 border border-gray-600/50 overflow-hidden shadow-inner">
                            <div 
                                className="bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" 
                                style={{ width: `${xpProgress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <div className="flex flex-col items-end gap-2">
                        <button 
                            onClick={() => setIsHelpOpen(true)} 
                            className="p-2 rounded-xl bg-tertiary/50 hover:bg-tertiary/70 transition-all hover:scale-110 border border-accent/20 shadow-md" 
                            title="길드 도움말"
                        >
                            <img src="/images/button/help.png" alt="도움말" className="h-6 w-6" />
                        </button>
                        <div className="flex items-center gap-3 bg-gradient-to-br from-tertiary/80 to-tertiary/60 p-3 rounded-xl border border-accent/20 shadow-lg">
                            <div className="flex items-center gap-2 pr-3 border-r border-color/50" title="나의 길드 코인">
                                <img src="/images/guild/tokken.png" alt="Guild Coin" className="w-7 h-7 drop-shadow-md" />
                                <span className="font-bold text-lg text-yellow-300">{myGuildCoins.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2" title="나의 보스전 참여 티켓">
                                <img src="/images/guild/ticket.png" alt="Boss Ticket" className="w-7 h-7 drop-shadow-md" />
                                <span className="font-bold text-lg text-blue-300">{myBossTickets} / {GUILD_BOSS_MAX_ATTEMPTS}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3 xl:col-span-3 flex flex-col gap-4 min-h-0">
                    <div className="flex-shrink-0">
                        <div className="flex bg-gradient-to-r from-stone-800/80 to-stone-700/60 p-1 rounded-xl w-full max-w-md border border-stone-600/40 shadow-md">
                            {tabs.map(tab => {
                                const tabColors = {
                                    home: { active: 'from-amber-600 to-amber-500', inactive: 'text-amber-300/70 hover:text-amber-300' },
                                    members: { active: 'from-blue-600 to-blue-500', inactive: 'text-blue-300/70 hover:text-blue-300' },
                                    management: { active: 'from-purple-600 to-purple-500', inactive: 'text-purple-300/70 hover:text-purple-300' },
                                };
                                const colors = tabColors[tab.id] || { active: 'from-accent to-accent/80', inactive: 'text-tertiary hover:text-highlight' };
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                                            activeTab === tab.id 
                                                ? `bg-gradient-to-r ${colors.active} text-white shadow-lg` 
                                                : `${colors.inactive} hover:bg-stone-700/50`
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        {activeTab === 'home' && <GuildHomePanel guild={guild} myMemberInfo={myMemberInfo} />}
                        {activeTab === 'members' && (
                            <NineSlicePanel className="h-full">
                                <GuildMembersPanel guild={guild} myMemberInfo={myMemberInfo} />
                            </NineSlicePanel>
                        )}
                        {activeTab === 'management' && canManage && (
                            <NineSlicePanel className="h-full">
                                <GuildManagementPanel guild={guild} />
                            </NineSlicePanel>
                        )}
                    </div>
                </div>

                <RightPanel guildDonationAnimation={guildDonationAnimation} onDonationComplete={onDonationComplete} goldButtonRef={goldButtonRef} diamondButtonRef={diamondButtonRef} />
            </main>
            {goldAnimation}
            {diamondAnimation}
            </div>
        </div>
    );
};