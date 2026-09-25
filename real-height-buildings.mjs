import {buildingBounds,fetchBuildings,emptyBuildings} from './live-buildings.js';

export const REAL_HEIGHT_SOURCE='osm-real-height-buildings';
export const REAL_HEIGHT_LAYER='osm-real-height-3d';

export function createRealHeightBuildings({map,onStatus=()=>{},enabled=true,fetcher=fetchBuildings,delay=900}){
 let controller=null,timer=null,request=0,installed=false,disposed=false;
 const report=(state,detail={})=>onStatus({state,...detail});
 const clear=()=>map.getSource(REAL_HEIGHT_SOURCE)?.setData(emptyBuildings());
 const abort=()=>{controller?.abort();controller=null;request++;};
 function schedule(wait=delay){
  clearTimeout(timer);
  if(!disposed&&enabled)timer=setTimeout(update,wait);
 }
 async function update(){
  if(disposed||!installed||!enabled)return;
  abort();
  const box=map.getBounds();
  const bounds=buildingBounds([box.getWest(),box.getSouth(),box.getEast(),box.getNorth()]);
  if(map.getZoom()<13||!bounds){
   clear();
   report(map.getZoom()<13?'zoom':'extent');
   return;
  }
  const current=++request;
  controller=new AbortController();
  const signal=controller.signal;
  report('loading');
  try{
   const buildings=await fetcher(bounds,signal);
   if(disposed||signal.aborted||current!==request)return;
   map.getSource(REAL_HEIGHT_SOURCE)?.setData(buildings);
   report('ready',{count:buildings.features.length,timestamp:buildings.source?.timestamp||null});
  }catch(error){
   if(disposed||signal.aborted||current!==request)return;
   clear();
   report('error',{message:String(error?.message||error)});
  }finally{
   if(current===request)controller=null;
  }
 }
 function moveStart(){
  clearTimeout(timer);
  abort();
  if(enabled&&map.getZoom()>=13)report('moving');
 }
 const moveEnd=()=>schedule();
 function install(){
  if(disposed||installed)return;
  installed=true;
  map.addSource(REAL_HEIGHT_SOURCE,{type:'geojson',data:emptyBuildings(),attribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'});
  const firstLabel=map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
  const before=map.getLayer('point-halo')?'point-halo':firstLabel;
  map.addLayer({id:REAL_HEIGHT_LAYER,type:'fill-extrusion',source:REAL_HEIGHT_SOURCE,minzoom:13,layout:{visibility:enabled?'visible':'none'},paint:{'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-color':'#dce8e1','fill-extrusion-opacity':0.94,'fill-extrusion-vertical-gradient':true}},before);
  map.on('movestart',moveStart);
  map.on('moveend',moveEnd);
  if(enabled)schedule(0);
  else report('off');
 }
 if(map.isStyleLoaded())install();
 else map.once('load',install);
 return {
  setEnabled(value){
   enabled=Boolean(value);
   clearTimeout(timer);
   abort();
   if(installed){
    map.setLayoutProperty(REAL_HEIGHT_LAYER,'visibility',enabled?'visible':'none');
    if(!enabled)clear();
   }
   if(enabled)schedule(0);
   else report('off');
  },
  refresh(){schedule(0);},
  dispose(){
   if(disposed)return;
   disposed=true;
   clearTimeout(timer);
   abort();
   map.off('load',install);
   if(installed){
    map.off('movestart',moveStart);
    map.off('moveend',moveEnd);
   }
  }
 };
}
