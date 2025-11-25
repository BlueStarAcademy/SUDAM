import React from 'react';
import DraggableWindow from './DraggableWindow.js';
import Button from './Button.js';
import { InventoryItem } from '../types.js';
import { ITEM_SELL_PRICES, MATERIAL_SELL_PRICES, CONSUMABLE_SELL_PRICES } from '../constants/items.js';

interface SellItemConfirmModalProps {
    item: InventoryItem;
    onClose: () => void;
    onConfirm: () => void;
    isTopmost?: boolean;
}

const SellItemConfirmModal: React.FC<SellItemConfirmModalProps> = ({ item, onClose, onConfirm, isTopmost }) => {
    const calculateSellPrice = (): number => {
        if (item.type === 'equipment') {
            const basePrice = ITEM_SELL_PRICES[item.grade] || 0;
            const enhancementMultiplier = Math.pow(1.2, item.stars);
            return Math.floor(basePrice * enhancementMultiplier);
        } else if (item.type === 'material') {
            // 재료는 1개만 판매
            const pricePerUnit = MATERIAL_SELL_PRICES[item.name] || 1;
            return pricePerUnit;
        } else if (item.type === 'consumable') {
            // 소비 아이템 판매 가격
            const pricePerUnit = CONSUMABLE_SELL_PRICES[item.name] ?? (CONSUMABLE_SELL_PRICES[item.name?.replace('골드꾸러미', '골드 꾸러미')] ?? 0);
            return pricePerUnit;
        }
        return 0;
    };

    const sellPrice = calculateSellPrice();

    return (
        <DraggableWindow 
            title="아이템 판매 확인" 
            onClose={onClose} 
            windowId="sellItemConfirm" 
            isTopmost={isTopmost}
            zIndex={60}
        >
            <div className="p-4 text-on-panel flex flex-col items-center">
                <div className="mb-4 text-center">
                    <h3 className="text-lg font-bold mb-2">이 아이템을 판매하시겠습니까?</h3>
                    <div className="flex items-center justify-center gap-4 my-4">
                        {item.image && (
                            <div className="relative w-20 h-20 rounded-lg flex-shrink-0">
                                <img src={item.image} alt={item.name} className="absolute object-contain" style={{ width: '80%', height: '80%', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                            </div>
                        )}
                        <div className="text-left">
                            <p className="font-semibold text-lg">{item.name}</p>
                            {item.type === 'equipment' && item.stars > 0 && (
                                <p className="text-sm text-gray-400">강화: {item.stars}성</p>
                            )}
                            {item.type === 'material' && item.quantity && (
                                <p className="text-sm text-gray-400">보유: {item.quantity.toLocaleString()}개 (1개 판매)</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="w-full bg-gray-800/50 p-4 rounded-lg mb-4">
                    <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold">판매 가격:</span>
                        <span className="text-2xl font-bold text-yellow-400">
                            {sellPrice.toLocaleString()} 골드
                        </span>
                    </div>
                </div>

                <div className="flex gap-4 w-full">
                    <Button onClick={onClose} colorScheme="gray" className="flex-1">
                        취소
                    </Button>
                    <Button onClick={onConfirm} colorScheme="red" className="flex-1">
                        판매
                    </Button>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default SellItemConfirmModal;

