import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImageryURL,tilePresence,parentCrop,resolveImageryTile,createImageryProtocol} from './imagery-source.mjs';
test('deep zoom tile URLs are bounded to the real world and two display modes',()=>{
 assert.deepEqual(parseImageryURL('land15-imagery://enhanced/23/5/6'),{mode:'enhanced',z:23,x:5,y:6});
 for(const value of ['land15-imagery://enhanced/24/0/0','land15-imagery://original/1/2/0','https://example.com/1','land15-imagery://fake/1/0/0'])assert.throws(()=>parseImageryURL(value));
});
test('availability uses returned row-major bounds and never treats unknown data as coverage',()=>{
 const result={location:{left:8,top:16,width:2,height:2},data:[1,0,0,1]};
 assert.equal(tilePresence(result,9,17),true);assert.equal(tilePresence(result,9,16),false);
 assert.equal(tilePresence({error:{code:422}},0,0),false);
 assert.throws(()=>tilePresence(result,10,17));assert.throws(()=>tilePresence({...result,data:[1]},8,16));assert.throws(()=>tilePresence({error:{code:500}},0,0));
});
test('missing native imagery uses the geographically correct parent quadrant at extreme zoom',async()=>{
 const tile={z:22,x:56789,y:12345};const crop=parentCrop(tile,17);
 assert.deepEqual(crop,{x:1774,y:385,sx:168,sy:200,span:8});
 const levels=[];const native=await resolveImageryTile(tile,async(z)=>{levels.push(z);return z===17;});
 assert.equal(native.z,17);assert.deepEqual(levels,[22,21,20,19,18,17]);
});
test('unavailable and aborted imagery never fabricate a successful tile',async()=>{
 await assert.rejects(resolveImageryTile({z:2,x:0,y:0},async()=>false),/No verified/);
 const controller=new AbortController();controller.abort();await assert.rejects(resolveImageryTile({z:2,x:0,y:0},async()=>true,{signal:controller.signal}),{name:'AbortError'});
});
test('protocol checks coverage before fetching and shares parent imagery across display modes',async()=>{
 const calls=[],events=[];
 const protocol=createImageryProtocol({fetchImpl:async url=>{calls.push(url);if(url.includes('/tilemap/')){const z=Number(url.split('/tilemap/')[1].split('/')[0]);return new Response(JSON.stringify(z>1?{error:{code:422}}:{location:{left:0,top:0,width:2,height:2},data:[1,1,1,1]}),{headers:{'Content-Type':'application/json'}});}return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});},renderTile:async(blob,tile,native)=>{assert.equal(native.z,1);return blob.arrayBuffer();},onTile:meta=>events.push(meta)});
 await protocol({url:'land15-imagery://enhanced/3/5/6'},new AbortController());
 await protocol({url:'land15-imagery://original/3/5/6'},new AbortController());
 assert.equal(calls.filter(url=>url.includes('/tile/')).length,1);assert.ok(calls.at(-1).endsWith('/tile/1/1/1'));assert.equal(events[0].overzoomed,true);protocol.dispose();
});

function availableResponse(url){
 const [,top,left,width,height]=url.split('/tilemap/')[1].split('?')[0].split('/').map(Number);
 return new Response(JSON.stringify({location:{top,left,width,height},data:Array(width*height).fill(1)}),{headers:{'Content-Type':'application/json'}});
}
const imageResponse=()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});

test('cancelling one shared consumer preserves the other consumer and its single image fetch',async()=>{
 let release,started,innerAborts=0,imageFetches=0,availabilityFetches=0;
 const began=new Promise(resolve=>started=resolve);
 const protocol=createImageryProtocol({fetchImpl:async(url,{signal})=>{
  if(url.includes('/tilemap/')){
   availabilityFetches++;signal.addEventListener('abort',()=>innerAborts++,{once:true});
   started();await new Promise(resolve=>release=resolve);return availableResponse(url);
  }
  imageFetches++;return imageResponse();
 },renderTile:blob=>blob.arrayBuffer()});
 try{
  const firstController=new AbortController(),secondController=new AbortController();
  const first=protocol({url:'land15-imagery://enhanced/15/0/0'},firstController);
  const rejected=assert.rejects(first,{name:'AbortError'});
  const second=protocol({url:'land15-imagery://original/15/0/0'},secondController);
  await began;firstController.abort();release();await rejected;
  assert.deepEqual(new Uint8Array((await second).data),new Uint8Array([1,2,3]));
  assert.equal(innerAborts,0);assert.equal(availabilityFetches,1);assert.equal(imageFetches,1);
 }finally{release?.();protocol.dispose();}
});

test('disposing while a tile renders prevents completion events and rejects later requests',async()=>{
 let finishRender,started;const began=new Promise(resolve=>started=resolve),events=[];
 const protocol=createImageryProtocol({fetchImpl:async url=>url.includes('/tilemap/')?availableResponse(url):imageResponse(),onTile:meta=>events.push(meta),renderTile:async()=>{
  started();return new Promise(resolve=>finishRender=()=>resolve(new ArrayBuffer(3)));
 }});
 const pending=protocol({url:'land15-imagery://enhanced/15/0/0'},new AbortController());
 const rejected=assert.rejects(pending,{name:'AbortError'});
 try{
  await began;protocol.dispose();finishRender();await rejected;
  assert.equal(events.length,0);
  await assert.rejects(protocol({url:'land15-imagery://original/15/0/0'},new AbortController()),{name:'AbortError'});
 }finally{finishRender?.();protocol.dispose();}
});

test('network work and image processing together stay within four active jobs',async()=>{
 let active=0,maximum=0,fetches=0,renders=0;
 const work=async result=>{
  active++;maximum=Math.max(maximum,active);
  try{await new Promise(resolve=>setTimeout(resolve,2));return result;}
  finally{active--;}
 };
 const protocol=createImageryProtocol({fetchImpl:async url=>{
  fetches++;return work(url.includes('/tilemap/')?availableResponse(url):imageResponse());
 },renderTile:async()=>{renders++;return work(new ArrayBuffer(3));}});
 try{
  const results=await Promise.all(Array.from({length:12},(_,index)=>protocol({url:`land15-imagery://enhanced/15/${index*8}/0`},new AbortController())));
  assert.equal(results.length,12);assert.equal(fetches,24);assert.equal(renders,12);
  assert.equal(maximum,4);assert.equal(active,0);
 }finally{protocol.dispose();}
});

test('aborting during bitmap decoding closes the decoded bitmap before rejection',async()=>{
 const previous=globalThis.createImageBitmap;
 let completeDecode,started,closed=0;const began=new Promise(resolve=>started=resolve);
 globalThis.createImageBitmap=()=>{started();return new Promise(resolve=>completeDecode=()=>resolve({width:256,height:256,close(){closed++;}}));};
 const protocol=createImageryProtocol({fetchImpl:async url=>url.includes('/tilemap/')?availableResponse(url):imageResponse()});
 const controller=new AbortController();
 const rejected=assert.rejects(protocol({url:'land15-imagery://enhanced/15/0/0'},controller),{name:'AbortError'});
 try{
  await began;controller.abort();completeDecode();await rejected;assert.equal(closed,1);
 }finally{
  completeDecode?.();protocol.dispose();
  if(previous===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previous;
 }
});
