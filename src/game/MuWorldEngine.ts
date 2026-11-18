import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getItemVisualSpec, getMapById } from '../data/muWorldData';
import type {
  EventType,
  GroundTheme,
  HeroClass,
  MapId,
  MonsterArchetype,
  MuItem,
  MuMapConfig,
  NpcDef,
  RoomPeer,
  SkillDef,
  WeatherKind,
} from '../types/game';
import { soundSynth } from './soundSynth';

const _vec3 = new THREE.Vector3();
const _vec3b = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export type EngineCameraMode = 'title' | 'character_select' | 'playing';

export interface LootDrop {
  id: string;
  kind: 'zen' | 'bless' | 'soul' | 'chaos' | 'life';
  label: string;
  amount: number;
  x: number;
  z: number;
  mesh: THREE.Group;
  spawnTime: number;
}

interface MonsterEntity {
  id: string;
  archetype: MonsterArchetype;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  damage: number;
  xpReward: number;
  zenReward: number;
  isBoss: boolean;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  attackCooldown: number;
  hitFlash: number;
  mesh: THREE.Group;
  hpBarFill: THREE.Mesh;
  alive: boolean;
  respawnTimer: number;
}

interface NpcEntity {
  def: NpcDef;
  mesh: THREE.Group;
}

interface Projectile {
  mesh: THREE.Mesh;
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
  mesh: THREE.Object3D;
  life: number;
  maxLife: number;
  expandRate: number;
  spinSpeed: number;
  riseSpeed: number;
}

export interface EngineCallbacks {
  onKillMonster: (xp: number, zen: number, isBoss: boolean) => void;
  onPickupLoot: (drop: { kind: LootDrop['kind']; label: string; amount: number }) => void;
  onPlayerDamaged: (amount: number) => void;
  onHeroMoveSync: (x: number, z: number, rotY: number, action: 'idle' | 'move' | 'attack' | 'skill') => void;
  onBossHitInEvent: (damage: number) => void;
  onFloatingText: (text: string, color: string) => void;
  onNearbyNpcChange?: (npc: NpcDef | null) => void;
  onOpenNpc?: (npc: NpcDef) => void;
  onFpsUpdate?: (fps: number) => void;
}

function createGroundTexture(theme: GroundTheme, tintHex: number, maxAniso: number): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const baseColor = new THREE.Color(tintHex);
  const r = Math.round(baseColor.r * 255);
  const g = Math.round(baseColor.g * 255);
  const b = Math.round(baseColor.b * 255);

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  if (theme === 'cobble' || theme === 'dungeon' || theme === 'arena' || theme === 'tower' || theme === 'kanturu') {
    const step = 64;
    for (let y = 0; y < size; y += step) {
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      for (let x = -step; x < size + step; x += step) {
        const delta = ((x * 13 + y * 29) % 20) - 10;
        ctx.fillStyle = `rgb(${Math.max(10, Math.min(245, r + delta))}, ${Math.max(10, Math.min(245, g + delta))}, ${Math.max(10, Math.min(245, b + delta + 4))})`;
        ctx.fillRect(x + offset + 3, y + 3, step - 6, step - 6);
        ctx.strokeStyle =
          theme === 'kanturu'
            ? 'rgba(56, 189, 248, 0.14)'
            : theme === 'tower'
              ? 'rgba(244, 63, 94, 0.12)'
              : 'rgba(255, 220, 160, 0.06)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + offset + 4, y + 4, step - 8, step - 8);
      }
    }
  } else if (theme === 'vulcanus') {
    // Basalt cracks + glowing magma veins
    for (let i = 0; i < 160; i++) {
      const x = (i * 97) % size;
      const y = (i * 53) % size;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(249, 115, 22, 0.35)' : 'rgba(15, 6, 6, 0.45)';
      ctx.fillRect(x, y, 24, 6);
    }
  } else if (theme === 'snow' || theme === 'raklion' || theme === 'cloud') {
    for (let i = 0; i < 320; i++) {
      const x = (i * 71) % size;
      const y = (i * 113) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(147, 197, 253, 0.14)';
      ctx.fillRect(x, y, 16, 10);
    }
  } else if (theme === 'underwater') {
    for (let i = 0; i < 220; i++) {
      const x = (i * 83) % size;
      const y = (i * 47) % size;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(94, 234, 212, 0.12)' : 'rgba(8, 51, 68, 0.25)';
      ctx.beginPath();
      ctx.arc(x, y, 14 + (i % 10), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Grass, Aida, Elbeland, Sand
    for (let i = 0; i < 500; i++) {
      const x = (i * 67) % size;
      const y = (i * 127) % size;
      ctx.fillStyle =
        theme === 'sand'
          ? 'rgba(253, 224, 71, 0.09)'
          : theme === 'aida'
            ? 'rgba(192, 132, 252, 0.1)'
            : 'rgba(134, 239, 172, 0.08)';
      ctx.fillRect(x, y, 8, 8);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = maxAniso;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createLabelSprite(text: string, color = '#fde68a'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 54;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
  ctx.fillRect(8, 8, 240, 38);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, 240, 38);
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text.slice(0, 22), 128, 28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.52, 1);
  return sprite;
}

export class MuWorldEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  private callbacks: EngineCallbacks;
  private mode: EngineCameraMode = 'title';
  private currentMap: MuMapConfig = getMapById('lorencia');
  private userBrightness = 1.08;

  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;

  private mapGroup = new THREE.Group();
  private weatherPoints: THREE.Points | null = null;
  private weatherPositions: Float32Array | null = null;
  private weatherKind: WeatherKind = 'leaves';
  private weatherCount = 0;

  private heroClass: HeroClass = 'DK';
  private heroGroup: THREE.Group;
  private heroWeaponPivot: THREE.Group | null = null;
  private heroWingsGroup: THREE.Group | null = null;
  private heroPetGroup: THREE.Group | null = null;
  private heroAuraMaterial: THREE.MeshBasicMaterial | null = null;
  private dlRavenGroup: THREE.Group | null = null;
  private shadowTex: THREE.CanvasTexture;

  private heroPos = new THREE.Vector3(0, 0, 6);
  private heroRotY = Math.PI;
  private heroAttackAnim = 0;
  private hitstopTimer = 0;
  private shakeIntensity = 0;

  private cameraYaw = Math.PI;
  private cameraPitch = 0.42;
  private cameraDist = 11.5;
  private free3dMode = false;
  private dragPointerId: number | null = null;
  private dragLastX = 0;
  private dragLastY = 0;
  private pointerDownPos = { x: 0, y: 0 };

  private targetFps: 30 | 45 | 60 = 60;
  private lastRenderMs = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  private keys = new Set<string>();
  private joyX = 0;
  private joyY = 0;
  private titleAngle = 0;

  private npcs: NpcEntity[] = [];
  private lastNearbyNpcId: string | null = null;
  private monsters: MonsterEntity[] = [];
  private lootDrops: LootDrop[] = [];
  private projectiles: Projectile[] = [];
  private transientFx: TransientFx[] = [];
  private remotePeers = new Map<string, THREE.Group>();
  private portalRing: THREE.Mesh | null = null;
  private brazierLights: THREE.PointLight[] = [];
  private eventBossMesh: THREE.Group | null = null;
  private eventActive = false;
  private lastSyncTime = 0;

  private equippedEnhance = 7;
  private equippedRarity: MuItem['rarity'] = 'excellent';
  private equippedSetColor = 0x991b1b;
  private equippedWingsName = 'Wings of Satan';
  private equippedPetName = 'Guardian Angel';
  private hasWings = true;
  private hasPet = true;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onBlurBound: () => void;
  private onResizeBound: () => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 960;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && !isMobile,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2),
    );
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1018);
    this.scene.fog = new THREE.FogExp2(0x0c1018, 0.013);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.2, 160);
    this.camera.position.set(0, 8, 16);

    this.shadowTex = createContactShadowTexture();
    this.setupLighting();
    this.scene.add(this.mapGroup);

    this.heroGroup = this.buildHeroModel('DK', 7, 'excellent', 0x991b1b, true, true);
    this.heroGroup.position.copy(this.heroPos);
    this.heroGroup.rotation.y = this.heroRotY;
    this.scene.add(this.heroGroup);

    this.loadMap('lorencia', false);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.onKeyDownBound = (e) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      this.keys.add(e.code);
      if (this.mode === 'playing' && e.code === 'KeyE') {
        this.pickupNearestLoot();
      }
    };

    this.onKeyUpBound = (e) => {
      this.keys.delete(e.code);
    };

    this.onBlurBound = () => {
      this.keys.clear();
      this.joyX = 0;
      this.joyY = 0;
      this.dragPointerId = null;
    };

    this.onResizeBound = () => {
      if (this.disposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    this.onPointerDownBound = (e: PointerEvent) => {
      if (this.mode !== 'playing') return;
      this.dragPointerId = e.pointerId;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    this.onPointerMoveBound = (e: PointerEvent) => {
      if (this.mode !== 'playing' || this.dragPointerId !== e.pointerId) return;
      const dx = e.clientX - this.dragLastX;
      const dy = e.clientY - this.dragLastY;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;

      this.cameraYaw -= dx * 0.007;
      if (this.free3dMode) {
        this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.006, 0.14, 1.18);
      } else {
        this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.003, 0.28, 0.72);
      }
    };

    this.onPointerUpBound = (e: PointerEvent) => {
      if (this.dragPointerId === e.pointerId) {
        this.dragPointerId = null;
        const movedDist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
        if (movedDist < 8 && this.mode === 'playing') {
          this.tryTapNpc(e.clientX, e.clientY);
        }
      }
    };

    this.onWheelBound = (e: WheelEvent) => {
      if (this.mode !== 'playing') return;
      this.cameraDist = THREE.MathUtils.clamp(this.cameraDist + e.deltaY * 0.01, 6.5, 20);
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('resize', this.onResizeBound);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);
    this.renderer.domElement.addEventListener('wheel', this.onWheelBound, { passive: true });

    this.clock.start();
    this.tick();
  }

  private tryTapNpc(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);

    for (const n of this.npcs) {
      const hits = this.raycaster.intersectObject(n.mesh, true);
      if (hits.length > 0) {
        this.callbacks.onOpenNpc?.(n.def);
        return;
      }
    }
  }

  public setBrightness(val: number) {
    this.userBrightness = THREE.MathUtils.clamp(val, 0.5, 1.7);
    this.renderer.toneMappingExposure = this.userBrightness * this.currentMap.ev;
  }

  public setFree3dMode(enabled: boolean) {
    this.free3dMode = enabled;
    if (!enabled) {
      this.cameraPitch = 0.42;
      this.cameraYaw = this.heroRotY;
    }
  }

  public setTargetFps(fps: 30 | 45 | 60) {
    this.targetFps = fps;
  }

  private setupLighting() {
    this.hemiLight = new THREE.HemisphereLight(0x88ade8, 0x261a12, 0.85);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffdfb0, 2.15);
    this.keyLight.position.set(16, 28, 14);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 70;
    const d = 24;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x4f7df3, 0.85);
    this.rimLight.position.set(-18, 12, -16);
    this.scene.add(this.rimLight);
  }

  public loadMap(mapId: MapId, resetHeroPos = true) {
    const cfg = getMapById(mapId);
    this.currentMap = cfg;

    // Clear previous map entities & props
    while (this.mapGroup.children.length > 0) {
      const child = this.mapGroup.children[0];
      this.mapGroup.remove(child);
    }
    for (const m of this.monsters) {
      this.scene.remove(m.mesh);
    }
    this.monsters = [];
    for (const n of this.npcs) {
      this.scene.remove(n.mesh);
    }
    this.npcs = [];
    this.lastNearbyNpcId = null;
    this.callbacks.onNearbyNpcChange?.(null);

    for (const d of this.lootDrops) {
      this.scene.remove(d.mesh);
    }
    this.lootDrops = [];
    this.brazierLights = [];
    this.portalRing = null;

    if (this.weatherPoints) {
      this.scene.remove(this.weatherPoints);
      this.weatherPoints.geometry.dispose();
      (this.weatherPoints.material as THREE.Material).dispose();
      this.weatherPoints = null;
      this.weatherPositions = null;
    }

    // Apply OpenMU lighting, sky, and fog
    this.scene.background = new THREE.Color(cfg.skyHorizonHex);
    this.scene.fog = new THREE.FogExp2(cfg.fogHex, cfg.fogDensity);
    this.renderer.toneMappingExposure = this.userBrightness * cfg.ev;

    this.hemiLight.color.setHex(cfg.ambientLightHex);
    this.hemiLight.groundColor.setHex(cfg.groundTintHex);
    this.keyLight.color.setHex(cfg.sunLightHex);
    this.rimLight.color.setHex(cfg.skyTopHex);

    // Build ground, safe-zone gate & map landmarks
    this.buildMapEnvironment(cfg);
    this.buildWeatherSystem(cfg.weather);
    this.spawnMapNpcs(cfg.npcs);
    this.spawnMapMonsters(cfg);

    if (resetHeroPos) {
      this.heroPos.set(0, 0, 7);
      this.heroRotY = Math.PI;
      this.cameraYaw = Math.PI;
      this.heroGroup.position.copy(this.heroPos);
      soundSynth.playWarp();
    }

    if (this.mode === 'playing') {
      soundSynth.playMapMusic(cfg.musicTheme, cfg.ambientBed);
    }
  }

  private buildMapEnvironment(cfg: MuMapConfig) {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const mapTex = createGroundTexture(cfg.groundTheme, cfg.groundTintHex, maxAniso);

    const outerGeo = new THREE.CircleGeometry(95, 42);
    outerGeo.rotateX(-Math.PI / 2);
    const outerFloor = new THREE.Mesh(
      outerGeo,
      new THREE.MeshStandardMaterial({
        color: cfg.id === 'icarus' ? 0x0b1630 : cfg.fogHex,
        roughness: 0.94,
        metalness: 0.05,
      }),
    );
    outerFloor.position.y = -0.06;
    outerFloor.receiveShadow = true;
    this.mapGroup.add(outerFloor);

    const courtGeo = new THREE.CylinderGeometry(28, 28.5, 0.16, 36);
    const court = new THREE.Mesh(
      courtGeo,
      new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.78, metalness: 0.12 }),
    );
    court.position.y = -0.08;
    court.receiveShadow = true;
    this.mapGroup.add(court);

    // Safe Zone Circle
    const ringGeo = new THREE.RingGeometry(4.8, 5.3, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const runeColor =
      cfg.id === 'devias' || cfg.id === 'raklion' || cfg.id === 'atlans'
        ? 0x38bdf8
        : cfg.id === 'noria' || cfg.id === 'aida'
          ? 0x34d399
          : cfg.id === 'vulcanus' || cfg.id === 'losttower'
            ? 0xf43f5e
            : 0xd97706;
    const runeRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshStandardMaterial({
        color: runeColor,
        emissive: runeColor,
        emissiveIntensity: 0.65,
        roughness: 0.25,
        metalness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    runeRing.position.set(0, 0.02, 7);
    this.mapGroup.add(runeRing);

    // North Portal Gate
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, -21);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: cfg.id === 'devias' || cfg.id === 'raklion' ? 0x94a3b8 : 0x333c4a,
      roughness: 0.8,
      metalness: 0.2,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: runeColor, roughness: 0.25, metalness: 0.9 });

    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 1.1), stoneMat);
    leftPillar.position.set(-2.3, 2.3, 0);
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 1.1), stoneMat);
    rightPillar.position.set(2.3, 2.3, 0);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.9, 1.3), stoneMat);
    arch.position.set(0, 4.8, 0);

    const portalTorus = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.14, 10, 32),
      new THREE.MeshStandardMaterial({
        color: runeColor,
        emissive: runeColor,
        emissiveIntensity: 1.5,
      }),
    );
    portalTorus.position.set(0, 2.4, 0);
    this.portalRing = portalTorus;
    gateGroup.add(leftPillar, rightPillar, arch, portalTorus);
    this.mapGroup.add(gateGroup);

    // 4 Safe-Zone Braziers / Crystals
    const brazierCoords = [
      [-8.5, 0.5],
      [8.5, 0.5],
      [-8.5, 13.5],
      [8.5, 13.5],
    ];
    brazierCoords.forEach(([bx, bz], idx) => {
      const brazier = new THREE.Group();
      brazier.position.set(bx, 0, bz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 1.1, 8), stoneMat);
      base.position.y = 0.55;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.35, 0.45, 8), trimMat);
      bowl.position.y = 1.25;
      const flame = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.36, 0),
        new THREE.MeshBasicMaterial({ color: runeColor }),
      );
      flame.position.y = 1.68;
      brazier.add(base, bowl, flame);
      this.mapGroup.add(brazier);

      if (idx < 2) {
        const pt = new THREE.PointLight(runeColor, 4.0, 16, 1.8);
        pt.position.set(bx, 2.1, bz);
        this.mapGroup.add(pt);
        this.brazierLights.push(pt);
      }
    });

    // Instanced Perimeter Environment Props tailored to map theme
    const count = 36;
    const isCrystalMap =
      cfg.groundTheme === 'snow' ||
      cfg.groundTheme === 'raklion' ||
      cfg.groundTheme === 'underwater' ||
      cfg.groundTheme === 'aida' ||
      cfg.groundTheme === 'kanturu' ||
      cfg.groundTheme === 'tower';

    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.38, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({
        color: isCrystalMap ? 0x334155 : 0x3b2a1e,
        roughness: 0.85,
      }),
      count,
    );

    const topGeo = isCrystalMap
      ? new THREE.OctahedronGeometry(1.15, 0)
      : new THREE.ConeGeometry(1.45, 3.6, 7);
    topGeo.translate(0, 3.3, 0);
    const topColor =
      cfg.groundTheme === 'snow' || cfg.groundTheme === 'raklion'
        ? 0xbae6fd
        : cfg.groundTheme === 'underwater'
          ? 0x2dd4bf
          : cfg.groundTheme === 'vulcanus'
            ? 0xf97316
            : cfg.groundTheme === 'aida'
              ? 0xa855f7
              : cfg.groundTheme === 'sand'
                ? 0xd97706
                : 0x1a332a;
    const tops = new THREE.InstancedMesh(
      topGeo,
      new THREE.MeshStandardMaterial({
        color: topColor,
        emissive: isCrystalMap || cfg.groundTheme === 'vulcanus' ? topColor : 0x000000,
        emissiveIntensity: isCrystalMap ? 0.35 : 0.1,
        roughness: 0.65,
      }),
      count,
    );

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.06;
      const radius = 30.5 + (i % 5) * 2.2;
      _dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      _dummy.rotation.y = i * 1.1;
      const s = 0.85 + (i % 4) * 0.14;
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      trunks.setMatrixAt(i, _dummy.matrix);
      tops.setMatrixAt(i, _dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    tops.computeBoundingSphere();
    this.mapGroup.add(trunks, tops);
  }

  private buildWeatherSystem(kind: WeatherKind) {
    this.weatherKind = kind;
    if (kind === 'none') return;

    const count = 180;
    this.weatherCount = count;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 44;
      positions[i * 3 + 1] = 0.4 + Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    this.weatherPositions = positions;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const color =
      kind === 'snowfall' || kind === 'snow'
        ? 0xf0f9ff
        : kind === 'petals'
          ? 0xf9a8d4
          : kind === 'leaves'
            ? 0xa3e635
            : kind === 'underwater'
              ? 0x99f6e4
              : kind === 'embers'
                ? 0xfb923c
                : kind === 'sandDust'
                  ? 0xfde68a
                  : 0x94a3b8;

    const mat = new THREE.PointsMaterial({
      color,
      size: kind === 'snowfall' ? 0.24 : kind === 'embers' ? 0.22 : 0.2,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });

    this.weatherPoints = new THREE.Points(geo, mat);
    this.scene.add(this.weatherPoints);
  }

  private spawnMapNpcs(npcDefs: NpcDef[]) {
    for (const def of npcDefs) {
      const g = new THREE.Group();
      g.position.set(def.x, 0, def.z);
      g.add(this.createShadowDisc(0.8));

      const robeMat = new THREE.MeshStandardMaterial({
        color: def.robeColor,
        roughness: 0.5,
        metalness: 0.35,
      });
      const accMat = new THREE.MeshStandardMaterial({
        color: def.accentColor,
        emissive: def.accentColor,
        emissiveIntensity: 0.45,
        metalness: 0.8,
        roughness: 0.2,
      });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6bfa0, roughness: 0.6 });

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.35, 8), robeMat);
      body.position.y = 0.68;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skinMat);
      head.position.y = 1.6;
      const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), accMat);
      halo.position.y = 2.15;

      const label = createLabelSprite(def.name, '#fde68a');
      label.position.y = 2.65;

      g.add(body, head, halo, label);
      this.scene.add(g);
      this.npcs.push({ def, mesh: g });
    }
  }

  private createShadowDisc(radius: number): THREE.Mesh {
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.025;
    return disc;
  }

  private buildHeroModel(
    classType: HeroClass,
    enhanceLevel: number,
    rarity: MuItem['rarity'],
    armorColorHex: number,
    withWings: boolean,
    withPet: boolean,
  ): THREE.Group {
    const group = new THREE.Group();
    group.add(this.createShadowDisc(0.95));

    const vis = getItemVisualSpec({ enhanceLevel, rarity }, armorColorHex);
    const metalness = Math.min(0.96, 0.45 + enhanceLevel * 0.038);
    const roughness = Math.max(0.14, 0.55 - enhanceLevel * 0.028);

    const armorMat = new THREE.MeshPhysicalMaterial({
      color: armorColorHex,
      metalness,
      roughness,
      emissive: vis.emissiveHex,
      emissiveIntensity: vis.emissiveIntensity * 0.5,
      clearcoat: enhanceLevel >= 7 ? 0.85 : 0.25,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: enhanceLevel >= 11 ? 0xfbbf24 : 0xf59e0b,
      emissive: enhanceLevel >= 11 ? 0xf59e0b : 0x000000,
      emissiveIntensity: enhanceLevel >= 11 ? 0.55 : 0,
      metalness: 0.9,
      roughness: 0.2,
    });
    const clothMat = new THREE.MeshStandardMaterial({
      color: classType === 'DL' ? 0x581c87 : 0x1e293b,
      metalness: 0.12,
      roughness: 0.8,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe6bfa0,
      roughness: 0.65,
      metalness: 0.02,
    });

    // +9..+15 & Excellent/Ancient ground aura disc
    if (enhanceLevel >= 7 || rarity !== 'normal') {
      this.heroAuraMaterial = new THREE.MeshBasicMaterial({
        color: vis.emissiveHex,
        transparent: true,
        opacity: enhanceLevel >= 13 ? 0.42 : 0.25,
        side: THREE.DoubleSide,
      });
      const auraRing = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.05, 28),
        this.heroAuraMaterial,
      );
      auraRing.rotation.x = -Math.PI / 2;
      auraRing.position.y = 0.04;
      group.add(auraRing);
    } else {
      this.heroAuraMaterial = null;
    }

    const legGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.82, 8);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.22, 0.41, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.22, 0.41, 0);
    rightLeg.castShadow = true;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.85, 0.44), armorMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.48), trimMat);
    belt.position.set(0, 0.88, 0);

    const pauldronGeo = new THREE.SphereGeometry(0.25, 10, 8);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.5, 1.58, 0);
    leftPauldron.scale.set(1.1, 0.85, 1.0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.5, 1.58, 0);
    rightPauldron.scale.set(1.1, 0.85, 1.0);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.set(0, 1.9, 0);
    group.add(leftLeg, rightLeg, torso, belt, leftPauldron, rightPauldron, head);

    if (classType === 'MG') {
      const hairMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4, metalness: 0.35 });
      for (let s = -1; s <= 1; s++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.36, 5), hairMat);
        spike.position.set(s * 0.14, 2.15, -0.02);
        spike.rotation.z = -s * 0.25;
        group.add(spike);
      }
    } else if (classType === 'DL') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.26, 6), trimMat);
      crown.position.set(0, 2.04, 0);
      const jewel = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.08, 0),
        new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x9333ea, emissiveIntensity: 1.2 }),
      );
      jewel.position.set(0, 2.14, 0.2);
      group.add(crown, jewel);
    } else {
      const helm = new THREE.Mesh(
        classType === 'DW' ? new THREE.ConeGeometry(0.32, 0.55, 8) : new THREE.CylinderGeometry(0.26, 0.27, 0.28, 10),
        armorMat,
      );
      helm.position.set(0, classType === 'DW' ? 2.18 : 1.98, 0);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.36), trimMat);
      crest.position.set(0, 2.15, -0.02);
      group.add(helm, crest);
    }

    const cape = new THREE.Mesh(
      new THREE.BoxGeometry(classType === 'DL' ? 1.05 : 0.68, classType === 'DL' ? 1.32 : 1.0, 0.05),
      clothMat,
    );
    cape.position.set(0, 1.12, -0.26);
    cape.rotation.x = 0.16;
    group.add(cape);

    if (classType === 'DL') {
      const raven = new THREE.Group();
      raven.position.set(-0.78, 2.15, 0.1);
      const rBody = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x1e1b4b, emissive: 0x4c1d95, emissiveIntensity: 0.6 }),
      );
      rBody.rotation.x = Math.PI / 3;
      const rWingL = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.16), trimMat);
      rWingL.position.set(-0.22, 0.06, 0);
      const rWingR = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.16), trimMat);
      rWingR.position.set(0.22, 0.06, 0);
      raven.add(rBody, rWingL, rWingR);
      group.add(raven);
      this.dlRavenGroup = raven;
    } else {
      this.dlRavenGroup = null;
    }

    // Lv1 / Lv2 / Lv3 Wings
    if (withWings && classType !== 'DL') {
      const wings = new THREE.Group();
      wings.position.set(0, 1.48, -0.24);
      const isLv3 =
        this.equippedWingsName.includes('Storm') ||
        this.equippedWingsName.includes('Space') ||
        this.equippedWingsName.includes('Illusion') ||
        this.equippedWingsName.includes('Hurricane');
      const wingScale = isLv3 ? 1.25 : 1.0;

      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.lineTo(0.95 * wingScale, 0.56 * wingScale);
      wingShape.lineTo(1.3 * wingScale, 0.15 * wingScale);
      wingShape.lineTo(0.82 * wingScale, -0.35 * wingScale);
      wingShape.lineTo(0.25 * wingScale, -0.25 * wingScale);
      wingShape.closePath();

      const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
        depth: 0.04,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2,
      });
      const wingColor =
        isLv3
          ? 0xfbbf24
          : classType === 'DK'
            ? 0xdc2626
            : classType === 'DW'
              ? 0x38bdf8
              : classType === 'ELF'
                ? 0x34d399
                : 0xa855f7;
      const wingMat = new THREE.MeshPhysicalMaterial({
        color: wingColor,
        emissive: wingColor,
        emissiveIntensity: isLv3 ? 0.72 : 0.45,
        metalness: 0.7,
        roughness: 0.2,
        transparent: true,
        opacity: 0.88,
      });
      const rightWing = new THREE.Mesh(wingGeo, wingMat);
      rightWing.position.set(0.12, 0, 0);
      rightWing.rotation.y = -0.32;
      const leftWing = new THREE.Mesh(wingGeo, wingMat);
      leftWing.position.set(-0.12, 0, 0);
      leftWing.scale.x = -1;
      leftWing.rotation.y = 0.32;
      wings.add(leftWing, rightWing);
      group.add(wings);
      this.heroWingsGroup = wings;
    } else {
      this.heroWingsGroup = null;
    }

    // Pet Companion (Angel / Imp / Fenrir)
    if (withPet) {
      const pet = new THREE.Group();
      pet.position.set(0.85, 1.95, 0.15);
      const isImp = this.equippedPetName.includes('Imp');
      const isFenrir = this.equippedPetName.includes('Fenrir');
      const petColor = isFenrir ? 0xfbbf24 : isImp ? 0xef4444 : 0xe0f2fe;
      const petBody = new THREE.Mesh(
        isFenrir ? new THREE.BoxGeometry(0.32, 0.22, 0.44) : new THREE.OctahedronGeometry(0.18, 0),
        new THREE.MeshStandardMaterial({
          color: petColor,
          emissive: petColor,
          emissiveIntensity: 0.85,
          metalness: 0.6,
          roughness: 0.2,
        }),
      );
      pet.add(petBody);
      group.add(pet);
      this.heroPetGroup = pet;
    } else {
      this.heroPetGroup = null;
    }

    // Weapon Pivot
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.54, 1.25, 0.18);
    const weaponGlowMat = new THREE.MeshStandardMaterial({
      color: enhanceLevel >= 9 ? 0xfbbf24 : 0xe2e8f0,
      emissive: vis.emissiveHex,
      emissiveIntensity: Math.max(0.35, vis.emissiveIntensity),
      metalness: 0.95,
      roughness: 0.14,
    });

    if (classType === 'DK' || classType === 'MG') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.05), weaponGlowMat);
      blade.position.set(0, 0.65, 0.35);
      blade.rotation.x = Math.PI / 3;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.1), trimMat);
      guard.position.set(0, 0.18, 0.12);
      guard.rotation.x = Math.PI / 3;
      weaponPivot.add(blade, guard);

      if (classType === 'MG') {
        const leftSword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.05), weaponGlowMat);
        leftSword.position.set(-0.54, 1.45, 0.45);
        leftSword.rotation.x = Math.PI / 3;
        group.add(leftSword);
      }
    } else if (classType === 'DW' || classType === 'DL') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 8), trimMat);
      shaft.position.set(0, 0.5, 0.25);
      shaft.rotation.x = Math.PI / 4;
      const orbColor = classType === 'DL' ? 0xa855f7 : 0x38bdf8;
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2, 0),
        new THREE.MeshStandardMaterial({
          color: orbColor,
          emissive: orbColor,
          emissiveIntensity: 1.4,
          metalness: 0.85,
          roughness: 0.1,
        }),
      );
      orb.position.set(0, 1.15, 0.82);
      weaponPivot.add(shaft, orb);
    } else {
      const bowCurve = new THREE.TorusGeometry(0.55, 0.045, 8, 16, Math.PI);
      const bow = new THREE.Mesh(bowCurve, weaponGlowMat);
      bow.rotation.z = -Math.PI / 2;
      bow.position.set(0, 0.25, 0.4);
      weaponPivot.add(bow);
    }

    group.add(weaponPivot);
    this.heroWeaponPivot = weaponPivot;

    return group;
  }

  public syncHeroAppearance(classType: HeroClass, equippedItems: MuItem[]) {
    this.heroClass = classType;
    const weapon = equippedItems.find((i) => i.slot === 'weapon' && i.isEquipped);
    const armor = equippedItems.find((i) => i.slot === 'armor' && i.isEquipped);
    const wings = equippedItems.find((i) => i.slot === 'wings' && i.isEquipped);
    const pet = equippedItems.find((i) => i.slot === 'pet' && i.isEquipped);

    this.equippedEnhance = weapon?.enhanceLevel ?? armor?.enhanceLevel ?? 6;
    this.equippedRarity = weapon?.rarity ?? armor?.rarity ?? 'normal';
    this.hasWings = Boolean(wings) || equippedItems.length === 0;
    this.equippedWingsName = wings?.name || '';
    this.hasPet = Boolean(pet);
    this.equippedPetName = pet?.name || 'Guardian Angel';

    if (armor?.setName.includes('Great Dragon')) this.equippedSetColor = 0xb91c1c;
    else if (armor?.setName.includes('Dragon')) this.equippedSetColor = 0x991b1b;
    else if (armor?.setName.includes('Grand Soul') || armor?.setName.includes('Legendary')) this.equippedSetColor = 0x1d4ed8;
    else if (armor?.setName.includes('Divine') || armor?.setName.includes('Guardian')) this.equippedSetColor = 0x047857;
    else if (armor?.setName.includes('Dark Master') || armor?.setName.includes('Dark Steel')) this.equippedSetColor = 0x4c1d95;
    else if (armor?.setName.includes('Volcano') || armor?.setName.includes('Hurricane')) this.equippedSetColor = 0x312e81;
    else {
      this.equippedSetColor =
        classType === 'DK'
          ? 0x991b1b
          : classType === 'DW'
            ? 0x1d4ed8
            : classType === 'ELF'
              ? 0x047857
              : classType === 'DL'
                ? 0x4c1d95
                : 0x312e81;
    }

    const prevPos = this.heroGroup.position.clone();
    const prevRot = this.heroGroup.rotation.y;
    this.scene.remove(this.heroGroup);
    this.heroGroup = this.buildHeroModel(
      this.heroClass,
      this.equippedEnhance,
      this.equippedRarity,
      this.equippedSetColor,
      this.hasWings,
      this.hasPet,
    );
    this.heroGroup.position.copy(prevPos);
    this.heroGroup.rotation.y = prevRot;
    this.scene.add(this.heroGroup);
  }

  public setMode(mode: EngineCameraMode) {
    this.mode = mode;
    if (mode === 'playing') {
      this.heroPos.set(0, 0, 7);
      this.heroRotY = Math.PI;
      this.cameraYaw = Math.PI;
      this.cameraPitch = 0.42;
      soundSynth.playMapMusic(this.currentMap.musicTheme, this.currentMap.ambientBed);
    } else if (mode === 'character_select') {
      this.heroPos.set(0, 0, 2);
      this.heroGroup.position.set(0, 0, 2);
      soundSynth.playMapMusic('login', 'none');
    } else {
      soundSynth.playMapMusic('login', 'none');
    }
  }

  public setJoystickVector(x: number, y: number) {
    this.joyX = x;
    this.joyY = y;
  }

  private buildMonsterMesh(
    archetype: MonsterArchetype,
    name: string,
    isBoss: boolean,
  ): { group: THREE.Group; hpBarFill: THREE.Mesh } {
    const g = new THREE.Group();
    const scale = isBoss ? 1.65 : archetype === 'gorgon' || archetype === 'golem' || archetype === 'balrog' ? 1.22 : 1.0;
    g.add(this.createShadowDisc(0.85 * scale));

    const bodyColor =
      isBoss
        ? 0x4c1d95
        : archetype === 'yeti' || archetype === 'ice_queen'
          ? 0x7dd3fc
          : archetype === 'skeleton'
            ? 0xcbd5e1
            : archetype === 'hydra'
              ? 0x0d9488
              : archetype === 'lava_giant' || archetype === 'balrog'
                ? 0x991b1b
                : archetype === 'mech'
                  ? 0x475569
                  : archetype === 'goblin'
                    ? 0x16a34a
                    : 0x3f6212;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: archetype === 'skeleton' ? 0.55 : 0.42,
      metalness: archetype === 'mech' || isBoss ? 0.72 : 0.25,
      emissive: isBoss ? 0x7e22ce : archetype === 'lava_giant' ? 0xdc2626 : 0x000000,
      emissiveIntensity: isBoss ? 0.45 : archetype === 'lava_giant' ? 0.35 : 0,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: isBoss ? 0xf59e0b : 0xef4444,
      emissive: isBoss ? 0xd97706 : 0x991b1b,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.7,
    });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.75 * scale, 0.9 * scale, 0.5 * scale), bodyMat);
    torso.position.y = 1.0 * scale;
    torso.castShadow = true;

    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 * scale, 0), bodyMat);
    head.position.y = 1.65 * scale;

    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.08 * scale, 0.42 * scale, 6), accentMat);
    hornL.position.set(-0.22 * scale, 1.92 * scale, 0);
    hornL.rotation.z = 0.35;
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.08 * scale, 0.42 * scale, 6), accentMat);
    hornR.position.set(0.22 * scale, 1.92 * scale, 0);
    hornR.rotation.z = -0.35;

    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.12 * scale, 1.1 * scale, 0.12 * scale), accentMat);
    weapon.position.set(0.55 * scale, 1.15 * scale, 0.25 * scale);
    weapon.rotation.x = 0.5;

    // Overhead HP Bar & Nameplate
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide }),
    );
    barBg.position.set(0, 2.25 * scale, 0);

    const hpBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 0.08),
      new THREE.MeshBasicMaterial({ color: isBoss ? 0xf59e0b : 0xef4444, side: THREE.DoubleSide }),
    );
    hpBarFill.position.set(0, 2.25 * scale, 0.01);

    const label = createLabelSprite(name, isBoss ? '#fbbf24' : '#f8fafc');
    label.position.y = 2.65 * scale;

    g.add(torso, head, hornL, hornR, weapon, barBg, hpBarFill, label);
    return { group: g, hpBarFill };
  }

  private spawnMapMonsters(cfg: MuMapConfig) {
    cfg.monsters.forEach((d, idx) => {
      const { group, hpBarFill } = this.buildMonsterMesh(d.archetype, d.name, Boolean(d.isBoss));
      group.position.set(d.x, 0, d.z);
      this.scene.add(group);
      this.monsters.push({
        id: `${cfg.id}-mob-${idx}`,
        archetype: d.archetype,
        name: d.name,
        level: d.level,
        hp: d.hp,
        maxHp: d.hp,
        damage: d.damage,
        xpReward: d.xp,
        zenReward: d.zen,
        isBoss: Boolean(d.isBoss),
        homeX: d.x,
        homeZ: d.z,
        x: d.x,
        z: d.z,
        attackCooldown: 1.2,
        hitFlash: 0,
        mesh: group,
        hpBarFill,
        alive: true,
        respawnTimer: 0,
      });
    });
  }

  public setEventActive(active: boolean, eventType?: EventType) {
    this.eventActive = active;
    if (active && !this.eventBossMesh) {
      const { group } = this.buildMonsterMesh('boss', 'Señor Kundun (Evento)', true);
      group.position.set(0, 0, -14);
      this.scene.add(group);
      this.eventBossMesh = group;
      this.callbacks.onFloatingText(
        `¡Evento iniciado: ${eventType === 'kundun_boss' ? 'Señor Kundun' : 'Blood Castle'}!`,
        '#fbbf24',
      );
    } else if (!active && this.eventBossMesh) {
      this.scene.remove(this.eventBossMesh);
      this.eventBossMesh = null;
    }
  }

  public syncRemotePeers(peers: RoomPeer[], localPeerId: string) {
    const activeIds = new Set<string>();
    for (const peer of peers) {
      if (peer.peerId === localPeerId) continue;
      activeIds.add(peer.peerId);
      let mesh = this.remotePeers.get(peer.peerId);
      if (!mesh) {
        const color =
          peer.classType === 'DK'
            ? 0xb91c1c
            : peer.classType === 'DW'
              ? 0x2563eb
              : peer.classType === 'ELF'
                ? 0x059669
                : peer.classType === 'DL'
                  ? 0x4c1d95
                  : 0x312e81;
        mesh = this.buildHeroModel(peer.classType, peer.enhanceLevel || 7, 'excellent', color, true, false);
        this.scene.add(mesh);
        this.remotePeers.set(peer.peerId, mesh);
      }
      mesh.position.set(peer.x, 0, peer.z);
      mesh.rotation.y = peer.rotY;
    }

    for (const [id, mesh] of this.remotePeers.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.remotePeers.delete(id);
      }
    }
  }

  public executeSkill(skill: SkillDef, comboStepMultiplier = 1, bonusStatPower = 0) {
    if (this.mode !== 'playing') return;
    this.heroAttackAnim = 0.28;

    const critRoll = Math.random();
    const isExcellent = critRoll < 0.18;
    const isCritical = !isExcellent && critRoll < 0.36;
    const critMult = isExcellent ? 1.45 : isCritical ? 1.25 : 1.0;

    const baseDmg =
      (56 + this.equippedEnhance * 8 + bonusStatPower) *
      skill.damageMultiplier *
      comboStepMultiplier *
      critMult;
    const dmg = Math.round(baseDmg);

    soundSynth.playSkillSfx(skill.vfx);

    if (skill.isBuff) {
      this.spawnPillarEffect(skill.colorHex, 1.4, 0.6);
      this.spawnRingEffect(skill.colorHex, 3.4, 0.45);
      this.callbacks.onFloatingText(`¡${skill.name}!`, '#4ade80');
      return;
    }

    // Distinct OpenMU VFX per skill.vfx type
    if (skill.vfx === 'evil_spirit' || skill.vfx === 'gigantic_storm') {
      for (let k = 0; k < 4; k++) {
        const angle = (k / 4) * Math.PI * 2;
        this.spawnOrbitFx(skill.colorHex, angle, skill.range * 0.55);
      }
      this.spawnRingEffect(skill.colorHex, skill.range, 0.42);
      this.hitEnemiesInRadius(skill.range, dmg, isCritical, isExcellent, comboStepMultiplier > 1);
    } else if (skill.vfx === 'nova' || skill.vfx === 'hellfire' || skill.vfx === 'rageful_blow' || skill.vfx === 'earthshake') {
      this.spawnPillarEffect(skill.colorHex, 2.2, 0.45);
      this.spawnRingEffect(skill.colorHex, skill.range, 0.45);
      this.shakeIntensity = 0.24;
      this.hitEnemiesInRadius(skill.range, dmg, isCritical, isExcellent, true);
    } else if (skill.vfx === 'ice_storm') {
      for (let i = 0; i < 6; i++) {
        this.spawnFallingShard(skill.colorHex, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }
      this.spawnRingEffect(skill.colorHex, skill.range, 0.4);
      this.hitEnemiesInRadius(skill.range, dmg, isCritical, isExcellent, comboStepMultiplier > 1);
    } else if (skill.vfx === 'twisting') {
      this.spawnSlashArc(skill.colorHex, skill.range * 0.85, Math.PI * 1.9);
      this.spawnRingEffect(0xfbbf24, skill.range * 0.7, 0.3);
      this.hitEnemiesInRadius(skill.range, dmg, isCritical, isExcellent, comboStepMultiplier > 1);
    } else if (skill.vfx === 'triple_shot' || skill.vfx === 'power_slash' || skill.vfx === 'fire_scream' || skill.vfx === 'fire_burst') {
      this.spawnRingEffect(skill.colorHex, 2.8, 0.25);
      for (let i = -2; i <= 2; i++) {
        this.spawnProjectile(skill.colorHex, dmg, i * 0.22, isCritical, isExcellent);
      }
    } else if (skill.vfx === 'bolt' || skill.vfx === 'arrow' || skill.vfx === 'ice_arrow' || skill.vfx === 'raven') {
      this.spawnProjectile(skill.colorHex, dmg, 0, isCritical, isExcellent);
    } else {
      // slash / death_stab
      this.spawnSlashArc(skill.colorHex, skill.range * 0.78, Math.PI * 0.95);
      this.hitEnemiesInRadius(skill.range, dmg, isCritical, isExcellent, comboStepMultiplier > 1);
    }

    this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'skill');
  }

  public executeComboChain(skills: [SkillDef, SkillDef, SkillDef], bonusStatPower = 0) {
    if (this.mode !== 'playing') return;
    this.executeSkill(skills[0], 1.15, bonusStatPower);
    window.setTimeout(() => {
      if (!this.disposed && this.mode === 'playing') {
        this.executeSkill(skills[1], 1.35, bonusStatPower);
      }
    }, 185);
    window.setTimeout(() => {
      if (!this.disposed && this.mode === 'playing') {
        soundSynth.playComboBurst();
        this.spawnRingEffect(0xfbbf24, 6.2, 0.48);
        this.executeSkill(skills[2], 1.85, bonusStatPower);
        this.hitstopTimer = 0.055;
        this.shakeIntensity = 0.36;
        this.callbacks.onFloatingText('¡COMBO x3 MU!', '#fbbf24');
      }
    }, 380);
  }

  private spawnSlashArc(colorHex: number, radius: number, thetaLen = Math.PI * 0.9) {
    const geo = new THREE.RingGeometry(radius * 0.52, radius, 22, 1, -thetaLen / 2, thetaLen);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 1.0, this.heroPos.z);
    mesh.rotation.y = this.heroRotY - Math.PI / 2;
    this.scene.add(mesh);
    this.transientFx.push({ mesh, life: 0.25, maxLife: 0.25, expandRate: 0.32, spinSpeed: 4, riseSpeed: 0 });
  }

  private spawnRingEffect(colorHex: number, radius: number, life: number) {
    const geo = new THREE.RingGeometry(radius * 0.35, radius * 0.92, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 0.22, this.heroPos.z);
    this.scene.add(mesh);
    this.transientFx.push({ mesh, life, maxLife: life, expandRate: 0.45, spinSpeed: 0, riseSpeed: 0 });
  }

  private spawnPillarEffect(colorHex: number, radius: number, life: number) {
    const geo = new THREE.CylinderGeometry(radius * 0.65, radius * 0.95, 4.2, 14, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 2.1, this.heroPos.z);
    this.scene.add(mesh);
    this.transientFx.push({ mesh, life, maxLife: life, expandRate: 0.3, spinSpeed: 5, riseSpeed: 1.5 });
  }

  private spawnOrbitFx(colorHex: number, angle: number, dist: number) {
    const geo = new THREE.OctahedronGeometry(0.32, 0);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      this.heroPos.x + Math.cos(angle) * dist,
      1.2,
      this.heroPos.z + Math.sin(angle) * dist,
    );
    this.scene.add(mesh);
    this.transientFx.push({ mesh, life: 0.45, maxLife: 0.45, expandRate: 0.2, spinSpeed: 10, riseSpeed: 1.2 });
  }

  private spawnFallingShard(colorHex: number, dx: number, dz: number) {
    const geo = new THREE.ConeGeometry(0.24, 1.1, 5);
    geo.rotateX(Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x + dx, 5.5, this.heroPos.z + dz);
    this.scene.add(mesh);
    this.transientFx.push({ mesh, life: 0.38, maxLife: 0.38, expandRate: 0, spinSpeed: 4, riseSpeed: -11 });
  }

  private spawnProjectile(
    color: number,
    damage: number,
    angleOffset = 0,
    isCritical = false,
    isExcellent = false,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    const dirAngle = this.heroRotY + angleOffset;
    const vx = Math.sin(dirAngle) * 20;
    const vz = Math.cos(dirAngle) * 20;
    mesh.position.set(
      this.heroPos.x + Math.sin(dirAngle) * 0.85,
      1.25,
      this.heroPos.z + Math.cos(dirAngle) * 0.85,
    );
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      x: mesh.position.x,
      y: 1.25,
      z: mesh.position.z,
      vx,
      vz,
      life: 0.95,
      damage,
      isCritical,
      isExcellent,
    });
  }

  private hitEnemiesInRadius(
    radius: number,
    damage: number,
    isCritical: boolean,
    isExcellent: boolean,
    heavy: boolean,
  ) {
    let hitAny = false;
    for (const mob of this.monsters) {
      if (!mob.alive) continue;
      const dist = Math.hypot(mob.x - this.heroPos.x, mob.z - this.heroPos.z);
      if (dist <= radius) {
        this.damageMonster(mob, damage, isCritical, isExcellent);
        hitAny = true;
      }
    }

    if (this.eventActive && this.eventBossMesh) {
      const distBoss = Math.hypot(
        this.eventBossMesh.position.x - this.heroPos.x,
        this.eventBossMesh.position.z - this.heroPos.z,
      );
      if (distBoss <= radius + 1.5) {
        this.callbacks.onBossHitInEvent(damage);
        this.callbacks.onFloatingText(`-${damage} Jefe`, '#f97316');
        hitAny = true;
      }
    }

    if (hitAny && heavy) {
      this.hitstopTimer = 0.04;
      this.shakeIntensity = 0.22;
    }
  }

  private damageMonster(mob: MonsterEntity, damage: number, isCritical: boolean, isExcellent: boolean) {
    mob.hp -= damage;
    mob.hitFlash = 0.16;
    soundSynth.playMonsterHit();

    const pct = Math.max(0.01, mob.hp / mob.maxHp);
    mob.hpBarFill.scale.x = pct;

    const label = isExcellent ? `¡Exc -${damage}!` : isCritical ? `¡Crit -${damage}!` : `-${damage}`;
    const color = isExcellent ? '#34d399' : isCritical ? '#38bdf8' : '#f8fafc';
    this.callbacks.onFloatingText(label, color);

    if (mob.hp <= 0) {
      mob.alive = false;
      mob.mesh.visible = false;
      mob.respawnTimer = mob.isBoss ? 12 : 6;
      this.callbacks.onKillMonster(mob.xpReward, mob.zenReward, mob.isBoss);
      this.spawnLootDrop(mob.x, mob.z, mob.zenReward);
    }
  }

  private spawnLootDrop(x: number, z: number, zenBase: number) {
    const roll = Math.random();
    const kind: LootDrop['kind'] =
      roll < 0.22
        ? 'bless'
        : roll < 0.42
          ? 'soul'
          : roll < 0.52
            ? 'chaos'
            : roll < 0.6
              ? 'life'
              : 'zen';
    const label =
      kind === 'bless'
        ? 'Jewel of Bless'
        : kind === 'soul'
          ? 'Jewel of Soul'
          : kind === 'chaos'
            ? 'Jewel of Chaos'
            : kind === 'life'
              ? 'Jewel of Life'
              : `Zen x${Math.max(1200, Math.round(zenBase * 0.5)).toLocaleString()}`;
    const amount = kind === 'zen' ? Math.max(1200, Math.round(zenBase * 0.5)) : 1;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(this.createShadowDisc(0.45));

    const color =
      kind === 'bless'
        ? 0xef4444
        : kind === 'soul'
          ? 0x3b82f6
          : kind === 'chaos'
            ? 0xf59e0b
            : kind === 'life'
              ? 0xa855f7
              : 0xfde047;
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.95,
        metalness: 0.85,
        roughness: 0.12,
      }),
    );
    crystal.position.y = 0.45;
    g.add(crystal);
    this.scene.add(g);

    soundSynth.playJewelDrop();
    this.lootDrops.push({
      id: `loot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      label,
      amount,
      x,
      z,
      mesh: g,
      spawnTime: performance.now(),
    });
  }

  public pickupNearestLoot() {
    let bestIdx = -1;
    let bestDist = 4.4;
    for (let i = 0; i < this.lootDrops.length; i++) {
      const d = Math.hypot(this.lootDrops[i].x - this.heroPos.x, this.lootDrops[i].z - this.heroPos.z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const drop = this.lootDrops.splice(bestIdx, 1)[0];
      this.scene.remove(drop.mesh);
      soundSynth.playJewelDrop();
      this.callbacks.onPickupLoot({ kind: drop.kind, label: drop.label, amount: drop.amount });
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const nowMs = performance.now();
    const minIntervalMs = this.targetFps < 60 ? 1000 / this.targetFps - 2 : 0;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
    } else {
      this.updateSimulation(dt, elapsed);
    }

    if (minIntervalMs === 0 || nowMs - this.lastRenderMs >= minIntervalMs) {
      this.lastRenderMs = nowMs;
      this.renderer.render(this.scene, this.camera);
      this.fpsFrames++;
    }

    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 1.0) {
      const measured = Math.round(this.fpsFrames / this.fpsAccum);
      this.callbacks.onFpsUpdate?.(measured);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateSimulation(dt: number, elapsed: number) {
    if (this.portalRing) {
      this.portalRing.rotation.z += dt * 1.4;
    }
    for (let i = 0; i < this.brazierLights.length; i++) {
      this.brazierLights[i].intensity = 4.0 + Math.sin(elapsed * 8 + i * 2) * 0.8;
    }
    if (this.heroWingsGroup) {
      this.heroWingsGroup.rotation.y = Math.sin(elapsed * 4.5) * 0.1;
    }
    if (this.heroPetGroup) {
      this.heroPetGroup.position.y = 1.95 + Math.sin(elapsed * 6) * 0.16;
      this.heroPetGroup.rotation.y += dt * 1.8;
    }
    if (this.dlRavenGroup) {
      this.dlRavenGroup.position.y = 2.15 + Math.sin(elapsed * 5.2) * 0.14;
    }
    if (this.heroAuraMaterial && this.equippedEnhance >= 9) {
      this.heroAuraMaterial.opacity = 0.28 + Math.sin(elapsed * 4.2) * 0.14;
    }

    // Weather particles update (zero allocations)
    if (this.weatherPoints && this.weatherPositions) {
      const pos = this.weatherPositions;
      const isRising = this.weatherKind === 'embers' || this.weatherKind === 'underwater';
      const isWindy = this.weatherKind === 'leaves' || this.weatherKind === 'sandDust' || this.weatherKind === 'petals';
      for (let i = 0; i < this.weatherCount; i++) {
        const idx = i * 3;
        if (isRising) {
          pos[idx + 1] += dt * (1.8 + (i % 3) * 0.4);
          if (pos[idx + 1] > 14) pos[idx + 1] = 0.2;
        } else {
          pos[idx + 1] -= dt * (this.weatherKind === 'snowfall' ? 2.4 : 1.7);
          if (pos[idx + 1] < 0.2) pos[idx + 1] = 14;
        }
        if (isWindy) {
          pos[idx] -= dt * 2.2;
          if (pos[idx] < -22) pos[idx] = 22;
        }
      }
      this.weatherPoints.geometry.attributes.position.needsUpdate = true;
    }

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.22;
      this.camera.position.set(
        Math.sin(this.titleAngle) * 14.5,
        7.0,
        Math.cos(this.titleAngle) * 14.5 + 4,
      );
      this.camera.lookAt(0, 1.8, 3);
      return;
    }

    if (this.mode === 'character_select') {
      this.titleAngle += dt * 0.45;
      this.heroGroup.rotation.y = Math.sin(this.titleAngle * 0.6) * 0.5;
      this.camera.position.set(0, 2.5, 6.2);
      this.camera.lookAt(0, 1.35, 2);
      return;
    }

    // Movement
    let inputX = this.joyX;
    let inputY = this.joyY;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) inputY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) inputY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) inputX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) inputX += 1;

    const len = Math.hypot(inputX, inputY);
    let moving = false;
    if (len > 0.08) {
      moving = true;
      const nx = inputX / Math.max(1, len);
      const ny = inputY / Math.max(1, len);

      const fwdX = Math.sin(this.cameraYaw);
      const fwdZ = Math.cos(this.cameraYaw);
      const rightX = -Math.cos(this.cameraYaw);
      const rightZ = Math.sin(this.cameraYaw);

      const worldMoveX = fwdX * -ny + rightX * nx;
      const worldMoveZ = fwdZ * -ny + rightZ * nx;

      const speed = 8.8;
      this.heroPos.x += worldMoveX * speed * dt;
      this.heroPos.z += worldMoveZ * speed * dt;

      const distCenter = Math.hypot(this.heroPos.x, this.heroPos.z);
      if (distCenter > 25.5) {
        this.heroPos.x *= 25.5 / distCenter;
        this.heroPos.z *= 25.5 / distCenter;
      }

      const targetYaw = Math.atan2(worldMoveX, worldMoveZ);
      let diff = targetYaw - this.heroRotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heroRotY += diff * Math.min(1, dt * 14);

      if (!this.free3dMode && this.dragPointerId === null && ny < -0.25) {
        let camDiff = this.heroRotY - this.cameraYaw;
        while (camDiff > Math.PI) camDiff -= Math.PI * 2;
        while (camDiff < -Math.PI) camDiff += Math.PI * 2;
        this.cameraYaw += camDiff * Math.min(1, dt * 2.2);
      }
    }

    this.heroGroup.position.set(
      this.heroPos.x,
      moving ? Math.abs(Math.sin(elapsed * 12)) * 0.08 : 0,
      this.heroPos.z,
    );
    this.heroGroup.rotation.y = this.heroRotY;

    if (this.heroAttackAnim > 0 && this.heroWeaponPivot) {
      this.heroAttackAnim = Math.max(0, this.heroAttackAnim - dt);
      this.heroWeaponPivot.rotation.x = Math.sin((this.heroAttackAnim / 0.28) * Math.PI) * 1.45;
    } else if (this.heroWeaponPivot) {
      this.heroWeaponPivot.rotation.x = 0;
    }

    if (moving && elapsed - this.lastSyncTime > 0.1) {
      this.lastSyncTime = elapsed;
      this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'move');
    }

    // Proximity NPC check
    let nearestNpc: NpcDef | null = null;
    let bestNpcDist = 3.6;
    for (const n of this.npcs) {
      const d = Math.hypot(n.def.x - this.heroPos.x, n.def.z - this.heroPos.z);
      if (d < bestNpcDist) {
        bestNpcDist = d;
        nearestNpc = n.def;
      }
    }
    const nextNpcId = nearestNpc?.id || null;
    if (nextNpcId !== this.lastNearbyNpcId) {
      this.lastNearbyNpcId = nextNpcId;
      this.callbacks.onNearbyNpcChange?.(nearestNpc);
    }

    // Loot auto pickup & spin
    for (let i = this.lootDrops.length - 1; i >= 0; i--) {
      const drop = this.lootDrops[i];
      drop.mesh.children[1].rotation.y += dt * 2.2;
      const d = Math.hypot(drop.x - this.heroPos.x, drop.z - this.heroPos.z);
      if (d < 1.35) {
        this.lootDrops.splice(i, 1);
        this.scene.remove(drop.mesh);
        soundSynth.playJewelDrop();
        this.callbacks.onPickupLoot({ kind: drop.kind, label: drop.label, amount: drop.amount });
      }
    }

    // Monsters AI
    for (const mob of this.monsters) {
      if (!mob.alive) {
        mob.respawnTimer -= dt;
        if (mob.respawnTimer <= 0) {
          mob.alive = true;
          mob.hp = mob.maxHp;
          mob.hpBarFill.scale.x = 1;
          mob.x = mob.homeX;
          mob.z = mob.homeZ;
          mob.mesh.visible = true;
        }
        continue;
      }

      const dx = this.heroPos.x - mob.x;
      const dz = this.heroPos.z - mob.z;
      const dist = Math.hypot(dx, dz);
      // Safe Zone protection near z > 4.5 && |x| < 5
      const heroInSafeZone = this.heroPos.z > 3.5 && Math.abs(this.heroPos.x) < 5.2;

      if (!heroInSafeZone && dist < 10.5 && dist > 1.85) {
        mob.x += (dx / dist) * 2.7 * dt;
        mob.z += (dz / dist) * 2.7 * dt;
        mob.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (!heroInSafeZone && dist <= 1.85) {
        mob.attackCooldown -= dt;
        if (mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.65;
          this.callbacks.onPlayerDamaged(mob.damage);
        }
      }

      if (mob.hitFlash > 0) {
        mob.hitFlash -= dt;
        mob.mesh.scale.setScalar(1.07);
      } else {
        mob.mesh.scale.setScalar(1.0);
      }
      mob.mesh.position.set(mob.x, 0, mob.z);
    }

    if (this.eventActive && this.eventBossMesh) {
      this.eventBossMesh.rotation.y = Math.atan2(
        this.heroPos.x - this.eventBossMesh.position.x,
        this.heroPos.z - this.eventBossMesh.position.z,
      );
      this.eventBossMesh.position.y = Math.sin(elapsed * 3) * 0.12;
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y += dt * 8;

      let hit = false;
      for (const mob of this.monsters) {
        if (!mob.alive) continue;
        if (Math.hypot(mob.x - p.x, mob.z - p.z) < 1.35) {
          this.damageMonster(mob, p.damage, p.isCritical, p.isExcellent);
          hit = true;
          break;
        }
      }
      if (!hit && this.eventActive && this.eventBossMesh) {
        if (Math.hypot(this.eventBossMesh.position.x - p.x, this.eventBossMesh.position.z - p.z) < 1.9) {
          this.callbacks.onBossHitInEvent(p.damage);
          this.callbacks.onFloatingText(`-${p.damage} Jefe`, '#38bdf8');
          hit = true;
        }
      }

      if (hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.transientFx.length - 1; i >= 0; i--) {
      const fx = this.transientFx[i];
      fx.life -= dt;
      const mesh = fx.mesh as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat && 'opacity' in mat) {
        mat.opacity = Math.max(0, (fx.life / fx.maxLife) * 0.85);
      }
      fx.mesh.scale.setScalar(1 + (1 - fx.life / fx.maxLife) * fx.expandRate);
      if (fx.spinSpeed !== 0) fx.mesh.rotation.y += fx.spinSpeed * dt;
      if (fx.riseSpeed !== 0) fx.mesh.position.y += fx.riseSpeed * dt;

      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        mesh.geometry?.dispose();
        mat?.dispose();
        this.transientFx.splice(i, 1);
      }
    }

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.005) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-10 * dt);
    } else {
      this.shakeIntensity = 0;
    }

    const horizDist = Math.cos(this.cameraPitch) * this.cameraDist;
    const heightOffset = Math.sin(this.cameraPitch) * this.cameraDist + 1.4;
    const desiredX = this.heroPos.x - Math.sin(this.cameraYaw) * horizDist + shakeX;
    const desiredZ = this.heroPos.z - Math.cos(this.cameraYaw) * horizDist;
    const desiredY = this.heroPos.y + heightOffset + shakeY;

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, desiredX, 9, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, desiredY, 9, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, desiredZ, 9, dt);

    _vec3b.set(this.heroPos.x, 1.55, this.heroPos.z);
    this.camera.lookAt(_vec3b);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    window.removeEventListener('resize', this.onResizeBound);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    this.renderer.domElement.removeEventListener('wheel', this.onWheelBound);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
