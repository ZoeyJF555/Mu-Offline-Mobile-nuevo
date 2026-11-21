import { AURORA_WING_NAME, artisanArmor, artisanWeapon, type ArtisanWeapon } from '../../data/artisanEquipment';
import { buildArtisanWeapon, buildAuroraWings } from './ArtisanWeapon';
import { Matrix, Mesh, TransformNode, Vector3, VertexBuffer, type AnimationGroup, type Scene, type ISceneLoaderAsyncResult } from '@babylonjs/core';
import type { MuItem } from '../../types/game';
import { getWingEvoTier, getWingTargetWidth, type WingEvoTier } from '../worldPhysicsMath';
import { FlyffCharacter, importGLB, splitGarments } from './runtime.js';

// Flyff's exported wing props have no skeleton or clips. Bend each half
// about the centerline, leaving the attachment stable. MU uses its own clips.
function prepareWingFlex(mesh: Mesh): (angle: number) => void {
  mesh.makeGeometryUnique();
  const rest = new Float32Array(mesh.getVerticesData(VertexBuffer.PositionKind)!);
  const restNormals = new Float32Array(mesh.getVerticesData(VertexBuffer.NormalKind)!);
  const positions = rest.slice(), normals = restNormals.slice();
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
  return angle => {
    for (let i = 0; i < rest.length; i += 3) {
      const x = rest[i], z = rest[i + 2];
      const flex = angle * Math.max(-1, Math.min(1, x * 2));
      const sin = Math.sin(flex), cos = Math.cos(flex);
      positions[i] = cos * x - sin * z;
      positions[i + 2] = sin * x + cos * z;
      normals[i] = cos * restNormals[i] - sin * restNormals[i + 2];
      normals[i + 2] = sin * restNormals[i] + cos * restNormals[i + 2];
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  };
}

/** One native rig shared by all garments. Item identity selects geometry, not just color. */
export class EquipmentAppearance {
  private loaded = new Map<string, Promise<ISceneLoaderAsyncResult | null>>();
  private generation = 0;
  private disposed = false;
  private wingMount: TransformNode | null = null;
  private wingFlexers = new Map<string, Array<(angle: number) => void>>();
  private wingAnimations = new Map<string, AnimationGroup[]>();
  private activeWingKey: string | undefined;

  constructor(private scene: Scene, private base: string, private actor: FlyffCharacter, private library: any) {}

  private ensureWingMount(): TransformNode {
    if (this.wingMount && !this.wingMount.isDisposed()) return this.wingMount;
    const spine =
      this.actor.outfit.transformNodes.find((n: TransformNode) => n.name === 'Bip02 Spine2') ??
      this.actor.outfit.transformNodes.find((n: TransformNode) => n.name === 'Bip02 Spine1') ??
      this.actor.root;
    const mount = new TransformNode('equip_wing_mount', this.scene);
    mount.parent = spine;
    if (spine !== this.actor.root) {
      // Align local +X = Right, +Y = Up, +Z = Hero Back (-Z world)
      mount.rotation.set(0, 0, -Math.PI / 2);
      mount.position.set(0.05, 0, 0.04);
    } else {
      mount.rotation.set(0, Math.PI, 0);
      mount.position.set(0, 1.05, -0.1);
    }
    this.wingMount = mount;
    this.actor.wingsNode = mount;
    return mount;
  }

  private useArtisanWeapon(weapon: ArtisanWeapon) {
    const key = `weapon:${weapon.key}`;
    if (!this.loaded.has(key)) {
      const socket = this.actor.outfit.transformNodes.find(node =>
        node.name === (weapon.classType === 'ELF' ? 'socket_leftHand' : 'socket_rightHand'));
      if (!socket) throw new Error('No se encontró el anclaje de arma');
      const mesh = buildArtisanWeapon(this.scene, weapon);
      mesh.name = `equip_weapon_${key}`;
      mesh.parent = socket;
      this.trackCreatedMesh(key, mesh);
    }
    return key;
  }

  private trackCreatedMesh(key: string, mesh: Mesh) {
    mesh.metadata = { equipmentFile: key, visualSelected: false };
    mesh.setEnabled(false);
    this.actor.outfit.meshes.push(mesh);
    this.actor.ownedMaterials.add(mesh.material);
    this.loaded.set(key, Promise.resolve({
      meshes: [mesh], transformNodes: [], skeletons: [], animationGroups: [],
      particleSystems: [], geometries: [], lights: [], spriteManagers: [],
    }));
  }

  private useAuroraWings() {
    const key = 'wings:artisan-aurora';
    if (!this.loaded.has(key)) {
      const mesh = buildAuroraWings(this.scene);
      mesh.name = `equip_wings_${key}`;
      mesh.parent = this.ensureWingMount();
      mesh.alwaysSelectAsActiveMesh = true;
      this.wingFlexers.set(key, [prepareWingFlex(mesh)]);
      this.trackCreatedMesh(key,mesh);
    }
    return key;
  }

  private async load(file: string, slot?: string, evoTier: WingEvoTier = 1) {
    const key = slot === 'wings' ? `wings:evo${evoTier}:${file}` : slot ? `${slot}:${file}` : file;
    if (!this.loaded.has(key)) {
      const promise = importGLB(this.scene, this.base, file).then((result) => {
        if (this.disposed) {
          this.release(result);
          return null;
        }
        for (const mesh of result.meshes) if (!mesh.parent) mesh.parent = this.actor.root;

        if (slot === 'wings') {
          const mount = this.ensureWingMount();
          const holder = new TransformNode(`wing_holder_${key}`, this.scene);
          holder.parent = mount;
          const isOpenMu = file.includes('openmu');
          if (isOpenMu) {
            // OpenMU wings are Z-up (+Z = up, +Y = swept back); rotate so +Y -> +Z (back) and +Z -> +Y (up)
            holder.rotation.set(-Math.PI / 2, Math.PI, 0);
          }
          for (const mesh of result.meshes) {
            if (mesh.name === '__root__') {
              mesh.parent = holder;
              mesh.position.setAll(0);
            }
          }

          // Evaluate frame 0 of any wing animation before measuring skinned bounds
          for (const ag of result.animationGroups ?? []) {
            ag.start(true, 0.92, ag.from, ag.to);
            ag.goToFrame(ag.from);
          }
          holder.computeWorldMatrix(true);
          for (const skel of result.skeletons ?? []) {
            skel.prepare(true);
          }

          // Compute exact normalized bounds in wingMount local space (accounting for bone skinning)
          mount.computeWorldMatrix(true);
          const invMount = mount.getWorldMatrix().clone().invert();
          let lMin = new Vector3(Infinity, Infinity, Infinity);
          let lMax = new Vector3(-Infinity, -Infinity, -Infinity);
          let hasVerts = false;
          const points: Vector3[] = [];
          const v = new Vector3();
          const p = new Vector3();
          const skelPos = new Vector3();
          const boneMat = new Matrix();

          for (const m of result.meshes) {
            if (m.getTotalVertices() <= 0) continue;
            m.computeWorldMatrix(true);
            const pos = m.getVerticesData('position');
            if (!pos) continue;
            const skel = m.skeleton;
            const mats = skel ? skel.getTransformMatrices(m) : null;
            const joints = mats ? m.getVerticesData('matricesIndices') : null;
            const weights = mats ? m.getVerticesData('matricesWeights') : null;
            const toMount = m.getWorldMatrix().multiply(invMount);

            for (let i = 0; i < pos.length; i += 3) {
              v.set(pos[i], pos[i + 1], pos[i + 2]);
              if (mats && joints && weights) {
                const vi = (i / 3) * 4;
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let wSum = 0;
                for (let k = 0; k < 4; k++) {
                  const w = weights[vi + k];
                  if (w <= 0) continue;
                  const jIdx = Math.round(joints[vi + k]);
                  const offset = jIdx * 16;
                  if (offset + 15 >= mats.length) continue;
                  Matrix.FromArrayToRef(mats, offset, boneMat);
                  Vector3.TransformCoordinatesToRef(v, boneMat, skelPos);
                  sx += skelPos.x * w;
                  sy += skelPos.y * w;
                  sz += skelPos.z * w;
                  wSum += w;
                }
                if (wSum > 0.001) {
                  v.set(sx / wSum, sy / wSum, sz / wSum);
                }
              }
              Vector3.TransformCoordinatesToRef(v, toMount, p);
              lMin = Vector3.Minimize(lMin, p);
              lMax = Vector3.Maximize(lMax, p);
              hasVerts = true;
              points.push(p.clone());
            }
          }

          if (hasVerts) {
            const spanX = Math.max(0.15, lMax.x - lMin.x);
            const spanY = Math.max(0.15, lMax.y - lMin.y);
            const targetWidth = getWingTargetWidth(evoTier);
            const targetHeight = targetWidth * 0.78;
            const scale = Math.max(0.16, Math.min(targetWidth / spanX, targetHeight / spanY));
            holder.scaling.setAll(scale);

            const centerX = (lMin.x + lMax.x) * 0.5;
            const rootPoints = points.filter(p =>
              Math.abs(p.x - centerX) < spanX * 0.18 && p.z < lMin.z + (lMax.z - lMin.z) * 0.3);
            const rootY = rootPoints.length
              ? rootPoints.reduce((sum, p) => sum + p.y, 0) / rootPoints.length
              : (lMin.y + lMax.y) * 0.5;
            holder.position.set(-centerX * scale, -rootY * scale, 0.04 - lMin.z * scale);
          }

          for (const group of result.animationGroups) group.stop();
          this.wingAnimations.set(key, result.animationGroups);
          result.meshes
            .filter((m) => m.getTotalVertices() > 0)
            .forEach((mesh, i) => {
              mesh.name = `equip_wings_${key}_${i}`;
              mesh.alwaysSelectAsActiveMesh = true;
              if (!isOpenMu && mesh instanceof Mesh && !mesh.skeleton && mesh.isVerticesDataPresent(VertexBuffer.NormalKind)) {
                const flexers = this.wingFlexers.get(key) ?? [];
                flexers.push(prepareWingFlex(mesh));
                this.wingFlexers.set(key, flexers);
              }
              if (mesh.material) {
                const mats: any[] = (mesh.material as any).subMaterials || [mesh.material];
                for (const mat of mats) {
                  if (mat) mat.backFaceCulling = false;
                }
              }
            });
        } else if (slot) {
          const socket =
            slot === 'offhand'
              ? file.includes('weaswo')
                ? 'socket_leftHand'
                : 'socket_shield'
              : this.actor.config.classId === 'ELF'
                ? 'socket_leftHand'
                : 'socket_rightHand';
          const parent = this.actor.outfit.transformNodes.find((n: TransformNode) => n.name === socket);
          if (!parent) throw new Error(`Missing equipment socket: ${socket}`);
          for (const mesh of result.meshes) {
            if (mesh.name === '__root__') {
              // The containing character already supplies the GLTF coordinate conversion.
              mesh.parent = parent;
              mesh.position.setAll(0);
              mesh.scaling.setAll(1);
              mesh.rotationQuaternion = null;
              mesh.rotation.setAll(0);
            }
          }
          result.meshes
            .filter((m) => m.getTotalVertices())
            .forEach((mesh, i) => (mesh.name = `equip_${slot}_${key}_${i}`));
        } else {
          splitGarments(result.meshes);
          for (const mesh of result.meshes) if (mesh.skeleton) mesh.skeleton = this.actor.outfit.skeletons[0];
          for (const node of [...result.transformNodes, ...result.meshes]) {
            if (node.name.startsWith('equip_') && node.parent?.name.startsWith('Bip02')) {
              const parent = this.actor.outfit.transformNodes.find((n: TransformNode) => n.name === node.parent!.name);
              if (parent) node.parent = parent;
            }
          }
        }

        for (const mesh of result.meshes) {
          if (mesh.material) this.actor.ownedMaterials.add(mesh.material);
          mesh.isPickable = false;
          mesh.metadata = { ...mesh.metadata, equipmentFile: key, visualSelected: false };
        }
        this.actor.outfit.meshes.push(...result.meshes.filter((m) => m.getTotalVertices()));
        this.actor.updateVisibility();
        return result;
      });
      this.loaded.set(key, promise);
      promise.catch(() => this.loaded.delete(key));
    }
    return { key, result: await this.loaded.get(key) };
  }

  async apply(items: MuItem[]) {
    const generation = ++this.generation;
    const selected = new Map<string, string>();
    const slotMap: Record<string, string> = {
      helm: 'helmet',
      armor: 'torso',
      pants: 'pants',
      gloves: 'hands',
      boots: 'feet',
      weapon: 'weapon',
      shield: 'offhand',
      wings: 'wings',
    };

    for (const item of items.filter((i) => i.isEquipped)) {
      const slot = slotMap[item.slot];
      if (!slot) continue;
      let file: string | undefined;
      let evoTier: WingEvoTier = 1;
      if (slot === 'wings') {
        if (item.name === AURORA_WING_NAME) {
          selected.set(slot, this.useAuroraWings());
          continue;
        }
        evoTier = getWingEvoTier(item.name, item.evoTier);
        file =
          this.library.wings?.[item.name] ??
          this.library.wings?.['Alas de Ángel MU (OpenMU)'] ??
          'equipo/wing_flyff_feather.glb';
      } else if (slot === 'weapon' || slot === 'offhand') {
        const custom = slot === 'weapon' && artisanWeapon(item.name);
        if (custom) {
          selected.set(slot, this.useArtisanWeapon(custom));
          continue;
        }
        file =
          this.library.weapons[item.name] ??
          (slot === 'offhand'
            ? this.library.weapons[item.category === 'weapon' ? 'Espada Rúnica' : 'Escudo Dragón']
            : undefined);
      } else {
        file = this.library.sets[artisanArmor(item.setName)?.base ?? item.setName]?.[this.actor.config.sex];
      }
      if (file) {
        const asset = await this.load(file, ['weapon', 'offhand', 'wings'].includes(slot) ? slot : undefined, evoTier);
        if (asset.result) selected.set(slot, asset.key);
      }
    }

    if (this.disposed || generation !== this.generation) return;
    const wingKey = selected.get('wings');
    if (wingKey !== this.activeWingKey) {
      for (const group of this.wingAnimations.get(this.activeWingKey ?? '') ?? []) group.stop();
      for (const group of this.wingAnimations.get(wingKey ?? '') ?? []) group.start(true, 0.92);
      const wingFlexers = this.wingFlexers.get(wingKey ?? '');
      this.actor.wingFlex = wingFlexers ? angle => wingFlexers.forEach(flex => flex(angle)) : null;
      this.activeWingKey = wingKey;
    }
    for (const mesh of this.actor.outfit.meshes) {
      const slot = mesh.name.match(/^equip_(helmet|torso|pants|hands|feet|weapon|offhand|wings)_/)?.[1];
      if (!slot) continue;
      mesh.metadata = {
        ...mesh.metadata,
        visualSelected: selected.has(slot) ? mesh.metadata?.equipmentFile === selected.get(slot) : !mesh.metadata?.equipmentFile,
      };
    }
    this.actor.updateVisibility();
  }

  private release(result: ISceneLoaderAsyncResult) {
    const materials = new Set(result.meshes.map((m) => m.material).filter(Boolean));
    result.meshes.forEach((m) => m.dispose());
    result.transformNodes.forEach((n) => n.dispose());
    result.skeletons.forEach((s) => s.dispose());
    result.animationGroups.forEach((g) => g.dispose());
    materials.forEach((m: any) => {
      if (!this.actor.ownedMaterials.has(m)) m.dispose(false, true);
    });
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.actor.wingFlex = null;
    this.wingFlexers.clear();
    this.wingAnimations.clear();
    this.wingMount?.dispose();
    this.wingMount = null;
    this.loaded.forEach((p) =>
      p
        .then((r) => {
          if (r) this.release(r);
        })
        .catch(() => {}),
    );
    this.loaded.clear();
  }
}

