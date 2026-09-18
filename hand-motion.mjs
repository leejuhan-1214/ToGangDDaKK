const MODES = new Map([
  ['Open_Palm', 'pan'], ['Victory', 'rotate'],
  ['Thumb_Up', 'zoom'], ['Thumb_Down', 'zoom'], ['Closed_Fist', 'pause'],
]);
const PALM_POINTS = [0, 5, 9, 13, 17];
const MAX_GAP_MS = 250;
const MAX_TRACKING_STEP = 0.18;
const SMOOTHING_MS = 55;
const DEAD_ZONE = 0.0035;
const MAX_OUTPUT_STEP = 0.04;
const ZOOM_PER_SECOND = 0.7;

const command = (mode, values = {}) => ({mode, active: false, dx: 0, dy: 0, dz: 0, ...values});

function readHand(result, minConfidence) {
  const hands = result?.landmarks;
  const gestures = result?.gestures;
  if (!Array.isArray(hands) || !Array.isArray(gestures)) return {reason: 'malformed-result'};
  if (hands.length === 0 && gestures.length === 0) return {reason: 'no-hand'};
  if (hands.length > 1 || gestures.length > 1) return {reason: 'multiple-hands'};
  if (hands.length !== 1 || gestures.length !== 1 || !Array.isArray(gestures[0])) return {reason: 'malformed-result'};
  const classification = gestures[0][0];
  if (!classification || typeof classification.categoryName !== 'string' ||
      !Number.isFinite(classification.score) || classification.score < 0 || classification.score > 1) {
    return {reason: 'malformed-result'};
  }
  if (classification.score < minConfidence) return {reason: 'low-confidence'};
  if (!MODES.has(classification.categoryName)) return {reason: 'unknown-gesture'};
  const landmarks = hands[0];
  if (!Array.isArray(landmarks) || landmarks.length !== 21 ||
      Array.from(landmarks).some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    return {reason: 'malformed-landmarks'};
  }
  const center = PALM_POINTS.reduce((sum, index) => ({x: sum.x + landmarks[index].x, y: sum.y + landmarks[index].y}), {x: 0, y: 0});
  return {gesture: classification.categoryName, center: {x: 1 - center.x / PALM_POINTS.length, y: center.y / PALM_POINTS.length}};
}

/**
 * Convert MediaPipe GestureRecognizer video results into relative camera commands.
 * This pure controller neither opens a camera nor loads or transmits images.
 *
 * update(result, nowMs) accepts one complete hand and a monotonic millisecond time.
 * Every return has {mode, active, dx, dy, dz}, optionally a diagnostic reason.
 * dx/dy are normalized screen displacements (x mirrored like the camera preview;
 * y positive downward), not pixels or degrees. The caller supplies map scaling.
 * dz is zoom levels: Thumb_Up +0.7/s, Thumb_Down -0.7/s, times sensitivity.
 * Modes are idle, arming, pause, pan, rotate and zoom. Apply only active commands.
 *
 * A new gesture settles for 220 ms by default, then rebases without moving.
 * A fist pauses immediately. Missing/ambiguous input stops immediately; returning
 * hands must settle again. Gaps over 250 ms and one-frame jumps over 18% of the
 * image also reacquire. Motion uses a 55 ms position filter and 0.35% dead zone;
 * each displacement is capped at 4% with no deferred movement from clipped input.
 * reset() discards all tracking and time state, for stopping/restarting a session.
 */
export function createHandMotion({minConfidence = 0.7, settleMs = 220, sensitivity = 1} = {}) {
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new RangeError('minConfidence must be between 0 and 1.');
  if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 2000) throw new RangeError('settleMs must be between 0 and 2000 milliseconds.');
  if (!Number.isFinite(sensitivity) || sensitivity < 0.1 || sensitivity > 4) throw new RangeError('sensitivity must be between 0.1 and 4.');
  let lastTime = null;
  let gesture = null;
  let startedAt = 0;
  let settled = false;
  let raw = null;
  let filtered = null;
  let anchor = null;

  function clearTracking() {
    gesture = null;
    startedAt = 0;
    settled = false;
    raw = filtered = anchor = null;
  }

  function rebase(center) {
    raw = {...center};
    filtered = {...center};
    anchor = {...center};
  }

  function acquire(hand, nowMs, reason = 'settling') {
    gesture = hand.gesture;
    startedAt = nowMs;
    settled = settleMs === 0;
    rebase(hand.center);
    return command(settled ? MODES.get(gesture) : 'arming', {reason: settled ? 'settled' : reason});
  }

  function update(result, nowMs) {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      clearTracking();
      return command('idle', {reason: 'invalid-time'});
    }
    const elapsed = lastTime === null ? null : nowMs - lastTime;
    if (elapsed !== null && elapsed <= 0) {
      clearTracking();
      return command('idle', {reason: 'non-monotonic-time'});
    }
    lastTime = nowMs;
    const hand = readHand(result, minConfidence);
    if (hand.reason) {
      clearTracking();
      return command('idle', {reason: hand.reason});
    }
    if (hand.gesture === 'Closed_Fist') {
      clearTracking();
      return command('pause', {reason: 'closed-fist'});
    }
    if (elapsed !== null && elapsed > MAX_GAP_MS) {
      clearTracking();
      return acquire(hand, nowMs, 'tracking-gap');
    }
    if (gesture !== hand.gesture || !raw) return acquire(hand, nowMs);
    if (Math.hypot(hand.center.x - raw.x, hand.center.y - raw.y) > MAX_TRACKING_STEP) {
      return acquire(hand, nowMs, 'tracking-jump');
    }
    raw = {...hand.center};
    const mode = MODES.get(gesture);
    if (!settled) {
      rebase(hand.center);
      if (nowMs - startedAt < settleMs) return command('arming', {reason: 'settling'});
      settled = true;
      return command(mode, {reason: 'settled'});
    }
    if (mode === 'zoom') {
      return command(mode, {active: true, dz: (gesture === 'Thumb_Up' ? 1 : -1) * ZOOM_PER_SECOND * sensitivity * elapsed / 1000});
    }
    const alpha = 1 - Math.exp(-elapsed / SMOOTHING_MS);
    filtered = {
      x: filtered.x + alpha * (hand.center.x - filtered.x),
      y: filtered.y + alpha * (hand.center.y - filtered.y),
    };
    const delta = {x: filtered.x - anchor.x, y: filtered.y - anchor.y};
    const distance = Math.hypot(delta.x, delta.y);
    if (distance <= DEAD_ZONE) return command(mode, {reason: 'steady'});
    const movement = distance - DEAD_ZONE;
    if (movement <= 0.000001) return command(mode, {reason: 'steady'});
    // Consume the complete filtered displacement even if the output is capped.
    anchor = {x: anchor.x + delta.x * movement / distance, y: anchor.y + delta.y * movement / distance};
    const scale = Math.min(movement * sensitivity, MAX_OUTPUT_STEP) / distance;
    return command(mode, {active: true, dx: delta.x * scale, dy: delta.y * scale});
  }

  function reset() {
    clearTracking();
    lastTime = null;
  }

  return {update, reset};
}
