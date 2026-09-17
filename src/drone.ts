import * as THREE from 'three';
import type { Sticks, Phase } from './types';
import type { World } from './world';

const G = 9.81;
const MAX_TILT = THREE.MathUtils.degToRad(28); // DJI N-mode style angle limit
const MAX_VS = 5; // m/s
const MAX_YAW_RATE = THREE.MathUtils.degToRad(140);
const DRAG = 0.28; // horizontal drag coefficient
const TILT_RESPONSE = 7; // how fast the body reaches the commanded tilt
const VS_RESPONSE = 4;

export class Drone {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Yaw, radians, Three.js convention: 0 = facing -Z (north), positive = counter-clockwise from above. */
  yaw = 0;
  /** Compass heading in degrees, clockwise from north. */
  get headingDeg() {
    return ((-THREE.MathUtils.radToDeg(this.yaw) % 360) + 360) % 360;
  }
  pitch = 0; // body tilt, radians, positive nose-down
  roll = 0; // body tilt, radians, positive right-down
  phase: Phase = 'grounded';
  motorsOn = false;
  landingSpeed = 0;
  private rotors: THREE.Mesh[] = [];
  private spin = 0;

  constructor(private world: World) {
    this.buildMesh();
    this.reset();
  }

  private buildMesh() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5, metalness: 0.4 }),
    );
    body.castShadow = true;
    this.group.add(body);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.6 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0xff8a3d }));
    nose.position.set(0, 0.03, -0.2);
    this.group.add(nose);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.34), armMat);
      arm.position.set(sx * 0.14, 0, sz * 0.14);
      arm.rotation.y = Math.atan2(sx, sz);
      this.group.add(arm);
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), rotorMat);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(sx * 0.26, 0.04, sz * 0.26);
      this.group.add(rotor);
      this.rotors.push(rotor);
    }
  }

  reset() {
    this.position.copy(this.world.launchPad).setY(0.25);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.atan2(-(this.world.landingPad.x - this.world.launchPad.x), -(this.world.landingPad.z - this.world.launchPad.z)) + THREE.MathUtils.degToRad(35);
    this.pitch = this.roll = 0;
    this.phase = 'grounded';
    this.motorsOn = false;
    this.landingSpeed = 0;
    this.sync();
  }

  /** Height above the ground below the drone (the map is flat, so AGL = y - hover offset). */
  get altitude() {
    return Math.max(0, this.position.y - 0.25);
  }

  /** Unit vector the nose points at, horizontal. */
  forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  step(dt: number, s: Sticks) {
    if (this.phase === 'crashed') { this.sync(); return; }

    // Arm on first throttle-up, disarm when landed
    if (this.phase === 'grounded' && s.throttle > 0.15) {
      this.motorsOn = true;
      this.phase = 'airborne';
    }
    if (this.phase === 'grounded' || this.phase === 'landed') {
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0, dt * 5);
      this.roll = THREE.MathUtils.lerp(this.roll, 0, dt * 5);
      this.spin += dt * (this.motorsOn ? 40 : 0);
      this.sync();
      return;
    }

    // Attitude follows the sticks (self-leveling)
    const targetPitch = s.pitch * MAX_TILT;
    const targetRoll = s.roll * MAX_TILT;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * TILT_RESPONSE);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * TILT_RESPONSE);
    // Stick right (+) turns the nose clockwise, which is negative yaw in Three.js.
    this.yaw -= s.yaw * MAX_YAW_RATE * dt;

    // Horizontal acceleration from tilt
    const fwd = this.forward();
    const rgt = this.right();
    const ax = G * Math.tan(this.pitch);
    const ay = G * Math.tan(this.roll);
    const accel = new THREE.Vector3().addScaledVector(fwd, ax).addScaledVector(rgt, ay);
    const horiz = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    accel.addScaledVector(horiz, -DRAG * (1 + horiz.length() * 0.15));
    this.velocity.x += accel.x * dt;
    this.velocity.z += accel.z * dt;

    // Vertical speed follows throttle (altitude hold when centered)
    const targetVS = s.throttle * MAX_VS;
    this.velocity.y += (targetVS - this.velocity.y) * Math.min(1, dt * VS_RESPONSE);

    this.position.addScaledVector(this.velocity, dt);
    this.spin += dt * (30 + s.throttle * 20);

    // Ground contact
    if (this.position.y <= 0.25) {
      this.position.y = 0.25;
      const impact = -this.velocity.y;
      const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      this.landingSpeed = impact;
      this.velocity.set(0, 0, 0);
      if (impact > 3.5 || horizSpeed > 3) {
        this.phase = 'crashed';
      } else {
        this.phase = 'landed';
        this.motorsOn = false;
      }
    }

    // Building collision
    for (const b of this.world.buildings) {
      if (b.box.containsPoint(this.position)) {
        this.phase = 'crashed';
        this.velocity.set(0, 0, 0);
        break;
      }
    }
    this.sync();
  }

  private sync() {
    this.group.position.copy(this.position);
    // Order: yaw, then pitch (nose down about local X), then roll (about local Z)
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(this.yaw);
    this.group.rotateX(-this.pitch);
    this.group.rotateZ(-this.roll);
    for (const r of this.rotors) r.rotation.z = this.spin;
  }

  /** Landed within the pad radius? */
  onPad(): boolean {
    const d = Math.hypot(this.position.x - this.world.landingPad.x, this.position.z - this.world.landingPad.z);
    return d <= this.world.padRadius;
  }

  distanceToPad(): number {
    return Math.hypot(this.position.x - this.world.landingPad.x, this.position.z - this.world.landingPad.z);
  }

  /** Nearest building intersected by a forward ray at the current altitude, within `range` meters. */
  obstacleAhead(range = 60): number | null {
    const dir = this.forward();
    const ray = new THREE.Ray(this.position.clone(), dir);
    let best: number | null = null;
    const hit = new THREE.Vector3();
    for (const b of this.world.buildings) {
      if (ray.intersectBox(b.box, hit)) {
        const d = hit.distanceTo(this.position);
        if (d < range && (best === null || d < best)) best = d;
      }
    }
    return best;
  }

  /** Tallest building whose footprint is within `corridor` meters of the straight line to the pad. */
  tallestOnPath(corridor = 6): number {
    const a = new THREE.Vector3(this.position.x, 0, this.position.z);
    const b = new THREE.Vector3(this.world.landingPad.x, 0, this.world.landingPad.z);
    const ab = b.clone().sub(a);
    const len = ab.length();
    if (len < 1) return 0;
    ab.divideScalar(len);
    let tallest = 0;
    for (const bl of this.world.buildings) {
      const c = bl.box.getCenter(new THREE.Vector3()).setY(0);
      const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab), 0, len);
      const closest = a.clone().addScaledVector(ab, t);
      const size = bl.box.getSize(new THREE.Vector3());
      const halfDiag = Math.hypot(size.x, size.z) / 2;
      if (closest.distanceTo(c) < halfDiag + corridor) tallest = Math.max(tallest, bl.height);
    }
    return tallest;
  }
}
