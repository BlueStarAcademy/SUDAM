import React from 'react';
import { InventoryItem, ItemGrade, ItemOption } from '../types.js';
import DraggableWindow from './DraggableWindow.js';
import Button from './Button.js';

import { useAppContext } from '../hooks/useAppContext.js';
import { GRADE_LEVEL_REQUIREMENTS } from '../constants';

interface ItemDetailModalProps {
    item: InventoryItem;
    isOwnedByCurrentUser: boolean;
    onClose: () => void;
    onStartEnhance: (item: InventoryItem) => void;
    isTopmost?: boolean;
}

const gradeStyles: Record<ItemGrade, { name: string; color: string; background: string; }> = {
    normal: { name: '일반', color: 'text-gray-300', background: '/images/equipments/normalbgi.png' },
    uncommon: { name: '고급', color: 'text-green-400', background: '/images/equipments/uncommonbgi.png' },
    rare: { name: '희귀', color: 'text-blue-400', background: '/images/equipments/rarebgi.png' },
    epic: { name: '에픽', color: 'text-purple-400', background: '/images/equipments/epicbgi.png' },
    legendary: { name: '전설', color: 'text-red-500', background: '/images/equipments/legendarybgi.png' },
    mythic: { name: '신화', color: 'text-orange-400', background: '/images/equipments/mythicbgi.png' },
};

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

    return (
        <div className="absolute top-0.5 left-0.5 flex items-center gap-0.5 bg-black/40 rounded-br-md px-1 py-0.5 z-10" style={{ textShadow: '1px 1px 2px black' }}>
            <img src={starImage} alt="star" className="w-3 h-3" />
            <span className={`font-bold text-xs leading-none ${numberColor}`}>{stars}</span>
        </div>
    );
};

const ItemDetailModal: React.FC<ItemDetailModalProps> = ({ item, isOwnedByCurrentUser, onClose, onStartEnhance, isTopmost }) => {
    const { currentUserWithStatus } = useAppContext();
    const styles = gradeStyles[item.grade];

    const requiredLevel = GRADE_LEVEL_REQUIREMENTS[item.grade];
    const userLevelSum = (currentUserWithStatus?.strategyLevel || 0) + (currentUserWithStatus?.playfulLevel || 0);
    const canEquip = userLevelSum >= requiredLevel;

    return (
        <DraggableWindow title="장비 상세 정보" onClose={onClose} windowId={`item-detail-${item.id}`} initialWidth={350} isTopmost={isTopmost}>
            <div className="flex flex-col h-full">
                {/* Top Section: Image (left), Name & Main Option (right) */}
                <div className="flex items-start justify-between mb-4">
                    {/* Left: Image */}
                    <div className="relative w-24 h-24 rounded-lg flex-shrink-0">
                        <img src={styles.background} alt={item.grade} className="absolute inset-0 w-full h-full object-cover rounded-lg" />
                        {item.image && <img src={item.image} alt={item.name} className="absolute object-contain p-2" style={{ width: '80%', height: '80%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />}
                        {renderStarDisplay(item.stars)}
                        {item.isDivineMythic && (
                            <div 
                                className="absolute bottom-0 left-0 flex items-center justify-center bg-black/60 rounded-tr-md z-10" 
                                style={{ 
                                    textShadow: '1px 1px 2px black',
                                    padding: '2px 4px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    color: '#FFD700'
                                }}
                            >
                                D
                            </div>
                        )}
                    </div>
                    {/* Right: Name & Main Option */}
                    <div className="flex-grow text-right ml-4">
                        <div className="flex items-baseline justify-end gap-1">
                            <h3 className={`text-xl font-bold ${styles.color}`}>{item.name}</h3>
                        </div>
                        <p className={`text-sm ${styles.color}`}>[{styles.name}]</p>
                        <p className={`text-xs ${canEquip ? 'text-gray-500' : 'text-red-500'}`}>(착용레벨: {requiredLevel})</p>
                        {/* 제련 가능 횟수 표시 (장비인 경우에만) */}
                        {item.type === 'equipment' && item.grade !== 'normal' && (
                            <p className={`text-xs font-semibold ${(item as any).refinementCount > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                제련 가능: {(item as any).refinementCount > 0 ? `${(item as any).refinementCount}회` : '제련불가'}
                            </p>
                        )}
                        {item.options?.main && (
                            <p className="font-semibold text-yellow-300 text-sm">{item.options.main.display}</p>
                        )}
                    </div>
                </div>

                {/* Bottom Section: Sub Options */}
                <div className="w-full text-sm text-left space-y-2 bg-gray-900/50 p-3 rounded-lg flex-grow overflow-y-auto">
                    {item.options?.combatSubs && item.options.combatSubs.length > 0 && (
                        <div className="space-y-0.5">
                            {item.options.combatSubs.map((opt, i) => (
                                <p key={i} className="text-blue-300">{opt.display}</p>
                            ))}
                        </div>
                    )}
                    {item.options?.specialSubs && item.options.specialSubs.length > 0 && (
                        <div className="space-y-0.5">
                            {item.options.specialSubs.map((opt, i) => (
                                <p key={i} className="text-green-300">{opt.display}</p>
                            ))}
                        </div>
                    )}
                    {item.options?.mythicSubs && item.options.mythicSubs.length > 0 && (
                        <div className="space-y-0.5">
                            {item.options.mythicSubs.map((opt, i) => (
                                <p key={i} className="text-red-400">{opt.display}</p>
                            ))}
                        </div>
                    )}
                </div>

                {isOwnedByCurrentUser && item.type === 'equipment' && (
                    <div className="w-full mt-6 pt-4 border-t border-gray-700">
                        <Button
                            onClick={() => onStartEnhance(item)}
                            disabled={item.stars >= 10}
                            colorScheme="yellow"
                            className="w-full"
                        >
                            {item.stars >= 10 ? '최대 강화' : '강화하기'}
                        </Button>
                    </div>
                )}
            </div>
        </DraggableWindow>
    );
};

export default ItemDetailModal;