import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLandMask, isLand, isLandSegment } from './land-mask.mjs';
import {
  GRID_COLS, GRID_ROWS, analyze, areaKm2, applyCellularAutomata,
  greedyPlan, restorationScores, riskClassFromScore, polygon,
  aStar, routeToTarget, managementNetwork,
} from './model.mjs';

await loadLandMask(JSON.parse(await readFile(new URL('./data/land-mask.json', import.meta.url), 'utf8')));

const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('analysis fails closed before mask initialization and after an invalid mask load', () => {
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import {analyze} from './model.mjs';
    import {loadLandMask,landMaskReady} from './land-mask.mjs';
    assert.throws(() => analyze({west:122.5,east:123,south:35,north:35.5}), /land mask/i);
    await assert.rejects(loadLandMask({format:-1}), /Invalid land mask/i);
    assert.equal(landMaskReady(), false);
    assert.throws(() => analyze({west:122.5,east:123,south:35,north:35.5}), /land mask/i);
  `], {cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8'});
});

const waterViews = [
  ['Pacific Ocean', {west:-150,east:-149,south:20,north:21}],
  ['Yellow Sea', {west:122.5,east:123,south:35,north:35.5}],
  ['Caspian Sea inland lake', {west:51,east:52,south:40,north:41}],
  ['Pacific date-line crossing', {west:179,east:181,south:20,north:21}],
];

for (const [name, bounds] of waterViews) {
  test(`${name}: no risk class, land area, restoration candidate, hub, or route is assigned`, () => {
    const result = analyze(bounds, {generations:8});
    assert.equal(result.cells.length, GRID_COLS * GRID_ROWS, 'water retains grid slots for CA adjacency');
    assert.equal(result.area, 0);
    assert.equal(result.landCellCount, 0);
    near(result.waterArea, areaKm2(bounds));
    assert.equal(result.centers.filter(center => center.visible).length, 0);
    assert.deepEqual(managementNetwork(result.centers), []);
    for (const cell of result.cells) {
      assert.equal(cell.isLand, false);
      assert.equal(cell.riskScore, null);
      assert.equal(cell.nbRiskScore, null);
      assert.equal(cell.classIndex, null);
      assert.equal(cell.nbClassIndex, null);
      assert.equal(cell.zone, null);
      assert.equal(cell.geometry, null);
      assert.equal(cell.area, 0);
      assert.equal(polygon(cell).geometry, null);
    }
    for (const threshold of [0, 65, 100]) {
      const plan = greedyPlan(result.cells, 1000, threshold);
      assert.deepEqual(plan, {selected:[],spent:0,candidateCount:0});
      assert.deepEqual(routeToTarget(result, plan.selected[0]), []);
    }
    assert.ok(restorationScores(result.cells, result.cells, 100).every(score => score === null));
    assert.equal(riskClassFromScore(null), null);
  });
}

// Independent point-in-polygon oracle: a coastal representative point must be
// inside its own clipped polygon, rather than simply inside the grid rectangle.
function containsPoint(geometry, point) {
  function inRing(ring) {
    let inside = false;
    const [x, y] = point;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const [xi,yi]=ring[i], [xj,yj]=ring[j];
      if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
    }
    return inside;
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => inRing(rings[0]) && !rings.slice(1).some(inRing));
}

test('Korean west coast is polygon-clipped and all statistics use land area', () => {
  const result = analyze({west:125.8,east:127,south:36.4,north:37.9});
  const land = result.cells.filter(cell => cell.isLand);
  const water = result.cells.filter(cell => !cell.isLand);
  const partial = land.filter(cell => cell.area < areaKm2(cell.bounds) * .99);
  assert.ok(land.length > 0 && water.length > 0, 'regression viewport must contain both surfaces');
  assert.ok(partial.length > 0, 'coastline must clip cell geometry');
  assert.ok(result.area > 0 && result.area < result.viewportArea);
  near(result.area, land.reduce((total, cell) => total + cell.area, 0), result.area * 1e-12);
  near(result.waterArea + result.area, result.viewportArea, result.viewportArea * 1e-12);
  const classAreas = [0,1,2,3].map(level => land.filter(cell => cell.classIndex===level).reduce((sum,cell)=>sum+cell.area,0));
  near(classAreas.reduce((sum,area)=>sum+area,0) / result.area, 1, 1e-12);
  assert.equal(result.landCellCount, land.length);
  for (const cell of land) {
    assert.ok(isLand(cell.coords), `land sample must avoid water: ${cell.coords}`);
    assert.ok(containsPoint(cell.geometry, cell.coords), `sample must remain in its own clipped cell: ${cell.index}`);
    assert.deepEqual(polygon(cell).geometry, cell.geometry);
    assert.ok(cell.area <= areaKm2(cell.bounds) * (1 + 1e-6));
  }
  // This catches a center-only land predicate: shoreline cells can have a water
  // midpoint but must retain their land fragments and choose a valid land sample.
  assert.ok(partial.some(cell => !isLand([
    (cell.bounds.west+cell.bounds.east)/2,
    (cell.bounds.south+cell.bounds.north)/2,
  ])), 'some surviving coastal land must have its original rectangle center in water');
  const plan = greedyPlan(result.cells, 100, 0);
  assert.ok(plan.selected.length > 0);
  assert.ok(plan.selected.every(cell => cell.isLand && isLand(cell.coords)));
  assert.ok(result.centers.every(center => isLand(center.coords)));
  const restored = restorationScores(result.cells, plan.selected, 100);
  for (const cell of water) assert.equal(restored[cell.index], null);
  for (const edge of managementNetwork(result.centers)) {
    assert.ok(isLandSegment(result.centers[edge.from].coords, result.centers[edge.to].coords));
  }
});

test('water neighbors cannot seed or dilute cellular automata risk', () => {
  const createGrid = waterRisk => Array.from({length:GRID_COLS*GRID_ROWS}, (_,index) => ({
    row:Math.floor(index/GRID_COLS),col:index%GRID_COLS,isLand:false,
    classIndex:3,riskScore:waterRisk,bareSoil:100,moisture:0,temperature:43,
  }));
  const low = createGrid(0), high = createGrid(1);
  const index = 24*GRID_COLS+32;
  for (const cells of [low,high]) {
    Object.assign(cells[index], {isLand:true,classIndex:0,riskScore:.12,bareSoil:18,moisture:30,temperature:20});
    applyCellularAutomata(cells, 3);
  }
  near(low[index].riskScore, .06024576, 1e-12);
  near(high[index].riskScore, low[index].riskScore, 1e-12);
});

test('A* rejects water endpoints and detours around water even with zero risk', () => {
  const cells = Array.from({length:9}, (_,index) => ({
    row:Math.floor(index/3),col:index%3,isLand:index!==4,riskScore:0,bareSoil:0,
  }));
  const path = aStar(cells, cells[3], cells[5]);
  assert.equal(path.length, 5);
  assert.ok(path.every(cell => cell.isLand));
  assert.deepEqual(aStar(cells, cells[4], cells[5]), []);
  assert.deepEqual(aStar(cells, cells[3], cells[4]), []);
  for (const index of [1,4,7]) cells[index].isLand=false;
  assert.deepEqual(aStar(cells, cells[3], cells[5]), []);
});

test('A* respects a blocked shoreline segment between otherwise valid land cells', () => {
  const cells = Array.from({length:3}, (_,col) => ({row:0,col,isLand:true,riskScore:0,bareSoil:0}));
  assert.deepEqual(aStar(cells, cells[0], cells[2], (a,b) => a.col+b.col!==3), []);
});

test('land geometry, samples, and area are equivalent across longitude world copies', () => {
  const bounds = {west:177.9,east:178.3,south:-18.2,north:-17.8};
  const first = analyze(bounds);
  const shifted = analyze({...bounds,west:bounds.west+360,east:bounds.east+360});
  assert.ok(first.landCellCount > 0, 'Fiji regression viewport must contain land');
  assert.equal(first.landCellCount, shifted.landCellCount);
  near(first.area, shifted.area, Math.max(1e-8,first.area*1e-8));
  for (let index=0;index<first.cells.length;index++) {
    const a=first.cells[index],b=shifted.cells[index];
    assert.equal(a.isLand,b.isLand);
    if (!a.isLand) continue;
    near(a.coords[0]+360,b.coords[0],1e-8);
    near(a.coords[1],b.coords[1],1e-8);
    near(a.area,b.area,Math.max(1e-8,a.area*1e-6));
    near(a.riskScore,b.riskScore,1e-7);
  }
});
