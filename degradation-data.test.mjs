import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBoundedRangeClient,normalizeDegradationBounds,pointToDegradationPixel,decodeDegradationStatus,
  decodeDegradationPoint,compareDegradationMethods,selectDegradationOverview,degradationGridRowLatitudes,
  createDegradationReader,DEGRADATION_NODATA} from './degradation-data.mjs';

const classes=Object.fromEntries(Array.from({length:7},(_,i)=>[i+1,{labelKo:`상태 ${i+1}`,group:i<3?'degraded':i===3?'stable':'improved'}]));
const source=id=>({id,name:id,url:`https://example.test/${id}`,width:360,height:180,origin:[-180,90],pixelSizeDegrees:[1,1],nominalResolutionMetersAtEquator:111195,bands:Array.from({length:14},(_,i)=>({band:i+1,description:`band ${i+1}`})),overviewResampling:'MODE'});
const manifest={schemaVersion:1,statusYear:2023,baseline:[2000,2015],publicationDate:'2025-11-03',sources:[source('te'),source('jrc')],statusClasses:classes};
const meta={provider:'te',width:360,height:180,origin:[-180,90],resolutionDegrees:[1,1]};

test('a full-file HTTP200 response is cancelled without reading its body',async()=>{
  let cancelled=false,read=false;
  const client=createBoundedRangeClient('https://example.test/file',{fetchImpl:async()=>({status:200,body:{cancel:async()=>{cancelled=true;}},arrayBuffer:async()=>{read=true;throw new Error('Must never read');}})});
  await assert.rejects(client.request({headers:{Range:'bytes=0-65535'}}),/206/);
  assert.equal(cancelled,true);assert.equal(read,false);
});
test('range requests require one bounded byte interval and reject oversized operations',async()=>{
  let calls=0;const context={requests:160,bytes:0};
  const client=createBoundedRangeClient('https://example.test/file',{getContext:()=>context,fetchImpl:async()=>{calls++;}});
  await assert.rejects(client.request({headers:{}}),/단일/);
  await assert.rejects(client.request({headers:{Range:'bytes=0-1,4-5'}}),/단일/);
  await assert.rejects(client.request({headers:{Range:'bytes=0-8388608'}}),/한도/);
  await assert.rejects(client.request({headers:{Range:'bytes=0-3'}}),/한도/);
  assert.equal(calls,0);
});
test('only matching Content-Range and exact response bytes are accepted',async()=>{
  const client=createBoundedRangeClient('https://example.test/file',{fetchImpl:async()=>new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{'content-range':'bytes 4-7/100','content-length':'4'}})});
  await assert.rejects(client.request({headers:{Range:'bytes=0-3'}}),/일치/);
  const oversized=createBoundedRangeClient('https://example.test/file',{fetchImpl:async()=>new Response(new Uint8Array(8),{status:206,headers:{'content-range':'bytes 0-3/100','content-length':'4'}})});
  await assert.rejects(oversized.request({headers:{Range:'bytes=0-3'}}),/초과/);
  const valid=createBoundedRangeClient('https://example.test/file',{fetchImpl:async()=>new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{'content-range':'bytes 0-3/100','content-length':'4'}})});
  assert.deepEqual([...new Uint8Array(await (await valid.request({headers:{Range:'bytes=0-3'}})).getData())],[1,2,3,4]);
});
test('an aborted range never starts a network request',async()=>{
  const controller=new AbortController();controller.abort();let called=false;
  const client=createBoundedRangeClient('https://example.test/file',{fetchImpl:()=>{called=true;}});
  await assert.rejects(client.request({headers:{Range:'bytes=0-3'},signal:controller.signal}),{name:'AbortError'});
  assert.equal(called,false);
});
test('point sampling selects the containing native pixel and supports wrapped longitudes',()=>{
  const point=pointToDegradationPixel(20.25,60.25,meta);
  assert.deepEqual([point.x,point.y],[200,29]);assert.deepEqual(point.bounds,[20,60,21,61]);
  assert.deepEqual(pointToDegradationPixel(380.25,60.25,meta),point);
  assert.equal(pointToDegradationPixel(0,-90,meta),null);
  assert.throws(()=>pointToDegradationPixel(0,91,meta),RangeError);
});
test('status no-data, invalid labels, SDG code0 and continuous SOC are interpreted separately',()=>{
  assert.equal(decodeDegradationStatus(DEGRADATION_NODATA,manifest).code,null);
  assert.equal(decodeDegradationStatus(8,manifest).code,null);
  const values=Array(14).fill(0);values[10]=4;values[12]=-12;values[13]=3;
  const result=decodeDegradationPoint(values,meta,manifest,null);
  assert.equal(result.status.group,'degraded');assert.equal(result.sdg.group,'stable');
  assert.equal(result.landCover.code,0);assert.equal(result.soilCarbonPercent,-12);
  assert.equal(result.productivity.code,4);assert.match(result.soilCarbonPeriodNote,/일치하지/);
});
test('cross-method disagreement is retained and missing pixels never count as agreement',()=>{
  const a={status:{code:3,group:'degraded'},sdg:{code:0}};
  const b={status:{code:4,group:'stable'},sdg:{code:0}};
  const result=compareDegradationMethods(a,b);
  assert.equal(result.status,'different');assert.equal(result.sdg,'same');assert.match(result.limitation,/독립/);
  assert.equal(compareDegradationMethods(a,{status:{code:null},sdg:{code:null}}).status,'unavailable');
});
test('all-zero unclassified pixels retain raw zeros but never imply stable land or method agreement',()=>{
  const first=decodeDegradationPoint(Array(14).fill(0),meta,manifest,null);
  const second=decodeDegradationPoint(Array(14).fill(0),meta,manifest,null);
  assert.deepEqual(first.bands,Array(14).fill(0));
  assert.equal(first.status.code,null);assert.equal(first.sdg.code,null);assert.equal(first.sdg.group,'no-data');
  assert.equal(first.productivity.code,null);assert.equal(first.landCover.code,null);assert.equal(first.soilCarbonPercent,null);
  assert.equal(first.interpretation.eligible,false);assert.equal(first.interpretation.reason,'status-unavailable');
  const agreement=compareDegradationMethods(first,second);
  assert.equal(agreement.status,'unavailable');assert.equal(agreement.group,'unavailable');assert.equal(agreement.sdg,'unavailable');
});
test('masked or invalid status suppresses derived interpretations even when sub-indicators look valid',()=>{
  for(const status of [DEGRADATION_NODATA,8,0]){
    const values=Array(14).fill(0);values[9]=-1;values[10]=5;values[11]=1;values[12]=-12;values[13]=status;
    const result=decodeDegradationPoint(values,meta,manifest,null);
    assert.equal(result.bands[9],-1);assert.equal(result.bands[10],5);assert.equal(result.bands[11],1);assert.equal(result.bands[12],-12);
    assert.equal(result.sdg.code,null);assert.equal(result.productivity.code,null);assert.equal(result.landCover.code,null);assert.equal(result.soilCarbonPercent,null);
    assert.equal(result.interpretation.eligible,false);
  }
});
test('SDG comparison independently requires valid status and valid ternary indicators',()=>{
  const valid={status:{code:4,group:'stable'},sdg:{code:0}};
  for(const code of [null,undefined,0,8])assert.equal(compareDegradationMethods(valid,{status:{code},sdg:{code:0}}).sdg,'unavailable');
  assert.equal(compareDegradationMethods(valid,{status:{code:4,group:'stable'},sdg:{code:2}}).sdg,'unavailable');
  assert.equal(compareDegradationMethods(valid,valid).sdg,'same');
});
test('dateline bounds remain continuous without taking a 340-degree window',()=>{
  assert.deepEqual(normalizeDegradationBounds([170,-10,-170,10]),[170,-10,190,10]);
  assert.deepEqual(normalizeDegradationBounds({west:-190,south:-100,east:190,north:100}),[-180,-90,180,90]);
});
test('Web Mercator center rows sample projected latitude rather than arithmetic latitude',()=>{
  const rows=degradationGridRowLatitudes([-10,40,10,80],1);
  const expected=2*Math.atan(Math.sqrt(Math.tan(Math.PI/4+40*Math.PI/360)*Math.tan(Math.PI/4+80*Math.PI/360)))*180/Math.PI-90;
  assert.ok(Math.abs(rows[0]-expected)<1e-10);
  assert.ok(rows[0]>67&&rows[0]<68);assert.notEqual(rows[0],60);
  assert.deepEqual(degradationGridRowLatitudes([-10,40,10,80],1,'EPSG:4326'),[60]);
  const symmetric=degradationGridRowLatitudes([-180,-80,180,80],3);assert.ok(Math.abs(symmetric[1])<1e-10);
});
test('display overview selection chooses a source level without interpolating class codes',()=>{
  const images=[0.01,0.02,0.04,0.08].map((resolution,index)=>({index,resolutionDegrees:[resolution,resolution]}));
  assert.equal(selectDegradationOverview(images,[0,0,8,8],192,128).index,2);
  assert.equal(selectDegradationOverview(images,[0,0,0.1,0.1],192,128).index,0);
});

function fakeDecoder({jrcFails=false,invalidCrs=false}={}){
  const reads=[];
  const decoder={async fromCustomClient(client,options){
    assert.equal(options.allowFullFile,false);assert.equal(options.maxRanges,0);assert.equal(options.cacheSize*options.blockSize,4*1024*1024);
    if(jrcFails&&client.url.endsWith('/jrc'))throw new Error('JRC unavailable');
    const provider=client.url.endsWith('/jrc')?'jrc':'te';
    const image=index=>({getGeoKeys:()=>({GeographicTypeGeoKey:invalidCrs?3857:4326}),getOrigin:()=>[-180,90,0],getResolution:()=>[1+index,-1-index,0],
      getSamplesPerPixel:()=>14,getGDALNoData:()=>DEGRADATION_NODATA,getSampleFormat:()=>2,getWidth:()=>360/(1+index),getHeight:()=>180/(1+index),
      getBoundingBox:()=>[-180,-90,180,90],getTileWidth:()=>512,getTileHeight:()=>512,
      async readRasters({window,samples,signal}){
        if(signal?.aborted)throw signal.reason;reads.push({provider,index,window,samples});
        const [left,top,right,bottom]=window,out=[];
        for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)for(const band of samples){
          out.push(band===13?(provider==='jrc'?4:y*(1+index)<30?1:7):band===10?4:band===12?-5:0);
        }
        return Int16Array.from(out);
      }});
    return {getImage:async index=>image(index??0),getImageCount:async()=>2};
  }};return {decoder,reads};
}
test('reader samples all14 native bands but only the two comparable JRC bands',async()=>{
  const fixture=fakeDecoder(),reader=createDegradationReader({manifest,decoder:fixture.decoder});
  const result=await reader.sampleDegradation(20.25,60.25);
  assert.equal(result.primary.status.code,1);assert.equal(result.comparison.status.code,4);
  assert.equal(result.primary.soilCarbonPercent,-5);assert.equal(result.desertificationConfirmed,false);
  assert.equal(fixture.reads[0].index,0);assert.equal(fixture.reads[0].samples.length,14);assert.deepEqual(fixture.reads[1].samples,[9,13]);
  assert.deepEqual(result.primary.pixelBounds,[20,60,21,61]);
});
test('grid values follow Mercator row centers and nearest native categorical pixels',async()=>{
  const fixture=fakeDecoder(),reader=createDegradationReader({manifest,decoder:fixture.decoder});
  const grid=await reader.readDegradationGrid([-10,40,10,80],{width:16,height:16});
  assert.equal(grid.projection,'EPSG:3857');assert.equal(grid.overviewIndex,0);
  const rows=degradationGridRowLatitudes(grid.bounds,16);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.equal(grid.values[y*16+x],Math.floor(90-rows[y])<30?1:7);
  assert.deepEqual(grid.coordinates,[[-10,80],[10,80],[10,40],[-10,40]]);
  assert.ok(fixture.reads.every(read=>read.samples.length===1&&read.samples[0]===13));
});
test('a failed comparison preserves the real primary sample and reports the failure',async()=>{
  const fixture=fakeDecoder({jrcFails:true}),reader=createDegradationReader({manifest,decoder:fixture.decoder});
  const result=await reader.sampleDegradation(20,60);
  assert.ok(result.primary.status.code);assert.equal(result.comparison,null);assert.equal(result.errors[0].provider,'jrc');
});
test('an unexpected source projection fails closed rather than plotting misplaced classifications',async()=>{
  const fixture=fakeDecoder({invalidCrs:true}),reader=createDegradationReader({manifest,decoder:fixture.decoder});
  await assert.rejects(reader.loadDegradation(),/좌표계/);assert.equal(fixture.reads.length,0);
});
test('GeoTIFF generic aggregates preserve the strict clients underlying HTTP error',async()=>{
  let cancelled=0,read=0;
  const decoder={async fromCustomClient(client){
    try{await client.request({headers:{Range:'bytes=0-3'}});}
    catch{throw new AggregateError([],'Request failed');}
  }};
  const fetchImpl=async()=>({status:503,body:{cancel:async()=>{cancelled++;}},arrayBuffer:async()=>{read++;}});
  const reader=createDegradationReader({manifest,decoder,fetchImpl});
  await assert.rejects(reader.loadDegradation(),/응답 503/);
  assert.equal(cancelled,1);assert.equal(read,0);
  await assert.rejects(reader.loadDegradation(),/응답 503/);
  assert.equal(cancelled,2,'failed readers must not poison subsequent retries');
});
test('a provider timeout remains a TimeoutError even if GeoTIFF masks the aborted block',async()=>{
  const decoder={async fromCustomClient(client,options,signal){
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new AggregateError([],'Request failed')),{once:true}));
  }};
  const reader=createDegradationReader({manifest,decoder});
  await assert.rejects(reader.loadDegradation({timeoutMs:100}),{name:'TimeoutError'});
});
