import React, { useState, useMemo, useEffect } from 'react';
import DraggableWindow from '../DraggableWindow.js';
import Button from '../Button.js';
import { GameMode, ServerAction, GameSettings } from '../../types.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, RANKED_STRATEGIC_MODES, RANKED_PLAYFUL_MODES } from '../../constants/index.js';
import { RANKED_GAME_SETTINGS } from '../../constants/rankedGameSettings.js';

interface RankedMatchSelectionModalProps {
    lobbyType: 'strategic' | 'playful';
    onClose: () => void;
    onStartMatching: (selectedModes: GameMode[]) => void;
}

const GameCard: React.FC<{ 
    mode: GameMode, 
    image: string, 
    name: string,
    onToggle: (mode: GameMode) => void,
    isSelected: boolean,
}> = ({ mode, image, name, onToggle, isSelected }) => {
    const [imgError, setImgError] = useState(false);

    return (
        <div
            className={`bg-panel text-on-panel rounded-lg flex flex-col items-center text-center transition-all transform cursor-pointer relative ${
                isSelected
                    ? 'ring-2 ring-green-500 hover:-translate-y-1 shadow-lg bg-green-900/20'
                    : 'hover:-translate-y-1 shadow-lg'
            }`}
            style={{ padding: '8px', gap: '4px' }}
            onClick={() => onToggle(mode)}
        >
            {/* 체크박스 - 상단 우측에 명확하게 표시 */}
            <div className="absolute top-1 right-1 z-10 bg-green-600 rounded-full p-1 shadow-lg">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(mode)}
                    className="w-5 h-5 cursor-pointer accent-green-500"
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
            {/* 선택 표시 배지 */}
            {isSelected && (
                <div className="absolute top-1 left-1 z-10 bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-lg">
                    선택됨
                </div>
            )}
            <div 
                className="w-full flex-shrink-0 bg-tertiary rounded-md flex items-center justify-center text-tertiary overflow-hidden shadow-inner relative"
                style={{ height: '100px', marginBottom: '4px', padding: '4px' }}
            >
                {!imgError ? (
                    <img 
                        src={image} 
                        alt={name} 
                        className="w-full h-full object-contain"
                        onError={() => setImgError(true)} 
                    />
                ) : (
                    <span style={{ fontSize: '10px' }}>{name}</span>
                )}
            </div>
            <div className="flex-grow flex flex-col w-full">
                <h3 
                    className={`font-bold leading-tight ${
                        isSelected ? 'text-green-300' : 'text-primary'
                    }`}
                    style={{ fontSize: '11px', marginBottom: '2px' }}
                >
                    {name}
                </h3>
            </div>
        </div>
    );
};

const RankedMatchSelectionModal: React.FC<RankedMatchSelectionModalProps> = ({ 
    lobbyType, 
    onClose, 
    onStartMatching 
}) => {
    const availableModes = useMemo(() => {
        return lobbyType === 'strategic' ? RANKED_STRATEGIC_MODES : RANKED_PLAYFUL_MODES;
    }, [lobbyType]);

    const availableGameDefinitions = useMemo(() => {
        const allModes = lobbyType === 'strategic' ? SPECIAL_GAME_MODES : PLAYFUL_GAME_MODES;
        return allModes.filter(m => availableModes.includes(m.mode));
    }, [lobbyType, availableModes]);

    const [selectedModes, setSelectedModes] = useState<GameMode[]>([]);
    const [selectedMode, setSelectedMode] = useState<GameMode | null>(null);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const [windowHeight, setWindowHeight] = useState(window.innerHeight);

    // 우선순위 조정 함수들
    const moveModeUp = (mode: GameMode) => {
        setSelectedModes(prev => {
            const index = prev.indexOf(mode);
            if (index <= 0) return prev;
            const newModes = [...prev];
            [newModes[index - 1], newModes[index]] = [newModes[index], newModes[index - 1]];
            return newModes;
        });
    };

    const moveModeDown = (mode: GameMode) => {
        setSelectedModes(prev => {
            const index = prev.indexOf(mode);
            if (index < 0 || index >= prev.length - 1) return prev;
            const newModes = [...prev];
            [newModes[index], newModes[index + 1]] = [newModes[index + 1], newModes[index]];
            return newModes;
        });
    };
    
    useEffect(() => {
        const handleResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    const isMobile = windowWidth < 768;
    const calculatedWidth = Math.max(800, Math.min(1200, windowWidth * 0.85));
    const calculatedHeight = Math.max(600, Math.min(900, windowHeight * 0.8));
    const mobileTextScale = isMobile ? 0.85 : 1.0;

    const selectedGameDefinition = useMemo(() => {
        return availableGameDefinitions.find(mode => mode.mode === selectedMode);
    }, [availableGameDefinitions, selectedMode]);

    const handleModeToggle = (mode: GameMode) => {
        setSelectedModes(prev => 
            prev.includes(mode) 
                ? prev.filter(m => m !== mode)
                : [...prev, mode]
        );
        // 상세 정보 표시를 위해 선택된 모드 중 하나를 selectedMode로 설정
        if (!selectedModes.includes(mode)) {
            setSelectedMode(mode);
        } else if (selectedMode === mode) {
            // 선택 해제된 모드가 현재 상세 정보로 표시된 모드면 다른 선택된 모드로 변경
            const remaining = selectedModes.filter(m => m !== mode);
            setSelectedMode(remaining.length > 0 ? remaining[0] : null);
        }
    };

    const handleStartMatching = () => {
        if (selectedModes.length === 0) {
            alert('최소 1개 이상의 게임 모드를 선택해주세요.');
            return;
        }
        onStartMatching(selectedModes);
    };

    const renderRankedSettings = (mode: GameMode) => {
        const settings = RANKED_GAME_SETTINGS[mode];
        if (!settings) return null;

        const items: { label: string; value: string }[] = [];

        if (settings.boardSize) {
            items.push({ label: '판 크기', value: `${settings.boardSize}줄` });
        }
        if (settings.timeLimit > 0) {
            items.push({ label: '제한시간', value: `${settings.timeLimit}분` });
        }
        if (settings.byoyomiTime > 0 && settings.byoyomiCount > 0) {
            items.push({ label: '초읽기', value: `${settings.byoyomiTime}초 × ${settings.byoyomiCount}회` });
        }
        if (settings.timeIncrement && settings.timeIncrement > 0) {
            items.push({ label: '시간 추가', value: `피셔 방식 ${settings.timeIncrement}초` });
        }
        if (settings.captureTarget) {
            items.push({ label: '따내기 목표', value: `${settings.captureTarget}점` });
        }
        if (settings.hiddenStoneCount) {
            items.push({ label: '히든 아이템', value: `${settings.hiddenStoneCount}개` });
        }
        if (settings.scanCount) {
            items.push({ label: '스캔 아이템', value: `${settings.scanCount}개` });
        }
        if (settings.missileCount) {
            items.push({ label: '미사일 아이템', value: `${settings.missileCount}개` });
        }
        if (settings.diceGoRounds) {
            items.push({ label: '라운드', value: `${settings.diceGoRounds}라운드` });
        }
        if (settings.has33Forbidden !== undefined) {
            items.push({ label: '쌍삼 금지', value: settings.has33Forbidden ? '적용' : '미적용' });
        }
        if (settings.hasOverlineForbidden !== undefined) {
            items.push({ label: '장목 금지', value: settings.hasOverlineForbidden ? '적용' : '미적용' });
        }
        if (settings.alkkagiRounds) {
            items.push({ label: '라운드', value: `${settings.alkkagiRounds}라운드` });
        }
        if (settings.alkkagiStoneCount) {
            items.push({ label: '배치 개수', value: `${settings.alkkagiStoneCount}개` });
        }
        if (settings.alkkagiGaugeSpeed) {
            items.push({ label: '게이지 속도', value: `빠름 ×${settings.alkkagiGaugeSpeed}` });
        }
        if (settings.alkkagiSlowItemCount) {
            items.push({ label: '슬로우 아이템', value: `${settings.alkkagiSlowItemCount}개` });
        }
        if (settings.alkkagiAimingLineItemCount) {
            items.push({ label: '조준선 아이템', value: `${settings.alkkagiAimingLineItemCount}개` });
        }
        if (settings.curlingRounds) {
            items.push({ label: '라운드', value: `${settings.curlingRounds}라운드` });
        }
        if (settings.curlingStoneCount) {
            items.push({ label: '스톤 개수', value: `${settings.curlingStoneCount}개` });
        }
        if (settings.curlingGaugeSpeed) {
            items.push({ label: '게이지 속도', value: `빠름 ×${settings.curlingGaugeSpeed}` });
        }
        if (settings.curlingSlowItemCount) {
            items.push({ label: '슬로우 아이템', value: `${settings.curlingSlowItemCount}개` });
        }
        if (settings.curlingAimingLineItemCount) {
            items.push({ label: '조준선 아이템', value: `${settings.curlingAimingLineItemCount}개` });
        }
        if (settings.autoScoring) {
            items.push({ label: '자동 계가', value: '서로 통과시 계가' });
        }

        // 클래식바둑 특별 처리
        if (mode === GameMode.Standard) {
            items.push({ label: '랭킹 점수', value: '승리시 2배, 패배시 절반' });
        }

        return items;
    };

    return (
        <DraggableWindow 
            title="랭킹전 게임 선택" 
            onClose={onClose} 
            windowId="ranked-match-selection" 
            initialWidth={calculatedWidth} 
            initialHeight={calculatedHeight}
            isTopmost
        >
            <div className="flex h-full">
                {/* Left Panel: Game Selection */}
                <div className={`w-1/3 bg-tertiary/30 ${isMobile ? 'p-2' : 'p-4'} flex flex-col text-on-panel rounded-l-lg border-r border-gray-700`}>
                    <h3 className="font-bold text-green-300 mb-3" style={{ fontSize: `${Math.max(12, Math.round(16 * mobileTextScale))}px` }}>
                        게임 종류 선택 (다중 선택 가능)
                    </h3>
                    
                    {/* 모든 게임들 표시 (선택 여부와 관계없이) */}
                    <div className="flex-1 grid grid-cols-2 gap-2 overflow-y-auto pr-2">
                        {availableGameDefinitions.map((game) => {
                            const isSelected = selectedModes.includes(game.mode);
                            return (
                                <div key={game.mode} className="relative">
                                    <GameCard
                                        mode={game.mode}
                                        image={game.image}
                                        name={game.name}
                                        onToggle={handleModeToggle}
                                        isSelected={isSelected}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-700">
                        <p className="text-xs text-gray-400">
                            선택된 게임: {selectedModes.length}개
                        </p>
                    </div>
                </div>

                {/* Right Panel: Priority List, Game Description and Settings */}
                <div className={`w-2/3 bg-primary ${isMobile ? 'p-2' : 'p-4'} flex flex-col rounded-r-lg overflow-y-auto`}>
                    {/* 우선순위 목록 - 오른쪽 제일 위에 표시 */}
                    {selectedModes.length > 0 && (
                        <div className="mb-4 flex-1 min-h-0 flex flex-col">
                            <h4 className="font-semibold text-yellow-300 mb-2 flex-shrink-0" style={{ fontSize: `${Math.max(12, Math.round(14 * mobileTextScale))}px` }}>
                                선택된 게임 우선순위 (1순위가 가장 높음)
                            </h4>
                            <div className="bg-gray-900/50 border border-yellow-700/50 rounded-lg p-3 flex-1 min-h-0 flex flex-col">
                                <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
                                    {selectedModes.map((mode, index) => {
                                        const gameDef = availableGameDefinitions.find(g => g.mode === mode);
                                        if (!gameDef) return null;
                                        
                                        return (
                                            <div 
                                                key={mode} 
                                                className="flex items-center gap-2 bg-gray-800/70 rounded-lg p-2 border border-gray-700 hover:border-green-500 transition-colors"
                                            >
                                                {/* 우선순위 번호 */}
                                                <div className="flex-shrink-0 w-7 h-7 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                                                    {index + 1}
                                                </div>
                                                
                                                {/* 게임 이미지 */}
                                                <img 
                                                    src={gameDef.image} 
                                                    alt={gameDef.name}
                                                    className="w-10 h-10 object-contain flex-shrink-0"
                                                />
                                                
                                                {/* 게임 이름 */}
                                                <span className="flex-grow text-sm text-white font-medium">
                                                    {gameDef.name}
                                                </span>
                                                
                                                {/* 우선순위 조정 및 취소 버튼 */}
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {/* 우선순위 조정 버튼 */}
                                                    <div className="flex flex-col gap-1">
                                                        <button
                                                            onClick={() => moveModeUp(mode)}
                                                            disabled={index === 0}
                                                            className={`w-6 h-6 flex items-center justify-center rounded ${
                                                                index === 0 
                                                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                                                                    : 'bg-green-600 hover:bg-green-500 text-white'
                                                            }`}
                                                            style={{ fontSize: '11px' }}
                                                            title="우선순위 올리기"
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            onClick={() => moveModeDown(mode)}
                                                            disabled={index === selectedModes.length - 1}
                                                            className={`w-6 h-6 flex items-center justify-center rounded ${
                                                                index === selectedModes.length - 1 
                                                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                                                                    : 'bg-green-600 hover:bg-green-500 text-white'
                                                            }`}
                                                            style={{ fontSize: '11px' }}
                                                            title="우선순위 내리기"
                                                        >
                                                            ↓
                                                        </button>
                                                    </div>
                                                    {/* 선택 취소 버튼 */}
                                                    <button
                                                        onClick={() => handleModeToggle(mode)}
                                                        className="w-6 h-6 flex items-center justify-center rounded bg-red-600 hover:bg-red-500 text-white"
                                                        style={{ fontSize: '12px' }}
                                                        title="선택 취소"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-yellow-300 mt-2 pt-2 border-t border-gray-700 flex-shrink-0">
                                    💡 우선순위는 위아래 버튼으로 조정하거나, 선택 취소(×)로 제거할 수 있습니다.
                                </p>
                            </div>
                        </div>
                    )}
                    {selectedGameDefinition ? (
                        <div className={`flex gap-4 ${isMobile ? 'flex-col' : 'flex-row'} flex-shrink-0`} style={{ maxHeight: '40%' }}>
                            {/* Game Info - 왼쪽 */}
                            <div className={`bg-gray-900/50 rounded-lg border border-gray-700 ${isMobile ? 'p-2' : 'p-3'} ${isMobile ? 'w-full' : 'w-1/2'} flex-shrink-0 flex flex-col`}>
                                <div className="flex items-center gap-3 mb-3">
                                    <img 
                                        src={selectedGameDefinition.image} 
                                        alt={selectedGameDefinition.name}
                                        className="w-16 h-16 object-contain"
                                    />
                                    <div>
                                        <h3 className="font-bold text-green-300" style={{ fontSize: `${Math.max(14, Math.round(18 * mobileTextScale))}px` }}>
                                            {selectedGameDefinition.name}
                                        </h3>
                                        <p className="text-xs text-gray-400">
                                            {selectedModes.includes(selectedGameDefinition.mode) ? '✓ 선택됨' : '선택되지 않음'}
                                        </p>
                                    </div>
                                </div>
                                <div className="border-t border-gray-700 pt-3 mt-3 flex-1">
                                    <h4 className="font-semibold text-gray-300 mb-2" style={{ fontSize: `${Math.max(10, Math.round(12 * mobileTextScale))}px` }}>
                                        게임 설명
                                    </h4>
                                    <p className="text-tertiary leading-relaxed" style={{ fontSize: `${Math.max(9, Math.round(11 * mobileTextScale))}px` }}>
                                        {selectedGameDefinition.description || '선택된 게임에 대한 설명이 없습니다.'}
                                    </p>
                                </div>
                            </div>

                            {/* Ranked Settings - 오른쪽 */}
                            <div className={`bg-yellow-900/20 border border-yellow-700/50 rounded-lg ${isMobile ? 'p-2' : 'p-3'} ${isMobile ? 'w-full' : 'w-1/2'} flex-shrink-0 flex flex-col`}>
                                <h4 className="font-semibold text-yellow-300 mb-3 flex-shrink-0" style={{ fontSize: `${Math.max(10, Math.round(12 * mobileTextScale))}px` }}>
                                    게임 설정
                                </h4>
                                <div className="grid grid-cols-1 gap-2 overflow-y-auto flex-1">
                                    {renderRankedSettings(selectedGameDefinition.mode)?.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center text-sm">
                                            <span className="text-gray-300">{item.label}:</span>
                                            <span className="text-yellow-200 font-semibold">{item.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <p className="text-gray-400 text-center">
                                왼쪽에서 게임 모드를 선택해주세요.
                            </p>
                        </div>
                    )}

                    {/* Bottom Buttons */}
                    <div className="border-t border-gray-700 flex justify-end gap-2 mt-4 pt-4 flex-shrink-0">
                        <Button 
                            onClick={onClose} 
                            colorScheme="gray" 
                            style={{ fontSize: `${Math.max(10, Math.round(12 * mobileTextScale))}px` }}
                        >
                            취소
                        </Button>
                        <Button 
                            onClick={handleStartMatching} 
                            colorScheme="green" 
                            disabled={selectedModes.length === 0}
                            style={{ fontSize: `${Math.max(10, Math.round(12 * mobileTextScale))}px` }}
                        >
                            매칭 시작 ({selectedModes.length}개 선택)
                        </Button>
                    </div>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default RankedMatchSelectionModal;

