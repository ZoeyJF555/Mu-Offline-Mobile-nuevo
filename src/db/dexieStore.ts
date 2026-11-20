import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_BUTTON_LAYOUTS,
  MU_CLASSES,
  MU_SKILLS,
  getDefaultComboConfig,
  getStarterItemsForMuClass,
} from '../data/muSkillsAndClasses';
import { MU_CHAOS_WINGS_RECIPES } from '../data/muWorldData';
import type {
  AsyncDuelRecord,
  ButtonLayoutItem,
  CharacterComboConfig,
  ChatMessageRecord,
  EventSessionRecord,
  GameSettings,
  HeroClass,
  CharacterSex,
  HudButtonId,
  MuAccount,
  MuCharacter,
  MuItem,
  SharedLedgerEntry,
  ShopItemDef,
} from '../types/game';
import {
  MAX_HERO_LEVEL,
  MAX_STAT_POINTS,
  POINTS_PER_LEVEL,
  getSkillRank,
  getSkillUpgradeCost,
  getXpRequiredForLevel,
} from '../game/combatAndProgression';
import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_LOOT_FILTERS,
  DEFAULT_POTION_CONFIG,
  type LootFilterSettings,
  type PotionConfig,
} from '../game/worldPhysicsMath';
import type { MapId } from '../types/game';

interface KvSettingRow {
  key: string;
  valueJson: string;
}

class MuLorenciaDexieDB extends Dexie {
  Accounts!: Table<MuAccount, string>;
  Characters!: Table<MuCharacter, string>;
  KvSettings!: Table<KvSettingRow, string>;
  SharedLedger!: Table<SharedLedgerEntry, string>;
  EventSessions!: Table<EventSessionRecord, string>;
  ChatMessages!: Table<ChatMessageRecord, string>;
  DuelRecords!: Table<AsyncDuelRecord, string>;

  constructor() {
    super('MuLorenciaOfflineDB');
    this.version(1).stores({
      Accounts: 'id, &username, updatedAt, isSynced',
      Characters: 'id, accountId, name, class, level, updatedAt, isSynced',
      KvSettings: 'key',
      SharedLedger: 'id, createdAt',
      EventSessions: 'id, startedAt',
      ChatMessages: 'id, createdAt',
    });
    this.version(2).stores({
      Accounts: 'id, &username, updatedAt, isSynced',
      Characters: 'id, accountId, name, class, level, updatedAt, isSynced',
      KvSettings: 'key',
      SharedLedger: 'id, createdAt',
      EventSessions: 'id, startedAt',
      ChatMessages: 'id, createdAt',
      DuelRecords: 'id, createdAt',
    });
  }
}

export const db = new MuLorenciaDexieDB();

export function hashPassword(pwd: string): string {
  let h = 2166136261;
  for (let i = 0; i < pwd.length; i++) {
    h ^= pwd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `mu6_${(h >>> 0).toString(16)}`;
}

export function normalizeSecretAnswer(ans: string): string {
  return ans.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hashSecretAnswer(ans: string): string {
  return hashPassword(`sec:${normalizeSecretAnswer(ans)}`);
}

let initPromise: Promise<void> | null = null;
let onMutatedCallback: (() => void) | null = null;

export function setOnLocalMutationListener(cb: (() => void) | null) {
  onMutatedCallback = cb;
}

function notifyMutated() {
  if (onMutatedCallback) {
    onMutatedCallback();
  }
}

export async function initDexie(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await db.open();
    const accCount = await db.Accounts.count();
    if (accCount === 0) {
      const now = Date.now();
      await db.Accounts.put({
        id: 'acc-local',
        username: 'lorencia',
        passwordHash: hashPassword('123456'),
        secretQ1: '¿Nombre de la ciudad inicial de MU?',
        secretA1: hashSecretAnswer('lorencia'),
        secretQ2: '¿Color de la joya Jewel of Bless?',
        secretA2: hashSecretAnswer('rojo'),
        updatedAt: now,
        isSynced: false,
        createdAt: new Date(now).toISOString(),
      });
    }

    const charCount = await db.Characters.count();
    if (charCount === 0) {
      await seedCharacterInternal('acc-local', 'GuerreroLorencia', 'DK');
    }
  })();
  return initPromise;
}

async function seedCharacterInternal(
  accountId: string,
  name: string,
  classType: HeroClass,
  sex: CharacterSex = 'male',
): Promise<MuCharacter> {
  const cls = MU_CLASSES.find((c) => c.id === classType) || MU_CLASSES[0];
  const charId = `chr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const starterItems = getStarterItemsForMuClass(charId, name, classType);
  const equipment = starterItems.filter((i) => i.isEquipped);
  const inventory = starterItems.filter((i) => !i.isEquipped);

  const charObj: MuCharacter = {
    id: charId,
    accountId,
    name,
    class: classType,
    classType,
    sex,
    level: 1,
    xp: 0,
    xpToNext: getXpRequiredForLevel(1),
    unspentPoints: POINTS_PER_LEVEL,
    skillPoints: 2,
    skillLevels: {},
    specialization: 'balanced',
    unlockedAchievements: [],
    duelWins: 0,
    duelLosses: 0,
    currentMapId: 'flaris',
    str: cls.baseStats.str,
    agi: cls.baseStats.agi,
    vit: cls.baseStats.vit,
    ene: cls.baseStats.ene,
    cmd: cls.baseStats.cmd,
    zen: 45000,
    bless: 8,
    soul: 8,
    chaos: 3,
    life: 2,
    creation: 1,
    harmony: 1,
    talisman: 0,
    hp: cls.baseStats.maxHp,
    maxHp: cls.baseStats.maxHp,
    mp: cls.baseStats.maxMp,
    maxMp: cls.baseStats.maxMp,
    sd: cls.baseStats.maxSd,
    maxSd: cls.baseStats.maxSd,
    ag: cls.baseStats.maxAg,
    maxAg: cls.baseStats.maxAg,
    kills: 0,
    resets: 0,
    equipment,
    inventory,
    updatedAt: now,
    isSynced: false,
  };

  await db.Characters.put(charObj);
  return charObj;
}

const VALID_MAP_IDS = new Set<MapId>(['flaris', 'robledal', 'puerto', 'ceniza']);

function stripBuggedStarterWings(items?: MuItem[]): MuItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item) => !(item.slot === 'wings' && (item.id.endsWith('-wg1') || item.name === 'Alas de Ángel +7')),
  );
}

export function normalizeCharacterRecord(c: MuCharacter): MuCharacter {
  const safeMap: MapId = VALID_MAP_IDS.has(c.currentMapId as MapId) ? (c.currentMapId as MapId) : 'flaris';
  const expectedXp = c.level >= MAX_HERO_LEVEL ? Math.max(1, c.xpToNext || 1) : getXpRequiredForLevel(c.level);
  const safeXp = c.level >= MAX_HERO_LEVEL ? 0 : Math.min(c.xp, Math.max(0, expectedXp - 1));
  return {
    ...c,
    currentMapId: safeMap,
    sex: c.sex ?? 'male',
    xp: safeXp,
    xpToNext: expectedXp,
    talisman: c.talisman ?? 0,
    skillPoints: c.skillPoints ?? Math.max(2, c.level),
    skillLevels: c.skillLevels ?? {},
    specialization: c.specialization ?? 'balanced',
    unlockedAchievements: c.unlockedAchievements ?? [],
    duelWins: c.duelWins ?? 0,
    duelLosses: c.duelLosses ?? 0,
    equipment: stripBuggedStarterWings(c.equipment),
    inventory: stripBuggedStarterWings(c.inventory),
  };
}

function combineCharItems(c: MuCharacter): MuItem[] {
  const eq = stripBuggedStarterWings(c.equipment).map((i) => ({ ...i, isEquipped: true }));
  const inv = stripBuggedStarterWings(c.inventory).map((i) => ({ ...i, isEquipped: false }));
  return [...eq, ...inv];
}

function splitCharItems(items: MuItem[]): { equipment: MuItem[]; inventory: MuItem[] } {
  const equipment = items.filter((i) => i.isEquipped);
  const inventory = items.filter((i) => !i.isEquipped);
  return { equipment, inventory };
}

// --- Accounts CRUD & Auth ---

export async function listAccounts(): Promise<MuAccount[]> {
  await initDexie();
  return db.Accounts.orderBy('updatedAt').reverse().toArray();
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<{ ok: true; account: MuAccount } | { ok: false; error: string }> {
  await initDexie();
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser || !password) {
    return { ok: false, error: 'Ingresa usuario y contraseña.' };
  }
  const account = await db.Accounts.where('username').equals(cleanUser).first();
  if (!account) {
    return { ok: false, error: 'Cuenta no encontrada en este dispositivo.' };
  }
  if (account.passwordHash !== hashPassword(password)) {
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  return { ok: true, account };
}

export async function registerAccount(input: {
  username: string;
  password: string;
  secretQ1: string;
  secretA1: string;
  secretQ2: string;
  secretA2: string;
}): Promise<{ ok: true; account: MuAccount } | { ok: false; error: string }> {
  await initDexie();
  const cleanUser = input.username.trim().toLowerCase();
  if (cleanUser.length < 3) {
    return { ok: false, error: 'El usuario debe tener al menos 3 caracteres.' };
  }
  if (input.password.length < 4) {
    return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
  }
  if (!input.secretQ1.trim() || !input.secretA1.trim() || !input.secretQ2.trim() || !input.secretA2.trim()) {
    return { ok: false, error: 'Debes completar obligatoriamente las 2 preguntas secretas y sus respuestas.' };
  }

  const existing = await db.Accounts.where('username').equals(cleanUser).first();
  if (existing) {
    return { ok: false, error: 'Ese ID de cuenta ya existe en el dispositivo.' };
  }

  const now = Date.now();
  const account: MuAccount = {
    id: `acc-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    username: cleanUser,
    passwordHash: hashPassword(input.password),
    secretQ1: input.secretQ1.trim(),
    secretA1: hashSecretAnswer(input.secretA1),
    secretQ2: input.secretQ2.trim(),
    secretA2: hashSecretAnswer(input.secretA2),
    updatedAt: now,
    isSynced: false,
    createdAt: new Date(now).toISOString(),
  };

  await db.Accounts.put(account);
  notifyMutated();
  return { ok: true, account };
}

export async function changeAccountPassword(
  username: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await initDexie();
  const cleanUser = username.trim().toLowerCase();
  if (newPassword.length < 4) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos 4 caracteres.' };
  }
  const account = await db.Accounts.where('username').equals(cleanUser).first();
  if (!account) {
    return { ok: false, error: 'No se encontró esa cuenta localmente.' };
  }
  if (account.passwordHash !== hashPassword(oldPassword)) {
    return { ok: false, error: 'La contraseña actual no coincide.' };
  }

  await db.Accounts.update(account.id, {
    passwordHash: hashPassword(newPassword),
    updatedAt: Date.now(),
    isSynced: false,
  });
  notifyMutated();
  return { ok: true };
}

export async function getLocalRecoveryQuestions(
  username: string,
): Promise<{ found: true; secretQ1: string; secretQ2: string } | { found: false }> {
  await initDexie();
  const cleanUser = username.trim().toLowerCase();
  const account = await db.Accounts.where('username').equals(cleanUser).first();
  if (!account) return { found: false };
  return { found: true, secretQ1: account.secretQ1, secretQ2: account.secretQ2 };
}

export async function recoverAccountLocal(
  username: string,
  answer1: string,
  answer2: string,
  newPassword: string,
): Promise<{ ok: true; account: MuAccount } | { ok: false; error: string }> {
  await initDexie();
  const cleanUser = username.trim().toLowerCase();
  if (newPassword.length < 4) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos 4 caracteres.' };
  }
  const account = await db.Accounts.where('username').equals(cleanUser).first();
  if (!account) {
    return { ok: false, error: 'Cuenta no encontrada localmente.' };
  }
  if (
    account.secretA1 !== hashSecretAnswer(answer1) ||
    account.secretA2 !== hashSecretAnswer(answer2)
  ) {
    return { ok: false, error: 'Las respuestas secretas no coinciden.' };
  }

  const updated: MuAccount = {
    ...account,
    passwordHash: hashPassword(newPassword),
    updatedAt: Date.now(),
    isSynced: false,
  };
  await db.Accounts.put(updated);
  notifyMutated();
  return { ok: true, account: updated };
}

// --- Characters & Items ---

export async function listCharactersByAccount(accountId: string): Promise<MuCharacter[]> {
  await initDexie();
  const chars = await db.Characters.where('accountId').equals(accountId).toArray();
  return chars.map(normalizeCharacterRecord).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createCharacterForAccount(
  accountId: string,
  name: string,
  classType: HeroClass,
  sex: CharacterSex = 'male',
): Promise<MuCharacter> {
  await initDexie();
  const charObj = await seedCharacterInternal(
    accountId,
    name.trim().slice(0, 16) || 'GuerreroMU',
    classType,
    sex,
  );
  notifyMutated();
  return charObj;
}

export async function updateCharacter(char: MuCharacter): Promise<MuCharacter> {
  await initDexie();
  const stamped: MuCharacter = {
    ...char,
    class: char.classType,
    updatedAt: Date.now(),
    isSynced: false,
  };
  // Item mutations own the inventory arrays. Stat saves may contain older snapshots.
  return db.transaction('rw', db.Characters, async () => {
    const latest = await db.Characters.get(char.id);
    if (latest) { stamped.equipment = latest.equipment; stamped.inventory = latest.inventory; }
    await db.Characters.put(stamped);
    notifyMutated();
    return stamped;
  });
}

export async function getItemsForCharacter(charId: string): Promise<MuItem[]> {
  await initDexie();
  const char = await db.Characters.get(charId);
  if (!char) return [];
  return combineCharItems(char);
}

export async function saveItemsForCharacter(charId: string, items: MuItem[]): Promise<MuItem[]> {
  await initDexie();
  const saved = await db.transaction('rw', db.Characters, async () => {
    const char = await db.Characters.get(charId);
    if (!char) return items;
    // Wear/repair own durability; equip/trade/upgrade snapshots must preserve it.
    const latest = new Map(combineCharItems(char).map(i => [i.id, i]));
    const merged = items.map(i => ({ ...i, durability: latest.get(i.id)?.durability ?? i.durability }));
    const { equipment, inventory } = splitCharItems(merged);
    await db.Characters.put({ ...char, equipment, inventory, updatedAt: Date.now(), isSynced: false });
    return combineCharItems({ ...char, equipment, inventory });
  });
  notifyMutated(); return saved;
}

export async function addItemToCharacter(charId: string, item: MuItem): Promise<MuItem[]> {
  const current = await getItemsForCharacter(charId);
  const next = [...current, { ...item, charId }];
  return saveItemsForCharacter(charId, next);
}

export async function removeItemFromCharacter(charId: string, itemId: string): Promise<MuItem[]> {
  const current = await getItemsForCharacter(charId);
  return saveItemsForCharacter(
    charId,
    current.filter((i) => i.id !== itemId),
  );
}

export async function wearEquipment(charId: string, slot: string, durability: number, itemId?: string): Promise<void> {
  await initDexie();
  await db.transaction('rw', db.Characters, async () => {
    await db.Characters.where('id').equals(charId).modify(c => {
      c.equipment = c.equipment.map(i => i.slot === slot && (!itemId || i.id === itemId) ? { ...i, durability: Math.min(i.durability ?? 100, durability) } : i);
      c.updatedAt = Date.now(); c.isSynced = false;
    });
  });
  notifyMutated();
}

export async function repairEquipment(charId: string): Promise<MuCharacter> {
  await initDexie();
  const char = await db.transaction('rw', db.Characters, async () => {
    const c = await db.Characters.get(charId);
    if (!c) throw new Error('Personaje no encontrado');
    const cost = c.equipment.reduce((sum, i) => sum + (100 - (i.durability ?? 100)), 0);
    if (c.zen < cost) throw new Error(`Necesitas ${cost} Zen para reparar el equipo`);
    const updated = { ...c, zen: c.zen - cost, equipment: c.equipment.map(i => ({...i, durability:100})), updatedAt: Date.now(), isSynced:false };
    await db.Characters.put(updated);return updated;
  });
  notifyMutated(); return char;
}

export async function equipItem(charId: string, itemId: string): Promise<MuItem[]> {
  const current = await getItemsForCharacter(charId);
  const target = current.find((i) => i.id === itemId);
  if (!target) return current;
  const next = current.map((i) => {
    if (i.id === itemId) return { ...i, isEquipped: !target.isEquipped };
    if (i.slot === target.slot && i.isEquipped) return { ...i, isEquipped: false };
    return i;
  });
  return saveItemsForCharacter(charId, next);
}

export async function allocateStatPoint(
  char: MuCharacter,
  stat: 'str' | 'agi' | 'vit' | 'ene' | 'cmd',
  amount = 1,
): Promise<{ ok: boolean; character: MuCharacter; message?: string }> {
  const currentVal = char[stat] ?? 0;
  if (currentVal >= MAX_STAT_POINTS) {
    return { ok: false, character: char, message: `Este atributo ya llegó al máximo de ${MAX_STAT_POINTS.toLocaleString()} puntos.` };
  }
  const actualAmount = Math.min(amount, char.unspentPoints, MAX_STAT_POINTS - currentVal);
  if (actualAmount <= 0) {
    return { ok: false, character: char, message: 'No tienes puntos libres suficientes.' };
  }
  const updated: MuCharacter = {
    ...char,
    unspentPoints: char.unspentPoints - actualAmount,
    str: stat === 'str' ? Math.min(MAX_STAT_POINTS, char.str + actualAmount) : char.str,
    agi: stat === 'agi' ? Math.min(MAX_STAT_POINTS, char.agi + actualAmount) : char.agi,
    vit: stat === 'vit' ? Math.min(MAX_STAT_POINTS, char.vit + actualAmount) : char.vit,
    ene: stat === 'ene' ? Math.min(MAX_STAT_POINTS, char.ene + actualAmount) : char.ene,
    cmd: stat === 'cmd' ? Math.min(MAX_STAT_POINTS, char.cmd + actualAmount) : char.cmd,
    maxHp: stat === 'vit' ? char.maxHp + actualAmount * 8 : char.maxHp,
    hp: stat === 'vit' ? char.hp + actualAmount * 8 : char.hp,
    maxMp: stat === 'ene' ? char.maxMp + actualAmount * 6 : char.maxMp,
    mp: stat === 'ene' ? char.mp + actualAmount * 6 : char.mp,
    maxSd: stat === 'vit' || stat === 'agi' ? char.maxSd + actualAmount * 4 : char.maxSd,
    sd: stat === 'vit' || stat === 'agi' ? char.sd + actualAmount * 4 : char.sd,
  };
  const saved = await updateCharacter(updated);
  return { ok: true, character: normalizeCharacterRecord(saved) };
}

export async function performHeroReset(
  char: MuCharacter,
): Promise<{ ok: boolean; character: MuCharacter; message: string }> {
  if (char.level < MAX_HERO_LEVEL) {
    return {
      ok: false,
      character: char,
      message: `Necesitas llegar a Nivel ${MAX_HERO_LEVEL} para hacer Reset (actual: Nv.${char.level}).`,
    };
  }
  const nextResets = (char.resets ?? 0) + 1;
  const resetBonusPoints = 15;
  const updated: MuCharacter = {
    ...char,
    level: 1,
    xp: 0,
    xpToNext: getXpRequiredForLevel(1),
    resets: nextResets,
    unspentPoints: (char.unspentPoints ?? 0) + resetBonusPoints,
    hp: char.maxHp,
    mp: char.maxMp,
    sd: char.maxSd,
    ag: char.maxAg,
  };
  const saved = await updateCharacter(updated);
  return {
    ok: true,
    character: normalizeCharacterRecord(saved),
    message: `¡Reset #${nextResets} completado! Volviste a Nivel 1 conservando todos tus atributos (+${resetBonusPoints} pts extra).`,
  };
}

export async function upgradeSkillRank(
  char: MuCharacter,
  skillId: string,
): Promise<{ ok: boolean; character: MuCharacter; message: string }> {
  const norm = normalizeCharacterRecord(char);
  const currentRank = getSkillRank(norm, skillId);
  if (currentRank >= 10) {
    return { ok: false, character: norm, message: 'Esta habilidad ya alcanzó el rango máximo (Nv.10).' };
  }
  const cost = getSkillUpgradeCost(currentRank);
  if ((norm.skillPoints ?? 0) < cost.skillPoints) {
    return {
      ok: false,
      character: norm,
      message: `Necesitas ${cost.skillPoints} punto(s) de habilidad. Sube de nivel o completa logros.`,
    };
  }
  if (norm.zen < cost.zenCost) {
    return {
      ok: false,
      character: norm,
      message: `Zen insuficiente (requiere ${cost.zenCost.toLocaleString()} Zen).`,
    };
  }
  const nextRank = currentRank + 1;
  const updated: MuCharacter = {
    ...norm,
    skillPoints: (norm.skillPoints ?? 0) - cost.skillPoints,
    zen: norm.zen - cost.zenCost,
    skillLevels: { ...(norm.skillLevels ?? {}), [skillId]: nextRank },
  };
  const saved = await updateCharacter(updated);
  return {
    ok: true,
    character: normalizeCharacterRecord(saved),
    message: `Habilidad mejorada a Rango ${nextRank}/10.`,
  };
}

export async function setCharacterSpecialization(
  char: MuCharacter,
  specialization: NonNullable<MuCharacter['specialization']>,
): Promise<MuCharacter> {
  const norm = normalizeCharacterRecord(char);
  const saved = await updateCharacter({ ...norm, specialization });
  return normalizeCharacterRecord(saved);
}

export async function upgradeItemWithJewel(
  char: MuCharacter,
  itemId: string,
  jewel: 'bless' | 'soul' | 'life' | 'harmony',
): Promise<{ success: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const currentItems = await getItemsForCharacter(char.id);
  const target = currentItems.find((i) => i.id === itemId);
  if (!target) {
    return { success: false, message: 'Ítem no encontrado.', character: char, items: currentItems };
  }

  if (jewel === 'bless') {
    if (char.bless <= 0) {
      return { success: false, message: 'No tienes Jewel of Bless suficientes.', character: char, items: currentItems };
    }
    if (target.enhanceLevel >= 6) {
      return { success: false, message: 'Bless sube hasta +6. Usa Soul para +7 a +13.', character: char, items: currentItems };
    }
    const nextLvl = target.enhanceLevel + 1;
    const nextItems = currentItems.map((i) =>
      i.id === itemId
        ? {
            ...i,
            enhanceLevel: nextLvl,
            minDmg: i.minDmg > 0 ? i.minDmg + 4 : 0,
            maxDmg: i.maxDmg > 0 ? i.maxDmg + 6 : 0,
            defense: i.defense > 0 ? i.defense + 4 : 0,
            magicPower: i.magicPower > 0 ? i.magicPower + 5 : 0,
          }
        : i,
    );
    const savedChar = await updateCharacter({ ...char, bless: char.bless - 1 });
    const savedItems = await saveItemsForCharacter(char.id, nextItems);
    return {
      success: true,
      message: `¡${target.name} mejorado a +${nextLvl} con Jewel of Bless!`,
      character: savedChar,
      items: savedItems,
    };
  }

  if (jewel === 'soul') {
    if (char.soul <= 0) {
      return { success: false, message: 'No tienes Jewel of Soul suficientes.', character: char, items: currentItems };
    }
    if (target.enhanceLevel >= 13) {
      return { success: false, message: 'Usa Jewel of Harmony para refinar de +13 a +15.', character: char, items: currentItems };
    }
    const rate = target.luck ? 0.78 : 0.6;
    const success = Math.random() <= rate;
    const nextLvl = success ? target.enhanceLevel + 1 : Math.max(0, target.enhanceLevel - 1);
    const nextItems = currentItems.map((i) =>
      i.id === itemId
        ? {
            ...i,
            enhanceLevel: nextLvl,
            minDmg: i.minDmg > 0 ? Math.max(4, i.minDmg + (success ? 6 : -4)) : 0,
            maxDmg: i.maxDmg > 0 ? Math.max(8, i.maxDmg + (success ? 8 : -6)) : 0,
            defense: i.defense > 0 ? Math.max(4, i.defense + (success ? 5 : -3)) : 0,
            magicPower: i.magicPower > 0 ? Math.max(0, i.magicPower + (success ? 7 : -4)) : 0,
          }
        : i,
    );
    const savedChar = await updateCharacter({ ...char, soul: char.soul - 1 });
    const savedItems = await saveItemsForCharacter(char.id, nextItems);
    return {
      success,
      message: success
        ? `¡Éxito! ${target.name} subió a +${nextLvl} con Jewel of Soul.`
        : `Falló Jewel of Soul: ${target.name} bajó a +${nextLvl}.`,
      character: savedChar,
      items: savedItems,
    };
  }

  if (jewel === 'life') {
    if (char.life <= 0) {
      return { success: false, message: 'No tienes Jewel of Life.', character: char, items: currentItems };
    }
    const nextItems = currentItems.map((i) =>
      i.id === itemId
        ? {
            ...i,
            minDmg: i.minDmg > 0 ? i.minDmg + 6 : 0,
            maxDmg: i.maxDmg > 0 ? i.maxDmg + 8 : 0,
            defense: i.defense > 0 ? i.defense + 6 : 0,
            magicPower: i.magicPower > 0 ? i.magicPower + 6 : 0,
            excellentOpt: i.excellentOpt.includes('+16') ? i.excellentOpt : `${i.excellentOpt} · Adicional +16`.trim(),
          }
        : i,
    );
    const savedChar = await updateCharacter({ ...char, life: char.life - 1 });
    const savedItems = await saveItemsForCharacter(char.id, nextItems);
    return {
      success: true,
      message: `¡Jewel of Life aplicada! ${target.name} ganó opción adicional.`,
      character: savedChar,
      items: savedItems,
    };
  }

  // harmony (+13 -> +15)
  if (char.harmony <= 0) {
    return { success: false, message: 'No tienes Jewel of Harmony.', character: char, items: currentItems };
  }
  if (target.enhanceLevel >= 15) {
    return { success: false, message: 'Este ítem ya está al nivel máximo +15.', character: char, items: currentItems };
  }
  const nextLvl = target.enhanceLevel + 1;
  const nextItems = currentItems.map((i) =>
    i.id === itemId
      ? {
          ...i,
          enhanceLevel: nextLvl,
          minDmg: i.minDmg > 0 ? i.minDmg + 9 : 0,
          maxDmg: i.maxDmg > 0 ? i.maxDmg + 12 : 0,
          defense: i.defense > 0 ? i.defense + 8 : 0,
          magicPower: i.magicPower > 0 ? i.magicPower + 10 : 0,
        }
      : i,
  );
  const savedChar = await updateCharacter({ ...char, harmony: char.harmony - 1 });
  const savedItems = await saveItemsForCharacter(char.id, nextItems);
  return {
    success: true,
    message: `¡Refinamiento Maestro! ${target.name} alcanzó +${nextLvl}.`,
    character: savedChar,
    items: savedItems,
  };
}

export async function buyShopItem(
  char: MuCharacter,
  shopItem: ShopItemDef,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const currentItems = await getItemsForCharacter(char.id);
  if (char.zen < shopItem.zenCost) {
    return {
      ok: false,
      message: `Zen insuficiente. Necesitas ${shopItem.zenCost.toLocaleString()} Zen.`,
      character: char,
      items: currentItems,
    };
  }
  const newItem: MuItem = {
    id: `itm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    charId: char.id,
    name: shopItem.name,
    slot: shopItem.slot,
    category: shopItem.category,
    setName: shopItem.setName,
    rarity: shopItem.rarity,
    enhanceLevel: shopItem.enhanceLevel,
    minDmg: shopItem.minDmg,
    maxDmg: shopItem.maxDmg,
    defense: shopItem.defense,
    magicPower: shopItem.magicPower,
    luck: true,
    excellentOpt: shopItem.excellentOpt,
    isEquipped: false,
    originalOwner: char.name,
    sharedFromSession: null,
    acquiredAt: new Date().toISOString(),
  };
  const savedChar = await updateCharacter({ ...char, zen: char.zen - shopItem.zenCost });
  const savedItems = await addItemToCharacter(char.id, newItem);
  return {
    ok: true,
    message: `Compraste ${shopItem.name} +${shopItem.enhanceLevel} por ${shopItem.zenCost.toLocaleString()} Zen.`,
    character: savedChar,
    items: savedItems,
  };
}

export async function buyJewelFromNpc(
  char: MuCharacter,
  jewel: 'bless' | 'soul' | 'chaos' | 'life' | 'harmony',
  cost: number,
): Promise<{ ok: boolean; message: string; character: MuCharacter }> {
  if (char.zen < cost) {
    return { ok: false, message: 'Zen insuficiente para comprar esta joya.', character: char };
  }
  const updated: MuCharacter = {
    ...char,
    zen: char.zen - cost,
    bless: jewel === 'bless' ? char.bless + 1 : char.bless,
    soul: jewel === 'soul' ? char.soul + 1 : char.soul,
    chaos: jewel === 'chaos' ? char.chaos + 1 : char.chaos,
    life: jewel === 'life' ? char.life + 1 : char.life,
    harmony: jewel === 'harmony' ? char.harmony + 1 : char.harmony,
  };
  const saved = await updateCharacter(updated);
  return { ok: true, message: `Compraste 1 Jewel of ${jewel.toUpperCase()}.`, character: saved };
}

export async function sellInventoryItem(
  char: MuCharacter,
  itemId: string,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const currentItems = await getItemsForCharacter(char.id);
  const target = currentItems.find((i) => i.id === itemId);
  if (!target || target.isEquipped) {
    return { ok: false, message: 'Desequipa el ítem antes de venderlo.', character: char, items: currentItems };
  }
  const refund = 1200 + target.enhanceLevel * 450 + (target.rarity === 'ancient' ? 5000 : target.rarity === 'excellent' ? 2500 : 0);
  const savedItems = await removeItemFromCharacter(char.id, itemId);
  const savedChar = await updateCharacter({ ...char, zen: char.zen + refund });
  return {
    ok: true,
    message: `Vendiste ${target.name} por +${refund.toLocaleString()} Zen.`,
    character: savedChar,
    items: savedItems,
  };
}

export async function executeChaosMixWing(
  char: MuCharacter,
  tier: 2 | 3,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const recipe = MU_CHAOS_WINGS_RECIPES.find((r) => r.tier === tier)!;
  const currentItems = await getItemsForCharacter(char.id);
  if (
    char.bless < recipe.blessCost ||
    char.soul < recipe.soulCost ||
    char.chaos < recipe.chaosCost ||
    char.zen < recipe.zenCost
  ) {
    return {
      ok: false,
      message: `Faltan recursos para Chaos Mix Lv${tier} (${recipe.blessCost} Bless, ${recipe.soulCost} Soul, ${recipe.chaosCost} Chaos, ${recipe.zenCost.toLocaleString()} Zen).`,
      character: char,
      items: currentItems,
    };
  }

  const wingName = recipe.wingNames[char.classType];
  const created: MuItem = {
    id: `wing-${Date.now().toString(36)}`,
    charId: char.id,
    name: wingName,
    slot: 'wings',
    category: 'wings',
    setName: `Lv${tier} Wings`,
    rarity: tier === 3 ? 'ancient' : 'excellent',
    enhanceLevel: tier === 3 ? 13 : 9,
    minDmg: tier === 3 ? 52 : 34,
    maxDmg: tier === 3 ? 52 : 34,
    defense: tier === 3 ? 64 : 42,
    magicPower: tier === 3 ? 52 : 32,
    luck: true,
    excellentOpt: tier === 3 ? 'Ignora Defensa 5% · Absorbe 42% Daño' : 'Ignora Defensa 3% · Absorbe 32% Daño',
    isEquipped: false,
    originalOwner: char.name,
    sharedFromSession: null,
    acquiredAt: new Date().toISOString(),
  };

  const savedChar = await updateCharacter({
    ...char,
    bless: char.bless - recipe.blessCost,
    soul: char.soul - recipe.soulCost,
    chaos: char.chaos - recipe.chaosCost,
    zen: char.zen - recipe.zenCost,
  });
  const savedItems = await addItemToCharacter(char.id, created);
  return {
    ok: true,
    message: `¡Chaos Mix exitoso! Forjaste ${wingName}.`,
    character: savedChar,
    items: savedItems,
  };
}

// --- Settings, Layouts, Combo, Ledger, Events & Chat ---

const DEFAULT_SETTINGS: GameSettings = {
  brightness: 1.08,
  volume: 0.75,
  muted: false,
  musicEnabled: true,
  musicVolume: 0.45,
  free3dCamera: false,
  cameraDistance: DEFAULT_CAMERA_DISTANCE,
  cameraDistanceMigratedV2: true,
  cameraDistanceMigratedV3: true,
  autoAimAssist: true,
  targetFps: 60,
};

export async function loadGameSettings(): Promise<GameSettings> {
  await initDexie();
  const row = await db.KvSettings.get('game_settings');
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.valueJson) as Partial<GameSettings>;
    if (!parsed.cameraDistanceMigratedV3) {
      const migrated: GameSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        cameraDistance:
          typeof parsed.cameraDistance === 'number' && parsed.cameraDistance > 4.4
            ? parsed.cameraDistance
            : DEFAULT_CAMERA_DISTANCE,
        cameraDistanceMigratedV2: true,
        cameraDistanceMigratedV3: true,
      };
      await db.KvSettings.put({ key: 'game_settings', valueJson: JSON.stringify(migrated) });
      return migrated;
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveGameSettings(settings: GameSettings): Promise<void> {
  await initDexie();
  await db.KvSettings.put({
    key: 'game_settings',
    valueJson: JSON.stringify({
      ...settings,
      cameraDistanceMigratedV2: true,
      cameraDistanceMigratedV3: true,
    }),
  });
}

export async function loadLootFilters(): Promise<LootFilterSettings> {
  await initDexie();
  const row = await db.KvSettings.get('loot_filters');
  if (!row) return { ...DEFAULT_LOOT_FILTERS };
  try {
    return { ...DEFAULT_LOOT_FILTERS, ...JSON.parse(row.valueJson) };
  } catch {
    return { ...DEFAULT_LOOT_FILTERS };
  }
}

export async function saveLootFilters(filters: LootFilterSettings): Promise<void> {
  await initDexie();
  await db.KvSettings.put({ key: 'loot_filters', valueJson: JSON.stringify(filters) });
}

export async function loadPotionConfig(): Promise<PotionConfig> {
  await initDexie();
  const row = await db.KvSettings.get('potion_config');
  if (!row) return { ...DEFAULT_POTION_CONFIG };
  try {
    return { ...DEFAULT_POTION_CONFIG, ...JSON.parse(row.valueJson) };
  } catch {
    return { ...DEFAULT_POTION_CONFIG };
  }
}

export async function savePotionConfig(cfg: PotionConfig): Promise<void> {
  await initDexie();
  await db.KvSettings.put({ key: 'potion_config', valueJson: JSON.stringify(cfg) });
}

export async function loadButtonLayouts(): Promise<Record<HudButtonId, ButtonLayoutItem>> {
  await initDexie();
  const row = await db.KvSettings.get('hud_layouts');
  if (!row) return { ...DEFAULT_BUTTON_LAYOUTS };
  try {
    return { ...DEFAULT_BUTTON_LAYOUTS, ...JSON.parse(row.valueJson) };
  } catch {
    return { ...DEFAULT_BUTTON_LAYOUTS };
  }
}

export async function saveButtonLayouts(layouts: Record<HudButtonId, ButtonLayoutItem>): Promise<void> {
  await initDexie();
  await db.KvSettings.put({ key: 'hud_layouts', valueJson: JSON.stringify(layouts) });
}

export async function loadComboConfig(charId: string, classType: HeroClass): Promise<CharacterComboConfig> {
  await initDexie();
  const defCfg = getDefaultComboConfig(classType);
  const validIds = new Set((MU_SKILLS[classType] || MU_SKILLS.DK).map((s) => s.id));
  const row = await db.KvSettings.get(`combo_${charId}`);
  if (!row) return defCfg;
  try {
    const parsed = JSON.parse(row.valueJson) as Partial<CharacterComboConfig>;
    const filtered: string[] = [];
    for (const id of parsed.comboSkillIds || []) {
      if (validIds.has(id) && !filtered.includes(id)) {
        filtered.push(id);
      }
      if (filtered.length >= 5) break;
    }
    for (const fallbackId of defCfg.comboSkillIds) {
      if (filtered.length >= 5) break;
      if (!filtered.includes(fallbackId)) {
        filtered.push(fallbackId);
      }
    }
    return {
      defaultSkillId: parsed.defaultSkillId && validIds.has(parsed.defaultSkillId)
        ? parsed.defaultSkillId
        : defCfg.defaultSkillId,
      comboSkillIds: filtered.slice(0, 5),
    };
  } catch {
    return defCfg;
  }
}

export async function saveComboConfig(charId: string, cfg: CharacterComboConfig): Promise<void> {
  await initDexie();
  await db.KvSettings.put({ key: `combo_${charId}`, valueJson: JSON.stringify(cfg) });
}

export async function getSharedLedger(): Promise<SharedLedgerEntry[]> {
  await initDexie();
  const all = await db.SharedLedger.toArray();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
}

export async function recordSharedLedger(entry: SharedLedgerEntry): Promise<void> {
  await initDexie();
  await db.SharedLedger.put(entry);
}

export async function getEventSessions(): Promise<EventSessionRecord[]> {
  await initDexie();
  const all = await db.EventSessions.toArray();
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 40);
}

export async function upsertEventSession(rec: EventSessionRecord): Promise<void> {
  await initDexie();
  await db.EventSessions.put(rec);
}

export async function getChatHistory(): Promise<ChatMessageRecord[]> {
  await initDexie();
  const all = await db.ChatMessages.toArray();
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
}

export async function saveChatMessage(msg: ChatMessageRecord): Promise<void> {
  await initDexie();
  await db.ChatMessages.put(msg);
}

export async function getAsyncDuels(): Promise<AsyncDuelRecord[]> {
  await initDexie();
  const all = await db.DuelRecords.toArray();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

export async function recordAsyncDuel(rec: AsyncDuelRecord): Promise<void> {
  await initDexie();
  await db.DuelRecords.put(rec);
  notifyMutated();
}

// --- Cloud Sync Helpers (Golden Rule: NEVER overwrite newer updatedAt) ---

export async function getPendingSyncRecords(): Promise<{
  accounts: MuAccount[];
  characters: MuCharacter[];
}> {
  await initDexie();
  const [accounts, characters] = await Promise.all([
    db.Accounts.filter((a) => !a.isSynced).toArray(),
    db.Characters.filter((c) => !c.isSynced).toArray(),
  ]);
  return { accounts, characters };
}

export async function markRecordsSynced(accountIds: string[], charIds: string[]): Promise<void> {
  await initDexie();
  await db.transaction('rw', db.Accounts, db.Characters, async () => {
    for (const id of accountIds) {
      await db.Accounts.update(id, { isSynced: true });
    }
    for (const id of charIds) {
      await db.Characters.update(id, { isSynced: true });
    }
  });
}

export async function upsertAccountFromCloud(cloudAcc: MuAccount): Promise<boolean> {
  await initDexie();
  const local = await db.Accounts.get(cloudAcc.id);
  if (!local || cloudAcc.updatedAt > local.updatedAt) {
    await db.Accounts.put({ ...cloudAcc, isSynced: true });
    return true;
  }
  return false;
}

export async function upsertCharacterFromCloud(cloudChar: MuCharacter): Promise<boolean> {
  await initDexie();
  const local = await db.Characters.get(cloudChar.id);
  if (!local || cloudChar.updatedAt > local.updatedAt) {
    await db.Characters.put({ ...cloudChar, isSynced: true });
    return true;
  }
  return false;
}

export async function countPendingSync(): Promise<number> {
  await initDexie();
  const pending = await getPendingSyncRecords();
  return pending.accounts.length + pending.characters.length;
}

// --- Backup Export / Import (IndexedDB Dexie JSON) ---

export async function getAllSyncRecordsForCloud(): Promise<{
  accounts: MuAccount[];
  characters: MuCharacter[];
  ledger: SharedLedgerEntry[];
  duels: AsyncDuelRecord[];
  events: EventSessionRecord[];
}> {
  await initDexie();
  const [pending, ledger, duels, events] = await Promise.all([
    getPendingSyncRecords(),
    db.SharedLedger.toArray(),
    db.DuelRecords.toArray(),
    db.EventSessions.toArray(),
  ]);
  return { ...pending, ledger, duels, events };
}

export async function getDatabaseStats(): Promise<{
  tables: Array<{ name: string; rows: number }>;
  byteSize: number;
}> {
  await initDexie();
  const [a, c, k, l, e, m, d] = await Promise.all([
    db.Accounts.count(),
    db.Characters.count(),
    db.KvSettings.count(),
    db.SharedLedger.count(),
    db.EventSessions.count(),
    db.ChatMessages.count(),
    db.DuelRecords.count(),
  ]);
  const snapshot = await exportDexieJsonString();
  return {
    tables: [
      { name: 'Accounts', rows: a },
      { name: 'Characters', rows: c },
      { name: 'KvSettings', rows: k },
      { name: 'SharedLedger', rows: l },
      { name: 'EventSessions', rows: e },
      { name: 'ChatMessages', rows: m },
      { name: 'DuelRecords', rows: d },
    ],
    byteSize: new Blob([snapshot]).size,
  };
}

async function exportDexieJsonString(): Promise<string> {
  const [Accounts, Characters, KvSettings, SharedLedger, EventSessions, ChatMessages, DuelRecords] = await Promise.all([
    db.Accounts.toArray(),
    db.Characters.toArray(),
    db.KvSettings.toArray(),
    db.SharedLedger.toArray(),
    db.EventSessions.toArray(),
    db.ChatMessages.toArray(),
    db.DuelRecords.toArray(),
  ]);
  return JSON.stringify({
    engine: 'dexie-indexeddb',
    version: 2,
    exportedAt: new Date().toISOString(),
    Accounts,
    Characters,
    KvSettings,
    SharedLedger,
    EventSessions,
    ChatMessages,
    DuelRecords,
  }, null, 2);
}

export async function exportDatabaseFile(): Promise<Blob> {
  await initDexie();
  const json = await exportDexieJsonString();
  return new Blob([json], { type: 'application/json' });
}

export async function importDatabaseFile(file: File): Promise<void> {
  await initDexie();
  const text = await file.text();
  const parsed = JSON.parse(text) as {
    Accounts?: MuAccount[];
    Characters?: MuCharacter[];
    KvSettings?: KvSettingRow[];
    SharedLedger?: SharedLedgerEntry[];
    EventSessions?: EventSessionRecord[];
    ChatMessages?: ChatMessageRecord[];
    DuelRecords?: AsyncDuelRecord[];
  };
  await db.transaction(
    'rw',
    [db.Accounts, db.Characters, db.KvSettings, db.SharedLedger, db.EventSessions, db.ChatMessages, db.DuelRecords],
    async () => {
      if (Array.isArray(parsed.Accounts)) await db.Accounts.bulkPut(parsed.Accounts);
      if (Array.isArray(parsed.Characters)) await db.Characters.bulkPut(parsed.Characters);
      if (Array.isArray(parsed.KvSettings)) await db.KvSettings.bulkPut(parsed.KvSettings);
      if (Array.isArray(parsed.SharedLedger)) await db.SharedLedger.bulkPut(parsed.SharedLedger);
      if (Array.isArray(parsed.EventSessions)) await db.EventSessions.bulkPut(parsed.EventSessions);
      if (Array.isArray(parsed.ChatMessages)) await db.ChatMessages.bulkPut(parsed.ChatMessages);
      if (Array.isArray(parsed.DuelRecords)) await db.DuelRecords.bulkPut(parsed.DuelRecords);
    },
  );
  notifyMutated();
}
