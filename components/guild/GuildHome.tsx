import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '../../hooks/useAppContext.js';
import { Guild as GuildType } from '../../types/index.js';
import { GuildDashboard } from './GuildDashboard.js';
import BackButton from '../BackButton.js';

interface GuildHomeProps {
    initialGuild?: GuildType;
}

const GuildHome: React.FC<GuildHomeProps> = ({ initialGuild }) => {
    const { currentUserWithStatus, guilds, handlers } = useAppContext();
    const [guildDonationAnimation, setGuildDonationAnimation] = useState<{ coins: number; research: number; type: 'gold' | 'diamond' } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasLoadedRef = useRef(false);

    // 현재 사용자의 길드 찾기
    const myGuild = useMemo(() => {
        const guildId = initialGuild?.id || currentUserWithStatus?.guildId;
        if (!guildId) return null;
        return guilds[guildId] || initialGuild || null;
    }, [guilds, currentUserWithStatus?.guildId, initialGuild]);

    // 새로고침 시 길드 정보 로드 (guilds 상태가 비어있을 때만)
    useEffect(() => {
        const guildId = currentUserWithStatus?.guildId;
        if (!guildId) {
            hasLoadedRef.current = false;
            return;
        }
        
        // guilds 상태에 길드가 없으면 로드
        if (!guilds[guildId] && !initialGuild && !hasLoadedRef.current) {
            const loadGuildInfo = async () => {
                if (isLoading) return;
                setIsLoading(true);
                hasLoadedRef.current = true;
                try {
                    const result: any = await handlers.handleAction({ type: 'GET_GUILD_INFO' });
                    if (result?.error) {
                        console.warn('[GuildHome] Failed to load guild info:', result.error);
                        hasLoadedRef.current = false; // Retry on next render
                    } else if (result?.clientResponse?.guild) {
                        // 길드 정보가 로드되었으면 hasLoadedRef를 true로 유지
                        hasLoadedRef.current = true;
                    }
                } catch (error) {
                    console.error('[GuildHome] Error loading guild info:', error);
                    hasLoadedRef.current = false; // Retry on next render
                } finally {
                    setIsLoading(false);
                }
            };
            loadGuildInfo();
        } else if (guilds[guildId] || initialGuild) {
            hasLoadedRef.current = true;
        }
    }, [currentUserWithStatus?.guildId, guilds, initialGuild, handlers, isLoading]);

    // 길드 기부 애니메이션 처리 (WebSocket 이벤트 또는 액션 결과에서 받을 수 있음)
    useEffect(() => {
        // 기부 애니메이션은 3초 후 자동으로 사라짐
        if (guildDonationAnimation) {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
            }
            animationTimeoutRef.current = setTimeout(() => {
                setGuildDonationAnimation(null);
            }, 3000);
        }
        return () => {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
            }
        };
    }, [guildDonationAnimation]);

    // 로딩 중이면 로딩 표시
    if (isLoading && currentUserWithStatus?.guildId && !myGuild) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-400">길드 정보를 불러오는 중...</p>
            </div>
        );
    }

    // 길드가 없으면 프로필로 리다이렉트
    useEffect(() => {
        if (!myGuild && !isLoading && hasLoadedRef.current) {
            window.location.hash = '#/profile';
        }
    }, [myGuild, isLoading]);

    // 길드가 없으면 로딩 또는 리다이렉트 중 표시
    if (!myGuild) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <BackButton onClick={() => window.location.hash = '#/profile'} />
                <p className="text-gray-400">길드 정보를 불러오는 중...</p>
            </div>
        );
    }

    // 길드가 있으면 대시보드 표시
    return <GuildDashboard guild={myGuild} guildDonationAnimation={guildDonationAnimation} onDonationComplete={(coins: number, research: number, type: 'gold' | 'diamond') => setGuildDonationAnimation({ coins, research, type })} />;
};

export default GuildHome;
