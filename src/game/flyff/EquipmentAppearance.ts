import type { Scene, ISceneLoaderAsyncResult } from '@babylonjs/core';
import type { MuItem } from '../../types/game';
import { FlyffCharacter, importGLB, splitGarments } from './runtime.js';
/** One native rig shared by all garments. Item identity selects geometry, not just color. */
export class EquipmentAppearance {
  private loaded = new Map<string,Promise<ISceneLoaderAsyncResult|null>>();
  private generation = 0;
  private disposed = false;
  constructor(private scene:Scene,private base:string,private actor:FlyffCharacter,private library:any) {}
  private async load(file:string,slot?:string) {
    const key=slot?`${slot}:${file}`:file;
    if(!this.loaded.has(key)){
      const promise=importGLB(this.scene,this.base,file).then(result=>{
        if(this.disposed){this.release(result);return null;}
        for(const mesh of result.meshes)if(!mesh.parent)mesh.parent=this.actor.root;
        if(slot){
          const socket=slot==='offhand'?(file.includes('weaswo')?'socket_leftHand':'socket_shield'):(this.actor.config.classId==='ELF'?'socket_leftHand':'socket_rightHand');
          const parent=this.actor.outfit.transformNodes.find(n=>n.name===socket);
          if(!parent)throw new Error(`Missing equipment socket: ${socket}`);
          for(const mesh of result.meshes)if(mesh.name==='__root__'){
            // The containing character already supplies the GLTF coordinate conversion.
            mesh.parent=parent;mesh.position.setAll(0);mesh.scaling.setAll(1);
            mesh.rotationQuaternion=null;mesh.rotation.setAll(0);
          }
          result.meshes.filter(m=>m.getTotalVertices()).forEach((mesh,i)=>mesh.name=`equip_${slot}_${key}_${i}`);
        } else {
          splitGarments(result.meshes);
          for(const mesh of result.meshes)if(mesh.skeleton)mesh.skeleton=this.actor.outfit.skeletons[0];
          for(const node of [...result.transformNodes,...result.meshes])if(node.name.startsWith('equip_')&&node.parent?.name.startsWith('Bip02')){
            const parent=this.actor.outfit.transformNodes.find(n=>n.name===node.parent!.name);if(parent)node.parent=parent;
          }
        }
        for(const mesh of result.meshes){if(mesh.material)this.actor.ownedMaterials.add(mesh.material);mesh.isPickable=false;mesh.metadata={...mesh.metadata,equipmentFile:key,visualSelected:false};}
        this.actor.outfit.meshes.push(...result.meshes.filter(m=>m.getTotalVertices()));
        this.actor.updateVisibility();return result;
      });
      this.loaded.set(key,promise);promise.catch(()=>this.loaded.delete(key));
    }
    return {key,result:await this.loaded.get(key)};
  }
  async apply(items:MuItem[]) {
    const generation=++this.generation,selected=new Map<string,string>();
    for(const item of items.filter(i=>i.isEquipped)){
      const slot=({helm:'helmet',armor:'torso',pants:'pants',gloves:'hands',boots:'feet',weapon:'weapon',shield:'offhand'} as Record<string,string>)[item.slot];
      if(!slot)continue;
      const file=['weapon','offhand'].includes(slot)?(this.library.weapons[item.name]??(slot==='offhand'?this.library.weapons[item.category==='weapon'?'Espada Rúnica':'Escudo Dragón']:undefined)):this.library.sets[item.setName]?.[this.actor.config.sex];
      if(file){const asset=await this.load(file,['weapon','offhand'].includes(slot)?slot:undefined);if(asset.result)selected.set(slot,asset.key);}
    }
    if(this.disposed||generation!==this.generation)return;
    for(const mesh of this.actor.outfit.meshes){
      const slot=mesh.name.match(/^equip_(helmet|torso|pants|hands|feet|weapon|offhand)_/)?.[1];if(!slot)continue;
      mesh.metadata={...mesh.metadata,visualSelected:selected.has(slot)?mesh.metadata?.equipmentFile===selected.get(slot):!mesh.metadata?.equipmentFile};
    }
    this.actor.updateVisibility();
  }
  private release(result:ISceneLoaderAsyncResult) {
    const materials=new Set(result.meshes.map(m=>m.material).filter(Boolean));
    result.meshes.forEach(m=>m.dispose());result.transformNodes.forEach(n=>n.dispose());
    result.skeletons.forEach(s=>s.dispose());result.animationGroups.forEach(g=>g.dispose());
    materials.forEach((m:any)=>{if(!this.actor.ownedMaterials.has(m))m.dispose(false,true);});
  }
  dispose(){this.disposed=true;this.generation++;this.loaded.forEach(p=>p.then(r=>{if(r)this.release(r);}).catch(()=>{}));this.loaded.clear();}
}
