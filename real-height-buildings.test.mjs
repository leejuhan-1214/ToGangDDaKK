import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingBounds,convertBuildings,heightMeters} from './live-buildings.js';
import {createRealHeightBuildings,REAL_HEIGHT_LAYER,REAL_HEIGHT_SOURCE} from './real-height-buildings.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
const feature=(height=30)=>({type:'FeatureCollection',features:[{type:'Feature',properties:{height,base:5},geometry:{type:'Polygon',coordinates:[[[0,0],[.001,0],[.001,.001],[0,0]]]}}]});

function fakeMap(){
 const handlers=new Map(),sources=new Map(),layers=new Map();
 const map={
  zoom:14,bounds:[126.99,37.55,127.01,37.57],handlers,sources,layers,
  isStyleLoaded:()=>true,
  getStyle:()=>({layers:[{id:'labels',type:'symbol'}]}),
  getLayer:id=>layers.get(id),
  addSource(id,definition){const source={...definition,setData(data){this.data=data;}};sources.set(id,source);},
  getSource:id=>sources.get(id),
  addLayer(layer,before){layers.set(layer.id,{...layer,before});},
  setLayoutProperty(id,key,value){layers.get(id).layout[key]=value;},
  getZoom(){return this.zoom;},
  getBounds(){const [w,s,e,n]=this.bounds;return {getWest:()=>w,getSouth:()=>s,getEast:()=>e,getNorth:()=>n};},
  on(name,handler){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);},
  once(name,handler){this.on(name,handler);},
  off(name,handler){handlers.get(name)?.delete(handler);},
  fire(name){for(const handler of handlers.get(name)||[])handler();}
 };
 return map;
}

test('XY5 converter uses only tagged heights and keeps min_height as extrusion base',()=>{
 const ring=[{lon:127,lat:37.55},{lon:127.001,lat:37.55},{lon:127.001,lat:37.551},{lon:127,lat:37.55}];
 const make=(id,tags)=>({type:'way',id,tags,geometry:ring});
 const result=convertBuildings({elements:[
  make(1,{building:'yes',height:'30',min_height:'5'}),
  make(2,{building:'yes',height:'35 ft'}),
  make(3,{building:'yes','building:levels':'12'}),
  make(4,{building:'yes',height:'unknown'})
 ]});
 assert.equal(result.features.length,2);
 assert.equal(result.features[0].properties.height,30);
 assert.equal(result.features[0].properties.base,5);
 assert.equal(result.features[1].properties.height,35*0.3048);
 assert.equal(heightMeters('3 floors'),null);
 assert.equal(buildingBounds([0,0,10,10]),null);
});

test('map layer loads visible bounds, ignores stale responses, and clears on zoom-out',async()=>{
 const map=fakeMap(),statuses=[],pending=[];
 map.layers.set('point-halo',{id:'point-halo'});
 const control=createRealHeightBuildings({map,onStatus:s=>statuses.push(s),delay:0,fetcher:(bounds,signal)=>new Promise(resolve=>pending.push({bounds,signal,resolve}))});
 await tick();
 assert.equal(pending.length,1);
 assert.equal(map.layers.get(REAL_HEIGHT_LAYER).type,'fill-extrusion');
 assert.equal(map.layers.get(REAL_HEIGHT_LAYER).before,'point-halo');
 assert.deepEqual(map.layers.get(REAL_HEIGHT_LAYER).paint['fill-extrusion-height'],['get','height']);
 assert.deepEqual(map.layers.get(REAL_HEIGHT_LAYER).paint['fill-extrusion-base'],['get','base']);
 map.fire('movestart');
 assert.equal(pending[0].signal.aborted,true);
 map.bounds=[127.01,37.55,127.03,37.57];
 map.fire('moveend');
 await tick();
 assert.equal(pending.length,2);
 pending[0].resolve(feature(99));
 await tick();
 assert.equal(map.sources.get(REAL_HEIGHT_SOURCE).data.features.length,0);
 pending[1].resolve(feature(30));
 await tick();
 assert.equal(map.sources.get(REAL_HEIGHT_SOURCE).data.features[0].properties.height,30);
 assert.equal(statuses.at(-1).count,1);
 map.fire('movestart');
 map.zoom=12;
 map.fire('moveend');
 await tick();
 assert.equal(map.sources.get(REAL_HEIGHT_SOURCE).data.features.length,0);
 assert.equal(statuses.at(-1).state,'zoom');
 control.dispose();
});

test('building switch stops requests and leaves an explicit off state',async()=>{
 const map=fakeMap(),statuses=[];
 map.layers.set('point-halo',{id:'point-halo'});
 const control=createRealHeightBuildings({map,onStatus:s=>statuses.push(s),enabled:false,delay:0,fetcher:()=>{throw Error('should not query');}});
 await tick();
 assert.equal(statuses.at(-1).state,'off');
 assert.equal(map.layers.get(REAL_HEIGHT_LAYER).layout.visibility,'none');
 control.dispose();
});
