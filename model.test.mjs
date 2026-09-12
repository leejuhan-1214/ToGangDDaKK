import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadLandMask, isLand } from './land-mask.mjs';
import {
  GRID_COLS, GRID_ROWS, gaussianClassify, applyCellularAutomata,
  geographicField, createManagementCenters, analyze, regions, areaKm2,
  distanceKm, greedyPlan, restorationScores, primEdges, aStar,
} from './model.mjs';

await loadLandMask(JSON.parse(await readFile(new URL('./data/land-mask.json', import.meta.url), 'utf8')));

const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const sum = values => values.reduce((total, value) => total + value, 0);
const radians = degrees => degrees * Math.PI / 180;
const wrap = lng => ((lng + 180) % 360 + 360) % 360 - 180;

// Independent great-circle oracle using 3D unit vectors, not haversine.
function sphereDistance(a, b) {
  const vector = ([lng, lat]) => [Math.cos(radians(lat)) * Math.cos(radians(lng)), Math.cos(radians(lat)) * Math.sin(radians(lng)), Math.sin(radians(lat))];
  const u = vector(a), v = vector(b);
  const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  return 6371 * Math.atan2(Math.hypot(...cross), sum(u.map((value, index) => value * v[index])));
}

test('NB known stable and severe class posteriors, normalized finite probabilities', () => {
  const stable = gaussianClassify([0.57, -2, 112, 25, 24, 18]);
  const severe = gaussianClassify([0.12, -27, 27, 7, 39, 78]);
  assert.equal(stable.classIndex, 0);
  assert.equal(severe.classIndex, 3);
  near(stable.probabilities[0], 0.9885176075307378, 1e-13);
  near(stable.probabilities[1], 0.011482392459934786, 1e-13);
  near(severe.probabilities[3], 0.9985195169158961, 1e-13);
  for (const result of [stable, severe, gaussianClassify([.3, -13, 70, 14, 32, 42])]) {
    near(sum(result.probabilities), 1, 1e-14);
    assert.ok(result.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
    near(result.confidence, result.probabilities[result.classIndex]);
  }
});

function uniformCells() {
  return Array.from({ length: GRID_COLS * GRID_ROWS }, (_, index) => ({
    row: Math.floor(index / GRID_COLS), col: index % GRID_COLS,
    classIndex: 0, riskScore: .12, bareSoil: 18, moisture: 30, temperature: 20,
  }));
}
test('CA uniform quiet grid has analytical 3-generation result including boundaries', () => {
  const cells = uniformCells();
  applyCellularAutomata(cells, 3);
  // Each generation is s_next = .92*s - .012 for this uniform low-stress field.
  for (const cell of cells) {
    near(cell.riskScore, .06024576, 1e-12);
    assert.equal(cell.classIndex, 0);
    assert.equal(cell.nbClassIndex, 0);
    near(cell.nbRiskScore, .12);
  }
});
test('CA uses synchronous Moore neighbors and does not wrap rows', () => {
  const cells = uniformCells();
  const middle = 24 * GRID_COLS + 32;
  Object.assign(cells[middle], { classIndex: 3, riskScore: .86 });
  Object.assign(cells[GRID_COLS - 1], { classIndex: 3, riskScore: .86 });
  applyCellularAutomata(cells, 1);
  near(cells[middle].riskScore, .5424);
  for (const offset of [-GRID_COLS-1, -GRID_COLS, -GRID_COLS+1, -1, 1, GRID_COLS-1, GRID_COLS, GRID_COLS+1]) near(cells[middle+offset].riskScore, .128);
  near(cells[GRID_COLS].riskScore, .0984);
});

test('Raw coordinate field is deterministic and periodic over longitude wraps', () => {
  for (const [lat, lng] of [[45,105], [15.5,-14.65], [-31,179.9], [60,-179.99], [0,0]]) {
    for (const salt of [0, 41, 103]) {
      const baseline = geographicField(lat, lng, salt);
      assert.equal(geographicField(lat, lng, salt), baseline);
      near(geographicField(lat, lng + 360, salt), baseline, 1e-11);
      near(geographicField(lat, lng - 720, salt), baseline, 1e-11);
    }
  }
  assert.notEqual(geographicField(45,105), geographicField(45,106));
});

const gobi = analyze(regions.gobi.bounds);
test('Land area equals the clipped grid sum; viewport area matches independent latitude integration', () => {
  for (const bounds of [regions.gobi.bounds, regions.sahel.bounds, { south: -1, north: 1, west: 179, east: 181 }, { south: 72, north: 78, west: 10, east: 18 }]) {
    const result = analyze(bounds);
    near(sum(result.cells.map(cell => cell.area)), result.area, result.area * 1e-12);
    // Simpson quadrature of R^2*cos(latitude) dlatitude dlongitude.
    const n = 2000, low = radians(bounds.south), high = radians(bounds.north), step = (high-low)/n;
    let integral = Math.cos(low) + Math.cos(high);
    for (let i=1;i<n;i++) integral += (i%2 ? 4 : 2) * Math.cos(low+i*step);
    const expected = 6371**2 * radians(bounds.east-bounds.west) * integral * step / 3;
    near(areaKm2(bounds), expected, expected * 1e-12);
    near(result.viewportArea, expected, expected * 1e-12);
    near(result.area + result.waterArea, result.viewportArea, result.viewportArea * 1e-12);
    assert.equal(result.cells.length, GRID_COLS*GRID_ROWS);
    assert.equal(new Set(result.cells.map(c => c.index)).size, result.cells.length);
    assert.equal(result.landCellCount, result.cells.filter(c => c.isLand).length);
    assert.ok(result.cells.every(c => c.isLand
      ? Number.isFinite(c.riskScore) && c.riskScore >= 0 && c.riskScore <= 1 && c.area > 0
      : c.riskScore === null && c.area === 0));
  }
});
test('Each Voronoi zone picks nearest geographic hub, including high latitudes', () => {
  for (const result of [gobi, analyze({south:77,north:80,west:10,east:18})]) {
    for (const cell of result.cells.filter((cell,index) => cell.isLand && index % 19 === 0)) {
      assert.ok(isLand(cell.coords));
      if (!result.centers.length) { assert.equal(cell.zone, null); continue; }
      const expected = result.centers.reduce((best, hub) => sphereDistance(cell.coords, hub.coords) < sphereDistance(cell.coords, best.coords) ? hub : best);
      assert.equal(cell.zone, expected.index);
      near(distanceKm(cell.coords, expected.coords), sphereDistance(cell.coords, expected.coords), 1e-9);
    }
  }
});
test('Equivalent +360 degree bounds retain environmental data and physical hub locations', () => {
  const b = {south:43.2,north:43.8,west:101,east:102};
  const shifted = {...b,west:b.west+360,east:b.east+360};
  const first = analyze(b), second = analyze(shifted);
  for (const index of [0, 35, 1024, 2048, 3071]) {
    for (const key of ['ndvi','ndviTrend','rainfall','moisture','temperature','bareSoil','riskScore']) near(first.cells[index][key],second.cells[index][key],1e-10);
  }
  const firstHubs = createManagementCenters(b), secondHubs = createManagementCenters(shifted);
  assert.equal(firstHubs.length, secondHubs.length);
  for (let index=0;index<firstHubs.length;index++) {
    near(wrap(firstHubs[index].coords[0]),wrap(secondHubs[index].coords[0]),1e-10);
    near(firstHubs[index].coords[1],secondHubs[index].coords[1],1e-10);
  }
});

test('Greedy skips unaffordable candidates, honors threshold, cap and fractional budgets', () => {
  // With ecological=0 and people=0, benefit=.62*risk.
  const cells = [
    {index:0,cost:.5,riskScore:1,ecological:0,people:0},
    {index:1,cost:.2,riskScore:.35,ecological:0,people:0},
    {index:2,cost:.1,riskScore:.1,ecological:0,people:0},
  ];
  const snapshot = structuredClone(cells);
  const plan = greedyPlan(cells,.3,0);
  assert.deepEqual(plan.selected.map(c=>c.index),[1,2]);
  near(plan.spent,.3);
  assert.deepEqual(cells,snapshot);
  assert.deepEqual(greedyPlan(cells,0,0).selected,[]);
  assert.equal(greedyPlan(cells,0,0).spent,0);
  assert.equal(greedyPlan(cells,100,101).candidateCount,0);
  assert.deepEqual(greedyPlan(cells,100,35).selected.map(c=>c.index),[0,1]);
  for (const budget of [0,1,3.7,10,20,30,50,100,1000]) {
    for (const threshold of [0,35,65,85,100]) {
      const result=greedyPlan(gobi.cells,budget,threshold);
      assert.ok(result.spent <= budget + 1e-9);
      near(result.spent,sum(result.selected.map(c=>c.cost)));
      assert.ok(result.selected.length<=7);
      assert.ok(result.selected.every(c=>c.riskScore*100>=threshold));
      assert.equal(new Set(result.selected.map(c=>c.index)).size,result.selected.length);
    }
  }
});
test('Restoration preserves immutable baseline, clamps effect and monotonically reduces selected risk', () => {
  const cells = Object.freeze([.8,.6,.2].map((riskScore,index)=>Object.freeze({index,riskScore,area:[2,3,5][index]})));
  const selected = Object.freeze([cells[1]]);
  const baseline = cells.map(c=>c.riskScore);
  assert.deepEqual(restorationScores(cells,selected,0),baseline);
  assert.deepEqual(restorationScores(cells,selected,-20),baseline);
  assert.deepEqual(restorationScores(cells,[],100),baseline);
  assert.deepEqual(restorationScores(cells,selected,100),[.8,.3,.2]);
  assert.deepEqual(restorationScores(cells,selected,200),[.8,.3,.2]);
  let previous=baseline;
  for (const effect of [0,20,40,60,80,100]) {
    const result=restorationScores(cells,selected,effect);
    result.forEach((risk,index)=>{ assert.ok(risk<=previous[index]); assert.ok(risk>=0); });
    assert.equal(result[0],.8);assert.equal(result[2],.2);
    previous=result;
  }
  const after=restorationScores(cells,selected,100);
  const weighted=values=>sum(values.map((risk,index)=>risk*cells[index].area))/10;
  near(weighted(baseline),.44);near(weighted(after),.35);
  const highArea=values=>sum(values.map((risk,index)=>risk>=.5?cells[index].area:0));
  assert.equal(highArea(baseline),5);assert.equal(highArea(after),2);
  assert.deepEqual(cells.map(c=>c.riskScore),baseline);
  assert.deepEqual(restorationScores(cells,selected,0),baseline);
});

function treeWeightIfConnected(n, edges) {
  const components=Array.from({length:n},(_,index)=>index);
  const root=index=>{while(components[index]!==index)index=components[index];return index;};
  for(const edge of edges){const a=root(edge.from),b=root(edge.to);if(a===b)return Infinity;components[a]=b;}
  if(edges.length!==n-1||new Set(components.map((_,index)=>root(index))).size!==1)return Infinity;
  return sum(edges.map(e=>e.distance));
}
function exhaustiveMst(points) {
  const edges=[];let best=Infinity;
  for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)edges.push({from:a,to:b,distance:sphereDistance(points[a].coords,points[b].coords)});
  function choose(start, chosen){
    if(chosen.length===points.length-1){best=Math.min(best,treeWeightIfConnected(points.length,chosen));return;}
    for(let index=start;index<edges.length;index++)choose(index+1,[...chosen,edges[index]]);
  }
  choose(0,[]);return best;
}
test('Prim forms a connected minimum tree matching exhaustive small-graph search', () => {
  assert.deepEqual(primEdges([]),[]);
  assert.deepEqual(primEdges([{coords:[0,0]}]),[]);
  for(const coords of [ [[0,0],[3,0],[3,4],[0,4]], [[104,44],[104.8,45.1],[106,45],[104.9,43.7],[107,46]], [[179,10],[-179,10],[180,12],[178,9],[-178,11]], [[0,0],[0,0],[1,0],[0,1]] ]){
    const points=coords.map(coords=>({coords})), edges=primEdges(points);
    assert.equal(edges.length,points.length-1);
    assert.ok(Number.isFinite(treeWeightIfConnected(points.length,edges)));
    near(sum(edges.map(e=>e.distance)),exhaustiveMst(points),1e-8);
  }
});

const entryCost=cell=>1+cell.riskScore*1.4+cell.bareSoil/130;
const key=cell=>`${cell.row},${cell.col}`;
function dijkstra(cells,start,goal){
  const pending=new Map(cells.map(c=>[key(c),c])), distance=new Map([[key(start),0]]);
  while(pending.size){
    let current=null,currentDistance=Infinity;
    for(const [id,cell] of pending){const value=distance.get(id)??Infinity;if(value<currentDistance){current=cell;currentDistance=value;}}
    if(!current)return Infinity;
    if(key(current)===key(goal))return currentDistance;
    pending.delete(key(current));
    for(const candidate of pending.values()){
      if(Math.abs(candidate.row-current.row)+Math.abs(candidate.col-current.col)!==1)continue;
      distance.set(key(candidate),Math.min(distance.get(key(candidate))??Infinity,currentDistance+entryCost(candidate)));
    }
  }
  return Infinity;
}
function validatePath(path,start,goal){
  assert.equal(key(path[0]),key(start));assert.equal(key(path.at(-1)),key(goal));
  for(let index=1;index<path.length;index++)assert.equal(Math.abs(path[index].row-path[index-1].row)+Math.abs(path[index].col-path[index-1].col),1);
  return sum(path.slice(1).map(entryCost));
}
test('A* detours around expensive cells and handles same start and unreachable goal', () => {
  const cells=Array.from({length:9},(_,index)=>({row:Math.floor(index/3),col:index%3,riskScore:index===4?1:0,bareSoil:index===4?100:0}));
  const path=aStar(cells,cells[3],cells[5]);
  near(validatePath(path,cells[3],cells[5]),4);
  assert.equal(path.length,5);assert.ok(!path.includes(cells[4]));
  assert.deepEqual(aStar(cells,cells[3],cells[3]),[cells[3]]);
  assert.deepEqual(aStar([cells[3],cells[5]],cells[3],cells[5]),[]);
});
test('A* agrees with independent Dijkstra on 80 deterministic weighted/blocked grids', () => {
  let seed=938457;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<80;sample++){
    const rows=3+sample%5,cols=3+sample%4,cells=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      if((row!==0||col!==0)&&(row!==rows-1||col!==cols-1)&&random()<.13)continue;
      cells.push({row,col,riskScore:random(),bareSoil:random()*100});
    }
    const start=cells[0],goal=cells.at(-1),expected=dijkstra(cells,start,goal),path=aStar(cells,start,goal);
    if(expected===Infinity)assert.deepEqual(path,[]);
    else near(validatePath(path,start,goal),expected,1e-9);
  }
});
