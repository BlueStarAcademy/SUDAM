import React from 'react';
import { LiveGameSession, SinglePlayerStageInfo } from '../types.js';
import { SINGLE_PLAYER_STAGES } from '../constants/singlePlayerConstants.js';
import { TOWER_STAGES } from '../constants/towerConstants.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../constants/gameModes.js';
import { GameMode, Player, SinglePlayerLevel } from '../types/enums.js';
import Button from './Button.js';

interface SinglePlayerGameDescriptionModalProps {
    session: LiveGameSession;
    onStart: () => void;
    onClose?: () => void;
}

const SinglePlayerGameDescriptionModal: React.FC<SinglePlayerGameDescriptionModalProps> = ({ session, onStart, onClose }) => {
    // 싱글플레이어 게임이면 SINGLE_PLAYER_STAGES에서, 도전의 탑 게임이면 TOWER_STAGES에서 스테이지 찾기
    const isTower = session.gameCategory === 'tower';
    const stage = isTower 
        ? TOWER_STAGES.find(s => s.id === session.stageId)
        : SINGLE_PLAYER_STAGES.find(s => s.id === session.stageId);
    
    if (!stage) {
        return null;
    }

    // 게임 모드 이름 찾기
    const getGameModeName = (mode: GameMode): string => {
        const specialMode = SPECIAL_GAME_MODES.find(m => m.mode === mode);
        if (specialMode) return specialMode.name;
        
        const playfulMode = PLAYFUL_GAME_MODES.find(m => m.mode === mode);
        if (playfulMode) return playfulMode.name;
        
        return mode;
    };

    const gameModeName = getGameModeName(session.mode);
    const isCaptureMode = stage.blackTurnLimit !== undefined || session.mode === GameMode.Capture;
    const isSpeedMode = !isCaptureMode && stage.timeControl.type === 'fischer';
    
    // 문양돌 개수 확인
    const blackPatternCount = stage.placements.blackPattern || 0;
    const whitePatternCount = stage.placements.whitePattern || 0;
    const hasPatternStones = blackPatternCount > 0 || whitePatternCount > 0;
    
    // 승리 목표 설명
    const getWinCondition = (): string => {
        const effectiveTargets = session.effectiveCaptureTargets;
        const blackTarget = effectiveTargets?.[Player.Black];
        const whiteTarget = effectiveTargets?.[Player.White];

        // 살리기 바둑 모드
        if (stage.survivalTurns) {
            // 살리기 바둑: 백의 목표점수는 black 값 사용
            const whiteTarget = stage.targetScore.black;
            return `백(AI)이 ${stage.survivalTurns}턴 이내에 목표점수(${whiteTarget}개)를 달성하지 못하면 유저(흑) 승리. 백이 목표점수를 달성하면 유저 패배`;
        }
        
        // 따내기 바둑
        if (isCaptureMode) {
            if (stage.blackTurnLimit && typeof blackTarget === 'number' && blackTarget !== 999) {
                if (typeof whiteTarget === 'number' && whiteTarget !== 999) {
                    return `${stage.blackTurnLimit}턴 이내에 흑 ${blackTarget}점 이상 달성 (백은 ${whiteTarget}점 달성 시 승리)`;
                }
                return `${stage.blackTurnLimit}턴 이내에 흑이 ${blackTarget}점 이상 획득하면 승리`;
            }

            if (typeof blackTarget === 'number' && blackTarget !== 999 && typeof whiteTarget === 'number' && whiteTarget !== 999) {
                return `흑 ${blackTarget}점 / 백 ${whiteTarget}점 달성 경쟁`;
            }
            if (typeof blackTarget === 'number' && blackTarget !== 999) {
                return `흑이 ${blackTarget}개 이상의 돌을 따내면 승리`;
            }
            if (typeof whiteTarget === 'number' && whiteTarget !== 999) {
                return `백이 ${whiteTarget}개 이상의 돌을 따내면 승리`;
            }
            if (typeof session.settings.captureTarget === 'number') {
                return `흑이 ${session.settings.captureTarget}개 이상의 돌을 따내면 승리`;
            }
        }
        
        // 스피드 바둑 (피셔 타이머)
        if (isSpeedMode) {
            return '계가 시 최종 점수가 더 높은 플레이어가 승리합니다. 남은 시간 5초마다 1점 보너스가 추가됩니다.';
        }
        
        // 따내기 바둑: 턴 제한과 목표 점수가 모두 있는 경우
        if (stage.blackTurnLimit && stage.targetScore.black > 0) {
            return `${stage.blackTurnLimit}턴 이내에 ${stage.targetScore.black}점 이상 획득하기`;
        }
        
        // 일반 계가 승리 조건
        if (stage.targetScore.black > 0 && stage.targetScore.white > 0) {
            return `계가 시 흑 ${stage.targetScore.black}집, 백 ${stage.targetScore.white}집 이상 확보`;
        }
        
        return '계가 시 더 많은 집을 확보한 플레이어 승리';
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border-2 border-gray-600">
                <div className="p-6">
                    <h2 className="text-2xl font-bold text-white mb-4 border-b border-gray-600 pb-3">
                        {stage.name} - 게임 설명
                    </h2>
                    
                    <div className="space-y-4 text-white">
                        {/* 승리 목표 - 이미지와 함께 */}
                        <div>
                            <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                <span>🎯</span>
                                <span>승리 목표</span>
                            </h3>
                            <div className="bg-gray-700/50 rounded-lg p-3">
                                <p className="text-gray-200 font-medium">{getWinCondition()}</p>
                            </div>
                        </div>

                        {/* 문양돌 설명 */}
                        {hasPatternStones && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2">문양돌</h3>
                                <div className="bg-gray-700/50 rounded-lg p-3 space-y-3">
                                    {/* 문양돌 이미지 및 설명 */}
                                    <div className="flex items-start gap-3">
                                        {/* 흑 문양돌 이미지 */}
                                        {blackPatternCount > 0 && (
                                            <div className="flex-shrink-0 flex flex-col items-center gap-1">
                                                <div className="relative w-16 h-16">
                                                    <div className="w-16 h-16 rounded-full bg-black border-2 border-gray-400 flex items-center justify-center">
                                                        <img 
                                                            src="/images/single/BlackDouble.png" 
                                                            alt="흑 문양돌"
                                                            className="w-12 h-12 object-contain"
                                                            onError={(e) => {
                                                                const target = e.target as HTMLImageElement;
                                                                target.style.display = 'none';
                                                                const parent = target.parentElement;
                                                                if (parent) {
                                                                    parent.innerHTML = '<span class="text-white text-xl">⭐</span>';
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                <span className="text-xs text-gray-300">흑 {blackPatternCount}개</span>
                                            </div>
                                        )}
                                        {/* 백 문양돌 이미지 */}
                                        {whitePatternCount > 0 && (
                                            <div className="flex-shrink-0 flex flex-col items-center gap-1">
                                                <div className="relative w-16 h-16">
                                                    <div className="w-16 h-16 rounded-full bg-white border-2 border-gray-400 flex items-center justify-center">
                                                        <img 
                                                            src="/images/single/WhiteDouble.png" 
                                                            alt="백 문양돌"
                                                            className="w-12 h-12 object-contain"
                                                            onError={(e) => {
                                                                const target = e.target as HTMLImageElement;
                                                                target.style.display = 'none';
                                                                const parent = target.parentElement;
                                                                if (parent) {
                                                                    parent.innerHTML = '<span class="text-black text-xl">⭐</span>';
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                <span className="text-xs text-gray-300">백 {whitePatternCount}개</span>
                                            </div>
                                        )}
                                        <div className="flex-1">
                                            <p className="text-gray-200 text-sm mb-2">
                                                문양돌을 따내면 <span className="text-green-400 font-bold">2점</span>을 획득합니다.
                                            </p>
                                            <p className="text-gray-300 text-xs">
                                                문양돌을 빼앗기면 상대방이 <span className="text-red-400 font-bold">2점</span>을 획득합니다.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 살리기 바둑 모드 */}
                        {stage.survivalTurns && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                    <span>⚔️</span>
                                    <span>특수 규칙</span>
                                </h3>
                                <div className="bg-gray-700/50 rounded-lg p-3">
                                    <p className="text-gray-200">
                                        백(AI)이 <span className="text-red-400 font-bold">{stage.survivalTurns}턴</span> 동안 유저(흑)의 돌을 잡으러 옵니다.
                                        <br />
                                        <span className="text-blue-400">백이 한 수를 둘 때마다 백 남은 턴이 감소합니다.</span>
                                        <br />
                                        <span className="text-green-400">백의 따낸 돌에는 목표점수가 표시되지만, 유저의 따낸 돌에는 목표점수가 표시되지 않습니다.</span>
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 스피드 바둑 특수 규칙 */}
                        {isSpeedMode && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                    <img src="/images/icon/timer.png" alt="타이머" className="w-4 h-4 object-contain" />
                                    <span>특수 규칙</span>
                                </h3>
                                <div className="bg-gray-700/50 rounded-lg p-3 space-y-2">
                                    <p className="text-gray-200">
                                        각 플레이어는 수를 둘 때마다 <span className="text-blue-300 font-semibold">피셔 타이머</span>가 적용되어 일정 시간(증가 시간)이 추가됩니다.
                                    </p>
                                    <p className="text-gray-200">
                                        경기 종료 시 <span className="text-green-300 font-semibold">남은 시간 5초마다 1점</span>이 추가되어 최종 점수를 결정합니다.
                                    </p>
                                    <p className="text-gray-300 text-sm">
                                        목표 따냄 수는 없으며, 최종 점수가 더 높은 쪽이 승리합니다.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 턴 제한 */}
                        {stage.blackTurnLimit && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                    <img src="/images/icon/timer.png" alt="타이머" className="w-4 h-4 object-contain" />
                                    <span>턴 제한</span>
                                </h3>
                                <div className="bg-gray-700/50 rounded-lg p-3">
                                    <p className="text-gray-200">
                                        흑(유저)은 <span className="text-red-400 font-bold">{stage.blackTurnLimit}턴</span> 이내에 승리해야 합니다.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 자동 계가 */}
                        {stage.autoScoringTurns && stage.autoScoringTurns > 0 && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                    <img src="/images/icon/timer.png" alt="타이머" className="w-4 h-4 object-contain" />
                                    <span>자동 계가</span>
                                </h3>
                                <div className="bg-gray-700/50 rounded-lg p-3">
                                    <p className="text-gray-200">
                                        <span className="text-blue-400 font-bold">{stage.autoScoringTurns}턴</span> 후 자동으로 계가가 진행됩니다.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 특수 아이템 */}
                        {(stage.missileCount || stage.hiddenCount || stage.scanCount) && (
                            <div>
                                <h3 className="text-lg font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                                    <span>🎁</span>
                                    <span>특수 아이템</span>
                                </h3>
                                <div className="bg-gray-700/50 rounded-lg p-3 space-y-3">
                                    {/* 미사일 아이템 */}
                                    {stage.missileCount && stage.missileCount > 0 && (
                                        <div className="border-l-4 border-amber-400 pl-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <img src="/images/button/missile.png" alt="미사일" className="w-6 h-6 object-contain" />
                                                <span className="font-semibold text-amber-300">미사일 ({stage.missileCount}개)</span>
                                            </div>
                                            <p className="text-gray-200 text-sm">
                                                발사할 바둑돌을 선택한 후 방향을 선택하면 해당 방향으로 날아갑니다. 
                                                <br />
                                                <span className="text-gray-300 text-xs">• 아이템 사용 시 30초의 제한시간이 부여됩니다.</span>
                                            </p>
                                        </div>
                                    )}
                                    
                                    {/* 히든 아이템 */}
                                    {stage.hiddenCount && stage.hiddenCount > 0 && (
                                        <div className="border-l-4 border-purple-400 pl-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <img src="/images/button/hidden.png" alt="히든" className="w-6 h-6 object-contain" />
                                                <span className="font-semibold text-purple-300">히든 스톤 ({stage.hiddenCount}개)</span>
                                            </div>
                                            <p className="text-gray-200 text-sm">
                                                상대방에게 보이지 않는 돌을 배치할 수 있습니다. 
                                                <br />
                                                <span className="text-gray-300 text-xs">• 아이템 사용 시 30초의 제한시간이 부여됩니다.</span>
                                            </p>
                                            {/* 고급반 스테이지에서 AI봇의 히든돌 안내 */}
                                            {stage.level === SinglePlayerLevel.고급 && (
                                                <div className="mt-2 p-2 bg-purple-900/30 rounded border border-purple-500/50">
                                                    <p className="text-purple-200 text-xs">
                                                        <span className="font-semibold">⚠️ 주의:</span> AI봇이 이미 <span className="text-yellow-300 font-bold">히든돌 1개</span>를 숨겨두고 있습니다. 
                                                        <br />
                                                        <span className="text-purple-300">스캔 아이템을 사용하여 찾아보세요!</span>
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* 스캔 아이템 */}
                                    {stage.scanCount && stage.scanCount > 0 && (
                                        <div className="border-l-4 border-blue-400 pl-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <img src="/images/button/scan.png" alt="스캔" className="w-6 h-6 object-contain" />
                                                <span className="font-semibold text-blue-300">스캔 ({stage.scanCount}개)</span>
                                            </div>
                                            <p className="text-gray-200 text-sm">
                                                상대방의 히든 스톤을 탐지할 수 있습니다. 
                                                <br />
                                                <span className="text-gray-300 text-xs">• 아이템 사용 시 30초의 제한시간이 부여됩니다.</span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 버튼 */}
                    <div className="flex gap-3 mt-6 pt-4 border-t border-gray-600">
                        {onClose && (
                            <Button 
                                onClick={onClose} 
                                colorScheme="gray" 
                                className="flex-1"
                            >
                                취소
                            </Button>
                        )}
                        <Button 
                            onClick={onStart} 
                            colorScheme="accent" 
                            className="flex-1"
                        >
                            시작하기
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SinglePlayerGameDescriptionModal;
