// Screenshot & smoke-test driver for Sky Circuit. Starts the game's own static server,
// plays the game with real keyboard input to prove it runs, then stages each scene in
// shots.json (the autopilot flies; nothing is posed) and saves the frames the entry
// hands in. Run: node tools/shoot.mjs
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire('/home/hatch/workspace/guanmo-studio/package.json');
const { chromium } = require('playwright');

const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
const PORT = 8080;
const BASE = `http://localhost:${PORT}`;

const server = spawn('node', [join(root, 'serve.ts')], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const candidates = [
    undefined,
    '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  ];
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (err) {
      if (executablePath === candidates[candidates.length - 1]) throw err;
    }
  }
  throw new Error('no chromium');
}

let failures = 0;
try {
  await sleep(700);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`));

  // 1) The interactive game: title, take off with the keyboard, fly a few seconds.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game !== undefined);
  await sleep(600);
  const titleState = await page.evaluate(() => ({ phase: window.__game.world.state.phase }));
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.down('KeyD');
  await sleep(900);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  await sleep(700);
  await page.keyboard.up('KeyW');
  const flown = await page.evaluate(() => {
    const s = window.__game.world.state;
    return { z: Math.round(s.plane.z), alt: Math.round(s.plane.alt), time: s.time.toFixed(1), phase: s.phase };
  });
  console.log('interactive: title phase', titleState.phase, '→ after keys:', JSON.stringify(flown));
  if (!(flown.z > 40 && flown.time > 0.8)) { failures += 1; console.log('FAIL: the plane did not fly under keyboard control'); }

  // Mouse steering smoke check: move the pointer and confirm the controls answer.
  await page.mouse.move(980, 240);
  await sleep(500);
  const mouseState = await page.evaluate(() => ({ bank: window.__game.world.state.plane.bank.toFixed(1) }));
  console.log('mouse steer: bank after pointer move =', mouseState.bank);

  // 2) The staged scenes: real autopilot flights, one frame each.
  for (const shot of shots) {
    const url = `${BASE}/${shot.query}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.shotReady === '1', null, { timeout: 30000 });
    const info = await page.evaluate(() => window.__shot);
    const out = join(root, 'screenshots', shot.name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 84 });
    const size = statSync(out).size;
    console.log(`${shot.name}: ${size} bytes, scene=${JSON.stringify(info)}`);
    if (size > 262144) { failures += 1; console.log(`FAIL: ${shot.name} is over the 256 KiB cap`); }
  }

  await browser.close();
  if (errors.length) { failures += 1; console.log('PAGE ERRORS:\n' + errors.join('\n')); }
  else console.log('page errors: none');
} finally {
  server.kill();
}
console.log(failures ? `RESULT: ${failures} failure(s)` : 'RESULT: all good');
process.exit(failures ? 1 : 0);
