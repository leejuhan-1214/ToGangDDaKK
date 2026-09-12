import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {loadLandMask,clipCell,isLand,isLandSegment,landMaskReady,geometryAreaKm2} from './land-mask.mjs';

assert.equal(landMaskReady(),false);
assert.throws(()=>clipCell({west:0,east:1,south:0,north:1}),/Load the land mask/);
await loadLandMask(JSON.parse(await readFile(new URL('./data/land-mask.json',import.meta.url),'utf8')));
assert.equal(landMaskReady(),true);
const checks=[
  ['Gobi',[104.85,45],true],['Seoul',[126.978,37.5665],true],
  ['Jeju',[126.53,33.36],true],['Yellow Sea',[124.8,35.6],false],
  ['East Sea',[132,37],false],['Pacific',[170,15],false],
  ['Lake Michigan',[-87,44],false],['Caspian Sea',[51,42],false],
  ['Lake Victoria',[33,-1],false],['Lake Baikal',[108,53.5],false],
  ['Suva, Fiji',[178.45,-18.12],true],['Fiji ocean',[-179,-15],false]
];
for(const [name,point,expected] of checks) assert.equal(isLand(point),expected,name);
assert.equal(isLandSegment([103,44.5],[105,45]),true,'inland route is retained');
assert.equal(isLand([45,40]),true,'Caspian route start on land');
assert.equal(isLand([57,40]),true,'Caspian route end on land');
assert.equal(isLandSegment([45,40],[57,40]),false,'land endpoints do not authorize a water-crossing route');
assert.equal(isLandSegment([124.8,35.6],[126.978,37.5665]),false,'water route start rejected');
for(const point of [[124.8,35.6],[170,15],[-87,44],[51,42]]) {
  assert.equal(clipCell({west:point[0]-.03,east:point[0]+.03,south:point[1]-.03,north:point[1]+.03}),null,'water clip');
}
const coastal={west:125.6,east:127,south:36.6,north:37.7};
const clipped=clipCell(coastal);
assert.ok(clipped?.areaKm2>0);
const box={type:'Polygon',coordinates:[[[125.6,36.6],[127,36.6],[127,37.7],[125.6,37.7],[125.6,36.6]]]};
assert.ok(clipped.areaKm2<geometryAreaKm2(box)*.9,'coastal cell excludes water area');
assert.ok(isLand(clipped.point),'representative point is land');
const coords=(g)=>g.type==='Polygon'?g.coordinates.flat():g.coordinates.flat(2);
assert.ok(coords(clipped.geometry).every(([x,y])=>x>=coastal.west-1e-8&&x<=coastal.east+1e-8&&y>=coastal.south-1e-8&&y<=coastal.north+1e-8));
const fiji=clipCell({west:177,east:181,south:-19,north:-15});
const fijiWrap=clipCell({west:-183,east:-179,south:-19,north:-15});
assert.ok(fiji&&fijiWrap);
assert.ok(Math.abs(fiji.areaKm2-fijiWrap.areaKm2)<1e-7,'world-copy area is stable');
assert.ok(coords(fiji.geometry).every(([x])=>x>=177&&x<=181),'continuous world-copy longitude');
for(const bounds of [{west:1,east:0,south:0,north:1},{west:0,east:361,south:0,north:1},{west:0,east:1,south:-91,north:0}]) assert.throws(()=>clipCell(bounds),/Invalid/);

function benchmark(name,bounds) {
  const start=performance.now();let total=0,area=0;
  for(let row=0;row<48;row++) for(let col=0;col<64;col++) {
    const dx=(bounds.east-bounds.west)/64,dy=(bounds.north-bounds.south)/48;
    const b={west:bounds.west+col*dx,east:bounds.west+(col+1)*dx,south:bounds.south+row*dy,north:bounds.south+(row+1)*dy};
    const result=clipCell(b);if(result){total++;area+=result.areaKm2;assert.ok(result.point);}
  }
  return {name,ms:Math.round(performance.now()-start),landCells:total,areaKm2:Math.round(area)};
}
const timings=[
benchmark('Gobi',{west:101,east:108.7,south:43.2,north:46.8}),
benchmark('Korea',{west:123,east:132,south:32,north:40}),
benchmark('Seoul',{west:126.8,east:127.2,south:37.3,north:37.8}),
benchmark('World',{west:-180,east:180,south:-85,north:85}),
benchmark('Korea warm',{west:123,east:132,south:32,north:40})
];
console.log(JSON.stringify({passed:true,pointChecks:checks.length,benchmarks:timings},null,2));
