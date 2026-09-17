import * as THREE from 'three';
import { buildPath, dot, len, leftOf, rightOf, DIRS, ISEC_HALF, STOP_LINE, SPACING, ROAD_HALF, type RoadNetwork, type Vec2, type Path } from './roads';
import type { Car } from './car';
import type { Controls, Telemetry, Maneuver } from './types';

export interface TripSpec { start: { u: number; v: number }; dest: { p: number; q: number; pos: Vec2 } }
export type TripEvent = 'red_light' | 'crash_building' | 'crash_offroad' | 'arrived';

/** Everything about the drive that is not rendering: streets, path, telemetry, rules. Runs in the browser and headless. */
export class Trip {
  route: number[] = [];
  committed: Maneuver | null = null;
  path!: Path;
  insideNode: number | null = null;
  prevStopDist = Infinity;
  redLightsRun = 0;
  simTime = 0;
  private stoppedNearDestSince = -1;
  done = false;

  constructor(public net: RoadNetwork, public spec: TripSpec, public car: Car, public buildings: THREE.Box3[] = []) {
    this.reset();
  }

  reset() {
    this.route = [this.spec.start.u, this.spec.start.v];
    this.committed = null;
    this.path = buildPath(this.net, this.route);
    this.insideNode = null; this.prevStopDist = Infinity; this.redLightsRun = 0; this.simTime = 0; this.stoppedNearDestSince = -1; this.done = false;
    const d = this.net.dir(this.route[0], this.route[1]);
    const p = this.net.laneStart(this.route[0], this.route[1]);
    this.car.place({ x: p.x + d.x * 4, z: p.z + d.z * 4 }, d);
  }

  commitManeuver(m: Maneuver): boolean {
    if (this.committed || this.route.length !== 2) return false;
    const [u, v] = this.route;
    const w = this.net.neighbor(v, this.net.maneuverDir(this.net.dir(u, v), m));
    if (w === null) return false;
    this.committed = m;
    this.route = [u, v, w];
    this.path = buildPath(this.net, this.route);
    return true;
  }

  /** The exit that points most toward B. Code fallback so the car never reaches an intersection without a plan. */
  fallbackManeuver(): Maneuver {
    const [u, v] = this.route;
    const d = this.net.dir(u, v);
    const nv = this.net.node(v).pos;
    const toDest = { x: this.spec.dest.pos.x - nv.x, z: this.spec.dest.pos.z - nv.z };
    let best: Maneuver = 'go_straight', bestScore = -Infinity;
    for (const [m, dir] of [['go_straight', d], ['turn_left', leftOf(d)], ['turn_right', rightOf(d)]] as [Maneuver, Vec2][]) {
      if (this.net.neighbor(v, dir) === null) continue;
      const score = dot(dir, toDest);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  onRoad(p: Vec2): boolean {
    for (const n of this.net.nodes) if (this.net.adj.get(n.id)!.size && Math.abs(p.x - n.pos.x) <= ISEC_HALF + 0.6 && Math.abs(p.z - n.pos.z) <= ISEC_HALF + 0.6) return true;
    for (const [a, b] of this.net.edges()) {
      const A = this.net.node(a).pos, d = this.net.dir(a, b);
      const rel = { x: p.x - A.x, z: p.z - A.z };
      if (dot(rel, d) >= 0 && dot(rel, d) <= SPACING && Math.abs(dot(rel, rightOf(d))) <= ROAD_HALF + 0.6) return true;
    }
    return false;
  }

  /** Track which street the car is on as it drives through intersections. Works for human and Jev alike. */
  private trackStreet() {
    const p = this.car.pos2();
    const v = this.route[1];
    const nv = this.net.node(v);
    const inside = Math.abs(p.x - nv.pos.x) <= ISEC_HALF + 1 && Math.abs(p.z - nv.pos.z) <= ISEC_HALF + 1;
    if (inside) this.insideNode = v;
    else if (this.insideNode === v) {
      const out = { x: p.x - nv.pos.x, z: p.z - nv.pos.z };
      let bestDir = DIRS[0], bestDot = -Infinity;
      for (const d of DIRS) { const s = dot(d, out); if (s > bestDot) { bestDot = s; bestDir = d; } }
      const w = this.net.neighbor(v, bestDir);
      this.insideNode = null;
      if (w !== null) { this.route = [v, w]; this.committed = null; this.path = buildPath(this.net, this.route); this.prevStopDist = Infinity; }
    }
  }

  telemetry(): Telemetry {
    const car = this.car, net = this.net;
    const p = car.pos2();
    const heading = car.forward(), right = car.right();
    const cp = this.path.closest(p);
    const laneOffset = dot({ x: p.x - cp.point.x, z: p.z - cp.point.z }, rightOf(cp.tangent));
    let he = Math.atan2(heading.z, heading.x) - Math.atan2(cp.tangent.z, cp.tangent.x);
    he = Math.atan2(Math.sin(he), Math.cos(he));
    const la = this.path.at(cp.s + 10), laf = this.path.at(cp.s + 22);
    const [u, v] = this.route;
    const d = net.dir(u, v);
    const stop = { x: net.node(v).pos.x - d.x * STOP_LINE, z: net.node(v).pos.z - d.z * STOP_LINE };
    const distanceToStopLine = dot({ x: stop.x - p.x, z: stop.z - p.z }, d);
    const dv = { x: this.spec.dest.pos.x - p.x, z: this.spec.dest.pos.z - p.z };
    const { p: dp, q: dq } = this.spec.dest;
    const onDestStreet = (u === dp && v === dq) || (u === dq && v === dp);
    const along = dot(dv, d);
    const speedMs = car.speed;
    const light = net.light(v, d, this.simTime);
    const inside = this.insideNode !== null;
    const turning = this.committed === 'turn_left' || this.committed === 'turn_right';
    const destAhead = onDestStreet && along > -4 ? along : null;
    // Comfortable speed to reach a stop `dist` meters ahead at 2 m/s², capped when close.
    const stopSpeed = (dist: number) => (dist < 2.5 ? 0 : Math.min(50, dist < 25 ? 20 : 50, Math.sqrt(2 * 2 * Math.max(0, dist - 1.5)) * 3.6));
    let advised = 50;
    if (destAhead !== null) advised = stopSpeed(destAhead);
    else if (light !== null && light !== 'green' && !inside && distanceToStopLine > -1) advised = Math.min(advised, stopSpeed(distanceToStopLine));
    else if (turning && (inside || distanceToStopLine < 30)) advised = 15;
    else if (inside) advised = 35;
    return {
      phase: car.phase,
      speedKmh: speedMs * 3.6,
      advisedSpeedKmh: advised,
      stoppingDistance: (speedMs * speedMs) / (2 * 6) + 1.5,
      laneOffset,
      headingError: THREE.MathUtils.radToDeg(he),
      lookaheadRight: dot({ x: la.x - p.x, z: la.z - p.z }, right),
      lookaheadFarRight: dot({ x: laf.x - p.x, z: laf.z - p.z }, right),
      distanceToStopLine,
      inIntersection: inside,
      exits: { left: net.neighbor(v, leftOf(d)) !== null, straight: net.neighbor(v, d) !== null, right: net.neighbor(v, rightOf(d)) !== null },
      plannedManeuver: this.committed,
      light,
      destBlocksAhead: dot(dv, heading) / SPACING,
      destBlocksRight: dot(dv, right) / SPACING,
      distanceToDestination: len(dv),
      destinationAheadOnThisRoad: destAhead,
      redLightsRun: this.redLightsRun,
    };
  }

  /**
   * Advance the drive by dt seconds with the given controls.
   * `auto` changes when the code fallback plans a turn and how long the car must sit at B before arrival counts.
   */
  step(dt: number, controls: Controls, auto: boolean, arrivedByJev = false): TripEvent[] {
    const events: TripEvent[] = [];
    this.simTime += dt;
    this.trackStreet();
    const t = this.telemetry();

    if (this.committed === null && !t.inIntersection && t.distanceToStopLine > -2) {
      const exitCount = Number(t.exits.left) + Number(t.exits.straight) + Number(t.exits.right);
      // A single exit is not a decision: plan it early. Otherwise Jev decides, with a late code fallback.
      if (exitCount <= 1 && t.distanceToStopLine < 60) this.commitManeuver(this.fallbackManeuver());
      else if (t.distanceToStopLine < (auto ? 14 : 40)) this.commitManeuver(this.fallbackManeuver());
    }

    const wasDriving = this.car.phase === 'driving';
    this.car.step(dt, controls);

    if (this.prevStopDist > 0 && t.distanceToStopLine <= 0 && t.light === 'red' && this.car.phase === 'driving') { this.redLightsRun += 1; events.push('red_light'); }
    this.prevStopDist = t.distanceToStopLine;

    if (!this.done && this.car.phase === 'driving') {
      const probe = this.car.position.clone().setY(0.6);
      if (this.buildings.some((b) => b.containsPoint(probe))) { this.car.phase = 'crashed'; events.push('crash_building'); }
      else if (!this.onRoad(this.car.pos2())) { this.car.phase = 'crashed'; events.push('crash_offroad'); }
      else if (t.distanceToDestination < 6 && this.car.speed < 0.3) {
        if (this.stoppedNearDestSince < 0) this.stoppedNearDestSince = this.simTime;
        if (arrivedByJev || this.simTime - this.stoppedNearDestSince > (auto ? 4 : 0.8)) this.car.phase = 'arrived';
      } else this.stoppedNearDestSince = -1;
    }
    if (!this.done && wasDriving && this.car.phase === 'arrived') { this.done = true; events.push('arrived'); }
    if (!this.done && this.car.phase === 'crashed') this.done = true;
    return events;
  }
}
