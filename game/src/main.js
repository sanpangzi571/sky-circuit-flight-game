// Sky Circuit bootstrap: wires the world, the renderer and the input together.
// With ?shot=<scene>&seed=<n> it stages one real simulated scene and draws a single
// frame (that is how the screenshots in ../../screenshots were taken); otherwise it
// runs the interactive game: title, flight, results, restart.

import { STEP } from './config.js';
import { createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { pilotControls, stageShot } from './shots.js';
import { createWorld, PHASE_FLY, PHASE_OVER } from './world.js';

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7) || 7;

const world = createWorld(seed);
const renderer = createRenderer(canvas);
const input = createInput(canvas);

// A tiny generated soundscape: no audio files, just short oscillator blips on events.
let audio = null;
function blip(freq, seconds, type = 'sine', gain = 0.05) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, audio.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds);
    osc.connect(amp).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + seconds);
  } catch {
    // Sound is a garnish; a silent game is still a game.
  }
}

function drainEvents() {
  for (const event of world.state.events) {
    if (event === 'ring') { blip(880, 0.12); setTimeout(() => blip(1320, 0.14), 70); }
    if (event === 'miss') blip(190, 0.2, 'sawtooth', 0.035);
    if (event === 'land') blip(520, 0.3, 'triangle', 0.06);
    if (event === 'crash') blip(90, 0.5, 'sawtooth', 0.07);
  }
  world.state.events.length = 0;
  if (world.state.message) status.textContent = `${world.state.message.text} — ${world.state.message.sub}`;
}

const shot = params.get('shot');
if (shot) {
  const { screen } = stageShot(shot, world);
  renderer.draw(world, screen);
  window.__shot = {
    scene: shot,
    seed,
    screen,
    score: world.state.score,
    ringsPassed: world.state.ringsPassed,
    phase: world.state.phase,
    endReason: world.state.endReason,
  };
  document.body.dataset.shotReady = '1';
} else {
  let screen = SCREEN_TITLE;
  let overAt = 0;
  let last = performance.now();
  let titleClock = 0;

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyR' && screen === SCREEN_OVER) {
      world.reset();
      screen = SCREEN_PLAY;
      input.controls.startPressed = false;
    }
  });
  canvas.addEventListener('pointerdown', () => {
    if (screen === SCREEN_OVER && performance.now() - overAt > 600) {
      world.reset();
      screen = SCREEN_PLAY;
    }
  });

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (screen === SCREEN_TITLE) {
      // The valley lives behind the title: the autopilot cruises it.
      titleClock += dt;
      let acc = dt;
      while (acc > 0) {
        const step = Math.min(STEP, acc);
        world.step(step, pilotControls(world, 'cruise'));
        acc -= step;
        if (world.state.phase === PHASE_OVER) world.reset();
      }
      if (input.controls.startPressed) {
        input.controls.startPressed = false;
        world.reset();
        screen = SCREEN_PLAY;
        blip(660, 0.1);
      }
    } else if (screen === SCREEN_PLAY) {
      const controls = input.poll();
      let acc = dt;
      while (acc > 0) {
        const step = Math.min(STEP, acc);
        world.step(step, controls);
        acc -= step;
        if (world.state.phase !== PHASE_FLY) break;
      }
      drainEvents();
      if (world.state.phase === PHASE_OVER) {
        screen = SCREEN_OVER;
        overAt = now;
      }
    }
    renderer.draw(world, screen);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.__game = { world, seed };
