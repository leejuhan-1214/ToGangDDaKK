// Natural Earth land-minus-lakes mask. See data/README.md for source and limits.
import polygonClipping from './vendor/polygon-clipping.mjs';

let mask = null;
let loading = null;
const RADIUS_KM = 6371;
const RAD = Math.PI / 180;
const EPSILON = 1e-10;

function boundsOf(polygon) {
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for (const [x,y] of polygon[0]) { west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y); }
  return {west,south,east,north};
}

function overlaps(a,b) { return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south; }
function rectangle(b) { return [[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]; }
function decodeNode(node) {
  let decoded=mask.decoded.get(node);
  if(decoded) return decoded;
  const encoded=node.p;
  if(!encoded) return [];
  decoded=encoded.map(polygon=>{
    const coordinates=polygon.map(ring=>{
      let x=0,y=0; const out=[];
      for(let i=0;i<ring.length;i+=2) {x+=ring[i];y+=ring[i+1];out.push([x/mask.precision,y/mask.precision]);}
      return out;
    });
    return {coordinates,bounds:boundsOf(coordinates)};
  });
  mask.decoded.set(node,decoded);
  return decoded;
}

/** Load once before running synchronous analysis. A raw dataset can be supplied in tests. */
export async function loadLandMask(source=new URL('./data/land-mask.json',import.meta.url)) {
  if(mask) return mask;
  if(loading) return loading;
  loading=(async()=>{
    const data=source && typeof source==='object' && source.format ? source : await (async()=>{
      // Standard HTTP revalidation permits browser caching; a failed request
      // clears the promise so an explicit UI retry can attempt loading again.
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),30000);
      try {
        const response=await fetch(source,{signal:controller.signal,cache:'default'});
        if(!response.ok) throw new Error(`Land mask could not be loaded (${response.status})`);
        return await response.json();
      } finally { clearTimeout(timeout); }
    })();
    if(data.format!==2 || data.step!==2 || data.states?.length!==16200 || !data.tiles || !data.coarse) throw new Error('Invalid land mask data');
    mask={...data,decoded:new WeakMap(),width:360/data.step,height:180/data.step};
    return mask;
  })().catch(error=>{loading=null;throw error;});
  return loading;
}

export function landMaskReady() { return mask!==null; }

function requireMask() { if(!mask) throw new Error('Load the land mask before analyzing land'); }
const normalizeLongitude=lng=>((lng+180)%360+360)%360-180;

function inRing(point,ring) {
  const [x,y]=point; let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}

/** Point query uses the full bundled coastline, including lake holes. */
export function isLand(point) {
  requireMask();
  if(!point || !point.every(Number.isFinite) || point[1]<=-90 || point[1]>=90) return false;
  const x=normalizeLongitude(point[0]),y=point[1];
  const col=Math.min(mask.width-1,Math.floor((x+180)/mask.step));
  const row=Math.min(mask.height-1,Math.floor((y+90)/mask.step));
  const key=row*mask.width+col, state=mask.states[key];
  if(state==='1') return true;
  if(state!=='2') return false;
  let node=mask.tiles[key],west=col*mask.step-180,south=row*mask.step-90,step=mask.step;
  while(node.c) {
    step/=2;
    const cx=x>=west+step?1:0,cy=y>=south+step?1:0;
    node=node.c[cy*2+cx];west+=cx*step;south+=cy*step;
    if(node===0)return false;
    if(node===1)return true;
  }
  return containsAny([x,y],decodeNode(node));
}

function containsAny(point,polygons) {
  const [x,y]=point;
  return polygons.some(({coordinates:p,bounds:b})=>x>=b.west && x<=b.east && y>=b.south && y<=b.north && inRing(point,p[0]) && !p.slice(1).some(r=>inRing(point,r)));
}

/**
 * Sampled check for schematic routes, not a navigation guarantee.
 * Samples at <= 0.01 degrees (about 1.12km north/south). Very long segments are
 * rejected rather than increasing the sampling interval. Small waterways absent
 * from Natural Earth cannot be detected.
 */
export function isLandSegment(a,b) {
  requireMask();
  if(!a || !b || ![...a,...b].every(Number.isFinite))return false;
  let dx=b[0]-a[0];dx=((dx+180)%360+360)%360-180;
  const dy=b[1]-a[1],steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.01));
  if(steps>20000 || !isLand(a) || !isLand(b))return false;
  for(let i=1;i<steps;i++)if(!isLand([a[0]+dx*i/steps,a[1]+dy*i/steps]))return false;
  return true;
}

/** Spherical area in km², holes subtracted. Longitudes may be unwrapped. */
export function geometryAreaKm2(geometry) {
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  function ringArea(ring) {
    let area=0;
    for(let i=0;i<ring.length-1;i++) {
      const a=ring[i],b=ring[i+1];
      area+=(b[0]-a[0])*RAD*(2+Math.sin(a[1]*RAD)+Math.sin(b[1]*RAD));
    }
    return Math.abs(area)*RADIUS_KM**2/2;
  }
  return polys.reduce((sum,p)=>sum+Math.max(0,ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0)),0);
}

function representativePoint(geometry,preferred) {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const contains=(point,p)=>inRing(point,p[0])&&!p.slice(1).some(r=>inRing(point,r));
  if(polygons.some(p=>contains(preferred,p))) return preferred;
  // A scanline yields an interior point, including for concave shapes and holes.
  // Select the widest land interval to avoid unstable points along the coastline.
  let best=null,bestWidth=-Infinity;
  for(const p of polygons) {
    const bbox=boundsOf(p),y=(bbox.south+bbox.north)/2, crossings=[];
    for(const ring of p) for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      if((a[1]>y)!==(b[1]>y)) crossings.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
    }
    crossings.sort((a,b)=>a-b);
    for(let i=0;i+1<crossings.length;i+=2) {
      const width=crossings[i+1]-crossings[i];
      if(width>bestWidth) {bestWidth=width;best=[(crossings[i]+crossings[i+1])/2,y];}
    }
  }
  return best;
}

function boundariesMayCross(polygons,b) {
  for(const {coordinates:p} of polygons) for(const ring of p) for(let i=1;i<ring.length;i++) {
    const a=ring[i-1],c=ring[i];
    if(Math.max(a[0],c[0])>=b.west && Math.min(a[0],c[0])<=b.east && Math.max(a[1],c[1])>=b.south && Math.min(a[1],c[1])<=b.north)return true;
  }
  return false;
}

function clipCanonical(b,layer) {
  const minX=Math.max(0,Math.floor((b.west+180)/mask.step));
  const maxX=Math.min(mask.width-1,Math.ceil((b.east+180)/mask.step)-1);
  const minY=Math.max(0,Math.floor((b.south+90)/mask.step));
  const maxY=Math.min(mask.height-1,Math.ceil((b.north+90)/mask.step)-1);
  const candidates=[]; let allLand=true;
  function collect(node,tile) {
    if(!overlaps(b,tile))return;
    if(node===0){allLand=false;return;}
    const piece={west:Math.max(b.west,tile.west),east:Math.min(b.east,tile.east),south:Math.max(b.south,tile.south),north:Math.min(b.north,tile.north)};
    if(node===1){candidates.push(rectangle(piece));return;}
    if(node.c) {
      const mx=(tile.west+tile.east)/2,my=(tile.south+tile.north)/2;
      collect(node.c[0],{west:tile.west,east:mx,south:tile.south,north:my});
      collect(node.c[1],{west:mx,east:tile.east,south:tile.south,north:my});
      collect(node.c[2],{west:tile.west,east:mx,south:my,north:tile.north});
      collect(node.c[3],{west:mx,east:tile.east,south:my,north:tile.north});
      return;
    }
    const polygons=decodeNode(node).filter(p=>overlaps(piece,p.bounds));
    if(!polygons.length){allLand=false;return;}
    if(!boundariesMayCross(polygons,piece)) {
      if(containsAny([(piece.west+piece.east)/2,(piece.south+piece.north)/2],polygons))candidates.push(rectangle(piece));
      else allLand=false;
      return;
    }
    allLand=false;
    for(const p of polygons)candidates.push(p.coordinates);
  }
  for(let row=minY;row<=maxY;row++) for(let col=minX;col<=maxX;col++) {
    const key=row*mask.width+col,state=layer.states[key];
    if(state==='0') {allLand=false;continue;}
    const tile={west:col*mask.step-180,east:(col+1)*mask.step-180,south:row*mask.step-90,north:(row+1)*mask.step-90};
    collect(state==='1'?1:layer.tiles[key],tile);
  }
  if(allLand) return [rectangle(b)];
  if(!candidates.length) return [];
  return polygonClipping.intersection(candidates,rectangle(b));
}

/**
 * Intersect a geographic cell with actual land polygons, not its center point.
 * Returns null for water, or {geometry,areaKm2,point}. The point lies inside
 * clipped land, using the cell center when that center is on land.
 * east must be greater than west;
 * a dateline-crossing request uses continuous bounds, e.g. west:179,east:181.
 * Returned coordinates retain that same continuous longitude world copy.
 */
export function clipCell(bounds) {
  requireMask();
  const {west,east,south,north}=bounds;
  if(![west,east,south,north].every(Number.isFinite) || east<=west || north<=south || east-west>360+EPSILON || south< -90 || north>90) throw new Error('Invalid land-mask bounds');
  const polygons=[];
  const layer=Math.max(east-west,north-south)>=mask.coarse.minCellDegrees?mask.coarse:mask;
  const firstWorld=Math.floor((west+180)/360);
  const lastWorld=Math.ceil((east+180)/360)-1;
  for(let world=firstWorld;world<=lastWorld;world++) {
    const shift=world*360;
    const piece={west:Math.max(-180,west-shift),east:Math.min(180,east-shift),south,north};
    if(piece.east-piece.west<=EPSILON) continue;
    const clipped=clipCanonical(piece,layer);
    for(const polygon of clipped) polygons.push(shift===0?polygon:polygon.map(ring=>ring.map(([x,y])=>[x+shift,y])));
  }
  if(!polygons.length) return null;
  const geometry=polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons};
  const areaKm2=geometryAreaKm2(geometry);
  return areaKm2>1e-10?{geometry,areaKm2,point:representativePoint(geometry,[(west+east)/2,(south+north)/2])}:null;
}
