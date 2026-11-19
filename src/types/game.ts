export type HeroClass = 'DK' | 'DW' | 'ELF' | 'DL' | 'MG';

export type CharacterSex = 'male' | 'female';

export type MapId = 'flaris' | 'robledal' | 'puerto' | 'ceniza';

export type WeatherKind =
  | 'none'
  | 'leaves'
  | 'petals'
  | 'snowfall'
  | 'snow'
  | 'underwater'
  | 'embers'
  | 'sandDust'
  | 'dungeonDust'
  | 'skyClouds';

export type AmbientBedKind =
  | 'none'
  | 'wind'
  | 'water'
  | 'desert'
  | 'dungeon'
  | 'heaven'
  | 'tower';

export type SkillVfxKind =
  | 'slash'
  | 'twisting'
  | 'death_stab'
  | 'rageful_blow'
  | 'bolt'
  | 'evil_spirit'
  | 'ice_storm'
  | 'nova'
  | 'hellfire'
  | 'arrow'
  | 'triple_shot'
  | 'ice_arrow'
  | 'fire_burst'
  | 'fire_scream'
  | 'earthshake'
  | 'raven'
  | 'power_slash'
  | 'gigantic_storm'
  | 'buff';

export type ItemSlot =
  | 'weapon'
  | 'shield'
  | 'helm'
  | 'armor'
  | 'pants'
  | 'gloves'
  | 'boots'
  | 'wings'
  | 'pendant'
  | 'ring1'
  | 'ring2'
  | 'pet';

export type ItemCategory = 'weapon' | 'armor' | 'wings' | 'jewelry' | 'pet';

export type ItemRarity = 'normal' | 'excellent' | 'ancient';

export type TransportMode = 'wifi' | 'bluetooth';

export type EventType =
  | 'blood_castle'
  | 'chaos_castle'
  | 'kundun_boss'
  | 'free_trade';

export interface MuAccount {
  id: string;
  username: string;
  passwordHash: string;
  secretQ1: string;
  secretA1: string;
  secretQ2: string;
  secretA2: string;
  updatedAt: number;
  isSynced: boolean;
  createdAt: string;
}

export interface MuItem {
  id: string;
  charId: string;
  name: string;
  slot: ItemSlot;
  category: ItemCategory;
  setName: string;
  rarity: ItemRarity;
  enhanceLevel: number;
  minDmg: number;
  maxDmg: number;
  defense: number;
  magicPower: number;
  luck: boolean;
  excellentOpt: string;
  isEquipped: boolean;
  durability?: number; // Missing values in old saves mean 100%.
  originalOwner: string;
  sharedFromSession: string | null;
  acquiredAt: string;
}

export type CharacterVariantKey = `${HeroClass}_${CharacterSex}`;

export interface MuCharacter {
  id: string;
  accountId: string;
  name: string;
  class: HeroClass;
  classType: HeroClass;
  sex?: CharacterSex; // Backward compatible with old characters.
  level: number;
  xp: number;
  xpToNext: number;
  unspentPoints: number;
  skillPoints?: number;
  skillLevels?: Record<string, number>;
  specialization?: 'balanced' | 'berserk' | 'guardian' | 'arcane';
  unlockedAchievements?: string[];
  duelWins?: number;
  duelLosses?: number;
  currentMapId: MapId;
  str: number;
  agi: number;
  vit: number;
  ene: number;
  cmd: number;
  zen: number;
  bless: number;
  soul: number;
  chaos: number;
  life: number;
  creation: number;
  harmony: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sd: number;
  maxSd: number;
  ag: number;
  maxAg: number;
  kills: number;
  resets: number;
  lastX?: number;
  lastZ?: number;
  lastRotY?: number;
  equipment: MuItem[];
  inventory: MuItem[];
  updatedAt: number;
  isSynced: boolean;
}

export interface SkillDef {
  id: string;
  openMuSkillId: number;
  classType: HeroClass;
  name: string;
  shortName: string;
  description: string;
  mpCost: number;
  agCost: number;
  cooldownSec?: number;
  damageMultiplier: number;
  range: number;
  isAoe: boolean;
  isBuff?: boolean;
  vfx: SkillVfxKind;
  colorHex: number;
  badgeColor: string;
}

export interface CharacterComboConfig {
  defaultSkillId: string;
  comboSkillIds: [string, string, string];
}

export type HudButtonId =
  | 'joystick'
  | 'attack'
  | 'combo'
  | 'jump'
  | 'skillTray'
  | 'potion'
  | 'loot'
  | 'inventory'
  | 'mapWarp'
  | 'stats'
  | 'sync'
  | 'settings';

export interface ButtonLayoutItem {
  id: HudButtonId;
  label: string;
  xPct: number;
  yPct: number;
  scale: number;
}

export interface GameSettings {
  brightness: number; // 0.6 to 1.6
  volume: number; // SFX 0 to 1
  muted: boolean; // SFX mute
  musicEnabled: boolean;
  musicVolume: number; // 0 to 1
  free3dCamera: boolean;
  cameraDistance?: number; // 4.5 to 14m third-person distance
  autoAimAssist?: boolean; // 80% auto-aim toggle (default true)
  targetFps: 30 | 45 | 60;
}

export interface ActiveEffect {
  id: string;
  name: string;
  kind: 'buff' | 'debuff';
  statHint: string;
  color: string;
  remainingSec: number;
  totalSec: number;
  atkBonusPct?: number;
  defBonusPct?: number;
  critBonusPct?: number;
  speedBonusPct?: number;
}

export interface MonsterPowerDef {
  id: string;
  name: string;
  damageMultiplier: number;
  range: number;
  cooldownSec: number;
  colorHex: string;
  effectDebuff?: string;
}

export interface ScaledMonsterStats {
  name: string;
  archetype: MonsterArchetype;
  baseLevel: number;
  scaledLevel: number;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  xp: number;
  zen: number;
  isBoss: boolean;
  powers: MonsterPowerDef[];
  damageTable: {
    basicAttack: number;
    specialPower: number;
    criticalHit: number;
    critChancePct: number;
    critMultiplier: number;
    playerEstNormal: number;
    playerEstCrit: number;
  };
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: 'combat' | 'progression' | 'forge' | 'multiplayer' | 'exploration';
  targetValue: number;
  rewardZen: number;
  rewardBless: number;
  rewardSkillPoints: number;
  metricKey: 'kills' | 'level' | 'skillRanks' | 'duelWins' | 'trades' | 'enhanceMax' | 'events';
}

export interface AsyncDuelChallenge {
  id: string;
  challengerId: string;
  challengerName: string;
  variantKey: CharacterVariantKey;
  level: number;
  combatPower: number;
  attack: number;
  defense: number;
  magic: number;
  maxHp: number;
  critChance: number;
  avgSkillMult: number;
  transport: TransportMode;
  topWeapon: string;
  createdAt: string;
}

export interface AsyncDuelRecord {
  id: string;
  challengerName: string;
  opponentName: string;
  opponentVariant: CharacterVariantKey;
  opponentLevel: number;
  transportMode: TransportMode;
  won: boolean;
  rounds: number;
  damageDealt: number;
  damageTaken: number;
  rewardZen: number;
  summary: string;
  roundLog: string[];
  createdAt: string;
}

export interface SharedLedgerEntry {
  id: string;
  sessionId: string;
  transportMode: TransportMode;
  partnerName: string;
  role: 'host' | 'guest';
  direction: 'sent' | 'received' | 'event_reward' | 'duel_reward';
  itemId: string;
  itemName: string;
  itemSnapshotJson: string;
  status: 'committed';
  createdAt: string;
}

export interface EventSessionRecord {
  id: string;
  sessionCode: string;
  eventType: EventType;
  hostName: string;
  transportMode: TransportMode;
  startedAt: string;
  endedAt: string | null;
  wavesCleared: number;
  bossDefeated: boolean;
  lootSummary: string;
}

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: string;
}

export interface RoomPeer {
  currentMapId?: MapId;
  equipment?: MuItem[];
  peerId: string;
  name: string;
  classType: HeroClass;
  sex?: CharacterSex; // Backward compatible with old characters.
  level: number;
  role: 'host' | 'guest';
  transport: TransportMode;
  x: number;
  z: number;
  rotY: number;
  action: 'idle' | 'move' | 'attack' | 'skill';
  equippedSet: string;
  equippedWeapon: string;
  enhanceLevel: number;
}

export interface RoomState {
  code: string;
  eventType: EventType;
  hostPeerId: string;
  hostName: string;
  transport: TransportMode;
  activeEvent: boolean;
  eventWave: number;
  bossHp: number;
  bossMaxHp: number;
  peers: RoomPeer[];
  sharedFeed: SharedLedgerEntry[];
}

export interface BuildAnalysisResult {
  combatRating: string;
  upgradePriority: string;
  statAdvice: string;
  eventReadiness: string;
  recommendations: string[];
}

export type MonsterArchetype =
  | 'dragon'
  | 'hound'
  | 'bull'
  | 'skeleton'
  | 'gorgon'
  | 'yeti'
  | 'ice_queen'
  | 'goblin'
  | 'golem'
  | 'shadow'
  | 'balrog'
  | 'hydra'
  | 'mutant'
  | 'phoenix'
  | 'mech'
  | 'selupan'
  | 'lava_giant'
  | 'boss';

export interface MapMonsterDef {
  name: string;
  archetype: MonsterArchetype;
  level: number;
  hp: number;
  damage: number;
  xp: number;
  zen: number;
  x: number;
  z: number;
  isBoss?: boolean;
}

export type NpcRole = 'blacksmith' | 'potions' | 'wizard' | 'elf' | 'chaos_goblin' | 'guard';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  role: NpcRole;
  x: number;
  z: number;
  robeColor: number;
  accentColor: number;
}

export type GroundTheme =
  | 'cobble'
  | 'dungeon'
  | 'snow'
  | 'grass'
  | 'tower'
  | 'arena'
  | 'underwater'
  | 'sand'
  | 'cloud'
  | 'aida'
  | 'kanturu'
  | 'elbeland'
  | 'raklion'
  | 'vulcanus';

export interface MuMapConfig {
  assetWorld?: 'flyff';
  spawn?: { x: number; z: number };
  id: MapId;
  worldIndex: number;
  name: string;
  subtitle: string;
  sizeMeters: number; // e.g., 1000..1264 => 1.00 km² .. 1.60 km²
  areaKm2: number;
  cityRadius: number; // Safe capital zone radius in meters (e.g., 95m)
  targetMonsterCount: number; // <= 50,000 monsters outside capital city
  floraModel: string;
  minLevel: number;
  maxLevel: number;
  warpZen: number;
  weather: WeatherKind;
  ambientBed: AmbientBedKind;
  musicTheme: string;
  groundTheme: GroundTheme;
  skyTopHex: number;
  skyHorizonHex: number;
  fogHex: number;
  fogDensity: number;
  ev: number;
  whiteBalance: [number, number, number];
  groundTintHex: number;
  cityGroundTintHex: number;
  ambientLightHex: number;
  sunLightHex: number;
  npcs: NpcDef[];
  monsters: MapMonsterDef[];
}

export interface ShopItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  category: ItemCategory;
  setName: string;
  rarity: ItemRarity;
  enhanceLevel: number;
  minDmg: number;
  maxDmg: number;
  defense: number;
  magicPower: number;
  excellentOpt: string;
  zenCost: number;
  classFilter?: HeroClass[];
  vendorRoles: NpcRole[];
}

export interface FloatingDamageNumber {
  id: number;
  text: string;
  color: string;
  xPct: number;
  yPct: number;
  isCritical?: boolean;
}

export interface SyncStatusInfo {
  isOnline: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastMessage: string | null;
}
