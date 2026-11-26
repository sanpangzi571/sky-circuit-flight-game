// The screenshot scenes behind ?shot=title|play|approach|end. Each scene flies the real
// simulation forward from a fresh world, steered by the autopilot below through the same
// controls object a player's keyboard fills — nothing is placed by hand, so every frame
// is a moment a real flight reached, and the same seed always reaches the same frame.

import { STEP, WORLD } from './config.js';
import { PHASE_OVER } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The autopilot's ask for this step. In 'cruise' it weaves gently down the valley (the
 * title screen's living background). In 'play' it threads the rings. Once the rings are
 * done — or always, in 'approach' — it lines up on the strip and flies a glide slope down.
 */
export function pilotControls(world, mode) {
  const state = world.state;
  const p = state.plane;
  let tx;
  let talt;
  let tz;
  let throttle = 0.62;
  const ring = mode === 'cruise' ? null : world.nextRing();
  if (mode === 'cruise') {
    tx = 90 * Math.sin(state.time * 0.1);
    talt = 88;
    tz = p.z + 420;
  } else if (ring) {
    tx = ring.x;
    talt = ring.alt;
    tz = ring.z;
  } else {
    // Final approach: hold 52 m until 500 m out, ride the slope down to 9.5 m at 140 m
    // out, then settle the last of the height away over the threshold and touch.
    tx = 0;
    tz = WORLD.runwayZ0 + 320;
    const dz = WORLD.runwayZ0 - p.z;
    if (dz > 500) talt = 52;
    else if (dz > 140) talt = 9.5 + ((dz - 140) * 42.5) / 360;
    else talt = Math.max(WORLD.runwayAlt + 0.6, 9.5 - (140 - Math.max(dz, -500)) * 0.02);
    throttle = 0.34;
  }
  const desired = Math.atan2(tx - p.x, Math.max(60, tz - p.z)) / DEG;
  const err = ((desired - p.heading + 540) % 360) - 180;
  const roll = clamp(err * 0.05, -1, 1);
  const wantVy = clamp((talt - p.alt) * 0.25, -9, 9);
  const pitch = clamp((wantVy - p.vy) * 0.12, -1, 1);
  return { pitch, roll, throttle, boost: p.speed < 52 && p.fuel > 0, brake: false };
}

function fly(world, mode, seconds, stopWhen) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    world.step(STEP, pilotControls(world, mode));
    if (world.state.phase === PHASE_OVER) break;
    if (stopWhen && stopWhen(world)) break;
  }
}

/** Set `world` to the named scene and return the screen to draw over it. */
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    // Fly the course until the fifth gate is close ahead: a working moment, rings banked.
    fly(world, 'play', 60, (w) => {
      const resolved = w.rings.filter((r) => r.status === 'passed' || r.status === 'missed').length;
      const next = w.nextRing();
      return resolved >= 4 && next !== null && next.z - w.state.plane.z < 185;
    });
    return { screen: SCREEN_PLAY };
  }
  if (name === 'approach') {
    // Fly the whole course, then catch the frame low on final with the strip ahead.
    fly(world, 'approach', 240, (w) => {
      const p = w.state.plane;
      return w.nextRing() === null && WORLD.runwayZ0 - p.z < 330 && p.alt < 56;
    });
    return { screen: SCREEN_PLAY };
  }
  if (name === 'end') {
    // Fly it to the end of the run, whatever the end turns out to be.
    fly(world, 'approach', 300, null);
    return { screen: SCREEN_OVER };
  }
  // Anything else is the title: a few seconds of gentle cruising behind the lettering.
  fly(world, 'cruise', 5, null);
  return { screen: SCREEN_TITLE };
}
