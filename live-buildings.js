export const BUILDING_ENDPOINT='https://maps.mail.ru/osm/tools/overpass/api/interpreter';
export const emptyBuildings=()=>({type:'FeatureCollection',features:[]});
export function heightMeters(raw){
  if(typeof raw!=='string')return null;
  const match=raw.trim().match(/^(\d+(?:\.\d+)?)\s*(m|ft)?$/);
  if(!match)return null;
  const value=Number(match[1])*(match[2]==='ft'?0.3048:1);
  return Number.isFinite(value)&&value>0?value:null;
}
export function buildingQuery([w,s,e,n]){
  if(![w,s,e,n].every(Number.isFinite)||e<=w||n<=s)throw Error('Invalid building bounds');
  const box=[s,w,n,e].map(v=>v.toFixed(6)).join(',');
  return `[out:json][timeout:25];(way["building"]["height"](${box});way["building:part"]["height"](${box});relation["type"="multipolygon"]["building"]["height"](${box});relation["type"="multipolygon"]["building:part"]["height"](${box}););out geom;`;
}
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const coordinates=geometry=>geometry?.every(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat))?geometry.map(p=>[p.lon,p.lat]):[];
function ringsFrom(segments){
  const pending=segments.map(x=>x.slice()),rings=[];
  while(pending.length){
    const ring=pending.pop();if(ring.length<2)return null;
    while(!same(ring[0],ring.at(-1))){
      const index=pending.findIndex(part=>same(ring.at(-1),part[0])||same(ring.at(-1),part.at(-1)));
      if(index<0)return null;
      const next=pending.splice(index,1)[0];if(!same(ring.at(-1),next[0]))next.reverse();ring.push(...next.slice(1));
    }
    if(ring.length<4)return null;rings.push(ring);
  }
  return rings;
}
function contains(ring,[x,y]){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function geometryFor(element){
  if(element.type==='way'){
    const ring=coordinates(element.geometry);
    return ring.length>=4&&same(ring[0],ring.at(-1))?{type:'Polygon',coordinates:[ring]}:null;
  }
  if(element.type!=='relation')return null;
  const members=element.members?.filter(x=>x.type==='way')||[];
  const outers=ringsFrom(members.filter(x=>x.role==='outer'||!x.role).map(x=>coordinates(x.geometry)));
  const inners=ringsFrom(members.filter(x=>x.role==='inner').map(x=>coordinates(x.geometry)));
  if(!outers?.length||!inners)return null;
  const polygons=outers.map(ring=>[ring]);
  for(const hole of inners){const polygon=polygons.find(x=>contains(x[0],hole[0]));if(!polygon)return null;polygon.push(hole);}
  return {type:'MultiPolygon',coordinates:polygons};
}
export function convertBuildings(raw){
  const features=[],seen=new Set();
  for(const element of raw.elements||[]){
    const key=`${element.type}/${element.id}`,tags=element.tags||{},height=heightMeters(tags.height);
    if(!Number.isSafeInteger(element.id)||seen.has(key)||height===null||(!tags.building&&!tags['building:part'])||tags.building==='no')continue;
    const geometry=geometryFor(element);if(!geometry)continue;
    const base=heightMeters(tags.min_height)??0;if(base>=height)continue;
    features.push({type:'Feature',id:key,properties:{osmId:element.id,osmType:element.type,name:tags['name:ko']||tags.name||'',height,base,heightTag:tags.height,sourceURL:`https://www.openstreetmap.org/${key}`},geometry});seen.add(key);
  }
  return {type:'FeatureCollection',features,source:{timestamp:raw.osm3s?.timestamp_osm_base||null,url:BUILDING_ENDPOINT}};
}
export function buildingBounds(mapBounds){
  const [w,s,e,n]=mapBounds;
  if(!mapBounds.every(Number.isFinite))return null;
  const area=(e-w)*(n-s)*12321*Math.cos((n+s)/2*Math.PI/180);
  if(area>160||e<=w||n<=s)return null;
  return [Math.max(-180,w),Math.max(-85,s),Math.min(180,e),Math.min(85,n)];
}
export async function fetchBuildings(bounds,signal){
  const endpoints=[BUILDING_ENDPOINT,'https://overpass-api.de/api/interpreter'];
  for(const endpoint of endpoints){
    try{
      const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:buildingQuery(bounds)}),signal:AbortSignal.any([signal,AbortSignal.timeout(35000)])});
      if(response.status===429)throw Object.assign(Error('건물 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.'),{rateLimited:true});
      if(!response.ok)throw Error(`건물 자료 서버 응답 ${response.status}`);
      const raw=await response.json();if(raw.remark)throw Error('건물 자료 조회가 완료되지 않았습니다. 다시 시도해 주세요.');
      const result=convertBuildings(raw);result.source.url=endpoint;return result;
    }catch(error){if(signal.aborted||error.rateLimited||endpoint===endpoints.at(-1))throw error;}
  }
}
