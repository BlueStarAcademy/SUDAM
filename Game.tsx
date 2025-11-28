import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
// FIX: Import types from the new centralized types barrel file
import { Player, GameMode, GameStatus, Point, GameProps, LiveGameSession, ServerAction } from './types/index.js';
import GameArena from './components/GameArena.js';
import Sidebar from './components/game/Sidebar.js';
import PlayerPanel from './components/game/PlayerPanel.js';
import GameModals from './components/game/GameModals.js';
import TurnDisplay from './components/game/TurnDisplay.js';
import { audioService } from './services/audioService.js';
import { TerritoryAnalysisWindow, HintWindow } from './components/game/AnalysisWindows.js';
import GameControls from './components/game/GameControls.js';
import { PLAYFUL_GAME_MODES, SPECIAL_GAME_MODES, aiUserId } from './constants.js';
import { useAppContext } from './hooks/useAppContext.js';
import DisconnectionModal from './components/DisconnectionModal.js';
// FIX: Import TimeoutFoulModal component to resolve 'Cannot find name' error.
import TimeoutFoulModal from './components/TimeoutFoulModal.js';
import SinglePlayerControls from './components/game/SinglePlayerControls.js';
import SinglePlayerInfoPanel from './components/game/SinglePlayerInfoPanel.js';
import SinglePlayerGameDescriptionModal from './components/SinglePlayerGameDescriptionModal.js';
import SinglePlayerSidebar from './components/game/SinglePlayerSidebar.js';
import TowerControls from './components/game/TowerControls.js';
import TowerSidebar from './components/game/TowerSidebar.js';
import { useClientTimer } from './hooks/useClientTimer.js';
import { calculateSimpleAiMove } from './client/goAiBotClient.js';
import { processMoveClient } from './client/goLogicClient.js';

// AI 유저 ID (싱글플레이에서 AI 차례 판단용)
const AI_USER_ID = aiUserId;

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

interface GameComponentProps {
    session: LiveGameSession;
}

const Game: React.FC<GameComponentProps> = ({ session }) => {
    const { 
        currentUser,
        currentUserWithStatus,
        handlers,
        onlineUsers,
        waitingRoomChats,
        gameChats,
        negotiations,
        activeNegotiation,
        settings,
    } = useAppContext();

    const { id: gameId, currentPlayer, gameStatus, player1, player2, mode, blackPlayerId, whitePlayerId } = session;

    if (!player1?.id || !player2?.id || !currentUser || !currentUserWithStatus) {
        return <div className="flex items-center justify-center min-h-screen">플레이어 정보를 불러오는 중...</div>;
    }

    const [confirmModalType, setConfirmModalType] = useState<'resign' | null>(null);
    const [showResultModal, setShowResultModal] = useState(false);
    const [showFinalTerritory, setShowFinalTerritory] = useState(false);
    const [justScanned, setJustScanned] = useState(false);
    const [pendingMove, setPendingMove] = useState<Point | null>(null);
    const [isAnalysisActive, setIsAnalysisActive] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [resumeCountdown, setResumeCountdown] = useState(0);
    const pauseStartedAtRef = useRef<number | null>(null);
    const pauseCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [pauseButtonCooldown, setPauseButtonCooldown] = useState(0);
    const clientTimes = useClientTimer(session, (session.isSinglePlayer || (session.gameCategory === 'tower')) ? { isPaused } : {});
    
    // 보드 잠금 메커니즘: AI가 돌을 둔 직후 최신 serverRevision을 받을 때까지 보드 잠금
    const [lastReceivedServerRevision, setLastReceivedServerRevision] = useState<number>(session.serverRevision ?? 0);
    const [isBoardLocked, setIsBoardLocked] = useState(false);
    
    const prevGameStatus = usePrevious(gameStatus);
    const prevCurrentPlayer = usePrevious(currentPlayer);
    const prevCaptures = usePrevious(session.captures);
    const prevAnimationType = usePrevious(session.animation?.type);
    const warningSoundPlayedForTurn = useRef(false);
    const prevMoveCount = usePrevious(session.moveHistory?.length);
    const prevAnalysisResult = usePrevious(session.analysisResult?.['system']);

    const isSpectator = useMemo(() => currentUserWithStatus?.status === 'spectating', [currentUserWithStatus]);
    const isSinglePlayer = session.isSinglePlayer;
    const isTower = session.gameCategory === 'tower';
    
    // 클라이언트에서 게임 상태 저장/복원 (새로고침 시 바둑판 복원)
    const GAME_STATE_STORAGE_KEY = `gameState_${gameId}`;
    
    // 게임 상태를 sessionStorage에서 복원
    const restoredBoardState = useMemo(() => {
        // 먼저 sessionStorage에서 복원 시도
        try {
            const storedState = sessionStorage.getItem(GAME_STATE_STORAGE_KEY);
            if (storedState) {
                const parsed = JSON.parse(storedState);
                // 게임이 종료되지 않았고, 같은 게임 ID인 경우에만 복원
                if (parsed.gameId === gameId && !['ended', 'no_contest', 'scoring'].includes(gameStatus)) {
                    if (parsed.boardState && Array.isArray(parsed.boardState) && parsed.boardState.length > 0) {
                        console.log(`[Game] Restored boardState from sessionStorage for game ${gameId}`);
                        return parsed.boardState;
                    }
                }
            }
        } catch (e) {
            console.error(`[Game] Failed to restore game state from sessionStorage:`, e);
        }
        
        // sessionStorage에 없으면 서버에서 받은 boardState 사용
        if (session.boardState && Array.isArray(session.boardState) && session.boardState.length > 0) {
            return session.boardState;
        }
        
        // 싱글플레이어 게임과 도전의 탑 게임의 경우 blackPatternStones와 whitePatternStones로부터 복원
        if ((isSinglePlayer || isTower) && (session.blackPatternStones || session.whitePatternStones)) {
            const boardSize = session.settings.boardSize;
            const restored = Array(boardSize).fill(null).map(() => Array(boardSize).fill(Player.None));
            
            // blackPatternStones 복원
            if (session.blackPatternStones && Array.isArray(session.blackPatternStones)) {
                for (const stone of session.blackPatternStones) {
                    if (stone.x >= 0 && stone.x < boardSize && stone.y >= 0 && stone.y < boardSize) {
                        restored[stone.y][stone.x] = Player.Black;
                    }
                }
            }
            
            // whitePatternStones 복원
            if (session.whitePatternStones && Array.isArray(session.whitePatternStones)) {
                for (const stone of session.whitePatternStones) {
                    if (stone.x >= 0 && stone.x < boardSize && stone.y >= 0 && stone.y < boardSize) {
                        restored[stone.y][stone.x] = Player.White;
                    }
                }
            }
            
            // moveHistory를 통해 이후의 수를 복원
            if (session.moveHistory && Array.isArray(session.moveHistory)) {
                for (const move of session.moveHistory) {
                    if (move.x >= 0 && move.x < boardSize && move.y >= 0 && move.y < boardSize) {
                        restored[move.y][move.x] = move.player;
                    }
                }
            }
            
            return restored;
        }
        
        return session.boardState;
    }, [isSinglePlayer, isTower, session.boardState, session.blackPatternStones, session.whitePatternStones, session.moveHistory?.length, session.settings.boardSize, gameId, gameStatus]);
    
    // 게임 상태를 sessionStorage에 저장 (매 수마다)
    useEffect(() => {
        // 게임이 종료되면 저장된 상태 삭제
        if (['ended', 'no_contest', 'scoring'].includes(gameStatus)) {
            try {
                sessionStorage.removeItem(GAME_STATE_STORAGE_KEY);
                console.log(`[Game] Removed game state from sessionStorage for ended game ${gameId}`);
            } catch (e) {
                console.error(`[Game] Failed to remove game state from sessionStorage:`, e);
            }
            return;
        }
        
        // 게임이 진행 중이면 상태 저장
        if (restoredBoardState && Array.isArray(restoredBoardState) && restoredBoardState.length > 0) {
            try {
                const gameStateToSave = {
                    gameId,
                    boardState: restoredBoardState,
                    moveHistory: session.moveHistory || [],
                    captures: session.captures || { [Player.None]: 0, [Player.Black]: 0, [Player.White]: 0 },
                    baseStoneCaptures: session.baseStoneCaptures,
                    hiddenStoneCaptures: session.hiddenStoneCaptures,
                    permanentlyRevealedStones: session.permanentlyRevealedStones || [],
                    blackPatternStones: session.blackPatternStones,
                    whitePatternStones: session.whitePatternStones,
                    totalTurns: session.totalTurns,
                    timestamp: Date.now()
                };
                sessionStorage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(gameStateToSave));
            } catch (e) {
                console.error(`[Game] Failed to save game state to sessionStorage:`, e);
            }
        }
    }, [restoredBoardState, session.moveHistory, session.captures, session.baseStoneCaptures, session.hiddenStoneCaptures, session.permanentlyRevealedStones, session.blackPatternStones, session.whitePatternStones, session.totalTurns, gameId, gameStatus]);
    
    // --- Mobile UI State ---
    const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [hasNewMessage, setHasNewMessage] = useState(false);
    const gameChat = useMemo(() => gameChats[session.id] || [], [gameChats, session.id]);
    const prevChatLength = usePrevious(gameChat.length);

    useEffect(() => {
        const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    useEffect(() => {
        if (!isMobileSidebarOpen && prevChatLength !== undefined && gameChat.length > prevChatLength) {
            setHasNewMessage(true);
        }
    }, [gameChat.length, prevChatLength, isMobileSidebarOpen]);

    const openMobileSidebar = () => {
        setIsMobileSidebarOpen(true);
        setHasNewMessage(false);
    };

    useEffect(() => {
        const gameHasJustEnded =
            (gameStatus === 'ended' || gameStatus === 'no_contest') &&
            prevGameStatus !== 'ended' &&
            prevGameStatus !== 'no_contest' &&
            prevGameStatus !== 'rematch_pending';

        // 분석 결과가 도착했을 때만 모달 표시 (바둑판 초기화 방지)
        // scoring 상태일 때는 분석 결과가 준비될 때까지 게임 화면을 유지
        // 기권/접속 끊김 등 즉시 종료되는 경우에는 analysisResult 없이도 모달 표시
        const currentAnalysisResult = session.analysisResult?.['system'];
        const analysisResultJustArrived = currentAnalysisResult && !prevAnalysisResult;
        const isImmediateEnd = gameHasJustEnded && (session.winReason === 'resign' || session.winReason === 'disconnect' || session.winReason === 'timeout');
        const shouldShowModal = gameHasJustEnded || 
            ((isSinglePlayer || isTower)
                ? (isImmediateEnd || (gameStatus === 'ended' && currentAnalysisResult && prevGameStatus !== 'ended') ||
                   (gameStatus === 'scoring' && currentAnalysisResult && analysisResultJustArrived))
                : ((gameStatus === 'ended' && currentAnalysisResult && prevGameStatus !== 'ended') ||
                   (gameStatus === 'scoring' && currentAnalysisResult && analysisResultJustArrived)));

        if (shouldShowModal) {
            setShowResultModal(true);
            if (gameStatus === 'ended') {
                setShowFinalTerritory(true);
            }
        }
        
        // 계가가 완료되었을 때(analysisResult가 있을 때) 영토 표시 활성화
        if (gameStatus === 'ended' || gameStatus === 'scoring') {
            if (currentAnalysisResult) {
                setShowFinalTerritory(true);
            }
        }
    }, [gameStatus, prevGameStatus, session.analysisResult, prevAnalysisResult, isSinglePlayer, isTower]);
    
    const myPlayerEnum = useMemo(() => {
        if (isSpectator) return Player.None;
        if (blackPlayerId === currentUser.id) return Player.Black;
        if (whitePlayerId === currentUser.id) return Player.White;
        if ((mode === GameMode.Base || (mode === GameMode.Mix && session.settings.mixedModes?.includes(GameMode.Base))) && gameStatus === 'base_placement') {
             return currentUser.id === player1.id ? Player.Black : Player.White;
        }
        return Player.None;
    }, [currentUser.id, blackPlayerId, whitePlayerId, isSpectator, mode, gameStatus, player1.id, player2.id, session.settings.mixedModes]);
    
    const isMyTurn = useMemo(() => {
        if (isSpectator) return false;
        if (gameStatus === 'alkkagi_simultaneous_placement' && session.settings.alkkagiPlacementType === '일괄 배치') {
            const myStonesOnBoard = (session.alkkagiStones || []).filter(s => s.player === myPlayerEnum).length;
            const myStonesInPlacement = (currentUser.id === player1.id ? session.alkkagiStones_p1 : session.alkkagiStones_p2)?.length || 0;
            return (myStonesOnBoard + myStonesInPlacement) < (session.settings.alkkagiStoneCount || 5);
        }
        switch (gameStatus) {
            case 'dice_turn_rolling': return session.turnOrderRolls?.[currentUser.id] === null;
            case 'dice_turn_choice': return session.turnChooserId === currentUser.id;
            case 'playing': case 'hidden_placing': case 'scanning': case 'missile_selecting': 
            case 'alkkagi_placement': case 'alkkagi_playing': case 'curling_playing':
            case 'dice_rolling': case 'dice_placing': case 'thief_rolling': case 'thief_placing':
                return myPlayerEnum !== Player.None && myPlayerEnum === currentPlayer;
            case 'base_placement': {
                 const myStones = currentUser.id === player1.id ? session.baseStones_p1 : session.baseStones_p2;
                 return (myStones?.length || 0) < (session.settings.baseStones || 4);
            }
            default: return false;
        }
    }, [myPlayerEnum, currentPlayer, gameStatus, isSpectator, session, currentUser.id, player1.id, session.settings]);
    
    // --- Sound Effects ---
    const prevIsMyTurn = usePrevious(isMyTurn);
    useEffect(() => {
        if (isMyTurn && !prevIsMyTurn) {
            const isPlayfulTurnSoundMode = [ GameMode.Dice, GameMode.Thief, GameMode.Alkkagi, GameMode.Curling, ].includes(session.mode);
            if (isPlayfulTurnSoundMode) audioService.myTurn();
        }
    }, [isMyTurn, prevIsMyTurn, session.mode]);

    const prevLastMove = usePrevious(session.lastMove);
    useEffect(() => {
        if (session.lastMove && session.lastMove.x !== -1 && JSON.stringify(session.lastMove) !== JSON.stringify(prevLastMove)) {
            const isGoBasedGame = SPECIAL_GAME_MODES.some(m => m.mode === session.mode) || 
                                  [GameMode.Omok, GameMode.Ttamok, GameMode.Dice, GameMode.Thief].includes(session.mode);
            if (isGoBasedGame) audioService.placeStone();
        }
    }, [session.lastMove, prevLastMove, session.mode]);
    
    useEffect(() => { if (prevCaptures) { /* Capture sounds removed */ } }, [session.captures, prevCaptures, session.justCaptured, session.blackPlayerId, currentUser.id]);

    useEffect(() => {
        if (gameStatus === 'scanning' && prevGameStatus !== 'scanning') audioService.playScanBgm();
        else if (gameStatus !== 'scanning' && prevGameStatus === 'scanning') audioService.stopScanBgm();
        return () => { if (gameStatus === 'scanning') audioService.stopScanBgm(); };
    }, [gameStatus, prevGameStatus]);

    useEffect(() => {
        const anim = session.animation;
        if (anim && anim.type !== prevAnimationType) { 
            switch(anim.type) {
                case 'missile': case 'hidden_missile': audioService.launchMissile(); break;
                case 'hidden_reveal': if (!justScanned) audioService.revealHiddenStone(); break;
                case 'scan':
                    setJustScanned(true); setTimeout(() => setJustScanned(false), 1000);
                    if (anim.success) audioService.scanSuccess(); else audioService.scanFail();
                    break;
            }
        }
    }, [session.animation, prevAnimationType, justScanned]);

    useEffect(() => {
        const activeStartStatuses: GameStatus[] = [ 'playing', 'alkkagi_placement', 'alkkagi_simultaneous_placement', 'curling_playing', 'dice_rolling', 'thief_rolling' ];
        if (activeStartStatuses.includes(gameStatus) && (prevGameStatus === undefined || !activeStartStatuses.includes(prevGameStatus))) audioService.gameStart();
    }, [gameStatus, prevGameStatus]);

    useEffect(() => { return () => audioService.stopScanBgm(); }, []);

    useEffect(() => {
        const isGameOver = ['ended', 'no_contest', 'scoring'].includes(gameStatus);
        const hasTurnChanged = prevMoveCount !== undefined && session.moveHistory && session.moveHistory.length > prevMoveCount;
    
        if (!isMyTurn || hasTurnChanged || isGameOver) {
            if (warningSoundPlayedForTurn.current) {
                audioService.stopTimerWarning();
                warningSoundPlayedForTurn.current = false;
            }
        }
        
        if (isMyTurn && !isGameOver) {
            const myTime = myPlayerEnum === Player.Black ? clientTimes.clientTimes.black : clientTimes.clientTimes.white;
            if (myTime <= 10 && myTime > 0 && !warningSoundPlayedForTurn.current) {
                audioService.timerWarning();
                warningSoundPlayedForTurn.current = true;
            }
        }
    }, [isMyTurn, clientTimes.clientTimes, myPlayerEnum, session.moveHistory, prevMoveCount, gameStatus]);


    const isItemModeActive = ['hidden_placing', 'scanning', 'missile_selecting', 'missile_animating', 'scanning_animating'].includes(gameStatus);

    const handleBoardClick = useCallback((x: number, y: number) => {
        audioService.stopTimerWarning();
        if (isSpectator || gameStatus === 'missile_animating') return;
        if ((session.isSinglePlayer || isTower) && isPaused) return;
        if ((session.isSinglePlayer || isTower) && isBoardLocked) {
            console.log('[Game] Board is locked, ignoring click', { isBoardLocked, serverRevision: session.serverRevision });
            return;
        }

        if (isMobile && settings.features.mobileConfirm && isMyTurn && !isItemModeActive) {
            if (pendingMove && pendingMove.x === x && pendingMove.y === y) return;
            setPendingMove({ x, y });
            return;
        }
        
        let actionType: ServerAction['type'] | null = null;
        let payload: any = { gameId, x, y };

        if ((mode === GameMode.Omok || mode === GameMode.Ttamok) && gameStatus === 'playing' && isMyTurn) {
            actionType = 'OMOK_PLACE_STONE';
        } else if (gameStatus === 'scanning' && isMyTurn) {
            audioService.stopScanBgm();
            actionType = 'SCAN_BOARD';
        } else if (gameStatus === 'base_placement') {
            const myStones = currentUser.id === player1.id ? session.baseStones_p1 : session.baseStones_p2;
            if ((myStones?.length || 0) < (session.settings.baseStones || 4)) actionType = 'PLACE_BASE_STONE';
        } else if (['playing', 'hidden_placing'].includes(gameStatus) && isMyTurn) {
            // 도전의 탑과 싱글플레이 게임은 클라이언트에서만 처리 (서버로 전송하지 않음, 검증 없이 무조건 실행)
            if (isTower || isSinglePlayer) {
                // 클라이언트에서 직접 게임 상태 업데이트 (검증 없이 무조건 실행)
                console.log(`[Game] ${isTower ? 'Tower' : 'Single player'} game - processing move client-side (no validation):`, { x, y, gameId, currentPlayer: myPlayerEnum });
                
                // boardState가 유효한지 확인 (복원된 boardState 사용)
                const boardStateToUse = restoredBoardState || session.boardState;
                if (!boardStateToUse || !Array.isArray(boardStateToUse) || boardStateToUse.length === 0) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - boardState is invalid, cannot process move`);
                    return;
                }
                
                // 치명적 버그 방지: 패 위치(-1, -1)에 돌을 놓으려는 시도 차단
                if (x === -1 || y === -1) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - CRITICAL BUG PREVENTION: Attempted to place stone at pass position (${x}, ${y})`);
                    // TODO: 에러 메시지를 사용자에게 표시
                    return;
                }

                // 치명적 버그 방지: 보드 범위를 벗어나는 위치에 돌을 놓으려는 시도 차단
                const boardSize = session.settings.boardSize;
                if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - CRITICAL BUG PREVENTION: Attempted to place stone out of bounds (${x}, ${y}), boardSize=${boardSize}`);
                    // TODO: 에러 메시지를 사용자에게 표시
                    return;
                }

                // 싱글플레이/도전의 탑에서 AI 돌 위에 착점하는 것 차단
                const opponentPlayerEnum = myPlayerEnum === Player.Black ? Player.White : Player.Black;
                const stoneAtTarget = boardStateToUse[y][x];
                if ((isSinglePlayer || isTower) && stoneAtTarget === opponentPlayerEnum) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - CRITICAL BUG PREVENTION: Attempted to place stone on AI stone at (${x}, ${y})`);
                    // TODO: 에러 메시지를 사용자에게 표시
                    return;
                }

                // 클라이언트에서 move 처리 (바둑 규칙 검증 적용)
                let moveResult;
                try {
                    moveResult = processMoveClient(
                        boardStateToUse,
                        { x, y, player: myPlayerEnum },
                        session.koInfo,
                        session.moveHistory?.length || 0,
                        {
                            ignoreSuicide: false,
                            isSinglePlayer: isSinglePlayer || isTower,
                            opponentPlayer: (isSinglePlayer || isTower) ? opponentPlayerEnum : undefined
                        }
                    );
                } catch (e) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - processMoveClient error:`, e);
                    // TODO: 에러 메시지를 사용자에게 표시
                    return;
                }
                
                // 검증 실패 시 돌을 놓지 않음 (바둑 규칙 준수)
                if (!moveResult.isValid) {
                    console.error(`[Game] ${isTower ? 'Tower' : 'Single player'} game - Invalid move blocked:`, moveResult.reason);
                    // TODO: 에러 메시지를 사용자에게 표시 (코 금지, 자충수, 이미 돌이 놓인 자리 등)
                    return;
                }
                
                // 게임 상태 업데이트 (handlers를 통해, 서버로 전송하지 않음)
                handlers.handleAction({
                    type: isTower ? 'TOWER_CLIENT_MOVE' : 'SINGLE_PLAYER_CLIENT_MOVE',
                    payload: {
                        gameId,
                        x,
                        y,
                        newBoardState: moveResult.newBoardState,
                        capturedStones: moveResult.capturedStones,
                        newKoInfo: moveResult.newKoInfo,
                    }
                } as any);
                return;
            }
            actionType = 'PLACE_STONE'; 
            payload.isHidden = gameStatus === 'hidden_placing';
            // 클라이언트의 boardState와 moveHistory를 서버로 전송하여 정확한 검증 가능하도록 함
            payload.boardState = restoredBoardState || session.boardState;
            payload.moveHistory = session.moveHistory || [];
            if (payload.isHidden) audioService.stopScanBgm();
        }

        if (actionType) {
            console.log('[Game] Sending action:', { actionType, payload, isMyTurn, myPlayerEnum, currentPlayer, gameStatus });
            handlers.handleAction({ type: actionType, payload } as ServerAction);
        } else {
            console.log('[Game] No action type determined', { 
                isMyTurn, 
                myPlayerEnum, 
                currentPlayer, 
                gameStatus,
                mode,
                blackPlayerId: session.blackPlayerId,
                whitePlayerId: session.whitePlayerId,
                currentUser: currentUser.id
            });
        }
    }, [isSpectator, gameStatus, isMyTurn, gameId, handlers.handleAction, currentUser.id, player1.id, session.baseStones_p1, session.baseStones_p2, session.settings.baseStones, mode, isMobile, settings.features.mobileConfirm, pendingMove, isItemModeActive, session.isSinglePlayer, isPaused, isBoardLocked, restoredBoardState, session.boardState, session.moveHistory]);

    const handleConfirmMove = useCallback(() => {
        audioService.stopTimerWarning();
        if (!pendingMove) return;
        
        let actionType: ServerAction['type'] | null = null;
        let payload: any = { gameId, x: pendingMove.x, y: pendingMove.y };

        if ((mode === GameMode.Omok || mode === GameMode.Ttamok) && gameStatus === 'playing' && isMyTurn) {
            actionType = 'OMOK_PLACE_STONE';
        } else if (['playing', 'hidden_placing'].includes(gameStatus) && isMyTurn) {
            actionType = 'PLACE_STONE'; 
            payload.isHidden = gameStatus === 'hidden_placing';
            // 클라이언트의 boardState와 moveHistory를 서버로 전송하여 정확한 검증 가능하도록 함
            payload.boardState = restoredBoardState || session.boardState;
            payload.moveHistory = session.moveHistory || [];
        }
        
        if (actionType) handlers.handleAction({ type: actionType, payload } as ServerAction);
        
        setPendingMove(null);
    }, [pendingMove, gameId, handlers, gameStatus, isMyTurn, mode]);

    const handleCancelMove = useCallback(() => setPendingMove(null), []);

    const clearPauseCountdown = useCallback(() => {
        if (pauseCountdownIntervalRef.current) {
            clearInterval(pauseCountdownIntervalRef.current);
            pauseCountdownIntervalRef.current = null;
        }
    }, []);

    const resumeFromPause = useCallback(() => {
        if (!isPaused) return;
        if (resumeCountdown > 0) return;

        setIsPaused(false);
        setResumeCountdown(0);
        setPauseButtonCooldown(5);
        if (pauseStartedAtRef.current) {
            const pausedDuration = Date.now() - pauseStartedAtRef.current;
            pauseStartedAtRef.current = null;
            const newTurnDeadline = session.turnDeadline ? session.turnDeadline + pausedDuration : undefined;
            const newItemDeadline = session.itemUseDeadline ? session.itemUseDeadline + pausedDuration : undefined;
            const newSharedDeadline = session.basePlacementDeadline ? session.basePlacementDeadline + pausedDuration : undefined;
            if (newTurnDeadline || newItemDeadline || newSharedDeadline) {
                session.turnDeadline = newTurnDeadline ?? session.turnDeadline;
                session.itemUseDeadline = newItemDeadline ?? session.itemUseDeadline;
                session.basePlacementDeadline = newSharedDeadline ?? session.basePlacementDeadline;
            }
        }
        clearPauseCountdown();
    }, [isPaused, resumeCountdown, clearPauseCountdown, session]);

    const initiatePause = useCallback(() => {
        if (isPaused || pauseButtonCooldown > 0) return;
        audioService.stopTimerWarning();
        pauseStartedAtRef.current = Date.now();
        setIsPaused(true);
        setResumeCountdown(5);
        clearPauseCountdown();
        pauseCountdownIntervalRef.current = setInterval(() => {
            setResumeCountdown(prev => {
                if (prev <= 1) {
                    clearPauseCountdown();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, [isPaused, pauseButtonCooldown, clearPauseCountdown]);

    const handlePauseToggle = useCallback(() => {
        const isTower = session.gameCategory === 'tower';
        if (!(session.isSinglePlayer || isTower)) return;
        if (!isPaused) {
            initiatePause();
        } else {
            resumeFromPause();
        }
    }, [isPaused, initiatePause, resumeFromPause, session.isSinglePlayer, session.gameCategory]);

    useEffect(() => {
        if (pauseButtonCooldown <= 0) return;
        const interval = setInterval(() => {
            setPauseButtonCooldown(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [pauseButtonCooldown]);

    const analysisResult = useMemo(() => session.analysisResult?.[currentUser.id] ?? (['ended','no_contest'].includes(gameStatus) ? session.analysisResult?.['system'] : null), [session.analysisResult, currentUser.id, gameStatus]);

    const isNoContestLeaveAvailable = useMemo(() => {
        if (isSpectator || session.isAiGame) return false;
        return !!session.canRequestNoContest?.[currentUser.id];
    }, [session.canRequestNoContest, currentUser.id, isSpectator, session.isAiGame]);

    const handleLeaveOrResignClick = useCallback(() => {
        if (isSpectator) {
            handlers.handleAction({ type: 'LEAVE_SPECTATING' });
            return;
        }
        if (['ended', 'no_contest', 'rematch_pending'].includes(gameStatus)) {
            const actionType = session.isAiGame ? 'LEAVE_AI_GAME' : 'LEAVE_GAME_ROOM';
            // 싱글플레이 게임인 경우 postGameRedirect 설정
            if (session.isSinglePlayer) {
                sessionStorage.setItem('postGameRedirect', '#/singleplayer');
            }
            handlers.handleAction({ type: actionType, payload: { gameId } });
            return;
        }
        if (isNoContestLeaveAvailable) {
            if (window.confirm("상대방의 장고로 인해 페널티 없이 무효 처리하고 나가시겠습니까?")) {
                handlers.handleAction({ type: 'REQUEST_NO_CONTEST_LEAVE', payload: { gameId } });
            }
        } else {
            setConfirmModalType('resign');
        }
    }, [isSpectator, handlers.handleAction, session.isAiGame, session.isSinglePlayer, gameId, gameStatus, isNoContestLeaveAvailable]);

    useEffect(() => {
        return () => {
            clearPauseCountdown();
        };
    }, [clearPauseCountdown]);

    useEffect(() => {
        const isTower = session.gameCategory === 'tower';
        if (!(session.isSinglePlayer || isTower)) return;
        if (isPaused && ['ended', 'no_contest'].includes(gameStatus)) {
            resumeFromPause();
        }
    }, [session.isSinglePlayer, isPaused, gameStatus, resumeFromPause, session.gameCategory]);

    useEffect(() => {
        setIsPaused(false);
        setResumeCountdown(0);
        setPauseButtonCooldown(0);
        pauseStartedAtRef.current = null;
        clearPauseCountdown();
        // 게임이 변경되면 보드 잠금 상태 초기화
        setIsBoardLocked(false);
        setLastReceivedServerRevision(session.serverRevision ?? 0);
    }, [session.id, clearPauseCountdown, session.serverRevision]);

    // currentPlayer 변경 감지: AI가 돌을 둔 경우 보드 잠금
    useEffect(() => {
        if (session.isSinglePlayer && prevCurrentPlayer !== undefined) {
            // 싱글플레이에서는 blackPlayerId가 사용자, whitePlayerId가 AI
            const myPlayerEnum = blackPlayerId === currentUser.id ? Player.Black : (whitePlayerId === currentUser.id ? Player.White : Player.None);
            const wasMyTurn = prevCurrentPlayer === myPlayerEnum;
            const isNowMyTurn = currentPlayer === myPlayerEnum;
            
            // AI가 돌을 둔 경우 (내 턴이 아니었다가 내 턴이 된 경우는 제외)
            if (wasMyTurn && !isNowMyTurn) {
                console.log('[Game] AI moved, locking board until serverRevision update', { 
                    prevCurrentPlayer, 
                    currentPlayer, 
                    myPlayerEnum,
                    wasMyTurn,
                    isNowMyTurn
                });
                setIsBoardLocked(true);
            }
        }
    }, [currentPlayer, prevCurrentPlayer, session.isSinglePlayer, currentUser.id, blackPlayerId, whitePlayerId]);

    // serverRevision 변경 감지: 최신 상태를 받은 경우 보드 잠금 해제
    useEffect(() => {
        if ((session.isSinglePlayer || isTower) && session.serverRevision !== undefined) {
            const newRevision = session.serverRevision;
            if (newRevision > lastReceivedServerRevision) {
                setLastReceivedServerRevision(newRevision);
                // 최신 상태를 받았으므로 잠금 해제
                if (isBoardLocked) {
                    console.log('[Game] Received latest serverRevision, unlocking board');
                    setIsBoardLocked(false);
                }
            }
        }
    }, [session.serverRevision, session.isSinglePlayer, isTower, lastReceivedServerRevision, isBoardLocked]);

    // 싱글플레이: 클라이언트 측 AI 자동 처리 (서버 부하 최소화)
    // 보드 잠금은 사용자 입력만 막는 것이므로, AI 수 계산은 보드 잠금과 독립적으로 실행
    const aiMoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastAiMoveRef = useRef<{ gameId: string; moveHistoryLength: number; player: Player; timestamp: number } | null>(null);
    
    // moveHistoryLength 변경 시 lastAiMoveRef 검증 및 초기화
    useEffect(() => {
        if (lastAiMoveRef.current) {
            const currentMoveHistoryLength = session.moveHistory?.length || 0;
            // moveHistoryLength가 증가했거나, 타임스탬프가 3초 이상 지났으면 초기화
            const timeSinceLastMove = Date.now() - lastAiMoveRef.current.timestamp;
            if (currentMoveHistoryLength > lastAiMoveRef.current.moveHistoryLength || timeSinceLastMove > 3000) {
                console.log('[Game] Resetting lastAiMoveRef:', {
                    reason: currentMoveHistoryLength > lastAiMoveRef.current.moveHistoryLength ? 'moveHistoryLength increased' : 'timeout',
                    lastMove: lastAiMoveRef.current,
                    currentMoveHistoryLength,
                    timeSinceLastMove
                });
                lastAiMoveRef.current = null;
            }
        }
    }, [session.moveHistory?.length]);
    
    useEffect(() => {
        // 이전 timeout이 있으면 취소
        if (aiMoveTimeoutRef.current) {
            clearTimeout(aiMoveTimeoutRef.current);
            aiMoveTimeoutRef.current = null;
        }
        
        const isTower = session.gameCategory === 'tower';
        const isPlayfulAiGame = session.isAiGame && PLAYFUL_GAME_MODES.some(m => m.mode === mode);
        // 게임이 종료되었거나 일시정지되었거나 플레이 중이 아니면 AI 수를 보내지 않음
        // 놀이바둑 AI 게임도 클라이언트에서 처리
        if (!(session.isSinglePlayer || isTower || isPlayfulAiGame) || isPaused || gameStatus !== 'playing') {
            lastAiMoveRef.current = null;
            return;
        }
        if (currentPlayer === Player.None) {
            lastAiMoveRef.current = null;
            return;
        }
        
        // 게임이 제대로 초기화되지 않았으면 AI 수를 보내지 않음
        const boardStateToCheck = restoredBoardState || session.boardState;
        if (!boardStateToCheck || !Array.isArray(boardStateToCheck) || boardStateToCheck.length === 0) return;
        if (!session.blackPlayerId || !session.whitePlayerId) return;
        
        // 게임 ID가 유효한지 확인 (재도전 시 게임 ID가 변경될 수 있음)
        if (!session.id || typeof session.id !== 'string') return;

        const aiPlayerId = currentPlayer === Player.Black ? session.blackPlayerId : session.whitePlayerId;
        // 놀이바둑 AI 게임도 클라이언트에서 처리
        const isAiTurn = aiPlayerId === AI_USER_ID || (session.isAiGame && aiPlayerId === 'ai-player-01');

        // 디버깅: AI 차례 판단 로그 (도전의 탑과 싱글플레이에서 상세하게)
        if ((isTower || session.isSinglePlayer) && (currentPlayer === Player.Black || currentPlayer === Player.White)) {
            const logData = {
                gameId: session.id,
                gameCategory: session.gameCategory,
                isTower,
                isSinglePlayer: session.isSinglePlayer,
                currentPlayer,
                'currentPlayer === Player.White': currentPlayer === Player.White,
                'currentPlayer === Player.Black': currentPlayer === Player.Black,
                aiPlayerId,
                AI_USER_ID,
                'aiPlayerId === AI_USER_ID': aiPlayerId === AI_USER_ID,
                isAiTurn,
                blackPlayerId: session.blackPlayerId,
                whitePlayerId: session.whitePlayerId,
                'whitePlayerId === AI_USER_ID': session.whitePlayerId === AI_USER_ID,
                'blackPlayerId === AI_USER_ID': session.blackPlayerId === AI_USER_ID,
                gameStatus,
                lastAiMove: lastAiMoveRef.current,
                moveHistoryLength: session.moveHistory?.length || 0
            };
            console.log(`[Game] ${isTower ? 'Tower' : 'Single player'} AI turn check:`, logData);
            if (currentPlayer === Player.White && session.whitePlayerId !== AI_USER_ID) {
                console.error(`[Game] MISMATCH: Current player is White but whitePlayerId is not AI_USER_ID!`, {
                    whitePlayerId: session.whitePlayerId,
                    AI_USER_ID,
                    blackPlayerId: session.blackPlayerId,
                    gameCategory: session.gameCategory,
                    isSinglePlayer: session.isSinglePlayer
                });
            }
            // 싱글플레이에서는 blackPlayerId가 유저 ID여야 하고, whitePlayerId가 AI_USER_ID여야 함
            if (currentPlayer === Player.Black && session.blackPlayerId !== currentUser.id && session.isSinglePlayer) {
                console.error(`[Game] MISMATCH: Single player - Current player is Black but blackPlayerId is not current user!`, {
                    blackPlayerId: session.blackPlayerId,
                    whitePlayerId: session.whitePlayerId,
                    AI_USER_ID,
                    currentUserId: currentUser.id
                });
            }
        }

        if (isAiTurn) {
            // 게임이 이미 종료되었는지 확인
            if (gameStatus !== 'playing' && (gameStatus === 'ended' || gameStatus === 'no_contest' || gameStatus === 'scoring')) {
                console.log(`[Game] ${isTower ? 'Tower' : 'Single player'} game already ended, skipping AI move:`, {
                    gameId: session.id,
                    gameStatus
                });
                return;
            }
            
            console.log('[Game] Entering AI move calculation block:', {
                gameId: session.id,
                gameCategory: session.gameCategory,
                isTower,
                currentPlayer,
                moveHistoryLength: session.moveHistory?.length || 0
            });
            const moveHistoryLength = session.moveHistory?.length || 0;
            
            // 이미 같은 게임, 같은 moveHistory 길이, 같은 플레이어에 대해 AI 수를 보냈는지 확인
            // (중복 전송 방지)
            // 단, AI 수 계산 중이거나 전송 대기 중인 경우(타임스탬프가 2초 이내)는 제외
            if (lastAiMoveRef.current &&
                lastAiMoveRef.current.gameId === session.id &&
                lastAiMoveRef.current.moveHistoryLength === moveHistoryLength &&
                lastAiMoveRef.current.player === currentPlayer) {
                const timeSinceLastMove = Date.now() - lastAiMoveRef.current.timestamp;
                // 2초 이내면 아직 전송 대기 중이거나 계산 중일 수 있으므로 무시
                if (timeSinceLastMove < 2000) {
                    console.log('[Game] AI move calculation/transmission in progress, skipping:', {
                        gameId: session.id,
                        lastMove: lastAiMoveRef.current,
                        currentMoveHistoryLength: moveHistoryLength,
                        currentPlayer,
                        timeSinceLastMove
                    });
                    return;
                }
                // 3초 이상 지났으면 초기화하고 재시도
                if (timeSinceLastMove > 3000) {
                    console.log('[Game] lastAiMoveRef timeout, resetting and retrying:', {
                        gameId: session.id,
                        lastMove: lastAiMoveRef.current,
                        timeSinceLastMove
                    });
                    lastAiMoveRef.current = null;
                    // 초기화 후 계속 진행하여 AI 수 재계산
                } else {
                    // 이미 이 상태에 대해 AI 수를 보냈으므로 무시
                    console.log('[Game] AI move already sent, skipping:', {
                        gameId: session.id,
                        lastAiMove: lastAiMoveRef.current,
                        currentMoveHistoryLength: moveHistoryLength,
                        currentPlayer,
                        timeSinceLastMove
                    });
                    return;
                }
            }
            
            // 놀이바둑 게임은 바둑 AI를 사용할 수 없으므로 서버로 전송
            const isPlayfulMode = PLAYFUL_GAME_MODES.some(m => m.mode === mode);
            if (isPlayfulMode) {
                // 놀이바둑 게임은 서버에서 AI 처리 (DICE, ALKKAGI, CURLING, THIEF 등)
                // 서버로 액션 전송하여 AI가 처리하도록 함
                console.log('[Game] Playful AI game - sending action to server for AI processing:', {
                    gameId: session.id,
                    mode,
                    currentPlayer
                });
                // 서버에서 AI가 처리하도록 PLACE_STONE 액션 전송 (서버가 AI 차례를 감지하여 처리)
                handlers.handleAction({
                    type: 'PLACE_STONE',
                    payload: {
                        gameId: session.id,
                        x: -1, // 서버에서 AI가 처리하도록 표시
                        y: -1,
                        isClientAiMove: false,
                    },
                } as ServerAction);
                return;
            }
            
            // 클라이언트 측에서 AI 수 계산 (바둑 모드만)
            const aiLevel = session.settings.aiDifficulty || 1;
            const opponentPlayer = currentPlayer === Player.Black ? Player.White : Player.Black;
            
            // 현재 게임 ID와 상태를 저장 (timeout 내에서 사용)
            const currentGameId = session.id;
            const currentGameStatus = session.gameStatus;
            const currentPlayerAtCalculation = currentPlayer;
            const moveHistoryLengthAtCalculation = moveHistoryLength;
            
            // 보드 상태를 깊은 복사하여 계산 시점의 상태를 보존
            const boardStateToUse = restoredBoardState || session.boardState;
            const boardStateAtCalculation = JSON.parse(JSON.stringify(boardStateToUse));
            const koInfoAtCalculation = session.koInfo ? JSON.parse(JSON.stringify(session.koInfo)) : null;
            
            const aiMove = calculateSimpleAiMove(
                boardStateAtCalculation,
                currentPlayer,
                opponentPlayer,
                koInfoAtCalculation,
                moveHistoryLengthAtCalculation,
                aiLevel
            );

            if (aiMove) {
                console.log('[Game] AI move calculated:', {
                    gameId: currentGameId,
                    gameCategory: session.gameCategory,
                    isTower: session.gameCategory === 'tower',
                    aiMove,
                    currentPlayer: currentPlayerAtCalculation,
                    aiLevel,
                    moveHistoryLength: moveHistoryLengthAtCalculation
                });
                
                // 약 1초 지연 후 AI 수 전송 (봇도 시간을 사용해야 하므로)
                const delay = 1000; // 1초 고정
                aiMoveTimeoutRef.current = setTimeout(() => {
                    // 게임 상태가 여전히 'playing'이고 AI 차례인지 다시 확인
                    // 게임 ID가 변경되지 않았는지도 확인
                    // moveHistory 길이가 변경되지 않았는지 확인 (다른 수가 이미 둬졌는지 확인)
                    const currentMoveHistoryLength = session.moveHistory?.length || 0;
                    if (session.gameStatus === 'playing' && 
                        session.currentPlayer === currentPlayerAtCalculation &&
                        session.id === currentGameId &&
                        session.gameStatus === currentGameStatus &&
                        currentMoveHistoryLength === moveHistoryLengthAtCalculation) {
                        // 타워 게임, 싱글플레이 게임, 놀이바둑 AI 게임의 AI move도 클라이언트에서만 처리
                        const isPlayfulAiGame = session.isAiGame && PLAYFUL_GAME_MODES.some(m => m.mode === mode);
                        if (session.gameCategory === 'tower' || session.isSinglePlayer || isPlayfulAiGame) {
                            console.log(`[Game] ${session.gameCategory === 'tower' ? 'Tower' : 'Single player'} game - processing AI move client-side:`, {
                                gameId: currentGameId,
                                x: aiMove.x,
                                y: aiMove.y,
                                currentPlayer: currentPlayerAtCalculation
                            });
                            
                            // 클라이언트에서 AI move 처리
                            const aiMoveResult = processMoveClient(
                                boardStateAtCalculation,
                                { x: aiMove.x, y: aiMove.y, player: currentPlayerAtCalculation },
                                koInfoAtCalculation,
                                moveHistoryLengthAtCalculation
                            );
                            
                            if (!aiMoveResult.isValid) {
                                console.warn(`[Game] ${session.gameCategory === 'tower' ? 'Tower' : 'Single player'} game - Invalid AI move:`, aiMoveResult.reason);
                                lastAiMoveRef.current = null;
                                return;
                            }
                            
                            // AI 수를 실제로 전송한 후에만 lastAiMoveRef 설정 (중복 전송 방지)
                            lastAiMoveRef.current = {
                                gameId: currentGameId,
                                moveHistoryLength: moveHistoryLengthAtCalculation,
                                player: currentPlayerAtCalculation,
                                timestamp: Date.now()
                            };
                            
                            // 게임 상태 업데이트 (handlers를 통해)
                            handlers.handleAction({
                                type: session.gameCategory === 'tower' ? 'TOWER_CLIENT_MOVE' : 'SINGLE_PLAYER_CLIENT_MOVE',
                                payload: {
                                    gameId: currentGameId,
                                    x: aiMove.x,
                                    y: aiMove.y,
                                    newBoardState: aiMoveResult.newBoardState,
                                    capturedStones: aiMoveResult.capturedStones,
                                    newKoInfo: aiMoveResult.newKoInfo,
                                }
                            } as any);
                        } else {
                        console.log('[Game] Sending AI move:', {
                            gameId: currentGameId,
                            x: aiMove.x,
                            y: aiMove.y,
                            isClientAiMove: true
                        });
                        handlers.handleAction({
                            type: 'PLACE_STONE',
                            payload: {
                                gameId: currentGameId,
                                x: aiMove.x,
                                y: aiMove.y,
                                isClientAiMove: true, // 클라이언트가 계산한 AI 수임을 표시
                            },
                        } as ServerAction);
                        }
                    } else {
                        console.log('[Game] AI move cancelled due to state change:', {
                            gameStatus: session.gameStatus,
                            currentPlayer: session.currentPlayer,
                            gameId: session.id,
                            moveHistoryLength: currentMoveHistoryLength,
                            expectedLength: moveHistoryLengthAtCalculation
                        });
                        // 상태가 변경되었으므로 lastAiMoveRef 초기화
                        lastAiMoveRef.current = null;
                    }
                    aiMoveTimeoutRef.current = null;
                }, delay);
            } else {
                console.warn('[Game] calculateSimpleAiMove returned null:', {
                    gameId: currentGameId,
                    gameCategory: session.gameCategory,
                    isTower: session.gameCategory === 'tower',
                    currentPlayer: currentPlayerAtCalculation,
                    aiLevel,
                    boardSize: boardStateAtCalculation.length,
                    moveHistoryLength: moveHistoryLengthAtCalculation
                });
                // AI 수를 계산할 수 없으면 lastAiMoveRef 초기화하여 다음 시도 허용
                lastAiMoveRef.current = null;
            }
        } else {
            // AI 차례가 아니면 lastAiMoveRef 초기화 (다음 AI 차례를 위해)
            lastAiMoveRef.current = null;
        }
        
        // cleanup: 게임 ID가 변경되거나 컴포넌트가 unmount될 때 timeout 취소
        return () => {
            if (aiMoveTimeoutRef.current) {
                clearTimeout(aiMoveTimeoutRef.current);
                aiMoveTimeoutRef.current = null;
            }
        };
    }, [session.isSinglePlayer, session.gameCategory, isPaused, gameStatus, currentPlayer, session.blackPlayerId, session.whitePlayerId, restoredBoardState, session.koInfo, session.moveHistory?.length, session.settings.aiDifficulty, isBoardLocked, session.id, session.gameStatus, handlers.handleAction]);
    
    const globalChat = useMemo(() => waitingRoomChats['global'] || [], [waitingRoomChats]);
    
    const handleCloseResults = useCallback(() => {
        // AI 게임의 경우 결과창 확인 시 모달만 닫고, 홈화면으로 이동하지 않음
        // 나가기 버튼을 통해 대기실로 이동할 수 있음
        setShowResultModal(false);
        // 계가가 완료된 경우(analysisResult가 있는 경우) 영토 표시는 유지
        // 계가가 완료되지 않은 경우에만 영토 표시를 숨김
        if (!session.analysisResult?.['system']) {
            setShowFinalTerritory(false);
        }
        // 도전의 탑이나 싱글플레이어의 경우, 확인 버튼을 눌렀을 때 모달이 닫히도록 하기 위해
        // showResultModal을 false로 설정했지만, gameStatus === 'ended' 조건 때문에 모달이 계속 표시될 수 있음
        // 이를 방지하기 위해 추가 상태 관리가 필요할 수 있지만, 일단 showResultModal만 false로 설정
    }, [session.analysisResult]);

    // 싱글플레이 게임 설명창 표시 여부
    const showGameDescription = isSinglePlayer && gameStatus === 'pending';
    // 도전의 탑 게임 설명창 표시 여부
    const showTowerGameDescription = isTower && gameStatus === 'pending';
    
    // 도전의 탑 배경 이미지 설정
    const towerBackgroundImage = isTower && session.towerFloor 
        ? (session.towerFloor === 100 ? '/images/tower/Tower100.png' : '/images/tower/InTower.png')
        : null;
    
    // 디버깅: 게임 상태 확인
    useEffect(() => {
        if (isSinglePlayer) {
            console.log('[Game] Single player game status:', {
                gameStatus,
                isSinglePlayer,
                showGameDescription,
                gameId: session.id,
                stageId: session.stageId
            });
        }
        if (isTower) {
            console.log('[Game] Tower game status:', {
                gameStatus,
                isTower,
                showTowerGameDescription,
                gameId: session.id,
                towerFloor: session.towerFloor
            });
        }
    }, [isSinglePlayer, isTower, gameStatus, showGameDescription, showTowerGameDescription, session.id, session.stageId, session.towerFloor]);

    const handleStartGame = useCallback(() => {
        console.log('[Game] handleStartGame called', { gameId, gameStatus, isSinglePlayer, isTower, sessionId: session.id });
        if (!gameId) {
            console.error('[Game] handleStartGame: gameId is missing', { sessionId: session.id, gameStatus });
            return;
        }
        
        if (isSinglePlayer) {
            console.log('[Game] handleStartGame: Sending CONFIRM_SINGLE_PLAYER_GAME_START', { gameId, gameStatus });
            handlers.handleAction({ 
                type: 'CONFIRM_SINGLE_PLAYER_GAME_START', 
                payload: { gameId } 
            } as ServerAction).then(result => {
                console.log('[Game] handleStartGame: CONFIRM_SINGLE_PLAYER_GAME_START completed', result);
            }).catch(err => {
                console.error('[Game] handleStartGame: CONFIRM_SINGLE_PLAYER_GAME_START failed', err);
            });
        } else if (isTower) {
            console.log('[Game] handleStartGame: Sending CONFIRM_TOWER_GAME_START', { gameId, gameStatus, isTower });
            handlers.handleAction({ 
                type: 'CONFIRM_TOWER_GAME_START', 
                payload: { gameId } 
            } as ServerAction);
        }
    }, [handlers.handleAction, gameId, isSinglePlayer, isTower, session.id, gameStatus]);

    // 도전의 탑: 싱글플레이와 동일하게 시작 모달에서 시작 버튼을 눌러 확정
    
    // 싱글플레이어 게임의 경우 restoredBoardState를 포함한 session 객체 생성
    // session 객체의 참조가 변경되지 않을 수 있으므로, moveHistory.length와 boardState를 의존성으로 사용
    const sessionWithRestoredBoard = useMemo(() => {
        if (!isSinglePlayer && !isTower) {
            return session;
        }
        // restoredBoardState가 있고 session.boardState와 다르면 업데이트된 boardState 사용
        if (restoredBoardState && restoredBoardState !== session.boardState) {
            return {
                ...session,
                boardState: restoredBoardState
            };
        }
        return session;
    }, [isSinglePlayer, isTower, session, restoredBoardState, session.moveHistory?.length, session.boardState]);
    
    const gameProps: GameProps = {
        session: sessionWithRestoredBoard, onAction: handlers.handleAction, currentUser: currentUserWithStatus, waitingRoomChat: globalChat,
        gameChat: gameChat, isSpectator, onlineUsers, activeNegotiation, negotiations: Object.values(negotiations), onViewUser: handlers.openViewingUser
    };

    const gameControlsProps = {
        session, isMyTurn, isSpectator, onAction: handlers.handleAction, setShowResultModal, setConfirmModalType, currentUser: currentUserWithStatus,
        onlineUsers, pendingMove, onConfirmMove: handleConfirmMove, onCancelMove: handleCancelMove, settings, isMobile,
        showResultModal,
    };

    if (isSinglePlayer) {
        return (
            <div className={`w-full h-dvh flex flex-col p-1 lg:p-2 relative max-w-full bg-single-player-background text-stone-200`}>
                {showGameDescription && (
                    <SinglePlayerGameDescriptionModal 
                        session={session}
                        onStart={handleStartGame}
                    />
                )}
                <div className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0">
                    <main className="flex-1 flex items-center justify-center min-w-0 min-h-0">
                        <div className="w-full h-full max-h-full max-w-full lg:max-w-[calc(100vh-8rem)] flex flex-col items-center gap-1 lg:gap-2">
                            <div className="flex-shrink-0 w-full flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <PlayerPanel {...gameProps} clientTimes={clientTimes.clientTimes} isSinglePlayer={true} isMobile={isMobile} />
                                </div>
                            </div>
                            <div className="flex-1 w-full relative">
                                <div className="absolute inset-0">
                                    <GameArena 
                                        {...gameProps}
                                        isMyTurn={isMyTurn} 
                                        myPlayerEnum={myPlayerEnum} 
                                        handleBoardClick={handleBoardClick} 
                                        isItemModeActive={isItemModeActive} 
                                        showTerritoryOverlay={showFinalTerritory} 
                                        isMobile={isMobile}
                                        myRevealedMoves={session.revealedHiddenMoves?.[currentUser.id] || []}
                                        showLastMoveMarker={settings.features.lastMoveMarker}
                                        isSinglePlayerPaused={isPaused}
                                        resumeCountdown={resumeCountdown}
                                        isBoardLocked={isBoardLocked}
                                    />
                                </div>
                            </div>
                            <div className="flex-shrink-0 w-full flex flex-col gap-1">
                                <TurnDisplay
                                    session={session}
                                    isPaused={isPaused}
                                    isMobile={isMobile}
                                    onOpenSidebar={() => setIsMobileSidebarOpen(true)}
                                    onAction={handlers.handleAction}
                                />
                                <SinglePlayerControls {...gameControlsProps} />
                            </div>
                        </div>
                    </main>
                    
                    {!isMobile && (
                        <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0">
                                <SinglePlayerSidebar 
                                    session={session}
                                    gameChat={gameChat}
                                    onAction={handlers.handleAction}
                                    currentUser={currentUserWithStatus}
                                    isPaused={isPaused}
                                    resumeCountdown={resumeCountdown}
                                    pauseButtonCooldown={pauseButtonCooldown}
                                    onTogglePause={handlePauseToggle}
                                    onOpenSettings={handlers.openSettingsModal}
                                />
                        </div>
                    )}
                    
                    {isMobile && (
                        <>
                            <div className={`fixed top-0 right-0 h-full w-[280px] bg-secondary shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                                <SinglePlayerSidebar 
                                    session={session}
                                    gameChat={gameChat}
                                    onAction={handlers.handleAction}
                                    currentUser={currentUserWithStatus}
                                    onClose={() => setIsMobileSidebarOpen(false)}
                                    onOpenSettings={handlers.openSettingsModal}
                                    isPaused={isPaused}
                                    resumeCountdown={resumeCountdown}
                                    pauseButtonCooldown={pauseButtonCooldown}
                                    onTogglePause={handlePauseToggle}
                                />
                            </div>
                            {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                        </>
                    )}
                </div>
                
                <GameModals 
                    {...gameProps}
                    confirmModalType={confirmModalType}
                    onHideConfirmModal={() => setConfirmModalType(null)}
                    showResultModal={showResultModal}
                    onCloseResults={handleCloseResults}
                />
            </div>
        );
    }

    if (isTower) {
        return (
            <div 
                className={`w-full h-dvh flex flex-col p-1 lg:p-2 relative max-w-full text-stone-200`}
                style={towerBackgroundImage ? {
                    backgroundImage: `url(${towerBackgroundImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat'
                } : {}}
            >
                {showTowerGameDescription && (
                    <SinglePlayerGameDescriptionModal 
                        session={session}
                        onStart={handleStartGame}
                    />
                )}
                <div className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0">
                    <main className="flex-1 flex items-center justify-center min-w-0 min-h-0">
                        <div className="w-full h-full max-h-full max-w-full lg:max-w-[calc(100vh-8rem)] flex flex-col items-center gap-1 lg:gap-2">
                            <div className="flex-shrink-0 w-full flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <PlayerPanel {...gameProps} clientTimes={clientTimes.clientTimes} isSinglePlayer={true} isMobile={isMobile} />
                                </div>
                            </div>
                            <div className="flex-1 w-full relative">
                                <div className="absolute inset-0">
                                <GameArena 
                                        {...gameProps}
                                        isMyTurn={isMyTurn} 
                                        myPlayerEnum={myPlayerEnum} 
                                        handleBoardClick={handleBoardClick} 
                                        isItemModeActive={isItemModeActive} 
                                        showTerritoryOverlay={showFinalTerritory} 
                                        isMobile={isMobile}
                                        myRevealedMoves={session.revealedHiddenMoves?.[currentUser.id] || []}
                                        showLastMoveMarker={settings.features.lastMoveMarker}
                                        isSinglePlayerPaused={isPaused}
                                        resumeCountdown={resumeCountdown}
                                        isBoardLocked={isBoardLocked}
                                    />
                                </div>
                            </div>
                            <div className="flex-shrink-0 w-full flex flex-col gap-1">
                                <TurnDisplay
                                    session={session}
                                    isPaused={isPaused}
                                    isMobile={isMobile}
                                    onOpenSidebar={() => setIsMobileSidebarOpen(true)}
                                    onAction={handlers.handleAction}
                                />
                                <TowerControls {...gameControlsProps} />
                            </div>
                        </div>
                    </main>
                    
                    {!isMobile && (
                        <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0">
                            <TowerSidebar 
                                session={session}
                                gameChat={gameChat}
                                onAction={handlers.handleAction}
                                currentUser={currentUserWithStatus}
                                onOpenSettings={handlers.openSettingsModal}
                                onTogglePause={handlePauseToggle}
                                isPaused={isPaused}
                                resumeCountdown={resumeCountdown}
                                pauseButtonCooldown={pauseButtonCooldown}
                            />
                        </div>
                    )}
                    
                    {isMobile && (
                        <>
                            <div className={`fixed top-0 right-0 h-full w-[280px] bg-secondary shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                                <TowerSidebar 
                                    session={session}
                                    gameChat={gameChat}
                                    onAction={handlers.handleAction}
                                    currentUser={currentUserWithStatus}
                                    onClose={() => setIsMobileSidebarOpen(false)}
                                    onOpenSettings={handlers.openSettingsModal}
                                    onTogglePause={handlePauseToggle}
                                    isPaused={isPaused}
                                    resumeCountdown={resumeCountdown}
                                    pauseButtonCooldown={pauseButtonCooldown}
                                />
                            </div>
                            {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                        </>
                    )}
                </div>
                
                <GameModals 
                    {...gameProps}
                    confirmModalType={confirmModalType}
                    onHideConfirmModal={() => setConfirmModalType(null)}
                    showResultModal={showResultModal}
                    onCloseResults={handleCloseResults}
                />
            </div>
        );
    }

    // PVP 게임 배경 이미지 결정
    const pvpBackgroundClass = useMemo(() => {
        if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
            return 'bg-strategic-background';
        }
        if (PLAYFUL_GAME_MODES.some(m => m.mode === mode)) {
            return 'bg-playful-background';
        }
        return 'bg-tertiary';
    }, [mode]);

    return (
        <div className={`w-full h-dvh flex flex-col p-1 lg:p-2 relative max-w-full ${pvpBackgroundClass}`}>
            {session.disconnectionState && <DisconnectionModal session={session} currentUser={currentUser} />}
            {session.gameStatus === 'scoring' && !session.analysisResult?.['system'] && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-30 pointer-events-none">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-gray-100 mb-4"></div>
                    <p className="text-xl font-bold text-white">계가 중...</p>
                </div>
            )}
            <div className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0">
                <main className="flex-1 flex items-center justify-center min-w-0 min-h-0">
                    <div className="w-full h-full max-h-full max-w-full lg:max-w-[calc(100vh-8rem)] flex flex-col items-center gap-1 lg:gap-2">
                        <div className="flex-shrink-0 w-full flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <PlayerPanel {...gameProps} clientTimes={clientTimes.clientTimes} isMobile={isMobile} />
                            </div>
                        </div>
                        <div className="flex-1 w-full relative">
                            <div className="absolute inset-0">
                                <GameArena 
                                    {...gameProps}
                                    isMyTurn={isMyTurn} 
                                    myPlayerEnum={myPlayerEnum} 
                                    handleBoardClick={handleBoardClick} 
                                    isItemModeActive={isItemModeActive} 
                                    showTerritoryOverlay={showFinalTerritory} 
                                    isMobile={isMobile}
                                    myRevealedMoves={session.revealedHiddenMoves?.[currentUser.id] || []}
                                    showLastMoveMarker={settings.features.lastMoveMarker}
                                />
                            </div>
                        </div>
                        <div className="flex-shrink-0 w-full flex flex-col gap-1">
                            <TurnDisplay
                                session={session}
                                isMobile={isMobile}
                                onOpenSidebar={isMobile ? openMobileSidebar : undefined}
                                sidebarNotification={hasNewMessage}
                                onAction={handlers.handleAction}
                            />
                            <GameControls {...gameControlsProps} />
                        </div>
                    </div>
                </main>
                
                {!isMobile && (
                     <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0">
                        <Sidebar 
                            {...gameProps}
                            onLeaveOrResign={handleLeaveOrResignClick}
                            isNoContestLeaveAvailable={isNoContestLeaveAvailable}
                            onOpenSettings={handlers.openSettingsModal}
                        />
                    </div>
                )}
                
                {isMobile && (
                    <>
                        <div className={`fixed top-0 right-0 h-full w-[280px] bg-secondary shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                            <Sidebar 
                                {...gameProps}
                                onLeaveOrResign={handleLeaveOrResignClick}
                                isNoContestLeaveAvailable={isNoContestLeaveAvailable}
                                onClose={() => setIsMobileSidebarOpen(false)}
                                onOpenSettings={handlers.openSettingsModal}
                            />
                        </div>
                        {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                    </>
                )}
            </div>
            
            {isAnalysisActive && analysisResult && (
                <TerritoryAnalysisWindow session={session} result={analysisResult} onClose={() => setIsAnalysisActive(false)} />
            )}
            
            <GameModals 
                {...gameProps}
                confirmModalType={confirmModalType}
                onHideConfirmModal={() => setConfirmModalType(null)}
                showResultModal={showResultModal}
                onCloseResults={handleCloseResults}
            />
        </div>
    );
};

export default Game;