export type HeroClass = 'DK' | 'DW' | 'ELF';

export type ItemSlot =
  | 'weapon'
  | 'shield'
  | 'helm'
  | 'armor'
  | 'pants'
  | 'gloves'
  | 'boots'
  | 'wings';

export type ItemCategory = 'weapon' | 'armor' | 'wings';

export type ItemRarity = 'normal' | 'excellent' | 'ancient';

export type TransportMode = 'wifi' | 'bluetooth';

export type EventType =
  | 'blood_castle'
  | 'chaos_castle'
  | 'kundun_boss'
  | 'free_trade';

export interface MuCharacter {
  id: string;
  name: string;
  classType: HeroClass;
  level: number;
  xp: number;
  xpToNext: number;
  str: number;
  agi: number;
  vit: number;
  ene: number;
  zen: number;
  bless: number;
  soul: number;
  chaos: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  kills: number;
  resets: number;
  updatedAt: string;
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
  originalOwner: string;
  sharedFromSession: string | null;
  acquiredAt: string;
}

export interface SharedLedgerEntry {
  id: string;
  sessionId: string;
  transportMode: TransportMode;
  partnerName: string;
  role: 'host' | 'guest';
  direction: 'sent' | 'received' | 'event_reward';
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
  peerId: string;
  name: string;
  classType: HeroClass;
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
