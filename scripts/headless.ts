// Headless drive: real road network, real car physics, real Jev decisions, no rendering.
// Usage: npx tsx scripts/headless.ts [seed] [maxSeconds]
import { RoadNetwork, pickTrip } from '../src/roads';
import { Car } from '../src/car';
import { Trip } from '../src/trip';
import { Autopilot } from '../src/autopilot';

const seed = Number(process.argv[2]) || 1 + Math.floor(Math.random() * 2147483646);
const maxSeconds = Number(process.argv[3]) || 240;
const net = new RoadNetwork(seed);
const spec = pickTrip(net);
const car = new Car();
const trip = new Trip(net, spec, car);
const pilot = new Autopilot(180, 'http://localhost:5173/api/pilot');
let arrivedByJev = false;
pilot.onManeuver = (m) => { if (trip.commitManeuver(m)) console.log(`   ↳ Jev plans: ${m}`); };
pilot.onArrived = () => (arrivedByJev = true);
pilot.onError = (e) => console.log('   ! pilot error:', e);
pilot.reset();

console.log(`seed=${seed} start=${spec.start.u}->${spec.start.v} dest street ${spec.dest.p}-${spec.dest.q} (${trip.telemetry().distanceToDestination.toFixed(0)} m away)`);
const DECIDE = 0.18, SUB = 0.03;
let lastLog = -10;
outer: while (trip.simTime < maxSeconds) {
  await pilot.decide(trip.telemetry());
  for (let k = 0; k < DECIDE / SUB; k++) {
    const controls = pilot.smooth(SUB);
    for (const ev of trip.step(SUB, controls, true, arrivedByJev)) console.log(`   ! ${ev} at t=${trip.simTime.toFixed(1)}s`);
    if (trip.done) break outer;
  }
  if (trip.simTime - lastLog >= 3) {
    lastLog = trip.simTime;
    const t = trip.telemetry();
    const a = pilot.last?.answers;
    console.log(
      `t=${trip.simTime.toFixed(0).padStart(3)}s ${t.speedKmh.toFixed(0).padStart(3)}/${t.advisedSpeedKmh.toFixed(0).padStart(2)} km/h  dist ${t.distanceToDestination.toFixed(0).padStart(3)} m  lane ${t.laneOffset.toFixed(1).padStart(5)} m  hdg ${t.headingError.toFixed(0).padStart(4)}°  stop ${t.distanceToStopLine.toFixed(0).padStart(4)} m  light ${(t.light ?? '-').padEnd(6)} next ${(t.plannedManeuver ?? '-').padEnd(11)} | ${a ? `${a.steer.choice}/${a.pedal.choice}(${Object.entries(a.pedal.probabilities).filter(([, p]) => p > 0.05).map(([k, p]) => `${k.replace('accelerate', 'acc').replace('_hard', '!')}=${p.toFixed(2)}`).join(' ')})${a.maneuver ? '/' + a.maneuver.choice : ''}` : ''}`,
    );
  }
}
const s = pilot.stats;
console.log(`\nRESULT: ${car.phase} after ${trip.simTime.toFixed(0)} s · ${s.requests} decisions · ${(s.inputTokens + s.outputTokens).toLocaleString()} tokens · avg ${(s.latencyMsTotal / Math.max(1, s.requests)).toFixed(0)} ms · red lights run: ${trip.redLightsRun}`);
