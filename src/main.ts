import * as THREE from 'three';
import { createWorld } from './world';
import { Drone } from './drone';
import { ManualInput } from './input';
import { Hud } from './hud';
import { Autopilot } from './autopilot';
import type { Sticks, Telemetry } from './types';

const CRUISE_ALT = 30;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const world = createWorld();
const drone = new Drone(world);
world.scene.add(drone.group);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 900);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const hud = new Hud();
const input = new ManualInput();
const autopilot = new Autopilot(180);
let mode: 'manual' | 'auto' = 'manual';
let missionDone = false;
let bannerRequests = -1; // how many Jev decisions the landing banner currently reflects

autopilot.onResponse = (r) => hud.setJev(r);
autopilot.onError = (e) => hud.setJev(null, e);

function setMode(m: 'manual' | 'auto') {
  mode = m;
  hud.setMode(m);
  if (m === 'auto') {
    autopilot.reset();
    hud.setJev(null);
    hud.flash('JEV HAS CONTROL', 'ok', 1500);
  } else {
    hud.flash('MANUAL', '', 1000);
  }
}

function resetMission() {
  drone.reset();
  autopilot.reset();
  missionDone = false;
  hud.clearFlash();
  hud.flash('TAKE OFF FROM A → LAND ON B', '', 3000);
}

input.onKey = (code) => {
  if (code === 'KeyJ') setMode(mode === 'auto' ? 'manual' : 'auto');
  if (code === 'KeyR') resetMission();
};

function showLandingBanner() {
  const st = autopilot.stats;
  const flightSeconds = ((st.endedAt || performance.now()) - st.startedAt) / 1000;
  const sub =
    mode === 'auto' && st.requests > 0
      ? `JEV: ${(st.inputTokens + st.outputTokens).toLocaleString()} TOKENS · ${st.requests} DECISIONS · ${flightSeconds.toFixed(0)} S · IN ${st.inputTokens.toLocaleString()} / OUT ${st.outputTokens.toLocaleString()}`
      : undefined;
  bannerRequests = st.requests;
  hud.flash(`LANDED ON B · ${drone.landingSpeed.toFixed(1)} m/s`, 'ok', 0, sub);
}

function buildTelemetry(): Telemetry {
  const fwd = drone.forward();
  const rgt = drone.right();
  const toPad = new THREE.Vector3(world.landingPad.x - drone.position.x, 0, world.landingPad.z - drone.position.z);
  const padForward = toPad.dot(fwd);
  const padRight = toPad.dot(rgt);
  const bearing = THREE.MathUtils.radToDeg(Math.atan2(padRight, padForward));
  const tallest = drone.tallestOnPath();
  return {
    phase: drone.phase,
    altitude: drone.altitude,
    verticalSpeed: drone.velocity.y,
    groundSpeed: Math.hypot(drone.velocity.x, drone.velocity.z),
    distanceToPad: drone.distanceToPad(),
    bearingToPad: bearing,
    padForward,
    padRight,
    velocityForward: drone.velocity.dot(fwd),
    velocityRight: drone.velocity.dot(rgt),
    obstacleAhead: drone.obstacleAhead(),
    tallestObstacleOnPath: tallest,
    // Cruise clears whatever is on the direct line to the pad.
    cruiseAltitude: Math.max(CRUISE_ALT, tallest + 8),
    padRadius: world.padRadius,
  };
}

function updateCamera() {
  // Third person chase camera: behind and above the drone, smoothed
  const behind = drone.forward().multiplyScalar(-6);
  const desired = drone.position.clone().add(behind).add(new THREE.Vector3(0, 2.2, 0));
  camera.position.lerp(desired, 0.12);
  camera.lookAt(drone.position.clone().add(new THREE.Vector3(0, 0.3, 0)));
}

let last = performance.now();
let telemetry = buildTelemetry();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  telemetry = buildTelemetry();
  let sticks: Sticks;
  if (mode === 'auto') {
    // Any manual input snatches control back
    const manual = input.read(dt);
    if (Math.abs(manual.throttle) + Math.abs(manual.yaw) + Math.abs(manual.pitch) + Math.abs(manual.roll) > 0.5) {
      setMode('manual');
      sticks = manual;
    } else {
      sticks = autopilot.update(now, dt, telemetry);
    }
  } else {
    sticks = input.read(dt);
  }

  drone.step(dt, sticks);

  if (!missionDone) {
    if (drone.phase === 'landed') {
      missionDone = true;
      if (drone.onPad()) showLandingBanner();
      else if (drone.distanceToPad() < 2 * world.padRadius) hud.flash('LANDED · JUST OFF THE PAD', '', 0);
      else hud.flash('LANDED · WRONG SPOT', 'bad', 0);
    } else if (drone.phase === 'crashed') {
      missionDone = true;
      hud.flash('CRASHED · PRESS R', 'bad', 0);
    }
  }

  // The final "cut motors" answer arrives just after touchdown; keep the banner totals exact.
  if (missionDone && drone.phase === 'landed' && mode === 'auto' && drone.onPad() && autopilot.stats.requests !== bannerRequests) {
    showLandingBanner();
  }

  updateCamera();
  if (mode === 'auto') hud.setFlightStats(autopilot.stats);
  hud.setSticks(sticks, mode, drone.motorsOn);
  hud.setTelemetry({
    alt: drone.altitude,
    vs: drone.velocity.y,
    spd: telemetry.groundSpeed,
    dist: telemetry.distanceToPad,
    hdg: drone.headingDeg,
    phase: drone.phase,
    bearing: telemetry.bearingToPad,
  });

  renderer.render(world.scene, camera);
  requestAnimationFrame(frame);
}

resetMission();
hud.setMode('manual');
document.getElementById('seed')!.textContent = String(world.seed);
requestAnimationFrame(frame);
