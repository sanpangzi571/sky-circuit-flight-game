// Sky Circuit world: the valley terrain, the ring course, the finish runway and the
// aeroplane's flight model. Pure simulation — nothing here draws. The renderer reads the
// state; the player and the screenshot autopilot both steer through the same controls
// object { pitch, roll, throttle, boost, brake }, each in a plain numeric range.

import { COURSE, PLANE, WORLD } from './config.js';
import { makeNoise1d, makeRng } from './random.js';

export const PHASE_FLY = 'fly';
export const PHASE_OVER = 'over';

export const END_LANDED = 'landed';
export const END_CRASHED = 'crashed';
export const END_OVERSHOT = 'overshot';
export const END_TIMEOUT = 'timeout';
export const END_FUEL = 'fuel-starved';

export const RING_NEXT = 'next';
export const RING_OPEN = 'open';
export const RING_PASSED = 'passed';
export const RING_MISSED = 'missed';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The river's centreline: a lazy S-curve down the valley. */
export function riverX(z) {
  return 150 * Math.sin(z * 0.00042 + 0.8) + 60 * Math.sin(z * 0.0011 + 2.1);
}

export function createWorld(seed) {
  const rng = makeRng(seed * 7919 + 13);
  const hillNoise = makeNoise1d(seed * 31 + 7);
  const patchNoise = makeNoise1d(seed * 57 + 3);

  /** Rolling ground height before the river and runway carve their channels. */
  function rawHeight(x, z) {
    let h = 13
      + 11 * Math.sin(z * 0.0016 + Math.sin(x * 0.0009) * 2.2)
      + 8 * Math.sin(x * 0.0021 + z * 0.0007)
      + 9 * hillNoise(z * 0.006 + x * 0.0016);
    // The valley walls rise away from the course line.
    const ax = Math.abs(x);
    if (ax > 300) h += Math.min(150, (ax - 300) * 0.42);
    if (ax > 520) h += Math.min(120, (ax - 520) * 0.6);
    return h;
  }

  /** Ground height at a point, with the river bed and the runway strip pressed in. */
  function terrainHeight(x, z) {
    let h = rawHeight(x, z);
    const riverDist = Math.abs(x - riverX(z));
    if (riverDist < 110) {
      const bed = 1.1 + 0.5 * Math.sin(z * 0.002);
      h = Math.min(h, bed + (h - bed) * smoothstep(26, 110, riverDist));
    }
    // A calm apron around the start of the course and a flat pad for the runway.
    const pad = smoothstep(WORLD.runwayZ0 - 320, WORLD.runwayZ0 - 60, z)
      * (1 - smoothstep(WORLD.runwayZ1 + 60, WORLD.runwayZ1 + 320, z));
    const nearStrip = 1 - smoothstep(30, 95, Math.abs(x));
    const k = Math.max(pad * nearStrip, (1 - smoothstep(150, 420, z)) * (1 - smoothstep(55, 130, Math.abs(x))) * 0.85);
    if (k > 0) h = h + (WORLD.runwayAlt - h) * k;
    return Math.max(0.4, h);
  }

  /** What the ground is made of at a point: drives the renderer's colours. */
  function terrainKind(x, z, h) {
    if (h <= WORLD.waterLevel && Math.abs(x - riverX(z)) < 60) return 'water';
    if (z > WORLD.runwayZ0 - 40 && z < WORLD.runwayZ1 + 40 && Math.abs(x) < WORLD.runwayHalfWidth + 3) return 'runway';
    if (h <= WORLD.waterLevel + 1.6) return 'sand';
    if (h > 105) return 'rock';
    if (h > 62) return 'scrub';
    return patchNoise(x * 0.008 + z * 0.0035) > 0.28 ? 'forest' : 'grass';
  }

  // The ring course: gates strung down the valley, swinging side to side and up and down.
  const rings = [];
  for (let i = 0; i < COURSE.ringCount; i += 1) {
    rings.push({
      index: i,
      x: Math.round(118 * Math.sin(i * 0.92 + 0.5) + 34 * Math.sin(i * 2.1)),
      alt: Math.round(64 + 34 * Math.sin(i * 1.27 + 0.8)),
      z: COURSE.firstRingZ + i * COURSE.ringGapZ,
      r: COURSE.ringRadius,
      status: i === 0 ? RING_NEXT : RING_OPEN,
      centreDist: null,
    });
  }

  // Scenery: pine trees on the slopes, a village of small houses on the east bank, and
  // clouds. All placed from the seed, kept clear of the river, the strip and the gates.
  const trees = [];
  for (let i = 0; i < 340 && trees.length < 300; i += 1) {
    const x = (rng() * 2 - 1) * 560;
    const z = rng() * (WORLD.courseEndZ + 500);
    if (Math.abs(x - riverX(z)) < 42) continue;
    if (z > WORLD.runwayZ0 - 200 && Math.abs(x) < 80) continue;
    const h = terrainHeight(x, z);
    if (h <= WORLD.waterLevel + 1 || h > 120) continue;
    trees.push({ x, z, h, s: 0.75 + rng() * 0.9 });
  }
  const houses = [];
  for (let i = 0; i < 26; i += 1) {
    const x = 120 + rng() * 130;
    const z = 1750 + rng() * 750;
    const h = terrainHeight(x, z);
    if (h <= WORLD.waterLevel + 1) continue;
    houses.push({ x, z, h, w: 9 + rng() * 7, hue: rng() });
  }
  const clouds = [];
  for (let i = 0; i < 42; i += 1) {
    clouds.push({
      x: (rng() * 2 - 1) * 1500,
      z: rng() * (WORLD.courseEndZ + 2600) - 600,
      alt: 195 + rng() * 145,
      s: 42 + rng() * 78,
    });
  }

  const state = {
    time: 0,
    timeLeft: COURSE.timeLimit,
    phase: PHASE_FLY,
    endReason: null,
    plane: null,
    score: 0,
    ringScore: 0,
    landingScore: 0,
    timeScore: 0,
    combo: 1,
    bestCombo: 1,
    ringsPassed: 0,
    fuelOut: false,
    message: null, // { text, sub, until } — a centre-screen note the renderer shows
    events: [], // transient happenings for sound/popups: 'ring', 'miss', 'land', 'crash'
  };

  function reset() {
    state.time = 0;
    state.timeLeft = COURSE.timeLimit;
    state.phase = PHASE_FLY;
    state.endReason = null;
    state.score = 0;
    state.ringScore = 0;
    state.landingScore = 0;
    state.timeScore = 0;
    state.combo = 1;
    state.bestCombo = 1;
    state.ringsPassed = 0;
    state.fuelOut = false;
    state.message = null;
    state.events.length = 0;
    for (const ring of rings) {
      ring.status = ring.index === 0 ? RING_NEXT : RING_OPEN;
      ring.centreDist = null;
    }
    state.plane = {
      x: 0,
      z: 0,
      alt: PLANE.startAlt,
      heading: 0, // degrees, 0 = straight down the course (+Z)
      pitch: 0,
      bank: 0,
      speed: PLANE.startSpeed,
      vy: 0,
      throttle: 0.62,
      fuel: PLANE.startFuel,
      propSpin: 0,
    };
  }

  function nextRing() {
    for (const ring of rings) if (ring.status === RING_NEXT || ring.status === RING_OPEN) return ring;
    return null;
  }

  function say(text, sub, seconds) {
    state.message = { text, sub, until: state.time + seconds };
  }

  function finish(reason) {
    state.phase = PHASE_OVER;
    state.endReason = reason;
    if (reason === END_LANDED) {
      state.landingScore = COURSE.landingBonus;
      state.timeScore = Math.round(state.timeLeft) * COURSE.timeBonusPerSecond;
      state.events.push('land');
      say('TOUCHDOWN!', 'Greased it on the strip', 4);
    } else if (reason === END_CRASHED) {
      state.events.push('crash');
      say('CRASHED', 'The valley claims another', 4);
    }
    state.score = state.ringScore + state.landingScore + state.timeScore;
  }

  /** Advance the simulation one step. controls: { pitch, roll, throttle, boost, brake }. */
  function step(dt, controls) {
    if (state.phase !== PHASE_FLY) return;
    const p = state.plane;
    state.time += dt;
    state.timeLeft -= dt;
    p.propSpin += dt * (14 + p.speed * 0.55);

    // The stick answers: bank and pitch chase what the pilot asks for.
    const wantBank = clamp(controls.roll, -1, 1) * PLANE.maxBank;
    const wantPitch = clamp(controls.pitch, -1, 1) * PLANE.maxPitch;
    p.bank += clamp(wantBank - p.bank, -PLANE.bankRate * dt, PLANE.bankRate * dt);
    p.pitch += clamp(wantPitch - p.pitch, -PLANE.pitchRate * dt, PLANE.pitchRate * dt);

    // Turning: a banked wing pulls the nose around, slower the faster you fly.
    const turnRate = (9.8 * Math.tan(p.bank * DEG)) / Math.max(p.speed, 30) / DEG;
    p.heading += clamp(turnRate, -46, 46) * dt;
    p.heading = ((p.heading + 540) % 360) - 180;

    // Throttle, fuel and speed.
    p.throttle = clamp(controls.throttle, 0, 1);
    const boosting = controls.boost && p.fuel > 0;
    let target = PLANE.minSpeed + p.throttle * (PLANE.cruiseSpeed + 14 - PLANE.minSpeed);
    if (boosting) target += PLANE.boostExtra;
    if (controls.brake) target -= PLANE.brakeCut;
    if (p.fuel <= 0) {
      target = 36; // dead engine: a glider's best glide and no more
      if (!state.fuelOut) {
        state.fuelOut = true;
        say('ENGINE OUT', 'Out of fuel — glide for the strip', 3.2);
      }
    }
    target = clamp(target, PLANE.minSpeed, PLANE.maxSpeed + PLANE.boostExtra);
    p.speed += clamp(target - p.speed, -PLANE.accel * dt, PLANE.accel * dt);
    const burn = boosting ? PLANE.fuelBoost : p.throttle < 0.25 ? PLANE.fuelGlide : PLANE.fuelCruise;
    p.fuel = Math.max(0, p.fuel - burn * dt);

    // Move: forward along the heading, climbing or sinking with the pitch.
    const headRad = p.heading * DEG;
    p.vy = Math.sin(p.pitch * DEG) * p.speed;
    p.x += Math.sin(headRad) * p.speed * dt;
    p.z += Math.cos(headRad) * p.speed * dt;
    p.alt += p.vy * dt;
    if (p.alt > WORLD.ceiling) {
      p.alt = WORLD.ceiling;
      p.vy = Math.min(p.vy, 0);
    }

    // Rings: crossing a gate's plane settles whether it was threaded.
    for (const ring of rings) {
      if (ring.status !== RING_NEXT && ring.status !== RING_OPEN) continue;
      if (p.z - p.speed * dt < ring.z && p.z >= ring.z) {
        const dx = p.x - ring.x;
        const dy = p.alt - ring.alt;
        const dist = Math.hypot(dx, dy);
        ring.centreDist = dist;
        if (dist <= ring.r) {
          ring.status = RING_PASSED;
          state.ringsPassed += 1;
          const centreBonus = Math.round(COURSE.ringCentreBonus * (1 - dist / ring.r));
          const gained = Math.round((COURSE.ringBaseScore + centreBonus) * state.combo);
          state.ringScore += gained;
          state.combo = Math.min(COURSE.comboMax, state.combo + COURSE.comboStep);
          state.bestCombo = Math.max(state.bestCombo, state.combo);
          state.events.push('ring');
          say(`RING ${ring.index + 1}  +${gained}`, dist < ring.r * 0.4 ? 'Dead centre!' : 'Through!', 1.15);
        } else {
          ring.status = RING_MISSED;
          state.combo = 1;
          state.events.push('miss');
          say(`RING ${ring.index + 1} MISSED`, dist < ring.r * 2 ? 'So close' : 'Off line', 1.15);
        }
        const next = nextRing();
        if (next && next.status === RING_OPEN) next.status = RING_NEXT;
      }
    }
    state.score = state.ringScore + state.landingScore + state.timeScore;

    // Ground, strip and the end of the run.
    const ground = terrainHeight(p.x, p.z);
    // The flattened apron just short of the threshold counts as the strip: it is the
    // same flat pad, and a gentle arrival there is a landing, not a crash.
    const onStrip = p.z > WORLD.runwayZ0 - 90 && p.z < WORLD.runwayZ1 && Math.abs(p.x) < WORLD.runwayHalfWidth;
    if (p.alt <= ground + 1.7) {
      if (onStrip && p.vy > -9 && Math.abs(p.bank) < 24) {
        p.alt = ground + 1.7;
        finish(END_LANDED);
      } else {
        finish(END_CRASHED);
      }
      return;
    }
    if (p.z > WORLD.courseEndZ) {
      finish(END_OVERSHOT);
      return;
    }
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      finish(state.fuelOut ? END_FUEL : END_TIMEOUT);
    }
  }

  reset();

  return {
    state,
    rings,
    trees,
    houses,
    clouds,
    terrainHeight,
    terrainKind,
    riverX,
    nextRing,
    reset,
    step,
  };
}
