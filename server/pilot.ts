import { experimental_evaluate as evaluate } from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Telemetry, PilotResponse, ChoiceAnswer, Maneuver } from '../src/types';

/**
 * Turns telemetry into a situation report a driver could act on.
 * Jev is a System One model: strong at judgment, deliberately weak at arithmetic.
 * Code does every comparison and hands over plain-language facts plus rounded numbers.
 */
function describe(t: Telemetry) {
  const abs = Math.abs;
  const r = (n: number, d = 0) => Number(n.toFixed(d));
  const side = (v: number) => (v > 0 ? 'right' : 'left');

  const speedWords =
    t.speedKmh < 1 ? 'the car is stopped' : t.speedKmh < 8 ? 'crawling' : t.speedKmh < 25 ? 'driving slowly' : t.speedKmh < 45 ? 'driving at a moderate speed' : 'driving fast, at or above the 50 km/h limit';
  const diff = t.speedKmh - t.advisedSpeedKmh;
  const speedVerdict =
    t.advisedSpeedKmh < 1
      ? t.speedKmh < 1
        ? 'the right speed here is zero and the car is stopped: hold the brake'
        : 'the car must come to a complete stop here: brake'
      : diff < -12
        ? `the right speed here is about ${r(t.advisedSpeedKmh)} km/h: the car is MUCH TOO SLOW, press the gas`
        : diff < -4
          ? `the right speed here is about ${r(t.advisedSpeedKmh)} km/h: the car is a little slow, add some gas`
          : diff > 12
            ? `the right speed here is about ${r(t.advisedSpeedKmh)} km/h: the car is MUCH TOO FAST, brake`
            : diff > 4
              ? `the right speed here is about ${r(t.advisedSpeedKmh)} km/h: the car is a little fast, ease off or brake gently`
              : `the right speed here is about ${r(t.advisedSpeedKmh)} km/h: the speed is about right, hold it`;

  const laneWords =
    abs(t.laneOffset) < 0.4
      ? 'centered in the lane'
      : abs(t.laneOffset) < 1.3
        ? `slightly ${side(t.laneOffset)} of the lane center, by ${r(abs(t.laneOffset), 1)} m`
        : abs(t.laneOffset) < 2.6
          ? `well ${side(t.laneOffset)} of the lane center, by ${r(abs(t.laneOffset), 1)} m`
          : `far ${side(t.laneOffset)} of the lane, ${r(abs(t.laneOffset), 1)} m off center, close to leaving the road`;

  const headingWords =
    abs(t.headingError) < 3
      ? 'pointing straight along the lane'
      : abs(t.headingError) < 10
        ? `pointing slightly ${side(t.headingError)} of the lane direction`
        : abs(t.headingError) < 25
          ? `pointing clearly ${side(t.headingError)} of the lane direction, by ${r(abs(t.headingError))} degrees`
          : `pointing sharply ${side(t.headingError)} of the lane direction, by ${r(abs(t.headingError))} degrees`;

  const near = t.lookaheadRight, farr = t.lookaheadFarRight;
  const roadAhead =
    abs(near) < 0.5 && abs(farr) < 1
      ? 'the lane center runs straight ahead of the car'
      : `to be on the lane center 10 m ahead, the car must move ${r(abs(near), 1)} m to the ${side(near)}; 22 m ahead the lane center is ${r(abs(farr), 1)} m to the ${side(farr)}` +
        (abs(farr) > 4 ? ` — the road curves ${side(farr)} ahead` : '');

  const exits = [t.exits.left && 'left', t.exits.straight && 'straight', t.exits.right && 'right'].filter(Boolean).join(', ') || 'none';
  const maneuverWord = t.plannedManeuver === 'turn_left' ? 'turn left' : t.plannedManeuver === 'turn_right' ? 'turn right' : t.plannedManeuver === 'go_straight' ? 'go straight' : null;
  const intersection = t.inIntersection
    ? `the car is inside the intersection${maneuverWord ? `, executing: ${maneuverWord}. Follow the lane center as described in roadAhead` : ''}`
    : t.distanceToStopLine < 0
      ? 'the car has just passed the stop line'
      : `the stop line of the next intersection is ${r(t.distanceToStopLine)} m ahead (${t.distanceToStopLine < 12 ? 'very close' : t.distanceToStopLine < 30 ? 'close' : 'still some way off'}). Exits there: ${exits}. ` +
        (maneuverWord ? `Planned maneuver: ${maneuverWord}.` : 'No maneuver chosen yet.');

  const room = t.distanceToStopLine - t.stoppingDistance;
  const dsl = t.distanceToStopLine;
  const lightWords =
    t.light === null || t.inIntersection || dsl < 0
      ? 'no traffic light applies right now'
      : t.light === 'green'
        ? `the traffic light facing the car is GREEN, ${r(dsl)} m ahead: proceed`
        : dsl < 3
          ? `the car is AT the stop line and the light is ${t.light.toUpperCase()}: hold the brake and wait here`
          : room > 30
            ? `the light ahead is ${t.light.toUpperCase()}, but the stop line is still FAR: ${r(dsl)} m away. Do not stop here. Keep driving toward the line at the speed given in \`speed\`; it may turn green before the car arrives`
            : room > 3
              ? `the light ahead is ${t.light.toUpperCase()} and the stop line is ${r(dsl)} m away. Roll up to the line and stop exactly AT it, not before it. ${t.speedKmh < 3 ? `The car is stopped ${r(dsl)} m short of the line: creep forward` : 'Brake gently so the car comes to rest at the line'}`
              : `the light ahead is ${t.light.toUpperCase()} and the stop line is only ${r(dsl)} m away: brake firmly now to stop at the line`;

  const ahead = t.destBlocksAhead, rgt = t.destBlocksRight;
  const dirWords =
    abs(ahead) < 0.35 && abs(rgt) < 0.35
      ? 'the destination is right here'
      : `${abs(ahead) < 0.35 ? '' : `${r(abs(ahead), 1)} blocks ${ahead > 0 ? 'ahead' : 'behind'}`}${abs(ahead) >= 0.35 && abs(rgt) >= 0.35 ? ' and ' : ''}${abs(rgt) < 0.35 ? '' : `${r(abs(rgt), 1)} blocks to the ${side(rgt)}`}`;
  const destination =
    t.destinationAheadOnThisRoad !== null
      ? t.distanceToDestination < 5
        ? 'the car is AT the destination marker. Stop here and stay stopped.'
        : `the destination is on THIS street, ${r(t.destinationAheadOnThisRoad)} m ahead. Drive up to it at the speed given in \`speed\` and stop exactly at it${t.stoppingDistance > t.destinationAheadOnThisRoad ? ' — brake now, the car needs more distance to stop than remains' : ''}.`
      : `the destination is ${dirWords} (${r(t.distanceToDestination)} m away in a straight line). The city is a grid, so pick the exit that points toward it.`;

  return {
    mission: 'Drive the car from A to B through the city grid, stay in the right-hand lane, obey traffic lights, and stop at the destination marker.',
    phase: t.phase === 'ready' ? 'ready: the car is parked at A with the engine running; press the gas to begin the trip' : t.phase,
    speed: `${speedWords} (${r(t.speedKmh)} km/h). ${speedVerdict}. Stopping distance about ${r(t.stoppingDistance)} m.`,
    lanePosition: laneWords,
    heading: headingWords,
    roadAhead,
    intersection,
    trafficLight: lightWords,
    destination,
    redLightsRunSoFar: t.redLightsRun,
    controls:
      'Steering wheel: left/right turns the car toward that side. Gas pedal accelerates. Brake pedal slows and stops. Automatic gearbox, forward only.',
  };
}

export function createPilotHandler(apiKey: string | undefined) {
  if (!apiKey) throw new Error('TYPESAFE_AI_API_KEY is not set');
  const typeSafe = createTypeSafeAi({ apiKey });
  const model = typeSafe.evaluationModel('jev-latest');

  return async function handle(telemetry: Telemetry): Promise<PilotResponse> {
    const situation = describe(telemetry);
    const started = performance.now();

    const exitCriteria: Partial<Record<Maneuver, string>> = {};
    if (telemetry.exits.left) exitCriteria.turn_left = 'Turn left at the intersection onto the cross street.';
    if (telemetry.exits.straight) exitCriteria.go_straight = 'Continue straight through the intersection.';
    if (telemetry.exits.right) exitCriteria.turn_right = 'Turn right at the intersection onto the cross street.';
    const askManeuver =
      telemetry.plannedManeuver === null && !telemetry.inIntersection && telemetry.distanceToStopLine > 0 && telemetry.distanceToStopLine < 55 && Object.keys(exitCriteria).length >= 2;

    const questions = {
      steer: {
        type: 'choice' as const,
        instructions:
          'Which steering input keeps the car on the lane center and follows the road? Use `roadAhead` first: steer toward the side the lane center ahead is on. Also use `lanePosition` and `heading`. Choose straight when the car is centered and pointing along the lane. Use the hard inputs only for a sharp turn inside an intersection or when the car is far off the lane.',
        criteria: {
          hard_left: 'Turn the wheel fully left. The lane center ahead is far to the left, such as a left turn inside an intersection.',
          left: 'Turn the wheel a little left. The lane center ahead is somewhat to the left, or the car points right of the lane.',
          straight: 'Hold the wheel centered. The car is on the lane center and pointing along it.',
          right: 'Turn the wheel a little right. The lane center ahead is somewhat to the right, or the car points left of the lane.',
          hard_right: 'Turn the wheel fully right. The lane center ahead is far to the right, such as a right turn inside an intersection.',
        },
      },
      pedal: {
        type: 'choice' as const,
        instructions:
          'Which pedal input is right now? `speed` states the right speed for this spot and whether the car is too slow, too fast, or about right: follow that verdict. Too slow means gas; too fast means brake; about right means coast or a touch of gas to hold speed; must stop means brake. A red light means stop AT the stop line, not as soon as the light is visible: while `trafficLight` says the line is still far or asks the car to creep forward, keep moving. Brake hard only when `trafficLight` or `destination` says a stop is close, and accelerate hard only on a clear straight road well below the limit.',
        criteria: {
          accelerate_hard: 'Press the gas fully. The road ahead is clear, the light is green or absent, no turn or destination is near, and the car is well below the limit.',
          accelerate: 'Press the gas gently. Keep speed up on a clear road near the limit, or move off from a stop, or roll through a green intersection.',
          coast: 'No pedal. Speed is fine and nothing requires braking, or the car is creeping through a turn at the right speed.',
          brake: 'Press the brake gently. Slow down for an upcoming turn, for a red light that is still far, or for the destination ahead.',
          brake_hard: 'Press the brake fully. A red light or the destination is close and the car must stop now, or the car is stopped at the destination and should stay stopped.',
        },
      },
      arrived: {
        type: 'boolean' as const,
        instructions: 'The car is stopped at the destination and the trip is complete. True only when `destination` says the car is AT the destination marker and `speed` says it is stopped.',
      },
      ...(askManeuver
        ? {
            maneuver: {
              type: 'choice' as const,
              instructions:
                'Which way should the car go at the upcoming intersection to get closer to the destination? Use `destination`. Only the listed exits exist. If the destination is ahead, go straight. If it is mostly to the right, turn right. If it is mostly to the left, turn left. If it is behind, turn toward whichever side it is on.',
              criteria: exitCriteria as Record<Maneuver, string>,
            },
          }
        : {}),
    };

    const result = await evaluate({ model, state: situation, questions });
    const latencyMs = performance.now() - started;
    const conf = (result.providerMetadata?.typesafe as { confidence?: Record<string, number> } | undefined)?.confidence ?? {};
    const pick = <K extends string>(id: string, a: { choice: K; probabilities?: Record<K, number> }): ChoiceAnswer<K> => ({
      choice: a.choice,
      probabilities: a.probabilities ?? ({ [a.choice]: 1 } as Record<K, number>),
      confidence: conf[id] ?? null,
    });
    const a = result.answers as unknown as {
      steer: { choice: keyof typeof questions.steer.criteria; probabilities?: Record<string, number> };
      pedal: { choice: keyof typeof questions.pedal.criteria; probabilities?: Record<string, number> };
      arrived: { probability: number };
      maneuver?: { choice: Maneuver; probabilities?: Record<Maneuver, number> };
    };
    return {
      answers: {
        steer: pick('steer', a.steer as { choice: keyof typeof questions.steer.criteria; probabilities?: Record<keyof typeof questions.steer.criteria, number> }),
        pedal: pick('pedal', a.pedal as { choice: keyof typeof questions.pedal.criteria; probabilities?: Record<keyof typeof questions.pedal.criteria, number> }),
        maneuver: a.maneuver ? pick('maneuver', a.maneuver) : undefined,
        arrived: a.arrived.probability,
      },
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      latencyMs,
      situation,
    };
  };
}
