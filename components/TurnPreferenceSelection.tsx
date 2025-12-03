
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveGameSession, User, ServerAction } from '../types.js';
import Button from './Button.js';
import DraggableWindow from './DraggableWindow.js';

interface TurnPreferenceSelectionProps {
    session: LiveGameSession;
    currentUser: User;
    onAction: (action: ServerAction) => void;
    tiebreaker?: 'rps' | 'nigiri' | 'dice_roll';
}

const TurnPreferenceSelection: React.FC<TurnPreferenceSelectionProps> = (props) => {
    const { session, currentUser } = props;
    const { player1, player2, turnChoices, turnChoiceDeadline } = session;
    const [localChoice, setLocalChoice] = useState<'first' | 'second' | null>(null);
    const [countdown, setCountdown] = useState(30);

    const latestProps = useRef(props);
    useEffect(() => {
        latestProps.current = props;
    });

    const myId = currentUser.id;
    const opponent = myId === player1.id ? player2 : player1;

    const myTurnChoice = turnChoices?.[myId];

    const handleChoice = useCallback((choice: 'first' | 'second') => {
        const { session: currentSession, onAction: currentOnAction, currentUser: user } = latestProps.current;
        const myCurrentTurnChoice = currentSession.turnChoices?.[user.id];

        if (myCurrentTurnChoice) return;
        setLocalChoice(choice);
        currentOnAction({ type: 'CHOOSE_TURN_PREFERENCE', payload: { gameId: currentSession.id, choice } });
    }, []);

    useEffect(() => {
        // 양쪽 선택이 완료되면 타이머 불필요 (서버에서 즉시 다음 단계로 전환)
        if (myTurnChoice || localChoice || !turnChoiceDeadline) {
            setCountdown(30);
            return;
        }

        const timerId = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((turnChoiceDeadline - Date.now()) / 1000));
            setCountdown(remaining);
            // 0초가 되면 서버에서 자동으로 랜덤 선택 처리 (클라이언트에서 추가 통신 불필요)
            if (remaining <= 0) {
                clearInterval(timerId);
            }
        }, 1000);

        return () => clearInterval(timerId);
    }, [myTurnChoice, localChoice, turnChoiceDeadline]);


    const renderContent = () => {
        if (myTurnChoice || localChoice) {
            return (
                <div className="text-center">
                    <h2 className="text-2xl font-bold mb-4">선택 완료!</h2>
                    <p className="text-gray-300 mb-6 animate-pulse">{opponent.nickname}님의 선택을 기다리고 있습니다...</p>
                    <div className="flex justify-center items-center h-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-100"></div>
                    </div>
                </div>
            );
        }

        return (
            <div className="text-center">
                <p className="text-gray-300 mb-6">원하는 순서를 선택하세요. 순서가 겹치면 미니게임으로 결정됩니다.</p>
                 <div className="my-4 text-center">
                    <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2 overflow-hidden">
                        <div className="bg-yellow-400 h-2.5 rounded-full" style={{ width: `${(countdown / 30) * 100}%`, transition: 'width 1s linear' }}></div>
                    </div>
                    <div className="text-5xl font-mono text-yellow-300">{countdown}</div>
                </div>
                <div className="flex gap-4 mt-4">
                    <Button
                        onClick={() => handleChoice('first')}
                        colorScheme="blue"
                        className="w-full py-4 text-lg"
                    >
                        선공 (흑)
                    </Button>
                    <Button
                        onClick={() => handleChoice('second')}
                        colorScheme="gray"
                        className="w-full py-4 text-lg"
                    >
                        후공 (백)
                    </Button>
                </div>
            </div>
        );
    };

    return (
        <DraggableWindow title="순서 선택" windowId="turn-preference-selection">
            {renderContent()}
        </DraggableWindow>
    );
};

export default TurnPreferenceSelection;