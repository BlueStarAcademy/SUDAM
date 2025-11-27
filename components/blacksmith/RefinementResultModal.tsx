import React from 'react';
import DraggableWindow from '../DraggableWindow.js';
import Button from '../Button.js';
import { InventoryItem, ItemGrade } from '../../types.js';

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

const ItemDisplay: React.FC<{ item: InventoryItem; label: string }> = ({ item, label }) => {
    const styles = gradeStyles[item.grade];
    if (!item.options) return null;
    const { main, combatSubs, specialSubs, mythicSubs } = item.options;

    return (
        <div className="flex flex-col w-full h-full p-2 bg-black/20 rounded-lg">
            <div className="text-xs font-bold text-gray-400 mb-2">{label}</div>
            <div className="flex mb-2">
                <div className="relative w-16 h-16 rounded-lg flex-shrink-0 mr-2">
                    <img src={styles.background} alt={item.grade} className="absolute inset-0 w-full h-full object-cover rounded-lg" />
                    {item.image && <img src={item.image} alt={item.name} className="absolute object-contain p-1" style={{ width: '80%', height: '80%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />}
                    {renderStarDisplay(item.stars || 0)}
                    {item.isDivineMythic && (
                        <div className="absolute bottom-0 left-0 flex items-center justify-center bg-black/60 rounded-tr-md z-10" style={{ textShadow: '1px 1px 2px black', padding: '2px 4px', fontSize: '8px', fontWeight: 'bold', color: '#FFD700' }}>
                            D
                        </div>
                    )}
                </div>
                <div className="flex-grow pt-1 min-w-0">
                    <h3 className={`text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis ${styles.color}`} title={item.name}>{item.name}</h3>
                    {main && <p className="font-semibold text-yellow-300 text-xs whitespace-nowrap overflow-hidden text-ellipsis" title={main.display}>{main.display}</p>}
                </div>
            </div>
            <div className="w-full text-xs text-left space-y-0.5 bg-black/30 p-1.5 rounded-lg flex-grow overflow-y-auto max-h-32">
                {combatSubs && combatSubs.length > 0 && (
                    <div className="space-y-0.5">
                        {combatSubs.map((opt, i) => <p key={`c-${i}`} className="text-blue-300">{opt.display}</p>)}
                    </div>
                )}
                {specialSubs && specialSubs.length > 0 && (
                    <div className="space-y-0.5">
                        {specialSubs.map((opt, i) => <p key={`s-${i}`} className="text-green-300">{opt.display}</p>)}
                    </div>
                )}
                {mythicSubs && mythicSubs.length > 0 && (
                    <div className="space-y-0.5">
                        {mythicSubs.map((opt, i) => <p key={`m-${i}`} className="text-red-400">{opt.display}</p>)}
                    </div>
                )}
            </div>
        </div>
    );
};

interface RefinementResultModalProps {
    result: {
        message: string;
        success: boolean;
        itemBefore: InventoryItem;
        itemAfter: InventoryItem;
    } | null;
    onClose: () => void;
    isTopmost?: boolean;
}

const RefinementResultModal: React.FC<RefinementResultModalProps> = ({ result, onClose, isTopmost }) => {
    if (!result) return null;

    const getChangedOption = () => {
        if (!result.itemBefore.options || !result.itemAfter.options) return null;
        
        const before = result.itemBefore.options;
        const after = result.itemAfter.options;
        
        // 주옵션 변경 확인
        if (before.main.type !== after.main.type || before.main.value !== after.main.value) {
            return { type: 'main', before: before.main, after: after.main };
        }
        
        // 부옵션 변경 확인
        for (let i = 0; i < Math.max(before.combatSubs?.length || 0, after.combatSubs?.length || 0); i++) {
            const beforeSub = before.combatSubs?.[i];
            const afterSub = after.combatSubs?.[i];
            if (beforeSub && afterSub && (beforeSub.type !== afterSub.type || beforeSub.value !== afterSub.value)) {
                return { type: 'combatSub', index: i, before: beforeSub, after: afterSub };
            }
        }
        
        // 특수옵션 변경 확인
        for (let i = 0; i < Math.max(before.specialSubs?.length || 0, after.specialSubs?.length || 0); i++) {
            const beforeSub = before.specialSubs?.[i];
            const afterSub = after.specialSubs?.[i];
            if (beforeSub && afterSub && (beforeSub.type !== afterSub.type || beforeSub.value !== afterSub.value)) {
                return { type: 'specialSub', index: i, before: beforeSub, after: afterSub };
            }
        }
        
        // 신화옵션 변경 확인
        for (let i = 0; i < Math.max(before.mythicSubs?.length || 0, after.mythicSubs?.length || 0); i++) {
            const beforeSub = before.mythicSubs?.[i];
            const afterSub = after.mythicSubs?.[i];
            if (beforeSub && afterSub && beforeSub.type !== afterSub.type) {
                return { type: 'mythicSub', index: i, before: beforeSub, after: afterSub };
            }
        }
        
        return null;
    };

    const changedOption = getChangedOption();
    const optionTypeNames = {
        main: '주옵션',
        combatSub: '부옵션',
        specialSub: '특수옵션',
        mythicSub: '신화옵션'
    };

    return (
        <DraggableWindow 
            title="제련 결과" 
            onClose={onClose} 
            windowId="refinement-result"
            isTopmost={isTopmost}
            initialWidth={500}
            variant="store"
        >
            <div className="text-center flex flex-col items-center p-4">
                <div className="text-6xl mb-4 animate-bounce">⚒️</div>
                <h2 className="text-2xl font-bold text-green-400 mb-2">제련 완료!</h2>
                <p className="text-gray-300 mb-6">{result.message}</p>
                
                {result.success && changedOption && (
                    <>
                        {/* 변경된 옵션 표시 */}
                        <div className="w-full max-w-md bg-gray-900/50 p-4 rounded-lg mb-4">
                            <h4 className="font-bold text-center text-yellow-300 mb-3">
                                {optionTypeNames[changedOption.type as keyof typeof optionTypeNames]} 변경
                            </h4>
                            <div className="flex items-center justify-center gap-4">
                                <div className="flex-1">
                                    <div className="text-xs text-gray-400 mb-1">변경 전</div>
                                    <div className="text-sm text-red-400 line-through">{changedOption.before.display}</div>
                                </div>
                                <div className="text-2xl text-yellow-400">→</div>
                                <div className="flex-1">
                                    <div className="text-xs text-gray-400 mb-1">변경 후</div>
                                    <div className="text-sm text-green-400 font-bold">{changedOption.after.display}</div>
                                </div>
                            </div>
                        </div>
                        
                        {/* 아이템 비교 */}
                        <div className="w-full max-w-md grid grid-cols-2 gap-3 mb-4">
                            <ItemDisplay item={result.itemBefore} label="제련 전" />
                            <ItemDisplay item={result.itemAfter} label="제련 후" />
                        </div>
                    </>
                )}
                
                <Button onClick={onClose} colorScheme="green" className="w-full max-w-md py-2.5">
                    확인
                </Button>
            </div>
        </DraggableWindow>
    );
};

export default RefinementResultModal;

