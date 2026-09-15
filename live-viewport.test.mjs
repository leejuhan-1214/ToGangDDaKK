import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitViewportBounds,MAX_MERCATOR_LATITUDE} from './live-viewport.mjs';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const longitudeOnCircle=lng=>((lng%360)+360)%360;
function expectedCoverage(lng,west,east){
  const span=east-west;
  if(Math.abs(span)>=360)return true;
  const width=span<0?360+span:span;
  return longitudeOnCircle(lng-west)<width;
}
const actualCoverage=(lng,windows)=>windows.some(([west,,east])=>lng>=west&&lng<east);

test('ordinary camera bounds remain a single correctly ordered window',()=>{
  assert.deepEqual(splitViewportBounds([-18,12,-11,19]),[[-18,12,-11,19]]);
  assert.deepEqual(splitViewportBounds([70,40,110,80]),[[70,40,110,80]]);
});
test('dateline crossing preserves both sides without passing longitude190 to CanvasSource',()=>{
  assert.deepEqual(splitViewportBounds([170,-25,190,25]),[[170,-25,180,25],[-180,-25,-170,25]]);
  assert.deepEqual(splitViewportBounds([170,-25,-170,25]),[[170,-25,180,25],[-180,-25,-170,25]]);
});
test('negative and distant world wraps are normalized with identical coverage',()=>{
  assert.deepEqual(splitViewportBounds([-190,-20,-170,20]),[[170,-20,180,20],[-180,-20,-170,20]]);
  assert.deepEqual(splitViewportBounds([530,-20,550,20]),[[170,-20,180,20],[-180,-20,-170,20]]);
  assert.deepEqual(splitViewportBounds([-550,-20,-530,20]),[[170,-20,180,20],[-180,-20,-170,20]]);
  assert.deepEqual(splitViewportBounds([370,-20,390,20]),[[10,-20,30,20]]);
});
test('full globe and multiple worlds produce one canonical global window',()=>{
  for(const [west,east] of [[-180,180],[0,360],[180,-180],[-540,540],[200,-200]]){
    assert.deepEqual(splitViewportBounds([west,-80,east,80]),[[-180,-80,180,80]]);
  }
});
test('seams have no zero-width windows or canonical centres outside longitude bounds',()=>{
  assert.deepEqual(splitViewportBounds([170,0,180,10]),[[170,0,180,10]]);
  assert.deepEqual(splitViewportBounds([180,0,190,10]),[[-180,0,-170,10]]);
  assert.deepEqual(splitViewportBounds([-180,0,-170,10]),[[-180,0,-170,10]]);
  for(const input of [[179.5,50,-179.5,70],[170,-25,190,25],[-180,-85,180,85]]){
    for(const [west,south,east,north] of splitViewportBounds(input)){
      assert.ok(west>=-180&&east<=180&&east>west&&north>south);
      const centreX=((west+east)/2+180)/360;
      assert.ok(centreX>=0&&centreX<1,'canonical centre must be inside one world');
    }
  }
});
test('polar bounds are clipped to the exact Web Mercator latitude limit',()=>{
  assert.deepEqual(splitViewportBounds([-180,-90,180,90]),[[-180,-MAX_MERCATOR_LATITUDE,180,MAX_MERCATOR_LATITUDE]]);
  assert.deepEqual(splitViewportBounds([10,80,20,90]),[[10,80,20,MAX_MERCATOR_LATITUDE]]);
});
test('finite, empty, reversed latitude and entirely polar ranges fail explicitly',()=>{
  for(const bounds of [null,[],[0,0,1],[0,0,1,NaN],[0,0,Infinity,1],['0',0,1,1],[10,0,10,1],[0,10,1,10],[0,11,1,10],[0,86,1,90],[0,-90,1,-86]])assert.throws(()=>splitViewportBounds(bounds),RangeError);
});
test('splits preserve original circular coverage and total longitude span independently',()=>{
  const cases=[[-18,-11],[170,190],[170,-170],[-190,-170],[530,550],[-550,-530],[370,390],[-179.25,179.5],[179.5,-179.25],[-180,180],[-300,80]];
  for(const [west,east] of cases){
    const windows=splitViewportBounds([west,-40,east,65]);
    const rawSpan=east-west,expectedSpan=Math.abs(rawSpan)>=360?360:rawSpan<0?rawSpan+360:rawSpan;
    close(windows.reduce((sum,[w,,e])=>sum+e-w,0),expectedSpan);
    for(let lng=-179.875;lng<180;lng+=0.25)assert.equal(actualCoverage(lng,windows),expectedCoverage(lng,west,east),`coverage mismatch at ${lng} for ${west},${east}`);
  }
});
