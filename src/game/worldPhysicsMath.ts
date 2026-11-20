import type { MapId } from '../types/game';

export const DEFAULT_CAMERA_DISTANCE = 5.4;
export const MIN_CAMERA_DISTANCE = 2.6;
export const MAX_CAMERA_DISTANCE = 11.5;

export interface CameraTerrainSampleInput {
  pivotX: number;
  pivotY: number;
  pivotZ: number;
  alpha: number; // Babylon ArcRotateCamera alpha (radians)
  beta: number; // Babylon ArcRotateCamera beta (radians from +Y up)
  desiredRadius: number;
  sampleTerrainHeight: (x: number, z: number) => number;
  minClearanceAboveTerrain?: number;
  prevPos?: { x: number; y: number; z: number } | null;
  dt?: number;
  smoothingRate?: number;
}

export interface CameraTerrainResult {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  clampedBeta: number;
  effectiveRadius: number;
}

export function clampCameraBeta(beta: number): number {
  return Math.max(0.28, Math.min(1.34, beta));
}

export function exponentialDamp(current: number, target: number, lambda: number, dt: number): number {
  if (!Number.isFinite(current)) return target;
  if (dt <= 0 || lambda <= 0) return target;
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

/**
 * Computes a collision-free third-person camera position that pulls in smoothly
 * along the boom when slopes rise behind the hero and never drops below the terrain surface,
 * preventing underside clipping or fallback-grid bleed-through when looking down.
 */
export function solveCameraWithTerrain(input: CameraTerrainSampleInput): CameraTerrainResult {
  const clearance = input.minClearanceAboveTerrain ?? 0.72;
  const clampedBeta = clampCameraBeta(input.beta);
  const sinBeta = Math.sin(clampedBeta);
  const cosBeta = Math.cos(clampedBeta);
  const dirX = Math.cos(input.alpha) * sinBeta;
  const dirY = cosBeta;
  const dirZ = Math.sin(input.alpha) * sinBeta;

  let safeRadius = Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, input.desiredRadius));
  const stepFractions = [0.28, 0.48, 0.68, 0.85, 1.0];

  for (const frac of stepFractions) {
    const dist = safeRadius * frac;
    const sx = input.pivotX + dirX * dist;
    const sy = input.pivotY + dirY * dist;
    const sz = input.pivotZ + dirZ * dist;
    const groundY = input.sampleTerrainHeight(sx, sz);
    const minY = groundY + clearance;
    if (sy < minY) {
      // Pull camera radius in slightly if the ray intersects a hill behind the hero
      if (frac < 0.95 && dirY < 0.32) {
        const pullRadius = Math.max(MIN_CAMERA_DISTANCE, dist * 0.84);
        safeRadius = Math.min(safeRadius, pullRadius);
      }
    }
  }

  let eyeX = input.pivotX + dirX * safeRadius;
  let eyeZ = input.pivotZ + dirZ * safeRadius;
  const groundAtEye = input.sampleTerrainHeight(eyeX, eyeZ);
  const groundAtMid = input.sampleTerrainHeight(
    input.pivotX + dirX * safeRadius * 0.55,
    input.pivotZ + dirZ * safeRadius * 0.55,
  );
  const requiredMinY = Math.max(groundAtEye + clearance, groundAtMid + clearance * 0.65, input.pivotY - 0.12);
  let eyeY = Math.max(input.pivotY + dirY * safeRadius, requiredMinY);

  if (input.prevPos && typeof input.dt === 'number' && input.dt > 0) {
    const rate = input.smoothingRate ?? 14;
    eyeX = exponentialDamp(input.prevPos.x, eyeX, rate, input.dt);
    eyeZ = exponentialDamp(input.prevPos.z, eyeZ, rate, input.dt);
    const dampedY = exponentialDamp(input.prevPos.y, eyeY, rate, input.dt);
    eyeY = Math.max(dampedY, groundAtEye + clearance * 0.92);
  }

  const effectiveRadius = Math.hypot(eyeX - input.pivotX, eyeY - input.pivotY, eyeZ - input.pivotZ);
  return { eyeX, eyeY, eyeZ, clampedBeta, effectiveRadius };
}

export interface HeroVerticalState {
  y: number;
  vy: number;
  isAirborne: boolean;
  airTime: number;
}

export interface HeroVerticalStepInput {
  state: HeroVerticalState;
  floorY: number;
  dt: number;
  jumpRequested?: boolean;
  jumpVelocity?: number;
  gravity?: number;
  slopeSnapTolerance?: number;
}

export interface HeroVerticalStepResult {
  state: HeroVerticalState;
  justJumped: boolean;
  justLanded: boolean;
  phase: 'grounded' | 'rising' | 'falling';
}

/**
 * Unified vertical & jump solver:
 * - Snaps cleanly to walkable slopes (downhill deltas <= 0.52m stay grounded without sliding).
 * - Only enters airborne state on explicit jump or true cliff drops (> 0.52m).
 * - Lands decisively with vy = 0 when heroY reaches floorY.
 */
export function stepHeroVerticalPhysics(input: HeroVerticalStepInput): HeroVerticalStepResult {
  const dt = Math.max(0, Math.min(0.08, input.dt));
  const gravity = input.gravity ?? 19.5;
  const jumpVelocity = input.jumpVelocity ?? 6.5;
  const slopeSnapTolerance = input.slopeSnapTolerance ?? 0.52;

  let { y, vy, isAirborne, airTime } = input.state;
  const floorY = input.floorY;
  let justJumped = false;
  let justLanded = false;

  if (!isAirborne && input.jumpRequested) {
    isAirborne = true;
    vy = jumpVelocity;
    airTime = 0;
    y = Math.max(y, floorY) + 0.02;
    justJumped = true;
  }

  if (!isAirborne) {
    const gapBelow = y - floorY;
    if (gapBelow > slopeSnapTolerance) {
      // Stepped off a ledge/cliff
      isAirborne = true;
      vy = -0.6;
      airTime = 0;
    } else {
      // Smooth uphill/downhill slope follow — zero sliding
      y = floorY;
      vy = 0;
      airTime = 0;
      return {
        state: { y, vy, isAirborne: false, airTime: 0 },
        justJumped,
        justLanded: false,
        phase: 'grounded',
      };
    }
  }

  vy -= gravity * dt;
  y += vy * dt;
  airTime += dt;

  if (y <= floorY && vy <= 0) {
    y = floorY;
    vy = 0;
    isAirborne = false;
    airTime = 0;
    justLanded = true;
    return {
      state: { y, vy, isAirborne: false, airTime: 0 },
      justJumped,
      justLanded,
      phase: 'grounded',
    };
  }

  return {
    state: { y, vy, isAirborne: true, airTime },
    justJumped,
    justLanded: false,
    phase: vy >= 0 ? 'rising' : 'falling',
  };
}

export type MinimapDotKind = 'hero' | 'npc' | 'friend' | 'monster';

export interface MinimapDot {
  id: string;
  kind: MinimapDotKind;
  xPct: number;
  yPct: number;
  label?: string;
}

export function projectToMinimap(
  worldX: number,
  worldZ: number,
  mapId: MapId,
  sizeMeters: number,
): { xPct: number; yPct: number } {
  const safeSize = Math.max(256, sizeMeters);
  // Flyff-backed worlds span [-1536..1536] around (0,0) or [0..3072] depending on map; detect bounds cleanly
  const half = safeSize / 2;
  let u = (worldX + half) / safeSize;
  let v = (worldZ + half) / safeSize;
  if (mapId === 'flaris' || mapId === 'robledal' || mapId === 'puerto' || mapId === 'ceniza') {
    // Check world bounds centered at 0 (-1536..1536)
    u = (worldX + half) / safeSize;
    v = 1 - (worldZ + half) / safeSize;
  }
  const xPct = Math.max(2, Math.min(98, u * 100));
  const yPct = Math.max(2, Math.min(98, v * 100));
  return { xPct, yPct };
}

export type LootFilterKey = 'zen' | 'life' | 'soul' | 'bless' | 'chaos' | 'creation' | 'talisman';

export interface LootFilterSettings {
  autoLootEnabled: boolean;
  zen: boolean;
  life: boolean;
  soul: boolean;
  bless: boolean;
  chaos: boolean;
  creation: boolean;
  talisman: boolean;
}

export const DEFAULT_LOOT_FILTERS: LootFilterSettings = {
  autoLootEnabled: true,
  zen: true,
  life: true,
  soul: true,
  bless: true,
  chaos: true,
  creation: true,
  talisman: true,
};

export function matchesLootFilter(
  dropKind: string,
  filters: LootFilterSettings,
  forceManual = false,
): boolean {
  if (forceManual) return true;
  if (!filters.autoLootEnabled) return false;
  switch (dropKind) {
    case 'zen':
      return filters.zen;
    case 'life':
      return filters.life;
    case 'soul':
      return filters.soul;
    case 'bless':
      return filters.bless;
    case 'chaos':
      return filters.chaos;
    case 'creation':
      return filters.creation;
    case 'talisman':
      return filters.talisman;
    default:
      return true;
  }
}

export type PotionTierId = 'menor' | 'media' | 'suprema';

export interface PotionConfig {
  tierId: PotionTierId;
  autoHealThresholdPct: number; // e.g., 50 -> heal when HP < 50% or MP < 35%
}

export interface PotionTierDef {
  id: PotionTierId;
  name: string;
  shortName: string;
  hpRestoreFlat: number;
  mpRestoreFlat: number;
  pctRestore: number;
  zenCost: number;
}

export const POTION_TIERS: PotionTierDef[] = [
  {
    id: 'menor',
    name: 'Poción Mixta Menor (HP+MP)',
    shortName: 'Menor +220',
    hpRestoreFlat: 220,
    mpRestoreFlat: 220,
    pctRestore: 0.35,
    zenCost: 0,
  },
  {
    id: 'media',
    name: 'Poción Mixta Mayor (HP+MP)',
    shortName: 'Mayor +550',
    hpRestoreFlat: 550,
    mpRestoreFlat: 550,
    pctRestore: 0.65,
    zenCost: 120,
  },
  {
    id: 'suprema',
    name: 'Elixir Supremo Dual (100% HP+MP)',
    shortName: 'Elixir 100%',
    hpRestoreFlat: 999999,
    mpRestoreFlat: 999999,
    pctRestore: 1.0,
    zenCost: 350,
  },
];

export const DEFAULT_POTION_CONFIG: PotionConfig = {
  tierId: 'suprema',
  autoHealThresholdPct: 55,
};

export function computeDualPotionRestore(input: {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sd: number;
  maxSd: number;
  ag: number;
  maxAg: number;
  tierId: PotionTierId;
}): {
  nextHp: number;
  nextMp: number;
  nextSd: number;
  nextAg: number;
  restoredHp: number;
  restoredMp: number;
  tier: PotionTierDef;
} {
  const tier = POTION_TIERS.find((t) => t.id === input.tierId) ?? POTION_TIERS[2];
  const hpGain = Math.max(tier.hpRestoreFlat, Math.round(input.maxHp * tier.pctRestore));
  const mpGain = Math.max(tier.mpRestoreFlat, Math.round(input.maxMp * tier.pctRestore));
  const sdGain = Math.round(input.maxSd * Math.min(1, tier.pctRestore * 0.8 + 0.2));
  const agGain = Math.round(input.maxAg * Math.min(1, tier.pctRestore * 0.8 + 0.2));

  const nextHp = Math.min(input.maxHp, Math.max(0, input.hp) + hpGain);
  const nextMp = Math.min(input.maxMp, Math.max(0, input.mp) + mpGain);
  const nextSd = Math.min(input.maxSd, Math.max(0, input.sd) + sdGain);
  const nextAg = Math.min(input.maxAg, Math.max(0, input.ag) + agGain);

  return {
    nextHp,
    nextMp,
    nextSd,
    nextAg,
    restoredHp: nextHp - Math.max(0, input.hp),
    restoredMp: nextMp - Math.max(0, input.mp),
    tier,
  };
}
