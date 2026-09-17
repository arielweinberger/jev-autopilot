import type { Controls, Telemetry, PilotResponse, Maneuver } from './types';
import { STEER_OPTIONS, PEDAL_OPTIONS } from './types';

/**
 * Client side of the Jev driver. Sends telemetry to /api/pilot, receives typed
 * answers with probabilities, turns them into wheel and pedal positions using
 * the expected value over each distribution so inputs stay smooth.
 */
export class Autopilot {
  private inFlight = false;
  private target: Controls = { steer: 0, throttle: 0, brake: 0 };
  private current: Controls = { steer: 0, throttle: 0, brake: 0 };
  private lastTickAt = 0;
  private lastResponseAt = 0;
  last: PilotResponse | null = null;
  error: string | null = null;
  arrivedVotes = 0;
  stats = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, startedAt: 0, endedAt: 0 };
  onResponse: (r: PilotResponse) => void = () => {};
  onError: (e: string) => void = () => {};
  /** Jev chose a maneuver for the upcoming intersection. */
  onManeuver: (m: Maneuver) => void = () => {};
  /** Jev says the trip is complete. */
  onArrived: () => void = () => {};

  constructor(private intervalMs = 180, private endpoint = '/api/pilot') {}

  reset() {
    this.target = { steer: 0, throttle: 0, brake: 0 };
    this.current = { ...this.target };
    this.last = null; this.error = null; this.arrivedVotes = 0;
    this.stats = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, startedAt: performance.now(), endedAt: 0 };
  }

  private expected<K extends string>(probs: Record<K, number>, values: Record<K, number>): number {
    let v = 0;
    for (const k of Object.keys(probs) as K[]) v += probs[k] * values[k];
    return v;
  }

  update(now: number, dt: number, telemetry: Telemetry): Controls {
    const over = telemetry.phase === 'crashed' || telemetry.phase === 'arrived';
    // A hidden tab freezes the simulation, so asking Jev would only burn tokens.
    const paused = typeof document !== 'undefined' && document.hidden;
    if (!over && !paused && !this.inFlight && now - this.lastTickAt >= this.intervalMs) {
      this.lastTickAt = now;
      void this.tick(telemetry);
    }
    if (this.lastResponseAt > 0 && now - this.lastResponseAt > 1500) this.target = { steer: 0, throttle: 0, brake: 0.3 };
    if (over) this.target = { steer: 0, throttle: 0, brake: 1 };
    return this.smooth(dt);
  }

  /** Ease the live controls toward Jev's latest target. */
  smooth(dt: number): Controls {
    const k = Math.min(1, dt * 9);
    for (const key of Object.keys(this.current) as (keyof Controls)[]) this.current[key] += (this.target[key] - this.current[key]) * k;
    return this.current;
  }

  /** One synchronous decision, for headless runs. */
  async decide(telemetry: Telemetry): Promise<void> { await this.tick(telemetry); }

  private async tick(telemetry: Telemetry) {
    this.inFlight = true;
    const sentAt = performance.now();
    try {
      const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telemetry) });
      const data = (await res.json()) as PilotResponse | { error: string };
      if ('error' in data) throw new Error(data.error);
      if (performance.now() - sentAt > 2000) return; // stale
      this.last = data; this.error = null; this.lastResponseAt = performance.now();
      this.stats.requests += 1;
      this.stats.inputTokens += data.usage.inputTokens ?? 0;
      this.stats.outputTokens += data.usage.outputTokens ?? 0;
      this.stats.latencyMsTotal += data.latencyMs;
      const a = data.answers;

      const steer = this.expected(a.steer.probabilities, STEER_OPTIONS);
      // One pedal axis: the distribution's expected value decides gas vs brake, never both.
      const pedal = this.expected(a.pedal.probabilities, PEDAL_OPTIONS);
      this.target = { steer, throttle: Math.max(0, pedal), brake: Math.max(0, -pedal) };

      if (a.maneuver && a.maneuver.probabilities[a.maneuver.choice] > 0.45) this.onManeuver(a.maneuver.choice);
      if (a.arrived > 0.6 && telemetry.speedKmh < 2 && telemetry.distanceToDestination < 8) {
        this.arrivedVotes += 1;
        if (this.arrivedVotes >= 2) { this.stats.endedAt = performance.now(); this.onArrived(); }
      } else this.arrivedVotes = 0;
      this.onResponse(data);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.onError(this.error);
    } finally {
      this.inFlight = false;
    }
  }
}
