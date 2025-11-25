import React, { useState, useEffect } from 'react';
import { LiveGameSession, User } from '../types.js';

interface DisconnectionModalProps {
    session: LiveGameSession;
    currentUser: User;
}

const DisconnectionModal: React.FC<DisconnectionModalProps> = ({ session, currentUser }) => {
    const { disconnectionState, player1, player2, disconnectionCounts } = session;
    const [timeLeft, setTimeLeft] = useState(90);

    if (!disconnectionState) return null;

    const disconnectedPlayer = disconnectionState.disconnectedPlayerId === player1.id ? player1 : player2;
    const isDisconnectedMe = disconnectedPlayer.id === currentUser.id;
    const count = disconnectionCounts?.[disconnectedPlayer.id] || 1;

    useEffect(() => {
        const updateTimer = () => {
            const elapsed = (Date.now() - disconnectionState.timerStartedAt) / 1000;
            const remaining = Math.max(0, 90 - Math.floor(elapsed));
            setTimeLeft(remaining);
        };

        const timerId = setInterval(updateTimer, 100);
        updateTimer(); // Initial call

        return () => clearInterval(timerId);
    }, [disconnectionState.timerStartedAt]);
    
    // 원형 프로그레스 계산
    const totalTime = 90;
    const progress = ((totalTime - timeLeft) / totalTime) * 100;
    const circumference = 2 * Math.PI * 45; // 반지름 45
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-8 border border-gray-700 text-center">
                <h2 className="text-2xl font-bold text-yellow-400 mb-4">플레이어 접속 끊김 ({count}/3회)</h2>
                <div className="flex justify-center items-center my-6">
                    <div className="relative w-32 h-32">
                        {/* 원형 프로그레스 바 */}
                        <svg className="transform -rotate-90 w-32 h-32">
                            {/* 배경 원 */}
                            <circle
                                cx="64"
                                cy="64"
                                r="45"
                                stroke="rgba(107, 114, 128, 0.3)"
                                strokeWidth="8"
                                fill="none"
                            />
                            {/* 프로그레스 원 */}
                            <circle
                                cx="64"
                                cy="64"
                                r="45"
                                stroke={timeLeft > 30 ? "#fbbf24" : timeLeft > 10 ? "#f59e0b" : "#ef4444"}
                                strokeWidth="8"
                                fill="none"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                strokeLinecap="round"
                                className="transition-all duration-100 ease-linear"
                            />
                        </svg>
                        {/* 중앙 타이머 텍스트 */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <p className="text-3xl font-mono font-bold text-white">{timeLeft}</p>
                                <p className="text-xs text-gray-400 mt-1">초</p>
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-lg text-white mb-2">
                    <span className="font-bold">{disconnectedPlayer.nickname}</span> 님의 연결이 끊겼습니다.
                </p>
                <p className="text-gray-300">재접속을 기다리는 중입니다...</p>
                {isDisconnectedMe && (
                    <p className="text-sm text-red-400 bg-red-900/50 p-2 rounded-md mt-4">페이지를 새로고침하여 재접속하세요.</p>
                )}
            </div>
        </div>
    );
};

export default DisconnectionModal;