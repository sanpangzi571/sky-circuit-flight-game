// Sky Circuit — River Valley Run: every tunable number for the game lives here, so the
// physics, the course and the scoring can be balanced without hunting through the code.

/** Fixed simulation step (seconds) used by screenshot staging and the autopilot. */
export const STEP = 1 / 60;

/** The valley the course runs through, in metres. */
export const WORLD = {
  corridorHalfWidth: 620, // terrain is modelled this far to each side of the course line
  ceiling: 330, // soft ceiling: above this the air is thin and the plane sinks back
  waterLevel: 2.4, // terrain lower than this renders as the river surface
  runwayAlt: 6, // height of the finish runway's strip
  runwayZ0: 6680, // runway threshold (where the landing zone starts)
  runwayZ1: 7620, // far end of the runway
  runwayHalfWidth: 21,
  courseEndZ: 7820, // flying past this ends the run one way or another
};

/** The aeroplane itself: speeds in m/s, angles in degrees unless noted. */
export const PLANE = {
  startAlt: 86,
  startSpeed: 56,
  minSpeed: 27,
  cruiseSpeed: 58,
  maxSpeed: 84,
  boostExtra: 20,
  brakeCut: 17,
  accel: 7.5, // how fast the speed chases its target, m/s per second
  maxBank: 58,
  bankRate: 150, // degrees per second the wings answer the stick
  maxPitch: 24,
  pitchRate: 68,
  startFuel: 100,
  fuelCruise: 0.5, // per second at cruise throttle
  fuelBoost: 1.25,
  fuelGlide: 0.16,
};

/** The ring course: how many gates, where they sit, and what they pay. */
export const COURSE = {
  ringCount: 14,
  firstRingZ: 520,
  ringGapZ: 425,
  ringRadius: 15,
  ringBaseScore: 300,
  ringCentreBonus: 200, // extra for threading the middle of a ring
  comboStep: 0.25, // each consecutive ring adds this to the score multiplier
  comboMax: 2.5,
  timeLimit: 150, // seconds on the clock at the start of a run
  landingBonus: 1000,
  timeBonusPerSecond: 10,
};

/** Grades handed out on the results screen, best first: [minimum score, letter]. */
export const GRADES = [
  [5200, 'S'],
  [4300, 'A'],
  [3300, 'B'],
  [2200, 'C'],
  [0, 'D'],
];

export function gradeFor(score) {
  for (const [min, letter] of GRADES) if (score >= min) return letter;
  return 'D';
}
