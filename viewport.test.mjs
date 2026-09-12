import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadLandMask, isLand } from './land-mask.mjs';
import { createViewportScheduler, viewportBounds, sameBounds, MERCATOR_LATITUDE } from './viewport.mjs';
import { analyze, GRID_COLS, GRID_ROWS, areaKm2 } from './model.mjs';

await loadLandMask(JSON.parse(await readFile(new URL('./data/land-mask.json', import.meta.url), 'utf8')));

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

class FakeClock {
  time = 0;
  nextId = 0;
  timers = new Map();
  now = () => this.time;
  setTimer = (callback, delay) => {
    const id = ++this.nextId;
    this.timers.set(id, { callback, due: this.time + Math.max(0, delay) });
    return id;
  };
  clearTimer = id => { this.timers.delete(id); };
  async advance(ms) {
    const target = this.time + ms;
    let loops = 0;
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert.ok(++loops < 1000, 'timer runaway');
      this.time = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

function harness() {
  const clock = new FakeClock();
  const calls = [], applied = [], errors = [];
  let bounds = { west: 10, east: 20, south: 30, north: 40 };
  let enabled = true, active = 0, maxActive = 0;
  const scheduler = createViewportScheduler({
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    readBounds: () => ({ ...bounds }), enabled: () => enabled,
    compute: b => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const call = { bounds: b, at: clock.time, resolve, reject };
      calls.push(call);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return promise.finally(() => { active -= 1; });
    },
    apply: result => applied.push(result), onError: error => errors.push(error),
  });
  return {
    scheduler, clock, calls, applied, errors,
    setBounds(value) { bounds = value; },
    setEnabled(value) { enabled = value; },
    get maxActive() { return maxActive; },
    async resolve(index, result = { bounds: calls[index].bounds }) { calls[index].resolve(result); await flush(); },
    async reject(index, error = new Error('worker failed')) { calls[index].reject(error); await flush(); },
  };
}

test('burst movement coalesces and the final viewport is eventually applied with one computation in flight', async () => {
  const h = harness();
  const intermediate = { west: 40, east: 60, south: 10, north: 20 };
  const final = { west: 170, east: 190, south: -20, north: 5 };
  h.scheduler.move();
  h.setBounds(intermediate);
  h.scheduler.move();
  await h.clock.advance(0);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].bounds, intermediate);
  for (let i = 0; i < 20; i += 1) h.scheduler.move();
  h.setBounds(final);
  h.scheduler.settle();
  await h.clock.advance(30);
  assert.equal(h.calls.length, 1);
  await h.resolve(0);
  await h.clock.advance(149);
  assert.equal(h.calls.length, 1);
  await h.clock.advance(1);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].bounds, final);
  await h.resolve(1);
  assert.deepEqual(h.applied.at(-1).bounds, final);
  assert.equal(h.maxActive, 1);
  assert.equal(h.clock.timers.size, 0);
});

test('settle samples the current viewport after its delay and replaces a queued movement timer', async () => {
  const h = harness();
  h.scheduler.move();
  await h.clock.advance(0);
  await h.resolve(0);
  h.scheduler.move();
  h.scheduler.settle();
  assert.equal(h.clock.timers.size, 1);
  await h.clock.advance(59);
  assert.equal(h.calls.length, 1);
  h.setBounds({ west: -20, east: 0, south: -10, north: 0 });
  await h.clock.advance(1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].bounds.west, -20);
  await h.resolve(1);
});

test('invalidate rejects old results while refresh waits for the existing computation', async () => {
  const h = harness();
  h.scheduler.refresh();
  await h.clock.advance(0);
  h.scheduler.invalidate();
  h.setBounds({ west: 100, east: 110, south: 40, north: 50 });
  h.scheduler.refresh();
  await h.clock.advance(500);
  assert.equal(h.calls.length, 1);
  await h.resolve(0);
  assert.equal(h.applied.length, 0);
  await h.clock.advance(0);
  assert.equal(h.calls.length, 2);
  await h.resolve(1);
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].bounds.west, 100);
  assert.equal(h.maxActive, 1);
});

test('disabled drawing mode pauses queued work and suppresses active results, then refresh resumes', async () => {
  const h = harness();
  h.scheduler.move();
  h.setEnabled(false);
  await h.clock.advance(1000);
  assert.equal(h.calls.length, 0);
  h.scheduler.refresh();
  h.scheduler.move();
  h.scheduler.settle();
  assert.equal(h.clock.timers.size, 0);
  h.setEnabled(true);
  h.scheduler.refresh();
  await h.clock.advance(0);
  assert.equal(h.calls.length, 1);
  h.setEnabled(false);
  h.scheduler.invalidate();
  await h.resolve(0);
  assert.equal(h.applied.length, 0);
  h.setEnabled(true);
  h.scheduler.refresh();
  await h.clock.advance(0);
  await h.resolve(1);
  assert.equal(h.applied.length, 1);
});

test('a worker error reports once, releases the busy slot, and pending work recovers', async () => {
  const h = harness();
  h.scheduler.refresh();
  await h.clock.advance(0);
  h.scheduler.move();
  await h.reject(0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.applied.length, 0);
  await h.clock.advance(180);
  assert.equal(h.calls.length, 2);
  await h.resolve(1);
  assert.equal(h.applied.length, 1);
  assert.equal(h.maxActive, 1);
});

test('errors from invalidated work are ignored and dispose prevents future work', async () => {
  const h = harness();
  h.scheduler.refresh();
  await h.clock.advance(0);
  h.scheduler.invalidate();
  await h.reject(0);
  assert.equal(h.errors.length, 0);
  h.scheduler.refresh();
  h.scheduler.dispose();
  h.scheduler.refresh();
  h.scheduler.move();
  h.scheduler.settle();
  await h.clock.advance(1000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.clock.timers.size, 0);
});

test('a null result is a successful no-op without leaking pending work', async () => {
  const h = harness();
  h.scheduler.refresh();
  await h.clock.advance(0);
  await h.resolve(0, null);
  assert.equal(h.applied.length, 0);
  h.scheduler.refresh();
  await h.clock.advance(0);
  assert.equal(h.calls.length, 2);
  await h.resolve(1);
});

test('viewport normalization supports date-line crossings, repeated worlds, poles, and invalid bounds', () => {
  assert.deepEqual(viewportBounds({ west: 170, east: 200, south: -10, north: 10 }), { west: 170, east: 200, south: -10, north: 10 });
  assert.deepEqual(viewportBounds({ west: 530, east: 560, south: -10, north: 10 }), { west: 170, east: 200, south: -10, north: 10 });
  assert.deepEqual(viewportBounds({ west: -900, east: 900, south: -90, north: 90 }), { west: -180, east: 180, south: -MERCATOR_LATITUDE, north: MERCATOR_LATITUDE });
  for (const b of [
    { west: 0, east: 0, south: 0, north: 1 },
    { west: 0, east: 1, south: 0, north: 0 },
    { west: 0, east: Infinity, south: 0, north: 1 },
    { west: 0, east: 1, south: 86, north: 90 },
  ]) assert.throws(() => viewportBounds(b));
});

test('bounds tolerance preserves small pan changes at deep zoom', () => {
  const b = { west: 127, east: 127.0001, south: 37, north: 37.0001 };
  assert.ok(sameBounds(b, { ...b }));
  assert.ok(sameBounds(b, { ...b, west: b.west + 1e-10 }));
  assert.ok(!sameBounds(b, { ...b, west: b.west + 1e-7 }));
});

const cases = [
  ['world', { west: -540, east: 540, south: -90, north: 90 }],
  ['near north pole', { west: 160, east: 200, south: 84.9, north: 89 }],
  ['near south pole', { west: -170, east: -130, south: -89, north: -84.9 }],
  ['dateline', { west: 175, east: 195, south: -12, north: 6 }],
  ['tiny zoom', { west: 127.00001, east: 127.00011, south: 37.00001, north: 37.00007 }],
];

for (const [name, raw] of cases) {
  test(`${name}: analysis covers the complete viewport with 3072 cells and bounded management hubs`, () => {
    const b = viewportBounds(raw);
    const result = analyze(b);
    assert.equal(result.cells.length, GRID_COLS * GRID_ROWS);
    assert.equal(result.cells.length, 3072);
    assert.ok(result.centers.length <= 99, `${result.centers.length} centers`);
    assert.equal(result.cells[0].bounds.west, b.west);
    assert.equal(result.cells[0].bounds.north, b.north);
    const last = result.cells.at(-1);
    assert.ok(Math.abs(last.bounds.east - b.east) < 1e-10);
    assert.ok(Math.abs(last.bounds.south - b.south) < 1e-10);
    const sum = result.cells.reduce((total, cell) => total + cell.area, 0);
    assert.ok(Math.abs(sum - result.area) <= Math.max(1e-12, result.area * 1e-6), `${sum} vs ${result.area}`);
    assert.ok(Math.abs(result.viewportArea - areaKm2(b)) <= Math.max(1e-12, areaKm2(b) * 1e-6));
    assert.ok(result.area <= result.viewportArea * (1 + 1e-6));
    if (name === 'world') {
      assert.ok(result.area > 120_000_000 && result.area < 160_000_000, `${result.area} km2 global land`);
      assert.ok(result.landCellCount > 0 && result.landCellCount < result.cells.length);
    }
    if (name === 'near north pole') assert.equal(result.landCellCount, 0);
    if (name === 'near south pole') assert.ok(result.landCellCount > result.cells.length / 2, 'Antarctic land remains covered; ice shelf water is excluded');
    if (name === 'tiny zoom') assert.equal(result.landCellCount, result.cells.length);
    for (const cell of result.cells) {
      assert.ok(cell.bounds.east > cell.bounds.west && cell.bounds.north > cell.bounds.south);
      if (cell.isLand) {
        assert.ok(Number.isFinite(cell.riskScore) && cell.riskScore >= 0 && cell.riskScore <= 1);
        assert.ok(cell.area > 0 && Number.isFinite(cell.area));
        assert.ok(isLand(cell.coords), `${name}: land sample ${cell.coords}`);
      } else {
        assert.equal(cell.riskScore, null);
        assert.equal(cell.area, 0);
        assert.equal(cell.geometry, null);
      }
    }
    for (const center of result.centers) {
      assert.ok(Math.abs(center.coords[1]) <= MERCATOR_LATITUDE);
      assert.ok(center.coords.every(Number.isFinite));
      assert.ok(isLand(center.coords));
    }
  });
}
