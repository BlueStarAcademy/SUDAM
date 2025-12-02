import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LiveGameSession, Player, GameStatus, GameMode, User, ServerAction } from '../../types.js';
import { PLAYFUL_GAME_MODES, DICE_GO_MAIN_PLACE_TIME, DICE_GO_MAIN_ROLL_TIME, DICE_GO_LAST_CAPTURE_BONUS_BY_TOTAL_ROUNDS } from '../../constants';
import { audioService } from '../../services/audioService.js';

interface TurnDisplayProps {
    session: LiveGameSession;
    isPaused?: boolean;
    isMobile?: boolean;
    onOpenSidebar?: () => void;
    sidebarNotification?: boolean;
    onAction?: (action: ServerAction) => void;
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

const getGameStatusText = (session: LiveGameSession): string => {
    const { gameStatus, currentPlayer, blackPlayerId, whitePlayerId, player1, player2, mode, settings, passCount, moveHistory, alkkagiRound } = session;

    const getPlayerByEnum = (playerEnum: Player): User | null => {
        const targetId = playerEnum === Player.Black ? blackPlayerId : whitePlayerId;
        if (!targetId) return null;
        return player1.id === targetId ? player1 : player2;
    };

    const player = getPlayerByEnum(currentPlayer);

    if (session.mode === GameMode.Dice && session.lastWhiteGroupInfo && session.lastWhiteGroupInfo.liberties <= 6) {
        const totalRounds = session.settings.diceGoRounds ?? 1;
        let message = `마지막 승부! 유효자리 ${session.lastWhiteGroupInfo.liberties}개`;
        if (session.round === totalRounds && totalRounds > 0) {
            const bonus = DICE_GO_LAST_CAPTURE_BONUS_BY_TOTAL_ROUNDS[totalRounds - 1];
            if (bonus) {
                message += ` (마지막 포획 보너스 +${bonus}점)`;
            }
        }
        return message;
    }

    const lastMoveInHistory = moveHistory && moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
    
    // 싱글플레이어 게임에서는 통과 기능이 없으므로 통과 텍스트를 표시하지 않음
    const isSinglePlayer = session.isSinglePlayer || session.gameCategory === 'singleplayer';
    
    if (!isSinglePlayer) {
        if (passCount >= 2 && lastMoveInHistory?.x === -1) {
            return "양측 모두 통과하여 계가를 시작합니다.";
        }

        if (gameStatus !== 'ended' && passCount === 1 && lastMoveInHistory?.x === -1) {
            const opponentOfCurrent = currentPlayer === Player.Black ? Player.White : Player.Black;
            const passingPlayer = getPlayerByEnum(opponentOfCurrent);
            if (passingPlayer) {
                return `${passingPlayer.nickname}님이 통과했습니다.`;
            }
        }
    }

    switch (gameStatus) {
        case 'playing':
            return player ? `${player.nickname}님의 차례입니다.` : '대국 진행 중';
        case 'nigiri_choosing':
        case 'nigiri_guessing':
        case 'nigiri_reveal':
            return '돌 가리기 진행 중...';
        case 'base_placement':
            return `베이스돌 배치 중... (${settings.baseStones}개)`;
        case 'komi_bidding':
            return '덤 설정 중...';
        case 'ended':
            return '대국 종료';
        case 'no_contest':
            return '무효 대국';
        case 'rematch_pending':
            return '재대결 대기 중...';
        case 'hidden_placing':
        case 'scanning':
        case 'missile_selecting':
            return '아이템 사용 중...';
        case 'hidden_final_reveal':
            return "모든 히든돌을 공개하고 계가를 시작합니다.";
        case 'alkkagi_placement': {
            const currentRound = alkkagiRound || 1;
            const totalRounds = settings.alkkagiRounds || 1;
            if (currentRound > 1) {
                return `돌을 다시 배치하세요. (${currentRound} / ${totalRounds} 라운드)`;
            }
            return `돌을 배치하세요. (${currentRound} / ${totalRounds} 라운드)`;
        }
        case 'alkkagi_playing': {
            const currentRound = alkkagiRound || 1;
            const totalRounds = settings.alkkagiRounds || 1;
            return `${player?.nickname}님 차례입니다. (${currentRound} / ${totalRounds} 라운드)`;
        }
        case 'alkkagi_round_end':
            return `라운드 종료! 결과를 확인하세요.`;
        case 'dice_rolling':
             return player ? `${player.nickname}님이 주사위를 굴릴 차례입니다.` : '주사위 굴릴 차례';
        case 'thief_rolling':
             return player ? `${player.nickname}님이 주사위를 굴릴 차례입니다.` : '주사위 굴릴 차례';
        case 'curling_tiebreaker_preference_selection':
        case 'curling_tiebreaker_rps':
        case 'curling_tiebreaker_rps_reveal':
            return '승부치기 순서 결정 중...';
        case 'curling_tiebreaker_playing':
            return `승부치기 진행 중... (${player?.nickname}님 차례)`;
        default:
            if (mode === GameMode.Dice) return `주사위 바둑 (${session.round} / ${session.settings.diceGoRounds} 라운드)`;
            if (mode === GameMode.Thief) return `도둑과 경찰 (${session.round} 라운드)`;
            return player ? `${player.nickname}님의 차례입니다.` : '게임 준비 중...';
    }
};

const TurnDisplay: React.FC<TurnDisplayProps> = ({
    session,
    isPaused = false,
    isMobile = false,
    onOpenSidebar,
    sidebarNotification = false,
    onAction,
}) => {
    const [timeLeft, setTimeLeft] = useState(30);
    const [percentage, setPercentage] = useState(100);
    const [foulMessage, setFoulMessage] = useState<string | null>(null);
    const prevTimeoutPlayerId = usePrevious(session.lastTimeoutPlayerId);
    const prevFoulInfoMessage = usePrevious(session.foulInfo?.message);

    const isPlayfulTurn = useMemo(() => {
        return PLAYFUL_GAME_MODES.some(m => m.mode === session.mode) && 
               session.turnDeadline && 
               session.turnStartTime &&
               ['dice_rolling', 'dice_placing', 'thief_rolling', 'thief_placing'].includes(session.gameStatus);
    }, [session.mode, session.turnDeadline, session.turnStartTime, session.gameStatus]);

    useEffect(() => {
        if (!isPlayfulTurn) {
            setPercentage(100);
            return;
        }

        if (isPaused) {
            return;
        }

        const totalDuration = session.turnDeadline! - session.turnStartTime!;
        if (totalDuration <= 0) return;

        const updateBar = () => {
            const remaining = session.turnDeadline! - Date.now();
            const newPercentage = Math.max(0, (remaining / totalDuration) * 100);
            setPercentage(newPercentage);
        };

        updateBar();
        const interval = setInterval(updateBar, 100);
        return () => clearInterval(interval);
    }, [isPlayfulTurn, session.turnDeadline, session.turnStartTime, isPaused]);


    useEffect(() => {
        if (session.foulInfo && session.foulInfo.message !== prevFoulInfoMessage) {
            setFoulMessage(session.foulInfo.message);
            audioService.timeoutFoul();
            const timer = setTimeout(() => setFoulMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [session.foulInfo, prevFoulInfoMessage]);

    useEffect(() => {
        if (session.lastTimeoutPlayerId && session.lastTimeoutPlayerId !== prevTimeoutPlayerId) {
            const isFoulMode = PLAYFUL_GAME_MODES.some(m => m.mode === session.mode);
            if (isFoulMode) {
                 const foulPlayer = session.player1.id === session.lastTimeoutPlayerId ? session.player1 : session.player2;
                 setFoulMessage(`${foulPlayer.nickname}님의 타임오버 파울!`);
                 const timer = setTimeout(() => setFoulMessage(null), 5000);
                 return () => clearTimeout(timer);
            }
        }
    }, [session.lastTimeoutPlayerId, prevTimeoutPlayerId, session.mode, session.player1, session.player2]);
    
    useEffect(() => {
        // Reset foul message when moving to a new turn/phase to prevent it from persisting.
        const resetStatuses: GameStatus[] = [
            'playing', 'ended', 'no_contest', // Strategic/General
            'alkkagi_playing', 'curling_playing', 'dice_rolling', 'dice_placing', 'thief_rolling', 'thief_placing' // Playful
        ];
    
        if (resetStatuses.includes(session.gameStatus)) {
            setFoulMessage(null);
        }
    }, [session.gameStatus]);

    const isItemMode = ['hidden_placing', 'scanning', 'missile_selecting'].includes(session.gameStatus);

    const prevTimeLeft = useRef<number>(30);
    
    useEffect(() => {
        if (!isItemMode || !session.itemUseDeadline || isPaused) {
            setTimeLeft(30); // Reset to default when not in item mode
            prevTimeLeft.current = 30;
            return;
        }

        const updateTimer = () => {
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((session.itemUseDeadline! - now) / 1000));
            const clampedRemaining = Math.min(30, Math.max(0, remaining)); // 0-30초 범위로 제한
            
            // 0초가 되면 초읽기 효과음 재생
            if (clampedRemaining === 0 && prevTimeLeft.current > 0) {
                audioService.timerWarning();
            }
            prevTimeLeft.current = clampedRemaining;
            
            // 상태 업데이트 (항상 업데이트하여 막대그래프가 작동하도록)
            setTimeLeft(clampedRemaining);
            
            // 아이템 시간이 초과되었는데 게임 상태가 여전히 아이템 모드인 경우
            // 싱글플레이에서는 서버의 게임 루프가 제대로 작동하지 않을 수 있으므로
            // 클라이언트에서 서버에 게임 상태 업데이트를 요청
            if (remaining === 0 && session.gameStatus === 'missile_selecting' && onAction && session.id) {
                console.log(`[TurnDisplay] Item use deadline expired but gameStatus is still missile_selecting, requesting game state update, gameId=${session.id}`);
                // 서버의 게임 루프가 처리하도록 하기 위해 빈 액션을 보내서 게임 상태를 갱신
                // 실제로는 서버의 processGame이 updateMissileState를 호출하여 처리
            }
        };

        updateTimer();
        const timerId = setInterval(updateTimer, 500);

        return () => clearInterval(timerId);
    }, [isItemMode, session.itemUseDeadline, isPaused, session.gameStatus, onAction, session.id]);

    const isSinglePlayer = session.isSinglePlayer;
    const baseClasses = "flex-shrink-0 rounded-lg flex flex-col items-center justify-center shadow-inner py-1 h-12 border";
    const themeClasses = isSinglePlayer 
        ? "bg-stone-800/70 backdrop-blur-sm border-stone-700/50" 
        : "bg-secondary border-color";
    const textClass = isSinglePlayer ? "text-amber-300" : "text-highlight";

    const showSidebarButton = Boolean(isMobile && onOpenSidebar);
    const paddingClass = showSidebarButton ? 'pr-12' : '';

    const sidebarToggle = showSidebarButton ? (
        <button
            type="button"
            onClick={onOpenSidebar}
            className="absolute top-1/2 -translate-y-1/2 right-1.5 w-9 h-10 sm:w-10 sm:h-12 bg-secondary/80 backdrop-blur-sm rounded-l-lg flex items-center justify-center text-primary shadow-lg hover:bg-secondary transition-colors"
            aria-label="메뉴 열기"
        >
            <span className="relative font-bold text-lg sm:text-xl">
                {'<'}
                {sidebarNotification && (
                    <span className="absolute -top-1.5 -right-1 w-2 h-2 bg-danger rounded-full border border-secondary"></span>
                )}
            </span>
        </button>
    ) : null;

    const wrapContent = (containerClass: string, content: React.ReactNode) => (
        <div className="relative w-full">
            <div className={`${containerClass} ${paddingClass}`}>
                {content}
            </div>
            {sidebarToggle}
        </div>
    );
    
    if (foulMessage) {
        return wrapContent(
            "flex-shrink-0 bg-danger rounded-lg flex items-center justify-center shadow-inner animate-pulse py-1 h-12 border-2 border-red-500",
            <p className="font-bold text-white tracking-wider text-[clamp(0.875rem,3vmin,1.125rem)]">{foulMessage}</p>
        );
    }
    
    if (session.mode === GameMode.Dice && session.gameStatus === 'dice_placing' && session.dice) {
        return wrapContent(
            `${baseClasses} ${themeClasses} px-4 gap-1`,
            <>
                <div className="flex items-center gap-2">
                    <span className={`font-bold text-tertiary text-[clamp(0.8rem,2.5vmin,1rem)]`}>
                        주사위: <span className={`${textClass} text-[clamp(0.9rem,3vmin,1.1rem)]`}>{session.dice.dice1}</span>
                    </span>
                    <div className={`w-px h-5 ${isSinglePlayer ? 'bg-stone-600' : 'bg-border-color'}`}></div>
                    <span className={`font-bold text-tertiary text-[clamp(0.8rem,2.5vmin,1rem)]`}>
                        남은 돌: <span className={`${textClass} text-[clamp(0.9rem,3vmin,1.1rem)]`}>{session.stonesToPlace}</span>
                    </span>
                </div>
                {isPlayfulTurn && (
                    <div className="w-full h-1 bg-tertiary rounded-full mt-1">
                        <div className="h-1 bg-red-500 rounded-full" style={{ width: `${percentage}%` }} />
                    </div>
                )}
            </>
        );
    }

    if (session.mode === GameMode.Thief && session.gameStatus === 'thief_placing' && session.dice) {
        const { dice1, dice2 } = session.dice;
        const diceDisplay = dice2 > 0 ? `${dice1}, ${dice2}` : `${dice1}`;
        return wrapContent(
            `${baseClasses} ${themeClasses} px-4 gap-2`,
            <>
                <span className={`font-bold text-tertiary text-[clamp(0.8rem,2.5vmin,1rem)]`}>
                    주사위: <span className={`${textClass} text-[clamp(0.9rem,3vmin,1.1rem)]`}>{diceDisplay}</span>
                </span>
                <div className={`w-px h-5 ${isSinglePlayer ? 'bg-stone-600' : 'bg-border-color'}`}></div>
                <span className={`font-bold text-tertiary text-[clamp(0.8rem,2.5vmin,1rem)]`}>
                    남은 착수: <span className={`${textClass} text-[clamp(0.9rem,3vmin,1.1rem)]`}>{session.stonesToPlace}</span>
                </span>
            </>
        );
    }

    if (isItemMode) {
        let itemText = "아이템 사용시간";
        if (session.gameStatus === 'hidden_placing') itemText = "히든 사용시간";
        if (session.gameStatus === 'scanning') itemText = "스캔 사용시간";
        if (session.gameStatus === 'missile_selecting') {
            itemText = "발사할 바둑돌을 선택하세요. 선택후 방향을 선택하면 날아갑니다.";
        }

        const percentage = (timeLeft / 30) * 100;
        
        // 전광판 스타일로 아이템 사용시간 표시
        const tickerText = `${itemText} ${timeLeft}초`;

        return wrapContent(
            `${baseClasses} ${themeClasses} px-4 gap-1.5 min-h-[3rem]`,
            <>
                {/* 전광판 스타일 텍스트 */}
                <div className="w-full overflow-hidden flex-shrink-0 relative h-6">
                    <div 
                        className={`font-bold ${textClass} tracking-wider text-[clamp(0.8rem,2.5vmin,1rem)] whitespace-nowrap absolute inset-0 flex items-center justify-center`}
                        style={{
                            textShadow: '0 0 8px rgba(255, 255, 255, 0.5), 0 0 16px rgba(255, 255, 255, 0.3)'
                        }}
                    >
                        <span className="inline-block">{tickerText}</span>
                    </div>
                </div>
                <div className={`w-full bg-tertiary rounded-full h-[clamp(0.5rem,1.5vh,0.75rem)] relative overflow-hidden border-2 ${isSinglePlayer ? 'border-black/20' : 'border-tertiary'} flex-shrink-0`}>
                    <div className="absolute inset-0 bg-highlight rounded-full" style={{ width: `${percentage}%`, transition: 'width 0.5s linear' }}></div>
                </div>
            </>
        );
    }
    
    const statusText = getGameStatusText(session);

    return wrapContent(
        `${baseClasses} ${themeClasses}`,
        <>
            <p className={`font-bold ${textClass} tracking-wider text-[clamp(0.8rem,2.5vmin,1rem)] text-center px-2`}>{statusText}</p>
            {isPlayfulTurn && (
                <div className="w-11/12 h-1 bg-tertiary rounded-full mt-1">
                    <div className="h-1 bg-red-500 rounded-full" style={{ width: `${percentage}%` }} />
                </div>
            )}
        </>
    );
};

export default TurnDisplay;