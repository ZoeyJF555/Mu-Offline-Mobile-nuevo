import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EventType, HeroClass, MuItem, RoomPeer, SkillDef } from '../types/game';
import { soundSynth } from './soundSynth';

const _vec3 = new THREE.Vector3();
const _vec3b = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export type EngineCameraMode = 'title' | 'character_select' | 'playing';

export interface LootDrop {
  id: string;
  kind: 'zen' | 'bless' | 'soul' | 'item';
  label: string;
  amount: number;
  x: number;
  z: number;
  mesh: THREE.Group;
  spawnTime: number;
}

interface MonsterEntity {
  id: string;
  kind: 'dragon' | 'skeleton' | 'gorgon' | 'boss';
  name: string;
  hp: number;
  maxHp: number;
  xpReward: number;
  zenReward: number;
  x: number;
  z: number;
  attackCooldown: number;
  hitFlash: number;
  mesh: THREE.Group;
  alive: boolean;
  respawnTimer: number;
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
}

interface SlashEffect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  expandRate: number;
}

export interface EngineCallbacks {
  onKillMonster: (xp: number, zen: number, isBoss: boolean) => void;
  onPickupLoot: (drop: { kind: LootDrop['kind']; label: string; amount: number }) => void;
  onPlayerDamaged: (amount: number) => void;
  onHeroMoveSync: (x: number, z: number, rotY: number, action: 'idle' | 'move' | 'attack' | 'skill') => void;
  onBossHitInEvent: (damage: number) => void;
  onFloatingText: (text: string, color: string) => void;
  onFpsUpdate?: (fps: number) => void;
}

function createCobbleTextures(maxAniso: number) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  ctx.fillStyle = '#1b2029';
  ctx.fillRect(0, 0, size, size);

  const step = 64;
  for (let y = 0; y < size; y += step) {
    const offset = (Math.floor(y / step) % 2) * (step / 2);
    for (let x = -step; x < size + step; x += step) {
      const tone = 30 + ((x * 13 + y * 29) % 16);
      ctx.fillStyle = `rgb(${tone + 4}, ${tone + 6}, ${tone + 12})`;
      ctx.fillRect(x + offset + 3, y + 3, step - 6, step - 6);
      ctx.strokeStyle = 'rgba(255, 220, 160, 0.05)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + offset + 4, y + 4, step - 8, step - 8);
    }
  }

  for (let i = 0; i < 650; i++) {
    const gx = (i * 73) % size;
    const gy = (i * 137) % size;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(217, 155, 60, 0.03)' : 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(gx, gy, 4, 4);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(14, 14);
  map.anisotropy = maxAniso;

  return { map };
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
  private heroClass: HeroClass = 'DK';
  private heroGroup: THREE.Group;
  private heroWeaponPivot: THREE.Group | null = null;
  private heroWingsGroup: THREE.Group | null = null;
  private dlRavenGroup: THREE.Group | null = null;
  private shadowTex: THREE.CanvasTexture;

  private heroPos = new THREE.Vector3(0, 0, 6);
  private heroRotY = Math.PI; // Facing North (-Z)
  private heroAttackAnim = 0;
  private hitstopTimer = 0;
  private shakeIntensity = 0;

  // 3rd-person chase & 3D orbit camera controls
  private cameraYaw = Math.PI; // Behind hero facing -Z
  private cameraPitch = 0.42;
  private cameraDist = 11.5;
  private free3dMode = false;
  private dragPointerId: number | null = null;
  private dragLastX = 0;
  private dragLastY = 0;

  // Performance pacing & brightness
  private targetFps: 30 | 45 | 60 = 60;
  private lastRenderMs = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  private keys = new Set<string>();
  private joyX = 0;
  private joyY = 0;
  private titleAngle = 0;

  private monsters: MonsterEntity[] = [];
  private lootDrops: LootDrop[] = [];
  private projectiles: Projectile[] = [];
  private slashEffects: SlashEffect[] = [];
  private remotePeers = new Map<string, THREE.Group>();
  private portalRing: THREE.Mesh | null = null;
  private brazierLights: THREE.PointLight[] = [];
  private eventBossMesh: THREE.Group | null = null;
  private eventActive = false;
  private lastSyncTime = 0;

  private equippedEnhance = 7;
  private equippedSetColor = 0x991b1b;
  private hasWings = true;

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
    // Cap pixel ratio at 1.5 on mobile for consistent 45-60 FPS
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2),
    );
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1018);
    this.scene.fog = new THREE.FogExp2(0x0c1018, 0.015);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.2, 160);
    this.camera.position.set(0, 8, 16);

    this.shadowTex = createContactShadowTexture();
    this.setupLighting();
    this.buildLorenciaEnvironment();

    this.heroGroup = this.buildHeroModel('DK', 7, 0x991b1b, true);
    this.heroGroup.position.copy(this.heroPos);
    this.heroGroup.rotation.y = this.heroRotY;
    this.scene.add(this.heroGroup);

    this.spawnMonsters();

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

  public setBrightness(val: number) {
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(val, 0.5, 1.7);
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
    const hemi = new THREE.HemisphereLight(0x88ade8, 0x261a12, 0.82);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffdfb0, 2.15);
    keyLight.position.set(16, 28, 14);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 70;
    const d = 24;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4f7df3, 0.85);
    rimLight.position.set(-18, 12, -16);
    this.scene.add(rimLight);
  }

  private buildLorenciaEnvironment() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const { map } = createCobbleTextures(maxAniso);

    const outerGeo = new THREE.CircleGeometry(95, 42);
    outerGeo.rotateX(-Math.PI / 2);
    const outerFloor = new THREE.Mesh(
      outerGeo,
      new THREE.MeshStandardMaterial({ color: 0x13171e, roughness: 0.94, metalness: 0.04 }),
    );
    outerFloor.position.y = -0.04;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    const courtGeo = new THREE.CylinderGeometry(28, 28.5, 0.16, 32);
    const court = new THREE.Mesh(
      courtGeo,
      new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0.12 }),
    );
    court.position.y = -0.08;
    court.receiveShadow = true;
    this.scene.add(court);

    const ringGeo = new THREE.RingGeometry(4.6, 5.1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const runeRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0x92400e,
        emissiveIntensity: 0.7,
        roughness: 0.28,
        metalness: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    runeRing.position.y = 0.02;
    this.scene.add(runeRing);

    // Lorencia Gate North
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, -17);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x333c4a, roughness: 0.85, metalness: 0.15 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.25, metalness: 0.9 });

    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 1.1), stoneMat);
    leftPillar.position.set(-2.3, 2.3, 0);
    leftPillar.castShadow = true;
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 1.1), stoneMat);
    rightPillar.position.set(2.3, 2.3, 0);
    rightPillar.castShadow = true;
    const arch = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.9, 1.3), stoneMat);
    arch.position.set(0, 4.8, 0);
    arch.castShadow = true;

    const portalTorus = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.14, 12, 36),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 1.5,
        roughness: 0.2,
        metalness: 0.8,
      }),
    );
    portalTorus.position.set(0, 2.4, 0);
    this.portalRing = portalTorus;

    const portalDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.45, 24),
      new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
    );
    portalDisc.position.set(0, 2.4, 0);
    gateGroup.add(leftPillar, rightPillar, arch, portalTorus, portalDisc);
    this.scene.add(gateGroup);

    // 4 Braziers
    const brazierCoords = [
      [-8.5, -8.5],
      [8.5, -8.5],
      [-8.5, 8.5],
      [8.5, 8.5],
    ];
    brazierCoords.forEach(([bx, bz], idx) => {
      const brazier = new THREE.Group();
      brazier.position.set(bx, 0, bz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 1.1, 8), stoneMat);
      base.position.y = 0.55;
      base.castShadow = true;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.35, 0.45, 8), goldMat);
      bowl.position.y = 1.25;
      const flame = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.36, 0),
        new THREE.MeshBasicMaterial({ color: 0xfb923c }),
      );
      flame.position.y = 1.68;
      brazier.add(base, bowl, flame);
      this.scene.add(brazier);

      if (idx < 2) {
        const pt = new THREE.PointLight(0xf97316, 4.5, 16, 1.8);
        pt.position.set(bx, 2.1, bz);
        this.scene.add(pt);
        this.brazierLights.push(pt);
      }
    });

    // Instanced Perimeter Trees & Rocks
    const treeCount = 40;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.92 }),
      treeCount,
    );

    const canopyGeo = new THREE.ConeGeometry(1.45, 3.6, 7);
    canopyGeo.translate(0, 3.3, 0);
    const canopies = new THREE.InstancedMesh(
      canopyGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a332a, roughness: 0.85 }),
      treeCount,
    );

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.06;
      const radius = 30.5 + (i % 5) * 2.4;
      _dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      _dummy.rotation.y = i * 1.1;
      const s = 0.85 + (i % 4) * 0.14;
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      trunks.setMatrixAt(i, _dummy.matrix);
      canopies.setMatrixAt(i, _dummy.matrix);
      canopies.setColorAt(i, new THREE.Color().setHSL(0.41, 0.32, 0.14 + (i % 3) * 0.03));
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();
    this.scene.add(trunks, canopies);
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
    armorColorHex: number,
    withWings: boolean,
  ): THREE.Group {
    const group = new THREE.Group();
    group.add(this.createShadowDisc(0.95));

    const metalness = Math.min(0.96, 0.45 + enhanceLevel * 0.04);
    const roughness = Math.max(0.14, 0.55 - enhanceLevel * 0.03);
    const emissiveHex = enhanceLevel >= 7 ? armorColorHex : 0x000000;
    const emissiveInt = enhanceLevel >= 9 ? 0.45 : enhanceLevel >= 7 ? 0.22 : 0;

    const armorMat = new THREE.MeshPhysicalMaterial({
      color: armorColorHex,
      metalness,
      roughness,
      emissive: emissiveHex,
      emissiveIntensity: emissiveInt,
      clearcoat: enhanceLevel >= 7 ? 0.8 : 0.2,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.22,
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

    // Greaves
    const legGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.82, 8);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.22, 0.41, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.22, 0.41, 0);
    rightLeg.castShadow = true;

    // Torso & Belt
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.85, 0.44), armorMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.48), trimMat);
    belt.position.set(0, 0.88, 0);

    // Pauldrons
    const pauldronGeo = new THREE.SphereGeometry(0.25, 10, 8);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.5, 1.58, 0);
    leftPauldron.scale.set(1.1, 0.85, 1.0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.5, 1.58, 0);
    rightPauldron.scale.set(1.1, 0.85, 1.0);

    // Head + Class-specific headgear (MG has spiky hair, DL has royal crown, DW has wizard hat)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.set(0, 1.9, 0);
    group.add(leftLeg, rightLeg, torso, belt, leftPauldron, rightPauldron, head);

    if (classType === 'MG') {
      // MG signature dark-silver spiky hair crown
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

    // Cape (DL gets wide Royal Emperor Cape)
    const cape = new THREE.Mesh(
      new THREE.BoxGeometry(classType === 'DL' ? 0.96 : 0.68, classType === 'DL' ? 1.25 : 1.0, 0.05),
      clothMat,
    );
    cape.position.set(0, 1.12, -0.26);
    cape.rotation.x = 0.16;
    group.add(cape);

    // DL Perched Dark Raven companion
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

    // Wings (all classes except DL royal cape unless wings equipped)
    if (withWings && classType !== 'DL') {
      const wings = new THREE.Group();
      wings.position.set(0, 1.48, -0.24);
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.lineTo(0.95, 0.52);
      wingShape.lineTo(1.25, 0.15);
      wingShape.lineTo(0.82, -0.35);
      wingShape.lineTo(0.25, -0.25);
      wingShape.closePath();

      const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
        depth: 0.04,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2,
      });
      const wingColor =
        classType === 'DK'
          ? 0xdc2626
          : classType === 'DW'
            ? 0x38bdf8
            : classType === 'ELF'
              ? 0x34d399
              : 0xa855f7;
      const wingMat = new THREE.MeshPhysicalMaterial({
        color: wingColor,
        emissive: wingColor,
        emissiveIntensity: 0.42,
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

    // Primary Weapon Pivot (Right Hand)
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.54, 1.25, 0.18);

    const weaponGlowMat = new THREE.MeshStandardMaterial({
      color: enhanceLevel >= 9 ? 0xfbbf24 : 0xe2e8f0,
      emissive: enhanceLevel >= 7 ? 0xf59e0b : 0x1e293b,
      emissiveIntensity: enhanceLevel >= 9 ? 0.95 : 0.35,
      metalness: 0.95,
      roughness: 0.15,
    });

    if (classType === 'DK' || classType === 'MG') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.05), weaponGlowMat);
      blade.position.set(0, 0.65, 0.35);
      blade.rotation.x = Math.PI / 3;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.1), trimMat);
      guard.position.set(0, 0.18, 0.12);
      guard.rotation.x = Math.PI / 3;
      weaponPivot.add(blade, guard);

      // MG Dual Rune Blade in Left Hand!
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

    this.equippedEnhance = weapon?.enhanceLevel ?? armor?.enhanceLevel ?? 6;
    this.hasWings = Boolean(wings) || equippedItems.length === 0;

    if (armor?.setName.includes('Dragon')) this.equippedSetColor = 0x991b1b;
    else if (armor?.setName.includes('Legendary')) this.equippedSetColor = 0x1d4ed8;
    else if (armor?.setName.includes('Guardian')) this.equippedSetColor = 0x047857;
    else if (armor?.setName.includes('Dark Steel')) this.equippedSetColor = 0x4c1d95;
    else if (armor?.setName.includes('Hurricane')) this.equippedSetColor = 0x312e81;
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
      this.equippedSetColor,
      this.hasWings,
    );
    this.heroGroup.position.copy(prevPos);
    this.heroGroup.rotation.y = prevRot;
    this.scene.add(this.heroGroup);
  }

  public setMode(mode: EngineCameraMode) {
    this.mode = mode;
    if (mode === 'playing') {
      this.heroPos.set(0, 0, 6);
      this.heroRotY = Math.PI;
      this.cameraYaw = Math.PI;
      this.cameraPitch = 0.42;
    } else if (mode === 'character_select') {
      this.heroPos.set(0, 0, 2);
      this.heroGroup.position.set(0, 0, 2);
    }
  }

  public setJoystickVector(x: number, y: number) {
    this.joyX = x;
    this.joyY = y;
  }

  private buildMonsterMesh(kind: MonsterEntity['kind']): THREE.Group {
    const g = new THREE.Group();
    const scale = kind === 'boss' ? 1.85 : kind === 'gorgon' ? 1.2 : 1.0;
    g.add(this.createShadowDisc(0.85 * scale));

    const bodyColor =
      kind === 'boss'
        ? 0x4c1d95
        : kind === 'gorgon'
          ? 0x7f1d1d
          : kind === 'skeleton'
            ? 0xcbd5e1
            : 0x15803d;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: kind === 'skeleton' ? 0.55 : 0.45,
      metalness: kind === 'boss' ? 0.65 : 0.25,
      emissive: kind === 'boss' ? 0x7e22ce : 0x000000,
      emissiveIntensity: kind === 'boss' ? 0.45 : 0,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: kind === 'boss' ? 0xf59e0b : 0xef4444,
      emissive: kind === 'boss' ? 0xd97706 : 0x991b1b,
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

    g.add(torso, head, hornL, hornR, weapon);
    return g;
  }

  private spawnMonsters() {
    const defs: Array<{
      kind: MonsterEntity['kind'];
      name: string;
      hp: number;
      xp: number;
      zen: number;
      x: number;
      z: number;
    }> = [
      { kind: 'dragon', name: 'Budge Dragon', hp: 140, xp: 45, zen: 650, x: -9, z: -4 },
      { kind: 'dragon', name: 'Budge Dragon', hp: 140, xp: 45, zen: 650, x: 9, z: -5 },
      { kind: 'skeleton', name: 'Esqueleto Guerrero', hp: 210, xp: 75, zen: 1100, x: -12, z: 7 },
      { kind: 'skeleton', name: 'Esqueleto Guerrero', hp: 210, xp: 75, zen: 1100, x: 11, z: 6 },
      { kind: 'gorgon', name: 'Gorgona de Sangre', hp: 320, xp: 120, zen: 1850, x: -4, z: -12 },
      { kind: 'gorgon', name: 'Gorgona de Sangre', hp: 320, xp: 120, zen: 1850, x: 5, z: -11 },
    ];

    defs.forEach((d, idx) => {
      const mesh = this.buildMonsterMesh(d.kind);
      mesh.position.set(d.x, 0, d.z);
      this.scene.add(mesh);
      this.monsters.push({
        id: `mob-${idx}`,
        kind: d.kind,
        name: d.name,
        hp: d.hp,
        maxHp: d.hp,
        xpReward: d.xp,
        zenReward: d.zen,
        x: d.x,
        z: d.z,
        attackCooldown: 1.2,
        hitFlash: 0,
        mesh,
        alive: true,
        respawnTimer: 0,
      });
    });
  }

  public setEventActive(active: boolean, eventType?: EventType) {
    this.eventActive = active;
    if (active && !this.eventBossMesh) {
      const bossGroup = this.buildMonsterMesh('boss');
      bossGroup.position.set(0, 0, -12);
      this.scene.add(bossGroup);
      this.eventBossMesh = bossGroup;
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
        mesh = this.buildHeroModel(peer.classType, peer.enhanceLevel || 7, color, true);
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

  public executeSkill(skill: SkillDef, comboStepMultiplier = 1) {
    if (this.mode !== 'playing') return;
    this.heroAttackAnim = 0.28;
    const baseDmg = (52 + this.equippedEnhance * 7) * skill.damageMultiplier * comboStepMultiplier;
    const dmg = Math.round(baseDmg);

    if (skill.isBuff) {
      soundSynth.playTradeSync();
      this.spawnRingEffect(skill.colorHex, 3.2, 0.35);
      this.callbacks.onFloatingText(`¡${skill.name}!`, '#4ade80');
      return;
    }

    if (skill.isAoe) {
      soundSynth.playMagic();
      this.spawnRingEffect(skill.colorHex, skill.range, 0.32);
      if (skill.range >= 9) {
        for (let i = -2; i <= 2; i++) {
          this.spawnProjectile(skill.colorHex, dmg, i * 0.25);
        }
      } else {
        this.hitEnemiesInRadius(skill.range, dmg, comboStepMultiplier > 1);
      }
    } else if (skill.range > 7) {
      soundSynth.playMagic();
      this.spawnProjectile(skill.colorHex, dmg, 0);
    } else {
      soundSynth.playSlash();
      this.spawnSlashArc(skill.colorHex, skill.range * 0.72);
      this.hitEnemiesInRadius(skill.range, dmg, comboStepMultiplier > 1);
    }

    this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'skill');
  }

  public executeComboChain(skills: [SkillDef, SkillDef, SkillDef]) {
    if (this.mode !== 'playing') return;
    this.executeSkill(skills[0], 1.15);
    window.setTimeout(() => {
      if (!this.disposed && this.mode === 'playing') {
        this.executeSkill(skills[1], 1.3);
      }
    }, 190);
    window.setTimeout(() => {
      if (!this.disposed && this.mode === 'playing') {
        soundSynth.playComboBurst();
        this.spawnRingEffect(0xfbbf24, 5.8, 0.42);
        this.executeSkill(skills[2], 1.75);
        this.hitstopTimer = 0.055;
        this.shakeIntensity = 0.35;
        this.callbacks.onFloatingText('¡COMBO x3 MU!', '#fbbf24');
      }
    }, 390);
  }

  private spawnSlashArc(colorHex: number, radius: number) {
    const geo = new THREE.RingGeometry(radius * 0.55, radius, 20, 1, -Math.PI * 0.45, Math.PI * 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 1.0, this.heroPos.z);
    mesh.rotation.y = this.heroRotY - Math.PI / 2;
    this.scene.add(mesh);
    this.slashEffects.push({ mesh, life: 0.24, maxLife: 0.24, expandRate: 0.3 });
  }

  private spawnRingEffect(colorHex: number, radius: number, life: number) {
    const geo = new THREE.RingGeometry(radius * 0.35, radius * 0.9, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 0.22, this.heroPos.z);
    this.scene.add(mesh);
    this.slashEffects.push({ mesh, life, maxLife: life, expandRate: 0.45 });
  }

  private spawnProjectile(color: number, damage: number, angleOffset = 0) {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    const dirAngle = this.heroRotY + angleOffset;
    const vx = Math.sin(dirAngle) * 19;
    const vz = Math.cos(dirAngle) * 19;
    mesh.position.set(
      this.heroPos.x + Math.sin(dirAngle) * 0.8,
      1.25,
      this.heroPos.z + Math.cos(dirAngle) * 0.8,
    );
    this.scene.add(mesh);
    this.projectiles.push({ mesh, x: mesh.position.x, y: 1.25, z: mesh.position.z, vx, vz, life: 1.0, damage });
  }

  private hitEnemiesInRadius(radius: number, damage: number, heavy: boolean) {
    let hitAny = false;
    for (const mob of this.monsters) {
      if (!mob.alive) continue;
      const dist = Math.hypot(mob.x - this.heroPos.x, mob.z - this.heroPos.z);
      if (dist <= radius) {
        this.damageMonster(mob, damage, heavy);
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

  private damageMonster(mob: MonsterEntity, damage: number, heavy: boolean) {
    mob.hp -= damage;
    mob.hitFlash = 0.16;
    this.callbacks.onFloatingText(`-${damage}`, heavy ? '#fbbf24' : '#f8fafc');
    if (mob.hp <= 0) {
      mob.alive = false;
      mob.mesh.visible = false;
      mob.respawnTimer = 6.5;
      this.callbacks.onKillMonster(mob.xpReward, mob.zenReward, false);
      this.spawnLootDrop(mob.x, mob.z);
    }
  }

  private spawnLootDrop(x: number, z: number) {
    const roll = Math.random();
    const kind: LootDrop['kind'] = roll < 0.22 ? 'bless' : roll < 0.44 ? 'soul' : 'zen';
    const label =
      kind === 'bless' ? 'Jewel of Bless' : kind === 'soul' ? 'Jewel of Soul' : 'Zen x1,500';
    const amount = kind === 'zen' ? 1500 : 1;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(this.createShadowDisc(0.45));

    const color = kind === 'bless' ? 0xef4444 : kind === 'soul' ? 0x3b82f6 : 0xfbbf24;
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
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
    let bestDist = 4.2;
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
      this.brazierLights[i].intensity = 4.2 + Math.sin(elapsed * 8 + i * 2) * 0.8;
    }
    if (this.heroWingsGroup) {
      this.heroWingsGroup.rotation.y = Math.sin(elapsed * 4.5) * 0.1;
    }
    if (this.dlRavenGroup) {
      this.dlRavenGroup.position.y = 2.15 + Math.sin(elapsed * 5.2) * 0.14;
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

    // PUBG-style camera-relative movement
    let inputX = this.joyX;
    let inputY = this.joyY; // negative = forward, positive = backward
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

      // Camera forward vector in XZ plane: (sin(cameraYaw), cos(cameraYaw))
      const fwdX = Math.sin(this.cameraYaw);
      const fwdZ = Math.cos(this.cameraYaw);
      // Camera right vector in XZ plane
      const rightX = -Math.cos(this.cameraYaw);
      const rightZ = Math.sin(this.cameraYaw);

      // Forward is -ny, Right is nx
      const worldMoveX = fwdX * -ny + rightX * nx;
      const worldMoveZ = fwdZ * -ny + rightZ * nx;

      const speed = 8.6;
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

      // In standard 3rd-person chase mode, camera gently follows behind hero when moving forward
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
          mob.mesh.visible = true;
        }
        continue;
      }

      const dx = this.heroPos.x - mob.x;
      const dz = this.heroPos.z - mob.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 10 && dist > 1.8) {
        mob.x += (dx / dist) * 2.6 * dt;
        mob.z += (dz / dist) * 2.6 * dt;
        mob.mesh.rotation.y = Math.atan2(dx, dz);
      } else if (dist <= 1.8) {
        mob.attackCooldown -= dt;
        if (mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.6;
          this.callbacks.onPlayerDamaged(12);
        }
      }

      if (mob.hitFlash > 0) {
        mob.hitFlash -= dt;
        mob.mesh.scale.setScalar(1.08);
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
        if (Math.hypot(mob.x - p.x, mob.z - p.z) < 1.25) {
          this.damageMonster(mob, p.damage, false);
          hit = true;
          break;
        }
      }
      if (!hit && this.eventActive && this.eventBossMesh) {
        if (Math.hypot(this.eventBossMesh.position.x - p.x, this.eventBossMesh.position.z - p.z) < 1.8) {
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

    for (let i = this.slashEffects.length - 1; i >= 0; i--) {
      const s = this.slashEffects[i];
      s.life -= dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (s.life / s.maxLife) * 0.85);
      s.mesh.scale.setScalar(1 + (1 - s.life / s.maxLife) * s.expandRate);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        mat.dispose();
        this.slashEffects.splice(i, 1);
      }
    }

    // 3rd-person camera positioned behind hero using spherical orbit around heroPos
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
