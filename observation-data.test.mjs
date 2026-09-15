import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNpp,normalizeAnnualDates,normalizeNppSubset,calculateProductivityTrend,normalizeRainfall,
  fetchPointObservations,clearObservationCache,createObservationLoader} from './observation-data.mjs';

const dates=(start=2001,end=2025)=>Array.from({length:end-start+1},(_,i)=>({modis_date:`A${start+i}001`,calendar_date:`${start+i}-01-01`}));
const dateRows=(start=2001,end=2025)=>normalizeAnnualDates({dates:dates(start,end)},{lastCompleteYear:2025});
const bands={bands:[{band:'Npp_500m',scale_factor:'0.0001',add_offset:'0',valid_range:'-30000 to 32700'}]};
function subset(start=2001,end=2025,{raw=1000,qc=20}={}){
  return {nrows:1,ncols:1,cellsize:463.312716528,xllcorner:'10000',yllcorner:'20000',subset:dates(start,end).flatMap(row=>[
    {...row,band:'Npp_500m',data:[typeof raw==='function'?raw(Number(row.calendar_date.slice(0,4))):raw]},
    {...row,band:'Npp_QC_500m',data:[qc]}])};
}
function rain(start=2001,end=2025,value=1){return {parameters:{PRECTOTCORR:{units:'mm/day'}},header:{fill_value:-999,sources:['MERRA2']},properties:{parameter:{PRECTOTCORR:Object.fromEntries(Array.from({length:end-start+1},(_,i)=>start+i).flatMap(year=>Array.from({length:12},(_,m)=>[`${year}${String(m+1).padStart(2,'0')}`,value])))}}};}
const json=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
function fixtureFetch({failBatch=false,delay=0,qc=20}={}){
  let count=0,active=0,maxActive=0;const urls=[];
  const fetchImpl=async(url,{signal})=>{
    count++;urls.push(url);active++;maxActive=Math.max(maxActive,active);
    try{
      if(delay)await new Promise((resolve,reject)=>{
        if(signal.aborted){reject(signal.reason);return;}
        const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},delay);
        signal.addEventListener('abort',onAbort,{once:true});
      });
      const parsed=new URL(url),params=parsed.searchParams;
      if(parsed.pathname.endsWith('/bands'))return json(bands);
      if(parsed.pathname.endsWith('/dates'))return json({dates:dates()});
      if(parsed.pathname.endsWith('/subset')){
        const start=Number(params.get('startDate').slice(1,5)),end=Number(params.get('endDate').slice(1,5));
        assert.ok(end-start+1<=10,'provider max 10 dates');
        if(failBatch&&start===2011)return {ok:false,status:503};
        return json({...subset(start,end,{raw:y=>4000-50*(y-2001),qc}),latitude:Number(params.get('latitude')),longitude:Number(params.get('longitude'))});
      }
      return json(rain(Number(params.get('start')),Number(params.get('end'))));
    }finally{active--;}
  };
  return {fetchImpl,stats:()=>({count,maxActive,urls})};
}
const opts={now:'2026-09-15T00:00:00Z',cache:false};

test('MOD17 scale and negative physical range are preserved; zero is valid',()=>{
  assert.equal(normalizeNpp(1234,0).nppKgC,0.1234);
  assert.equal(normalizeNpp(0,50).nppKgC,0);
  assert.equal(normalizeNpp(-200,12).nppKgC,-0.02);
  assert.equal(normalizeNpp(null,0).nppKgC,null);
  assert.equal(normalizeNpp(0,null).reason,'missing-quality');
});
test('water, natural barren, urban and missing product codes cannot become risk evidence',()=>{
  assert.equal(normalizeNpp(32766,254).reason,'water');
  assert.equal(normalizeNpp(32765,253).reason,'barren-or-sparse');
  assert.equal(normalizeNpp(32762,250).reason,'urban');
  assert.equal(normalizeNpp(32767,255).nppKgC,null);
  assert.equal(normalizeNpp(100,254).reason,'water');
});
test('NPP QC is a gap-filled input percentage, not a probability or bit mask',()=>{
  const excluded=normalizeNpp(1000,51);
  assert.equal(excluded.nppKgC,null);assert.equal(excluded.rawNppKgC,0.1);
  assert.equal(excluded.reason,'high-gap-fill');assert.equal(excluded.qualityPercent,51);
  assert.equal(normalizeNpp(1000,100,{maxGapFillPercent:100}).nppKgC,0.1);
  assert.throws(()=>normalizeNpp(100,0,{maxGapFillPercent:-1}),RangeError);
});
test('annual dates use completed advertised years only and reject mismatched dates',()=>{
  const result=normalizeAnnualDates({dates:[...dates(2001,2027),{modis_date:'A1999001',calendar_date:'1999-01-01'},{modis_date:'A2001225',calendar_date:'2001-08-13'},{modis_date:'A2025001',calendar_date:'2024-01-01'}]},{lastCompleteYear:2025,maxYears:20});
  assert.equal(result.length,20);assert.equal(result[0].year,2006);assert.equal(result.at(-1).year,2025);
});
test('normalizer joins NPP and QC by date independently of response row order',()=>{
  const data=subset(2001,2002);data.subset.reverse();data.subset=data.subset.filter(row=>row.modis_date!=='A2002001'||row.band!=='Npp_QC_500m');
  const result=normalizeNppSubset(data,dateRows(2001,2002));
  assert.equal(result.series[0].nppKgC,0.1);assert.equal(result.series[1].reason,'missing-quality');
  assert.equal(result.pixel.cellSizeM,463.312716528);
  assert.throws(()=>normalizeNppSubset({...data,ncols:3},dateRows()),/단일/);
  assert.throws(()=>normalizeNppSubset({...data,subset:[...data.subset,data.subset[0]]},dateRows()),/중복/);
});
test('Sen slope uses real year spacing and is robust to one huge outlier',()=>{
  const series=Array.from({length:20},(_,i)=>({year:2001+i,nppKgC:1-0.01*i}));
  series[8].nppKgC=100;
  const trend=calculateProductivityTrend(series);
  assert.equal(trend.status,'declining');assert.ok(Math.abs(trend.slopePerYear+0.01)<1e-12);
  assert.ok(trend.pValue<0.001);assert.equal(trend.validYears,20);
  assert.match(trend.limitation,/상관/);
});
test('Mann–Kendall handles ties and zero with no artificial trend',()=>{
  const trend=calculateProductivityTrend(Array.from({length:25},(_,i)=>({year:2001+i,nppKgC:0})));
  assert.equal(trend.status,'no-clear-trend');assert.equal(trend.slopePerYear,0);
  assert.equal(trend.tau,0);assert.ok(trend.pValue>0.99999);
});
test('insufficient years and sparse coverage prevent trend declaration',()=>{
  assert.equal(calculateProductivityTrend(Array.from({length:10},(_,i)=>({year:2001+i,nppKgC:1-i/20}))).status,'insufficient-data');
  const series=Array.from({length:25},(_,i)=>({year:2001+i,nppKgC:i<15?1-i/30:null}));
  assert.equal(calculateProductivityTrend(series).status,'insufficient-data');
  assert.throws(()=>calculateProductivityTrend([{year:2001,nppKgC:1},{year:2001,nppKgC:2}]),/one observation/);
});
test('rainfall integrates leap-year month days and excludes incomplete years',()=>{
  const data=rain(2003,2004,2);
  let result=normalizeRainfall(data,2003,2004);
  assert.equal(result.series[0].precipitationMm,730);assert.equal(result.series[1].precipitationMm,732);
  data.properties.parameter.PRECTOTCORR['200402']=-999;
  result=normalizeRainfall(data,2003,2004);assert.equal(result.series[1].precipitationMm,null);
  data.parameters.PRECTOTCORR.units='mm/month';assert.throws(()=>normalizeRainfall(data,2003,2004),/단위/);
});
test('25-year point request is bounded to 6 calls and 2 concurrently; never confirms desertification',async()=>{
  const fixture=fixtureFetch({delay:2});const progress=[];
  const result=await fetchPointObservations(15,10,{...opts,...fixture,onProgress:p=>progress.push(p)});
  assert.equal(fixture.stats().count,6);assert.equal(fixture.stats().maxActive,2);
  assert.deepEqual(result.period,{start:2001,end:2025});assert.equal(result.series.length,25);
  assert.equal(result.latestObservation.year,2025);assert.equal(result.trend.status,'declining');
  assert.equal(result.verdict,'not-confirmed');assert.equal(result.errors.length,0);
  assert.ok(result.missingFlags.includes('soil-carbon-not-validated'));
  assert.equal(result.sourceUrls.subsets.length,3);assert.equal(progress.at(-1).completed,6);
});
test('failed provider batch is missing, not a zero or fabricated continuation',async()=>{
  const fixture=fixtureFetch({failBatch:true});
  const result=await fetchPointObservations(15,10,{...opts,...fixture});
  assert.equal(result.quality.validYears,15);assert.equal(result.quality.excludedYears,10);
  assert.equal(result.series.find(row=>row.year===2015).nppKgC,null);
  assert.equal(result.trend.status,'insufficient-data');assert.equal(result.climate.validYears,25);
  assert.ok(result.missingFlags.includes('npp-unavailable'));assert.equal(result.errors.length,1);
});
test('unverified scale prevents reading NPP as if it had the expected units',async()=>{
  const fixture=fixtureFetch();
  const fetchImpl=(url,options)=>url.endsWith('/bands')?Promise.resolve(json({bands:[{...bands.bands[0],scale_factor:'1'}]})):fixture.fetchImpl(url,options);
  const result=await fetchPointObservations(15,10,{...opts,fetchImpl});
  assert.equal(result.quality.validYears,0);assert.equal(result.latestObservation,null);
  assert.equal(result.climate.validYears,25);assert.equal(result.sourceUrls.subsets.length,0);
  assert.ok(result.missingFlags.includes('metadata-unavailable'));
});
test('a response for a different coordinate cannot become evidence for the selected point',async()=>{
  const fixture=fixtureFetch();
  const fetchImpl=async(url,options)=>{
    const response=await fixture.fetchImpl(url,options);
    if(!url.includes('/subset?'))return response;
    const data=await response.json();return json({...data,latitude:55});
  };
  const result=await fetchPointObservations(15,10,{...opts,fetchImpl});
  assert.equal(result.quality.validYears,0);assert.equal(result.latestObservation,null);
  assert.equal(result.errors.length,3);assert.equal(result.climate.validYears,25);
});
test('cache is bounded to requested coordinates and returns defensive copies',async()=>{
  clearObservationCache();const fixture=fixtureFetch();
  const options={...opts,...fixture,cache:true};
  const first=await fetchPointObservations(15,10,options);first.series[0].nppKgC=999;
  const second=await fetchPointObservations(15,10,options);
  assert.equal(fixture.stats().count,6);assert.notEqual(second.series[0].nppKgC,999);
  assert.equal(second.cacheUsed,true);assert.equal(second.sourceRequests.length,6);
  assert.ok(second.sourceRequests.every(row=>row.cacheHit));assert.ok(second.retrievedAt<=second.checkedAt);
  await fetchPointObservations(16,10,options);assert.equal(fixture.stats().count,11);
  clearObservationCache();
});
test('aborted requests reject, and a new selection cannot return an older result',async()=>{
  const fixture=fixtureFetch({delay:20}),loader=createObservationLoader({...opts,...fixture});
  const old=loader.load(15,10);const rejected=assert.rejects(old,{name:'AbortError'});
  const fresh=loader.load(16,11);await rejected;
  assert.deepEqual((await fresh).coordinate,[16,11]);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(fetchPointObservations(15,10,{...opts,...fixture,signal:aborted.signal}),{name:'AbortError'});
});
test('timeouts preserve unavailable states instead of hanging or inventing observations',async()=>{
  const fixture=fixtureFetch({delay:80});
  const result=await fetchPointObservations(15,10,{...opts,...fixture,timeoutMs:10});
  assert.equal(result.latestObservation,null);assert.equal(result.climate,null);
  assert.equal(result.trend.status,'insufficient-data');assert.ok(result.errors.length>=2);
});
