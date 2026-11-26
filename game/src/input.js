// Sky Circuit input: keyboard and mouse feed one controls object, the same shape the
// autopilot writes for screenshots. Keys: W/S or ↑/↓ pitch, A/D or ←/→ bank,
// Shift boosts, Space brakes, Q/E trim the throttle. The mouse steers toward the
// pointer while it moves over the canvas; a held button boosts.

export function createInput(canvas) {
  const keys = new Set();
  const controls = {
    pitch: 0,
    roll: 0,
    throttle: 0.62,
    boost: false,
    brake: false,
    startPressed: false, // edge-triggered by the bootstrap: Enter or a click
  };
  let mouse = null; // { x, y } in canvas pixels while the pointer is over the game
  let mouseDown = false;

  function onKey(down) {
    return (event) => {
      const code = event.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) event.preventDefault();
      if (down) {
        keys.add(code);
        if (code === 'Enter') controls.startPressed = true;
        if (code === 'KeyQ') controls.throttle = Math.max(0, controls.throttle - 0.08);
        if (code === 'KeyE') controls.throttle = Math.min(1, controls.throttle + 0.08);
      } else {
        keys.delete(code);
      }
    };
  }
  const keyDown = onKey(true);
  const keyUp = onKey(false);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height };
  });
  canvas.addEventListener('pointerdown', (event) => {
    mouseDown = true;
    controls.startPressed = true;
    canvas.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointerup', () => { mouseDown = false; });
  canvas.addEventListener('pointerleave', () => { mouse = null; });

  /** Read the pilot's current ask. Called once per frame by the game loop. */
  function poll() {
    let pitch = 0;
    let roll = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) pitch += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) pitch -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) roll -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) roll += 1;
    if (mouse && roll === 0 && pitch === 0) {
      // Steer toward the pointer: right of centre banks right, above centre climbs.
      const nx = (mouse.x / mouse.w) * 2 - 1;
      const ny = (mouse.y / mouse.h) * 2 - 1;
      if (Math.abs(nx) > 0.06) roll = nx * 1.15;
      if (Math.abs(ny) > 0.08) pitch = -ny * 0.9;
    }
    controls.pitch = Math.max(-1, Math.min(1, pitch));
    controls.roll = Math.max(-1, Math.min(1, roll));
    controls.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') || mouseDown;
    controls.brake = keys.has('Space');
    if (keys.has('KeyW') || keys.has('ArrowUp')) controls.throttle = Math.min(1, controls.throttle + 0.0035);
    return controls;
  }

  return { controls, poll };
}
