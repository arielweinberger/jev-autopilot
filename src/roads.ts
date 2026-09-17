import type { LightState, Maneuver } from './types';

/** Road network: a grid of intersections with some streets removed. Right-hand traffic. */
export const GRID = 6; // intersections per side
export const SPACING = 80; // meters between intersections
export const ROAD_HALF = 7; // road is 14 m wide, two lanes
export const LANE = 3.5; // lane center offset from road center line
export const ISEC_HALF = 7; // intersection square half size
export const STOP_LINE = ISEC_HALF + 1;

export interface Vec2 { x: number; z: number }
export const v2 = (x: number, z: number): Vec2 => ({ x, z });
const add = (a: Vec2, b: Vec2) => v2(a.x + b.x, a.z + b.z);
const sub = (a: Vec2, b: Vec2) => v2(a.x - b.x, a.z - b.z);
const mul = (a: Vec2, k: number) => v2(a.x * k, a.z * k);
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
export const len = (a: Vec2) => Math.hypot(a.x, a.z);
/** Perpendicular pointing to the right of a direction (y-up, looking down: x right, z down). */
export const rightOf = (d: Vec2) => v2(-d.z, d.x);
export const leftOf = (d: Vec2) => v2(d.z, -d.x);

export const DIRS: Vec2[] = [v2(1, 0), v2(-1, 0), v2(0, -1), v2(0, 1)]; // E W N S

export interface Node { id: number; i: number; j: number; pos: Vec2; hasLight: boolean }

export class RoadNetwork {
  nodes: Node[] = [];
  /** adjacency: node id -> set of neighbor ids */
  adj = new Map<number, Set<number>>();
  private rand: () => number;

  constructor(seed: number) {
    let s = seed;
    this.rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const id = j * GRID + i;
      this.nodes.push({ id, i, j, pos: v2((i - (GRID - 1) / 2) * SPACING, (j - (GRID - 1) / 2) * SPACING), hasLight: false });
      this.adj.set(id, new Set());
    }
    const link = (a: number, b: number) => { this.adj.get(a)!.add(b); this.adj.get(b)!.add(a); };
    for (const n of this.nodes) {
      if (n.i < GRID - 1) link(n.id, n.id + 1);
      if (n.j < GRID - 1) link(n.id, n.id + GRID);
    }
    // Remove ~20% of streets while keeping every intersection reachable with at least two streets.
    const edges: [number, number][] = [];
    for (const [a, set] of this.adj) for (const b of set) if (a < b) edges.push([a, b]);
    for (const [a, b] of edges) {
      if (this.rand() > 0.2) continue;
      if (this.adj.get(a)!.size <= 2 || this.adj.get(b)!.size <= 2) continue;
      this.adj.get(a)!.delete(b); this.adj.get(b)!.delete(a);
      if (!this.connected()) link(a, b);
    }
    for (const n of this.nodes) n.hasLight = this.adj.get(n.id)!.size >= 3;
  }

  private connected(): boolean {
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) for (const b of this.adj.get(stack.pop()!)!) if (!seen.has(b)) { seen.add(b); stack.push(b); }
    return seen.size === this.nodes.length;
  }

  node(id: number) { return this.nodes[id]; }
  neighbor(id: number, dir: Vec2): number | null {
    const n = this.node(id);
    const i = n.i + dir.x, j = n.j + dir.z;
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null;
    const m = j * GRID + i;
    return this.adj.get(id)!.has(m) ? m : null;
  }
  dir(from: number, to: number): Vec2 {
    const d = sub(this.node(to).pos, this.node(from).pos);
    const l = len(d);
    return v2(d.x / l, d.z / l);
  }
  edges(): [number, number][] {
    const out: [number, number][] = [];
    for (const [a, set] of this.adj) for (const b of set) if (a < b) out.push([a, b]);
    return out;
  }
  random(): number { return this.rand(); }

  /** Lane center line for driving from u to v, trimmed to the intersection boundaries. */
  laneStart(u: number, v: number): Vec2 { const d = this.dir(u, v); return add(add(this.node(u).pos, mul(d, ISEC_HALF + 2)), mul(rightOf(d), LANE)); }
  laneEnd(u: number, v: number): Vec2 { const d = this.dir(u, v); return add(sub(this.node(v).pos, mul(d, ISEC_HALF + 2)), mul(rightOf(d), LANE)); }

  /** Traffic light state at a node for traffic moving along `dir`, at time t (seconds). */
  light(nodeId: number, dir: Vec2, t: number): LightState | null {
    const n = this.node(nodeId);
    if (!n.hasLight) return null;
    const cycle = 24, phase = (t + n.id * 3.7) % cycle;
    const nsGreen = phase < 10, nsYellow = phase >= 10 && phase < 12, ewGreen = phase >= 12 && phase < 22, ewYellow = phase >= 22;
    const ns = dir.z !== 0;
    if (ns) return nsGreen ? 'green' : nsYellow ? 'yellow' : 'red';
    return ewGreen ? 'green' : ewYellow ? 'yellow' : 'red';
  }

  maneuverDir(dir: Vec2, m: Maneuver): Vec2 {
    return m === 'turn_left' ? leftOf(dir) : m === 'turn_right' ? rightOf(dir) : dir;
  }
}

/** A polyline the car should follow, with arc-length lookup. */
export class Path {
  pts: Vec2[] = [];
  cum: number[] = [];
  constructor(pts: Vec2[]) {
    // Drop duplicate consecutive points
    for (const p of pts) if (!this.pts.length || len(sub(p, this.pts[this.pts.length - 1])) > 0.01) this.pts.push(p);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + len(sub(this.pts[i], this.pts[i - 1])));
  }
  get length() { return this.cum[this.cum.length - 1] ?? 0; }

  closest(p: Vec2): { s: number; point: Vec2; tangent: Vec2; dist: number; seg: number } {
    let best = { s: 0, point: this.pts[0], tangent: v2(0, -1), dist: Infinity, seg: 0 };
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ab = sub(b, a), l2 = dot(ab, ab);
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
      const q = add(a, mul(ab, t));
      const d = len(sub(p, q));
      if (d < best.dist) {
        const l = Math.sqrt(l2);
        best = { s: this.cum[i] + t * l, point: q, tangent: v2(ab.x / l, ab.z / l), dist: d, seg: i };
      }
    }
    return best;
  }

  at(s: number): Vec2 {
    if (s <= 0) return this.pts[0];
    if (s >= this.length) return this.pts[this.pts.length - 1];
    let i = 0;
    while (this.cum[i + 1] < s) i++;
    const t = (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i]);
    return add(this.pts[i], mul(sub(this.pts[i + 1], this.pts[i]), t));
  }
}

/** Build the lane path for a route of intersections, with smooth turns between streets. */
export function buildPath(net: RoadNetwork, route: number[]): Path {
  const pts: Vec2[] = [];
  for (let k = 0; k + 1 < route.length; k++) {
    const u = route[k], v = route[k + 1];
    const a = net.laneStart(u, v), b = net.laneEnd(u, v);
    if (k === 0) pts.push(a);
    pts.push(b);
    if (k + 2 < route.length) {
      const w = route[k + 2];
      const c = net.laneStart(v, w);
      const d1 = net.dir(u, v), d2 = net.dir(v, w);
      if (Math.abs(dot(d1, d2) - 1) < 1e-6) { pts.push(c); continue; }
      // Quadratic bezier from b to c, control point where the two lane lines meet.
      const ctrl = intersect(b, d1, c, d2);
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        pts.push(add(add(mul(b, (1 - t) * (1 - t)), mul(ctrl, 2 * (1 - t) * t)), mul(c, t * t)));
      }
    } else {
      // No maneuver chosen yet: the path ends at the stop line.
      pts.push(add(b, mul(net.dir(u, v), 1)));
    }
  }
  return new Path(pts);
}

function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 {
  // Solve p + d*t = q + e*s
  const det = d.x * (-e.z) - d.z * (-e.x);
  if (Math.abs(det) < 1e-9) return mul(add(p, q), 0.5);
  const rx = q.x - p.x, rz = q.z - p.z;
  const t = (rx * (-e.z) - rz * (-e.x)) / det;
  return add(p, mul(d, t));
}

/** Choose a start street and a destination street near the farthest intersection. */
export function pickTrip(net: RoadNetwork): { start: { u: number; v: number }; dest: { p: number; q: number; pos: Vec2 } } {
  const rand = () => net.random();
  const edges = net.edges();
  const [su, sv] = edges[Math.floor(rand() * edges.length)];
  const start = rand() < 0.5 ? { u: su, v: sv } : { u: sv, v: su };
  const s0 = net.node(start.u);
  const far = net.nodes.slice().sort((a, b) => (Math.abs(b.i - s0.i) + Math.abs(b.j - s0.j)) - (Math.abs(a.i - s0.i) + Math.abs(a.j - s0.j)));
  const p = far[Math.floor(rand() * 3)].id;
  const q = [...net.adj.get(p)!][Math.floor(rand() * net.adj.get(p)!.size)];
  const P = net.node(p).pos, Q = net.node(q).pos;
  return { start, dest: { p, q, pos: v2((P.x + Q.x) / 2, (P.z + Q.z) / 2) } };
}
