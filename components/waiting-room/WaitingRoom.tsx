import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { GameMode, ServerAction, Announcement, OverrideAnnouncement, UserWithStatus, LiveGameSession, UserStatus } from '../../types.js';
import Avatar from '../Avatar.js';
import HelpModal from '../HelpModal.js';
import { useAppContext } from '../../hooks/useAppContext.js';

// Import newly created sub-components
import PlayerList from './PlayerList.js';
import RankingList from './RankingList.js';
import GameList from './GameList.js';
import ChatWindow from './ChatWindow.js';
import TierInfoModal from '../TierInfoModal.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, aiUserId } from '../../constants';
import QuickAccessSidebar from '../QuickAccessSidebar.js';
import Button from '../Button.js';
import AiChallengeModal from './AiChallengeModal.js';
import RankedMatchPanel from './RankedMatchPanel.js';
import MatchFoundModal from './MatchFoundModal.js';


interface WaitingRoomComponentProps {
    mode: GameMode | 'strategic' | 'playful';
}

const PLAYFUL_AI_MODES: GameMode[] = [GameMode.Dice, GameMode.Omok, GameMode.Ttamok, GameMode.Thief, GameMode.Alkkagi, GameMode.Curling];

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

const AiChallengePanel: React.FC<{ mode: GameMode | 'strategic' | 'playful'; onOpenModal: () => void }> = ({ mode, onOpenModal }) => {
    const isStrategic = mode === 'strategic' || SPECIAL_GAME_MODES.some(m => m.mode === mode);
    const isPlayful = mode === 'playful' || PLAYFUL_AI_MODES.includes(mode as GameMode);

    if (!isStrategic && !isPlayful) {
        return null;
    }

    return (
        <div className="bg-panel rounded-lg shadow-lg p-3 flex items-center justify-between flex-shrink-0 text-on-panel">
            <div className="flex items-center gap-3">
                <Avatar userId={aiUserId} userName="AI" size={40} className="border-2 border-purple-500" />
                <div>
                    <h3 className="text-base font-bold text-purple-300">AI와 대결하기</h3>
                    <p className="text-xs text-tertiary">AI와 즉시 대국을 시작합니다.</p>
                </div>
            </div>
            <Button onClick={onOpenModal} colorScheme="purple" className="!text-sm !py-1.5">설정 및 시작</Button>
        </div>
    );
};

const AnnouncementBoard: React.FC<{ mode: GameMode | 'strategic' | 'playful'; }> = ({ mode }) => {
    const { announcements, globalOverrideAnnouncement, announcementInterval } = useAppContext();
    const [currentIndex, setCurrentIndex] = useState(0);
    const announcementIds = useMemo(() => announcements.map(a => a.id).join(','), [announcements]);
    const strategicModes = useMemo(() => SPECIAL_GAME_MODES.map(m => m.mode), []);
    const playfulModes = useMemo(() => PLAYFUL_GAME_MODES.map(m => m.mode), []);

    useEffect(() => {
        if (!announcements || announcements.length <= 1) {
            setCurrentIndex(0);
            return;
        }
        const timer = setInterval(() => {
            setCurrentIndex(prevIndex => (prevIndex + 1) % announcements.length);
        }, announcementInterval * 1000);
        return () => clearInterval(timer);
    }, [announcementIds, announcements.length, announcementInterval]);

    const relevantOverride = globalOverrideAnnouncement && (
        globalOverrideAnnouncement.modes === 'all' ||
        (Array.isArray(globalOverrideAnnouncement.modes) && globalOverrideAnnouncement.modes.some(m => {
            if (mode === 'strategic') return strategicModes.includes(m);
            if (mode === 'playful') return playfulModes.includes(m);
            return m === mode;
        }))
    );

    if (relevantOverride) {
        return (
            <div className="bg-yellow-800/50 border border-yellow-600 rounded-lg shadow-lg p-2 flex items-center justify-center flex-shrink-0 h-10">
                <span className="font-bold text-yellow-300 animate-pulse text-center">{globalOverrideAnnouncement.message}</span>
            </div>
        );
    }
    
    if (!announcements || announcements.length === 0) {
        return (
            <div className="bg-panel rounded-lg shadow-lg p-2 flex items-center justify-center flex-shrink-0 h-10 text-on-panel">
                <span className="font-bold text-tertiary text-center">[현재 등록된 공지사항이 없습니다.]</span>
            </div>
        );
    }

    return (
        <div className="bg-panel rounded-lg shadow-lg px-4 relative overflow-hidden flex-shrink-0 h-10">
            <div
                className="w-full absolute top-0 left-0 transition-transform duration-1000 ease-in-out"
                style={{ transform: `translateY(-${currentIndex * 2.5}rem)` }}
            >
                {announcements.map((announcement) => (
                    <div key={announcement.id} className="w-full h-10 flex items-center justify-center">
                        <span className="font-bold">
                            <span className="text-red-500 mr-2">[공지]</span>
                            <span className="text-highlight">{announcement.message}</span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};


const WaitingRoom: React.FC<WaitingRoomComponentProps> = ({ mode }) => {
  const { 
    currentUserWithStatus, onlineUsers, allUsers, liveGames, 
    waitingRoomChats, negotiations, handlers 
  } = useAppContext();

  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isTierInfoModalOpen, setIsTierInfoModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isAiChallengeModalOpen, setIsAiChallengeModalOpen] = useState(false);
  const [isRankedMatching, setIsRankedMatching] = useState(false);
  const [rankedMatchingStartTime, setRankedMatchingStartTime] = useState(0);
  const [matchFoundData, setMatchFoundData] = useState<{ gameId: string; player1: any; player2: any } | null>(null);
  const desktopContainerRef = useRef<HTMLDivElement>(null);

  // 전략바둑과 놀이바둑 대기실은 각각의 채널 사용
  const chatChannel = mode === 'strategic' ? 'strategic' : mode === 'playful' ? 'playful' : 'global';
  const chatMessages = waitingRoomChats[chatChannel] || [];
  const prevChatLength = usePrevious(chatMessages.length);

  const isStrategic = useMemo(() => {
    if (mode === 'strategic') return true;
    if (mode === 'playful') return false;
    return SPECIAL_GAME_MODES.some(m => m.mode === mode);
  }, [mode]);

  // 대기실 입장 시 자동으로 ENTER_WAITING_ROOM 액션 전송
  const hasEnteredWaitingRoom = useRef(false);
  const lastModeRef = useRef<string | GameMode | undefined>(undefined);
  
  useEffect(() => {
    // mode가 변경되면 플래그 리셋
    if (lastModeRef.current !== mode) {
      hasEnteredWaitingRoom.current = false;
      lastModeRef.current = mode;
    }
    
    if (currentUserWithStatus && mode && !hasEnteredWaitingRoom.current) {
      // 현재 유저가 이미 대기실에 있는지 확인
      const isAlreadyInWaitingRoom = currentUserWithStatus.status === UserStatus.Waiting || currentUserWithStatus.status === UserStatus.Resting;
      // 전략/놀이바둑 대기실의 경우 mode 매칭 체크를 다르게 처리
      const modeMatches = mode === 'strategic' || mode === 'playful' 
        ? (!currentUserWithStatus.mode || 
           (mode === 'strategic' && SPECIAL_GAME_MODES.some(m => m.mode === currentUserWithStatus.mode)) ||
           (mode === 'playful' && PLAYFUL_GAME_MODES.some(m => m.mode === currentUserWithStatus.mode)))
        : currentUserWithStatus.mode === mode;
      
      // 대기 상태가 아니거나 모드가 일치하지 않으면 대기실 입장
      if (!isAlreadyInWaitingRoom || !modeMatches) {
        hasEnteredWaitingRoom.current = true;
        handlers.handleAction({ type: 'ENTER_WAITING_ROOM', payload: { mode } });
      } else {
        hasEnteredWaitingRoom.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentUserWithStatus?.id]);

  // 랭킹전 매칭 상태 업데이트 (WebSocket 메시지 처리)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'RANKED_MATCHING_UPDATE') {
          const queue = message.payload?.queue as Record<string, Record<string, any>> | undefined;
          if (queue) {
            // mode를 직접 사용하여 lobbyType 계산
            const lobbyType: 'strategic' | 'playful' = (mode === 'strategic' || (mode !== 'playful' && SPECIAL_GAME_MODES.some(m => m.mode === mode))) ? 'strategic' : 'playful';
            const userEntry = currentUserWithStatus?.id ? queue[lobbyType]?.[currentUserWithStatus.id] : undefined;
            if (userEntry) {
              setIsRankedMatching(true);
              setRankedMatchingStartTime(userEntry.startTime);
            } else {
              setIsRankedMatching(false);
              setRankedMatchingStartTime(0);
            }
          }
        } else if (message.type === 'RANKED_MATCH_FOUND') {
          // 매칭 성공 시 VS 화면 표시
          setIsRankedMatching(false);
          setRankedMatchingStartTime(0);
          setMatchFoundData({
            gameId: message.payload.gameId,
            player1: message.payload.player1,
            player2: message.payload.player2,
          });
        }
      } catch (e) {
        // 무시
      }
    };

    const ws = (window as any).ws;
    if (ws) {
      ws.addEventListener('message', handleMessage);
      return () => ws.removeEventListener('message', handleMessage);
    }
  }, [mode, currentUserWithStatus?.id]);

  useEffect(() => {
    if (!isMobileSidebarOpen && prevChatLength !== undefined && chatMessages.length > prevChatLength) {
        setHasNewMessage(true);
    }
  }, [chatMessages.length, prevChatLength, isMobileSidebarOpen]);
  
  const onBackToLobby = () => {
    handlers.handleAction({ type: 'LEAVE_WAITING_ROOM' });
    window.location.hash = '#/profile';
  }

  useEffect(() => {
    const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);
  
  if (!currentUserWithStatus) return null;

  // 전략/놀이바둑 대기실에서는 해당 카테고리의 게임만 표시
  const ongoingGames = useMemo(() => {
    const allGames = Object.values(liveGames) as LiveGameSession[];
    if (mode === 'strategic') {
      // 전략바둑 대기실: 전략바둑 게임만 표시
      return allGames.filter(g => SPECIAL_GAME_MODES.some(m => m.mode === g.mode));
    } else if (mode === 'playful') {
      // 놀이바둑 대기실: 놀이바둑 게임만 표시
      return allGames.filter(g => PLAYFUL_GAME_MODES.some(m => m.mode === g.mode));
    } else {
      // 단일 게임 모드 대기실: 해당 모드 게임만 표시
      return allGames.filter(g => g.mode === mode);
    }
  }, [liveGames, mode]);
  
  const usersInThisRoom = useMemo(() => {
        const isStrategicLobby = mode === 'strategic';
        const isPlayfulLobby = mode === 'playful';

        // 전략/놀이바둑 대기실의 경우: mode가 정확히 일치하는 유저만 포함 (완전 분리)
        // 단일 게임 모드 대기실의 경우: mode가 정확히 일치하는 유저만 포함
        const all = onlineUsers.filter(u => {
            if (isStrategicLobby || isPlayfulLobby) {
                // 전략/놀이바둑 대기실: mode가 undefined이거나 해당 카테고리의 게임 모드이고 waiting 또는 resting 상태인 유저만 포함
                return (!u.mode || (isStrategicLobby && SPECIAL_GAME_MODES.some(m => m.mode === u.mode)) || (isPlayfulLobby && PLAYFUL_GAME_MODES.some(m => m.mode === u.mode))) && 
                       (u.status === UserStatus.Waiting || u.status === UserStatus.Resting);
            }
            // 단일 게임 모드 대기실: mode가 정확히 일치하는 유저만 포함
            return u.mode === mode;
        });
        
        // 현재 유저가 목록에 없으면 추가 (대기실에 입장했지만 아직 상태가 업데이트되지 않은 경우)
        const me = all.find(u => u.id === currentUserWithStatus.id);
        if (!me) {
            // 현재 유저를 대기실 상태로 추가
            // 전략/놀이바둑 대기실의 경우 mode는 strategic/playful로 설정
            // 단일 게임 모드 대기실의 경우 mode를 그대로 사용
            const currentUserInRoom: UserWithStatus = {
                ...currentUserWithStatus,
                status: UserStatus.Waiting,
                mode: (isStrategicLobby || isPlayfulLobby) ? undefined : (mode as GameMode)
            };
            return [currentUserInRoom, ...all];
        }
        
        return [me, ...all.filter(u => u.id !== currentUserWithStatus.id)];
  }, [onlineUsers, mode, currentUserWithStatus]);

  // 허용된 위치만 설정
  let locationPrefix: string;
  if (mode === 'strategic') {
    locationPrefix = '[전략바둑]';
  } else if (mode === 'playful') {
    locationPrefix = '[놀이바둑]';
  } else {
    // 알 수 없는 모드는 기본값으로 [홈] 반환
    locationPrefix = '[홈]';
  }
    
  return (
    <div className="bg-primary text-primary flex flex-col h-full max-w-full">
      <header className="flex justify-between items-center mb-4 flex-shrink-0 px-2 sm:px-4 lg:px-6 pt-2 sm:pt-4 lg:pt-6">
        <div className="flex-1">
          <button onClick={onBackToLobby} className="p-0 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-100 active:shadow-inner active:scale-95 active:translate-y-0.5">
            <img src="/images/button/back.png" alt="Back" className="w-full h-full" />
          </button>
        </div>
        <div className='flex-1 text-center flex items-center justify-center h-full'>
          <div className="flex items-center gap-2 sm:gap-3 flex-nowrap h-full">
            <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold whitespace-nowrap">
              {mode === 'strategic' ? '전략바둑 대기실' : mode === 'playful' ? '놀이바둑 대기실' : `${mode} 대기실`}
            </h1>
            {(mode === 'strategic' || mode === 'playful') && (
              <button
                type="button"
                aria-label={mode === 'strategic' ? '놀이바둑 대기실로 이동' : '전략바둑 대기실로 이동'}
                title={mode === 'strategic' ? '놀이바둑 대기실로 이동' : '전략바둑 대기실로 이동'}
                onClick={() => {
                  const targetMode = mode === 'strategic' ? 'playful' : 'strategic';
                  window.location.hash = `#/waiting/${targetMode}`;
                }}
                className="w-8 sm:w-10 flex items-center justify-center rounded-lg transition-all duration-300 hover:scale-110 active:scale-95 text-on-panel relative overflow-hidden group"
                style={{ 
                  height: '60%',
                  marginTop: '4px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(139, 92, 246, 0.3) 100%)',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  boxShadow: '0 2px 8px rgba(99, 102, 241, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-purple-500/20 to-indigo-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <span className="text-base sm:text-lg font-bold flex flex-col items-center justify-center gap-0 relative z-10 drop-shadow-sm leading-none">
                  <span className="transition-transform duration-300 group-hover:-translate-x-0.5 -mb-2.5">←</span>
                  <span className="transition-transform duration-300 group-hover:translate-x-0.5 -mt-2.5">→</span>
                </span>
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 flex justify-end items-center">
          {(mode === 'strategic' || mode === 'playful') && (
            <button 
              onClick={() => setIsHelpModalOpen(true)}
              className="w-8 h-8 flex items-center justify-center transition-transform hover:scale-110"
              aria-label="게임 방법 보기"
              title="게임 방법 보기"
            >
              <img src="/images/button/help.png" alt="도움말" className="w-full h-full" />
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 min-h-0 relative px-2 sm:px-4 lg:px-6 pb-2 sm:pb-4 lg:pb-6">
        {isMobile ? (
          <>
            <div className="flex flex-col h-full gap-2">
                <div className="flex-shrink-0"><AnnouncementBoard mode={mode} /></div>
                <div className="flex-shrink-0"><AiChallengePanel mode={mode} onOpenModal={() => setIsAiChallengeModalOpen(true)} /></div>
                <div className="h-[350px] min-h-0">
                    <GameList games={ongoingGames} onAction={handlers.handleAction} currentUser={currentUserWithStatus} />
                </div>
                <div className="flex-1 min-h-0 bg-panel border border-color rounded-lg shadow-lg flex flex-col">
                    <PlayerList users={usersInThisRoom} mode={mode} onAction={handlers.handleAction} currentUser={currentUserWithStatus} negotiations={Object.values(negotiations)} onViewUser={handlers.openViewingUser} lobbyType={isStrategic ? 'strategic' : 'playful'} userCount={usersInThisRoom.length} />
                </div>
            </div>

            <div className="absolute top-1/2 -translate-y-1/2 right-0 z-20">
                <button 
                    onClick={() => { setIsMobileSidebarOpen(true); setHasNewMessage(false); }}
                    className="w-8 h-12 bg-secondary/80 backdrop-blur-sm rounded-l-lg flex items-center justify-center text-primary shadow-lg"
                    aria-label="유저 및 랭킹 목록 열기"
                >
                    <span className="relative font-bold text-lg">
                        {'<'}
                        {hasNewMessage && <div className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-danger rounded-full border-2 border-secondary"></div>}
                    </span>
                </button>
            </div>
            <div className={`fixed top-0 right-0 h-full w-[360px] bg-primary shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
                <div className="flex justify-between items-center p-2 border-b border-color flex-shrink-0">
                    <h3 className="text-lg font-bold">메뉴</h3>
                    <button onClick={() => setIsMobileSidebarOpen(false)} className="text-2xl font-bold text-tertiary hover:text-primary">×</button>
                </div>
                <div className="flex flex-col gap-2 p-2 flex-grow min-h-0 overflow-y-auto">
                    <div className="flex-shrink-0 p-1 bg-panel rounded-lg border border-color">
                        <QuickAccessSidebar mobile={true} />
                    </div>
                    <div className="flex-shrink-0 border-b border-color pb-2">
                        <div className="bg-panel border border-color rounded-lg">
                            <RankingList mode={mode} onShowTierInfo={() => setIsTierInfoModalOpen(true)} currentUser={currentUserWithStatus} onViewUser={handlers.openViewingUser} onShowPastRankings={(info) => handlers.openPastRankings(info)} lobbyType={isStrategic ? 'strategic' : 'playful'} />
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 bg-panel border border-color rounded-lg shadow-lg flex flex-col">
                        <ChatWindow messages={chatMessages} mode={chatChannel} onAction={handlers.handleAction} locationPrefix={locationPrefix} onViewUser={handlers.openViewingUser} />
                    </div>
                </div>
            </div>
            {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
          </>
        ) : (
          <div ref={desktopContainerRef} className="grid grid-cols-1 lg:grid-cols-5 h-full gap-4">
              {/* Main Content Column */}
                  <div className="lg:col-span-3 flex flex-col gap-4 min-h-0">
                      <div className="flex-shrink-0">
                          <AnnouncementBoard mode={mode} />
                      </div>
                       <div className="flex-shrink-0">
                          <AiChallengePanel mode={mode} onOpenModal={() => setIsAiChallengeModalOpen(true)} />
                      </div>

                      <div className="h-[500px] min-h-0">
                          <GameList games={ongoingGames} onAction={handlers.handleAction} currentUser={currentUserWithStatus} />
                      </div>
                      {/* 채팅창과 랭킹전 패널을 나란히 배치 */}
                      <div className="h-[200px] flex flex-row gap-4 min-h-0">
                          <div className="flex-1 flex flex-col bg-panel border border-color rounded-lg shadow-lg min-h-0">
                              <ChatWindow messages={chatMessages} mode={chatChannel} onAction={handlers.handleAction} locationPrefix={locationPrefix} onViewUser={handlers.openViewingUser} />
                          </div>
                          <div className="w-80 flex-shrink-0 bg-panel border border-color rounded-lg shadow-lg">
                              <RankedMatchPanel 
                                lobbyType={isStrategic ? 'strategic' : 'playful'}
                                currentUser={currentUserWithStatus}
                                onAction={handlers.handleAction}
                                isMatching={isRankedMatching}
                                matchingStartTime={rankedMatchingStartTime}
                                onMatchingStateChange={(isMatching, startTime) => {
                                  setIsRankedMatching(isMatching);
                                  setRankedMatchingStartTime(startTime);
                                }}
                                onCancelMatching={() => {
                                  setIsRankedMatching(false);
                                  setRankedMatchingStartTime(0);
                                }}
                              />
                          </div>
                      </div>
                  </div>
              
              {/* Right Sidebar Column */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                <div className="flex-1 flex flex-row gap-4 items-stretch min-h-0">
                  <div className="flex-1 bg-panel border border-color rounded-lg shadow-lg min-w-0">
                    <PlayerList users={usersInThisRoom} mode={mode} onAction={handlers.handleAction} currentUser={currentUserWithStatus} negotiations={Object.values(negotiations)} onViewUser={handlers.openViewingUser} lobbyType={isStrategic ? 'strategic' : 'playful'} userCount={usersInThisRoom.length} />
                  </div>
                  <div className="w-24 flex-shrink-0">
                    <QuickAccessSidebar />
                  </div>
                </div>

                <div className="flex-1 bg-panel border border-color rounded-lg shadow-lg">
                  <RankingList currentUser={currentUserWithStatus} mode={mode} onViewUser={handlers.openViewingUser} onShowTierInfo={() => setIsTierInfoModalOpen(true)} onShowPastRankings={handlers.openPastRankings} lobbyType={isStrategic ? 'strategic' : 'playful'} />
                </div>
              </div>
          </div>
        )}
      </div>
      {isTierInfoModalOpen && <TierInfoModal onClose={() => setIsTierInfoModalOpen(false)} />}
      {isHelpModalOpen && <HelpModal mode={mode} onClose={() => setIsHelpModalOpen(false)} />}
      {isAiChallengeModalOpen && (
        <AiChallengeModal 
          lobbyType={isStrategic ? 'strategic' : 'playful'} 
          onClose={() => setIsAiChallengeModalOpen(false)} 
          onAction={handlers.handleAction}
        />
      )}
      {matchFoundData && (
        <MatchFoundModal
          gameId={matchFoundData.gameId}
          player1={matchFoundData.player1}
          player2={matchFoundData.player2}
          currentUserId={currentUserWithStatus.id}
          onClose={() => setMatchFoundData(null)}
          onEnterGame={(gameId) => {
            setMatchFoundData(null);
            window.location.hash = `#/game/${gameId}`;
          }}
        />
      )}
    </div>
  );
};

export default WaitingRoom;
