/** Stick deflections, DJI Mode 2. All values in [-1, 1]. */
export interface Sticks {
  /** Left stick vertical. +1 = climb, -1 = descend, 0 = hold altitude. */
  throttle: number;
  /** Left stick horizontal. +1 = yaw right (clockwise from above). */
  yaw: number;
  /** Right stick vertical. +1 = pitch forward (nose down, fly forward). */
  pitch: number;
  /** Right stick horizontal. +1 = roll right (fly right). */
  roll: number;
}

export type Phase = 'grounded' | 'airborne' | 'landed' | 'crashed';

/** Telemetry sent to the autopilot. Everything is pre-computed in code. */
export interface Telemetry {
  phase: Phase;
  /** Height above ground, meters. */
  altitude: number;
  /** Vertical speed, m/s. Positive = climbing. */
  verticalSpeed: number;
  /** Horizontal ground speed, m/s. */
  groundSpeed: number;
  /** Horizontal distance from drone to landing pad center, meters. */
  distanceToPad: number;
  /** Signed angle from the drone's nose to the pad, degrees. Positive = pad is to the right. */
  bearingToPad: number;
  /** Pad position in the drone's body frame, meters. */
  padForward: number;
  padRight: number;
  /** Velocity in the drone's body frame, m/s. */
  velocityForward: number;
  velocityRight: number;
  /** Nearest obstacle within a forward cone, meters, or null. */
  obstacleAhead: number | null;
  /** Height of the tallest building near the direct path, meters. */
  tallestObstacleOnPath: number;
  /** Suggested cruise altitude, meters. */
  cruiseAltitude: number;
  /** Radius of the landing pad, meters. */
  padRadius: number;
}

export const THROTTLE_OPTIONS = {
  climb_fast: 1,
  climb: 0.5,
  hold_altitude: 0,
  descend: -0.25,
  descend_fast: -0.7,
} as const;

export const YAW_OPTIONS = {
  turn_left_hard: -1,
  turn_left: -0.25,
  hold_heading: 0,
  turn_right: 0.25,
  turn_right_hard: 1,
} as const;

export const PITCH_OPTIONS = {
  full_forward: 1,
  forward: 0.5,
  neutral: 0,
  pull_back: -0.5,
  brake_hard: -1,
} as const;

export const ROLL_OPTIONS = {
  slide_left: -0.5,
  neutral: 0,
  slide_right: 0.5,
} as const;

export interface ChoiceAnswer<K extends string> {
  choice: K;
  probabilities: Record<K, number>;
  confidence: number | null;
}

export interface PilotAnswers {
  throttle: ChoiceAnswer<keyof typeof THROTTLE_OPTIONS>;
  yaw: ChoiceAnswer<keyof typeof YAW_OPTIONS>;
  pitch: ChoiceAnswer<keyof typeof PITCH_OPTIONS>;
  roll: ChoiceAnswer<keyof typeof ROLL_OPTIONS>;
  /** Probability that the drone should commit to landing now. */
  commitToLanding: number;
  /** Probability that the drone is down on the pad and motors should stop. */
  cutMotors: number;
}

export interface PilotResponse {
  answers: PilotAnswers;
  usage: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  /** Echo of the situation report Jev was shown, for the HUD. */
  situation: Record<string, unknown>;
}
