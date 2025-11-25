import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Guild as GuildType, ChatMessage, GuildMemberRole, GuildMember } from '../../types/index.js';
import { useAppContext } from '../../hooks/useAppContext.js';
import Button from '../Button.js';
import { GUILD_CHECK_IN_MILESTONE_REWARDS } from '../../constants/index.js';
import { isSameDayKST, formatDateTimeKST } from '../../utils/timeUtils.js';
import Avatar from '../Avatar.js';
import { AVATAR_POOL, BORDER_POOL } from '../../constants/index.js';

// 고급 버튼 스타일 함수
const luxuryButtonBase = "relative overflow-hidden whitespace-normal break-keep text-sm px-4 py-2 rounded-xl backdrop-blur-sm font-semibold tracking-wide transition-all duration-200 flex items-center justify-center gap-1";

const getLuxuryButtonClasses = (variant: 'primary' | 'danger' | 'neutral' | 'accent' | 'success' | 'green' | 'gray' = 'primary') => {
    const variants: Record<string, string> = {
        primary: `${luxuryButtonBase} border border-cyan-200/40 bg-gradient-to-br from-cyan-500/85 via-sky-500/80 to-indigo-500/80 text-white shadow-[0_18px_34px_-18px_rgba(59,130,246,0.55)] hover:-translate-y-0.5 hover:shadow-[0_24px_40px_-18px_rgba(96,165,250,0.6)]`,
        danger: `${luxuryButtonBase} border border-rose-300/45 bg-gradient-to-br from-rose-600/90 via-red-500/85 to-amber-400/80 text-white shadow-[0_18px_36px_-16px_rgba(248,113,113,0.55)] hover:-translate-y-0.5 hover:shadow-[0_24px_42px_-18px_rgba(248,113,113,0.65)]`,
        neutral: `${luxuryButtonBase} border border-slate-400/35 bg-gradient-to-br from-slate-800/85 via-slate-900/80 to-black/70 text-slate-100 shadow-[0_16px_32px_-20px_rgba(148,163,184,0.5)] hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-18px_rgba(203,213,225,0.55)]`,
        accent: `${luxuryButtonBase} border border-amber-300/55 bg-gradient-to-br from-amber-400/85 via-yellow-400/75 to-orange-400/80 text-slate-900 shadow-[0_18px_36px_-18px_rgba(251,191,36,0.5)] hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-18px_rgba(251,191,36,0.6)]`,
        success: `${luxuryButtonBase} border border-emerald-300/55 bg-gradient-to-br from-emerald-500/85 via-lime-500/75 to-green-500/80 text-slate-900 shadow-[0_18px_34px_-18px_rgba(74,222,128,0.45)] hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-18px_rgba(74,222,128,0.6)]`,
        green: `${luxuryButtonBase} border border-emerald-300/55 bg-gradient-to-br from-emerald-500/85 via-lime-500/75 to-green-500/80 text-white shadow-[0_18px_34px_-18px_rgba(74,222,128,0.45)] hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-18px_rgba(74,222,128,0.6)]`,
        gray: `${luxuryButtonBase} border border-slate-400/35 bg-gradient-to-br from-slate-700/85 via-slate-800/80 to-slate-900/70 text-slate-300 shadow-[0_16px_32px_-20px_rgba(148,163,184,0.4)] opacity-60 cursor-not-allowed`,
    };
    return variants[variant] || variants.primary;
};

const GuildCheckInPanel: React.FC<{ guild: GuildType }> = ({ guild }) => {
    const { handlers, currentUserWithStatus } = useAppContext();

    const now = Date.now();
    const myCheckInTimestamp = guild.checkIns?.[currentUserWithStatus!.id];
    const hasCheckedInToday = myCheckInTimestamp ? isSameDayKST(myCheckInTimestamp, now) : false;

    const todaysCheckIns = Object.values(guild.checkIns || {}).filter(ts => isSameDayKST(ts, now)).length;
    const totalMembers = guild.memberLimit || (guild.members?.length || 0);
    
    const maxProgress = GUILD_CHECK_IN_MILESTONE_REWARDS[GUILD_CHECK_IN_MILESTONE_REWARDS.length - 1].count;
    // 막대그래프는 출석 인원수 기준으로 채워지되, 최대 maxProgress까지만 표시
    const progressPercent = totalMembers > 0 ? Math.min((todaysCheckIns / totalMembers) * 100, 100) : 0;

    const handleCheckIn = async () => {
        const result = await handlers.handleAction({ type: 'GUILD_CHECK_IN' }) as any;
        if (result?.error) {
            console.error('[GuildCheckInPanel] Check-in failed:', result.error);
            alert(result.error);
        } else {
            // 성공 시 길드 정보를 다시 가져옴
            await handlers.handleAction({ type: 'GET_GUILD_INFO' });
        }
    };
    
    const handleClaimMilestone = (index: number) => {
        handlers.handleAction({ type: 'GUILD_CLAIM_CHECK_IN_REWARD', payload: { milestoneIndex: index } });
    };

    return (
        <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-4 rounded-xl flex flex-col h-full border-2 border-stone-600/60 shadow-2xl backdrop-blur-md relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-lg text-highlight drop-shadow-lg flex items-center gap-2">
                        <span className="text-xl">📅</span>
                        <span>길드 출석부</span>
                    </h3>
                    <Button 
                        onClick={handleCheckIn} 
                        disabled={hasCheckedInToday} 
                        colorScheme="none"
                        className={hasCheckedInToday ? getLuxuryButtonClasses('gray') : getLuxuryButtonClasses('green')}
                    >
                        {hasCheckedInToday ? '출석 완료' : '출석하기'}
                    </Button>
                </div>
                <p className="text-sm text-tertiary mb-3">
                    오늘 출석: <span className="font-bold text-primary text-base">{todaysCheckIns} / {totalMembers}</span>명
                </p>
            </div>
            <div className="my-3 relative z-10">
                <div className="w-full bg-tertiary/60 rounded-full h-3 relative border-2 border-black/30 shadow-inner backdrop-blur-sm">
                    <div className="bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-600 h-full rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(74,222,128,0.6)]" style={{ width: `${progressPercent}%` }}></div>
                    {GUILD_CHECK_IN_MILESTONE_REWARDS.map((milestone, index) => {
                        // 마일스톤 구분선: totalMembers 기준으로 위치 계산
                        const milestonePercent = totalMembers > 0 
                            ? Math.min((milestone.count / totalMembers) * 100, 100) 
                            : 0;
                        // 마일스톤이 totalMembers보다 크면 표시하지 않음
                        if (milestone.count > totalMembers) return null;
                        return (
                            <div 
                                key={`milestone-line-${index}`} 
                                className="absolute top-0 h-full w-0.5 bg-yellow-400/80 z-10 border-l border-yellow-300 shadow-[0_0_4px_rgba(251,191,36,0.8)]" 
                                style={{ left: `${milestonePercent}%` }} 
                                title={`${milestone.count}명 보상`}
                            >
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-yellow-300 font-bold whitespace-nowrap drop-shadow-lg bg-black/40 px-1 rounded">
                                    {milestone.count}명
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 flex-grow relative z-10">
                {GUILD_CHECK_IN_MILESTONE_REWARDS.map((milestone, index) => {
                    const isAchieved = todaysCheckIns >= milestone.count;
                    const isClaimed = guild.dailyCheckInRewardsClaimed?.some(c => c.userId === currentUserWithStatus!.id && c.milestoneIndex === index);
                    const canClaim = isAchieved && !isClaimed && hasCheckedInToday;
                    
                    return (
                        <div key={index} className={`bg-gradient-to-br ${isAchieved ? 'from-yellow-900/40 via-amber-900/30 to-yellow-800/40' : 'from-tertiary/60 via-tertiary/50 to-tertiary/40'} p-3 rounded-xl text-center flex flex-col items-center justify-between border-2 ${isAchieved ? 'border-yellow-500/60 shadow-[0_0_15px_rgba(251,191,36,0.4)]' : 'border-transparent'} aspect-square backdrop-blur-sm transition-all hover:scale-105`}>
                            <div className="flex flex-col items-center">
                                <img src="/images/guild/tokken.png" alt="길드 코인" className="w-8 h-8 drop-shadow-lg mb-1"/>
                                <span className="text-base font-bold text-primary drop-shadow">+{milestone.reward.guildCoins}</span>
                                <p className="text-xs text-tertiary mt-0.5">{milestone.count}명</p>
                            </div>
                            <Button 
                                onClick={() => { if (canClaim) handleClaimMilestone(index); }} 
                                disabled={!canClaim} 
                                colorScheme="none"
                                className={canClaim ? `${getLuxuryButtonClasses('success')} !text-xs !py-1.5 !px-2 mt-2 w-full` : `${getLuxuryButtonClasses('gray')} !text-xs !py-1.5 !px-2 mt-2 w-full`}
                            >
                                {isClaimed ? '완료' : (isAchieved ? '받기' : '미달성')}
                            </Button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const GuildAnnouncementPanel: React.FC<{ guild: GuildType }> = ({ guild }) => (
    <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-4 rounded-xl flex flex-col h-full border-2 border-stone-600/60 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
        <h3 className="font-bold text-lg text-highlight mb-3 flex-shrink-0 relative z-10 drop-shadow-lg flex items-center gap-2">
            <span className="text-xl">📢</span>
            <span>길드 공지</span>
        </h3>
        <div className="flex-grow overflow-y-auto pr-2 bg-tertiary/50 p-4 rounded-lg min-h-0 border-2 border-black/20 shadow-inner backdrop-blur-sm relative z-10">
            <p className="text-sm text-primary whitespace-pre-wrap leading-relaxed">
                {guild.announcement || <span className="text-tertiary italic">등록된 공지사항이 없습니다.</span>}
            </p>
        </div>
    </div>
);

const GuildChat: React.FC<{ guild: GuildType, myMemberInfo: GuildMember | undefined }> = ({ guild, myMemberInfo }) => {
    const { handlers, allUsers, currentUserWithStatus } = useAppContext();
    const [message, setMessage] = useState('');
    const chatBodyRef = useRef<HTMLDivElement>(null);
    const userMap = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

    useEffect(() => {
        if (chatBodyRef.current) {
            chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
        }
    }, [guild.chatHistory]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (message.trim()) {
            handlers.handleAction({ type: 'SEND_GUILD_CHAT_MESSAGE', payload: { content: message } });
            setMessage('');
        }
    };

    const handleDelete = (msg: ChatMessage) => {
        if (window.confirm('메시지를 삭제하시겠습니까?')) {
            handlers.handleAction({ 
                type: 'GUILD_DELETE_CHAT_MESSAGE', 
                payload: { 
                    messageId: msg.id, 
                    timestamp: msg.timestamp 
                } 
            });
        }
    };

    return (
        <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 p-4 rounded-xl h-full flex flex-col border-2 border-stone-600/60 shadow-2xl backdrop-blur-md relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
            <h3 className="font-bold text-lg text-highlight mb-3 flex-shrink-0 relative z-10 drop-shadow-lg flex items-center gap-2">
                <span className="text-xl">💬</span>
                <span>길드 채팅</span>
            </h3>
            <div ref={chatBodyRef} className="flex-grow space-y-3 overflow-y-auto pr-2 mb-3 bg-tertiary/50 p-4 rounded-lg min-h-0 border-2 border-black/20 shadow-inner backdrop-blur-sm relative z-10">
                {guild.chatHistory && guild.chatHistory.length > 0 ? (
                    guild.chatHistory.map(msg => {
                        const senderId = msg.user?.id || msg.authorId;
                        const sender = senderId ? userMap.get(senderId) : undefined;
                        const avatarUrl = sender ? AVATAR_POOL.find(a => a.id === sender.avatarId)?.url : undefined;
                        const borderUrl = sender ? BORDER_POOL.find(b => b.id === sender.borderId)?.url : undefined;
                        const isMyMessage = senderId === currentUserWithStatus?.id;
                        const canManage = myMemberInfo?.role === 'leader' || myMemberInfo?.role === 'officer';

                        return (
                            <div key={msg.id || msg.timestamp || msg.createdAt} className="flex items-start gap-3 group p-2 rounded-lg hover:bg-black/10 transition-colors">
                                <div className="flex-shrink-0 mt-1">
                                    {sender && <Avatar userId={sender.id} userName={sender.nickname} avatarUrl={avatarUrl} borderUrl={borderUrl} size={36} />}
                                </div>
                                <div className="flex-grow">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-baseline gap-2">
                                            <span className="font-semibold text-primary text-sm">{msg.user?.nickname || sender?.nickname || 'Unknown'}</span>
                                            <span className="text-xs text-tertiary">{formatDateTimeKST(msg.timestamp || msg.createdAt)}</span>
                                        </div>
                                        {(isMyMessage || canManage) && !msg.system && msg.id && (
                                            <button onClick={() => handleDelete(msg as ChatMessage)} className="text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity font-semibold px-2 py-1 rounded hover:bg-red-500/20" aria-label="Delete message" title="메시지 삭제">삭제</button>
                                        )}
                                    </div>
                                    <p className="text-sm text-secondary break-words whitespace-pre-wrap leading-relaxed">{msg.text || msg.content || ''}</p>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="h-full flex items-center justify-center text-tertiary"><p className="italic">길드 채팅 메시지가 없습니다.</p></div>
                )}
            </div>
            <form onSubmit={handleSubmit} className="flex gap-3 flex-shrink-0 relative z-10">
                <textarea 
                    value={message} 
                    onChange={e => setMessage(e.target.value)} 
                    placeholder="메시지를 입력하세요..." 
                    className="flex-grow bg-tertiary/80 border-2 border-black/30 rounded-lg p-3 text-sm resize-none shadow-inner backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all" 
                    rows={1} 
                    maxLength={200} 
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }} 
                />
                <Button 
                    type="submit" 
                    colorScheme="none"
                    className={getLuxuryButtonClasses('primary')}
                >
                    전송
                </Button>
            </form>
        </div>
    );
};

interface GuildHomePanelProps {
    guild: GuildType;
    myMemberInfo: GuildMember | undefined;
}

const GuildHomePanel: React.FC<GuildHomePanelProps> = ({ guild, myMemberInfo }) => {
    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-shrink-0">
                <GuildCheckInPanel guild={guild} />
                <GuildAnnouncementPanel guild={guild} />
            </div>
            <div className="flex-grow min-h-0">
                <GuildChat guild={guild} myMemberInfo={myMemberInfo} />
            </div>
        </div>
    );
};

export default GuildHomePanel;
