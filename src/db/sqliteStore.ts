import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type {
  ChatMessageRecord,
  EventSessionRecord,
  EventType,
  HeroClass,
  ItemSlot,
  MuCharacter,
  MuItem,
  SharedLedgerEntry,
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

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      class_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xp_to_next INTEGER NOT NULL DEFAULT 120,
      str INTEGER NOT NULL DEFAULT 28,
      agi INTEGER NOT NULL DEFAULT 20,
      vit INTEGER NOT NULL DEFAULT 25,
      ene INTEGER NOT NULL DEFAULT 15,
      zen INTEGER NOT NULL DEFAULT 15000,
      bless INTEGER NOT NULL DEFAULT 3,
      soul INTEGER NOT NULL DEFAULT 3,
      chaos INTEGER NOT NULL DEFAULT 1,
      hp INTEGER NOT NULL DEFAULT 220,
      max_hp INTEGER NOT NULL DEFAULT 220,
      mp INTEGER NOT NULL DEFAULT 90,
      max_mp INTEGER NOT NULL DEFAULT 90,
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
}

function getStarterItemsForClass(charId: string, ownerName: string, classType: HeroClass): MuItem[] {
  const now = new Date().toISOString();
  if (classType === 'DK') {
    return [
      {
        id: `itm-${charId}-w1`,
        charId,
        name: 'Espada del Dragón',
        slot: 'weapon',
        category: 'weapon',
        setName: 'Dragon',
        rarity: 'excellent',
        enhanceLevel: 7,
        minDmg: 42,
        maxDmg: 68,
        defense: 0,
        magicPower: 0,
        luck: true,
        excellentOpt: 'Daño Excelente +10%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-s1`,
        charId,
        name: 'Escudo de Placas Dragón',
        slot: 'shield',
        category: 'armor',
        setName: 'Dragon',
        rarity: 'normal',
        enhanceLevel: 5,
        minDmg: 0,
        maxDmg: 0,
        defense: 24,
        magicPower: 0,
        luck: true,
        excellentOpt: 'Defensa +5%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-a1`,
        charId,
        name: 'Armadura Dragón Carmesí',
        slot: 'armor',
        category: 'armor',
        setName: 'Dragon',
        rarity: 'excellent',
        enhanceLevel: 7,
        minDmg: 0,
        maxDmg: 0,
        defense: 46,
        magicPower: 0,
        luck: true,
        excellentOpt: 'Reducción de Daño +4%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-h1`,
        charId,
        name: 'Yelmo Dragón Carmesí',
        slot: 'helm',
        category: 'armor',
        setName: 'Dragon',
        rarity: 'normal',
        enhanceLevel: 6,
        minDmg: 0,
        maxDmg: 0,
        defense: 28,
        magicPower: 0,
        luck: false,
        excellentOpt: '',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-w2`,
        charId,
        name: 'Espada del Arcángel',
        slot: 'weapon',
        category: 'weapon',
        setName: 'Archangel',
        rarity: 'ancient',
        enhanceLevel: 9,
        minDmg: 64,
        maxDmg: 96,
        defense: 0,
        magicPower: 0,
        luck: true,
        excellentOpt: 'Velocidad Ataque +7 · Listo para Intercambio',
        isEquipped: false,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-wg1`,
        charId,
        name: 'Alas de Satán',
        slot: 'wings',
        category: 'wings',
        setName: 'Satan Wings',
        rarity: 'excellent',
        enhanceLevel: 6,
        minDmg: 18,
        maxDmg: 18,
        defense: 22,
        magicPower: 0,
        luck: true,
        excellentOpt: 'Absorbe 25% de Daño',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
    ];
  }

  if (classType === 'DW') {
    return [
      {
        id: `itm-${charId}-w1`,
        charId,
        name: 'Báculo Legendario',
        slot: 'weapon',
        category: 'weapon',
        setName: 'Legendary',
        rarity: 'excellent',
        enhanceLevel: 7,
        minDmg: 24,
        maxDmg: 38,
        defense: 0,
        magicPower: 74,
        luck: true,
        excellentOpt: 'Poder Mágico +10%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-a1`,
        charId,
        name: 'Túnica Legendaria',
        slot: 'armor',
        category: 'armor',
        setName: 'Legendary',
        rarity: 'excellent',
        enhanceLevel: 7,
        minDmg: 0,
        maxDmg: 0,
        defense: 36,
        magicPower: 14,
        luck: true,
        excellentOpt: 'Mana Máximo +4%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-h1`,
        charId,
        name: 'Capucha Legendaria',
        slot: 'helm',
        category: 'armor',
        setName: 'Legendary',
        rarity: 'normal',
        enhanceLevel: 5,
        minDmg: 0,
        maxDmg: 0,
        defense: 22,
        magicPower: 8,
        luck: false,
        excellentOpt: '',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-w2`,
        charId,
        name: 'Báculo de Kundun',
        slot: 'weapon',
        category: 'weapon',
        setName: 'Kundun',
        rarity: 'ancient',
        enhanceLevel: 9,
        minDmg: 32,
        maxDmg: 50,
        defense: 0,
        magicPower: 112,
        luck: true,
        excellentOpt: 'Ignora Defensa 3% · Listo para Intercambio',
        isEquipped: false,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
      {
        id: `itm-${charId}-wg1`,
        charId,
        name: 'Alas del Alma',
        slot: 'wings',
        category: 'wings',
        setName: 'Soul Wings',
        rarity: 'excellent',
        enhanceLevel: 6,
        minDmg: 0,
        maxDmg: 0,
        defense: 20,
        magicPower: 26,
        luck: true,
        excellentOpt: 'Recuperación MP +5%',
        isEquipped: true,
        originalOwner: ownerName,
        sharedFromSession: null,
        acquiredAt: now,
      },
    ];
  }

  return [
    {
      id: `itm-${charId}-w1`,
      charId,
      name: 'Arco Celestial',
      slot: 'weapon',
      category: 'weapon',
      setName: 'Guardian',
      rarity: 'excellent',
      enhanceLevel: 7,
      minDmg: 38,
      maxDmg: 62,
      defense: 0,
      magicPower: 0,
      luck: true,
      excellentOpt: 'Velocidad Ataque +7',
      isEquipped: true,
      originalOwner: ownerName,
      sharedFromSession: null,
      acquiredAt: now,
    },
    {
      id: `itm-${charId}-a1`,
      charId,
      name: 'Armadura Guardián',
      slot: 'armor',
      category: 'armor',
      setName: 'Guardian',
      rarity: 'excellent',
      enhanceLevel: 7,
      minDmg: 0,
      maxDmg: 0,
      defense: 40,
      magicPower: 0,
      luck: true,
      excellentOpt: 'Evasión +10%',
      isEquipped: true,
      originalOwner: ownerName,
      sharedFromSession: null,
      acquiredAt: now,
    },
    {
      id: `itm-${charId}-h1`,
      charId,
      name: 'Diadema Guardián',
      slot: 'helm',
      category: 'armor',
      setName: 'Guardian',
      rarity: 'normal',
      enhanceLevel: 5,
      minDmg: 0,
      maxDmg: 0,
      defense: 24,
      magicPower: 0,
      luck: false,
      excellentOpt: '',
      isEquipped: true,
      originalOwner: ownerName,
      sharedFromSession: null,
      acquiredAt: now,
    },
    {
      id: `itm-${charId}-w2`,
      charId,
      name: 'Ballesta de Cristal',
      slot: 'weapon',
      category: 'weapon',
      setName: 'Celestial',
      rarity: 'ancient',
      enhanceLevel: 9,
      minDmg: 58,
      maxDmg: 88,
      defense: 0,
      magicPower: 0,
      luck: true,
      excellentOpt: 'Daño Crítico +15% · Listo para Intercambio',
      isEquipped: false,
      originalOwner: ownerName,
      sharedFromSession: null,
      acquiredAt: now,
    },
    {
      id: `itm-${charId}-wg1`,
      charId,
      name: 'Alas de Elfa',
      slot: 'wings',
      category: 'wings',
      setName: 'Elf Wings',
      rarity: 'excellent',
      enhanceLevel: 6,
      minDmg: 16,
      maxDmg: 16,
      defense: 22,
      magicPower: 0,
      luck: true,
      excellentOpt: 'Velocidad Movimiento +15%',
      isEquipped: true,
      originalOwner: ownerName,
      sharedFromSession: null,
      acquiredAt: now,
    },
  ];
}

function getBaseStatsForClass(classType: HeroClass) {
  if (classType === 'DK') {
    return { str: 36, agi: 22, vit: 30, ene: 12, maxHp: 280, maxMp: 80 };
  }
  if (classType === 'DW') {
    return { str: 16, agi: 22, vit: 20, ene: 42, maxHp: 210, maxMp: 180 };
  }
  return { str: 20, agi: 38, vit: 22, ene: 20, maxHp: 235, maxMp: 120 };
}

export async function initSqlite(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!SQL) {
      SQL = await initSqlJs({
        locateFile: () => '/sql-wasm.wasm',
      });
    }
    const existingBytes = await readDbBytesFromIdb();
    const db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
    createSchema(db);

    // Ensure at least one hero exists
    const res = db.exec('SELECT COUNT(*) as c FROM characters');
    const count = Number(res[0]?.values[0]?.[0] ?? 0);
    if (count === 0) {
      seedCharacterInternal(db, 'GuerreroLorencia', 'DK');
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

function seedCharacterInternal(db: Database, name: string, classType: HeroClass): string {
  const id = `hero-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const base = getBaseStatsForClass(classType);

  db.run(
    `INSERT INTO characters (
      id, name, class_type, level, xp, xp_to_next, str, agi, vit, ene,
      zen, bless, soul, chaos, hp, max_hp, mp, max_mp, kills, resets, updated_at
    ) VALUES (?, ?, ?, 15, 40, 220, ?, ?, ?, ?, 25000, 5, 5, 2, ?, ?, ?, ?, 0, 0, ?)`,
    [id, name, classType, base.str, base.agi, base.vit, base.ene, base.maxHp, base.maxHp, base.maxMp, base.maxMp, now],
  );

  const items = getStarterItemsForClass(id, name, classType);
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
    name: String(obj.name),
    classType: obj.class_type as HeroClass,
    level: Number(obj.level),
    xp: Number(obj.xp),
    xpToNext: Number(obj.xp_to_next),
    str: Number(obj.str),
    agi: Number(obj.agi),
    vit: Number(obj.vit),
    ene: Number(obj.ene),
    zen: Number(obj.zen),
    bless: Number(obj.bless),
    soul: Number(obj.soul),
    chaos: Number(obj.chaos),
    hp: Number(obj.hp),
    maxHp: Number(obj.max_hp),
    mp: Number(obj.mp),
    maxMp: Number(obj.max_mp),
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

export async function createOrSelectClassHero(name: string, classType: HeroClass): Promise<MuCharacter> {
  const db = await initSqlite();
  const existing = await listCharacters();
  const found = existing.find((c) => c.classType === classType && (!name || c.name === name));
  if (found && existing.length <= 3 && name === found.name) {
    return found;
  }
  const cleanName = name.trim() || (classType === 'DK' ? 'GuerreroLorencia' : classType === 'DW' ? 'MagoLorencia' : 'ElfaLorencia');
  const id = seedCharacterInternal(db, cleanName, classType);
  await persistDb();
  const all = await listCharacters();
  return all.find((c) => c.id === id)!;
}

export async function updateCharacter(char: MuCharacter): Promise<void> {
  const db = await initSqlite();
  const now = new Date().toISOString();
  db.run(
    `UPDATE characters SET
      name = ?, level = ?, xp = ?, xp_to_next = ?, str = ?, agi = ?, vit = ?, ene = ?,
      zen = ?, bless = ?, soul = ?, chaos = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?,
      kills = ?, resets = ?, updated_at = ?
    WHERE id = ?`,
    [
      char.name,
      char.level,
      char.xp,
      char.xpToNext,
      char.str,
      char.agi,
      char.vit,
      char.ene,
      char.zen,
      char.bless,
      char.soul,
      char.chaos,
      char.hp,
      char.maxHp,
      char.mp,
      char.maxMp,
      char.kills,
      char.resets,
      now,
      char.id,
    ],
  );
  await persistDb();
}

export async function getItemsForCharacter(charId: string): Promise<MuItem[]> {
  const db = await initSqlite();
  const res = db.exec(`SELECT * FROM items WHERE char_id = '${charId.replace(/'/g, "''")}' ORDER BY is_equipped DESC, enhance_level DESC, acquired_at DESC`);
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
  jewelType: 'bless' | 'soul',
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
        message: 'Jewel of Bless mejora hasta +6. Usa Jewel of Soul para +7 a +13.',
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
        item.category === 'weapon' ? 4 : 0,
        item.category === 'weapon' ? 6 : 0,
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

  // Soul (+0 to +13)
  if (char.soul <= 0) {
    return { success: false, message: 'No tienes Jewel of Soul suficientes.', character: char, items };
  }
  if (item.enhanceLevel >= 13) {
    return { success: false, message: `${item.name} ya alcanzó el nivel máximo +13.`, character: char, items };
  }

  const chance = item.luck ? 0.8 : 0.6;
  const rolled = Math.random() < chance;
  const updatedChar = { ...char, soul: char.soul - 1 };
  await updateCharacter(updatedChar);

  if (rolled) {
    const nextLevel = item.enhanceLevel + 1;
    db.run(
      'UPDATE items SET enhance_level = ?, min_dmg = min_dmg + ?, max_dmg = max_dmg + ?, defense = defense + ?, magic_power = magic_power + ? WHERE id = ?',
      [
        nextLevel,
        item.category === 'weapon' ? 6 : 0,
        item.category === 'weapon' ? 8 : 0,
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
  const names = ['characters', 'items', 'shared_ledger', 'event_sessions', 'chat_messages'];
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
    SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const nextDb = new SQL.Database(buf);
  createSchema(nextDb);
  dbInstance = nextDb;
  await persistDb();
}
