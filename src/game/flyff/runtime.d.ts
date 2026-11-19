import type { ISceneLoaderAsyncResult, Scene, TransformNode, AbstractMesh, AnimationGroup, Vector3 } from '@babylonjs/core';
export function importGLB(scene:Scene,base:string,file:string):Promise<ISceneLoaderAsyncResult>;
export function splitGarments(meshes:AbstractMesh[]):void;
export function readJSON(base: string, file: string): Promise<any>;
export class FlyffAudio {
  constructor(base: string, sounds: Record<string,string>);
  muted: boolean; volume: number; context: AudioContext | null;
  unlock(): Promise<void>; play(id: string, volume?: number): Promise<boolean>; dispose(): void;
}
export class FlyffCharacter {
  static load(scene: Scene, base: string, config: any, audio: FlyffAudio): Promise<FlyffCharacter>;
  root: TransformNode; config: any; hp: number; disposed: boolean; time: number; clip: string;
  ownedMaterials:Set<any>;
  gear: Record<string,{equipped:boolean;durability:number}>;
  outfit: { meshes: AbstractMesh[]; transformNodes: TransformNode[]; skeletons: any[] };
  body: { meshes: AbstractMesh[] };
  clips: Map<string,AnimationGroup>;
  jumping:boolean; velocityY:number;
  groundAt?: (x:number,z:number,ceiling?:number)=>number;
  onEvent?: (event: any)=>void;
  play(name:string,loop?:boolean):void; seek(time:number):void; equip(slot:string,enabled:boolean):void;
  detach(slot:string):void; updateVisibility():void;
  receiveHit(damage:number,slot?:string,wear?:number):void;
  jump(height:number):boolean; update(dt:number, options?:any):void; dispose():void;
}
export class FlyffEffects {
  constructor(scene: Scene,base:string);
  spawn(file:string,position:Vector3,scale?:number):Promise<any>;
  update(dt:number):void; dispose():void;
}
export class FlyffWorld {
  static load(scene:Scene,base:string):Promise<FlyffWorld>;
  rootParent: TransformNode | null; manifest:any; tiles:Map<string,{root:TransformNode}>; lava:AbstractMesh;
  heightAt(x:number,z:number):number;
  surfaceAt(x:number,z:number):string;
  stream(x:number,z:number,radius?:number,distance?:number):Promise<void>;
  dispose():void;
}
