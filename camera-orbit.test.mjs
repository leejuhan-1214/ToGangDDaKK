import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCameraOrbit} from './camera-orbit.mjs';

class Surface extends EventTarget {
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  fire(type, properties = {}) {
    const event = new Event(type);
    Object.assign(event, properties);
    this.dispatchEvent(event);
  }
}

class FakeMap {
  listeners = new Map();
  animations = [];
  active = null;
  bearing = 0;
  stops = 0;
  constructor() {
    this.document = new Surface();
    this.document.hidden = false;
    this.document.visibilityState = 'visible';
    this.motion = new Surface();
    this.motion.matches = false;
    this.document.defaultView = {matchMedia: () => this.motion};
    this.container = new Surface();
    this.container.ownerDocument = this.document;
  }
  getContainer() { return this.container; }
  getBearing() { return this.bearing; }
  on(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  off(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, event = {}) { for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event); }
  easeTo(options, eventData) {
    this.stop();
    this.active = {options, eventData};
    this.animations.push(this.active);
    this.emit('movestart', eventData);
  }
  stop() {
    this.stops += 1;
    if (!this.active) return;
    const prior = this.active;
    this.active = null;
    this.emit('moveend', prior.eventData);
  }
  finish() {
    assert.ok(this.active, 'an animation must exist');
    const prior = this.active;
    this.bearing = prior.options.bearing;
    this.active = null;
    this.emit('moveend', prior.eventData);
  }
}

function setup(options = {}) {
  const map = new FakeMap();
  const button = new Surface();
  const states = [];
  const orbit = createCameraOrbit({map, button, onStateChange: state => states.push(state), ...options});
  return {map, button, states, orbit};
}
const settle = () => new Promise(resolve => queueMicrotask(resolve));

test('orbit is opt-in and preserves center, zoom, pitch and terrain settings', () => {
  const {map, button, states, orbit} = setup();
  assert.equal(map.animations.length, 0);
  assert.equal(orbit.isRunning(), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  map.bearing = 150;
  assert.equal(orbit.start(), true);
  assert.equal(map.active.options.bearing, -90);
  assert.equal(map.active.options.duration, 30000);
  assert.equal(map.active.options.easing(0.3), 0.3);
  assert.equal(map.active.options.essential, false);
  assert.deepEqual(Object.keys(map.active.options).sort(), ['bearing', 'duration', 'easing', 'essential']);
  assert.deepEqual(states, [{running: true, reason: 'started'}]);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  orbit.dispose();
});

test('completed segments continue smoothly through wrapped headings', async () => {
  const {map, orbit} = setup();
  map.bearing = 100;
  orbit.start();
  for (const expected of [-140, -20, 100]) {
    assert.equal(map.active.options.bearing, expected);
    map.finish();
    await settle();
    assert.equal(orbit.isRunning(), true);
  }
  assert.equal(map.animations.length, 4);
  orbit.dispose();
});

test('manual pointer, wheel, touch and navigation keys immediately release the camera', async () => {
  for (const [type, properties] of [['pointerdown', {}], ['wheel', {}], ['touchstart', {}], ['keydown', {key: 'ArrowLeft'}]]) {
    const {map, states, orbit} = setup();
    orbit.start();
    map.bearing = 37;
    map.container.fire(type, properties);
    await settle();
    assert.equal(orbit.isRunning(), false, type);
    assert.equal(map.active, null, type);
    assert.equal(map.bearing, 37, 'stopping must not snap the camera');
    assert.equal(map.animations.length, 1);
    assert.deepEqual(states.at(-1), {running: false, reason: 'manual-input'});
    orbit.dispose();
  }
});

test('Escape stops rotation without consuming the key event', () => {
  const {map, states, orbit} = setup();
  orbit.start();
  const event = new Event('keydown', {cancelable: true});
  event.key = 'Escape';
  map.document.dispatchEvent(event);
  assert.equal(orbit.isRunning(), false);
  assert.equal(event.defaultPrevented, false);
  assert.equal(states.at(-1).reason, 'escape');
  orbit.dispose();
});

test('external stop cannot look like segment completion or restart the orbit', async () => {
  const {map, states, orbit} = setup();
  orbit.start();
  map.bearing = 15;
  map.stop();
  await settle();
  assert.equal(orbit.isRunning(), false);
  assert.equal(map.animations.length, 1);
  assert.equal(states.at(-1).reason, 'interrupted');
  orbit.dispose();
});

test('a new camera owner interrupts the orbit, including during a completion microtask', async () => {
  const {map, orbit} = setup();
  orbit.start();
  map.finish();
  map.emit('movestart', {originalEvent: {type: 'wheel'}});
  await settle();
  assert.equal(orbit.isRunning(), false);
  assert.equal(map.animations.length, 1);
  orbit.dispose();
});

test('a competing camera animation retains control instead of being cancelled by the orbit', async () => {
  const {map, orbit} = setup();
  orbit.start();
  map.finish();
  map.easeTo({bearing: 12, duration: 500}, {navigation: true});
  await settle();
  assert.equal(orbit.isRunning(), false);
  assert.equal(map.active.options.bearing, 12);
  assert.equal(map.animations.length, 2);
  orbit.dispose();
});

test('stopping invalidates pending work, and an explicit restart begins at the current bearing', async () => {
  const {map, orbit} = setup();
  orbit.start();
  map.finish();
  orbit.stop('navigation');
  map.bearing = 27;
  orbit.start();
  await settle();
  assert.equal(map.animations.length, 2);
  assert.equal(map.active.options.bearing, 147);
  assert.equal(orbit.start(), true);
  assert.equal(map.animations.length, 2, 'start is idempotent');
  orbit.dispose();
});

test('reduced motion blocks starting and a preference change stops existing rotation', () => {
  const {map, states, orbit} = setup();
  map.motion.matches = true;
  assert.equal(orbit.start(), false);
  assert.equal(map.animations.length, 0);
  assert.deepEqual(states.at(-1), {running: false, reason: 'reduced-motion'});
  map.motion.matches = false;
  orbit.start();
  map.motion.matches = true;
  map.motion.fire('change');
  assert.equal(orbit.isRunning(), false);
  assert.equal(map.active, null);
  orbit.dispose();
});

test('injected reduced motion preference is respected without browser globals', () => {
  const {map, states, orbit} = setup({reducedMotion: () => true});
  assert.equal(orbit.toggle(), false);
  assert.equal(map.animations.length, 0);
  assert.equal(states.at(-1).reason, 'reduced-motion');
  orbit.dispose();
});

test('hidden page stops motion, refuses starting, and never resumes on its own', () => {
  const {map, states, orbit} = setup();
  orbit.start();
  map.document.hidden = true;
  map.document.visibilityState = 'hidden';
  map.document.fire('visibilitychange');
  assert.equal(orbit.isRunning(), false);
  assert.equal(states.at(-1).reason, 'document-hidden');
  assert.equal(orbit.start(), false);
  map.document.hidden = false;
  map.document.visibilityState = 'visible';
  map.document.fire('visibilitychange');
  assert.equal(orbit.isRunning(), false);
  assert.equal(map.animations.length, 1);
  orbit.dispose();
});

test('button toggles rotation and disposal detaches every event listener', async () => {
  const {map, button, states, orbit} = setup();
  button.fire('click');
  assert.equal(orbit.isRunning(), true);
  button.fire('click');
  assert.equal(orbit.isRunning(), false);
  button.fire('click');
  map.finish();
  orbit.dispose();
  const stateCount = states.length;
  const animationCount = map.animations.length;
  button.fire('click');
  map.container.fire('wheel');
  map.document.fire('keydown', {key: 'Escape'});
  map.motion.fire('change');
  map.emit('movestart');
  map.emit('moveend');
  await settle();
  assert.equal(orbit.start(), false);
  assert.equal(orbit.isRunning(), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(map.animations.length, animationCount);
  assert.equal(states.length, stateCount);
  assert.ok([...map.listeners.values()].every(listeners => listeners.size === 0));
  orbit.dispose();
});

test('removed maps dispose without calling camera methods on the removed instance', () => {
  const {map, orbit} = setup();
  orbit.start();
  map.stop = () => { throw new Error('map is removed'); };
  assert.doesNotThrow(() => map.emit('remove'));
  assert.equal(orbit.isRunning(), false);
  assert.equal(orbit.start(), false);
});
