
import React, { useState, useEffect } from 'react';
import { UserWithStatus, ServerAction, InventoryItemType } from '../types.js';
import DraggableWindow from './DraggableWindow.js';
import Button from './Button.js';
import { ACTION_POINT_PURCHASE_COSTS_DIAMONDS, MAX_ACTION_POINT_PURCHASES_PER_DAY, ACTION_POINT_PURCHASE_REFILL_AMOUNT } from '../constants';
import { isDifferentWeekKST } from '../utils/timeUtils.js';
import PurchaseQuantityModal from './PurchaseQuantityModal.js';
import { useAppContext } from '../hooks/useAppContext.js';

interface ShopModalProps {
    currentUser?: UserWithStatus; // Optional: useAppContext에서 가져올 수 있도록
    onClose: () => void;
    onAction: (action: ServerAction) => void;
    isTopmost?: boolean;
    initialTab?: ShopTab;
}

type ShopTab = 'equipment' | 'materials' | 'misc' | 'consumables';

interface PurchasableItem {
    itemId: string;
    name: string;
    price: { gold?: number; diamonds?: number };
    limit?: number;
    type: InventoryItemType;
}

const isSameDayKST = (ts1: number, ts2: number): boolean => {
    if (!ts1 || !ts2) return false;
    const KST_OFFSET = 9 * 60 * 60 * 1000;
    const d1 = new Date(ts1 + KST_OFFSET);
    const d2 = new Date(ts2 + KST_OFFSET);
    return d1.getUTCFullYear() === d2.getUTCFullYear() &&
           d1.getUTCMonth() === d2.getUTCMonth() &&
           d1.getUTCDate() === d2.getUTCDate();
};

const formatDescription = (desc: string): string => {
    if (!desc) return '';
    const cleaned = desc
        .replace(/~/g, ' ~ ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleaned.endsWith('획득')) {
        return `${cleaned}합니다.`;
    }

    if (!/[.!?]$/.test(cleaned)) {
        return `${cleaned}.`;
    }

    return cleaned;
};

const ActionPointCard: React.FC<{ currentUser: UserWithStatus, onBuy: () => void }> = ({ currentUser, onBuy }) => {
    const now = Date.now();
    const purchasesToday = isSameDayKST(currentUser.lastActionPointPurchaseDate || 0, now) 
        ? (currentUser.actionPointPurchasesToday || 0) 
        : 0;

    const costIndex = Math.min(purchasesToday, ACTION_POINT_PURCHASE_COSTS_DIAMONDS.length - 1);
    const cost = ACTION_POINT_PURCHASE_COSTS_DIAMONDS[costIndex] ?? ACTION_POINT_PURCHASE_COSTS_DIAMONDS[ACTION_POINT_PURCHASE_COSTS_DIAMONDS.length - 1];
    const canPurchase = purchasesToday < MAX_ACTION_POINT_PURCHASES_PER_DAY;
    
    const handlePurchase = () => {
        if (!canPurchase) return;
        const canAfford = currentUser.diamonds >= cost;
        if (!canAfford) {
            alert('다이아가 부족합니다.');
            return;
        }
        onBuy();
    };

    return (
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1f3e]/95 via-[#0f172a]/95 to-[#060b15]/95 border border-cyan-400/30 shadow-[0_25px_60px_-25px_rgba(34,211,238,0.55)] p-5 flex flex-col items-center text-center transition-transform duration-300 hover:-translate-y-1 hover:shadow-[0_30px_70px_-30px_rgba(59,130,246,0.65)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent pointer-events-none" />
            <div className="absolute inset-0 opacity-0 pointer-events-none transition-opacity duration-500 group-hover:opacity-20 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.3),transparent_55%)]" />
            <div className="w-24 h-24 bg-gradient-to-br from-[#14b8a6]/30 via-[#06b6d4]/20 to-transparent rounded-xl mb-4 flex items-center justify-center relative">
                <span className="text-5xl text-cyan-300 drop-shadow-[0_0_18px_rgba(14,165,233,0.35)]">⚡</span>
                <span className="absolute bottom-2 right-2 text-2xl font-bold text-cyan-200 drop-shadow-[0_0_8px_rgba(14,165,233,0.5)]">{ACTION_POINT_PURCHASE_REFILL_AMOUNT}</span>
            </div>
            <h3 className="text-xl font-bold tracking-wide text-white drop-shadow-lg">행동력 충전</h3>
            <p className="text-sm text-slate-200/85 mt-2 leading-relaxed flex-grow">
                최대치 초과가능
            </p>
            <div className="mt-4 flex flex-col items-center justify-center gap-2 w-full">
                <Button
                    onClick={handlePurchase}
                    disabled={!canPurchase}
                    colorScheme="none"
                    className={`w-full justify-center rounded-xl border border-cyan-400/60 bg-gradient-to-r from-cyan-400/90 via-sky-400/90 to-blue-500/90 text-slate-900 font-semibold tracking-wide shadow-[0_10px_30px_-12px_rgba(14,165,233,0.65)] hover:from-cyan-300 hover:to-blue-400 ${canPurchase ? '' : 'opacity-50 cursor-not-allowed'}`}
                >
                    <div className="flex flex-col items-center justify-center gap-0.5">
                        <div className="flex items-center justify-center gap-2 text-sm sm:text-base">
                            <img src="/images/icon/Zem.png" alt="다이아" className="w-5 h-5 drop-shadow-md" />
                            <span>{cost.toLocaleString()}</span>
                        </div>
                        <span className="text-[10px] text-slate-700/90 tracking-wide">
                            오늘 구매 {purchasesToday}/{MAX_ACTION_POINT_PURCHASES_PER_DAY}
                        </span>
                    </div>
                </Button>
                {!canPurchase && (
                    <span className="text-xs text-cyan-100/80 italic mt-1">오늘 구매 한도에 도달했습니다.</span>
                )}
            </div>
        </div>
    );
};

const ShopItemCard: React.FC<{ 
    item: { itemId: string, name: string, description: string, price: { gold?: number, diamonds?: number }, image: string, dailyLimit?: number, weeklyLimit?: number, type: InventoryItemType },
    onBuy: (item: PurchasableItem) => void; 
    currentUser: UserWithStatus 
}> = ({ item, onBuy, currentUser }) => {
    const { name, description, price, image, dailyLimit, weeklyLimit } = item;
    const isGold = !!price.gold;
    const priceAmount = price.gold || price.diamonds || 0;
    const PriceIcon = isGold ? <img src="/images/icon/Gold.png" alt="골드" className="w-5 h-5 drop-shadow-md" /> : <img src="/images/icon/Zem.png" alt="다이아" className="w-5 h-5 drop-shadow-md" />;
    const refinedDescription = formatDescription(description);

    const now = Date.now();
    const purchaseRecord = currentUser.dailyShopPurchases?.[item.itemId];
    
    let purchasesThisPeriod = 0;
    let limit = 0;
    let limitText = '';

    if (weeklyLimit) {
        purchasesThisPeriod = (purchaseRecord && !isDifferentWeekKST(purchaseRecord.date, now)) ? purchaseRecord.quantity : 0;
        limit = weeklyLimit;
        limitText = '주간';
    } else if (dailyLimit) {
        purchasesThisPeriod = (purchaseRecord && isSameDayKST(purchaseRecord.date, now)) ? purchaseRecord.quantity : 0;
        limit = dailyLimit;
        limitText = '일일';
    }
    
    const remaining = limit > 0 ? limit - purchasesThisPeriod : (item.type === 'equipment' ? 100 : undefined);

    const handleBuyClick = () => {
        onBuy({ ...item, limit: remaining });
    };

    return (
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1f2239]/95 via-[#0f172a]/95 to-[#060b12]/95 p-4 border border-indigo-400/35 shadow-[0_22px_55px_-30px_rgba(99,102,241,0.65)] flex flex-col items-center text-center transition-transform duration-300 hover:-translate-y-1 hover:shadow-[0_30px_70px_-32px_rgba(129,140,248,0.65)] min-h-[230px]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/80 to-transparent pointer-events-none" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-500 bg-[radial-gradient(circle_at_top,rgba(79,70,229,0.35),transparent_65%)] pointer-events-none" />
            <div className="w-20 h-20 bg-gradient-to-br from-[#312e81]/35 via-[#1e1b4b]/20 to-transparent rounded-xl mb-3 flex items-center justify-center shadow-[0_0_25px_-8px_rgba(129,140,248,0.65)]">
                <img src={image} alt={name} className="w-full h-full object-contain p-2 drop-shadow-[0_6px_12px_rgba(30,64,175,0.4)]" />
            </div>
            <h3 className="text-lg font-semibold tracking-wide text-white drop-shadow-[0_2px_12px_rgba(99,102,241,0.55)]">
                {name}
            </h3>
            <p className="text-xs text-slate-200/80 mt-2 leading-relaxed line-clamp-2">
                {refinedDescription}
            </p>
            <div className="flex flex-col items-stretch justify-center gap-2 mt-3 w-full">
                <Button
                    onClick={handleBuyClick}
                    disabled={remaining === 0}
                    colorScheme="none"
                    className={`w-full justify-center rounded-xl border ${isGold ? 'border-amber-400/50 bg-gradient-to-r from-amber-400/90 via-amber-300/90 to-amber-500/90 text-slate-900 shadow-[0_12px_32px_-18px_rgba(251,191,36,0.85)] hover:from-amber-300 hover:to-amber-500' : 'border-sky-400/50 bg-gradient-to-r from-sky-400/90 via-blue-500/90 to-indigo-500/90 text-white shadow-[0_12px_32px_-18px_rgba(56,189,248,0.85)] hover:from-sky-300 hover:to-indigo-500'} ${remaining === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <div className="flex flex-col items-center justify-center gap-0.5">
                        <div className="flex items-center justify-center gap-2 text-sm sm:text-base font-semibold tracking-wide">
                            {PriceIcon}
                            <span>{priceAmount.toLocaleString()}</span>
                        </div>
                        {limit > 0 && (
                            <span className={`text-[10px] ${isGold ? 'text-slate-700/90' : 'text-white/70'} tracking-wide`}>
                                {limitText} 한도 {remaining}/{limit}
                            </span>
                        )}
                    </div>
                </Button>
            </div>
        </div>
    );
};

const ShopModal: React.FC<ShopModalProps> = ({ currentUser: propCurrentUser, onClose, onAction, isTopmost, initialTab }) => {
    const { currentUserWithStatus } = useAppContext();
    // useAppContext의 currentUserWithStatus를 우선 사용 (최신 상태 보장)
    const currentUser = currentUserWithStatus || propCurrentUser;
    
    if (!currentUser) {
        return null;
    }
    
    const [activeTab, setActiveTab] = useState<ShopTab>(initialTab || 'equipment');
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [purchasingItem, setPurchasingItem] = useState<PurchasableItem | null>(null);

    useEffect(() => {
        if (toastMessage) {
            const timer = setTimeout(() => setToastMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toastMessage]);

    const handleInitiatePurchase = (item: PurchasableItem) => {
        setPurchasingItem(item);
    };

    const handleConfirmPurchase = (itemId: string, quantity: number) => {
        const item = purchasingItem;
        if (!item) return;

        // 컨디션 회복제는 별도의 액션 사용
        if (itemId.startsWith('condition_potion_')) {
            const potionType = itemId.replace('condition_potion_', '') as 'small' | 'medium' | 'large';
            onAction({ type: 'BUY_CONDITION_POTION', payload: { potionType, quantity } });
        } else if (itemId === 'option_type_change_ticket' || itemId === 'option_value_change_ticket') {
            // 변경권 구매
            onAction({ type: 'BUY_CONSUMABLE', payload: { itemId, quantity } });
        } else {
            const actionType = item.type === 'equipment' ? 'BUY_SHOP_ITEM' : 'BUY_MATERIAL_BOX';
            onAction({ type: actionType, payload: { itemId, quantity } });
        }
        setToastMessage('구매 완료! 가방을 확인하세요.');
        setPurchasingItem(null);
    };
    
    const handleBuyActionPoints = () => {
        onAction({ type: 'PURCHASE_ACTION_POINTS' });
        setToastMessage('행동력 구매 완료!');
    };

    const renderContent = () => {
        const equipmentItems = [
            { itemId: 'equipment_box_1', name: "장비 상자 I", description: "일반~희귀 등급 장비", price: { gold: 500 }, image: "/images/Box/EquipmentBox1.png", type: 'equipment' as const },
            { itemId: 'equipment_box_2', name: "장비 상자 II", description: "일반~에픽 등급 장비", price: { gold: 1500 }, image: "/images/Box/EquipmentBox2.png", type: 'equipment' as const },
            { itemId: 'equipment_box_3', name: "장비 상자 III", description: "고급~전설 등급 장비", price: { gold: 5000 }, image: "/images/Box/EquipmentBox3.png", type: 'equipment' as const },
            { itemId: 'equipment_box_4', name: "장비 상자 IV", description: "희귀~신화 등급 장비", price: { gold: 10000 }, image: "/images/Box/EquipmentBox4.png", type: 'equipment' as const },
            { itemId: 'equipment_box_5', name: "장비 상자 V", description: "에픽~신화 등급 장비", price: { diamonds: 100 }, image: "/images/Box/EquipmentBox5.png", type: 'equipment' as const },
            { itemId: 'equipment_box_6', name: "장비 상자 VI", description: "전설~신화 등급 장비", price: { diamonds: 500 }, image: "/images/Box/EquipmentBox6.png", type: 'equipment' as const },
        ];
        const materialItems = [
            { itemId: "material_box_1", name: "재료 상자 I", description: "하급~상급강화석 5개", price: { gold: 500 }, image: "/images/Box/ResourceBox1.png", dailyLimit: 10, type: 'material' as const },
            { itemId: "material_box_2", name: "재료 상자 II", description: "하급~상급강화석 5개", price: { gold: 1000 }, image: "/images/Box/ResourceBox2.png", dailyLimit: 10, type: 'material' as const },
            { itemId: "material_box_3", name: "재료 상자 III", description: "하급~상급강화석 5개", price: { gold: 3000 }, image: "/images/Box/ResourceBox3.png", dailyLimit: 10, type: 'material' as const },
            { itemId: "material_box_4", name: "재료 상자 IV", description: "중급~최상급강화석 5개", price: { gold: 5000 }, image: "/images/Box/ResourceBox4.png", dailyLimit: 10, type: 'material' as const },
            { itemId: "material_box_5", name: "재료 상자 V", description: "상급~신비의강화석 5개", price: { gold: 10000 }, image: "/images/Box/ResourceBox5.png", dailyLimit: 10, type: 'material' as const },
            { itemId: "material_box_6", name: "재료 상자 VI", description: "상급~신비의강화석 5개", price: { diamonds: 100 }, image: "/images/Box/ResourceBox6.png", dailyLimit: 10, type: 'material' as const },
        ];

        switch (activeTab) {
            case 'equipment':
                return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {equipmentItems.map(item => <ShopItemCard key={item.itemId} item={item} onBuy={handleInitiatePurchase} currentUser={currentUser} />)}
                    </div>
                );
            case 'materials':
                 return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {materialItems.map(item => <ShopItemCard key={item.itemId} item={item} onBuy={handleInitiatePurchase} currentUser={currentUser} />)}
                    </div>
                );
            case 'misc':
                 return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <ActionPointCard currentUser={currentUser} onBuy={handleBuyActionPoints} />
                    </div>
                );
            case 'consumables':
            default:
                const consumableItems = [
                    { itemId: 'condition_potion_small', name: "컨디션회복제(소)", description: "컨디션 1~10회복", price: { gold: 100 }, image: "/images/use/con1.png", dailyLimit: 3, type: 'consumable' as const },
                    { itemId: 'condition_potion_medium', name: "컨디션회복제(중)", description: "컨디션 10~20회복", price: { gold: 150 }, image: "/images/use/con2.png", dailyLimit: 3, type: 'consumable' as const },
                    { itemId: 'condition_potion_large', name: "컨디션회복제(대)", description: "컨디션 20~30회복", price: { gold: 200 }, image: "/images/use/con3.png", dailyLimit: 3, type: 'consumable' as const },
                    { itemId: 'option_type_change_ticket', name: "옵션 종류 변경권", description: "장비의 주옵션, 부옵션, 특수옵션 중 하나를 다른 종류로 변경", price: { gold: 500 }, image: "/images/use/change1.png", dailyLimit: 10, type: 'consumable' as const },
                    { itemId: 'option_value_change_ticket', name: "옵션 수치 변경권", description: "장비의 부옵션 또는 특수옵션 중 하나의 수치를 변경", price: { gold: 500 }, image: "/images/use/change2.png", dailyLimit: 10, type: 'consumable' as const },
                ];
                return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {consumableItems.map(item => <ShopItemCard key={item.itemId} item={item} onBuy={handleInitiatePurchase} currentUser={currentUser} />)}
                    </div>
                );
        }
    };

    return (
        <>
            {purchasingItem && (
                <PurchaseQuantityModal 
                    item={purchasingItem}
                    currentUser={currentUser}
                    onClose={() => setPurchasingItem(null)}
                    onConfirm={handleConfirmPurchase}
                />
            )}
            <DraggableWindow title="상점" onClose={onClose} windowId="shop" initialWidth={900} initialHeight={750} isTopmost={isTopmost && !purchasingItem}>
                <div className="h-[calc(var(--vh,1vh)*60)] flex flex-col relative">
                    <div className="flex bg-gray-900/70 p-1 rounded-lg mb-4 flex-shrink-0">
                        <button onClick={() => setActiveTab('equipment')} className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'equipment' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>장비</button>
                        <button onClick={() => setActiveTab('materials')} className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'materials' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>재료</button>
                        <button onClick={() => setActiveTab('consumables')} className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'consumables' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>소모품</button>
                        <button onClick={() => setActiveTab('misc')} className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'misc' ? 'bg-blue-600' : 'text-gray-400 hover:bg-gray-700/50'}`}>기타</button>
                    </div>

                    <div className="flex-grow overflow-y-auto pr-2">
                        {renderContent()}
                    </div>

                    {toastMessage && (
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg animate-fade-in z-10">
                            {toastMessage}
                        </div>
                    )}
                </div>
            </DraggableWindow>
        </>
    );
};

export default ShopModal;
