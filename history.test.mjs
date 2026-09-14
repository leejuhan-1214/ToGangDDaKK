import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {timelineValues,yearDifference,timelineSvg} from './history-view.mjs';
const history=JSON.parse(await readFile(new URL('./data/history.json',import.meta.url),'utf8'));
test('missing historical observations never become zero or a numeric trend',()=>{
 const rows=[{year:2001,ndvi:.2},{year:2025,ndvi:null}];
 assert.deepEqual(timelineValues(rows,'ndvi'),[{year:2001,value:.2},{year:2025,value:null}]);
 assert.equal(yearDifference(rows,'ndvi',2001,2025),null);
 assert.match(timelineSvg(rows,'ndvi',2001,2025),/2025년 자료 없음/);
 assert.doesNotMatch(timelineSvg(rows,'ndvi',2001,2025),/2025년 0\.00/);
 assert.equal(yearDifference([{year:2001,ndvi:0},{year:2025,ndvi:.25}],'ndvi',2001,2025),.25);
});
test('annual precipitation uses all 12 actual months including leap February',()=>{
 for(const region of Object.values(history.regions))for(const row of region.precipitationSeries){
  assert.equal(row.monthlyMeanMmPerDay.length,12);
  const total=row.monthlyMeanMmPerDay.reduce((sum,value,index)=>sum+value*new Date(Date.UTC(row.year,index+1,0)).getUTCDate(),0);
  assert.ok(Math.abs(row.precipitationMm-total)<=.011,`${region.name} ${row.year}`);
 }
});
test('published NDVI observations preserve scale and exclude failed quality',()=>{
 for(const region of Object.values(history.regions))for(const row of region.series){
  if(row.ndvi===null)continue;
  assert.ok(Math.abs(row.ndvi-row.ndviRaw*.0001)<1e-10);
  assert.equal(row.ndviQuality,0);
  assert.ok(row.ndvi>=-.2&&row.ndvi<=1);
 }
 assert.equal(history.regions.sahel.series.find(row=>row.year===2020).ndvi,null);
 assert.equal(history.regions.sahel.series.find(row=>row.year===2025).ndvi,null);
});
test('historical maps use explicitly supported dates rather than a current-image fallback',()=>{
 for(const layer of Object.values(history.imagery))for(const year of history.years){
  assert.ok(layer.dateByYear[year].startsWith(`${year}-08-`));
  assert.match(layer.tileUrlTemplate,/^https:\/\/gibs\.earthdata\.nasa\.gov\//);
  assert.match(layer.tileUrlTemplate,/\{date\}/);
 }
});
