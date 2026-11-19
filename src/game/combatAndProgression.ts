import { MU_CLASSES, MU_SKILLS } from '../data/muSkillsAndClasses';
import type {
  AchievementDef,
  ActiveEffect,
  AsyncDuelChallenge,
  AsyncDuelRecord,
  CharacterSex,
  CharacterVariantKey,
  HeroClass,
  MapMonsterDef,
  MonsterArchetype,
  MonsterPowerDef,
  MuCharacter,
  MuItem,
  ScaledMonsterStats,
  SkillDef,
  TransportMode,
} from '../types/game';

export const MAX_STAT_POINTS = 65000;
export const MAX_HERO_LEVEL = 99;
export const POINTS_PER_LEVEL = 5;

export interface VariantSkillRow {
  skillId: string;
  name: string;
  baseMultiplier: number;
  cooldownSec: number;
  mpCost: number;
  critBonusPct: number;
  armorPenPct: number;
  roleTag: string;
  competitiveDpsIndex: number;
}

export interface CharacterVariantProfile {
  variantKey: CharacterVariantKey;
  classType: HeroClass;
  sex: CharacterSex;
  displayName: string;
  title: string;
  specialty: string;
  atkSpeedRating: number;
  critBasePct: number;
  defenseBonusPct: number;
  competitivePowerScore: number;
  starterStats: { str: number; agi: number; vit: number; ene: number; cmd: number };
  statFocus: string;
  basicAttackName: string;
  armorPieces: {
    helm: string;
    armor: string;
    pants: string;
    gloves: string;
    boots: string;
    shield: string;
  };
  weapons: string[];
  jewelry: {
    pendant: string;
    ring1: string;
    ring2: string;
    pet: string;
  };
  skills: VariantSkillRow[];
}

const VARIANT_MODIFIERS: Record<
  CharacterVariantKey,
  {
    displayName: string;
    title: string;
    specialty: string;
    atkSpeedRating: number;
    critBasePct: number;
    defenseBonusPct: number;
    multBias: number;
    cdBias: number;
    penBias: number;
    statFocus: string;
    basicAttackName: string;
    armorPieces: {
      helm: string;
      armor: string;
      pants: string;
      gloves: string;
      boots: string;
      shield: string;
    };
    weapons: string[];
    jewelry: {
      pendant: string;
      ring1: string;
      ring2: string;
      pet: string;
    };
  }
> = {
  DK_male: {
    displayName: 'Blade Knight (Masculino)',
    title: 'Coloso de Sangre',
    specialty: 'Golpes sísmicos de alto impacto y resistencia frontal',
    atkSpeedRating: 1.02,
    critBasePct: 16,
    defenseBonusPct: 14,
    multBias: 1.04,
    cdBias: 1.02,
    penBias: 10,
    statFocus: 'Fuerza · Vitalidad · Agilidad (hasta 65,000 c/u)',
    basicAttackName: 'Tajo Pesado de Acero',
    armorPieces: {
      helm: 'Leather Helm (+0) → Dragon Knight Helm',
      armor: 'Leather Armor (+0) → Dragon Knight Armor',
      pants: 'Leather Pants (+0) → Dragon Knight Pants',
      gloves: 'Leather Gloves (+0) → Dragon Knight Gloves',
      boots: 'Leather Boots (+0) → Dragon Knight Boots',
      shield: 'Round Shield → Dragon Shield',
    },
    weapons: ['Short Sword (+0)', 'Sword of Destruction', 'Bone Blade +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Fire',
      ring1: 'Anillo de Aprendiz → Ring of Ice',
      ring2: 'Anillo de Vitalidad → Ring of Poison',
      pet: 'Guardian Angel / Horn of Fenrir',
    },
  },
  DK_female: {
    displayName: 'Blade Knight (Femenino)',
    title: 'Valkiria Carmesí',
    specialty: 'Combos veloces de espada con mayor cadencia y crítico',
    atkSpeedRating: 1.08,
    critBasePct: 20,
    defenseBonusPct: 10,
    multBias: 0.99,
    cdBias: 0.94,
    penBias: 12,
    statFocus: 'Agilidad · Fuerza · Vitalidad (hasta 65,000 c/u)',
    basicAttackName: 'Estocada Relámpago Doble',
    armorPieces: {
      helm: 'Leather Helm (+0) → Crimson Valkyrie Helm',
      armor: 'Leather Armor (+0) → Crimson Valkyrie Armor',
      pants: 'Leather Pants (+0) → Crimson Valkyrie Pants',
      gloves: 'Leather Gloves (+0) → Crimson Valkyrie Gloves',
      boots: 'Leather Boots (+0) → Crimson Valkyrie Boots',
      shield: 'Round Shield → Plate Shield Excelente',
    },
    weapons: ['Short Sword (+0)', 'Crystal Sword', 'Flameberge +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Lightning',
      ring1: 'Anillo de Aprendiz → Ring of Wind',
      ring2: 'Anillo de Vitalidad → Ring of Ice',
      pet: 'Imp / Horn of Fenrir Carmesí',
    },
  },
  DW_male: {
    displayName: 'Soul Master (Masculino)',
    title: 'Archimago del Abismo',
    specialty: 'Explosiones arcanas concentradas y ruptura elemental',
    atkSpeedRating: 1.0,
    critBasePct: 18,
    defenseBonusPct: 8,
    multBias: 1.05,
    cdBias: 1.03,
    penBias: 14,
    statFocus: 'Energía · Agilidad · Vitalidad (hasta 65,000 c/u)',
    basicAttackName: 'Descarga Rúnica del Abismo',
    armorPieces: {
      helm: 'Pad Helm (+0) → Grand Soul Helm',
      armor: 'Pad Armor (+0) → Grand Soul Armor',
      pants: 'Pad Pants (+0) → Grand Soul Pants',
      gloves: 'Pad Gloves (+0) → Grand Soul Gloves',
      boots: 'Pad Boots (+0) → Grand Soul Boots',
      shield: 'Skull Shield → Grand Soul Shield',
    },
    weapons: ['Skull Staff (+0)', 'Staff of Resurrection', 'Staff of Kundun +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Water',
      ring1: 'Anillo de Aprendiz → Ring of Magic',
      ring2: 'Anillo de Vitalidad → Ring of Ice',
      pet: 'Demon / Dinorant Astral',
    },
  },
  DW_female: {
    displayName: 'Soul Master (Femenino)',
    title: 'Hechicera Astral',
    specialty: 'Casteo rápido en movimiento y control glacial continuo',
    atkSpeedRating: 1.07,
    critBasePct: 20,
    defenseBonusPct: 9,
    multBias: 0.99,
    cdBias: 0.93,
    penBias: 13,
    statFocus: 'Energía · Agilidad · Comando (hasta 65,000 c/u)',
    basicAttackName: 'Pulso Estelar en Carrera',
    armorPieces: {
      helm: 'Pad Helm (+0) → Venom Mist Helm',
      armor: 'Pad Armor (+0) → Venom Mist Armor',
      pants: 'Pad Pants (+0) → Venom Mist Pants',
      gloves: 'Pad Gloves (+0) → Venom Mist Gloves',
      boots: 'Pad Boots (+0) → Venom Mist Boots',
      shield: 'Skull Shield → Legendary Shield',
    },
    weapons: ['Skull Staff (+0)', 'Staff of Gorgon', 'Platina Wing Staff +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Ability',
      ring1: 'Anillo de Aprendiz → Ring of Magic',
      ring2: 'Anillo de Vitalidad → Ring of Wind',
      pet: 'Guardian Angel / Dinorant Estelar',
    },
  },
  ELF_male: {
    displayName: 'Muse Elf (Masculino)',
    title: 'Guardabosques Real',
    specialty: 'Disparos perforantes de precisión a media y larga distancia',
    atkSpeedRating: 1.06,
    critBasePct: 22,
    defenseBonusPct: 10,
    multBias: 1.02,
    cdBias: 0.98,
    penBias: 15,
    statFocus: 'Agilidad · Energía · Fuerza (hasta 65,000 c/u)',
    basicAttackName: 'Virote Perforante Real',
    armorPieces: {
      helm: 'Vine Helm (+0) → Red Spirit Helm',
      armor: 'Vine Armor (+0) → Red Spirit Armor',
      pants: 'Vine Pants (+0) → Red Spirit Pants',
      gloves: 'Vine Gloves (+0) → Red Spirit Gloves',
      boots: 'Vine Boots (+0) → Red Spirit Boots',
      shield: 'Elven Buckler → Elemental Shield',
    },
    weapons: ['Short Bow (+0)', 'Celestial Bow', 'Sylph Wind Bow +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Wind',
      ring1: 'Anillo de Aprendiz → Ring of Wind',
      ring2: 'Anillo de Vitalidad → Ring of Earth',
      pet: 'Uniria / Guardian Angel',
    },
  },
  ELF_female: {
    displayName: 'Muse Elf (Femenino)',
    title: 'Centinela Celestial',
    specialty: 'Cadencia suprema de flechas múltiples y auras tácticas',
    atkSpeedRating: 1.11,
    critBasePct: 24,
    defenseBonusPct: 10,
    multBias: 0.98,
    cdBias: 0.92,
    penBias: 12,
    statFocus: 'Agilidad · Energía · Vitalidad (hasta 65,000 c/u)',
    basicAttackName: 'Flecha Veloz Celestial',
    armorPieces: {
      helm: 'Vine Helm (+0) → Divine Helm',
      armor: 'Vine Armor (+0) → Divine Armor',
      pants: 'Vine Pants (+0) → Divine Pants',
      gloves: 'Vine Gloves (+0) → Divine Gloves',
      boots: 'Vine Boots (+0) → Divine Boots',
      shield: 'Elven Buckler → Elven Shield',
    },
    weapons: ['Short Bow (+0)', 'Saint Crossbow', 'Great Reign Crossbow +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Ability',
      ring1: 'Anillo de Aprendiz → Ring of Wind',
      ring2: 'Anillo de Vitalidad → Ring of Ice',
      pet: 'Uniria / Horn of Fenrir Dorado',
    },
  },
  DL_male: {
    displayName: 'Dark Lord (Masculino)',
    title: 'Emperador Oscuro',
    specialty: 'Daño crítico imperial y comandos con Cuervo Oscuro',
    atkSpeedRating: 1.01,
    critBasePct: 21,
    defenseBonusPct: 13,
    multBias: 1.04,
    cdBias: 1.02,
    penBias: 13,
    statFocus: 'Comando · Fuerza · Energía (hasta 65,000 c/u)',
    basicAttackName: 'Impacto de Cetro Imperial',
    armorPieces: {
      helm: 'Light Plate Mask (+0) → Dark Master Mask',
      armor: 'Light Plate Armor (+0) → Dark Master Armor',
      pants: 'Light Plate Pants (+0) → Dark Master Pants',
      gloves: 'Light Plate Gloves (+0) → Dark Master Gloves',
      boots: 'Light Plate Boots (+0) → Dark Master Boots',
      shield: 'Iron Buckler → Serpent Shield',
    },
    weapons: ['Battle Scepter (+0)', 'Lord Scepter', 'Soleil Scepter +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Fire',
      ring1: 'Anillo de Aprendiz → Ring of Fire',
      ring2: 'Anillo de Vitalidad → Ring of Earth',
      pet: 'Dark Raven / Dark Horse',
    },
  },
  DL_female: {
    displayName: 'Dark Lord (Femenino)',
    title: 'Soberana del Cetro',
    specialty: 'Ráfagas ígneas ágiles con menor enfriamiento en duelos',
    atkSpeedRating: 1.06,
    critBasePct: 22,
    defenseBonusPct: 11,
    multBias: 1.0,
    cdBias: 0.95,
    penBias: 14,
    statFocus: 'Comando · Agilidad · Energía (hasta 65,000 c/u)',
    basicAttackName: 'Azote Soberano de Llama',
    armorPieces: {
      helm: 'Light Plate Mask (+0) → Sunlight Mask',
      armor: 'Light Plate Armor (+0) → Sunlight Armor',
      pants: 'Light Plate Pants (+0) → Sunlight Pants',
      gloves: 'Light Plate Gloves (+0) → Sunlight Gloves',
      boots: 'Light Plate Boots (+0) → Sunlight Boots',
      shield: 'Iron Buckler → Bronze Shield Excelente',
    },
    weapons: ['Battle Scepter (+0)', 'Great Scepter', 'Shining Scepter +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Lightning',
      ring1: 'Anillo de Aprendiz → Ring of Fire',
      ring2: 'Anillo de Vitalidad → Ring of Wind',
      pet: 'Dark Raven / Dark Horse Real',
    },
  },
  MG_male: {
    displayName: 'Magic Gladiator (Masculino)',
    title: 'Señor de la Ruina',
    specialty: 'Híbrido fuerza/magia con remate de doble espada',
    atkSpeedRating: 1.04,
    critBasePct: 19,
    defenseBonusPct: 11,
    multBias: 1.03,
    cdBias: 1.0,
    penBias: 14,
    statFocus: 'Fuerza · Energía · Agilidad (hasta 65,000 c/u)',
    basicAttackName: 'Corte Dual Rúnico',
    armorPieces: {
      helm: 'Sin Yelmo (Diadema Rúnica MG)',
      armor: 'Storm Crow Armor (+0) → Volcano Armor',
      pants: 'Storm Crow Pants (+0) → Volcano Pants',
      gloves: 'Storm Crow Gloves (+0) → Volcano Gloves',
      boots: 'Storm Crow Boots (+0) → Volcano Boots',
      shield: 'Runic Buckler → Tower Shield',
    },
    weapons: ['Gladius (+0)', 'Rune Blade', 'Dark Reign Blade +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Lightning',
      ring1: 'Anillo de Aprendiz → Ring of Magic',
      ring2: 'Anillo de Vitalidad → Ring of Fire',
      pet: 'Imp / Horn of Dinorant',
    },
  },
  MG_female: {
    displayName: 'Magic Gladiator (Femenino)',
    title: 'Duelista Rúnica',
    specialty: 'Encadenamiento eléctrico veloz y movilidad táctica',
    atkSpeedRating: 1.09,
    critBasePct: 21,
    defenseBonusPct: 10,
    multBias: 0.99,
    cdBias: 0.94,
    penBias: 14,
    statFocus: 'Energía · Agilidad · Fuerza (hasta 65,000 c/u)',
    basicAttackName: 'Hoja Voltaica Veloz',
    armorPieces: {
      helm: 'Sin Yelmo (Tiara Voltaica MG)',
      armor: 'Storm Crow Armor (+0) → Hurricane Armor',
      pants: 'Storm Crow Pants (+0) → Hurricane Pants',
      gloves: 'Storm Crow Gloves (+0) → Hurricane Gloves',
      boots: 'Storm Crow Boots (+0) → Hurricane Boots',
      shield: 'Runic Buckler → Legendary Buckler',
    },
    weapons: ['Gladius (+0)', 'Explosion Blade', 'Imperial Sword +13'],
    jewelry: {
      pendant: 'Colgante del Aprendiz → Pendant of Ability',
      ring1: 'Anillo de Aprendiz → Ring of Wind',
      ring2: 'Anillo de Vitalidad → Ring of Magic',
      pet: 'Guardian Angel / Horn of Fenrir',
    },
  },
};

export function getVariantKey(classType: HeroClass, sex: CharacterSex = 'male'): CharacterVariantKey {
  return `${classType}_${sex}`;
}

export function getSkillCooldownSec(skill: SkillDef): number {
  if (typeof skill.cooldownSec === 'number') return skill.cooldownSec;
  if (skill.mpCost === 0) return 0.35;
  if (skill.isBuff) return 6.0;
  if (skill.damageMultiplier >= 2.0) return 3.2;
  if (skill.damageMultiplier >= 1.75) return 2.1;
  return 1.25;
}

export function getSkillRank(character: Pick<MuCharacter, 'skillLevels'> | null, skillId: string): number {
  const rank = character?.skillLevels?.[skillId] ?? 1;
  return Math.max(1, Math.min(10, rank));
}

export function getSkillUpgradeCost(currentRank: number): { skillPoints: number; zenCost: number } {
  return {
    skillPoints: currentRank >= 6 ? 2 : 1,
    zenCost: currentRank * 1800,
  };
}

export function getEffectiveSkillMultiplier(
  baseMultiplier: number,
  rank: number,
  variantKey: CharacterVariantKey,
  specialization: MuCharacter['specialization'] = 'balanced',
): number {
  const mod = VARIANT_MODIFIERS[variantKey] || VARIANT_MODIFIERS.DK_male;
  const rankBonus = 1 + (Math.max(1, rank) - 1) * 0.085;
  const specBonus = specialization === 'berserk' ? 1.08 : specialization === 'arcane' ? 1.05 : 1.0;
  return Number((baseMultiplier * mod.multBias * rankBonus * specBonus).toFixed(2));
}

export function buildAll10CharacterTables(): CharacterVariantProfile[] {
  const classes: HeroClass[] = ['DK', 'DW', 'ELF', 'DL', 'MG'];
  const sexes: CharacterSex[] = ['male', 'female'];
  const tables: CharacterVariantProfile[] = [];

  for (const classType of classes) {
    const baseSkills = MU_SKILLS[classType];
    for (const sex of sexes) {
      const key = getVariantKey(classType, sex);
      const mod = VARIANT_MODIFIERS[key];
      const rows: VariantSkillRow[] = baseSkills.map((sk, idx) => {
        const baseCd = getSkillCooldownSec(sk);
        const tunedCd = Number(Math.max(0.32, baseCd * mod.cdBias).toFixed(2));
        const tunedMult = Number((sk.damageMultiplier * mod.multBias).toFixed(2));
        const critBonus = mod.critBasePct + (idx === 2 || idx === 5 ? 8 : 2);
        const armorPen = mod.penBias + (sk.isAoe ? 0 : 6);
        const dpsIndex = Math.round(
          ((tunedMult * mod.atkSpeedRating * (1 + (critBonus / 100) * 0.5)) /
            Math.max(0.6, Math.sqrt(tunedCd))) *
            100,
        );
        return {
          skillId: sk.id,
          name: sk.name,
          baseMultiplier: tunedMult,
          cooldownSec: tunedCd,
          mpCost: sk.mpCost,
          critBonusPct: critBonus,
          armorPenPct: armorPen,
          roleTag: sk.isBuff ? 'Buff / Supervivencia' : sk.isAoe ? 'Área Táctica' : idx === 0 ? 'Básico Rápido' : 'Ejecución Single',
          competitiveDpsIndex: dpsIndex,
        };
      });

      const nonBuff = rows.filter((r) => r.roleTag !== 'Buff / Supervivencia');
      const avgDps = Math.round(nonBuff.reduce((s, r) => s + r.competitiveDpsIndex, 0) / nonBuff.length);
      // Normalize competitive score across the 10 heroes within a tight 96-104 balanced band
      const rawScore = Math.round(92 + (avgDps - 140) * 0.16 + mod.defenseBonusPct * 0.25 + (mod.critBasePct - 18) * 0.22);
      const competitivePowerScore = Math.max(96, Math.min(104, rawScore));

      const classDef = MU_CLASSES.find((c) => c.id === classType) ?? MU_CLASSES[0];
      const bs = classDef.baseStats;
      tables.push({
        variantKey: key,
        classType,
        sex,
        displayName: mod.displayName,
        title: mod.title,
        specialty: mod.specialty,
        atkSpeedRating: mod.atkSpeedRating,
        critBasePct: mod.critBasePct,
        defenseBonusPct: mod.defenseBonusPct,
        competitivePowerScore,
        starterStats: { str: bs.str, agi: bs.agi, vit: bs.vit, ene: bs.ene, cmd: bs.cmd },
        statFocus: mod.statFocus,
        basicAttackName: mod.basicAttackName,
        armorPieces: mod.armorPieces,
        weapons: mod.weapons,
        jewelry: mod.jewelry,
        skills: rows,
      });
    }
  }
  return tables;
}

export const TEN_CHARACTER_TABLES: CharacterVariantProfile[] = buildAll10CharacterTables();

export function getVariantProfile(classType: HeroClass, sex: CharacterSex = 'male'): CharacterVariantProfile {
  const key = getVariantKey(classType, sex);
  return TEN_CHARACTER_TABLES.find((t) => t.variantKey === key) || TEN_CHARACTER_TABLES[0];
}

// --- Monster Powers, Dynamic Level Scaling & Damage Tables ---

const MONSTER_POWERS_BY_ARCHETYPE: Record<MonsterArchetype, MonsterPowerDef[]> = {
  bull: [
    { id: 'bull_charge', name: 'Embestida Brutal', damageMultiplier: 1.45, range: 4.5, cooldownSec: 4.5, colorHex: '#f97316', effectDebuff: 'Aturdido' },
    { id: 'bull_stomp', name: 'Pisotón Sísmico', damageMultiplier: 1.65, range: 5.5, cooldownSec: 7.0, colorHex: '#ef4444' },
  ],
  hound: [
    { id: 'hound_bite', name: 'Mordida Sangrante', damageMultiplier: 1.38, range: 3.8, cooldownSec: 4.0, colorHex: '#dc2626', effectDebuff: 'Sangrado' },
  ],
  skeleton: [
    { id: 'skel_curse', name: 'Maldición Ósea', damageMultiplier: 1.5, range: 8.5, cooldownSec: 5.0, colorHex: '#a855f7', effectDebuff: 'Debilitado' },
  ],
  dragon: [
    { id: 'drag_breath', name: 'Aliento Ígneo', damageMultiplier: 1.6, range: 9.0, cooldownSec: 4.8, colorHex: '#fb923c', effectDebuff: 'Quemadura' },
  ],
  yeti: [
    { id: 'yeti_frost', name: 'Golpe Glacial', damageMultiplier: 1.55, range: 5.2, cooldownSec: 4.5, colorHex: '#38bdf8', effectDebuff: 'Congelado' },
  ],
  ice_queen: [
    { id: 'iq_blizzard', name: 'Ventisca Real', damageMultiplier: 1.8, range: 10.5, cooldownSec: 5.0, colorHex: '#67e8f9', effectDebuff: 'Escarcha' },
  ],
  goblin: [
    { id: 'gob_ambush', name: 'Daga Envenenada', damageMultiplier: 1.35, range: 4.0, cooldownSec: 4.2, colorHex: '#22c55e', effectDebuff: 'Veneno' },
  ],
  golem: [
    { id: 'golem_slam', name: 'Impacto Tectónico', damageMultiplier: 1.7, range: 5.8, cooldownSec: 5.5, colorHex: '#eab308' },
  ],
  shadow: [
    { id: 'shad_nova', name: 'Pulso Sombrío', damageMultiplier: 1.6, range: 8.0, cooldownSec: 4.8, colorHex: '#818cf8' },
  ],
  gorgon: [
    { id: 'gorg_ray', name: 'Mirada Petrificante', damageMultiplier: 1.68, range: 9.5, cooldownSec: 5.2, colorHex: '#14b8a6' },
  ],
  balrog: [
    { id: 'bal_inferno', name: 'Guadaña Infernal', damageMultiplier: 1.85, range: 9.5, cooldownSec: 4.8, colorHex: '#f43f5e', effectDebuff: 'Quemadura' },
  ],
  hydra: [
    { id: 'hyd_wave', name: 'Marejada Abisal', damageMultiplier: 1.85, range: 11.0, cooldownSec: 5.0, colorHex: '#06b6d4' },
  ],
  mutant: [
    { id: 'mut_cleave', name: 'Garra Mutante', damageMultiplier: 1.55, range: 4.8, cooldownSec: 4.2, colorHex: '#f59e0b' },
  ],
  phoenix: [
    { id: 'phx_flare', name: 'Fénix Solar', damageMultiplier: 1.85, range: 11.0, cooldownSec: 5.0, colorHex: '#fbbf24' },
  ],
  mech: [
    { id: 'mech_laser', name: 'Haz Cibernético', damageMultiplier: 1.72, range: 9.0, cooldownSec: 4.6, colorHex: '#38bdf8' },
  ],
  selupan: [
    { id: 'sel_venom', name: 'Red Glacial Tóxica', damageMultiplier: 1.9, range: 10.0, cooldownSec: 5.2, colorHex: '#c084fc' },
  ],
  lava_giant: [
    { id: 'lava_eruption', name: 'Erupción Magmática', damageMultiplier: 1.95, range: 10.0, cooldownSec: 4.8, colorHex: '#ef4444', effectDebuff: 'Quemadura' },
  ],
  boss: [
    { id: 'boss_cataclysm', name: 'Cataclismo del Señor', damageMultiplier: 2.0, range: 11.0, cooldownSec: 4.5, colorHex: '#f43f5e' },
  ],
};

export function computeHeroDamageStats(
  character: Pick<MuCharacter, 'classType' | 'sex' | 'level' | 'resets' | 'str' | 'agi' | 'vit' | 'ene' | 'cmd'>,
  equippedItems: MuItem[],
): {
  physicalPower: number;
  magicPower: number;
  defense: number;
  critChancePct: number;
  avgAttack: number;
} {
  const usable = equippedItems.filter((i) => i.isEquipped && (i.durability ?? 100) > 0);
  const gearMin = usable.reduce((s, i) => s + i.minDmg + i.enhanceLevel * 2, 0);
  const gearMax = usable.reduce((s, i) => s + i.maxDmg + i.enhanceLevel * 3, 0);
  const gearMagic = usable.reduce((s, i) => s + i.magicPower + i.enhanceLevel * 3, 0);
  const gearDef = usable.reduce((s, i) => s + i.defense + i.enhanceLevel * 2, 0);

  const profile = getVariantProfile(character.classType, character.sex ?? 'male');
  const resetMult = 1 + (character.resets || 0) * 0.14;
  // Todos los 5 atributos (hasta 65,000 c/u) escalan el combate del personaje
  const physicalPower = Math.round(
    ((character.str * 1.15 + character.agi * 0.42 + character.vit * 0.18 + character.ene * 0.12 + character.cmd * 0.65) * 0.9 +
      (gearMin + gearMax) * 0.65) *
      resetMult,
  );
  const magicPower = Math.round(
    ((character.ene * 1.2 + character.cmd * 0.45 + character.agi * 0.28 + character.vit * 0.14 + character.str * 0.15) * 0.9 +
      gearMagic) *
      resetMult,
  );
  const defense = Math.round(
    (character.agi * 0.48 + character.vit * 0.52 + character.str * 0.16 + character.ene * 0.12 + character.cmd * 0.25 + gearDef) *
      (1 + profile.defenseBonusPct / 100) *
      (1 + (character.resets || 0) * 0.08),
  );
  const critChancePct = Math.min(72, profile.critBasePct + Math.floor((character.agi + character.cmd) / 2800));
  const avgAttack = Math.max(physicalPower, magicPower);
  return { physicalPower, magicPower, defense, critChancePct, avgAttack };
}

export function computeHeroDefenseMitigation(
  rawDamage: number,
  isCrit: boolean,
  character: Pick<MuCharacter, 'classType' | 'sex' | 'level' | 'resets' | 'str' | 'agi' | 'vit' | 'ene' | 'cmd'>,
  equippedItems: MuItem[],
): { finalDamage: number; mitigatedPct: number } {
  const { defense } = computeHeroDamageStats(character, equippedItems);
  // Sin tope mínimo artificial: si el monstruo pega más que la defensa, el héroe recibe daño letal real
  const effectiveDefense = isCrit ? defense * 0.32 : defense * 0.56;
  const reduced = Math.max(1, Math.round(rawDamage - effectiveDefense));
  const ratioFloor = Math.max(1, Math.round(rawDamage * (isCrit ? 0.25 : 0.12)));
  const finalDamage = Math.max(ratioFloor, reduced);
  const mitigatedPct = Math.max(0, Math.min(92, Math.round((1 - finalDamage / Math.max(1, rawDamage)) * 100)));
  return { finalDamage, mitigatedPct };
}

export function scaleMonsterForPlayerLevel(
  def: MapMonsterDef,
  playerLevel: number,
  playerAvgAttack = 75,
  mapRange?: { minLevel: number; maxLevel: number },
): ScaledMonsterStats {
  const safePlayerLevel = Math.max(1, Math.min(MAX_HERO_LEVEL, playerLevel));
  // Mantiene la identidad del mapa (1-24 Flaris, 25-46 Robledal, 47-76 Puerto, 77-99 Ceniza) adaptándose dinámicamente al nivel
  let targetLevel = def.isBoss
    ? Math.max(def.level, Math.round(def.level * 0.6 + safePlayerLevel * 0.45) + 2)
    : Math.max(def.level, Math.round(def.level * 0.55 + safePlayerLevel * 0.52));

  if (mapRange) {
    targetLevel = Math.max(mapRange.minLevel, Math.min(mapRange.maxLevel, targetLevel));
  }

  const levelRatio = targetLevel / Math.max(1, def.level);
  const hpFactor = 1 + (levelRatio - 1) * 0.58 + (safePlayerLevel - 1) * 0.035;
  const dmgFactor = 1 + (levelRatio - 1) * 0.46 + (safePlayerLevel - 1) * 0.024;

  const maxHp = Math.round(def.hp * hpFactor * (def.isBoss ? 1.18 : 1));
  const damage = Math.round(def.damage * dmgFactor);
  const defense = Math.round(targetLevel * 1.45 + (def.isBoss ? 18 : 6));
  const xp = Math.round(def.xp * (1 + (safePlayerLevel - 1) * 0.11));
  const zen = Math.round(def.zen * (1 + (safePlayerLevel - 1) * 0.09));

  const powers = MONSTER_POWERS_BY_ARCHETYPE[def.archetype] || MONSTER_POWERS_BY_ARCHETYPE.bull;
  const topPower = powers[0];
  const playerEstNormal = Math.max(10, Math.round(playerAvgAttack - defense * 0.25));
  const critChancePct = def.isBoss ? 24 : Math.min(20, 12 + Math.floor(targetLevel / 14));
  const critMultiplier = def.isBoss ? 1.75 : 1.55;

  return {
    name: def.name,
    archetype: def.archetype,
    baseLevel: def.level,
    scaledLevel: targetLevel,
    hp: maxHp,
    maxHp,
    damage,
    defense,
    xp,
    zen,
    isBoss: Boolean(def.isBoss),
    powers,
    damageTable: {
      basicAttack: damage,
      specialPower: Math.round(damage * topPower.damageMultiplier),
      criticalHit: Math.round(damage * critMultiplier),
      critChancePct,
      critMultiplier,
      playerEstNormal,
      playerEstCrit: Math.round(playerEstNormal * 1.45),
    },
  };
}

export function rollMonsterAttack(
  scaledStats: ScaledMonsterStats,
  rand = Math.random(),
): { damage: number; isCrit: boolean; isPower: boolean; attackLabel: string } {
  const isCrit = rand * 100 < scaledStats.damageTable.critChancePct;
  const topPower = scaledStats.powers[0];
  const isPower = !isCrit && rand > 0.68 && Boolean(topPower);
  if (isCrit) {
    return {
      damage: scaledStats.damageTable.criticalHit,
      isCrit: true,
      isPower: false,
      attackLabel: 'CRÍTICO',
    };
  }
  if (isPower && topPower) {
    return {
      damage: scaledStats.damageTable.specialPower,
      isCrit: false,
      isPower: true,
      attackLabel: topPower.name,
    };
  }
  return {
    damage: scaledStats.damageTable.basicAttack,
    isCrit: false,
    isPower: false,
    attackLabel: 'Golpe Básico',
  };
}

// --- 80% Auto-Aim System ---

export interface AutoAimCandidate {
  index: number;
  x: number;
  z: number;
  dist: number;
  isBoss?: boolean;
}

export interface AutoAimResult {
  targetIndex: number;
  targetAngle: number;
  blendedAngle: number;
  dist: number;
  coveragePct: number;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 80% Auto-Aim assist across all 10 hero variants:
 * Picks the highest-priority target inside aim range (favoring forward cone & proximity),
 * and blends 80% toward the exact target vector so melee and ranged attacks stay snappy and reliable.
 */
export function findAutoAimTarget(
  heroX: number,
  heroZ: number,
  heroRotY: number,
  maxRange: number,
  candidates: AutoAimCandidate[],
  assistWeight = 0.8,
): AutoAimResult | null {
  if (!candidates.length) return null;
  let best: AutoAimCandidate | null = null;
  let bestScore = Infinity;

  for (const c of candidates) {
    if (c.dist > maxRange) continue;
    const angleToTarget = Math.atan2(c.x - heroX, c.z - heroZ);
    const angleDiff = Math.abs(normalizeAngle(angleToTarget - heroRotY));
    // Lower score is better: distance + slight forward cone preference
    const conePenalty = angleDiff * 2.2;
    const bossBonus = c.isBoss ? -1.4 : 0;
    const score = c.dist + conePenalty + bossBonus;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) return null;
  const targetAngle = Math.atan2(best.x - heroX, best.z - heroZ);
  const delta = normalizeAngle(targetAngle - heroRotY);
  const clampedWeight = Math.max(0, Math.min(1, assistWeight));
  const blendedAngle = normalizeAngle(heroRotY + delta * clampedWeight);

  return {
    targetIndex: best.index,
    targetAngle,
    blendedAngle,
    dist: best.dist,
    coveragePct: Math.round(clampedWeight * 100),
  };
}

// --- Active Effects / Buffs / Debuffs ---

export function createSkillBuffEffect(skill: SkillDef, rank = 1): ActiveEffect {
  const duration = 18 + Math.min(12, rank * 2);
  if (skill.id === 'dk_swell_life') {
    return {
      id: 'eff-inner-life',
      name: 'Swell Life (Inner)',
      kind: 'buff',
      statHint: '+20% DEF · +15% ATK',
      color: '#f43f5e',
      remainingSec: duration,
      totalSec: duration,
      atkBonusPct: 15 + rank * 2,
      defBonusPct: 20 + rank * 2,
    };
  }
  if (skill.id === 'elf_infinity') {
    return {
      id: 'eff-infinity-arrow',
      name: 'Infinity Arrow',
      kind: 'buff',
      statHint: '+22% Crit · +14% Vel.',
      color: '#2dd4bf',
      remainingSec: duration,
      totalSec: duration,
      atkBonusPct: 14 + rank * 2,
      critBonusPct: 22,
      speedBonusPct: 14,
    };
  }
  if (skill.id === 'elf_bless') {
    return {
      id: 'eff-elf-aura',
      name: 'Aura de Protección',
      kind: 'buff',
      statHint: '+26% DEF · Regeneración',
      color: '#4ade80',
      remainingSec: duration,
      totalSec: duration,
      defBonusPct: 26 + rank * 2,
    };
  }
  return {
    id: `eff-${skill.id}`,
    name: skill.name,
    kind: 'buff',
    statHint: '+18% ATK · +16% Crit',
    color: '#c084fc',
    remainingSec: duration,
    totalSec: duration,
    atkBonusPct: 18 + rank * 2,
    critBonusPct: 16,
  };
}

export function aggregateActiveEffects(effects: ActiveEffect[]) {
  let atkBonusPct = 0;
  let defBonusPct = 0;
  let critBonusPct = 0;
  let speedBonusPct = 0;
  for (const eff of effects) {
    atkBonusPct += eff.atkBonusPct ?? 0;
    defBonusPct += eff.defBonusPct ?? 0;
    critBonusPct += eff.critBonusPct ?? 0;
    speedBonusPct += eff.speedBonusPct ?? 0;
  }
  return { atkBonusPct, defBonusPct, critBonusPct, speedBonusPct };
}

// --- Achievements System ---

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: 'ach-first-blood',
    title: 'Primer Cazador de Lorencia',
    description: 'Derrota tu primer monstruo fuera de las murallas.',
    category: 'combat',
    targetValue: 1,
    rewardZen: 3500,
    rewardBless: 1,
    rewardSkillPoints: 1,
    metricKey: 'kills',
  },
  {
    id: 'ach-slayer-25',
    title: 'Vanguardia del Reino',
    description: 'Elimina 25 monstruos en zonas de caza dinámicas.',
    category: 'combat',
    targetValue: 25,
    rewardZen: 12000,
    rewardBless: 2,
    rewardSkillPoints: 2,
    metricKey: 'kills',
  },
  {
    id: 'ach-veteran-10',
    title: 'Veterano Nivel 10',
    description: 'Alcanza el nivel 10 con tu héroe.',
    category: 'progression',
    targetValue: 10,
    rewardZen: 18000,
    rewardBless: 2,
    rewardSkillPoints: 2,
    metricKey: 'level',
  },
  {
    id: 'ach-skill-master',
    title: 'Maestro de Habilidades',
    description: 'Sube rangos de habilidad hasta acumular 10 puntos de maestría.',
    category: 'progression',
    targetValue: 10,
    rewardZen: 15000,
    rewardBless: 2,
    rewardSkillPoints: 2,
    metricKey: 'skillRanks',
  },
  {
    id: 'ach-forgemaster',
    title: 'Forjador Excelente (+9)',
    description: 'Equipa o forja un ítem de nivel +9 o superior.',
    category: 'forge',
    targetValue: 9,
    rewardZen: 16000,
    rewardBless: 3,
    rewardSkillPoints: 1,
    metricKey: 'enhanceMax',
  },
  {
    id: 'ach-duelist',
    title: 'Campeón de Duelos Asíncronos',
    description: 'Gana al menos 1 duelo rápido vía Wi-Fi o Bluetooth.',
    category: 'multiplayer',
    targetValue: 1,
    rewardZen: 14000,
    rewardBless: 2,
    rewardSkillPoints: 2,
    metricKey: 'duelWins',
  },
  {
    id: 'ach-trader',
    title: 'Pacto de Comercio Seguro',
    description: 'Completa un intercambio o recompensa cooperativa persistente.',
    category: 'multiplayer',
    targetValue: 1,
    rewardZen: 10000,
    rewardBless: 1,
    rewardSkillPoints: 1,
    metricKey: 'trades',
  },
];

export interface AchievementProgressItem {
  def: AchievementDef;
  current: number;
  unlocked: boolean;
  pct: number;
}

export function evaluateAchievements(
  character: MuCharacter,
  items: MuItem[],
  ledgerCount: number,
  eventCount: number,
): {
  progress: AchievementProgressItem[];
  newlyUnlocked: AchievementDef[];
} {
  const alreadyUnlocked = new Set(character.unlockedAchievements || []);
  const skillRanksSum = Object.values(character.skillLevels || {}).reduce((s, v) => s + v, 0) || 6;
  const maxEnhance = items.reduce((m, i) => Math.max(m, i.enhanceLevel), 0);

  const metrics: Record<AchievementDef['metricKey'], number> = {
    kills: character.kills,
    level: character.level,
    skillRanks: skillRanksSum,
    duelWins: character.duelWins ?? 0,
    trades: ledgerCount,
    enhanceMax: maxEnhance,
    events: eventCount,
  };

  const newlyUnlocked: AchievementDef[] = [];
  const progress: AchievementProgressItem[] = ACHIEVEMENT_DEFS.map((def) => {
    const current = metrics[def.metricKey] ?? 0;
    const reached = current >= def.targetValue;
    const unlocked = alreadyUnlocked.has(def.id) || reached;
    if (reached && !alreadyUnlocked.has(def.id)) {
      newlyUnlocked.push(def);
    }
    return {
      def,
      current: Math.min(def.targetValue, current),
      unlocked,
      pct: Math.min(100, Math.round((current / def.targetValue) * 100)),
    };
  });

  return { progress, newlyUnlocked };
}

// --- Asynchronous Quick Duels (Wi-Fi & Bluetooth Offline Snapshot) ---

export function buildAsyncDuelChallenge(
  character: MuCharacter,
  items: MuItem[],
  transport: TransportMode,
): AsyncDuelChallenge {
  const sex = character.sex ?? 'male';
  const variantKey = getVariantKey(character.classType, sex);
  const profile = getVariantProfile(character.classType, sex);
  const equipped = items.filter((i) => i.isEquipped && (i.durability ?? 100) > 0);
  const gearMin = equipped.reduce((s, i) => s + i.minDmg, 0);
  const gearMax = equipped.reduce((s, i) => s + i.maxDmg, 0);
  const gearDef = equipped.reduce((s, i) => s + i.defense, 0);
  const gearMag = equipped.reduce((s, i) => s + i.magicPower, 0);
  const weapon = equipped.find((i) => i.slot === 'weapon');

  const attack = Math.round(character.str * 0.8 + (gearMin + gearMax) * 0.5 + character.cmd * 0.35);
  const magic = Math.round(character.ene * 0.85 + gearMag);
  const defense = Math.round(character.agi * 0.5 + gearDef * (1 + profile.defenseBonusPct / 100));

  const skills = MU_SKILLS[character.classType];
  const avgSkillMult = Number(
    (
      skills.reduce(
        (sum, sk) => sum + getEffectiveSkillMultiplier(sk.damageMultiplier, getSkillRank(character, sk.id), variantKey, character.specialization),
        0,
      ) / skills.length
    ).toFixed(2),
  );

  const combatPower = Math.round(attack * 1.4 + magic * 1.1 + defense * 1.2 + character.maxHp * 0.35 + avgSkillMult * 40);

  return {
    id: `duel-${character.id}-${Date.now().toString(36)}`,
    challengerId: character.id,
    challengerName: character.name,
    variantKey,
    level: character.level,
    combatPower,
    attack,
    defense,
    magic,
    maxHp: character.maxHp,
    critChance: profile.critBasePct,
    avgSkillMult,
    transport,
    topWeapon: weapon ? `${weapon.name} +${weapon.enhanceLevel}` : 'Arma Estándar',
    createdAt: new Date().toISOString(),
  };
}

export function encodeDuelToken(challenge: AsyncDuelChallenge): string {
  const json = JSON.stringify(challenge);
  if (typeof Buffer !== 'undefined') {
    return `MUDUEL1:${Buffer.from(json, 'utf8').toString('base64')}`;
  }
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return `MUDUEL1:${btoa(bin)}`;
}

export function decodeDuelToken(token: string): AsyncDuelChallenge | null {
  try {
    const trimmed = token.trim();
    if (!trimmed.startsWith('MUDUEL1:')) return null;
    const b64 = trimmed.slice('MUDUEL1:'.length);
    let json = '';
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(b64, 'base64').toString('utf8');
    } else {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    }
    const parsed = JSON.parse(json) as AsyncDuelChallenge;
    if (!parsed?.challengerName || !parsed?.variantKey || typeof parsed.combatPower !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveAsyncDuel(
  playerChallenge: AsyncDuelChallenge,
  opponentChallenge: AsyncDuelChallenge,
  transport: TransportMode,
  seedInput?: number,
): AsyncDuelRecord {
  let seed =
    seedInput ??
    (playerChallenge.combatPower * 31 + opponentChallenge.combatPower * 17 + playerChallenge.level * 13);
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  let pHp = playerChallenge.maxHp;
  let oHp = opponentChallenge.maxHp;
  let damageDealt = 0;
  let damageTaken = 0;
  const roundLog: string[] = [];
  let rounds = 0;

  while (pHp > 0 && oHp > 0 && rounds < 12) {
    rounds++;
    const pOffense = (playerChallenge.attack + playerChallenge.magic * 0.72) * playerChallenge.avgSkillMult;
    const pCrit = nextRand() * 100 < playerChallenge.critChance ? 1.45 : 0.92 + nextRand() * 0.18;
    const pDmg = Math.max(18, Math.round((pOffense - opponentChallenge.defense * 0.36) * 0.42 * pCrit));
    oHp = Math.max(0, oHp - pDmg);
    damageDealt += pDmg;
    roundLog.push(
      `Ronda ${rounds}: ${playerChallenge.challengerName} golpea por ${pDmg}${pCrit > 1.2 ? ' (CRÍTICO)' : ''} · HP rival: ${oHp}`,
    );
    if (oHp <= 0) break;

    const oOffense = (opponentChallenge.attack + opponentChallenge.magic * 0.72) * opponentChallenge.avgSkillMult;
    const oCrit = nextRand() * 100 < opponentChallenge.critChance ? 1.45 : 0.92 + nextRand() * 0.18;
    const oDmg = Math.max(15, Math.round((oOffense - playerChallenge.defense * 0.36) * 0.42 * oCrit));
    pHp = Math.max(0, pHp - oDmg);
    damageTaken += oDmg;
    roundLog.push(
      `Ronda ${rounds}: ${opponentChallenge.challengerName} responde por ${oDmg}${oCrit > 1.2 ? ' (CRÍTICO)' : ''} · Tu HP: ${pHp}`,
    );
  }

  const won = oHp <= 0 || pHp >= oHp;
  const rewardZen = won ? 6500 + opponentChallenge.level * 350 : 2200 + opponentChallenge.level * 120;

  return {
    id: `duelrec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    challengerName: playerChallenge.challengerName,
    opponentName: opponentChallenge.challengerName,
    opponentVariant: opponentChallenge.variantKey,
    opponentLevel: opponentChallenge.level,
    transportMode: transport,
    won,
    rounds,
    damageDealt,
    damageTaken,
    rewardZen,
    summary: won
      ? `Victoria en ${rounds} rondas vs ${opponentChallenge.challengerName} (${transport.toUpperCase()})`
      : `Derrota disputada en ${rounds} rondas vs ${opponentChallenge.challengerName}`,
    roundLog,
    createdAt: new Date().toISOString(),
  };
}
