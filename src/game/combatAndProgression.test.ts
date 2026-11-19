import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_AIM_PROBABILITY,
  MAX_HERO_LEVEL,
  MAX_STAT_POINTS,
  POINTS_PER_LEVEL,
  TEN_CHARACTER_TABLES,
  buildAsyncDuelChallenge,
  computeHeroDamageStats,
  computeHeroDefenseMitigation,
  decodeDuelToken,
  encodeDuelToken,
  evaluateAchievements,
  findAutoAimTarget,
  getEffectiveSkillMultiplier,
  resolveAsyncDuel,
  rollAutoAimHit,
  rollMonsterAttack,
  scaleMonsterForPlayerLevel,
} from './combatAndProgression';
import { getDefaultComboConfig, getStarterItemsForMuClass } from '../data/muSkillsAndClasses';
import { MU_MAPS } from '../data/muWorldData';
import type { HeroClass, MapMonsterDef, MuCharacter } from '../types/game';

function makeTestChar(overrides: Partial<MuCharacter> = {}): MuCharacter {
  const id = 'chr-test-1';
  const items = getStarterItemsForMuClass(id, 'TestHero', overrides.classType ?? 'DK');
  return {
    id,
    accountId: 'acc-test',
    name: 'TestHero',
    class: overrides.classType ?? 'DK',
    classType: overrides.classType ?? 'DK',
    sex: 'male',
    level: 10,
    xp: 0,
    xpToNext: 500,
    unspentPoints: 5,
    skillPoints: 3,
    skillLevels: {},
    currentMapId: 'flaris',
    str: 65,
    agi: 42,
    vit: 45,
    ene: 30,
    cmd: 20,
    zen: 50000,
    bless: 5,
    soul: 5,
    chaos: 2,
    life: 1,
    creation: 1,
    harmony: 1,
    hp: 420,
    maxHp: 420,
    mp: 180,
    maxMp: 180,
    sd: 260,
    maxSd: 260,
    ag: 100,
    maxAg: 100,
    kills: 0,
    resets: 0,
    equipment: items.filter((i) => i.isEquipped),
    inventory: items.filter((i) => !i.isEquipped),
    updatedAt: Date.now(),
    isSynced: false,
    ...overrides,
  };
}

test('only the 4 approved Madrigal maps exist with exact level ranges and no rain weather', () => {
  assert.deepEqual(
    MU_MAPS.map((m) => [m.id, m.minLevel, m.maxLevel]),
    [
      ['flaris', 1, 24],
      ['robledal', 25, 46],
      ['puerto', 47, 76],
      ['ceniza', 77, 99],
    ],
  );
  for (const m of MU_MAPS) {
    assert.notEqual(String(m.weather), 'rain');
  }
});

test('starter gear never includes golden wings across all 5 classes', () => {
  const classes: HeroClass[] = ['DK', 'DW', 'ELF', 'DL', 'MG'];
  for (const cls of classes) {
    const items = getStarterItemsForMuClass('c1', 'Hero', cls);
    assert.equal(items.some((i) => i.slot === 'wings' || i.category === 'wings' || i.id.startsWith('wg')), false);
  }
});

test('progression constants enforce +5 pts/level, Lv.99 reset cap, and 65,000 stat ceiling', () => {
  assert.equal(POINTS_PER_LEVEL, 5);
  assert.equal(MAX_HERO_LEVEL, 99);
  assert.equal(MAX_STAT_POINTS, 65000);
});

test('all 10 character variants exist, each has 10 unique skills + 5-skill combo, and are competitively balanced', () => {
  assert.equal(TEN_CHARACTER_TABLES.length, 10);
  const scores = TEN_CHARACTER_TABLES.map((t) => t.competitivePowerScore);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  assert.ok(maxScore - minScore <= 10, `Spread too large: ${minScore}..${maxScore}`);
  for (const profile of TEN_CHARACTER_TABLES) {
    assert.equal(profile.skills.length, 10);
    const uniqueSkillIds = new Set(profile.skills.map((s) => s.skillId));
    assert.equal(uniqueSkillIds.size, 10);
    assert.ok(profile.basicAttackName.length > 3);
    assert.ok(profile.weapons.length >= 3);
    assert.ok(profile.armorPieces.armor && profile.armorPieces.boots && profile.armorPieces.shield);
    assert.ok(profile.jewelry.pendant && profile.jewelry.ring1 && profile.jewelry.ring2 && profile.jewelry.pet);
  }
  for (const cls of ['DK', 'DW', 'ELF', 'DL', 'MG'] as HeroClass[]) {
    const combo = getDefaultComboConfig(cls);
    assert.equal(combo.comboSkillIds.length, 5);
    assert.equal(new Set(combo.comboSkillIds).size, 5);
  }
});

test('hero attack scales strongly toward 65,000 stat cap and resets, and weak heroes take real lethal damage', () => {
  const beginner = makeTestChar({ level: 1, str: 24, agi: 18, vit: 20, ene: 12, cmd: 10, resets: 0 });
  const mid = makeTestChar({ level: 60, str: 2500, agi: 1800, vit: 1500, ene: 800, cmd: 400, resets: 2 });
  const capped = makeTestChar({ level: 99, str: 65000, agi: 65000, vit: 65000, ene: 65000, cmd: 65000, resets: 10 });

  const bStats = computeHeroDamageStats(beginner, beginner.equipment);
  const mStats = computeHeroDamageStats(mid, mid.equipment);
  const cStats = computeHeroDamageStats(capped, capped.equipment);
  assert.ok(mStats.avgAttack > bStats.avgAttack * 10);
  assert.ok(cStats.avgAttack > mStats.avgAttack * 10);

  const cenizaBossHit = computeHeroDefenseMitigation(450, true, beginner, beginner.equipment);
  assert.ok(cenizaBossHit.finalDamage > 200, 'Lv.1 hero must take lethal damage against Lv.99 monsters');
});

test('skill progression scales multiplier cleanly with rank and specialization', () => {
  const r1 = getEffectiveSkillMultiplier(1.5, 1, 'DK_male', 'balanced');
  const r5 = getEffectiveSkillMultiplier(1.5, 5, 'DK_male', 'balanced');
  const r5Berserk = getEffectiveSkillMultiplier(1.5, 5, 'DK_male', 'berserk');
  assert.ok(r5 > r1);
  assert.ok(r5Berserk > r5);
});

test('monsters scale dynamically inside map level bands and expose crit damage tables', () => {
  const baseMonster: MapMonsterDef = {
    name: 'Aibatt Joven',
    archetype: 'goblin',
    level: 3,
    hp: 120,
    damage: 10,
    xp: 45,
    zen: 550,
    x: 45,
    z: -260,
  };
  const atLv1Flaris = scaleMonsterForPlayerLevel(baseMonster, 1, 60, { minLevel: 1, maxLevel: 24 });
  const atLv99Flaris = scaleMonsterForPlayerLevel(baseMonster, 99, 500, { minLevel: 1, maxLevel: 24 });

  assert.ok(atLv1Flaris.scaledLevel >= 1 && atLv1Flaris.scaledLevel <= 24);
  assert.ok(atLv99Flaris.scaledLevel >= atLv1Flaris.scaledLevel && atLv99Flaris.scaledLevel <= 24);
  assert.ok(atLv99Flaris.maxHp > atLv1Flaris.maxHp * 2);
  assert.ok(atLv99Flaris.damageTable.criticalHit > atLv99Flaris.damageTable.basicAttack);
  assert.ok(atLv99Flaris.damageTable.critChancePct >= 10);

  const critHit = rollMonsterAttack(atLv99Flaris, 0.01);
  assert.equal(critHit.isCrit, true);
  assert.equal(critHit.damage, atLv99Flaris.damageTable.criticalHit);
});

test('60% auto-aim locks onto nearest target, blends angle by 60%, and rolls 60% hit accuracy', () => {
  assert.equal(AUTO_AIM_PROBABILITY, 0.6);
  const heroRotY = 0; // Facing +Z
  const res = findAutoAimTarget(
    0,
    0,
    heroRotY,
    12,
    [
      { index: 1, x: 5, z: 5, dist: Math.hypot(5, 5) },
      { index: 2, x: 18, z: 0, dist: 18 },
    ],
  );
  assert.ok(res !== null);
  assert.equal(res.targetIndex, 1);
  assert.equal(res.coveragePct, 60);
  assert.ok(Math.abs(res.blendedAngle - (Math.PI / 4) * 0.6) < 0.001);
  assert.equal(rollAutoAimHit(true, 0.6, 0.59), true);
  assert.equal(rollAutoAimHit(true, 0.6, 0.61), false);
});

test('achievements evaluate kills, level, and duel wins accurately', () => {
  const hero = makeTestChar({ kills: 30, level: 12, duelWins: 1 });
  const items = [
    ...hero.equipment.map((it, idx) => (idx === 0 ? { ...it, enhanceLevel: 9 } : it)),
    ...hero.inventory,
  ];
  const { newlyUnlocked } = evaluateAchievements(hero, items, 1, 1);
  const ids = newlyUnlocked.map((a) => a.id);
  assert.ok(ids.includes('ach-first-blood'));
  assert.ok(ids.includes('ach-slayer-25'));
  assert.ok(ids.includes('ach-veteran-10'));
  assert.ok(ids.includes('ach-forgemaster'));
  assert.ok(ids.includes('ach-duelist'));
  assert.ok(ids.includes('ach-trader'));
});

test('async duel token roundtrip & duel resolution work deterministically offline', () => {
  const heroA = makeTestChar({ id: 'a', name: 'Ares', classType: 'DK', level: 25, str: 130, maxHp: 680 });
  const heroB = makeTestChar({ id: 'b', name: 'Luna', classType: 'ELF', sex: 'female', level: 12, agi: 60, maxHp: 340 });

  const chalA = buildAsyncDuelChallenge(heroA, heroA.equipment, 'bluetooth');
  const chalB = buildAsyncDuelChallenge(heroB, heroB.equipment, 'wifi');

  const token = encodeDuelToken(chalB);
  const decoded = decodeDuelToken(token);
  assert.ok(decoded !== null);
  assert.equal(decoded.challengerName, 'Luna');

  const record = resolveAsyncDuel(chalA, decoded, 'bluetooth', 42);
  assert.equal(record.won, true);
  assert.ok(record.roundLog.length >= 1);
  assert.equal(record.transportMode, 'bluetooth');
});
