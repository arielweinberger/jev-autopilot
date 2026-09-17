import * as THREE from 'three';

export interface Building {
  box: THREE.Box3;
  height: number;
}

export interface World {
  scene: THREE.Scene;
  launchPad: THREE.Vector3;
  landingPad: THREE.Vector3;
  padRadius: number;
  buildings: Building[];
  /** Layout seed; pass as ?seed= to reproduce this map. */
  seed: number;
}

const PAD_RADIUS = 4;

function makeGroundTexture(): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2f5d34';
  ctx.fillRect(0, 0, size, size);
  // subtle noise
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.anisotropy = 8;
  return tex;
}

function makePad(color: number, label: string): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 }),
  );
  base.position.y = 0.1;
  base.receiveShadow = true;
  g.add(base);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PAD_RADIUS - 0.5, PAD_RADIUS - 0.1, 64),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.21;
  g.add(ring);

  // Letter marker painted on the pad
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 200px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  const letter = new THREE.Mesh(
    new THREE.PlaneGeometry(PAD_RADIUS, PAD_RADIUS),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  letter.rotation.x = -Math.PI / 2;
  letter.position.y = 0.22;
  g.add(letter);

  // Light beacon pillar so the pad is visible from a distance
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.position.y = 30;
  g.add(beacon);

  const light = new THREE.PointLight(color, 40, 30);
  light.position.y = 2;
  g.add(light);
  return g;
}

export function createWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b4d8);
  scene.fog = new THREE.Fog(0x9cc3e0, 120, 420);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3b4a2f, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(80, 140, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -200;
  sun.shadow.camera.right = sun.shadow.camera.top = 200;
  sun.shadow.camera.far = 400;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const launchPad = new THREE.Vector3(0, 0, 0);
  const landingPad = new THREE.Vector3(150, 0, -120);

  const padA = makePad(0x3ddc97, 'A');
  padA.position.copy(launchPad);
  scene.add(padA);
  const padB = makePad(0xff8a3d, 'B');
  padB.position.copy(landingPad);
  scene.add(padB);

  // Random city layout, new on every refresh. Pin one with ?seed=123.
  const params = new URLSearchParams(location.search);
  const seedParam = Number(params.get('seed'));
  let seed = Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : 1 + Math.floor(Math.random() * 2147483646);
  const layoutSeed = seed;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const MAP_HALF = 210; // buildings and trees live inside ±MAP_HALF
  const PAD_CLEAR = 22; // radius around each pad kept free of buildings
  const footprints: { x: number; z: number; w: number; d: number }[] = [];
  const overlaps = (x: number, z: number, w: number, d: number, margin: number) =>
    footprints.some((f) => Math.abs(f.x - x) < (f.w + w) / 2 + margin && Math.abs(f.z - z) < (f.d + d) / 2 + margin);
  const nearPad = (x: number, z: number, r: number) =>
    Math.hypot(x - launchPad.x, z - launchPad.z) < r || Math.hypot(x - landingPad.x, z - landingPad.z) < r;

  const buildings: Building[] = [];
  const palette = [0x8d99ae, 0xb8c0cc, 0x6d7a8c, 0xa3adba, 0x5c6b7a, 0x9aa5b1];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const targetCount = 110 + Math.floor(rand() * 40);
  for (let attempt = 0; attempt < 4000 && buildings.length < targetCount; attempt++) {
    const w = 7 + rand() * 12;
    const d = 7 + rand() * 12;
    const x = (rand() - 0.5) * 2 * MAP_HALF;
    const z = (rand() - 0.5) * 2 * MAP_HALF;
    if (nearPad(x, z, PAD_CLEAR + Math.max(w, d) / 2)) continue;
    if (overlaps(x, z, w, d, 4)) continue;
    const h = 6 + rand() * rand() * 36;
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: palette[Math.floor(rand() * palette.length)], roughness: 0.8 }));
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    buildings.push({ box: new THREE.Box3().setFromObject(m), height: h });
    footprints.push({ x, z, w, d });
  }

  // Trees: never inside or touching a building, never on a pad, never on top of each other.
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
  const crownGeo = new THREE.ConeGeometry(1.6, 4, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32 });
  const trees: { x: number; z: number }[] = [];
  const treeTarget = 140;
  for (let attempt = 0; attempt < 3000 && trees.length < treeTarget; attempt++) {
    const x = (rand() - 0.5) * 2 * MAP_HALF;
    const z = (rand() - 0.5) * 2 * MAP_HALF;
    if (nearPad(x, z, PAD_RADIUS + 4)) continue;
    if (overlaps(x, z, 3.2, 3.2, 1.5)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    const t = new THREE.Mesh(trunkGeo, trunkMat);
    t.position.set(x, 1, z);
    const cr = new THREE.Mesh(crownGeo, crownMat);
    cr.position.set(x, 4, z);
    cr.castShadow = true;
    scene.add(t, cr);
    trees.push({ x, z });
  }

  console.info(`[world] seed=${layoutSeed} buildings=${buildings.length} trees=${trees.length}  (pin with ?seed=${layoutSeed})`);

  return { scene, launchPad, landingPad, padRadius: PAD_RADIUS, buildings, seed: layoutSeed };
}
