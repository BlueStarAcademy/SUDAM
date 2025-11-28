import React from 'react';
import { GameProps, Player } from '../../types.js';
import Button from '../Button.js';
import { TOWER_STAGES } from '../../constants/towerConstants.js';

interface TowerControlsProps extends Pick<GameProps, 'session' | 'onAction' | 'currentUser'> {
    showResultModal?: boolean;
    setShowResultModal?: (show: boolean) => void;
}

interface ImageButtonProps {
    src: string;
    alt: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    count?: number;
    maxCount?: number;
}

const ImageButton: React.FC<ImageButtonProps> = ({ src, alt, onClick, disabled = false, title, count, maxCount }) => {
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
			className={`relative w-16 h-16 md:w-20 md:h-20 rounded-xl border-2 border-amber-400 transition-transform duration-200 ease-out overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-gray-900 ${disabled ? 'opacity-40 cursor-not-allowed border-gray-700' : 'hover:scale-105 active:scale-95 shadow-lg'}`}
        >
			<img src={src} alt={alt} className="absolute inset-0 w-full h-full object-contain pointer-events-none p-1.5" />
            {count !== undefined && (
				<div className={`absolute -bottom-0.5 -right-0.5 text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-purple-900 ${
                    count > 0 ? 'bg-yellow-400 text-gray-900' : 'bg-gray-600 text-gray-300'
                }`}>
                    {count}
                </div>
            )}
        </button>
    );
};

const TowerControls: React.FC<TowerControlsProps> = ({ session, onAction, currentUser, showResultModal, setShowResultModal }) => {
    const floor = session.towerFloor ?? 1;
    const stage = TOWER_STAGES.find(s => {
        const stageFloor = parseInt(s.id.replace('tower-', ''));
        return stageFloor === floor;
    });

    
    if (session.gameStatus === 'ended' || session.gameStatus === 'no_contest') {
        const isWinner = session.winner === Player.Black;
        const nextFloor = floor < 100 ? floor + 1 : null;
        const userTowerFloor = (currentUser as any).towerFloor ?? 0;
        const canTryNext = isWinner && nextFloor !== null && userTowerFloor >= floor;
        
        const retryActionPointCost = stage?.actionPointCost ?? 0;
        const nextFloorActionPointCost = nextFloor ? TOWER_STAGES.find(s => {
            const stageFloor = parseInt(s.id.replace('tower-', ''));
            return stageFloor === nextFloor;
        })?.actionPointCost ?? 0 : 0;

        const handleShowResults = () => {
            if (setShowResultModal) {
                setShowResultModal(true);
            }
        };

        const handleRetry = async () => {
            try {
                const result = await onAction({ type: 'START_TOWER_GAME', payload: { floor } });
                const gameId = (result as any)?.gameId;
                if (gameId) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('[TowerControls] Failed to retry floor:', error);
                window.alert('재도전에 실패했습니다. 다시 시도해주세요.');
            }
        };
        
        const handleNextFloor = async () => {
            if (!canTryNext || !nextFloor) return;
            try {
                const result = await onAction({ type: 'START_TOWER_GAME', payload: { floor: nextFloor } });
                const gameId = (result as any)?.gameId;
                if (gameId) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('[TowerControls] Failed to start next floor:', error);
                window.alert('다음 층 시작에 실패했습니다. 다시 시도해주세요.');
            }
        };
        
        const handleExitToLobby = async () => {
            // 도전의 탑에서는 서버 액션을 시도하되, 성공/실패와 관계없이 로비로 이동
            sessionStorage.setItem('postGameRedirect', '#/tower');
            try {
                await onAction({ type: 'LEAVE_AI_GAME', payload: { gameId: session.id } });
            } catch (error) {
                // 에러가 발생해도 로비로 이동 (도전의 탑 게임이 이미 종료되었거나 없는 경우 등)
                console.log('[TowerControls] LEAVE_AI_GAME failed, moving to lobby anyway:', error);
            }
            // 서버 응답을 기다리지 않고 바로 이동
            window.location.hash = '#/tower';
        };

        return (
            <footer className="responsive-controls flex-shrink-0 bg-gray-800 rounded-lg p-2 flex flex-col items-stretch justify-center gap-2 w-full min-h-[148px]">
                <div className="bg-gray-900/70 border border-stone-700 rounded-xl px-4 py-3 flex flex-wrap items-center justify-center gap-3">
                    <Button onClick={handleShowResults} colorScheme="none" className={`justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-indigo-400/50 bg-gradient-to-r from-indigo-500/90 via-purple-500/90 to-pink-500/90 text-white shadow-[0_12px_32px_-18px_rgba(99,102,241,0.85)] hover:from-indigo-400 hover:to-pink-400 whitespace-nowrap`}>
                        결과 보기
                    </Button>
                    <Button onClick={handleRetry} colorScheme="none" className={`justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500/90 via-amber-300/90 to-amber-500/90 text-slate-900 shadow-[0_12px_32px_-18px_rgba(251,191,36,0.85)] hover:from-amber-300 hover:to-amber-500 whitespace-nowrap`}>
                        재도전 {retryActionPointCost > 0 && `(⚡${retryActionPointCost})`}
                    </Button>
                    <Button onClick={handleNextFloor} colorScheme="none" className={`justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/90 via-sky-500/90 to-blue-500/90 text-white shadow-[0_12px_32px_-18px_rgba(56,189,248,0.85)] hover:from-cyan-300 hover:to-blue-500 whitespace-nowrap`} disabled={!canTryNext}>
                        다음 층{canTryNext && nextFloor ? `: ${nextFloor}층` : ''}{nextFloorActionPointCost > 0 && ` (⚡${nextFloorActionPointCost})`}
                    </Button>
                    <Button onClick={handleExitToLobby} colorScheme="none" className={`justify-center !py-1.5 !px-4 !text-sm rounded-xl border border-slate-400/50 bg-gradient-to-r from-slate-800/90 via-slate-900/90 to-black/90 text-slate-100 shadow-[0_12px_32px_-18px_rgba(148,163,184,0.85)] hover:from-slate-700 hover:to-slate-900 whitespace-nowrap`}>
                        나가기
                    </Button>
                </div>
            </footer>
        );
    }
    
    const handleRefresh = () => {
        onAction({ type: 'TOWER_REFRESH_PLACEMENT', payload: { gameId: session.id } });
    };

    const handleForfeit = () => {
        if (window.confirm('경기를 포기하시겠습니까?')) {
            window.location.hash = '#/tower';
        }
    };

    // 도전의 탑 아이템: 인벤토리에서 개수 가져오기
    const inventory = currentUser?.inventory || [];
    const getItemCount = (itemName: string): number => {
        const item = inventory.find((inv: any) => inv.name === itemName || inv.id === itemName);
        return item?.quantity ?? 0;
    };

    const isMyTurn = session.currentPlayer === Player.Black;
    const gameStatus = session.gameStatus;
    const showMissileAndHidden = floor >= 21;
    const showTurnAdd = floor <= 20; // 1~20층에서만 턴 추가 아이템 표시

    // 턴 추가 아이템 (1~20층, 제한 없음) - 로비 인벤토리와 동기화
    const turnAddCount = showTurnAdd ? getItemCount('턴 추가') || getItemCount('턴증가') || getItemCount('turn_add') || getItemCount('turn_add_item') : 0;
    const turnAddDisabled = gameStatus !== 'playing' || turnAddCount <= 0;
    
    const handleUseTurnAdd = () => {
        if (gameStatus !== 'playing' || turnAddCount <= 0) return;
        if (window.confirm('턴 추가 아이템을 사용하여 남은 턴을 3턴 추가하시겠습니까?')) {
            onAction({ type: 'TOWER_ADD_TURNS', payload: { gameId: session.id } });
        }
    };

    // 미사일 아이템 (21층 이상, 최대 2개) - 로비 인벤토리와 동기화
    const missileCount = showMissileAndHidden ? getItemCount('미사일') || getItemCount('missile') : 0;
    const missileMaxCount = 2;
    const myMissilesLeft = session.missiles_p1 ?? missileCount;
    const missileDisabled = !isMyTurn || gameStatus !== 'playing' || myMissilesLeft <= 0;
    
    const handleUseMissile = () => {
        if (gameStatus !== 'playing') return;
        onAction({ type: 'START_MISSILE_SELECTION', payload: { gameId: session.id } });
    };
    
    // 히든 아이템 (21층 이상, 최대 2개) - 로비 인벤토리와 동기화
    const hiddenCount = showMissileAndHidden ? getItemCount('히든') || getItemCount('hidden') : 0;
    const hiddenMaxCount = 2;
    // 히든 아이템 (스캔 아이템처럼 개수 기반)
    const hiddenLeft = session.hidden_stones_p1 ?? hiddenCount;
    const hiddenDisabled = !isMyTurn || gameStatus !== 'playing' || hiddenLeft <= 0;
    
    const handleUseHidden = () => {
        if (gameStatus !== 'playing') return;
        onAction({ type: 'START_HIDDEN_PLACEMENT', payload: { gameId: session.id } });
    };
    
    // 배치변경 아이템 (모든 층, 최대 5개) - 비용/제한 없이 보유 개수만 체크
    // 첫 수를 두기 전에만 사용 가능
    const refreshCount = getItemCount('배치 새로고침') || getItemCount('배치변경') || getItemCount('reflesh') || getItemCount('refresh');
    const refreshMaxCount = 5;
    const canUseRefresh = session.moveHistory && session.moveHistory.length === 0 && session.gameStatus === 'playing' && session.currentPlayer === Player.Black;
    const refreshDisabled = refreshCount <= 0 || !canUseRefresh;

	return (
		<footer className="responsive-controls flex-shrink-0 bg-stone-800/70 backdrop-blur-sm rounded-xl p-3 flex items-stretch justify-between gap-4 w-full min-h-[148px] border border-stone-700/50">
			{/* Left group: 기권, 배치변경 (가운데 정렬) */}
			<div className="flex-1 flex items-center justify-center gap-6">
                <div className="flex flex-col items-center gap-1">
                    <ImageButton
                        src="/images/button/giveup.png"
                        alt="기권"
                        onClick={handleForfeit}
                        title="기권하기"
                    />
					<span className="text-[11px] font-semibold text-red-300">기권</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                    <ImageButton
                        src="/images/button/reflesh.png"
                        alt="배치변경"
                        onClick={handleRefresh}
                        disabled={refreshDisabled}
                        title="배치 새로고침"
                        count={refreshCount}
                        maxCount={refreshMaxCount}
                    />
					<span className={`text-[11px] font-semibold ${refreshDisabled ? 'text-gray-500' : 'text-amber-100'}`}>
                        배치변경
                    </span>
                </div>
            </div>

			{/* Right group: 턴 추가 (1~20층) 또는 미사일, 히든 (21층 이상) (가운데 정렬) */}
			<div className="flex-1 flex items-center justify-center gap-6">
                {showTurnAdd && (
                    <div className="flex flex-col items-center gap-1">
                        <ImageButton
                            src="/images/button/addturn.png"
                            alt="턴 추가"
                            onClick={handleUseTurnAdd}
                            disabled={turnAddDisabled}
                            title="남은 턴 3턴 추가"
                            count={turnAddCount}
                        />
						<span className={`text-[11px] font-semibold ${turnAddDisabled ? 'text-gray-500' : 'text-amber-100'}`}>
                            턴 추가
                        </span>
                    </div>
                )}
                {showMissileAndHidden && (
                    <div className="flex flex-col items-center gap-1">
                        <ImageButton
                            src="/images/button/missile.png"
                            alt="미사일"
                            onClick={handleUseMissile}
                            disabled={missileDisabled}
                            title="미사일 발사"
                            count={myMissilesLeft}
                            maxCount={missileMaxCount}
                        />
						<span className={`text-[11px] font-semibold ${missileDisabled ? 'text-gray-500' : 'text-amber-100'}`}>
                            미사일
                        </span>
                    </div>
                )}
                {showMissileAndHidden && (
                    <div className="flex flex-col items-center gap-1">
                        <ImageButton
                            src="/images/button/hidden.png"
                            alt="히든"
                            onClick={handleUseHidden}
                            disabled={hiddenDisabled}
                            title="히든 스톤 배치"
                            count={hiddenLeft}
                            maxCount={hiddenMaxCount}
                        />
						<span className={`text-[11px] font-semibold ${hiddenDisabled ? 'text-gray-500' : 'text-amber-100'}`}>
                            히든
                        </span>
                    </div>
                )}
            </div>
        </footer>
    );
};

export default TowerControls;

