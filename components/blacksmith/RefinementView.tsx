
import React, { useState, useMemo } from 'react';
import { UserWithStatus, InventoryItem, ServerAction, ItemOption, CoreStat, SpecialStat, MythicStat } from '../../types.js';
import Button from '../Button.js';
import { ItemGrade } from '../../types/enums.js';
import { MAIN_STAT_DEFINITIONS, SUB_OPTION_POOLS, SPECIAL_STATS_DATA, MYTHIC_STATS_DATA, GRADE_SUB_OPTION_RULES } from '../../constants';
import { useAppContext } from '../../hooks/useAppContext.js';
import { calculateRefinementGoldCost } from '../../constants/rules.js';

// 모바일 감지 훅
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    React.useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    return isMobile;
};

interface RefinementViewProps {
    selectedItem: InventoryItem | null;
    currentUser: UserWithStatus;
    onAction: (action: ServerAction) => void;
    refinementResult: { message: string; success: boolean; itemBefore: InventoryItem; itemAfter: InventoryItem; } | null;
    onResultConfirm: () => void;
}

type RefinementType = 'type' | 'value' | 'mythic';

const RefinementView: React.FC<RefinementViewProps> = ({ selectedItem, currentUser, onAction, refinementResult, onResultConfirm }) => {
    const isMobile = useIsMobile();
    const [selectedOption, setSelectedOption] = useState<{ type: 'main' | 'combatSub' | 'specialSub' | 'mythicSub'; index: number } | null>(null);
    const [refinementType, setRefinementType] = useState<RefinementType | null>(null);
    const [isRefining, setIsRefining] = useState(false);
    const [refinementProgress, setRefinementProgress] = useState(0);

    // 등급별 소모량
    const getTicketCost = (grade: ItemGrade): number => {
        switch (grade) {
            case ItemGrade.Uncommon: return 1;
            case ItemGrade.Rare: return 2;
            case ItemGrade.Epic: return 3;
            case ItemGrade.Legendary: return 4;
            case ItemGrade.Mythic: return 5;
            default: return 1;
        }
    };

    // 보유한 변경권 개수
    const ticketCounts = useMemo(() => {
        if (!currentUser) return { type: 0, value: 0, mythic: 0 };
        const inventory = currentUser.inventory || [];
        return {
            type: inventory.filter(i => i.name === '옵션 종류 변경권').reduce((sum, i) => sum + (i.quantity || 0), 0),
            value: inventory.filter(i => i.name === '옵션 수치 변경권').reduce((sum, i) => sum + (i.quantity || 0), 0),
            mythic: inventory.filter(i => i.name === '신화 옵션 변경권').reduce((sum, i) => sum + (i.quantity || 0), 0),
        };
    }, [currentUser]);

    // 선택된 옵션 정보
    const selectedOptionData = useMemo(() => {
        if (!selectedItem || !selectedItem.options || !selectedOption) return null;
        
        const { main, combatSubs, specialSubs, mythicSubs } = selectedItem.options;
        
        if (selectedOption.type === 'main') {
            return main;
        } else if (selectedOption.type === 'combatSub') {
            return combatSubs[selectedOption.index];
        } else if (selectedOption.type === 'specialSub') {
            return specialSubs[selectedOption.index];
        } else if (selectedOption.type === 'mythicSub') {
            return mythicSubs[selectedOption.index];
        }
        return null;
    }, [selectedItem, selectedOption]);

    // 변경 가능한 옵션 종류 계산
    const availableOptions = useMemo(() => {
        if (!selectedItem || !selectedOption || !selectedOptionData) return [];
        
        const slot = selectedItem.slot!;
        const grade = selectedItem.grade;
        
        if (refinementType === 'type') {
            // 옵션 종류 변경: 장비의 종류에 맞는 다른 옵션 중 하나로 변경
            if (selectedOption.type === 'main') {
                // 주옵션 변경: 같은 슬롯의 다른 주옵션
                const slotDef = MAIN_STAT_DEFINITIONS[slot];
                const gradeDef = slotDef.options[grade];
                return gradeDef.stats.filter(stat => stat !== selectedOptionData.type);
            } else if (selectedOption.type === 'combatSub') {
                // 부옵션 변경: 같은 슬롯의 다른 부옵션
                const rules = GRADE_SUB_OPTION_RULES[grade];
                const combatTier = rules.combatTier;
                const pool = SUB_OPTION_POOLS[slot][combatTier];
                const usedTypes = new Set(selectedItem.options!.combatSubs.map(s => s.type));
                usedTypes.add(selectedItem.options!.main.type);
                return pool.filter(opt => !usedTypes.has(opt.type)).map(opt => opt.type);
            } else if (selectedOption.type === 'specialSub') {
                // 특수옵션 변경: 다른 특수옵션
                const allSpecialStats = Object.values(SpecialStat);
                const usedTypes = new Set(selectedItem.options!.specialSubs.map(s => s.type));
                return allSpecialStats.filter(stat => !usedTypes.has(stat));
            }
        } else if (refinementType === 'value') {
            // 옵션 수치 변경: 같은 옵션의 다른 수치 범위
            if (selectedOption.type === 'combatSub' || selectedOption.type === 'specialSub') {
                // 범위 내 랜덤 값 반환 (실제로는 서버에서 처리)
                return ['랜덤 수치'];
            }
        } else if (refinementType === 'mythic') {
            // 신화 옵션 변경: 다른 신화 옵션
            if (selectedOption.type === 'mythicSub') {
                const allMythicStats = Object.values(MythicStat);
                const usedTypes = new Set(selectedItem.options!.mythicSubs.map(s => s.type));
                return allMythicStats.filter(stat => stat !== selectedOptionData.type);
            }
        }
        
        return [];
    }, [selectedItem, selectedOption, selectedOptionData, refinementType]);

    // 필요한 변경권 개수
    const requiredTickets = useMemo(() => {
        if (!selectedItem) return 0;
        return getTicketCost(selectedItem.grade);
    }, [selectedItem]);

    // 필요한 골드 비용
    const requiredGold = useMemo(() => {
        if (!selectedItem) return 0;
        return calculateRefinementGoldCost(selectedItem.grade);
    }, [selectedItem]);

    // 일반 등급 장비는 제련 불가
    const canRefineAtAll = useMemo(() => {
        if (!selectedItem) return false;
        return selectedItem.grade !== ItemGrade.Normal;
    }, [selectedItem]);

    // 제련 가능 여부
    const canRefine = useMemo(() => {
        if (!selectedItem || !selectedOption || !refinementType || !canRefineAtAll) return false;
        
        // 골드 부족 체크
        if (currentUser.gold < requiredGold) return false;
        
        if (refinementType === 'type') {
            return ticketCounts.type >= requiredTickets && availableOptions.length > 0;
        } else if (refinementType === 'value') {
            return ticketCounts.value >= requiredTickets && (selectedOption.type === 'combatSub' || selectedOption.type === 'specialSub');
        } else if (refinementType === 'mythic') {
            return ticketCounts.mythic >= requiredTickets && selectedOption.type === 'mythicSub' && availableOptions.length > 0;
        }
        
        return false;
    }, [selectedItem, selectedOption, refinementType, ticketCounts, requiredTickets, availableOptions, canRefineAtAll, currentUser.gold, requiredGold]);

    const handleRefine = async () => {
        if (!canRefine || !selectedItem || !selectedOption) return;
        
        setIsRefining(true);
        setRefinementProgress(0);
        
        // 진행 바 애니메이션 (2초)
        const interval = setInterval(() => {
            setRefinementProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    return 100;
                }
                return prev + 2;
            });
        }, 40);
        
        setTimeout(async () => {
            clearInterval(interval);
            setRefinementProgress(100);
            
            // 서버 액션 호출
            await onAction({
                type: 'REFINE_EQUIPMENT',
                payload: {
                    itemId: selectedItem.id,
                    optionType: selectedOption.type,
                    optionIndex: selectedOption.index,
                    refinementType: refinementType,
                }
            });
            
            setIsRefining(false);
            setRefinementProgress(0);
            setSelectedOption(null);
            setRefinementType(null);
        }, 2000);
    };

    if (!selectedItem) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400">
                장비를 선택해주세요.
            </div>
        );
    }

    if (!selectedItem.options) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400">
                옵션이 없는 장비입니다.
            </div>
        );
    }

    if (!canRefineAtAll) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400">
                일반 등급 장비는 제련할 수 없습니다.
            </div>
        );
    }

    const { main, combatSubs, specialSubs, mythicSubs } = selectedItem.options;

    return (
        <div className="flex flex-col h-full gap-4">
            {/* 좌측: 선택된 장비 및 옵션 */}
            <div className="flex-1 grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-bold">선택된 장비</h3>
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <div className="font-bold mb-2">{selectedItem.name}</div>
                        <div className="space-y-1 text-sm">
                            <div>주옵션: {main.display}</div>
                            {combatSubs.map((sub, idx) => (
                                <div key={idx}>부옵션 {idx + 1}: {sub.display}</div>
                            ))}
                            {specialSubs.map((sub, idx) => (
                                <div key={idx}>특수옵션 {idx + 1}: {sub.display}</div>
                            ))}
                            {mythicSubs.map((sub, idx) => (
                                <div key={idx}>신화옵션 {idx + 1}: {sub.display}</div>
                            ))}
                        </div>
                    </div>
                    
                    <h3 className="text-lg font-bold mt-4">옵션 선택</h3>
                    <div className="bg-gray-800 p-4 rounded-lg space-y-2">
                        <button
                            onClick={() => setSelectedOption({ type: 'main', index: 0 })}
                            className={`w-full p-2 rounded text-left ${selectedOption?.type === 'main' ? 'bg-blue-600' : 'bg-gray-700'}`}
                        >
                            주옵션: {main.display}
                        </button>
                        {combatSubs.map((sub, idx) => (
                            <button
                                key={idx}
                                onClick={() => setSelectedOption({ type: 'combatSub', index: idx })}
                                className={`w-full p-2 rounded text-left ${selectedOption?.type === 'combatSub' && selectedOption.index === idx ? 'bg-blue-600' : 'bg-gray-700'}`}
                            >
                                부옵션 {idx + 1}: {sub.display}
                            </button>
                        ))}
                        {specialSubs.map((sub, idx) => (
                            <button
                                key={idx}
                                onClick={() => setSelectedOption({ type: 'specialSub', index: idx })}
                                className={`w-full p-2 rounded text-left ${selectedOption?.type === 'specialSub' && selectedOption.index === idx ? 'bg-blue-600' : 'bg-gray-700'}`}
                            >
                                특수옵션 {idx + 1}: {sub.display}
                            </button>
                        ))}
                        {mythicSubs.map((sub, idx) => (
                            <button
                                key={idx}
                                onClick={() => setSelectedOption({ type: 'mythicSub', index: idx })}
                                className={`w-full p-2 rounded text-left ${selectedOption?.type === 'mythicSub' && selectedOption.index === idx ? 'bg-blue-600' : 'bg-gray-700'}`}
                            >
                                신화옵션 {idx + 1}: {sub.display}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 우측: 변경 결과 및 재료 */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-bold">제련 정보</h3>
                    {selectedOption && (
                        <div className="bg-gray-800 p-4 rounded-lg space-y-4">
                            <div>
                                <div className="font-bold mb-2">선택된 옵션</div>
                                <div>{selectedOptionData?.display || 'N/A'}</div>
                            </div>
                            
                            <div>
                                <div className="font-bold mb-2">제련 타입 선택</div>
                                <div className="space-y-2">
                                    {(selectedOption.type === 'main' || selectedOption.type === 'combatSub' || selectedOption.type === 'specialSub') && (
                                        <>
                                            <button
                                                onClick={() => setRefinementType('type')}
                                                className={`w-full p-2 rounded ${refinementType === 'type' ? 'bg-green-600' : 'bg-gray-700'}`}
                                            >
                                                종류 변경
                                            </button>
                                            {(selectedOption.type === 'combatSub' || selectedOption.type === 'specialSub') && (
                                                <button
                                                    onClick={() => setRefinementType('value')}
                                                    className={`w-full p-2 rounded ${refinementType === 'value' ? 'bg-green-600' : 'bg-gray-700'}`}
                                                >
                                                    수치 변경
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {selectedOption.type === 'mythicSub' && (
                                        <button
                                            onClick={() => setRefinementType('mythic')}
                                            className={`w-full p-2 rounded ${refinementType === 'mythic' ? 'bg-green-600' : 'bg-gray-700'}`}
                                        >
                                            신화 옵션 변경
                                        </button>
                                    )}
                                </div>
                            </div>

                            {refinementType && (
                                <>
                                    <div>
                                        <div className="font-bold mb-2">변경 가능한 옵션</div>
                                        <div className="bg-gray-900 p-2 rounded text-sm">
                                            {availableOptions.length > 0 ? (
                                                <div>랜덤 선택: {availableOptions.length}개 옵션 중 1개</div>
                                            ) : (
                                                <div className="text-red-400">변경 가능한 옵션이 없습니다.</div>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="font-bold mb-2">필요한 재료</div>
                                        <div className="space-y-1 text-sm">
                                            {refinementType === 'type' && (
                                                <div>옵션 종류 변경권 x{requiredTickets} (보유: {ticketCounts.type})</div>
                                            )}
                                            {refinementType === 'value' && (
                                                <div>옵션 수치 변경권 x{requiredTickets} (보유: {ticketCounts.value})</div>
                                            )}
                                            {refinementType === 'mythic' && (
                                                <div>신화 옵션 변경권 x{requiredTickets} (보유: {ticketCounts.mythic})</div>
                                            )}
                                            <div className={`mt-2 ${currentUser.gold < requiredGold ? 'text-red-400' : 'text-yellow-300'}`}>
                                                골드: {requiredGold.toLocaleString()} (보유: {currentUser.gold.toLocaleString()})
                                            </div>
                                        </div>
                                    </div>

                                    {isRefining && (
                                        <div className="mt-4">
                                            <div className="w-full bg-gray-700 rounded-full h-4">
                                                <div
                                                    className="bg-blue-600 h-4 rounded-full transition-all duration-100"
                                                    style={{ width: `${refinementProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <Button
                                        onClick={handleRefine}
                                        disabled={!canRefine || isRefining}
                                        className="w-full mt-4"
                                    >
                                        제련하기
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
            
            {/* 제련 결과 모달 */}
            {refinementResult && (
                <div className="absolute inset-0 bg-gray-900/80 rounded-lg flex flex-col items-center justify-center z-20 animate-fade-in p-4">
                    <div className="text-6xl mb-4 animate-bounce">🎉</div>
                    <h2 className="text-3xl font-bold text-green-400">제련 완료!</h2>
                    <p className="text-gray-300 mt-2 text-center">{refinementResult.message}</p>
                    {refinementResult.success && (
                        <div className="bg-gray-800/50 p-3 rounded-lg mt-4 w-full max-w-sm text-xs space-y-1">
                            <h4 className="font-bold text-center text-yellow-300 mb-2">변경 사항</h4>
                            {refinementResult.itemBefore.options && refinementResult.itemAfter.options && (
                                <>
                                    {refinementResult.itemBefore.options.main.type !== refinementResult.itemAfter.options.main.type && (
                                        <div className="flex justify-between">
                                            <span>주옵션:</span>
                                            <span className="truncate">{refinementResult.itemBefore.options.main.display} → {refinementResult.itemAfter.options.main.display}</span>
                                        </div>
                                    )}
                                    {refinementResult.itemBefore.options.combatSubs[0]?.type !== refinementResult.itemAfter.options.combatSubs[0]?.type && (
                                        <div className="flex justify-between text-green-300">
                                            <span>부옵션 변경:</span>
                                            <span className="truncate">{refinementResult.itemBefore.options.combatSubs[0]?.display} → {refinementResult.itemAfter.options.combatSubs[0]?.display}</span>
                                        </div>
                                    )}
                                    {refinementResult.itemBefore.options.specialSubs[0]?.type !== refinementResult.itemAfter.options.specialSubs[0]?.type && (
                                        <div className="flex justify-between text-green-300">
                                            <span>특수옵션 변경:</span>
                                            <span className="truncate">{refinementResult.itemBefore.options.specialSubs[0]?.display} → {refinementResult.itemAfter.options.specialSubs[0]?.display}</span>
                                        </div>
                                    )}
                                    {refinementResult.itemBefore.options.mythicSubs[0]?.type !== refinementResult.itemAfter.options.mythicSubs[0]?.type && (
                                        <div className="flex justify-between text-green-300">
                                            <span>신화옵션 변경:</span>
                                            <span className="truncate">{refinementResult.itemBefore.options.mythicSubs[0]?.display} → {refinementResult.itemAfter.options.mythicSubs[0]?.display}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <Button onClick={onResultConfirm} colorScheme="green" className="mt-6 w-full max-w-sm">확인</Button>
                </div>
            )}
        </div>
    );
};

export default RefinementView;

