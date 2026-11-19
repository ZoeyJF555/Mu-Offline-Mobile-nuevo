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
  MonsterArchetype,
  MuCharacter,
  MuItem,
  MuMapConfig,
  NpcDef,
  RoomPeer,
  SkillDef,
  WeatherKind,
} from '../types/game';
import { FlyffContent } from './FlyffContent';
import { getStarterItemsForMuClass } from '../data/muSkillsAndClasses';
import { MuAssetManager } from './MuAssetManager';
import { soundSynth } from './soundSynth';

export type EngineCameraMode = 'title' | 'character_select' | 'playing';

export interface LootDrop {
  id: string;
  kind: 'zen' | 'bless' | 'soul' | 'chaos' | 'life';
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
  mesh: Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  isCritical: boolean;
  isExcellent: boolean;
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
  hitFlash: number;
  attackCooldown: number;
  archetype: MonsterArchetype;
}

export interface EngineCallbacks {
  onEquipmentWear?: (slot: string, durability: number) => void;
  onKillMonster: (xp: number, zen: number, isBoss: boolean) => void;
  onPickupLoot: (drop: { kind: LootDrop['kind']; label: string; amount: number }) => void;
  onPlayerDamaged: (amount: number) => void;
  onHeroMoveSync: (x: number, z: number, rotY: number, action: 'idle' | 'move' | 'attack' | 'skill') => void;
  onBossHitInEvent: (damage: number) => void;
  onFloatingText: (text: string, color: string) => void;
  onDamageNumber?: (dmg: FloatingDamageNumber) => void;
  onNearbyNpcChange?: (npc: NpcDef | null) => void;
  onOpenNpc?: (npc: NpcDef) => void;
  onFpsUpdate?: (fps: number) => void;
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
  const tex = new DynamicTexture(`groundTex_${theme}`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();

  const r = (tintHex >> 16) & 255;
  const g = (tintHex >> 8) & 255;
  const b = tintHex & 255;

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  if (theme === 'cobble' || theme === 'dungeon' || theme === 'arena' || theme === 'tower' || theme === 'kanturu') {
    const step = 64;
    for (let y = 0; y < size; y += step) {
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      for (let x = -step; x < size + step; x += step) {
        const delta = ((x * 13 + y * 29) % 20) - 10;
        ctx.fillStyle = `rgb(${Math.max(12, Math.min(245, r + delta))}, ${Math.max(12, Math.min(245, g + delta))}, ${Math.max(12, Math.min(245, b + delta + 4))})`;
        ctx.fillRect(x + offset + 3, y + 3, step - 6, step - 6);
        ctx.strokeStyle = 'rgba(255, 220, 160, 0.08)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + offset + 4, y + 4, step - 8, step - 8);
      }
    }
  } else if (theme === 'vulcanus') {
    for (let i = 0; i < 180; i++) {
      const x = (i * 97) % size;
      const y = (i * 53) % size;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(249, 115, 22, 0.35)' : 'rgba(15, 6, 6, 0.45)';
      ctx.fillRect(x, y, 26, 7);
    }
  } else if (theme === 'snow' || theme === 'raklion') {
    for (let i = 0; i < 320; i++) {
      const x = (i * 71) % size;
      const y = (i * 113) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.22)' : 'rgba(147, 197, 253, 0.16)';
      ctx.fillRect(x, y, 18, 10);
    }
  } else if (theme === 'underwater') {
    for (let i = 0; i < 220; i++) {
      const x = (i * 83) % size;
      const y = (i * 47) % size;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(94, 234, 212, 0.14)' : 'rgba(8, 51, 68, 0.25)';
      ctx.beginPath();
      ctx.arc(x, y, 14 + (i % 10), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 480; i++) {
      const x = (i * 67) % size;
      const y = (i * 127) % size;
      ctx.fillStyle = theme === 'sand' ? 'rgba(253, 224, 71, 0.12)' : 'rgba(134, 239, 172, 0.09)';
      ctx.fillRect(x, y, 9, 9);
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
  private assetManager: MuAssetManager;

  private flyff: FlyffContent;
  private heroSex: 'male' | 'female' = 'male';
  private callbacks: EngineCallbacks;
  private mode: EngineCameraMode = 'title';
  private currentMap: MuMapConfig = getMapById('lorencia');
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
  private heroWingsNode: TransformNode | null = null;
  private heroX = 0;
  private heroZ = 8;
  private heroRotY = Math.PI;
  private heroAction: 'idle' | 'move' | 'attack' | 'skill' = 'idle';
  private attackSwingTimer = 0;

  private activeNpcs: ActiveNpc[] = [];
  private friendlyBots: FriendlyBot[] = [];
  private lootDrops: LootDrop[] = [];
  private projectiles: ProjectileFx[] = [];
  private transientFx: TransientFx[] = [];
  private remotePeers = new Map<string, { root: TransformNode; content: FlyffContent; targetX: number; targetZ: number; rotY: number; action: RoomPeer['action'] }>();
  private loadingMap = false;
  private accessoryGeneration = 0;
  private heroAccessories: TransformNode[] = [];

  // --- Up to 50,000 Monster Spatial Simulation ---
  private totalMonsters = 0;
  private monX = new Float32Array(0);
  private monZ = new Float32Array(0);
  private monHomeX = new Float32Array(0);
  private monHomeZ = new Float32Array(0);
  private monHp = new Float32Array(0);
  private monMaxHp = new Float32Array(0);
  private monDmg = new Float32Array(0);
  private monXp = new Float32Array(0);
  private monZen = new Float32Array(0);
  private monRespawn = new Float32Array(0);
  private monAlive = new Uint8Array(0);
  private monLevel = new Uint16Array(0);
  private monDefIdx = new Uint8Array(0);
  private spatialGrid = new Map<number, number[]>();
  private thinMasterMeshes = new Map<string, { mesh: Mesh; matrices: number[] }>();
  private activeMonsterSlots: ActiveMonsterSlot[] = [];

  // Weather
  private weatherMesh: Mesh | null = null;
  private weatherPositions: Float32Array | null = null;
  private weatherMatrices: Float32Array | null = null;
  private weatherKind: WeatherKind = 'leaves';

  // Controls & Camera
  private keys = new Set<string>();
  private joystickVec = { x: 0, y: 0 };
  private free3dMode = false;
  private userBrightness = 1.08;
  private targetFps: 30 | 45 | 60 = 60;
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
    steps: [SkillDef, SkillDef, SkillDef] | null;
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
      Math.PI / 3.1,
      20,
      new Vector3(0, 1.5, 8),
      this.scene,
    );
    this.camera.lowerBetaLimit = 0.28;
    this.camera.upperBetaLimit = 1.42;
    this.camera.lowerRadiusLimit = 2.5;
    this.camera.upperRadiusLimit = 44;
    this.camera.wheelPrecision = 20;

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
    this.preloadAssetsAndStart().catch(this.flyff.onError);
  }

  private async preloadAssetsAndStart() {
    await this.assetManager.preloadCoreModels([
      'hero_dk.glb',
      'hero_dw.glb',
      'hero_elf.glb',
      'hero_dl.glb',
      'hero_mg.glb',
      'bot_soldier.glb',
      'npc_merchant.glb',
      'npc_goblin.glb',
      'weapon_sword.glb',
      'weapon_staff.glb',
      'weapon_bow.glb',
      'weapon_scepter.glb',
      'shield_dragon.glb',
      'wings_angel.glb',
      'house_medieval.glb',
      'tavern_baret.glb',
      'shop_smithy.glb',
      'city_wall.glb',
      'city_gate.glb',
      'fountain_plaza.glb',
    ]);
    await this.rebuildHeroModel();
    if (this.loadSeq === 0) await this.loadMap('lorencia', true);

    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt, now);
      this.scene.render();
    });
  }

  private bindInputListeners() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private handleResize = () => {
    this.engine.resize();
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName ?? '')) return;
    this.keys.add(e.code);
    if (e.code === 'KeyJ' && this.mode === 'playing') { e.preventDefault(); this.jump(); }
    if (e.code === 'KeyE' && this.mode === 'playing') {
      this.pickupNearestLoot();
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
      this.camera.detachControl();
    } else if (this.free3dMode) {
      this.camera.attachControl(this.canvas, true);
    }
  }

  setFree3dMode(enabled: boolean) {
    this.free3dMode = enabled;
    if (enabled && this.mode === 'playing') {
      this.camera.attachControl(this.canvas, true);
    } else {
      this.camera.detachControl();
    }
  }

  setBrightness(val: number) {
    this.userBrightness = val;
    this.hemiLight.intensity = 0.85 * val;
    this.sunLight.intensity = 1.25 * val;
  }

  setTargetFps(fps: 30 | 45 | 60) {
    this.targetFps = fps;
    this.engine.setHardwareScalingLevel(fps === 30 ? 1.35 : fps === 45 ? 1.15 : 1.0);
  }

  setJoystickVector(x: number, y: number) {
    this.joystickVec = { x, y };
  }

  setEventActive(_active: boolean, _eventType?: EventType) {
    // Event boss / wave indicator handled cleanly in HUD + combat
  }

  updateHeroStats(char: MuCharacter | null) {
    this.heroStatsSnapshot = char;
  }

  isInSafeCity(x = this.heroX, z = this.heroZ): boolean {
    return this.currentMap.assetWorld ? this.flyff.safe(x, z) : Math.hypot(x, z) < this.currentMap.cityRadius;
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
    this.heroClass = classType;this.heroSex = sex ?? this.heroStatsSnapshot?.sex ?? 'male';
    this.heroEquippedItems = equippedItems;
    try { await this.rebuildHeroModel(); } catch(error) { this.flyff.onError(error); throw error; }
  }

  private async rebuildHeroModel() {
    await this.flyff.character(this.heroClass, this.heroSex, this.heroEquippedItems, this.heroRoot);
    if (this.disposed) return;
    this.heroModelRoot = this.flyff.actor?.root ?? null;
    const generation = ++this.accessoryGeneration, actor = this.flyff.actor;
    this.heroAccessories.forEach(n => n.dispose()); this.heroAccessories = [];
    if (!actor) return;
    for (const [slot, file, scale] of [['wings', 'wings_angel.glb', 0.45]] as const) {
      if (!this.heroEquippedItems.some(i => i.slot === slot && i.isEquipped && (i.durability ?? 100) > 0)) continue;
      const accessory = await this.assetManager.instantiateModel(file, `hero_${slot}`, actor.root, { scale });
      if (generation !== this.accessoryGeneration || this.disposed || actor !== this.flyff.actor) { accessory.root.dispose(); return; }
      accessory.root.position.set(0, 1.02, 0.15);
      this.heroWingsNode = accessory.root;
      this.heroAccessories.push(accessory.root);
    }
  }

  async loadMap(mapId: MapId, resetHeroPosition = true) {
    const mySeq = ++this.loadSeq;
    this.loadingMap = true;
    this.keys.clear();this.joystickVec = {x:0,y:0};
    try {
    const mapCfg = getMapById(mapId);
    this.currentMap = mapCfg;
    this.flyff.clearWorld();
    this.totalMonsters = 0;

    soundSynth.playMapMusic(mapCfg.musicTheme, mapCfg.ambientBed);

    for (const peer of this.remotePeers.values()) { peer.content.dispose(); peer.root.dispose(); }
    this.remotePeers.clear();
    // Clear previous map nodes
    this.disposeChildren(this.worldRoot);
    this.disposeChildren(this.cityRoot);
    this.disposeChildren(this.floraRoot);
    this.disposeChildren(this.monsterRoot);
    this.disposeChildren(this.fxRoot);
    this.activeNpcs = [];
    this.friendlyBots = [];
    this.lootDrops = [];
    this.projectiles = [];
    this.transientFx = [];
    this.activeMonsterSlots = [];
    this.thinMasterMeshes.clear();
    this.spatialGrid.clear();

    if (this.weatherMesh) {
      this.weatherMesh.dispose();
      this.weatherMesh = null;
    }

    // Atmosphere & Lighting
    const horizon = Color3.FromHexString(`#${mapCfg.skyHorizonHex.toString(16).padStart(6, '0')}`);
    const fogColor = Color3.FromHexString(`#${mapCfg.fogHex.toString(16).padStart(6, '0')}`);
    this.scene.clearColor = new Color4(horizon.r * 0.45, horizon.g * 0.45, horizon.b * 0.45, 1);
    this.scene.fogColor = fogColor;
    this.scene.fogDensity = mapCfg.fogDensity;

    const ambColor = Color3.FromHexString(`#${mapCfg.ambientLightHex.toString(16).padStart(6, '0')}`);
    const sunColor = Color3.FromHexString(`#${mapCfg.sunLightHex.toString(16).padStart(6, '0')}`);
    this.hemiLight.diffuse = ambColor;
    this.hemiLight.groundColor = fogColor.scale(0.6);
    this.sunLight.diffuse = sunColor;
    this.setBrightness(this.userBrightness);

    if (mapCfg.assetWorld && mapCfg.spawn) {
      await this.flyff.loadWorld(mapCfg.spawn.x, mapCfg.spawn.z);
      if (mySeq !== this.loadSeq || this.disposed) return;
      if (resetHeroPosition) {
        this.heroX = mapCfg.spawn.x; this.heroZ = mapCfg.spawn.z;
        const spawnY = this.getTerrainHeight(this.heroX, this.heroZ);
        this.heroRoot.position.set(this.heroX, spawnY, this.heroZ);
        this.camera.target.set(this.heroX, spawnY + 1.6, this.heroZ);
      }
      for (const npcDef of mapCfg.npcs) {
        const inst = await this.assetManager.instantiateModel(npcDef.role === 'chaos_goblin' ? 'npc_goblin.glb' : 'npc_merchant.glb', `npc_${npcDef.id}`, this.cityRoot);
        if (mySeq !== this.loadSeq) { inst.root.dispose(); return; }
        inst.root.position.set(npcDef.x, this.getTerrainHeight(npcDef.x, npcDef.z), npcDef.z);
        const plate = createNameplatePlane(this.scene, npcDef.name, '#fde68a', 3.4);
        plate.parent = inst.root; plate.position.y = 2.75;
        this.activeNpcs.push({ def: npcDef, root: inst.root });
      }
      await this.populateMonsters(mapCfg, mySeq);
      if(mySeq === this.loadSeq) this.initWeatherParticles(mapCfg.weather);
      return;
    }

    // 1. Huge 1.00 - 1.60 km² Terrain Ground
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
    gMat.diffuseTexture = createGroundCanvasTexture(this.scene, mapCfg.groundTheme, mapCfg.groundTintHex, 44);
    gMat.specularColor = new Color3(0.08, 0.08, 0.08);
    ground.material = gMat;
    ground.parent = this.worldRoot;

    // 2. Central Capital City Plaza Floor (Cobblestone / Marble)
    const cityDisc = MeshBuilder.CreateDisc(
      `cityPlaza_${mapCfg.id}`,
      { radius: mapCfg.cityRadius, tessellation: 48 },
      this.scene,
    );
    cityDisc.rotation.x = Math.PI / 2;
    cityDisc.position.y = 0.04;
    const cMat = new StandardMaterial(`cityMat_${mapCfg.id}`, this.scene);
    cMat.diffuseTexture = createGroundCanvasTexture(this.scene, 'cobble', mapCfg.cityGroundTintHex, 14);
    cMat.specularColor = new Color3(0.12, 0.12, 0.12);
    cityDisc.material = cMat;
    cityDisc.parent = this.cityRoot;

    if (resetHeroPosition) {
      this.heroX = 0;
      this.heroZ = 8;
      this.heroRotY = Math.PI;
      this.heroRoot.position = new Vector3(0, 0, 8);
      this.camera.target.set(0, 1.6, 8);
    }

    // Build Capital City Medieval Architecture, NPCs, Bots, Outskirts Flora, and <= 50,000 Monsters
    await Promise.all([
      this.buildCapitalCity(mapCfg, mySeq),
      this.buildOutskirtsAndFlora(mapCfg, mySeq),
      this.populateMonsters(mapCfg, mySeq),
    ]);

    if (mySeq !== this.loadSeq) return;
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
    this.monHp = new Float32Array(count);
    this.monMaxHp = new Float32Array(count);
    this.monDmg = new Float32Array(count);
    this.monXp = new Float32Array(count);
    this.monZen = new Float32Array(count);
    this.monRespawn = new Float32Array(count);
    this.monAlive = new Uint8Array(count);
    this.monLevel = new Uint16Array(count);
    this.monDefIdx = new Uint8Array(count);
    this.spatialGrid.clear();

    const half = mapCfg.sizeMeters / 2 - 16;
    const minSafeDist = mapCfg.cityRadius + 14; // Strictly outside capital city!
    const defs = mapCfg.monsters;
    let seed = (mapCfg.worldIndex + 1) * 7919;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      // First 180 monsters cluster near the 4 city gates (just outside city walls) for immediate hunting action
      if (i < 180) {
        const angle = rand() * Math.PI * 2;
        const r = minSafeDist + 6 + rand() * 55;
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
      } else {
        for (let attempt = 0; attempt < 6; attempt++) {
          x = (rand() * 2 - 1) * half;
          z = (rand() * 2 - 1) * half;
          if (!this.isInSafeCity(x, z) && Math.hypot(x, z) >= minSafeDist) break;
        }
        if (Math.hypot(x, z) < minSafeDist) {
          const ang = rand() * Math.PI * 2;
          x = Math.cos(ang) * (minSafeDist + 20);
          z = Math.sin(ang) * (minSafeDist + 20);
        }
      }

      if (mapCfg.assetWorld && this.isInSafeCity(x, z)) {
        // Rejection sampling guarantees all three cities stay free of monsters.
        for (let attempt = 0; attempt < 100 && this.isInSafeCity(x, z); attempt++) { x=(rand()*2-1)*half;z=(rand()*2-1)*half; }
      }
      const defIdx = i % defs.length;
      const def = defs[defIdx];
      this.monX[i] = x;
      this.monZ[i] = z;
      this.monHomeX[i] = x;
      this.monHomeZ[i] = z;
      this.monHp[i] = def.hp;
      this.monMaxHp[i] = def.hp;
      this.monDmg[i] = def.damage;
      this.monXp[i] = def.xp;
      this.monZen[i] = def.zen;
      this.monAlive[i] = 1;
      this.monRespawn[i] = 0;
      this.monLevel[i] = def.level;
      this.monDefIdx[i] = defIdx;

      const key = this.cellKey(x, z);
      let bucket = this.spatialGrid.get(key);
      if (!bucket) {
        bucket = [];
        this.spatialGrid.set(key, bucket);
      }
      bucket.push(i);
    }

    // Prepare ThinInstance master meshes for every monster archetype in this map
    const uniqueGlbs = new Set<string>();
    for (const d of defs) {
      uniqueGlbs.add(ARCHETYPE_TO_GLB[d.archetype] || 'mon_bull.glb');
    }
    for (const glb of uniqueGlbs) {
      const master = await this.assetManager.getThinInstanceMaster(glb, `mon_${mapCfg.id}`);
      if (master && seq === this.loadSeq) {
        master.parent = this.monsterRoot;
        this.thinMasterMeshes.set(glb, { mesh: master, matrices: [] });
      }
    }
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
    const count = 280;
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

    const proto = MeshBuilder.CreateSphere('weatherProto', { diameter: 0.14, segments: 4 }, this.scene);
    const mat = new StandardMaterial('weatherMat', this.scene);
    mat.emissiveColor = Color3.FromHexString(`#${hex.toString(16).padStart(6, '0')}`);
    mat.disableLighting = true;
    proto.material = mat;
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

    const totalBase = (base + bonusStatPower * 0.6) * skill.damageMultiplier;
    const isExcellent = Math.random() < 0.16;
    const isCritical = !isExcellent && Math.random() < 0.24;
    const mult = isExcellent ? 1.55 : isCritical ? 1.32 : 0.92 + Math.random() * 0.18;
    return {
      damage: Math.max(12, Math.round(totalBase * mult)),
      isCritical,
      isExcellent,
    };
  }

  executeSkill(skill: SkillDef, _comboMultiplier = 1, bonusStatPower = 0) {
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

    this.heroAction = 'skill';
    this.attackSwingTimer = 0.38;
    this.flyff.cast(skill);

    const { damage, isCritical, isExcellent } = this.computeHeroDamage(skill, bonusStatPower);
    // Native effects are driven by the same accepted game skill. Damage remains authoritative here.

    if (skill.isBuff) {
      this.callbacks.onFloatingText(`+${skill.shortName} Activo`, '#4ade80');
      return;
    }

    // Ranged projectile skills
    if (
      skill.vfx === 'bolt' ||
      skill.vfx === 'arrow' ||
      skill.vfx === 'triple_shot' ||
      skill.vfx === 'ice_arrow' ||
      skill.vfx === 'fire_scream'
    ) {
      const count = skill.vfx === 'triple_shot' ? 3 : 1;
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 0.24;
        const ang = this.heroRotY + spread;
        const orb = MeshBuilder.CreateSphere('proj', { diameter: 0.42, segments: 8 }, this.scene);
        const mat = new StandardMaterial('projMat', this.scene);
        mat.emissiveColor = Color3.FromHexString(`#${skill.colorHex.toString(16).padStart(6, '0')}`);
        mat.disableLighting = true;
        orb.material = mat;
        orb.position = new Vector3(
          this.heroX + Math.sin(ang) * 1.1,
          this.getTerrainHeight(this.heroX, this.heroZ) + 1.4,
          this.heroZ + Math.cos(ang) * 1.1,
        );
        orb.parent = this.fxRoot;
        this.projectiles.push({
          mesh: orb,
          x: orb.position.x,
          y: orb.position.y,
          z: orb.position.z,
          vx: Math.sin(ang) * 28,
          vz: Math.cos(ang) * 28,
          life: 0.85,
          damage,
          isCritical,
          isExcellent,
        });
      }
      return;
    }

    // Melee / AoE instant area hit against nearby monsters
    const nearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, skill.range + 1.5);
    let hits = 0;
    for (const idx of nearby) {
      if (this.monAlive[idx] !== 1) continue;
      if (!skill.isAoe && hits >= 1) break;
      this.damageMonsterAt(idx, damage, isCritical, isExcellent);
      hits++;
      if (hits >= 14) break;
    }

    if (hits > 0) {
      this.callbacks.onBossHitInEvent(Math.round(damage * 0.7));
    }
  }

  executeComboChain(skills: [SkillDef, SkillDef, SkillDef], bonusStatPower = 0) {
    if (this.mode !== 'playing') return;
    if (this.isInSafeCity()) {
      this.callbacks.onFloatingText('Zona Segura de la Capital: Sal por las puertas para usar Combo', '#fbbf24');
      return;
    }
    this.comboState = { steps: skills, nextIndex: 0, timer: 0.01, bonusStatPower };
  }

  private spawnSkillVfx(skill: SkillDef) {
    const color = Color3.FromHexString(`#${skill.colorHex.toString(16).padStart(6, '0')}`);
    const hy = this.getTerrainHeight(this.heroX, this.heroZ);
    const node = new TransformNode(`vfx_${skill.id}_${Date.now()}`, this.scene);
    node.position = new Vector3(this.heroX, hy + 0.8, this.heroZ);
    node.parent = this.fxRoot;

    const ring = MeshBuilder.CreateTorus(
      'vfxRing',
      { diameter: skill.isAoe ? 3.2 : 1.8, thickness: 0.16, tessellation: 24 },
      this.scene,
    );
    const mat = new StandardMaterial('vfxMat', this.scene);
    mat.emissiveColor = color;
    mat.alpha = 0.85;
    mat.disableLighting = true;
    ring.material = mat;
    ring.parent = node;

    if (skill.vfx === 'hellfire' || skill.vfx === 'nova' || skill.vfx === 'evil_spirit' || skill.vfx === 'ice_storm') {
      const pillar = MeshBuilder.CreateCylinder('vfxPillar', { diameterTop: 2.8, diameterBottom: 0.8, height: 4.5, tessellation: 12 }, this.scene);
      const pMat = new StandardMaterial('vfxPMat', this.scene);
      pMat.emissiveColor = color;
      pMat.alpha = 0.45;
      pMat.disableLighting = true;
      pillar.material = pMat;
      pillar.position.y = 1.6;
      pillar.parent = node;
    }

    this.transientFx.push({
      node,
      life: 0.48,
      maxLife: 0.48,
      expandRate: skill.isAoe ? 5.2 : 2.2,
      spinSpeed: 8.5,
      riseSpeed: skill.vfx === 'ice_storm' ? -2.0 : 1.4,
    });
  }

  private damageMonsterAt(idx: number, damage: number, isCritical: boolean, isExcellent: boolean) {
    if (this.monAlive[idx] !== 1) return;
    this.monHp[idx] = Math.max(0, this.monHp[idx] - damage);
    this.flyff.impact(this.monX[idx], this.monZ[idx]);

    // Emit floating 3D -> 2D projected damage number
    const mx = this.monX[idx];
    const mz = this.monZ[idx];
    const my = this.getTerrainHeight(mx, mz) + 2.4;
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
      this.monRespawn[idx] = 10 + Math.random() * 8;
      const xp = this.monXp[idx];
      const zen = this.monZen[idx];
      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      soundSynth.playMonsterHit();
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
    if (this.lootDrops.length > 24) return;
    const roll = Math.random();
    let kind: LootDrop['kind'] = 'zen';
    let label = `${Math.round(zenAmount * 0.6)} Zen`;
    let amount = Math.round(zenAmount * 0.6);
    let colorHex = 0xfbbf24;

    if (roll < 0.08) {
      kind = 'bless';
      label = 'Jewel of Bless';
      amount = 1;
      colorHex = 0xf43f5e;
      soundSynth.playJewelDrop();
    } else if (roll < 0.15) {
      kind = 'soul';
      label = 'Jewel of Soul';
      amount = 1;
      colorHex = 0x38bdf8;
      soundSynth.playJewelDrop();
    } else if (roll < 0.19) {
      kind = 'chaos';
      label = 'Jewel of Chaos';
      amount = 1;
      colorHex = 0xf59e0b;
      soundSynth.playJewelDrop();
    } else if (roll < 0.22) {
      kind = 'life';
      label = 'Jewel of Life';
      amount = 1;
      colorHex = 0xc084fc;
      soundSynth.playJewelDrop();
    } else if (roll > 0.65) {
      return;
    }

    const node = new TransformNode(`loot_${Date.now()}`, this.scene);
    const y = this.getTerrainHeight(x, z);
    node.position = new Vector3(x, y + 0.45, z);
    node.parent = this.fxRoot;

    const gem = MeshBuilder.CreatePolyhedron('lootGem', { type: 1, size: 0.28 }, this.scene);
    const mat = new StandardMaterial('lootMat', this.scene);
    mat.emissiveColor = Color3.FromHexString(`#${colorHex.toString(16).padStart(6, '0')}`);
    mat.diffuseColor = mat.emissiveColor;
    gem.material = mat;
    gem.parent = node;

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

  pickupNearestLoot() {
    let bestIdx = -1;
    let bestDist = 8.5;
    for (let i = 0; i < this.lootDrops.length; i++) {
      const d = Math.hypot(this.lootDrops[i].x - this.heroX, this.lootDrops[i].z - this.heroZ);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const [drop] = this.lootDrops.splice(bestIdx, 1);
      drop.node.dispose();
      soundSynth.playTradeSync();
      this.callbacks.onPickupLoot({ kind: drop.kind, label: drop.label, amount: drop.amount });
    }
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
        entry = {root,content,targetX:p.x,targetZ:p.z,rotY:p.rotY,action:p.action};
        this.remotePeers.set(p.peerId,entry);
        const plate = createNameplatePlane(this.scene,p.name,'#38bdf8',2.8);plate.parent=root;plate.position.y=2.1;
      }
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

    // Combo chain stepper
    if (this.comboState.steps) {
      this.comboState.timer -= dt;
      if (this.comboState.timer <= 0) {
        const skill = this.comboState.steps[this.comboState.nextIndex];
        this.executeSkill(skill, 1.35, this.comboState.bonusStatPower);
        this.comboState.nextIndex += 1;
        if (this.comboState.nextIndex >= 3) {
          this.comboState.steps = null;
          this.callbacks.onFloatingText('¡COMBO x3!', '#38bdf8');
        } else {
          this.comboState.timer = 0.24;
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
        const nx = mx / Math.max(1, mag);
        const nz = mz / Math.max(1, mag);
        const speed = 13.5;
        const limit = this.currentMap.sizeMeters / 2 - 14;
        const nextX = Math.max(-limit, Math.min(limit, this.heroX + nx * speed * dt));
        const nextZ = Math.max(-limit, Math.min(limit, this.heroZ + nz * speed * dt));
        if (this.flyff.canMove(nextX, this.heroZ, this.heroX, this.heroZ, this.heroRoot.position.y + (this.flyff.actor?.root.position.y ?? 0))) this.heroX = nextX;
        if (this.flyff.canMove(this.heroX, nextZ, this.heroX, this.heroZ, this.heroRoot.position.y + (this.flyff.actor?.root.position.y ?? 0))) this.heroZ = nextZ;
        this.heroRotY = Math.atan2(nx, nz);
        if (this.attackSwingTimer <= 0) this.heroAction = 'move';
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

      if (this.heroWingsNode) {
        this.heroWingsNode.rotation.y = Math.sin(now * 0.008) * 0.14;
      }

      // Smooth chase camera when not in free 3D orbit
      if (!this.free3dMode) {
        this.camera.target = Vector3.Lerp(this.camera.target, new Vector3(this.heroX, hy + 1.6, this.heroZ), 0.14);
        this.camera.alpha += (-Math.PI / 2 - this.camera.alpha) * 0.05;
        this.camera.beta += (1.02 - this.camera.beta) * 0.05;
        this.camera.radius += (19 - this.camera.radius) * 0.08;
      } else {
        this.camera.target = Vector3.Lerp(this.camera.target, new Vector3(this.heroX, hy + 1.6, this.heroZ), 0.14);
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
      // Login / Character select cinematic orbit around Lorencia plaza
      const orbit = now * 0.00025;
      this.camera.target = new Vector3(this.heroX, this.getTerrainHeight(this.heroX,this.heroZ)+1.05, this.heroZ);
      this.camera.alpha = orbit;
      this.camera.beta = 1.1;
      this.camera.radius = this.mode === 'character_select' ? 4 : 15;
    }

    this.flyff.update(dt, this.heroX, this.heroZ, this.heroAction === 'move', this.heroRotY);

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
      peer.content.update(dt,peer.root.position.x,peer.root.position.z,peer.action==='move',0);
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
          this.damageMonsterAt(idx, p.damage, p.isCritical, p.isExcellent);
          hit = true;
          break;
        }
      }

      if (hit || p.life <= 0) {
        p.mesh.dispose();
        this.projectiles.splice(i, 1);
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

    // Rotate Loot Gems
    for (const d of this.lootDrops) {
      d.node.rotation.y += dt * 2.2;
      d.node.position.y = this.getTerrainHeight(d.x, d.z) + 0.45 + Math.sin(now * 0.005) * 0.12;
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

    // Telemetry callback to HUD (~4x/sec)
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
    }
  }

  private updateNearbyMonsters(dt: number, now: number): number[] {
    if (this.totalMonsters === 0) return [];
    const renderRadius = 96;
    const nearby = this.queryNearbyMonsterIndices(this.heroX, this.heroZ, renderRadius);
    const heroInCity = this.isInSafeCity();
    const minBarrierR = this.currentMap.cityRadius + 5;

    for (const entry of this.thinMasterMeshes.values()) {
      entry.matrices.length = 0;
    }

    for (let k = 0; k < nearby.length; k++) {
      const idx = nearby[k];
      if (this.monAlive[idx] === 0) {
        this.monRespawn[idx] -= dt;
        if (this.monRespawn[idx] <= 0) {
          this.monAlive[idx] = 1;
          this.monHp[idx] = this.monMaxHp[idx];
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

      let rotY = 0;
      if (this.mode === 'playing' && !heroInCity && distToHero < 26 && distToHero > 2.2) {
        const moveX = mx + (dx / distToHero) * 3.8 * dt;
        const moveZ = mz + (dz / distToHero) * 3.8 * dt;
        // STRICT CITY BARRIER: Monsters CANNOT enter the capital city!
        if ((this.currentMap.assetWorld ? !this.isInSafeCity(moveX, moveZ) : Math.hypot(moveX, moveZ) >= minBarrierR) && this.flyff.canMove(moveX, moveZ, mx, mz)) {
          mx = moveX;
          mz = moveZ;
          this.monX[idx] = mx;
          this.monZ[idx] = mz;
        }
        rotY = Math.atan2(dx, dz);
      } else {
        // Gentle idle patrol around home outside the city
        rotY = Math.sin(now * 0.001 + idx) * 1.2;
      }

      // Monster attacks hero when within melee range outside the safe city
      if (this.mode === 'playing' && !heroInCity && distToHero <= 2.6) {
        if (Math.random() < dt * 0.75) {
          const damage = Math.max(4, Math.round(this.monDmg[idx] * 0.85));
          this.flyff.hurt(damage);
          this.callbacks.onPlayerDamaged(damage);
        }
      }

      const def = this.currentMap.monsters[this.monDefIdx[idx]];
      const glb = ARCHETYPE_TO_GLB[def.archetype] || 'mon_bull.glb';
      const bucket = this.thinMasterMeshes.get(glb);
      if (bucket) {
        const my = this.getTerrainHeight(mx, mz);
        const s = def.isBoss ? 1.45 : 1.05;
        const mat = Matrix.Compose(
          new Vector3(s, s, s),
          Quaternion.RotationYawPitchRoll(rotY, 0, 0),
          new Vector3(mx, my, mz),
        );
        bucket.matrices.push(...mat.m);
      }
    }

    for (const entry of this.thinMasterMeshes.values()) {
      if (entry.matrices.length === 0) {
        entry.mesh.thinInstanceCount = 0;
      } else {
        entry.mesh.thinInstanceSetBuffer('matrix', new Float32Array(entry.matrices), 16, false);
        entry.mesh.thinInstanceCount = entry.matrices.length / 16;
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
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.assetManager.dispose();
    this.scene.dispose();
    this.engine.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
