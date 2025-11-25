import React, { useMemo } from 'react';
import { GameProps, Player, Point, GameStatus, Move, GameMode } from '../../types.js';
import GoBoard from '../GoBoard.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../../constants/gameModes';

interface GoGameArenaProps extends GameProps {
    isMyTurn: boolean;
    myPlayerEnum: Player;
    handleBoardClick: (x: number, y: number) => void;
    isItemModeActive: boolean;
    showTerritoryOverlay: boolean;
    isMobile: boolean;
    myRevealedMoves: number[];
    showLastMoveMarker: boolean;
}

const GoGameArena: React.FC<GoGameArenaProps> = (props) => {
    const {
        session,
        onAction,
        myPlayerEnum,
        handleBoardClick,
        isItemModeActive,
        showTerritoryOverlay,
        isMyTurn,
        isMobile,
        myRevealedMoves,
        showLastMoveMarker,
    } = props;
    
    const { blackPlayerId, whitePlayerId, player1, player2, settings, lastMove, gameStatus, mode } = session;

    const players = [player1, player2];
    const blackPlayer = players.find(p => p.id === blackPlayerId) || null;
    const whitePlayer = players.find(p => p.id === whitePlayerId) || null;

    const myRevealedStones = useMemo(() => {
        return (myRevealedMoves || [])
            .map(index => session.moveHistory?.[index])
            .filter((move): move is Move => !!move)
            .map(move => ({ x: move.x, y: move.y }));
    }, [myRevealedMoves, session.moveHistory]);

    const allRevealedStones = useMemo(() => {
        if (!session.moveHistory || !session.revealedHiddenMoves) {
            return {};
        }
        const result: { [playerId: string]: Point[] } = {};
        for (const playerId in session.revealedHiddenMoves) {
            result[playerId] = session.revealedHiddenMoves[playerId]
                .map(index => session.moveHistory?.[index])
                .filter((move): move is Move => !!move)
                .map(move => ({ x: move.x, y: move.y }));
        }
        return result;
    }, [session.revealedHiddenMoves, session.moveHistory]);

    const backgroundClass = useMemo(() => {
        if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
            return 'bg-strategic-background';
        }
        if (PLAYFUL_GAME_MODES.some(m => m.mode === mode)) {
            return 'bg-playful-background';
        }
        return 'bg-primary';
    }, [mode]);

    return (
        <div className={`w-full h-full flex items-center justify-center ${backgroundClass}`}>
            <GoBoard
                boardState={session.boardState}
                boardSize={settings.boardSize}
                onBoardClick={handleBoardClick}
                onMissileLaunch={(from: Point, direction: 'up' | 'down' | 'left' | 'right') => {
                    // 클라이언트의 boardState를 서버로 전송하여 정확한 검증 가능하도록 함
                    onAction({ 
                        type: 'LAUNCH_MISSILE', 
                        payload: { 
                            gameId: session.id, 
                            from, 
                            direction,
                            boardState: session.boardState, // 클라이언트의 현재 boardState 전송
                            moveHistory: session.moveHistory || [] // 클라이언트의 moveHistory 전송
                        } 
                    });
                }}
                onAction={onAction}
                gameId={session.id}
                lastMove={lastMove}
                lastTurnStones={session.lastTurnStones}
                isBoardDisabled={props.isSpectator || (!isMyTurn && gameStatus !== 'base_placement')}
                stoneColor={myPlayerEnum}
                winningLine={session.winningLine}
                mode={session.mode}
                mixedModes={session.settings.mixedModes}
                hiddenMoves={session.hiddenMoves}
                moveHistory={session.moveHistory}
                baseStones={session.baseStones}
                myPlayerEnum={myPlayerEnum}
                gameStatus={gameStatus}
                currentPlayer={session.currentPlayer}
                highlightedPoints={[]}
                myRevealedStones={myRevealedStones}
                allRevealedStones={allRevealedStones}
                newlyRevealed={session.newlyRevealed}
                justCaptured={session.justCaptured}
                permanentlyRevealedStones={session.permanentlyRevealedStones}
                isSpectator={props.isSpectator}
                analysisResult={session.analysisResult?.[props.currentUser.id] ?? ((gameStatus === 'ended' || (gameStatus === 'scoring' && session.analysisResult?.['system'])) ? session.analysisResult?.['system'] : null)}
                showTerritoryOverlay={showTerritoryOverlay}
                showHintOverlay={false}
                showLastMoveMarker={showLastMoveMarker}
                baseStones_p1={gameStatus === 'base_placement' ? session.baseStones_p1 : undefined}
                baseStones_p2={gameStatus === 'base_placement' ? session.baseStones_p2 : undefined}
                currentUser={props.currentUser}
                blackPlayerNickname={blackPlayer?.nickname || '흑'}
                whitePlayerNickname={whitePlayer?.nickname || '백'}
                isItemModeActive={isItemModeActive}
                animation={session.animation}
                isMobile={isMobile}
            />
        </div>
    );
}

export default GoGameArena;
