// Game integration of the converted Flyff resources; original resource notices in public/flyff/licencias.
import { Color3, PBRMaterial, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { CharacterSex, HeroClass, MuItem, SkillDef } from '../types/game';
import { getItemVisualSpec } from '../data/muWorldData';
import { MU_SKILLS } from '../data/muSkillsAndClasses';
import { FlyffAudio, FlyffCharacter, FlyffEffects, FlyffWorld, readJSON } from './flyff/runtime.js';
import { EquipmentAppearance } from './flyff/EquipmentAppearance';
import { SurfaceCollision } from './flyff/SurfaceCollision';
import { RECIPES } from './flyff/recipes';

const ORIGIN = 1536;
const SLOTS = { helmet: 'helm', torso: 'armor', pants: 'pants', hands: 'gloves', feet: 'boots', weapon: 'weapon', offhand: 'shield' } as const;
export class FlyffContent {
  readonly base = new URL(`${import.meta.env.BASE_URL}flyff/`, location.href).href;
  actor: FlyffCharacter | null = null;
  world: FlyffWorld | null = null;
  readonly effects: FlyffEffects;
  audio: FlyffAudio | null = null;
  private resources: Promise<[any[],any,any]>;
  private appearance:EquipmentAppearance|null=null;
  private generation = 0;
  private equipmentGeneration = 0;
  private worldGeneration = 0;
  private loadingWorld = false;
  private disposed = false;
  private origin: TransformNode | null = null;
  private collision = new SurfaceCollision();
  private collisionTiles = "";

  private streaming = false;
  private streamClock = 1;
  private worldClock = 0;
  private pendingSounds: Promise<void> | null = null;
  private volume = .7;
  private muted = false;
  onError: (error:unknown)=>void = console.warn;
  onWear: (slot: string, durability: number)=>void = ()=>{};
  constructor(private scene: Scene) {
    this.effects = new FlyffEffects(scene,this.base);
    this.resources = Promise.all([readJSON(this.base,'personajes.json'),readJSON(this.base,'efectos-audio.json'),readJSON(this.base,'equipo.json')]);
    // Register rejection immediately; loading errors are also presented to the player.
    this.resources.catch(error=>this.onError(error));
  }
  async unlockAudio() {
    if (!this.pendingSounds) this.pendingSounds = this.resources.then(async ([,media])=>{
      if(this.disposed)return;
      this.audio ??= new FlyffAudio(this.base,media.sounds);
      await this.audio.unlock();this.audio.muted=this.muted;this.audio.volume=this.volume;
    }).catch(error=>{this.pendingSounds=null;this.onError(error);});
    await this.pendingSounds;
  }
  setAudio(volume:number, muted:boolean) { this.volume=volume;this.muted=muted;if(this.audio){this.audio.volume=volume;this.audio.muted=muted;} }
  async character(classId:HeroClass,sex:CharacterSex,items:MuItem[],parent:TransformNode) {
    const generation=++this.generation;
    const [configs,media,library]=await this.resources;
    if(this.disposed||generation!==this.generation)return;
    this.audio ??= new FlyffAudio(this.base,media.sounds);this.setAudio(this.volume,this.muted);
    if(this.actor?.config.id===`${classId}_${sex}`) {await this.equipment(items);return;}
    const config=configs.find(c=>c.classId===classId&&c.sex===sex);
    if(!config)throw new Error(`Variante no disponible: ${classId}/${sex}`);
    const next=await FlyffCharacter.load(this.scene,this.base,config,this.audio);
    if(this.disposed||generation!==this.generation){next.dispose();return;}
    this.appearance?.dispose();this.actor?.dispose();this.actor=next;next.root.parent=parent;
    this.appearance=new EquipmentAppearance(this.scene,this.base,next,library);
    next.groundAt=(x,z,ceiling=Infinity)=>this.collision.floor(x,z,ceiling,this.height(x,z));
    next.onEvent=e=>{if(e.type.endsWith('error'))this.onError(e.message);};
    await this.equipment(items);
    if(!this.disposed&&generation===this.generation&&this.actor===next)next.play('idle');
  }
  async equipment(items:MuItem[]) {
    const generation=++this.equipmentGeneration,actor=this.actor,appearance=this.appearance;
    await appearance?.apply(items);
    if(!actor||actor!==this.actor||appearance!==this.appearance||this.disposed||generation!==this.equipmentGeneration)return;
    for(const [slot,itemSlot] of Object.entries(SLOTS)) {
      const item=items.find(i=>i.slot===itemSlot&&i.isEquipped);
      this.actor.equip(slot,Boolean(item&&(item.durability??100)>0));
      this.actor.gear[slot].durability=item?.durability??100;
      const visual=getItemVisualSpec(item);
      for(const mesh of this.actor.outfit.meshes.filter(m=>m.name.startsWith(`equip_${slot}_`))) {
        if(mesh.material instanceof PBRMaterial) {
          // Each slot owns its material so pants and upper armor may glow independently.
          if(!mesh.metadata?.gameMaterial) {this.actor.ownedMaterials.add(mesh.material);mesh.material=mesh.material.clone(`game_${mesh.name}`);mesh.metadata={...mesh.metadata,gameMaterial:true};this.actor.ownedMaterials.add(mesh.material);}
          (mesh.material as PBRMaterial).emissiveColor=Color3.FromHexString(`#${visual.emissiveHex.toString(16).padStart(6,'0')}`).scale(visual.emissiveIntensity*.35);
        }
      }
    }
  }
  hurt(damage:number) {
    const actor=this.actor;if(!actor)return;
    const available=Object.keys(SLOTS).filter(s=>s!=='weapon'&&actor.gear[s].equipped);
    const slot=available[Math.floor(Math.random()*available.length)];
    if(slot){const remaining=Math.max(0,actor.gear[slot].durability-Math.max(1,Math.round(damage/8)));
      actor.gear[slot].durability=remaining;if(!remaining){actor.detach(slot);actor.equip(slot,false);}this.onWear(SLOTS[slot as keyof typeof SLOTS],remaining);}
    actor.play('hit',false);void this.audio?.play(`hurt_${actor.config.sex}`,.4).catch(this.onError);
  }
  cast(skill:SkillDef) {
    const index=MU_SKILLS[skill.classType].findIndex(s=>s.id===skill.id),recipe=RECIPES[skill.classType][index];
    if(!this.actor||!recipe)return;
    if (typeof (this.actor as any).playAction === 'function') {
      (this.actor as any).playAction(index===0?'attack':'cast_release', index===0?0.34:0.44);
    } else {
      this.actor.play(index===0?'attack':'cast_release',false);
    }
    const point=this.actor.root.getAbsolutePosition().add(new Vector3(0,.5,0));
    void this.effects.spawn(`efectos/${recipe[0]}.json`,point,.65).catch(this.onError);
    void this.audio?.play(recipe[1],.5).catch(this.onError);
    void this.audio?.play(index===0?`attack_${this.actor.config.sex}`:'cast_fire',.3).catch(this.onError);
  }
  impact(x:number,z:number) {
    const y=this.world?this.height(x,z):0;
    void this.effects.spawn('efectos/sfx_hitsword01.json',new Vector3(x,y+.8,z),.5).catch(this.onError);
    void this.audio?.play('hit_sword',.3).catch(this.onError);
  }
  async loadWorld(x:number,z:number) {
    const generation=++this.worldGeneration;this.loadingWorld=true;
    try {
      let next=this.world;
      if(!next||this.disposed) {
        this.clearWorld(false);
        next=await FlyffWorld.load(this.scene,this.base);
        if(this.disposed||generation!==this.worldGeneration){next.dispose();return;}
        this.world=next;
        this.origin=new TransformNode('madrigal_origin',this.scene);
        this.origin.position.set(-ORIGIN,0,-ORIGIN);
        next.lava.parent=this.origin;
        next.rootParent=this.origin;
      }
      await next.stream(x+ORIGIN,z+ORIGIN,0,100);
      if(!this.disposed&&generation===this.worldGeneration) {
        for(const tile of next.tiles.values())tile.root.parent=this.origin;
        this.refreshCollision();
      }
    } catch (err) {
      if (!this.disposed && generation === this.worldGeneration && !(err instanceof Error && err.message === 'World disposed')) {
        throw err;
      }
    } finally { if(generation===this.worldGeneration)this.loadingWorld=false; }
  }
  clearWorld(invalidate=true) {
    if(invalidate){this.worldGeneration++;this.loadingWorld=false;}
    this.world?.dispose();this.world=null;this.origin?.dispose();this.origin=null;this.collision.rebuild([]);this.collisionTiles="";
  }
  private async stream(x:number,z:number) {
    const world=this.world;const generation=this.worldGeneration;if(!world||this.streaming||this.disposed)return;
    this.streaming=true;
    try {await world.stream(x+ORIGIN,z+ORIGIN,0,100);
      if(world===this.world&&!this.disposed&&generation===this.worldGeneration){for(const tile of world.tiles.values())tile.root.parent=this.origin;this.refreshCollision();}
    } catch (err) {
      if (!this.disposed && generation === this.worldGeneration && !(err instanceof Error && err.message === 'World disposed')) {
        throw err;
      }
    } finally {this.streaming=false;}
  }
  height(x:number,z:number) {return this.world?.heightAt(x+ORIGIN,z+ORIGIN)??0;}
  safe(x:number,z:number) {return Boolean(this.world?.manifest.cities.some((c:any)=>Math.max(Math.abs(x+ORIGIN-c.x),Math.abs(z+ORIGIN-c.z))<c.sizeMeters/2));}
  ready(x:number,z:number) {return !this.world || this.world.tiles.has(`${Math.floor((x+ORIGIN)/512)}_${Math.floor((z+ORIGIN)/512)}`);}
  private refreshCollision() {
    const key=[...this.world!.tiles.keys()].sort().join(',');if(key===this.collisionTiles)return;
    this.collisionTiles=key;
    this.collision.rebuild([...this.world!.tiles.values()].flatMap((tile:any)=>tile.colliders.map((o:any)=>({...o,x:o.x-ORIGIN,z:o.z-ORIGIN}))));
  }
  canMove(x:number,z:number,fromX:number,fromZ:number,feet=this.height(fromX,fromZ)) {
    if(!this.world)return true;
    return this.collision.canMove(fromX,fromZ,x,z,feet,(px,pz)=>this.height(px,pz),(px,pz)=>this.ready(px,pz));
  }
  walkHeight(x:number,z:number,current:number,_dt:number) {
    if(!this.world)return this.height(x,z);
    const actor=this.actor,feet=current+(actor?.root.position.y??0);
    const target=this.collision.floor(x,z,feet+.65,this.height(x,z));
    if(actor){
      actor.root.position.y=Math.max(0,feet-target);
      if(actor.root.position.y>.06&&!actor.jumping){actor.jumping=true;actor.velocityY=0;actor.play('jump_fall',false);}
    }
    return target;
  }
  update(dt:number,x:number,z:number,moving:boolean,rotation:number) {
    this.effects.update(dt);this.world?.update(dt);this.worldClock+=dt;
    if(this.world&&!this.loadingWorld&&this.worldClock>this.streamClock){this.worldClock=0;void this.stream(x,z).catch(this.onError);}
    if(this.actor){this.actor.root.rotation.y=rotation;
      this.actor.update(dt,{moving,running:true,height:0,surface:this.world?.surfaceAt(x+ORIGIN,z+ORIGIN)??'land'});
    }
  }
  jump(){this.actor?.jump(0);}
  dispose(){this.disposed=true;this.generation++;this.clearWorld();this.appearance?.dispose();this.actor?.dispose();this.effects.dispose();this.audio?.dispose();}
}
