import fs from 'fs';
import path from 'path';

const OUT_DIR = path.resolve(process.cwd(), 'public', 'models');
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- Geometry Builders (Sculpted medieval meshes, zero Minecraft blocks) ---

function createBuilder() {
  const parts = [];
  return {
    addPart(name, geom, colorHex, opts = {}) {
      parts.push({
        name,
        positions: geom.positions,
        normals: geom.normals,
        indices: geom.indices,
        colorHex,
        metallic: opts.metallic ?? 0.25,
        roughness: opts.roughness ?? 0.65,
        emissiveHex: opts.emissiveHex ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
      });
    },
    parts,
  };
}

function hexToRgb(hex) {
  return [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ];
}

function transformGeom(geom, { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);

  const rotateVec = (x, y, z) => {
    // Scale
    let px = x * sx, py = y * sy, pz = z * sz;
    // Rotate X
    let y1 = py * cx - pz * sxr;
    let z1 = py * sxr + pz * cx;
    py = y1; pz = z1;
    // Rotate Y
    let x2 = px * cy + pz * syr;
    let z2 = -px * syr + pz * cy;
    px = x2; pz = z2;
    // Rotate Z
    let x3 = px * cz - py * szr;
    let y3 = px * szr + py * cz;
    return [x3, y3, pz];
  };

  const pos = new Float32Array(geom.positions.length);
  const norm = new Float32Array(geom.normals.length);
  for (let i = 0; i < geom.positions.length; i += 3) {
    const [vx, vy, vz] = rotateVec(geom.positions[i], geom.positions[i + 1], geom.positions[i + 2]);
    pos[i] = vx + tx;
    pos[i + 1] = vy + ty;
    pos[i + 2] = vz + tz;

    const [nx, ny, nz] = rotateVec(geom.normals[i], geom.normals[i + 1], geom.normals[i + 2]);
    const len = Math.hypot(nx, ny, nz) || 1;
    norm[i] = nx / len;
    norm[i + 1] = ny / len;
    norm[i + 2] = nz / len;
  }
  return { positions: pos, normals: norm, indices: geom.indices };
}

function mergeGeoms(geoms) {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geoms) {
    totalVerts += g.positions.length / 3;
    totalIdx += g.indices.length;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIdx);
  let vOff = 0;
  let iOff = 0;
  for (const g of geoms) {
    positions.set(g.positions, vOff * 3);
    normals.set(g.normals, vOff * 3);
    for (let k = 0; k < g.indices.length; k++) {
      indices[iOff + k] = g.indices[k] + vOff;
    }
    vOff += g.positions.length / 3;
    iOff += g.indices.length;
  }
  return { positions, normals, indices };
}

// Tapered cylinder / cone frustum
function makeTaperedCylinder(rBottom, rTop, height, segs = 12, radialSegs = 1) {
  const pos = [];
  const norm = [];
  const idx = [];
  const slope = (rBottom - rTop) / height;

  for (let y = 0; y <= radialSegs; y++) {
    const v = y / radialSegs;
    const py = (v - 0.5) * height;
    const r = rBottom + (rTop - rBottom) * v;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const a = u * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.push(ca * r, py, sa * r);
      const len = Math.hypot(ca, slope, sa) || 1;
      norm.push(ca / len, slope / len, sa / len);
    }
  }
  const stride = segs + 1;
  for (let y = 0; y < radialSegs; y++) {
    for (let i = 0; i < segs; i++) {
      const a = y * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Caps
  if (rBottom > 0.001) {
    const center = pos.length / 3;
    pos.push(0, -height / 2, 0);
    norm.push(0, -1, 0);
    const start = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rBottom, -height / 2, Math.sin(a) * rBottom);
      norm.push(0, -1, 0);
    }
    for (let i = 0; i < segs; i++) {
      idx.push(center, start + i + 1, start + i);
    }
  }
  if (rTop > 0.001) {
    const center = pos.length / 3;
    pos.push(0, height / 2, 0);
    norm.push(0, 1, 0);
    const start = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rTop, height / 2, Math.sin(a) * rTop);
      norm.push(0, 1, 0);
    }
    for (let i = 0; i < segs; i++) {
      idx.push(center, start + i, start + i + 1);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    indices: new Uint16Array(idx),
  };
}

// Smooth UV sphere / ellipsoid
function makeEllipsoid(rx, ry, rz, segs = 12, rings = 8) {
  const pos = [];
  const norm = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let s = 0; s <= segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      const st = Math.sin(theta), ct = Math.cos(theta);
      const nx = sp * ct, ny = cp, nz = sp * st;
      pos.push(nx * rx, ny * ry, nz * rz);
      const nl = Math.hypot(nx / rx, ny / ry, nz / rz) || 1;
      norm.push((nx / rx) / nl, (ny / ry) / nl, (nz / rz) / nl);
    }
  }
  const stride = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    indices: new Uint16Array(idx),
  };
}

// Pitched gable prism (for medieval roofs / blades / wings)
function makePrism(width, height, depth, ridgeScale = 0.05) {
  const hw = width / 2, hh = height / 2, hd = depth / 2;
  const rw = hw * ridgeScale;
  const faces = [
    // Left slope
    [[-hw, -hh, -hd], [-hw, -hh, hd], [-rw, hh, hd], [-rw, hh, -hd]],
    // Right slope
    [[hw, -hh, hd], [hw, -hh, -hd], [rw, hh, -hd], [rw, hh, hd]],
    // Front gable
    [[-hw, -hh, hd], [hw, -hh, hd], [rw, hh, hd], [-rw, hh, hd]],
    // Back gable
    [[hw, -hh, -hd], [-hw, -hh, -hd], [-rw, hh, -hd], [rw, hh, -hd]],
    // Bottom
    [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]],
    // Top ridge
    [[-rw, hh, -hd], [-rw, hh, hd], [rw, hh, hd], [rw, hh, -hd]],
  ];
  const pos = [];
  const norm = [];
  const idx = [];
  let v = 0;
  for (const quad of faces) {
    const [a, b, c, d] = quad;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const pt of quad) {
      pos.push(pt[0], pt[1], pt[2]);
      norm.push(nx / len, ny / len, nz / len);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    indices: new Uint16Array(idx),
  };
}

// Beveled octagonal/hexagonal medieval stone block/pillar
function makeOctaWall(width, height, depth) {
  return transformGeom(makeTaperedCylinder(width * 0.65, width * 0.62, height, 8, 1), {
    sx: 1,
    sy: 1,
    sz: depth / width,
  });
}

// --- Write glTF 2.0 Binary (.glb) ---
function writeGlb(filename, builder) {
  const gltf = {
    asset: { version: '2.0', generator: 'MU-Lorencia-Medieval-GLB' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: path.basename(filename, '.glb'), children: [] }],
    meshes: [],
    materials: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };

  const chunks = [];
  let byteOffset = 0;

  const pushBuffer = (typedArray, target) => {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    const padded = new Uint8Array(bytes.byteLength + pad);
    padded.set(bytes);
    chunks.push(padded);
    const bvIdx = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    });
    byteOffset += padded.byteLength;
    return bvIdx;
  };

  builder.parts.forEach((part, i) => {
    const pos = part.positions;
    const norm = part.normals;
    const idx = part.indices;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = 0; k < pos.length; k += 3) {
      if (pos[k] < minX) minX = pos[k];
      if (pos[k + 1] < minY) minY = pos[k + 1];
      if (pos[k + 2] < minZ) minZ = pos[k + 2];
      if (pos[k] > maxX) maxX = pos[k];
      if (pos[k + 1] > maxY) maxY = pos[k + 1];
      if (pos[k + 2] > maxZ) maxZ = pos[k + 2];
    }

    const bvPos = pushBuffer(pos, 34962);
    const bvNorm = pushBuffer(norm, 34962);
    const bvIdx = pushBuffer(idx, 34963);

    const accPos = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvPos,
      componentType: 5126,
      count: pos.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvNorm,
      componentType: 5126,
      count: norm.length / 3,
      type: 'VEC3',
    });
    const accIdx = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvIdx,
      componentType: 5123,
      count: idx.length,
      type: 'SCALAR',
    });

    const rgb = hexToRgb(part.colorHex);
    const em = hexToRgb(part.emissiveHex);
    const matIdx = gltf.materials.length;
    gltf.materials.push({
      name: `${part.name}_mat`,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [rgb[0], rgb[1], rgb[2], 1],
        metallicFactor: part.metallic,
        roughnessFactor: part.roughness,
      },
      ...(part.emissiveIntensity > 0
        ? { emissiveFactor: [em[0] * part.emissiveIntensity, em[1] * part.emissiveIntensity, em[2] * part.emissiveIntensity] }
        : {}),
    });

    const meshIdx = gltf.meshes.length;
    gltf.meshes.push({
      name: part.name,
      primitives: [{
        attributes: { POSITION: accPos, NORMAL: accNorm },
        indices: accIdx,
        material: matIdx,
      }],
    });

    const nodeIdx = gltf.nodes.length;
    gltf.nodes.push({ name: part.name, mesh: meshIdx });
    gltf.nodes[0].children.push(nodeIdx);
  });

  gltf.buffers[0].byteLength = byteOffset;
  const binTotal = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const totalLen = 12 + 8 + jsonPadded.length + 8 + binTotal.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // glTF
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binTotal.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // BIN

  const outBuf = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binTotal]);
  fs.writeFileSync(path.join(OUT_DIR, filename), outBuf);
}

// --- Build Medieval Heroes, Bots & NPCs (Sculpted tapered armor/robes, zero cubes!) ---
function buildMedievalHero(filename, cfg) {
  const b = createBuilder();
  // Boots & Greaves (tapered organic cylinders)
  const legL = transformGeom(makeTaperedCylinder(0.11, 0.14, 0.88, 10, 2), { tx: -0.17, ty: 0.44 });
  const legR = transformGeom(makeTaperedCylinder(0.11, 0.14, 0.88, 10, 2), { tx: 0.17, ty: 0.44 });
  b.addPart('greaves', mergeGeoms([legL, legR]), cfg.legHex, { metallic: 0.45, roughness: 0.45 });

  // Sculpted Torso / Tunic / Breastplate
  const torso = cfg.robe
    ? transformGeom(makeTaperedCylinder(0.42, 0.28, 1.05, 14, 2), { ty: 1.15 })
    : transformGeom(makeTaperedCylinder(0.24, 0.36, 0.92, 14, 2), { ty: 1.25 });
  b.addPart('armor_torso', torso, cfg.armorHex, { metallic: cfg.robe ? 0.15 : 0.65, roughness: cfg.robe ? 0.72 : 0.35 });

  // Pauldrons (Medieval Shoulder Armor)
  const pL = transformGeom(makeEllipsoid(0.22, 0.16, 0.2, 10, 6), { tx: -0.38, ty: 1.62, rz: 0.3 });
  const pR = transformGeom(makeEllipsoid(0.22, 0.16, 0.2, 10, 6), { tx: 0.38, ty: 1.62, rz: -0.3 });
  b.addPart('pauldrons', mergeGeoms([pL, pR]), cfg.accentHex, { metallic: 0.75, roughness: 0.3 });

  // Arms / Sleeves
  const armL = transformGeom(makeTaperedCylinder(0.08, 0.11, 0.72, 10, 1), { tx: -0.41, ty: 1.24, rz: 0.14 });
  const armR = transformGeom(makeTaperedCylinder(0.08, 0.11, 0.72, 10, 1), { tx: 0.41, ty: 1.24, rz: -0.14 });
  b.addPart('arms', mergeGeoms([armL, armR]), cfg.armorHex, { metallic: 0.4, roughness: 0.5 });

  // Cloak / Cape
  if (cfg.cloak) {
    const cape = transformGeom(makePrism(0.62, 1.15, 0.08, 0.65), { ty: 1.12, tz: -0.26, rx: 0.16 });
    b.addPart('cloak', cape, cfg.cloakHex, { metallic: 0.1, roughness: 0.85 });
  }

  // Head
  const head = transformGeom(makeEllipsoid(0.2, 0.23, 0.21, 12, 8), { ty: 1.94 });
  b.addPart('head', head, 0xe8be9e, { metallic: 0.05, roughness: 0.65 });

  // Medieval Helm / Hood / Crown / Circlet
  if (cfg.headgear === 'helm') {
    const dome = transformGeom(makeTaperedCylinder(0.23, 0.18, 0.32, 12, 1), { ty: 2.02 });
    const crest = transformGeom(makePrism(0.08, 0.22, 0.38, 0.4), { ty: 2.22 });
    b.addPart('helmet', mergeGeoms([dome, crest]), cfg.accentHex, { metallic: 0.8, roughness: 0.28 });
  } else if (cfg.headgear === 'hood') {
    const hood = transformGeom(makeTaperedCylinder(0.28, 0.06, 0.44, 12, 1), { ty: 2.08, rx: -0.15 });
    b.addPart('hood', hood, cfg.accentHex, { metallic: 0.1, roughness: 0.8 });
  } else if (cfg.headgear === 'crown') {
    const band = transformGeom(makeTaperedCylinder(0.23, 0.25, 0.16, 8, 1), { ty: 2.12 });
    b.addPart('crown', band, 0xfbbf24, { metallic: 0.88, roughness: 0.22 });
  } else {
    const hair = transformGeom(makeEllipsoid(0.22, 0.22, 0.24, 12, 6), { ty: 2.0, tz: -0.04 });
    b.addPart('hair', hair, cfg.accentHex, { metallic: 0.2, roughness: 0.6 });
  }

  writeGlb(filename, b);
}

buildMedievalHero('hero_dk.glb', {
  armorHex: 0x991b1b, legHex: 0x334155, accentHex: 0xf59e0b, cloakHex: 0x7f1d1d, cloak: true, headgear: 'helm',
});
buildMedievalHero('hero_dw.glb', {
  armorHex: 0x1e3a8a, legHex: 0x1e293b, accentHex: 0x38bdf8, cloakHex: 0x1d4ed8, robe: true, cloak: true, headgear: 'hood',
});
buildMedievalHero('hero_elf.glb', {
  armorHex: 0x047857, legHex: 0x064e3b, accentHex: 0x6ee7b7, cloakHex: 0x059669, robe: false, cloak: true, headgear: 'hair',
});
buildMedievalHero('hero_dl.glb', {
  armorHex: 0x4c1d95, legHex: 0x1f2937, accentHex: 0xfbbf24, cloakHex: 0x581c87, cloak: true, headgear: 'crown',
});
buildMedievalHero('hero_mg.glb', {
  armorHex: 0x312e81, legHex: 0x1e293b, accentHex: 0xf59e0b, cloakHex: 0x3730a3, cloak: true, headgear: 'hair',
});
buildMedievalHero('bot_soldier.glb', {
  armorHex: 0x475569, legHex: 0x1e293b, accentHex: 0xcbd5e1, cloakHex: 0x991b1b, cloak: true, headgear: 'helm',
});
buildMedievalHero('npc_merchant.glb', {
  armorHex: 0x78350f, legHex: 0x451a03, accentHex: 0xfbbf24, robe: true, cloak: false, headgear: 'hood',
});
buildMedievalHero('npc_goblin.glb', {
  armorHex: 0x3f6212, legHex: 0x365314, accentHex: 0xfacc15, robe: true, cloak: true, cloakHex: 0x713f12, headgear: 'hood',
});

// --- Build Weapons, Shields & Wings ---
{
  const b = createBuilder();
  const handle = transformGeom(makeTaperedCylinder(0.035, 0.04, 0.36, 8, 1), { ty: 0.18 });
  const guard = transformGeom(makePrism(0.42, 0.08, 0.09, 0.7), { ty: 0.36 });
  const blade = transformGeom(makePrism(0.14, 1.25, 0.05, 0.12), { ty: 1.02 });
  b.addPart('hilt', mergeGeoms([handle, guard]), 0xd97706, { metallic: 0.85, roughness: 0.28 });
  b.addPart('blade', blade, 0xe2e8f0, { metallic: 0.92, roughness: 0.18 });
  writeGlb('weapon_sword.glb', b);
}
{
  const b = createBuilder();
  const shaft = transformGeom(makeTaperedCylinder(0.035, 0.045, 1.7, 10, 2), { ty: 0.85 });
  const crown = transformGeom(makeTaperedCylinder(0.08, 0.16, 0.22, 8, 1), { ty: 1.7 });
  const gem = transformGeom(makeEllipsoid(0.14, 0.2, 0.14, 10, 6), { ty: 1.92 });
  b.addPart('staff_shaft', mergeGeoms([shaft, crown]), 0x7c2d12, { metallic: 0.6, roughness: 0.4 });
  b.addPart('staff_gem', gem, 0x38bdf8, { metallic: 0.2, roughness: 0.15, emissiveHex: 0x38bdf8, emissiveIntensity: 0.9 });
  writeGlb('weapon_staff.glb', b);
}
{
  const b = createBuilder();
  const limbUp = transformGeom(makeTaperedCylinder(0.04, 0.02, 0.75, 8, 1), { ty: 0.36, tz: -0.1, rx: 0.42 });
  const limbDn = transformGeom(makeTaperedCylinder(0.02, 0.04, 0.75, 8, 1), { ty: -0.36, tz: -0.1, rx: -0.42 });
  const stringG = transformGeom(makeTaperedCylinder(0.008, 0.008, 1.26, 6, 1), { tz: -0.26 });
  b.addPart('bow_limbs', mergeGeoms([limbUp, limbDn]), 0x10b981, { metallic: 0.45, roughness: 0.35, emissiveHex: 0x10b981, emissiveIntensity: 0.25 });
  b.addPart('bow_string', stringG, 0xfef3c7, { metallic: 0.1, roughness: 0.6 });
  writeGlb('weapon_bow.glb', b);
}
{
  const b = createBuilder();
  const shaft = transformGeom(makeTaperedCylinder(0.04, 0.05, 1.3, 10, 1), { ty: 0.65 });
  const orb = transformGeom(makeEllipsoid(0.16, 0.16, 0.16, 10, 6), { ty: 1.4 });
  b.addPart('scepter_rod', shaft, 0xf59e0b, { metallic: 0.85, roughness: 0.25 });
  b.addPart('scepter_orb', orb, 0xa855f7, { metallic: 0.3, roughness: 0.2, emissiveHex: 0xa855f7, emissiveIntensity: 0.85 });
  writeGlb('weapon_scepter.glb', b);
}
{
  const b = createBuilder();
  const body = transformGeom(makePrism(0.68, 0.92, 0.08, 0.35), { rx: Math.PI });
  const boss = transformGeom(makeEllipsoid(0.14, 0.14, 0.08, 10, 6), { tz: 0.06 });
  b.addPart('shield_plate', body, 0x991b1b, { metallic: 0.72, roughness: 0.35 });
  b.addPart('shield_boss', boss, 0xfbbf24, { metallic: 0.9, roughness: 0.22 });
  writeGlb('shield_dragon.glb', b);
}
{
  const b = createBuilder();
  const wL = transformGeom(makePrism(1.25, 0.75, 0.06, 0.2), { tx: -0.78, ty: 0.2, rz: 0.35, ry: 0.22 });
  const wR = transformGeom(makePrism(1.25, 0.75, 0.06, 0.2), { tx: 0.78, ty: 0.2, rz: -0.35, ry: -0.22 });
  const wL2 = transformGeom(makePrism(0.95, 0.45, 0.05, 0.15), { tx: -0.62, ty: -0.22, rz: -0.25, ry: 0.22 });
  const wR2 = transformGeom(makePrism(0.95, 0.45, 0.05, 0.15), { tx: 0.62, ty: -0.22, rz: 0.25, ry: -0.22 });
  b.addPart('wings_primary', mergeGeoms([wL, wR, wL2, wR2]), 0xf59e0b, {
    metallic: 0.55, roughness: 0.25, emissiveHex: 0xfbbf24, emissiveIntensity: 0.45,
  });
  writeGlb('wings_angel.glb', b);
}

// --- Build Medieval Architecture (Houses, Taverns/Barets, Smithies, City Walls & Gates) ---
{
  // Half-timbered medieval house
  const b = createBuilder();
  const base = transformGeom(makeOctaWall(5.6, 1.1, 4.6), { ty: 0.55 });
  const upper = transformGeom(makeOctaWall(5.8, 2.7, 4.8), { ty: 2.45 });
  const roof = transformGeom(makePrism(6.8, 2.3, 5.4, 0.06), { ty: 4.95 });
  const chimney = transformGeom(makeTaperedCylinder(0.45, 0.35, 2.2, 6, 1), { tx: 1.9, ty: 5.3, tz: -1.1 });
  const door = transformGeom(makeTaperedCylinder(0.62, 0.58, 2.0, 8, 1), { ty: 1.0, tz: 2.35, sz: 0.25 });
  b.addPart('stone_foundation', mergeGeoms([base, chimney]), 0x64748b, { metallic: 0.1, roughness: 0.88 });
  b.addPart('plaster_walls', upper, 0xd6c7b2, { metallic: 0.05, roughness: 0.85 });
  b.addPart('pitched_roof', roof, 0x7c2d12, { metallic: 0.1, roughness: 0.78 });
  b.addPart('oak_door', door, 0x451a03, { metallic: 0.1, roughness: 0.82 });
  writeGlb('house_medieval.glb', b);
}
{
  // Medieval Tavern / Baret (2-story inn + barrels + warm lantern sign)
  const b = createBuilder();
  const stoneLower = transformGeom(makeOctaWall(8.2, 2.6, 6.2), { ty: 1.3 });
  const timberUpper = transformGeom(makeOctaWall(8.6, 2.6, 6.6), { ty: 3.9 });
  const roofMain = transformGeom(makePrism(9.6, 2.8, 7.4, 0.08), { ty: 6.55 });
  const barrel1 = transformGeom(makeTaperedCylinder(0.48, 0.44, 1.05, 10, 2), { tx: -3.4, ty: 0.52, tz: 3.3 });
  const barrel2 = transformGeom(makeTaperedCylinder(0.48, 0.44, 1.05, 10, 2), { tx: -2.3, ty: 0.52, tz: 3.3 });
  const signLantern = transformGeom(makeEllipsoid(0.32, 0.42, 0.32, 8, 6), { tx: 1.8, ty: 2.6, tz: 3.55 });
  b.addPart('tavern_stone', stoneLower, 0x475569, { metallic: 0.1, roughness: 0.86 });
  b.addPart('tavern_upper', timberUpper, 0xc2a988, { metallic: 0.05, roughness: 0.82 });
  b.addPart('tavern_roof', roofMain, 0x991b1b, { metallic: 0.15, roughness: 0.75 });
  b.addPart('tavern_barrels', mergeGeoms([barrel1, barrel2]), 0x78350f, { metallic: 0.15, roughness: 0.75 });
  b.addPart('tavern_lantern', signLantern, 0xfbbf24, { metallic: 0.2, roughness: 0.2, emissiveHex: 0xf59e0b, emissiveIntensity: 1.1 });
  writeGlb('tavern_baret.glb', b);
}
{
  // Medieval Blacksmith / Shop Stall
  const b = createBuilder();
  const hearth = transformGeom(makeTaperedCylinder(1.6, 0.8, 4.6, 8, 1), { tx: -2.2, ty: 2.3, tz: -1.4 });
  const canopy = transformGeom(makePrism(6.8, 1.4, 5.0, 0.2), { ty: 3.6 });
  const p1 = transformGeom(makeTaperedCylinder(0.18, 0.18, 3.0, 8, 1), { tx: -2.8, ty: 1.5, tz: 1.9 });
  const p2 = transformGeom(makeTaperedCylinder(0.18, 0.18, 3.0, 8, 1), { tx: 2.8, ty: 1.5, tz: 1.9 });
  const p3 = transformGeom(makeTaperedCylinder(0.18, 0.18, 3.0, 8, 1), { tx: 2.8, ty: 1.5, tz: -1.9 });
  const forgeGlow = transformGeom(makeEllipsoid(0.7, 0.45, 0.7, 8, 6), { tx: -2.2, ty: 0.75, tz: -0.7 });
  const anvil = transformGeom(makePrism(1.1, 0.65, 0.55, 0.45), { tx: 0.6, ty: 0.45, tz: 0.8 });
  b.addPart('smithy_stone', hearth, 0x334155, { metallic: 0.2, roughness: 0.85 });
  b.addPart('smithy_timber', mergeGeoms([p1, p2, p3]), 0x78350f, { metallic: 0.1, roughness: 0.82 });
  b.addPart('smithy_awning', canopy, 0x9a3412, { metallic: 0.1, roughness: 0.75 });
  b.addPart('smithy_anvil', anvil, 0x1e293b, { metallic: 0.85, roughness: 0.35 });
  b.addPart('smithy_fire', forgeGlow, 0xf97316, { metallic: 0.1, roughness: 0.3, emissiveHex: 0xf97316, emissiveIntensity: 1.2 });
  writeGlb('shop_smithy.glb', b);
}
{
  // Medieval City Wall Segment
  const b = createBuilder();
  const wall = transformGeom(makeOctaWall(14.0, 6.2, 2.8), { ty: 3.1 });
  const merlons = [];
  for (let i = -5; i <= 5; i += 2.5) {
    merlons.push(transformGeom(makeOctaWall(1.4, 1.2, 2.2), { tx: i, ty: 6.7 }));
  }
  b.addPart('city_wall_stone', mergeGeoms([wall, ...merlons]), 0x475569, { metallic: 0.15, roughness: 0.86 });
  writeGlb('city_wall.glb', b);
}
{
  // Grand Medieval City Gatehouse (Twin Towers + Archway)
  const b = createBuilder();
  const tL = transformGeom(makeTaperedCylinder(2.5, 2.2, 10.5, 10, 1), { tx: -5.4, ty: 5.25 });
  const tR = transformGeom(makeTaperedCylinder(2.5, 2.2, 10.5, 10, 1), { tx: 5.4, ty: 5.25 });
  const capL = transformGeom(makeTaperedCylinder(2.7, 0.1, 3.6, 10, 1), { tx: -5.4, ty: 12.2 });
  const capR = transformGeom(makeTaperedCylinder(2.7, 0.1, 3.6, 10, 1), { tx: 5.4, ty: 12.2 });
  const bridge = transformGeom(makeOctaWall(9.5, 2.8, 3.2), { ty: 7.4 });
  b.addPart('gate_towers', mergeGeoms([tL, tR, bridge]), 0x475569, { metallic: 0.18, roughness: 0.82 });
  b.addPart('gate_roofs', mergeGeoms([capL, capR]), 0x7c2d12, { metallic: 0.15, roughness: 0.72 });
  writeGlb('city_gate.glb', b);
}
{
  // Capital Plaza Fountain / Obelisk
  const b = createBuilder();
  const basin = transformGeom(makeTaperedCylinder(3.8, 4.2, 0.9, 12, 1), { ty: 0.45 });
  const spire = transformGeom(makeTaperedCylinder(0.95, 0.35, 5.2, 8, 1), { ty: 3.0 });
  const crystal = transformGeom(makeEllipsoid(0.65, 0.95, 0.65, 8, 6), { ty: 6.2 });
  b.addPart('fountain_stone', mergeGeoms([basin, spire]), 0x64748b, { metallic: 0.2, roughness: 0.65 });
  b.addPart('fountain_crystal', crystal, 0x38bdf8, { metallic: 0.25, roughness: 0.2, emissiveHex: 0x38bdf8, emissiveIntensity: 0.95 });
  writeGlb('fountain_plaza.glb', b);
}

// --- Build Biome Vegetation (.glb) ---
{
  const b = createBuilder();
  const trunk = transformGeom(makeTaperedCylinder(0.45, 0.25, 4.4, 8, 2), { ty: 2.2 });
  const c1 = transformGeom(makeEllipsoid(2.3, 1.8, 2.2, 10, 6), { ty: 5.0 });
  const c2 = transformGeom(makeEllipsoid(1.7, 1.4, 1.7, 8, 5), { tx: 1.1, ty: 4.3, tz: 0.8 });
  const c3 = transformGeom(makeEllipsoid(1.6, 1.4, 1.6, 8, 5), { tx: -1.0, ty: 4.4, tz: -0.7 });
  b.addPart('oak_trunk', trunk, 0x5c3a21, { metallic: 0.05, roughness: 0.9 });
  b.addPart('oak_canopy', mergeGeoms([c1, c2, c3]), 0x2f6f3e, { metallic: 0.05, roughness: 0.82 });
  writeGlb('tree_oak.glb', b);
}
{
  const b = createBuilder();
  const trunk = transformGeom(makeTaperedCylinder(0.35, 0.16, 3.6, 8, 1), { ty: 1.8 });
  const t1 = transformGeom(makeTaperedCylinder(2.3, 0.2, 2.8, 10, 1), { ty: 3.4 });
  const t2 = transformGeom(makeTaperedCylinder(1.8, 0.15, 2.5, 10, 1), { ty: 5.0 });
  const t3 = transformGeom(makeTaperedCylinder(1.2, 0.05, 2.2, 10, 1), { ty: 6.4 });
  b.addPart('pine_trunk', trunk, 0x452b18, { metallic: 0.05, roughness: 0.9 });
  b.addPart('pine_needles', mergeGeoms([t1, t2, t3]), 0xcbd5e1, { metallic: 0.1, roughness: 0.72 });
  writeGlb('tree_pine.glb', b);
}
{
  const b = createBuilder();
  const trunk = transformGeom(makeTaperedCylinder(0.42, 0.22, 4.6, 9, 2), { ty: 2.3, rz: 0.08 });
  const c1 = transformGeom(makeEllipsoid(2.4, 1.4, 2.4, 10, 6), { ty: 5.1 });
  const gem = transformGeom(makeEllipsoid(0.65, 0.85, 0.65, 8, 5), { ty: 5.8 });
  b.addPart('elf_trunk', trunk, 0x4c3b6e, { metallic: 0.15, roughness: 0.75 });
  b.addPart('elf_leaves', c1, 0x10b981, { metallic: 0.15, roughness: 0.65, emissiveHex: 0x059669, emissiveIntensity: 0.3 });
  b.addPart('elf_blossom', gem, 0x5eead4, { metallic: 0.2, roughness: 0.3, emissiveHex: 0x5eead4, emissiveIntensity: 0.8 });
  writeGlb('tree_elf.glb', b);
}
{
  const b = createBuilder();
  const seg1 = transformGeom(makeTaperedCylinder(0.32, 0.26, 2.6, 8, 1), { ty: 1.3, rz: 0.08 });
  const seg2 = transformGeom(makeTaperedCylinder(0.26, 0.18, 2.8, 8, 1), { tx: -0.25, ty: 3.7, rz: 0.16 });
  const fronds = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    fronds.push(transformGeom(makePrism(0.7, 0.12, 2.6, 0.4), {
      tx: -0.45 + Math.sin(ang) * 1.1,
      ty: 4.9,
      tz: Math.cos(ang) * 1.1,
      ry: ang,
      rx: 0.32,
    }));
  }
  b.addPart('palm_trunk', mergeGeoms([seg1, seg2]), 0x78553a, { metallic: 0.05, roughness: 0.88 });
  b.addPart('palm_fronds', mergeGeoms(fronds), 0x65a30d, { metallic: 0.08, roughness: 0.75 });
  writeGlb('tree_palm.glb', b);
}
{
  const b = createBuilder();
  const c1 = transformGeom(makeTaperedCylinder(0.38, 0.18, 3.2, 8, 1), { ty: 1.6, rz: 0.18 });
  const c2 = transformGeom(makeTaperedCylinder(0.32, 0.14, 2.8, 8, 1), { tx: 0.8, ty: 1.4, rz: -0.28 });
  const c3 = transformGeom(makeTaperedCylinder(0.28, 0.12, 2.4, 8, 1), { tx: -0.7, ty: 1.2, tz: 0.6, rx: 0.25 });
  b.addPart('coral_branches', mergeGeoms([c1, c2, c3]), 0x06b6d4, { metallic: 0.2, roughness: 0.45, emissiveHex: 0x0891b2, emissiveIntensity: 0.5 });
  writeGlb('coral_atlans.glb', b);
}
{
  const b = createBuilder();
  const s1 = transformGeom(makeTaperedCylinder(0.85, 0.12, 4.8, 6, 1), { ty: 2.4, rz: 0.08 });
  const s2 = transformGeom(makeTaperedCylinder(0.65, 0.08, 3.6, 6, 1), { tx: 0.9, ty: 1.8, rz: -0.26 });
  b.addPart('volcanic_spire', mergeGeoms([s1, s2]), 0x292524, { metallic: 0.35, roughness: 0.7 });
  const core = transformGeom(makeEllipsoid(0.65, 1.1, 0.65, 6, 4), { ty: 1.4 });
  b.addPart('magma_core', core, 0xf97316, { metallic: 0.2, roughness: 0.3, emissiveHex: 0xf97316, emissiveIntensity: 1.0 });
  writeGlb('crystal_spire.glb', b);
}

// --- Build Medieval Monsters (.glb) — ZERO Minecraft cubes! ---
function buildMonster(filename, kind) {
  const b = createBuilder();
  if (kind === 'bull' || kind === 'yeti' || kind === 'balrog') {
    const color = kind === 'yeti' ? 0xcbd5e1 : kind === 'balrog' ? 0x991b1b : 0x7c2d12;
    const accent = kind === 'yeti' ? 0x38bdf8 : kind === 'balrog' ? 0xf97316 : 0xfef3c7;
    const scale = kind === 'balrog' ? 1.45 : kind === 'yeti' ? 1.2 : 1.0;
    const legs = mergeGeoms([
      transformGeom(makeTaperedCylinder(0.16 * scale, 0.22 * scale, 0.95 * scale, 10, 1), { tx: -0.24 * scale, ty: 0.48 * scale }),
      transformGeom(makeTaperedCylinder(0.16 * scale, 0.22 * scale, 0.95 * scale, 10, 1), { tx: 0.24 * scale, ty: 0.48 * scale }),
    ]);
    const chest = transformGeom(makeEllipsoid(0.54 * scale, 0.62 * scale, 0.42 * scale, 12, 8), { ty: 1.38 * scale });
    const head = transformGeom(makeEllipsoid(0.28 * scale, 0.3 * scale, 0.32 * scale, 10, 6), { ty: 2.02 * scale, tz: 0.1 * scale });
    const hornL = transformGeom(makeTaperedCylinder(0.08 * scale, 0.015 * scale, 0.62 * scale, 8, 1), { tx: -0.32 * scale, ty: 2.25 * scale, rz: 0.65 });
    const hornR = transformGeom(makeTaperedCylinder(0.08 * scale, 0.015 * scale, 0.62 * scale, 8, 1), { tx: 0.32 * scale, ty: 2.25 * scale, rz: -0.65 });
    const arms = mergeGeoms([
      transformGeom(makeTaperedCylinder(0.14 * scale, 0.2 * scale, 0.92 * scale, 10, 1), { tx: -0.62 * scale, ty: 1.32 * scale, rz: 0.22 }),
      transformGeom(makeTaperedCylinder(0.14 * scale, 0.2 * scale, 0.92 * scale, 10, 1), { tx: 0.62 * scale, ty: 1.32 * scale, rz: -0.22 }),
    ]);
    b.addPart('beast_body', mergeGeoms([legs, chest, head, arms]), color, { metallic: 0.25, roughness: 0.65 });
    b.addPart('beast_horns', mergeGeoms([hornL, hornR]), accent, {
      metallic: 0.5, roughness: 0.35,
      emissiveHex: kind === 'balrog' ? 0xf97316 : 0x000000,
      emissiveIntensity: kind === 'balrog' ? 0.85 : 0,
    });
    if (kind === 'balrog') {
      const wingL = transformGeom(makePrism(1.6, 1.0, 0.08, 0.2), { tx: -1.1, ty: 2.1, tz: -0.35, rz: 0.4, ry: 0.25 });
      const wingR = transformGeom(makePrism(1.6, 1.0, 0.08, 0.2), { tx: 1.1, ty: 2.1, tz: -0.35, rz: -0.4, ry: -0.25 });
      b.addPart('demon_wings', mergeGeoms([wingL, wingR]), 0x450a0a, { metallic: 0.3, roughness: 0.5, emissiveHex: 0xdc2626, emissiveIntensity: 0.35 });
    }
  } else if (kind === 'hound') {
    const body = transformGeom(makeEllipsoid(0.32, 0.3, 0.72, 10, 6), { ty: 0.68 });
    const head = transformGeom(makeTaperedCylinder(0.22, 0.1, 0.5, 8, 1), { ty: 0.85, tz: 0.78, rx: Math.PI / 2 });
    const legs = mergeGeoms([
      transformGeom(makeTaperedCylinder(0.07, 0.1, 0.55, 8, 1), { tx: -0.2, ty: 0.28, tz: 0.38 }),
      transformGeom(makeTaperedCylinder(0.07, 0.1, 0.55, 8, 1), { tx: 0.2, ty: 0.28, tz: 0.38 }),
      transformGeom(makeTaperedCylinder(0.07, 0.1, 0.55, 8, 1), { tx: -0.2, ty: 0.28, tz: -0.38 }),
      transformGeom(makeTaperedCylinder(0.07, 0.1, 0.55, 8, 1), { tx: 0.2, ty: 0.28, tz: -0.38 }),
    ]);
    b.addPart('hound_body', mergeGeoms([body, head, legs]), 0x7f1d1d, { metallic: 0.2, roughness: 0.68 });
  } else if (kind === 'skeleton') {
    const ribs = transformGeom(makeTaperedCylinder(0.22, 0.3, 0.82, 10, 2), { ty: 1.25 });
    const legs = mergeGeoms([
      transformGeom(makeTaperedCylinder(0.06, 0.08, 0.85, 8, 1), { tx: -0.15, ty: 0.42 }),
      transformGeom(makeTaperedCylinder(0.06, 0.08, 0.85, 8, 1), { tx: 0.15, ty: 0.42 }),
    ]);
    const skull = transformGeom(makeEllipsoid(0.2, 0.24, 0.22, 10, 6), { ty: 1.88 });
    const sword = transformGeom(makePrism(0.1, 1.0, 0.04, 0.15), { tx: 0.42, ty: 1.25, tz: 0.35, rx: 0.65 });
    b.addPart('skeleton_bones', mergeGeoms([ribs, legs, skull]), 0xe2e8f0, { metallic: 0.2, roughness: 0.55 });
    b.addPart('skeleton_blade', sword, 0x94a3b8, { metallic: 0.85, roughness: 0.3 });
  } else if (kind === 'dragon') {
    const body = transformGeom(makeEllipsoid(0.38, 0.34, 0.72, 10, 6), { ty: 1.2 });
    const neck = transformGeom(makeTaperedCylinder(0.18, 0.12, 0.65, 8, 1), { ty: 1.55, tz: 0.55, rx: 0.65 });
    const tail = transformGeom(makeTaperedCylinder(0.18, 0.03, 0.95, 8, 1), { ty: 1.05, tz: -0.82, rx: -1.1 });
    const wL = transformGeom(makePrism(1.25, 0.65, 0.05, 0.2), { tx: -0.85, ty: 1.55, rz: 0.38 });
    const wR = transformGeom(makePrism(1.25, 0.65, 0.05, 0.2), { tx: 0.85, ty: 1.55, rz: -0.38 });
    b.addPart('dragon_scales', mergeGeoms([body, neck, tail, wL, wR]), 0xb91c1c, { metallic: 0.45, roughness: 0.42 });
  } else if (kind === 'golem') {
    const torso = transformGeom(makeTaperedCylinder(0.55, 0.72, 1.35, 7, 2), { ty: 1.35 });
    const legs = mergeGeoms([
      transformGeom(makeTaperedCylinder(0.24, 0.28, 0.82, 7, 1), { tx: -0.28, ty: 0.41 }),
      transformGeom(makeTaperedCylinder(0.24, 0.28, 0.82, 7, 1), { tx: 0.28, ty: 0.41 }),
    ]);
    const head = transformGeom(makeEllipsoid(0.32, 0.28, 0.3, 7, 5), { ty: 2.15 });
    b.addPart('golem_rock', mergeGeoms([torso, legs, head]), 0x475569, { metallic: 0.3, roughness: 0.82 });
    const core = transformGeom(makeEllipsoid(0.24, 0.28, 0.22, 8, 5), { ty: 1.45, tz: 0.46 });
    b.addPart('golem_core', core, 0x38bdf8, { metallic: 0.2, roughness: 0.2, emissiveHex: 0x38bdf8, emissiveIntensity: 0.9 });
  } else {
    // hydra
    const base = transformGeom(makeTaperedCylinder(0.62, 0.42, 0.9, 10, 1), { ty: 0.45 });
    const n1 = transformGeom(makeTaperedCylinder(0.18, 0.12, 1.55, 8, 2), { ty: 1.45, rx: 0.2 });
    const n2 = transformGeom(makeTaperedCylinder(0.15, 0.1, 1.35, 8, 2), { tx: -0.45, ty: 1.35, rz: 0.28 });
    const n3 = transformGeom(makeTaperedCylinder(0.15, 0.1, 1.35, 8, 2), { tx: 0.45, ty: 1.35, rz: -0.28 });
    b.addPart('hydra_scales', mergeGeoms([base, n1, n2, n3]), 0x0f766e, { metallic: 0.4, roughness: 0.4, emissiveHex: 0x14b8a6, emissiveIntensity: 0.25 });
  }
  writeGlb(filename, b);
}

buildMonster('mon_bull.glb', 'bull');
buildMonster('mon_hound.glb', 'hound');
buildMonster('mon_skeleton.glb', 'skeleton');
buildMonster('mon_dragon.glb', 'dragon');
buildMonster('mon_yeti.glb', 'yeti');
buildMonster('mon_golem.glb', 'golem');
buildMonster('mon_hydra.glb', 'hydra');
buildMonster('mon_balrog.glb', 'balrog');

console.log(`Generated ${fs.readdirSync(OUT_DIR).length} medieval .glb models in public/models/`);
