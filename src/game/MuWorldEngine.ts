import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  NullEngine,
  PointLight,
  PBRMaterial,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { getMapById } from '../data/muWorldData';
import type {
  EventType,
  FloatingDamageNumber,
  GroundTheme,
  HeroClass,
  MapId,
  MinimapEntitySnapshot,
  MonsterArchetype,
  MonsterPowerDef,
  MuCharacter,
  MuItem,
  MuMapConfig,
  NpcDef,
  RoomPeer,
  ScaledMonsterStats,
  SkillDef,
  WeatherKind,
} from '../types/game';
import {
  AUTO_AIM_PROBABILITY,
  findAutoAimTarget,
  getEffectiveSkillMultiplier,
  getSkillRank,
  getVariantKey,
  getVariantProfile,
  rollAutoAimHit,
  rollMonsterAttack,
  scaleMonsterForPlayerLevel,
} from './combatAndProgression';
import {
  DEFAULT_CAMERA_DISTANCE,
  MAX_CAMERA_DISTANCE,
  MIN_CAMERA_DISTANCE,
  clampCameraBeta,
  exponentialDamp,
  matchesLootFilter,
  solveCameraWithTerrain,
  type LootFilterSettings,
} from './worldPhysicsMath';
import { FlyffContent } from './FlyffContent';
import { getStarterItemsForMuClass } from '../data/muSkillsAndClasses';
import { MuAssetManager } from './MuAssetManager';
import { soundSynth } from './soundSynth';
import { createCreature } from './OriginalCreature';
import { creatureFx } from './CreatureEffects';
import { SPECIES_BY_ID, type MonsterElement } from '../data/bestiary';
import { artisanWeapon } from '../data/artisanEquipment';

export type EngineCameraMode = 'title' | 'character_select' | 'playing';

export interface TargetMonsterInfo {
  index: number;
  stats: ScaledMonsterStats;
  currentHp: number;
  dist: number;
  autoAimPct: number;
}

export interface LootDrop {
  id: string;
  kind: 'zen' | 'bless' | 'soul' | 'chaos' | 'life' | 'creation' | 'talisman';
  label: string;
  amount: number;
  x: number;
  z: number;
  node: TransformNode;
  spawnTime: number;
}

interface ActiveNpc {
  def: NpcDef;
  root: TransformNode;
}

interface FriendlyBot {
  root: TransformNode;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  targetX: number;
  targetZ: number;
  speed: number;
  phase: number;
  waitTimer: number;
}

interface ProjectileFx {
  mesh: TransformNode;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  isCritical: boolean;
  isExcellent: boolean;
  freezeMs?: number;
  colorHex?: number;
}

interface TransientFx {
  node: TransformNode;
  life: number;
  maxLife: number;
  expandRate: number;
  spinSpeed: number;
  riseSpeed: number;
}

interface ActiveMonsterSlot {
  poolIdx: number;
  root: TransformNode;
  hpBarBg: Mesh;
  hpBarFill: Mesh;
  hpFillMat: StandardMaterial;
  plate: Mesh;
  plateTex: DynamicTexture;
  lastLabel: string;
  hitFlash: number;
}

export interface EngineCallbacks {
  onEquipmentWear?: (slot: string, durability: number) => void;
  onKillMonster: (xp: number, zen: number, isBoss: boolean) => void;
  onPickupLoot: (drop: { kind: LootDrop['kind']; label: string; amount: number }) => void;
  onPlayerDamaged: (amount: number, isCrit?: boolean) => void;
  onMonsterPowerHit?: (power: MonsterPowerDef, damage: number) => void;
  onTargetMonsterChange?: (target: TargetMonsterInfo | null) => void;
  onHeroMoveSync: (x: number, z: number, rotY: number, action: 'idle' | 'move' | 'attack' | 'skill') => void;
  onBossHitInEvent: (damage: number) => void;
  onFloatingText: (text: string, color: string) => void;
  onDamageNumber?: (dmg: FloatingDamageNumber) => void;
  onNearbyNpcChange?: (npc: NpcDef | null) => void;
  onOpenNpc?: (npc: NpcDef) => void;
  onFpsUpdate?: (fps: number) => void;
  onMinimapUpdate?: (snapshot: MinimapEntitySnapshot) => void;
  onAutoHuntAttack?: () => void;
  onWorldTelemetry?: (info: {
    x: number;
    z: number;
    inSafeCity: boolean;
    totalMonsters: number;
    nearbyMonsters: number;
    mapName: string;
    areaKm2: number;
  }) => void;
}

const ARCHETYPE_TO_GLB: Record<MonsterArchetype, string> = {
  bull: 'mon_bull.glb',
  hound: 'mon_hound.glb',
  skeleton: 'mon_skeleton.glb',
  dragon: 'mon_dragon.glb',
  yeti: 'mon_yeti.glb',
  ice_queen: 'mon_yeti.glb',
  goblin: 'npc_goblin.glb',
  golem: 'mon_golem.glb',
  shadow: 'mon_skeleton.glb',
  gorgon: 'mon_hydra.glb',
  balrog: 'mon_balrog.glb',
  hydra: 'mon_hydra.glb',
  mutant: 'mon_bull.glb',
  phoenix: 'mon_dragon.glb',
  mech: 'mon_golem.glb',
  selupan: 'mon_hydra.glb',
  lava_giant: 'mon_balrog.glb',
  boss: 'mon_balrog.glb',
};

const CELL_SIZE = 40; // 40m spatial grid cell for O(1) lookup over 50,000 monsters

function createGroundCanvasTexture(
  scene: Scene,
  theme: GroundTheme,
  tintHex: number,
  repeatCount: number,
): DynamicTexture {
  const size = 512;
  const tex = new DynamicTexture(`groundTex_${theme}_${tintHex}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();

  const r = (tintHex >> 16) & 255;
  const g = (tintHex >> 8) & 255;
  const b = tintHex & 255;

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  if (theme === 'cobble' || theme === 'dungeon' || theme === 'arena' || theme === 'tower' || theme === 'kanturu') {
    const step = 64;
    ctx.fillStyle = `rgb(${Math.max(18, r - 24)}, ${Math.max(18, g - 24)}, ${Math.max(20, b - 22)})`;
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += step) {
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      for (let x = -step; x < size + step; x += step) {
        const hash = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const delta = Math.round((hash - 0.5) * 26);
        const sr = Math.max(24, Math.min(242, r + delta));
        const sg = Math.max(24, Math.min(242, g + delta));
        const sb = Math.max(26, Math.min(245, b + delta + 3));
        ctx.fillStyle = `rgb(${sr}, ${sg}, ${sb})`;
        ctx.fillRect(x + offset + 3, y + 3, step - 6, step - 6);
        // Soft weathered stone highlights & inner edge
        ctx.fillStyle = 'rgba(255, 240, 210, 0.08)';
        ctx.fillRect(x + offset + 5, y + 5, step - 10, 6);
        ctx.strokeStyle = 'rgba(215, 195, 155, 0.14)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + offset + 4, y + 4, step - 8, step - 8);
      }
    }
    for (let i = 0; i < 320; i++) {
      const sx = (i * 89) % size;
      const sy = (i * 137) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(20,16,12,0.09)';
      ctx.fillRect(sx, sy, 4, 3);
    }
  } else if (theme === 'vulcanus') {
    for (let i = 0; i < 240; i++) {
      const x = (i * 97) % size;
      const y = (i * 53) % size;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(249, 115, 22, 0.42)' : 'rgba(18, 7, 7, 0.48)';
      ctx.fillRect(x, y, 28, 8);
    }
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.moveTo((i * 73) % size, 0);
      ctx.lineTo(((i * 73 + 95) % size), size);
      ctx.stroke();
    }
  } else if (theme === 'snow' || theme === 'raklion') {
    for (let i = 0; i < 380; i++) {
      const x = (i * 71) % size;
      const y = (i * 113) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.25)' : 'rgba(147, 197, 253, 0.18)';
      ctx.fillRect(x, y, 18, 10);
    }
  } else if (theme === 'underwater') {
    for (let i = 0; i < 260; i++) {
      const x = (i * 83) % size;
      const y = (i * 47) % size;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(94, 234, 212, 0.18)' : 'rgba(8, 51, 68, 0.26)';
      ctx.beginPath();
      ctx.arc(x, y, 14 + (i % 10), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 640; i++) {
      const x = (i * 67) % size;
      const y = (i * 127) % size;
      ctx.fillStyle = theme === 'sand'
        ? (i % 3 === 0 ? 'rgba(253, 224, 71, 0.20)' : 'rgba(180, 120, 40, 0.14)')
        : (i % 5 === 0 ? 'rgba(163, 230, 53, 0.16)' : i % 2 === 0 ? 'rgba(74, 222, 128, 0.12)' : 'rgba(20, 62, 32, 0.22)');
      ctx.fillRect(x, y, 12, 5);
    }
    if (theme === 'grass') {
      for (let i = 0; i < 90; i++) {
        const px = (i * 109) % size;
        const py = (i * 163) % size;
        ctx.fillStyle = 'rgba(101, 163, 13, 0.14)';
        ctx.beginPath();
        ctx.arc(px, py, 8 + (i % 6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  tex.uScale = repeatCount;
  tex.vScale = repeatCount;
  return tex;
}

function createGroundBumpTexture(scene: Scene, theme: GroundTheme, repeatCount: number): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(`groundBump_${theme}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);

  if (theme === 'cobble' || theme === 'dungeon' || theme === 'arena' || theme === 'tower' || theme === 'kanturu') {
    const step = 32;
    ctx.strokeStyle = 'rgb(75,75,75)';
    ctx.lineWidth = 3;
    for (let y = 0; y < size; y += step) {
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      for (let x = -step; x < size + step; x += step) {
        ctx.fillStyle = ((x + y) % 64 === 0) ? 'rgb(156,156,156)' : 'rgb(140,140,140)';
        ctx.fillRect(x + offset + 2, y + 2, step - 4, step - 4);
        ctx.strokeRect(x + offset + 2, y + 2, step - 4, step - 4);
      }
    }
  } else {
    for (let i = 0; i < 400; i++) {
      const x = (i * 53) % size;
      const y = (i * 89) % size;
      const v = i % 2 === 0 ? 158 : 102;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 6, 4);
    }
  }
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  tex.uScale = repeatCount;
  tex.vScale = repeatCount;
  return tex;
}

function createNameplatePlane(scene: Scene, text: string, colorHex: string, width = 3.2): Mesh {
  const tex = new DynamicTexture(`np_${text}`, { width: 512, height: 96 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 96);
  ctx.fillStyle = 'rgba(10, 14, 24, 0.78)';
  ctx.fillRect(16, 14, 480, 68);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 14, 480, 68);
  ctx.font = 'bold 34px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colorHex;
  ctx.fillText(text.slice(0, 26), 256, 48);
  tex.hasAlpha = true;
  tex.update();

  const plane = MeshBuilder.CreatePlane(`plate_${text}`, { width, height: width * 0.19 }, scene);
  const mat = new StandardMaterial(`plateMat_${text}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}

export class MuWorldEngine {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private bestiaryMaterial: StandardMaterial | null = null;
  private assetManager: MuAssetManager;

  private flyff: FlyffContent;
  private currentEquippedWeapon: string | undefined;
  private heroSex: 'male' | 'female' = 'male';
  private callbacks: EngineCallbacks;
  private mode: EngineCameraMode = 'title';
  private currentMap: MuMapConfig = getMapById('flaris');
  private disposed = false;

  private hemiLight!: HemisphericLight;
  private sunLight!: DirectionalLight;
  private heroLight!: PointLight;

  private worldRoot: TransformNode;
  private cityRoot: TransformNode;
  private floraRoot: TransformNode;
  private monsterRoot: TransformNode;
  private fxRoot: TransformNode;

  private heroClass: HeroClass = 'DK';
  private heroStatsSnapshot: MuCharacter | null = null;
  private heroEquippedItems: MuItem[] = [];
  private heroRoot: TransformNode;
  private heroModelRoot: TransformNode | null = null;
  private heroWeaponNode: TransformNode | null = null;
  private heroX = -200;
  private heroZ = -255;
  private heroRotY = 0;
  private heroAction: 'idle' | 'move' | 'attack' | 'skill' = 'idle';
  private attackSwingTimer = 0;

  private activeNpcs: ActiveNpc[] = [];
  private friendlyBots: FriendlyBot[] = [];
  private lootDrops: LootDrop[] = [];
  private projectiles: ProjectileFx[] = [];
  private transientFx: TransientFx[] = [];
  private remotePeers = new Map<string, { name: string; root: TransformNode; content: FlyffContent; targetX: number; targetZ: number; rotY: number; action: RoomPeer['action'] }>();
  private loadingMap = false;

  // --- Spatial Simulation with 18x15 3m Camps + Dispersed Monsters ---
  private totalMonsters = 0;
  private monX = new Float32Array(0);
  private monZ = new Float32Array(0);
  private monHomeX = new Float32Array(0);
  private monHomeZ = new Float32Array(0);
  private monCampX = new Float32Array(0);
  private monCampZ = new Float32Array(0);
  private monLeash = new Float32Array(0);
  private monHp = new Float32Array(0);
  private monMaxHp = new Float32Array(0);
  private monDmg = new Float32Array(0);
  private monXp = new Float32Array(0);
  private monZen = new Float32Array(0);
  private monRespawn = new Float32Array(0);
  private monAlive = new Uint8Array(0);
  private monLevel = new Uint16Array(0);
  private monDefIdx = new Uint8Array(0);
  private monAttackCd = new Float32Array(0);
  private monPowerCd = new Float32Array(0);
  private monFrozenUntil = new Float64Array(0);
  private monStrikeAnim = new Float32Array(0);
  private spatialGrid = new Map<number, number[]>();
  private thinMasterMeshes = new Map<string, { mesh: Mesh; matrices: number[] }>();
  private monShadowMesh: Mesh | null = null;
  private monShadowMatrices: number[] = [];
  private activeMonsterSlots: ActiveMonsterSlot[] = [];
  private autoAimRing: TransformNode | null = null;
  private skyDome: Mesh | null = null;
  private lockedTargetIdx = -1;
  private lastScaledHeroLevel = 1;
  private enemyProjectiles: Array<{ mesh: TransformNode; x: number; y: number; z: number; vx: number; vz: number; life: number }> = [];

  // Weather
  private weatherMesh: Mesh | null = null;
  private weatherPositions: Float32Array | null = null;
  private weatherMatrices: Float32Array | null = null;
  private weatherKind: WeatherKind = 'leaves';

  // Controls & Free 360° Camera Look
  private keys = new Set<string>();
  private joystickVec = { x: 0, y: 0 };
  private free3dMode = true;
  private cameraDistance = DEFAULT_CAMERA_DISTANCE;
  private camPrevEye: { x: number; y: number; z: number } | null = null;
  private camDragPointerId: number | null = null;
  private camDragLastX = 0;
  private camDragLastY = 0;
  private camAutoTurnCooldown = 0;
  private autoAimAssist = true;
  private autoHuntEnabled = false;
  private autoHuntAttackTimer = 0;
  private activeEffectBonuses = { atkBonusPct: 0, speedBonusPct: 0, critBonusPct: 0, reflectBonusPct: 0 };
  private userBrightness = 1.08;
  private targetFps: 30 | 45 | 60 = 60;
  private isSoftwareGl = false;
  private lastRenderTime = 0;
  private lastRenderEndTime = 0;
  private lastTime = performance.now();
  private lastTelemetryTime = 0;
  private lastMoveSyncTime = 0;
  private lastSafeZoneNoticeTime = 0;
  private lastNearbyNpcId: string | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsLastReport = performance.now();
  private dmgSeq = 1;
  private loadSeq = 0;

  private comboState: {
    steps: SkillDef[] | null;
    nextIndex: number;
    timer: number;
    bonusStatPower: number;
  } = { steps: null, nextIndex: 0, timer: 0, bonusStatPower: 0 };

  constructor(container: HTMLElement, callbacks: EngineCallbacks, options: { headless?: boolean } = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.outline = 'none';
    this.container.appendChild(this.canvas);

    this.engine = import.meta.env.DEV && options.headless ? new NullEngine() : new Engine(this.canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
    });

    try {
      const gl = (this.engine as unknown as { _gl?: WebGLRenderingContext })._gl;
      let rendererStr = '';
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        rendererStr = String(
          (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '',
        );
      }
      if (!rendererStr && typeof this.engine.getGlInfo === 'function') {
        rendererStr = String(this.engine.getGlInfo()?.renderer ?? '');
      }
      if (/swiftshader|llvmpipe|software|angle.*swiftshader/i.test(rendererStr)) {
        this.isSoftwareGl = true;
        this.engine.setHardwareScalingLevel(1.8);
      }
    } catch {
      // Ignore WebGL probe failures
    }

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.07, 0.12, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;

    this.assetManager = new MuAssetManager(this.scene);
    this.flyff = new FlyffContent(this.scene);
    this.flyff.onError = error => { console.error(error); this.callbacks.onFloatingText('No se pudo cargar un recurso del juego. Reintenta la conexión.', '#f87171'); };
    this.flyff.onWear = (slot, durability) => {
      this.heroEquippedItems = this.heroEquippedItems.map(i => i.slot === slot && i.isEquipped ? {...i,durability} : i);
      this.callbacks.onEquipmentWear?.(slot, durability);
    };

    this.camera = new ArcRotateCamera(
      'muCamera',
      -Math.PI / 2,
      1.16,
      this.cameraDistance,
      new Vector3(this.heroX, 1.38, this.heroZ),
      this.scene,
    );
    this.camera.lowerBetaLimit = 0.18;
    this.camera.upperBetaLimit = 1.46;
    this.camera.lowerRadiusLimit = MIN_CAMERA_DISTANCE;
    this.camera.upperRadiusLimit = MAX_CAMERA_DISTANCE;
    this.camera.minZ = 0.25;
    this.camera.wheelPrecision = 24;
    this.canvas.style.touchAction = 'none';

    this.hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    this.sunLight = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.35), this.scene);
    this.sunLight.position = new Vector3(60, 120, 60);

    this.worldRoot = new TransformNode('worldRoot', this.scene);
    this.cityRoot = new TransformNode('cityRoot', this.scene);
    this.floraRoot = new TransformNode('floraRoot', this.scene);
    this.monsterRoot = new TransformNode('monsterRoot', this.scene);
    this.fxRoot = new TransformNode('fxRoot', this.scene);

    this.heroRoot = new TransformNode('heroRoot', this.scene);
    this.heroRoot.position = new Vector3(this.heroX, 0, this.heroZ);
    this.heroLight = new PointLight('heroLight', new Vector3(0, 3.5, 0), this.scene);
    this.heroLight.parent = this.heroRoot;
    this.heroLight.intensity = 0.7;
    this.heroLight.range = 16;

    this.bindInputListeners();
    this.startRenderLoop();
    this.preloadAssetsAndStart().catch((err) => {
      if (!this.disposed) this.flyff.onError(err);
    });
  }

  private startRenderLoop() {
    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      const now = performance.now();
      if (this.isSoftwareGl) {
        if (now - this.lastRenderEndTime < 180) return;
      } else {
        const minIntervalMs = this.targetFps < 60 ? 1000 / this.targetFps : 0;
        if (minIntervalMs > 0 && now - this.lastRenderTime < minIntervalMs) {
          return;
        }
      }
      this.lastRenderTime = now;
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt, now);
      this.scene.render();
      this.lastRenderEndTime = performance.now();
    });
  }

  private async preloadAssetsAndStart() {
    // Rebuild hero and equipment immediately without blocking on unused legacy meshes
    await this.rebuildHeroModel();
    if (this.disposed) return;
    // Warm up lightweight NPC models in background while loading map
    void this.assetManager.preloadCoreModels(['npc_merchant.glb', 'npc_goblin.glb']).catch(() => {});
    if (this.loadSeq === 0) {
      await this.loadMap('flaris', true);
    }
  }

  private bindInputListeners() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerUp);
    this.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: true });
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private handleResize = () => {
    this.engine.resize();
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  private handleCanvasPointerDown = (e: PointerEvent) => {
    if (this.mode !== 'playing') return;
    if (this.camDragPointerId === null) {
      this.camDragPointerId = e.pointerId;
      this.camDragLastX = e.clientX;
      this.camDragLastY = e.clientY;
    }
  };

  private handleWindowPointerMove = (e: PointerEvent) => {
    if (this.mode !== 'playing' || e.pointerId !== this.camDragPointerId) return;
    const dx = e.clientX - this.camDragLastX;
    const dy = e.clientY - this.camDragLastY;
    this.camDragLastX = e.clientX;
    this.camDragLastY = e.clientY;
    this.camera.alpha -= dx * 0.0085;
    this.camera.beta = clampCameraBeta(this.camera.beta - dy * 0.0065);
    this.camAutoTurnCooldown = 2.8;
  };

  private handleWindowPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.camDragPointerId) {
      this.camDragPointerId = null;
      this.camAutoTurnCooldown = 2.8;
    }
  };

  private handleCanvasWheel = (e: WheelEvent) => {
    if (this.mode !== 'playing') return;
    this.cameraDistance = Math.max(
      MIN_CAMERA_DISTANCE,
      Math.min(MAX_CAMERA_DISTANCE, this.cameraDistance + Math.sign(e.deltaY) * 0.6),
    );
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName ?? '')) return;
    this.keys.add(e.code);
    if (e.code === 'KeyJ' && this.mode === 'playing') { e.preventDefault(); this.jump(); }
    if (e.code === 'KeyE' && this.mode === 'playing') {
      this.pickupNearestLoot(true);
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  jump() { if (this.mode === 'playing') this.flyff.jump(); }
  unlockAudio() { return this.flyff.unlockAudio(); }
  setAudio(volume: number, muted: boolean) { this.flyff.setAudio(volume, muted); }

  setMode(mode: EngineCameraMode) {
    this.mode = mode;
    if (mode !== 'playing') {
      this.camDragPointerId = null;
      this.camPrevEye = null;
    } else {
      this.camera.radius = this.cameraDistance;
      this.camPrevEye = null;
      const hy = this.getTerrainHeight(this.heroX, this.heroZ);
      this.flyff.resetVerticalPosition(hy);
      this.camera.target.set(this.heroX, hy + 1.38, this.heroZ);
    }
  }

  setFree3dMode(enabled: boolean) {
    this.free3dMode = enabled;
  }

  setCameraDistance(dist: number) {
    this.cameraDistance = Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, dist));
  }

  setAutoAimAssist(enabled: boolean) {
    this.autoAimAssist = enabled;
  }

  setAutoHuntEnabled(enabled: boolean) {
    this.autoHuntEnabled = enabled;
    if (!enabled) this.autoHuntAttackTimer = 0;
  }

  setActiveEffectBonuses(bonuses: { atkBonusPct: number; speedBonusPct: number; critBonusPct: number; reflectBonusPct?: number }) {
    this.activeEffectBonuses = {
      atkBonusPct: bonuses.atkBonusPct,
      speedBonusPct: bonuses.speedBonusPct,
      critBonusPct: bonuses.critBonusPct,
      reflectBonusPct: bonuses.reflectBonusPct ?? 0,
    };
  }

  setBrightness(val: number) {
    this.userBrightness = val;
    this.hemiLight.intensity = 0.85 * val;
    this.sunLight.intensity = 1.25 * val;
  }

  setTargetFps(fps: 30 | 45 | 60) {
    this.targetFps = fps;
    this.engine.setHardwareScalingLevel(this.isSoftwareGl ? 1.8 : fps === 30 ? 1.35 : fps === 45 ? 1.15 : 1.0);
  }

  setJoystickVector(x: number, y: number) {
    this.joystickVec = { x, y };
  }

  setEventActive(_active: boolean, _eventType?: EventType) {
    // Event boss / wave indicator handled cleanly in HUD + combat
  }

  updateHeroStats(char: MuCharacter | null) {
    const prevLevel = this.heroStatsSnapshot?.level ?? 1;
    this.heroStatsSnapshot = char;
    const nextLevel = char?.level ?? 1;
    if (nextLevel !== prevLevel && nextLevel !== this.lastScaledHeroLevel && this.totalMonsters > 0) {
      this.rescaleMonstersForHero(nextLevel);
    }
  }

  private getPlayerAvgAttackEstimate(): number {
    const c = this.heroStatsSnapshot;
    const eqDmg = this.heroEquippedItems
      .filter((i) => i.isEquipped && (i.durability ?? 100) > 0)
      .reduce((acc, i) => acc + i.minDmg + i.maxDmg + i.magicPower, 0);
    return Math.round(30 + ((c?.str ?? 30) + (c?.ene ?? 22)) * 0.65 + eqDmg * 0.5);
  }

  private rescaleMonstersForHero(heroLevel: number) {
    this.lastScaledHeroLevel = heroLevel;
    const avgAtk = this.getPlayerAvgAttackEstimate();
    const defs = this.currentMap.monsters;
    const mapRange = { minLevel: this.currentMap.minLevel, maxLevel: this.currentMap.maxLevel };
    for (let i = 0; i < this.totalMonsters; i++) {
      const def = defs[this.monDefIdx[i]];
      if (!def) continue;
      const scaled = scaleMonsterForPlayerLevel(def, heroLevel, avgAtk, mapRange, this.currentMap.id);
      const hpRatio = this.monMaxHp[i] > 0 ? this.monHp[i] / this.monMaxHp[i] : 1;
      this.monMaxHp[i] = scaled.maxHp;
      this.monHp[i] = Math.max(1, Math.round(scaled.maxHp * hpRatio));
      this.monDmg[i] = scaled.damage;
      this.monXp[i] = scaled.xp;
      this.monZen[i] = scaled.zen;
      this.monLevel[i] = scaled.scaledLevel;
    }
  }

  isInSafeCity(x = this.heroX, z = this.heroZ): boolean {
    const sx = this.currentMap.spawn?.x ?? 0;
    const sz = this.currentMap.spawn?.z ?? 0;
    const inMapCity = Math.hypot(x - sx, z - sz) < this.currentMap.cityRadius;
    return this.currentMap.assetWorld ? (inMapCity || this.flyff.safe(x, z)) : inMapCity;
  }

  getHeroPose(): { x: number; z: number; rotY: number } {
    return {
      x: Number(this.heroX.toFixed(2)),
      z: Number(this.heroZ.toFixed(2)),
      rotY: Number(this.heroRotY.toFixed(3)),
    };
  }

  respawnInCurrentCity(): { x: number; z: number; rotY: number } {
    const spawn = this.currentMap.spawn ?? { x: 0, z: 0 };
    const maxR = Math.max(18, Math.min(72, this.currentMap.cityRadius * 0.42));
    let rx = spawn.x;
    let rz = spawn.z;
    for (let attempt = 0; attempt < 28; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * maxR;
      const cx = spawn.x + Math.cos(ang) * dist;
      const cz = spawn.z + Math.sin(ang) * dist;
      const surface = this.flyff.world?.surfaceAt(cx + 1536, cz + 1536) ?? 'land';
      if (surface !== 'water' && (!this.currentMap.assetWorld || this.flyff.safe(cx, cz))) {
        rx = cx;
        rz = cz;
        break;
      }
    }
    this.heroX = rx;
    this.heroZ = rz;
    this.heroRotY = Math.random() * Math.PI * 2;
    this.lockedTargetIdx = -1;
    const hy = this.getTerrainHeight(rx, rz);
    this.flyff.resetVerticalPosition(hy);
    this.camPrevEye = null;
    this.heroRoot.position.set(rx, hy, rz);
    this.camera.target.set(rx, hy + 1.38, rz);
    this.callbacks.onTargetMonsterChange?.(null);
    return this.getHeroPose();
  }

  private getTerrainHeight(x: number, z: number): number {
    if (this.currentMap.assetWorld) return this.flyff.height(x, z);
    const dist = Math.hypot(x, z);
    if (dist <= this.currentMap.cityRadius + 10) return 0;
    const blend = Math.min(1, (dist - (this.currentMap.cityRadius + 10)) / 35);
    const wave =
      Math.sin(x * 0.025) * Math.cos(z * 0.025) * 1.4 +
      Math.sin((x + z) * 0.011) * 0.9;
    return wave * blend;
  }

  async syncHeroAppearance(classType: HeroClass, equippedItems: MuItem[], sex?: 'male' | 'female') {
    this.currentEquippedWeapon = equippedItems.find(item => item.slot === 'weapon' && item.isEquipped)?.name;
    this.heroClass = classType; this.heroSex = sex ?? this.heroStatsSnapshot?.sex ?? 'male';
    this.heroEquippedItems = equippedItems;
    try { await this.rebuildHeroModel(); } catch (error) { this.flyff.onError(error); throw error; }
  }

  private async rebuildHeroModel() {
    await this.flyff.character(this.heroClass, this.heroSex, this.heroEquippedItems, this.heroRoot);
    if (this.disposed) return;
    this.heroModelRoot = this.flyff.actor?.root ?? null;
  }

  async loadMap(mapId: MapId, resetHeroPosition = true, initialPose?: { x: number; z: number; rotY?: number }) {
    if (this.disposed) return;
    const mySeq = ++this.loadSeq;
    this.loadingMap = true;
    this.keys.clear(); this.joystickVec = { x: 0, y: 0 };
    try {
    const mapCfg = getMapById(mapId);
    this.currentMap = mapCfg;
    if (!mapCfg.assetWorld) {
      this.flyff.clearWorld();
    }
    this.totalMonsters = 0;

    soundSynth.playMapMusic(mapCfg.musicTheme, mapCfg.ambientBed);

    for (const peer of this.remotePeers.values()) { peer.content.dispose(); peer.root.dispose(); }
    this.remotePeers.clear();
    // Clear previous map nodes
    this.disposeChildren(this.worldRoot);
    this.disposeChildren(this.cityRoot);
    this.disposeChildren(this.floraRoot);
    this.disposeChildren(this.monsterRoot);
    this.bestiaryMaterial?.dispose();
    this.bestiaryMaterial = null;
    this.disposeChildren(this.fxRoot);
    this.activeNpcs = [];
    this.friendlyBots = [];
    this.lootDrops = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.transientFx = [];
    for (const slot of this.activeMonsterSlots) {
      slot.root.dispose();
    }
    this.activeMonsterSlots = [];
    if (this.autoAimRing) {
      this.autoAimRing.dispose();
      this.autoAimRing = null;
    }
    if (this.skyDome) {
      this.skyDome.dispose();
      this.skyDome = null;
    }
    this.lockedTargetIdx = -1;
    this.callbacks.onTargetMonsterChange?.(null);
    this.thinMasterMeshes.clear();
    this.spatialGrid.clear();

    if (this.weatherMesh) {
      this.weatherMesh.dispose();
      this.weatherMesh = null;
    }

    // Atmosphere, SkyDome & Lighting
    const skyTop = Color3.FromHexString(`#${mapCfg.skyTopHex.toString(16).padStart(6, '0')}`);
    const horizon = Color3.FromHexString(`#${mapCfg.skyHorizonHex.toString(16).padStart(6, '0')}`);
    const fogColor = Color3.FromHexString(`#${mapCfg.fogHex.toString(16).padStart(6, '0')}`);
    this.scene.clearColor = new Color4(horizon.r * 0.45, horizon.g * 0.45, horizon.b * 0.45, 1);
    this.scene.fogColor = fogColor;
    this.scene.fogDensity = mapCfg.fogDensity;

    const skyTex = new DynamicTexture(`skyTex_${mapCfg.id}`, { width: 64, height: 256 }, this.scene, false);
    const skyCtx = skyTex.getContext();
    const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgb(${Math.round(skyTop.r * 255)}, ${Math.round(skyTop.g * 255)}, ${Math.round(skyTop.b * 255)})`);
    grad.addColorStop(0.58, `rgb(${Math.round(horizon.r * 255)}, ${Math.round(horizon.g * 255)}, ${Math.round(horizon.b * 255)})`);
    grad.addColorStop(1, `rgb(${Math.round(fogColor.r * 255)}, ${Math.round(fogColor.g * 255)}, ${Math.round(fogColor.b * 255)})`);
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 64, 256);
    skyTex.update();
    const skyDome = MeshBuilder.CreateSphere(`skyDome_${mapCfg.id}`, { diameter: 2200, segments: 12 }, this.scene);
    const skyMat = new StandardMaterial(`skyMat_${mapCfg.id}`, this.scene);
    skyMat.emissiveTexture = skyTex;
    skyMat.diffuseColor = Color3.Black();
    skyMat.disableLighting = true;
    skyMat.backFaceCulling = false;
    skyDome.material = skyMat;
    skyDome.isPickable = false;
    skyDome.infiniteDistance = true;
    skyDome.parent = this.worldRoot;
    this.skyDome = skyDome;

    const ambColor = Color3.FromHexString(`#${mapCfg.ambientLightHex.toString(16).padStart(6, '0')}`);
    const sunColor = Color3.FromHexString(`#${mapCfg.sunLightHex.toString(16).padStart(6, '0')}`);
    this.hemiLight.diffuse = ambColor;
    this.hemiLight.groundColor = fogColor.scale(0.6);
    this.sunLight.diffuse = sunColor;
    this.setBrightness(this.userBrightness);

    if (mapCfg.assetWorld && mapCfg.spawn) {
      // Deep solid fog-toned abyss disc well below terrain so looking down or near hills NEVER exposes grid bleed-through
      const baseDisc = MeshBuilder.CreateDisc(
        `assetFallbackGround_${mapCfg.id}`,
        { radius: mapCfg.sizeMeters * 0.85, tessellation: 48 },
        this.scene,
      );
      baseDisc.rotation.x = Math.PI / 2;
      baseDisc.position.y = -95;
      const baseMat = new StandardMaterial(`assetFallbackMat_${mapCfg.id}`, this.scene);
      baseMat.diffuseColor = fogColor.scale(0.18);
      baseMat.emissiveColor = fogColor.scale(0.12);
      baseMat.specularColor = Color3.Black();
      baseMat.disableLighting = true;
      baseMat.backFaceCulling = false;
      baseDisc.material = baseMat;
      baseDisc.isPickable = false;
      baseDisc.parent = this.worldRoot;

      const targetX = initialPose && Number.isFinite(initialPose.x) ? initialPose.x : mapCfg.spawn.x;
      const targetZ = initialPose && Number.isFinite(initialPose.z) ? initialPose.z : mapCfg.spawn.z;
      await this.flyff.loadWorld(targetX, targetZ);
      if (mySeq !== this.loadSeq || this.disposed) return;
      if (resetHeroPosition || initialPose) {
        this.heroX = targetX;
        this.heroZ = targetZ;
        this.heroRotY = initialPose && typeof initialPose.rotY === 'number' ? initialPose.rotY : 0;
        const spawnY = this.getTerrainHeight(this.heroX, this.heroZ);
        this.flyff.resetVerticalPosition(spawnY);
        this.camPrevEye = null;
        this.heroRoot.position.set(this.heroX, spawnY, this.heroZ);
        this.camera.alpha = -Math.PI / 2;
        this.camera.beta = 1.16;
        this.camera.target.set(this.heroX, spawnY + 1.38, this.heroZ);
      }
      for (const npcDef of mapCfg.npcs) {
        const inst = await this.assetManager.instantiateModel(npcDef.role === 'chaos_goblin' ? 'npc_goblin.glb' : 'npc_merchant.glb', `npc_${npcDef.id}`, this.cityRoot);
        if (mySeq !== this.loadSeq) { inst.root.dispose(); return; }
        inst.root.position.set(npcDef.x, this.getTerrainHeight(npcDef.x, npcDef.z), npcDef.z);
        inst.root.rotation.y = Math.atan2(targetX - npcDef.x, targetZ - npcDef.z);
        for (const mesh of inst.meshes) {
          if (!(mesh.material instanceof PBRMaterial) || /head_mat|arms_mat/.test(mesh.material.name)) continue;
          const material = mesh.material.clone(`npcFabric_${mesh.name}`);
          const trim = /pauldrons_mat|greaves_mat/.test(mesh.material.name);
          material.albedoColor = Color3.FromHexString('#' + (trim ? npcDef.accentColor : npcDef.robeColor).toString(16).padStart(6,'0'));
          mesh.material = material;
          inst.root.onDisposeObservable.addOnce(() => material.dispose());
        }
        const plate = createNameplatePlane(this.scene, npcDef.name, '#fde68a', 3.4);
        plate.parent = inst.root; plate.position.y = 2.75;
        plate.onDisposeObservable.addOnce(() => plate.material?.dispose(false, true));
        this.activeNpcs.push({ def: npcDef, root: inst.root });
      }
      await this.populateMonsters(mapCfg, mySeq);
      this.initMonsterHudSlots();
      if (mySeq === this.loadSeq) this.initWeatherParticles(mapCfg.weather);
      return;
    }

    // 1. Huge 1.00 - 1.60 km² Terrain Ground with Diffuse + Bump Textures
    const groundSize = mapCfg.sizeMeters;
    const ground = MeshBuilder.CreateGround(
      `terrain_${mapCfg.id}`,
      { width: groundSize, height: groundSize, subdivisions: 64, updatable: true },
      this.scene,
    );
    const positions = ground.getVerticesData('position');
    if (positions) {
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] = this.getTerrainHeight(positions[i], positions[i + 2]);
      }
      ground.updateVerticesData('position', positions);
      ground.createNormals(false);
    }
    const gMat = new StandardMaterial(`groundMat_${mapCfg.id}`, this.scene);
    gMat.diffuseTexture = createGroundCanvasTexture(this.scene, mapCfg.groundTheme, mapCfg.groundTintHex, 48);
    gMat.bumpTexture = createGroundBumpTexture(this.scene, mapCfg.groundTheme, 48);
    gMat.bumpTexture.level = 0.45;
    gMat.specularColor = new Color3(0.08, 0.08, 0.08);
    ground.material = gMat;
    ground.parent = this.worldRoot;

    // 2. Central Capital City Plaza Floor (Cobblestone / Marble with Bump)
    const cityDisc = MeshBuilder.CreateDisc(
      `cityPlaza_${mapCfg.id}`,
      { radius: mapCfg.cityRadius, tessellation: 48 },
      this.scene,
    );
    cityDisc.rotation.x = Math.PI / 2;
    cityDisc.position.y = 0.04;
    const cMat = new StandardMaterial(`cityMat_${mapCfg.id}`, this.scene);
    cMat.diffuseTexture = createGroundCanvasTexture(this.scene, 'cobble', mapCfg.cityGroundTintHex, 16);
    cMat.bumpTexture = createGroundBumpTexture(this.scene, 'cobble', 16);
    cMat.bumpTexture.level = 0.55;
    cMat.specularColor = new Color3(0.12, 0.12, 0.12);
    cityDisc.material = cMat;
    cityDisc.parent = this.cityRoot;

    if (resetHeroPosition) {
      this.heroX = 0;
      this.heroZ = 14;
      this.heroRotY = 0;
      this.heroRoot.position = new Vector3(0, 0, 14);
      this.camera.alpha = -Math.PI / 2;
      this.camera.target.set(0, 1.32, 14);
    }

    // Build Capital City Medieval Architecture, NPCs, Bots, Outskirts Flora, and <= 50,000 Monsters
    await Promise.all([
      this.buildCapitalCity(mapCfg, mySeq),
      this.buildOutskirtsAndFlora(mapCfg, mySeq),
      this.populateMonsters(mapCfg, mySeq),
    ]);

    if (mySeq !== this.loadSeq) return;
    this.initMonsterHudSlots();
    this.initWeatherParticles(mapCfg.weather);
    } finally { if (mySeq === this.loadSeq) this.loadingMap = false; }
  }

  private async buildCapitalCity(mapCfg: MuMapConfig, seq: number) {
    // Central Fountain / Obelisk
    const fountain = await this.assetManager.instantiateModel('fountain_plaza.glb', `fountain_${mapCfg.id}`, this.cityRoot, {
      scale: 1.4,
    });
    if (seq !== this.loadSeq) return;
    fountain.root.position = new Vector3(0, 0, 0);

    // 4 Cardinal City Gates (N, S, E, W) at r = cityRadius
    const rWall = mapCfg.cityRadius;
    const gatePositions = [
      { x: 0, z: rWall, ry: 0 },
      { x: 0, z: -rWall, ry: Math.PI },
      { x: rWall, z: 0, ry: Math.PI / 2 },
      { x: -rWall, z: 0, ry: -Math.PI / 2 },
    ];
    for (let i = 0; i < gatePositions.length; i++) {
      const gp = gatePositions[i];
      const gate = await this.assetManager.instantiateModel('city_gate.glb', `gate_${mapCfg.id}_${i}`, this.cityRoot, {
        scale: 1.35,
      });
      if (seq !== this.loadSeq) return;
      gate.root.position = new Vector3(gp.x, 0, gp.z);
      gate.root.rotation.y = gp.ry;
    }

    // Perimeter City Walls using ThinInstances
    const wallMaster = await this.assetManager.getThinInstanceMaster('city_wall.glb', mapCfg.id);
    if (wallMaster && seq === this.loadSeq) {
      wallMaster.parent = this.cityRoot;
      const wallMats: number[] = [];
      const segments = 36;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const wx = Math.sin(angle) * rWall;
        const wz = Math.cos(angle) * rWall;
        // Leave openings for the 4 cardinal gates
        if (Math.abs(wx) < 12 || Math.abs(wz) < 12) continue;
        const mat = Matrix.Compose(
          new Vector3(1.15, 1.15, 1.15),
          Quaternion.RotationYawPitchRoll(angle, 0, 0),
          new Vector3(wx, 0, wz),
        );
        wallMats.push(...mat.m);
      }
      if (wallMats.length > 0) {
        wallMaster.thinInstanceSetBuffer('matrix', new Float32Array(wallMats), 16);
      }
    }

    // Medieval Houses, Taverns/Barets, and Smithy Shops inside the Capital City
    const buildingPlacements: Array<{ file: string; x: number; z: number; ry: number; scale: number }> = [
      { file: 'shop_smithy.glb', x: -30, z: 22, ry: 0.5, scale: 1.35 },
      { file: 'tavern_baret.glb', x: 30, z: 22, ry: -0.5, scale: 1.3 },
      { file: 'house_medieval.glb', x: -24, z: 48, ry: 0.2, scale: 1.4 },
      { file: 'house_medieval.glb', x: 24, z: 48, ry: -0.2, scale: 1.4 },
      { file: 'house_medieval.glb', x: -54, z: -24, ry: 1.3, scale: 1.35 },
      { file: 'tavern_baret.glb', x: 54, z: -26, ry: -1.4, scale: 1.25 },
      { file: 'house_medieval.glb', x: -52, z: 36, ry: 1.1, scale: 1.3 },
      { file: 'shop_smithy.glb', x: 52, z: 36, ry: -1.1, scale: 1.25 },
      { file: 'house_medieval.glb', x: -30, z: -56, ry: 2.8, scale: 1.4 },
      { file: 'house_medieval.glb', x: 30, z: -56, ry: -2.8, scale: 1.4 },
      { file: 'house_medieval.glb', x: -66, z: 8, ry: 1.57, scale: 1.35 },
      { file: 'house_medieval.glb', x: 66, z: -8, ry: -1.57, scale: 1.35 },
    ];

    const byFile = new Map<string, Array<{ x: number; z: number; ry: number; scale: number }>>();
    for (const bp of buildingPlacements) {
      const list = byFile.get(bp.file) || [];
      list.push(bp);
      byFile.set(bp.file, list);
    }
    for (const [file, list] of byFile.entries()) {
      const master = await this.assetManager.getThinInstanceMaster(file, `city_${mapCfg.id}`);
      if (!master || seq !== this.loadSeq) continue;
      master.parent = this.cityRoot;
      const mats: number[] = [];
      for (const b of list) {
        const m = Matrix.Compose(
          new Vector3(b.scale, b.scale, b.scale),
          Quaternion.RotationYawPitchRoll(b.ry, 0, 0),
          new Vector3(b.x, 0, b.z),
        );
        mats.push(...m.m);
      }
      master.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16);
    }

    // Capital NPCs (Sellers of Weapons, Sets, Robes, Wings, Jewelry, Pets)
    for (const npcDef of mapCfg.npcs) {
      const npcFile = npcDef.role === 'chaos_goblin' ? 'npc_goblin.glb' : 'npc_merchant.glb';
      const inst = await this.assetManager.instantiateModel(npcFile, `npc_${npcDef.id}`, this.cityRoot, {
        scale: 1.15,
        tintHex: npcDef.robeColor,
      });
      if (seq !== this.loadSeq) return;
      inst.root.position = new Vector3(npcDef.x, 0, npcDef.z);
      inst.root.rotation.y = Math.atan2(-npcDef.x, -npcDef.z);

      const plate = createNameplatePlane(this.scene, npcDef.name, '#fde68a', 3.4);
      plate.parent = inst.root;
      plate.position = new Vector3(0, 2.75, 0);

      this.activeNpcs.push({ def: npcDef, root: inst.root });
    }

    // Friendly Medieval Bots: Soldiers, Mages (DW), Elves (ELF), and Blade Knights (BK)
    const botSpecs: Array<{ file: string; label: string; color: string; x: number; z: number }> = [
      { file: 'bot_soldier.glb', label: 'Soldado Guardia', color: '#cbd5e1', x: -12, z: 76 },
      { file: 'bot_soldier.glb', label: 'Soldado Guardia', color: '#cbd5e1', x: 12, z: -76 },
      { file: 'bot_soldier.glb', label: 'Centinela Puerta', color: '#cbd5e1', x: 76, z: 10 },
      { file: 'bot_soldier.glb', label: 'Centinela Puerta', color: '#cbd5e1', x: -76, z: -10 },
      { file: 'hero_dw.glb', label: 'Mago de Lorencia', color: '#93c5fd', x: -18, z: -22 },
      { file: 'hero_elf.glb', label: 'Elfa Vigía', color: '#6ee7b7', x: 22, z: -18 },
      { file: 'hero_dk.glb', label: 'Caballero BK', color: '#fca5a5', x: -34, z: -4 },
      { file: 'hero_dw.glb', label: 'Archimago Bot', color: '#93c5fd', x: 36, z: 4 },
      { file: 'hero_elf.glb', label: 'Arquera Élfica', color: '#6ee7b7', x: -8, z: 46 },
      { file: 'hero_dk.glb', label: 'Paladín BK', color: '#fca5a5', x: 14, z: -38 },
    ];

    for (let i = 0; i < botSpecs.length; i++) {
      const spec = botSpecs[i];
      const bot = await this.assetManager.instantiateModel(spec.file, `bot_${mapCfg.id}_${i}`, this.cityRoot, {
        scale: 1.05,
      });
      if (seq !== this.loadSeq) return;
      bot.root.position = new Vector3(spec.x, 0, spec.z);
      const plate = createNameplatePlane(this.scene, spec.label, spec.color, 2.8);
      plate.parent = bot.root;
      plate.position = new Vector3(0, 2.55, 0);

      this.friendlyBots.push({
        root: bot.root,
        x: spec.x,
        z: spec.z,
        homeX: spec.x,
        homeZ: spec.z,
        targetX: spec.x + (Math.random() - 0.5) * 18,
        targetZ: spec.z + (Math.random() - 0.5) * 18,
        speed: 3.2 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        waitTimer: Math.random() * 2,
      });
    }
  }

  private async buildOutskirtsAndFlora(mapCfg: MuMapConfig, seq: number) {
    const half = mapCfg.sizeMeters / 2 - 24;
    const minR = mapCfg.cityRadius + 22;

    // 1. Biome Vegetation (Trees, Corals, Spires) via ThinInstances (~650 instances across 1.0 - 1.6 km²)
    const floraMaster = await this.assetManager.getThinInstanceMaster(mapCfg.floraModel, `flora_${mapCfg.id}`);
    if (floraMaster && seq === this.loadSeq) {
      floraMaster.parent = this.floraRoot;
      const mats: number[] = [];
      let seed = mapCfg.worldIndex * 997 + 13;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 650; i++) {
        const x = (rand() * 2 - 1) * half;
        const z = (rand() * 2 - 1) * half;
        if (Math.hypot(x, z) < minR) continue;
        const y = this.getTerrainHeight(x, z);
        const s = 0.85 + rand() * 0.9;
        const ry = rand() * Math.PI * 2;
        const m = Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(ry, 0, 0), new Vector3(x, y, z));
        mats.push(...m.m);
      }
      if (mats.length > 0) {
        floraMaster.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16);
      }
    }

    // 2. Outskirts Medieval Hamlets & Cottages (casas aledañas fuera de la muralla)
    const houseMaster = await this.assetManager.getThinInstanceMaster('house_medieval.glb', `outskirts_${mapCfg.id}`);
    if (houseMaster && seq === this.loadSeq) {
      houseMaster.parent = this.floraRoot;
      const outMats: number[] = [];
      const outposts = [
        { x: 130, z: 32, ry: 0.4 },
        { x: 142, z: 46, ry: 1.1 },
        { x: -135, z: -36, ry: -0.6 },
        { x: -148, z: -50, ry: 0.8 },
        { x: 40, z: 145, ry: 2.1 },
        { x: -45, z: -150, ry: 0.2 },
        { x: 240, z: -190, ry: 1.4 },
        { x: -260, z: 210, ry: -1.2 },
      ];
      for (const op of outposts) {
        const y = this.getTerrainHeight(op.x, op.z);
        const m = Matrix.Compose(
          new Vector3(1.25, 1.25, 1.25),
          Quaternion.RotationYawPitchRoll(op.ry, 0, 0),
          new Vector3(op.x, y, op.z),
        );
        outMats.push(...m.m);
      }
      houseMaster.thinInstanceSetBuffer('matrix', new Float32Array(outMats), 16);
    }
  }

  private async populateMonsters(mapCfg: MuMapConfig, seq: number) {
    const count = Math.min(50000, Math.max(1000, mapCfg.targetMonsterCount));
    this.totalMonsters = count;

    this.monX = new Float32Array(count);
    this.monZ = new Float32Array(count);
    this.monHomeX = new Float32Array(count);
    this.monHomeZ = new Float32Array(count);
    this.monCampX = new Float32Array(count);
    this.monCampZ = new Float32Array(count);
    this.monLeash = new Float32Array(count);
    this.monHp = new Float32Array(count);
    this.monMaxHp = new Float32Array(count);
    this.monDmg = new Float32Array(count);
    this.monXp = new Float32Array(count);
    this.monZen = new Float32Array(count);
    this.monRespawn = new Float32Array(count);
    this.monAlive = new Uint8Array(count);
    this.monLevel = new Uint16Array(count);
    this.monDefIdx = new Uint8Array(count);
    this.monAttackCd = new Float32Array(count);
    this.monPowerCd = new Float32Array(count);
    this.monFrozenUntil = new Float64Array(count);
    this.monStrikeAnim = new Float32Array(count);
    this.spatialGrid.clear();

    const heroLevel = this.heroStatsSnapshot?.level ?? 1;
    this.lastScaledHeroLevel = heroLevel;
    const avgAtk = this.getPlayerAvgAttackEstimate();
    const mapRange = { minLevel: mapCfg.minLevel, maxLevel: mapCfg.maxLevel };

    const half = mapCfg.sizeMeters / 2 - 24;
    const spawnX = mapCfg.spawn?.x ?? 0;
    const spawnZ = mapCfg.spawn?.z ?? 0;
    const minSafeDist = mapCfg.cityRadius + 24;
    const defs = mapCfg.monsters;
    let seed = (mapCfg.worldIndex + 1) * 7919 + 41;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const isValidOutsideSpot = (x: number, z: number): boolean => {
      if (Math.abs(x) > half || Math.abs(z) > half) return false;
      if (this.isInSafeCity(x, z)) return false;
      if (Math.hypot(x - spawnX, z - spawnZ) < minSafeDist) return false;
      if (mapCfg.assetWorld && this.flyff.world) {
        if (this.flyff.world.surfaceAt(x + 1536, z + 1536) === 'water') return false;
        if (this.flyff.height(x, z) < 1.5) return false;
      }
      return true;
    };

    // 18 puntos aleatorios con 15 monstruos cada uno en un rango estricto de 3 metros (<= 3.0m) fuera de la ciudad
    const CAMP_COUNT = 18;
    const MONSTERS_PER_CAMP = 15;
    const camps: Array<{ x: number; z: number }> = [];
    for (let c = 0; c < CAMP_COUNT; c++) {
      let cx = spawnX + minSafeDist + 35;
      let cz = spawnZ + 20;
      for (let attempt = 0; attempt < 80; attempt++) {
        const ang = rand() * Math.PI * 2;
        const r = c < 12 ? minSafeDist + 16 + rand() * 210 : minSafeDist + 230 + rand() * 340;
        const tx = spawnX + Math.cos(ang) * r;
        const tz = spawnZ + Math.sin(ang) * r;
        if (isValidOutsideSpot(tx, tz) && camps.every((k) => Math.hypot(k.x - tx, k.z - tz) > 22)) {
          cx = tx;
          cz = tz;
          break;
        }
      }
      camps.push({ x: cx, z: cz });
    }

    const campTotal = CAMP_COUNT * MONSTERS_PER_CAMP; // 270 monstruos en los 18 puntos de 3m
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      let campX = 0;
      let campZ = 0;
      let leash = 18;

      if (i < campTotal) {
        const camp = camps[Math.floor(i / MONSTERS_PER_CAMP)];
        const ang = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand()) * 2.8;
        campX = camp.x;
        campZ = camp.z;
        x = camp.x + Math.cos(ang) * rad;
        z = camp.z + Math.sin(ang) * rad;
        leash = 3.0;
      } else {
        let found = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          const tx = (rand() * 2 - 1) * half;
          const tz = (rand() * 2 - 1) * half;
          if (isValidOutsideSpot(tx, tz)) {
            x = tx;
            z = tz;
            found = true;
            break;
          }
        }
        if (!found) {
          const ang = rand() * Math.PI * 2;
          const r = minSafeDist + 30 + rand() * 140;
          x = Math.max(-half, Math.min(half, spawnX + Math.cos(ang) * r));
          z = Math.max(-half, Math.min(half, spawnZ + Math.sin(ang) * r));
        }
        campX = x;
        campZ = z;
        leash = 18.0;
      }

      const defIdx = i % defs.length;
      const def = defs[defIdx];
      const scaled = scaleMonsterForPlayerLevel(def, heroLevel, avgAtk, mapRange, mapCfg.id);
      this.monX[i] = x;
      this.monZ[i] = z;
      this.monHomeX[i] = x;
      this.monHomeZ[i] = z;
      this.monCampX[i] = campX;
      this.monCampZ[i] = campZ;
      this.monLeash[i] = leash;
      this.monHp[i] = scaled.maxHp;
      this.monMaxHp[i] = scaled.maxHp;
      this.monDmg[i] = scaled.damage;
      this.monXp[i] = scaled.xp;
      this.monZen[i] = scaled.zen;
      this.monAlive[i] = 1;
      this.monRespawn[i] = 0;
      this.monLevel[i] = scaled.scaledLevel;
      this.monDefIdx[i] = defIdx;
      this.monAttackCd[i] = 0.6 + rand() * 1.4;
      this.monPowerCd[i] = 2.0 + rand() * 3.0;

      const key = this.cellKey(x, z);
      let bucket = this.spatialGrid.get(key);
      if (!bucket) {
        bucket = [];
        this.spatialGrid.set(key, bucket);
      }
      bucket.push(i);
    }

    // Ground contact shadows for active nearby monsters (1 batched draw call)
    const shadowDisc = MeshBuilder.CreateDisc(`monShadow_${mapCfg.id}`, { radius: 0.92, tessellation: 18 }, this.scene);
    shadowDisc.rotation.x = Math.PI / 2;
    const shadowMat = new StandardMaterial(`monShadowMat_${mapCfg.id}`, this.scene);
    shadowMat.diffuseColor = Color3.Black();
    shadowMat.emissiveColor = new Color3(0.02, 0.02, 0.03);
    shadowMat.alpha = 0.36;
    shadowMat.disableLighting = true;
    shadowDisc.material = shadowMat;
    shadowDisc.isPickable = false;
    shadowDisc.parent = this.monsterRoot;
    this.monShadowMesh = shadowDisc;
    this.monShadowMatrices = [];

    // Prepare ThinInstance master meshes for every monster archetype in this map
    const uniqueGlbs = new Set<string>();
    for (const d of defs) {
      if (!d.speciesId) uniqueGlbs.add(ARCHETYPE_TO_GLB[d.archetype] || 'mon_bull.glb');
      else if (!this.thinMasterMeshes.has(d.speciesId)) {
        const master = createCreature(this.scene, d.speciesId);
        if (!this.bestiaryMaterial) {
          this.bestiaryMaterial = new StandardMaterial('bestiaryPalette', this.scene);
          this.bestiaryMaterial.specularColor.set(.12, .12, .12);
        }
        master.material = this.bestiaryMaterial;
        master.parent = this.monsterRoot;
        master.setEnabled(false);
        this.thinMasterMeshes.set(d.speciesId, { mesh: master, matrices: [] });
      }
    }
    for (const glb of uniqueGlbs) {
      const master = await this.assetManager.getThinInstanceMaster(glb, `mon_${mapCfg.id}`);
      if (master && seq === this.loadSeq) {
        master.setEnabled(false);
        master.parent = this.monsterRoot;
        this.thinMasterMeshes.set(glb, { mesh: master, matrices: [] });
      } else if (master && !master.parent) master.dispose();
    }
  }

  private initMonsterHudSlots() {
    for (let i = 0; i < 10; i++) {
      const root = new TransformNode(`monSlot_${i}`, this.scene);
      root.parent = this.fxRoot;
      root.setEnabled(false);

      const hpBarBg = MeshBuilder.CreatePlane(`monHpBg_${i}`, { width: 1.9, height: 0.2 }, this.scene);
      const bgMat = new StandardMaterial(`monHpBgMat_${i}`, this.scene);
      bgMat.diffuseColor = Color3.Black();
      bgMat.emissiveColor = new Color3(0.08, 0.08, 0.12);
      bgMat.disableLighting = true;
      hpBarBg.material = bgMat;
      hpBarBg.billboardMode = Mesh.BILLBOARDMODE_ALL;
      hpBarBg.position.y = 2.55;
      hpBarBg.isPickable = false;
      hpBarBg.parent = root;

      const hpBarFill = MeshBuilder.CreatePlane(`monHpFill_${i}`, { width: 1.82, height: 0.13 }, this.scene);
      const hpFillMat = new StandardMaterial(`monHpFillMat_${i}`, this.scene);
      hpFillMat.diffuseColor = Color3.Black();
      hpFillMat.emissiveColor = new Color3(0.92, 0.25, 0.25);
      hpFillMat.disableLighting = true;
      hpBarFill.material = hpFillMat;
      hpBarFill.billboardMode = Mesh.BILLBOARDMODE_ALL;
      hpBarFill.position.y = 2.55;
      hpBarFill.position.z = -0.02;
      hpBarFill.isPickable = false;
      hpBarFill.parent = root;

      const plateTex = new DynamicTexture(`monPlateTex_${i}`, { width: 384, height: 64 }, this.scene, true);
      plateTex.hasAlpha = true;
      const plate = MeshBuilder.CreatePlane(`monPlate_${i}`, { width: 2.3, height: 0.38 }, this.scene);
      const plateMat = new StandardMaterial(`monPlateMat_${i}`, this.scene);
      plateMat.diffuseTexture = plateTex;
      plateMat.emissiveTexture = plateTex;
      plateMat.opacityTexture = plateTex;
      plateMat.disableLighting = true;
      plateMat.backFaceCulling = false;
      plate.material = plateMat;
      plate.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plate.position.y = 2.86;
      plate.isPickable = false;
      plate.parent = root;

      this.activeMonsterSlots.push({
        poolIdx: -1,
        root,
        hpBarBg,
        hpBarFill,
        hpFillMat,
        plate,
        plateTex,
        lastLabel: '',
        hitFlash: 0,
      });
    }

    const ringRoot = new TransformNode('autoAimRing', this.scene);
    ringRoot.setEnabled(false);
    ringRoot.parent = this.fxRoot;
    this.autoAimRing = ringRoot;
    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/MoveTargetPosEffect.glb', 'aim_marker', ringRoot, {
        targetSize: 2.25,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: 0xfbbf24,
        emissiveIntensity: 0.72,
      })
      .catch(() => {});
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor(x / CELL_SIZE) + 128;
    const cz = Math.floor(z / CELL_SIZE) + 128;
    return (cx << 10) + cz;
  }

  private queryNearbyMonsterIndices(px: number, pz: number, radius: number): number[] {
    const minCx = Math.floor((px - radius) / CELL_SIZE) + 128;
    const maxCx = Math.floor((px + radius) / CELL_SIZE) + 128;
    const minCz = Math.floor((pz - radius) / CELL_SIZE) + 128;
    const maxCz = Math.floor((pz + radius) / CELL_SIZE) + 128;
    const r2 = radius * radius;
    const result: number[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.spatialGrid.get((cx << 10) + cz);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          const dx = this.monX[idx] - px;
          const dz = this.monZ[idx] - pz;
          if (dx * dx + dz * dz <= r2) {
            result.push(idx);
          }
        }
      }
    }
    return result;
  }

  private initWeatherParticles(kind: WeatherKind) {
    this.weatherKind = kind;
    if (kind === 'none') return;
    const count = 240;
    const hex =
      kind === 'snowfall' || kind === 'snow'
        ? 0xe0f2fe
        : kind === 'embers'
          ? 0xf97316
          : kind === 'petals'
            ? 0xf472b6
            : kind === 'underwater'
              ? 0x5eead4
              : kind === 'sandDust'
                ? 0xfde68a
                : 0xbef264;

    const spriteTex = new DynamicTexture('weatherSpriteTex', { width: 32, height: 32 }, this.scene, true);
    const sctx = spriteTex.getContext();
    sctx.clearRect(0, 0, 32, 32);
    const grad = sctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 32, 32);
    spriteTex.hasAlpha = true;
    spriteTex.update();

    const proto = MeshBuilder.CreatePlane('weatherProto', { size: 0.22 }, this.scene);
    const mat = new StandardMaterial('weatherMat', this.scene);
    mat.emissiveColor = Color3.FromHexString(`#${hex.toString(16).padStart(6, '0')}`);
    mat.diffuseTexture = spriteTex;
    mat.opacityTexture = spriteTex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    proto.material = mat;
    proto.billboardMode = Mesh.BILLBOARDMODE_ALL;
    proto.isPickable = false;
    proto.alwaysSelectAsActiveMesh = true;

    this.weatherPositions = new Float32Array(count * 3);
    this.weatherMatrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      this.weatherPositions[i * 3] = (Math.random() - 0.5) * 60;
      this.weatherPositions[i * 3 + 1] = Math.random() * 20;
      this.weatherPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    proto.thinInstanceSetBuffer('matrix', this.weatherMatrices, 16, false);
    this.weatherMesh = proto;
  }

  private computeHeroDamage(skill: SkillDef, bonusStatPower: number) {
    const c = this.heroStatsSnapshot;
    const eqDmg = this.heroEquippedItems
      .filter((i) => i.isEquipped && (i.durability ?? 100) > 0)
      .reduce((acc, i) => acc + i.minDmg + i.maxDmg + i.magicPower, 0);

    const str = c?.str ?? 32;
    const agi = c?.agi ?? 24;
    const ene = c?.ene ?? 22;
    const cmd = c?.cmd ?? 0;

    const base =
      this.heroClass === 'DW'
        ? 28 + ene * 1.15 + eqDmg * 0.55
        : this.heroClass === 'ELF'
          ? 26 + agi * 1.05 + str * 0.35 + eqDmg * 0.55
          : this.heroClass === 'DL'
            ? 30 + str * 0.8 + cmd * 0.75 + eqDmg * 0.55
            : this.heroClass === 'MG'
              ? 28 + (str + ene) * 0.65 + eqDmg * 0.55
              : 30 + str * 1.1 + eqDmg * 0.55;

    const variantKey = getVariantKey(this.heroClass, this.heroSex);
    const profile = getVariantProfile(this.heroClass, this.heroSex);
    const rank = getSkillRank(c, skill.id);
    const effectiveMult = getEffectiveSkillMultiplier(
      skill.damageMultiplier,
      rank,
      variantKey,
      c?.specialization ?? 'balanced',
    );
    const buffAtkMult = 1 + this.activeEffectBonuses.atkBonusPct / 100;

    const totalBase = (base + bonusStatPower * 0.6) * effectiveMult * buffAtkMult;
    const critRate = Math.min(0.55, (profile.critBasePct + this.activeEffectBonuses.critBonusPct) / 100);
    const isExcellent = Math.random() < 0.16;
    const isCritical = !isExcellent && Math.random() < critRate;
    const mult = isExcellent ? 1.55 : isCritical ? 1.32 : 0.92 + Math.random() * 0.18;
    return {
      damage: Math.max(12, Math.round(totalBase * mult)),
      isCritical,
      isExcellent,
    };
  }

  private getAutoAimCandidateList(maxRange: number) {
    const nearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, maxRange);
    const candidates = [];
    for (const idx of nearby) {
      if (this.monAlive[idx] !== 1) continue;
      const dist = Math.hypot(this.monX[idx] - this.heroX, this.monZ[idx] - this.heroZ);
      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      candidates.push({
        index: idx,
        x: this.monX[idx],
        z: this.monZ[idx],
        dist,
        isBoss: Boolean(def?.isBoss),
      });
    }
    return candidates;
  }

  executeSkill(skill: SkillDef, comboMultiplier = 1, bonusStatPower = 0) {
    if (this.mode !== 'playing' || this.loadingMap) return;

    // STRICT SAFE CITY RULE: No attacks or skills inside the capital city!
    if (this.isInSafeCity()) {
      const now = performance.now();
      if (now - this.lastSafeZoneNoticeTime > 1200) {
        this.lastSafeZoneNoticeTime = now;
        this.callbacks.onFloatingText('Zona Segura de la Capital: No se permiten ataques aquí', '#fbbf24');
      }
      return;
    }

    // 60% Auto-Aim assist across all 10 hero variants (works mid-run & mid-jump!)
    const aimRange = Math.max(skill.range + 6, 16);
    const aimResult = this.autoAimAssist
      ? findAutoAimTarget(
          this.heroX,
          this.heroZ,
          this.heroRotY,
          aimRange,
          this.getAutoAimCandidateList(aimRange),
          AUTO_AIM_PROBABILITY,
        )
      : null;

    if (aimResult) {
      this.heroRotY = aimResult.blendedAngle;
      this.lockedTargetIdx = aimResult.targetIndex;
    }

    this.heroAction = 'skill';
    this.attackSwingTimer = 0.34;
    this.flyff.cast(skill);
    const craft = artisanWeapon(this.currentEquippedWeapon);
    if (craft && !skill.isBuff) {
      const socket = this.flyff.actor?.outfit.transformNodes.find(n =>
        n.name === (craft.classType === 'ELF' ? 'socket_leftHand' : 'socket_rightHand'));
      const point = socket?.getAbsolutePosition() ?? this.heroRoot.position.add(new Vector3(0, 1, 0));
      this.addCreatureEffect(point, point, craft.element, 'greeting');
      soundSynth.playCreatureSfx(craft.element, 'strike');
    }
    this.spawnSkillVfx(skill);

    const dmgRoll = this.computeHeroDamage(skill, bonusStatPower);
    const damage = Math.max(12, Math.round(dmgRoll.damage * Math.max(1, comboMultiplier)));
    const { isCritical, isExcellent } = dmgRoll;

    if (skill.isBuff) {
      this.callbacks.onFloatingText(`+${skill.shortName} Activo`, '#4ade80');
      return;
    }

    const hitLanded = aimResult ? rollAutoAimHit(this.autoAimAssist, AUTO_AIM_PROBABILITY) : true;
    const freezeMs = skill.vfx === 'ice_arrow' ? 2000 : 0;

    // DL Fire Scream: blue-flame 5m radial explosion around the hero + forward flame wave
    if (skill.vfx === 'fire_scream') {
      const auraNearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, 5.2);
      for (const idx of auraNearby) {
        if (this.monAlive[idx] !== 1) continue;
        this.damageMonsterAt(idx, Math.round(damage * 0.85), isCritical, isExcellent, 0x38bdf8, 0);
      }
    }

    // Ranged projectile skills aimed with 50% auto-aim blend & accuracy roll
    if (
      skill.vfx === 'bolt' ||
      skill.vfx === 'fire_burst' ||
      skill.vfx === 'arrow' ||
      skill.vfx === 'triple_shot' ||
      skill.vfx === 'ice_arrow' ||
      skill.vfx === 'fire_scream' ||
      skill.vfx === 'raven'
    ) {
      const count = skill.vfx === 'triple_shot' ? 3 : 1;
      const missDeflect = hitLanded ? 0 : (Math.random() < 0.5 ? -0.28 : 0.28);
      const baseAngle = (aimResult ? aimResult.blendedAngle : this.heroRotY) + missDeflect;

      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 0.22;
        const ang = baseAngle + spread;
        const isArrow = skill.vfx === 'arrow' || skill.vfx === 'triple_shot' || skill.vfx === 'ice_arrow';
        const projNode = new TransformNode(`proj_${skill.id}_${Date.now()}_${i}`, this.scene);
        projNode.position = new Vector3(
          this.heroX + Math.sin(ang) * 1.15,
          this.getTerrainHeight(this.heroX, this.heroZ) + 1.32,
          this.heroZ + Math.cos(ang) * 1.15,
        );
        projNode.rotation.y = ang;
        projNode.parent = this.fxRoot;

        const modelPath = isArrow
          ? '/flyff/efectos/mallas/obj_middlearrow_01.glb'
          : skill.vfx === 'fire_scream'
            ? '/openmu/effects/darkfirescrem01.glb'
            : skill.vfx === 'bolt' || skill.vfx === 'raven'
              ? '/openmu/effects/chain_lightning_ani.glb'
              : '/openmu/effects/FlameStrike.glb';

        const projColor = skill.vfx === 'fire_scream' ? 0x38bdf8 : skill.vfx === 'ice_arrow' ? 0x67e8f9 : skill.colorHex;

        void this.assetManager
          .instantiateNormalizedModel(modelPath, `proj_glb_${i}`, projNode, {
            targetSize: isArrow ? 1.25 : 1.05,
            zUpOpenMu: !isArrow,
            seatOnGround: false,
            emissiveHex: projColor,
            emissiveIntensity: 0.9,
          })
          .catch(() => {});

        this.projectiles.push({
          mesh: projNode,
          x: projNode.position.x,
          y: projNode.position.y,
          z: projNode.position.z,
          vx: Math.sin(ang) * 28,
          vz: Math.cos(ang) * 28,
          life: 0.95,
          damage: hitLanded ? damage : Math.round(damage * 0.2),
          isCritical,
          isExcellent,
          freezeMs,
          colorHex: projColor,
        });
      }
      return;
    }

    // Melee / AoE instant area hit (prioritizes 50% auto-aimed target first!)
    const nearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, skill.range + 2.4);
    if (aimResult && nearby.includes(aimResult.targetIndex)) {
      const i = nearby.indexOf(aimResult.targetIndex);
      if (i > 0) {
        nearby.splice(i, 1);
        nearby.unshift(aimResult.targetIndex);
      }
    }

    if (!hitLanded && nearby.length > 0) {
      const missIdx = nearby[0];
      const mx = this.monX[missIdx];
      const mz = this.monZ[missIdx];
      this.emitDamageNumber(
        new Vector3(mx, this.getTerrainHeight(mx, mz) + 2.3, mz),
        'Esquivado',
        '#94a3b8',
        false,
      );
      return;
    }

    let hits = 0;
    for (const idx of nearby) {
      if (this.monAlive[idx] !== 1) continue;
      if (!skill.isAoe && hits >= 1) break;
      this.damageMonsterAt(idx, damage, isCritical, isExcellent, skill.colorHex, freezeMs);
      hits++;
      if (hits >= 14) break;
    }

    if (hits > 0) {
      this.callbacks.onBossHitInEvent(Math.round(damage * 0.7));
    }
  }

  executeComboChain(skills: SkillDef[], bonusStatPower = 0) {
    if (this.mode !== 'playing') return;
    if (this.isInSafeCity()) {
      this.callbacks.onFloatingText('Zona Segura de la Capital: Sal por las puertas para usar Combo', '#fbbf24');
      return;
    }
    const chain = skills.slice(0, 5);
    if (chain.length === 0) return;
    this.comboState = { steps: chain, nextIndex: 0, timer: 0.01, bonusStatPower };
  }

  playLevelUpAnimation(isReset = false) {
    const node = new TransformNode(`lvlUpFx_${Date.now()}`, this.scene);
    node.parent = this.heroRoot;
    node.position.set(0, 0.08, 0);
    const fxColor = isReset ? 0xf59e0b : 0x38bdf8;
    const fxSize = isReset ? 4.4 : 3.2;

    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/Change_Up_Eff.glb', 'lvl_change', node, {
        targetSize: fxSize,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: fxColor,
        emissiveIntensity: 1.0,
      })
      .catch(() => {});
    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/MagicCircle01.glb', 'lvl_circle', node, {
        targetSize: fxSize * 0.9,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: 0xfde047,
        emissiveIntensity: 0.9,
      })
      .catch(() => {});
    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/ManaRune.glb', 'lvl_rune', node, {
        targetSize: fxSize * 0.72,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: fxColor,
        emissiveIntensity: 0.95,
      })
      .catch(() => {});

    this.transientFx.push({
      node,
      life: 2.2,
      maxLife: 2.2,
      expandRate: 0.38,
      spinSpeed: isReset ? 4.2 : 2.8,
      riseSpeed: 0.35,
    });
    soundSynth.playLevelUp();
  }

  sampleMinimapTerrain(
    spanMeters: number,
    gridSize = 48,
    centerX = this.heroX,
    centerZ = this.heroZ,
  ): number[] | null {
    const heights = this.flyff.sampleMinimapTerrain(centerX, centerZ, spanMeters, gridSize);
    if (heights) return heights;
    const fallback: number[] = new Array(gridSize * gridSize);
    const half = spanMeters / 2;
    const step = spanMeters / Math.max(1, gridSize - 1);
    for (let row = 0; row < gridSize; row++) {
      const wz = centerZ + half - row * step;
      for (let col = 0; col < gridSize; col++) {
        const wx = centerX - half + col * step;
        fallback[row * gridSize + col] = this.getTerrainHeight(wx, wz);
      }
    }
    return fallback;
  }

  private spawnSkillVfx(skill: SkillDef) {
    const hy = this.getTerrainHeight(this.heroX, this.heroZ);
    const node = new TransformNode(`vfx_${skill.id}_${Date.now()}`, this.scene);
    node.position = new Vector3(this.heroX, hy + 0.08, this.heroZ);
    node.rotation.y = this.heroRotY;
    node.parent = this.fxRoot;

    // DL Fire Scream: 5m blue-fire AoE circle around the hero
    if (skill.vfx === 'fire_scream') {
      void this.assetManager
        .instantiateNormalizedModel('/openmu/effects/darkfirescrem01.glb', 'dl_blue_fire', node, {
          targetSize: 5.0,
          zUpOpenMu: true,
          seatOnGround: true,
          emissiveHex: 0x38bdf8,
          emissiveIntensity: 1.0,
        })
        .catch(() => {});
      this.transientFx.push({
        node,
        life: 0.85,
        maxLife: 0.85,
        expandRate: 0.35,
        spinSpeed: 5.4,
        riseSpeed: 0.14,
      });
      return;
    }

    const effectGlb =
      skill.vfx === 'buff'
        ? '/openmu/effects/Protect01.glb'
        : skill.vfx === 'ice_storm' || skill.vfx === 'ice_arrow'
          ? '/openmu/effects/blizzard.glb'
          : skill.vfx === 'lightning_shock' || skill.vfx === 'gigantic_storm' || skill.vfx === 'chaotic_ray'
            ? '/openmu/effects/chain_lightning_ani.glb'
            : skill.vfx === 'aqua_beam' || skill.vfx === 'bolt' || skill.vfx === 'evil_spirit'
              ? '/openmu/effects/lightning_type01.glb'
              : skill.vfx === 'nova' || skill.vfx === 'hellfire' || skill.vfx === 'meteor' || skill.vfx === 'fire_burst'
                ? '/openmu/effects/Inferno01.glb'
                : skill.vfx === 'twisting' || skill.vfx === 'blood_storm' || skill.vfx === 'power_slash' || skill.vfx === 'sword_rush'
                  ? '/openmu/effects/SwordForce.glb'
                  : skill.vfx === 'death_stab' || skill.vfx === 'rageful_blow'
                    ? '/openmu/effects/combo.glb'
                    : '/openmu/effects/magic_powerup.glb';

    void this.assetManager
      .instantiateNormalizedModel(effectGlb, `skill_glb_${skill.id}`, node, {
        targetSize: skill.isAoe ? 3.8 : 2.3,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: skill.colorHex,
        emissiveIntensity: 0.82,
      })
      .catch(() => {});

    this.transientFx.push({
      node,
      life: 0.65,
      maxLife: 0.65,
      expandRate: skill.isAoe ? 1.5 : 0.95,
      spinSpeed: skill.vfx === 'buff' ? 3.2 : 6.5,
      riseSpeed: skill.vfx === 'buff' ? 0.65 : 0.12,
    });
  }

  private spawnHitImpactVfx(x: number, y: number, z: number, colorHex = 0xfbbf24, isCritical = false) {
    const node = new TransformNode(`hitFx_${Date.now()}`, this.scene);
    node.position.set(x, y, z);
    node.parent = this.fxRoot;

    const effectGlb = isCritical ? '/openmu/effects/FlameStrike.glb' : '/openmu/effects/lightning_type01.glb';
    void this.assetManager
      .instantiateNormalizedModel(effectGlb, 'hit_glb', node, {
        targetSize: isCritical ? 1.45 : 1.0,
        zUpOpenMu: true,
        seatOnGround: false,
        emissiveHex: colorHex,
        emissiveIntensity: 0.88,
      })
      .catch(() => {});

    this.transientFx.push({
      node,
      life: 0.36,
      maxLife: 0.36,
      expandRate: 1.4,
      spinSpeed: 8.5,
      riseSpeed: 0.45,
    });
  }

  private damageMonsterAt(
    idx: number,
    damage: number,
    isCritical: boolean,
    isExcellent: boolean,
    colorHex = 0xfbbf24,
    freezeMs = 0,
  ) {
    if (this.monAlive[idx] !== 1) return;
    this.monHp[idx] = Math.max(0, this.monHp[idx] - damage);
    this.flyff.impact(this.monX[idx], this.monZ[idx]);

    const mx = this.monX[idx];
    const mz = this.monZ[idx];
    const groundY = this.getTerrainHeight(mx, mz);
    const my = groundY + 2.4;

    if (freezeMs > 0) {
      this.monFrozenUntil[idx] = performance.now() + freezeMs;
      const iceNode = new TransformNode(`iceFreeze_${Date.now()}`, this.scene);
      iceNode.position.set(mx, groundY + 0.1, mz);
      iceNode.parent = this.fxRoot;
      void this.assetManager
        .instantiateNormalizedModel('/openmu/effects/Ice01.glb', 'ice_freeze_glb', iceNode, {
          targetSize: 1.85,
          zUpOpenMu: true,
          seatOnGround: true,
          emissiveHex: 0x67e8f9,
          emissiveIntensity: 0.92,
        })
        .catch(() => {});
      this.transientFx.push({
        node: iceNode,
        life: freezeMs / 1000,
        maxLife: freezeMs / 1000,
        expandRate: 0.12,
        spinSpeed: 1.2,
        riseSpeed: 0,
      });
      this.emitDamageNumber(new Vector3(mx, my + 0.35, mz), '¡CONGELADO 2s!', '#67e8f9', true);
    }

    this.spawnHitImpactVfx(mx, groundY + 1.1, mz, isExcellent ? 0x34d399 : isCritical ? 0xfbbf24 : colorHex, isCritical || isExcellent);
    this.emitDamageNumber(
      new Vector3(mx, my, mz),
      isExcellent ? `EXC -${damage}!` : isCritical ? `CRIT -${damage}!` : `-${damage}`,
      isExcellent ? '#34d399' : isCritical ? '#fbbf24' : '#f8fafc',
      isExcellent || isCritical,
    );

    const activeSlot = this.activeMonsterSlots.find((s) => s.poolIdx === idx);
    if (activeSlot) {
      activeSlot.hitFlash = 0.16;
    }

    if (this.monHp[idx] <= 0) {
      this.monAlive[idx] = 0;
      this.monFrozenUntil[idx] = 0;
      this.monRespawn[idx] = 10 + Math.random() * 8;
      const xp = this.monXp[idx];
      const zen = this.monZen[idx];
      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      const species = def?.speciesId && SPECIES_BY_ID.get(def.speciesId);
      if (species) {
        soundSynth.playCreatureSfx(species.power.element, 'defeat');
        const place = new Vector3(mx, groundY + .4, mz);
        this.addCreatureEffect(place, place, species.power.element, 'defeat');
      } else soundSynth.playMonsterHit();
      this.callbacks.onKillMonster(xp, zen, Boolean(def?.isBoss));
      this.maybeSpawnLoot(mx, mz, zen);
    }
  }

  private emitDamageNumber(worldPos: Vector3, text: string, color: string, isCritical = false) {
    if (!this.callbacks.onDamageNumber) return;
    const vp = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const projected = Vector3.Project(
      worldPos,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      vp,
    );
    const xPct = (projected.x / this.engine.getRenderWidth()) * 100;
    const yPct = (projected.y / this.engine.getRenderHeight()) * 100;
    if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;

    this.callbacks.onDamageNumber({
      id: this.dmgSeq++,
      text,
      color,
      xPct,
      yPct,
      isCritical,
    });
  }

  private maybeSpawnLoot(x: number, z: number, zenAmount: number) {
    if (this.lootDrops.length > 26) return;
    const roll = Math.random();
    let kind: LootDrop['kind'] = 'zen';
    let label = `${Math.round(zenAmount * 0.6)} Zen`;
    let amount = Math.round(zenAmount * 0.6);
    let colorHex = 0xfbbf24;

    if (roll < 0.07) {
      kind = 'bless';
      label = 'Jewel of Bless';
      amount = 1;
      colorHex = 0xf43f5e;
      soundSynth.playJewelDrop();
    } else if (roll < 0.14) {
      kind = 'soul';
      label = 'Jewel of Soul';
      amount = 1;
      colorHex = 0x38bdf8;
      soundSynth.playJewelDrop();
    } else if (roll < 0.18) {
      kind = 'chaos';
      label = 'Jewel of Chaos';
      amount = 1;
      colorHex = 0xf59e0b;
      soundSynth.playJewelDrop();
    } else if (roll < 0.21) {
      kind = 'life';
      label = 'Jewel of Life';
      amount = 1;
      colorHex = 0xc084fc;
      soundSynth.playJewelDrop();
    } else if (roll < 0.24) {
      kind = 'creation';
      label = 'Jewel of Creation';
      amount = 1;
      colorHex = 0x34d399;
      soundSynth.playJewelDrop();
    } else if (roll < 0.27) {
      kind = 'talisman';
      label = 'Talismán de Suerte';
      amount = 1;
      colorHex = 0xfde047;
      soundSynth.playJewelDrop();
    } else if (roll > 0.68) {
      return;
    }

    const node = new TransformNode(`loot_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, this.scene);
    const y = this.getTerrainHeight(x, z);
    node.position = new Vector3(x, y + 0.01, z);
    node.parent = this.fxRoot;

    void this.assetManager
      .instantiateNormalizedModel(`/openmu/models/drop_${kind}.glb`, `drop_${kind}_${Date.now()}`, node, {
        targetSize: kind === 'zen' ? 0.44 : 0.48,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: colorHex,
        emissiveIntensity: kind === 'zen' ? 0.22 : 0.42,
      })
      .catch(() => {});

    this.lootDrops.push({
      id: `drp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      label,
      amount,
      x,
      z,
      node,
      spawnTime: performance.now(),
    });
  }

  pickupNearestLoot(forceManual = true, filters?: LootFilterSettings): boolean {
    let bestIdx = -1;
    let bestDist = 9.0;
    for (let i = 0; i < this.lootDrops.length; i++) {
      const drop = this.lootDrops[i];
      if (filters && !matchesLootFilter(drop.kind, filters, forceManual)) continue;
      const d = Math.hypot(drop.x - this.heroX, drop.z - this.heroZ);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const [drop] = this.lootDrops.splice(bestIdx, 1);
      drop.node.dispose();
      soundSynth.playPickup(drop.kind !== 'zen');
      this.callbacks.onPickupLoot({ kind: drop.kind, label: drop.label, amount: drop.amount });
      return true;
    }
    return false;
  }

  collectAutoLoot(filters: LootFilterSettings): number {
    if (!filters.autoLootEnabled) return 0;
    let picked = 0;
    for (let i = this.lootDrops.length - 1; i >= 0; i--) {
      const drop = this.lootDrops[i];
      if (!matchesLootFilter(drop.kind, filters, false)) continue;
      const d = Math.hypot(drop.x - this.heroX, drop.z - this.heroZ);
      if (d <= 8.5) {
        this.lootDrops.splice(i, 1);
        drop.node.dispose();
        soundSynth.playPickup(drop.kind !== 'zen');
        this.callbacks.onPickupLoot({ kind: drop.kind, label: drop.label, amount: drop.amount });
        picked++;
      }
    }
    return picked;
  }

  async syncRemotePeers(peers: RoomPeer[], localPeerId: string) {
    const visible = peers.filter(p => p.peerId !== localPeerId && (!p.currentMapId || p.currentMapId === this.currentMap.id));
    const ids = new Set(visible.map(p => p.peerId));
    for (const [id, entry] of this.remotePeers) if (!ids.has(id)) {
      entry.content.dispose(); entry.root.dispose(); this.remotePeers.delete(id);
    }
    for (const p of visible) {
      let entry = this.remotePeers.get(p.peerId);
      if (!entry) {
        const root = new TransformNode(`peer_${p.peerId}`, this.scene);root.parent = this.worldRoot;
        root.position.set(p.x, this.getTerrainHeight(p.x,p.z),p.z);
        const content = new FlyffContent(this.scene);content.onError = this.flyff.onError;
        entry = {name: p.name, root, content, targetX:p.x, targetZ:p.z, rotY:p.rotY, action:p.action};
        this.remotePeers.set(p.peerId,entry);
        const plate = createNameplatePlane(this.scene,p.name,'#38bdf8',2.8);plate.parent=root;plate.position.y=2.1;
      }
      entry.name = p.name;
      entry.targetX=p.x;entry.targetZ=p.z;entry.rotY=p.rotY;
      const oldAction=entry.action;entry.action=p.action;
      await entry.content.character(p.classType,p.sex??'male',p.equipment??getStarterItemsForMuClass(p.peerId,p.name,p.classType),entry.root);
      if (entry.content.actor && oldAction !== p.action && ['attack','skill'].includes(p.action)) entry.content.actor.play(p.action==='attack'?'attack':'cast_release',false);
    }
  }

  private update(dt: number, now: number) {
    // FPS counter
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (now - this.fpsLastReport >= 700) {
      const fps = Math.max(1, Math.round(this.fpsFrames / Math.max(0.01, this.fpsAccum)));
      this.callbacks.onFpsUpdate?.(fps);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.fpsLastReport = now;
    }

    if (this.camAutoTurnCooldown > 0) {
      this.camAutoTurnCooldown = Math.max(0, this.camAutoTurnCooldown - dt);
    }

    // Combo chain stepper (up to 5 powers!)
    if (this.comboState.steps) {
      this.comboState.timer -= dt;
      if (this.comboState.timer <= 0) {
        const stepIdx = this.comboState.nextIndex;
        const skill = this.comboState.steps[stepIdx];
        this.executeSkill(skill, 1.15 + stepIdx * 0.1, this.comboState.bonusStatPower);
        this.comboState.nextIndex += 1;
        if (this.comboState.nextIndex >= this.comboState.steps.length) {
          const count = this.comboState.steps.length;
          this.comboState.steps = null;
          this.callbacks.onFloatingText(`¡COMBO x${count}!`, '#38bdf8');
        } else {
          this.comboState.timer = 0.26;
        }
      }
    }

    // Hero movement
    if (this.mode === 'playing' && !this.loadingMap) {
      let mx = this.joystickVec.x;
      let mz = -this.joystickVec.y;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;

      const mag = Math.hypot(mx, mz);
      if (mag > 0.08) {
        const lx = mx / Math.max(1, mag);
        const lz = mz / Math.max(1, mag);
        // Camera-relative movement so rotating 360° left/right/up/down while running steers seamlessly
        const fwdX = -Math.cos(this.camera.alpha);
        const fwdZ = -Math.sin(this.camera.alpha);
        const rightX = -Math.sin(this.camera.alpha);
        const rightZ = Math.cos(this.camera.alpha);
        const nx = rightX * lx + fwdX * lz;
        const nz = rightZ * lx + fwdZ * lz;
        const speed = 13.5 * (1 + this.activeEffectBonuses.speedBonusPct / 100);
        const limit = this.currentMap.sizeMeters / 2 - 14;
        const nextX = Math.max(-limit, Math.min(limit, this.heroX + nx * speed * dt));
        const nextZ = Math.max(-limit, Math.min(limit, this.heroZ + nz * speed * dt));
        if (this.flyff.canMove(nextX, this.heroZ, this.heroX, this.heroZ, this.heroRoot.position.y + (this.flyff.actor?.root.position.y ?? 0))) this.heroX = nextX;
        if (this.flyff.canMove(this.heroX, nextZ, this.heroX, this.heroZ, this.heroRoot.position.y + (this.flyff.actor?.root.position.y ?? 0))) this.heroZ = nextZ;
        if (this.attackSwingTimer <= 0) {
          this.heroRotY = Math.atan2(nx, nz);
          this.heroAction = 'move';
        }
        // Smooth third-person camera turn ONLY when classic follow mode (!free3dMode) and idle from drag
        if (!this.free3dMode && this.camDragPointerId === null && this.camAutoTurnCooldown <= 0 && lz > -0.35) {
          const desiredAlpha = Math.atan2(-Math.cos(this.heroRotY), -Math.sin(this.heroRotY));
          const diff = Math.atan2(
            Math.sin(desiredAlpha - this.camera.alpha),
            Math.cos(desiredAlpha - this.camera.alpha),
          );
          const turnRate = Math.abs(lx) > 0.25 ? 2.8 : 1.9;
          this.camera.alpha += diff * Math.min(1, dt * turnRate);
        }
      } else if (this.autoHuntEnabled && !this.isInSafeCity()) {
        // Auto-hunt: walk toward nearest living monster and trigger Combo attack automatically
        const candidates = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, 68);
        let bestIdx = -1;
        let bestDist = Infinity;
        for (const idx of candidates) {
          if (this.monAlive[idx] !== 1) continue;
          const d = Math.hypot(this.monX[idx] - this.heroX, this.monZ[idx] - this.heroZ);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
          }
        }
        if (bestIdx >= 0) {
          this.lockedTargetIdx = bestIdx;
          const dx = this.monX[bestIdx] - this.heroX;
          const dz = this.monZ[bestIdx] - this.heroZ;
          this.heroRotY = Math.atan2(dx, dz);
          if (bestDist > 4.2) {
            const nx = dx / bestDist;
            const nz = dz / bestDist;
            const speed = 12.2 * (1 + this.activeEffectBonuses.speedBonusPct / 100);
            const limit = this.currentMap.sizeMeters / 2 - 14;
            const nextX = Math.max(-limit, Math.min(limit, this.heroX + nx * speed * dt));
            const nextZ = Math.max(-limit, Math.min(limit, this.heroZ + nz * speed * dt));
            const footY = this.heroRoot.position.y + (this.flyff.actor?.root.position.y ?? 0);
            if (this.flyff.canMove(nextX, this.heroZ, this.heroX, this.heroZ, footY)) this.heroX = nextX;
            if (this.flyff.canMove(this.heroX, nextZ, this.heroX, this.heroZ, footY)) this.heroZ = nextZ;
            this.heroAction = 'move';
          } else if (this.attackSwingTimer <= 0) {
            this.heroAction = 'idle';
          }
          if (bestDist <= 6.8) {
            this.autoHuntAttackTimer -= dt;
            if (this.autoHuntAttackTimer <= 0 && !this.comboState.steps) {
              this.autoHuntAttackTimer = 0.92;
              this.callbacks.onAutoHuntAttack?.();
            }
          }
        } else if (this.attackSwingTimer <= 0) {
          this.heroAction = 'idle';
        }
      } else if (this.attackSwingTimer <= 0) {
        this.heroAction = 'idle';
      }

      const hy = this.currentMap.assetWorld ? this.flyff.walkHeight(this.heroX,this.heroZ,this.heroRoot.position.y,dt) : this.getTerrainHeight(this.heroX, this.heroZ);
      this.heroRoot.position.set(this.heroX, hy, this.heroZ);
      if (this.heroModelRoot && !this.flyff.actor) {
        this.heroModelRoot.rotation.y = this.heroRotY;
        if (this.heroAction === 'move') {
          this.heroModelRoot.position.y = Math.abs(Math.sin(now * 0.014)) * 0.11;
        } else {
          this.heroModelRoot.position.y = Math.sin(now * 0.003) * 0.03;
        }
      }

      if (this.attackSwingTimer > 0) {
        this.attackSwingTimer -= dt;
        if (this.heroWeaponNode) {
          this.heroWeaponNode.rotation.x = 0.45 + Math.sin(this.attackSwingTimer * 26) * 1.1;
        }
      } else if (this.heroWeaponNode) {
        this.heroWeaponNode.rotation.x = 0.45;
      }

      // Collision-free 3rd-person 360° camera (~5.4m default distance) with terrain clearance damping
      const targetX = exponentialDamp(this.camera.target.x, this.heroX, 16, dt);
      const targetY = exponentialDamp(this.camera.target.y, hy + 1.38, 16, dt);
      const targetZ = exponentialDamp(this.camera.target.z, this.heroZ, 16, dt);
      this.camera.target.set(targetX, targetY, targetZ);

      const camSolve = solveCameraWithTerrain({
        pivotX: targetX,
        pivotY: targetY,
        pivotZ: targetZ,
        alpha: this.camera.alpha,
        beta: clampCameraBeta(this.camera.beta),
        desiredRadius: this.cameraDistance,
        sampleTerrainHeight: (sx, sz) => this.getTerrainHeight(sx, sz),
        minClearanceAboveTerrain: 0.78,
        prevPos: this.camPrevEye,
        dt,
        smoothingRate: 15,
      });
      this.camPrevEye = { x: camSolve.eyeX, y: camSolve.eyeY, z: camSolve.eyeZ };
      this.camera.radius = camSolve.effectiveRadius;
      const desiredEyeY = targetY + Math.cos(camSolve.clampedBeta) * camSolve.effectiveRadius;
      const eyeFloor = this.getTerrainHeight(camSolve.eyeX, camSolve.eyeZ) + 0.72;
      if (eyeFloor > desiredEyeY + 0.08) {
        const dyFromTarget = eyeFloor - targetY;
        const cosB = Math.max(-0.85, Math.min(0.95, dyFromTarget / Math.max(0.5, camSolve.effectiveRadius)));
        const safeBeta = Math.acos(cosB);
        this.camera.beta = Math.min(camSolve.clampedBeta, Math.max(0.18, safeBeta));
      }

      // Sync peer location
      if (now - this.lastMoveSyncTime > 120) {
        this.lastMoveSyncTime = now;
        this.callbacks.onHeroMoveSync(this.heroX, this.heroZ, this.heroRotY, this.heroAction);
      }

      // Check nearby NPC
      let closestNpc: NpcDef | null = null;
      let closestNpcDist = 6.5;
      for (const npc of this.activeNpcs) {
        const d = Math.hypot(npc.def.x - this.heroX, npc.def.z - this.heroZ);
        if (d < closestNpcDist) {
          closestNpcDist = d;
          closestNpc = npc.def;
        }
      }
      if ((closestNpc?.id || null) !== this.lastNearbyNpcId) {
        this.lastNearbyNpcId = closestNpc?.id || null;
        this.callbacks.onNearbyNpcChange?.(closestNpc);
      }
    } else {
      // Login / Character select frontal framing so hero + armor + wings remain 100% visible
      const titleY = this.getTerrainHeight(this.heroX, this.heroZ);
      this.heroRoot.position.set(this.heroX, titleY, this.heroZ);
      this.camera.target.set(this.heroX, titleY + 1.05, this.heroZ);
      this.camera.alpha = -Math.PI / 2 + Math.sin(now * 0.0004) * 0.35;
      this.camera.beta = 1.24;
      this.camera.radius = this.mode === 'character_select' ? 4.4 : 5.6;
    }

    this.flyff.update(dt, this.heroX, this.heroZ, this.heroAction === 'move', this.heroRotY, this.isInSafeCity());

    // Update Friendly Medieval Bots (soldiers, mages, elves, BKs patrolling the capital)
    for (const bot of this.friendlyBots) {
      if (bot.waitTimer > 0) {
        bot.waitTimer -= dt;
        continue;
      }
      const dx = bot.targetX - bot.x;
      const dz = bot.targetZ - bot.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        bot.waitTimer = 1.2 + Math.random() * 2.4;
        bot.targetX = bot.homeX + (Math.random() - 0.5) * 24;
        bot.targetZ = bot.homeZ + (Math.random() - 0.5) * 24;
        // Keep friendly bots inside safe city
        const tr = Math.hypot(bot.targetX, bot.targetZ);
        if (tr > this.currentMap.cityRadius - 8) {
          bot.targetX *= (this.currentMap.cityRadius - 10) / tr;
          bot.targetZ *= (this.currentMap.cityRadius - 10) / tr;
        }
      } else {
        bot.x += (dx / dist) * bot.speed * dt;
        bot.z += (dz / dist) * bot.speed * dt;
        bot.root.position.set(bot.x, Math.abs(Math.sin(now * 0.01 + bot.phase)) * 0.07, bot.z);
        bot.root.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Update Remote Multiplayer Peers
    for (const peer of this.remotePeers.values()) {
      peer.root.position.x += (peer.targetX - peer.root.position.x) * 0.18;
      peer.root.position.z += (peer.targetZ - peer.root.position.z) * 0.18;
      peer.root.position.y = this.getTerrainHeight(peer.root.position.x, peer.root.position.z);
      peer.root.rotation.y = peer.rotY;
      peer.content.update(
        dt,
        peer.root.position.x,
        peer.root.position.z,
        peer.action === 'move',
        0,
        this.isInSafeCity(peer.root.position.x, peer.root.position.z),
      );
    }

    // Update Nearby Monsters (Spatial Grid + ThinInstances + Active Combat)
    const nearbyIndices = this.updateNearbyMonsters(dt, now);

    // Update Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);

      let hit = false;
      for (const idx of nearbyIndices) {
        if (this.monAlive[idx] !== 1) continue;
        const dist = Math.hypot(this.monX[idx] - p.x, this.monZ[idx] - p.z);
        if (dist < 2.2) {
          this.damageMonsterAt(idx, p.damage, p.isCritical, p.isExcellent, p.colorHex ?? 0xfbbf24, p.freezeMs ?? 0);
          hit = true;
          break;
        }
      }

      if (hit || p.life <= 0) {
        p.mesh.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // Update Enemy Projectiles (Monster Powers)
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const ep = this.enemyProjectiles[i];
      ep.life -= dt;
      ep.x += ep.vx * dt;
      ep.z += ep.vz * dt;
      ep.mesh.position.set(ep.x, ep.y, ep.z);
      if (ep.life <= 0) {
        ep.mesh.dispose();
        this.enemyProjectiles.splice(i, 1);
      }
    }

    // Update Transient VFX
    for (let i = this.transientFx.length - 1; i >= 0; i--) {
      const fx = this.transientFx[i];
      fx.life -= dt;
      const t = 1 - fx.life / fx.maxLife;
      const s = 1 + t * fx.expandRate;
      fx.node.scaling.set(s, s, s);
      fx.node.rotation.y += fx.spinSpeed * dt;
      fx.node.position.y += fx.riseSpeed * dt;
      if (fx.life <= 0) {
        fx.node.dispose();
        this.transientFx.splice(i, 1);
      }
    }

    // Keep loot drops strictly seated on terrain ground (NO floating!)
    for (const d of this.lootDrops) {
      d.node.rotation.y += dt * 1.1;
      d.node.position.y = this.getTerrainHeight(d.x, d.z) + 0.01;
    }

    // Update Weather ThinInstances
    if (this.weatherMesh && this.weatherPositions && this.weatherMatrices) {
      const count = this.weatherPositions.length / 3;
      const fallSpeed = this.weatherKind === 'embers' ? -2.2 : this.weatherKind === 'underwater' ? -0.9 : 3.2;
      for (let i = 0; i < count; i++) {
        let wx = this.weatherPositions[i * 3];
        let wy = this.weatherPositions[i * 3 + 1] - fallSpeed * dt;
        let wz = this.weatherPositions[i * 3 + 2];
        if (wy < 0) wy = 19;
        if (wy > 20) wy = 1;
        this.weatherPositions[i * 3 + 1] = wy;

        const mat = Matrix.Translation(this.heroX + wx, this.getTerrainHeight(this.heroX,this.heroZ) + wy, this.heroZ + wz);
        mat.copyToArray(this.weatherMatrices, i * 16);
      }
      this.weatherMesh.thinInstanceBufferUpdated('matrix');
    }

    // Telemetry + 60% Auto-Aim Target Lock + Minimap snapshot (~4x/sec)
    if (now - this.lastTelemetryTime > 260) {
      this.lastTelemetryTime = now;
      this.callbacks.onWorldTelemetry?.({
        x: Math.round(this.heroX),
        z: Math.round(this.heroZ),
        inSafeCity: this.isInSafeCity(),
        totalMonsters: this.totalMonsters,
        nearbyMonsters: nearbyIndices.length,
        mapName: this.currentMap.name,
        areaKm2: this.currentMap.areaKm2,
      });

      if (this.callbacks.onMinimapUpdate) {
        const friends: MinimapEntitySnapshot['friends'] = [];
        for (const [id, peer] of this.remotePeers.entries()) {
          friends.push({ id, name: peer.name, x: peer.targetX, z: peer.targetZ });
        }
        const monsters: MinimapEntitySnapshot['monsters'] = [];
        const scan = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, 180);
        for (let k = 0; k < scan.length && monsters.length < 70; k++) {
          const idx = scan[k];
          if (this.monAlive[idx] !== 1) continue;
          const def = this.currentMap.monsters[this.monDefIdx[idx]];
          monsters.push({
            id: `m-${idx}`,
            x: this.monX[idx],
            z: this.monZ[idx],
            isBoss: Boolean(def?.isBoss),
          });
        }
        this.callbacks.onMinimapUpdate({
          mapId: this.currentMap.id,
          sizeMeters: this.currentMap.sizeMeters,
          hero: { x: this.heroX, z: this.heroZ },
          npcs: this.currentMap.npcs.map((n) => ({ id: n.id, name: n.name, x: n.x, z: n.z })),
          friends,
          monsters,
        });
      }

      const aim = this.autoAimAssist
        ? findAutoAimTarget(
            this.heroX,
            this.heroZ,
            this.heroRotY,
            18,
            this.getAutoAimCandidateList(18),
            AUTO_AIM_PROBABILITY,
          )
        : null;
      if (aim && !this.isInSafeCity()) {
        this.lockedTargetIdx = aim.targetIndex;
        const def = this.currentMap.monsters[this.monDefIdx[aim.targetIndex]];
        const heroLv = this.heroStatsSnapshot?.level ?? 1;
        const scaled = scaleMonsterForPlayerLevel(def, heroLv, this.getPlayerAvgAttackEstimate(), {
          minLevel: this.currentMap.minLevel,
          maxLevel: this.currentMap.maxLevel,
        }, this.currentMap.id);
        this.callbacks.onTargetMonsterChange?.({
          index: aim.targetIndex,
          stats: {
            ...scaled,
            hp: Math.round(this.monHp[aim.targetIndex]),
            maxHp: Math.round(this.monMaxHp[aim.targetIndex]),
          },
          currentHp: Math.round(this.monHp[aim.targetIndex]),
          dist: Number(aim.dist.toFixed(1)),
          autoAimPct: aim.coveragePct,
        });
      } else {
        this.lockedTargetIdx = -1;
        this.callbacks.onTargetMonsterChange?.(null);
      }
    }
  }

  greetNpc(id: string) {
    const npc = this.activeNpcs.find(entry => entry.def.id === id);
    if (!npc || Math.hypot(npc.def.x - this.heroX, npc.def.z - this.heroZ) > 6.5) return;
    const element: MonsterElement = npc.def.role === 'blacksmith' ? 'ember' :
      npc.def.role === 'wizard' ? 'storm' : npc.def.role === 'elf' ? 'venom' : 'light';
    const position = npc.root.position.add(new Vector3(0, 1.15, 0));
    this.addCreatureEffect(position, position, element, 'greeting');
    soundSynth.playCreatureSfx(element, 'greeting');
  }

  private addCreatureEffect(start: Vector3, target: Vector3, element: MonsterElement, style: Parameters<typeof creatureFx>[5]) {
    // Keep crowded encounters within the same effect budget as a few duels.
    if (this.transientFx.length >= 36) return;
    const node = creatureFx(this.scene, this.fxRoot, start, target, element, style);
    const life = style === 'bolt' ? .25 : style === 'cleave' ? .28 : .55;
    this.transientFx.push({
      node, life, maxLife: life, expandRate: style === 'bolt' ? 0 : .42,
      spinSpeed: style === 'bolt' || style === 'cleave' ? 0 : 2.4, riseSpeed: style === 'defeat' ? 1.3 : 0,
    });
  }

  private spawnMonsterPowerFx(mx: number, mz: number, power: MonsterPowerDef) {
    if (power.element && power.style) {
      const start = new Vector3(mx, this.getTerrainHeight(mx, mz) + .9, mz);
      const impact = new Vector3(this.heroX, this.getTerrainHeight(this.heroX, this.heroZ) + .88, this.heroZ);
      this.addCreatureEffect(start, impact, power.element, power.style);
      soundSynth.playCreatureSfx(power.element, 'power');
      return;
    }
    const colorHex = Number.parseInt(power.colorHex.replace('#', ''), 16) || 0xf97316;
    const my = this.getTerrainHeight(mx, mz) + 1.25;
    const dx = this.heroX - mx;
    const dz = this.heroZ - mz;
    const dist = Math.max(0.5, Math.hypot(dx, dz));

    const orbNode = new TransformNode(`monPower_${Date.now()}`, this.scene);
    orbNode.position.set(mx, my, mz);
    orbNode.rotation.y = Math.atan2(dx, dz);
    orbNode.parent = this.fxRoot;
    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/FlameStrike.glb', 'mon_pwr_glb', orbNode, {
        targetSize: 0.9,
        zUpOpenMu: true,
        seatOnGround: false,
        emissiveHex: colorHex,
        emissiveIntensity: 0.9,
      })
      .catch(() => {});

    this.enemyProjectiles.push({
      mesh: orbNode,
      x: mx,
      y: my,
      z: mz,
      vx: (dx / dist) * 16,
      vz: (dz / dist) * 16,
      life: Math.min(0.65, dist / 16 + 0.08),
    });

    const ringNode = new TransformNode(`monTelegraph_${Date.now()}`, this.scene);
    ringNode.position.set(this.heroX, this.getTerrainHeight(this.heroX, this.heroZ) + 0.06, this.heroZ);
    ringNode.parent = this.fxRoot;
    void this.assetManager
      .instantiateNormalizedModel('/openmu/effects/MoveTargetPosEffect.glb', 'mon_tele_glb', ringNode, {
        targetSize: 2.1,
        zUpOpenMu: true,
        seatOnGround: true,
        emissiveHex: colorHex,
        emissiveIntensity: 0.8,
      })
      .catch(() => {});
    this.transientFx.push({ node: ringNode, life: 0.45, maxLife: 0.45, expandRate: 0.9, spinSpeed: 4, riseSpeed: 0.05 });
  }

  private updateNearbyMonsters(dt: number, now: number): number[] {
    if (this.totalMonsters === 0) return [];
    const renderRadius = 96;
    const nearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, renderRadius);
    const heroInCity = this.isInSafeCity();
    const heroLv = this.heroStatsSnapshot?.level ?? 1;
    const mapRange = { minLevel: this.currentMap.minLevel, maxLevel: this.currentMap.maxLevel };
    const closestForHud: Array<{ idx: number; dist: number }> = [];

    for (const entry of this.thinMasterMeshes.values()) {
      entry.matrices.length = 0;
    }
    this.monShadowMatrices.length = 0;

    for (let k = 0; k < nearby.length; k++) {
      const idx = nearby[k];
      if (this.monAlive[idx] === 0) {
        this.monRespawn[idx] -= dt;
        if (this.monRespawn[idx] <= 0) {
          this.monAlive[idx] = 1;
          const def = this.currentMap.monsters[this.monDefIdx[idx]];
          const scaled = scaleMonsterForPlayerLevel(def, heroLv, this.getPlayerAvgAttackEstimate(), mapRange, this.currentMap.id);
          this.monMaxHp[idx] = scaled.maxHp;
          this.monHp[idx] = scaled.maxHp;
          this.monDmg[idx] = scaled.damage;
          this.monLevel[idx] = scaled.scaledLevel;
          this.monXp[idx] = scaled.xp;
          this.monZen[idx] = scaled.zen;
          this.monX[idx] = this.monHomeX[idx];
          this.monZ[idx] = this.monHomeZ[idx];
        }
        continue;
      }

      let mx = this.monX[idx];
      let mz = this.monZ[idx];
      const dx = this.heroX - mx;
      const dz = this.heroZ - mz;
      const distToHero = Math.hypot(dx, dz);

      if (distToHero < 28) {
        closestForHud.push({ idx, dist: distToHero });
      }

      if (this.monAttackCd[idx] > 0) this.monAttackCd[idx] -= dt;
      if (this.monPowerCd[idx] > 0) this.monPowerCd[idx] -= dt;
      if (this.monStrikeAnim[idx] > 0) this.monStrikeAnim[idx] = Math.max(0, this.monStrikeAnim[idx] - dt);

      const isFrozen = now < (this.monFrozenUntil[idx] ?? 0);
      let rotY = 0;
      let isMovingMon = false;
      const leashR = this.monLeash[idx] || 3.0;
      const campX = this.monCampX[idx];
      const campZ = this.monCampZ[idx];

      if (!isFrozen && this.mode === 'playing' && !heroInCity && distToHero < 22 && distToHero > 2.15) {
        const moveX = mx + (dx / distToHero) * 3.8 * dt;
        const moveZ = mz + (dz / distToHero) * 3.8 * dt;
        const withinCamp = Math.hypot(moveX - campX, moveZ - campZ) <= leashR;
        // STRICT CITY & 3m CAMP BARRIER: Monsters stay outside cities AND inside their 3m camp radius!
        if (withinCamp && !this.isInSafeCity(moveX, moveZ) && this.flyff.canMove(moveX, moveZ, mx, mz)) {
          mx = moveX;
          mz = moveZ;
          this.monX[idx] = mx;
          this.monZ[idx] = mz;
          isMovingMon = true;
        }
        rotY = Math.atan2(dx, dz);
      } else if (!isFrozen) {
        rotY = Math.sin(now * 0.001 + idx) * 1.1;
      }

      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      // Monster Special Powers, Melee & Critical Attacks (skipped while frozen)
      if (!isFrozen && this.mode === 'playing' && !heroInCity) {
        const scaled = scaleMonsterForPlayerLevel(def, heroLv, this.getPlayerAvgAttackEstimate(), mapRange, this.currentMap.id);
        const power = scaled.powers[0];
        if (distToHero <= (power ? Math.max(power.range, 2.7) : 2.7) && this.monAttackCd[idx] <= 0 && this.monPowerCd[idx] <= 0) {
          const rolled = rollMonsterAttack(scaled);
          if (rolled.isPower && power) {
            this.monPowerCd[idx] = power.cooldownSec;
            this.monAttackCd[idx] = 1.4;
            this.monStrikeAnim[idx] = 0.34;
            this.spawnMonsterPowerFx(mx, mz, power);
            this.flyff.hurt(rolled.damage);
            this.callbacks.onPlayerDamaged(rolled.damage, false);
            this.callbacks.onMonsterPowerHit?.(power, rolled.damage);
            if ((this.activeEffectBonuses.reflectBonusPct ?? 0) > 0) {
              const reflected = Math.max(2, Math.round((rolled.damage * (this.activeEffectBonuses.reflectBonusPct ?? 0)) / 100));
              this.damageMonsterAt(idx, reflected, false, false, 0xf43f5e, 0);
            }
          } else if (distToHero <= 2.75) {
            this.monAttackCd[idx] = 1.55;
            this.monStrikeAnim[idx] = 0.28;
            if (power?.element) soundSynth.playCreatureSfx(power.element, 'strike');
            this.flyff.hurt(rolled.damage);
            this.callbacks.onPlayerDamaged(rolled.damage, rolled.isCrit);
            if ((this.activeEffectBonuses.reflectBonusPct ?? 0) > 0) {
              const reflected = Math.max(2, Math.round((rolled.damage * (this.activeEffectBonuses.reflectBonusPct ?? 0)) / 100));
              this.damageMonsterAt(idx, reflected, false, false, 0xf43f5e, 0);
            }
            if (rolled.isCrit) {
              const hy = this.getTerrainHeight(this.heroX, this.heroZ) + 2.2;
              this.emitDamageNumber(new Vector3(this.heroX, hy, this.heroZ), `CRIT -${rolled.damage}!`, '#ef4444', true);
              this.callbacks.onFloatingText(`CRIT ${def.name}: -${rolled.damage}`, '#ef4444');
            }
          }
        }
      }

      const glb = def.speciesId || ARCHETYPE_TO_GLB[def.archetype] || 'mon_bull.glb';
      const bucket = this.thinMasterMeshes.get(glb);
      if (bucket) {
        const my = this.getTerrainHeight(mx, mz);
        const baseScale = def.isBoss ? 1.45 : 1.05;
        const strikeT = this.monStrikeAnim[idx] / 0.34;
        const strikeLunge = strikeT > 0 ? Math.sin(strikeT * Math.PI) : 0;
        const phase = isFrozen ? idx : now * (isMovingMon ? 0.011 : 0.0032) + idx * 0.7;
        const bobY = isFrozen ? 0 : isMovingMon ? Math.abs(Math.sin(phase)) * 0.14 : strikeLunge * 0.22;
        const breath = isFrozen ? 0 : isMovingMon ? 0 : Math.sin(phase) * 0.032;
        const pitch = isFrozen ? 0 : strikeLunge * 0.38 + (isMovingMon ? 0.09 : Math.sin(phase) * 0.03);
        const roll = isFrozen ? 0 : isMovingMon ? Math.sin(phase) * 0.06 : 0;
        const mat = Matrix.Compose(
          new Vector3(baseScale * (1 + breath), baseScale * (1 - breath * 0.75), baseScale * (1 + breath)),
          Quaternion.RotationYawPitchRoll(rotY, pitch, roll),
          new Vector3(mx, my + bobY, mz),
        );
        bucket.matrices.push(...mat.m);
        if (this.monShadowMesh) {
          const sScale = def.isBoss ? 1.5 : 1.05;
          const flatShadow = Matrix.Compose(
            new Vector3(sScale, sScale, 1),
            Quaternion.RotationYawPitchRoll(0, Math.PI / 2, 0),
            new Vector3(mx, my + 0.04, mz),
          );
          this.monShadowMatrices.push(...flatShadow.m);
        }
      }
    }

    // Update 3D overhead HP/level bars for up to 10 closest living monsters
    closestForHud.sort((a, b) => a.dist - b.dist);
    for (let sIdx = 0; sIdx < this.activeMonsterSlots.length; sIdx++) {
      const slot = this.activeMonsterSlots[sIdx];
      const item = closestForHud[sIdx];
      if (!item) {
        slot.poolIdx = -1;
        slot.root.setEnabled(false);
        continue;
      }
      const idx = item.idx;
      slot.poolIdx = idx;
      slot.root.setEnabled(true);
      const mx = this.monX[idx];
      const mz = this.monZ[idx];
      const my = this.getTerrainHeight(mx, mz);
      slot.root.position.set(mx, my, mz);

      const ratio = Math.max(0.02, Math.min(1, this.monHp[idx] / Math.max(1, this.monMaxHp[idx])));
      slot.hpBarFill.scaling.x = ratio;
      slot.hpBarFill.position.x = -(1 - ratio) * 0.91;
      if (slot.hitFlash > 0) {
        slot.hitFlash -= dt;
        slot.hpFillMat.emissiveColor.set(1, 0.85, 0.25);
      } else {
        slot.hpFillMat.emissiveColor.set(idx === this.lockedTargetIdx ? 1 : 0.9, idx === this.lockedTargetIdx ? 0.6 : 0.2, 0.2);
      }

      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      const label = `Nv.${this.monLevel[idx]} ${def?.name || 'Monstruo'}`;
      if (slot.lastLabel !== label) {
        slot.lastLabel = label;
        const ctx = slot.plateTex.getContext() as unknown as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, 384, 64);
        ctx.fillStyle = 'rgba(10, 14, 24, 0.78)';
        ctx.fillRect(8, 8, 368, 48);
        ctx.font = 'bold 24px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = def?.isBoss ? '#fbbf24' : '#f8fafc';
        ctx.fillText(label.slice(0, 22), 192, 32);
        slot.plateTex.update();
      }
    }

    // Update 80% Auto-Aim Target Lock Ring
    if (this.autoAimRing) {
      if (this.lockedTargetIdx >= 0 && this.monAlive[this.lockedTargetIdx] === 1 && !heroInCity) {
        const tx = this.monX[this.lockedTargetIdx];
        const tz = this.monZ[this.lockedTargetIdx];
        this.autoAimRing.setEnabled(true);
        this.autoAimRing.position.set(tx, this.getTerrainHeight(tx, tz) + 0.14, tz);
        this.autoAimRing.rotation.y += dt * 3.5;
      } else {
        this.autoAimRing.setEnabled(false);
      }
    }

    for (const entry of this.thinMasterMeshes.values()) {
      if (entry.matrices.length === 0) {
        entry.mesh.thinInstanceCount = 0;
        entry.mesh.setEnabled(false);
      } else {
        entry.mesh.thinInstanceSetBuffer('matrix', new Float32Array(entry.matrices), 16, false);
        entry.mesh.thinInstanceCount = entry.matrices.length / 16;
        entry.mesh.setEnabled(true);
      }
    }
    if (this.monShadowMesh) {
      if (this.monShadowMatrices.length === 0) {
        this.monShadowMesh.thinInstanceCount = 0;
      } else {
        this.monShadowMesh.thinInstanceSetBuffer('matrix', new Float32Array(this.monShadowMatrices), 16, false);
        this.monShadowMesh.thinInstanceCount = this.monShadowMatrices.length / 16;
      }
    }

    return nearby;
  }

  private disposeChildren(node: TransformNode) {
    const children = node.getChildren();
    for (const ch of children) {
      ch.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    this.loadSeq++;
    this.flyff.dispose();
    for (const peer of this.remotePeers.values()) peer.content.dispose();
    this.remotePeers.clear();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    this.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.assetManager.dispose();
    this.scene.dispose();
    this.engine.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
