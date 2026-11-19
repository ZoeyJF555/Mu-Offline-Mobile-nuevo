// Cross-file integration checks; no GPU or external services required.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RECIPES } from '../src/game/flyff/recipes.ts';
import { MU_SKILLS } from '../src/data/muSkillsAndClasses.ts';

const root = new URL('../public/flyff/', import.meta.url);
const readJSON = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const required = new Set();
async function asset(path) {
  const url = new URL(path, root);
  assert(url.href.startsWith(root.href), `Asset outside public/flyff: ${path}`);
  const info = await stat(fileURLToPath(url));
  assert(info.isFile() && info.size > 0, `Empty asset: ${path}`);
  assert(info.size < 25 * 1024 * 1024, `Asset exceeds offline cache limit: ${path}`);
  required.add(path);
}
async function glb(path) {
  await asset(path);
  const bytes = await readFile(new URL(path, root));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, path);
  assert.equal(bytes.readUInt32LE(4), 2, path);
  assert.equal(bytes.readUInt32LE(8), bytes.length, path);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}
const characters = await readJSON('personajes.json');
assert.equal(characters.length, 10);
assert.equal(new Set(characters.map(c => c.id)).size, 10);
for (const cls of Object.keys(RECIPES)) for (const sex of ['male', 'female']) {
  const c = characters.find(c => c.classId === cls && c.sex === sex);
  assert(c, `Missing ${cls}/${sex}`);
  const outfit = await glb(c.model), body = await glb(c.body);
  assert.equal(outfit.skins[0].joints.length, 30, c.id);
  assert.equal(body.skins[0].joints.length, 30, c.id);
  assert.equal(outfit.animations.length, 13, c.id);
  for (const clip of ['idle', 'run', 'attack', 'hit', 'death', 'jump_land', 'cast_release']) {
    assert(outfit.animations.some(a => a.name === clip), `${c.id}/${clip}`);
  }
  assert(outfit.nodes.some(n => n.name === 'socket_rightHand'), `Weapon socket: ${c.id}`);
  await asset(c.model.replace('.glb', '.animaciones.json'));
}
const equipment = await readJSON('equipo.json');
await asset('equipo.json');
for(const file of new Set(Object.values(equipment.weapons))) await glb(file);
for(const family of Object.values(equipment.sets)) for(const sex of ['male','female']) {
  const outfit=await glb(family[sex]);assert.equal(outfit.skins[0].joints.length,30);
}
const media = await readJSON('efectos-audio.json');
for (const path of Object.values(media.sounds)) await asset(path);
let skills = 0;
for (const [cls, recipes] of Object.entries(RECIPES)) {
  assert.equal(recipes.length, MU_SKILLS[cls].length);
  for (const [effect, sound] of recipes) {
    const path = `efectos/${effect}.json`, def = await readJSON(path);
    await asset(path);
    assert.equal(def.missing?.length ?? 0, 0, `Incomplete selected effect: ${effect}`);
    assert(media.sounds[sound], `Missing sound: ${sound}`);
    for (const part of def.parts) {
      for (const texture of part.textures ?? []) await asset(texture);
      if (part.mesh) await asset(part.mesh);
    }
    skills++;
  }
}
const world = await readJSON('mundo/mundo.json');
assert.equal(world.sizeMeters, 3072);
assert.equal(world.tiles.length, 36);
const height = await readFile(new URL('mundo/heightmap.f32', root));
assert.equal(height.length, world.heightResolution ** 2 * 4);
for (let i = 0; i < height.length; i += 4) assert(Number.isFinite(height.readFloatLE(i)));
await asset('mundo/heightmap.f32');
for (const tile of world.tiles) {
  await glb(tile.terrain); await asset(tile.height); await asset(tile.surface);
  for (const object of tile.objects) assert(world.models[object.model], `Unknown model: ${object.model}`);
}
for (const model of Object.values(world.models)) {
  await glb(model.file);
  if (model.collision) {
    await asset(model.collision);
    assert(model.collisionBounds?.min.every(Number.isFinite));
    assert(model.collisionBounds?.max.every(Number.isFinite));
  }
}
console.log(JSON.stringify({ characters: 10, skills, sounds: Object.keys(media.sounds).length,
  sectors: world.tiles.length, objects: world.tiles.reduce((n,t) => n+t.objects.length,0),
  models: Object.keys(world.models).length, equipmentModels: new Set([...Object.values(equipment.weapons),...Object.values(equipment.sets).flatMap(Object.values)]).size, referencedFiles: required.size }, null, 2));
