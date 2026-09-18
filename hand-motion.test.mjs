import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandMotion} from './hand-motion.mjs';

// A complete normalized hand with the wrist, knuckles and finger joints at
// separate locations; moving the fixture translates all 21 model landmarks.
const SHAPE = [
  [0, 0.07], [-0.035, 0.04], [-0.06, 0.01], [-0.08, -0.015], [-0.095, -0.04],
  [-0.035, 0], [-0.04, -0.045], [-0.04, -0.075], [-0.04, -0.1],
  [0, -0.005], [0, -0.055], [0, -0.09], [0, -0.12],
  [0.03, 0], [0.035, -0.04], [0.04, -0.07], [0.04, -0.095],
  [0.055, 0.015], [0.065, -0.015], [0.07, -0.04], [0.075, -0.065],
];
function hand(gesture = 'Open_Palm', x = 0.5, y = 0.5, score = 0.95) {
  return {
    gestures: [[{categoryName: gesture, score, index: 0, displayName: ''}]],
    landmarks: [SHAPE.map(([dx, dy], index) => ({x: x + dx, y: y + dy, z: -index * 0.001}))],
  };
}
function neutral(command, mode) {
  assert.equal(command.mode, mode);
  assert.equal(command.active, false);
  assert.equal(command.dx, 0);
  assert.equal(command.dy, 0);
  assert.equal(command.dz, 0);
}
function arm(engine, gesture = 'Open_Palm', start = 0, x = 0.5, y = 0.5) {
  neutral(engine.update(hand(gesture, x, y), start), 'arming');
  neutral(engine.update(hand(gesture, x, y), start + 100), 'arming');
  neutral(engine.update(hand(gesture, x, y), start + 219), 'arming');
  const ready = engine.update(hand(gesture, x, y), start + 220);
  neutral(ready, gesture === 'Open_Palm' ? 'pan' : gesture === 'Victory' ? 'rotate' : 'zoom');
  return start + 220;
}

test('a palm must settle, rebases movement while settling, and mirrors horizontal motion', () => {
  const engine = createHandMotion();
  neutral(engine.update(hand('Open_Palm', 0.4), 0), 'arming');
  neutral(engine.update(hand('Open_Palm', 0.45), 100), 'arming');
  neutral(engine.update(hand('Open_Palm', 0.55), 220), 'pan');
  neutral(engine.update(hand('Open_Palm', 0.55), 250), 'pan');
  const movement = engine.update(hand('Open_Palm', 0.6, 0.53), 300);
  assert.equal(movement.mode, 'pan');
  assert.equal(movement.active, true);
  assert.ok(movement.dx < 0, 'camera-right becomes mirrored screen-left');
  assert.ok(movement.dy > 0, 'camera-down stays screen-down');
  assert.equal(movement.dz, 0);
});

test('a different gesture requires a fresh neutral anchor before rotating', () => {
  const engine = createHandMotion();
  arm(engine);
  assert.equal(engine.update(hand('Open_Palm', 0.54), 260).active, true);
  neutral(engine.update(hand('Victory', 0.6), 300), 'arming');
  neutral(engine.update(hand('Victory', 0.66), 450), 'arming');
  neutral(engine.update(hand('Victory', 0.68), 520), 'rotate');
  neutral(engine.update(hand('Victory', 0.68), 560), 'rotate');
  const movement = engine.update(hand('Victory', 0.63), 610);
  assert.equal(movement.mode, 'rotate');
  assert.ok(movement.active && movement.dx > 0);
});

test('a closed fist pauses immediately and reopening requires settlement', () => {
  const engine = createHandMotion();
  arm(engine, 'Thumb_Up');
  assert.ok(engine.update(hand('Thumb_Up'), 250).dz > 0);
  neutral(engine.update(hand('Closed_Fist'), 260), 'pause');
  neutral(engine.update(hand('Closed_Fist'), 300), 'pause');
  neutral(engine.update(hand('Thumb_Up'), 330), 'arming');
});

test('loss of a hand stops zoom immediately and reacquisition has no stored motion', () => {
  const engine = createHandMotion();
  arm(engine, 'Thumb_Down');
  assert.ok(engine.update(hand('Thumb_Down'), 250).dz < 0);
  const lost = engine.update({gestures: [], landmarks: []}, 275);
  neutral(lost, 'idle');
  assert.equal(lost.reason, 'no-hand');
  arm(engine, 'Thumb_Down', 300, 0.7, 0.6);
  assert.ok(Math.abs(engine.update(hand('Thumb_Down', 0.7, 0.6), 620).dz + 0.07) < 1e-12);
});

test('exactly one complete hand is accepted, including for a pause gesture', () => {
  const engine = createHandMotion({settleMs: 0});
  for (const gesture of ['Open_Palm', 'Thumb_Up', 'Closed_Fist']) {
    engine.reset();
    const result = hand(gesture);
    result.gestures.push(hand('Closed_Fist').gestures[0]);
    result.landmarks.push(hand('Closed_Fist').landmarks[0]);
    const two = engine.update(result, 0);
    neutral(two, 'idle');
    assert.equal(two.reason, 'multiple-hands');
    neutral(engine.update(hand(gesture), 30), gesture === 'Closed_Fist' ? 'pause' : gesture === 'Thumb_Up' ? 'zoom' : 'pan');
  }
});

test('unrecognized or low confidence observations reset an already active gesture', () => {
  for (const result of [hand('Open_Palm', 0.5, 0.5, 0.69), hand('None'), hand('Pointing_Up')]) {
    const engine = createHandMotion();
    arm(engine);
    assert.equal(engine.update(hand('Open_Palm', 0.55), 260).active, true);
    neutral(engine.update(result, 300), 'idle');
    neutral(engine.update(hand('Open_Palm', 0.7), 330), 'arming');
  }
  const threshold = createHandMotion({settleMs: 0, minConfidence: 0.7});
  neutral(threshold.update(hand('Victory', 0.5, 0.5, 0.7), 0), 'rotate');
});

test('malformed model results cannot produce a camera command', () => {
  const malformed = [null, {}, {gestures: [], landmarks: [[]]}, hand(), hand(), hand(), hand(), hand(), hand(), hand(), hand()];
  malformed[3].gestures[0][0].score = NaN;
  malformed[4].landmarks[0][5].x = Infinity;
  malformed[5].landmarks[0][9].y = 1.1;
  malformed[6].landmarks[0][20].z = NaN;
  malformed[7].landmarks[0].pop();
  malformed[8].gestures[0] = [];
  malformed[9].landmarks[0][0] = null;
  delete malformed[10].landmarks[0][5];
  for (const result of malformed) {
    const engine = createHandMotion({settleMs: 0});
    engine.update(hand(), 0);
    neutral(engine.update(result, 50), 'idle');
    neutral(engine.update(hand(), 60), 'pan');
  }
});

test('repeated small stationary jitter never accumulates into panning', () => {
  const engine = createHandMotion();
  arm(engine);
  for (let index = 1; index <= 300; index += 1) {
    const x = 0.5 + Math.sin(index * 1.7) * 0.0015;
    const y = 0.5 + Math.cos(index * 1.3) * 0.0015;
    neutral(engine.update(hand('Open_Palm', x, y), 220 + index * 33), 'pan');
  }
});

test('zoom speed is elapsed-time based at different inference frame rates', () => {
  function zoom(step, gesture, sensitivity = 1) {
    const engine = createHandMotion({sensitivity});
    arm(engine, gesture);
    let total = 0;
    for (let time = 220 + step; time <= 1220; time += step) total += engine.update(hand(gesture), time).dz;
    return total;
  }
  for (const step of [20, 40, 100, 250]) {
    assert.ok(Math.abs(zoom(step, 'Thumb_Up') - 0.7) < 1e-12);
    assert.ok(Math.abs(zoom(step, 'Thumb_Down') + 0.7) < 1e-12);
  }
  assert.ok(Math.abs(zoom(100, 'Thumb_Up', 2) - 1.4) < 1e-12);
});

test('a stalled inference stream requires reacquisition instead of a large zoom or pan', () => {
  for (const gesture of ['Open_Palm', 'Thumb_Up']) {
    const engine = createHandMotion();
    arm(engine, gesture);
    const gap = engine.update(hand(gesture, 0.65), 600);
    neutral(gap, 'arming');
    assert.equal(gap.reason, 'tracking-gap');
    neutral(engine.update(hand(gesture, 0.65), 800), 'arming');
    neutral(engine.update(hand(gesture, 0.65), 820), gesture === 'Open_Palm' ? 'pan' : 'zoom');
  }
});

test('a discontinuous hand position is suppressed and must settle at its new location', () => {
  const engine = createHandMotion();
  arm(engine);
  const jumped = engine.update(hand('Open_Palm', 0.8), 250);
  neutral(jumped, 'arming');
  assert.equal(jumped.reason, 'tracking-jump');
  neutral(engine.update(hand('Open_Palm', 0.8), 470), 'pan');
  neutral(engine.update(hand('Open_Palm', 0.8), 500), 'pan');
});

test('camera displacement is smoothed and capped in vector length at high sensitivity', () => {
  const engine = createHandMotion({sensitivity: 4});
  arm(engine);
  const move = engine.update(hand('Open_Palm', 0.62, 0.6), 320);
  assert.ok(move.active);
  assert.ok(Math.hypot(move.dx, move.dy) <= 0.040000000001);
  assert.ok(Math.abs(Math.hypot(move.dx, move.dy) - 0.04) < 1e-12);
  // The cap discards excess travel. Holding still may finish the position filter,
  // but cannot replay the clipped movement indefinitely.
  let tail = 0;
  for (let index = 1; index <= 30; index += 1) {
    const command = engine.update(hand('Open_Palm', 0.62, 0.6), 320 + index * 50);
    tail += Math.hypot(command.dx, command.dy);
    if (index > 20) neutral(command, 'pan');
  }
  assert.ok(tail < 0.12);
});

test('repeated, backward, negative and nonfinite timestamps cannot move the view', () => {
  const engine = createHandMotion({settleMs: 0});
  engine.update(hand('Thumb_Up'), 100);
  for (const time of [100, 90, -1, NaN, Infinity]) neutral(engine.update(hand('Thumb_Up'), time), 'idle');
  neutral(engine.update(hand('Thumb_Up'), 110), 'zoom');
  assert.ok(Math.abs(engine.update(hand('Thumb_Up'), 210).dz - 0.07) < 1e-12);
});

test('reset allows a new session clock and drops all pending movement', () => {
  const engine = createHandMotion();
  arm(engine, 'Victory', 1000);
  assert.ok(engine.update(hand('Victory', 0.55), 1270).active);
  engine.reset();
  arm(engine, 'Open_Palm', 0, 0.75);
  neutral(engine.update(hand('Open_Palm', 0.75), 240), 'pan');
});

test('invalid controller configuration is rejected before camera use', () => {
  for (const options of [{minConfidence: NaN}, {minConfidence: 1.1}, {settleMs: -1}, {settleMs: Infinity}, {sensitivity: 0}, {sensitivity: 5}]) {
    assert.throws(() => createHandMotion(options), RangeError);
  }
});
