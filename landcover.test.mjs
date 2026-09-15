import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLandCoverPoint,summarizeLandCover,loadLandCoverHistory} from './landcover-data.mjs';
const date=year=>({modis_date:`A${year}001`,calendar_date:`${year}-01-01`});
const response=(years,{cover=10,qc=0,water=2}={})=>({nrows:1,ncols:1,latitude:43.5,longitude:104,cellsize:463.312716528,xllcorner:'8388276.77',yllcorner:'4836521.41',subset:years.flatMap(year=>[['LC_Type1',cover],['QC',qc],['LW',water]].map(([band,value])=>({...date(year),band,tile:'h25v04',proc_date:'2025206051107',data:[value]})))});

test('MCD12Q1 QC is a categorical flag: missing land labeled barren is excluded',()=>{
 const rows=parseLandCoverPoint(response([2024],{cover:16,qc:1}),[date(2024)]);
 assert.equal(rows[0].rawClass,16);assert.equal(rows[0].classCode,null);assert.equal(rows[0].accepted,false);
 for(const qc of [3,4,5,6,7,8,9,10,255])assert.equal(parseLandCoverPoint(response([2024],{qc}),[date(2024)])[0].accepted,false);
});
test('water requires aligned class, categorical quality and independent product water mask',()=>{
 assert.equal(parseLandCoverPoint(response([2024],{cover:17,qc:2,water:1}),[date(2024)])[0].status,'classified-water');
 assert.equal(parseLandCoverPoint(response([2024],{cover:17,qc:0,water:2}),[date(2024)])[0].accepted,false);
 assert.equal(parseLandCoverPoint(response([2024],{cover:10,qc:0,water:1}),[date(2024)])[0].accepted,false);
});
test('fill, absent QC, stale QC, malformed values and multi-pixel responses fail closed',()=>{
 for(const cover of [null,255,0,18,NaN,'10'])assert.equal(parseLandCoverPoint(response([2024],{cover}),[date(2024)])[0].classCode,null);
 const missing=response([2024]);missing.subset=missing.subset.filter(row=>row.band!=='QC');assert.equal(parseLandCoverPoint(missing,[date(2024)])[0].accepted,false);
 const stale=response([2024]);stale.subset[1].proc_date='20240101';assert.equal(parseLandCoverPoint(stale,[date(2024)])[0].accepted,false);
 const multiple=response([2024]);multiple.nrows=3;assert.throws(()=>parseLandCoverPoint(multiple,[date(2024)]));
});
test('label differences never imply confirmed change, barren risk, or invented missing endpoints',()=>{
 const before=parseLandCoverPoint(response([2001],{cover:10}),[date(2001)])[0],after=parseLandCoverPoint(response([2024],{cover:16}),[date(2024)])[0];
 const summary=summarizeLandCover([after,before]);assert.equal(summary.labelDifference.different,true);assert.equal(summary.verifiedLandCoverChange,null);assert.equal(summary.desertificationVerdict,null);
 const excluded=parseLandCoverPoint(response([2025],{cover:255}),[date(2025)])[0];
 const partial=summarizeLandCover([before,after,excluded]);assert.equal(partial.latest.year,2025);assert.equal(partial.latest.label,null);assert.equal(partial.latestAccepted.year,2024);assert.equal(partial.labelDifference,null);
});
test('live loader discovers published years and batches <=10 composites with complete provenance',async()=>{
 const calls=[];
 const result=await loadLandCoverHistory({lat:43.5,lng:104,fetchImpl:async url=>{
  calls.push(url);const parsed=new URL(url);if(parsed.pathname.endsWith('/dates'))return {ok:true,json:async()=>({dates:Array.from({length:24},(_,i)=>date(2001+i))})};
  const start=Number(parsed.searchParams.get('startDate').slice(1,5)),end=Number(parsed.searchParams.get('endDate').slice(1,5));assert.ok(end-start<10);assert.equal(parsed.searchParams.get('kmAboveBelow'),'0');assert.equal(parsed.searchParams.has('band'),false);
  return {ok:true,json:async()=>response(Array.from({length:end-start+1},(_,i)=>start+i))};
 }});
 assert.equal(calls.length,4);assert.equal(result.observations.length,24);assert.equal(result.summary.acceptedCount,24);assert.equal(result.period.endYear,2024);assert.deepEqual(result.requestUrls,calls);assert.equal(result.realtimeObservation,false);assert.ok(Math.abs(result.pixel.center.lat-43.5)<.01);
});
test('missing dates, network errors and aborts cannot turn into synthetic observations',async()=>{
 await assert.rejects(loadLandCoverHistory({lat:43.5,lng:104,fetchImpl:async()=>({ok:false,status:503})}),/503/);
 const empty=await loadLandCoverHistory({lat:43.5,lng:104,fetchImpl:async()=>({ok:true,json:async()=>({dates:[]})})});assert.equal(empty.observations.length,0);assert.equal(empty.period.endYear,null);
 const control=new AbortController();control.abort();await assert.rejects(loadLandCoverHistory({lat:43.5,lng:104,signal:control.signal,fetchImpl:()=>assert.fail('aborted request must not start')}));
 await assert.rejects(loadLandCoverHistory({lat:null,lng:104}),/위도/);
});
