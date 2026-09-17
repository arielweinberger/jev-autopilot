import * as THREE from 'three';
import type { Controls, Phase } from './types';
import type { Vec2 } from './roads';

const WHEELBASE = 2.7;
const MAX_STEER = THREE.MathUtils.degToRad(34);
const MAX_SPEED = 17; // m/s ≈ 61 km/h
const ACCEL = 4.5;
const BRAKE = 8;
const STEER_RATE = 3.5; // rad/s at the wheels

export class Car {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  /** Three.js yaw: 0 = facing -Z (north), positive = counter-clockwise from above. */
  yaw = 0;
  speed = 0; // m/s, forward only
  steerAngle = 0;
  phase: Phase = 'ready';
  private frontWheels: THREE.Object3D[] = [];
  private wheels: THREE.Mesh[] = [];

  constructor() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4d3d, roughness: 0.35, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.3), bodyMat);
    body.position.y = 0.65; body.castShadow = true; this.group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.2, metalness: 0.4 }));
    cabin.position.set(0, 1.2, -0.1); cabin.castShadow = true; this.group.add(cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const [sx, sz] of [[1, -1.35], [-1, -1.35], [1, 1.35], [-1, 1.35]] as const) {
      const pivot = new THREE.Object3D();
      pivot.position.set(sx * 0.95, 0.36, sz);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      pivot.add(w);
      this.group.add(pivot);
      this.wheels.push(w);
      if (sz < 0) this.frontWheels.push(pivot);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c0 });
    for (const sx of [-0.6, 0.6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), lampMat); l.position.set(sx, 0.7, -2.15); this.group.add(l); }
  }

  place(pos: Vec2, dir: Vec2) {
    this.position.set(pos.x, 0, pos.z);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.speed = 0; this.steerAngle = 0; this.phase = 'ready';
    this.sync();
  }

  forward(): Vec2 { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  right(): Vec2 { const f = this.forward(); return { x: -f.z, z: f.x }; }
  pos2(): Vec2 { return { x: this.position.x, z: this.position.z }; }

  step(dt: number, c: Controls) {
    if (this.phase === 'crashed' || this.phase === 'arrived') { this.sync(); return; }
    if (this.phase === 'ready' && c.throttle > 0.05) this.phase = 'driving';

    // Speed-sensitive steering lock, like power steering that firms up at speed
    const lock = MAX_STEER * THREE.MathUtils.clamp(1 - this.speed / 45, 0.35, 1);
    const target = THREE.MathUtils.clamp(c.steer, -1, 1) * lock;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -STEER_RATE * dt, STEER_RATE * dt);

    const drag = 0.012 * this.speed * this.speed + 0.25;
    const accel = c.throttle * ACCEL - c.brake * BRAKE - drag;
    this.speed = THREE.MathUtils.clamp(this.speed + accel * dt, 0, MAX_SPEED);

    // Kinematic bicycle model. Right steer = clockwise = negative Three.js yaw.
    const yawRate = (this.speed / WHEELBASE) * Math.tan(this.steerAngle);
    this.yaw -= yawRate * dt;
    const f = this.forward();
    this.position.x += f.x * this.speed * dt;
    this.position.z += f.z * this.speed * dt;
    for (const w of this.wheels) w.rotation.x += (this.speed / 0.36) * dt;
    this.sync();
  }

  private sync() {
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.yaw, 0);
    for (const p of this.frontWheels) p.rotation.y = -this.steerAngle;
  }
}
