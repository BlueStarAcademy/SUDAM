import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
// FIX: The main types barrel file now exports settings types. Use it for consistency.
import { User, LiveGameSession, UserWithStatus, ServerAction, GameMode, Negotiation, ChatMessage, UserStatus, UserStatusInfo, AdminLog, Announcement, OverrideAnnouncement, InventoryItem, AppState, InventoryItemType, AppRoute, QuestReward, DailyQuestData, WeeklyQuestData, MonthlyQuestData, Theme, SoundSettings, FeatureSettings, AppSettings, PanelEdgeStyle, CoreStat, SpecialStat, MythicStat, EquipmentSlot, EquipmentPreset, Player, HomeBoardPost, GameRecord, Guild } from '../types.js';
import { HandleActionResult } from '../types/api.js';
import { Point } from '../types/enums.js';
import { audioService } from '../services/audioService.js';
import { stableStringify, parseHash } from '../utils/appUtils.js';
import { 
    DAILY_MILESTONE_THRESHOLDS,
    WEEKLY_MILESTONE_THRESHOLDS,
    MONTHLY_MILESTONE_THRESHOLDS
} from '../constants.js';
import { defaultSettings, SETTINGS_STORAGE_KEY } from './useAppSettings.js';
import { getPanelEdgeImages } from '../constants/panelEdges.js';
import { SINGLE_PLAYER_STAGES } from '../constants/singlePlayerConstants.js';
import { calculateUserEffects } from '../services/effectService.js';
import { ACTION_POINT_REGEN_INTERVAL_MS } from '../constants/rules.js';
import { aiUserId } from '../constants/auth.js';

export const useApp = () => {
    // --- State Management ---
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        try {
            const stored = sessionStorage.getItem('currentUser');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) { console.error('Failed to parse user from sessionStorage', e); }
        return null;
    });

    const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => parseHash(window.location.hash));
    const currentRouteRef = useRef(currentRoute);
    const [error, setError] = useState<string | null>(null);
    const isLoggingOut = useRef(false);
    // 강제 리렌더링을 위한 카운터
    const [updateTrigger, setUpdateTrigger] = useState(0);
    const currentUserRef = useRef<User | null>(null);
    const currentUserStatusRef = useRef<UserWithStatus | null>(null);
    // HTTP 응답 후 일정 시간 내 WebSocket 업데이트 무시 (중복 방지)
    const lastHttpUpdateTime = useRef<number>(0);
    const lastHttpActionType = useRef<string | null>(null);
    const lastHttpHadUpdatedUser = useRef<boolean>(false); // HTTP 응답에 updatedUser가 있었는지 추적
    const HTTP_UPDATE_DEBOUNCE_MS = 2000; // HTTP 응답 후 2초 내 WebSocket 업데이트 무시 (더 긴 시간으로 확실하게 보호)

    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    const mergeUserState = useCallback((prev: User | null, updates: Partial<User>) => {
        if (!prev) {
            return updates as User;
        }
        
        // 깊은 병합을 위해 JSON 직렬화/역직렬화 사용
        const base = JSON.parse(JSON.stringify(prev)) as User;
        const patch = JSON.parse(JSON.stringify(updates)) as Partial<User>;
        
        // inventory는 배열이므로 완전히 교체 (깊은 복사로 새로운 참조 생성)
        const mergedInventory = patch.inventory !== undefined 
            ? JSON.parse(JSON.stringify(patch.inventory)) 
            : base.inventory;
        
        // 중첩된 객체들을 깊게 병합
        // ID는 항상 이전 사용자의 ID로 유지 (다른 사용자 정보로 덮어씌워지는 것을 방지)
        const prevId = prev.id;
        const merged: User = {
            ...base,
            ...patch,
            // ID는 항상 이전 사용자의 ID로 강제 유지 (보안: 다른 사용자로 로그인 변경 방지)
            id: prevId,
            // inventory는 배열이므로 완전히 교체 (새로운 참조로)
            inventory: mergedInventory,
            // equipment는 객체이므로 완전히 교체 (서버에서 보내는 equipment는 항상 전체 상태)
            equipment: patch.equipment !== undefined ? (patch.equipment || {}) : base.equipment,
            // actionPoints는 객체이므로 병합
            actionPoints: patch.actionPoints !== undefined ? { ...base.actionPoints, ...patch.actionPoints } : base.actionPoints,
            // stats 객체들도 병합
            stats: patch.stats !== undefined ? { ...base.stats, ...patch.stats } : base.stats,
            // 기타 중첩 객체들도 병합
            equipmentPresets: patch.equipmentPresets !== undefined ? patch.equipmentPresets : base.equipmentPresets,
            clearedSinglePlayerStages: patch.clearedSinglePlayerStages !== undefined ? patch.clearedSinglePlayerStages : base.clearedSinglePlayerStages,
            // singlePlayerMissions는 객체이므로 병합
            singlePlayerMissions: patch.singlePlayerMissions !== undefined ? { ...base.singlePlayerMissions, ...patch.singlePlayerMissions } : base.singlePlayerMissions,
        };
        
        return merged;
    }, []);

    const applyUserUpdate = useCallback((updates: Partial<User>, source: string) => {
        const prevUser = currentUserRef.current;
        
        // 보안: 다른 사용자의 ID가 포함된 업데이트는 무시 (다른 사용자로 로그인 변경 방지)
        if (prevUser && updates.id && updates.id !== prevUser.id) {
            console.warn(`[applyUserUpdate] Rejected update from ${source}: ID mismatch (prev: ${prevUser.id}, update: ${updates.id})`);
            return prevUser;
        }
        
        const mergedUser = mergeUserState(prevUser, updates);
        
        // 추가 보안: 병합 후에도 ID가 변경되지 않았는지 확인
        if (prevUser && mergedUser.id !== prevUser.id) {
            console.error(`[applyUserUpdate] CRITICAL: ID changed after merge! (prev: ${prevUser.id}, merged: ${mergedUser.id}). Restoring previous ID.`);
            mergedUser.id = prevUser.id;
        }
        
        // 실제 변경사항이 있는지 확인 (불필요한 리렌더링 방지)
        // 중요한 필드들을 직접 비교하여 더 정확한 변경 감지
        let hasActualChanges = !prevUser;
        if (prevUser) {
            // inventory 배열 길이와 내용 비교 (더 정확한 변경 감지)
            const inventoryChanged = 
                prevUser.inventory?.length !== mergedUser.inventory?.length ||
                JSON.stringify(prevUser.inventory) !== JSON.stringify(mergedUser.inventory);
            
            // 주요 필드 직접 비교
            const keyFieldsChanged = 
                prevUser.gold !== mergedUser.gold ||
                prevUser.diamonds !== mergedUser.diamonds ||
                prevUser.strategyXp !== mergedUser.strategyXp ||
                prevUser.playfulXp !== mergedUser.playfulXp ||
                prevUser.avatarId !== mergedUser.avatarId ||
                prevUser.borderId !== mergedUser.borderId ||
                prevUser.nickname !== mergedUser.nickname ||
                prevUser.mbti !== mergedUser.mbti ||
                prevUser.isMbtiPublic !== mergedUser.isMbtiPublic ||
                prevUser.mannerScore !== mergedUser.mannerScore ||
                prevUser.mannerMasteryApplied !== mergedUser.mannerMasteryApplied ||
                inventoryChanged ||
                JSON.stringify(prevUser.equipment) !== JSON.stringify(mergedUser.equipment) ||
                JSON.stringify(prevUser.singlePlayerMissions) !== JSON.stringify(mergedUser.singlePlayerMissions) ||
                JSON.stringify(prevUser.actionPoints) !== JSON.stringify(mergedUser.actionPoints);
            
            // stableStringify로 전체 비교 (백업)
            const fullComparison = stableStringify(prevUser) !== stableStringify(mergedUser);
            
            hasActualChanges = keyFieldsChanged || fullComparison;
            
            // 보상 수령 관련 액션의 경우 inventory 변경을 강제로 감지
            if (source.includes('CLAIM') || source.includes('REWARD')) {
                if (inventoryChanged) {
                    hasActualChanges = true;
                    console.log(`[applyUserUpdate] Forcing update for ${source} due to inventory change`, {
                        prevLength: prevUser.inventory?.length,
                        newLength: mergedUser.inventory?.length
                    });
                }
            }
        }
        
        const updateKeys = Object.keys(updates || {}).filter(key => key !== 'id');

        if (!hasActualChanges && prevUser) {
            if (updateKeys.length === 0) {
                console.log(`[applyUserUpdate] No actual changes detected (${source}) and no update keys, skipping update.`);
                return prevUser;
            }

            console.warn(`[applyUserUpdate] No diff detected for ${source}, but forcing refresh to avoid stale UI.`, { updateKeys });
        }
        
        currentUserRef.current = mergedUser;
        flushSync(() => {
            setCurrentUser(mergedUser);
            setUpdateTrigger(prev => prev + 1);
        });
        
        if (mergedUser.id) {
            setUsersMap(prevMap => ({ ...prevMap, [mergedUser.id]: mergedUser }));
        }
        
        try {
            sessionStorage.setItem('currentUser', JSON.stringify(mergedUser));
        } catch (e) {
            console.error(`[applyUserUpdate] Failed to persist user (${source})`, e);
        }
        
        console.log(`[applyUserUpdate] Applied update from ${source}`, {
            inventoryLength: mergedUser.inventory?.length,
            gold: mergedUser.gold,
            diamonds: mergedUser.diamonds
        });
        
        // HTTP 업데이트인 경우 타임스탬프 및 액션 타입 기록
        // (HTTP 응답에 updatedUser가 있었을 때만 타임스탬프 업데이트 - handleAction에서 처리)
        // 여기서는 source만 확인하여 로깅용으로 사용
        
        return mergedUser;
    }, [mergeUserState]);
    
    // --- App Settings State ---
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (storedSettings) {
                let parsed = JSON.parse(storedSettings);
                // Migration for old settings structure
                if (typeof parsed.theme === 'string') {
                    parsed = {
                        ...defaultSettings,
                        graphics: {
                            theme: parsed.theme,
                            panelColor: undefined,
                            textColor: undefined,
                        },
                        sound: parsed.sound || defaultSettings.sound,
                        features: parsed.features || defaultSettings.features,
                    };
                }
                // Deep merge to ensure new settings from code are not overwritten by old localStorage data
                return {
                    ...defaultSettings,
                    ...parsed,
                    graphics: { ...defaultSettings.graphics, ...(parsed.graphics || {}) },
                    sound: { ...defaultSettings.sound, ...(parsed.sound || {}) },
                    features: { ...defaultSettings.features, ...(parsed.features || {}) },
                };
            }
        } catch (error) { console.error('Error reading settings from localStorage', error); }
        return defaultSettings;
    });

    // --- Server State ---
    const [usersMap, setUsersMap] = useState<Record<string, User>>({});
    const [onlineUsers, setOnlineUsers] = useState<UserWithStatus[]>([]);
    const [liveGames, setLiveGames] = useState<Record<string, LiveGameSession>>({});  // 일반 게임만
    const [singlePlayerGames, setSinglePlayerGames] = useState<Record<string, LiveGameSession>>({});  // 싱글플레이 게임
    const [towerGames, setTowerGames] = useState<Record<string, LiveGameSession>>({});  // 도전의 탑 게임
    const liveGameSignaturesRef = useRef<Record<string, string>>({});
    const singlePlayerGameSignaturesRef = useRef<Record<string, string>>({});
    const towerGameSignaturesRef = useRef<Record<string, string>>({});
    // WebSocket GAME_UPDATE 메시지 쓰로틀링 (같은 게임에 대해 최대 100ms당 1회만 처리)
    const lastGameUpdateTimeRef = useRef<Record<string, number>>({});
    const GAME_UPDATE_THROTTLE_MS = 100; // 100ms 쓰로틀링
    const [negotiations, setNegotiations] = useState<Record<string, Negotiation>>({});
    const [waitingRoomChats, setWaitingRoomChats] = useState<Record<string, ChatMessage[]>>({});
    const [gameChats, setGameChats] = useState<Record<string, ChatMessage[]>>({});
    const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
    const [gameModeAvailability, setGameModeAvailability] = useState<Partial<Record<GameMode, boolean>>>({});
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [globalOverrideAnnouncement, setGlobalOverrideAnnouncement] = useState<OverrideAnnouncement | null>(null);
    const [announcementInterval, setAnnouncementInterval] = useState(3);
    const [homeBoardPosts, setHomeBoardPosts] = useState<HomeBoardPost[]>([]);
    const [guilds, setGuilds] = useState<Record<string, Guild>>({});
    
    // --- UI Modals & Toasts ---
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);
    const [isMailboxOpen, setIsMailboxOpen] = useState(false);
    const [isQuestsOpen, setIsQuestsOpen] = useState(false);
    const [isShopOpen, setIsShopOpen] = useState(false);
    const [shopInitialTab, setShopInitialTab] = useState<'equipment' | 'materials' | 'consumables' | 'misc' | undefined>(undefined);
    const [lastUsedItemResult, setLastUsedItemResult] = useState<InventoryItem[] | null>(null);
    const [tournamentScoreChange, setTournamentScoreChange] = useState<{ oldScore: number; newScore: number; scoreReward: number } | null>(null);
    const [disassemblyResult, setDisassemblyResult] = useState<{ gained: { name: string, amount: number }[], jackpot: boolean } | null>(null);
    const [craftResult, setCraftResult] = useState<{ gained: { name: string; amount: number }[]; used: { name: string; amount: number }[]; craftType: 'upgrade' | 'downgrade'; jackpot?: boolean } | null>(null);
    const [rewardSummary, setRewardSummary] = useState<{ reward: QuestReward; items: InventoryItem[]; title: string } | null>(null);
    const [isClaimAllSummaryOpen, setIsClaimAllSummaryOpen] = useState(false);
    const [claimAllSummary, setClaimAllSummary] = useState<{ gold: number; diamonds: number; actionPoints: number } | null>(null);
    const [viewingUser, setViewingUser] = useState<UserWithStatus | null>(null);
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
    const [isEncyclopediaOpen, setIsEncyclopediaOpen] = useState(false);
    const [isStatAllocationModalOpen, setIsStatAllocationModalOpen] = useState(false);
    const [enhancementResult, setEnhancementResult] = useState<{ message: string; success: boolean } | null>(null);
    const [enhancementOutcome, setEnhancementOutcome] = useState<{ message: string; success: boolean; itemBefore: InventoryItem; itemAfter: InventoryItem; } | null>(null);
    const [refinementResult, setRefinementResult] = useState<{ message: string; success: boolean; itemBefore: InventoryItem; itemAfter: InventoryItem; } | null>(null);
    const [enhancementAnimationTarget, setEnhancementAnimationTarget] = useState<{ itemId: string; stars: number } | null>(null);
    const [pastRankingsInfo, setPastRankingsInfo] = useState<{ user: UserWithStatus; mode: GameMode | 'strategic' | 'playful'; } | null>(null);
    const [enhancingItem, setEnhancingItem] = useState<InventoryItem | null>(null);
    const [viewingItem, setViewingItem] = useState<{ item: InventoryItem; isOwnedByCurrentUser: boolean; } | null>(null);
    const [showExitToast, setShowExitToast] = useState(false);
    const exitToastTimer = useRef<number | null>(null);
    const [isProfileEditModalOpen, setIsProfileEditModalOpen] = useState(false);
    const [moderatingUser, setModeratingUser] = useState<UserWithStatus | null>(null);
    const [isMbtiInfoModalOpen, setIsMbtiInfoModalOpen] = useState(false);
    const [isEquipmentEffectsModalOpen, setIsEquipmentEffectsModalOpen] = useState(false);
    const [isBlacksmithModalOpen, setIsBlacksmithModalOpen] = useState(false);
    const [isGameRecordListOpen, setIsGameRecordListOpen] = useState(false);
    const [viewingGameRecord, setViewingGameRecord] = useState<GameRecord | null>(null);
    const [blacksmithSelectedItemForEnhancement, setBlacksmithSelectedItemForEnhancement] = useState<InventoryItem | null>(null);
    const [blacksmithActiveTab, setBlacksmithActiveTab] = useState<'enhance' | 'combine' | 'disassemble' | 'convert' | 'refine'>('enhance');
    const [combinationResult, setCombinationResult] = useState<{ item: InventoryItem; xpGained: number; isGreatSuccess: boolean; } | null>(null);
    const [isBlacksmithHelpOpen, setIsBlacksmithHelpOpen] = useState(false);
    const [isEnhancementResultModalOpen, setIsEnhancementResultModalOpen] = useState(false);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) { console.error('Error saving settings to localStorage', error); }
        
        const root = document.documentElement;
        if (settings.graphics.panelColor) {
            root.style.setProperty('--custom-panel-bg', settings.graphics.panelColor);
        } else {
            root.style.removeProperty('--custom-panel-bg');
        }
        if (settings.graphics.textColor) {
            root.style.setProperty('--custom-text-color', settings.graphics.textColor);
        } else {
            root.style.removeProperty('--custom-text-color');
        }
        const edgeStyle = settings.graphics.panelEdgeStyle ?? 'default';
        const edgeImages = getPanelEdgeImages(edgeStyle);
        root.style.setProperty('--panel-edge-top-left', edgeImages.topLeft ?? 'none');
        root.style.setProperty('--panel-edge-top-right', edgeImages.topRight ?? 'none');
        root.style.setProperty('--panel-edge-bottom-left', edgeImages.bottomLeft ?? 'none');
        root.style.setProperty('--panel-edge-bottom-right', edgeImages.bottomRight ?? 'none');
        // 엣지 스타일이 'none'이 아닌 경우 data 속성 추가 (CSS에서 금색 테두리 적용용)
        if (edgeStyle !== 'none') {
            root.setAttribute('data-edge-style', edgeStyle);
        } else {
            root.setAttribute('data-edge-style', 'none');
        }

    }, [settings]);



    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.graphics.theme);
    }, [settings.graphics.theme]);

    useEffect(() => {
        audioService.updateSettings(settings.sound);
    }, [settings.sound]);

    const updateTheme = useCallback((theme: Theme) => {
        setSettings(s => ({ 
            ...s, 
            graphics: { 
                ...s.graphics, 
                theme,
                panelColor: undefined, 
                textColor: undefined,
            } 
        }));
    }, []);

    const updatePanelColor = useCallback((color: string) => {
        setSettings(s => ({ ...s, graphics: { ...s.graphics, panelColor: color }}));
    }, []);

    const updateTextColor = useCallback((color: string) => {
        setSettings(s => ({ ...s, graphics: { ...s.graphics, textColor: color }}));
    }, []);
    
    const updatePanelEdgeStyle = useCallback((edgeStyle: PanelEdgeStyle) => {
        setSettings(s => ({ ...s, graphics: { ...s.graphics, panelEdgeStyle: edgeStyle }}));
    }, []);
    
    const resetGraphicsToDefault = useCallback(() => {
        setSettings(s => ({ ...s, graphics: { ...s.graphics, panelColor: undefined, textColor: undefined, panelEdgeStyle: 'default' } }));
    }, []);

    const updateSoundSetting = useCallback(<K extends keyof SoundSettings>(key: K, value: SoundSettings[K]) => {
        setSettings(s => ({ ...s, sound: { ...s.sound, [key]: value } }));
    }, []);

    const updateFeatureSetting = useCallback(<K extends keyof FeatureSettings>(key: K, value: FeatureSettings[K]) => {
        setSettings(s => ({ ...s, features: { ...s.features, [key]: value } }));
    }, []);

    // --- Derived State ---
    const allUsers = useMemo(() => {
        if (!usersMap || typeof usersMap !== 'object') return [];
        return Object.values(usersMap);
    }, [usersMap]);

    // 행동력 실시간 업데이트를 위한 상태
    const [actionPointUpdateTrigger, setActionPointUpdateTrigger] = useState(0);
    
    // 행동력을 실시간으로 계산하는 useEffect
    useEffect(() => {
        if (!currentUser || !currentUser.actionPoints) return;
        
        const intervalId = setInterval(() => {
            if (!currentUser.actionPoints || currentUser.lastActionPointUpdate === undefined) return;
            
            const effects = calculateUserEffects(currentUser);
            const now = Date.now();
            const calculatedMaxAP = effects.maxActionPoints;
            
            // 행동력이 최대치가 아니고, lastActionPointUpdate가 유효한 경우에만 계산
            if (currentUser.actionPoints.current < calculatedMaxAP && currentUser.lastActionPointUpdate !== 0) {
                const lastUpdate = currentUser.lastActionPointUpdate;
                if (typeof lastUpdate === 'number' && !isNaN(lastUpdate)) {
                    const elapsedMs = now - lastUpdate;
                    const regenInterval = effects.actionPointRegenInterval > 0 ? effects.actionPointRegenInterval : ACTION_POINT_REGEN_INTERVAL_MS;
                    const pointsToAdd = Math.floor(elapsedMs / regenInterval);
                    
                    if (pointsToAdd > 0) {
                        const newCurrent = Math.min(calculatedMaxAP, currentUser.actionPoints.current + pointsToAdd);
                        setCurrentUser(prev => {
                            if (!prev || !prev.actionPoints) return prev;
                            return {
                                ...prev,
                                actionPoints: {
                                    ...prev.actionPoints,
                                    current: newCurrent,
                                    max: calculatedMaxAP
                                }
                            };
                        });
                        setActionPointUpdateTrigger(prev => prev + 1);
                    }
                }
            }
        }, 1000); // 1초마다 체크
        
        return () => clearInterval(intervalId);
    }, [currentUser?.actionPoints?.current, currentUser?.lastActionPointUpdate, currentUser?.id]);
    
    const currentUserWithStatus: UserWithStatus | null = useMemo(() => {
        // updateTrigger와 actionPointUpdateTrigger를 dependency에 포함시켜 강제 리렌더링 보장
        if (!currentUser) return null;
        const statusInfo = Array.isArray(onlineUsers)
            ? onlineUsers.find(u => u && u.id === currentUser.id)
            : null;
        const statusData: UserStatusInfo = {
            status: statusInfo?.status ?? ('online' as UserStatus),
            mode: statusInfo?.mode,
            gameId: statusInfo?.gameId,
            spectatingGameId: statusInfo?.spectatingGameId,
        };
        
        // 행동력 최대치를 실시간으로 계산하여 반영
        const effects = calculateUserEffects(currentUser);
        const calculatedMaxAP = effects.maxActionPoints;
        const updatedActionPoints = currentUser.actionPoints ? {
            ...currentUser.actionPoints,
            max: calculatedMaxAP
        } : currentUser.actionPoints;
        
        return { ...currentUser, actionPoints: updatedActionPoints, ...statusData };
    }, [currentUser, onlineUsers, updateTrigger, actionPointUpdateTrigger]);

    useEffect(() => {
        currentUserStatusRef.current = currentUserWithStatus;
    }, [currentUserWithStatus]);

    const activeGame = useMemo(() => {
        if (!currentUserWithStatus) return null;
        const gameId = currentUserWithStatus.gameId || currentUserWithStatus.spectatingGameId;
        if (gameId) {
            // status가 'in-game'이거나 'spectating'이면 게임으로 라우팅
            // 'negotiating' 상태는 제거 (대국 신청 중에는 게임이 아님)
            // scoring 상태의 게임도 포함 (계가 진행 중)
            if (currentUserWithStatus.status === 'in-game' || currentUserWithStatus.status === 'spectating') {
                // 모든 게임 카테고리에서 찾기
                const game = liveGames[gameId] || singlePlayerGames[gameId] || towerGames[gameId];
                if (game) {
                    return game;
                }
            }
            // scoring 상태의 게임은 사용자 상태와 관계없이 activeGame으로 인식
            // (계가 진행 중에는 사용자 상태가 변경될 수 있음)
            const game = liveGames[gameId] || singlePlayerGames[gameId] || towerGames[gameId];
            if (game && game.gameStatus === 'scoring') {
                return game;
            }
        }
        return null;
    }, [currentUserWithStatus, liveGames, singlePlayerGames, towerGames]);

    const activeNegotiation = useMemo(() => {
        if (!currentUserWithStatus) return null;
        if (!negotiations || typeof negotiations !== 'object' || Array.isArray(negotiations)) {
            return null;
        }
        try {
            const negotiationsArray = Object.values(negotiations);
            // 현재 사용자와 관련된 모든 negotiation 필터링
            const relevantNegotiations = negotiationsArray.filter(neg => 
                neg && neg.challenger && neg.opponent &&
                ((neg.challenger.id === currentUserWithStatus.id && (neg.status === 'pending' || neg.status === 'draft')) ||
                (neg.opponent.id === currentUserWithStatus.id && neg.status === 'pending'))
            );
            
            if (relevantNegotiations.length === 0) return null;
            
            // 가장 먼저 온 신청서 선택 (deadline이 가장 이른 것, 또는 deadline이 같으면 생성 시간 기준)
            // deadline이 없으면 생성 시간(id에 포함된 timestamp 또는 생성 순서) 기준
            const sorted = relevantNegotiations.sort((a, b) => {
                // deadline이 있으면 deadline 기준으로 정렬 (더 이른 deadline이 우선)
                if (a.deadline && b.deadline) {
                    return a.deadline - b.deadline;
                }
                if (a.deadline) return -1; // a에만 deadline이 있으면 a가 우선
                if (b.deadline) return 1; // b에만 deadline이 있으면 b가 우선
                // deadline이 둘 다 없으면 id의 타임스탬프 비교 (나중에 생성된 것이 더 큰 id를 가짐)
                return a.id.localeCompare(b.id);
            });
            
            return sorted[0] || null;
        } catch (error) {
            console.error('[activeNegotiation] Error:', error);
            return null;
        }
    }, [currentUserWithStatus, negotiations]);

    const unreadMailCount = useMemo(() => {
        if (!currentUser || !currentUser.mail || !Array.isArray(currentUser.mail)) {
            return 0;
        }
        return currentUser.mail.filter(m => m && !m.isRead).length;
    }, [currentUser?.mail]);

    const hasClaimableQuest = useMemo(() => {
        if (!currentUser?.quests) return false;
        const { daily, weekly, monthly } = currentUser.quests;
    
        const checkQuestList = (questData?: DailyQuestData | WeeklyQuestData | MonthlyQuestData) => {
            if (!questData) return false;
            return questData.quests.some(q => q.progress >= q.target && !q.isClaimed);
        };
    
        const checkMilestones = (questData?: DailyQuestData | WeeklyQuestData | MonthlyQuestData, thresholds?: number[]) => {
            if (!questData || !thresholds) return false;
            return questData.claimedMilestones.some((claimed, index) => {
                return !claimed && questData.activityProgress >= thresholds[index];
            });
        };
    
        return checkQuestList(daily) ||
               checkQuestList(weekly) ||
               checkQuestList(monthly) ||
               checkMilestones(daily, DAILY_MILESTONE_THRESHOLDS) ||
               checkMilestones(weekly, WEEKLY_MILESTONE_THRESHOLDS) ||
               checkMilestones(monthly, MONTHLY_MILESTONE_THRESHOLDS);
    }, [currentUser?.quests]);
    
    const showError = (message: string) => {
        let displayMessage = message;
        if (message.includes('Invalid move: ko')) {
            displayMessage = "패 모양입니다. 다른 곳에 착수 후 다시 둘 수 있는 자리입니다.";
        } else if (message.includes('action point')) {
            displayMessage = "상대방의 행동력이 충분하지 않습니다.";
        }
        setError(displayMessage);
        setTimeout(() => setError(null), 5000);
    };
    
    useEffect(() => {
        if (currentUser) {
            sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
            console.log('[useApp] currentUser updated:', {
                id: currentUser.id,
                inventoryLength: currentUser.inventory?.length,
                gold: currentUser.gold,
                diamonds: currentUser.diamonds
            });
        } else {
            sessionStorage.removeItem('currentUser');
        }
    }, [currentUser]);

    // --- Action Handler ---
    // 액션 디바운싱을 위한 ref
    const actionDebounceRef = useRef<Map<string, number>>(new Map());
    const ACTION_DEBOUNCE_MS = 300; // 300ms 디바운스
    
    const handleAction = useCallback(async (action: ServerAction): Promise<{ gameId?: string; claimAllTrainingQuestRewards?: any } | void> => {
        // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
        if (process.env.NODE_ENV === 'development') {
            console.log(`[handleAction] Action received: ${action.type}`, action);
        }
        
        // 디바운싱: 같은 액션이 짧은 시간 내에 여러 번 호출되면 무시
        const actionKey = `${action.type}_${JSON.stringify(action.payload || {})}`;
        const now = Date.now();
        const lastCallTime = actionDebounceRef.current.get(actionKey);
        if (lastCallTime && (now - lastCallTime) < ACTION_DEBOUNCE_MS) {
            if (process.env.NODE_ENV === 'development') {
                console.log(`[handleAction] Action debounced: ${action.type} (${now - lastCallTime}ms since last call)`);
            }
            return;
        }
        actionDebounceRef.current.set(actionKey, now);
        
        // 싱글플레이 미사일 애니메이션 완료 클라이언트 처리
        if ((action as any).type === 'SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE') {
            const payload = (action as any).payload;
            const { gameId } = payload;
            // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
            if (process.env.NODE_ENV === 'development') {
                console.log(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - processing client-side:`, { gameId });
            }
            
            setSinglePlayerGames((currentGames) => {
                const game = currentGames[gameId];
                if (!game) {
                    // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                    if (process.env.NODE_ENV === 'development') {
                        console.debug(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Game not found in state:`, gameId);
                    }
                    return currentGames;
                }
                
                // 게임이 이미 종료되었는지 확인
                if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest' || game.gameStatus === 'scoring') {
                    // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Game already ended, ignoring:`, {
                            gameId,
                            gameStatus: game.gameStatus
                        });
                    }
                    return currentGames;
                }
                
                // 애니메이션이 없거나 이미 완료된 경우
                if (!game.animation || (game.animation.type !== 'missile' && game.animation.type !== 'hidden_missile')) {
                    // 게임 상태가 여전히 missile_animating이면 정리
                    if (game.gameStatus === 'missile_animating') {
                        // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Cleaning up stuck missile_animating state:`, gameId);
                        }
                        return {
                            ...currentGames,
                            [gameId]: {
                                ...game,
                                gameStatus: 'playing',
                                animation: null,
                                pausedTurnTimeLeft: undefined,
                                itemUseDeadline: undefined
                            }
                        };
                    }
                    return currentGames;
                }
                
                // 애니메이션 정보 저장
                const animationFrom = game.animation.from;
                const animationTo = game.animation.to;
                const playerWhoMoved = game.currentPlayer;
                const revealedHiddenStone = (game.animation as any).revealedHiddenStone as Point | null | undefined;
                
                // totalTurns와 captures 보존 (애니메이션 완료 시 초기화 방지)
                const preservedTotalTurns = game.totalTurns;
                const preservedCaptures = { ...game.captures };
                const preservedBaseStoneCaptures = game.baseStoneCaptures ? { ...game.baseStoneCaptures } : undefined;
                const preservedHiddenStoneCaptures = game.hiddenStoneCaptures ? { ...game.hiddenStoneCaptures } : undefined;
                
                // 게임 상태 업데이트
                // 타이머 복원: pausedTurnTimeLeft가 있으면 복원
                let updatedBlackTime = game.blackTimeLeft;
                let updatedWhiteTime = game.whiteTimeLeft;
                
                if (game.pausedTurnTimeLeft !== undefined) {
                    if (playerWhoMoved === Player.Black) {
                        updatedBlackTime = game.pausedTurnTimeLeft;
                    } else {
                        updatedWhiteTime = game.pausedTurnTimeLeft;
                    }
                }
                
                const updatedGame: LiveGameSession = {
                    ...game,
                    animation: null,
                    gameStatus: 'playing',
                    blackTimeLeft: updatedBlackTime,
                    whiteTimeLeft: updatedWhiteTime,
                    pausedTurnTimeLeft: undefined,
                    itemUseDeadline: undefined,
                    // 타이머 재개를 위해 turnDeadline과 turnStartTime도 설정
                    turnDeadline: game.settings.timeLimit > 0 && (updatedBlackTime > 0 || updatedWhiteTime > 0) 
                        ? Date.now() + (playerWhoMoved === Player.Black ? updatedBlackTime : updatedWhiteTime) * 1000
                        : undefined,
                    turnStartTime: game.settings.timeLimit > 0 ? Date.now() : undefined,
                    // totalTurns와 captures 보존
                    totalTurns: preservedTotalTurns,
                    captures: preservedCaptures,
                    ...(preservedBaseStoneCaptures ? { baseStoneCaptures: preservedBaseStoneCaptures } : {}),
                    ...(preservedHiddenStoneCaptures ? { hiddenStoneCaptures: preservedHiddenStoneCaptures } : {})
                };
                
                // 히든 돌 공개 처리
                if (revealedHiddenStone) {
                    const moveIndex = game.moveHistory.findIndex(m => m.x === revealedHiddenStone.x && m.y === revealedHiddenStone.y);
                    if (moveIndex !== -1) {
                        if (!updatedGame.permanentlyRevealedStones) updatedGame.permanentlyRevealedStones = [];
                        if (!updatedGame.permanentlyRevealedStones.some(p => p.x === revealedHiddenStone.x && p.y === revealedHiddenStone.y)) {
                            updatedGame.permanentlyRevealedStones.push({ x: revealedHiddenStone.x, y: revealedHiddenStone.y });
                        }
                    }
                }
                
                // 싱글플레이에서는 LAUNCH_MISSILE에서 이미 보드 상태가 업데이트되었으므로
                // 애니메이션 완료 시에는 보드 상태를 변경하지 않고 그대로 유지
                // (서버에서 이미 원래 자리 제거, 목적지 배치가 완료됨)
                // 단, 보드 상태가 제대로 동기화되지 않은 경우를 대비해 확인만 수행
                if (animationFrom && animationTo) {
                    const stoneAtTo = game.boardState[animationTo.y]?.[animationTo.x];
                    const stoneAtFrom = game.boardState[animationFrom.y]?.[animationFrom.x];
                    
                    // 목적지에 돌이 없으면 배치 (서버 동기화 문제 대비)
                    if (stoneAtTo !== playerWhoMoved) {
                        console.warn(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Stone not at destination, fixing:`, {
                            gameId,
                            from: animationFrom,
                            to: animationTo,
                            stoneAtTo,
                            playerWhoMoved
                        });
                        const newBoardState = game.boardState.map((row, y) => 
                            row.map((cell, x) => {
                                if (x === animationTo.x && y === animationTo.y) {
                                    return playerWhoMoved;
                                }
                                if (x === animationFrom.x && y === animationFrom.y && cell === playerWhoMoved) {
                                    return Player.None;
                                }
                                return cell;
                            })
                        );
                        updatedGame.boardState = newBoardState;
                    } else if (stoneAtFrom === playerWhoMoved) {
                        // 원래 자리에 아직 돌이 있으면 제거 (서버 동기화 문제 대비)
                        console.warn(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Stone still at origin, removing:`, {
                            gameId,
                            from: animationFrom,
                            to: animationTo
                        });
                        const newBoardState = game.boardState.map((row, y) => 
                            row.map((cell, x) => 
                                (x === animationFrom.x && y === animationFrom.y && cell === playerWhoMoved) ? Player.None : cell
                            )
                        );
                        updatedGame.boardState = newBoardState;
                    }
                    
                    // 배치돌 업데이트: 원래 자리의 배치돌을 목적지로 이동 (이미 서버에서 처리되었을 수 있음)
                    if (game.baseStones) {
                        const baseStoneIndex = game.baseStones.findIndex(bs => bs.x === animationFrom.x && bs.y === animationFrom.y);
                        if (baseStoneIndex !== -1) {
                            updatedGame.baseStones = [...game.baseStones];
                            const originalBaseStone = game.baseStones[baseStoneIndex];
                            updatedGame.baseStones[baseStoneIndex] = { x: animationTo.x, y: animationTo.y, player: originalBaseStone.player };
                        }
                    }
                    
                    // 싱글플레이에서 baseStones_p1, baseStones_p2도 확인
                    const playerId = playerWhoMoved === Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                    const baseStonesKey = playerId === game.player1.id ? 'baseStones_p1' : 'baseStones_p2';
                    const baseStonesArray = (game as any)[baseStonesKey] as Point[] | undefined;
                    if (baseStonesArray) {
                        const baseStoneIndex = baseStonesArray.findIndex(bs => bs.x === animationFrom.x && bs.y === animationFrom.y);
                        if (baseStoneIndex !== -1) {
                            (updatedGame as any)[baseStonesKey] = [...baseStonesArray];
                            (updatedGame as any)[baseStonesKey][baseStoneIndex] = { x: animationTo.x, y: animationTo.y };
                        }
                    }
                    
                    // moveHistory 업데이트: 원래 자리의 이동 기록을 목적지로 변경 (이미 서버에서 처리되었을 수 있음)
                    const fromMoveIndex = game.moveHistory.findIndex(m => m.x === animationFrom.x && m.y === animationFrom.y && m.player === playerWhoMoved);
                    if (fromMoveIndex !== -1) {
                        updatedGame.moveHistory = [...game.moveHistory];
                        updatedGame.moveHistory[fromMoveIndex] = { ...updatedGame.moveHistory[fromMoveIndex], x: animationTo.x, y: animationTo.y };
                    }
                }
                
                // sessionStorage에 저장 (restoredBoardState가 최신 상태를 읽을 수 있도록)
                try {
                    const GAME_STATE_STORAGE_KEY = `gameState_${gameId}`;
                    const gameStateToSave = {
                        gameId,
                        boardState: updatedGame.boardState,
                        moveHistory: updatedGame.moveHistory || [],
                        captures: updatedGame.captures || { [Player.None]: 0, [Player.Black]: 0, [Player.White]: 0 },
                        baseStoneCaptures: updatedGame.baseStoneCaptures,
                        hiddenStoneCaptures: updatedGame.hiddenStoneCaptures,
                        permanentlyRevealedStones: updatedGame.permanentlyRevealedStones || [],
                        blackPatternStones: updatedGame.blackPatternStones,
                        whitePatternStones: updatedGame.whitePatternStones,
                        totalTurns: updatedGame.totalTurns,
                        timestamp: Date.now()
                    };
                    sessionStorage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(gameStateToSave));
                    console.log(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Saved game state to sessionStorage for game ${gameId}`);
                } catch (e) {
                    console.error(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Failed to save game state to sessionStorage:`, e);
                }
                
                console.log(`[handleAction] SINGLE_PLAYER_CLIENT_MISSILE_ANIMATION_COMPLETE - Updated game state:`, {
                    gameId,
                    gameStatus: updatedGame.gameStatus,
                    animation: updatedGame.animation,
                    moveHistoryLength: updatedGame.moveHistory.length,
                    totalTurns: updatedGame.totalTurns,
                    captures: updatedGame.captures
                });
                
                return {
                    ...currentGames,
                    [gameId]: updatedGame
                };
            });
            
            return;
        }
        
        // 타워 게임과 싱글플레이 게임의 클라이언트 측 move 처리 (서버로 전송하지 않음)
        // 클라이언트 측 이동 처리 (도전의 탑, 싱글플레이 공통 로직)
        if ((action as any).type === 'TOWER_CLIENT_MOVE' || (action as any).type === 'SINGLE_PLAYER_CLIENT_MOVE') {
            const { updateGameStateAfterMove, checkVictoryCondition } = await import('./useClientGameState.js');
            const isTower = (action as any).type === 'TOWER_CLIENT_MOVE';
            const actionTypeName = isTower ? 'TOWER_CLIENT_MOVE' : 'SINGLE_PLAYER_CLIENT_MOVE';
            const payload = (action as any).payload;
            const { gameId, x, y, newBoardState, capturedStones, newKoInfo } = payload;
            // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
            if (process.env.NODE_ENV === 'development') {
                console.log(`[handleAction] ${actionTypeName} - processing client-side:`, { gameId, x, y });
            }
            
            // 타워 게임과 싱글플레이 게임을 각각의 상태로 관리
            const updateGameState = isTower ? setTowerGames : setSinglePlayerGames;
            const gameType: 'tower' | 'singleplayer' = isTower ? 'tower' : 'singleplayer';
            
            // 게임 상태 업데이트 및 체크 정보 준비
            let victoryCheckResult: { winner: Player; winReason: string } | null = null;
            let shouldEndGameSurvival = false;
            let endGameWinnerSurvival: Player | null = null;
            let finalUpdatedGame: LiveGameSession | null = null;
            
            updateGameState((currentGames) => {
                const game = currentGames[gameId];
                if (!game) {
                    // 게임이 아직 로드되지 않았을 수 있으므로 조용히 반환 (WebSocket 업데이트를 기다림)
                    console.debug(`[handleAction] ${actionTypeName} - Game not found in state (may be loading):`, gameId);
                    return currentGames;
                }
                
                // 게임이 이미 종료되었는지 확인
                if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest' || game.gameStatus === 'scoring') {
                    console.log(`[handleAction] ${actionTypeName} - Game already ended, ignoring move:`, {
                        gameId,
                        gameStatus: game.gameStatus
                    });
                    return currentGames;
                }
                
                // 공통 유틸리티 함수를 사용하여 게임 상태 업데이트
                const updateResult = updateGameStateAfterMove(game, payload, gameType);
                finalUpdatedGame = updateResult.updatedGame;
                
                console.log(`[handleAction] ${actionTypeName} - Updated game state:`, {
                    gameId,
                    moveHistoryLength: updateResult.updatedGame.moveHistory.length,
                    currentPlayer: updateResult.updatedGame.currentPlayer,
                    captures: updateResult.updatedGame.captures,
                    shouldCheckVictory: updateResult.shouldCheckVictory,
                    whiteTurnsPlayed: (updateResult.updatedGame as any).whiteTurnsPlayed,
                    totalTurns: (updateResult.updatedGame as any).totalTurns
                });
                
                // 싱글플레이 자동 계가 트리거 체크 (즉시 동기적으로 처리하여 게임 초기화 방지)
                let shouldTriggerAutoScoring = false;
                let autoScoringPreservedState: any = null;
                
                // 싱글플레이 또는 AI봇 대결에서 자동계가 체크
                // hidden_placing, scanning 등 아이템 모드에서는 자동계가 체크를 하지 않음
                const isItemMode = ['hidden_placing', 'scanning', 'missile_selecting', 'missile_animating', 'scanning_animating'].includes(updateResult.updatedGame.gameStatus);
                
                if (!isItemMode) {
                    const autoScoringTurns = gameType === 'singleplayer' && game.stageId
                        ? SINGLE_PLAYER_STAGES.find((s: any) => s.id === game.stageId)?.autoScoringTurns
                        : (updateResult.updatedGame.settings as any)?.autoScoringTurns;
                    
                    if (autoScoringTurns !== undefined || (gameType === 'singleplayer' && game.stageId)) {
                    // totalTurns가 없으면 moveHistory에서 계산
                    let totalTurns = updateResult.updatedGame.totalTurns;
                    if (totalTurns === undefined || totalTurns === null) {
                        const validMoves = (updateResult.updatedGame.moveHistory || []).filter((m: any) => m.x !== -1 && m.y !== -1);
                        totalTurns = validMoves.length;
                    }
                    
                        if (totalTurns !== undefined && totalTurns !== null && autoScoringTurns) {
                            try {
                                // AI 차례인지 확인 (싱글플레이에서만)
                                const currentPlayerEnum = updateResult.updatedGame.currentPlayer;
                                const isAiTurn = gameType === 'singleplayer' && 
                                    ((currentPlayerEnum === Player.White && updateResult.updatedGame.whitePlayerId === aiUserId) ||
                                     (currentPlayerEnum === Player.Black && updateResult.updatedGame.blackPlayerId === aiUserId));
                                
                                if (totalTurns >= autoScoringTurns) {
                                    // totalTurns를 업데이트
                                    updateResult.updatedGame.totalTurns = totalTurns;
                                    if (updateResult.updatedGame.gameStatus === 'playing') {
                                        // AI 차례라면 자동 계가를 트리거하지 않고, AI가 수를 두도록 함
                                        if (isAiTurn) {
                                            console.log(`[handleAction] ${actionTypeName} - Auto-scoring reached but it's AI turn, waiting for AI move: totalTurns=${totalTurns}, autoScoringTurns=${autoScoringTurns}, currentPlayer=${currentPlayerEnum === Player.White ? 'White' : 'Black'}`);
                                            // 게임 상태를 playing으로 유지하여 AI가 수를 두도록 함
                                            // shouldTriggerAutoScoring을 false로 유지 (기본값)
                                        } else {
                                            // 플레이어 차례라면 자동 계가 트리거
                                            shouldTriggerAutoScoring = true;
                                            const gameTypeLabel = gameType === 'singleplayer' ? 'SinglePlayer' : 'AiGame';
                                            console.log(`[handleAction] ${actionTypeName} - Auto-scoring triggered at ${updateResult.updatedGame.totalTurns} turns (${gameTypeLabel}, stageId: ${game.stageId || 'N/A'}) - IMMEDIATELY FREEZING GAME`);
                                            
                                            // 즉시 게임 상태를 보존하여 게임 초기화 방지 (동기적으로 처리)
                                            const preservedBoardState = updateResult.updatedGame.boardState && updateResult.updatedGame.boardState.length > 0
                                                ? updateResult.updatedGame.boardState
                                                : (game.boardState || updateResult.updatedGame.boardState);
                                            const preservedMoveHistory = updateResult.updatedGame.moveHistory && updateResult.updatedGame.moveHistory.length > 0
                                                ? updateResult.updatedGame.moveHistory
                                                : (game.moveHistory || updateResult.updatedGame.moveHistory);
                                            const preservedTotalTurns = updateResult.updatedGame.totalTurns ?? game.totalTurns;
                                            const preservedBlackTimeLeft = updateResult.updatedGame.blackTimeLeft ?? game.blackTimeLeft;
                                            const preservedWhiteTimeLeft = updateResult.updatedGame.whiteTimeLeft ?? game.whiteTimeLeft;
                                            
                                            autoScoringPreservedState = {
                                                boardState: preservedBoardState,
                                                moveHistory: preservedMoveHistory,
                                                totalTurns: preservedTotalTurns,
                                                blackTimeLeft: preservedBlackTimeLeft,
                                                whiteTimeLeft: preservedWhiteTimeLeft,
                                            };
                                            
                                            console.log(`[handleAction] IMMEDIATELY preserving game state for scoring: boardStateSize=${preservedBoardState?.length || 0}, moveHistoryLength=${preservedMoveHistory?.length || 0}, totalTurns=${preservedTotalTurns}, blackTimeLeft=${preservedBlackTimeLeft}, whiteTimeLeft=${preservedWhiteTimeLeft}`);
                                            
                                            // 게임 상태를 즉시 scoring으로 변경하여 반환값에 반영 (게임 초기화 방지)
                                            updateResult.updatedGame.gameStatus = 'scoring' as const;
                                            updateResult.updatedGame.boardState = preservedBoardState;
                                            updateResult.updatedGame.moveHistory = preservedMoveHistory;
                                            updateResult.updatedGame.totalTurns = preservedTotalTurns;
                                            updateResult.updatedGame.blackTimeLeft = preservedBlackTimeLeft;
                                            updateResult.updatedGame.whiteTimeLeft = preservedWhiteTimeLeft;
                                            
                                            // 게임 상태를 즉시 scoring으로 변경 (게임 초기화 방지)
                                            updateGameState((currentGames) => {
                                                const currentGame = currentGames[gameId];
                                                if (currentGame && currentGame.gameStatus === 'playing') {
                                                    return { 
                                                        ...currentGames, 
                                                        [gameId]: { 
                                                            ...currentGame,
                                                            ...updateResult.updatedGame, // 최신 업데이트 결과 포함 (gameStatus: 'scoring')
                                                            // boardState, moveHistory, totalTurns, 시간 정보는 반드시 보존
                                                            boardState: preservedBoardState,
                                                            moveHistory: preservedMoveHistory,
                                                            totalTurns: preservedTotalTurns,
                                                            blackTimeLeft: preservedBlackTimeLeft,
                                                            whiteTimeLeft: preservedWhiteTimeLeft,
                                                        } 
                                                    };
                                                }
                                                return currentGames;
                                            });
                                        }
                                    }
                                }
                            } catch (err) {
                                console.error(`[handleAction] Failed to check auto-scoring:`, err);
                            }
                        }
                    }
                }
                
                // 자동 계가 트리거가 필요한 경우 서버에 요청 (비동기로 처리)
                if (shouldTriggerAutoScoring && autoScoringPreservedState) {
                    const { totalTurns, moveHistory, boardState, blackTimeLeft, whiteTimeLeft } = autoScoringPreservedState;
                    
                    console.log(`[handleAction] Auto-scoring triggered on client, sending to server: totalTurns=${totalTurns}, moveHistoryLength=${moveHistory.length}, boardStateSize=${boardState.length}, blackTimeLeft=${blackTimeLeft}, whiteTimeLeft=${whiteTimeLeft}, stage=${game.stageId}`);
                    
                    // 서버에 자동 계가 트리거 요청 전송 (수 좌표 없이 플래그만 전송)
                    const autoScoringAction = {
                        type: 'PLACE_STONE',
                        payload: {
                            gameId,
                            x: -1, // 패스 좌표 (실제 수를 두는 것이 아님)
                            y: -1, // 패스 좌표 (실제 수를 두는 것이 아님)
                            totalTurns: totalTurns, // 서버에 totalTurns 정보 전달
                            moveHistory: moveHistory, // 서버에 moveHistory 정보 전달 (KataGo 분석용)
                            boardState: boardState, // 서버에 boardState 정보 전달 (KataGo 분석용)
                            blackTimeLeft: blackTimeLeft, // 서버에 시간 정보 전달
                            whiteTimeLeft: whiteTimeLeft, // 서버에 시간 정보 전달
                            triggerAutoScoring: true // 자동 계가 트리거 플래그
                        }
                    } as any;
                    
                    console.log(`[handleAction] Sending PLACE_STONE action to server for auto-scoring:`, { ...autoScoringAction, payload: { ...autoScoringAction.payload, moveHistory: `[${moveHistory.length} moves]` } });
                    handleAction(autoScoringAction).then(result => {
                        console.log(`[handleAction] Auto-scoring action sent successfully:`, result);
                    }).catch(err => {
                        console.error(`[handleAction] Failed to trigger auto-scoring on server:`, err);
                    });
                }
                
                // 살리기 바둑 모드: 백이 수를 둔 경우 백의 남은 턴 체크
                const movePlayer = game.currentPlayer; // 수를 둔 플레이어
                
                if (gameType === 'singleplayer' && movePlayer === Player.White) {
                    // game.settings에서 survivalTurns를 직접 확인 (동기적으로 접근 가능)
                    const survivalTurns = (game.settings as any)?.survivalTurns;
                    if (survivalTurns) {
                        const whiteTurnsPlayed = (updateResult.updatedGame as any).whiteTurnsPlayed || 0;
                        const remainingTurns = survivalTurns - whiteTurnsPlayed;
                        
                        console.log(`[handleAction] ${actionTypeName} - Survival Go check: whiteTurnsPlayed=${whiteTurnsPlayed}, survivalTurns=${survivalTurns}, remaining=${remainingTurns}`);
                        
                        if (remainingTurns <= 0 && game.gameStatus === 'playing') {
                            console.log(`[handleAction] ${actionTypeName} - White ran out of turns (${whiteTurnsPlayed}/${survivalTurns}), Black wins - ENDING GAME`);
                            shouldEndGameSurvival = true;
                            endGameWinnerSurvival = Player.Black;
                            // 게임 상태를 즉시 ended로 업데이트
                            return { ...currentGames, [gameId]: { ...updateResult.updatedGame, gameStatus: 'ended' as const, winner: Player.Black, winReason: 'capture_limit' } };
                        }
                    }
                }
                
                // 승리 조건 체크 (도전의 탑 및 싱글플레이)
                if (updateResult.shouldCheckVictory && updateResult.checkInfo) {
                    checkVictoryCondition(updateResult.checkInfo, gameId, game.effectiveCaptureTargets).then(result => {
                        if (result) {
                            victoryCheckResult = result;
                            // 게임 상태를 즉시 ended로 업데이트하고 winner도 설정
                            updateGameState((currentGames) => {
                                const game = currentGames[gameId];
                                if (game && game.gameStatus !== 'ended') {
                                    console.log(`[handleAction] ${actionTypeName} - Setting game status to ended and winner to ${result.winner === Player.Black ? 'Black' : 'White'} immediately:`, gameId);
                                    return { ...currentGames, [gameId]: { ...game, gameStatus: 'ended' as const, winner: result.winner, winReason: result.winReason } };
                                }
                                return currentGames;
                            });
                            // 게임 종료 액션 호출
                            const endGameActionType = isTower ? 'END_TOWER_GAME' : 'END_SINGLE_PLAYER_GAME';
                            handleAction({
                                type: endGameActionType,
                                payload: {
                                    gameId,
                                    winner: result.winner,
                                    winReason: result.winReason
                                }
                            } as any).catch(err => {
                                console.error(`[handleAction] Failed to end ${gameType} game:`, err);
                            });
                        }
                    });
                }
                
                return { ...currentGames, [gameId]: updateResult.updatedGame };
            });
            
            // 싱글플레이 게임과 도전의 탑 게임의 경우 sessionStorage에 저장 (restoredBoardState가 최신 상태를 읽을 수 있도록)
            if ((gameType === 'singleplayer' || gameType === 'tower') && finalUpdatedGame) {
                try {
                    const GAME_STATE_STORAGE_KEY = `gameState_${gameId}`;
                    const gameStateToSave = {
                        gameId,
                        boardState: finalUpdatedGame.boardState,
                        moveHistory: finalUpdatedGame.moveHistory || [],
                        captures: finalUpdatedGame.captures || { [Player.None]: 0, [Player.Black]: 0, [Player.White]: 0 },
                        baseStoneCaptures: finalUpdatedGame.baseStoneCaptures,
                        hiddenStoneCaptures: finalUpdatedGame.hiddenStoneCaptures,
                        permanentlyRevealedStones: finalUpdatedGame.permanentlyRevealedStones || [],
                        blackPatternStones: finalUpdatedGame.blackPatternStones,
                        whitePatternStones: finalUpdatedGame.whitePatternStones,
                        totalTurns: finalUpdatedGame.totalTurns,
                        timestamp: Date.now()
                    };
                    sessionStorage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(gameStateToSave));
                    console.log(`[handleAction] ${actionTypeName} - Saved game state to sessionStorage for game ${gameId}`);
                } catch (e) {
                    console.error(`[handleAction] ${actionTypeName} - Failed to save game state to sessionStorage:`, e);
                }
            }
            
            // 살리기 바둑에서 게임 종료가 필요한 경우
            if (shouldEndGameSurvival && endGameWinnerSurvival !== null && finalUpdatedGame) {
                // 게임 종료 액션 호출
                handleAction({
                    type: 'END_SINGLE_PLAYER_GAME',
                    payload: {
                        gameId,
                        winner: endGameWinnerSurvival,
                        winReason: 'capture_limit'
                    }
                } as any).catch(err => {
                    console.error(`[handleAction] Failed to end single player game:`, err);
                });
            }
            
            return { gameId };
        }
        
        if (action.type === 'CLEAR_TOURNAMENT_SESSION' && currentUserRef.current) {
            applyUserUpdate({
                    lastNeighborhoodTournament: null,
                    lastNationalTournament: null,
                    lastWorldTournament: null,
            }, 'CLEAR_TOURNAMENT_SESSION-local');
        }
        // Optimistic update는 제거 - 서버 응답에만 의존
        // TOGGLE_EQUIP_ITEM의 optimistic update는 서버 응답과 충돌할 수 있으므로 제거
        if (action.type === 'SAVE_PRESET') {
            const prevUser = currentUserRef.current;
            if (prevUser) {
                const { preset, index } = action.payload;
                const newPresets = [...(prevUser.equipmentPresets || [])];
                newPresets[index] = preset;
                applyUserUpdate({ equipmentPresets: newPresets }, 'SAVE_PRESET-local');
            }
        }

        // currentUserRef.current?.id가 없으면 액션을 보내지 않음 (401 에러 방지)
        if (!currentUserRef.current?.id) {
            if (import.meta.env.DEV) {
                console.warn(`[handleAction] Cannot send action ${action.type}: user not authenticated`);
            }
            // ENTER_TOURNAMENT_VIEW 같은 경우는 사용자가 아직 로드되지 않았을 수 있으므로
            // 에러를 표시하지 않고 조용히 무시
            if (action.type !== 'ENTER_TOURNAMENT_VIEW' && action.type !== 'LEAVE_TOURNAMENT_VIEW') {
                showError('로그인이 필요합니다.');
            }
            return;
        }

        try {
            audioService.initialize();
            const res = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ ...action, userId: currentUserRef.current.id }),
            });

            if (!res.ok) {
                let errorMessage = 'An unknown error occurred.';
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.message || errorData.error || errorMessage;
                    console.error(`[handleAction] ${action.type} - HTTP ${res.status} error:`, errorData);
                } catch (parseError) {
                    console.error(`[handleAction] ${action.type} - Failed to parse error response:`, parseError);
                    errorMessage = `서버 오류 (${res.status})`;
                }
                // 401 에러는 특별 처리 (인증 문제)
                if (res.status === 401) {
                    if (import.meta.env.DEV) {
                        console.warn(`[handleAction] ${action.type} - Authentication failed, user may not be logged in`);
                    }
                    // ENTER_TOURNAMENT_VIEW 같은 경우는 사용자가 아직 로드되지 않았을 수 있으므로
                    // 에러를 표시하지 않고 조용히 무시
                    if (action.type !== 'ENTER_TOURNAMENT_VIEW' && action.type !== 'LEAVE_TOURNAMENT_VIEW') {
                        showError('로그인이 필요합니다.');
                    }
                    return;
                }
                showError(errorMessage);
                if (action.type === 'TOGGLE_EQUIP_ITEM' || action.type === 'USE_ITEM') {
                    setUpdateTrigger(prev => prev + 1);
                }
                // Return error object so components can handle it
                return { error: errorMessage } as HandleActionResult;
            } else {
                const result = await res.json();
                if (result.error || result.message) {
                    const errorMessage = result.message || result.error || '서버 오류가 발생했습니다.';
                    console.error(`[handleAction] ${action.type} - Server returned error:`, errorMessage);
                    showError(errorMessage);
                    return;
                }
                // 계가 요청 응답 처리
                if (action.type === 'REQUEST_SCORING' && result.clientResponse?.scoringAnalysis) {
                    const { scoringAnalysis } = result.clientResponse;
                    const gameId = (action.payload as any).gameId;
                    // AI 게임도 PVE로 처리하므로 singlePlayerGames에 저장
                    // 게임을 찾아서 카테고리를 확인
                    const game = towerGames[gameId] || singlePlayerGames[gameId] || liveGames[gameId];
                    const isTower = game?.gameCategory === 'tower';
                    const updateGameState = isTower ? setTowerGames : setSinglePlayerGames;
                    
                    // 게임 상태를 scoring으로 변경하고 분석 결과 저장
                    updateGameState((currentGames) => {
                        const game = currentGames[gameId];
                        if (!game) return currentGames;
                        
                        return {
                            ...currentGames,
                            [gameId]: {
                                ...game,
                                gameStatus: 'scoring' as const,
                                analysisResult: {
                                    ...game.analysisResult,
                                    [currentUserRef.current?.id || 'system']: scoringAnalysis
                                }
                            }
                        };
                    });
                    
                    // 계가 결과를 기반으로 게임 종료 처리
                    const blackTotal = scoringAnalysis.scoreDetails?.black?.total || 0;
                    const whiteTotal = scoringAnalysis.scoreDetails?.white?.total || 0;
                    const winner = blackTotal > whiteTotal ? Player.Black : (whiteTotal > blackTotal ? Player.White : Player.None);
                    
                    updateGameState((currentGames) => {
                        const game = currentGames[gameId];
                        if (!game) return currentGames;
                        
                        return {
                            ...currentGames,
                            [gameId]: {
                                ...game,
                                gameStatus: 'ended' as const,
                                winner,
                                winReason: 'score' as const,
                                finalScores: {
                                    black: blackTotal,
                                    white: whiteTotal
                                }
                            }
                        };
                    });
                    
                    // 게임 종료 액션 호출
                    const endGameActionType = isTower ? 'END_TOWER_GAME' : 'END_SINGLE_PLAYER_GAME';
                    handleAction({
                        type: endGameActionType,
                        payload: {
                            gameId,
                            winner,
                            winReason: 'score'
                        }
                    } as any).catch(err => {
                        console.error(`[handleAction] Failed to end ${isTower ? 'tower' : 'single player'} game:`, err);
                    });
                    
                    return;
                }
                
                console.debug('[handleAction] Action response received', {
                    actionType: action.type,
                    hasUpdatedUser: !!result.updatedUser || !!result.clientResponse?.updatedUser,
                    moveHistoryLength: Array.isArray(result.clientResponse?.game?.moveHistory) ? result.clientResponse.game.moveHistory.length : undefined,
                    raw: result,
                });
                
                // CONFIRM_TOWER_GAME_START 액션에 대한 상세 로깅
                if (action.type === 'CONFIRM_TOWER_GAME_START') {
                    const responseGameId = result.clientResponse?.gameId || (result as any).gameId;
                    const responseGame = result.clientResponse?.game || (result as any).game;
                    console.log(`[handleAction] CONFIRM_TOWER_GAME_START - Full response:`, {
                        result,
                        hasClientResponse: !!result.clientResponse,
                        gameId: responseGameId,
                        hasGame: !!responseGame,
                        game: responseGame,
                        gameStatus: responseGame?.gameStatus,
                        gameCategory: responseGame?.gameCategory,
                    });
                    
                    // gameId가 없으면 경고
                    if (!responseGameId) {
                        console.warn('[handleAction] CONFIRM_TOWER_GAME_START - No gameId in response!', result);
                    }
                    // game 객체가 없으면 경고
                    if (!responseGame) {
                        console.warn('[handleAction] CONFIRM_TOWER_GAME_START - No game object in response!', result);
                    }
                }
                
                console.log(`[handleAction] ${action.type} - Response received:`, {
                    hasUpdatedUser: !!result.updatedUser,
                    hasClientResponse: !!result.clientResponse,
                    hasClientResponseUpdatedUser: !!result.clientResponse?.updatedUser,
                    hasRedirectToTournament: !!result.clientResponse?.redirectToTournament,
                    redirectToTournament: result.clientResponse?.redirectToTournament || result.redirectToTournament,
                    hasObtainedItemsBulk: !!result.obtainedItemsBulk,
                    hasClientResponseObtainedItemsBulk: !!result.clientResponse?.obtainedItemsBulk,
                    hasRewardSummary: !!result.rewardSummary,
                    hasDisassemblyResult: !!result.disassemblyResult,
                    hasCombinationResult: !!result.combinationResult,
                    hasEnhancementOutcome: !!result.enhancementOutcome,
                    hasCraftResult: !!result.craftResult,
                    resultKeys: Object.keys(result),
                    clientResponseKeys: result.clientResponse ? Object.keys(result.clientResponse) : [],
                    fullResult: result
                });
                
                // 서버 응답 구조: { success: true, ...result.clientResponse }
                // 따라서 result.updatedUser 또는 result.clientResponse?.updatedUser 확인
                const updatedUserFromResponse = result.updatedUser || result.clientResponse?.updatedUser;
                
                if (updatedUserFromResponse) {
                    // 인벤토리 변경을 확실히 반영해야 하는 액션들
                    const inventoryCriticalActions = [
                        'CLAIM_MAIL_ATTACHMENTS',
                        'CLAIM_ALL_MAIL_ATTACHMENTS',
                        'CLAIM_QUEST_REWARD',
                        'CLAIM_TOURNAMENT_REWARD',
                        'CLAIM_ACTIVITY_MILESTONE',
                        'CLAIM_SINGLE_PLAYER_MISSION_REWARD',
                        'CLAIM_ALL_TRAINING_QUEST_REWARDS',
                        'SINGLE_PLAYER_REFRESH_PLACEMENT',
                        'BUY_SHOP_ITEM',
                        'BUY_MATERIAL_BOX',
                        'BUY_CONSUMABLE',
                        'BUY_CONDITION_POTION',
                        'USE_CONDITION_POTION',
                        'BUY_BORDER',
                        'ENHANCE_ITEM',
                        'DISASSEMBLE_ITEM',
                        'COMBINE_ITEMS',
                        'CRAFT_MATERIAL',
                        'EXPAND_INVENTORY',
                        'TOGGLE_EQUIP_ITEM',
                        'MANNER_ACTION'
                    ];
                    const isInventoryCriticalAction = inventoryCriticalActions.includes(action.type);
                    
                    if (isInventoryCriticalAction && updatedUserFromResponse.inventory) {
                        // inventory가 있는 경우 깊은 복사로 새로운 참조 생성하여 React가 변경을 확실히 감지하도록 함
                        updatedUserFromResponse.inventory = JSON.parse(JSON.stringify(updatedUserFromResponse.inventory));
                        console.log(`[handleAction] ${action.type} - Forcing inventory update`, {
                            inventoryLength: updatedUserFromResponse.inventory?.length,
                            inventoryItems: updatedUserFromResponse.inventory?.slice(0, 3).map((i: any) => i.name)
                        });
                    }

                    if ((action.type === 'CLAIM_SINGLE_PLAYER_MISSION_REWARD' || action.type === 'CLAIM_ALL_TRAINING_QUEST_REWARDS') && updatedUserFromResponse.singlePlayerMissions) {
                        try {
                            updatedUserFromResponse.singlePlayerMissions = JSON.parse(JSON.stringify(updatedUserFromResponse.singlePlayerMissions));
                        } catch (error) {
                            console.warn(`[handleAction] ${action.type} - Failed to deep copy singlePlayerMissions`, error);
                        }
                    }
                    
                    // applyUserUpdate는 이미 내부에서 flushSync를 사용하므로 모든 액션에서 즉시 UI 업데이트됨
                    // HTTP 응답의 updatedUser를 우선적으로 적용하고, WebSocket 업데이트는 일정 시간 동안 무시됨
                    const mergedUser = applyUserUpdate(updatedUserFromResponse, `${action.type}-http`);
                    // HTTP 응답에 updatedUser가 있었음을 기록하고 타임스탬프 업데이트
                    lastHttpUpdateTime.current = Date.now();
                    lastHttpActionType.current = action.type;
                    lastHttpHadUpdatedUser.current = true;
                    console.log(`[handleAction] ${action.type} - applied HTTP updatedUser (WebSocket updates will be ignored for ${HTTP_UPDATE_DEBOUNCE_MS}ms)`, {
                        inventoryLength: mergedUser?.inventory?.length,
                        equipment: mergedUser?.equipment,
                        gold: mergedUser?.gold,
                        diamonds: mergedUser?.diamonds,
                        actionPoints: mergedUser?.actionPoints
                    });
                    
                    // 보상 수령 액션의 경우 추가로 강제 업데이트
                    if (isInventoryCriticalAction) {
                        flushSync(() => {
                            setUpdateTrigger(prev => prev + 1);
                            // currentUser 상태를 다시 설정하여 확실히 업데이트
                            setCurrentUser(prev => {
                                if (prev && mergedUser && prev.id === mergedUser.id) {
                                    return mergedUser;
                                }
                                return prev;
                            });
                        });
                    }
                } else {
                    // HTTP 응답에 updatedUser가 없었음을 기록 (타임스탬프는 업데이트하지 않음)
                    lastHttpActionType.current = action.type;
                    lastHttpHadUpdatedUser.current = false;
                    const actionsThatShouldHaveUpdatedUser = [
                        'TOGGLE_EQUIP_ITEM', 'USE_ITEM', 'USE_ALL_ITEMS_OF_TYPE', 'ENHANCE_ITEM', 
                        'COMBINE_ITEMS', 'DISASSEMBLE_ITEM', 'CRAFT_MATERIAL', 'BUY_SHOP_ITEM', 
                        'BUY_CONSUMABLE', 'BUY_CONDITION_POTION', 'USE_CONDITION_POTION', 'UPDATE_AVATAR', 
                        'UPDATE_BORDER', 'CHANGE_NICKNAME', 'UPDATE_MBTI', 'ALLOCATE_STAT_POINT',
                        'SELL_ITEM', 'EXPAND_INVENTORY', 'BUY_BORDER', 'APPLY_PRESET', 'SAVE_PRESET',
                        'DELETE_MAIL', 'DELETE_ALL_CLAIMED_MAIL', 'CLAIM_MAIL_ATTACHMENTS', 
                        'CLAIM_ALL_MAIL_ATTACHMENTS', 'MARK_MAIL_AS_READ',
                        'CLAIM_QUEST_REWARD', 'CLAIM_ACTIVITY_MILESTONE',
                        'CLAIM_SINGLE_PLAYER_MISSION_REWARD', 'CLAIM_ALL_TRAINING_QUEST_REWARDS', 'LEVEL_UP_TRAINING_QUEST',
                        'SINGLE_PLAYER_REFRESH_PLACEMENT',
                        'MANNER_ACTION'
                    ];
                    if (actionsThatShouldHaveUpdatedUser.includes(action.type)) {
                        console.warn(`[handleAction] ${action.type} - No updatedUser in response! Waiting for WebSocket update...`, {
                            hasClientResponse: !!result.clientResponse,
                            clientResponseKeys: result.clientResponse ? Object.keys(result.clientResponse) : [],
                            resultKeys: Object.keys(result)
                        });
                        // updatedUser가 없어도 액션 타입을 기록하여 WebSocket 업데이트를 받을 수 있도록 함
                        // 타임스탬프는 설정하지 않아서 WebSocket 업데이트가 즉시 적용되도록 함
                        lastHttpActionType.current = action.type;
                        // updatedUser가 없으면 WebSocket 업데이트를 기다리되, 타임아웃을 설정하여 일정 시간 후 강제 업데이트
                        // WebSocket USER_UPDATE가 곧 도착할 것이므로 별도 처리 불필요
                        // 하지만 WebSocket 업데이트가 오지 않으면 문제가 될 수 있으므로, 짧은 시간 후 WebSocket 무시 시간을 줄임
                        setTimeout(() => {
                            // WebSocket 업데이트가 오지 않았으면 무시 시간을 줄여서 다음 WebSocket 업데이트를 받을 수 있도록 함
                            const timeSinceLastHttpUpdate = Date.now() - lastHttpUpdateTime.current;
                            if (timeSinceLastHttpUpdate > HTTP_UPDATE_DEBOUNCE_MS || lastHttpUpdateTime.current === 0) {
                                console.warn(`[handleAction] ${action.type} - WebSocket update not received, reducing debounce window`);
                                // 다음 WebSocket 업데이트를 받을 수 있도록 타임스탬프 조정
                                lastHttpUpdateTime.current = Date.now() - HTTP_UPDATE_DEBOUNCE_MS;
                            }
                        }, 500);
                     }
                 }
                 
                 // 변경권 사용 시 대장간 제련 탭으로 이동
                 if (action.type === 'USE_ITEM' && result.clientResponse?.openBlacksmithRefineTab) {
                     setIsBlacksmithModalOpen(true);
                     setBlacksmithActiveTab('refine');
                     // 선택된 아이템이 있으면 해당 아이템 선택
                     if (result.clientResponse?.selectedItemId && currentUser) {
                         const selectedItem = currentUser.inventory.find(i => i.id === result.clientResponse.selectedItemId);
                         if (selectedItem && selectedItem.type === 'equipment') {
                             // BlacksmithModal에 전달할 수 있도록 상태 업데이트
                             // 실제로는 BlacksmithModal이 열릴 때 인벤토리에서 선택하도록 함
                         }
                     }
                 }
                 
                 // trainingQuestLevelUp 응답 처리 (강화 완료 피드백용)
                 const trainingQuestLevelUp = result.clientResponse?.trainingQuestLevelUp;
                 if (trainingQuestLevelUp && action.type === 'LEVEL_UP_TRAINING_QUEST') {
                     // TrainingQuestPanel에서 처리할 수 있도록 반환
                     return trainingQuestLevelUp;
                 }
                 
                 const obtainedItemsBulk = result.clientResponse?.obtainedItemsBulk || result.obtainedItemsBulk;
                 if (obtainedItemsBulk) {
                     const stampedItems = obtainedItemsBulk.map((item: any) => ({
                         ...item,
                         id: item.id || `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                         quantity: item.quantity ?? 1,
                     }));
                     setLastUsedItemResult(stampedItems);
                 }
                 const scoreChange = result.clientResponse?.tournamentScoreChange;
                 if (scoreChange) setTournamentScoreChange(scoreChange);
                
                 // 제련 결과 처리
                 if (action.type === 'REFINE_EQUIPMENT' && result.clientResponse?.refinementResult) {
                     setRefinementResult(result.clientResponse.refinementResult);
                 }
                
                 // 보상 수령 모달 처리 (즉시 표시를 위해 flushSync 사용)
                if (result.rewardSummary) {
                    flushSync(() => {
                        setRewardSummary(result.rewardSummary);
                    });
                } else if (result.clientResponse?.rewardSummary) {
                    flushSync(() => {
                        setRewardSummary(result.clientResponse.rewardSummary);
                    });
                } else if (action.type === 'CLAIM_SINGLE_PLAYER_MISSION_REWARD' && result.clientResponse?.reward) {
                    // 서버에서 rewardSummary가 없을 경우 fallback
                    const reward = result.clientResponse.reward;
                    flushSync(() => {
                        setRewardSummary({
                            reward: reward,
                            items: [],
                            title: '수련과제 보상 수령'
                        });
                    });
                }
                
                if (result.claimAllSummary) {
                    flushSync(() => {
                        setClaimAllSummary(result.claimAllSummary);
                        setIsClaimAllSummaryOpen(true);
                    });
                }
                
                // 수련 과제 일괄 수령 응답 처리
                const claimAllTrainingQuestRewards = result.clientResponse?.claimAllTrainingQuestRewards 
                    || result.claimAllTrainingQuestRewards;
                if (claimAllTrainingQuestRewards && action.type === 'CLAIM_ALL_TRAINING_QUEST_REWARDS') {
                    // TrainingQuestPanel에서 처리할 수 있도록 반환
                    return {
                        claimAllTrainingQuestRewards: claimAllTrainingQuestRewards
                    };
                }
                const disassemblyResult = result.clientResponse?.disassemblyResult || result.disassemblyResult;
                if (disassemblyResult) { 
                    setDisassemblyResult(disassemblyResult);
                    if (disassemblyResult.jackpot) audioService.disassemblyJackpot();
                }
                const craftResult = result.clientResponse?.craftResult || result.craftResult;
                if (craftResult) {
                    console.log(`[handleAction] ${action.type} - Setting craftResult:`, {
                        craftResult,
                        hasCraftResult: !!craftResult,
                        gained: craftResult.gained,
                        used: craftResult.used,
                        craftType: craftResult.craftType,
                        jackpot: craftResult.jackpot
                    });
                    // 상태 업데이트를 즉시 동기적으로 처리하여 결과 모달이 확실히 표시되도록 함
                    flushSync(() => {
                        setCraftResult(craftResult);
                    });
                    // 대박 발생 시 사운드 재생
                    if (craftResult.jackpot) {
                        audioService.disassemblyJackpot();
                    }
                    // 추가 디버깅: 상태가 설정되었는지 확인
                    console.log(`[handleAction] ${action.type} - craftResult state set, should trigger modal`);
                } else {
                    // craftResult가 없는 것은 정상입니다 (일부 액션만 craftResult를 반환)
                    // 경고는 craftResult를 반환해야 하는 액션에서만 표시
                    const actionsThatShouldHaveCraftResult = ['CRAFT_MATERIAL', 'CONVERT_MATERIAL'];
                    if (actionsThatShouldHaveCraftResult.includes(action.type)) {
                        console.warn(`[handleAction] ${action.type} - No craftResult in response!`, {
                            hasClientResponse: !!result.clientResponse,
                            hasCraftResult: !!result.craftResult,
                            clientResponseKeys: result.clientResponse ? Object.keys(result.clientResponse) : [],
                            resultKeys: Object.keys(result)
                        });
                    }
                }
                const combinationResult = result.clientResponse?.combinationResult || result.combinationResult;
                if (combinationResult) {
                    setCombinationResult(combinationResult);
                    if (combinationResult.isGreatSuccess) {
                        audioService.combinationGreatSuccess(); // Assuming this sound exists
                    } else {
                        audioService.combinationSuccess(); // Assuming this sound exists
                    }
                }
                // 랭킹전 매칭 시작 응답 처리
                if (action.type === 'START_RANKED_MATCHING' && result.clientResponse?.success) {
                    const matchingInfo = result.clientResponse.matchingInfo;
                    if (matchingInfo) {
                        console.log('[handleAction] START_RANKED_MATCHING - Matching started:', matchingInfo);
                        // 매칭 정보를 반환하여 컴포넌트에서 즉시 상태 업데이트 가능하도록 함
                        return { matchingInfo } as HandleActionResult;
                    }
                }
                
                const enhancementOutcome = result.clientResponse?.enhancementOutcome || result.enhancementOutcome;
                if (enhancementOutcome) {
                    const { message, success, itemBefore, itemAfter, xpGained } = enhancementOutcome;
                    setEnhancementResult({ message, success });
                    // 서버 응답이 오면 롤링 애니메이션을 종료하고 실제 결과를 표시
                    setEnhancementOutcome({ message, success, itemBefore, itemAfter, xpGained, isRolling: false });
                    setIsEnhancementResultModalOpen(true);
                    const enhancementAnimationTarget = result.clientResponse?.enhancementAnimationTarget || result.enhancementAnimationTarget;
                    if (enhancementAnimationTarget) {
                        setEnhancementAnimationTarget(enhancementAnimationTarget);
                    }
                    if (success) {
                        audioService.enhancementSuccess();
                    } else {
                        audioService.enhancementFail();
                    }
                }
                if (result.enhancementAnimationTarget) setEnhancementAnimationTarget(result.enhancementAnimationTarget);
                const redirectToTournament = result.clientResponse?.redirectToTournament || result.redirectToTournament;
                if (redirectToTournament) {
                    if (action.type !== 'USE_CONDITION_POTION' && action.type !== 'BUY_CONDITION_POTION') {
                        const targetHash = `#/tournament/${redirectToTournament}`;
                        if (window.location.hash !== targetHash) {
                            console.log(`[handleAction] ${action.type} - Redirecting to tournament:`, redirectToTournament);
                            setTimeout(() => {
                                window.location.hash = targetHash;
                            }, 200);
                                } else {
                            console.log(`[handleAction] ${action.type} - Already at ${targetHash}, skipping redirect`);
                        }
                    } else {
                        console.log(`[handleAction] ${action.type} - Skipping redirect (already in tournament)`);
                    }
                }
                
                // 비상탈출 등에서 사용하는 일반 redirectTo 처리
                const redirectTo = result.clientResponse?.redirectTo;
                if (redirectTo) {
                    if (window.location.hash !== redirectTo) {
                        console.log(`[handleAction] ${action.type} - Redirecting to:`, redirectTo);
                        setTimeout(() => {
                            window.location.hash = redirectTo;
                        }, 200);
                    } else {
                        console.log(`[handleAction] ${action.type} - Already at ${redirectTo}, skipping redirect`);
                    }
                }
                // 거절 메시지 표시
                if (result.declinedMessage) {
                    showError(result.declinedMessage.message);
                }
                
                // ACCEPT_NEGOTIATION, START_AI_GAME, START_SINGLE_PLAYER_GAME, START_TOWER_GAME, CONFIRM_TOWER_GAME_START, CONFIRM_SINGLE_PLAYER_GAME_START 후 게임이 생성되었거나 업데이트되었을 때 처리
                // 서버 응답 구조: { success: true, ...result.clientResponse }
                // 따라서 result.gameId 또는 result.clientResponse?.gameId 둘 다 확인
                const gameId = (result as any).gameId || result.clientResponse?.gameId;
                const game = (result as any).game || result.clientResponse?.game;
                
                // CONFIRM_TOWER_GAME_START의 경우 gameId가 없어도 게임이 이미 있을 수 있으므로, session에서 gameId를 가져올 수 있음
                let effectiveGameId = gameId;
                if (!effectiveGameId && (action.type === 'CONFIRM_TOWER_GAME_START' || action.type === 'CONFIRM_SINGLE_PLAYER_GAME_START')) {
                    effectiveGameId = (action.payload as any)?.gameId;
                    console.log(`[handleAction] ${action.type} - gameId not in response, using payload gameId:`, effectiveGameId);
                }
                
                // END_TOWER_GAME 액션 처리
                if (action.type === 'END_TOWER_GAME') {
                    const endGameId = (action.payload as any)?.gameId || gameId;
                    const endGame = game || (result.clientResponse?.game);
                    
                    if (endGameId && endGame) {
                        console.log(`[handleAction] ${action.type} - Updating game with winner:`, { gameId: endGameId, winner: endGame.winner, gameStatus: endGame.gameStatus });
                        
                        if (endGame.gameCategory === 'tower') {
                            setTowerGames(currentGames => {
                                const existingGame = currentGames[endGameId];
                                // winner가 설정된 경우 항상 업데이트 (서버에서 설정한 정확한 winner 정보 사용)
                                if (endGame.winner !== null && endGame.winner !== undefined) {
                                    console.log(`[handleAction] ${action.type} - Updating tower game winner:`, { gameId: endGameId, winner: endGame.winner, existingWinner: existingGame?.winner });
                                    return { ...currentGames, [endGameId]: { ...existingGame, ...endGame } };
                                }
                                return currentGames;
                            });
                        } else if (endGame.isSinglePlayer) {
                            setSinglePlayerGames(currentGames => {
                                const existingGame = currentGames[endGameId];
                                if (endGame.winner !== null && endGame.winner !== undefined) {
                                    console.log(`[handleAction] ${action.type} - Updating single player game winner:`, { gameId: endGameId, winner: endGame.winner, existingWinner: existingGame?.winner });
                                    return { ...currentGames, [endGameId]: { ...existingGame, ...endGame } };
                                }
                                return currentGames;
                            });
                        }
                    }
                }
                
                if (effectiveGameId && (action.type === 'ACCEPT_NEGOTIATION' || action.type === 'START_AI_GAME' || action.type === 'START_SINGLE_PLAYER_GAME' || action.type === 'START_TOWER_GAME' || action.type === 'CONFIRM_TOWER_GAME_START' || action.type === 'CONFIRM_SINGLE_PLAYER_GAME_START')) {
                    console.log(`[handleAction] ${action.type} - gameId received:`, effectiveGameId, 'hasGame:', !!game, 'result keys:', Object.keys(result), 'clientResponse keys:', result.clientResponse ? Object.keys(result.clientResponse) : []);
                    
                    // 응답에 게임 데이터가 있으면 즉시 상태에 추가 (WebSocket 업데이트를 기다리지 않음)
                    if (game) {
                        console.log(`[handleAction] ${action.type} - Game object found in response:`, { gameId: game.id, gameStatus: game.gameStatus, gameCategory: game.gameCategory, isSinglePlayer: game.isSinglePlayer });
                        const isTowerGame = game.gameCategory === 'tower';
                        console.log('[handleAction] Adding game to state immediately:', effectiveGameId, 'isSinglePlayer:', game.isSinglePlayer, 'gameCategory:', game.gameCategory, 'isTower:', isTowerGame);
                        
                        // 게임 카테고리 확인
                        if (game.isSinglePlayer) {
                            setSinglePlayerGames(currentGames => {
                                // CONFIRM 액션의 경우 게임 상태가 업데이트되었으므로 항상 업데이트
                                if (action.type === 'CONFIRM_SINGLE_PLAYER_GAME_START' || !currentGames[effectiveGameId]) {
                                    return { ...currentGames, [effectiveGameId]: game };
                                }
                                return currentGames;
                            });
                        } else if (isTowerGame) {
                            setTowerGames(currentGames => {
                                // CONFIRM 액션의 경우 게임 상태가 pending에서 playing으로 변경되었으므로 항상 업데이트
                                if (action.type === 'CONFIRM_TOWER_GAME_START' || !currentGames[effectiveGameId]) {
                                    console.log('[handleAction] Updating tower game:', effectiveGameId, 'gameStatus:', game.gameStatus, 'action type:', action.type, 'existing game status:', currentGames[effectiveGameId]?.gameStatus);
                                    return { ...currentGames, [effectiveGameId]: game };
                                }
                                return currentGames;
                            });
                        } else {
                            setLiveGames(currentGames => {
                                if (currentGames[gameId]) {
                                    return currentGames;
                                }
                                return { ...currentGames, [gameId]: game };
                            });
                        }
                        
                        // 사용자 상태도 즉시 업데이트 (gameId와 status를 'in-game'으로 설정)
                        // currentUserWithStatus는 onlineUsers에서 가져오므로, onlineUsers를 업데이트하면 자동으로 반영됨
                        if (currentUser?.id) {
                            setOnlineUsers(prevUsers => {
                                const userIndex = prevUsers.findIndex(u => u.id === currentUser.id);
                                if (userIndex >= 0) {
                                    const updatedUsers = [...prevUsers];
                                    updatedUsers[userIndex] = {
                                        ...updatedUsers[userIndex],
                                        gameId: effectiveGameId,
                                        status: UserStatus.InGame,
                                        mode: game.mode
                                    };
                                    console.log('[handleAction] Updated user status in onlineUsers:', {
                                        userId: currentUser.id,
                                        gameId: effectiveGameId,
                                        status: 'in-game',
                                        mode: game.mode
                                    });
                                    return updatedUsers;
                                } else {
                                    // 사용자가 onlineUsers에 없으면 추가
                                    const newUser: UserWithStatus = {
                                        ...currentUser,
                                        status: UserStatus.InGame,
                                        gameId: effectiveGameId,
                                        mode: game.mode
                                    };
                                    console.log('[handleAction] Added user to onlineUsers:', newUser);
                                    return [...prevUsers, newUser];
                                }
                            });
                        }
                    }
                    
                    // CONFIRM_TOWER_GAME_START의 경우 게임 객체가 없어도 WebSocket GAME_UPDATE를 기다림
                    // 하지만 게임이 이미 towerGames에 있으면 상태를 업데이트해야 함
                    if (!game && effectiveGameId && (action.type === 'CONFIRM_TOWER_GAME_START' || action.type === 'CONFIRM_SINGLE_PLAYER_GAME_START')) {
                        console.log(`[handleAction] ${action.type} - No game in response, checking existing games for gameId:`, effectiveGameId);
                        
                        // 기존 게임 상태 확인
                        const existingTowerGame = towerGames[effectiveGameId];
                        const existingSinglePlayerGame = singlePlayerGames[effectiveGameId];
                        const existingGame = existingTowerGame || existingSinglePlayerGame;
                        
                        if (existingGame) {
                            console.log(`[handleAction] ${action.type} - Found existing game, updating status to playing:`, { gameId: effectiveGameId, currentStatus: existingGame.gameStatus });
                            
                            // 게임 상태를 playing으로 업데이트 (WebSocket 업데이트를 기다리지 않고 즉시)
                            if (existingTowerGame) {
                                setTowerGames(currentGames => {
                                    const updatedGame = { ...currentGames[effectiveGameId], gameStatus: 'playing' as const, startTime: Date.now() };
                                    return { ...currentGames, [effectiveGameId]: updatedGame };
                                });
                            } else if (existingSinglePlayerGame) {
                                setSinglePlayerGames(currentGames => {
                                    const updatedGame = { ...currentGames[effectiveGameId], gameStatus: 'playing' as const, startTime: Date.now() };
                                    return { ...currentGames, [effectiveGameId]: updatedGame };
                                });
                            }
                        } else {
                            console.log(`[handleAction] ${action.type} - Game not found in state, will wait for GAME_UPDATE WebSocket message`);
                        }
                    }
                    
                    // 즉시 라우팅 업데이트 (게임이 생성되었으므로)
                    // 게임 데이터가 있으면 즉시 라우팅, 없어도 gameId가 있으면 즉시 라우팅
                    const targetHash = `#/game/${effectiveGameId}`;
                    if (window.location.hash !== targetHash) {
                        console.log('[handleAction] Setting immediate route to new game:', targetHash, 'hasGame:', !!game);
                        // 즉시 라우팅 (지연 제거)
                        window.location.hash = targetHash;
                    }
                    
                    // gameId를 반환하여 컴포넌트에서 사용할 수 있도록 함
                    return { gameId: effectiveGameId };
                } else if (action.type === 'START_TOWER_GAME') {
                    // START_TOWER_GAME의 경우 gameId를 다시 확인 (다른 경로에서 올 수 있음)
                    const towerGameId = (result as any).gameId || result.clientResponse?.gameId;
                    const towerGame = (result as any).game || result.clientResponse?.game;
                    if (towerGameId) {
                        const targetHash = `#/game/${towerGameId}`;
                        console.log('[handleAction] START_TOWER_GAME - gameId found, routing to:', targetHash, 'hasGame:', !!towerGame);
                        
                        // 게임 객체가 있으면 즉시 상태에 추가
                        if (towerGame) {
                            setTowerGames(currentGames => {
                                if (!currentGames[towerGameId]) {
                                    return { ...currentGames, [towerGameId]: towerGame };
                                }
                                return currentGames;
                            });
                        }
                        
                        // 즉시 라우팅 (지연 제거)
                        if (window.location.hash !== targetHash) {
                            window.location.hash = targetHash;
                        }
                        return { gameId: towerGameId };
                    } else {
                        console.warn('[handleAction] START_TOWER_GAME - No gameId found in response:', {
                            resultKeys: Object.keys(result),
                            hasClientResponse: !!result.clientResponse,
                            clientResponseKeys: result.clientResponse ? Object.keys(result.clientResponse) : []
                        });
                    }
                }
                
                // Handle guild creation response
                if (action.type === 'CREATE_GUILD') {
                    console.log(`[handleAction] CREATE_GUILD - Processing response:`, {
                        hasResult: !!result,
                        hasSuccess: result?.success,
                        hasGuild: !!result?.guild,
                        hasClientResponse: !!result?.clientResponse,
                        hasClientResponseGuild: !!result?.clientResponse?.guild,
                        resultKeys: result ? Object.keys(result) : [],
                        clientResponseKeys: result?.clientResponse ? Object.keys(result.clientResponse) : []
                    });
                    // Server returns { success: true, ...result.clientResponse }
                    // So result.guild or result.clientResponse?.guild should work
                    const guild = result?.guild || result?.clientResponse?.guild;
                    if (guild) {
                        console.log(`[handleAction] CREATE_GUILD - Guild found:`, guild);
                        setGuilds(prev => ({ ...prev, [guild.id]: guild }));
                        // Return result in the format expected by modal
                        return { clientResponse: { guild, updatedUser: result?.updatedUser || result?.clientResponse?.updatedUser } } as HandleActionResult;
                    }
                }
                
                // Handle guild list response
                if (action.type === 'LIST_GUILDS' && result?.clientResponse?.guilds) {
                    const guildsList = result.clientResponse.guilds;
                    if (Array.isArray(guildsList)) {
                        const guildsMap: Record<string, Guild> = {};
                        guildsList.forEach((g: any) => {
                            if (g && g.id) guildsMap[g.id] = g;
                        });
                        setGuilds(prev => ({ ...prev, ...guildsMap }));
                    }
                }
                
                // Handle other guild responses that might include guilds
                if (result?.clientResponse?.guilds && typeof result.clientResponse.guilds === 'object') {
                    setGuilds(prev => ({ ...prev, ...result.clientResponse.guilds }));
                }
                
                if (result?.guilds && typeof result.guilds === 'object') {
                    setGuilds(prev => ({ ...prev, ...result.guilds }));
                }
                
                // Return result for actions that need it (preserve original structure)
                // Include donationResult and other specific response fields
                if (result && (
                    result.clientResponse || 
                    result.guild || 
                    result.gameId ||
                    result.donationResult ||
                    result.clientResponse?.donationResult
                )) {
                    return result;
                }
            }
        } catch (err: any) {
            console.error(`[handleAction] ${action.type} - Exception:`, err);
            console.error(`[handleAction] Error stack:`, err.stack);
            showError(err.message || '요청 처리 중 오류가 발생했습니다.');
        }
    }, [currentUser?.id]);

    const handleLogout = useCallback(async () => {
        if (!currentUser) return;
        isLoggingOut.current = true;
        
        const userId = currentUser.id; // 현재 사용자 ID 저장
        
        // 로그아웃 액션을 먼저 전송 (비동기 처리)
        try {
            // currentUser가 null이 되기 전에 userId를 직접 사용
            const res = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ type: 'LOGOUT', userId }),
            });
            
            if (res.ok) {
                const result = await res.json();
                if (result.error) {
                    console.error('[handleLogout] Server error:', result.error);
                }
            } else {
                console.error('[handleLogout] HTTP error:', res.status);
            }
        } catch (error) {
            console.error('[handleLogout] Error during logout action:', error);
        }
        
        // 상태 초기화 (WebSocket은 useEffect cleanup에서 자동으로 닫힘)
        setCurrentUser(null);
        sessionStorage.removeItem('currentUser');
        
        // 모든 상태 초기화
        setOnlineUsers([]);
        setLiveGames({});
        setSinglePlayerGames({});
        setTowerGames({});
        setNegotiations({});
        setWaitingRoomChats({});
        setGameChats({});
        
        // 라우팅 초기화 (로그인 페이지로 이동)
        window.location.hash = '';
    }, [currentUser]);
    


    useEffect(() => {
        if (!currentUser) {
            // Clean up if user logs out
            setUsersMap({});
            setOnlineUsers([]);
            setLiveGames({});
            setNegotiations({});
            return;
        }

        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let isIntentionalClose = false;
        let shouldReconnect = true;
        let isConnecting = false; // 중복 연결 방지 플래그
        let isInitialStateReady = true;
        let pendingMessages: any[] = [];
        let initialStateTimeout: NodeJS.Timeout | null = null;

        const getCloseCodeMeaning = (code: number): string => {
            switch (code) {
                case 1000: return 'Normal Closure';
                case 1001: return 'Going Away';
                case 1002: return 'Protocol Error';
                case 1003: return 'Unsupported Data';
                case 1006: return 'Abnormal Closure (no close frame)';
                case 1007: return 'Invalid Data';
                case 1008: return 'Policy Violation';
                case 1009: return 'Message Too Big';
                case 1010: return 'Missing Extension';
                case 1011: return 'Internal Error';
                case 1012: return 'Service Restart';
                case 1013: return 'Try Again Later';
                case 1014: return 'Bad Gateway';
                case 1015: return 'TLS Handshake';
                default: return `Unknown (${code})`;
            }
        };

        // 초기 상태 처리 헬퍼 함수
        const processInitialState = (users: Record<string, any>, otherData: {
            onlineUsers?: any[];
            liveGames?: Record<string, any>;
            singlePlayerGames?: Record<string, any>;
            towerGames?: Record<string, any>;
            negotiations?: Record<string, any>;
            waitingRoomChats?: Record<string, any>;
            gameChats?: Record<string, any>;
            adminLogs?: any[];
            announcements?: any[];
            globalOverrideAnnouncement?: any;
            gameModeAvailability?: Record<string, boolean>;
            announcementInterval?: number;
            homeBoardPosts?: any[];
            guilds?: Record<string, any>;
        }) => {
                const userEntries = Object.entries(users || {});
                // nickname이 없거나 비어 있는 경우 제외
                const filteredEntries = userEntries.filter(
                    ([, u]) => u && typeof u.nickname === 'string' && u.nickname.trim().length > 0
                );

                // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                if (process.env.NODE_ENV === 'development') {
                    console.log('[WebSocket] Processing initial state - total users:', userEntries.length, 'filtered:', filteredEntries.length);
                }

                const normalizedFiltered = filteredEntries.map(([id, u]) => [
                    id,
                    {
                        ...u,
                        mbti: typeof u.mbti === 'string' ? u.mbti : null,
                        inventory: Array.isArray(u.inventory) ? u.inventory : [],
                    },
                ]);

            if (users && typeof users === 'object' && !Array.isArray(users)) {
                setUsersMap(Object.fromEntries(normalizedFiltered));
                console.log('[WebSocket] usersMap updated with', normalizedFiltered.length, 'users');
                
                // 현재 사용자의 데이터가 초기 상태에 포함되어 있으면 업데이트
                const currentUserSnapshot = currentUserRef.current;
                if (currentUserSnapshot && users[currentUserSnapshot.id]) {
                    const initialUserData = users[currentUserSnapshot.id];
                    if (initialUserData) {
                        const sanitizedUpdate: Partial<User> = {
                            ...initialUserData,
                            inventory: initialUserData.inventory ?? currentUserSnapshot.inventory,
                            equipment: initialUserData.equipment ?? currentUserSnapshot.equipment,
                        };
                        applyUserUpdate(sanitizedUpdate, 'INITIAL_STATE');
                    }
                }
            } else {
                console.warn('[WebSocket] Invalid users data:', users);
                setUsersMap({});
            }
            if (otherData) {
                if (otherData.onlineUsers !== undefined) setOnlineUsers(otherData.onlineUsers || []);
                if (otherData.liveGames !== undefined) setLiveGames(otherData.liveGames || {});
                if (otherData.singlePlayerGames !== undefined) setSinglePlayerGames(otherData.singlePlayerGames || {});
                if (otherData.towerGames !== undefined) setTowerGames(otherData.towerGames || {});
                if (otherData.negotiations !== undefined) setNegotiations(otherData.negotiations || {});
                if (otherData.waitingRoomChats !== undefined) setWaitingRoomChats(otherData.waitingRoomChats || {});
                if (otherData.gameChats !== undefined) setGameChats(otherData.gameChats || {});
                if (otherData.adminLogs !== undefined) setAdminLogs(otherData.adminLogs || []);
                if (otherData.announcements !== undefined) setAnnouncements(otherData.announcements || []);
                if (otherData.globalOverrideAnnouncement !== undefined) setGlobalOverrideAnnouncement(otherData.globalOverrideAnnouncement || null);
                if (otherData.gameModeAvailability !== undefined) setGameModeAvailability(otherData.gameModeAvailability || {});
                if (otherData.announcementInterval !== undefined) setAnnouncementInterval(otherData.announcementInterval || 3);
                if (otherData.homeBoardPosts !== undefined) setHomeBoardPosts(otherData.homeBoardPosts || []);
                if (otherData.guilds !== undefined) setGuilds(otherData.guilds || {});
            }
        };

        const connectWebSocket = () => {
            if (!shouldReconnect || !currentUser) return;
            
            // 이미 연결 중이면 중복 연결 방지
            if (isConnecting) {
                console.log('[WebSocket] Connection already in progress, skipping...');
                return;
            }
            
            // 이미 열려있는 연결이 있으면 재연결하지 않음
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('[WebSocket] Connection already open, skipping...');
                return;
            }
            
            // 기존 타임아웃 정리
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            
            isConnecting = true;
            
            try {
                // Close existing connection if any
                if (ws && ws.readyState !== WebSocket.CLOSED) {
                    console.log('[WebSocket] Closing existing connection before reconnecting');
                    isIntentionalClose = true;
                    ws.close();
                    ws = null;
                }
                
                // WebSocket 연결 URL 결정
                // Vite 개발 서버를 사용하는 경우 프록시를 통해 연결
                let wsUrl: string;
                
                // Vite 개발 서버를 사용하는 경우 (포트가 5173인 경우)
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const isViteDevServer = window.location.port === '5173' || window.location.port === '';

                if (isViteDevServer) {
                    // Vite 개발 환경에서는 프록시 (/ws) 사용
                    // 네트워크 주소(192.168.x.x)로 접속해도 프록시 사용
                    wsUrl = `${wsProtocol}//${window.location.host}/ws`;
                } else {
                    // 그 외 환경에서는 서버(4000)의 /ws 엔드포인트로 직접 연결
                    wsUrl = `${wsProtocol}//${window.location.hostname}:4000/ws`;
                }
                
                console.log('[WebSocket] Connecting to:', wsUrl);
                console.log('[WebSocket] Current location:', {
                    protocol: window.location.protocol,
                    hostname: window.location.hostname,
                    port: window.location.port,
                    href: window.location.href
                });
                
                try {
                    ws = new WebSocket(wsUrl);
                } catch (error) {
                    console.error('[WebSocket] Failed to create WebSocket:', error);
                    isConnecting = false;
                    // 재연결 시도
                    if (!isIntentionalClose && shouldReconnect && currentUser) {
                        reconnectTimeout = setTimeout(() => {
                            if (shouldReconnect && currentUser && !isConnecting) {
                                console.log('[WebSocket] Retrying connection after creation error...');
                                isIntentionalClose = false;
                                connectWebSocket();
                            }
                        }, 3000);
                    }
                    return;
                }
                
                // 연결 타임아웃 설정 (30초)
                let connectionTimeout: NodeJS.Timeout | null = setTimeout(() => {
                    if (ws && ws.readyState === WebSocket.CONNECTING) {
                        console.warn('[WebSocket] Connection timeout, closing...');
                        ws.close();
                    }
                    connectionTimeout = null;
                }, 30000);

                ws.onopen = () => {
                    console.log('[WebSocket] Connected successfully');
                    isIntentionalClose = false;
                    isConnecting = false; // 연결 완료
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }
                    // 서버에 userId 전송 (대역폭 최적화를 위해 게임 참가자에게만 메시지 전송)
                    if (currentUser?.id && ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({ type: 'AUTH', userId: currentUser.id }));
                        } catch (e) {
                            console.error('[WebSocket] Failed to send AUTH message:', e);
                        }
                    }
                };

                const scheduleInitialStateTimeout = () => {
                    if (initialStateTimeout) {
                        clearTimeout(initialStateTimeout);
                    }
                    initialStateTimeout = setTimeout(() => {
                        if (!isInitialStateReady) {
                            console.warn('[WebSocket] Initial state chunks timeout, forcing completion.');
                            const buffer = (window as any).__chunkedStateBuffer;
                            const users = buffer?.users || {};
                            const otherData = buffer?.otherData || {};
                            (window as any).__chunkedStateBuffer = null;
                            processInitialState(users, otherData);
                            completeInitialState();
                        }
                    }, 10000);
                };

                const completeInitialState = () => {
                    if (initialStateTimeout) {
                        clearTimeout(initialStateTimeout);
                        initialStateTimeout = null;
                    }
                    if (!isInitialStateReady) {
                        isInitialStateReady = true;
                        if (pendingMessages.length > 0) {
                            const bufferedMessages = pendingMessages;
                            pendingMessages = [];
                            bufferedMessages.forEach(message => handleMessage(message, true));
                        }
                    }
                };

                function handleMessage(message: any, fromBuffer = false) {
                    const initialStateTypes = ['INITIAL_STATE_START', 'INITIAL_STATE_CHUNK', 'INITIAL_STATE', 'CONNECTION_ESTABLISHED'];

                    if (!fromBuffer && !isInitialStateReady && !initialStateTypes.includes(message.type)) {
                        pendingMessages.push(message);
                        return;
                    }

                    switch (message.type) {
                        case 'CONNECTION_ESTABLISHED':
                            console.log('[WebSocket] Connection established, waiting for initial state...');
                            return;
                        case 'INITIAL_STATE_START': {
                            console.log('[WebSocket] Receiving chunked initial state (start):', {
                                chunkIndex: message.payload.chunkIndex,
                                totalChunks: message.payload.totalChunks
                            });
                            isInitialStateReady = false;
                            pendingMessages = [];
                            scheduleInitialStateTimeout();
                            (window as any).__chunkedStateBuffer = {
                                users: {},
                                receivedChunks: 0,
                                totalChunks: message.payload.totalChunks,
                                otherData: null
                            };
                            const startBuffer = (window as any).__chunkedStateBuffer;
                            Object.assign(startBuffer.users, message.payload.users);
                            startBuffer.otherData = {
                                onlineUsers: message.payload.onlineUsers,
                                liveGames: message.payload.liveGames,
                                singlePlayerGames: message.payload.singlePlayerGames,
                                towerGames: message.payload.towerGames,
                                negotiations: message.payload.negotiations,
                                waitingRoomChats: message.payload.waitingRoomChats,
                                gameChats: message.payload.gameChats,
                                adminLogs: message.payload.adminLogs,
                                announcements: message.payload.announcements,
                                globalOverrideAnnouncement: message.payload.globalOverrideAnnouncement,
                                gameModeAvailability: message.payload.gameModeAvailability,
                                announcementInterval: message.payload.announcementInterval,
                                homeBoardPosts: message.payload.homeBoardPosts,
                                guilds: message.payload.guilds || {}
                            };
                            startBuffer.receivedChunks++;
                            if (message.payload.isLast) {
                                processInitialState(startBuffer.users, startBuffer.otherData);
                                (window as any).__chunkedStateBuffer = null;
                                completeInitialState();
                            }
                            return;
                        }
                        case 'INITIAL_STATE_CHUNK': {
                            if (!(window as any).__chunkedStateBuffer) {
                                console.warn('[WebSocket] Received chunk without INITIAL_STATE_START, initializing buffer...');
                                (window as any).__chunkedStateBuffer = {
                                    users: {},
                                    receivedChunks: 0,
                                    totalChunks: message.payload.totalChunks || 0,
                                    otherData: null
                                };
                            }
                            isInitialStateReady = false;
                            scheduleInitialStateTimeout();
                            const chunkBuffer = (window as any).__chunkedStateBuffer;
                            Object.assign(chunkBuffer.users, message.payload.users);
                            chunkBuffer.receivedChunks++;
                            console.log(`[WebSocket] Received chunk ${chunkBuffer.receivedChunks}/${chunkBuffer.totalChunks || '?'} (index ${message.payload.chunkIndex})`);
                            if (message.payload.isLast) {
                                console.log('[WebSocket] All chunks received, processing...');
                                if (!chunkBuffer.otherData) {
                                chunkBuffer.otherData = {
                                    onlineUsers: message.payload.onlineUsers,
                                    liveGames: message.payload.liveGames,
                                    singlePlayerGames: message.payload.singlePlayerGames,
                                    towerGames: message.payload.towerGames,
                                    negotiations: message.payload.negotiations,
                                    waitingRoomChats: message.payload.waitingRoomChats,
                                    gameChats: message.payload.gameChats,
                                    adminLogs: message.payload.adminLogs,
                                    announcements: message.payload.announcements,
                                    globalOverrideAnnouncement: message.payload.globalOverrideAnnouncement,
                                    gameModeAvailability: message.payload.gameModeAvailability,
                                    announcementInterval: message.payload.announcementInterval,
                                    homeBoardPosts: message.payload.homeBoardPosts,
                                    guilds: message.payload.guilds || chunkBuffer.otherData?.guilds || {}
                                };
                                }
                                processInitialState(chunkBuffer.users, chunkBuffer.otherData);
                                (window as any).__chunkedStateBuffer = null;
                                completeInitialState();
                                console.log('[WebSocket] Chunked initial state processed successfully');
                            }
                            return;
                        }
                        case 'INITIAL_STATE': {
                            console.log('INITIAL_STATE payload:', message.payload);
                            isInitialStateReady = false;
                            pendingMessages = [];
                            scheduleInitialStateTimeout();
                            const {
                                users,
                                onlineUsers,
                                liveGames,
                                singlePlayerGames,
                                towerGames,
                                negotiations,
                                waitingRoomChats,
                                gameChats,
                                adminLogs,
                                announcements,
                                globalOverrideAnnouncement,
                                gameModeAvailability,
                                announcementInterval,
                                homeBoardPosts,
                                guilds
                            } = message.payload;
                            processInitialState(users, {
                                onlineUsers,
                                liveGames,
                                singlePlayerGames,
                                towerGames,
                                negotiations,
                                waitingRoomChats,
                                gameChats,
                                adminLogs,
                                announcements,
                                globalOverrideAnnouncement,
                                gameModeAvailability,
                                announcementInterval,
                                homeBoardPosts,
                                guilds
                            });
                            completeInitialState();
                            return;
                        }
                        case 'USER_UPDATE': {
                            const payload = message.payload || {};
                            const updatedCurrentUser = currentUser ? payload[currentUser.id] : undefined;

                            setUsersMap(currentUsersMap => {
                                const updatedUsersMap = { ...currentUsersMap };
                                Object.entries(payload).forEach(([userId, updatedUserData]: [string, any]) => {
                                    updatedUsersMap[userId] = updatedUserData;
                                });
                                return updatedUsersMap;
                            });

                            if (currentUser && updatedCurrentUser && updatedCurrentUser.id === currentUser.id) {
                                const now = Date.now();
                                const timeSinceLastHttpUpdate = now - lastHttpUpdateTime.current;

                                const hadHttpUpdate = lastHttpUpdateTime.current > 0;
                                const httpUpdateHadUser = lastHttpHadUpdatedUser.current;

                                if (hadHttpUpdate && httpUpdateHadUser && timeSinceLastHttpUpdate < HTTP_UPDATE_DEBOUNCE_MS) {
                                    console.log(`[WebSocket] USER_UPDATE ignored (${timeSinceLastHttpUpdate}ms since HTTP update with user, debounce: ${HTTP_UPDATE_DEBOUNCE_MS}ms, last action: ${lastHttpActionType.current})`);
                                    return;
                                }

                                if (!httpUpdateHadUser && lastHttpActionType.current) {
                                    console.log(`[WebSocket] USER_UPDATE applied immediately (HTTP response had no updatedUser for ${lastHttpActionType.current})`);
                                    lastHttpUpdateTime.current = now;
                                    lastHttpHadUpdatedUser.current = true;
                                }

                                if (hadHttpUpdate && httpUpdateHadUser && timeSinceLastHttpUpdate < HTTP_UPDATE_DEBOUNCE_MS * 2 && lastHttpActionType.current) {
                                    console.log(`[WebSocket] USER_UPDATE ignored (possible stale data, ${timeSinceLastHttpUpdate}ms since HTTP update)`);
                                    return;
                                }

                                const mergedUser = applyUserUpdate(updatedCurrentUser, 'USER_UPDATE-websocket');
                                console.log('[WebSocket] Applied USER_UPDATE for currentUser:', {
                                    inventoryLength: mergedUser.inventory?.length,
                                    gold: mergedUser.gold,
                                    diamonds: mergedUser.diamonds,
                                    equipment: mergedUser.equipment,
                                    actionPoints: mergedUser.actionPoints
                                });
                            }
                            return;
                        }
                        case 'USER_STATUS_UPDATE': {
                            setUsersMap(currentUsersMap => {
                                const updatedUsersMap = { ...currentUsersMap };
                                const onlineStatuses = Object.entries(message.payload || {}).map(([id, statusInfo]: [string, any]) => {
                                    let user: User | undefined = currentUsersMap[id];
                                    if (!user) {
                                        const allUsersArray = Object.values(currentUsersMap);
                                        user = allUsersArray.find((u: any) => u?.id === id) as User | undefined;
                                        if (!user) {
                                            console.warn(`[WebSocket] User ${id} not found in usersMap or allUsers`);
                                            return undefined;
                                        }
                                        updatedUsersMap[id] = user;
                                    }
                                    return { ...user, ...statusInfo };
                                }).filter(Boolean) as UserWithStatus[];
                                setOnlineUsers(onlineStatuses);

                                if (currentUser) {
                                    const currentUserStatus = onlineStatuses.find(u => u.id === currentUser.id);
                                    if (currentUserStatus) {
                                        if (currentUserStatus.gameId && currentUserStatus.status === 'in-game') {
                                            const gameId = currentUserStatus.gameId;
                                            const gameCategory = currentUserStatus.gameCategory;
                                            console.log('[WebSocket] Current user status updated to in-game:', gameId, 'gameCategory:', gameCategory);
                                            
                                            // 모든 게임 카테고리에서 게임 찾기
                                            const checkAllGames = () => {
                                                const game = liveGames[gameId] || singlePlayerGames[gameId] || towerGames[gameId];
                                                if (game) {
                                                    console.log('[WebSocket] Game found, routing immediately');
                                                    setTimeout(() => {
                                                        window.location.hash = `#/game/${gameId}`;
                                                    }, 100);
                                                    return true;
                                                }
                                                return false;
                                            };
                                            
                                            // 즉시 확인
                                            if (!checkAllGames()) {
                                                console.log('[WebSocket] Game not found yet, will wait for GAME_UPDATE');
                                                let attempts = 0;
                                                const maxAttempts = 20;
                                                const checkGame = () => {
                                                    attempts++;
                                                    if (checkAllGames()) {
                                                        return;
                                                    } else if (attempts < maxAttempts) {
                                                        setTimeout(checkGame, 200);
                                                    } else {
                                                        console.warn('[WebSocket] Game not found after max attempts:', gameId);
                                                    }
                                                };
                                                setTimeout(checkGame, 200);
                                            }
                                        } else if (currentUserStatus.status === 'waiting' && currentUserStatus.mode && !currentUserStatus.gameId) {
                                            const currentHash = window.location.hash;
                                            const isGamePage = currentHash.startsWith('#/game/');
                                            if (isGamePage) {
                                                // 게임 페이지에 있을 때, 현재 게임이 scoring 상태인지 확인
                                                const gameIdFromHash = currentHash.replace('#/game/', '');
                                                const currentGame = liveGames[gameIdFromHash] || singlePlayerGames[gameIdFromHash] || towerGames[gameIdFromHash];
                                                
                                                // scoring 상태의 게임은 리다이렉트하지 않음 (계가 진행 중)
                                                if (currentGame && currentGame.gameStatus === 'scoring') {
                                                    console.log('[WebSocket] Game is in scoring state, keeping user on game page:', gameIdFromHash);
                                                    return updatedUsersMap;
                                                }
                                                
                                                const postGameRedirect = sessionStorage.getItem('postGameRedirect');
                                                if (postGameRedirect) {
                                                    console.log('[WebSocket] Current user status updated to waiting, routing to postGameRedirect:', postGameRedirect);
                                                    sessionStorage.removeItem('postGameRedirect');
                                                    setTimeout(() => {
                                                        window.location.hash = postGameRedirect;
                                                    }, 100);
                                                } else {
                                                    const mode = currentUserStatus.mode;
                                                    if (!mode && (currentUserStatus.status === UserStatus.Waiting || currentUserStatus.status === UserStatus.Resting)) {
                                                        console.log('[WebSocket] Current user status updated to waiting without mode (likely in strategic/playful lobby)');
                                                    } else if (mode) {
                                                        console.warn('[WebSocket] Individual game mode detected, redirecting to profile:', mode);
                                                        setTimeout(() => {
                                                            window.location.hash = '#/profile';
                                                        }, 100);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                return updatedUsersMap;
                            });
                            return;
                        }
                        case 'WAITING_ROOM_CHAT_UPDATE': {
                            setWaitingRoomChats(currentChats => {
                                const updatedChats = { ...currentChats };
                                Object.entries(message.payload || {}).forEach(([channel, messages]: [string, any]) => {
                                    updatedChats[channel] = messages;
                                });
                                return updatedChats;
                            });
                            return;
                        }
                        case 'GAME_CHAT_UPDATE': {
                            setGameChats(currentChats => {
                                const updatedChats = { ...currentChats };
                                Object.entries(message.payload || {}).forEach(([gameId, messages]: [string, any]) => {
                                    updatedChats[gameId] = messages;
                                });
                                return updatedChats;
                            });
                            return;
                        }
                        case 'GAME_UPDATE': {
                            Object.entries(message.payload || {}).forEach(([gameId, game]: [string, any]) => {
                                // 성능 최적화: GAME_UPDATE 메시지 쓰로틀링 (같은 게임에 대해 최대 100ms당 1회만 처리)
                                const now = Date.now();
                                const lastUpdateTime = lastGameUpdateTimeRef.current[gameId] || 0;
                                if (now - lastUpdateTime < GAME_UPDATE_THROTTLE_MS) {
                                    // 쓰로틀링: 이전 업데이트로부터 100ms가 지나지 않았으면 무시
                                    return;
                                }
                                lastGameUpdateTimeRef.current[gameId] = now;
                                
                                const gameCategory = game.gameCategory || (game.isSinglePlayer ? 'singleplayer' : 'normal');
                                
                                // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                if (process.env.NODE_ENV === 'development') {
                                    console.log('[WebSocket] GAME_UPDATE received:', { gameId, gameCategory, gameStatus: game.gameStatus, isSinglePlayer: game.isSinglePlayer });
                                }

                                if (gameCategory === 'singleplayer') {
                                    setSinglePlayerGames(currentGames => {
                                        // 성능 최적화: 게임 상태가 변경되지 않았으면 early return
                                        const existingGame = currentGames[gameId];
                                        
                                        // 중요한 필드만 비교하여 빠른 early return (stableStringify 호출 전에)
                                        if (existingGame) {
                                            const keyFieldsChanged = 
                                                existingGame.gameStatus !== game.gameStatus ||
                                                existingGame.currentPlayer !== game.currentPlayer ||
                                                existingGame.serverRevision !== game.serverRevision ||
                                                (game.animation && existingGame.animation?.type !== game.animation?.type);
                                            
                                            // 중요한 필드가 변경되지 않았을 때만 서명 비교 (비용이 큰 작업)
                                            if (!keyFieldsChanged) {
                                                const previousSignature = singlePlayerGameSignaturesRef.current[gameId];
                                                // 서명이 이미 저장되어 있고, 중요한 필드가 변경되지 않았으면 서명 비교 생략 가능
                                                // 하지만 안전을 위해 서명 비교 수행 (중요 필드 외의 변경 감지)
                                                const signature = stableStringify(game);
                                                if (previousSignature === signature) {
                                                    return currentGames; // 완전히 동일한 상태
                                                }
                                                singlePlayerGameSignaturesRef.current[gameId] = signature;
                                            } else {
                                                // 중요한 필드가 변경되었으므로 서명 업데이트 (한 번만 호출)
                                                singlePlayerGameSignaturesRef.current[gameId] = stableStringify(game);
                                            }
                                        } else {
                                            // 새 게임이므로 서명 저장 (한 번만 호출)
                                            singlePlayerGameSignaturesRef.current[gameId] = stableStringify(game);
                                        }
                                        const updatedGames = { ...currentGames };
                                        
                                        // scoring 상태인 경우 기존 게임의 boardState와 moveHistory 무조건 보존
                                        if (game.gameStatus === 'scoring') {
                                            if (existingGame) {
                                                // scoring 상태에서는 기존 게임의 boardState와 moveHistory를 절대 덮어쓰지 않음
                                                // 기존 게임의 boardState와 moveHistory가 유효한지 확인
                                                const existingBoardStateValid = existingGame.boardState && 
                                                    Array.isArray(existingGame.boardState) && 
                                                    existingGame.boardState.length > 0 && 
                                                    existingGame.boardState[0] && 
                                                    Array.isArray(existingGame.boardState[0]) && 
                                                    existingGame.boardState[0].length > 0;
                                                
                                                const existingMoveHistoryValid = existingGame.moveHistory && 
                                                    Array.isArray(existingGame.moveHistory) && 
                                                    existingGame.moveHistory.length > 0;
                                                
                                                // 기존 boardState에 실제 돌이 있는지 확인
                                                const existingBoardStateHasStones = existingBoardStateValid && existingGame.boardState.some((row: any[]) => 
                                                    row && Array.isArray(row) && row.some((cell: any) => cell !== 0 && cell !== null && cell !== undefined)
                                                );
                                                
                                                // scoring 상태에서는 기존 boardState를 절대 덮어쓰지 않음 (돌이 있으면 무조건 유지)
                                                // 서버에서 보낸 boardState가 유효하면 사용, 아니면 기존 것 사용
                                                const serverBoardStateValid = game.boardState && 
                                                    Array.isArray(game.boardState) && 
                                                    game.boardState.length > 0 && 
                                                    game.boardState[0] && 
                                                    Array.isArray(game.boardState[0]) && 
                                                    game.boardState[0].length > 0 &&
                                                    game.boardState.some((row: any[]) => 
                                                        row && Array.isArray(row) && row.some((cell: any) => cell !== 0 && cell !== null && cell !== undefined)
                                                    );
                                                
                                                // scoring 상태에서는 기존 boardState를 절대 덮어쓰지 않음
                                                // 서버에서 보낸 boardState가 유효하고 돌이 있으면 사용, 아니면 기존 것 사용
                                                const finalBoardState = (serverBoardStateValid && existingBoardStateHasStones)
                                                    ? game.boardState
                                                    : ((existingBoardStateValid && existingBoardStateHasStones)
                                                        ? existingGame.boardState 
                                                        : (existingBoardStateValid ? existingGame.boardState : (serverBoardStateValid ? game.boardState : existingGame.boardState)));
                                                
                                                // 서버에서 보낸 moveHistory가 유효하면 사용, 아니면 기존 것 사용
                                                const serverMoveHistoryValid = game.moveHistory && 
                                                    Array.isArray(game.moveHistory) && 
                                                    game.moveHistory.length > 0;
                                                
                                                const finalMoveHistory = serverMoveHistoryValid
                                                    ? game.moveHistory
                                                    : (existingMoveHistoryValid 
                                                        ? existingGame.moveHistory 
                                                        : (game.moveHistory && Array.isArray(game.moveHistory) && game.moveHistory.length > 0 ? game.moveHistory : existingGame.moveHistory));
                                                
                                                // totalTurns도 보존
                                                const finalTotalTurns = (game.totalTurns !== undefined && game.totalTurns !== null)
                                                    ? game.totalTurns
                                                    : (existingGame.totalTurns !== undefined && existingGame.totalTurns !== null ? existingGame.totalTurns : game.totalTurns);
                                                
                                                // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                if (process.env.NODE_ENV === 'development') {
                                                    console.log(`[WebSocket][SinglePlayer] Scoring state: preserving state - boardState (serverValid=${serverBoardStateValid}, existingValid=${existingBoardStateValid}, hasStones=${existingBoardStateHasStones}, size=${finalBoardState?.length || 0}), moveHistory (serverValid=${serverMoveHistoryValid}, existingValid=${existingMoveHistoryValid}, length=${finalMoveHistory?.length || 0}), totalTurns=${finalTotalTurns}`);
                                                }
                                                
                                                const preservedGame = {
                                                    ...game,
                                                    // boardState, moveHistory, totalTurns는 서버에서 온 값이 유효하면 사용, 아니면 기존 것 사용
                                                    boardState: finalBoardState,
                                                    moveHistory: finalMoveHistory,
                                                    totalTurns: finalTotalTurns,
                                                    // 시간 정보도 서버에서 온 값이 유효하면 사용, 아니면 기존 것 사용
                                                    blackTimeLeft: (game.blackTimeLeft !== undefined && game.blackTimeLeft !== null && game.blackTimeLeft > 0) 
                                                        ? game.blackTimeLeft 
                                                        : (existingGame.blackTimeLeft !== undefined && existingGame.blackTimeLeft !== null ? existingGame.blackTimeLeft : game.blackTimeLeft),
                                                    whiteTimeLeft: (game.whiteTimeLeft !== undefined && game.whiteTimeLeft !== null && game.whiteTimeLeft > 0) 
                                                        ? game.whiteTimeLeft 
                                                        : (existingGame.whiteTimeLeft !== undefined && existingGame.whiteTimeLeft !== null ? existingGame.whiteTimeLeft : game.whiteTimeLeft),
                                                };
                                                updatedGames[gameId] = preservedGame;
                                            } else {
                                                updatedGames[gameId] = game;
                                            }
                                        } else {
                                            // hidden_placing, scanning 등 아이템 모드에서는 boardState를 보존해야 함
                                            const isItemMode = ['hidden_placing', 'scanning', 'missile_selecting', 'missile_animating', 'scanning_animating'].includes(game.gameStatus);
                                            
                                            // 애니메이션 중에는 totalTurns와 captures를 보존해야 함
                                            const isAnimating = game.animation !== null && game.animation !== undefined;
                                            
                                            // totalTurns와 captures 보존 (애니메이션 중 초기화 방지)
                                            const preservedTotalTurns = existingGame?.totalTurns !== undefined && existingGame?.totalTurns !== null
                                                ? existingGame.totalTurns
                                                : (game.totalTurns !== undefined && game.totalTurns !== null ? game.totalTurns : undefined);
                                            
                                            const preservedCaptures = existingGame?.captures && 
                                                typeof existingGame.captures === 'object' &&
                                                Object.keys(existingGame.captures).length > 0
                                                ? existingGame.captures
                                                : (game.captures && typeof game.captures === 'object' && Object.keys(game.captures).length > 0
                                                    ? game.captures
                                                    : existingGame?.captures || game.captures || { [Player.None]: 0, [Player.Black]: 0, [Player.White]: 0 });
                                            
                                            if (isItemMode) {
                                                // 아이템 모드에서는 기존 boardState를 보존
                                                const existingBoardStateValid = existingGame?.boardState && 
                                                    Array.isArray(existingGame.boardState) && 
                                                    existingGame.boardState.length > 0 && 
                                                    existingGame.boardState[0] && 
                                                    Array.isArray(existingGame.boardState[0]) && 
                                                    existingGame.boardState[0].length > 0;
                                                
                                                const serverBoardStateValid = game.boardState && 
                                                    Array.isArray(game.boardState) && 
                                                    game.boardState.length > 0 && 
                                                    game.boardState[0] && 
                                                    Array.isArray(game.boardState[0]) && 
                                                    game.boardState[0].length > 0;
                                                
                                                // 기존 boardState가 유효하면 보존, 아니면 서버에서 온 것 사용
                                                const finalBoardState = existingBoardStateValid
                                                    ? existingGame.boardState
                                                    : (serverBoardStateValid ? game.boardState : existingGame?.boardState);
                                                
                                                // moveHistory도 보존
                                                const existingMoveHistoryValid = existingGame?.moveHistory && 
                                                    Array.isArray(existingGame.moveHistory) && 
                                                    existingGame.moveHistory.length > 0;
                                                
                                                const serverMoveHistoryValid = game.moveHistory && 
                                                    Array.isArray(game.moveHistory) && 
                                                    game.moveHistory.length > 0;
                                                
                                                const finalMoveHistory = existingMoveHistoryValid
                                                    ? existingGame.moveHistory
                                                    : (serverMoveHistoryValid ? game.moveHistory : existingGame?.moveHistory);
                                                
                                                updatedGames[gameId] = {
                                                    ...game,
                                                    boardState: finalBoardState,
                                                    moveHistory: finalMoveHistory,
                                                    // totalTurns와 captures 보존 (애니메이션 중 초기화 방지)
                                                    totalTurns: preservedTotalTurns,
                                                    captures: preservedCaptures,
                                                    // 시간 정보도 보존
                                                    blackTimeLeft: (game.blackTimeLeft !== undefined && game.blackTimeLeft !== null && game.blackTimeLeft > 0) 
                                                        ? game.blackTimeLeft 
                                                        : (existingGame?.blackTimeLeft !== undefined && existingGame?.blackTimeLeft !== null ? existingGame.blackTimeLeft : game.blackTimeLeft),
                                                    whiteTimeLeft: (game.whiteTimeLeft !== undefined && game.whiteTimeLeft !== null && game.whiteTimeLeft > 0) 
                                                        ? game.whiteTimeLeft 
                                                        : (existingGame?.whiteTimeLeft !== undefined && existingGame?.whiteTimeLeft !== null ? existingGame.whiteTimeLeft : game.whiteTimeLeft),
                                                };
                                            } else if (game.gameStatus === 'playing' && (game.stageId || (game.settings as any)?.autoScoringTurns)) {
                                                // GAME_UPDATE를 받았을 때 자동계가 체크 (AI 수를 둔 경우 등)
                                                try {
                                                    const autoScoringTurns = game.isSinglePlayer && game.stageId
                                                        ? SINGLE_PLAYER_STAGES.find((s: any) => s.id === game.stageId)?.autoScoringTurns
                                                        : (game.settings as any)?.autoScoringTurns;
                                                    
                                                    if (autoScoringTurns) {
                                                        // totalTurns가 없으면 moveHistory에서 계산 (항상 최신 상태로 업데이트)
                                                        const validMoves = (game.moveHistory || []).filter((m: any) => m.x !== -1 && m.y !== -1);
                                                        let totalTurns = game.totalTurns;
                                                        if (totalTurns === undefined || totalTurns === null || totalTurns < validMoves.length) {
                                                            // totalTurns가 없거나 moveHistory보다 작으면 moveHistory에서 계산
                                                            totalTurns = validMoves.length;
                                                        }
                                                        
                                                        // totalTurns를 게임 상태에 반영
                                                        if (totalTurns !== undefined && totalTurns !== null) {
                                                            game.totalTurns = totalTurns;
                                                        }
                                                        
                                                        if (totalTurns !== undefined && totalTurns >= autoScoringTurns) {
                                                        // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                        if (process.env.NODE_ENV === 'development') {
                                                            const gameTypeLabel = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                                                            console.log(`[WebSocket][${gameTypeLabel}] Auto-scoring triggered from GAME_UPDATE at ${totalTurns} turns (stageId: ${game.stageId || 'N/A'}) - IMMEDIATELY FREEZING GAME`);
                                                        }
                                                        
                                                        // 즉시 게임 상태를 scoring으로 변경하여 게임 초기화 방지
                                                        const preservedBoardState = game.boardState && game.boardState.length > 0
                                                            ? game.boardState
                                                            : (existingGame?.boardState || game.boardState);
                                                        const preservedMoveHistory = game.moveHistory && game.moveHistory.length > 0
                                                            ? game.moveHistory
                                                            : (existingGame?.moveHistory || game.moveHistory);
                                                        const preservedTotalTurns = totalTurns;
                                                        const preservedBlackTimeLeft = game.blackTimeLeft ?? existingGame?.blackTimeLeft;
                                                        const preservedWhiteTimeLeft = game.whiteTimeLeft ?? existingGame?.whiteTimeLeft;
                                                        
                                                        // 게임 상태를 즉시 scoring으로 변경
                                                        updatedGames[gameId] = {
                                                            ...game,
                                                            gameStatus: 'scoring' as const,
                                                            boardState: preservedBoardState,
                                                            moveHistory: preservedMoveHistory,
                                                            totalTurns: preservedTotalTurns,
                                                            blackTimeLeft: preservedBlackTimeLeft,
                                                            whiteTimeLeft: preservedWhiteTimeLeft,
                                                        };
                                                        
                                                        // 서버에 자동 계가 트리거 요청 전송
                                                        const autoScoringAction = {
                                                            type: 'PLACE_STONE',
                                                            payload: {
                                                                gameId,
                                                                x: -1,
                                                                y: -1,
                                                                totalTurns: preservedTotalTurns,
                                                                moveHistory: preservedMoveHistory,
                                                                boardState: preservedBoardState,
                                                                blackTimeLeft: preservedBlackTimeLeft,
                                                                whiteTimeLeft: preservedWhiteTimeLeft,
                                                                triggerAutoScoring: true
                                                            }
                                                        } as any;
                                                        
                                                        // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                        if (process.env.NODE_ENV === 'development') {
                                                            console.log(`[WebSocket][SinglePlayer] Sending auto-scoring action to server: totalTurns=${preservedTotalTurns}, moveHistoryLength=${preservedMoveHistory?.length || 0}`);
                                                        }
                                                        handleAction(autoScoringAction).then(result => {
                                                            // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                            if (process.env.NODE_ENV === 'development') {
                                                                console.log(`[WebSocket][SinglePlayer] Auto-scoring action sent successfully:`, result);
                                                            }
                                                        }).catch(err => {
                                                            console.error(`[WebSocket][SinglePlayer] Failed to trigger auto-scoring on server:`, err);
                                                        });
                                                        }
                                                    }
                                                } catch (err) {
                                                    console.error(`[WebSocket][SinglePlayer] Failed to check auto-scoring from GAME_UPDATE:`, err);
                                                }
                                            } else {
                                                // 일반 상태에서는 서버에서 온 게임 상태 사용
                                                // 애니메이션 중이거나 기존 게임이 있으면 totalTurns와 captures 보존
                                                if (isAnimating || existingGame) {
                                                    updatedGames[gameId] = {
                                                        ...game,
                                                        totalTurns: preservedTotalTurns !== undefined ? preservedTotalTurns : game.totalTurns,
                                                        captures: preservedCaptures
                                                    };
                                                } else {
                                                    updatedGames[gameId] = game;
                                                }
                                            }
                                        }
                                const lastMoves = Array.isArray(game.moveHistory)
                                    ? game.moveHistory.slice(Math.max(0, game.moveHistory.length - 4)).map((m: any) => ({
                                        x: m?.x,
                                        y: m?.y,
                                        player: m?.player,
                                    }))
                                    : null;
                                const boardSnapshot = Array.isArray(game.boardState)
                                    ? game.boardState.map((row: any[]) => row?.join?.('') ?? row).slice(0, 3)
                                    : undefined;
                                console.debug('[WebSocket][SinglePlayer] GAME_UPDATE', {
                                    gameId,
                                    stageId: game.stageId,
                                    serverRevision: game.serverRevision,
                                    moveHistoryLength: Array.isArray(game.moveHistory) ? game.moveHistory.length : undefined,
                                    currentPlayer: game.currentPlayer,
                                    gameStatus: game.gameStatus,
                                    lastMove: game.lastMove,
                                    lastMoves,
                                    boardSample: boardSnapshot,
                                });

                                        if (currentUser && game.player1 && game.player2) {
                                            const isPlayer1 = game.player1.id === currentUser.id;
                                            const isPlayer2 = game.player2.id === currentUser.id;
                                            const currentStatus = currentUserStatusRef.current;
                                            const isActiveForGame = !!currentStatus &&
                                                (currentStatus.gameId === gameId || currentStatus.spectatingGameId === gameId) &&
                                                (currentStatus.status === 'in-game' || currentStatus.status === 'spectating');

                                            if ((isPlayer1 || isPlayer2) && isActiveForGame) {
                                                const targetHash = `#/game/${gameId}`;
                                                if (window.location.hash !== targetHash) {
                                                    // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                    if (process.env.NODE_ENV === 'development') {
                                                        console.log('[WebSocket] Routing to single player game:', gameId);
                                                    }
                                                    setTimeout(() => {
                                                        if (window.location.hash !== targetHash) {
                                                            window.location.hash = targetHash;
                                                        }
                                                    }, 100);
                                                }
                                            }
                                        }
                                        return updatedGames;
                                    });
                                } else if (gameCategory === 'tower') {
                                    setTowerGames(currentGames => {
                                        const existingGame = currentGames[gameId];
                                        
                                        // 타워 게임은 클라이언트에서만 실행되므로, 
                                        // 클라이언트의 로컬 상태가 더 최신이면 서버 상태를 무시
                                        if (existingGame) {
                                            const localMoveHistoryLength = existingGame.moveHistory?.length || 0;
                                            const serverMoveHistoryLength = game.moveHistory?.length || 0;
                                            const localServerRevision = existingGame.serverRevision || 0;
                                            const serverRevision = game.serverRevision || 0;
                                            
                                            // 클라이언트가 더 많은 수를 두었거나, 같은 수를 두었지만 클라이언트의 serverRevision이 더 크면 무시
                                            if (localMoveHistoryLength > serverMoveHistoryLength || 
                                                (localMoveHistoryLength === serverMoveHistoryLength && localServerRevision >= serverRevision)) {
                                                // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                if (process.env.NODE_ENV === 'development') {
                                                    console.log('[WebSocket] Tower game - Ignoring server update (client state is newer):', {
                                                        gameId,
                                                        localMoveHistoryLength,
                                                        serverMoveHistoryLength,
                                                        localServerRevision,
                                                        serverRevision
                                                    });
                                                }
                                                return currentGames;
                                            }
                                            
                                            // 중요한 필드만 비교하여 빠른 early return (stableStringify 호출 전에)
                                            const keyFieldsChanged = 
                                                existingGame.gameStatus !== game.gameStatus ||
                                                existingGame.currentPlayer !== game.currentPlayer ||
                                                existingGame.serverRevision !== game.serverRevision ||
                                                (game.animation && existingGame.animation?.type !== game.animation?.type);
                                            
                                            // 중요한 필드가 변경되지 않았을 때만 서명 비교
                                            if (!keyFieldsChanged) {
                                                const previousSignature = towerGameSignaturesRef.current[gameId];
                                                if (previousSignature) {
                                                    // 서명 비교는 비용이 큰 작업이므로 필요한 경우에만 수행
                                                    const signature = stableStringify(game);
                                                    if (previousSignature === signature) {
                                                        return currentGames; // 완전히 동일한 상태
                                                    }
                                                    towerGameSignaturesRef.current[gameId] = signature;
                                                } else {
                                                    towerGameSignaturesRef.current[gameId] = stableStringify(game);
                                                }
                                            } else {
                                                // 중요한 필드가 변경되었으므로 서명 업데이트
                                                towerGameSignaturesRef.current[gameId] = stableStringify(game);
                                            }
                                        } else {
                                            // 새 게임이므로 서명 저장
                                            towerGameSignaturesRef.current[gameId] = stableStringify(game);
                                        }
                                        
                                        // 서명 비교는 이미 위에서 수행했으므로 여기서는 바로 업데이트
                                        const updatedGames = { ...currentGames };
                                        updatedGames[gameId] = game;

                                        if (currentUser && game.player1 && game.player2) {
                                            const isPlayer1 = game.player1.id === currentUser.id;
                                            const isPlayer2 = game.player2.id === currentUser.id;
                                            const currentStatus = currentUserStatusRef.current;
                                            const isActiveForGame = !!currentStatus &&
                                                (currentStatus.gameId === gameId || currentStatus.spectatingGameId === gameId) &&
                                                (currentStatus.status === 'in-game' || currentStatus.status === 'spectating');

                                            if ((isPlayer1 || isPlayer2) && isActiveForGame) {
                                                const targetHash = `#/game/${gameId}`;
                                                if (window.location.hash !== targetHash) {
                                                    // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                    if (process.env.NODE_ENV === 'development') {
                                                        console.log('[WebSocket] Routing to tower game:', gameId);
                                                    }
                                                    setTimeout(() => {
                                                        if (window.location.hash !== targetHash) {
                                                            window.location.hash = targetHash;
                                                        }
                                                    }, 100);
                                                }
                                            }
                                        }
                                        return updatedGames;
                                    });
                                } else {
                                    setLiveGames(currentGames => {
                                        const signature = stableStringify(game);
                                        const previousSignature = liveGameSignaturesRef.current[gameId];
                                        if (previousSignature === signature) {
                                            return currentGames;
                                        }
                                        liveGameSignaturesRef.current[gameId] = signature;
                                        const updatedGames = { ...currentGames };
                                        updatedGames[gameId] = game;

                                        if (currentUser && game.player1 && game.player2) {
                                            const isPlayer1 = game.player1.id === currentUser.id;
                                            const isPlayer2 = game.player2.id === currentUser.id;
                                            const currentStatus = currentUserStatusRef.current;
                                            const isActiveForGame = !!currentStatus &&
                                                (currentStatus.gameId === gameId || currentStatus.spectatingGameId === gameId) &&
                                                (currentStatus.status === 'in-game' || currentStatus.status === 'spectating');

                                            if ((isPlayer1 || isPlayer2) && isActiveForGame) {
                                                const targetHash = `#/game/${gameId}`;
                                                if (window.location.hash !== targetHash) {
                                                    // 성능 최적화: 불필요한 로깅 제거 (프로덕션)
                                                    if (process.env.NODE_ENV === 'development') {
                                                        console.log('[WebSocket] Routing to game:', gameId);
                                                    }
                                                    setTimeout(() => {
                                                        if (window.location.hash !== targetHash) {
                                                            window.location.hash = targetHash;
                                                        }
                                                    }, 100);
                                                }
                                            }
                                        }
                                        return updatedGames;
                                    });
                                }
                            });
                            return;
                        }
                        case 'GAME_DELETED': {
                            const deletedGameId = message.payload?.gameId;
                            const serverGameCategory = message.payload?.gameCategory;
                            if (!deletedGameId) return;

                            const removeFromGames = (setter: any, signaturesRef: Record<string, string>) => {
                                setter((currentGames: Record<string, any>) => {
                                    if (!currentGames[deletedGameId]) return currentGames;
                                    const updatedGames = { ...currentGames };
                                    delete updatedGames[deletedGameId];
                                    delete signaturesRef[deletedGameId];
                                    return updatedGames;
                                });
                            };

                            if (serverGameCategory === 'singleplayer') {
                                removeFromGames(setSinglePlayerGames, singlePlayerGameSignaturesRef.current);
                            } else if (serverGameCategory === 'tower') {
                                removeFromGames(setTowerGames, towerGameSignaturesRef.current);
                            } else if (serverGameCategory === 'normal') {
                                removeFromGames(setLiveGames, liveGameSignaturesRef.current);
                            } else {
                                removeFromGames(setLiveGames, liveGameSignaturesRef.current);
                                removeFromGames(setSinglePlayerGames, singlePlayerGameSignaturesRef.current);
                                removeFromGames(setTowerGames, towerGameSignaturesRef.current);
                            }

                            if (serverGameCategory === 'singleplayer') {
                                const currentHash = window.location.hash;
                                const isGamePage = currentHash.startsWith('#/game/') && currentHash.includes(deletedGameId);
                                if (isGamePage) {
                                    const postGameRedirect = sessionStorage.getItem('postGameRedirect');
                                    if (postGameRedirect) {
                                        console.log('[WebSocket] Single player game deleted, routing to postGameRedirect:', postGameRedirect);
                                        sessionStorage.removeItem('postGameRedirect');
                                        setTimeout(() => {
                                            window.location.hash = postGameRedirect;
                                        }, 100);
                                    } else {
                                        console.log('[WebSocket] Single player game deleted, routing to singleplayer lobby');
                                        setTimeout(() => {
                                            window.location.hash = '#/singleplayer';
                                        }, 100);
                                    }
                                }
                            }
                            return;
                        }
                        case 'CHALLENGE_DECLINED': {
                            if (message.payload?.challengerId === currentUser?.id && message.payload?.declinedMessage) {
                                showError(message.payload.declinedMessage.message);
                            }
                            return;
                        }
                        case 'NEGOTIATION_UPDATE': {
                            if (message.payload?.negotiations) {
                                const updatedNegotiations = JSON.parse(JSON.stringify(message.payload.negotiations));
                                setNegotiations(updatedNegotiations);
                            }
                            if (message.payload?.userStatuses) {
                                setOnlineUsers(prevOnlineUsers => {
                                    const updatedStatuses = message.payload.userStatuses;
                                    return prevOnlineUsers.map(user => {
                                        const statusInfo = updatedStatuses[user.id];
                                        if (statusInfo) {
                                            return { ...user, ...statusInfo };
                                        }
                                        return user;
                                    });
                                });
                            }
                            return;
                        }
                        case 'ANNOUNCEMENT_UPDATE': {
                            const { announcements: anns, globalOverrideAnnouncement: override } = message.payload || {};
                            if (Array.isArray(anns)) setAnnouncements(anns);
                            if (override !== undefined) setGlobalOverrideAnnouncement(override);
                            return;
                        }
                        case 'GAME_MODE_AVAILABILITY_UPDATE': {
                            const { gameModeAvailability: availability } = message.payload || {};
                            if (availability) setGameModeAvailability(availability);
                            return;
                        }
                        case 'HOME_BOARD_POSTS_UPDATE': {
                            const { homeBoardPosts: posts } = message.payload || {};
                            if (Array.isArray(posts)) setHomeBoardPosts(posts);
                            return;
                        }
                        case 'TOURNAMENT_STATE_UPDATE': {
                            const { tournamentState, tournamentType } = message.payload || {};
                            if (currentUserRef.current && tournamentState) {
                                setUsersMap(prev => ({
                                    ...prev,
                                    [currentUserRef.current!.id]: {
                                        ...prev[currentUserRef.current!.id],
                                        [`last${tournamentType.charAt(0).toUpperCase() + tournamentType.slice(1)}Tournament`]: tournamentState
                                    }
                                }));
                            }
                            return;
                        }
                        case 'GUILD_UPDATE': {
                            const { guilds: updatedGuilds } = message.payload || {};
                            if (updatedGuilds && typeof updatedGuilds === 'object') {
                                setGuilds(prev => ({ ...prev, ...updatedGuilds }));
                            }
                            return;
                        }
                        case 'GUILD_MESSAGE': {
                            // Guild message is sent to specific users via sendToUser
                            // Components should handle this in their own message handlers
                            return;
                        }
                        case 'GUILD_MISSION_UPDATE': {
                            // Guild mission update is sent to specific users via sendToUser
                            // Components should handle this in their own message handlers
                            return;
                        }
                        case 'GUILD_WAR_UPDATE': {
                            // Guild war update is sent to specific users via sendToUser
                            // Components should handle this in their own message handlers
                            return;
                        }
                        case 'ERROR': {
                            console.error('[WebSocket] Error message:', message.payload?.message || 'Unknown error');
                            return;
                        }
                        default: {
                            // broadcast({ guilds }) 형태의 메시지도 처리 (타입이 없는 경우)
                            if ((message as any).guilds && typeof (message as any).guilds === 'object') {
                                setGuilds(prev => ({ ...prev, ...(message as any).guilds }));
                            }
                            // payload.guilds가 있는 경우 처리
                            if (message.payload?.guilds && typeof message.payload.guilds === 'object') {
                                setGuilds(prev => ({ ...prev, ...message.payload.guilds }));
                            }
                            // 기존 default 처리 (이미 다른 case에서 처리되지 않은 경우)
                            if (message.type && !['USER_UPDATE', 'USER_STATUS_UPDATE', 'GAME_UPDATE', 'NEGOTIATION_UPDATE', 'CHAT_MESSAGE', 'WAITING_ROOM_CHAT', 'GAME_CHAT', 'TOURNAMENT_UPDATE', 'RANKED_MATCHING_UPDATE', 'RANKED_MATCH_FOUND', 'GUILD_UPDATE', 'GUILD_MESSAGE', 'GUILD_MISSION_UPDATE', 'GUILD_WAR_UPDATE', 'ERROR', 'INITIAL_STATE', 'INITIAL_STATE_START', 'INITIAL_STATE_CHUNK', 'CONNECTION_ESTABLISHED'].includes(message.type)) {
                                console.warn('[WebSocket] Unhandled message type:', message.type);
                            }
                            return;
                        }
                    }
                }

                ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        handleMessage(message);
                    } catch (error) {
                        console.error('[WebSocket] Error parsing message:', error);
                    }
                };

                ws.onerror = (error: Event) => {
                    // WebSocket 에러는 일반적으로 연결 문제를 나타내지만,
                    // 자동 재연결 로직이 처리하므로 사용자에게 보여줄 필요는 없음
                    // 개발 환경에서만 디버그 로그 출력
                    const isDevelopment = window.location.hostname === 'localhost' || 
                                         window.location.hostname === '127.0.0.1' ||
                                         window.location.hostname.includes('192.168');
                    
                    // WebSocket 상태 확인
                    const wsState = ws ? ws.readyState : -1;
                    const isConnectingError = wsState === WebSocket.CONNECTING || wsState === WebSocket.CLOSING;
                    
                    // 연결 중이거나 종료 중인 경우의 에러는 정상적인 흐름일 수 있음
                    if (isConnectingError) {
                        // 개발 환경에서만 조용히 로그 (console.debug는 개발자 도구에서 필터링 가능)
                        if (isDevelopment) {
                            console.debug('[WebSocket] Connection error during state transition (will reconnect automatically)');
                        }
                    } else {
                        // 개발 환경에서만 경고 로그
                        if (isDevelopment) {
                            console.debug('[WebSocket] Connection error detected (will attempt to reconnect)');
                        }
                    }
                    
                    // 에러 발생 시 연결 종료 처리
                    isConnecting = false;
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }
                    
                    // 연결이 CONNECTING 상태에서 실패한 경우
                    if (ws && ws.readyState === WebSocket.CONNECTING) {
                        // 연결을 명시적으로 닫음
                        try {
                            ws.close();
                        } catch (closeError) {
                            // 연결 종료 중 에러는 무시
                            if (isDevelopment) {
                                console.debug('[WebSocket] Error closing failed connection');
                            }
                        }
                    }
                    
                    // 에러 발생 시 재연결 시도 (의도적 종료가 아닌 경우)
                    if (!isIntentionalClose && shouldReconnect && currentUser) {
                        if (isDevelopment) {
                            console.debug('[WebSocket] Will attempt to reconnect in 3 seconds...');
                        }
                        if (reconnectTimeout) {
                            clearTimeout(reconnectTimeout);
                        }
                        reconnectTimeout = setTimeout(() => {
                            if (shouldReconnect && currentUser && !isConnecting) {
                                if (isDevelopment) {
                                    console.debug('[WebSocket] Attempting to reconnect after error...');
                                }
                                isIntentionalClose = false;
                                connectWebSocket();
                            }
                        }, 3000);
                    }
                };

                ws.onclose = (event) => {
                    isConnecting = false; // 연결 종료됨
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }
                    if (initialStateTimeout) {
                        clearTimeout(initialStateTimeout);
                        initialStateTimeout = null;
                    }
                    pendingMessages = [];
                    isInitialStateReady = true;
                    console.log('[WebSocket] Disconnected', {
                        code: event.code,
                        reason: event.reason,
                        wasClean: event.wasClean,
                        codeMeaning: getCloseCodeMeaning(event.code),
                        wasIntentional: isIntentionalClose
                    });
                    
                    // 1001 (Going Away)는 브라우저가 페이지를 떠날 때 발생할 수 있으므로
                    // 의도적인 종료가 아닌 경우에만 재연결
                    if (!isIntentionalClose && shouldReconnect && currentUser) {
                        // Reconnect after 3 seconds if not intentional close
                        console.log('[WebSocket] Will attempt to reconnect in 3 seconds...');
                        reconnectTimeout = setTimeout(() => {
                            if (shouldReconnect && currentUser && !isConnecting) {
                                console.log('[WebSocket] Attempting to reconnect...');
                                isIntentionalClose = false; // 재연결 시도는 의도적이지 않음
                                connectWebSocket();
                            }
                        }, 3000);
                    } else {
                        console.log('[WebSocket] Not reconnecting:', {
                            isIntentionalClose,
                            shouldReconnect,
                            hasCurrentUser: !!currentUser,
                            isConnecting
                        });
                    }
                };
            } catch (error) {
                isConnecting = false; // 연결 실패
                console.error('[WebSocket] Failed to create connection:', error);
                if (shouldReconnect && currentUser) {
                    reconnectTimeout = setTimeout(() => {
                        if (shouldReconnect && currentUser && !isConnecting) {
                            connectWebSocket();
                        }
                    }, 3000);
                }
            }
        };

        connectWebSocket();

        return () => {
            shouldReconnect = false;
            isIntentionalClose = true;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            if (initialStateTimeout) {
                clearTimeout(initialStateTimeout);
                initialStateTimeout = null;
            }
            pendingMessages = [];
            isInitialStateReady = true;
            if (ws) {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
                ws = null;
            }
        };
    }, [currentUser?.id]); // Only depend on currentUser.id to avoid unnecessary reconnections

    // --- Navigation Logic ---
    const initialRedirectHandled = useRef(false);
    useEffect(() => { currentRouteRef.current = currentRoute; }, [currentRoute]);
    
    useEffect(() => {
        const handleHashChange = () => {
            const prevRoute = currentRouteRef.current;
            const newRoute = parseHash(window.location.hash);
            const isExiting = (prevRoute.view === 'profile' && newRoute.view === 'login' && window.location.hash === '');
            
            if (isExiting && currentUser) {
                if (showExitToast) { handleLogout(); } 
                else {
                    setShowExitToast(true);
                    exitToastTimer.current = window.setTimeout(() => setShowExitToast(false), 2000);
                    window.history.pushState(null, '', '#/profile');
                    return;
                }
            } else {
                if (exitToastTimer.current) clearTimeout(exitToastTimer.current);
                if (showExitToast) setShowExitToast(false);
            }
            setCurrentRoute(newRoute);
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [currentUser, handleLogout, showExitToast]);

    useEffect(() => {
        if (!currentUser) {
            initialRedirectHandled.current = false;
            if (window.location.hash && window.location.hash !== '#/register') window.location.hash = '';
            return;
        }
        const currentHash = window.location.hash;
        
        if (!initialRedirectHandled.current) {
            initialRedirectHandled.current = true;
    
            if (currentHash === '' || currentHash === '#/') {
                if (activeGame) {
                    window.location.hash = `#/game/${activeGame.id}`;
                    return;
                }
                window.location.hash = '#/profile';
                return;
            }
        }
        
        const isGamePage = currentHash.startsWith('#/game/');

        if (activeGame && !isGamePage) {
            console.log('[useApp] Routing to game:', activeGame.id);
            window.location.hash = `#/game/${activeGame.id}`;
        } else if (!activeGame && isGamePage) {
            // AI 게임의 경우, 게임이 종료되어도 결과창을 확인할 수 있도록 게임 페이지에 머물 수 있음
            // 나가기 버튼을 통해 대기실로 이동할 수 있음
            const isAiGame = currentHash.startsWith('#/game/') && liveGames[currentHash.replace('#/game/', '')]?.isAiGame;
            if (!isAiGame) {
                let targetHash = '#/profile';
                if (currentUserWithStatus?.status === 'waiting' && currentUserWithStatus?.mode) {
                    targetHash = `#/waiting/${encodeURIComponent(currentUserWithStatus.mode)}`;
                }
                if (currentHash !== targetHash) {
                    window.location.hash = targetHash;
                }
            }
        }
    }, [currentUser, activeGame, currentUserWithStatus, liveGames]);
    
    // --- Misc UseEffects ---
    useEffect(() => {
        const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
        setVh();
        window.addEventListener('resize', setVh);
        window.addEventListener('orientationchange', setVh);
        return () => { window.removeEventListener('resize', setVh); window.removeEventListener('orientationchange', setVh); };
    }, []);

    useEffect(() => {
        if (enhancementResult) {
            const timer = setTimeout(() => {
                setEnhancementResult(null);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [enhancementResult]);

    const handleEnterWaitingRoom = (mode: GameMode) => {
        handleAction({ type: 'ENTER_WAITING_ROOM', payload: { mode } });
        window.location.hash = `#/waiting/${encodeURIComponent(mode)}`;
    };
    
    const handleViewUser = useCallback(async (userId: string) => {
        // 먼저 onlineUsers와 allUsers에서 찾기
        if (Array.isArray(onlineUsers) && Array.isArray(allUsers)) {
            const userToView = onlineUsers.find(u => u && u.id === userId) || allUsers.find(u => u && u.id === userId);
            if (userToView) {
                const statusInfo = onlineUsers.find(u => u && u.id === userId);
                setViewingUser({ ...userToView, ...(statusInfo || { status: UserStatus.Online }) });
                return;
            }
        }
        
        // 로컬에 없으면 서버에서 가져오기
        try {
            const response = await fetch(`/api/user/${userId}`);
            if (!response.ok) {
                console.error(`[handleViewUser] Failed to fetch user ${userId}: ${response.statusText}`);
                return;
            }
            const userData = await response.json();
            // 온라인 상태 확인
            const statusInfo = Array.isArray(onlineUsers) ? onlineUsers.find(u => u && u.id === userId) : null;
            setViewingUser({ 
                ...userData, 
                status: statusInfo?.status || UserStatus.Offline,
                equipment: {},
                inventory: []
            } as UserWithStatus);
        } catch (error) {
            console.error(`[handleViewUser] Error fetching user ${userId}:`, error);
        }
    }, [onlineUsers, allUsers]);

    const openModerationModal = useCallback((userId: string) => {
        if (!Array.isArray(onlineUsers) || !Array.isArray(allUsers)) return;
        const userToView = onlineUsers.find(u => u && u.id === userId) || allUsers.find(u => u && u.id === userId);
        if (userToView) {
            const statusInfo = onlineUsers.find(u => u && u.id === userId);
            setModeratingUser({ ...userToView, ...(statusInfo || { status: UserStatus.Online }) });
        }
    }, [onlineUsers, allUsers]);

    const closeModerationModal = useCallback(() => setModeratingUser(null), []);

    const setCurrentUserAndRoute = useCallback((user: User) => {
        const mergedUser = applyUserUpdate(user, 'setCurrentUserAndRoute');
        console.log('[setCurrentUserAndRoute] User set:', {
            id: mergedUser.id,
            inventoryLength: mergedUser.inventory?.length,
            equipmentSlots: Object.keys(mergedUser.equipment || {}).length,
            hasInventory: !!mergedUser.inventory,
            hasEquipment: !!mergedUser.equipment
        });
        window.location.hash = '#/profile';
    }, [applyUserUpdate]);
    
    const openEnhancingItem = useCallback((item: InventoryItem) => {
        setBlacksmithSelectedItemForEnhancement(item);
        setBlacksmithActiveTab('enhance');
        setIsBlacksmithModalOpen(true);
    }, []);

    const openEnhancementFromDetail = useCallback((item: InventoryItem) => {
        setBlacksmithSelectedItemForEnhancement(item);
        setBlacksmithActiveTab('enhance');
        setIsBlacksmithModalOpen(true);
    }, []);

    const openViewingItem = useCallback((item: InventoryItem, isOwnedByCurrentUser: boolean) => {
        setViewingItem({ item, isOwnedByCurrentUser });
    }, []);

    const clearRefinementResult = useCallback(() => {
        setRefinementResult(null);
    }, []);

    const clearEnhancementOutcome = useCallback(() => {
        if (enhancementOutcome?.success) {
            const enhancedItem = enhancementOutcome.itemAfter;
            setViewingItem(currentItem => {
                if (currentItem && enhancedItem && currentItem.item.id === enhancedItem.id) {
                    return { ...currentItem, item: enhancedItem };
                }
                return currentItem;
            });
            const snapshot = currentUserRef.current;
            if (snapshot && Array.isArray(snapshot.inventory)) {
                const nextInventory = snapshot.inventory.map(invItem =>
                        invItem.id === enhancedItem.id ? enhancedItem : invItem
                );
                flushSync(() => {
                    applyUserUpdate({ inventory: nextInventory }, 'clearEnhancementOutcome');
                });
            }
        }
        setEnhancementOutcome(null);
    }, [enhancementOutcome, applyUserUpdate]);
    
    const closeEnhancementModal = useCallback(() => {
        setIsEnhancementResultModalOpen(false);
        setEnhancementOutcome(null);
    }, []);

    const startEnhancement = useCallback((item: InventoryItem) => {
        // 제련 시작 시 즉시 모달을 열고 롤링 애니메이션을 위한 임시 결과 설정
        const tempItemAfter = JSON.parse(JSON.stringify(item));
        // 임시 결과: 성공/실패는 아직 모르므로 일단 성공으로 가정하고 롤링 애니메이션 표시
        // 별이 하나 증가한 상태로 표시 (실제 결과는 서버 응답에서 업데이트됨)
        if (tempItemAfter.stars < 10) {
            tempItemAfter.stars = tempItemAfter.stars + 1;
        }
        setEnhancementOutcome({
            message: '제련 중...',
            success: true, // 임시로 성공으로 설정 (실제 결과는 서버 응답에서 업데이트됨)
            itemBefore: JSON.parse(JSON.stringify(item)),
            itemAfter: tempItemAfter,
            isRolling: true, // 롤링 애니메이션 상태
        });
        setIsEnhancementResultModalOpen(true);
    }, []);

        const closeClaimAllSummary = useCallback(() => {
        setIsClaimAllSummaryOpen(false);
        setClaimAllSummary(null);
    }, []);

    const applyPreset = useCallback((preset: EquipmentPreset) => {
        handleAction({ type: 'APPLY_PRESET', payload: { presetName: preset.name, equipment: preset.equipment } });
    }, [handleAction]);

    const presets = useMemo(() => currentUser?.equipmentPresets || [], [currentUser?.equipmentPresets]);
    
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
    const [isGuildShopOpen, setIsGuildShopOpen] = useState(false);

    const {
        mainOptionBonuses,
        combatSubOptionBonuses,
        specialStatBonuses,
        aggregatedMythicStats,
    } = useMemo(() => {
        const initialBonuses = {
            mainOptionBonuses: {} as Record<CoreStat, { value: number; isPercentage: boolean }>,
            combatSubOptionBonuses: {} as Record<CoreStat, { value: number; isPercentage: boolean }>,
            specialStatBonuses: {} as Record<SpecialStat, { flat: number; percent: number }>,
            aggregatedMythicStats: {} as Record<MythicStat, { count: number, totalValue: number }>,
        };

        if (!currentUserWithStatus || !currentUserWithStatus.equipment || !currentUserWithStatus.inventory || !Array.isArray(currentUserWithStatus.inventory)) {
            return initialBonuses;
        }

        const equippedItems = currentUserWithStatus.inventory.filter(item =>
            item && currentUserWithStatus.equipment && Object.values(currentUserWithStatus.equipment).includes(item.id)
        );

        const aggregated = equippedItems.reduce((acc, item) => {
            if (!item.options) return acc;

            // Main Option
            if (item.options.main) {
                const type = item.options.main.type as CoreStat;
                if (!acc.mainOptionBonuses[type]) {
                    acc.mainOptionBonuses[type] = { value: 0, isPercentage: item.options.main.isPercentage };
                }
                acc.mainOptionBonuses[type].value += item.options.main.value;
            }

            // Combat Sub Options
            item.options.combatSubs.forEach(sub => {
                const type = sub.type as CoreStat;
                if (!acc.combatSubOptionBonuses[type]) {
                    acc.combatSubOptionBonuses[type] = { value: 0, isPercentage: sub.isPercentage };
                }
                acc.combatSubOptionBonuses[type].value += sub.value;
            });

            // Special Sub Options
            item.options.specialSubs.forEach(sub => {
                const type = sub.type as SpecialStat;
                if (!acc.specialStatBonuses[type]) {
                    acc.specialStatBonuses[type] = { flat: 0, percent: 0 };
                }
                if (sub.isPercentage) {
                    acc.specialStatBonuses[type].percent += sub.value;
                } else {
                    acc.specialStatBonuses[type].flat += sub.value;
                }
            });

            // Mythic Sub Options
            item.options.mythicSubs.forEach(sub => {
                const type = sub.type as MythicStat; // Cast to MythicStat
                if (!acc.aggregatedMythicStats[type]) {
                    acc.aggregatedMythicStats[type] = { count: 0, totalValue: 0 };
                }
                acc.aggregatedMythicStats[type].count++;
                acc.aggregatedMythicStats[type].totalValue += sub.value;
            });

            return acc;
        }, initialBonuses);

        return aggregated;
    }, [currentUserWithStatus]);

    return {
        currentUser,
        presets,
        setCurrentUserAndRoute,
        currentUserWithStatus,
        updateTrigger,
        currentRoute,
        error,
        allUsers,
        onlineUsers,
        liveGames,
        singlePlayerGames,
        towerGames,
        negotiations,
        waitingRoomChats,
        gameChats,
        adminLogs,
        gameModeAvailability,
        announcements,
        globalOverrideAnnouncement,
        announcementInterval,
        homeBoardPosts,
        activeGame,
        activeNegotiation,
        showExitToast,
        enhancementResult,
        enhancementOutcome,
        unreadMailCount,
        hasClaimableQuest,
        settings,
        updateTheme,
        updateSoundSetting,
        updateFeatureSetting,
        updatePanelColor,
        updateTextColor,
        updatePanelEdgeStyle,
        resetGraphicsToDefault,
        mainOptionBonuses,
        combatSubOptionBonuses,
        specialStatBonuses,
        aggregatedMythicStats,
        modals: {
            isSettingsModalOpen, isInventoryOpen, isMailboxOpen, isQuestsOpen, isShopOpen, shopInitialTab, lastUsedItemResult,
            disassemblyResult, craftResult, rewardSummary, viewingUser, isInfoModalOpen, isEncyclopediaOpen, isStatAllocationModalOpen, enhancementAnimationTarget,
            isGameRecordListOpen, viewingGameRecord,
            pastRankingsInfo, viewingItem, isProfileEditModalOpen, moderatingUser,
            isClaimAllSummaryOpen,
            claimAllSummary,
            isMbtiInfoModalOpen,
            isEquipmentEffectsModalOpen,
            isBlacksmithModalOpen,
            blacksmithSelectedItemForEnhancement,
            blacksmithActiveTab,
            combinationResult,
            isBlacksmithHelpOpen,
            enhancingItem,
            isEnhancementResultModalOpen,
            tournamentScoreChange,
            refinementResult,
        },
        handlers: {
            handleAction,
            handleLogout,
            handleEnterWaitingRoom,
            applyPreset,
            openSettingsModal: () => setIsSettingsModalOpen(true),
            closeSettingsModal: () => setIsSettingsModalOpen(false),
            openInventory: () => setIsInventoryOpen(true),
            closeInventory: () => setIsInventoryOpen(false),
            openMailbox: () => setIsMailboxOpen(true),
            closeMailbox: () => setIsMailboxOpen(false),
            openQuests: () => setIsQuestsOpen(true),
            closeQuests: () => setIsQuestsOpen(false),
            openShop: (tab?: 'equipment' | 'materials' | 'consumables' | 'misc') => {
                setShopInitialTab(tab);
                setIsShopOpen(true);
            },
            closeShop: () => {
                setIsShopOpen(false);
                setShopInitialTab(undefined);
            },
            closeItemObtained: () => {
                setLastUsedItemResult(null);
                setTournamentScoreChange(null);
            },
            closeDisassemblyResult: () => setDisassemblyResult(null),
            closeCraftResult: () => setCraftResult(null),
            closeCombinationResult: () => setCombinationResult(null),
            closeRewardSummary: () => setRewardSummary(null),
            closeClaimAllSummary,
            openViewingUser: handleViewUser,
            closeViewingUser: () => setViewingUser(null),
            openInfoModal: () => setIsInfoModalOpen(true),
            closeInfoModal: () => setIsInfoModalOpen(false),
            openEncyclopedia: () => setIsEncyclopediaOpen(true),
            closeEncyclopedia: () => setIsEncyclopediaOpen(false),
            openStatAllocationModal: () => setIsStatAllocationModalOpen(true),
            closeStatAllocationModal: () => setIsStatAllocationModalOpen(false),
            openProfileEditModal: () => setIsProfileEditModalOpen(true),
            closeProfileEditModal: () => setIsProfileEditModalOpen(false),
            openPastRankings: (info: { user: UserWithStatus; mode: GameMode | 'strategic' | 'playful'; }) => setPastRankingsInfo(info),
            closePastRankings: () => setPastRankingsInfo(null),
            openViewingItem,
            closeViewingItem: () => setViewingItem(null),
            openEnhancingItem,
            openEnhancementFromDetail,
            clearEnhancementOutcome,
            clearRefinementResult,
            clearEnhancementAnimation: () => setEnhancementAnimationTarget(null),
            openModerationModal,
            closeModerationModal,
            openMbtiInfoModal: () => setIsMbtiInfoModalOpen(true),
            closeMbtiInfoModal: () => setIsMbtiInfoModalOpen(false),
            openEquipmentEffectsModal: () => setIsEquipmentEffectsModalOpen(true),
            closeEquipmentEffectsModal: () => setIsEquipmentEffectsModalOpen(false),
            openBlacksmithModal: () => setIsBlacksmithModalOpen(true),
            closeBlacksmithModal: () => {
                setIsBlacksmithModalOpen(false);
                setBlacksmithSelectedItemForEnhancement(null);
                setBlacksmithActiveTab('enhance'); // Reset to default tab
            },
            openBlacksmithHelp: () => setIsBlacksmithHelpOpen(true),
            closeBlacksmithHelp: () => setIsBlacksmithHelpOpen(false),
            openGameRecordList: () => setIsGameRecordListOpen(true),
            closeGameRecordList: () => setIsGameRecordListOpen(false),
            openGameRecordViewer: (record: GameRecord) => setViewingGameRecord(record),
            closeGameRecordViewer: () => setViewingGameRecord(null),
            setBlacksmithActiveTab,
            closeEnhancementModal,
            openPresetModal: () => setIsPresetModalOpen(true),
            closePresetModal: () => setIsPresetModalOpen(false),
            openGuildShop: () => setIsGuildShopOpen(true),
            closeGuildShop: () => setIsGuildShopOpen(false),
        },
        guilds,
    };
};