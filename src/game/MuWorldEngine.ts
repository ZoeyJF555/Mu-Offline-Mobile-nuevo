import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EventType, HeroClass, MuItem, RoomPeer } from '../types/game';
import { soundSynth } from './soundSynth';

const _vec3 = new THREE.Vector3();
const _vec3b = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _dummy = new THREE.Object3D();

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
  vx: number;
  vz: number;
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
  color: number;
}

interface SlashEffect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onKillMonster: (xp: number, zen: number, isBoss: boolean) => void;
  onPickupLoot: (drop: { kind: LootDrop['kind']; label: string; amount: number }) => void;
  onPlayerDamaged: (amount: number) => void;
  onHeroMoveSync: (x: number, z: number, rotY: number, action: 'idle' | 'move' | 'attack' | 'skill') => void;
  onBossHitInEvent: (damage: number) => void;
  onFloatingText: (text: string, color: string) => void;
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

  // Subtle moss & stone grain
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
  const tex = new THREE.CanvasTexture(c);
  return tex;
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
  private mode: 'title' | 'playing' = 'title';
  private heroClass: HeroClass = 'DK';
  private heroGroup: THREE.Group;
  private heroWeaponPivot: THREE.Group | null = null;
  private heroWingsGroup: THREE.Group | null = null;
  private shadowTex: THREE.CanvasTexture;

  private heroPos = new THREE.Vector3(0, 0, 6);
  private heroRotY = Math.PI;
  private heroAttackAnim = 0;
  private heroSkillCooldown1 = 0;
  private heroSkillCooldown2 = 0;
  private heroSkillCooldown3 = 0;
  private hitstopTimer = 0;
  private shakeIntensity = 0;

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

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1018);
    this.scene.fog = new THREE.FogExp2(0x0c1018, 0.0155);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.2, 160);
    this.camera.position.set(0, 12, 18);

    this.shadowTex = createContactShadowTexture();
    this.setupLighting();
    this.buildLorenciaEnvironment();

    this.heroGroup = this.buildHeroModel('DK', 7, 0x991b1b, true);
    this.heroGroup.position.copy(this.heroPos);
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
      if (this.mode === 'playing') {
        if (e.code === 'Space') {
          e.preventDefault();
          this.triggerBasicAttack();
        } else if (e.code === 'Digit1') {
          this.triggerSkill(1);
        } else if (e.code === 'Digit2') {
          this.triggerSkill(2);
        } else if (e.code === 'Digit3') {
          this.triggerSkill(3);
        } else if (e.code === 'KeyE') {
          this.pickupNearestLoot();
        }
      }
    };

    this.onKeyUpBound = (e) => {
      this.keys.delete(e.code);
    };

    this.onBlurBound = () => {
      this.keys.clear();
      this.joyX = 0;
      this.joyY = 0;
    };

    this.onResizeBound = () => {
      if (this.disposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('resize', this.onResizeBound);

    this.clock.start();
    this.tick();
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight(0x7ca2dc, 0x261a12, 0.78);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffdfb0, 2.1);
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

    // Outer continuous terrain beyond playable arena (no void dropoff)
    const outerGeo = new THREE.CircleGeometry(95, 48);
    outerGeo.rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x13171e,
      roughness: 0.94,
      metalness: 0.04,
    });
    const outerFloor = new THREE.Mesh(outerGeo, outerMat);
    outerFloor.position.y = -0.04;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    // Lorencia Citadel Courtyard
    const courtGeo = new THREE.CylinderGeometry(28, 28.5, 0.16, 32);
    const courtMat = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.78,
      metalness: 0.12,
    });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.position.y = -0.08;
    court.receiveShadow = true;
    this.scene.add(court);

    // Central Golden Rune Ring (polygonOffset to prevent Z-fighting)
    const ringGeo = new THREE.RingGeometry(4.6, 5.1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0x92400e,
      emissiveIntensity: 0.7,
      roughness: 0.28,
      metalness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const runeRing = new THREE.Mesh(ringGeo, ringMat);
    runeRing.position.y = 0.02;
    this.scene.add(runeRing);

    // Lorencia Warp Portal Gate at North (z = -17)
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

    // 4 Gothic Braziers around courtyard
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

    // Instanced Perimeter Pines & Rocks (natural boundary, > 20 items)
    const treeCount = 44;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.92 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);

    const canopyGeo = new THREE.ConeGeometry(1.45, 3.6, 7);
    canopyGeo.translate(0, 3.3, 0);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1a332a, roughness: 0.85 });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);

    const rockGeo = new THREE.DodecahedronGeometry(1.1, 0);
    rockGeo.translate(0, 0.5, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2d3440, roughness: 0.9, metalness: 0.08 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 28);

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

    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + 0.14;
      const radius = 29 + (i % 3) * 1.8;
      _dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      _dummy.rotation.set(0.1 * i, 0.4 * i, 0);
      const sx = 0.8 + (i % 4) * 0.25;
      _dummy.scale.set(sx, 0.7 + (i % 3) * 0.25, sx);
      _dummy.updateMatrix();
      rocks.setMatrixAt(i, _dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    this.scene.add(rocks);
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
      color: 0x1e293b,
      metalness: 0.08,
      roughness: 0.85,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe6bfa0,
      roughness: 0.65,
      metalness: 0.02,
    });

    // 1 & 2. Greaves / Boots
    const legGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.82, 8);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.22, 0.41, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.22, 0.41, 0);
    rightLeg.castShadow = true;

    // 3. Armored Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.85, 0.44), armorMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;

    // 4. Belt Accent
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.48), trimMat);
    belt.position.set(0, 0.88, 0);

    // 5 & 6. Pauldrons (Shoulders)
    const pauldronGeo = new THREE.SphereGeometry(0.25, 10, 8);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.5, 1.58, 0);
    leftPauldron.scale.set(1.1, 0.85, 1.0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.5, 1.58, 0);
    rightPauldron.scale.set(1.1, 0.85, 1.0);

    // 7. Head + Helm/Hood
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.set(0, 1.9, 0);
    const helm = new THREE.Mesh(
      classType === 'DW' ? new THREE.ConeGeometry(0.32, 0.55, 8) : new THREE.CylinderGeometry(0.26, 0.27, 0.28, 10),
      armorMat,
    );
    helm.position.set(0, classType === 'DW' ? 2.18 : 1.98, 0);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.36), trimMat);
    crest.position.set(0, 2.15, -0.02);

    // 8. Cape
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.0, 0.05), clothMat);
    cape.position.set(0, 1.15, -0.26);
    cape.rotation.x = 0.14;

    group.add(leftLeg, rightLeg, torso, belt, leftPauldron, rightPauldron, head, helm, crest, cape);

    // 9. Wings (ExtrudeGeometry silhouette)
    if (withWings) {
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
      const wingColor = classType === 'DK' ? 0xdc2626 : classType === 'DW' ? 0x38bdf8 : 0x34d399;
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
    }

    // 10. Weapon Pivot (Right Hand)
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.54, 1.25, 0.18);

    const weaponGlowMat = new THREE.MeshStandardMaterial({
      color: enhanceLevel >= 9 ? 0xfbbf24 : 0xe2e8f0,
      emissive: enhanceLevel >= 7 ? 0xf59e0b : 0x1e293b,
      emissiveIntensity: enhanceLevel >= 9 ? 0.95 : 0.35,
      metalness: 0.95,
      roughness: 0.15,
    });

    if (classType === 'DK') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.05), weaponGlowMat);
      blade.position.set(0, 0.65, 0.35);
      blade.rotation.x = Math.PI / 3;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.1), trimMat);
      guard.position.set(0, 0.18, 0.12);
      guard.rotation.x = Math.PI / 3;
      weaponPivot.add(blade, guard);
    } else if (classType === 'DW') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), trimMat);
      shaft.position.set(0, 0.5, 0.25);
      shaft.rotation.x = Math.PI / 4;
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18, 0),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0ea5e9,
          emissiveIntensity: 1.4,
          metalness: 0.8,
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

    this.equippedEnhance = weapon?.enhanceLevel ?? armor?.enhanceLevel ?? 5;
    this.hasWings = Boolean(wings);

    if (armor?.setName.includes('Dragon')) this.equippedSetColor = 0x991b1b;
    else if (armor?.setName.includes('Legendary')) this.equippedSetColor = 0x1d4ed8;
    else if (armor?.setName.includes('Guardian')) this.equippedSetColor = 0x047857;
    else if (armor?.rarity === 'ancient') this.equippedSetColor = 0x7c3aed;
    else this.equippedSetColor = classType === 'DK' ? 0x991b1b : classType === 'DW' ? 0x1e40af : 0x065f46;

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

  public setMode(mode: 'title' | 'playing') {
    this.mode = mode;
    if (mode === 'playing') {
      this.heroPos.set(0, 0, 6);
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
    const defs: Array<{ kind: MonsterEntity['kind']; name: string; hp: number; xp: number; zen: number; x: number; z: number }> = [
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
        vx: 0,
        vz: 0,
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
        const color = peer.classType === 'DK' ? 0xb91c1c : peer.classType === 'DW' ? 0x2563eb : 0x059669;
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

  public triggerBasicAttack() {
    if (this.mode !== 'playing') return;
    this.heroAttackAnim = 0.28;
    if (this.heroClass === 'DK') {
      soundSynth.playSlash();
      this.spawnSlashArc(0xf59e0b, 2.4);
      this.hitEnemiesInRadius(3.8, 52 + this.equippedEnhance * 6, false);
    } else {
      soundSynth.playMagic();
      this.spawnProjectile(this.heroClass === 'DW' ? 0x38bdf8 : 0x34d399, 55 + this.equippedEnhance * 6);
    }
    this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'attack');
  }

  public triggerSkill(slot: 1 | 2 | 3) {
    if (this.mode !== 'playing') return;
    if (slot === 1 && this.heroSkillCooldown1 <= 0) {
      this.heroSkillCooldown1 = 1.6;
      this.heroAttackAnim = 0.35;
      soundSynth.playSlash();
      this.spawnSlashArc(0xef4444, 3.6);
      this.hitEnemiesInRadius(4.8, 92 + this.equippedEnhance * 9, true);
      this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'skill');
    } else if (slot === 2 && this.heroSkillCooldown2 <= 0) {
      this.heroSkillCooldown2 = 3.2;
      soundSynth.playMagic();
      for (let i = -2; i <= 2; i++) {
        this.spawnProjectile(0xa855f7, 84 + this.equippedEnhance * 8, i * 0.28);
      }
      this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'skill');
    } else if (slot === 3 && this.heroSkillCooldown3 <= 0) {
      this.heroSkillCooldown3 = 4.5;
      soundSynth.playTradeSync();
      this.spawnSlashArc(0x22c55e, 2.8);
      this.callbacks.onFloatingText('¡Aura de Lorencia (+Defensa)!', '#4ade80');
    }
  }

  private spawnSlashArc(colorHex: number, radius: number) {
    const geo = new THREE.RingGeometry(radius * 0.55, radius, 20, 1, -Math.PI * 0.45, Math.PI * 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.heroPos.x, 1.0, this.heroPos.z);
    mesh.rotation.y = this.heroRotY - Math.PI / 2;
    this.scene.add(mesh);
    this.slashEffects.push({ mesh, life: 0.22, maxLife: 0.22 });
  }

  private spawnProjectile(color: number, damage: number, angleOffset = 0) {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    const dirAngle = this.heroRotY + angleOffset;
    const vx = Math.sin(dirAngle) * 18;
    const vz = Math.cos(dirAngle) * 18;
    mesh.position.set(this.heroPos.x + Math.sin(dirAngle) * 0.8, 1.25, this.heroPos.z + Math.cos(dirAngle) * 0.8);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, x: mesh.position.x, y: 1.25, z: mesh.position.z, vx, vz, life: 1.1, damage, color });
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
      this.hitstopTimer = 0.045;
      this.shakeIntensity = 0.26;
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
    const kind: LootDrop['kind'] =
      roll < 0.22 ? 'bless' : roll < 0.44 ? 'soul' : 'zen';
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
    let bestDist = 3.8;
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

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
    } else {
      this.updateSimulation(dt, elapsed);
    }

    this.renderer.render(this.scene, this.camera);

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
    // Animate portal & braziers
    if (this.portalRing) {
      this.portalRing.rotation.z += dt * 1.4;
    }
    for (let i = 0; i < this.brazierLights.length; i++) {
      this.brazierLights[i].intensity = 4.2 + Math.sin(elapsed * 8 + i * 2) * 0.8;
    }

    if (this.heroWingsGroup) {
      this.heroWingsGroup.rotation.y = Math.sin(elapsed * 4.5) * 0.1;
    }

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.22;
      const camX = Math.sin(this.titleAngle) * 14.5;
      const camZ = Math.cos(this.titleAngle) * 14.5 + 4;
      this.camera.position.set(camX, 7.2, camZ);
      this.camera.lookAt(0, 1.8, 3);
      return;
    }

    // Cooldowns
    this.heroSkillCooldown1 = Math.max(0, this.heroSkillCooldown1 - dt);
    this.heroSkillCooldown2 = Math.max(0, this.heroSkillCooldown2 - dt);
    this.heroSkillCooldown3 = Math.max(0, this.heroSkillCooldown3 - dt);

    // Movement input
    let moveX = this.joyX;
    let moveZ = this.joyY;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

    const len = Math.hypot(moveX, moveZ);
    let moving = false;
    if (len > 0.08) {
      moving = true;
      const nx = moveX / Math.max(1, len);
      const nz = moveZ / Math.max(1, len);
      const speed = 8.4;
      this.heroPos.x += nx * speed * dt;
      this.heroPos.z += nz * speed * dt;

      // Clamp to Lorencia Citadel radius (25.5m)
      const distCenter = Math.hypot(this.heroPos.x, this.heroPos.z);
      if (distCenter > 25.5) {
        this.heroPos.x *= 25.5 / distCenter;
        this.heroPos.z *= 25.5 / distCenter;
      }

      const targetYaw = Math.atan2(nx, nz);
      let diff = targetYaw - this.heroRotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heroRotY += diff * Math.min(1, dt * 14);
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

    // Throttle multiplayer position broadcast (~10 Hz)
    if (moving && elapsed - this.lastSyncTime > 0.1) {
      this.lastSyncTime = elapsed;
      this.callbacks.onHeroMoveSync(this.heroPos.x, this.heroPos.z, this.heroRotY, 'move');
    }

    // Auto-pickup very close loot (< 1.4m)
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

    // Update monsters AI
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

    // Animate Event Boss if active
    if (this.eventActive && this.eventBossMesh) {
      this.eventBossMesh.rotation.y = Math.atan2(
        this.heroPos.x - this.eventBossMesh.position.x,
        this.heroPos.z - this.eventBossMesh.position.z,
      );
      this.eventBossMesh.position.y = Math.sin(elapsed * 3) * 0.12;
    }

    // Update projectiles
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
        if (Math.hypot(mob.x - p.x, mob.z - p.z) < 1.2) {
          this.damageMonster(mob, p.damage, false);
          hit = true;
          break;
        }
      }
      if (!hit && this.eventActive && this.eventBossMesh) {
        if (
          Math.hypot(this.eventBossMesh.position.x - p.x, this.eventBossMesh.position.z - p.z) < 1.8
        ) {
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

    // Update slash arcs
    for (let i = this.slashEffects.length - 1; i >= 0; i--) {
      const s = this.slashEffects[i];
      s.life -= dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (s.life / s.maxLife) * 0.85);
      s.mesh.scale.setScalar(1 + (1 - s.life / s.maxLife) * 0.25);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        mat.dispose();
        this.slashEffects.splice(i, 1);
      }
    }

    // Damped third-person MU camera follow + decaying shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.005) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-10 * dt);
    } else {
      this.shakeIntensity = 0;
    }

    _vec3.set(this.heroPos.x + shakeX, 11.5 + shakeY, this.heroPos.z + 13.5);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _vec3.x, 7, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _vec3.y, 7, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _vec3.z, 7, dt);
    _vec3b.set(this.heroPos.x, 1.2, this.heroPos.z);
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
