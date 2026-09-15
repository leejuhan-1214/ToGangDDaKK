import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configureUnccdReference,findCountry,countryReference} from './unccd-reference.mjs';

const data=JSON.parse(await readFile(new URL('./data/unccd-reference.json',import.meta.url)));
const borders=JSON.parse(await readFile(new URL('./data/country-boundaries.json',import.meta.url)));
configureUnccdReference(data,borders);

test('official snapshot retains observed dates, missing values and national/aggregate scopes',()=>{
  assert.ok(data.counts.nationalAreas>=140);
  assert.ok(data.counts.nationalAreasWithValues>=100);
  assert.equal(Object.values(data.areas).flatMap(a=>a.observations).length,data.counts.observations);
  assert.equal(data.areas['1'].scope,'aggregate');
  assert.equal(data.areas['496'].scope,'national');
  assert.equal(data.pointValidated,false);
  for(const area of Object.values(data.areas)) for(const row of area.observations) {
    assert.equal(row.unit,'PERCENT');
    assert.ok(row.percent===null||(Number.isFinite(row.percent)&&row.percent>=0&&row.percent<=100));
    assert.ok(row.source);
    assert.ok(row.nature);
    assert.ok(Number.isInteger(row.year));
  }
});

test('country boundaries resolve inland preset and international reference points',()=>{
  for(const [point,m49] of [[[104,43.5],'496'],[[-14.5,15],'686'],[[60,46.5],'398'],[[59.612,42.46],'860'],[[126.978,37.5665],'410'],[[-98,38],'840'],[[2.35,48.85],'250']]) assert.equal(findCountry(point)?.m49,m49,JSON.stringify(point));
});

test('open ocean never inherits a nearest national value',()=>{
  for(const point of [[0,0],[-140,0],[130,30],[NaN,37],[0,91]]) {
    assert.equal(findCountry(point),null);
    assert.equal(countryReference(point).latest,null);
  }
});

test('national report is not pixel verification and preserves its reporting agency',()=>{
  const result=countryReference([104,43.5]);
  assert.equal(result.scope,'national');
  assert.equal(result.pointValidated,false);
  assert.equal(result.latest.percent,23.42);
  assert.equal(result.latest.year,2019);
  assert.equal(result.latest.nature,'C');
  assert.match(result.latest.source,/Ministry/);
  assert.equal(result.country.nameKo,'몽골');
});

test('missing Korean national data remains missing, not zero or regional fallback',()=>{
  const result=countryReference([126.978,37.5665]);
  assert.equal(result.country.m49,'410');
  assert.equal(result.latest,null);
  assert.equal(result.status,'no-national-data');
  assert.ok(result.observations.every(o=>o.percent===null));
});

test('holes exclude inland water in a country lookup fixture',()=>{
  const fixture={type:'FeatureCollection',schemaVersion:1,source:{name:'test'},features:[{properties:{m49:'999',name:'Fixture'},geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]}}]};
  try {
    configureUnccdReference(data,fixture);
    assert.equal(findCountry([2,2]),null);
    assert.equal(findCountry([0.5,0.5]).m49,'999');
    assert.equal(countryReference([0.5,0.5]).status,'no-national-data');
  } finally {configureUnccdReference(data,borders);}
});
