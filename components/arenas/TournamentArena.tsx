
import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { TournamentType, UserWithStatus, PlayerForTournament } from '../../types';
import { useAppContext } from '../../hooks/useAppContext';
import { TournamentBracket } from '../TournamentBracket';
import Button from '../Button';
import { TOURNAMENT_DEFINITIONS } from '../../constants';

// Error Boundary for TournamentBracket
class TournamentBracketErrorBoundary extends Component<
    { children: ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[TournamentBracketErrorBoundary] Error caught:', error, errorInfo);
    }

    componentDidUpdate(prevProps: { children: ReactNode }) {
        // props가 변경되면 에러 상태 리셋
        if (prevProps.children !== this.props.children && this.state.hasError) {
            this.setState({ hasError: false, error: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 text-center">
                    <p className="text-red-400 mb-4">토너먼트 화면을 불러오는 중 오류가 발생했습니다.</p>
                    <Button onClick={() => { window.location.hash = '#/tournament'; }}>토너먼트 로비로 돌아가기</Button>
                    {import.meta.env.DEV && this.state.error && (
                        <details className="mt-4 text-left">
                            <summary className="cursor-pointer text-gray-400">에러 상세 정보</summary>
                            <pre className="mt-2 p-2 bg-gray-800 rounded text-xs text-red-300 overflow-auto">
                                {this.state.error.toString()}
                                {this.state.error.stack}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

interface TournamentArenaProps {
    type: TournamentType;
}

const TournamentArena: React.FC<TournamentArenaProps> = ({ type }) => {
    const { currentUserWithStatus, handlers, allUsers } = useAppContext();
    const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

    useEffect(() => {
        const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    // stateKey 결정
    let stateKey: keyof Pick<UserWithStatus, 'lastNeighborhoodTournament' | 'lastNationalTournament' | 'lastWorldTournament'>;
    switch (type) {
        case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
        case 'national': stateKey = 'lastNationalTournament'; break;
        case 'world': stateKey = 'lastWorldTournament'; break;
        default: return <div>Invalid tournament type</div>;
    }

    const tournamentState = currentUserWithStatus?.[stateKey] as any;
    const latestTournamentStateRef = React.useRef<typeof tournamentState | null>(tournamentState ?? null);

    React.useEffect(() => {
        latestTournamentStateRef.current = tournamentState ?? null;
    }, [tournamentState]);

    React.useEffect(() => {
        return () => {
            const latestState = latestTournamentStateRef.current;
            if (!latestState || latestState.status === 'round_in_progress') return;
            handlers.handleAction({ type: 'SAVE_TOURNAMENT_PROGRESS', payload: { type } })
                .catch(error => console.error('[TournamentArena] Failed to save tournament progress on unmount:', error));
        };
    }, [handlers, type]);
    const tournamentDefinition = TOURNAMENT_DEFINITIONS[type];

    // 토너먼트 상태가 있으면 최신 상태로 업데이트 (자동 시작하지 않음 - 사용자가 직접 경기 시작 버튼을 눌러야 함)
    // 각 경기장은 독립적으로 작동하므로 자동으로 START_TOURNAMENT_ROUND를 호출하지 않습니다.

    if (!currentUserWithStatus) {
        return (
            <div className="p-4 text-center">
                <p>사용자 정보를 불러오는 중입니다...</p>
                <Button onClick={() => { window.location.hash = '#/tournament'; }} className="mt-4">로비로 돌아가기</Button>
            </div>
        );
    }

    // 토너먼트 상태가 없을 때 자동으로 시작 시도
    const startAttemptedRef = React.useRef<Set<string>>(new Set());
    const startTimeoutRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map());
    const handlersRef = React.useRef(handlers);
    const prevTournamentStateRef = React.useRef<any>(tournamentState);
    
    // handlers 참조 업데이트 (의존성 배열에서 제거하기 위해)
    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    useEffect(() => {
        // 토너먼트 상태가 없고, 이 타입에 대해 아직 시작 시도를 하지 않았을 때만 시작
        const tournamentKey = `${type}-${currentUserWithStatus?.id || 'unknown'}`;
        const prevTournamentState = prevTournamentStateRef.current;
        
        // 이전 상태 저장
        prevTournamentStateRef.current = tournamentState;
        
        // 토너먼트 상태가 있으면 해당 키를 제거하고 타이머 정리 (다음에 다시 시작할 수 있도록)
        if (tournamentState) {
            // bracket_ready 상태에서 컨디션이 부여되지 않은 경우에만 컨디션 부여를 위해 START_TOURNAMENT_ROUND 호출
            // 이미 유효한 컨디션이 있으면(40-100 사이) 다시 호출하지 않음 (뒤로가기 후 다시 들어온 경우 컨디션 유지)
            if (tournamentState.status === 'bracket_ready' && 
                tournamentState.players.some((p: PlayerForTournament) => {
                    const hasValidCondition = p.condition !== undefined && 
                                              p.condition !== null && 
                                              p.condition !== 1000 && 
                                              p.condition >= 40 && 
                                              p.condition <= 100;
                    return !hasValidCondition;
                })) {
                handlersRef.current.handleAction({ 
                    type: 'START_TOURNAMENT_ROUND', 
                    payload: { type: type } 
                });
            }
            
            // 토너먼트가 새로 생성된 경우 (undefined -> 값)에만 제거
            if (!prevTournamentState && startAttemptedRef.current.has(tournamentKey)) {
                // 타이머 정리
                const timeout = startTimeoutRef.current.get(tournamentKey);
                if (timeout) {
                    clearTimeout(timeout);
                    startTimeoutRef.current.delete(tournamentKey);
                }
                // 약간의 지연 후 제거 (WebSocket 업데이트 대기)
                const timeoutId = setTimeout(() => {
                    startAttemptedRef.current.delete(tournamentKey);
                }, 5000);
                return () => clearTimeout(timeoutId);
            }
            return; // 토너먼트 상태가 있으면 더 이상 처리하지 않음
        }
        
        // 토너먼트 상태가 없고, 아직 시작 시도를 하지 않았을 때만 시작
        // 리다이렉트로 인한 무한 루프 방지: 현재 해시가 이미 해당 토너먼트 페이지인 경우에도 재시도 가능하도록 수정
        if (!startAttemptedRef.current.has(tournamentKey) && currentUserWithStatus?.id) {
            startAttemptedRef.current.add(tournamentKey);
            console.log(`[TournamentArena] Starting tournament session for ${type}`);
            // 자동으로 토너먼트 세션 시작
            handlersRef.current.handleAction({ 
                type: 'START_TOURNAMENT_SESSION', 
                payload: { type: type } 
            });
            
            // 3초 후에도 토너먼트 상태가 없으면 재시도 (WebSocket 업데이트가 늦을 수 있음)
            const timeoutId = setTimeout(() => {
                if (!currentUserWithStatus?.[stateKey]) {
                    console.log(`[TournamentArena] Tournament state not updated after 3s, clearing attempt flag for retry`);
                    startAttemptedRef.current.delete(tournamentKey);
                    startTimeoutRef.current.delete(tournamentKey);
                }
            }, 3000);
            startTimeoutRef.current.set(tournamentKey, timeoutId);
        }
        
        // cleanup: 컴포넌트 언마운트 시 타이머 정리
        return () => {
            const timeout = startTimeoutRef.current.get(tournamentKey);
            if (timeout) {
                clearTimeout(timeout);
                startTimeoutRef.current.delete(tournamentKey);
            }
        };
    }, [type, tournamentState, currentUserWithStatus?.id, currentUserWithStatus, stateKey]);

    return (
        <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-[calc(100vh-5rem)] relative overflow-hidden">
            {tournamentState && (
                <TournamentBracketErrorBoundary>
                    <TournamentBracket 
                        tournament={tournamentState}
                        currentUser={currentUserWithStatus}
                        onBack={async () => {
                            if (tournamentState.status === 'round_in_progress') {
                                if (window.confirm('경기가 진행 중입니다. 현재 경기를 기권하시겠습니까? 현재 경기는 패배 처리됩니다.')) {
                                    handlers.handleAction({ type: 'FORFEIT_CURRENT_MATCH', payload: { type } });
                                }
                            } else {
                                try {
                                    if (tournamentState) {
                                        await handlers.handleAction({ type: 'SAVE_TOURNAMENT_PROGRESS', payload: { type } });
                                    }
                                } catch (error) {
                                    console.error('[TournamentArena] Failed to save tournament progress on exit:', error);
                                } finally {
                                    window.location.hash = '#/tournament';
                                }
                            }
                        }}
                        allUsersForRanking={allUsers}
                        onViewUser={handlers.openViewingUser}
                        onAction={handlers.handleAction}
                        onStartNextRound={() => handlers.handleAction({ type: 'START_TOURNAMENT_ROUND', payload: { type: type } })}
                        onReset={() => handlers.handleAction({ type: 'CLEAR_TOURNAMENT_SESSION', payload: { type: type } })}
                        onSkip={() => handlers.handleAction({ type: 'SKIP_TOURNAMENT_END', payload: { type: type } })}
                        onOpenShop={() => handlers.openShop('consumables')}
                        isMobile={isMobile}
                    />
                </TournamentBracketErrorBoundary>
            )}
        </div>
    );
};

export default TournamentArena;
