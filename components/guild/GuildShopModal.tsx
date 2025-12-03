import React, { useState, useMemo } from 'react';
import { useAppContext } from '../../hooks/useAppContext.js';
import { Guild as GuildType, ServerAction, InventoryItem, ItemGrade } from '../../types/index.js';
import DraggableWindow from '../DraggableWindow.js';
import Button from '../Button.js';
import { GUILD_SHOP_ITEMS, GuildShopItem } from '../../constants/guildConstants.js';
import { isDifferentWeekKST, isDifferentMonthKST } from '../../utils/timeUtils.js';
import { addItemsToInventory } from '../../utils/inventoryUtils.js';
import { openGuildGradeBox } from '../../server/shop.js';
import { CONSUMABLE_ITEMS, MATERIAL_ITEMS } from '../../constants/index.js';

interface GuildShopModalProps {
    onClose: () => void;
    isTopmost?: boolean;
}

type ShopTab = 'equipment' | 'material' | 'consumable';

const gradeBackgrounds: Record<ItemGrade, string> = {
    normal: '/images/equipments/normalbgi.png',
    uncommon: '/images/equipments/uncommonbgi.png',
    rare: '/images/equipments/rarebgi.png',
    epic: '/images/equipments/epicbgi.png',
    legendary: '/images/equipments/legendarybgi.png',
    mythic: '/images/equipments/mythicbgi.png',
};


const ShopItemCard: React.FC<{ item: GuildShopItem }> = ({ item }) => {
    const { handlers, currentUserWithStatus } = useAppContext();
    const [showDescription, setShowDescription] = useState(false);
    
    const purchaseRecord = currentUserWithStatus?.dailyShopPurchases?.[item.itemId];
    const now = Date.now();
    let purchasesThisPeriod = 0;

    if (purchaseRecord) {
        if (item.limitType === 'weekly' && !isDifferentWeekKST(purchaseRecord.date, now)) {
            purchasesThisPeriod = purchaseRecord.quantity;
        }
        if (item.limitType === 'monthly' && !isDifferentMonthKST(purchaseRecord.date, now)) {
            purchasesThisPeriod = purchaseRecord.quantity;
        }
    }

    const remaining = item.limit - purchasesThisPeriod;
    const canAfford = (currentUserWithStatus?.guildCoins ?? 0) >= item.cost;
    const canPurchase = remaining > 0 && canAfford;

    const handleBuy = () => {
        if (canPurchase) {
            handlers.handleAction({
                type: 'GUILD_BUY_SHOP_ITEM',
                payload: { shopItemId: item.itemId, itemId: item.itemId, quantity: 1 }
            });
        }
    };

    return (
        <div className="bg-gradient-to-br from-stone-900/95 via-neutral-800/90 to-stone-900/95 rounded-xl p-3 flex flex-col items-center text-center border-2 border-stone-600/60 shadow-xl hover:shadow-2xl transition-all hover:border-stone-500/80 relative overflow-visible h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-stone-500/10 via-gray-500/5 to-stone-500/10 pointer-events-none"></div>
            <div className="relative z-10 w-full flex flex-col h-full">
             <div 
                className="relative w-20 h-20 bg-gradient-to-br from-stone-800/90 to-stone-900/90 rounded-lg mb-2 flex items-center justify-center border-2 border-stone-600/60 shadow-lg mx-auto flex-shrink-0 cursor-pointer hover:scale-105 transition-transform"
                onClick={() => setShowDescription(!showDescription)}
                onMouseEnter={() => setShowDescription(true)}
                onMouseLeave={() => setShowDescription(false)}
            >
                 <img src={gradeBackgrounds[item.grade]} alt={item.grade} className="absolute inset-0 w-full h-full object-cover rounded-lg opacity-80" />
                <img src={item.image} alt={item.name} className="absolute object-contain p-2 z-10 drop-shadow-xl" style={{ width: '80%', height: '80%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
            </div>
            <h3 className="text-xs font-bold text-white mb-0.5 drop-shadow-lg line-clamp-1 flex-shrink-0">{item.name}</h3>
            {showDescription && (
                <div className="absolute z-50 top-24 left-1/2 -translate-x-1/2 w-48 bg-gray-900/95 border border-stone-600/50 rounded-lg p-2 shadow-xl">
                    <p className="text-[9px] text-stone-300/90 leading-tight">
                        {item.description}
                    </p>
                </div>
            )}
            <div className="flex flex-col items-stretch justify-center gap-1.5 mt-auto w-full flex-shrink-0">
                <button
                    onClick={handleBuy}
                    disabled={!canPurchase}
                    className={`w-full py-2 rounded-lg font-bold text-xs transition-all relative overflow-hidden group ${
                        canPurchase 
                            ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-500/30 hover:shadow-xl hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98]' 
                            : 'bg-stone-700/50 text-stone-400 cursor-not-allowed'
                    }`}
                >
                    {canPurchase && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
                    )}
                    <div className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <span>구매</span>
                        <div className="flex items-center gap-1">
                            <img src="/images/guild/tokken.png" alt="길드 코인" className="w-4 h-4 drop-shadow-md" /> 
                            <span className="font-bold text-[10px]">{item.cost.toLocaleString()}</span>
                        </div>
                    </div>
                </button>
            </div>
            <p className="text-[9px] text-stone-400 bg-stone-800/50 px-1.5 py-0.5 rounded-md border border-stone-700/50 mt-1 flex-shrink-0">
                {item.limitType === 'weekly' ? '주간' : '월간'} <span className={`font-bold ${remaining > 0 ? 'text-amber-300' : 'text-red-400'}`}>{remaining}/{item.limit}</span>
            </p>
            </div>
        </div>
    );
};


const GuildShopModal: React.FC<GuildShopModalProps> = ({ onClose, isTopmost }) => {
    const { currentUserWithStatus } = useAppContext();
    const [activeTab, setActiveTab] = useState<ShopTab>('equipment');

    const shopItemsForTab = useMemo(() => {
        const typeMap: Record<ShopTab, GuildShopItem['type'] | 'equipment_box'> = {
            'equipment': 'equipment_box',
            'material': 'material',
            'consumable': 'consumable',
        };
        return GUILD_SHOP_ITEMS.filter(item => item.type === typeMap[activeTab]);
    }, [activeTab]);

    return (
        <DraggableWindow title="길드 상점" onClose={onClose} windowId="guild-shop" initialWidth={1000} initialHeight={850} isTopmost={isTopmost} variant="store">
            <div className="flex flex-col h-full relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-stone-950/50 via-neutral-900/30 to-stone-950/50 pointer-events-none"></div>
                <div className="relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 bg-gradient-to-br from-amber-600/80 to-orange-600/80 rounded-xl flex items-center justify-center border-2 border-amber-400/50 shadow-lg shadow-amber-500/20">
                            <span className="text-xl">🛒</span>
                        </div>
                        <h3 className="text-xl font-bold bg-gradient-to-r from-amber-300 to-orange-300 bg-clip-text text-transparent">길드 상점</h3>
                    </div>
                    <div className="bg-gradient-to-br from-amber-900/90 via-yellow-800/80 to-amber-900/90 p-3 rounded-xl text-center border-2 border-amber-500/60 shadow-2xl backdrop-blur-md relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-yellow-400/10 to-amber-500/15 pointer-events-none"></div>
                        <div className="relative z-10">
                            <p className="text-[10px] text-amber-200/80 mb-0.5 font-semibold">보유 길드 코인</p>
                            <p className="font-bold text-lg text-yellow-300 drop-shadow-lg flex items-center justify-center gap-1.5">
                                <img src="/images/guild/tokken.png" alt="Guild Coin" className="w-5 h-5 drop-shadow-md" />
                                {(currentUserWithStatus?.guildCoins ?? 0).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex bg-gradient-to-r from-stone-800/90 via-neutral-800/80 to-stone-800/90 p-1 rounded-xl mb-3 flex-shrink-0 border border-stone-600/50 shadow-lg">
                    {(['equipment', 'material', 'consumable'] as ShopTab[]).map(tab => {
                        const tabColors = {
                            equipment: { active: 'from-purple-600 to-indigo-600', inactive: 'text-purple-300/70 hover:text-purple-300' },
                            material: { active: 'from-blue-600 to-cyan-600', inactive: 'text-blue-300/70 hover:text-blue-300' },
                            consumable: { active: 'from-green-600 to-emerald-600', inactive: 'text-green-300/70 hover:text-green-300' },
                        };
                        const colors = tabColors[tab] || { active: 'from-accent to-accent/80', inactive: 'text-tertiary' };
                        const labels = { equipment: '장비', material: '재료', consumable: '소모품' };
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                                    activeTab === tab 
                                        ? `bg-gradient-to-r ${colors.active} text-white shadow-lg` 
                                        : `${colors.inactive} hover:bg-stone-700/50`
                                }`}
                            >
                                {labels[tab]}
                            </button>
                        );
                    })}
                </div>
                 <div className="grid grid-cols-3 gap-2.5 overflow-y-auto pr-2 flex-1 min-h-0">
                    {shopItemsForTab.map(item => (
                        <ShopItemCard key={item.itemId} item={item} />
                    ))}
                </div>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default GuildShopModal;