import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveGameSession, User, ServerAction } from '../types.js';
import Button from './Button.js';
import DraggableWindow from './DraggableWindow.js';
import Avatar from './Avatar.js';
import Dice from './Dice.js';
import { AVATAR_POOL, BORDER_POOL, DICE_GO_TURN_ROLL_TIME, DICE_GO_TURN_CHOICE_TIME } from '../constants';

interface DiceGoTurnSelectionModalProps {
    session: LiveGameSession;
    currentUser: User;
    onAction: (action: ServerAction) => void;
}

const DiceGoTurnSelectionModal: React.FC<DiceGoTurnSelectionModalProps> = (props) => {
    const { session, currentUser, onAction } = props;
    const { id: gameId, player1, player2, gameStatus, turnOrderRollReady, animation } = session;
    
    const [countdown, setCountdown] = useState(DICE_GO_TURN_ROLL_TIME);

    const opponent = currentUser.id === player1.id ? player2 : player1;
    
    useEffect(() => {
        let timerId: number | undefined;
        const deadline = gameStatus === 'dice_turn_rolling' 
            ? session.turnOrderRollDeadline 
            : gameStatus === 'dice_turn_choice' 
                ? session.turnChoiceDeadline 
                : null;

        if (deadline) {
            const update = () => {
                const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
                setCountdown(remaining);
                // 0초가 되면 서버에서 자동으로 처리 (클라이언트에서 추가 통신 불필요)
                if (remaining <= 0) {
                    if (timerId) clearInterval(timerId);
                }
            };
            update();
            timerId = window.setInterval(update, 1000);
        } else {
            // deadline이 없으면 기본값으로 리셋
            setCountdown(gameStatus === 'dice_turn_rolling' ? DICE_GO_TURN_ROLL_TIME : DICE_GO_TURN_CHOICE_TIME);
        }
        
        return () => {
            if (timerId) clearInterval(timerId);
        };
    }, [gameStatus, session.turnOrderRollDeadline, session.turnChoiceDeadline]);

    const myReady = turnOrderRollReady?.[currentUser.id];
    
    const turnRollAnim = animation?.type === 'dice_roll_turn' ? animation : null;
    const isRolling = gameStatus === 'dice_turn_rolling_animating';
    const rollsExist = !!(session.turnOrderRolls && session.turnOrderRolls[currentUser.id] != null);
    const isResultVisible = (gameStatus === 'dice_turn_choice') || (!!turnRollAnim && !isRolling);

    const myRoll = turnRollAnim ? (currentUser.id === player1.id ? turnRollAnim.p1Roll : turnRollAnim.p2Roll) : session.turnOrderRolls?.[currentUser.id];
    const opponentRoll = turnRollAnim ? (opponent.id === player1.id ? turnRollAnim.p1Roll : turnRollAnim.p2Roll) : session.turnOrderRolls?.[opponent.id];
    
    let resultMessage = '';
    let resultColor = '';
    if (isResultVisible && myRoll != null && opponentRoll != null) {
        if (myRoll > opponentRoll) {
            resultMessage = '승리!';
            resultColor = 'text-green-400';
        } else if (myRoll < opponentRoll) {
            resultMessage = '패배!';
            resultColor = 'text-red-400';
        } else {
            resultMessage = '동점!';
            resultColor = 'text-yellow-400';
        }
    }
    
    const myAvatarUrl = AVATAR_POOL.find(a => a.id === currentUser.avatarId)?.url;
    const myBorderUrl = BORDER_POOL.find(b => b.id === currentUser.borderId)?.url;
    const opponentAvatarUrl = AVATAR_POOL.find(a => a.id === opponent.avatarId)?.url;
    const opponentBorderUrl = BORDER_POOL.find(b => b.id === opponent.borderId)?.url;
    
    return (
        <DraggableWindow title="선공/후공 결정" windowId="dice-go-turn-selection">
            <div className="text-center">
                <p className="text-gray-300 mb-6">준비 버튼을 눌러 주사위를 굴립니다. 높은 숫자가 나온 사람이 선공/후공을 선택합니다.</p>
                {session.turnOrderRollResult === 'tie' && <p className="text-yellow-400 font-bold text-lg mb-4 animate-pulse">동점! 잠시 후 다시 굴립니다.</p>}
                
                <div className="flex justify-around w-full items-center my-4">
                    <div className="flex flex-col items-center gap-2 w-24">
                        <Avatar userId={currentUser.id} userName={currentUser.nickname} size={64} avatarUrl={myAvatarUrl} borderUrl={myBorderUrl} />
                        <span className="font-semibold">{currentUser.nickname}</span>
                        {(myReady || turnRollAnim || rollsExist) && (
                            <Dice value={isResultVisible ? myRoll ?? null : null} isRolling={isRolling} sides={6} size={64} />
                        )}
                    </div>
                    
                    {isResultVisible && myRoll != null && opponentRoll != null ? (
                        <div className="text-4xl font-bold">{myRoll} : {opponentRoll}</div>
                    ) : (
                        <span className="text-3xl font-bold">VS</span>
                    )}

                     <div className="flex flex-col items-center gap-2 w-24">
                        <Avatar userId={opponent.id} userName={opponent.nickname} size={64} avatarUrl={opponentAvatarUrl} borderUrl={opponentBorderUrl} />
                        <span className="font-semibold">{opponent.nickname}</span>
                        {(turnOrderRollReady?.[opponent.id] || turnRollAnim || rollsExist) && (
                           <Dice value={isResultVisible ? opponentRoll ?? null : null} isRolling={isRolling} sides={6} size={64} />
                        )}
                    </div>
                </div>

                <div className="min-h-[6rem] mt-6 text-xl font-bold flex items-center justify-center">
                    {gameStatus === 'dice_turn_choice' ? (
                        session.turnChooserId === currentUser.id ? (
                            <div className="flex flex-col items-center gap-2">
                                <p className="text-base font-normal text-gray-300 mb-2">선공 또는 후공을 선택하세요. ({countdown})</p>
                                <div className="flex gap-4">
                                    <Button onClick={() => onAction({ type: 'DICE_CHOOSE_TURN', payload: { gameId, choice: 'first' } })} colorScheme="blue">선공 (흑)</Button>
                                    <Button onClick={() => onAction({ type: 'DICE_CHOOSE_TURN', payload: { gameId, choice: 'second' } })} colorScheme="gray">후공 (백)</Button>
                                </div>
                            </div>
                        ) : (
                            <p className="text-base text-green-400 animate-pulse">상대방이 선/후공을 선택하고 있습니다...</p>
                        )
                    ) : isResultVisible && resultMessage ? (
                        <p className={resultColor}>{resultMessage}</p>
                    ) : (
                        !myReady && !turnRollAnim ? (
                             <Button onClick={() => onAction({ type: 'DICE_READY_FOR_TURN_ROLL', payload: { gameId } })} colorScheme="blue">준비 ({countdown})</Button>
                        ) : myReady && !turnRollAnim ? (
                             <p className="text-base text-green-400 animate-pulse">상대방 대기 중...</p>
                        ) : isRolling ? (
                             <p className="text-base text-gray-400 animate-pulse">주사위를 굴립니다...</p>
                        ) : null
                    )}
                </div>
            </div>
        </DraggableWindow>
    );
};

export default DiceGoTurnSelectionModal;