import type { Controls, PilotResponse } from './types';
import { GRID, SPACING, type RoadNetwork, type Vec2 } from './roads';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private msg = $('center-msg');
  private msgTimer = 0;
  private map = $<HTMLCanvasElement>('minimap');

  setControls(c: Controls, mode: 'manual' | 'auto') {
    $('wheel').style.transform = `rotate(${c.steer * 140}deg)`;
    $('pedal-thr').style.height = `${c.throttle * 100}%`;
    $('pedal-brk').style.height = `${c.brake * 100}%`;
    $('rc-s').textContent = c.steer.toFixed(2);
    $('rc-t').textContent = c.throttle.toFixed(2);
    $('rc-b').textContent = c.brake.toFixed(2);
    $('rc-led').className = 'rc-led ' + (mode === 'auto' ? 'auto' : 'on');
  }

  setTelemetry(t: { kmh: number; light: string; next: string; dist: number; phase: string; reds: number }) {
    $('t-spd').textContent = t.kmh.toFixed(0);
    $('t-light').textContent = t.light;
    $('t-light').className = t.light;
    $('t-next').textContent = t.next;
    $('t-dist').textContent = t.dist.toFixed(0);
    $('t-phase').textContent = t.phase;
    $('t-reds').textContent = String(t.reds);
  }

  drawMinimap(net: RoadNetwork, car: Vec2, heading: Vec2, dest: Vec2, route: number[]) {
    const ctx = this.map.getContext('2d')!;
    const W = this.map.width, H = this.map.height;
    const span = (GRID + 0.6) * SPACING;
    const sx = (x: number) => W / 2 + (x / span) * W;
    const sz = (z: number) => H / 2 + (z / span) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,12,18,0.72)'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineCap = 'round';
    for (const [a, b] of net.edges()) {
      const A = net.node(a).pos, B = net.node(b).pos;
      ctx.beginPath(); ctx.moveTo(sx(A.x), sz(A.z)); ctx.lineTo(sx(B.x), sz(B.z)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(61,220,151,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath();
    route.forEach((id, k) => { const p = net.node(id).pos; k ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z)); });
    ctx.stroke();
    ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(sx(dest.x), sz(dest.z), 5, 0, Math.PI * 2); ctx.fill();
    // car as a triangle
    const cx = sx(car.x), cz = sz(car.z), a = Math.atan2(heading.z, heading.x);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 7, cz + Math.sin(a) * 7);
    ctx.lineTo(cx + Math.cos(a + 2.5) * 5, cz + Math.sin(a + 2.5) * 5);
    ctx.lineTo(cx + Math.cos(a - 2.5) * 5, cz + Math.sin(a - 2.5) * 5);
    ctx.closePath(); ctx.fill();
  }

  setMode(mode: 'manual' | 'auto') {
    const title = $('mode-title');
    title.textContent = mode === 'auto' ? 'JEV DRIVING' : 'MANUAL';
    title.className = mode === 'auto' ? 'auto' : '';
    $('jev').hidden = mode !== 'auto';
  }

  setFlightStats(s: { requests: number; inputTokens: number; outputTokens: number; latencyMsTotal: number }) {
    const el = $('jev-stats');
    if (s.requests === 0) { el.textContent = ''; return; }
    el.textContent = `trip: ${s.requests} decisions · ${(s.inputTokens + s.outputTokens).toLocaleString()} tokens · avg ${(s.latencyMsTotal / s.requests).toFixed(0)} ms`;
  }

  setJev(r: PilotResponse | null, error?: string) {
    const box = $('jev-answers');
    if (error) { box.innerHTML = `<div style="color:var(--danger)">${error}</div>`; return; }
    if (!r) { box.innerHTML = ''; return; }
    $('jev-latency').textContent = r.latencyMs.toFixed(0);
    $('jev-tokens').textContent = String((r.usage.inputTokens ?? 0) + (r.usage.outputTokens ?? 0));
    const a = r.answers;
    const choiceRow = (name: string, ans: { choice: string; probabilities: Record<string, number> }) => {
      const keys = Object.keys(ans.probabilities);
      const bars = keys.map((k) => `<div class="bar ${k === ans.choice ? 'top' : ''}" title="${k}: ${(ans.probabilities[k] * 100).toFixed(0)}%"><i style="height:${ans.probabilities[k] * 100}%"></i></div>`).join('');
      return `<div class="ans"><span class="k">${name}</span><div><div class="bars">${bars}</div><span class="choice">${ans.choice}</span></div></div>`;
    };
    const noulRow = (name: string, p: number) => `<div class="ans"><span class="k">${name}</span><div><div class="noul"><i style="width:${p * 100}%"></i></div><span style="color:var(--dim)">${(p * 100).toFixed(0)}%</span></div></div>`;
    box.innerHTML =
      choiceRow('steer', a.steer) +
      choiceRow('pedals', a.pedal) +
      (a.maneuver ? choiceRow('turn?', a.maneuver) : `<div class="ans"><span class="k">turn?</span><span style="color:var(--dim)">not asked</span></div>`) +
      noulRow('arrived?', a.arrived);
  }

  flash(text: string, kind: 'ok' | 'bad' | '' = '', ms = 2500, sub?: string) {
    this.msg.textContent = text;
    if (sub) { const el = document.createElement('div'); el.className = 'sub'; el.textContent = sub; this.msg.appendChild(el); }
    this.msg.className = `show ${kind}`;
    clearTimeout(this.msgTimer);
    if (ms > 0) this.msgTimer = window.setTimeout(() => (this.msg.className = ''), ms);
  }
  clearFlash() { this.msg.className = ''; }
}
