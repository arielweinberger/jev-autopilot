// Usage: node scripts/probe.mjs '<telemetry json>'
const t = JSON.parse(process.argv[2]);
const res = await fetch('http://localhost:5173/api/pilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) });
const d = await res.json();
if (d.error) { console.log('ERROR', d.error); process.exit(1); }
console.log(`latency ${Math.round(d.latencyMs)}ms  tokens in=${d.usage.inputTokens} out=${d.usage.outputTokens}`);
for (const [k, v] of Object.entries(d.answers)) {
  if (typeof v === 'object') {
    const probs = Object.entries(v.probabilities).map(([a, b]) => `${a}=${b.toFixed(2)}`).join(' ');
    console.log(`${k.padEnd(16)} -> ${v.choice.padEnd(16)} conf=${v.confidence}  ${probs}`);
  } else console.log(`${k.padEnd(16)} -> ${v}`);
}
