export const MERCATOR_LATITUDE = 85.0511287798066;

// Keep a crossing of the date line continuous. Repeated world copies count once.
export function viewportBounds(bounds) {
  const { west, east, south, north } = bounds;
  if (![west, east, south, north].every(Number.isFinite) || east <= west || north <= south) {
    throw new Error('유효한 지도 범위를 읽지 못했습니다.');
  }
  const width = Math.min(360, east - west);
  const start = width === 360 ? -180 : ((west + 180) % 360 + 360) % 360 - 180;
  const bottom = Math.max(-MERCATOR_LATITUDE, south);
  const top = Math.min(MERCATOR_LATITUDE, north);
  if (bottom >= top) throw new Error('표시 가능한 지도 범위를 벗어났습니다.');
  return { west: start, east: start + width, south: bottom, north: top };
}

export function sameBounds(a, b) {
  // Relative tolerance remains small even for a deeply zoomed viewport.
  const epsilon = Math.max(1e-9, Math.min(b.east - b.west, b.north - b.south) * 1e-6);
  return ['west', 'east', 'south', 'north'].every(key => Math.abs(a[key] - b[key]) <= epsilon);
}

// Coalesce movement while one analysis is running. Configuration changes invalidate
// old replies. A trailing run always samples the final viewport, without moving it.
export function createViewportScheduler({ readBounds, compute, apply, enabled, onError,
  interval = 180, settleDelay = 60, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null, busy = false, pending = false, epoch = 0, lastStart = -Infinity, disposed = false;
  function cancelTimer() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule(delay) {
    cancelTimer();
    if (!disposed && enabled()) timer = setTimer(run, Math.max(0, delay));
  }
  async function run() {
    timer = null;
    if (disposed || !enabled()) { pending = false; return; }
    if (busy) { pending = true; return; }
    busy = true; pending = false; lastStart = now();
    const generation = epoch;
    try {
      const result = await compute(readBounds());
      if (!disposed && generation === epoch && enabled() && result !== null) apply(result);
    } catch (error) {
      if (!disposed && generation === epoch && enabled()) onError(error);
    } finally {
      busy = false;
      if (pending && !disposed && enabled()) schedule(Math.max(0, interval - (now() - lastStart)));
    }
  }
  return {
    move() {
      if (disposed || !enabled()) return;
      pending = true;
      if (!busy && timer === null) schedule(interval - (now() - lastStart));
    },
    settle() {
      if (disposed || !enabled()) return;
      pending = true;
      if (!busy) schedule(settleDelay);
    },
    refresh() {
      if (disposed || !enabled()) return;
      pending = true;
      if (!busy) schedule(0);
    },
    invalidate() { epoch += 1; pending = false; cancelTimer(); },
    dispose() { disposed = true; epoch += 1; pending = false; cancelTimer(); },
  };
}
