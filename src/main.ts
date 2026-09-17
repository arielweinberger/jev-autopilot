import * as THREE from 'three';
import { createWorld } from './world';
import { Car } from './car';
import { Trip } from './trip';
import { ManualInput } from './input';
import { Hud } from './hud';
import { Autopilot } from './autopilot';
import type { Controls } from './types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const world = createWorld();
const car = new Car();
world.scene.add(car.group);
const trip = new Trip(world.net, { start: world.start, dest: world.dest }, car, world.buildings.map((b) => b.box));

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const hud = new Hud();
const input = new ManualInput();
const autopilot = new Autopilot(180);
let mode: 'manual' | 'auto' = 'manual';
let arrivedByJev = false;
let bannerRequests = -1;

autopilot.onResponse = (r) => hud.setJev(r);
autopilot.onError = (e) => hud.setJev(null, e);
autopilot.onManeuver = (m) => trip.commitManeuver(m);
autopilot.onArrived = () => (arrivedByJev = true);

function resetTrip() {
  trip.reset();
  arrivedByJev = false; bannerRequests = -1;
  autopilot.reset();
  hud.clearFlash();
  hud.flash('DRIVE FROM A → B', '', 3000);
}

function setMode(m: 'manual' | 'auto') {
  mode = m;
  hud.setMode(m);
  if (m === 'auto') { autopilot.reset(); hud.setJev(null); hud.flash('JEV IS DRIVING', 'ok', 1500); }
  else hud.flash('MANUAL', '', 1000);
}

function updateCamera() {
  const f = car.forward();
  const desired = new THREE.Vector3(car.position.x - f.x * 10, 4.5, car.position.z - f.z * 10);
  camera.position.lerp(desired, 0.08);
  camera.lookAt(car.position.x + f.x * 6, 1, car.position.z + f.z * 6);
}

function showBanner() {
  const st = autopilot.stats;
  const secs = trip.simTime;
  const sub =
    mode === 'auto' && st.requests > 0
      ? `JEV: ${(st.inputTokens + st.outputTokens).toLocaleString()} TOKENS · ${st.requests} DECISIONS · ${secs.toFixed(0)} S · RED LIGHTS RUN: ${trip.redLightsRun}`
      : `${secs.toFixed(0)} S · RED LIGHTS RUN: ${trip.redLightsRun}`;
  bannerRequests = st.requests;
  hud.flash('ARRIVED AT B', 'ok', 0, sub);
}

input.onKey = (code) => {
  if (code === 'KeyJ') setMode(mode === 'auto' ? 'manual' : 'auto');
  if (code === 'KeyR') resetTrip();
};

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const telemetry = trip.telemetry();
  let controls: Controls;
  if (mode === 'auto') {
    const manual = input.read(dt);
    if (input.active()) { setMode('manual'); controls = manual; }
    else controls = autopilot.update(now, dt, telemetry);
  } else controls = input.read(dt);

  for (const ev of trip.step(dt, controls, mode === 'auto', arrivedByJev)) {
    if (ev === 'red_light') hud.flash('RAN A RED LIGHT', 'bad', 1500);
    if (ev === 'crash_building') hud.flash('CRASHED INTO A BUILDING · PRESS R', 'bad', 0);
    if (ev === 'crash_offroad') hud.flash('LEFT THE ROAD · PRESS R', 'bad', 0);
    if (ev === 'arrived') { if (!autopilot.stats.endedAt) autopilot.stats.endedAt = performance.now(); showBanner(); }
  }
  if (trip.done && car.phase === 'arrived' && mode === 'auto' && autopilot.stats.requests !== bannerRequests) showBanner();

  world.updateLights(trip.simTime);
  updateCamera();
  if (mode === 'auto') hud.setFlightStats(autopilot.stats);
  hud.setControls(controls, mode);
  hud.setTelemetry({
    kmh: car.speed * 3.6,
    light: telemetry.light ?? '–',
    next: trip.committed ? trip.committed.replace('_', ' ') : '–',
    dist: telemetry.distanceToDestination,
    phase: car.phase,
    reds: trip.redLightsRun,
  });
  hud.drawMinimap(world.net, car.pos2(), car.forward(), world.dest.pos, trip.route);

  renderer.render(world.scene, camera);
  requestAnimationFrame(frame);
}

resetTrip();
hud.setMode('manual');
document.getElementById('seed')!.textContent = String(world.seed);
// Dev aid: inspect the live state from the browser console.
(window as unknown as { __sim: () => unknown }).__sim = () => ({ trip, mode, telemetry: trip.telemetry(), renderer, scene: world.scene, camera });
requestAnimationFrame(frame);
