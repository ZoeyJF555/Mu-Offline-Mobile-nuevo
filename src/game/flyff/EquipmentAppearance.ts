import { Matrix, TransformNode, Vector3, type Scene, type ISceneLoaderAsyncResult } from '@babylonjs/core';
import type { MuItem } from '../../types/game';
import { FlyffCharacter, importGLB, splitGarments } from './runtime.js';

/** One native rig shared by all garments. Item identity selects geometry, not just color. */
export class EquipmentAppearance {
  private loaded = new Map<string, Promise<ISceneLoaderAsyncResult | null>>();
  private generation = 0;
  private disposed = false;
  private wingMount: TransformNode | null = null;

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
      mount.position.set(0.06, 0, 0.08);
    } else {
      mount.rotation.set(0, Math.PI, 0);
      mount.position.set(0, 1.05, -0.14);
    }
    this.wingMount = mount;
    (this.actor as any).wingsNode = mount;
    return mount;
  }

  private async load(file: string, slot?: string) {
    const key = slot ? `${slot}:${file}` : file;
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
            ag.start(true, 0.85, ag.from, ag.to);
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
            }
          }

          if (hasVerts) {
            const spanX = Math.max(0.15, lMax.x - lMin.x);
            const spanY = Math.max(0.15, lMax.y - lMin.y);
            const maxWidth = file.includes('prophet') ? 1.62 : 1.42;
            const maxHeight = file.includes('prophet') ? 1.24 : 0.98;
            const scale = Math.min(1.25, Math.max(0.16, Math.min(maxWidth / spanX, maxHeight / spanY)));
            holder.scaling.setAll(scale);

            const cx = ((lMin.x + lMax.x) * 0.5) * scale;
            const cy = ((lMin.y + lMax.y) * 0.5) * scale;
            const targetCenterY = isOpenMu ? 0.16 : 0.14;
            holder.position.set(-cx, targetCenterY - cy, 0.10 - lMin.z * scale);
          }

          result.meshes
            .filter((m) => m.getTotalVertices() > 0)
            .forEach((mesh, i) => {
              mesh.name = `equip_wings_${key}_${i}`;
              mesh.alwaysSelectAsActiveMesh = true;
              if (mesh.material) {
                mesh.material.backFaceCulling = false;
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
      if (slot === 'wings') {
        file =
          this.library.wings?.[item.name] ??
          this.library.wings?.['Alas de Ángel MU (OpenMU)'] ??
          'equipo/wing_flyff_feather.glb';
      } else if (slot === 'weapon' || slot === 'offhand') {
        file =
          this.library.weapons[item.name] ??
          (slot === 'offhand'
            ? this.library.weapons[item.category === 'weapon' ? 'Espada Rúnica' : 'Escudo Dragón']
            : undefined);
      } else {
        file = this.library.sets[item.setName]?.[this.actor.config.sex];
      }
      if (file) {
        const asset = await this.load(file, ['weapon', 'offhand', 'wings'].includes(slot) ? slot : undefined);
        if (asset.result) selected.set(slot, asset.key);
      }
    }

    if (this.disposed || generation !== this.generation) return;
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

