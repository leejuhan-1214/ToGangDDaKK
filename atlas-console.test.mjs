import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCoordinates,searchLocalPlaces,greatCircleDistanceKm,greatCircleGeometry,parsePhotonResults,cameraShareURL,createAtlasConsole} from './atlas-console.mjs';

test('coordinates accept latitude-first decimal and hemisphere notation without silently swapping axes',()=>{
 assert.deepEqual(parseCoordinates('37.55, 127.6'),[127.6,37.55]);
 assert.deepEqual(parseCoordinates('37.55° N, 127.6° E'),[127.6,37.55]);
 assert.deepEqual(parseCoordinates('33.9 S 18.4 E'),[18.4,-33.9]);
 assert.deepEqual(parseCoordinates('-3.119 -60.0217'),[-60.0217,-3.119]);
 assert.deepEqual(parseCoordinates('0,0'),[0,0]);
 for(const value of ['127.6,37.55','86,0','37,181','NaN,127','37,','-37 N,127 E','37 E,127 N','서울','1e2,1','37,127<script>'])assert.equal(parseCoordinates(value),null,value);
});

test('local place search is multilingual, token-based, bounded and leaves shared coordinates untouched',()=>{
 assert.equal(searchLocalPlaces('seoul')[0].name,'서울');assert.equal(searchLocalPlaces('몽골 고비')[0].name,'고비 전이지대');
 assert.equal(searchLocalPlaces('not a real place').length,0);assert.equal(searchLocalPlaces('').length,5);
 const first=searchLocalPlaces('seoul');first[0].coordinate[0]=0;assert.equal(searchLocalPlaces('seoul')[0].coordinate[0],126.978);
});

test('great-circle distance handles identical points, known quarter circumference and date-line crossing',()=>{
 assert.equal(greatCircleDistanceKm([0,0],[0,0]),0);
 assert.ok(Math.abs(greatCircleDistanceKm([0,0],[90,0])-10007.5572)<.001);
 assert.ok(Math.abs(greatCircleDistanceKm([179,0],[-179,0])-222.39016)<.001);
 assert.ok(Math.abs(greatCircleDistanceKm([0,0],[180,0])-20015.11444)<.001);
 assert.throws(()=>greatCircleDistanceKm([181,0],[0,0]),RangeError);
});

test('measurement arc is split at the date line and never draws a spurious world-spanning segment',()=>{
 const geometry=greatCircleGeometry([179,20],[-179,20]);assert.equal(geometry.type,'MultiLineString');
 for(const line of geometry.coordinates)for(let i=1;i<line.length;i++)assert.ok(Math.abs(line[i][0]-line[i-1][0])<=180);
 const edge=geometry.coordinates[0].at(-1),opposite=geometry.coordinates[1][0];assert.equal(edge[0],180);assert.equal(opposite[0],-180);assert.equal(edge[1],opposite[1]);
 assert.ok(edge[1]>20,'shortest spherical arc bends poleward');
});

test('identical and antipodal arcs remain finite instead of dividing by a near-zero sine',()=>{
 for(const pair of [[[0,0],[180,0]],[[0,90],[0,-90]],[[7,45],[7,45]]]){
  const geometry=greatCircleGeometry(...pair);const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
  assert.ok(lines.flat().every(point=>point.every(Number.isFinite)));assert.deepEqual(lines[0][0],pair[0]);assert.deepEqual(lines.at(-1).at(-1),pair[1]);
 }
});

test('remote geocoding excludes malformed and unmappable coordinates, deduplicates and preserves plain text',()=>{
 const feature=(coordinate,name='City')=>({geometry:{type:'Point',coordinates:coordinate},properties:{name,city:'City',country:'Country',type:'city'}});
 const results=parsePhotonResults({features:[feature([127,37],'<img onerror=alert(1)>'),feature([127,37],'<img onerror=alert(1)>'),feature([127,89]),feature([null,37]),feature([0,0],'Ocean place')]});
 assert.equal(results.length,2);assert.equal(results[0].name,'<img onerror=alert(1)>');assert.equal(results[0].source,'Photon · © OpenStreetMap');assert.deepEqual(results[1].coordinate,[0,0]);
 assert.throws(()=>parsePhotonResults({error:'unavailable'}),TypeError);
});

test('shared camera URL preserves deployment version and encodes the actual view including wraparound',()=>{
 const url=new URL(cameraShareURL('https://example.org/app/?v=abc',{lng:487.6,lat:37.55,zoom:13.125,bearing:-25,pitch:65},{night:true,quality:false,overlay:true,shade:false,opacity:30}));
 assert.equal(url.searchParams.get('v'),'abc');assert.equal(url.searchParams.get('camera'),'127.60000,37.55000,13.13,-25.0,65.0');
 assert.equal(url.searchParams.get('night'),'1');assert.equal(url.searchParams.get('quality'),'0');assert.equal(url.searchParams.get('overlay'),'1');assert.equal(url.searchParams.get('shade'),'0');assert.equal(url.searchParams.get('opacity'),'30');
 assert.throws(()=>cameraShareURL('https://example.org',{lng:0,lat:0,zoom:23,bearing:0,pitch:0}),RangeError);
 const globe=new URL(cameraShareURL('https://example.org/app/',{lng:20,lat:18,zoom:1.5,bearing:0,pitch:0},{terrain:true}));
 assert.equal(globe.searchParams.get('terrain'),'1','a level camera can still have measured 3D terrain enabled');
});

function fixture(){
 class Element extends EventTarget {
  constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.style={cursor:''};this.dataset={};this.attributes={};this.children=[];this.value='';this.open=false;this.textContent='';const values=new Set();this.classList={toggle(name,force){const active=force??!values.has(name);active?values.add(name):values.delete(name);return active;},remove(...names){names.forEach(name=>values.delete(name));},contains:name=>values.has(name)};}
  setAttribute(name,value){this.attributes[name]=String(value);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  focus(){}
  closest(selector){if(selector.includes('input')&&['INPUT','TEXTAREA','SELECT'].includes(this.tagName))return this;if(selector==='button[data-search-index]'&&this.dataset.searchIndex!==undefined)return this;return null;}
 }
 const elements=new Map(),ids=['console-clock','console-camera','console-cursor','console-notice','console-search-trigger','console-search-close','console-search-form','console-search-input','console-search-results','console-search-status','console-search-dialog','console-measure-trigger','console-measure-value','console-focus-trigger','console-night-trigger','console-share-trigger','console-shortcuts-trigger','console-shortcuts-dialog','console-shortcuts-close'];
 for(const id of ids)elements.set(id,new Element(id==='console-search-input'?'input':'div'));
 const doc=new EventTarget();doc.body=new Element();doc.getElementById=id=>elements.get(id)||null;doc.createElement=tag=>new Element(tag);doc.querySelector=selector=>selector==='dialog[open]'?[...elements].find(([id,element])=>id.endsWith('-dialog')&&element.open)?.[1]||null:null;
 const canvas=new Element(),events=new Map(),sources=new Map(),layers=new Map([['satellite',{id:'satellite'}]]),paint=new Map([['raster-saturation',0],['raster-contrast',0]]);
 const map={getCanvas:()=>canvas,getPaintProperty:(id,key)=>paint.get(key),setPaintProperty:(id,key,value)=>paint.set(key,value),getCenter:()=>({lng:127,lat:37}),getZoom:()=>12,getBearing:()=>-25,getPitch:()=>60,on(event,callback){if(!events.has(event))events.set(event,new Set());events.get(event).add(callback);},off(event,callback){events.get(event)?.delete(callback);},getSource:id=>sources.get(id),addSource(id,spec){sources.set(id,{data:spec.data,setData(value){this.data=value;}});},removeSource:id=>sources.delete(id),getLayer:id=>layers.get(id),addLayer:layer=>layers.set(layer.id,layer),removeLayer:id=>layers.delete(id)};
 const frames=new Map();let nextFrame=0;const previous=new Map();
 for(const [name,value] of Object.entries({document:doc,requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id)})){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});}
 return {doc,map,paint,sources,layers,canvas,events,element:id=>elements.get(id),click:id=>elements.get(id).dispatchEvent(new Event('click')),key(key,target=doc){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:key});if(target!==doc)Object.defineProperty(event,'target',{value:target});doc.dispatchEvent(event);return event;},move(lng,lat){events.get('mousemove')?.forEach(callback=>callback({lngLat:{lng,lat}}));},flushFrames(){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());},restore(){for(const [name,descriptor] of previous)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('measurement consumes only active map clicks, resets on the third point, and survives a queued cursor update',()=>{
 const f=fixture(),changes=[];let controller;
 try{
  controller=createAtlasConsole({map:f.map,onMeasureChange:active=>changes.push(active)});
  assert.equal(controller.handleMapClick({lngLat:{lng:0,lat:0}}),false);
  f.click('console-measure-trigger');assert.equal(f.canvas.style.cursor,'crosshair');
  assert.equal(controller.handleMapClick({lngLat:{lng:179,lat:0}}),true);
  f.move(-179,0);controller.handleMapClick({lngLat:{lng:-179,lat:0}});f.flushFrames();
  const data=f.sources.get('console-measure').data;assert.equal(data.features.length,3);assert.equal(data.features[0].geometry.type,'MultiLineString');assert.match(f.element('console-measure-value').textContent,/222\.39 km/);
  controller.handleMapClick({lngLat:{lng:1,lat:2}});assert.equal(f.sources.get('console-measure').data.features.length,1);
  f.key('Escape');assert.deepEqual(changes,[true,false]);assert.equal(f.canvas.style.cursor,'');assert.equal(controller.handleMapClick({lngLat:{lng:0,lat:0}}),false);
 }finally{controller?.dispose();assert.equal(f.sources.size,0);assert.ok([...f.events.values()].every(callbacks=>callbacks.size===0));f.restore();}
});

test('low-light changes satellite display only and dispose restores the original paint and body state',()=>{
 const f=fixture();let controller;
 try{
  controller=createAtlasConsole({map:f.map,initialNight:true});assert.equal(f.paint.get('raster-brightness-max'),.62);assert.equal(f.paint.get('raster-saturation'),-.45);assert.equal(f.sources.size,0);
  f.click('console-focus-trigger');assert.equal(f.doc.body.classList.contains('console-focus'),true);
  controller.dispose();assert.equal(f.paint.get('raster-saturation'),0);assert.equal(f.paint.get('raster-brightness-max'),null);assert.equal(f.doc.body.classList.contains('console-night'),false);assert.equal(f.doc.body.classList.contains('console-focus'),false);
 }finally{controller?.dispose();f.restore();}
});

test('keyboard shortcuts do not hijack text inputs or open dialogs; O only invokes the orbit callback',()=>{
 const f=fixture(),calls=[];let controller;
 try{
  controller=createAtlasConsole({map:f.map,onOrbit:()=>calls.push('orbit'),onTab:tab=>calls.push(tab)});
  f.key('O');f.key('3');assert.deepEqual(calls,['orbit','verify']);
  f.key('O',f.element('console-search-input'));assert.equal(calls.length,2);
  f.key('/');assert.equal(f.element('console-search-dialog').open,true);f.key('O');f.key('1');assert.equal(calls.length,2);
 }finally{controller?.dispose();f.restore();}
});

test('search typing remains local and stale remote results cannot replace the next input',async()=>{
 const f=fixture(),requests=[];let finish,controller;
 try{
  controller=createAtlasConsole({map:f.map,fetchImpl:(url,options)=>{requests.push({url,options});return new Promise(resolve=>finish=resolve);}});
  f.click('console-search-trigger');const input=f.element('console-search-input');input.value='London';input.dispatchEvent(new Event('input'));assert.equal(requests.length,0);
  f.element('console-search-form').dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).searchParams.get('q'),'London');
  input.value='서울';input.dispatchEvent(new Event('input'));assert.equal(requests[0].options.signal.aborted,true);assert.equal(f.element('console-search-results').children[0].children[0].textContent,'서울');
  finish(new Response(JSON.stringify({features:[{geometry:{type:'Point',coordinates:[0,51]},properties:{name:'Stale London'}}]})));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.element('console-search-results').children[0].children[0].textContent,'서울');assert.equal(requests.length,1);
 }finally{controller?.dispose();f.restore();}
});
