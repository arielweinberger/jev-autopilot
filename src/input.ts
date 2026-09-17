import type { Controls } from './types';

/** Keyboard + gamepad → steering wheel and pedals. Keys ramp for a smooth feel. */
export class ManualInput {
  private keys = new Set<string>();
  private c: Controls = { steer: 0, throttle: 0, brake: 0 };
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

  private has(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }

  private gamepad(): Controls | null {
    const gp = navigator.getGamepads?.()[0];
    if (!gp) return null;
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    const c: Controls = { steer: dz(gp.axes[0] ?? 0), throttle: gp.buttons[7]?.value ?? 0, brake: gp.buttons[6]?.value ?? 0 };
    return c.steer === 0 && c.throttle === 0 && c.brake === 0 ? null : c;
  }

  read(dt: number): Controls {
    const gp = this.gamepad();
    if (gp) return (this.c = gp);
    const steerT = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    const thrT = this.has('KeyW', 'ArrowUp') ? 1 : 0;
    const brkT = this.has('KeyS', 'ArrowDown', 'Space') ? 1 : 0;
    const ramp = (cur: number, t: number, up: number, down: number) => (t === 0 ? cur + (0 - cur) * Math.min(1, dt * down) : cur + Math.sign(t - cur) * Math.min(Math.abs(t - cur), dt * up));
    this.c.steer = ramp(this.c.steer, steerT, 2.5, 8);
    this.c.throttle = ramp(this.c.throttle, thrT, 3, 10);
    this.c.brake = ramp(this.c.brake, brkT, 5, 10);
    return this.c;
  }

  /** True when the human is touching anything. */
  active(): boolean { return Math.abs(this.c.steer) + this.c.throttle + this.c.brake > 0.3; }
}
