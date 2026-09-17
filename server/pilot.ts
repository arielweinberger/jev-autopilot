import { experimental_evaluate as evaluate } from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Telemetry, PilotResponse, ChoiceAnswer } from '../src/types';

/**
 * Turns raw telemetry into a situation report Jev can reason about.
 * Jev is a System One model: strong at semantic judgment, weak at arithmetic.
 * So code does the math and hands over plain-language facts plus rounded numbers.
 */
function describe(t: Telemetry) {
  const abs = Math.abs;
  const r = (n: number, d = 0) => Number(n.toFixed(d));

  const side = t.bearingToPad > 0 ? 'right' : 'left';
  const bearingWords =
    t.distanceToPad < t.padRadius
      ? 'the drone is over the pad, so heading no longer matters; keep the nose still'
      : abs(t.bearingToPad) < 5
      ? 'the pad is straight ahead, nose is pointing at it'
      : abs(t.bearingToPad) < 20
        ? `the pad is slightly to the ${side} of the nose`
        : abs(t.bearingToPad) < 60
          ? `the pad is clearly to the ${side}, a turn is needed`
          : abs(t.bearingToPad) < 120
            ? `the pad is far to the ${side}, almost sideways`
            : `the pad is behind the drone, a large turn is needed`;

  const distanceWords =
    t.distanceToPad < t.padRadius * 0.5
      ? 'directly over the center of the landing pad'
      : t.distanceToPad < t.padRadius
        ? 'over the landing pad, near its edge'
        : t.distanceToPad < 8
          ? 'very close to the pad, a few meters off'
          : t.distanceToPad < 25
            ? 'close to the pad, final approach range'
            : t.distanceToPad < 80
              ? 'a medium distance from the pad'
              : 'far from the pad, still in cruise';

  const altitudeWords =
    t.altitude < 0.3
      ? 'on the ground'
      : t.altitude < 2
        ? 'barely off the ground, very low'
        : t.altitude < t.cruiseAltitude * 0.6
          ? 'low, well below cruise altitude'
          : t.altitude < t.cruiseAltitude * 0.9
            ? 'a bit below cruise altitude'
            : t.altitude < t.cruiseAltitude * 1.15
              ? 'at cruise altitude'
              : t.altitude < t.cruiseAltitude * 1.6
                ? 'above cruise altitude'
                : 'much too high, far above cruise altitude';

  const vsWords =
    t.verticalSpeed > 1.5
      ? 'climbing fast'
      : t.verticalSpeed > 0.3
        ? 'climbing gently'
        : t.verticalSpeed < -2.5
          ? 'descending dangerously fast'
          : t.verticalSpeed < -0.8
            ? 'descending'
            : t.verticalSpeed < -0.2
              ? 'sinking slowly'
              : 'holding altitude';

  const speedWords =
    t.groundSpeed < 0.5
      ? 'hovering, almost no horizontal motion'
      : t.groundSpeed < 2.5
        ? 'moving slowly'
        : t.groundSpeed < 7
          ? 'moving at a moderate speed'
          : 'moving fast';

  const lateralWords =
    abs(t.velocityRight) < 0.4
      ? 'no sideways drift'
      : `drifting to the ${t.velocityRight > 0 ? 'right' : 'left'} at ${r(abs(t.velocityRight), 1)} m/s`;

  const forwardMotion =
    t.velocityForward > 0.4
      ? `flying forward at ${r(t.velocityForward, 1)} m/s`
      : t.velocityForward < -0.4
        ? `flying backward at ${r(abs(t.velocityForward), 1)} m/s`
        : 'no forward motion';

  const padOffsetWords =
    t.distanceToPad < 1.5
      ? 'the drone is within a meter of the pad center; no horizontal correction is needed'
      : t.distanceToPad < 12
      ? `relative to the nose, the pad center is ${r(t.padForward, 1)} m ${t.padForward >= 0 ? 'ahead' : 'behind'} and ${r(abs(t.padRight), 1)} m to the ${t.padRight >= 0 ? 'right' : 'left'}`
      : 'not close enough to the pad for a precise offset';

  const obstacleWords =
    t.obstacleAhead === null
      ? 'no building in the forward path'
      : t.obstacleAhead < 15
        ? `a building is directly ahead only ${r(t.obstacleAhead)} m away, collision imminent unless the drone climbs or stops`
        : `a building is ahead about ${r(t.obstacleAhead)} m away at the current altitude`;

  const clearance = t.altitude - t.tallestObstacleOnPath;
  const clearanceWords =
    t.tallestObstacleOnPath <= 0
      ? 'the direct path to the pad has no buildings'
      : clearance > 5
        ? `the drone is safely above every building on the direct path (tallest is ${r(t.tallestObstacleOnPath)} m)`
        : `the drone is NOT above the buildings on the direct path (tallest is ${r(t.tallestObstacleOnPath)} m), it must climb before flying toward the pad`;

  return {
    mission: 'Fly the quadcopter from the launch pad to the landing pad and land softly on its center.',
    phase: t.phase,
    position: distanceWords,
    heading: bearingWords,
    bearingToPadDegrees: r(t.bearingToPad),
    distanceToPadMeters: r(t.distanceToPad, 1),
    padOffset: padOffsetWords,
    altitude: altitudeWords,
    altitudeMeters: r(t.altitude, 1),
    cruiseAltitudeMeters: r(t.cruiseAltitude),
    verticalMotion: vsWords,
    horizontalMotion: `${speedWords}; ${forwardMotion}; ${lateralWords}`,
    obstacles: `${obstacleWords}. ${clearanceWords}.`,
    controls:
      'DJI Mode 2 remote. Left stick up/down = climb/descend. Left stick left/right = turn the nose. Right stick up/down = fly forward/backward. Right stick left/right = slide sideways. Releasing all sticks makes the drone hover in place and self-level.',
  };
}

export function createPilotHandler(apiKey: string | undefined) {
  if (!apiKey) throw new Error('TYPESAFE_AI_API_KEY is not set');
  const typeSafe = createTypeSafeAi({ apiKey });
  const model = typeSafe.evaluationModel('jev-latest');

  return async function handle(telemetry: Telemetry): Promise<PilotResponse> {
    const situation = describe(telemetry);
    const started = performance.now();

    const result = await evaluate({
      model,
      state: situation,
      questions: {
        throttle: {
          type: 'choice',
          instructions:
            'Which left-stick vertical input should the pilot apply right now to manage altitude? Consider `altitude`, `verticalMotion`, `obstacles` and `position`. Take off by climbing. Cruise at cruise altitude and never below the tallest building on the path. Only descend when over the pad. When over the pad, descend gently; descend faster when high, slower when close to the ground. On the ground after landing, hold.',
          criteria: {
            climb_fast: 'Push the left stick fully up. For takeoff, for climbing over a building, or when far below cruise altitude.',
            climb: 'Push the left stick halfway up. For a gentle climb when a bit below cruise altitude.',
            hold_altitude: 'Center the left stick. Keep the current altitude: at cruise altitude while flying to the pad, or when already on the ground.',
            descend: 'Pull the left stick down a little. A gentle descent for landing when over the pad and within a few meters of the ground, or to correct being slightly above cruise altitude.',
            descend_fast: 'Pull the left stick well down. A brisk descent when over the pad and still high up, or when far above cruise altitude and not over buildings.',
          },
        },
        yaw: {
          type: 'choice',
          instructions:
            'Which left-stick horizontal input should the pilot apply to point the nose at the landing pad? Use `heading` and `bearingToPadDegrees`. A positive bearing means the pad is to the right. When the pad is straight ahead, or the drone is over the pad, hold heading. Use hard turns only for large bearings.',
          criteria: {
            turn_left_hard: 'Full left. The pad is far to the left or behind.',
            turn_left: 'Small left input. The pad is slightly or clearly to the left.',
            hold_heading: 'Center. The pad is straight ahead, or the drone is over the pad and landing.',
            turn_right: 'Small right input. The pad is slightly or clearly to the right.',
            turn_right_hard: 'Full right. The pad is far to the right or behind.',
          },
        },
        pitch: {
          type: 'choice',
          instructions:
            'Which right-stick vertical input should the pilot apply to cover the distance to the pad? Use `position`, `heading`, `horizontalMotion`, `obstacles` and `altitude`. Do not fly forward while on the ground or barely off the ground, or while the nose points well away from the pad, or while a building is ahead and the drone is not above it. Slow down when close to the pad. When over the pad, use small inputs to stay centered, using `padOffset`.',
          criteria: {
            full_forward: 'Push the right stick fully forward. The pad is far away and straight ahead, the path is clear, and the drone is at cruise altitude.',
            forward: 'Push the right stick forward a little. The pad is a medium or close distance ahead, or the drone is over the pad but the pad center is ahead of the nose.',
            neutral: 'Center the right stick. Hovering over the pad center, climbing on takeoff, turning the nose toward the pad, or on the ground.',
            pull_back: 'Pull the right stick back a little. The drone is close to the pad and moving forward too fast, or the pad center is slightly behind the nose.',
            brake_hard: 'Pull the right stick fully back. The drone is moving fast and about to overshoot the pad, or a building is directly ahead and collision is imminent.',
          },
        },
        roll: {
          type: 'choice',
          instructions:
            'Which right-stick horizontal input should the pilot apply to correct sideways position? Use `padOffset` and `horizontalMotion`. Only use this when close to or over the pad; otherwise stay neutral and let yaw and pitch do the work. Counter sideways drift.',
          criteria: {
            slide_left: 'Right stick left. The pad center is to the left of the nose while close, or the drone is drifting right.',
            neutral: 'Center. No sideways correction needed, or the drone is far from the pad.',
            slide_right: 'Right stick right. The pad center is to the right of the nose while close, or the drone is drifting left.',
          },
        },
        commitToLanding: {
          type: 'boolean',
          instructions:
            'Should the pilot commit to landing now? True only when the drone is over the landing pad, moving slowly with no large sideways drift, and pointing roughly toward the pad center. See `position`, `horizontalMotion`, `padOffset`.',
        },
        cutMotors: {
          type: 'boolean',
          instructions:
            'Has the drone touched down on the landing pad so the motors should be stopped? True only when `altitude` says it is on the ground AND `position` says it is over the landing pad.',
        },
      },
    });

    const latencyMs = performance.now() - started;
    const conf = (result.providerMetadata?.typesafe as { confidence?: Record<string, number> } | undefined)?.confidence ?? {};
    const pick = <K extends string>(id: string, a: { choice: K; probabilities?: Record<K, number> }): ChoiceAnswer<K> => ({
      choice: a.choice,
      // Fall back to a one-hot distribution if the provider omits probabilities.
      probabilities: a.probabilities ?? ({ [a.choice]: 1 } as Record<K, number>),
      confidence: conf[id] ?? null,
    });

    const a = result.answers;
    return {
      answers: {
        throttle: pick('throttle', a.throttle),
        yaw: pick('yaw', a.yaw),
        pitch: pick('pitch', a.pitch),
        roll: pick('roll', a.roll),
        commitToLanding: a.commitToLanding.probability,
        cutMotors: a.cutMotors.probability,
      },
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      latencyMs,
      situation,
    };
  };
}
