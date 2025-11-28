import React, { useState } from 'react';
import { GameProps, Player } from '../../types.js';
import Button from '../Button.js';
import { SINGLE_PLAYER_STAGES } from '../../constants';
import AlertModal from '../AlertModal.js';
import ConfirmModal from '../ConfirmModal.js';

interface SinglePlayerControlsProps extends Pick<GameProps, 'session' | 'onAction' | 'currentUser'> {
    setShowResultModal?: (show: boolean) => void;
}

interface ImageButtonProps {
    src: string;
    alt: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    variant?: 'primary' | 'danger';
    count?: number; // 개수 표시 (옵션)
}

const ImageButton: React.FC<ImageButtonProps> = ({ src, alt, onClick, disabled = false, title, variant = 'primary', count }) => {
    const variantClasses = variant === 'danger'
        ? 'border-red-400 shadow-red-500/40 focus:ring-red-400'
        : 'border-amber-400 shadow-amber-500/30 focus:ring-amber-300';
    
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
            className={`relative w-12 h-12 rounded-lg border-2 transition-transform duration-200 ease-out overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${variantClasses} ${disabled ? 'opacity-40 cursor-not-allowed border-gray-700' : 'hover:scale-105 active:scale-95 shadow-lg'}`}
        >
            <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-contain pointer-events-none p-1" />
            {/* 개수 표시 우측 하단 (옵션) */}
            {count !== undefined && (
                <span className={`absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border border-amber-600 ${disabled ? 'opacity-60' : ''}`}>
                    {count}
                </span>
            )}
        </button>
    );
};

interface ItemImageButtonProps {
    src: string;
    alt: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    count: number; // 아이템 개수
}

const ItemImageButton: React.FC<ItemImageButtonProps> = ({ src, alt, onClick, disabled = false, title, count }) => {
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
            className={`relative w-16 h-16 rounded-lg border-2 border-amber-400 transition-transform duration-200 ease-out overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-gray-900 ${disabled ? 'opacity-40 cursor-not-allowed border-gray-700' : 'hover:scale-105 active:scale-95 shadow-lg'}`}
        >
            <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-contain pointer-events-none p-1.5" />
            {/* 개수 표시 우측 하단 */}
            <span className={`absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border border-amber-600 ${disabled ? 'opacity-60' : ''}`}>
                {count}
            </span>
        </button>
    );
};

const SinglePlayerControls: React.FC<SinglePlayerControlsProps> = ({ session, onAction, currentUser, setShowResultModal }) => {
    const [alertModal, setAlertModal] = useState<{ title?: string; message: string } | null>(null);
    const [confirmModal, setConfirmModal] = useState<{ title?: string; message: string; onConfirm: () => void } | null>(null);
    
    if (session.gameStatus === 'ended' || session.gameStatus === 'no_contest') {
        const isWinner = session.winner === Player.Black;
        const currentStageIndex = SINGLE_PLAYER_STAGES.findIndex(s => s.id === session.stageId);
        const currentStage = SINGLE_PLAYER_STAGES.find(s => s.id === session.stageId);
        const nextStage = SINGLE_PLAYER_STAGES[currentStageIndex + 1];
        const canTryNext = isWinner && nextStage && (currentUser.singlePlayerProgress ?? 0) > currentStageIndex;
        
        const retryActionPointCost = currentStage?.actionPointCost ?? 0;
        const nextStageActionPointCost = nextStage?.actionPointCost ?? 0;

        const handleRetry = async () => {
            try {
                console.log('[SinglePlayerControls] Retry button clicked, starting game for stage:', session.stageId);
                const result = await onAction({ type: 'START_SINGLE_PLAYER_GAME', payload: { stageId: session.stageId! } });
                const gameId = (result as any)?.gameId;
                console.log('[SinglePlayerControls] Retry action completed, gameId:', gameId);
                if (gameId) {
                    // handleAction에서 이미 라우팅이 업데이트되었으므로 짧은 딜레이만
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    // gameId가 없으면 WebSocket 업데이트를 기다림
                    console.log('[SinglePlayerControls] No gameId in response, waiting for WebSocket update...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('[SinglePlayerControls] Failed to retry stage:', error);
                setAlertModal({ message: '재도전에 실패했습니다. 다시 시도해주세요.' });
            }
        };
        const handleNextStage = async () => {
            if (!canTryNext || !nextStage) {
                console.log('[SinglePlayerControls] Cannot start next stage:', { canTryNext, nextStage: !!nextStage });
                return;
            }
            try {
                console.log('[SinglePlayerControls] Next stage button clicked, starting game for stage:', nextStage.id);
                const result = await onAction({ type: 'START_SINGLE_PLAYER_GAME', payload: { stageId: nextStage.id } });
                const gameId = (result as any)?.gameId;
                console.log('[SinglePlayerControls] Next stage action completed, gameId:', gameId);
                if (gameId) {
                    // handleAction에서 이미 라우팅이 업데이트되었으므로 짧은 딜레이만
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    // gameId가 없으면 WebSocket 업데이트를 기다림
                    console.log('[SinglePlayerControls] No gameId in response, waiting for WebSocket update...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('[SinglePlayerControls] Failed to start next stage:', error);
                setAlertModal({ message: '다음 단계 시작에 실패했습니다. 다시 시도해주세요.' });
            }
        };
        const handleExitToLobby = async () => {
            sessionStorage.setItem('postGameRedirect', '#/singleplayer');
            try {
                await onAction({ type: 'LEAVE_AI_GAME', payload: { gameId: session.id } });
            } catch (error) {
                console.error('[SinglePlayerControls] Failed to leave AI game:', error);
            } finally {
                setTimeout(() => {
                    window.location.hash = '#/singleplayer';
                }, 100);
            }
        };

        const handleShowResults = () => {
            if (setShowResultModal) {
                setShowResultModal(true);
            }
        };

        return (
            <footer className="responsive-controls flex-shrink-0 bg-gray-800 rounded-lg p-2 flex flex-col items-stretch justify-center gap-2 w-full h-[148px]">
                <div className="bg-gray-900/70 border border-stone-700 rounded-xl px-4 py-3 flex flex-wrap items-center justify-center gap-3">
                    <Button onClick={handleShowResults} colorScheme="none" className="justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-indigo-400/50 bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-pink-500/90 text-white shadow-[0_12px_32px_-18px_rgba(99,102,241,0.85)] hover:from-indigo-400 hover:to-pink-400 whitespace-nowrap">
                        결과 확인
                    </Button>
                    <Button onClick={handleNextStage} colorScheme="none" className="justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/90 via-sky-500/90 to-blue-500/90 text-white shadow-[0_12px_32px_-18px_rgba(56,189,248,0.85)] hover:from-cyan-300 hover:to-blue-500 whitespace-nowrap" disabled={!canTryNext}>
                        다음 단계{canTryNext && nextStage ? `: ${nextStage.name.replace('스테이지 ', '')}` : ''}{nextStageActionPointCost > 0 && ` (⚡${nextStageActionPointCost})`}
                    </Button>
                    <Button onClick={handleRetry} colorScheme="none" className="justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500/90 via-amber-300/90 to-amber-500/90 text-slate-900 shadow-[0_12px_32px_-18px_rgba(251,191,36,0.85)] hover:from-amber-300 hover:to-amber-500 whitespace-nowrap">
                        재도전 {retryActionPointCost > 0 && `(⚡${retryActionPointCost})`}
                    </Button>
                    <Button onClick={handleExitToLobby} colorScheme="none" className="justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-slate-400/50 bg-gradient-to-r from-slate-800/90 via-slate-900/90 to-black/90 text-slate-100 shadow-[0_12px_32px_-18px_rgba(148,163,184,0.85)] hover:from-slate-700 hover:to-slate-900 whitespace-nowrap">
                        나가기
                    </Button>
                </div>
            </footer>
        );
    }
    
    const refreshesUsed = session.singlePlayerPlacementRefreshesUsed || 0;
    const remainingRefreshes = Math.max(0, 5 - refreshesUsed);
    const canRefresh = session.moveHistory.length === 0 && refreshesUsed < 5;
    const costs = [0, 50, 75, 100, 200]; // 서버와 일치
    const nextCost = costs[refreshesUsed] || 0;
    const canAfford = currentUser.gold >= nextCost;
    const refreshDisabled = !canRefresh || !canAfford;
    
    const handleRefresh = () => {
        if (canRefresh && canAfford) {
            const confirmationMessage = nextCost > 0
                ? `${nextCost.toLocaleString()} 골드를 사용하여 배치를 다시 섞으시겠습니까? (남은 재배치 ${remainingRefreshes}/5)`
                : '첫 재배치는 무료입니다. 배치를 다시 섞으시겠습니까?';
            setConfirmModal({
                message: confirmationMessage,
                onConfirm: () => {
                    onAction({ type: 'SINGLE_PLAYER_REFRESH_PLACEMENT', payload: { gameId: session.id } });
                }
            });
        }
    };

    const handleForfeit = () => {
        setConfirmModal({
            title: '기권 확인',
            message: '경기를 포기하시겠습니까?',
            onConfirm: () => {
                onAction({ type: 'RESIGN_GAME', payload: { gameId: session.id } });
            }
        });
    };

    // 게임 모드별 아이템 로직
    const hiddenCountSetting = session.settings.hiddenStoneCount ?? 0;
    const scanCountSetting = session.settings.scanCount ?? 0;
    const missileCountSetting = session.settings.missileCount ?? 0;
    
    const isHiddenMode = session.isSinglePlayer && hiddenCountSetting > 0;
    const isMissileMode = session.isSinglePlayer && missileCountSetting > 0;
    
    const isMyTurn = session.currentPlayer === Player.Black; // 싱글플레이어에서는 유저가 항상 흑
    const gameStatus = session.gameStatus;
    
    // 히든 아이템 (스캔 아이템처럼 개수 기반)
    const hiddenLeft = session.hidden_stones_p1 ?? hiddenCountSetting;
    const hiddenDisabled = !isMyTurn || gameStatus !== 'playing' || hiddenLeft <= 0;
    
    const handleUseHidden = React.useCallback(() => {
        if (gameStatus !== 'playing') return;
        onAction({ type: 'START_HIDDEN_PLACEMENT', payload: { gameId: session.id } });
    }, [gameStatus, session.id, onAction]);
    
    // 스캔 아이템
    const myScansLeft = session.scans_p1 ?? scanCountSetting;
    // 스캔 가능 여부 확인: 상대방(백)의 히든 스톤이 있고 아직 영구적으로 공개되지 않은 것이 있는지
    // AI 초기 히든 돌도 확인 (미리 배치된 히든 돌)
    const canScan = React.useMemo(() => {
        // AI 초기 히든 돌이 있고 아직 공개되지 않았는지 확인
        const aiInitialHiddenStone = (session as any).aiInitialHiddenStone;
        if (aiInitialHiddenStone) {
            const { x, y } = aiInitialHiddenStone;
            // 돌이 여전히 보드에 있고 영구적으로 공개되지 않았는지 확인
            if (session.boardState[y]?.[x] === Player.White) {
                const isPermanentlyRevealed = session.permanentlyRevealedStones?.some(p => p.x === x && p.y === y);
                if (!isPermanentlyRevealed) {
                    return true; // AI 초기 히든 돌이 있으면 스캔 가능
                }
            }
        }
        
        // 기존 로직: moveHistory의 히든 스톤 확인
        if (!session.hiddenMoves || !session.moveHistory) {
            return false;
        }
        // 상대방(백)의 히든 스톤 중 아직 영구적으로 공개되지 않은 것이 있는지 확인
        return Object.entries(session.hiddenMoves).some(([moveIndexStr, isHidden]) => {
            if (!isHidden) return false;
            const move = session.moveHistory[parseInt(moveIndexStr)];
            if (!move || move.player !== Player.White) return false;
            const { x, y } = move;
            // 돌이 여전히 보드에 있고 영구적으로 공개되지 않았는지 확인
            if (session.boardState[y]?.[x] !== Player.White) return false;
            const isPermanentlyRevealed = session.permanentlyRevealedStones?.some(p => p.x === x && p.y === y);
            return !isPermanentlyRevealed;
        });
    }, [session.hiddenMoves, session.moveHistory, session.boardState, session.permanentlyRevealedStones]);
    
    const scanDisabled = !isMyTurn || gameStatus !== 'playing' || myScansLeft <= 0 || !canScan;
    
    const handleUseScan = React.useCallback(() => {
        if (gameStatus !== 'playing') return;
        onAction({ type: 'START_SCANNING', payload: { gameId: session.id } });
    }, [gameStatus, session.id, onAction]);
    
    // 미사일 아이템
    const myMissilesLeft = session.missiles_p1 ?? missileCountSetting;
    const missileDisabled = !isMyTurn || gameStatus !== 'playing' || myMissilesLeft <= 0;
    
    const handleUseMissile = React.useCallback(() => {
        if (gameStatus !== 'playing') return;
        onAction({ type: 'START_MISSILE_SELECTION', payload: { gameId: session.id } });
    }, [gameStatus, session.id, onAction]);

    return (
        <div className="bg-stone-800/70 backdrop-blur-sm rounded-xl p-3 flex items-stretch justify-between gap-4 w-full h-full border border-stone-700/50">
            {/* Left group: 기권, 배치 새로고침 (대국 기능) - 가운데 정렬 */}
            <div className="flex-1 flex items-center justify-center gap-6">
                <div className="flex flex-col items-center gap-1">
                    <ImageButton
                        src="/images/button/giveup.png"
                        alt="기권"
                        onClick={handleForfeit}
                        title="기권하기"
                        variant="danger"
                    />
                    <span className="text-[11px] font-semibold text-red-300">기권</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                    <ImageButton
                        src="/images/button/reflesh.png"
                        alt="배치 새로고침"
                        onClick={handleRefresh}
                        disabled={refreshDisabled}
                        title={refreshDisabled ? (!canAfford ? '골드가 부족합니다.' : '배치 새로고침 불가') : `배치 새로고침 (비용: ${nextCost}골드, 남은 횟수: ${remainingRefreshes}/5)`}
                        count={remainingRefreshes}
                    />
                    <span className={`text-[11px] font-semibold ${refreshDisabled ? 'text-gray-500' : 'text-amber-100'}`}>
                        배치변경
                    </span>
                    {nextCost > 0 && (
                        <span className={`text-[10px] flex items-center gap-0.5 ${refreshDisabled ? 'text-gray-500' : 'text-yellow-300'}`}>
                            <img src="/images/icon/Gold.png" alt="골드" className="w-3 h-3" />
                            {nextCost.toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            {/* Right group: 히든, 스캔, 미사일 (특수 아이템) - 가운데 정렬 */}
            <div className="flex-1 flex items-center justify-center gap-6">
                {/* 히든 아이템 */}
                {isHiddenMode && (
                    <ItemImageButton
                        src="/images/button/hidden.png"
                        alt="히든"
                        onClick={handleUseHidden}
                        disabled={hiddenDisabled}
                        title="히든 스톤 배치"
                        count={hiddenLeft}
                    />
                )}
                
                {/* 스캔 아이템 */}
                {isHiddenMode && (
                    <ItemImageButton
                        src="/images/button/scan.png"
                        alt="스캔"
                        onClick={handleUseScan}
                        disabled={scanDisabled}
                        title="상대 히든 스톤 탐지"
                        count={myScansLeft}
                    />
                )}
                
                {/* 미사일 아이템 */}
                {isMissileMode && (
                    <ItemImageButton
                        src="/images/button/missile.png"
                        alt="미사일"
                        onClick={handleUseMissile}
                        disabled={missileDisabled}
                        title="미사일 발사"
                        count={myMissilesLeft}
                    />
                )}
            </div>
            
            {alertModal && (
                <AlertModal
                    title={alertModal.title}
                    message={alertModal.message}
                    onClose={() => setAlertModal(null)}
                />
            )}
            
            {confirmModal && (
                <ConfirmModal
                    title={confirmModal.title || '확인'}
                    message={confirmModal.message}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                    confirmText="확인"
                    cancelText="취소"
                    confirmColorScheme="red"
                    isTopmost={true}
                    windowId="singleplayer-confirm-modal"
                />
            )}
        </div>
    );
};

export default SinglePlayerControls;