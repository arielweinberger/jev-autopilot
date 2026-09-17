/** Driver inputs. */
export interface Controls {
  /** -1 = full left, +1 = full right. */
  steer: number;
  /** 0..1 accelerator pedal. */
  throttle: number;
  /** 0..1 brake pedal. */
  brake: number;
}

export type Phase = 'ready' | 'driving' | 'arrived' | 'crashed';
export type Maneuver = 'turn_left' | 'go_straight' | 'turn_right';
export type LightState = 'green' | 'yellow' | 'red';

/** Everything the autopilot is told. All numbers are pre-computed by code. */
export interface Telemetry {
  phase: Phase;
  speedKmh: number;
  /** Speed code considers right for this spot: cruise, slower for a turn, zero at a red light or the destination. */
  advisedSpeedKmh: number;
  /** Distance the car needs to come to a stop from its current speed, meters. */
  stoppingDistance: number;
  /** Lateral distance from the lane center, meters. Positive = car is right of center. */
  laneOffset: number;
  /** Angle between the car's heading and the lane direction, degrees. Positive = pointing right. */
  headingError: number;
  /** Where the lane center is 10 m ahead, in the car's frame. Positive right = lane bends right. */
  lookaheadRight: number;
  /** Same, 22 m ahead. */
  lookaheadFarRight: number;
  /** Meters to the stop line of the next intersection along the road. Negative once past it. */
  distanceToStopLine: number;
  inIntersection: boolean;
  /** Which exits the next intersection has. */
  exits: { left: boolean; straight: boolean; right: boolean };
  /** Maneuver already committed for the next intersection, if any. */
  plannedManeuver: Maneuver | null;
  /** Traffic light facing the car at the next intersection, if there is one. */
  light: LightState | null;
  /** Destination position in the car's frame, in blocks (one block = one intersection spacing). */
  destBlocksAhead: number;
  destBlocksRight: number;
  /** Straight-line distance to the destination, meters. */
  distanceToDestination: number;
  /** If the destination is on the road the car is currently on, its distance ahead along the road. */
  destinationAheadOnThisRoad: number | null;
  redLightsRun: number;
}

export const STEER_OPTIONS = {
  hard_left: -1,
  left: -0.4,
  straight: 0,
  right: 0.4,
  hard_right: 1,
} as const;

/** Pedal choices on one axis: positive = gas, negative = brake. Never both at once. */
export const PEDAL_OPTIONS = {
  accelerate_hard: 1,
  accelerate: 0.45,
  coast: 0,
  brake: -0.45,
  brake_hard: -1,
} as const;

export interface ChoiceAnswer<K extends string> {
  choice: K;
  probabilities: Record<K, number>;
  confidence: number | null;
}

export interface PilotAnswers {
  steer: ChoiceAnswer<keyof typeof STEER_OPTIONS>;
  pedal: ChoiceAnswer<keyof typeof PEDAL_OPTIONS>;
  /** Only present when the car is approaching an intersection with no committed maneuver. */
  maneuver?: ChoiceAnswer<Maneuver>;
  /** Probability that the trip is complete: stopped at the destination. */
  arrived: number;
}

export interface PilotResponse {
  answers: PilotAnswers;
  usage: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  situation: Record<string, unknown>;
}
