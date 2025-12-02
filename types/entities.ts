import { Player, GameMode, LeagueTier, UserStatus, WinReason, RPSChoice, DiceGoVariant, AlkkagiPlacementType, AlkkagiLayoutType, Point, Move, BoardState, EquipmentSlot, InventoryItemType, ItemGrade, CoreStat, ItemOptionType, TournamentType, TournamentSimulationStatus, GameStatus, SinglePlayerLevel, GameCategory, GuildMemberRole, GuildResearchId } from './enums.js';
// FIX: ChatMessage is now defined in api.ts to break circular dependency.
import { UserStatusInfo, ChatMessage } from './api.js';

// --- Item & Equipment ---
export type Equipment = Partial<Record<EquipmentSlot, string>>;

export type EquipmentPreset = {
  name: string;
  equipment: Equipment;
};

export type ItemOption = {
  type: ItemOptionType;
  value: number;
  baseValue?: number;
  isPercentage: boolean;
  tier?: number; // For special stats
  display: string;
  range?: [number, number];
  enhancements?: number;
};

export type ItemOptions = {
  main: ItemOption;
  combatSubs: ItemOption[];
  specialSubs: ItemOption[];
  mythicSubs: ItemOption[];
};

export type InventoryItem = {
  id: string;
  name: string;
  description: string;
  type: InventoryItemType;
  slot: EquipmentSlot | null;
  quantity?: number;
  level: number;
  isEquipped: boolean;
  createdAt: number;
  image: string;
  grade: ItemGrade;
  stars: number;
  options?: ItemOptions;
  enhancementFails?: number;
  isDivineMythic?: boolean; // D.신화 여부
};

// --- User & Associated Data ---
export type Mail = {
  id: string;
  from: string;
  title: string;
  message: string;
  attachments?: {
    gold?: number;
    diamonds?: number;
    actionPoints?: number;
    items?: (InventoryItem | { itemId: string; quantity: number })[];
  };
  receivedAt: number;
  expiresAt?: number;
  isRead: boolean;
  attachmentsClaimed: boolean;
};

export type QuestReward = {
  gold?: number;
  diamonds?: number;
  xp?: { type: 'strategy' | 'playful' | 'blacksmith'; amount: number };
  items?: (InventoryItem | { itemId: string; quantity: number })[];
  actionPoints?: number;
};

export type Quest = {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  reward: QuestReward;
  activityPoints: number;
  isClaimed: boolean;
};

export type DailyQuestData = {
  quests: Quest[];
  activityProgress: number;
  claimedMilestones: boolean[];
  lastReset: number;
};

export type WeeklyQuestData = {
  quests: Quest[];
  activityProgress: number;
  claimedMilestones: boolean[];
  lastReset: number;
};

export type MonthlyQuestData = {
  quests: Quest[];
  activityProgress: number;
  claimedMilestones: boolean[];
  lastReset: number;
};


export type QuestLog = {
    daily?: DailyQuestData;
    weekly?: WeeklyQuestData;
    monthly?: MonthlyQuestData;
};

export type AvatarInfo = {
  id: string;
  name: string;
  url: string;
  requiredLevel: number;
  type: 'strategy' | 'playful' | 'any';
};

export type BorderInfo = {
  id: string;
  name: string;
  url: string | null;
  description: string;
  unlockTier?: string;
  requiredLevelSum?: number;
};

export type ShopBorderItem = BorderInfo & {
    price: { gold?: number; diamonds?: number };
};

export type WeeklyCompetitor = {
    id: string;
    nickname: string;
    avatarId: string;
    borderId: string;
    league: LeagueTier;
    initialScore: number;
};

// --- Tournament ---
export type TournamentDefinition = {
    id: TournamentType;
    name: string;
    description: string;
    format: 'round-robin' | 'tournament';
    players: number;
    image: string;
};

export type CommentaryLine = {
    text: string;
    phase: 'early' | 'mid' | 'end';
    scores?: { player1: number; player2: number };
    isRandomEvent?: boolean;
};

export type Match = {
    id: string;
    players: (PlayerForTournament | null)[];
    winner: PlayerForTournament | null;
    isFinished: boolean;
    commentary: CommentaryLine[];
    isUserMatch: boolean;
    finalScore: { player1: number; player2: number } | null;
    score?: { player1: number; player2: number };
    timeElapsed?: number;
    sgfFileIndex?: number;
};

export type Round = {
    id: number;
    name: string;
    matches: Match[];
};

export type TournamentState = {
    type: TournamentType;
    status: TournamentSimulationStatus;
    title: string;
    players: PlayerForTournament[];
    rounds: Round[];
    currentSimulatingMatch: { roundIndex: number; matchIndex: number } | null;
    currentMatchCommentary: CommentaryLine[];
    currentRoundRobinRound?: number;
    lastPlayedDate: number;
    nextRoundStartTime: number | null;
    timeElapsed: number;
    lastSimulationTime?: number; // 마지막 시뮬레이션 실행 시간 (ms)
    simulationSeed?: string; // 클라이언트 시뮬레이션을 위한 랜덤 시드
    currentMatchScores?: { player1: number; player2: number } | null;
    lastScoreIncrement?: { 
        player1: { base: number; actual: number; isCritical: boolean } | null;
        player2: { base: number; actual: number; isCritical: boolean } | null;
    } | null;
    currentMatchResult?: {
        winnerId: string;
        loserId: string;
        rewards?: { gold: number; diamonds: number; };
    } | null;
    accumulatedGold?: number; // 동네바둑리그 경기별 누적 골드
    accumulatedMaterials?: Record<string, number>; // 전국바둑대회 경기별 누적 재료 (재료명: 개수)
    accumulatedEquipmentBoxes?: Record<string, number>; // 월드챔피언십 경기별 누적 장비상자 (상자명: 개수)
    // 던전 시스템 필드
    currentStage?: number; // 현재 클리어한 최고 단계 (1~10)
    unlockedStages?: number[]; // 클리어하여 언락된 단계 배열
    stageResults?: Record<number, {
        cleared: boolean; // 클리어 여부
        scoreDiff: number; // 점수차이 (랭킹 정렬용)
        clearTime: number; // 클리어 시간
        rank?: number; // 해당 단계에서의 순위
        dailyScore?: number; // 일일 획득 점수
    }>;
    dailyStageAttempts?: Record<number, number>; // 일일 단계별 시도 횟수 (리셋용)
    currentStageAttempt?: number; // 현재 진행 중인 단계
};

export type LeagueOutcome = 'promote' | 'maintain' | 'demote';

export interface LeagueRewardTier {
    rankStart: number;
    rankEnd: number;
    diamonds: number;
    outcome: LeagueOutcome;
}

export type UserCredentials = {
    username: string;
    passwordHash: string;
    userId: string;
};

export type SinglePlayerMissionLevelInfo = {
    level: number;
    unlockStageId?: string; // 레벨 10 오픈조건 (선택적)
    productionRateMinutes: number; // 생산속도 (분)
    rewardAmount: number; // 생산량
    maxCapacity: number; // 최대생산량
};

export type SinglePlayerMissionInfo = {
    id: string;
    name: string;
    description: string;
    unlockStageId: string; // 최초 오픈조건 (레벨 1)
    rewardType: 'gold' | 'diamonds';
    image: string;
    levels: SinglePlayerMissionLevelInfo[]; // 레벨 1-10 정보
};

export type SinglePlayerMissionState = {
    id: string;
    isStarted: boolean;
    level: number; // 현재 레벨 (1-10)
    lastCollectionTime: number;
    accumulatedAmount: number; // 현재 누적 생산량
    accumulatedCollection: number; // 누적 수령액 (레벨업용)
};

export type User = {
  id: string;
  username: string;
  nickname: string;
  isAdmin: boolean;
  strategyLevel: number;
  strategyXp: number;
  playfulLevel: number;
  playfulXp: number;
  baseStats: Record<CoreStat, number>;
  spentStatPoints: Record<CoreStat, number>;
  inventory: InventoryItem[];
  inventorySlots: { equipment: number; consumable: number; material: number; };
  equipment: Equipment;
  equipmentPresets?: EquipmentPreset[];
  actionPoints: { current: number; max: number };
  lastActionPointUpdate: number;
  actionPointPurchasesToday?: number;
  lastActionPointPurchaseDate?: number;
  dailyShopPurchases?: Record<string, { quantity: number; date: number }>;
  gold: number;
  diamonds: number;
  mannerScore: number;
  mail: Mail[];
  quests: QuestLog;
  stats?: Record<string, { wins: number; losses: number; rankingScore: number; aiWins?: number; aiLosses?: number; }>;
  chatBanUntil?: number | null;
  connectionBanUntil?: number | null;
  avatarId: string;
  borderId: string;
  ownedBorders: string[];
  previousSeasonTier?: string | null;
  seasonHistory?: Record<string, Partial<Record<GameMode, string>>>;
  tournamentScore: number;
  league: LeagueTier;
  mannerMasteryApplied?: boolean;
  pendingPenaltyNotification?: string | null;
  lastNeighborhoodPlayedDate?: number | null;
  dailyNeighborhoodWins?: number;
  neighborhoodRewardClaimed?: boolean;
  lastNeighborhoodTournament?: TournamentState | null;
  lastNationalPlayedDate?: number | null;
  dailyNationalWins?: number;
  nationalRewardClaimed?: boolean;
  lastNationalTournament?: TournamentState | null;
  lastWorldPlayedDate?: number | null;
  dailyWorldWins?: number;
  worldRewardClaimed?: boolean;
  lastWorldTournament?: TournamentState | null;
  // 경쟁상대 관련 필드 제거됨 (weeklyCompetitors, weeklyCompetitorsBotScores 등)
  lastLeagueUpdate?: number | null; // league는 유지 (다른 곳에서 사용 가능)
  monthlyGoldBuffExpiresAt?: number | null;
  // 던전 진행 상태
  dungeonProgress?: Record<TournamentType, {
    currentStage: number; // 현재 클리어한 최고 단계 (1~10)
    unlockedStages: number[]; // 클리어하여 언락된 단계 배열
    stageResults: Record<number, {
      cleared: boolean;
      scoreDiff: number;
      clearTime: number;
      rank?: number;
      dailyScore?: number;
    }>;
    dailyStageAttempts: Record<number, number>; // 일일 단계별 시도 횟수
  }>;
  dailyDungeonScore?: number; // 일일 획득 점수 (리셋용)
  mbti?: string | null;
  rejectedGameModes?: GameMode[];
  isMbtiPublic?: boolean;
  statResetCountToday?: number;
  lastStatResetDate?: string | null;
  singlePlayerProgress?: number;
  clearedSinglePlayerStages?: string[]; // 클리어한 스테이지 ID 배열 (최초 클리어 여부 추적용)
  bonusStatPoints?: number;
  singlePlayerMissions?: Record<string, SinglePlayerMissionState>;
  guildId?: string;
  blacksmithLevel: number;
  blacksmithXp: number;
  cumulativeRankingScore?: Record<string, number>;
  cumulativeTournamentScore?: number; // 누적 챔피언십 점수 (홈 화면 랭킹용)
  yesterdayTournamentScore?: number; // 어제의 챔피언십 점수 (변화량 계산용)
  inventorySlotsMigrated?: boolean;
  towerFloor?: number; // 도전의 탑 최고 층수
  lastTowerClearTime?: number; // 마지막 층 클리어 시간 (랭킹 정렬용)
  monthlyTowerFloor?: number; // 한 달 동안 클리어한 최고 층수 (매월 1일 리셋)
  dailyRankings?: {
    strategic?: { rank: number; score: number; lastUpdated: number };
    playful?: { rank: number; score: number; lastUpdated: number };
    championship?: {
      neighborhood?: { rank: number; maxStage: number; maxScoreDiff: number; totalAbility: number; lastUpdated: number };
      national?: { rank: number; maxStage: number; maxScoreDiff: number; totalAbility: number; lastUpdated: number };
      world?: { rank: number; maxStage: number; maxScoreDiff: number; totalAbility: number; lastUpdated: number };
    };
  };
  savedGameRecords?: GameRecord[];
  lastLoginAt?: number;
  dailyDonations?: { gold: number; diamond: number; date: number };
  guildCoins?: number;
  guildBossAttempts?: number;
  guildApplications?: Array<{ guildId: string; appliedAt: number }>;
};

export type GameRecord = {
  id: string;
  gameId: string;
  mode: GameMode;
  opponent: {
    id: string;
    nickname: string;
  };
  date: number;
  sgfContent: string;
  gameResult: {
    winner: Player;
    blackScore: number;
    whiteScore: number;
    scoreDetails?: {
      black: {
        timeBonus: number;
        baseStoneBonus: number;
        hiddenStoneBonus: number;
        itemBonus: number;
        komi?: number;
      };
      white: {
        timeBonus: number;
        baseStoneBonus: number;
        hiddenStoneBonus: number;
        itemBonus: number;
        komi?: number;
      };
    };
  };
};

export type EnhancementResult = {
  message: string;
  success: boolean;
  itemBefore: InventoryItem;
  itemAfter: InventoryItem;
  isRolling?: boolean; // 롤링 애니메이션 상태 (제련 진행 중)
  xpGained?: number;
};

export type UserWithStatus = User & UserStatusInfo;

export type PlayerForTournament = Pick<User, 'id' | 'nickname' | 'avatarId' | 'borderId' | 'league'> & {
    stats: Record<CoreStat, number>;
    originalStats?: Record<CoreStat, number>;
    wins: number;
    losses: number;
    condition: number;
    statsTimestamp?: number; // 오늘 0시 기준 타임스탬프 (능력치 고정용)
};

export type StageInfo = {
    id: string;
    name: string;
    description: string;
    level: SinglePlayerLevel;
    mode: GameMode;
    boardState: BoardState;
    player: Player;
    reward: {
        gold: number;
        diamonds: number;
    };
};

export type SinglePlayerStageInfo = {
    id: string;
    name: string;
    level: SinglePlayerLevel;
    actionPointCost: number;
    boardSize: 7 | 9 | 11 | 13;
    targetScore: { black: number; white: number; };
    placements: {
        black: number;
        white: number;
        blackPattern: number;
        whitePattern: number;
        centerBlackStoneChance?: number;
    };
    timeControl: {
        type: 'byoyomi' | 'fischer';
        mainTime: number; // minutes
        byoyomiTime?: number; // seconds
        byoyomiCount?: number;
        increment?: number; // seconds
    };
    rewards: {
        firstClear: { gold: number; exp: number; items?: { itemId: string; quantity: number }[]; bonus?: string };
        repeatClear: { gold: number; exp: number; items?: { itemId: string; quantity: number }[]; bonus?: string };
    };
    // 살리기 바둑 모드: AI(백)가 정해진 턴 동안 살아남기
    survivalTurns?: number; // AI(백)가 살아남아야 하는 턴 수 (백의 턴 수 제한)
    // 자동 계가 턴 수: 정해진 턴 수에 도달하면 자동으로 계가 진행
    autoScoringTurns?: number; // 총 턴 수 (유저+AI 합산)
    // 미사일바둑 모드: 미사일 아이템 개수
    missileCount?: number; // 미사일 아이템 개수
    // 히든바둑 모드: 히든/스캔 아이템 개수
    hiddenCount?: number; // 히든 아이템 개수
    scanCount?: number; // 스캔 아이템 개수
    // 흑(유저)의 턴 수 제한
    blackTurnLimit?: number; // 유저(흑)의 턴 수 제한
};


// --- Game ---
export type KomiBid = { color: Player; komi: number; };

export type AlkkagiStone = {
    id: number;
    player: Player;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    onBoard: boolean;
    timeOffBoard?: number;
};

export type GameSettings = {
  boardSize: 9 | 13 | 19 | 7 | 11 | 15;
  komi: number;
  timeLimit: number; // in minutes
  byoyomiTime: number; // in seconds
  byoyomiCount: number;
  
  // Mode-specific settings
  captureTarget?: number;
  timeIncrement?: number; // Fischer
  baseStones?: number;
  hiddenStoneCount?: number;
  scanCount?: number;
  missileCount?: number;
  mixedModes?: GameMode[];
  autoScoring?: boolean;
  
  // Omok settings
  has33Forbidden?: boolean;
  hasOverlineForbidden?: boolean;

  // Dice Go settings
  diceGoVariant?: DiceGoVariant;
  diceGoRounds?: 1 | 2 | 3;
  oddDiceCount?: number;
  evenDiceCount?: number;
  diceGoItemCount?: number;
  
  // Alkkagi settings
  alkkagiPlacementType?: AlkkagiPlacementType;
  alkkagiLayout?: AlkkagiLayoutType;
  alkkagiRounds?: 1 | 2 | 3;
  alkkagiStoneCount?: number;
  alkkagiGaugeSpeed?: number;
  alkkagiSlowItemCount?: number;
  alkkagiAimingLineItemCount?: number;
  alkkagiItemCount?: number;

  // Curling settings
  curlingStoneCount?: number;
  curlingGaugeSpeed?: number;
  curlingSlowItemCount?: number;
  curlingAimingLineItemCount?: number;
  curlingRounds?: 1 | 2 | 3;

  // AI Game settings
  player1Color?: Player.Black | Player.White; // For AI games, P1 is always the human
  aiDifficulty?: number; // 1-5
};

// --- Round Summaries ---
export type AlkkagiRoundSummary = {
    round: number;
    winnerId: string;
    loserId: string;
    refillsRemaining: { [playerId: string]: number };
};

export type CurlingRoundSummary = {
    round: number;
    roundWinner?: Player | null; // Winner of the round
    black: { houseScore: number; knockoutScore: number; total: number; };
    white: { houseScore: number; knockoutScore: number; total: number; };
    cumulativeScores: { [key in Player]: number; };
    stonesState: AlkkagiStone[];
    scoredStones: { [stoneId: number]: number };
};

export type DiceRoundSummary = {
    round: number;
    scores: { [playerId: string]: number };
    diceStats?: {
        [playerId: string]: {
            rolls: { [roll: number]: number };
            totalRolls: number;
        };
    };
};

export type ThiefRoundSummary = {
    round: number;
    isDeathmatch?: boolean;
    player1: { id: string; role: 'thief' | 'police'; roundScore: number; cumulativeScore: number; };
    player2: { id: string; role: 'thief' | 'police'; roundScore: number; cumulativeScore: number; };
    diceStats?: {
        [playerId: string]: {
            rolls: { [roll: number]: number };
            totalRolls: number;
        };
    };
};

export type AnimationData =
  | { type: 'scan'; point: Point; success: boolean; startTime: number; duration: number; playerId: string }
  | { type: 'missile'; from: Point; to: Point; player: Player; startTime: number; duration: number }
  | { type: 'dice_roll_turn'; p1Roll: number; p2Roll: number; startTime: number; duration: number }
  | { type: 'dice_roll_main'; dice: { dice1: number, dice2: number, dice3: number }; startTime: number; duration: number }
  | { type: 'alkkagi_flick'; stoneId: number; vx: number; vy: number; startTime: number; duration: number }
  | { type: 'curling_flick'; stone: AlkkagiStone; velocity: Point; startTime: number; duration: number }
  | { type: 'hidden_reveal'; stones: { point: Point; player: Player }[]; startTime: number; duration: number }
  | { type: 'hidden_missile'; from: Point; to: Point; player: Player; startTime: number; duration: number }
  | { type: 'bonus_text'; text: string; point: Point; player: Player; startTime: number; duration: number }
  | { type: 'bonus_score'; playerId: string; bonus: number; startTime: number; duration: number }
  | { type: 'ai_thinking'; startTime: number; duration: number; playerId: string };

// --- Analysis & Summary ---
export type RecommendedMove = {
  x: number;
  y: number;
  winrate: number;
  scoreLead: number;
  order: number;
};

export type AnalysisResult = {
  winRateBlack: number;
  winRateChange?: number;
  scoreLead?: number;
  blackConfirmed: Point[];
  whiteConfirmed: Point[];
  blackRight: Point[];
  whiteRight: Point[];
  blackLikely: Point[];
  whiteLikely: Point[];
  deadStones: Point[];
  ownershipMap: number[][] | null;
  recommendedMoves: RecommendedMove[];
  areaScore: { black: number; white: number; };
  scoreDetails: {
    black: { territory: number; captures: number; liveCaptures?: number; deadStones?: number; baseStoneBonus: number; hiddenStoneBonus: number; timeBonus: number; itemBonus: number; total: number; };
    white: { territory: number; captures: number; liveCaptures?: number; deadStones?: number; komi: number; baseStoneBonus: number; hiddenStoneBonus: number; timeBonus: number; itemBonus: number; total: number; };
  };
};

export type StatChange = {
  initial: number;
  change: number;
  final: number;
};

export type GameSummary = {
  xp: StatChange;
  rating: StatChange;
  manner: StatChange;
  mannerActionChange?: number;
  mannerGrade?: { initial: string; final: string; };
  actionPoints?: StatChange;
  level?: {
      initial: number;
      final: number;
      progress: { initial: number; final: number; max: number };
  };
  overallRecord?: { wins: number; losses: number; aiWins?: number; aiLosses?: number; };
  gold?: number;
  items?: InventoryItem[];
};


// --- Core Entities ---
export type LiveGameSession = {
  id: string;
  mode: GameMode;
  settings: GameSettings;
  description?: string;
  player1: User;
  player2: User;
  blackPlayerId: string | null;
  whitePlayerId: string | null;
  gameStatus: GameStatus;
  currentPlayer: Player;
  boardState: BoardState;
  moveHistory: Move[];
  serverRevision?: number;
  lastSyncedAt?: number;
  captures: { [key in Player]: number };
  baseStoneCaptures: { [key in Player]: number };
  hiddenStoneCaptures: { [key in Player]: number };
  winner: Player | null;
  winReason: WinReason | null;
  finalScores?: { black: number, white: number };
  createdAt: number;
  startTime?: number;
  endTime?: number;
  lastMove: Point | null;
  lastTurnStones?: Point[] | null;
  stonesPlacedThisTurn?: Point[] | null;
  passCount: number;
  koInfo: { point: Point; turn: number } | null;
  winningLine?: Point[] | null;
  statsUpdated?: boolean;
  summary?: { [playerId: string]: GameSummary };
  animation?: AnimationData | null;
  blackTimeLeft: number;
  whiteTimeLeft: number;
  blackByoyomiPeriodsLeft: number;
  whiteByoyomiPeriodsLeft: number;
  turnDeadline?: number;
  turnStartTime?: number;
  nigiriStartTime?: number;
  canRequestNoContest?: { [playerId: string]: boolean };
  pausedTurnTimeLeft?: number;
  itemUseDeadline?: number;
  lastTimeoutPlayerId?: string | null;
  lastTimeoutPlayerIdClearTime?: number;
  revealAnimationEndTime?: number;
  revealEndTime?: number;
  disconnectionState?: { disconnectedPlayerId: string; timerStartedAt: number; } | null;
  disconnectionCounts: { [playerId: string]: number; };
  aiHiddenItemUsed?: boolean;
  aiHiddenItemTurn?: number;
  aiHiddenItemAnimationEndTime?: number;
  noContestInitiatorIds?: string[];
  currentActionButtons: { [playerId: string]: any[] }; // ActionButton
  actionButtonCooldownDeadline?: { [playerId: string]: number | undefined };
  actionButtonUses?: { [playerId: string]: number };
  maxActionButtonUses?: number;
  actionButtonUsedThisCycle?: { [playerId: string]: boolean };
  mannerScoreChanges?: { [playerId: string]: number };
  nigiri?: { holderId: string; guesserId: string; stones: number | null; guess: 1 | 2 | null; result: 'correct' | 'incorrect' | null; processed?: boolean; purpose?: 'determine_colors' | 'turn_choice_tiebreaker'; };
  guessDeadline?: number;
  bids?: { [userId: string]: number | null };
  biddingRound?: number;
  captureBidDeadline?: number;
  effectiveCaptureTargets?: { [key in Player]: number };
  baseStones?: { x: number; y: number; player: Player; }[];
  baseStones_p1?: Point[];
  baseStones_p2?: Point[];
  basePlacementDeadline?: number;
  komiBids?: { [userId: string]: KomiBid | null };
  komiBiddingDeadline?: number;
  komiBiddingRound?: number;
  komiBidRevealProcessed?: boolean;
  finalKomi?: number;
  hiddenMoves?: { [moveIndex: number]: boolean };
  scans_p1?: number;
  scans_p2?: number;
  hidden_stones_p1?: number;
  hidden_stones_p2?: number;
  revealedHiddenMoves?: { [playerId: string]: number[] };
  newlyRevealed?: { point: Point, player: Player }[];
  justCaptured?: { point: Point; player: Player; wasHidden: boolean }[];
  hidden_stones_used_p1?: number;
  hidden_stones_used_p2?: number;
  pendingCapture?: { stones: Point[]; move: Move; hiddenContributors: Point[]; capturedHiddenStones?: Point[] } | null;
  permanentlyRevealedStones?: Point[];
  processingMove?: { playerId: string; x: number; y: number; timestamp: number } | null; // 동시성 제어를 위한 처리 중인 수
  missiles_p1?: number;
  missiles_p2?: number;
  missileUsedThisTurn?: boolean;
  rpsState?: { [userId:string]: RPSChoice | null };
  rpsRound?: number;
  dice?: { dice1: number, dice2: number, dice3: number };
  stonesToPlace?: number;
  turnOrderRolls?: { [userId: string]: number | null };
  turnOrderRollReady?: { [userId: string]: boolean };
  turnOrderRollResult?: 'tie' | null;
  turnOrderRollTies?: number;
  turnOrderRollDeadline?: number;
  turnOrderAnimationEndTime?: number;
  turnChoiceDeadline?: number;
  turnChooserId?: string | null;
  turnChoices?: { [userId: string]: 'first' | 'second' | null };
  turnSelectionTiebreaker?: 'rps' | 'nigiri' | 'dice_roll';
  diceRollHistory?: { [playerId: string]: number[] };
  diceRoundSummary?: DiceRoundSummary;
  lastWhiteGroupInfo?: { size: number; liberties: number } | null;
  gameStartTime?: number; // 게임 시작 시간 (초기화 시점)
  isEarlyTermination?: boolean; // 조기 종료 여부
  badMannerPlayerId?: string; // 비매너 행동자 ID
  isRankedGame?: boolean; // true면 랭킹전, false면 친선전 (기본값: false)
  diceGoItemUses?: { [playerId: string]: { odd: number; even: number } };
  diceGoBonuses?: { [playerId: string]: number };
  diceCapturesThisTurn?: number;
  diceLastCaptureStones?: Point[];
  round: number;
  isDeathmatch?: boolean;
  turnInRound: number;
  scores: { [userId: string]: number };
  thiefPlayerId?: string;
  policePlayerId?: string;
  roleChoices?: { [userId: string]: 'thief' | 'police' | null };
  roleChoiceWinnerId?: string | null;
  thiefRoundSummary?: ThiefRoundSummary;
  thiefDiceRollHistory?: { [playerId: string]: number[] };
  thiefCapturesThisRound?: number;
  alkkagiStones?: AlkkagiStone[];
  alkkagiStones_p1?: AlkkagiStone[];
  alkkagiStones_p2?: AlkkagiStone[];
  alkkagiTurnDeadline?: number;
  alkkagiPlacementDeadline?: number;
  alkkagiItemUses?: { [playerId: string]: { slow: number; aimingLine: number } };
  activeAlkkagiItems?: { [playerId: string]: ('slow' | 'aimingLine')[] };
  alkkagiRound?: number;
  alkkagiRefillsUsed?: { [playerId: string]: number };
  alkkagiStonesPlacedThisRound?: { [playerId: string]: number };
  alkkagiRoundSummary?: AlkkagiRoundSummary;
  curlingStones?: AlkkagiStone[];
  curlingTurnDeadline?: number;
  curlingScores?: { [key in Player]: number };
  curlingRound?: number;
  curlingRoundSummary?: CurlingRoundSummary;
  curlingItemUses?: { [playerId: string]: { slow: number; aimingLine: number } };
  activeCurlingItems?: { [playerId: string]: ('slow' | 'aimingLine')[] };
  hammerPlayerId?: string; // Player with last stone advantage
  isTiebreaker?: boolean;
  tiebreakerStonesThrown?: number;
  stonesThrownThisRound?: { [playerId: string]: number };
  preGameConfirmations?: { [playerId: string]: boolean | number };
  roundEndConfirmations?: { [playerId: string]: number };
  rematchRejectionCount?: { [playerId: string]: number };
  timeoutFouls?: { [playerId: string]: number };
  curlingStonesLostToFoul?: { [playerId: string]: number };
  foulInfo?: { message: string; expiry: number; } | null;
  isAnalyzing?: boolean;
  analysisResult?: { [playerId: string]: AnalysisResult } | null;
  previousAnalysisResult?: { [playerId: string]: AnalysisResult } | null;
  isAiGame?: boolean;
  aiTurnStartTime?: number;
  mythicBonuses?: {
    [playerId: string]: {
        strategicGoldTriggers: number;
        playfulGoldTriggers: number;
    }
  };
  lastPlayfulGoldCheck?: {
      [playerId: string]: number;
  };
  pendingSystemMessages?: ChatMessage[];
  isSinglePlayer?: boolean;  // Deprecated: Use gameCategory instead
  gameCategory?: GameCategory;  // 게임 카테고리: normal, singleplayer, tower
  stageId?: string;
  towerFloor?: number;  // 도전의 탑 층수
  blackPatternStones?: Point[];
  whitePatternStones?: Point[];
  whiteTurnsPlayed?: number; // 살리기 바둑 모드: 백(AI)이 둔 턴 수
  singlePlayerPlacementRefreshesUsed?: number;
  totalTurns?: number; // 총 턴 수 (유저 + AI 합산), 자동 계가 트리거용
};

export type Negotiation = {
  id: string;
  challenger: User;
  opponent: User;
  mode: GameMode;
  settings: GameSettings;
  proposerId: string;
  status: 'draft' | 'pending';
  turnCount?: number;
  deadline: number;
  rematchOfGameId?: string;
  previousSettings?: GameSettings;
  isRanked?: boolean; // false면 친선전, true면 랭킹전 (기본값: false)
};

export type SanctionLogData = {
    sanctionType: 'chat' | 'connection';
    durationMinutes?: number;
};

export type AdminLog = {
  id: string;
  timestamp: number;
  adminId: string;
  adminNickname: string;
  targetUserId: string;
  targetNickname: string;
  action: 'reset_stats' | 'reset_full' | 'delete_user' | 'force_logout' | 'force_delete_game' | 'send_mail' | 'set_game_description' | 'update_user_details' | 'apply_sanction' | 'lift_sanction' | 'force_win' | 'reset_tournament_session' | 'clear_user_guild' | 'create_home_board_post' | 'update_home_board_post' | 'delete_home_board_post';
  backupData: Partial<User> | { status: UserStatusInfo } | LiveGameSession | { mailTitle: string } | SanctionLogData | { gameId: string, winnerId: string } | { postId: string, title: string } | { oldGuildId: string | undefined };
};

export type Announcement = {
    id: string;
    message: string;
};

export type OverrideAnnouncement = {
    message: string;
    modes: GameMode[] | 'all';
};

export type HomeBoardPost = {
    id: string;
    title: string;
    content: string;
    authorId: string;
    isPinned: boolean;
    createdAt: number;
    updatedAt: number;
};

export type ActionButton = {
  name: string;
  message: string;
  type: 'manner' | 'unmannerly';
};

// --- Guild Types ---
export type Guild = {
  id: string;
  name: string;
  leaderId: string;
  description?: string;
  emblem?: string;
  icon?: string;
  settings?: any;
  gold: number;
  level: number;
  experience: number;
  xp?: number; // alias for experience
  researchPoints?: number;
  research?: Record<string, { level: number }>;
  researchTask?: { researchId: string; startedAt: number; completedAt: number; completionTime?: number } | null;
  members?: GuildMember[];
  memberLimit?: number;
  isPublic?: boolean;
  joinType?: 'application' | 'free'; // 'application': 신청가입 (승인 필요), 'free': 자유가입 (자동 가입)
  announcement?: string;
  chatHistory?: GuildMessage[];
  checkIns?: Record<string, number>;
  dailyCheckInRewardsClaimed?: Array<{ userId: string; milestoneIndex: number }>;
  guildBossState?: {
    bossId: string;
    hp: number;
    maxHp: number;
    defeatedAt?: number;
    lastResetAt: number;
    currentBossId?: string;
    currentBossHp?: number;
    totalDamageLog?: Record<string, number>;
  } | null;
  weeklyMissions?: GuildMission[];
  lastMissionReset?: number;
  applicants?: Array<{ userId: string; appliedAt: number }>;
  recruitmentBanUntil?: number;
  createdAt: number;
  updatedAt: number;
};

export type GuildMember = {
  id: string;
  guildId: string;
  userId: string;
  nickname?: string;
  role: 'leader' | 'officer' | 'member';
  joinDate: number;
  contributionTotal: number;
  weeklyContribution?: number;
  createdAt: number;
  updatedAt: number;
};

export type GuildMessage = {
  id: string;
  guildId: string;
  authorId: string;
  content: string;
  createdAt: number;
  user?: { id: string; nickname: string };
  system?: boolean;
  timestamp?: number;
  text?: string;
};

export type GuildMission = {
  id: string;
  guildId: string;
  missionType: string;
  status: 'active' | 'completed' | 'expired';
  title?: string;
  description?: string;
  target?: number;
  progress?: any;
  progressKey?: string;
  personalReward?: { guildCoins?: number };
  guildReward?: { guildXp?: number };
  claimedBy?: string[];
  resetAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type GuildShop = {
  id: string;
  guildId: string;
  itemTemplateId: string;
  price: number;
  stock: number; // -1 means unlimited
  purchasedBy?: string[];
  createdAt: number;
  updatedAt: number;
};

export type GuildDonation = {
  id: string;
  guildId: string;
  userId: string;
  amount: number;
  itemId?: string;
  createdAt: number;
};

export type GuildWar = {
  id: string;
  guild1Id: string;
  guild2Id: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  startTime?: number;
  endTime?: number;
  result?: {
    winnerId: string;
    guild1Score: number;
    guild2Score: number;
  };
  createdAt: number;
  updatedAt: number;
};

// --- Guild Research & Boss Types ---
export enum GuildResearchCategory {
    development = 'development',
    boss = 'boss',
    stats = 'stats',
    rewards = 'rewards',
}

export interface GuildResearchProject {
    image: string;
    category: GuildResearchCategory;
    name: string;
    description: string;
    maxLevel: number;
    baseCost: number;
    costMultiplier: number;
    baseEffect: number;
    effectUnit: '%' | '점' | '명';
    baseTimeHours: number;
    timeIncrementHours: number;
    requiredGuildLevel: number[];
}

export interface GuildBossSkillEffect {
    type: 'damage' | 'hp_percent' | 'heal' | 'debuff';
    value?: [number, number];
    hits?: number;
    debuffType?: 'user_combat_power_reduction_percent' | 'user_heal_reduction_percent';
    debuffValue?: [number, number];
    debuffDuration?: number;
}

export interface GuildBossSkillSubEffect extends GuildBossSkillEffect {}

export interface GuildBossSkill {
    id: string;
    name: string;
    description: string;
    type: 'active' | 'passive';
    image: string;
}

export interface GuildBossActiveSkill extends GuildBossSkill {
    type: 'active';
    checkStat: CoreStat | CoreStat[];
    onSuccess: GuildBossSkillEffect[];
    onFailure: GuildBossSkillEffect[];
}

export interface GuildBossPassiveSkill extends GuildBossSkill {
    type: 'passive';
    passiveTrigger: 'always' | 'every_turn' | 'on_user_heal';
    checkStat?: CoreStat;
    passiveEffect: GuildBossSkillSubEffect[];
    passiveChance?: number;
}

export interface GuildBossInfo {
    id: string;
    name: string;
    description: string;
    image: string;
    maxHp: number;
    hp: number;
    stats: Record<CoreStat, number>;
    skills: (GuildBossActiveSkill | GuildBossPassiveSkill)[];
    strategyGuide: string;
    recommendedStats: CoreStat[];
    recommendedResearch: GuildResearchId[];
}

export type GuildWarMatch = {
  id: string;
  warId: string;
  player1Id: string;
  player2Id: string;
  result?: {
    winnerId: string;
    gameId: string;
  };
  gameId?: string;
  createdAt: number;
  updatedAt: number;
};

export type BattleLogEntry = {
    turn: number;
    icon?: string;
    message: string;
    isUserAction: boolean;
    bossHealingDone?: number;
    damageTaken?: number;
    healingDone?: number;
    debuffsApplied?: string[];
    isCrit?: boolean;
};

export type GuildBossBattleResult = {
    damageDealt: number;
    turnsSurvived: number;
    rewards: { guildCoins: number };
    battleLog: BattleLogEntry[];
    bossHpBefore: number;
    bossHpAfter: number;
    bossMaxHp: number;
    userHp: number;
    maxUserHp: number;
};

export interface MannerEffects {
    maxActionPoints: number;
    actionPointRegenInterval: number;
    goldBonusPercent: number;
    itemDropRateBonus: number;
    mannerActionButtonBonus: number;
    rewardMultiplier: number;
    enhancementSuccessRateBonus: number;
}
