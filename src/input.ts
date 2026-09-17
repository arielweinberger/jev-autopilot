import type { Sticks } from './types';

/** Keyboard + gamepad → DJI Mode 2 sticks. Keys ramp toward full deflection for a stick-like feel. */
export class ManualInput {
  private keys = new Set<string>();
  private sticks: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  onKey: (code: string) => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private axis(pos: string, neg: string): number {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  /** Any gamepad input present this frame? */
  private gamepad(): Sticks | null {
    const gp = navigator.getGamepads?.()[0];
    if (!gp) return null;
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    const s: Sticks = {
      throttle: -dz(gp.axes[1] ?? 0),
      yaw: dz(gp.axes[0] ?? 0),
      pitch: -dz(gp.axes[3] ?? 0),
      roll: dz(gp.axes[2] ?? 0),
    };
    if (s.throttle === 0 && s.yaw === 0 && s.pitch === 0 && s.roll === 0) return null;
    return s;
  }

  read(dt: number): Sticks {
    const gp = this.gamepad();
    if (gp) {
      this.sticks = gp;
      return this.sticks;
    }
    const target: Sticks = {
      throttle: this.axis('KeyW', 'KeyS'),
      yaw: this.axis('KeyD', 'KeyA'),
      pitch: this.axis('ArrowUp', 'ArrowDown'),
      roll: this.axis('ArrowRight', 'ArrowLeft'),
    };
    const rate = dt * 4;
    for (const k of Object.keys(target) as (keyof Sticks)[]) {
      const cur = this.sticks[k];
      const t = target[k];
      this.sticks[k] = t === 0 ? cur + (0 - cur) * Math.min(1, dt * 10) : cur + Math.sign(t - cur) * Math.min(Math.abs(t - cur), rate);
    }
    return this.sticks;
  }
}
