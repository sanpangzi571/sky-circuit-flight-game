// Sky Circuit renderer: a pseudo-3D chase view drawn with plain canvas paths.
// The valley is a projected heightfield mesh (far rows first), then the runway, the
// scenery, the rings, the aeroplane, and finally the lit instrument panel and HUD.
// Everything is drawn from the world state each frame — nothing is pre-rendered.

import { COURSE, WORLD, gradeFor } from './config.js';
import { END_CRASHED, END_LANDED, PHASE_OVER, RING_MISSED, RING_NEXT, RING_PASSED } from './world.js';
import { makeNoise1d } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_OVER = 'over';

const DEG = Math.PI / 180;
const ridgeFar = makeNoise1d(1234);
const ridgeNear = makeNoise1d(987);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const KIND_FILL = {
  water: '#2e6da8',
  sand: '#c9b183',
  grass: '#5da24c',
  forest: '#3c7a3a',
  scrub: '#8a9a58',
  rock: '#8d8578',
  runway: '#4a4d52',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- camera & projection -------------------------------------------------
  // The camera sits a little behind and above the plane, looking along its heading
  // with a softened share of its pitch; the whole picture rolls a little with the wings.
  function makeCamera(plane) {
    const headRad = plane.heading * DEG;
    const f = { x: Math.sin(headRad), z: Math.cos(headRad) };
    const camPitch = plane.pitch * 0.55 * DEG;
    return {
      x: plane.x - f.x * 13,
      z: plane.z - f.z * 13,
      alt: plane.alt + 4.2,
      fx: f.x,
      fz: f.z,
      rx: f.z, // right vector = forward rotated -90°
      rz: -f.x,
      pitch: camPitch,
      roll: -plane.bank * 0.42 * DEG,
      focal: H * 0.92,
      horizonY: H * 0.46,
    };
  }

  function project(cam, x, y, z) {
    const dx = x - cam.x;
    const dy = y - cam.alt;
    const dz = z - cam.z;
    const cx = dx * cam.rx + dz * cam.rz;
    const cz = dx * cam.fx + dz * cam.fz;
    if (cz < 1.2) return null;
    const cy = dy * Math.cos(cam.pitch) - cz * Math.sin(cam.pitch);
    const fwd = dy * Math.sin(cam.pitch) + cz * Math.cos(cam.pitch);
    if (fwd < 1.2) return null;
    let sx = W / 2 + (cx * cam.focal) / fwd;
    let sy = cam.horizonY - (cy * cam.focal) / fwd;
    // Roll the picture around the centre of the screen.
    const ox = sx - W / 2;
    const oy = sy - cam.horizonY;
    const cos = Math.cos(cam.roll);
    const sin = Math.sin(cam.roll);
    sx = W / 2 + ox * cos - oy * sin;
    sy = cam.horizonY + ox * sin + oy * cos;
    return { x: sx, y: sy, depth: fwd };
  }

  // ---- sky, sun, far mountains ---------------------------------------------
  function drawSky(cam, plane) {
    const grad = ctx.createLinearGradient(0, 0, 0, cam.horizonY * 1.7);
    grad.addColorStop(0, '#274b7a');
    grad.addColorStop(0.55, '#7fb0dd');
    grad.addColorStop(1, '#dceefb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Sun, high to the left, with a soft glow.
    const sunX = W * 0.2;
    const sunY = H * 0.13;
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 120);
    glow.addColorStop(0, 'rgba(255,244,200,0.95)');
    glow.addColorStop(0.25, 'rgba(255,236,170,0.45)');
    glow.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 130, sunY - 130, 260, 260);
    // Two parallax ridgelines; their shapes slide as the heading turns.
    ridge(cam, plane, 1.9, 0.34, 0.16, '#5d7ba3', ridgeFar);
    ridge(cam, plane, 3.1, 0.4, 0.2, '#48688f', ridgeNear);
  }

  function ridge(cam, plane, scale, base, amp, colour, noise) {
    ctx.beginPath();
    ctx.moveTo(-4, cam.horizonY + 2);
    const shift = plane.heading * 0.045 * scale + plane.z * 0.00012 * scale;
    for (let sx = -4; sx <= W + 16; sx += 16) {
      const n = noise((sx / W) * 6 * scale + shift * 10) * 0.6 + noise((sx / W) * 17 * scale + shift * 23) * 0.4;
      const y = cam.horizonY - (base * 0.12 + n * amp + amp * 0.4) * H * 0.36;
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(W + 4, cam.horizonY + 2);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // ---- terrain mesh ----------------------------------------------------------
  const ROWS = 44;
  const COLS = 22;

  function drawTerrain(cam, world) {
    // Depth rows bunch near the camera and stretch away; columns fan out with depth.
    let prev = null;
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      const t = r / ROWS;
      const depth = 2 + Math.pow(t, 2.1) * 1150;
      const half = 26 + depth * 1.25;
      const row = [];
      for (let c = 0; c <= COLS; c += 1) {
        const lat = -half + (2 * half * c) / COLS;
        const wx = cam.x + cam.fx * depth + cam.rx * lat;
        const wz = cam.z + cam.fz * depth + cam.rz * lat;
        const h = world.terrainHeight(wx, wz);
        row.push({ wx, wz, h, p: project(cam, wx, h, wz) });
      }
      if (prev) {
        for (let c = 0; c < COLS; c += 1) {
          const a = row[c];
          const b = row[c + 1];
          const a2 = prev[c];
          const b2 = prev[c + 1];
          if (!a.p || !b.p || !a2.p || !b2.p) continue;
          const mx = (a.wx + b2.wx) / 2;
          const mz = (a.wz + b2.wz) / 2;
          const mh = (a.h + b2.h) / 2;
          const kind = world.terrainKind(mx, mz, mh);
          let fill = KIND_FILL[kind];
          // A checker of light over the fields, and depth haze toward the horizon.
          const checker = ((Math.floor(mz / 90) + Math.floor(mx / 90)) % 2 + 2) % 2;
          ctx.fillStyle = fill;
          ctx.globalAlpha = kind === 'grass' || kind === 'forest' ? (checker ? 0.92 : 1) : 1;
          ctx.beginPath();
          ctx.moveTo(a.p.x, a.p.y);
          ctx.lineTo(b.p.x, b.p.y);
          ctx.lineTo(b2.p.x, b2.p.y);
          ctx.lineTo(a2.p.x, a2.p.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      prev = row;
    }
    const haze = ctx.createLinearGradient(0, cam.horizonY - H * 0.06, 0, cam.horizonY + H * 0.13);
    haze.addColorStop(0, 'rgba(220,238,251,0.26)');
    haze.addColorStop(1, 'rgba(220,238,251,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, cam.horizonY - H * 0.06, W, H * 0.19);
  }

  // ---- runway ------------------------------------------------------------------
  function drawRunway(cam) {
    const z0 = WORLD.runwayZ0;
    const z1 = WORLD.runwayZ1;
    const hw = WORLD.runwayHalfWidth;
    const alt = WORLD.runwayAlt + 0.15;
    const corners = [
      project(cam, -hw, alt, z0),
      project(cam, hw, alt, z0),
      project(cam, hw, alt, z1),
      project(cam, -hw, alt, z1),
    ];
    if (corners.some((p) => !p)) return;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = '#43464c';
    ctx.fill();
    // Threshold bars and the dashed centreline.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i += 1) {
      const lx = -hw + 4 + i * ((hw * 2 - 8) / 5);
      const a = project(cam, lx - 1.1, alt, z0 + 6);
      const b = project(cam, lx + 1.1, alt, z0 + 6);
      const c = project(cam, lx + 1.1, alt, z0 + 34);
      const d = project(cam, lx - 1.1, alt, z0 + 34);
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let z = z0 + 90; z < z1 - 40; z += 90) {
      const a = project(cam, -1.4, alt, z);
      const b = project(cam, 1.4, alt, z + 34);
      if (!a || !b) continue;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) + 1.5, Math.abs(b.y - a.y) + 1.5);
    }
    // Edge lights, warm dots down both sides.
    ctx.fillStyle = '#ffd98a';
    for (let z = z0; z <= z1; z += 70) {
      for (const side of [-hw - 2.5, hw + 2.5]) {
        const p = project(cam, side, alt + 0.4, z);
        if (!p) continue;
        const s = clamp(900 / p.depth, 0.7, 4.2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- scenery: clouds, trees, houses -------------------------------------------
  function drawScenery(cam, world, plane) {
    const items = [];
    for (const cloud of world.clouds) {
      const dz = cloud.z - plane.z;
      if (dz < -80 || dz > 2600) continue;
      items.push({ kind: 'cloud', o: cloud, depth: dz });
    }
    for (const tree of world.trees) {
      const dz = tree.z - plane.z;
      if (dz < -30 || dz > 780) continue;
      items.push({ kind: 'tree', o: tree, depth: dz });
    }
    for (const house of world.houses) {
      const dz = house.z - plane.z;
      if (dz < -30 || dz > 780) continue;
      items.push({ kind: 'house', o: house, depth: dz });
    }
    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) {
      if (item.kind === 'cloud') drawCloud(cam, item.o);
      else if (item.kind === 'tree') drawTree(cam, item.o);
      else drawHouse(cam, item.o);
    }
  }

  function drawCloud(cam, cloud) {
    const p = project(cam, cloud.x, cloud.alt, cloud.z);
    if (!p) return;
    const s = (cloud.s * cam.focal) / p.depth;
    if (s < 6) return;
    ctx.fillStyle = 'rgba(255,255,255,0.74)';
    for (const [ox, oy, r] of [[0, 0, 0.55], [-0.5, 0.08, 0.38], [0.48, 0.09, 0.4], [0.05, -0.16, 0.36]]) {
      ctx.beginPath();
      ctx.ellipse(p.x + ox * s, p.y + oy * s, r * s, r * s * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTree(cam, tree) {
    const base = project(cam, tree.x, tree.h, tree.z);
    if (!base) return;
    const s = (11 * tree.s * cam.focal) / base.depth / 60;
    if (s < 1.2) return;
    ctx.strokeStyle = '#5a4230';
    ctx.lineWidth = Math.max(1, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, base.y - s * 0.4);
    ctx.stroke();
    ctx.fillStyle = '#2e6b31';
    for (let i = 0; i < 3; i += 1) {
      const wdt = s * (0.62 - i * 0.15);
      const y0 = base.y - s * (0.3 + i * 0.3);
      ctx.beginPath();
      ctx.moveTo(base.x - wdt, y0);
      ctx.lineTo(base.x + wdt, y0);
      ctx.lineTo(base.x, y0 - s * 0.52);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawHouse(cam, house) {
    const base = project(cam, house.x, house.h, house.z);
    if (!base) return;
    const s = (house.w * cam.focal) / base.depth / 60;
    if (s < 1.5) return;
    ctx.fillStyle = house.hue > 0.5 ? '#e8e0cd' : '#d9c8ae';
    ctx.fillRect(base.x - s / 2, base.y - s * 0.62, s, s * 0.62);
    ctx.fillStyle = '#a34a38';
    ctx.beginPath();
    ctx.moveTo(base.x - s * 0.62, base.y - s * 0.62);
    ctx.lineTo(base.x + s * 0.62, base.y - s * 0.62);
    ctx.lineTo(base.x, base.y - s * 1.02);
    ctx.closePath();
    ctx.fill();
  }

  // ---- rings ----------------------------------------------------------------------
  function drawRings(cam, world, plane) {
    const sorted = [...world.rings].sort((a, b) => b.z - a.z);
    for (const ring of sorted) {
      const dz = ring.z - plane.z;
      if (dz < -30 || dz > 1500) continue;
      const pts = [];
      let ok = true;
      for (let i = 0; i < 36; i += 1) {
        const a = (i / 36) * Math.PI * 2;
        const p = project(cam, ring.x + Math.cos(a) * ring.r, ring.alt + Math.sin(a) * ring.r, ring.z);
        if (!p) { ok = false; break; }
        pts.push(p);
      }
      if (!ok || pts.length < 4) continue;
      let colour = 'rgba(140,220,255,0.95)';
      let width = 3;
      if (ring.status === RING_PASSED) { colour = 'rgba(80,255,150,0.9)'; width = 4; }
      else if (ring.status === RING_MISSED) { colour = 'rgba(255,90,80,0.45)'; width = 2.5; }
      else if (ring.status === RING_NEXT) {
        const pulse = 0.72 + 0.28 * Math.sin(plane.propSpin * 0.35);
        colour = `rgba(255,196,64,${pulse})`;
        width = 5;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.stroke();
      // A soft inner glow for the gate you are aiming at.
      if (ring.status === RING_NEXT) {
        ctx.strokeStyle = 'rgba(255,196,64,0.22)';
        ctx.lineWidth = width * 2.6;
        ctx.stroke();
      }
      // Ring number at the top of the gate.
      const top = project(cam, ring.x, ring.alt + ring.r + 4, ring.z);
      if (top && ring.status !== RING_PASSED && ring.status !== RING_MISSED) {
        ctx.font = `700 ${clamp(15000 / (dz + 60), 10, 22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(String(ring.index + 1), top.x, top.y);
      }
    }
  }

  // ---- the aeroplane (chase view, from behind and above) ------------------------------
  function drawPlane(world) {
    const plane = world.state.plane;
    const cx = W / 2 + clamp(-plane.bank * 0.7, -30, 30);
    const cy = H * 0.6 + clamp(plane.pitch * 1.1, -18, 22);
    const scale = H / 560;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(plane.bank * DEG * 0.82);
    ctx.scale(scale, scale);
    // Shadow-soft fuselage: a tapered body running away from the viewer.
    ctx.fillStyle = '#d8543c';
    ctx.beginPath();
    ctx.moveTo(-13, 26);
    ctx.quadraticCurveTo(-11, -34, -4.5, -58);
    ctx.lineTo(4.5, -58);
    ctx.quadraticCurveTo(11, -34, 13, 26);
    ctx.quadraticCurveTo(0, 36, -13, 26);
    ctx.closePath();
    ctx.fill();
    // Main wing, swept slightly, with lit tips.
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(-108, 6);
    ctx.lineTo(-16, -12);
    ctx.lineTo(16, -12);
    ctx.lineTo(108, 6);
    ctx.lineTo(102, 17);
    ctx.lineTo(-102, 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c33';
    ctx.fillRect(-108, 6, 9, 11);
    ctx.fillStyle = '#2c4';
    ctx.fillRect(99, 6, 9, 11);
    // Tailplane and fin.
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(-40, 30);
    ctx.lineTo(0, 20);
    ctx.lineTo(40, 30);
    ctx.lineTo(36, 38);
    ctx.lineTo(-36, 38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d8543c';
    ctx.beginPath();
    ctx.moveTo(-3.4, 34);
    ctx.lineTo(0, 2);
    ctx.lineTo(3.4, 34);
    ctx.closePath();
    ctx.fill();
    // Canopy glass.
    ctx.fillStyle = '#bfe3f7';
    ctx.beginPath();
    ctx.ellipse(0, -16, 6.4, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-1.8, -22, 2.2, 8, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // Propeller blur at the nose (far end) and its hub.
    ctx.fillStyle = 'rgba(40,40,46,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, -59, 15, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath();
    ctx.arc(0, -59, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Navigation strobe.
    if (Math.sin(plane.propSpin * 0.9) > 0.86) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(0, 40, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- instrument panel ----------------------------------------------------------------
  function gauge(cx, cy, r, label, needleAngle, ticks, valueText, colour = '#ffc95e') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#141a21';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3d4a57';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,240,250,0.75)';
    ctx.lineWidth = 1.4;
    for (const t of ticks) {
      const a = t.angle;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
      ctx.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needleAngle) * (r - 9), cy + Math.sin(needleAngle) * (r - 9));
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#e8eef4';
    ctx.fill();
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,215,230,0.8)';
    ctx.fillText(label, cx, cy + r - 7);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = '#eaf4ff';
    ctx.fillText(valueText, cx, cy + 15);
  }

  function drawPanel(world) {
    const plane = world.state.plane;
    const panelH = Math.round(H * 0.155);
    const y0 = H - panelH;
    const grad = ctx.createLinearGradient(0, y0, 0, H);
    grad.addColorStop(0, '#232c36');
    grad.addColorStop(1, '#10151b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, W, panelH);
    ctx.fillStyle = '#39434e';
    ctx.fillRect(0, y0, W, 2);

    const cy = y0 + panelH / 2 + 3;
    const r = Math.min(panelH * 0.4, 44);
    const knots = plane.speed * 1.944;
    const feet = plane.alt * 3.281;
    const spread = Math.PI * 1.35;
    const base = Math.PI * 0.825;
    const speedTicks = [];
    for (let i = 0; i <= 8; i += 1) speedTicks.push({ angle: base + (i / 8) * spread });
    gauge(W * 0.13, cy, r, 'AIRSPEED KT', base + clamp(knots / 210, 0, 1) * spread, speedTicks, String(Math.round(knots)));
    const altTicks = [];
    for (let i = 0; i <= 9; i += 1) altTicks.push({ angle: -Math.PI / 2 + (i / 10) * Math.PI * 2 });
    gauge(W * 0.3, cy, r, 'ALTIMETER FT', -Math.PI / 2 + ((feet % 1000) / 1000) * Math.PI * 2, altTicks, String(Math.round(feet)));

    // Artificial horizon: sky and ground split, rolled with the wings, pitched with the nose.
    const hx = W * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(hx, cy);
    ctx.rotate(-plane.bank * DEG);
    const pitchPx = clamp(plane.pitch * 1.1, -r, r);
    ctx.fillStyle = '#3f7fbf';
    ctx.fillRect(-r - 4, -r - 4 + pitchPx, (r + 4) * 2, r + 4);
    ctx.fillStyle = '#7a5a36';
    ctx.fillRect(-r - 4, pitchPx, (r + 4) * 2, r + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    for (const off of [-14, 14]) {
      ctx.beginPath();
      ctx.moveTo(-11, pitchPx + off);
      ctx.lineTo(11, pitchPx + off);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(hx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3d4a57';
    ctx.stroke();
    ctx.strokeStyle = '#ffc95e';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.55, cy);
    ctx.lineTo(hx - r * 0.18, cy);
    ctx.lineTo(hx, cy + 4);
    ctx.lineTo(hx + r * 0.18, cy);
    ctx.lineTo(hx + r * 0.55, cy);
    ctx.stroke();
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,215,230,0.8)';
    ctx.fillText('ATTITUDE', hx, cy + r - 7);

    // Heading compass: a strip of cardinal ticks sliding with the nose.
    const compW = W * 0.17;
    const compX = W * 0.68;
    ctx.fillStyle = '#141a21';
    ctx.fillRect(compX - compW / 2, cy - 20, compW, 40);
    ctx.strokeStyle = '#3d4a57';
    ctx.strokeRect(compX - compW / 2, cy - 20, compW, 40);
    ctx.save();
    ctx.beginPath();
    ctx.rect(compX - compW / 2, cy - 20, compW, 40);
    ctx.clip();
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = -60; d <= 60; d += 5) {
      const deg = ((Math.round((plane.heading + d) / 5) * 5) % 360 + 360) % 360;
      const off = (deg - plane.heading + 540) % 360 - 180;
      if (Math.abs(off) > 58) continue;
      const x = compX + (off / 60) * (compW / 2);
      ctx.fillStyle = 'rgba(230,240,250,0.75)';
      ctx.fillRect(x, cy - 20, 1.4, deg % 30 === 0 ? 10 : 6);
      if (names[deg]) {
        ctx.fillStyle = '#ffc95e';
        ctx.fillText(names[deg], x, cy + 4);
      } else if (deg % 30 === 0) {
        ctx.fillStyle = 'rgba(230,240,250,0.85)';
        ctx.fillText(String(deg / 10).padStart(2, '0'), x, cy + 4);
      }
    }
    ctx.restore();
    ctx.fillStyle = '#ff5f4a';
    ctx.beginPath();
    ctx.moveTo(compX - 5, cy - 24);
    ctx.lineTo(compX + 5, cy - 24);
    ctx.lineTo(compX, cy - 17);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,215,230,0.8)';
    ctx.fillText('HEADING', compX, cy + 33);

    // Fuel and throttle bars at the right edge of the panel.
    const bx = W * 0.845;
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(200,215,230,0.8)';
    ctx.fillText('FUEL', bx, cy - 22);
    ctx.fillText('THR', bx, cy + 8);
    const barW = W * 0.078;
    ctx.fillStyle = '#141a21';
    ctx.fillRect(bx + 30, cy - 30, barW, 10);
    ctx.fillRect(bx + 30, cy, barW, 10);
    ctx.fillStyle = world.state.fuelOut ? '#ff5f4a' : plane.fuel < 25 ? '#ffb84d' : '#57d977';
    ctx.fillRect(bx + 30, cy - 30, (barW * plane.fuel) / 100, 10);
    ctx.fillStyle = '#ffc95e';
    ctx.fillRect(bx + 30, cy, barW * plane.throttle, 10);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = '#eaf4ff';
    ctx.fillText(`${Math.round(plane.fuel)}%`, bx + 34 + barW, cy - 21);
    ctx.fillText(`${Math.round(plane.throttle * 100)}%`, bx + 34 + barW, cy + 9);
  }

  // ---- HUD, messages, screens ---------------------------------------------------------
  function drawHud(world) {
    const state = world.state;
    const plane = state.plane;
    ctx.textAlign = 'left';
    ctx.font = '700 21px ui-monospace, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 5;
    ctx.fillText(`SCORE ${state.score}`, 20, 36);
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(`RINGS ${state.ringsPassed}/${COURSE.ringCount}   COMBO ×${state.combo.toFixed(2).replace(/\.?0+$/, '')}`, 20, 60);
    const t = Math.max(0, Math.ceil(state.timeLeft));
    ctx.textAlign = 'right';
    ctx.font = '700 21px ui-monospace, monospace';
    ctx.fillStyle = state.timeLeft < 20 ? '#ff7a5e' : '#ffffff';
    ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, W - 20, 36);
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(`ALT ${Math.round(plane.alt * 3.281)} FT · SPD ${Math.round(plane.speed * 1.944)} KT · HDG ${String(((Math.round(plane.heading) % 360) + 360) % 360).padStart(3, '0')}°`, W - 20, 60);
    ctx.shadowBlur = 0;

    // A guide arrow and distance for the next gate (or the strip, once the rings are done).
    const next = world.nextRing();
    let target = null;
    let label = '';
    if (next) {
      target = next;
      label = `RING ${next.index + 1}`;
    } else if (state.phase !== PHASE_OVER) {
      target = { x: 0, alt: WORLD.runwayAlt + 9, z: WORLD.runwayZ0 };
      label = 'RUNWAY';
    }
    if (target) {
      const dz = target.z - plane.z;
      const dx = target.x - plane.x;
      const dist = Math.max(0, Math.round(Math.hypot(dx, dz)));
      const bearing = Math.atan2(dx, dz) / DEG;
      const rel = ((bearing - plane.heading + 540) % 360) - 180;
      ctx.save();
      ctx.translate(W / 2, 44);
      ctx.rotate(clamp(rel, -70, 70) * DEG);
      ctx.fillStyle = next ? '#ffc95e' : '#57d977';
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(7, 7);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(`${label} · ${dist} M`, W / 2, 74);
    }

    // Centre-screen notes (ring results, warnings) while they last.
    if (state.message && state.time < state.message.until && state.phase !== PHASE_OVER) {
      const m = state.message;
      const left = m.until - state.time;
      ctx.globalAlpha = clamp(left / 0.3, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText(m.text, W / 2, H * 0.3);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.fillText(m.sub, W / 2, H * 0.3 + 26);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function dim(alpha) {
    ctx.fillStyle = `rgba(8,14,22,${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle(world) {
    dim(0.34);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd873';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillText('★  M A K E . F U N   F L I G H T   T R I A L  ★', W / 2, H * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 74px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.fillText('SKY CIRCUIT', W / 2, H * 0.3);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#bfe0f7';
    ctx.font = '600 21px system-ui, sans-serif';
    ctx.fillText('River Valley Run — thread 14 rings, then put her on the strip', W / 2, H * 0.3 + 38);
    const lines = [
      'W A S D / arrow keys — fly the plane        mouse — steer toward the pointer',
      'SHIFT — boost        SPACE — air brake        Q / E — throttle trim',
      'Gold ring is next · centre hits pay more · combos build to ×2.5',
      'Watch your fuel: boost drinks it, gliding sips it',
    ];
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.52 + i * 24));
    ctx.fillStyle = '#ffd873';
    ctx.font = '800 22px system-ui, sans-serif';
    const pulse = 0.7 + 0.3 * Math.sin(world.state.plane.propSpin * 0.4);
    ctx.globalAlpha = pulse;
    ctx.fillText('CLICK OR PRESS ENTER TO FLY', W / 2, H * 0.52 + lines.length * 24 + 26);
    ctx.globalAlpha = 1;
  }

  function drawOver(world) {
    const state = world.state;
    dim(0.45);
    const landed = state.endReason === END_LANDED;
    const crashed = state.endReason === END_CRASHED;
    ctx.textAlign = 'center';
    ctx.fillStyle = landed ? '#7dff9a' : crashed ? '#ff8a76' : '#ffd873';
    ctx.font = '900 52px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 12;
    ctx.fillText(landed ? 'TOUCHDOWN!' : crashed ? 'CRASHED' : 'RUN OVER', W / 2, H * 0.24);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 17px system-ui, sans-serif';
    const verdict = {
      landed: 'On the strip, in one piece. The valley applauds.',
      crashed: 'The valley floor came up to meet you.',
      overshot: 'You sailed past the strip and ran out of valley.',
      timeout: 'The clock ran out over the valley.',
      'fuel-starved': 'Out of fuel, out of time — a long walk home.',
    }[state.endReason] ?? '';
    ctx.fillText(verdict, W / 2, H * 0.24 + 34);
    // The score card.
    const cardW = 400;
    const cardX = W / 2 - cardW / 2;
    const cardY = H * 0.36;
    ctx.fillStyle = 'rgba(13,20,28,0.82)';
    ctx.fillRect(cardX, cardY, cardW, 196);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(cardX, cardY, cardW, 196);
    const rows = [
      [`Rings threaded`, `${state.ringsPassed} / ${COURSE.ringCount}`],
      [`Ring points`, `${state.ringScore}`],
      [`Best combo`, `×${state.bestCombo.toFixed(2).replace(/\.?0+$/, '')}`],
      [`Landing bonus`, `${state.landingScore}`],
      [`Time bonus`, `${state.timeScore}`],
    ];
    ctx.font = '600 16px system-ui, sans-serif';
    rows.forEach(([k, v], i) => {
      const y = cardY + 34 + i * 26;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(k, cardX + 24, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(v, cardX + cardW - 24, y);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd873';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText(`SCORE ${state.score}   ·   GRADE ${gradeFor(state.score)}`, W / 2, cardY + 196 + 48);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText('Press R or click to fly again', W / 2, cardY + 196 + 80);
  }

  /** Draw one frame. screen is SCREEN_TITLE, SCREEN_PLAY or SCREEN_OVER. */
  function draw(world, screen) {
    const plane = world.state.plane;
    const cam = makeCamera(plane);
    drawSky(cam, plane);
    drawTerrain(cam, world);
    drawRunway(cam);
    drawScenery(cam, world, plane);
    drawRings(cam, world, plane);
    if (screen !== SCREEN_OVER || world.state.endReason === END_LANDED) drawPlane(world);
    drawHud(world);
    drawPanel(world);
    if (screen === SCREEN_TITLE) drawTitle(world);
    if (screen === SCREEN_OVER) drawOver(world);
  }

  return { draw, resize };
}
