import React, { useMemo, useEffect, useRef, useState } from 'react';
import { LiveGameSession, User, Player, WinReason, StatChange, AnalysisResult, GameMode, GameSummary, InventoryItem, AvatarInfo, BorderInfo, AlkkagiStone, ServerAction } from '../types.js';
import Avatar from './Avatar.js';
import { audioService } from '../services/audioService.js';
import Button from './Button.js';
import DraggableWindow from './DraggableWindow.js';
import { PLAYFUL_GAME_MODES, AVATAR_POOL, BORDER_POOL, CONSUMABLE_ITEMS, SPECIAL_GAME_MODES } from '../constants';
import { TOWER_STAGES } from '../constants/towerConstants.js';
import { SINGLE_PLAYER_STAGES } from '../constants/singlePlayerConstants.js';
import { getMannerRank as getMannerRankShared } from '../services/manner.js';

interface GameSummaryModalProps {
    session: LiveGameSession;
    currentUser: User;
    onConfirm: () => void;
    onAction?: (action: ServerAction) => void;
}

const getIsWinner = (session: LiveGameSession, currentUser: User): boolean | null => {
    const { winner, blackPlayerId, whitePlayerId, player1, player2 } = session;
    if (winner === null || winner === Player.None) return null;
    const isPlayer = currentUser.id === player1.id || currentUser.id === player2.id;
    if (!isPlayer) return null; // Spectators don't have a win/loss status

    return (winner === Player.Black && currentUser.id === blackPlayerId) || 
           (winner === Player.White && currentUser.id === whitePlayerId);
};

const getMannerRank = (score: number) => {
    return getMannerRankShared(score).rank;
};


const XpBar: React.FC<{ initial: number; final: number; max: number; levelUp: boolean; xpGain: number; finalLevel: number; isMobile?: boolean; mobileTextScale?: number }> = ({ initial, final, max, levelUp, xpGain, finalLevel, isMobile = false, mobileTextScale = 1 }) => {
    // Width of the yellow bar, animates from initial to final
    const [barWidth, setBarWidth] = useState(0); 
    // Opacity of the green "flash" element
    const [gainFlashOpacity, setGainFlashOpacity] = useState(0); 
    const [showGainText, setShowGainText] = useState(false);

    const initialPercent = max > 0 ? (initial / max) * 100 : 0;
    const finalPercent = max > 0 ? (levelUp ? 100 : (final / max) * 100) : 0;
    const gainPercent = finalPercent - initialPercent;

    useEffect(() => {
        // Set initial state without animation
        setBarWidth(initialPercent);
        setGainFlashOpacity(0);
        setShowGainText(false);

        // Start animation after a short delay
        const startTimer = setTimeout(() => {
            setShowGainText(true);
            setGainFlashOpacity(1); // Show the green flash
            setBarWidth(finalPercent); // Start the yellow bar animation

            // After the yellow bar animation starts, fade out the green flash
            const fadeTimer = setTimeout(() => {
                setGainFlashOpacity(0);
            }, 500);

            return () => clearTimeout(fadeTimer);
        }, 500);

        return () => clearTimeout(startTimer);
    }, [initial, final, max, levelUp, initialPercent, finalPercent]);
    
    const gainTextKey = `${xpGain}-${initial}`;

    return (
        <div className={`flex items-center ${isMobile ? 'gap-1.5' : 'gap-3'}`}>
             <span className={`${isMobile ? 'text-xs w-12' : 'text-sm w-16'} font-bold text-right`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>Lv.{finalLevel}</span>
            <div className={`w-full bg-gray-700/50 rounded-full ${isMobile ? 'h-3' : 'h-4'} relative border border-gray-900/50 overflow-hidden`}>
                <div 
                    className="h-full bg-gradient-to-r from-yellow-400 to-yellow-500 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${barWidth}%` }}
                ></div>
                
                <div 
                    className="absolute top-0 h-full bg-gradient-to-r from-green-400 to-green-500 rounded-r-full transition-opacity duration-500 ease-out pointer-events-none"
                    style={{ 
                        left: `${initialPercent}%`, 
                        width: `${gainPercent}%`,
                        opacity: gainFlashOpacity
                    }}
                ></div>

                <span className={`absolute inset-0 flex items-center justify-center ${isMobile ? 'text-[9px]' : 'text-xs'} font-bold text-black/80 drop-shadow-sm`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>
                   {initial} +{xpGain} / {max} XP
                </span>

                {levelUp && (
                    <span className={`absolute inset-0 flex items-center justify-center ${isMobile ? 'text-[9px]' : 'text-xs'} font-bold text-white animate-pulse`} style={{textShadow: '0 0 5px black', fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined}}>
                        LEVEL UP!
                    </span>
                )}
            </div>
             {showGainText && xpGain > 0 && (
                <span key={gainTextKey} className={`${isMobile ? 'text-xs w-14' : 'text-sm w-20'} font-bold text-green-400 whitespace-nowrap animate-fade-in-xp`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>
                    +{xpGain} XP
                </span>
             )}
             <style>{`
                @keyframes fadeInXp {
                    from { opacity: 0; transform: scale(0.8); }
                    to { opacity: 1; transform: scale(1); }
                }
                .animate-fade-in-xp {
                    animation: fadeInXp 0.5s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

const ScoreDetailsComponent: React.FC<{ analysis: AnalysisResult, session: LiveGameSession, isMobile?: boolean, mobileTextScale?: number }> = ({ analysis, session, isMobile = false, mobileTextScale = 1 }) => {
    const { scoreDetails } = analysis;
    const { mode, settings } = session;

    if (!scoreDetails) return <p className={`text-center text-gray-400 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>점수 정보가 없습니다.</p>;
    
    const isSpeedMode = mode === GameMode.Speed || (mode === GameMode.Mix && settings.mixedModes?.includes(GameMode.Speed));
    const isBaseMode = mode === GameMode.Base || (mode === GameMode.Mix && settings.mixedModes?.includes(GameMode.Base));
    const isHiddenMode = mode === GameMode.Hidden || (mode === GameMode.Mix && settings.mixedModes?.includes(GameMode.Hidden));

    return (
        <div className={`space-y-2 sm:space-y-3 ${isMobile ? 'text-[10px]' : 'text-xs md:text-sm'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                <div className={`space-y-0.5 sm:space-y-1 bg-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-md`}>
                    <h3 className={`font-bold text-center mb-0.5 sm:mb-1 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>흑</h3>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>영토:</span> <span>{scoreDetails.black.territory.toFixed(0)}</span></div>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>따낸 돌:</span> <span>{scoreDetails.black.liveCaptures ?? 0}</span></div>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>사석:</span> <span>{scoreDetails.black.deadStones ?? 0}</span></div>
                    {isBaseMode && <div className="flex justify-between text-blue-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>베이스 보너스:</span> <span>{scoreDetails.black.baseStoneBonus}</span></div>}
                    {isHiddenMode && <div className="flex justify-between text-purple-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>히든 보너스:</span> <span>{scoreDetails.black.hiddenStoneBonus}</span></div>}
                    {isSpeedMode && <div className="flex justify-between text-green-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>시간 보너스:</span> <span>{scoreDetails.black.timeBonus.toFixed(1)}</span></div>}
                    <div className={`flex justify-between border-t border-gray-600 pt-0.5 sm:pt-1 mt-0.5 sm:mt-1 font-bold ${isMobile ? 'text-xs' : 'text-base'}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}><span>총점:</span> <span className="text-yellow-300">{scoreDetails.black.total.toFixed(1)}</span></div>
                </div>
                <div className={`space-y-0.5 sm:space-y-1 bg-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-md`}>
                    <h3 className={`font-bold text-center mb-0.5 sm:mb-1 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>백</h3>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>영토:</span> <span>{scoreDetails.white.territory.toFixed(0)}</span></div>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>따낸 돌:</span> <span>{scoreDetails.white.liveCaptures ?? 0}</span></div>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>사석:</span> <span>{scoreDetails.white.deadStones ?? 0}</span></div>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>덤:</span> <span>{scoreDetails.white.komi}</span></div>
                    {isBaseMode && <div className="flex justify-between text-blue-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>베이스 보너스:</span> <span>{scoreDetails.white.baseStoneBonus}</span></div>}
                    {isHiddenMode && <div className="flex justify-between text-purple-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>히든 보너스:</span> <span>{scoreDetails.white.hiddenStoneBonus}</span></div>}
                    {isSpeedMode && <div className="flex justify-between text-green-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>시간 보너스:</span> <span>{scoreDetails.white.timeBonus.toFixed(1)}</span></div>}
                    <div className={`flex justify-between border-t border-gray-600 pt-0.5 sm:pt-1 mt-0.5 sm:mt-1 font-bold ${isMobile ? 'text-xs' : 'text-base'}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}><span>총점:</span> <span className="text-yellow-300">{scoreDetails.white.total.toFixed(1)}</span></div>
                </div>
            </div>
        </div>
    );
};

const PlayfulScoreDetailsComponent: React.FC<{ gameSession: LiveGameSession, isMobile?: boolean, mobileTextScale?: number }> = ({ gameSession, isMobile = false, mobileTextScale = 1 }) => {
    const { scores, player1, player2, diceGoBonuses } = gameSession;
    const p1Id = player1.id;
    const p2Id = player2.id;

    const p1TotalScore = scores[p1Id] || 0;
    const p2TotalScore = scores[p2Id] || 0;

    const p1Bonus = diceGoBonuses?.[p1Id] || 0;
    const p2Bonus = diceGoBonuses?.[p2Id] || 0;

    const p1CaptureScore = p1TotalScore - p1Bonus;
    const p2CaptureScore = p2TotalScore - p2Bonus;

    const hasBonus = p1Bonus > 0 || p2Bonus > 0;

    if (!hasBonus) {
        return (
            <div className="text-center">
                <p className={`text-gray-300 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>최종 점수</p>
                <p className={`${isMobile ? 'text-3xl' : 'text-5xl'} font-mono my-2`} style={{ fontSize: isMobile ? `${28 * mobileTextScale}px` : undefined }}>{p1TotalScore} : {p2TotalScore}</p>
            </div>
        );
    }
    
    return (
        <div className={`space-y-2 sm:space-y-3 ${isMobile ? 'text-[10px]' : 'text-xs md:text-sm'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                <div className={`space-y-0.5 sm:space-y-1 bg-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-md`}>
                    <h3 className={`font-bold text-center mb-0.5 sm:mb-1 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>{player1.nickname}</h3>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>포획 점수:</span> <span>{p1CaptureScore}</span></div>
                    {p1Bonus > 0 && <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>마지막 더미 보너스:</span> <span className="text-green-400">+{p1Bonus}</span></div>}
                    <div className={`flex justify-between border-t border-gray-600 pt-0.5 sm:pt-1 mt-0.5 sm:mt-1 font-bold ${isMobile ? 'text-xs' : 'text-base'}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>
                        <span>총점:</span> <span className="text-yellow-300">{p1TotalScore}</span>
                    </div>
                </div>
                <div className={`space-y-0.5 sm:space-y-1 bg-gray-800/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-md`}>
                    <h3 className={`font-bold text-center mb-0.5 sm:mb-1 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>{player2.nickname}</h3>
                    <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>포획 점수:</span> <span>{p2CaptureScore}</span></div>
                    {p2Bonus > 0 && <div className="flex justify-between" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}><span>마지막 더미 보너스:</span> <span className="text-green-400">+{p2Bonus}</span></div>}
                    <div className={`flex justify-between border-t border-gray-600 pt-0.5 sm:pt-1 mt-0.5 sm:mt-1 font-bold ${isMobile ? 'text-xs' : 'text-base'}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>
                        <span>총점:</span> <span className="text-yellow-300">{p2TotalScore}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CaptureScoreDetailsComponent: React.FC<{ session: LiveGameSession, isMobile?: boolean, mobileTextScale?: number, mobileImageScale?: number }> = ({ session, isMobile = false, mobileTextScale = 1, mobileImageScale = 1 }) => {
    const { captures, blackPlayerId, whitePlayerId, player1, player2, winner } = session;
    const blackCaptures = captures[Player.Black] || 0;
    const whiteCaptures = captures[Player.White] || 0;
    
    const blackPlayer = blackPlayerId === player1.id ? player1 : player2;
    const whitePlayer = whitePlayerId === player1.id ? player1 : player2;
    
    const blackAvatarUrl = AVATAR_POOL.find((a: AvatarInfo) => a.id === blackPlayer.avatarId)?.url;
    const blackBorderUrl = BORDER_POOL.find((b: BorderInfo) => b.id === blackPlayer.borderId)?.url;
    const whiteAvatarUrl = AVATAR_POOL.find((a: AvatarInfo) => a.id === whitePlayer.avatarId)?.url;
    const whiteBorderUrl = BORDER_POOL.find((b: BorderInfo) => b.id === whitePlayer.borderId)?.url;
    
    const blackWon = winner === Player.Black;
    const whiteWon = winner === Player.White;
    
    // 돌 이미지 경로 (흑돌, 백돌)
    const blackStoneImage = '/images/single/BlackDouble.png';
    const whiteStoneImage = '/images/single/WhiteDouble.png';
    
    return (
        <div className="text-center space-y-3 sm:space-y-4">
            <p className={`text-gray-300 mb-2 sm:mb-4 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>최종 스코어</p>
            <div className="flex items-center justify-center gap-2 sm:gap-4">
                <div className={`flex flex-col items-center gap-1 sm:gap-2 ${isMobile ? 'w-20' : 'w-32'} flex-shrink-0`}>
                    <Avatar userId={blackPlayer.id} userName={blackPlayer.nickname} size={isMobile ? Math.round(40 * mobileImageScale) : 64} avatarUrl={blackAvatarUrl} borderUrl={blackBorderUrl} />
                    <span className={`font-bold mt-0.5 sm:mt-1 w-full truncate ${isMobile ? 'text-[10px]' : ''}`} style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{blackPlayer.nickname} (흑)</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 flex-grow justify-center">
                    <div className="flex flex-col items-center gap-1 sm:gap-2">
                        <img src={blackStoneImage} alt="흑돌" className={isMobile ? 'w-8 h-8' : 'w-12 h-12'} style={{ width: isMobile ? `${32 * mobileImageScale}px` : undefined, height: isMobile ? `${32 * mobileImageScale}px` : undefined }} />
                        <span className={`font-bold ${isMobile ? 'text-lg' : 'text-2xl'} ${blackWon ? 'text-green-400' : 'text-white'}`} style={{ fontSize: isMobile ? `${18 * mobileTextScale}px` : undefined }}>{blackCaptures}</span>
                    </div>
                    <span className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold`} style={{ fontSize: isMobile ? `${20 * mobileTextScale}px` : undefined }}>vs</span>
                    <div className="flex flex-col items-center gap-1 sm:gap-2">
                        <img src={whiteStoneImage} alt="백돌" className={isMobile ? 'w-8 h-8' : 'w-12 h-12'} style={{ width: isMobile ? `${32 * mobileImageScale}px` : undefined, height: isMobile ? `${32 * mobileImageScale}px` : undefined }} />
                        <span className={`font-bold ${isMobile ? 'text-lg' : 'text-2xl'} ${whiteWon ? 'text-green-400' : 'text-white'}`} style={{ fontSize: isMobile ? `${18 * mobileTextScale}px` : undefined }}>{whiteCaptures}</span>
                    </div>
                </div>
                <div className={`flex flex-col items-center gap-1 sm:gap-2 ${isMobile ? 'w-20' : 'w-32'} flex-shrink-0`}>
                    <Avatar userId={whitePlayer.id} userName={whitePlayer.nickname} size={isMobile ? Math.round(40 * mobileImageScale) : 64} avatarUrl={whiteAvatarUrl} borderUrl={whiteBorderUrl}/>
                    <span className={`font-bold mt-0.5 sm:mt-1 w-full truncate ${isMobile ? 'text-[10px]' : ''}`} style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{whitePlayer.nickname} (백)</span>
                </div>
            </div>
            {blackWon && (
                <p className={`${isMobile ? 'text-sm' : 'text-lg'} font-bold text-green-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>{blackPlayer.nickname} 승리!</p>
            )}
            {whiteWon && (
                <p className={`${isMobile ? 'text-sm' : 'text-lg'} font-bold text-green-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>{whitePlayer.nickname} 승리!</p>
            )}
        </div>
    );
};

const CurlingScoreDetailsComponent: React.FC<{ gameSession: LiveGameSession, isMobile?: boolean, mobileTextScale?: number, mobileImageScale?: number }> = ({ gameSession, isMobile = false, mobileTextScale = 1, mobileImageScale = 1 }) => {
    const { curlingScores, player1, player2, blackPlayerId, whitePlayerId } = gameSession;
    if (!curlingScores) return <p className={`text-center text-gray-400 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>점수 정보가 없습니다.</p>;

    const blackPlayer = blackPlayerId === player1.id ? player1 : player2;
    const whitePlayer = whitePlayerId === player1.id ? player1 : player2;
    
    const blackScore = curlingScores[Player.Black] || 0;
    const whiteScore = curlingScores[Player.White] || 0;
    
    const blackAvatarUrl = AVATAR_POOL.find((a: AvatarInfo) => a.id === blackPlayer.avatarId)?.url;
    const blackBorderUrl = BORDER_POOL.find((b: BorderInfo) => b.id === blackPlayer.borderId)?.url;
    const whiteAvatarUrl = AVATAR_POOL.find((a: AvatarInfo) => a.id === whitePlayer.avatarId)?.url;
    const whiteBorderUrl = BORDER_POOL.find((b: BorderInfo) => b.id === whitePlayer.borderId)?.url;


    return (
        <div className="text-center">
            <p className={`text-gray-300 mb-2 sm:mb-4 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>최종 점수</p>
            <div className="flex items-center justify-center my-1 sm:my-2">
                <div className={`flex flex-col items-center gap-1 sm:gap-2 ${isMobile ? 'w-20' : 'w-32'} flex-shrink-0`}>
                    <Avatar userId={blackPlayer.id} userName={blackPlayer.nickname} size={isMobile ? Math.round(40 * mobileImageScale) : 64} avatarUrl={blackAvatarUrl} borderUrl={blackBorderUrl} />
                    <span className={`font-bold mt-0.5 sm:mt-1 w-full truncate ${isMobile ? 'text-[10px]' : ''}`} style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{blackPlayer.nickname} (흑)</span>
                </div>
                <p className={`${isMobile ? 'text-3xl' : 'text-5xl'} font-mono text-center flex-grow px-1 sm:px-2`} style={{ fontSize: isMobile ? `${28 * mobileTextScale}px` : undefined }}>{blackScore} : {whiteScore}</p>
                <div className={`flex flex-col items-center gap-1 sm:gap-2 ${isMobile ? 'w-20' : 'w-32'} flex-shrink-0`}>
                    <Avatar userId={whitePlayer.id} userName={whitePlayer.nickname} size={isMobile ? Math.round(40 * mobileImageScale) : 64} avatarUrl={whiteAvatarUrl} borderUrl={whiteBorderUrl}/>
                    <span className={`font-bold mt-0.5 sm:mt-1 w-full truncate ${isMobile ? 'text-[10px]' : ''}`} style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{whitePlayer.nickname} (백)</span>
                </div>
            </div>
        </div>
    );
};


const GameSummaryModal: React.FC<GameSummaryModalProps> = ({ session, currentUser, onConfirm, onAction }) => {
    const { winner, player1, player2, blackPlayerId, whitePlayerId, winReason } = session;
    const soundPlayed = useRef(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const isWinner = getIsWinner(session, currentUser);
    const mySummary = session.summary?.[currentUser.id];
    const isPlayful = PLAYFUL_GAME_MODES.some((m: {mode: GameMode}) => m.mode === session.mode);
    const isStrategic = SPECIAL_GAME_MODES.some((m: {mode: GameMode}) => m.mode === session.mode);
    const isPVP = !session.isSinglePlayer && !session.isAiGame && !session.gameCategory;
    const canSaveRecord = isStrategic && isPVP && (session.gameStatus === 'ended' || session.gameStatus === 'scoring');
    const hasSavedRecord = currentUser.savedGameRecords?.some(r => r.gameId === session.id);
    const recordCount = currentUser.savedGameRecords?.length ?? 0;
    const [savingRecord, setSavingRecord] = useState(false);

    const avatarUrl = useMemo(() => AVATAR_POOL.find((a: AvatarInfo) => a.id === currentUser.avatarId)?.url, [currentUser.avatarId]);
    const borderUrl = useMemo(() => BORDER_POOL.find((b: BorderInfo) => b.id === currentUser.borderId)?.url, [currentUser.borderId]);
    
    // 모바일 텍스트 크기 조정
    const mobileTextScale = isMobile ? 0.85 : 1;
    const mobileImageScale = isMobile ? 0.7 : 1;

    useEffect(() => {
        if (soundPlayed.current) return;
        
        if (isWinner === true) audioService.gameWin();
        else if (isWinner === false) audioService.gameLose();
        
        if (mySummary) {
            if (mySummary.level && mySummary.level.initial < mySummary.level.final) {
                setTimeout(() => audioService.levelUp(), 800);
            }
            if (mySummary.manner && getMannerRank(mySummary.manner.initial) !== getMannerRank(mySummary.manner.final)) {
                 setTimeout(() => audioService.levelUp(), 900);
            }
        }
        
        soundPlayed.current = true;
    }, [isWinner, mySummary]);
    
    const isDraw = winner === Player.None;
    const winnerUser = winner === Player.Black 
        ? (player1.id === blackPlayerId ? player1 : player2)
        : (winner === Player.White ? (player1.id === whitePlayerId ? player1 : player2) : null);

    const { title, color } = useMemo(() => {
        if (isDraw) return { title: "무승부", color: 'text-yellow-400' };

        // For spectators or when winner info is not yet available
        if (isWinner === null) {
            if (winnerUser) {
                return { title: `${winnerUser.nickname} 승리`, color: "text-gray-300" };
            }
            return { title: "게임 종료", color: 'text-gray-300' };
        }

        // For players
        if (isWinner) {
            let title = '승리';
            if (winReason === 'resign') title = '기권승';
            if (winReason === 'timeout') title = '시간승';
            return { title, color: 'text-green-400' };
        } else {
            let title = '패배';
            if (winReason === 'resign') title = '기권패';
            if (winReason === 'timeout') title = '시간패';
            return { title, color: 'text-red-400' };
        }
    }, [isWinner, isDraw, winReason, winnerUser]);
    
    const analysisResult = session.analysisResult?.['system']; // System analysis is used for final scores

    const renderGameContent = () => {
        const totalMoves = session.moveHistory?.length ?? 0;
        const startTime = session.createdAt;
        const inferredEndTime = session.gameStatus === 'ended' || session.gameStatus === 'no_contest'
            ? (session.turnStartTime ?? Date.now())
            : Date.now();
        const elapsedMs = Math.max(0, inferredEndTime - startTime);
        const totalSeconds = Math.floor(elapsedMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        const formattedElapsed = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        const blackPlayer = player1.id === blackPlayerId ? player1 : player2;
        const whitePlayer = player1.id === whitePlayerId ? player1 : player2;

        if (isPlayful && winReason === 'resign') {
            const message = isWinner ? "상대방의 기권으로 승리했습니다." : "기권 패배했습니다.";
            return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'}`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>{message}</p>;
        }
        
        // 시간 패배/승리 처리
        if (winReason === 'timeout') {
            if (!isWinner) {
                // 패배한 경우
                if (session.stageId) {
                    // stageId가 있으면 제한 턴 체크
                    const isTower = session.gameCategory === 'tower';
                    if (isTower) {
                        try {
                            const currentStage = TOWER_STAGES.find((s: any) => s.id === session.stageId);
                            if (currentStage?.blackTurnLimit) {
                                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'} text-red-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>제한 턴이 다 되어 패배했습니다.</p>;
                            }
                        } catch (e) {
                            console.error('[GameSummaryModal] Error loading TOWER_STAGES:', e);
                        }
                    } else if (session.isSinglePlayer) {
                        try {
                            const currentStage = SINGLE_PLAYER_STAGES.find((s: any) => s.id === session.stageId);
                            if (currentStage?.blackTurnLimit) {
                                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'} text-red-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>제한 턴이 다 되어 패배했습니다.</p>;
                            }
                        } catch (e) {
                            console.error('[GameSummaryModal] Error loading SINGLE_PLAYER_STAGES:', e);
                        }
                    }
                }
                // 일반 게임에서 시간 패배한 경우
                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'} text-red-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>시간이 다 되어 패배했습니다.</p>;
            } else {
                // 승리한 경우
                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'} text-green-400`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>상대방의 시간이 다 되어 승리했습니다.</p>;
            }
        }
        
        // 따내기 바둑: 따낸 점수를 이미지로 표시
        const isCaptureMode = session.mode === GameMode.Capture;
        const isMixWithCapture = session.mode === GameMode.Mix && session.settings.mixedModes && 
            session.settings.mixedModes.includes(GameMode.Capture);
        
        if (isCaptureMode || isMixWithCapture) {
            return <CaptureScoreDetailsComponent session={session} isMobile={isMobile} mobileTextScale={mobileTextScale} mobileImageScale={mobileImageScale} />;
        }
        
        // 스피드 바둑, 베이스 바둑, 히든 바둑, 미사일 바둑, 믹스룰 바둑: 계가 결과 표시
        const strategicModesWithScoring = [GameMode.Speed, GameMode.Base, GameMode.Hidden, GameMode.Missile];
        const isMixWithStrategic = session.mode === GameMode.Mix && session.settings.mixedModes && 
            session.settings.mixedModes.some((m: GameMode) => strategicModesWithScoring.includes(m));
        
        if (strategicModesWithScoring.includes(session.mode) || isMixWithStrategic || session.mode === GameMode.Mix) {
            if (winReason === 'score' && analysisResult) {
                return (
                    <div className="w-full">
                        <ScoreDetailsComponent analysis={analysisResult} session={session} isMobile={isMobile} mobileTextScale={mobileTextScale} />
                    </div>
                );
            }
            if (winReason === 'score') {
                return <p className={`text-center text-gray-400 animate-pulse ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>점수 계산 중...</p>;
            }
        }
        
        if (winReason === 'score') {
            if (analysisResult) {
                return (
                    <div className="w-full">
                        <ScoreDetailsComponent analysis={analysisResult} session={session} isMobile={isMobile} mobileTextScale={mobileTextScale} />
                    </div>
                );
            }
            return <p className={`text-center text-gray-400 animate-pulse ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>점수 계산 중...</p>;
        }
        if (session.mode === GameMode.Dice || session.mode === GameMode.Thief) return <PlayfulScoreDetailsComponent gameSession={session} isMobile={isMobile} mobileTextScale={mobileTextScale} />;
        if (session.mode === GameMode.Curling) return <CurlingScoreDetailsComponent gameSession={session} isMobile={isMobile} mobileTextScale={mobileTextScale} mobileImageScale={mobileImageScale} />;
        if (session.mode === GameMode.Omok || session.mode === GameMode.Ttamok) {
            let message = '';
            if (winReason === 'omok_win') {
                message = isWinner ? '오목 완성' : '상대방 오목 완성';
            } else if (winReason === 'capture_limit') {
                message = isWinner ? '목표 따내기 완료' : '상대방 목표 따내기 완료';
            }
            if (message) {
                return <p className={`text-center ${isMobile ? 'text-lg' : 'text-2xl'} font-bold`} style={{ fontSize: isMobile ? `${16 * mobileTextScale}px` : undefined }}>{message}</p>;
            }
        }
        if (session.mode === GameMode.Alkkagi) {
            const myPlayerEnum = currentUser.id === blackPlayerId ? Player.Black : Player.White;
            const myStones = (session.alkkagiStones || []).filter((s: AlkkagiStone) => s.player === myPlayerEnum && s.onBoard).length;
            const opponentStones = (session.alkkagiStones || []).filter((s: AlkkagiStone) => s.player !== myPlayerEnum && s.onBoard).length;
        
            if (isWinner) {
                if (myStones > 0) {
                    return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'}`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>{myStones}개의 돌을 남기고 승리했습니다.</p>;
                }
                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'}`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>상대방의 돌을 모두 떨어뜨리고 승리했습니다.</p>;
            } else { // isWinner is false, I lost.
                if (opponentStones > 0) {
                    return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'}`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>모든 돌이 판 밖으로 나가 패배했습니다. (상대방 돌 {opponentStones}개 남음)</p>;
                }
                return <p className={`text-center ${isMobile ? 'text-sm' : 'text-lg'}`} style={{ fontSize: isMobile ? `${12 * mobileTextScale}px` : undefined }}>아쉽게 패배했습니다.</p>;
            }
        }
        return (
            <div className="flex flex-col gap-2 sm:gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-2 text-sm sm:text-base">
                    <div className="bg-gray-800/40 rounded-md px-2 py-1.5 flex justify-between items-center">
                        <span className="text-gray-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>흑</span>
                        <span className="font-semibold" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{blackPlayer.nickname}</span>
                    </div>
                    <div className="bg-gray-800/40 rounded-md px-2 py-1.5 flex justify-between items-center">
                        <span className="text-gray-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>백</span>
                        <span className="font-semibold" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{whitePlayer.nickname}</span>
                    </div>
                    <div className="bg-gray-800/40 rounded-md px-2 py-1.5 flex justify-between items-center">
                        <span className="text-gray-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>총 수순</span>
                        <span className="font-semibold" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{totalMoves}수</span>
                    </div>
                    <div className="bg-gray-800/40 rounded-md px-2 py-1.5 flex justify-between items-center">
                        <span className="text-gray-300" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>경기 시간</span>
                        <span className="font-semibold" style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>{formattedElapsed}</span>
                    </div>
                </div>
                <p className={`text-center text-gray-400 ${isMobile ? 'text-xs' : ''}`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>
                    특별한 경기 내용이 없습니다.
                </p>
            </div>
        );
    }

    const initialMannerRank = mySummary ? getMannerRank(mySummary.manner.initial) : '';
    const finalMannerRank = mySummary ? getMannerRank(mySummary.manner.final) : '';

    return (
        <DraggableWindow title="대국 결과" onClose={onConfirm} initialWidth={isMobile ? 600 : 900} initialHeight={isMobile ? 560 : 760} windowId="game-summary">
            <div className={`text-white ${isMobile ? 'text-xs' : 'text-[clamp(0.75rem,2.5vw,1rem)]'} flex flex-col ${isMobile ? 'max-h-[85vh]' : 'h-full'} overflow-y-auto`}>
                <h1 className={`${isMobile ? 'text-lg' : 'text-[clamp(2.25rem,10vw,3rem)]'} font-black text-center mb-2 sm:mb-4 tracking-widest ${color} flex-shrink-0`} style={{ fontSize: isMobile ? `${16 * mobileTextScale}px` : undefined }}>{title}</h1>
                
                <div className={`flex flex-row gap-2 sm:gap-4 overflow-hidden flex-1 min-h-0`}>
                    {/* Left Panel: Game Content */}
                    <div className={`w-1/2 bg-gray-900/50 ${isMobile ? 'p-1.5' : 'p-4'} rounded-lg overflow-y-auto flex flex-col`}>
                        <h2 className={`${isMobile ? 'text-xs' : 'text-lg'} font-bold text-center text-gray-200 mb-1 sm:mb-3 border-b border-gray-700 pb-0.5 sm:pb-2 flex-shrink-0`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>경기 내용</h2>
                        <div className="flex-1 min-h-0">
                            {renderGameContent()}
                        </div>
                    </div>
                    
                    {/* Right Panel: My Results & Rewards */}
                    {mySummary && (
                        <div className={`w-1/2 flex flex-col gap-1.5 sm:gap-4`}>
                            <div className={`bg-gray-900/50 ${isMobile ? 'p-1.5' : 'p-4'} rounded-lg flex flex-col gap-1`}>
                                <h2 className={`${isMobile ? 'text-xs' : 'text-lg'} font-bold text-center text-gray-200 mb-1 sm:mb-2 border-b border-gray-700 pb-0.5`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>내 대국 결과</h2>
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                    <Avatar userId={currentUser.id} userName={currentUser.nickname} size={isMobile ? Math.round(24 * mobileImageScale) : 48} avatarUrl={avatarUrl} borderUrl={borderUrl} />
                                    <div>
                                        <p className={`font-bold`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>{currentUser.nickname}</p>
                                        <p className={`text-gray-400`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>
                                            {isPlayful ? '놀이' : '전략'} Lv.{mySummary.level ? mySummary.level.final : (isPlayful ? currentUser.playfulLevel : currentUser.strategyLevel)}
                                        </p>
                                    </div>
                                </div>
                                {mySummary.level && (
                                    <div className="flex-shrink-0">
                                        <XpBar
                                            initial={mySummary.level.progress.initial}
                                            final={mySummary.level.progress.final}
                                            max={mySummary.level.progress.max}
                                            levelUp={mySummary.level.initial < mySummary.level.final}
                                            xpGain={mySummary.xp.change}
                                            finalLevel={mySummary.level.final}
                                            isMobile={isMobile}
                                            mobileTextScale={mobileTextScale}
                                        />
                                    </div>
                                )}
                                <div className={`grid grid-cols-2 gap-1 text-center`}>
                                    <div className={`bg-gray-800 ${isMobile ? 'p-1' : 'p-2'} rounded-md flex flex-col gap-0.5 leading-tight`}>
                                        <p className="text-gray-400" style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>랭킹 점수</p>
                                        <p className={`font-semibold text-white`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>
                                            {mySummary.rating.final}{' '}
                                            <span className={mySummary.rating.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                                                ({mySummary.rating.change > 0 ? '+' : ''}{mySummary.rating.change})
                                            </span>
                                        </p>
                                    </div>
                                    <div className={`bg-gray-800 ${isMobile ? 'p-1' : 'p-2'} rounded-md flex flex-col gap-0.5 leading-tight`}>
                                        <p className="text-gray-400" style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>매너 점수 변동</p>
                                        <p className={`font-semibold ${mySummary.manner.change === 0 ? 'text-white' : mySummary.manner.change > 0 ? 'text-green-400' : 'text-red-400'}`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>
                                            {mySummary.manner.change > 0 ? '+' : ''}{mySummary.manner.change}
                                        </p>
                                    </div>
                                    <div className={`bg-gray-800 ${isMobile ? 'p-1' : 'p-2'} rounded-md flex flex-col gap-0.5 leading-tight`}>
                                        <p className="text-gray-400" style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>통산 전적</p>
                                        <p className={`font-semibold text-white`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>{mySummary.overallRecord?.wins}승 {mySummary.overallRecord?.losses}패</p>
                                    </div>
                                    <div className={`bg-gray-800 ${isMobile ? 'p-1' : 'p-2'} rounded-md flex flex-col gap-0.5 leading-tight`}>
                                        <p className="text-gray-400" style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>매너 등급</p>
                                        <p className={`font-semibold text-white`} style={{ fontSize: isMobile ? `${8 * mobileTextScale}px` : undefined }}>{initialMannerRank} &rarr; {finalMannerRank}</p>
                                    </div>
                                </div>
                            </div>
                            <div className={`bg-gray-900/50 ${isMobile ? 'p-1.5' : 'p-4'} rounded-lg space-y-1 sm:space-y-2 flex-shrink-0`}>
                                <h2 className={`${isMobile ? 'text-xs' : 'text-lg'} font-bold text-center text-gray-200 border-b border-gray-700 pb-0.5`} style={{ fontSize: isMobile ? `${10 * mobileTextScale}px` : undefined }}>획득 보상</h2>
                                <div className={`flex gap-1.5 sm:gap-3 justify-center items-stretch`}>
                                    {/* Gold Reward - Square */}
                                    <div className={`${isMobile ? 'w-16 h-16' : 'w-32 h-32'} bg-gradient-to-br from-yellow-600/30 to-yellow-800/30 border-2 border-yellow-500/50 rounded-lg flex flex-col items-center justify-center ${isMobile ? 'p-1' : 'p-2'} shadow-lg`}>
                                        <img src="/images/icon/Gold.png" alt="골드" className={`${isMobile ? 'w-5 h-5' : 'w-12 h-12'} mb-0.5`} />
                                        <p className={`font-bold text-yellow-300 text-center`} style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>
                                            {(mySummary.gold ?? 0).toLocaleString()}
                                        </p>
                                    </div>
                                    {/* Items Reward - Multiple items support */}
                                    {mySummary?.items && mySummary.items.length > 0 ? (
                                        <div className={`flex flex-wrap gap-1 ${isMobile ? 'w-16' : 'w-32'} justify-center`}>
                                            {mySummary.items.slice(0, 3).map((item: InventoryItem, idx: number) => {
                                                const itemTemplate = CONSUMABLE_ITEMS.find((ci: { name: string; }) => ci.name === item.name);
                                                return (
                                                    <div key={idx} className={`${isMobile ? 'w-14 h-14' : 'w-28 h-28'} bg-gradient-to-br from-purple-600/30 to-purple-800/30 border-2 border-purple-500/50 rounded-lg flex flex-col items-center justify-center ${isMobile ? 'p-1' : 'p-2'} shadow-lg`}>
                                                        {itemTemplate?.image && (
                                                            <img 
                                                                src={itemTemplate.image} 
                                                                alt={item.name} 
                                                                className={`${isMobile ? 'w-6 h-6' : 'w-12 h-12'} mb-0.5 object-contain`}
                                                            />
                                                        )}
                                                        <p className={`font-semibold text-purple-300 text-center leading-tight`} style={{ fontSize: isMobile ? `${5 * mobileTextScale}px` : undefined }}>
                                                            {item.name}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                            {mySummary.items.length > 3 && (
                                                <div className={`${isMobile ? 'w-14 h-14' : 'w-28 h-28'} bg-gray-800/50 border-2 border-gray-700/50 rounded-lg flex items-center justify-center ${isMobile ? 'p-1' : 'p-2'}`}>
                                                    <p className={`text-gray-400 text-center`} style={{ fontSize: isMobile ? `${5 * mobileTextScale}px` : undefined }}>
                                                        +{mySummary.items.length - 3}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className={`${isMobile ? 'w-16 h-16' : 'w-32 h-32'} bg-gray-800/50 border-2 border-gray-700/50 rounded-lg flex items-center justify-center ${isMobile ? 'p-1' : 'p-2'} shadow-lg`}>
                                            <p className={`text-gray-500 text-center`} style={{ fontSize: isMobile ? `${7 * mobileTextScale}px` : undefined }}>
                                                보상 없음
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                 
                 {canSaveRecord && onAction && (
                    <Button 
                        onClick={async () => {
                            if (savingRecord) return;
                            if (recordCount >= 30 && !hasSavedRecord) {
                                alert('기보는 최대 30개까지 저장할 수 있습니다. 기존 기보를 삭제한 후 다시 시도해주세요.');
                                return;
                            }
                            setSavingRecord(true);
                            try {
                                onAction({ type: 'SAVE_GAME_RECORD', payload: { gameId: session.id } });
                            } catch (error) {
                                console.error('Failed to save game record:', error);
                            } finally {
                                setSavingRecord(false);
                            }
                        }}
                        disabled={savingRecord || hasSavedRecord}
                        className={`w-full ${isMobile ? 'py-1.5 text-xs' : 'py-2'} mt-2 flex-shrink-0 ${hasSavedRecord ? 'opacity-50' : ''}`}
                        style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}
                    >
                        {savingRecord ? '저장 중...' : hasSavedRecord ? '이미 저장됨' : '기보 저장'}
                    </Button>
                )}
                 <Button onClick={onConfirm} className={`w-full ${isMobile ? 'py-1.5 text-xs' : 'py-3'} mt-2 sm:mt-4 flex-shrink-0`} style={{ fontSize: isMobile ? `${9 * mobileTextScale}px` : undefined }}>확인</Button>
            </div>
        </DraggableWindow>
    );
};

export default GameSummaryModal;
