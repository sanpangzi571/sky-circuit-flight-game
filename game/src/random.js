// A tiny seeded random number generator (mulberry32). The whole valley — its hills, its
// trees, its village — is grown from one seed, so a given seed always builds the same
// world and a staged screenshot always shows the same frame.

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic 1-D value-noise: smooth wiggles from a seed, for ridgelines and hills. */
export function makeNoise1d(seed, cells = 256) {
  const rng = makeRng(seed);
  const values = new Float32Array(cells);
  for (let i = 0; i < cells; i += 1) values[i] = rng() * 2 - 1;
  return function noise(x) {
    const xi = Math.floor(x);
    const frac = x - xi;
    const a = values[((xi % cells) + cells) % cells];
    const b = values[(((xi + 1) % cells) + cells) % cells];
    const smooth = frac * frac * (3 - 2 * frac);
    return a + (b - a) * smooth;
  };
}
