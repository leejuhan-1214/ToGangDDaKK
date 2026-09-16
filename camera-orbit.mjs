const SEGMENT_DEGREES = 120;
const SEGMENT_DURATION_MS = 30000;
const OWNER_KEY = 'land15CameraOrbit';
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', '+', '-', '=', '_']);
const normalizeBearing = value => ((value + 180) % 360 + 360) % 360 - 180;

/** User-controlled rotation of the current view; neither terrain nor observations change. */
export function createCameraOrbit({map, button, onStateChange = () => {}, reducedMotion} = {}) {
  if (!map || typeof map.easeTo !== 'function' || typeof map.getBearing !== 'function') {
    throw new TypeError('Camera orbit requires a map with camera controls.');
  }
  const container = map.getContainer();
  const document = container?.ownerDocument ?? globalThis.document;
  const view = document?.defaultView ?? globalThis;
  const motionPreference = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = reducedMotion ?? (() => motionPreference?.matches === true);
  const owner = {};
  let running = false;
  let disposed = false;
  let generation = 0;
  let targetBearing = null;

  function publish(reason) {
    button?.setAttribute('aria-pressed', String(running));
    button?.setAttribute('data-running', String(running));
    onStateChange({running, reason});
  }

  function stop(reason = 'stopped', stopCamera = true) {
    if (!running) return false;
    running = false;
    generation += 1;
    targetBearing = null;
    // Clear ownership before stop(): MapLibre dispatches moveend synchronously.
    if (stopCamera) map.stop();
    publish(reason);
    return false;
  }

  function unavailableReason() {
    if (disposed) return 'disposed';
    if (document?.hidden || document?.visibilityState === 'hidden') return 'document-hidden';
    if (prefersReducedMotion()) return 'reduced-motion';
    return null;
  }

  function advance() {
    if (!running || disposed) return;
    const unavailable = unavailableReason();
    if (unavailable) {
      stop(unavailable);
      return;
    }
    const bearing = map.getBearing();
    if (!Number.isFinite(bearing)) {
      stop('camera-unavailable');
      return;
    }
    targetBearing = normalizeBearing(bearing + SEGMENT_DEGREES);
    try {
      // Omitted center, zoom and pitch preserve the user's current framing.
      // A segment below 180 degrees keeps MapLibre on the clockwise short path.
      map.easeTo({bearing: targetBearing, duration: SEGMENT_DURATION_MS, easing: t => t, essential: false}, {[OWNER_KEY]: owner});
    } catch {
      stop('camera-unavailable');
    }
  }

  function start() {
    if (running) return true;
    const unavailable = unavailableReason();
    if (unavailable) {
      if (!disposed) publish(unavailable);
      return false;
    }
    map.stop();
    running = true;
    generation += 1;
    publish('started');
    advance();
    return running;
  }

  function onMoveStart(event) {
    // The incoming camera owner is already active; release our loop without
    // cancelling the user's new flyTo/easeTo operation.
    if (running && (event?.originalEvent || event?.[OWNER_KEY] !== owner)) stop('interrupted', false);
  }

  function onMoveEnd(event) {
    if (!running) return;
    const arrived = targetBearing !== null && Math.abs(normalizeBearing(map.getBearing() - targetBearing)) < 0.01;
    // stop() and a competing camera animation can emit our old event data.
    // Only an actually completed segment may schedule another rotation.
    if (event?.[OWNER_KEY] !== owner || !arrived) {
      stop('interrupted', false);
      return;
    }
    const completedGeneration = generation;
    queueMicrotask(() => {
      if (running && generation === completedGeneration) advance();
    });
  }

  const onManualInput = () => stop('manual-input');
  const onContainerKey = event => {
    if (NAVIGATION_KEYS.has(event.key)) stop('manual-input');
  };
  const onEscape = event => {
    if (event.key === 'Escape') stop('escape');
  };
  const onVisibilityChange = () => {
    if (document?.hidden || document?.visibilityState === 'hidden') stop('document-hidden');
  };
  const onMotionChange = () => {
    if (prefersReducedMotion()) stop('reduced-motion');
  };
  const onButtonClick = () => toggle();
  const onMapRemove = () => dispose(false);

  function toggle() {
    return running ? stop() : start();
  }

  function dispose(stopCamera = true) {
    if (disposed) return;
    disposed = true;
    stop('disposed', stopCamera);
    generation += 1;
    map.off('movestart', onMoveStart);
    map.off('moveend', onMoveEnd);
    map.off('remove', onMapRemove);
    for (const type of ['pointerdown', 'wheel', 'touchstart']) container?.removeEventListener(type, onManualInput, true);
    container?.removeEventListener('keydown', onContainerKey, true);
    document?.removeEventListener('keydown', onEscape, true);
    document?.removeEventListener('visibilitychange', onVisibilityChange);
    motionPreference?.removeEventListener?.('change', onMotionChange);
    button?.removeEventListener('click', onButtonClick);
  }

  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  map.on('remove', onMapRemove);
  for (const type of ['pointerdown', 'wheel', 'touchstart']) container?.addEventListener(type, onManualInput, {capture: true, passive: true});
  container?.addEventListener('keydown', onContainerKey, true);
  document?.addEventListener('keydown', onEscape, true);
  document?.addEventListener('visibilitychange', onVisibilityChange);
  motionPreference?.addEventListener?.('change', onMotionChange);
  button?.addEventListener('click', onButtonClick);
  button?.setAttribute('aria-pressed', 'false');
  button?.setAttribute('data-running', 'false');

  return {start, stop, toggle, isRunning: () => running, dispose};
}
