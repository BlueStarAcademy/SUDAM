import { User } from '../../types/index.js';
import { deepClone } from './cloneHelper.js';

/**
 * 액션 타입에 따라 필요한 User 필드만 반환하는 헬퍼 함수
 * 메시지 크기를 대폭 줄이기 위한 최적화
 */
export function getSelectiveUserUpdate(
    user: User, 
    actionType: string, 
    options?: { includeAll?: boolean; additionalFields?: string[] }
): Partial<User> {
    const { includeAll = false, additionalFields = [] } = options || {};
    
    // 항상 포함해야 하는 기본 필드
    const baseFields = ['id', 'isAdmin'];
    
    // 액션 타입별 필요한 필드 맵
    const fieldMap: Record<string, string[]> = {
        // 인벤토리 관련
        'USE_ITEM': ['inventory', 'gold', 'diamonds', 'actionPoints'],
        'USE_ALL_ITEMS_OF_TYPE': ['inventory', 'gold', 'diamonds', 'actionPoints'],
        'TOGGLE_EQUIP_ITEM': ['inventory', 'equipment', 'actionPoints'],
        'SELL_ITEM': ['inventory', 'gold'],
        'COMBINE_ITEMS': ['inventory', 'blacksmithLevel', 'blacksmithXp'],
        'ENHANCE_ITEM': ['inventory', 'gold', 'diamonds', 'blacksmithLevel', 'blacksmithXp'],
        'DISASSEMBLE_ITEM': ['inventory', 'blacksmithLevel', 'blacksmithXp'],
        'CRAFT_MATERIAL': ['inventory'],
        'EXPAND_INVENTORY': ['inventorySlots', 'diamonds'],
        
        // 상점 관련
        'BUY_SHOP_ITEM': ['inventory', 'gold', 'diamonds'],
        'BUY_MATERIAL_BOX': ['inventory', 'gold', 'diamonds', 'dailyShopPurchases'],
        'BUY_CONDITION_POTION': ['inventory', 'gold', 'dailyShopPurchases'],
        'BUY_BORDER': ['ownedBorders', 'gold', 'diamonds'],
        'PURCHASE_ACTION_POINTS': ['actionPoints', 'diamonds', 'actionPointPurchasesToday', 'lastActionPointPurchaseDate'],
        
        // 프로필 관련
        'UPDATE_AVATAR': ['avatarId'],
        'UPDATE_BORDER': ['borderId'],
        'CHANGE_NICKNAME': ['nickname', 'diamonds'],
        'UPDATE_MBTI': ['mbti', 'isMbtiPublic', 'diamonds'],
        'MANNER_ACTION': ['mannerScore', 'mannerMasteryApplied', 'actionPoints'],
        'RESET_STAT_POINTS': ['spentStatPoints', 'gold', 'lastStatResetDate', 'statResetCountToday'],
        'CONFIRM_STAT_ALLOCATION': ['spentStatPoints'],
        'SAVE_PRESET': ['equipmentPresets'],
        'APPLY_PRESET': ['equipment', 'inventory'],
        
        // 보상 관련
        'CLAIM_QUEST_REWARD': ['inventory', 'gold', 'diamonds', 'actionPoints', 'quests'],
        'CLAIM_ACTIVITY_MILESTONE': ['inventory', 'gold', 'diamonds', 'actionPoints', 'quests'],
        'CLAIM_MAIL_ATTACHMENTS': ['inventory', 'gold', 'diamonds', 'actionPoints', 'mail'],
        'CLAIM_ALL_MAIL_ATTACHMENTS': ['inventory', 'gold', 'diamonds', 'actionPoints', 'mail'],
        'DELETE_MAIL': ['mail'],
        'DELETE_ALL_CLAIMED_MAIL': ['mail'],
        'MARK_MAIL_AS_READ': ['mail'],
        'CLAIM_SINGLE_PLAYER_MISSION_REWARD': ['inventory', 'gold', 'diamonds', 'singlePlayerMissions'],
        
        // 토너먼트 관련
        'USE_CONDITION_POTION': ['inventory', 'gold', 'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament'],
        'START_TOURNAMENT_SESSION': ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament', 'actionPoints'],
        'START_TOURNAMENT_ROUND': ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament'],
        'ADMIN_RESET_TOURNAMENT_SESSION': ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament', 'dungeonProgress'],
        'ADMIN_RESET_DUNGEON_PROGRESS': ['dungeonProgress'],
        'ADMIN_RESET_CHAMPIONSHIP_ALL': ['dungeonProgress', 'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament', 'lastNeighborhoodPlayedDate', 'lastNationalPlayedDate', 'lastWorldPlayedDate', 'neighborhoodRewardClaimed', 'nationalRewardClaimed', 'worldRewardClaimed'],
        'CLAIM_TOURNAMENT_REWARD': ['inventory', 'gold', 'diamonds', 'tournamentScore', 'neighborhoodRewardClaimed', 'nationalRewardClaimed', 'worldRewardClaimed', 'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament'],
        'START_DUNGEON_STAGE': ['dungeonProgress', 'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament'],
        'COMPLETE_DUNGEON_STAGE': ['dungeonProgress', 'inventory', 'gold', 'diamonds', 'tournamentScore', 'cumulativeTournamentScore', 'dailyDungeonScore'],
        
        // 싱글플레이어 관련
        'START_SINGLE_PLAYER_GAME': ['actionPoints', 'singlePlayerProgress'],
        
        // 길드 관련
        'GUILD_DONATE_GOLD': ['gold', 'guildCoins', 'dailyDonations'],
        'GUILD_DONATE_DIAMOND': ['diamonds', 'guildCoins', 'dailyDonations'],
        
        // 소셜 관련
        'LOGOUT': [], // 로그아웃은 사용자 데이터 반환 불필요
    };
    
    // 모든 필드를 포함해야 하는 경우
    if (includeAll) {
        return deepClone(user);
    }
    
    // 액션 타입에 해당하는 필드 가져오기
    const requiredFields = fieldMap[actionType] || [
        // 기본 필드 (대부분의 액션이 변경할 수 있는 필드)
        'inventory', 'equipment', 'gold', 'diamonds', 'actionPoints'
    ];
    
    // 추가 필드 포함
    const allFields = [...new Set([...baseFields, ...requiredFields, ...additionalFields])];
    
    // 선택적 User 객체 생성
    const selectiveUser: Partial<User> = {};
    
    for (const field of allFields) {
        const key = field as keyof User;
        if (key in user) {
            // 깊은 복사로 참조 문제 방지
            const value = user[key];
            if (value !== undefined) {
                if (typeof value === 'object' && value !== null) {
                    selectiveUser[key] = deepClone(value) as any;
                } else {
                    selectiveUser[key] = value as any;
                }
            }
        }
    }
    
    return selectiveUser;
}

/**
 * 두 User 객체 간의 델타(차이)를 계산하여 변경된 필드만 반환
 */
export function getUserDelta(oldUser: User | null, newUser: User): Partial<User> {
    if (!oldUser) {
        // 이전 상태가 없으면 모든 필드 반환
        return getSelectiveUserUpdate(newUser, '', { includeAll: true });
    }
    
    const delta: Partial<User> = { id: newUser.id };
    
    // 주요 필드 비교
    const fieldsToCompare: (keyof User)[] = [
        'inventory', 'equipment', 'gold', 'diamonds', 'actionPoints',
        'avatarId', 'borderId', 'nickname', 'mbti', 'isMbtiPublic',
        'spentStatPoints', 'equipmentPresets', 'mail', 'quests',
        'inventorySlots', 'blacksmithLevel', 'blacksmithXp',
        'lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament',
        'singlePlayerProgress', 'clearedSinglePlayerStages'
    ];
    
    for (const field of fieldsToCompare) {
        const oldValue = oldUser[field];
        const newValue = newUser[field];
        
        // 깊은 비교
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            if (typeof newValue === 'object' && newValue !== null) {
                delta[field] = deepClone(newValue) as any;
            } else {
                delta[field] = newValue as any;
            }
        }
    }
    
    return delta;
}

