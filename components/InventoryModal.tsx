import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { UserWithStatus, InventoryItem, ServerAction, InventoryItemType, ItemGrade, ItemOption, CoreStat, SpecialStat, MythicStat, EquipmentSlot, ItemOptionType } from '../types.js';
import DraggableWindow from './DraggableWindow.js';
import Button from './Button.js';
import ResourceActionButton from './ui/ResourceActionButton.js';
import { emptySlotImages, GRADE_LEVEL_REQUIREMENTS, ITEM_SELL_PRICES, MATERIAL_SELL_PRICES, gradeBackgrounds, gradeStyles, BASE_SLOTS_PER_CATEGORY, EXPANSION_AMOUNT, MAX_EQUIPMENT_SLOTS, MAX_CONSUMABLE_SLOTS, MAX_MATERIAL_SLOTS, ENHANCEMENT_COSTS, CONSUMABLE_ITEMS, MATERIAL_ITEMS } from '../constants/items';

import { calculateUserEffects } from '../services/effectService.js';
import { calculateTotalStats } from '../services/statService.js';
import { useAppContext } from '../hooks/useAppContext.js';
import PurchaseQuantityModal from './PurchaseQuantityModal.js';
import SellItemConfirmModal from './SellItemConfirmModal.js';
import SellMaterialBulkModal from './SellMaterialBulkModal.js';
import UseQuantityModal from './UseQuantityModal.js';

interface InventoryModalProps {
    currentUser: UserWithStatus;
    onClose: () => void;
    onAction: (action: ServerAction) => void;
    onStartEnhance: (item: InventoryItem) => void;
    enhancementAnimationTarget: { itemId: string; stars: number } | null;
    onAnimationComplete: () => void;
    isTopmost?: boolean;
}

type Tab = 'all' | 'equipment' | 'consumable' | 'material';
type SortKey = 'createdAt' | 'type' | 'grade';

const TAB_LABELS: Record<Tab, string> = {
    all: '전체',
    equipment: '장비',
    consumable: '소모품',
    material: '재료',
};

const calculateExpansionCost = (currentCategorySlots: number): number => {
    const expansionsMade = Math.max(0, (currentCategorySlots - BASE_SLOTS_PER_CATEGORY) / EXPANSION_AMOUNT);
    return 100 + (expansionsMade * 20);
};

const gradeOrder: Record<ItemGrade, number> = {
    normal: 0,
    uncommon: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
    mythic: 5,
};

const getStarDisplayInfo = (stars: number) => {
    if (stars >= 10) {
        return { text: `(★${stars})`, colorClass: "prism-text-effect" };
    } else if (stars >= 7) {
        return { text: `(★${stars})`, colorClass: "text-purple-400" };
    } else if (stars >= 4) {
        return { text: `(★${stars})`, colorClass: "text-amber-400" };
    } else if (stars >= 1) {
        return { text: `(★${stars})`, colorClass: "text-white" };
    }
    return { text: "", colorClass: "text-white" };
};

const EquipmentSlotDisplay: React.FC<{ 
    slot: EquipmentSlot; 
    item?: InventoryItem; 
    scaleFactor?: number;
    onClick?: () => void;
    isSelected?: boolean;
}> = ({ slot, item, scaleFactor = 1, onClick, isSelected = false }) => {
    const renderStarDisplay = (stars: number) => {
        if (stars === 0) return null;

        let starImage = '';
        let numberColor = '';

        if (stars >= 10) {
            starImage = '/images/equipments/Star4.png';
            numberColor = "prism-text-effect";
        } else if (stars >= 7) {
            starImage = '/images/equipments/Star3.png';
            numberColor = "text-purple-400";
        } else if (stars >= 4) {
            starImage = '/images/equipments/Star2.png';
            numberColor = "text-amber-400";
        } else if (stars >= 1) {
            starImage = '/images/equipments/Star1.png';
            numberColor = "text-white";
        }

        const starSize = Math.max(8, Math.round(10 * scaleFactor));
        const fontSize = Math.max(8, Math.round(10 * scaleFactor));
        const gap = Math.max(2, Math.round(2 * scaleFactor));
        const padding = Math.max(2, Math.round(2 * scaleFactor));
        const innerPadding = Math.max(4, Math.round(6 * scaleFactor));

        return (
            <div 
                className="absolute flex items-center bg-black/40 rounded-bl-md z-10" 
                style={{ 
                    textShadow: '1px 1px 2px black',
                    top: `${innerPadding}px`,
                    right: `${innerPadding}px`,
                    gap: `${gap}px`,
                    padding: `${padding}px`
                }}
            >
                <img src={starImage} alt="star" style={{ width: `${starSize}px`, height: `${starSize}px` }} />
                <span className={`font-bold leading-none ${numberColor}`} style={{ fontSize: `${fontSize}px` }}>{stars}</span>
            </div>
        );
    };

    if (item) {
        const padding = Math.max(4, Math.round(6 * scaleFactor));
        const borderWidth = Math.max(1, Math.round(2 * scaleFactor));
        const isDivineMythic = item.isDivineMythic === true;
        return (
            <div
                className={`relative aspect-square rounded-lg bg-tertiary/50 ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-accent/70' : ''} ${isSelected ? 'ring-2 ring-accent' : 'ring-1 ring-transparent'} ${isDivineMythic ? 'divine-mythic-border' : ''}`}
                title={item.name}
                onClick={onClick}
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    minWidth: 0, 
                    minHeight: 0, 
                    maxWidth: '100%', 
                    maxHeight: '100%',
                    border: isDivineMythic ? undefined : `${borderWidth}px solid rgba(255, 255, 255, 0.1)`,
                    boxSizing: 'border-box'
                }}
            >
                <img 
                    src={gradeBackgrounds[item.grade]} 
                    alt={item.grade} 
                    className="absolute inset-0 object-cover rounded-md" 
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        maxWidth: '100%', 
                        maxHeight: '100%',
                        objectFit: 'cover'
                    }} 
                />
                {(() => {
                    // 이미지 경로 찾기: item.image가 있으면 사용, 없으면 CONSUMABLE_ITEMS나 MATERIAL_ITEMS에서 찾기
                    const imagePath = item.image || 
                        (CONSUMABLE_ITEMS.find(ci => ci.name === item.name || ci.name === item.name.replace('꾸러미', ' 꾸러미') || ci.name === item.name.replace(' 꾸러미', '꾸러미'))?.image) ||
                        (MATERIAL_ITEMS[item.name]?.image) ||
                        (MATERIAL_ITEMS[item.name.replace('꾸러미', ' 꾸러미')]?.image) ||
                        (MATERIAL_ITEMS[item.name.replace(' 꾸러미', '꾸러미')]?.image);
                    
                    return imagePath ? (
                        <img 
                            src={imagePath} 
                            alt={item.name} 
                            className="absolute object-contain" 
                            style={{ 
                                width: '80%', 
                                height: '80%', 
                                padding: `${padding}px`, 
                                maxWidth: '80%', 
                                maxHeight: '80%',
                                boxSizing: 'border-box',
                                objectFit: 'contain',
                                left: '50%',
                                top: '50%',
                                transform: 'translate(-50%, -50%)'
                            }}
                            onError={(e) => {
                                console.error(`[EquipmentSlotDisplay] Failed to load image: ${imagePath} for item:`, item);
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    ) : null;
                })()}
                {renderStarDisplay(item.stars)}
                {isDivineMythic && (
                    <div 
                        className="absolute flex items-center justify-center bg-black/60 rounded-tr-md z-10" 
                        style={{ 
                            textShadow: '1px 1px 2px black',
                            bottom: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                            left: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                            padding: `${Math.max(2, Math.round(3 * scaleFactor))}px ${Math.max(4, Math.round(5 * scaleFactor))}px`,
                            fontSize: `${Math.max(10, Math.round(12 * scaleFactor))}px`,
                            fontWeight: 'bold',
                            color: '#FFD700'
                        }}
                    >
                        D
                    </div>
                )}
            </div>
        );
    } else {
        const padding = Math.max(4, Math.round(6 * scaleFactor));
        const borderWidth = Math.max(1, Math.round(2 * scaleFactor));
        return (
            <div
                className={`relative aspect-square rounded-lg bg-tertiary/50 ring-1 ring-transparent`}
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    minWidth: 0, 
                    minHeight: 0, 
                    maxWidth: '100%', 
                    maxHeight: '100%',
                    border: `${borderWidth}px solid rgba(255, 255, 255, 0.1)`,
                    boxSizing: 'border-box'
                }}
            >
                {/* 배경 레이어 (장비가 있을 때와 동일한 구조) */}
                <div 
                    className="absolute inset-0 bg-tertiary/30 rounded-md" 
                    style={{ 
                        width: '100%', 
                        height: '100%',
                        maxWidth: '100%', 
                        maxHeight: '100%',
                    }} 
                />
                {/* 빈 슬롯 이미지 (장비 이미지와 동일한 스타일) */}
                <img 
                    src={emptySlotImages[slot]} 
                    alt={`${slot} empty slot`} 
                    className="relative object-contain" 
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        padding: `${padding}px`, 
                        maxWidth: '100%', 
                        maxHeight: '100%',
                        boxSizing: 'border-box',
                        objectFit: 'contain'
                    }}
                />
            </div>
        );
    }
};

const LocalItemDetailDisplay: React.FC<{
    item: InventoryItem | null | undefined;
    title: string;
    comparisonItem?: InventoryItem | null;
    scaleFactor?: number;
    userLevelSum?: number;
    mobileTextScale?: number;
    emptySlot?: EquipmentSlot | null; // 빈 슬롯일 때 슬롯 타입
}> = ({ item, title, comparisonItem, scaleFactor = 1, userLevelSum = 0, mobileTextScale = 1, emptySlot }) => {
    // item이 없을 때도 "선택 장비" 뷰어와 동일한 구조로 표시
    if (!item) {
        return (
            <div className="flex flex-col h-full" style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                {/* Top Section: Image (left), Name (right) - 선택 장비 뷰어와 동일한 구조 */}
                <div className="flex items-start justify-between mb-2">
                    {/* Left: 빈 슬롯 이미지 */}
                    {emptySlot && (
                        <div 
                            className="relative rounded-lg flex-shrink-0"
                            style={{
                                width: `${Math.max(60, Math.round(80 * scaleFactor))}px`,
                                height: `${Math.max(60, Math.round(80 * scaleFactor))}px`
                            }}
                        >
                            <EquipmentSlotDisplay slot={emptySlot} scaleFactor={scaleFactor * 0.8} />
                        </div>
                    )}
                    {/* Right: Name */}
                    <div className="flex-grow text-right ml-2">
                        <div className="flex items-baseline justify-end gap-0.5">
                            <h3 className="font-bold text-tertiary" style={{ fontSize: `${Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>{title}</h3>
                        </div>
                    </div>
                </div>

                {/* Bottom Section: Sub Options - 비워둠 */}
                <div className="w-full text-left space-y-1 bg-gray-900/50 p-2 rounded-lg flex-grow overflow-y-auto min-h-0 max-h-[200px]" style={{ fontSize: `${Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>
                    {/* 옵션 없음 */}
                </div>
            </div>
        );
    }

    const styles = gradeStyles[item.grade];

    const renderStarDisplay = (stars: number) => {
        if (stars === 0) return null;

        let starImage = '';
        let numberColor = '';

        if (stars >= 10) {
            starImage = '/images/equipments/Star4.png';
            numberColor = "prism-text-effect";
        } else if (stars >= 7) {
            starImage = '/images/equipments/Star3.png';
            numberColor = "text-purple-400";
        } else if (stars >= 4) {
            starImage = '/images/equipments/Star2.png';
            numberColor = "text-amber-400";
        } else if (stars >= 1) {
            starImage = '/images/equipments/Star1.png';
            numberColor = "text-white";
        }

        const starSize = Math.max(8, Math.round(10 * scaleFactor));
        const fontSize = Math.max(8, Math.round(10 * scaleFactor));
        const gap = Math.max(2, Math.round(2 * scaleFactor));
        const padding = Math.max(2, Math.round(2 * scaleFactor));
        const innerPadding = Math.max(4, Math.round(6 * scaleFactor));

        return (
            <div 
                className="absolute flex items-center bg-black/40 rounded-bl-md z-10" 
                style={{ 
                    textShadow: '1px 1px 2px black',
                    top: `${innerPadding}px`,
                    right: `${innerPadding}px`,
                    gap: `${gap}px`,
                    padding: `${padding}px`
                }}
            >
                <img src={starImage} alt="star" style={{ width: `${starSize}px`, height: `${starSize}px` }} />
                <span className={`font-bold leading-none ${numberColor}`} style={{ fontSize: `${fontSize}px` }}>{stars}</span>
            </div>
        );
    };

    const requiredLevel = GRADE_LEVEL_REQUIREMENTS[item.grade];
    const showRequirement = item.type === 'equipment';
    const levelRequirementMet = !showRequirement || userLevelSum >= requiredLevel;

    const getAllOptions = (invItem: InventoryItem | null | undefined): ItemOption[] => {
        if (!invItem || !invItem.options) return [];
        return [
            ...(invItem.options.main ? [invItem.options.main] : []),
            ...(invItem.options.combatSubs || []),
            ...(invItem.options.specialSubs || []),
            ...(invItem.options.mythicSubs || []),
        ].filter(Boolean) as ItemOption[];
    };

    const getOptionValue = (invItem: InventoryItem | null | undefined, optionType: ItemOptionType): number => {
        if (!invItem || !invItem.options) return 0;
        const allOptions = getAllOptions(invItem);
        const foundOption = allOptions.find(opt => opt.type === optionType);
        return foundOption ? foundOption.value : 0;
    };

    const currentItemOptions = getAllOptions(item);
    const comparisonItemOptions = getAllOptions(comparisonItem);

    const optionMap = new Map<ItemOptionType, { current?: ItemOption; comparison?: ItemOption }>();

    currentItemOptions.forEach(opt => {
        optionMap.set(opt.type, { current: opt });
    });

    comparisonItemOptions.forEach(opt => {
        const existing = optionMap.get(opt.type);
        if (existing) {
            existing.comparison = opt;
        } else {
            optionMap.set(opt.type, { comparison: opt });
        }
    });

    const sortedOptionTypes = Array.from(optionMap.keys()).sort();

    return (
        <div className="flex flex-col h-full" style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
            {/* Top Section: Image (left), Name & Main Option (right) */}
            <div className="flex items-start justify-between mb-2">
                {/* Left: Image */}
                <div 
                    className="relative rounded-lg flex-shrink-0"
                    style={{
                        width: `${Math.max(60, Math.round(80 * scaleFactor))}px`,
                        height: `${Math.max(60, Math.round(80 * scaleFactor))}px`,
                        aspectRatio: '1 / 1'
                    }}
                >
                    <img src={styles.background} alt={item.grade} className="absolute inset-0 w-full h-full object-cover rounded-lg" />
                    {(() => {
                        // 이미지 경로 찾기: item.image가 있으면 사용, 없으면 CONSUMABLE_ITEMS나 MATERIAL_ITEMS에서 찾기
                        const imagePath = item.image || 
                            (CONSUMABLE_ITEMS.find(ci => ci.name === item.name || ci.name === item.name.replace('꾸러미', ' 꾸러미') || ci.name === item.name.replace(' 꾸러미', '꾸러미'))?.image) ||
                            (MATERIAL_ITEMS[item.name]?.image) ||
                            (MATERIAL_ITEMS[item.name.replace('꾸러미', ' 꾸러미')]?.image) ||
                            (MATERIAL_ITEMS[item.name.replace(' 꾸러미', '꾸러미')]?.image);
                        
                        return imagePath ? (
                            <img 
                                src={imagePath} 
                                alt={item.name} 
                                className="absolute object-contain" 
                                style={{ 
                                    width: '80%', 
                                    height: '80%', 
                                    padding: `${Math.max(2, Math.round(4 * scaleFactor))}px`, 
                                    left: '50%', 
                                    top: '50%', 
                                    transform: 'translate(-50%, -50%)' 
                                }} 
                                onError={(e) => {
                                    console.error(`[LocalItemDetailDisplay] Failed to load image: ${imagePath} for item:`, item);
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        ) : null;
                    })()}
                    {renderStarDisplay(item.stars)}
                    {item.isDivineMythic && (
                        <div 
                            className="absolute flex items-center justify-center bg-black/60 rounded-tr-md z-10" 
                            style={{ 
                                textShadow: '1px 1px 2px black',
                                bottom: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                                left: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                                padding: `${Math.max(2, Math.round(3 * scaleFactor))}px ${Math.max(4, Math.round(5 * scaleFactor))}px`,
                                fontSize: `${Math.max(10, Math.round(12 * scaleFactor))}px`,
                                fontWeight: 'bold',
                                color: '#FFD700'
                            }}
                        >
                            D
                        </div>
                    )}
                </div>
                {/* Right: Name & Main Option */}
                <div className="flex-grow text-right ml-2">
                    <div className="flex items-baseline justify-end gap-0.5">
                        <h3 className={`font-bold ${styles.color}`} style={{ fontSize: `${Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>{item.name}</h3>
                    </div>
                    <div className="flex items-center justify-end gap-2 mt-0.5" style={{ fontSize: `${Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>
                        <span className={styles.color}>[{styles.name}]</span>
                        {showRequirement && (
                            <span className={`${levelRequirementMet ? 'text-gray-300' : 'text-red-400'} whitespace-nowrap`} style={{ fontSize: `${Math.max(9, Math.round(10 * scaleFactor * mobileTextScale))}px` }}>
                                착용 레벨 {requiredLevel}
                            </span>
                        )}
                    </div>
                    {item.options?.main && ( // Only display main option if it exists
                        <p className="font-semibold text-yellow-300 flex justify-between items-center" style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                            <span>
                                {item.options.main.display}
                                {/* display에 이미 범위값이 포함되어 있으면 추가하지 않음 */}
                                {item.options.main.range && !item.options.main.display.includes('[') && ` [${item.options.main.range[0]}~${item.options.main.range[1]}]`}
                            </span>
                            {comparisonItem && item.options.main.type && (
                                (() => {
                                    const comparisonValue = getOptionValue(comparisonItem, item.options.main.type);
                                    const difference = item.options.main.value - comparisonValue;
                                    const differenceText = difference > 0 ? ` (+${difference})` : (difference < 0 ? ` (${difference})` : '');
                                    const differenceColorClass = difference > 0 ? 'text-green-400' : (difference < 0 ? 'text-red-400' : '');
                                    return difference !== 0 && <span className={`font-bold ${differenceColorClass} text-right`}>{differenceText}</span>;
                                })()
                            )}
                        </p>
                    )}
                </div>
            </div>

            {/* Bottom Section: Sub Options */}
            <div className="w-full text-left space-y-1 bg-gray-900/50 p-2 rounded-lg flex-grow overflow-y-auto min-h-0 max-h-[200px]" style={{ fontSize: `${Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>
                {sortedOptionTypes.map(type => {
                    const { current, comparison } = optionMap.get(type)!;

                    // Skip main option as it's handled in the top section
                    if (item.options?.main?.type === type) return null;

                    if (current && comparison) {
                        // Stat exists in both, show difference
                        const difference = current.value - comparison.value;
                        const differenceText = difference > 0 ? ` (+${difference})` : (difference < 0 ? ` (${difference})` : '');
                        const differenceColorClass = difference > 0 ? 'text-green-400' : (difference < 0 ? 'text-red-400' : '');
                        let colorClass = 'text-blue-300'; // Default for combat subs
                        if (Object.values(SpecialStat).includes(current.type as SpecialStat)) colorClass = 'text-green-300';
                        if (Object.values(MythicStat).includes(current.type as MythicStat)) colorClass = 'text-orange-400';

                        // display에 이미 범위값이 포함되어 있으면 추가하지 않음
                        const rangeText = current.range && !current.display.includes('[') ? ` [${current.range[0]}~${current.range[1]}]` : '';
                        return (
                            <p key={type} className={`${colorClass} flex justify-between items-center`}>
                                <span>
                                    {current.display}{rangeText}
                                </span>
                                {difference !== 0 && (
                                    <span className={`font-bold ${differenceColorClass} text-right`}>{differenceText}</span>
                                )}
                            </p>
                        );
                    } else if (current && !comparison) {
                        // Stat is new
                        let colorClass = 'text-green-400';
                        if (Object.values(SpecialStat).includes(current.type as SpecialStat)) colorClass = 'text-green-300';
                        if (Object.values(MythicStat).includes(current.type as MythicStat)) colorClass = 'text-orange-400';
                        // display에 이미 범위값이 포함되어 있으면 추가하지 않음
                        const rangeText = current.range && !current.display.includes('[') ? ` [${current.range[0]}~${current.range[1]}]` : '';
                        return (
                            <p key={type} className={`${colorClass} flex justify-between items-center`}>
                                <span>
                                    {current.display}{rangeText}
                                </span> <span className="font-bold text-right">(New)</span>
                            </p>
                        );
                    } else if (!current && comparison) {
                        // Stat is removed
                        let colorClass = 'text-red-400';
                        if (Object.values(SpecialStat).includes(comparison.type as SpecialStat)) colorClass = 'text-green-300';
                        if (Object.values(MythicStat).includes(comparison.type as MythicStat)) colorClass = 'text-orange-400';
                        // display에 이미 범위값이 포함되어 있으면 추가하지 않음
                        const rangeText = comparison.range && !comparison.display.includes('[') ? ` [${comparison.range[0]}~${comparison.range[1]}]` : '';
                        return (
                            <p key={type} className={`${colorClass} line-through flex justify-between items-center`}>
                                <span>{comparison.display}{rangeText}</span>
                            </p>
                        );
                    }
                    return null;
                })}
            </div>
        </div>
    );
};

const EQUIPMENT_SLOTS: EquipmentSlot[] = ['fan', 'board', 'top', 'bottom', 'bowl', 'stones'];

const InventoryModal: React.FC<InventoryModalProps> = ({ currentUser: propCurrentUser, onClose, onAction, onStartEnhance, enhancementAnimationTarget, onAnimationComplete, isTopmost }) => {
    const { presets, handlers, currentUserWithStatus, updateTrigger } = useAppContext();
    
    // useAppContext의 currentUserWithStatus를 우선 사용 (최신 상태 보장)
    const currentUser = currentUserWithStatus || propCurrentUser;

    const { inventorySlots = { equipment: 30, consumable: 10, material: 10 } } = currentUser;
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('all');
    const [sortKey, setSortKey] = useState<SortKey>('createdAt');
    const [selectedPreset, setSelectedPreset] = useState(0);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [showUseQuantityModal, setShowUseQuantityModal] = useState(false);
    const [itemToUseBulk, setItemToUseBulk] = useState<InventoryItem | null>(null);
    const [itemToSell, setItemToSell] = useState<InventoryItem | null>(null);
    const [itemToSellBulk, setItemToSellBulk] = useState<InventoryItem | null>(null);
    const [isExpandModalOpen, setIsExpandModalOpen] = useState(false);
    
    // 브라우저 크기 감지
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const [windowHeight, setWindowHeight] = useState(window.innerHeight);
    
    useEffect(() => {
        const handleResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // 뷰포트 크기에 비례한 창 크기 계산 (85% 너비, 최소 400px, 최대 950px)
    // 브라우저가 작아질수록 창도 함께 작아지도록 비율 기반 계산
    const calculatedWidth = useMemo(() => {
        // 데스크톱에서는 고정 크기 사용 (최소 1100px), 모바일에서만 화면 비율 사용
        if (windowWidth >= 768) {
            return Math.max(1100, Math.min(1200, windowWidth * 0.9)); // 데스크톱: 1100-1200px
        }
        const baseWidth = windowWidth * 0.85;
        return Math.max(400, Math.min(950, baseWidth));
    }, [windowWidth]);
    
    // 뷰포트 크기에 비례한 창 높이 계산 (90% 높이, 최소 520px, 최대 1000px) - 인벤토리 슬롯 2줄 이상 보이도록
    const calculatedHeight = useMemo(() => {
        // 데스크톱에서는 고정 크기 사용 (최소 800px), 모바일에서만 화면 비율 사용
        if (windowWidth >= 768) {
            return Math.max(800, Math.min(900, windowHeight * 0.85)); // 데스크톱: 800-900px
        }
        const baseHeight = windowHeight * 0.90;
        return Math.max(520, Math.min(1000, baseHeight));
    }, [windowHeight, windowWidth]);
    
    // 모바일 감지 (768px 이하를 모바일로 간주)
    const isMobile = useMemo(() => windowWidth < 768, [windowWidth]);
    
    // 창 크기에 비례한 스케일 팩터 계산 (기준: 950px 너비)
    // 모바일에서는 PC 레이아웃을 그대로 유지하되, 전체적으로 축소
    const baseWidth = 950;
    const scaleFactor = useMemo(() => {
        if (isMobile) {
            // 모바일: PC 레이아웃을 그대로 축소 (최소 0.35, 최대 0.5)
            const rawScale = calculatedWidth / baseWidth;
            return Math.max(0.35, Math.min(0.5, rawScale));
        }
        const rawScale = calculatedWidth / baseWidth;
        return Math.max(0.4, Math.min(1.0, rawScale));
    }, [calculatedWidth, isMobile]);
    
    // 모바일 텍스트 크기 조정 팩터 (모바일에서는 텍스트를 약간 더 크게)
    const mobileTextScale = useMemo(() => {
        return isMobile ? 1.1 : 1.0;
    }, [isMobile]);

    const handlePresetChange = (presetIndex: number) => {
        setSelectedPreset(presetIndex);
        const preset = presets[presetIndex];
        // 프리셋이 있으면 적용하고, 없으면(빈 프리셋) 빈 장비 세트를 적용
        handlers.applyPreset(preset || { name: presets[presetIndex]?.name || `프리셋 ${presetIndex + 1}`, equipment: {} });
    };

    const selectedItem = useMemo(() => {
        if (!selectedItemId) return null;
        // 현재 인벤토리에서 아이템이 사라졌을 경우 선택 해제
        const found = currentUser.inventory.find(item => item.id === selectedItemId);
        if (!found && selectedItemId) {
            // 아이템이 사라진 경우 선택 해제 (다음 렌더링에서 처리)
            setTimeout(() => setSelectedItemId(null), 0);
        }
        return found || null;
    }, [selectedItemId, currentUser.inventory, updateTrigger]);

    const expansionCost = useMemo(() => {
        if (activeTab === 'all') return 0;
        const currentSlotsForCategory = inventorySlots?.[activeTab] ?? BASE_SLOTS_PER_CATEGORY;
        return calculateExpansionCost(currentSlotsForCategory);
    }, [activeTab, inventorySlots]);

    const { coreStatBonuses } = useMemo(() => calculateUserEffects(currentUser), [currentUser]);

    const enhancementMaterialDetails = useMemo(() => {
        if (!selectedItem || selectedItem.type !== 'material') return [];
        const groupedDetails: Record<ItemGrade, number[]> = {
            normal: [],
            uncommon: [],
            rare: [],
            epic: [],
            legendary: [],
            mythic: [],
        };

        for (const grade in ENHANCEMENT_COSTS) {
            const costsForGrade = ENHANCEMENT_COSTS[grade as ItemGrade];
            costsForGrade.forEach((costArray, starIndex) => {
                costArray.forEach(cost => {
                    if (cost.name === selectedItem.name) {
                        if (!groupedDetails[grade as ItemGrade]) {
                            groupedDetails[grade as ItemGrade] = [];
                        }
                        groupedDetails[grade as ItemGrade].push(starIndex + 1);
                    }
                });
            });
        }

        const details: string[] = [];
        for (const grade in groupedDetails) {
            const starLevels = groupedDetails[grade as ItemGrade].sort((a, b) => a - b);
            if (starLevels.length > 0) {
                details.push(`${gradeStyles[grade as ItemGrade].name} 등급 장비 강화: +${starLevels.join('강/+')}강`);
            }
        }
        return details;
    }, [selectedItem]);

    const handleExpand = () => {
        if (activeTab === 'all' || !canExpand) return;
        setIsExpandModalOpen(true);
    };

    const handleConfirmExpand = async () => {
        if (activeTab === 'all' || !canExpand || expansionCost <= 0) return;
        if (!hasEnoughDiamonds) {
            alert('다이아가 부족합니다.');
            return;
        }
        await onAction({ type: 'EXPAND_INVENTORY', payload: { category: activeTab } });
        // 모달을 자동으로 닫지 않음 (사용자가 직접 닫도록)
    };

    const handleOpenRenameModal = () => {
        setNewPresetName(presets[selectedPreset].name);
        setIsRenameModalOpen(true);
    };

    const handleSavePreset = () => {
        const updatedPreset = {
            ...presets[selectedPreset],
            name: newPresetName,
            equipment: currentUser.equipment,
        };
        onAction({ type: 'SAVE_PRESET', payload: { preset: updatedPreset, index: selectedPreset } });
        setIsRenameModalOpen(false);
        alert('프리셋이 저장되었습니다.');
    };

    const handleEquipToggle = (itemId: string) => {
        const item = currentUser.inventory.find(i => i.id === itemId);
        if (!item) return;

        if (!item.isEquipped) {
            const requiredLevel = GRADE_LEVEL_REQUIREMENTS[item.grade];
            const userLevelSum = currentUser.strategyLevel + currentUser.playfulLevel;
            if (userLevelSum < requiredLevel) {
                alert(`착용 레벨 합이 부족합니다. (필요: ${requiredLevel}, 현재: ${userLevelSum})`);
                return;
            }
        }

        onAction({ type: 'TOGGLE_EQUIP_ITEM', payload: { itemId } });
    };

    const filteredAndSortedInventory = useMemo(() => {
        let items = [...currentUser.inventory];
        if (activeTab !== 'all') {
            items = items.filter((item: InventoryItem) => item.type === activeTab);
        }
        // Log for debugging: Check if materials are present and filtered correctly
        if (activeTab === 'material') {
            console.log('Filtered materials:', items);
        }
        items.sort((a, b) => {
            if (sortKey === 'createdAt') return b.createdAt - a.createdAt;
            if (sortKey === 'grade') {
                const gradeA = gradeOrder[a.grade];
                const gradeB = gradeOrder[b.grade];
                if (gradeA !== gradeB) return gradeB - gradeA;
                return b.stars - a.stars;
            }
            if (sortKey === 'type') {
                const typeOrder: Record<InventoryItemType, number> = { equipment: 1, consumable: 2, material: 3 };
                return typeOrder[a.type] - typeOrder[b.type];
            }
            return 0;
        });
        return items;
    }, [currentUser.inventory, activeTab, sortKey, updateTrigger]);

    const currentSlots = useMemo(() => {
        const slots = inventorySlots || {};
        if (activeTab === 'all') {
            return (slots.equipment ?? BASE_SLOTS_PER_CATEGORY) + (slots.consumable ?? BASE_SLOTS_PER_CATEGORY) + (slots.material ?? BASE_SLOTS_PER_CATEGORY);
        } else {
            return slots[activeTab] ?? BASE_SLOTS_PER_CATEGORY;
        }
    }, [inventorySlots, activeTab]);
    
    const maxSlotsForCurrentTab = useMemo(() => {
        let maxSlots = MAX_EQUIPMENT_SLOTS;
        if (activeTab === 'consumable') maxSlots = MAX_CONSUMABLE_SLOTS;
        else if (activeTab === 'material') maxSlots = MAX_MATERIAL_SLOTS;
        return maxSlots;
    }, [activeTab]);

    const currentCategorySlots = useMemo(() => {
        if (activeTab === 'all') return 0;
        return inventorySlots?.[activeTab] ?? BASE_SLOTS_PER_CATEGORY;
    }, [activeTab, inventorySlots]);

    const nextCategorySlots = useMemo(() => {
        if (activeTab === 'all') return 0;
        return Math.min(currentCategorySlots + EXPANSION_AMOUNT, maxSlotsForCurrentTab);
    }, [activeTab, currentCategorySlots, maxSlotsForCurrentTab]);

    const canExpand = useMemo(() => {
        if (activeTab === 'all') return false;
        return currentCategorySlots < maxSlotsForCurrentTab;
    }, [activeTab, currentCategorySlots, maxSlotsForCurrentTab]);

    const hasEnoughDiamonds = useMemo(() => {
        if (expansionCost <= 0) return true;
        return (currentUser.diamonds ?? 0) >= expansionCost;
    }, [currentUser.diamonds, expansionCost]);

    const slotsIncrease = useMemo(() => {
        if (activeTab === 'all') return 0;
        return Math.max(0, nextCategorySlots - currentCategorySlots);
    }, [activeTab, nextCategorySlots, currentCategorySlots]);

    const activeTabLabel = useMemo(() => TAB_LABELS[activeTab], [activeTab]);

    const isItemInAnyPreset = useCallback((itemId: string) => {
        return presets.some(preset => Object.values(preset.equipment).includes(itemId));
    }, [presets]);

    const getItemForSlot = useCallback((slot: EquipmentSlot) => {
        const itemId = currentUser.equipment[slot];
        if (!itemId) return undefined;
        return currentUser.inventory.find(item => item.id === itemId);
    }, [currentUser.equipment, currentUser.inventory, updateTrigger]);

    const correspondingEquippedItem = useMemo(() => {
        if (!selectedItem || !selectedItem.slot) return null;
        return getItemForSlot(selectedItem.slot);
    }, [selectedItem, getItemForSlot]);

    const canEquip = useMemo(() => {
        if (!selectedItem || selectedItem.type !== 'equipment') return false;
        const requiredLevel = GRADE_LEVEL_REQUIREMENTS[selectedItem.grade];
        const userLevelSum = currentUser.strategyLevel + currentUser.playfulLevel;
        return userLevelSum >= requiredLevel;
    }, [selectedItem, currentUser.strategyLevel, currentUser.playfulLevel]);

    // 바둑능력 변화 계산 (선택한 장비를 장착했을 때의 바둑능력 변화 - 6가지 능력치 합계)
    const combatPowerChange = useMemo(() => {
        if (!selectedItem || selectedItem.type !== 'equipment' || !selectedItem.slot) return null;
        
        // 현재 바둑능력 계산 (현재 장착된 장비 기준) - 6가지 능력치 합계
        const currentStats = calculateTotalStats(currentUser);
        const currentBadukPower = Object.values(currentStats).reduce((acc, val) => acc + val, 0);
        
        // 현재 해당 슬롯에 장착된 아이템 ID 찾기
        const currentEquippedItemId = currentUser.equipment[selectedItem.slot];
        
        // 선택한 장비를 장착한 상태로 가정한 User 생성
        const hypotheticalEquipment = { ...currentUser.equipment };
        hypotheticalEquipment[selectedItem.slot] = selectedItem.id;
        
        // 인벤토리에서 아이템의 isEquipped 상태 업데이트
        const hypotheticalInventory = currentUser.inventory.map(item => {
            // 선택한 아이템은 장착
            if (item.id === selectedItem.id) {
                return { ...item, isEquipped: true };
            }
            // 현재 해당 슬롯에 장착된 아이템은 해제
            if (currentEquippedItemId && item.id === currentEquippedItemId) {
                return { ...item, isEquipped: false };
            }
            // 나머지는 그대로 유지
            return item;
        });
        
        const hypotheticalUser = {
            ...currentUser,
            equipment: hypotheticalEquipment,
            inventory: hypotheticalInventory
        };
        
        // 선택한 장비를 장착했을 때의 바둑능력 계산 - 6가지 능력치 합계
        const newStats = calculateTotalStats(hypotheticalUser);
        const newBadukPower = Object.values(newStats).reduce((acc, val) => acc + val, 0);
        
        // 차이 계산 (선택한 장비 장착 시 - 현재 장착 장비 기준)
        const change = newBadukPower - currentBadukPower;
        return change;
    }, [selectedItem, currentUser]);

    return (
        <DraggableWindow title="가방" onClose={onClose} windowId="inventory" isTopmost={isTopmost} initialWidth={calculatedWidth} initialHeight={calculatedHeight} variant="store">
            <div 
                className="flex flex-col h-full w-full overflow-hidden"
                style={{ margin: 0, padding: 0 }}
            >
                {/* Top section: Equipped items (left) and Selected item details (right) */}
                <div className={`bg-gray-800 mb-2 rounded-md shadow-inner flex ${isMobile ? 'flex-col' : 'flex-row'} flex-shrink-0 overflow-auto`} style={{ maxHeight: `${isMobile ? Math.min(600 * scaleFactor, windowHeight * 0.65) : Math.min(600 * scaleFactor, windowHeight * 0.7)}px`, padding: `${isMobile ? Math.max(4, Math.round(6 * scaleFactor)) : Math.max(12, Math.round(16 * scaleFactor))}px` }}>
                    {/* Left panel: Equipped items */}
                    <div className={`${isMobile ? 'w-full mb-2 flex-shrink-0' : 'w-1/3 flex-shrink-0'} ${isMobile ? '' : 'border-r border-gray-700'}`} style={{ paddingRight: `${isMobile ? 0 : Math.max(12, Math.round(16 * scaleFactor))}px`, maxHeight: isMobile ? '120px' : 'none' }}>
                        {isMobile ? (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-bold text-on-panel" style={{ fontSize: `${Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px`, marginBottom: 0 }}>장착 장비</h3>
                                    <div className="flex items-center gap-1">
                                        <select
                                            value={selectedPreset}
                                            onChange={e => handlePresetChange(Number(e.target.value))}
                                            className="bg-secondary border border-color rounded-md p-0.5 focus:ring-accent focus:border-accent"
                                            style={{ fontSize: `${Math.max(9, Math.round(10 * scaleFactor * mobileTextScale))}px`, width: '80px' }}
                                        >
                                            {presets.map((preset, index) => (
                                                <option key={index} value={index}>{preset.name}</option>
                                            ))}
                                        </select>
                                        <Button onClick={handleOpenRenameModal} colorScheme="blue" className="!py-0.5 !px-1.5" style={{ fontSize: `${Math.max(9, Math.round(10 * scaleFactor * mobileTextScale))}px` }}>
                                            저장
                                        </Button>
                                    </div>
                                </div>
                                <div 
                                    className="grid" 
                                    style={{ 
                                        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                                        gap: `${Math.max(2, Math.round(3 * scaleFactor))}px`
                                    }}
                                >
                                    {EQUIPMENT_SLOTS.map(slot => {
                                        const equippedItem = getItemForSlot(slot);
                                        return (
                                        <div key={slot} style={{ width: '100%', minWidth: 0 }}>
                                            <EquipmentSlotDisplay 
                                                slot={slot} 
                                                item={equippedItem} 
                                                scaleFactor={scaleFactor * 0.5} 
                                                onClick={equippedItem ? () => setSelectedItemId(equippedItem.id) : undefined}
                                                isSelected={equippedItem ? selectedItemId === equippedItem.id : false}
                                            />
                                        </div>
                                    )})}
                                </div>
                            </div>
                        ) : (
                            <>
                                <h3 className="font-bold text-on-panel" style={{ fontSize: `${Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px`, marginBottom: `${Math.max(6, Math.round(8 * scaleFactor))}px` }}>장착 장비</h3>
                                <div 
                                    className="grid" 
                                    style={{ 
                                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                        gap: `${Math.max(6, Math.round(8 * scaleFactor))}px`
                                    }}
                                >
                                    {EQUIPMENT_SLOTS.map(slot => {
                                        const equippedItem = getItemForSlot(slot);
                                        return (
                                        <div key={slot} style={{ width: '100%', minWidth: 0 }}>
                                            <EquipmentSlotDisplay 
                                                slot={slot} 
                                                item={equippedItem} 
                                                scaleFactor={scaleFactor} 
                                                onClick={equippedItem ? () => setSelectedItemId(equippedItem.id) : undefined}
                                                isSelected={equippedItem ? selectedItemId === equippedItem.id : false}
                                            />
                                        </div>
                                    )})}
                                </div>
                                <div className="mt-4">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                                        {Object.values(CoreStat).map(stat => {
                                            const baseStats = currentUser.baseStats || {};
                                            const spentStatPoints = currentUser.spentStatPoints || {};
                                            const baseValue = (baseStats[stat] || 0) + (spentStatPoints[stat] || 0);
                                            const bonusInfo = coreStatBonuses[stat] || { percent: 0, flat: 0 };
                                            const bonus = Math.floor(baseValue * (bonusInfo.percent / 100)) + bonusInfo.flat;
                                            const finalValue = baseValue + bonus;
                                            return (
                                                <div key={stat} className="bg-tertiary/40 p-1 rounded-md flex items-center justify-between" style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                    <span className="font-semibold text-secondary whitespace-nowrap">{stat}</span>
                                                    <span className="font-mono font-bold whitespace-nowrap" title={`기본: ${baseValue}, 장비: ${bonus}`}>
                                                        {isNaN(finalValue) ? 0 : finalValue}
                                                        {bonus > 0 && <span className="text-green-400 ml-0.5" style={{ fontSize: `${Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>(+{bonus})</span>}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={selectedPreset}
                                            onChange={e => handlePresetChange(Number(e.target.value))}
                                            className="bg-secondary border border-color rounded-md p-1 focus:ring-accent focus:border-accent flex-grow"
                                            style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}
                                        >
                                            {presets.map((preset, index) => (
                                                <option key={index} value={index}>{preset.name}</option>
                                            ))}
                                        </select>
                                        <Button onClick={handleOpenRenameModal} colorScheme="blue" className="!py-1" style={{ fontSize: `${Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                            저장
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Conditional middle and right panels */}
                    {selectedItem && selectedItem.type === 'equipment' ? (
                        <div className={`flex ${isMobile ? 'flex-row gap-2' : 'flex-row gap-0'} flex-1`} style={{ minHeight: isMobile ? '300px' : undefined }}>
                            {/* Middle panel: Currently equipped item for comparison - 모바일에서도 표시하되 나란히 배치 */}
                            <div className={`flex flex-col ${isMobile ? 'w-1/2' : 'flex-1'} h-full bg-panel-secondary rounded-lg p-2 relative overflow-hidden ${isMobile ? '' : 'border-r border-gray-700'}`} style={{ minHeight: isMobile ? '300px' : undefined }}>
                                <h3 className="font-bold text-on-panel mb-1 flex-shrink-0" style={{ fontSize: `${isMobile ? Math.max(10, Math.round(12 * scaleFactor * mobileTextScale)) : Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>현재 장착</h3>
                                <div className="flex-1 min-h-0 overflow-y-auto pb-16" style={{ WebkitOverflowScrolling: 'touch' }}>
                                    <LocalItemDetailDisplay 
                                        item={correspondingEquippedItem} 
                                        title="장착된 장비 없음" 
                                        comparisonItem={selectedItem} 
                                        scaleFactor={isMobile ? scaleFactor * 0.7 : scaleFactor} 
                                        mobileTextScale={isMobile ? mobileTextScale * 0.8 : mobileTextScale} 
                                        userLevelSum={currentUser.strategyLevel + currentUser.playfulLevel}
                                        emptySlot={selectedItem?.slot}
                                    />
                                </div>
                            </div>

                            {/* Right panel: Selected equipment item */}
                            <div className={`flex flex-col ${isMobile ? 'w-1/2' : 'flex-1'} h-full bg-panel-secondary rounded-lg ${isMobile ? 'p-2' : 'p-3'} relative overflow-hidden`} style={{ minHeight: isMobile ? '300px' : undefined }}>
                                <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                                    <h3 className="font-bold text-on-panel" style={{ fontSize: `${isMobile ? Math.max(10, Math.round(12 * scaleFactor * mobileTextScale)) : Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>선택 장비</h3>
                                    {combatPowerChange !== null && combatPowerChange !== 0 && (
                                        <span className={`font-bold ${combatPowerChange > 0 ? 'text-green-400' : 'text-red-400'}`} style={{ fontSize: `${isMobile ? Math.max(9, Math.round(10 * scaleFactor * mobileTextScale)) : Math.max(12, Math.round(14 * scaleFactor * mobileTextScale))}px` }}>
                                            {combatPowerChange > 0 ? '+' : ''}{combatPowerChange}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto pb-16" style={{ WebkitOverflowScrolling: 'touch' }}>
                                    <LocalItemDetailDisplay item={selectedItem} title="선택된 아이템 없음" comparisonItem={correspondingEquippedItem} scaleFactor={isMobile ? scaleFactor * 0.7 : scaleFactor} mobileTextScale={isMobile ? mobileTextScale * 0.8 : mobileTextScale} userLevelSum={currentUser.strategyLevel + currentUser.playfulLevel} />
                                </div>
                                <div className={`absolute bottom-2 left-0 right-0 flex ${isMobile ? 'flex-row gap-1' : 'justify-center gap-2'} px-2 flex-shrink-0 bg-panel-secondary/95 backdrop-blur-sm`}>
                                    {selectedItem.id === correspondingEquippedItem?.id ? (
                                        <Button
                                            onClick={() => handleEquipToggle(selectedItem.id)}
                                            colorScheme="red"
                                            className={`flex-1 ${isMobile ? '!py-1 !px-2' : '!py-1'}`}
                                            style={{ fontSize: `${isMobile ? Math.max(9, Math.round(10 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}
                                        >
                                            해제
                                        </Button>
                                    ) : (
                                        <Button
                                            onClick={() => handleEquipToggle(selectedItem.id)}
                                            colorScheme="green"
                                            className={`flex-1 ${isMobile ? '!py-1 !px-2' : '!py-1'}`}
                                            disabled={!canEquip}
                                            style={{ fontSize: `${isMobile ? Math.max(9, Math.round(10 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}
                                        >
                                            장착
                                        </Button>
                                    )}
                                    <Button
                                        onClick={() => onStartEnhance(selectedItem)}
                                        disabled={selectedItem.stars >= 10}
                                        colorScheme="yellow"
                                        className={`flex-1 ${isMobile ? '!py-1 !px-2' : '!py-1'}`}
                                        style={{ fontSize: `${isMobile ? Math.max(9, Math.round(10 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}
                                    >
                                        {selectedItem.stars >= 10 ? '최대' : '강화'}
                                    </Button>
                                    <Button onClick={() => setItemToSell(selectedItem)} colorScheme="red" className={`flex-1 ${isMobile ? '!py-1 !px-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(9, Math.round(10 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                        판매
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Single right panel for non-equipment items or no selection */
                        <div className={`flex flex-col ${isMobile ? 'w-full flex-1 min-h-0' : 'w-2/3'} h-full bg-panel-secondary rounded-lg ${isMobile ? 'p-3' : 'p-3'} relative overflow-hidden ${isMobile ? '' : 'ml-4'}`} style={{ minHeight: isMobile ? '300px' : undefined }}>
                            {selectedItem ? (
                                (selectedItem.type === 'consumable' || selectedItem.type === 'material') ? (
                                    <>
                                        <h3 className="font-bold text-on-panel mb-2 flex-shrink-0" style={{ fontSize: `${isMobile ? Math.max(16, Math.round(18 * scaleFactor * mobileTextScale)) : Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>
                                            선택 {selectedItem.type === 'consumable' ? '소모품' : '재료'}
                                        </h3>
                                        <div className="flex-1 min-h-0 overflow-y-auto" style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px`, WebkitOverflowScrolling: 'touch' }}>
                                            <div className="flex items-start justify-between mb-2">
                                                <div 
                                                    className="relative rounded-lg flex-shrink-0 aspect-square"
                                                    style={{
                                                        width: `${isMobile ? Math.max(80, Math.round(100 * scaleFactor)) : Math.max(60, Math.round(80 * scaleFactor))}px`,
                                                        height: `${isMobile ? Math.max(80, Math.round(100 * scaleFactor)) : Math.max(60, Math.round(80 * scaleFactor))}px`
                                                    }}
                                                >
                                                    <img src={gradeBackgrounds[selectedItem.grade]} alt={selectedItem.grade} className="absolute inset-0 w-full h-full object-cover rounded-lg" />
                                                    {selectedItem.image && <img src={selectedItem.image} alt={selectedItem.name} className="absolute object-contain" style={{ width: '80%', height: '80%', padding: `${Math.max(2, Math.round(4 * scaleFactor))}px`, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />}
                                                </div>
                                                <div className="flex-grow text-right ml-2">
                                                    <h3 className={`font-bold ${gradeStyles[selectedItem.grade].color}`} style={{ fontSize: `${isMobile ? Math.max(16, Math.round(18 * scaleFactor * mobileTextScale)) : Math.max(14, Math.round(18 * scaleFactor * mobileTextScale))}px` }}>{selectedItem.name}</h3>
                                                    <p className={gradeStyles[selectedItem.grade].color} style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>[{gradeStyles[selectedItem.grade].name}]</p>
                                                    <p className="text-gray-300 mt-1" style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>{selectedItem.description}</p>
                                                    <p className="text-gray-300 mt-1" style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>보유 수량: {selectedItem.quantity}</p>
                                                </div>
                                            </div>
                                            {selectedItem.type === 'material' && (
                                                <div className="mt-2 p-2 bg-gray-800/50 rounded-lg">
                                                    <p className="font-semibold text-secondary mb-1" style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>강화 필요 정보:</p>
                                                    {enhancementMaterialDetails.length > 0 ? (
                                                        enhancementMaterialDetails.slice(0, 2).map((detail, index) => (
                                                            <p key={index} className="text-gray-300" style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>
                                                                {detail}
                                                            </p>
                                                        ))
                                                    ) : (
                                                        <p className="text-gray-300" style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>이 재료는 현재 어떤 장비 강화에도 사용되지 않습니다.</p>
                                                    )}
                                                    {enhancementMaterialDetails.length > 2 && (
                                                        <p className="text-gray-400 mt-1" style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>...</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`absolute bottom-2 left-0 right-0 flex ${isMobile ? 'flex-col gap-1.5' : 'justify-center gap-2'} px-4 flex-shrink-0`}>
                                            {selectedItem.type === 'consumable' && (() => {
                                                const consumableItem = CONSUMABLE_ITEMS.find(ci => ci.name === selectedItem.name || ci.name === selectedItem.name.replace('꾸러미', ' 꾸러미') || ci.name === selectedItem.name.replace(' 꾸러미', '꾸러미'));
                                                const isUsable = consumableItem?.usable !== false; // 기본값은 true
                                                const isSellable = consumableItem?.sellable !== false; // 기본값은 true
                                                
                                                return (
                                                    <>
                                                        {isUsable && (
                                                            <>
                                                                <Button onClick={() => onAction({ type: 'USE_ITEM', payload: { itemId: selectedItem.id } })} colorScheme="blue" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                                    사용
                                                                </Button>
                                                                {selectedItem.quantity && selectedItem.quantity > 1 && (
                                                                    <Button
                                                                        onClick={() => { setItemToUseBulk(selectedItem); setShowUseQuantityModal(true); }}
                                                                        colorScheme="purple"
                                                                        className={`w-full ${isMobile ? '!py-2' : '!py-1'}`}
                                                                        style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}
                                                                    >
                                                                        일괄 사용
                                                                    </Button>
                                                                )}
                                                            </>
                                                        )}
                                                        {isSellable && (
                                                            <>
                                                                <Button onClick={() => setItemToSell(selectedItem)} colorScheme="red" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                                    판매
                                                                </Button>
                                                                {selectedItem.quantity && selectedItem.quantity > 1 && (
                                                                    <Button onClick={() => setItemToSellBulk(selectedItem)} colorScheme="orange" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                                        일괄 판매
                                                                    </Button>
                                                                )}
                                                            </>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                            {selectedItem.type === 'material' && (
                                                <>
                                                    <Button onClick={() => setItemToSell(selectedItem)} colorScheme="red" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                        판매
                                                    </Button>
                                                    <Button onClick={() => setItemToSellBulk(selectedItem)} colorScheme="orange" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                        일괄 판매
                                                    </Button>
                                                </>
                                            )}
                                            {selectedItem.type !== 'material' && selectedItem.type !== 'consumable' && (() => {
                                                const consumableItem = selectedItem.type === 'consumable' ? CONSUMABLE_ITEMS.find(ci => ci.name === selectedItem.name || ci.name === selectedItem.name.replace('꾸러미', ' 꾸러미') || ci.name === selectedItem.name.replace(' 꾸러미', '꾸러미')) : null;
                                                const isSellable = consumableItem?.sellable !== false; // 기본값은 true
                                                
                                                return isSellable ? (
                                                    <Button onClick={() => setItemToSell(selectedItem)} colorScheme="red" className={`w-full ${isMobile ? '!py-2' : '!py-1'}`} style={{ fontSize: `${isMobile ? Math.max(13, Math.round(14 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                                        판매
                                                    </Button>
                                                ) : null;
                                            })()}
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-tertiary" style={{ fontSize: `${Math.max(12, Math.round(14 * scaleFactor * mobileTextScale))}px` }}>선택된 아이템 없음</div>
                                )
                            ) : (
                                <div className="h-full flex items-center justify-center text-tertiary" style={{ fontSize: `${Math.max(12, Math.round(14 * scaleFactor * mobileTextScale))}px` }}>아이템을 선택해주세요</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom section: Inventory grid */}
                <div className="bg-gray-900 overflow-hidden flex flex-col" style={{ flex: '1 1 0', minHeight: `${isMobile ? Math.max(250 * scaleFactor, windowHeight * 0.4) : Math.max(320 * scaleFactor, windowHeight * 0.45)}px`, padding: `${isMobile ? Math.max(6, Math.round(8 * scaleFactor)) : Math.max(12, Math.round(16 * scaleFactor))}px`, paddingTop: `${isMobile ? Math.max(6, Math.round(8 * scaleFactor)) : Math.max(12, Math.round(16 * scaleFactor))}px`, paddingBottom: `${isMobile ? Math.max(6, Math.round(8 * scaleFactor)) : Math.max(12, Math.round(16 * scaleFactor))}px`, marginBottom: 0 }}>
                    <div className={`flex-shrink-0 bg-gray-900/50 rounded-md mb-2 ${isMobile ? 'flex flex-col gap-2' : ''}`} style={{ padding: `${isMobile ? Math.max(4, Math.round(6 * scaleFactor)) : Math.max(6, Math.round(8 * scaleFactor))}px`, marginBottom: `${isMobile ? Math.max(4, Math.round(6 * scaleFactor)) : Math.max(6, Math.round(8 * scaleFactor))}px` }}>
                        <div className={`flex items-center ${isMobile ? 'flex-wrap gap-2' : 'justify-between'}`}>
                            <div className={`flex items-center ${isMobile ? 'gap-1 flex-wrap' : 'space-x-2'}`}>
                                <Button onClick={() => setActiveTab('all')} colorScheme={activeTab === 'all' ? 'blue' : 'gray'} className={`${isMobile ? '!py-1.5 !px-3' : '!py-1 !px-2'}`} style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>전체</Button>
                                <Button onClick={() => setActiveTab('equipment')} colorScheme={activeTab === 'equipment' ? 'blue' : 'gray'} className={`${isMobile ? '!py-1.5 !px-3' : '!py-1 !px-2'}`} style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>장비</Button>
                                <Button onClick={() => setActiveTab('consumable')} colorScheme={activeTab === 'consumable' ? 'blue' : 'gray'} className={`${isMobile ? '!py-1.5 !px-3' : '!py-1 !px-2'}`} style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>소모품</Button>
                                <Button onClick={() => setActiveTab('material')} colorScheme={activeTab === 'material' ? 'blue' : 'gray'} className={`${isMobile ? '!py-1.5 !px-3' : '!py-1 !px-2'}`} style={{ fontSize: `${isMobile ? Math.max(12, Math.round(13 * scaleFactor * mobileTextScale)) : Math.max(11, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>재료</Button>
                            </div>
                            <div className={`flex items-center ${isMobile ? 'gap-1.5' : 'space-x-2'}`}>
                                <span style={{ fontSize: `${isMobile ? Math.max(11, Math.round(12 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>정렬:</span>
                                <select onChange={(e) => setSortKey(e.target.value as SortKey)} value={sortKey} className={`bg-gray-700 text-white rounded-md ${isMobile ? 'p-1.5' : 'p-1'}`} style={{ fontSize: `${isMobile ? Math.max(11, Math.round(12 * scaleFactor * mobileTextScale)) : Math.max(9, Math.round(11 * scaleFactor * mobileTextScale))}px` }}>
                                    <option value="createdAt">최신순</option>
                                    <option value="grade">등급순</option>
                                    <option value="type">종류순</option>
                                </select>
                                <div className="text-gray-400" style={{ fontSize: `${isMobile ? Math.max(11, Math.round(12 * scaleFactor * mobileTextScale)) : Math.max(10, Math.round(12 * scaleFactor * mobileTextScale))}px` }}>
                                    {`${filteredAndSortedInventory.length} / ${currentSlots}`}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 min-h-0" style={{ width: '100%', minWidth: 0, paddingRight: `${isMobile ? Math.max(4, Math.round(6 * scaleFactor)) : Math.max(6, Math.round(8 * scaleFactor))}px`, WebkitOverflowScrolling: 'touch' }}>
                        <div 
                            className="grid gap-2" 
                            style={{ 
                                gridTemplateColumns: `repeat(${isMobile ? 8 : 12}, minmax(0, 1fr))`,
                                gap: `${isMobile ? Math.max(4, Math.round(8 * scaleFactor)) : Math.max(4, Math.round(8 * scaleFactor))}px`,
                                width: '100%',
                                minWidth: 0,
                                paddingBottom: `${isMobile ? Math.max(150, Math.round(200 * scaleFactor)) : Math.max(200, Math.round(250 * scaleFactor))}px`
                            }}
                        >
                        {Array.from({ length: currentSlots }).map((_, index) => {
                            const item = filteredAndSortedInventory[index];
                            if (item) {
                                return (
                                    <div key={item.id} className="aspect-square" style={{ width: '100%', minWidth: 0, minHeight: 0, maxWidth: '100%' }}>
                                        <InventoryItemCard
                                            item={item}
                                            onClick={() => setSelectedItemId(item.id)}
                                            isSelected={selectedItemId === item.id}
                                            isEquipped={item.isEquipped || false}
                                            enhancementStars={enhancementAnimationTarget?.itemId === item.id ? enhancementAnimationTarget.stars : undefined}
                                            isPresetEquipped={isItemInAnyPreset(item.id)}
                                            scaleFactor={scaleFactor}
                                        />
                                    </div>
                                );
                            } else {
                                return (
                                    <div key={`empty-${index}`} className="aspect-square rounded-lg bg-gray-800/50 border-2 border-gray-700/50" style={{ width: '100%', minWidth: 0, minHeight: 0, maxWidth: '100%' }} />
                                );
                            }
                        })}
                        {canExpand && (
                            <button
                                key="expand-slot"
                                onClick={handleExpand}
                                className={`w-full aspect-square rounded-lg bg-gray-800/50 border-2 border-gray-700/50 flex items-center justify-center text-gray-400 ${isMobile ? 'text-3xl' : 'text-4xl'} hover:bg-gray-700/50 hover:border-accent active:bg-gray-600/50 transition-all duration-200`}
                                title={`가방 확장 (${expansionCost} 다이아)`}
                                style={{ minHeight: isMobile ? '44px' : undefined }}
                            >
                                +
                            </button>
                        )}
                    </div>
                    </div>

                </div>
            </div>

            {/* Modals */}
            {showUseQuantityModal && itemToUseBulk && (
                <UseQuantityModal
                    item={itemToUseBulk}
                    currentUser={currentUser}
                    onClose={() => {
                        setShowUseQuantityModal(false);
                        setItemToUseBulk(null);
                    }}
                    onConfirm={(itemId, quantity) => {
                        onAction({ type: 'USE_ITEM', payload: { itemId, quantity } });
                    }}
                    isTopmost={isTopmost && !isRenameModalOpen && !itemToSell && !itemToSellBulk && !isExpandModalOpen}
                />
            )}

            {itemToSell && (
                <SellItemConfirmModal
                    item={itemToSell}
                    onClose={() => setItemToSell(null)}
                    onConfirm={async () => {
                        if (itemToSell.type === 'material') {
                            // 재료는 선택된 슬롯의 수량만 판매 (1개 판매)
                            await onAction({ type: 'SELL_ITEM', payload: { itemId: itemToSell.id, quantity: 1 } });
                        } else {
                            // 장비는 전체 판매
                            await onAction({ type: 'SELL_ITEM', payload: { itemId: itemToSell.id } });
                        }
                        setItemToSell(null);
                        setSelectedItemId(null);
                    }}
                    isTopmost={isTopmost && !isRenameModalOpen && !showUseQuantityModal && !itemToSellBulk && !isExpandModalOpen}
                />
            )}

            {itemToSellBulk && (
                <SellMaterialBulkModal
                    item={itemToSellBulk}
                    currentUser={currentUser}
                    onClose={() => setItemToSellBulk(null)}
                    onConfirm={async (quantity) => {
                        // 같은 이름의 재료를 모두 찾아서 순차적으로 판매
                        const materialsToSell = currentUser.inventory
                            .filter(i => i.type === 'material' && i.name === itemToSellBulk.name)
                            .sort((a, b) => (a.quantity || 0) - (b.quantity || 0)); // 수량이 적은 것부터 정렬
                        
                        let remainingQuantity = quantity;
                        
                        // 순차적으로 처리하여 인벤토리 상태가 올바르게 업데이트되도록 함
                        for (const material of materialsToSell) {
                            if (remainingQuantity <= 0) break;
                            const sellQty = Math.min(remainingQuantity, material.quantity || 0);
                            await onAction({ type: 'SELL_ITEM', payload: { itemId: material.id, quantity: sellQty } });
                            remainingQuantity -= sellQty;
                        }
                        
                        setItemToSellBulk(null);
                        setSelectedItemId(null);
                    }}
                    isTopmost={isTopmost && !isRenameModalOpen && !showUseQuantityModal && !itemToSell && !isExpandModalOpen}
                />
            )}

            {isExpandModalOpen && activeTab !== 'all' && (
                <DraggableWindow title="가방 확장" onClose={() => setIsExpandModalOpen(false)} windowId="expandInventory" isTopmost={isTopmost} variant="store">
                    <div className="w-full h-full flex flex-col items-center justify-center p-6">
                        <div className="w-full max-w-[360px] flex flex-col items-center justify-center space-y-6 text-center">
                            <div className="flex flex-col items-center space-y-3 w-full">
                                <p className="text-on-panel text-base font-medium w-full">{`${activeTabLabel} 가방을 확장하시겠습니까?`}</p>
                                <div className="flex items-center justify-center gap-3 text-base font-semibold w-full">
                                    <span className="text-gray-400">{currentCategorySlots}칸</span>
                                    <span className="text-gray-500">→</span>
                                    <span className="text-emerald-300">{nextCategorySlots}칸</span>
                                    {slotsIncrease > 0 && (
                                        <span className="text-emerald-400 text-sm">(+{slotsIncrease})</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-center gap-2 w-full">
                                <span className="text-xs text-gray-400">필요 다이아</span>
                                <div className={`flex items-center justify-center gap-2 px-4 py-2 rounded-full border ${hasEnoughDiamonds ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-100' : 'border-rose-500/60 bg-rose-500/10 text-rose-200'}`}>
                                    <img src="/images/icon/Zem.png" alt="다이아" className="w-5 h-5 object-contain" />
                                    <span className="font-bold text-base">{expansionCost.toLocaleString()}</span>
                                </div>
                                {!hasEnoughDiamonds && (
                                    <span className="text-xs text-rose-300 mt-1">다이아가 부족합니다.</span>
                                )}
                            </div>
                            <div className="flex items-center justify-center gap-3 w-full pt-2">
                                <Button 
                                    onClick={() => setIsExpandModalOpen(false)} 
                                    colorScheme="gray"
                                    className="px-6 py-2.5 min-w-[100px]"
                                >
                                    취소
                                </Button>
                                <ResourceActionButton
                                    onClick={handleConfirmExpand}
                                    disabled={!hasEnoughDiamonds}
                                    variant="diamonds"
                                    className="flex items-center justify-center gap-2 px-6 py-2.5 min-w-[120px]"
                                >
                                    <span>확장</span>
                                    <span className="flex items-center gap-1 text-sm">
                                        <img src="/images/icon/Zem.png" alt="다이아" className="w-4 h-4 object-contain" />
                                        {expansionCost.toLocaleString()}
                                    </span>
                                </ResourceActionButton>
                            </div>
                        </div>
                    </div>
                </DraggableWindow>
            )}

            {isRenameModalOpen && (
                <DraggableWindow title="프리셋 이름 변경" onClose={() => setIsRenameModalOpen(false)} windowId="renamePreset" isTopmost={isTopmost && !isExpandModalOpen}>
                    <div className="p-4 flex flex-col items-center">
                        <p className="mb-4 text-on-panel">새로운 프리셋 이름을 입력하세요:</p>
                        <input
                            type="text"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            className="bg-secondary border border-color text-on-panel text-sm rounded-md p-2 mb-4 w-full max-w-xs"
                            maxLength={20}
                        />
                        <div className="flex gap-2">
                            <Button onClick={handleSavePreset} colorScheme="blue">
                                저장
                            </Button>
                            <Button onClick={() => setIsRenameModalOpen(false)} colorScheme="gray">
                                취소
                            </Button>
                        </div>
                    </div>
                </DraggableWindow>
            )}
        </DraggableWindow>
    );
};

const InventoryItemCard: React.FC<{
    item: InventoryItem;
    onClick: () => void;
    isSelected: boolean;
    isEquipped: boolean;
    enhancementStars: number | undefined;
    isPresetEquipped?: boolean;
    scaleFactor?: number;
}> = ({ item, onClick, isSelected, isEquipped, enhancementStars, isPresetEquipped, scaleFactor = 1 }) => {
    const stars = enhancementStars || item.stars || 0;
    
    const renderStarDisplay = () => {
        if (stars === 0) return null;

        let starImage = '';
        let numberColor = '';

        if (stars >= 10) {
            starImage = '/images/equipments/Star4.png';
            numberColor = "prism-text-effect";
        } else if (stars >= 7) {
            starImage = '/images/equipments/Star3.png';
            numberColor = "text-purple-400";
        } else if (stars >= 4) {
            starImage = '/images/equipments/Star2.png';
            numberColor = "text-amber-400";
        } else if (stars >= 1) {
            starImage = '/images/equipments/Star1.png';
            numberColor = "text-white";
        }

        const starSize = Math.max(8, Math.round(10 * scaleFactor));
        const fontSize = Math.max(8, Math.round(10 * scaleFactor));
        const gap = Math.max(2, Math.round(2 * scaleFactor));
        const padding = Math.max(2, Math.round(2 * scaleFactor));

        return (
            <div 
                className="absolute flex items-center bg-black/40 rounded-bl-md z-10" 
                style={{ 
                    textShadow: '1px 1px 2px black',
                    top: `${Math.max(2, Math.round(2 * scaleFactor))}px`,
                    right: `${Math.max(2, Math.round(2 * scaleFactor))}px`,
                    gap: `${gap}px`,
                    padding: `${padding}px`
                }}
            >
                <img src={starImage} alt="star" style={{ width: `${starSize}px`, height: `${starSize}px` }} />
                <span className={`font-bold leading-none ${numberColor}`} style={{ fontSize: `${fontSize}px` }}>{stars}</span>
            </div>
        );
    };

    return (
        <div
            onClick={onClick}
            className={`relative aspect-square rounded-lg cursor-pointer transition-all duration-200 ${isSelected ? 'ring-2 ring-accent' : 'ring-1 ring-transparent'} hover:ring-2 hover:ring-accent/70`}
            title={item.name}
            style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, maxWidth: '100%', maxHeight: '100%' }}
        >
            <img src={gradeBackgrounds[item.grade]} alt={item.grade} className="absolute inset-0 object-cover rounded-md" style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }} />
            {(() => {
                // 이미지 경로 찾기: item.image가 있으면 사용, 없으면 CONSUMABLE_ITEMS나 MATERIAL_ITEMS에서 찾기
                const imagePath = item.image || 
                    (CONSUMABLE_ITEMS.find(ci => ci.name === item.name || ci.name === item.name.replace('꾸러미', ' 꾸러미') || ci.name === item.name.replace(' 꾸러미', '꾸러미'))?.image) ||
                    (MATERIAL_ITEMS[item.name]?.image) ||
                    (MATERIAL_ITEMS[item.name.replace('꾸러미', ' 꾸러미')]?.image) ||
                    (MATERIAL_ITEMS[item.name.replace(' 꾸러미', '꾸러미')]?.image);
                
                return imagePath ? (
                    <img 
                        src={imagePath} 
                        alt={item.name} 
                        className="absolute object-contain" 
                        style={{ 
                            width: '80%', 
                            height: '80%', 
                            padding: `${Math.max(4, Math.round(6 * scaleFactor))}px`, 
                            maxWidth: '80%', 
                            maxHeight: '80%', 
                            left: '50%', 
                            top: '50%', 
                            transform: 'translate(-50%, -50%)' 
                        }} 
                        onError={(e) => {
                            console.error(`[InventoryItemCard] Failed to load image: ${imagePath} for item:`, item);
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : null;
            })()}
            {renderStarDisplay()}
            {isEquipped && (
                <div 
                    className="absolute bg-green-500 text-white flex items-center justify-center rounded-full border-2 border-gray-800"
                    style={{
                        top: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                        left: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                        width: `${Math.max(12, Math.round(16 * scaleFactor))}px`,
                        height: `${Math.max(12, Math.round(16 * scaleFactor))}px`,
                        fontSize: `${Math.max(8, Math.round(10 * scaleFactor))}px`
                    }}
                >
                    E
                </div>
            )}
            {!isEquipped && isPresetEquipped && (
                <div 
                    className="absolute bg-blue-500 text-white flex items-center justify-center rounded-full border-2 border-gray-800"
                    style={{
                        top: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                        left: `${Math.max(4, Math.round(6 * scaleFactor))}px`,
                        width: `${Math.max(12, Math.round(16 * scaleFactor))}px`,
                        height: `${Math.max(12, Math.round(16 * scaleFactor))}px`,
                        fontSize: `${Math.max(8, Math.round(10 * scaleFactor))}px`
                    }}
                >
                    P
                </div>
            )}
            {(item.type === 'consumable' || item.type === 'material') && item.quantity && item.quantity > 1 && (
                <div 
                    className="absolute bg-black/70 text-white font-bold rounded border border-white/30"
                    style={{
                        bottom: `${Math.max(2, Math.round(2 * scaleFactor))}px`,
                        right: `${Math.max(2, Math.round(2 * scaleFactor))}px`,
                        fontSize: `${Math.max(8, Math.round(10 * scaleFactor))}px`,
                        padding: `${Math.max(2, Math.round(4 * scaleFactor))}px ${Math.max(3, Math.round(4 * scaleFactor))}px`
                    }}
                >
                    {item.quantity}
                </div>
            )}
        </div>
    );
};



export default InventoryModal;