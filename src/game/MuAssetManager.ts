import {
  AbstractMesh,
  AssetContainer,
  Color3,
  Mesh,
  PBRMaterial,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export class MuAssetManager {
  private scene: Scene;
  private containerCache = new Map<string, Promise<AssetContainer>>();
  private templateMeshCache = new Map<string, Promise<Mesh | null>>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  loadContainer(fileName: string): Promise<AssetContainer> {
    const existing = this.containerCache.get(fileName);
    if (existing) return existing;

    const basePath = `${import.meta.env.BASE_URL || './'}models/`;
    const promise = SceneLoader.LoadAssetContainerAsync(basePath, fileName, this.scene).catch((err) => {
      this.containerCache.delete(fileName);
      throw err;
    });

    this.containerCache.set(fileName, promise);
    return promise;
  }

  async preloadCoreModels(fileNames: string[]): Promise<void> {
    await Promise.allSettled(fileNames.map((f) => this.loadContainer(f)));
  }

  async instantiateModel(
    fileName: string,
    instanceName: string,
    parent?: TransformNode,
    opts?: {
      scale?: number;
      emissiveHex?: number;
      emissiveIntensity?: number;
      tintHex?: number;
      receiveShadows?: boolean;
    },
  ): Promise<{ root: TransformNode; meshes: AbstractMesh[] }> {
    const container = await this.loadContainer(fileName);
    const instantiated = container.instantiateModelsToScene(
      (sourceName) => `${instanceName}_${sourceName}`,
      false,
    );

    const root = new TransformNode(`${instanceName}_root`, this.scene);
    if (parent) {
      root.parent = parent;
    }

    for (const node of instantiated.rootNodes) {
      node.parent = root;
    }

    if (opts?.scale && opts.scale !== 1) {
      root.scaling = new Vector3(opts.scale, opts.scale, opts.scale);
    }

    const meshes: AbstractMesh[] = [];
    for (const node of instantiated.rootNodes) {
      const childMeshes = node.getChildMeshes(false);
      if (node instanceof AbstractMesh) meshes.push(node);
      for (const m of childMeshes) {
        meshes.push(m);
      }
    }

    for (const m of meshes) {
      m.isPickable = false;
      if (opts?.receiveShadows) {
        m.receiveShadows = true;
      }
      if ((opts?.emissiveHex !== undefined || opts?.tintHex !== undefined) && m.material) {
        const cloned = m.material.clone(`${instanceName}_${m.material.name}_mat`);
        if (cloned instanceof PBRMaterial) {
          if (opts.tintHex !== undefined) {
            cloned.albedoColor = Color3.FromHexString(`#${opts.tintHex.toString(16).padStart(6, '0')}`);
          }
          if (opts.emissiveHex !== undefined && opts.emissiveIntensity !== undefined) {
            const em = Color3.FromHexString(`#${opts.emissiveHex.toString(16).padStart(6, '0')}`);
            cloned.emissiveColor = em.scale(opts.emissiveIntensity);
          }
        }
        m.material = cloned;
      }
    }

    return { root, meshes };
  }

  /**
   * Builds a single multi-material Mesh prototype from a loaded .glb AssetContainer
   * so Babylon.js ThinInstances can render hundreds of trees, houses, or thousands of monsters at 60 FPS.
   */
  async getThinInstanceMaster(fileName: string, keySuffix = 'master'): Promise<Mesh | null> {
    const cacheKey = `${fileName}:${keySuffix}`;
    const existing = this.templateMeshCache.get(cacheKey);
    if (existing) {
      const cached = await existing;
      if (cached && !cached.isDisposed()) return cached;
      this.templateMeshCache.delete(cacheKey);
    }

    const promise = (async () => {
      try {
        const container = await this.loadContainer(fileName);
        const instantiated = container.instantiateModelsToScene(
          (src) => `proto_${fileName}_${src}`,
          false,
        );
        const sourceMeshes: Mesh[] = [];
        for (const root of instantiated.rootNodes) {
          root.computeWorldMatrix(true);
          if (root instanceof Mesh && root.getTotalVertices() > 0) {
            sourceMeshes.push(root);
          }
          for (const child of root.getChildMeshes(false)) {
            if (child instanceof Mesh && child.getTotalVertices() > 0) {
              child.computeWorldMatrix(true);
              sourceMeshes.push(child);
            }
          }
        }

        if (sourceMeshes.length === 0) return null;

        for (const m of sourceMeshes) {
          m.bakeCurrentTransformIntoVertices();
        }

        const merged = Mesh.MergeMeshes(sourceMeshes, true, true, undefined, false, true);
        for (const r of instantiated.rootNodes) {
          if (!r.isDisposed()) r.dispose();
        }
        if (!merged) return null;

        merged.name = `thin_${fileName}_${keySuffix}`;
        merged.isPickable = false;
        merged.alwaysSelectAsActiveMesh = true;
        merged.doNotSyncBoundingInfo = true;
        return merged;
      } catch (err) {
        console.warn(`No se pudo crear ThinInstance master para ${fileName}:`, err);
        return null;
      }
    })();

    this.templateMeshCache.set(cacheKey, promise);
    return promise;
  }

  dispose() {
    this.containerCache.clear();
    this.templateMeshCache.clear();
  }
}
