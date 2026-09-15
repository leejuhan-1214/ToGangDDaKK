import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TERRAIN_CATALOG_URL,createTerrainCoverageIndex,terrainNativeZoomLimit,ancestorTerrainTile,
  parseTerrainTileUrl,decodeTerrariumRgba,encodeTerrariumRgba,cropTerrainHeights,createTerrainProtocol} from './terrain-source.mjs';

const close=(actual,expected,tolerance=1/256)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value,arrayBuffer:async()=>new Uint8Array(value).buffer});
const emptyCatalog={items:[{name:'planet.pmtiles',min_zoom:0,max_zoom:12}]};
const catalogWith=(x,y,max_zoom)=>({items:[...emptyCatalog.items,{name:`6-${x}-${y}.pmtiles`,min_zoom:13,max_zoom}]});
const call=(handler,z,x,y,controller=new AbortController())=>handler({url:`terrain-dem://${z}/${x}/${y}`},controller);
const gridOf=fn=>({width:512,height:512,heights:Float32Array.from({length:512*512},(_,i)=>fn(i%512,Math.floor(i/512)))});
const trivialCodec={decodeTile:async()=>gridOf(()=>0),encodeTile:async()=>new Uint8Array([137,80,78,71]).buffer};

test('regional coverage honors archive limits without claiming global high resolution',()=>{
  const coverage=createTerrainCoverageIndex({items:[...catalogWith(33,22,18).items,
    {name:'6-34-22.pmtiles',max_zoom:14},{name:'6-80-90.pmtiles',max_zoom:18},{name:'untrusted.pmtiles',max_zoom:24}]});
  assert.equal(coverage.size,2);
  assert.equal(terrainNativeZoomLimit({z:18,x:33*4096+1,y:22*4096+1},coverage),18);
  assert.equal(terrainNativeZoomLimit({z:18,x:34*4096+1,y:22*4096+1},coverage),14);
  assert.equal(terrainNativeZoomLimit({z:18,x:55*4096,y:24*4096},coverage),12);
  assert.equal(terrainNativeZoomLimit({z:9,x:420,y:180},coverage),9);
  assert.equal(terrainNativeZoomLimit({z:18,x:120000,y:70000},null),12);
  assert.throws(()=>createTerrainCoverageIndex({}),TypeError);
});

test('tile parsing and parent geography reject invalid or mismatched coordinates',()=>{
  assert.deepEqual(parseTerrainTileUrl('terrain-dem://18/136861/92649.webp?v=abc'),{z:18,x:136861,y:92649});
  assert.deepEqual(ancestorTerrainTile({z:18,x:136861,y:92649},12),{z:12,x:2138,y:1447});
  for(const url of ['https://evil.example/18/1/1','terrain-dem://19/1/1','terrain-dem://2/4/0','terrain-dem://3/0/-1','terrain-dem://NaN/0/0'])assert.throws(()=>parseTerrainTileUrl(url),RangeError);
  assert.throws(()=>ancestorTerrainTile({z:12,x:1,y:1},13),RangeError);
  assert.throws(()=>cropTerrainHeights({width:1,height:1,heights:[0]},{z:1,x:0,y:0},{z:2,x:3,y:3}),RangeError);
});

test('Terrarium round trips real sea level, negative basin and mountain heights across RGB carries',()=>{
  const source=[-432,0,255.99609375,256,256.00390625,8711,-32768,32767.99609375];
  const decoded=decodeTerrariumRgba(encodeTerrariumRgba(source));
  assert.deepEqual([...decoded],source);
  assert.throws(()=>decodeTerrariumRgba(new Uint8Array([128,0,0,0])),/unavailable/);
  assert.throws(()=>encodeTerrariumRgba([NaN]),RangeError);
});

test('child interpolation uses metre values through Terrarium channel rollover',()=>{
  const heights=decodeTerrariumRgba(encodeTerrariumRgba([255,257,255,257]));
  const child=cropTerrainHeights({width:2,height:2,heights},{z:0,x:0,y:0},{z:0,x:0,y:0},3);
  close(child[1],256);
  close(decodeTerrariumRgba(encodeTerrariumRgba(child))[1],256);
  assert.ok([...child].every(h=>h>=255&&h<=257),'interpolation cannot invent a peak beyond the measured samples');
});

test('cropping preserves the exact southeast child footprint and adjacent child continuity',()=>{
  const heights=Float32Array.from({length:16},(_,i)=>(i%4)+Math.floor(i/4)*10);
  const grid={width:4,height:4,heights},parent={z:1,x:0,y:1};
  const southeast=cropTerrainHeights(grid,parent,{z:2,x:1,y:3},2);
  assert.deepEqual([...southeast],[22,23,32,33]);
  const left=cropTerrainHeights(grid,parent,{z:2,x:0,y:2},4);
  const right=cropTerrainHeights(grid,parent,{z:2,x:1,y:2},4);
  close(right[0]-left[3],0.5);
  close(right[4]-left[7],0.5);
});

test('overzoom leaves all-ocean zeros and a real below-sea-level surface unchanged',()=>{
  for(const height of [0,-432]) {
    const grid={width:2,height:2,heights:new Float32Array(4).fill(height)};
    const result=cropTerrainHeights(grid,{z:12,x:100,y:200},{z:18,x:6401,y:12802});
    assert.ok(result.every(value=>value===height));
    assert.ok(decodeTerrariumRgba(encodeTerrariumRgba(result)).every(value=>value===height));
  }
});

test('low zoom bypasses catalog and codecs, and transferred result cannot detach the cache',async()=>{
  const urls=[],events=[];
  const handler=createTerrainProtocol({fetchImpl:async url=>{urls.push(url);return response([1,2,3]);},onTile:event=>events.push(event),decodeTile:()=>{throw Error('must not decode');},encodeTile:()=>{throw Error('must not encode');}});
  try {
    const first=await call(handler,9,376,373);
    structuredClone(first.data,{transfer:[first.data]});
    assert.equal(first.data.byteLength,0);
    const second=await call(handler,9,376,373);
    assert.deepEqual([...new Uint8Array(second.data)],[1,2,3]);
    assert.deepEqual(urls,['https://tiles.mapterhorn.com/9/376/373.webp']);
    assert.equal(events[0].nativeZoom,9);assert.equal(events[0].overzoomed,false);
    assert.equal(events[0].x,376);assert.equal(events[0].y,373);
  } finally {handler.dispose();}
});

test('outside regional coverage requests only global parent and reports interpolation honestly',async()=>{
  const urls=[],events=[];
  let encoded;
  const handler=createTerrainProtocol({fetchImpl:async url=>{urls.push(url);return response(url===TERRAIN_CATALOG_URL?emptyCatalog:[1]);},
    onTile:event=>events.push(event),decodeTile:async()=>gridOf((x,y)=>x+10*y),encodeTile:async values=>{encoded=values;return new ArrayBuffer(1);}});
  try {
    await call(handler,18,136861,92649);
    assert.deepEqual(urls,[TERRAIN_CATALOG_URL,'https://tiles.mapterhorn.com/12/2138/1447.webp']);
    assert.equal(events[0].nativeZoom,12);assert.equal(events[0].overzoomed,true);
    assert.equal(events[0].catalogAvailable,true);
    // Child x offset29, y offset41 of64; pixel-centre positions are231.5078125 and327.5078125.
    close(encoded[0],231.5078125+327.5078125*10);
    await call(handler,18,136862,92649);
    assert.equal(urls.length,2,'catalog and decoded parent are reused across children');
  } finally {handler.dispose();}
});

test('regional high resolution is returned intact; absent finer tile uses correct cached parent',async()=>{
  const urls=[],events=[];
  const handler=createTerrainProtocol({...trivialCodec,fetchImpl:async url=>{
    urls.push(url);
    if(url===TERRAIN_CATALOG_URL)return response(catalogWith(33,22,18));
    return url.includes('/18/')?response([],404):response([10,20,30]);
  },onTile:event=>events.push(event)});
  try {
    const original=await call(handler,17,68430,46324);
    assert.deepEqual([...new Uint8Array(original.data)],[10,20,30]);
    assert.equal(events[0].nativeZoom,17);assert.equal(events[0].overzoomed,false);
    await call(handler,18,136861,92649);
    await call(handler,18,136861,92649);
    assert.equal(urls.filter(url=>url.includes('/18/')).length,1,'404 tiles have a bounded negative cache');
    assert.equal(events.at(-1).nativeZoom,17);assert.equal(events.at(-1).overzoomed,true);
    assert.equal(events.at(-1).fallbackReason,'tile-unavailable');
  } finally {handler.dispose();}
});

test('catalog failure falls back once to global measured DEM, never arbitrary elevations',async()=>{
  const urls=[],events=[];
  const handler=createTerrainProtocol({...trivialCodec,fetchImpl:async url=>{urls.push(url);if(url===TERRAIN_CATALOG_URL)throw Error('offline catalog');return response([1]);},onTile:event=>events.push(event)});
  try {
    await call(handler,18,136861,92649);await call(handler,18,136862,92649);
    assert.equal(urls.filter(url=>url===TERRAIN_CATALOG_URL).length,1);
    assert.equal(urls.filter(url=>url.includes('/18/')).length,0);
    assert.equal(events[0].nativeZoom,12);assert.equal(events[0].catalogAvailable,false);
    assert.equal(events[0].fallbackReason,'catalog-unavailable');
  } finally {handler.dispose();}
});

test('a temporary high-resolution error tries global parent without poisoning missing-tile cache',async()=>{
  const urls=[],events=[];
  const handler=createTerrainProtocol({...trivialCodec,fetchImpl:async url=>{urls.push(url);if(url===TERRAIN_CATALOG_URL)return response(catalogWith(33,22,18));return url.includes('/18/')?response([],503):response([1]);},onTile:event=>events.push(event)});
  try {
    await call(handler,18,136861,92649);await call(handler,18,136861,92649);
    assert.equal(urls.filter(url=>url.includes('/18/')).length,2);
    assert.ok(!urls.some(url=>/\/1[3-7]\//.test(url)),'transient provider failure does not fan out through every high zoom');
    assert.equal(events[0].nativeZoom,12);assert.equal(events[0].fallbackReason,'source-unavailable');
  } finally {handler.dispose();}
});

test('complete elevation outage is an error, never a fabricated flat ocean',async()=>{
  const events=[];
  const handler=createTerrainProtocol({fetchImpl:async()=>response([],503),onTile:event=>events.push(event)});
  try {await assert.rejects(call(handler,9,1,1),/503/);assert.equal(events.length,0);}
  finally {handler.dispose();}
});

test('network concurrency is at most four and aborted queued requests never reach the provider',async()=>{
  let active=0,maximum=0;
  const started=[],releases=[];
  const handler=createTerrainProtocol({fetchImpl:(url,{signal})=>new Promise((resolve,reject)=>{
    started.push(url);active++;maximum=Math.max(maximum,active);
    let done=false;
    const finish=(error)=>{if(done)return;done=true;active--;signal.removeEventListener('abort',abort);error?reject(error):resolve(response([1]));};
    const abort=()=>finish(new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});releases.push(()=>finish());
  })});
  try {
    const controllers=Array.from({length:8},()=>new AbortController());
    const requests=controllers.map((controller,i)=>call(handler,9,i,0,controller));
    const settled=Promise.allSettled(requests);
    await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(started.length,4);
    controllers[7].abort();
    for(let i=0;i<8;i++){releases.splice(0).forEach(release=>release());await new Promise(resolve=>setTimeout(resolve,1));}
    const results=await settled;
    assert.equal(maximum,4);assert.equal(started.length,7);
    assert.equal(results[7].status,'rejected');assert.equal(results[7].reason.name,'AbortError');
  } finally {handler.dispose();}
});

test('one cancelled consumer does not cancel a shared native request needed by another',async()=>{
  let release,requests=0,upstreamAborted=false;
  const handler=createTerrainProtocol({fetchImpl:async(url,{signal})=>{
    requests++;signal.addEventListener('abort',()=>{upstreamAborted=true;},{once:true});
    return new Promise(resolve=>{release=()=>resolve(response([1,2]));});
  }});
  try {
    const controller=new AbortController();
    const first=call(handler,9,1,1,controller),second=call(handler,9,1,1);
    const rejected=assert.rejects(first,{name:'AbortError'});
    await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await rejected;
    assert.equal(upstreamAborted,false);release();
    assert.equal((await second).data.byteLength,2);assert.equal(requests,1);
  } finally {handler.dispose();}
});

test('disposal aborts active fetches, clears pending work and rejects further use',async()=>{
  let aborted=false;
  const handler=createTerrainProtocol({fetchImpl:(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});
  })});
  const pending=call(handler,9,1,1);
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await new Promise(resolve=>setTimeout(resolve,1));handler.dispose();await rejected;
  assert.equal(aborted,true);
  await assert.rejects(call(handler,9,1,1),{name:'AbortError'});
});

test('an immediate retry cannot attach to an abandoned request whose abort is still settling',async()=>{
  let requests=0;
  const handler=createTerrainProtocol({fetchImpl:(url,{signal})=>{
    requests++;
    if(requests>1)return Promise.resolve(response([7]));
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{
      setTimeout(()=>reject(new DOMException('Aborted','AbortError')),10);
    },{once:true}));
  }});
  try {
    const controller=new AbortController(),first=call(handler,9,1,1,controller);
    const rejected=assert.rejects(first,{name:'AbortError'});
    await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await rejected;
    const retry=await call(handler,9,1,1);
    assert.deepEqual([...new Uint8Array(retry.data)],[7]);assert.equal(requests,2);
  } finally {handler.dispose();}
});

test('raw tile cache evicts older entries instead of retaining an unbounded browsing history',async()=>{
  let requests=0;
  const handler=createTerrainProtocol({fetchImpl:async()=>{requests++;return response([1]);}});
  try {
    for(let x=0;x<34;x++)await call(handler,9,x,1);
    await call(handler,9,0,1);
    assert.equal(requests,35);
  } finally {handler.dispose();}
});
