import type { Sticks, Telemetry, PilotResponse } from './types';
import { THROTTLE_OPTIONS, YAW_OPTIONS, PITCH_OPTIONS, ROLL_OPTIONS } from './types';

/**
 * Client side of the Jev autopilot.
 * Each tick sends telemetry to /api/pilot, gets back typed answers with probability
 * distributions, and turns them into stick deflections. The expected value over the
 * distribution is used (not just the argmax), so the sticks move smoothly.
 */
const THREE_CLAMP = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Autopilot {
  private inFlight = false;
  private target: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private current: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private lastTickAt = 0;
  private lastResponseAt = 0;
  last: PilotResponse | null = null;
  error: string | null = null;
  /** Running totals for the current flight (reset with the mission). */
  stats = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, startedAt: 0, endedAt: 0 };
  /** Sticky flags decided by Jev's Noul answers. */
  landingCommitted = false;
  motorsCut = false;
  onResponse: (r: PilotResponse) => void = () => {};
  onError: (e: string) => void = () => {};

  constructor(private intervalMs = 180) {}

  reset() {
    this.target = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.current = { ...this.target };
    this.landingCommitted = false;
    this.motorsCut = false;
    this.last = null;
    this.error = null;
    this.stats = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, startedAt: performance.now(), endedAt: 0 };
  }

  private expected<K extends string>(probs: Record<K, number>, values: Record<K, number>): number {
    let v = 0;
    for (const k of Object.keys(probs) as K[]) v += probs[k] * values[k];
    return v;
  }

  /** Call every frame. Returns the sticks the drone should use this frame. */
  update(now: number, dt: number, telemetry: Telemetry): Sticks {
    // Nothing left to decide once the flight is over.
    const flightOver = telemetry.phase === 'crashed' || (telemetry.phase === 'landed' && this.motorsCut);
    if (!flightOver && !this.inFlight && now - this.lastTickAt >= this.intervalMs) {
      this.lastTickAt = now;
      void this.tick(telemetry);
    }
    // If Jev goes silent, ease back to hover rather than holding the last command.
    if (now - this.lastResponseAt > 1500 && this.lastResponseAt > 0) {
      this.target = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    }
    const k = Math.min(1, dt * 8);
    for (const key of Object.keys(this.current) as (keyof Sticks)[]) {
      this.current[key] += (this.target[key] - this.current[key]) * k;
    }
    return this.current;
  }

  private async tick(telemetry: Telemetry) {
    this.inFlight = true;
    const sentAt = performance.now();
    try {
      const res = await fetch('/api/pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetry),
      });
      const data = (await res.json()) as PilotResponse | { error: string };
      if ('error' in data) throw new Error(data.error);
      // Freshness check: a slow answer describes a situation that no longer exists.
      if (performance.now() - sentAt > 2000) return;
      this.last = data;
      this.error = null;
      this.lastResponseAt = performance.now();
      this.stats.requests += 1;
      this.stats.inputTokens += data.usage.inputTokens ?? 0;
      this.stats.outputTokens += data.usage.outputTokens ?? 0;
      this.stats.latencyMsTotal += data.latencyMs;
      const a = data.answers;

      if (a.commitToLanding > 0.6) this.landingCommitted = true;
      if (a.cutMotors > 0.7 && telemetry.altitude < 0.3 && !this.motorsCut) {
        this.motorsCut = true;
        this.stats.endedAt = performance.now();
      }

      this.target = {
        throttle: this.expected(a.throttle.probabilities, THROTTLE_OPTIONS),
        yaw: this.expected(a.yaw.probabilities, YAW_OPTIONS),
        pitch: this.expected(a.pitch.probabilities, PITCH_OPTIONS),
        roll: this.expected(a.roll.probabilities, ROLL_OPTIONS),
      };

      // Code keeps the safety envelope. Jev decides intent, code enforces limits.
      // Precision mode: near the pad, shrink horizontal stick authority so small
      // corrections stay small (Jev picks the direction, code picks the gain).
      const gain = THREE_CLAMP(telemetry.distanceToPad / 15, 0.2, 1);
      this.target.pitch *= gain;
      this.target.roll *= gain;
      if (telemetry.phase === 'airborne' && telemetry.altitude < 1.5 && !this.landingCommitted && telemetry.distanceToPad > telemetry.padRadius) {
        // Never sink into the ground away from the pad.
        this.target.throttle = Math.max(this.target.throttle, 0.3);
      }
      if (telemetry.obstacleAhead !== null && telemetry.obstacleAhead < 12 && telemetry.altitude < telemetry.tallestObstacleOnPath + 2) {
        this.target.pitch = Math.min(this.target.pitch, -0.5);
        this.target.throttle = Math.max(this.target.throttle, 0.8);
      }
      // Flare: below 3 m the descent rate is capped regardless of what Jev asked for.
      if (telemetry.altitude < 3) this.target.throttle = Math.max(this.target.throttle, -0.15);
      if (this.motorsCut) this.target = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
      this.onResponse(data);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.onError(this.error);
    } finally {
      this.inFlight = false;
    }
  }
}
