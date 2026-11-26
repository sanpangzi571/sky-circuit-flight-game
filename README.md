# Sky Circuit — River Valley Run

![make.fun bounty](https://make.fun/badge/best-flight-game-20261126-0057.svg)
![rank](https://make.fun/badge/best-flight-game-20261126-0057/sanpangzi571/sky-circuit-flight-game/rank.svg)
![reward](https://make.fun/badge/best-flight-game-20261126-0057/sanpangzi571/sky-circuit-flight-game/reward.svg)

A chase-view flight game for make.fun's [Make the best flight game](https://make.fun/bounty/best-flight-game-20261126-0057) bounty ($500, paid to the top 50). Built by an AI agent from a single prompt; the build transcripts ship with the entry.

## The game

You are airborne over a river valley in a little red taildragger. Fourteen glowing rings hang down the valley — thread them in order, chase the centre of each one, and build your combo to ×2.5. Then the rings run out and the strip is ahead of you: ride the glide slope down, mind your sink rate, and put her on the runway for the landing bonus and whatever time bonus is left on the clock.

- **Pseudo-3D valley** — a projected heightfield with a winding river, pine slopes, a village, clouds and hazy ridgelines, all grown from one seed.
- **Real flight model** — bank, pitch, throttle, boost and air brake; a banked wing turns the nose, boost drinks the fuel, a dead engine glides.
- **Lit instruments** — airspeed and altimeter gauges with moving needles, an artificial horizon that rolls with the wings, a sliding heading compass, fuel and throttle bars, plus a HUD with score, combo, clock and a guide arrow to the next gate.
- **A full sortie** — title screen, the ring course, the final approach, touchdown or crash, and a results card with ring points, bonuses and a grade from D to S.

## Controls

| Input | Effect |
| --- | --- |
| W / S or ↑ / ↓ | climb / descend |
| A / D or ← / → | bank left / right |
| Mouse | steer toward the pointer; hold the button to boost |
| Shift | boost |
| Space | air brake |
| Q / E | throttle trim down / up |
| Enter or click | start |
| R | fly again after the run |

## Play it

```sh
node serve.ts   # then open http://localhost:8080
```

No build step and no network: `game/` is plain static files and everything is drawn with canvas paths — there are no image, font or sound files to load.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library (`vendor/makefun-game.ts`, copied unchanged from the competition kit). The output is deterministic: two runs produce byte-identical trees.

## Screenshots

The four frames in `screenshots/` are real renders of the game, staged by an autopilot that flies the simulation through the same controls a player uses (`game/src/shots.js`, driven by `tools/shoot.mjs`): the title over the valley, mid-course at the fifth ring, low on final approach with the strip ahead, and the touchdown results card of a completed run — 14 of 14 rings, grade S.

## Layout

- `main.ts` — the hand-in program (Node 22, standard library only)
- `serve.ts` — a pocket static server for local play
- `game/` — the game: `index.html` plus ES modules under `src/` (`world.js` simulation, `render.js` pseudo-3D drawing, `input.js`, `shots.js`, `config.js`, `random.js`)
- `screenshots/` — the four staged frames
- `tools/shoot.mjs` — the Playwright driver that plays the game and takes the screenshots
- `vendor/makefun-game.ts` — make.fun's dossier library, unchanged

MIT licensed — see `LICENSE`.
