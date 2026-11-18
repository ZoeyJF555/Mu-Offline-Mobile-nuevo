import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import {
  DEFAULT_BUTTON_LAYOUTS,
  MU_CLASSES,
  getDefaultComboConfig,
  getStarterItemsForMuClass,
} from '../data/muSkillsAndClasses';
import { MU_CHAOS_WINGS_RECIPES } from '../data/muWorldData';
import type {
  ButtonLayoutItem,
  CharacterComboConfig,
  ChatMessageRecord,
  EventSessionRecord,
  EventType,
  GameSettings,
  HeroClass,
  HudButtonId,
  ItemSlot,
  MapId,
  MuAccount,
  MuCharacter,
  MuItem,
  SharedLedgerEntry,
  ShopItemDef,
  TransportMode,
} from '../types/game';

const IDB_NAME = 'mu_lorencia_sqlite_idb';
const IDB_STORE = 'sqlite_files';
const IDB_KEY = 'mu_offline_main_db';

let SQL: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readDbBytesFromIdb(): Promise<Uint8Array | null> {
  try {
    const idb = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (val instanceof Uint8Array) resolve(val);
        else if (val instanceof ArrayBuffer) resolve(new Uint8Array(val));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeDbBytesToIdb(bytes: Uint8Array): Promise<void> {
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(bytes, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('No se pudo persistir SQLite en IndexedDB:', err);
  }
}

function hashPassword(pwd: string): string {
  let h = 2166136261;
  for (let i = 0; i < pwd.length; i++) {
    h ^= pwd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `mu6_${(h >>> 0).toString(16)}`;
}

function ensureColumn(db: Database, table: string, colName: string, colDef: string) {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const cols = (info[0]?.values || []).map((r) => String(r[1]));
  if (!cols.includes(colName)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
  }
}

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL DEFAULT 'acc-local',
      name TEXT NOT NULL,
      class_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xp_to_next INTEGER NOT NULL DEFAULT 120,
      unspent_points INTEGER NOT NULL DEFAULT 15,
      current_map_id TEXT NOT NULL DEFAULT 'lorencia',
      str INTEGER NOT NULL DEFAULT 28,
      agi INTEGER NOT NULL DEFAULT 20,
      vit INTEGER NOT NULL DEFAULT 25,
      ene INTEGER NOT NULL DEFAULT 15,
      cmd INTEGER NOT NULL DEFAULT 0,
      zen INTEGER NOT NULL DEFAULT 30000,
      bless INTEGER NOT NULL DEFAULT 6,
      soul INTEGER NOT NULL DEFAULT 6,
      chaos INTEGER NOT NULL DEFAULT 2,
      life INTEGER NOT NULL DEFAULT 2,
      creation INTEGER NOT NULL DEFAULT 1,
      harmony INTEGER NOT NULL DEFAULT 1,
      hp INTEGER NOT NULL DEFAULT 220,
      max_hp INTEGER NOT NULL DEFAULT 220,
      mp INTEGER NOT NULL DEFAULT 90,
      max_mp INTEGER NOT NULL DEFAULT 90,
      sd INTEGER NOT NULL DEFAULT 200,
      max_sd INTEGER NOT NULL DEFAULT 200,
      ag INTEGER NOT NULL DEFAULT 100,
      max_ag INTEGER NOT NULL DEFAULT 100,
      kills INTEGER NOT NULL DEFAULT 0,
      resets INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      char_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slot TEXT NOT NULL,
      category TEXT NOT NULL,
      set_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      enhance_level INTEGER NOT NULL DEFAULT 0,
      min_dmg INTEGER NOT NULL DEFAULT 0,
      max_dmg INTEGER NOT NULL DEFAULT 0,
      defense INTEGER NOT NULL DEFAULT 0,
      magic_power INTEGER NOT NULL DEFAULT 0,
      luck INTEGER NOT NULL DEFAULT 0,
      excellent_opt TEXT NOT NULL DEFAULT '',
      is_equipped INTEGER NOT NULL DEFAULT 0,
      original_owner TEXT NOT NULL,
      shared_from_session TEXT,
      acquired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shared_ledger (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      transport_mode TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      role TEXT NOT NULL,
      direction TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_sessions (
      id TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      event_type TEXT NOT NULL,
      host_name TEXT NOT NULL,
      transport_mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      waves_cleared INTEGER NOT NULL DEFAULT 0,
      boss_defeated INTEGER NOT NULL DEFAULT 0,
      loot_summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, 'characters', 'account_id', "TEXT NOT NULL DEFAULT 'acc-local'");
  ensureColumn(db, 'characters', 'cmd', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'characters', 'sd', 'INTEGER NOT NULL DEFAULT 220');
  ensureColumn(db, 'characters', 'max_sd', 'INTEGER NOT NULL DEFAULT 220');
  ensureColumn(db, 'characters', 'ag', 'INTEGER NOT NULL DEFAULT 100');
  ensureColumn(db, 'characters', 'max_ag', 'INTEGER NOT NULL DEFAULT 100');
  ensureColumn(db, 'characters', 'unspent_points', 'INTEGER NOT NULL DEFAULT 15');
  ensureColumn(db, 'characters', 'current_map_id', "TEXT NOT NULL DEFAULT 'lorencia'");
  ensureColumn(db, 'characters', 'life', 'INTEGER NOT NULL DEFAULT 2');
  ensureColumn(db, 'characters', 'creation', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'characters', 'harmony', 'INTEGER NOT NULL DEFAULT 1');
}

export async function initSqlite(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!SQL) {
      SQL = await initSqlJs({
        locateFile: () => `${import.meta.env.BASE_URL}sql-wasm.wasm`,
      });
    }
    const existingBytes = await readDbBytesFromIdb();
    const db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
    createSchema(db);

    const accRes = db.exec('SELECT COUNT(*) FROM accounts');
    if (Number(accRes[0]?.values[0]?.[0] ?? 0) === 0) {
      db.run(
        'INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
        ['acc-local', 'lorencia', hashPassword('123456'), new Date().toISOString()],
      );
    }

    const charRes = db.exec('SELECT COUNT(*) FROM characters');
    if (Number(charRes[0]?.values[0]?.[0] ?? 0) === 0) {
      seedCharacterInternal(db, 'acc-local', 'GuerreroLorencia', 'DK');
    }

    dbInstance = db;
    await persistDb();
    return db;
  })();

  return initPromise;
}

export async function persistDb(): Promise<void> {
  if (!dbInstance) return;
  const bytes = dbInstance.export();
  await writeDbBytesToIdb(bytes);
}

// Accounts
export async function listAccounts(): Promise<MuAccount[]> {
  const db = await initSqlite();
  const res = db.exec('SELECT id, username, created_at FROM accounts ORDER BY created_at ASC');
  if (!res.length) return [];
  return res[0].values.map((r) => ({
    id: String(r[0]),
    username: String(r[1]),
    createdAt: String(r[2]),
  }));
}

export async function registerAccount(
  username: string,
  password: string,
): Promise<{ ok: true; account: MuAccount } | { ok: false; error: string }> {
  const db = await initSqlite();
  const cleanUser = username.trim().toLowerCase();
  if (cleanUser.length < 3 || password.length < 4) {
    return { ok: false, error: 'El usuario debe tener al menos 3 letras y la clave 4 caracteres.' };
  }

  const existing = db.exec(`SELECT id FROM accounts WHERE username = '${cleanUser.replace(/'/g, "''")}'`);
  if (existing.length && existing[0].values.length > 0) {
    return { ok: false, error: `La cuenta "${cleanUser}" ya existe. Usa Ingresar.` };
  }

  const id = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const now = new Date().toISOString();
  db.run('INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    cleanUser,
    hashPassword(password),
    now,
  ]);
  await persistDb();
  return { ok: true, account: { id, username: cleanUser, createdAt: now } };
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<{ ok: true; account: MuAccount } | { ok: false; error: string }> {
  const db = await initSqlite();
  const cleanUser = username.trim().toLowerCase();
  const res = db.exec(
    `SELECT id, username, password_hash, created_at FROM accounts WHERE username = '${cleanUser.replace(/'/g, "''")}'`,
  );
  if (!res.length || res[0].values.length === 0) {
    return { ok: false, error: `No existe la cuenta "${cleanUser}". Regístrate primero.` };
  }
  const row = res[0].values[0];
  if (String(row[2]) !== hashPassword(password)) {
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  return {
    ok: true,
    account: {
      id: String(row[0]),
      username: String(row[1]),
      createdAt: String(row[3]),
    },
  };
}

function seedCharacterInternal(
  db: Database,
  accountId: string,
  name: string,
  classType: HeroClass,
): string {
  const id = `hero-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const meta = MU_CLASSES.find((c) => c.id === classType) || MU_CLASSES[0];
  const base = meta.baseStats;

  db.run(
    `INSERT INTO characters (
      id, account_id, name, class_type, level, xp, xp_to_next, unspent_points, current_map_id,
      str, agi, vit, ene, cmd, zen, bless, soul, chaos, life, creation, harmony,
      hp, max_hp, mp, max_mp, sd, max_sd, ag, max_ag, kills, resets, updated_at
    ) VALUES (?, ?, ?, ?, 15, 40, 220, 20, 'lorencia', ?, ?, ?, ?, ?, 45000, 6, 6, 2, 2, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    [
      id,
      accountId,
      name,
      classType,
      base.str,
      base.agi,
      base.vit,
      base.ene,
      base.cmd,
      base.maxHp,
      base.maxHp,
      base.maxMp,
      base.maxMp,
      base.maxSd,
      base.maxSd,
      base.maxAg,
      base.maxAg,
      now,
    ],
  );

  const items = getStarterItemsForMuClass(id, name, classType);
  for (const item of items) {
    insertItemInternal(db, item);
  }
  return id;
}

function insertItemInternal(db: Database, item: MuItem) {
  db.run(
    `INSERT OR REPLACE INTO items (
      id, char_id, name, slot, category, set_name, rarity, enhance_level,
      min_dmg, max_dmg, defense, magic_power, luck, excellent_opt,
      is_equipped, original_owner, shared_from_session, acquired_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.charId,
      item.name,
      item.slot,
      item.category,
      item.setName,
      item.rarity,
      item.enhanceLevel,
      item.minDmg,
      item.maxDmg,
      item.defense,
      item.magicPower,
      item.luck ? 1 : 0,
      item.excellentOpt,
      item.isEquipped ? 1 : 0,
      item.originalOwner,
      item.sharedFromSession,
      item.acquiredAt,
    ],
  );
}

function mapCharacterRow(cols: string[], row: unknown[]): MuCharacter {
  const obj: Record<string, unknown> = {};
  cols.forEach((c, idx) => (obj[c] = row[idx]));
  return {
    id: String(obj.id),
    accountId: String(obj.account_id || 'acc-local'),
    name: String(obj.name),
    classType: obj.class_type as HeroClass,
    level: Number(obj.level),
    xp: Number(obj.xp),
    xpToNext: Number(obj.xp_to_next),
    unspentPoints: Number(obj.unspent_points ?? 15),
    currentMapId: (String(obj.current_map_id || 'lorencia') as MapId),
    str: Number(obj.str),
    agi: Number(obj.agi),
    vit: Number(obj.vit),
    ene: Number(obj.ene),
    cmd: Number(obj.cmd || 0),
    zen: Number(obj.zen),
    bless: Number(obj.bless),
    soul: Number(obj.soul),
    chaos: Number(obj.chaos),
    life: Number(obj.life ?? 2),
    creation: Number(obj.creation ?? 1),
    harmony: Number(obj.harmony ?? 1),
    hp: Number(obj.hp),
    maxHp: Number(obj.max_hp),
    mp: Number(obj.mp),
    maxMp: Number(obj.max_mp),
    sd: Number(obj.sd ?? 200),
    maxSd: Number(obj.max_sd ?? 200),
    ag: Number(obj.ag ?? 100),
    maxAg: Number(obj.max_ag ?? 100),
    kills: Number(obj.kills),
    resets: Number(obj.resets),
    updatedAt: String(obj.updated_at),
  };
}

function mapItemRow(cols: string[], row: unknown[]): MuItem {
  const obj: Record<string, unknown> = {};
  cols.forEach((c, idx) => (obj[c] = row[idx]));
  return {
    id: String(obj.id),
    charId: String(obj.char_id),
    name: String(obj.name),
    slot: obj.slot as ItemSlot,
    category: obj.category as MuItem['category'],
    setName: String(obj.set_name),
    rarity: obj.rarity as MuItem['rarity'],
    enhanceLevel: Number(obj.enhance_level),
    minDmg: Number(obj.min_dmg),
    maxDmg: Number(obj.max_dmg),
    defense: Number(obj.defense),
    magicPower: Number(obj.magic_power),
    luck: Number(obj.luck) === 1,
    excellentOpt: String(obj.excellent_opt || ''),
    isEquipped: Number(obj.is_equipped) === 1,
    originalOwner: String(obj.original_owner),
    sharedFromSession: obj.shared_from_session ? String(obj.shared_from_session) : null,
    acquiredAt: String(obj.acquired_at),
  };
}

export async function listCharacters(): Promise<MuCharacter[]> {
  const db = await initSqlite();
  const res = db.exec('SELECT * FROM characters ORDER BY updated_at DESC');
  if (!res.length) return [];
  return res[0].values.map((r) => mapCharacterRow(res[0].columns, r));
}

export async function listCharactersByAccount(accountId: string): Promise<MuCharacter[]> {
  const db = await initSqlite();
  const res = db.exec(
    `SELECT * FROM characters WHERE account_id = '${accountId.replace(/'/g, "''")}' ORDER BY updated_at DESC`,
  );
  if (!res.length) return [];
  return res[0].values.map((r) => mapCharacterRow(res[0].columns, r));
}

export async function createCharacterForAccount(
  accountId: string,
  name: string,
  classType: HeroClass,
): Promise<MuCharacter> {
  const db = await initSqlite();
  const cleanName = name.trim().slice(0, 16) || `Heroe_${classType}`;
  const id = seedCharacterInternal(db, accountId, cleanName, classType);
  await persistDb();
  const list = await listCharactersByAccount(accountId);
  return list.find((c) => c.id === id)!;
}

export async function updateCharacter(char: MuCharacter): Promise<void> {
  const db = await initSqlite();
  const now = new Date().toISOString();
  db.run(
    `UPDATE characters SET
      name = ?, level = ?, xp = ?, xp_to_next = ?, unspent_points = ?, current_map_id = ?,
      str = ?, agi = ?, vit = ?, ene = ?, cmd = ?,
      zen = ?, bless = ?, soul = ?, chaos = ?, life = ?, creation = ?, harmony = ?,
      hp = ?, max_hp = ?, mp = ?, max_mp = ?, sd = ?, max_sd = ?, ag = ?, max_ag = ?,
      kills = ?, resets = ?, updated_at = ?
    WHERE id = ?`,
    [
      char.name,
      char.level,
      char.xp,
      char.xpToNext,
      char.unspentPoints,
      char.currentMapId,
      char.str,
      char.agi,
      char.vit,
      char.ene,
      char.cmd,
      char.zen,
      char.bless,
      char.soul,
      char.chaos,
      char.life,
      char.creation,
      char.harmony,
      char.hp,
      char.maxHp,
      char.mp,
      char.maxMp,
      char.sd,
      char.maxSd,
      char.ag,
      char.maxAg,
      char.kills,
      char.resets,
      now,
      char.id,
    ],
  );
  await persistDb();
}

export async function allocateStatPoint(
  char: MuCharacter,
  stat: 'str' | 'agi' | 'vit' | 'ene' | 'cmd',
  amount = 1,
): Promise<{ ok: boolean; character: MuCharacter; message?: string }> {
  const pts = Math.min(amount, char.unspentPoints);
  if (pts <= 0) {
    return { ok: false, character: char, message: 'No tienes puntos libres. Sube de nivel cazando monstruos.' };
  }
  const updated: MuCharacter = {
    ...char,
    unspentPoints: char.unspentPoints - pts,
    [stat]: char[stat] + pts,
    maxHp: stat === 'vit' ? char.maxHp + pts * 6 : char.maxHp,
    hp: stat === 'vit' ? char.hp + pts * 6 : char.hp,
    maxMp: stat === 'ene' ? char.maxMp + pts * 5 : char.maxMp,
    mp: stat === 'ene' ? char.mp + pts * 5 : char.mp,
  };
  await updateCharacter(updated);
  return { ok: true, character: updated };
}

export async function getItemsForCharacter(charId: string): Promise<MuItem[]> {
  const db = await initSqlite();
  const res = db.exec(
    `SELECT * FROM items WHERE char_id = '${charId.replace(/'/g, "''")}' ORDER BY is_equipped DESC, enhance_level DESC, acquired_at DESC`,
  );
  if (!res.length) return [];
  return res[0].values.map((r) => mapItemRow(res[0].columns, r));
}

export async function equipItem(charId: string, itemId: string): Promise<MuItem[]> {
  const db = await initSqlite();
  const items = await getItemsForCharacter(charId);
  const target = items.find((i) => i.id === itemId);
  if (!target) return items;

  db.run('UPDATE items SET is_equipped = 0 WHERE char_id = ? AND slot = ?', [charId, target.slot]);
  db.run('UPDATE items SET is_equipped = 1 WHERE id = ? AND char_id = ?', [itemId, charId]);
  await persistDb();
  return getItemsForCharacter(charId);
}

export async function upgradeItemWithJewel(
  char: MuCharacter,
  itemId: string,
  jewelType: 'bless' | 'soul' | 'life' | 'harmony',
): Promise<{ success: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const db = await initSqlite();
  const items = await getItemsForCharacter(char.id);
  const item = items.find((i) => i.id === itemId);
  if (!item) {
    return { success: false, message: 'Ítem no encontrado.', character: char, items };
  }

  if (jewelType === 'bless') {
    if (char.bless <= 0) {
      return { success: false, message: 'No tienes Jewel of Bless suficientes.', character: char, items };
    }
    if (item.enhanceLevel >= 6) {
      return {
        success: false,
        message: 'Jewel of Bless mejora hasta +6. Usa Soul (+7 a +13) o Harmony (+14 a +15).',
        character: char,
        items,
      };
    }
    const nextLevel = item.enhanceLevel + 1;
    const updatedChar = { ...char, bless: char.bless - 1 };
    await updateCharacter(updatedChar);
    db.run(
      'UPDATE items SET enhance_level = ?, min_dmg = min_dmg + ?, max_dmg = max_dmg + ?, defense = defense + ?, magic_power = magic_power + ? WHERE id = ?',
      [
        nextLevel,
        item.category === 'weapon' || item.category === 'jewelry' ? 4 : 0,
        item.category === 'weapon' || item.category === 'jewelry' ? 6 : 0,
        item.category !== 'weapon' ? 4 : 0,
        item.magicPower > 0 ? 5 : 0,
        item.id,
      ],
    );
    await persistDb();
    return {
      success: true,
      message: `${item.name} subió a +${nextLevel} con éxito (100% Bless).`,
      character: updatedChar,
      items: await getItemsForCharacter(char.id),
    };
  }

  if (jewelType === 'life') {
    if (char.life <= 0) {
      return { success: false, message: 'No tienes Jewel of Life suficientes.', character: char, items };
    }
    const updatedChar = { ...char, life: char.life - 1 };
    await updateCharacter(updatedChar);
    const nextOpt = item.excellentOpt.includes('Adicional +16')
      ? item.excellentOpt
      : `${item.excellentOpt ? `${item.excellentOpt} · ` : ''}Opción Adicional +16`;
    db.run(
      'UPDATE items SET min_dmg = min_dmg + ?, max_dmg = max_dmg + ?, defense = defense + ?, magic_power = magic_power + ?, excellent_opt = ? WHERE id = ?',
      [
        item.category === 'weapon' ? 5 : 0,
        item.category === 'weapon' ? 7 : 0,
        item.category !== 'weapon' ? 6 : 0,
        item.magicPower > 0 ? 6 : 0,
        nextOpt,
        item.id,
      ],
    );
    await persistDb();
    return {
      success: true,
      message: `¡Jewel of Life aplicado! ${item.name} recibió Opción Adicional.`,
      character: updatedChar,
      items: await getItemsForCharacter(char.id),
    };
  }

  if (jewelType === 'harmony') {
    if (char.harmony <= 0) {
      return { success: false, message: 'No tienes Jewel of Harmony suficientes.', character: char, items };
    }
    if (item.enhanceLevel < 13) {
      return { success: false, message: 'Sube el ítem a +13 primero con Soul para refinar con Harmony (+14/+15).', character: char, items };
    }
    if (item.enhanceLevel >= 15) {
      return { success: false, message: `${item.name} ya está en el nivel dorado máximo +15.`, character: char, items };
    }
    const nextLevel = item.enhanceLevel + 1;
    const updatedChar = { ...char, harmony: char.harmony - 1 };
    await updateCharacter(updatedChar);
    db.run(
      'UPDATE items SET enhance_level = ?, min_dmg = min_dmg + ?, max_dmg = max_dmg + ?, defense = defense + ?, magic_power = magic_power + ?, excellent_opt = ? WHERE id = ?',
      [
        nextLevel,
        item.category === 'weapon' ? 10 : 0,
        item.category === 'weapon' ? 14 : 0,
        item.category !== 'weapon' ? 9 : 0,
        item.magicPower > 0 ? 11 : 0,
        item.excellentOpt.includes('Harmony') ? item.excellentOpt : `${item.excellentOpt ? `${item.excellentOpt} · ` : ''}Harmony SD Ignorar +5%`,
        item.id,
      ],
    );
    await persistDb();
    return {
      success: true,
      message: `¡Brillo Supremo! ${item.name} refinado a +${nextLevel} con Harmony.`,
      character: updatedChar,
      items: await getItemsForCharacter(char.id),
    };
  }

  // Jewel of Soul (+7 to +13)
  if (char.soul <= 0) {
    return { success: false, message: 'No tienes Jewel of Soul suficientes.', character: char, items };
  }
  if (item.enhanceLevel >= 13) {
    return { success: false, message: `${item.name} ya alcanzó +13. Usa Harmony para +14/+15.`, character: char, items };
  }

  const chance = item.luck ? 0.82 : 0.62;
  const rolled = Math.random() < chance;
  const updatedChar = { ...char, soul: char.soul - 1 };
  await updateCharacter(updatedChar);

  if (rolled) {
    const nextLevel = item.enhanceLevel + 1;
    db.run(
      'UPDATE items SET enhance_level = ?, min_dmg = min_dmg + ?, max_dmg = max_dmg + ?, defense = defense + ?, magic_power = magic_power + ? WHERE id = ?',
      [
        nextLevel,
        item.category === 'weapon' || item.category === 'jewelry' ? 6 : 0,
        item.category === 'weapon' || item.category === 'jewelry' ? 8 : 0,
        item.category !== 'weapon' ? 5 : 0,
        item.magicPower > 0 ? 7 : 0,
        item.id,
      ],
    );
    await persistDb();
    return {
      success: true,
      message: `¡Éxito! ${item.name} subió a +${nextLevel} con Jewel of Soul.`,
      character: updatedChar,
      items: await getItemsForCharacter(char.id),
    };
  }

  const dropLevel = Math.max(0, item.enhanceLevel - 1);
  db.run('UPDATE items SET enhance_level = ? WHERE id = ?', [dropLevel, item.id]);
  await persistDb();
  return {
    success: false,
    message: `Falló Jewel of Soul. ${item.name} bajó a +${dropLevel}.`,
    character: updatedChar,
    items: await getItemsForCharacter(char.id),
  };
}

export async function buyShopItem(
  char: MuCharacter,
  shopItem: ShopItemDef,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const items = await getItemsForCharacter(char.id);
  if (char.zen < shopItem.zenCost) {
    return {
      ok: false,
      message: `Necesitas ${shopItem.zenCost.toLocaleString()} Zen para comprar ${shopItem.name}.`,
      character: char,
      items,
    };
  }
  const updatedChar: MuCharacter = { ...char, zen: char.zen - shopItem.zenCost };
  await updateCharacter(updatedChar);

  const newItem: MuItem = {
    id: `buy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const nextItems = await addItemToCharacter(char.id, newItem);
  return {
    ok: true,
    message: `Compraste ${shopItem.name} +${shopItem.enhanceLevel}. Guardado en mochila SQLite.`,
    character: updatedChar,
    items: nextItems,
  };
}

export async function buyJewelFromNpc(
  char: MuCharacter,
  jewel: 'bless' | 'soul' | 'chaos' | 'life' | 'harmony',
  zenCost: number,
): Promise<{ ok: boolean; message: string; character: MuCharacter }> {
  if (char.zen < zenCost) {
    return { ok: false, message: `Necesitas ${zenCost.toLocaleString()} Zen.`, character: char };
  }
  const updated: MuCharacter = {
    ...char,
    zen: char.zen - zenCost,
    [jewel]: char[jewel] + 1,
  };
  await updateCharacter(updated);
  return { ok: true, message: `+1 Jewel of ${jewel.toUpperCase()} añadido.`, character: updated };
}

export async function sellInventoryItem(
  char: MuCharacter,
  itemId: string,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const items = await getItemsForCharacter(char.id);
  const target = items.find((i) => i.id === itemId);
  if (!target) return { ok: false, message: 'Ítem no encontrado.', character: char, items };
  if (target.isEquipped) {
    return { ok: false, message: 'Desequipa primero el ítem o equipa otro antes de vender.', character: char, items };
  }
  const sellValue = 1200 + target.enhanceLevel * 450 + (target.rarity === 'ancient' ? 5000 : target.rarity === 'excellent' ? 2500 : 0);
  const updatedChar: MuCharacter = { ...char, zen: char.zen + sellValue };
  await updateCharacter(updatedChar);
  const nextItems = await removeItemFromCharacter(char.id, itemId);
  return {
    ok: true,
    message: `Vendiste ${target.name} por +${sellValue.toLocaleString()} Zen.`,
    character: updatedChar,
    items: nextItems,
  };
}

export async function executeChaosMixWing(
  char: MuCharacter,
  tier: 2 | 3,
): Promise<{ ok: boolean; message: string; character: MuCharacter; items: MuItem[] }> {
  const recipe = MU_CHAOS_WINGS_RECIPES.find((r) => r.tier === tier)!;
  const items = await getItemsForCharacter(char.id);

  if (
    char.bless < recipe.blessCost ||
    char.soul < recipe.soulCost ||
    char.chaos < recipe.chaosCost ||
    char.zen < recipe.zenCost
  ) {
    return {
      ok: false,
      message: `Faltan recursos: ${recipe.blessCost} Bless, ${recipe.soulCost} Soul, ${recipe.chaosCost} Chaos, ${recipe.zenCost.toLocaleString()} Zen.`,
      character: char,
      items,
    };
  }

  const wingFullName = recipe.wingNames[char.classType];
  const updatedChar: MuCharacter = {
    ...char,
    bless: char.bless - recipe.blessCost,
    soul: char.soul - recipe.soulCost,
    chaos: char.chaos - recipe.chaosCost,
    zen: char.zen - recipe.zenCost,
  };
  await updateCharacter(updatedChar);

  const forgedWing: MuItem = {
    id: `wing-mix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    charId: char.id,
    name: wingFullName.replace(/\s*\+\d+$/, ''),
    slot: 'wings',
    category: 'wings',
    setName: tier === 3 ? 'Lv3 Wings S6' : 'Lv2 Wings S6',
    rarity: tier === 3 ? 'ancient' : 'excellent',
    enhanceLevel: tier === 3 ? 13 : 9,
    minDmg: tier === 3 ? 48 : 30,
    maxDmg: tier === 3 ? 58 : 34,
    defense: tier === 3 ? 65 : 42,
    magicPower: char.classType === 'DW' || char.classType === 'MG' ? (tier === 3 ? 64 : 38) : 0,
    luck: true,
    excellentOpt: tier === 3 ? 'Ignora Defensa 5% · Absorbe 45% Daño · Recupera HP 5%' : 'Ignora Defensa 3% · Absorbe 32% Daño',
    isEquipped: false,
    originalOwner: char.name,
    sharedFromSession: null,
    acquiredAt: new Date().toISOString(),
  };

  const nextItems = await addItemToCharacter(char.id, forgedWing);
  return {
    ok: true,
    message: `¡Chaos Mix exitoso! Forjaste ${forgedWing.name} +${forgedWing.enhanceLevel}.`,
    character: updatedChar,
    items: nextItems,
  };
}

export async function addItemToCharacter(charId: string, item: MuItem): Promise<MuItem[]> {
  const db = await initSqlite();
  insertItemInternal(db, { ...item, charId });
  await persistDb();
  return getItemsForCharacter(charId);
}

export async function removeItemFromCharacter(charId: string, itemId: string): Promise<MuItem[]> {
  const db = await initSqlite();
  db.run('DELETE FROM items WHERE id = ? AND char_id = ?', [itemId, charId]);
  await persistDb();
  return getItemsForCharacter(charId);
}

// Settings, Button Layouts & Combo Config persisted in SQLite
const DEFAULT_SETTINGS: GameSettings = {
  brightness: 1.08,
  volume: 0.75,
  muted: false,
  musicEnabled: true,
  musicVolume: 0.45,
  free3dCamera: false,
  targetFps: 60,
};

export async function loadGameSettings(): Promise<GameSettings> {
  const db = await initSqlite();
  const res = db.exec("SELECT value_json FROM kv_settings WHERE key = 'game_settings'");
  if (!res.length || !res[0].values.length) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(String(res[0].values[0][0])) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveGameSettings(settings: GameSettings): Promise<void> {
  const db = await initSqlite();
  db.run('INSERT OR REPLACE INTO kv_settings (key, value_json) VALUES (?, ?)', [
    'game_settings',
    JSON.stringify(settings),
  ]);
  await persistDb();
}

export async function loadButtonLayouts(): Promise<Record<HudButtonId, ButtonLayoutItem>> {
  const db = await initSqlite();
  const res = db.exec("SELECT value_json FROM kv_settings WHERE key = 'hud_button_layouts'");
  if (!res.length || !res[0].values.length) return DEFAULT_BUTTON_LAYOUTS;
  try {
    return { ...DEFAULT_BUTTON_LAYOUTS, ...JSON.parse(String(res[0].values[0][0])) };
  } catch {
    return DEFAULT_BUTTON_LAYOUTS;
  }
}

export async function saveButtonLayouts(layouts: Record<HudButtonId, ButtonLayoutItem>): Promise<void> {
  const db = await initSqlite();
  db.run('INSERT OR REPLACE INTO kv_settings (key, value_json) VALUES (?, ?)', [
    'hud_button_layouts',
    JSON.stringify(layouts),
  ]);
  await persistDb();
}

export async function loadComboConfig(charId: string, classType: HeroClass): Promise<CharacterComboConfig> {
  const db = await initSqlite();
  const key = `combo_${charId}`;
  const res = db.exec(`SELECT value_json FROM kv_settings WHERE key = '${key.replace(/'/g, "''")}'`);
  if (!res.length || !res[0].values.length) return getDefaultComboConfig(classType);
  try {
    return JSON.parse(String(res[0].values[0][0])) as CharacterComboConfig;
  } catch {
    return getDefaultComboConfig(classType);
  }
}

export async function saveComboConfig(charId: string, config: CharacterComboConfig): Promise<void> {
  const db = await initSqlite();
  db.run('INSERT OR REPLACE INTO kv_settings (key, value_json) VALUES (?, ?)', [
    `combo_${charId}`,
    JSON.stringify(config),
  ]);
  await persistDb();
}

export async function recordSharedLedger(entry: SharedLedgerEntry): Promise<void> {
  const db = await initSqlite();
  db.run(
    `INSERT OR REPLACE INTO shared_ledger (
      id, session_id, transport_mode, partner_name, role, direction,
      item_id, item_name, item_snapshot_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.sessionId,
      entry.transportMode,
      entry.partnerName,
      entry.role,
      entry.direction,
      entry.itemId,
      entry.itemName,
      entry.itemSnapshotJson,
      entry.status,
      entry.createdAt,
    ],
  );
  await persistDb();
}

export async function getSharedLedger(): Promise<SharedLedgerEntry[]> {
  const db = await initSqlite();
  const res = db.exec('SELECT * FROM shared_ledger ORDER BY created_at DESC LIMIT 100');
  if (!res.length) return [];
  return res[0].values.map((row) => {
    const obj: Record<string, unknown> = {};
    res[0].columns.forEach((c, idx) => (obj[c] = row[idx]));
    return {
      id: String(obj.id),
      sessionId: String(obj.session_id),
      transportMode: obj.transport_mode as TransportMode,
      partnerName: String(obj.partner_name),
      role: obj.role as 'host' | 'guest',
      direction: obj.direction as SharedLedgerEntry['direction'],
      itemId: String(obj.item_id),
      itemName: String(obj.item_name),
      itemSnapshotJson: String(obj.item_snapshot_json),
      status: 'committed',
      createdAt: String(obj.created_at),
    };
  });
}

export async function upsertEventSession(session: EventSessionRecord): Promise<void> {
  const db = await initSqlite();
  db.run(
    `INSERT OR REPLACE INTO event_sessions (
      id, session_code, event_type, host_name, transport_mode,
      started_at, ended_at, waves_cleared, boss_defeated, loot_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.sessionCode,
      session.eventType,
      session.hostName,
      session.transportMode,
      session.startedAt,
      session.endedAt,
      session.wavesCleared,
      session.bossDefeated ? 1 : 0,
      session.lootSummary,
    ],
  );
  await persistDb();
}

export async function getEventSessions(): Promise<EventSessionRecord[]> {
  const db = await initSqlite();
  const res = db.exec('SELECT * FROM event_sessions ORDER BY started_at DESC LIMIT 50');
  if (!res.length) return [];
  return res[0].values.map((row) => {
    const obj: Record<string, unknown> = {};
    res[0].columns.forEach((c, idx) => (obj[c] = row[idx]));
    return {
      id: String(obj.id),
      sessionCode: String(obj.session_code),
      eventType: obj.event_type as EventType,
      hostName: String(obj.host_name),
      transportMode: obj.transport_mode as TransportMode,
      startedAt: String(obj.started_at),
      endedAt: obj.ended_at ? String(obj.ended_at) : null,
      wavesCleared: Number(obj.waves_cleared),
      bossDefeated: Number(obj.boss_defeated) === 1,
      lootSummary: String(obj.loot_summary || ''),
    };
  });
}

export async function saveChatMessage(msg: ChatMessageRecord): Promise<void> {
  const db = await initSqlite();
  db.run(
    'INSERT OR REPLACE INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)',
    [msg.id, msg.role, msg.content, msg.createdAt],
  );
  await persistDb();
}

export async function getChatHistory(): Promise<ChatMessageRecord[]> {
  const db = await initSqlite();
  const res = db.exec('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 60');
  if (!res.length) return [];
  return res[0].values.map((row) => {
    const obj: Record<string, unknown> = {};
    res[0].columns.forEach((c, idx) => (obj[c] = row[idx]));
    return {
      id: String(obj.id),
      role: obj.role as 'user' | 'model',
      content: String(obj.content),
      createdAt: String(obj.created_at),
    };
  });
}

export async function getSqliteStats(): Promise<{
  tables: Array<{ name: string; rows: number }>;
  byteSize: number;
}> {
  const db = await initSqlite();
  const names = ['accounts', 'characters', 'items', 'shared_ledger', 'event_sessions', 'chat_messages'];
  const tables = names.map((name) => {
    const res = db.exec(`SELECT COUNT(*) FROM ${name}`);
    return { name, rows: Number(res[0]?.values[0]?.[0] ?? 0) };
  });
  const bytes = db.export();
  return { tables, byteSize: bytes.byteLength };
}

export async function exportSqliteFile(): Promise<Blob> {
  const db = await initSqlite();
  const bytes = db.export();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/x-sqlite3' });
}

export async function importSqliteFile(file: File): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => `${import.meta.env.BASE_URL}sql-wasm.wasm` });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const nextDb = new SQL.Database(buf);
  createSchema(nextDb);
  dbInstance = nextDb;
  await persistDb();
}
