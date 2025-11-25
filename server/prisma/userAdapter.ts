// @ts-nocheck
import type { Prisma } from "@prisma/client";
import type { User, InventoryItem, Equipment, Mail, QuestLog, EquipmentSlot } from "../../types/index.js";
import { createDefaultBaseStats, createDefaultSpentStatPoints, createDefaultQuests } from "../initialData.ts";
import { LeagueTier } from "../../types/enums.js";
import { SINGLE_PLAYER_STAGES } from "../../constants/singlePlayerConstants.js";
import { EQUIPMENT_POOL, MATERIAL_ITEMS, CONSUMABLE_ITEMS } from "../../constants/index.js";

const DEFAULT_INVENTORY_SLOTS: User["inventorySlots"] = {
  equipment: 30,
  consumable: 30,
  material: 30
};

const ALL_SINGLE_PLAYER_STAGE_IDS = SINGLE_PLAYER_STAGES.map((stage) => stage.id);
const MAX_SINGLE_PLAYER_PROGRESS = ALL_SINGLE_PLAYER_STAGE_IDS.length;

type SerializedUserStatus = {
  version?: number;
  serializedUser?: User;
  legacyRow?: Record<string, unknown>;
  baseStats?: Record<string, number>;
  spentStatPoints?: Record<string, number>;
  stats?: User["stats"];
  inventorySlots?: User["inventorySlots"];
  mannerScore?: number;
  lastActionPointUpdate?: number;
  chatBanUntil?: number | null;
  connectionBanUntil?: number | null;
  avatarId?: string | null;
  borderId?: string | null;
  ownedBorders?: string[];
  mannerMasteryApplied?: boolean;
  pendingPenaltyNotification?: string | null;
  inventoryRaw?: string | InventoryItem[];
  equipmentRaw?: string | Equipment;
  mailRaw?: string | Mail[];
  questsRaw?: string | QuestLog;
  actionPointMeta?: {
    actionPoints?: { current?: number; max?: number };
    purchasesToday?: number | null;
    lastPurchaseDate?: number | null;
  };
  store?: {
    dailyShopPurchases?: Record<string, { quantity: number; date: number }>;
    inventorySlotsMigrated?: boolean;
    equipmentPresets?: User["equipmentPresets"];
  };
  leagueMetadata?: {
    tournamentScore?: number;
    league?: string | null;
    previousSeasonTier?: string | null;
    seasonHistory?: Record<string, any>;
    weeklyCompetitors?: User["weeklyCompetitors"];
    lastWeeklyCompetitorsUpdate?: number | null;
    lastLeagueUpdate?: number | null;
    weeklyCompetitorsBotScores?: User["weeklyCompetitorsBotScores"];
    cumulativeTournamentScore?: number | null;
    lastNeighborhoodPlayedDate?: number | null;
    dailyNeighborhoodWins?: number | null;
    neighborhoodRewardClaimed?: boolean | null;
    lastNeighborhoodTournament?: unknown;
    lastNationalPlayedDate?: number | null;
    dailyNationalWins?: number | null;
    nationalRewardClaimed?: boolean | null;
    lastNationalTournament?: unknown;
    lastWorldPlayedDate?: number | null;
    dailyWorldWins?: number | null;
    worldRewardClaimed?: boolean | null;
    lastWorldTournament?: unknown;
  };
  personalProgress?: {
    singlePlayerProgress?: number | null;
    clearedSinglePlayerStages?: string[];
    bonusStatPoints?: number;
    singlePlayerMissions?: Record<string, any>;
    monthlyGoldBuffExpiresAt?: number | null;
    blacksmithLevel?: number;
    blacksmithXp?: number;
  };
  identity?: {
    username?: string;
    mbti?: string | null;
    isMbtiPublic?: boolean;
  };
  rejectedGameModes?: unknown;
  statResetCountToday?: number | null;
  lastStatResetDate?: string | null;
  cumulativeRankingScore?: Record<string, number>;
  inventorySlotsMigrated?: boolean;
  dailyRankings?: User["dailyRankings"];
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return structuredClone(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
};

const coalesce = <T>(...values: Array<T | null | undefined>): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const safeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
};

const safeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return fallback;
};

const ensureQuestLog = (value: unknown): QuestLog => {
  const parsed = parseJson<QuestLog>(value, createDefaultQuests());
  return {
    daily: {
      quests: Array.isArray(parsed.daily?.quests) ? parsed.daily?.quests : [],
      activityProgress: parsed.daily?.activityProgress ?? 0,
      claimedMilestones: parsed.daily?.claimedMilestones ?? [false, false, false, false, false],
      lastReset: parsed.daily?.lastReset ?? 0
    },
    weekly: {
      quests: Array.isArray(parsed.weekly?.quests) ? parsed.weekly?.quests : [],
      activityProgress: parsed.weekly?.activityProgress ?? 0,
      claimedMilestones: parsed.weekly?.claimedMilestones ?? [false, false, false, false, false],
      lastReset: parsed.weekly?.lastReset ?? 0
    },
    monthly: {
      quests: Array.isArray(parsed.monthly?.quests) ? parsed.monthly?.quests : [],
      activityProgress: parsed.monthly?.activityProgress ?? 0,
      claimedMilestones: parsed.monthly?.claimedMilestones ?? [false, false, false, false, false],
      lastReset: parsed.monthly?.lastReset ?? 0
    }
  };
};

const ensureInventorySlots = (value: unknown): User["inventorySlots"] => {
  const parsed = parseJson<User["inventorySlots"]>(value, DEFAULT_INVENTORY_SLOTS);
  return {
    equipment: parsed.equipment ?? DEFAULT_INVENTORY_SLOTS.equipment,
    consumable: parsed.consumable ?? DEFAULT_INVENTORY_SLOTS.consumable,
    material: parsed.material ?? DEFAULT_INVENTORY_SLOTS.material
  };
};

const ensureActionPoints = (
  meta: SerializedUserStatus["actionPointMeta"],
  fallbackCurr: number,
  fallbackMax: number
): User["actionPoints"] => {
  const source = meta?.actionPoints ?? {};
  return {
    current: source.current ?? fallbackCurr,
    max: source.max ?? fallbackMax
  };
};

const ensureWeeklyCompetitors = (value: unknown): User["weeklyCompetitors"] =>
  parseJson<User["weeklyCompetitors"]>(value, []);

const ensureSinglePlayerMissions = (status: SerializedUserStatus): User["singlePlayerMissions"] =>
  parseJson<Record<string, any>>(status.personalProgress?.singlePlayerMissions, {});

const ensureDailyRankings = (value: unknown): User["dailyRankings"] =>
  parseJson<User["dailyRankings"]>(value, {});

const ensureStats = (value: unknown): User["stats"] =>
  parseJson<User["stats"]>(value, {});

const ensureInventory = (value: unknown): InventoryItem[] =>
  parseJson<InventoryItem[]>(value, []);

const ensureEquipment = (value: unknown): Equipment =>
  parseJson<Equipment>(value, {});

const ensureMail = (value: unknown): Mail[] =>
  parseJson<Mail[]>(value, []);

// equipment와 inventory는 optional로 처리 (데이터베이스 연결 문제 시에도 작동하도록)
export type PrismaUserWithStatus = Prisma.UserGetPayload<{ include: { status: true; guildMember: true } }> & {
  equipment?: Array<{ slot: string; inventoryId: string | null }>;
  inventory?: Array<{
    id: string;
    templateId: string;
    quantity: number;
    slot: string | null;
    enhancementLvl: number;
    stars: number;
    rarity: string | null;
    metadata: any;
    isEquipped: boolean;
    createdAt: Date;
  }>;
};

const applyDefaults = (
  user: Partial<User>,
  prismaUser: PrismaUserWithStatus,
  status?: SerializedUserStatus
): User => {
  return {
    id: prismaUser.id,
    username:
      user.username ??
      prismaUser.username ??
      `user-${prismaUser.id.slice(-6)}`,
    nickname: user.nickname ?? prismaUser.nickname,
    isAdmin: user.isAdmin ?? prismaUser.isAdmin ?? false,
    strategyLevel: user.strategyLevel ?? prismaUser.strategyLevel ?? 1,
    strategyXp: user.strategyXp ?? prismaUser.strategyXp ?? 0,
    playfulLevel: user.playfulLevel ?? prismaUser.playfulLevel ?? 1,
    playfulXp: user.playfulXp ?? prismaUser.playfulXp ?? 0,
    baseStats: user.baseStats ?? createDefaultBaseStats(),
    spentStatPoints: user.spentStatPoints ?? createDefaultSpentStatPoints(),
    inventory:
      user.inventory ??
      status?.serializedUser?.inventory ??
      (inventoryFromTable.length > 0 ? inventoryFromTable : parseJson(prismaUser.inventory as any, [])),
    inventorySlots:
      user.inventorySlots ??
      status?.serializedUser?.inventorySlots ??
      parseJson(prismaUser.inventorySlots as any, DEFAULT_INVENTORY_SLOTS),
    equipment:
      user.equipment ??
      status?.serializedUser?.equipment ??
      (Object.keys(equipmentFromTable).length > 0 ? equipmentFromTable : parseJson(prismaUser.equipment as any, {})),
    equipmentPresets: user.equipmentPresets ?? (presetsFromStatus.length > 0 ? presetsFromStatus : []),
    actionPoints: user.actionPoints ?? {
      current: prismaUser.actionPointCurr ?? 0,
      max: prismaUser.actionPointMax ?? 0
    },
    lastActionPointUpdate: user.lastActionPointUpdate ?? Date.now(),
    actionPointPurchasesToday: user.actionPointPurchasesToday ?? 0,
    lastActionPointPurchaseDate: user.lastActionPointPurchaseDate ?? 0,
    dailyShopPurchases: user.dailyShopPurchases ?? {},
    gold: safeNumber(user.gold ?? prismaUser.gold ?? 0),
    diamonds: safeNumber(user.diamonds ?? prismaUser.diamonds ?? 0),
    mannerScore: user.mannerScore ?? 0,
    mail: user.mail ?? [],
    quests: user.quests ?? createDefaultQuests(),
    stats: user.stats ?? {},
    chatBanUntil: user.chatBanUntil ?? null,
    connectionBanUntil: user.connectionBanUntil ?? null,
    avatarId: user.avatarId ?? "profile_1",
    borderId: user.borderId ?? "default",
    ownedBorders: user.ownedBorders ?? ["default"],
    previousSeasonTier: user.previousSeasonTier ?? null,
    seasonHistory: user.seasonHistory ?? {},
    tournamentScore: user.tournamentScore ?? prismaUser.tournamentScore ?? 0,
    league: (user.league ?? (prismaUser.league as LeagueTier)) ?? LeagueTier.Sprout,
    mannerMasteryApplied: user.mannerMasteryApplied ?? false,
    pendingPenaltyNotification: user.pendingPenaltyNotification ?? null,
    lastNeighborhoodPlayedDate: user.lastNeighborhoodPlayedDate ?? null,
    dailyNeighborhoodWins: user.dailyNeighborhoodWins ?? 0,
    neighborhoodRewardClaimed: user.neighborhoodRewardClaimed ?? false,
    lastNeighborhoodTournament: user.lastNeighborhoodTournament ?? null,
    lastNationalPlayedDate: user.lastNationalPlayedDate ?? null,
    dailyNationalWins: user.dailyNationalWins ?? 0,
    nationalRewardClaimed: user.nationalRewardClaimed ?? false,
    lastNationalTournament: user.lastNationalTournament ?? null,
    lastWorldPlayedDate: user.lastWorldPlayedDate ?? null,
    dailyWorldWins: user.dailyWorldWins ?? 0,
    worldRewardClaimed: user.worldRewardClaimed ?? false,
    lastWorldTournament: user.lastWorldTournament ?? null,
    weeklyCompetitors: user.weeklyCompetitors ?? [],
    lastWeeklyCompetitorsUpdate: user.lastWeeklyCompetitorsUpdate ?? null,
    lastLeagueUpdate: user.lastLeagueUpdate ?? null,
    weeklyCompetitorsBotScores: user.weeklyCompetitorsBotScores ?? {},
    monthlyGoldBuffExpiresAt: user.monthlyGoldBuffExpiresAt ?? null,
    mbti: user.mbti ?? null,
    rejectedGameModes: user.rejectedGameModes ?? [],
    isMbtiPublic: user.isMbtiPublic ?? false,
    statResetCountToday: user.statResetCountToday ?? 0,
    lastStatResetDate: user.lastStatResetDate ?? null,
    singlePlayerProgress: user.singlePlayerProgress ?? 0,
    clearedSinglePlayerStages: user.clearedSinglePlayerStages ?? [],
    bonusStatPoints: user.bonusStatPoints ?? 0,
    singlePlayerMissions: user.singlePlayerMissions ?? {},
    guildId: user.guildId ?? undefined,
    blacksmithLevel: user.blacksmithLevel ?? 1,
    blacksmithXp: user.blacksmithXp ?? 0,
    cumulativeRankingScore: user.cumulativeRankingScore ?? {},
    cumulativeTournamentScore: (user.cumulativeTournamentScore != null ? user.cumulativeTournamentScore : 0),
    inventorySlotsMigrated: user.inventorySlotsMigrated ?? false,
    dailyRankings: user.dailyRankings ?? {}
  };
};

const ensureAdminSinglePlayerAccess = (user: User): User => {
  if (!user.isAdmin) {
    return user;
  }

  const originalStages = Array.isArray(user.clearedSinglePlayerStages)
    ? user.clearedSinglePlayerStages
    : [];
  const clearedStageSet = new Set<string>([...originalStages, ...ALL_SINGLE_PLAYER_STAGE_IDS]);

  const ensuredProgress =
    user.singlePlayerProgress != null
      ? Math.max(user.singlePlayerProgress, MAX_SINGLE_PLAYER_PROGRESS)
      : MAX_SINGLE_PLAYER_PROGRESS;

  return {
    ...user,
    clearedSinglePlayerStages: Array.from(clearedStageSet),
    singlePlayerProgress: ensuredProgress
  };
};

export function deserializeUser(prismaUser: PrismaUserWithStatus): User {
  const status = (prismaUser.status ?? {}) as SerializedUserStatus;
  
  // UserInventory 테이블에서 인벤토리 로드 (있을 경우만)
  const inventoryFromTable: InventoryItem[] = [];
  try {
    if (prismaUser.inventory && Array.isArray(prismaUser.inventory)) {
      for (const inv of prismaUser.inventory) {
        // templateId로 아이템 정보 찾기
        let itemInfo: any = null;
        if (inv.slot) {
          // 장비 아이템
          itemInfo = EQUIPMENT_POOL.find(p => p.name === inv.templateId);
        } else {
          // 재료 또는 소모품
          itemInfo = MATERIAL_ITEMS[inv.templateId] ||
                     CONSUMABLE_ITEMS.find(c => c.name === inv.templateId);
        }
        
        // UserInventory를 InventoryItem으로 변환
        const item: InventoryItem = {
          id: inv.id,
          name: itemInfo?.name || inv.templateId,
          description: itemInfo?.description || '',
          type: inv.slot ? 'equipment' : (itemInfo?.type || 'material'),
          slot: inv.slot as EquipmentSlot | null,
          quantity: inv.quantity,
          level: inv.enhancementLvl,
          isEquipped: inv.isEquipped,
          createdAt: inv.createdAt?.getTime ? inv.createdAt.getTime() : (typeof inv.createdAt === 'number' ? inv.createdAt : Date.now()),
          image: itemInfo?.image || '',
          grade: (inv.rarity as any) || itemInfo?.grade || 'Normal',
          stars: inv.stars,
          options: (inv.metadata as any)?.options || itemInfo?.options || [],
          enhancementFails: (inv.metadata as any)?.enhancementFails || 0,
          isDivineMythic: (inv.metadata as any)?.isDivineMythic || false
        };
        inventoryFromTable.push(item);
      }
    }
  } catch (e) {
    // inventory 로드 실패 시 무시 (기존 로직 사용)
  }
  
  // UserEquipment 테이블에서 장비 로드 (있을 경우만)
  const equipmentFromTable: Equipment = {};
  try {
    if (prismaUser.equipment && Array.isArray(prismaUser.equipment)) {
      for (const eq of prismaUser.equipment) {
        if (eq.slot && eq.inventoryId) {
          equipmentFromTable[eq.slot as EquipmentSlot] = eq.inventoryId;
        }
      }
    }
  } catch (e) {
    // equipment 로드 실패 시 무시 (기존 로직 사용)
  }
  
  // 프리셋 로드 (status.store.equipmentPresets에서)
  const presetsFromStatus = status.store?.equipmentPresets || [];

  if (status.serializedUser) {
    const cloned = JSON.parse(JSON.stringify(status.serializedUser)) as Partial<User>;
    cloned.username =
      prismaUser.username ??
      cloned.username ??
      status.identity?.username ??
      `user-${prismaUser.id.slice(-6)}`;
    cloned.nickname = prismaUser.nickname ?? cloned.nickname ?? cloned.username!;
    cloned.isAdmin =
      prismaUser.isAdmin ??
      cloned.isAdmin ??
      status.serializedUser?.isAdmin ??
      false;
    cloned.strategyLevel = prismaUser.strategyLevel ?? cloned.strategyLevel;
    cloned.strategyXp = prismaUser.strategyXp ?? cloned.strategyXp;
    cloned.playfulLevel = prismaUser.playfulLevel ?? cloned.playfulLevel;
    cloned.playfulXp = prismaUser.playfulXp ?? cloned.playfulXp;
    cloned.actionPoints = {
      current:
        status.actionPointMeta?.actionPoints?.current ??
        cloned.actionPoints?.current ??
        prismaUser.actionPointCurr ??
        0,
      max:
        status.actionPointMeta?.actionPoints?.max ??
        cloned.actionPoints?.max ??
        prismaUser.actionPointMax ??
        0
    };
    cloned.tournamentScore = prismaUser.tournamentScore ?? cloned.tournamentScore;
    cloned.league =
      (prismaUser.league as LeagueTier) ??
      (cloned.league as LeagueTier) ??
      LeagueTier.Sprout;
    cloned.gold = safeNumber(prismaUser.gold ?? cloned.gold ?? 0);
    cloned.diamonds = safeNumber(prismaUser.diamonds ?? cloned.diamonds ?? 0);
    // weeklyCompetitorsBotScores는 leagueMetadata에서 우선적으로 가져오되, 없으면 serializedUser에서 가져옴
    cloned.weeklyCompetitorsBotScores = 
      (status.leagueMetadata?.weeklyCompetitorsBotScores ?? cloned.weeklyCompetitorsBotScores ?? {}) as User["weeklyCompetitorsBotScores"];
    const applied = applyDefaults(cloned, prismaUser, status);
    return ensureAdminSinglePlayerAccess(applied);
  }

  const legacy = (status.legacyRow ?? {}) as Record<string, unknown>;

  const partial: Partial<User> = {
    username:
      prismaUser.username ??
      status.identity?.username ??
      (legacy.username as string | undefined),
    nickname: prismaUser.nickname ?? (legacy.nickname as string | undefined),
    isAdmin:
      prismaUser.isAdmin ??
      safeBoolean(
        status.version != null ? status.serializedUser?.isAdmin : legacy.isAdmin
      ),
    baseStats: status.baseStats ?? parseJson(legacy.baseStats, undefined),
    spentStatPoints: status.spentStatPoints ?? parseJson(legacy.spentStatPoints, undefined),
    stats: ensureStats(status.stats ?? legacy.stats),
    inventorySlots: ensureInventorySlots(
      coalesce(status.inventorySlots, legacy.inventorySlots)
    ),
    mannerScore: status.mannerScore ?? safeNumber(legacy.mannerScore, 0),
    lastActionPointUpdate:
      status.lastActionPointUpdate ??
      safeNumber(legacy.lastActionPointUpdate, Date.now()),
    chatBanUntil:
      status.chatBanUntil ??
      (legacy.chatBanUntil as number | null | undefined) ??
      null,
    connectionBanUntil:
      status.connectionBanUntil ??
      (legacy.connectionBanUntil as number | null | undefined) ??
      null,
    avatarId:
      (status.avatarId as string | undefined) ??
      (legacy.avatarId as string | undefined),
    borderId:
      (status.borderId as string | undefined) ??
      (legacy.borderId as string | undefined),
    ownedBorders:
      status.ownedBorders ??
      parseJson<string[]>(legacy.ownedBorders, undefined),
    mannerMasteryApplied:
      status.mannerMasteryApplied ??
      safeBoolean(legacy.mannerMasteryApplied, false),
    pendingPenaltyNotification:
      status.pendingPenaltyNotification ??
      (legacy.pendingPenaltyNotification as string | null | undefined),
    inventory: inventoryFromTable.length > 0 
      ? inventoryFromTable 
      : ensureInventory(coalesce(status.inventoryRaw, legacy.inventory)),
    equipment: Object.keys(equipmentFromTable).length > 0 
      ? equipmentFromTable 
      : ensureEquipment(coalesce(status.equipmentRaw, legacy.equipment)),
    mail: ensureMail(coalesce(status.mailRaw, legacy.mail)),
    quests: ensureQuestLog(coalesce(status.questsRaw, legacy.quests)),
    actionPoints: ensureActionPoints(
      status.actionPointMeta,
      safeNumber(prismaUser.actionPointCurr, safeNumber(parseJson(legacy.actionPoints, {}).current)),
      safeNumber(prismaUser.actionPointMax, safeNumber(parseJson(legacy.actionPoints, {}).max))
    ),
    actionPointPurchasesToday:
      status.actionPointMeta?.purchasesToday ??
      safeNumber(legacy.actionPointPurchasesToday, 0),
    lastActionPointPurchaseDate:
      status.actionPointMeta?.lastPurchaseDate ??
      safeNumber(legacy.lastActionPointPurchaseDate, 0),
    dailyShopPurchases:
      status.store?.dailyShopPurchases ??
      parseJson<Record<string, { quantity: number; date: number }>>(
        legacy.dailyShopPurchases,
        {}
      ),
    weeklyCompetitors: ensureWeeklyCompetitors(
      coalesce(status.leagueMetadata?.weeklyCompetitors, legacy.weeklyCompetitors)
    ),
    lastWeeklyCompetitorsUpdate:
      status.leagueMetadata?.lastWeeklyCompetitorsUpdate ??
      safeNumber(legacy.lastWeeklyCompetitorsUpdate, null),
    lastLeagueUpdate:
      status.leagueMetadata?.lastLeagueUpdate ??
      safeNumber(legacy.lastLeagueUpdate, null),
    weeklyCompetitorsBotScores:
      (status.leagueMetadata?.weeklyCompetitorsBotScores ?? legacy.weeklyCompetitorsBotScores ?? {}) as User["weeklyCompetitorsBotScores"],
    previousSeasonTier:
      status.leagueMetadata?.previousSeasonTier ??
      (legacy.previousSeasonTier as string | null | undefined),
    seasonHistory:
      status.leagueMetadata?.seasonHistory ??
      parseJson(legacy.seasonHistory, {}),
    league:
      (status.leagueMetadata?.league as LeagueTier | undefined) ??
      (legacy.league as LeagueTier | undefined),
    lastNeighborhoodPlayedDate:
      status.leagueMetadata?.lastNeighborhoodPlayedDate ??
      safeNumber(legacy.lastNeighborhoodPlayedDate, null),
    dailyNeighborhoodWins:
      status.leagueMetadata?.dailyNeighborhoodWins ??
      safeNumber(legacy.dailyNeighborhoodWins, 0),
    neighborhoodRewardClaimed:
      status.leagueMetadata?.neighborhoodRewardClaimed ??
      safeBoolean(legacy.neighborhoodRewardClaimed, false),
    lastNeighborhoodTournament: parseJson(
      status.leagueMetadata?.lastNeighborhoodTournament ?? legacy.lastNeighborhoodTournament,
      null
    ),
    lastNationalPlayedDate:
      status.leagueMetadata?.lastNationalPlayedDate ??
      safeNumber(legacy.lastNationalPlayedDate, null),
    dailyNationalWins:
      status.leagueMetadata?.dailyNationalWins ??
      safeNumber(legacy.dailyNationalWins, 0),
    nationalRewardClaimed:
      status.leagueMetadata?.nationalRewardClaimed ??
      safeBoolean(legacy.nationalRewardClaimed, false),
    lastNationalTournament: parseJson(
      status.leagueMetadata?.lastNationalTournament ?? legacy.lastNationalTournament,
      null
    ),
    lastWorldPlayedDate:
      status.leagueMetadata?.lastWorldPlayedDate ??
      safeNumber(legacy.lastWorldPlayedDate, null),
    dailyWorldWins:
      status.leagueMetadata?.dailyWorldWins ??
      safeNumber(legacy.dailyWorldWins, 0),
    worldRewardClaimed:
      status.leagueMetadata?.worldRewardClaimed ??
      safeBoolean(legacy.worldRewardClaimed, false),
    lastWorldTournament: parseJson(
      status.leagueMetadata?.lastWorldTournament ?? legacy.lastWorldTournament,
      null
    ),
    monthlyGoldBuffExpiresAt:
      status.personalProgress?.monthlyGoldBuffExpiresAt ??
      safeNumber(legacy.monthlyGoldBuffExpiresAt, null),
    mbti:
      status.identity?.mbti ??
      (legacy.mbti as string | null | undefined),
    rejectedGameModes: parseJson(legacy.rejectedGameModes, []),
    isMbtiPublic:
      status.identity?.isMbtiPublic ??
      safeBoolean(legacy.isMbtiPublic, false),
    singlePlayerProgress:
      status.personalProgress?.singlePlayerProgress ??
      safeNumber(legacy.singlePlayerProgress, 0),
    clearedSinglePlayerStages: parseJson(
      status.personalProgress?.clearedSinglePlayerStages ??
        legacy.clearedSinglePlayerStages,
      []
    ),
    bonusStatPoints:
      status.personalProgress?.bonusStatPoints ??
      safeNumber(legacy.bonusStatPoints, 0),
    singlePlayerMissions: ensureSinglePlayerMissions(status),
    blacksmithLevel:
      status.personalProgress?.blacksmithLevel ??
      safeNumber(legacy.blacksmithLevel, 1),
    blacksmithXp:
      status.personalProgress?.blacksmithXp ??
      safeNumber(legacy.blacksmithXp, 0),
    cumulativeRankingScore: parseJson(legacy.cumulativeRankingScore, {}),
    cumulativeTournamentScore:
      (status.leagueMetadata?.cumulativeTournamentScore != null 
        ? safeNumber(status.leagueMetadata.cumulativeTournamentScore, 0)
        : safeNumber(legacy.cumulativeTournamentScore, 0)),
    inventorySlotsMigrated:
      status.store?.inventorySlotsMigrated ??
      safeBoolean(legacy.inventorySlotsMigrated, false),
    equipmentPresets: presetsFromStatus.length > 0 
      ? presetsFromStatus 
      : (status.store?.equipmentPresets ?? parseJson(legacy.equipmentPresets, [])),
    dailyRankings: ensureDailyRankings(
      coalesce(status.dailyRankings, legacy.dailyRankings)
    ),
    towerFloor: safeNumber(prismaUser.towerFloor, safeNumber(legacy.towerFloor, 0)),
    lastTowerClearTime: prismaUser.lastTowerClearTime != null 
      ? Number(prismaUser.lastTowerClearTime) 
      : safeNumber(legacy.lastTowerClearTime, undefined),
    monthlyTowerFloor: safeNumber((prismaUser as any).monthlyTowerFloor, safeNumber((legacy as any)?.monthlyTowerFloor, 0)),
    guildId: user.guildId ?? (prismaUser.guildMember?.guildId ?? undefined)
  };

  const applied = applyDefaults(partial, prismaUser, status);
  return ensureAdminSinglePlayerAccess(applied);
}

export function serializeUser(user: User): SerializedUserStatus {
  return {
    version: 1,
    serializedUser: JSON.parse(JSON.stringify(user)),
    baseStats: user.baseStats,
    spentStatPoints: user.spentStatPoints,
    stats: user.stats ?? {},
    inventorySlots: user.inventorySlots,
    mannerScore: user.mannerScore,
    lastActionPointUpdate: user.lastActionPointUpdate,
    chatBanUntil: user.chatBanUntil ?? null,
    connectionBanUntil: user.connectionBanUntil ?? null,
    avatarId: user.avatarId,
    borderId: user.borderId,
    ownedBorders: user.ownedBorders ?? [],
    mannerMasteryApplied: user.mannerMasteryApplied ?? false,
    pendingPenaltyNotification: user.pendingPenaltyNotification ?? null,
    inventoryRaw: JSON.stringify(user.inventory ?? []),
    equipmentRaw: JSON.stringify(user.equipment ?? {}),
    mailRaw: JSON.stringify(user.mail ?? []),
    questsRaw: JSON.stringify(user.quests ?? createDefaultQuests()),
    actionPointMeta: {
      actionPoints: user.actionPoints ?? {
        current: 0,
        max: 0
      },
      purchasesToday: user.actionPointPurchasesToday ?? 0,
      lastPurchaseDate: user.lastActionPointPurchaseDate ?? 0
    },
    store: {
      dailyShopPurchases: user.dailyShopPurchases ?? {},
      inventorySlotsMigrated: user.inventorySlotsMigrated ?? false,
      equipmentPresets: user.equipmentPresets ?? []
    },
    leagueMetadata: {
      tournamentScore: user.tournamentScore ?? 0,
      league: user.league ?? LeagueTier.Sprout,
      previousSeasonTier: user.previousSeasonTier ?? null,
      seasonHistory: user.seasonHistory ?? {},
      weeklyCompetitors: user.weeklyCompetitors ?? [],
      lastWeeklyCompetitorsUpdate: user.lastWeeklyCompetitorsUpdate ?? null,
      lastLeagueUpdate: user.lastLeagueUpdate ?? null,
      weeklyCompetitorsBotScores: user.weeklyCompetitorsBotScores ?? {},
      cumulativeTournamentScore: (user.cumulativeTournamentScore != null ? user.cumulativeTournamentScore : 0),
      lastNeighborhoodPlayedDate: user.lastNeighborhoodPlayedDate ?? null,
      dailyNeighborhoodWins: user.dailyNeighborhoodWins ?? 0,
      neighborhoodRewardClaimed: user.neighborhoodRewardClaimed ?? false,
      lastNeighborhoodTournament: user.lastNeighborhoodTournament ?? null,
      lastNationalPlayedDate: user.lastNationalPlayedDate ?? null,
      dailyNationalWins: user.dailyNationalWins ?? 0,
      nationalRewardClaimed: user.nationalRewardClaimed ?? false,
      lastNationalTournament: user.lastNationalTournament ?? null,
      lastWorldPlayedDate: user.lastWorldPlayedDate ?? null,
      dailyWorldWins: user.dailyWorldWins ?? 0,
      worldRewardClaimed: user.worldRewardClaimed ?? false,
      lastWorldTournament: user.lastWorldTournament ?? null
    },
    personalProgress: {
      singlePlayerProgress: user.singlePlayerProgress ?? 0,
      clearedSinglePlayerStages: user.clearedSinglePlayerStages ?? [],
      bonusStatPoints: user.bonusStatPoints ?? 0,
      singlePlayerMissions: user.singlePlayerMissions ?? {},
      monthlyGoldBuffExpiresAt: user.monthlyGoldBuffExpiresAt ?? null,
      blacksmithLevel: user.blacksmithLevel ?? 1,
      blacksmithXp: user.blacksmithXp ?? 0
    },
    identity: {
      username: user.username,
      mbti: user.mbti ?? null,
      isMbtiPublic: user.isMbtiPublic ?? false
    },
    rejectedGameModes: JSON.stringify(user.rejectedGameModes ?? []),
    statResetCountToday: user.statResetCountToday ?? 0,
    lastStatResetDate: user.lastStatResetDate ?? null,
    cumulativeRankingScore: user.cumulativeRankingScore ?? {},
    inventorySlotsMigrated: user.inventorySlotsMigrated ?? false,
    dailyRankings: user.dailyRankings ?? {}
  };
}


