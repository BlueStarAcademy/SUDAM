import {
    User, LiveGameSession, Negotiation, KomiBid,
    AdminLog, Announcement, OverrideAnnouncement, InventoryItem,
    QuestReward, DailyQuestData, WeeklyQuestData, MonthlyQuestData, TournamentState, UserWithStatus, EquipmentPreset, GameSettings, CommentaryLine, HomeBoardPost
} from './entities.js';
import { GameMode, RPSChoice, Point, Player, UserStatus, TournamentType, InventoryItemType, GameCategory, EquipmentSlot, BoardState } from './enums.js';
import type { WinReason } from './enums.js';

export type ChatMessage = {
  id: string;
  user: { id: string, nickname: string };
  text?: string;
  emoji?: string;
  system: boolean;
  timestamp: number;
  location?: string;
  actionInfo?: {
      message: string;
      scoreChange: number;
  };
  itemLink?: {
      itemId: string;
      userId: string;
      itemName: string;
      itemGrade?: string; // 장비 등급 (색상 적용용)
  };
  userLink?: {
      userId: string;
      userName: string;
  };
};

export type HandleActionResult = { 
    clientResponse?: any;
    matchingInfo?: any;
    error?: string;
    claimAllTrainingQuestRewards?: any;
    gameId?: string;
    donationResult?: any;
};

export interface AppState {
    users: Record<string, User>;
    userCredentials: Record<string, any>; // Not sent to client
    liveGames: Record<string, LiveGameSession>;  // 일반 게임만 포함 (normal category)
    singlePlayerGames: Record<string, LiveGameSession>;  // 싱글플레이 게임
    towerGames: Record<string, LiveGameSession>;  // 도전의 탑 게임
    userConnections: Record<string, number>;
    userStatuses: Record<string, UserStatusInfo>;
    negotiations: Record<string, Negotiation>;
    waitingRoomChats: Record<string, ChatMessage[]>;
    gameChats: Record<string, ChatMessage[]>;
    userLastChatMessage: Record<string, number>;
    adminLogs: AdminLog[];
    gameModeAvailability: Partial<Record<GameMode, boolean>>;
    announcements: Announcement[];
    globalOverrideAnnouncement: OverrideAnnouncement | null;
    announcementInterval: number;
    homeBoardPosts: HomeBoardPost[];
}

export interface RankedMatchingEntry {
    userId: string;
    lobbyType: 'strategic' | 'playful';
    selectedModes: GameMode[];
    startTime: number;
    rating: number;
}

export interface VolatileState {
    userConnections: Record<string, number>;
    userStatuses: Record<string, UserStatusInfo>;
    negotiations: Record<string, Negotiation>;
    waitingRoomChats: Record<string, ChatMessage[]>;
    gameChats: Record<string, ChatMessage[]>;
    userLastChatMessage: Record<string, number>;
    userConsecutiveChatMessages?: Record<string, { content: string, count: number }>;
    activeTournaments?: Record<string, TournamentState>;
    activeTournamentViewers: Set<string>;
    // 게임 상태 캐시 (DB 부하 감소를 위해)
    gameCache?: Map<string, { game: LiveGameSession; lastUpdated: number }>;
    // 사용자 정보 캐시 (DB 조회 최소화)
    userCache?: Map<string, { user: User; lastUpdated: number }>;
    // 랭킹전 매칭 큐
    rankedMatchingQueue?: {
        strategic?: Record<string, RankedMatchingEntry>;
        playful?: Record<string, RankedMatchingEntry>;
    };
}

export interface UserStatusInfo {
    status: UserStatus;
    mode?: GameMode;
    gameId?: string;
    spectatingGameId?: string;
    gameCategory?: GameCategory;
}

export type ServerAction =
    // Auth
    | { type: 'REGISTER', payload: any }
    | { type: 'LOGIN', payload: any }
    | { type: 'LOGOUT', payload?: never }
    // Social
    | { type: 'SEND_CHAT_MESSAGE', payload: { channel: string; text?: string; emoji?: string, location?: string } }
    | { type: 'SET_USER_STATUS', payload: { status: any } }
    | { type: 'UPDATE_REJECTION_SETTINGS', payload: { rejectedGameModes: GameMode[] } }
    | { type: 'ENTER_WAITING_ROOM', payload: { mode: GameMode | 'strategic' | 'playful' } }
    | { type: 'LEAVE_WAITING_ROOM', payload?: never }
    | { type: 'LEAVE_GAME_ROOM', payload: { gameId: string } }
    | { type: 'SPECTATE_GAME', payload: { gameId: string } }
    // FIX: The payload for LEAVE_SPECTATING is made optional to accommodate different call signatures in the codebase.
    | { type: 'LEAVE_SPECTATING', payload?: { gameId?: string } }
    // Negotiation
    | { type: 'CHALLENGE_USER', payload: { opponentId: string; mode: GameMode; settings?: GameSettings; isRanked?: boolean } }
    | { type: 'SEND_CHALLENGE', payload: { negotiationId: string; settings: any } }
    | { type: 'UPDATE_NEGOTIATION', payload: { negotiationId: string; settings: any } }
    | { type: 'ACCEPT_NEGOTIATION', payload: { negotiationId: string; settings: any } }
    | { type: 'DECLINE_NEGOTIATION', payload: { negotiationId: string } }
    | { type: 'START_AI_GAME', payload: { mode: GameMode, settings: any } }
    | { type: 'REQUEST_REMATCH', payload: { opponentId: string, originalGameId: string } }
    // Ranked Matching
    | { type: 'START_RANKED_MATCHING', payload: { lobbyType: 'strategic' | 'playful'; selectedModes: GameMode[] } }
    | { type: 'CANCEL_RANKED_MATCHING', payload?: never }
    // Game
    | { type: 'PLACE_STONE', payload: { gameId: string; x: number; y: number, isHidden?: boolean, isClientAiMove?: boolean } }
    | { type: 'PASS_TURN', payload: { gameId: string } }
    | { type: 'RESIGN_GAME', payload: { gameId: string, andLeave?: boolean } }
    | { type: 'LEAVE_AI_GAME', payload: { gameId: string } }
    | { type: 'REQUEST_NO_CONTEST_LEAVE', payload: { gameId: string } }
    | { type: 'EMERGENCY_EXIT', payload?: never }
    | { type: 'USE_ACTION_BUTTON', payload: { gameId: string; buttonName: string } }
    // Nigiri
    | { type: 'NIGIRI_GUESS', payload: { gameId: string; guess: 1 | 2 } }
    // Capture Go
    | { type: 'UPDATE_CAPTURE_BID', payload: { gameId: string; bid: number } }
    | { type: 'CONFIRM_CAPTURE_REVEAL', payload: { gameId: string } }
    // Base Go
    | { type: 'PLACE_BASE_STONE', payload: { gameId: string; x: number; y: number } }
    | { type: 'PLACE_REMAINING_BASE_STONES_RANDOMLY', payload?: never }
    | { type: 'UPDATE_KOMI_BID', payload: { gameId: string, bid: KomiBid } }
    | { type: 'CONFIRM_BASE_REVEAL', payload: { gameId: string } }
    // Hidden Go
    | { type: 'START_HIDDEN_PLACEMENT', payload: { gameId: string } }
    | { type: 'START_SCANNING', payload: { gameId: string } }
    | { type: 'SCAN_BOARD', payload: { gameId: string, x: number, y: number } }
    // Missile Go
    | { type: 'START_MISSILE_SELECTION', payload: { gameId: string } }
    // Scoring (PVE games only)
    | { type: 'REQUEST_SCORING', payload: { gameId: string; boardState: BoardState; moveHistory: any[]; settings: any } }
    | { type: 'LAUNCH_MISSILE', payload: { gameId: string, from: Point, direction: 'up' | 'down' | 'left' | 'right' } }
    | { type: 'MISSILE_INVALID_SELECTION', payload: { gameId: string } }
    | { type: 'CANCEL_MISSILE_SELECTION', payload: { gameId: string } }
    | { type: 'MISSILE_ANIMATION_COMPLETE', payload: { gameId: string } }
    // Omok
    | { type: 'OMOK_PLACE_STONE', payload: { gameId: string, x: number, y: number } }
    // Turn Preference (Alkkagi, Curling, Omok, Ttamok)
    | { type: 'CHOOSE_TURN_PREFERENCE', payload: { gameId: string, choice: 'first' | 'second' } }
    | { type: 'SUBMIT_RPS_CHOICE', payload: { gameId: string, choice: RPSChoice } }
    // Dice Go
    | { type: 'DICE_READY_FOR_TURN_ROLL', payload: { gameId: string } }
    | { type: 'DICE_CHOOSE_TURN', payload: { gameId: string; choice: 'first' | 'second' } }
    | { type: 'DICE_CONFIRM_START', payload: { gameId: string } }
    | { type: 'DICE_ROLL', payload: { gameId: string; itemType?: 'odd' | 'even' } }
    | { type: 'DICE_PLACE_STONE', payload: { gameId: string, x: number, y: number } }
    // Thief Go
    | { type: 'THIEF_UPDATE_ROLE_CHOICE', payload: { gameId: string; choice: 'thief' | 'police' } }
    | { type: 'CONFIRM_THIEF_ROLE', payload: { gameId: string } }
    | { type: 'THIEF_ROLL_DICE', payload: { gameId: string } }
    | { type: 'THIEF_PLACE_STONE', payload: { gameId: string; x: number; y: number } }
    // Game Records
    | { type: 'SAVE_GAME_RECORD', payload: { gameId: string } }
    | { type: 'DELETE_GAME_RECORD', payload: { recordId: string } }
    // Alkkagi
    | { type: 'CONFIRM_ALKKAGI_START', payload: { gameId: string } }
    | { type: 'ALKKAGI_PLACE_STONE', payload: { gameId: string, point: Point } }
    | { type: 'ALKKAGI_FLICK_STONE', payload: { gameId: string, stoneId: number, vx: number, vy: number } }
    | { type: 'USE_ALKKAGI_ITEM', payload: { gameId: string, itemType: 'slow' | 'aimingLine' } }
    // Curling
    | { type: 'CONFIRM_CURLING_START', payload: { gameId: string } }
    | { type: 'CURLING_FLICK_STONE', payload: { gameId: string, launchPosition: Point, velocity: Point } }
    | { type: 'USE_CURLING_ITEM', payload: { gameId: string, itemType: 'slow' | 'aimingLine' } }
    // Shared round end
    | { type: 'CONFIRM_ROUND_END', payload: { gameId: string } }
    // User Actions
    | { type: 'UPDATE_AVATAR', payload: { avatarId: string } }
    | { type: 'UPDATE_BORDER', payload: { borderId: string } }
    | { type: 'CHANGE_NICKNAME', payload: { newNickname: string } }
    | { type: 'CHANGE_USERNAME', payload: { newUsername: string; password: string } }
    | { type: 'CHANGE_PASSWORD', payload: { currentPassword: string; newPassword: string } }
    | { type: 'WITHDRAW_USER', payload: { password: string; confirmText: string } }
    | { type: 'UPDATE_MBTI', payload: { mbti: string, isMbtiPublic: boolean, isFirstTime?: boolean } }
    | { type: 'RESET_STAT_POINTS', payload?: never }
    | { type: 'CONFIRM_STAT_ALLOCATION', payload: { newStatPoints: any } }
    | { type: 'RESET_SINGLE_STAT', payload: { mode: GameMode } }
    | { type: 'RESET_STATS_CATEGORY', payload: { category: 'strategic' | 'playful' } }
    | { type: 'APPLY_PRESET', payload: { presetName: string, equipment?: Partial<Record<EquipmentSlot, string>> } }
    | { type: 'SAVE_PRESET', payload: { preset: EquipmentPreset, index: number } }
    // Inventory & Item Actions
    | { type: 'USE_ITEM', payload: { itemId: string, quantity?: number } }
    | { type: 'USE_ALL_ITEMS_OF_TYPE', payload: { itemName: string } }
    | { type: 'TOGGLE_EQUIP_ITEM', payload: { itemId: string } }
    | { type: 'SELL_ITEM', payload: { itemId: string, quantity?: number } }
    | { type: 'ENHANCE_ITEM', payload: { itemId: string } }
    | { type: 'DISASSEMBLE_ITEM', payload: { itemIds: string[] } }
    | { type: 'COMBINE_ITEMS', payload: { itemIds: string[], isRandom?: boolean } }
    | { type: 'CRAFT_MATERIAL', payload: { materialName: string, craftType: 'upgrade' | 'downgrade', quantity: number } }
    // Reward Actions
    | { type: 'CLAIM_MAIL_ATTACHMENTS', payload: { mailId: string } }
    | { type: 'CLAIM_ALL_MAIL_ATTACHMENTS', payload?: never }
    | { type: 'DELETE_MAIL', payload: { mailId: string } }
    | { type: 'DELETE_ALL_CLAIMED_MAIL', payload?: never }
    | { type: 'MARK_MAIL_AS_READ', payload: { mailId: string } }
    | { type: 'CLAIM_QUEST_REWARD', payload: { questId: string } }
    | { type: 'CLAIM_ACTIVITY_MILESTONE', payload: { milestoneIndex: number, questType: 'daily' | 'weekly' | 'monthly' } }
    // Shop
    | { type: 'BUY_SHOP_ITEM', payload: { itemId: string, quantity: number } }
    | { type: 'BUY_MATERIAL_BOX', payload: { itemId: string, quantity: number } }
    | { type: 'BUY_TOWER_ITEM', payload: { itemId: string, quantity: number } }
    | { type: 'PURCHASE_ACTION_POINTS', payload?: never }
    | { type: 'EXPAND_INVENTORY', payload: { category: InventoryItemType } }
    | { type: 'BUY_BORDER', payload: { borderId: string } }
    // Admin
    | { type: 'ADMIN_APPLY_SANCTION', payload: { targetUserId: string; sanctionType: 'chat' | 'connection'; durationMinutes: number } }
    | { type: 'ADMIN_LIFT_SANCTION', payload: { targetUserId: string; sanctionType: 'chat' | 'connection' } }
    | { type: 'ADMIN_RESET_USER_DATA', payload: { targetUserId: string; resetType: 'stats' | 'full' } }
    | { type: 'ADMIN_DELETE_USER', payload: { targetUserId: string } }
    | { type: 'ADMIN_CREATE_USER', payload: { username: string, password: string, nickname: string } }
    | { type: 'ADMIN_FORCE_LOGOUT', payload: { targetUserId: string } }
    | { type: 'ADMIN_SEND_MAIL', payload: any }
    | { type: 'ADMIN_REORDER_ANNOUNCEMENTS', payload: { announcements: Announcement[] } }
    | { type: 'ADMIN_ADD_ANNOUNCEMENT', payload: { message: string } }
    | { type: 'ADMIN_REMOVE_ANNOUNCEMENT', payload: { id: string } }
    | { type: 'ADMIN_SET_ANNOUNCEMENT_INTERVAL', payload: { interval: number } }
    | { type: 'ADMIN_SET_OVERRIDE_ANNOUNCEMENT', payload: { message: string } }
    | { type: 'ADMIN_CLEAR_OVERRIDE_ANNOUNCEMENT', payload?: never }
    | { type: 'ADMIN_TOGGLE_GAME_MODE', payload: { mode: GameMode; isAvailable: boolean } }
    | { type: 'ADMIN_SET_GAME_DESCRIPTION', payload: { gameId: string, description: string } }
    | { type: 'ADMIN_FORCE_DELETE_GAME', payload: { gameId: string } }
    | { type: 'ADMIN_FORCE_WIN', payload: { gameId: string, winnerId: string } }
    | { type: 'ADMIN_UPDATE_USER_DETAILS', payload: { targetUserId: string, updatedDetails: Partial<User> } }
    | { type: 'ADMIN_UPDATE_GUILD_DETAILS', payload: { guildId: string; updatedDetails: Partial<any> } }
    | { type: 'ADMIN_APPLY_GUILD_SANCTION', payload: { guildId: string; sanctionType: 'recruitment'; durationHours: number } }
    | { type: 'ADMIN_DELETE_GUILD', payload: { guildId: string } }
    | { type: 'ADMIN_RESET_TOURNAMENT_SESSION', payload: { targetUserId: string; tournamentType: TournamentType } }
    | { type: 'ADMIN_CLEAR_USER_GUILD', payload: { targetUserId: string } }
    | { type: 'ADMIN_CREATE_HOME_BOARD_POST', payload: { title: string; content: string; isPinned: boolean } }
    | { type: 'ADMIN_UPDATE_HOME_BOARD_POST', payload: { postId: string; title: string; content: string; isPinned: boolean } }
    | { type: 'ADMIN_DELETE_HOME_BOARD_POST', payload: { postId: string } }
    // Tournament
    | { type: 'START_TOURNAMENT_SESSION', payload: { type: TournamentType } }
    | { type: 'START_TOURNAMENT_ROUND', payload: { type: TournamentType } }
    | { type: 'START_TOURNAMENT_MATCH', payload: { type: TournamentType } }
    | { type: 'ADVANCE_TOURNAMENT_SIMULATION', payload: { type: TournamentType; timestamp: number } }
    | { type: 'COMPLETE_TOURNAMENT_SIMULATION', payload: { type: TournamentType; result: { timeElapsed: number; player1Score: number; player2Score: number; commentary: CommentaryLine[]; winnerId: string } } }
    | { type: 'CLEAR_TOURNAMENT_SESSION', payload: { type?: TournamentType } }
    | { type: 'SAVE_TOURNAMENT_PROGRESS', payload: { type: TournamentType } }
    | { type: 'FORFEIT_TOURNAMENT', payload: { type: TournamentType } }
    | { type: 'FORFEIT_CURRENT_MATCH', payload: { type: TournamentType } }
    | { type: 'SKIP_TOURNAMENT_END', payload: { type: TournamentType } }
    | { type: 'CLAIM_TOURNAMENT_REWARD', payload: { tournamentType: TournamentType } }
    | { type: 'USE_CONDITION_POTION', payload: { tournamentType: TournamentType; potionType: 'small' | 'medium' | 'large' } }
    | { type: 'BUY_CONDITION_POTION', payload: { potionType: 'small' | 'medium' | 'large'; quantity: number } }
    | { type: 'ENTER_TOURNAMENT_VIEW', payload?: never }
    | { type: 'LEAVE_TOURNAMENT_VIEW', payload?: never }
    // Dungeon
    | { type: 'START_DUNGEON_STAGE', payload: { dungeonType: TournamentType; stage: number } }
    | { type: 'COMPLETE_DUNGEON_STAGE', payload: { dungeonType: TournamentType; stage: number } }
    | { type: 'CLAIM_DUNGEON_REWARD', payload: { dungeonType: TournamentType; stage: number } }
    // Single Player
    | { type: 'START_SINGLE_PLAYER_GAME', payload: { stageId: string } }
    | { type: 'CONFIRM_SINGLE_PLAYER_GAME_START', payload: { gameId: string } }
    | { type: 'SINGLE_PLAYER_REFRESH_PLACEMENT', payload: { gameId: string } }
    | { type: 'START_TOWER_GAME', payload: { floor: number } }
    | { type: 'CONFIRM_TOWER_GAME_START', payload: { gameId: string } }
    | { type: 'TOWER_REFRESH_PLACEMENT', payload: { gameId: string } }
    | { type: 'TOWER_ADD_TURNS', payload: { gameId: string } }
    | { type: 'END_TOWER_GAME', payload: { gameId: string; winner: Player; winReason: WinReason } }
    | { type: 'TOWER_CLIENT_MOVE', payload: { gameId: string; x: number; y: number; newBoardState: BoardState; capturedStones: Point[]; newKoInfo: LiveGameSession['koInfo']; } }
    | { type: 'SINGLE_PLAYER_CLIENT_MOVE', payload: { gameId: string; x: number; y: number; newBoardState: BoardState; capturedStones: Point[]; newKoInfo: LiveGameSession['koInfo']; } }
    | { type: 'START_SINGLE_PLAYER_MISSION', payload: { missionId: string } }
    | { type: 'CLAIM_SINGLE_PLAYER_MISSION_REWARD', payload: { missionId: string } }
    | { type: 'CLAIM_ALL_TRAINING_QUEST_REWARDS', payload?: never }
    | { type: 'LEVEL_UP_TRAINING_QUEST', payload: { missionId: string } }
    | { type: 'MANNER_ACTION', payload: { targetUserId: string, actionType: 'up' | 'down' } }
    // Guild
    | { type: 'CREATE_GUILD', payload: { name: string; description?: string; emblem?: string; isPublic?: boolean } }
    | { type: 'JOIN_GUILD', payload: { guildId: string } }
    | { type: 'LEAVE_GUILD', payload?: never }
    | { type: 'GUILD_LEAVE', payload?: never }
    | { type: 'LIST_GUILDS', payload?: { searchQuery?: string; limit?: number } }
    | { type: 'KICK_GUILD_MEMBER', payload: { memberId: string } }
    | { type: 'GUILD_KICK_MEMBER', payload: { guildId?: string; memberId: string; targetMemberId?: string } }
    | { type: 'UPDATE_GUILD_MEMBER_ROLE', payload: { memberId: string; role: 'leader' | 'officer' | 'member' } }
    | { type: 'GUILD_PROMOTE_MEMBER', payload: { guildId?: string; memberId?: string; targetMemberId?: string } }
    | { type: 'GUILD_DEMOTE_MEMBER', payload: { guildId?: string; memberId?: string; targetMemberId?: string } }
    | { type: 'GUILD_TRANSFER_MASTERSHIP', payload: { guildId?: string; memberId?: string; targetMemberId?: string } }
    | { type: 'UPDATE_GUILD_SETTINGS', payload: { settings: any } }
    | { type: 'GUILD_UPDATE_PROFILE', payload: { guildId?: string; name?: string; description?: string; emblem?: string; icon?: string; isPublic?: boolean; joinType?: 'application' | 'free' } }
    | { type: 'GUILD_UPDATE_ANNOUNCEMENT', payload: { guildId?: string; announcement: string } }
    | { type: 'SEND_GUILD_MESSAGE', payload: { content: string } }
    | { type: 'SEND_GUILD_CHAT_MESSAGE', payload: { content: string } }
    | { type: 'GUILD_DELETE_CHAT_MESSAGE', payload: { messageId: string; timestamp?: number } }
    | { type: 'GET_GUILD_MESSAGES', payload?: { limit?: number; before?: number } }
    | { type: 'START_GUILD_MISSION', payload: { missionType: string; target: any } }
    | { type: 'UPDATE_GUILD_MISSION_PROGRESS', payload: { missionId: string; progress: any } }
    | { type: 'GUILD_CLAIM_MISSION_REWARD', payload: { missionId: string } }
    | { type: 'CLAIM_GUILD_WAR_REWARD', payload?: never }
    | { type: 'GET_GUILD_WAR_DATA', payload?: never }
    | { type: 'START_GUILD_WAR_GAME', payload: { boardId: string } }
    | { type: 'DONATE_TO_GUILD', payload: { amount?: number; itemId?: string } }
    | { type: 'GUILD_DONATE_GOLD', payload?: never }
    | { type: 'GUILD_DONATE_DIAMOND', payload?: never }
    | { type: 'PURCHASE_GUILD_SHOP_ITEM', payload: { shopItemId: string } }
    | { type: 'GUILD_BUY_SHOP_ITEM', payload: { shopItemId: string; itemId?: string; quantity?: number } }
    | { type: 'GUILD_CHECK_IN', payload?: never }
    | { type: 'GUILD_CLAIM_CHECK_IN_REWARD', payload: { userId?: string; milestoneIndex: number } }
    | { type: 'START_GUILD_WAR', payload: { targetGuildId: string } }
    | { type: 'END_GUILD_WAR', payload: { warId: string } }
    | { type: 'GET_GUILD_INFO', payload?: never }
    | { type: 'GUILD_ACCEPT_APPLICANT', payload: { guildId?: string; userId: string; applicantId?: string } }
    | { type: 'GUILD_REJECT_APPLICANT', payload: { guildId?: string; userId: string; applicantId?: string } }
    | { type: 'GUILD_CANCEL_APPLICATION', payload: { guildId: string } }
    | { type: 'GUILD_START_RESEARCH', payload: { guildId?: string; researchId: string } }
    | { type: 'START_GUILD_BOSS_BATTLE', payload: { bossId?: string; result?: any; bossName?: string } }
    | { type: 'LOAD_EQUIPMENT_PRESET', payload: { presetName?: string; presetIndex?: number } }
    ;

export interface GameProps {
    session: LiveGameSession;
    currentUser: UserWithStatus;
    onAction: (action: ServerAction) => void;
    isSpectator: boolean;
    onlineUsers: UserWithStatus[];
    onViewUser: (userId: string) => void;
    activeNegotiation: Negotiation | null;
    waitingRoomChat: ChatMessage[];
    gameChat: ChatMessage[];
    negotiations: Negotiation[];
}

export interface AdminProps {
    currentUser: UserWithStatus;
    allUsers: User[];
    liveGames: LiveGameSession[];
    adminLogs: AdminLog[];
    onAction: (action: ServerAction) => void;
    onBack: () => void;
    gameModeAvailability: Partial<Record<GameMode, boolean>>;
    announcements: Announcement[];
    globalOverrideAnnouncement: OverrideAnnouncement | null;
    announcementInterval: number;
}