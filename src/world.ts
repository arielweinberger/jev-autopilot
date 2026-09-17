import * as THREE from 'three';
import { RoadNetwork, SPACING, ROAD_HALF, ISEC_HALF, STOP_LINE, GRID, rightOf, pickTrip, type Vec2 } from './roads';

export interface Building { box: THREE.Box3; height: number }

export interface World {
  scene: THREE.Scene;
  net: RoadNetwork;
  buildings: Building[];
  seed: number;
  /** Start street (u -> v) and destination street (p, q) with the marker at its midpoint. */
  start: { u: number; v: number };
  dest: { p: number; q: number; pos: Vec2 };
  /** Call every frame to animate the traffic lights. */
  updateLights(t: number): void;
}

function groundTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4f7a3a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`; ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  return t;
}

export function createWorld(): World {
  const params = new URLSearchParams(location.search);
  const seedParam = Number(params.get('seed'));
  const seed = Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : 1 + Math.floor(Math.random() * 2147483646);
  const net = new RoadNetwork(seed);
  const rand = () => net.random();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb8dc);
  scene.fog = new THREE.Fog(0x9fc4e2, 150, 520);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1d9, 2.0);
  sun.position.set(120, 180, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -320;
  sun.shadow.camera.right = sun.shadow.camera.top = 320;
  sun.shadow.camera.far = 600;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.95 });
  const white = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xe6c440 });
  const flat = (w: number, l: number, mat: THREE.Material, x: number, z: number, y: number, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rotY;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  for (const [a, b] of net.edges()) {
    const A = net.node(a).pos, B = net.node(b).pos;
    const d = net.dir(a, b);
    const mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    const L = SPACING;
    const rot = d.x !== 0 ? Math.PI / 2 : 0;
    flat(ROAD_HALF * 2, L, asphalt, mid.x, mid.z, 0.02, rot);
    // edge lines and dashed center line (between the intersections only)
    const inner = L - 2 * ISEC_HALF;
    const r = rightOf(d);
    flat(0.2, inner, white, mid.x + r.x * (ROAD_HALF - 0.3), mid.z + r.z * (ROAD_HALF - 0.3), 0.03, rot);
    flat(0.2, inner, white, mid.x - r.x * (ROAD_HALF - 0.3), mid.z - r.z * (ROAD_HALF - 0.3), 0.03, rot);
    for (let s = -inner / 2 + 2; s < inner / 2 - 2; s += 6) flat(0.2, 3, yellow, mid.x + d.x * s, mid.z + d.z * s, 0.03, rot);
  }
  // Intersections, stop lines and traffic lights
  const lightBulbs: { mesh: THREE.Mesh; node: number; dir: Vec2; color: 'green' | 'yellow' | 'red' }[] = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x33363b });
  const bulbOff = { green: 0x0e3a1c, yellow: 0x4a3c0a, red: 0x3d0d0d } as const;
  const bulbOn = { green: 0x3ddc63, yellow: 0xffc830, red: 0xff3b3b } as const;
  for (const n of net.nodes) {
    if (net.adj.get(n.id)!.size === 0) continue;
    flat(ISEC_HALF * 2, ISEC_HALF * 2, asphalt, n.pos.x, n.pos.z, 0.025);
    for (const m of net.adj.get(n.id)!) {
      const d = net.dir(m, n.id); // direction of traffic arriving at n from m
      const r = rightOf(d);
      const sl = { x: n.pos.x - d.x * STOP_LINE, z: n.pos.z - d.z * STOP_LINE };
      // stop line across the arriving lane
      flat(ROAD_HALF, 0.4, white, sl.x + r.x * (ROAD_HALF / 2), sl.z + r.z * (ROAD_HALF / 2), 0.03, d.x !== 0 ? Math.PI / 2 : 0);
      if (!n.hasLight) continue;
      const px = sl.x + r.x * (ROAD_HALF + 1.2), pz = sl.z + r.z * (ROAD_HALF + 1.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.5, 8), poleMat);
      pole.position.set(px, 2.75, pz);
      scene.add(pole);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), poleMat);
      housing.position.set(px, 4.8, pz);
      scene.add(housing);
      (['red', 'yellow', 'green'] as const).forEach((color, k) => {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color: bulbOff[color] }));
        // bulbs face the arriving traffic
        bulb.position.set(px - d.x * 0.3, 5.3 - k * 0.5, pz - d.z * 0.3);
        scene.add(bulb);
        lightBulbs.push({ mesh: bulb, node: n.id, dir: d, color });
      });
    }
  }

  // Buildings inside each block, never overlapping each other or the roads
  const buildings: Building[] = [];
  const palette = [0x8d99ae, 0xb8c0cc, 0x6d7a8c, 0xa3adba, 0x5c6b7a, 0xc9b79c, 0x9c8d7a];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const half = (GRID - 1) / 2;
  const cells: { x: number; z: number; w: number; d: number }[] = [];
  for (let j = -1; j < GRID; j++) for (let i = -1; i < GRID; i++) {
    const cx = (i + 0.5 - half) * SPACING, cz = (j + 0.5 - half) * SPACING;
    const inner = SPACING / 2 - ROAD_HALF - 5;
    const count = 2 + Math.floor(rand() * 4);
    for (let k = 0, tries = 0; k < count && tries < 40; tries++) {
      const w = 10 + rand() * 16, d = 10 + rand() * 16;
      const x = cx + (rand() - 0.5) * 2 * (inner - w / 2), z = cz + (rand() - 0.5) * 2 * (inner - d / 2);
      if (cells.some((c) => Math.abs(c.x - x) < (c.w + w) / 2 + 3 && Math.abs(c.z - z) < (c.d + d) / 2 + 3)) continue;
      const h = 5 + rand() * rand() * 30;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: palette[Math.floor(rand() * palette.length)], roughness: 0.85 }));
      m.scale.set(w, h, d);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      buildings.push({ box: new THREE.Box3().setFromObject(m), height: h });
      cells.push({ x, z, w, d });
      k++;
    }
  }
  // Trees on the sidewalks
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6), crownGeo = new THREE.ConeGeometry(1.5, 3.6, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e }), crownMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32 });
  for (const [a, b] of net.edges()) {
    const A = net.node(a).pos, d = net.dir(a, b), r = rightOf(d);
    for (let s = ISEC_HALF + 6; s < SPACING - ISEC_HALF - 4; s += 12) for (const side of [1, -1]) {
      if (rand() < 0.35) continue;
      const x = A.x + d.x * s + r.x * side * (ROAD_HALF + 2.5), z = A.z + d.z * s + r.z * side * (ROAD_HALF + 2.5);
      if (cells.some((c) => Math.abs(c.x - x) < c.w / 2 + 1.5 && Math.abs(c.z - z) < c.d / 2 + 1.5)) continue;
      const t = new THREE.Mesh(trunkGeo, trunkMat); t.position.set(x, 1, z);
      const cr = new THREE.Mesh(crownGeo, crownMat); cr.position.set(x, 3.6, z); cr.castShadow = true;
      scene.add(t, cr);
    }
  }

  const { start, dest } = pickTrip(net);

  // Markers
  const marker = (pos: Vec2, color: number, label: string) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 64, 70);
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    letter.rotation.x = -Math.PI / 2; letter.position.y = 0.06; g.add(letter);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.8, 70, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    beacon.position.y = 35; g.add(beacon);
    g.position.set(pos.x, 0, pos.z);
    scene.add(g);
  };
  const sd = net.dir(start.u, start.v), sp = net.laneStart(start.u, start.v);
  marker({ x: sp.x + sd.x * 4, z: sp.z + sd.z * 4 }, 0x3ddc97, 'A');
  marker(dest.pos, 0xff8a3d, 'B');

  console.info(`[world] seed=${seed} streets=${net.edges().length} buildings=${buildings.length} (pin with ?seed=${seed})`);

  return {
    scene, net, buildings, seed, start, dest,
    updateLights(t) {
      for (const b of lightBulbs) {
        const state = net.light(b.node, b.dir, t);
        (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(state === b.color ? bulbOn[b.color] : bulbOff[b.color]);
      }
    },
  };
}
