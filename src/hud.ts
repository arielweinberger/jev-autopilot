import type { Sticks, PilotResponse } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private knobL = $('knob-left');
  private knobR = $('knob-right');
  private led = $('rc-led');
  private msg = $('center-msg');
  private msgTimer = 0;

  setSticks(s: Sticks, mode: 'manual' | 'auto', armed: boolean) {
    const R = 44; // px travel
    this.knobL.style.transform = `translate(${s.yaw * R}px, ${-s.throttle * R}px)`;
    this.knobR.style.transform = `translate(${s.roll * R}px, ${-s.pitch * R}px)`;
    $('rc-t').textContent = s.throttle.toFixed(2);
    $('rc-y').textContent = s.yaw.toFixed(2);
    $('rc-p').textContent = s.pitch.toFixed(2);
    $('rc-r').textContent = s.roll.toFixed(2);
    this.led.className = 'rc-led ' + (mode === 'auto' ? 'auto' : armed ? 'on' : '');
  }

  setTelemetry(t: { alt: number; vs: number; spd: number; dist: number; hdg: number; phase: string; bearing: number }) {
    $('t-alt').textContent = t.alt.toFixed(1);
    $('t-vs').textContent = (t.vs >= 0 ? '+' : '') + t.vs.toFixed(1);
    $('t-spd').textContent = t.spd.toFixed(1);
    $('t-dist').textContent = t.dist.toFixed(0);
    $('t-hdg').textContent = String(Math.round(((t.hdg % 360) + 360) % 360)).padStart(3, '0');
    $('t-phase').textContent = t.phase;
    $('compass-arrow').style.transform = `rotate(${t.bearing}deg)`;
  }

  setMode(mode: 'manual' | 'auto') {
    const title = $('mode-title');
    title.textContent = mode === 'auto' ? 'JEV AUTOPILOT' : 'MANUAL';
    title.className = mode === 'auto' ? 'auto' : '';
    $('jev').hidden = mode !== 'auto';
  }

  setFlightStats(s: { requests: number; inputTokens: number; outputTokens: number; latencyMsTotal: number }) {
    const el = $('jev-stats');
    if (s.requests === 0) { el.textContent = ''; return; }
    el.textContent = `flight: ${s.requests} decisions · ${(s.inputTokens + s.outputTokens).toLocaleString()} tokens · avg ${(s.latencyMsTotal / s.requests).toFixed(0)} ms`;
  }

  setJev(r: PilotResponse | null, error?: string) {
    const box = $('jev-answers');
    if (error) {
      box.innerHTML = `<div style="color:var(--danger)">${error}</div>`;
      return;
    }
    if (!r) return;
    $('jev-latency').textContent = r.latencyMs.toFixed(0);
    $('jev-tokens').textContent = String((r.usage.inputTokens ?? 0) + (r.usage.outputTokens ?? 0));
    const a = r.answers;
    const choiceRow = (name: string, ans: { choice: string; probabilities: Record<string, number> }) => {
      const keys = Object.keys(ans.probabilities);
      const bars = keys
        .map((k) => `<div class="bar ${k === ans.choice ? 'top' : ''}" title="${k}: ${(ans.probabilities[k] * 100).toFixed(0)}%"><i style="height:${ans.probabilities[k] * 100}%"></i></div>`)
        .join('');
      return `<div class="ans"><span class="k">${name}</span><div><div class="bars">${bars}</div><span class="choice">${ans.choice}</span></div></div>`;
    };
    const noulRow = (name: string, p: number) =>
      `<div class="ans"><span class="k">${name}</span><div><div class="noul"><i style="width:${p * 100}%"></i></div><span style="color:var(--dim)">${(p * 100).toFixed(0)}%</span></div></div>`;
    box.innerHTML =
      choiceRow('throttle', a.throttle) +
      choiceRow('yaw', a.yaw) +
      choiceRow('pitch', a.pitch) +
      choiceRow('roll', a.roll) +
      noulRow('land?', a.commitToLanding) +
      noulRow('cut motors?', a.cutMotors);
  }

  flash(text: string, kind: 'ok' | 'bad' | '' = '', ms = 2500, sub?: string) {
    this.msg.textContent = text;
    if (sub) {
      const el = document.createElement('div');
      el.className = 'sub';
      el.textContent = sub;
      this.msg.appendChild(el);
    }
    this.msg.className = `show ${kind}`;
    clearTimeout(this.msgTimer);
    if (ms > 0) this.msgTimer = window.setTimeout(() => (this.msg.className = ''), ms);
  }
  clearFlash() {
    this.msg.className = '';
  }
}
