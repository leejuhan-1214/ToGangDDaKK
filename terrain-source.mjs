/** Actual Mapterhorn elevations; overzoom only interpolates existing samples. */
export const TERRAIN_PROTOCOL = 'terrain-dem';
export const TERRAIN_TILE_SIZE = 512;
export const TERRAIN_MAX_ZOOM = 18;
export const TERRAIN_CATALOG_URL = 'https://download.mapterhorn.com/download_urls.json';
const TILE_BASE = 'https://tiles.mapterhorn.com';
const GLOBAL_MAX_ZOOM = 12;

function checkTile(tile) {
  if (!tile || !Number.isInteger(tile.z) || tile.z < 0 || tile.z > TERRAIN_MAX_ZOOM ||
      !Number.isInteger(tile.x) || !Number.isInteger(tile.y) || tile.x < 0 || tile.y < 0 ||
      tile.x >= 2 ** tile.z || tile.y >= 2 ** tile.z) throw new RangeError('Invalid terrain tile coordinates');
  return tile;
}

export function parseTerrainTileUrl(url) {
  const match = /^terrain-dem:\/\/(\d+)\/(\d+)\/(\d+)(?:\.(?:png|webp))?(?:\?[^#]*)?$/.exec(url);
  if (!match) throw new RangeError('Invalid terrain protocol URL');
  return checkTile({z:Number(match[1]),x:Number(match[2]),y:Number(match[3])});
}

/** Regional archives are indexed by their z6 tile, not by a claimed global resolution. */
export function createTerrainCoverageIndex(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) throw new TypeError('Invalid Mapterhorn coverage catalog');
  const index = new Map();
  for (const item of catalog.items) {
    const match = /^6-(\d+)-(\d+)\.pmtiles$/.exec(item?.name ?? '');
    if (!match || !Number.isInteger(item.max_zoom) || item.max_zoom <= GLOBAL_MAX_ZOOM) continue;
    const x = Number(match[1]), y = Number(match[2]);
    if (x < 0 || x >= 64 || y < 0 || y >= 64) continue;
    const key = `${x}/${y}`;
    index.set(key, Math.max(index.get(key) ?? GLOBAL_MAX_ZOOM, Math.min(TERRAIN_MAX_ZOOM,item.max_zoom)));
  }
  return index;
}

export function terrainNativeZoomLimit(tile, coverage) {
  checkTile(tile);
  if (tile.z <= GLOBAL_MAX_ZOOM) return tile.z;
  const divisor = 2 ** (tile.z - 6);
  const regionalMax = coverage?.get(`${Math.floor(tile.x/divisor)}/${Math.floor(tile.y/divisor)}`);
  return Math.min(tile.z,regionalMax ?? GLOBAL_MAX_ZOOM);
}

export function ancestorTerrainTile(tile, zoom) {
  checkTile(tile);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > tile.z) throw new RangeError('Invalid ancestor zoom');
  const divisor = 2 ** (tile.z-zoom);
  return {z:zoom,x:Math.floor(tile.x/divisor),y:Math.floor(tile.y/divisor)};
}

export function decodeTerrariumRgba(rgba) {
  if (!rgba || rgba.length % 4) throw new RangeError('Invalid RGBA elevation data');
  const heights = new Float32Array(rgba.length/4);
  for (let i=0,j=0;i<heights.length;i++,j+=4) {
    if (rgba[j+3] !== 255) throw new RangeError('Transparent elevation samples are unavailable, not zero metres');
    heights[i] = rgba[j]*256 + rgba[j+1] + rgba[j+2]/256 - 32768;
  }
  return heights;
}

export function encodeTerrariumRgba(heights) {
  const rgba = new Uint8ClampedArray(heights.length*4);
  for (let i=0,j=0;i<heights.length;i++,j+=4) {
    const height = heights[i];
    if (!Number.isFinite(height) || height < -32768 || height > 32768-1/256) throw new RangeError('Elevation outside Terrarium range');
    const packed = Math.round((height+32768)*256);
    rgba[j] = Math.floor(packed/65536);
    rgba[j+1] = Math.floor(packed/256)%256;
    rgba[j+2] = packed%256;
    rgba[j+3] = 255;
  }
  return rgba;
}

/** Pixel-centre sampling of the exact child footprint, in metres (never encoded RGB). */
export function cropTerrainHeights(grid, parent, child, outputSize=TERRAIN_TILE_SIZE) {
  checkTile(parent); checkTile(child);
  if (parent.z > child.z || !Number.isInteger(outputSize) || outputSize < 1 || outputSize > TERRAIN_TILE_SIZE ||
      !Number.isInteger(grid?.width) || !Number.isInteger(grid?.height) || grid.width < 1 || grid.height < 1 ||
      grid.heights?.length !== grid.width*grid.height) throw new RangeError('Invalid terrain grid');
  const ancestor = ancestorTerrainTile(child,parent.z);
  if (ancestor.x !== parent.x || ancestor.y !== parent.y) throw new RangeError('Terrain tile is not a descendant of its parent');
  const scale = 2 ** (child.z-parent.z), offsetX = child.x-parent.x*scale, offsetY = child.y-parent.y*scale;
  const result = new Float32Array(outputSize*outputSize);
  const columns = Array.from({length:outputSize},(_,x)=>{
    const position = Math.max(0,Math.min(grid.width-1,((offsetX+(x+0.5)/outputSize)/scale)*grid.width-0.5));
    const first = Math.floor(position);
    return [first,Math.min(first+1,grid.width-1),position-first];
  });
  for (let y=0;y<outputSize;y++) {
    const position = Math.max(0,Math.min(grid.height-1,((offsetY+(y+0.5)/outputSize)/scale)*grid.height-0.5));
    const first = Math.floor(position), second = Math.min(first+1,grid.height-1), weight = position-first;
    for (let x=0;x<outputSize;x++) {
      const [left,right,across] = columns[x];
      const top = grid.heights[first*grid.width+left]*(1-across)+grid.heights[first*grid.width+right]*across;
      const bottom = grid.heights[second*grid.width+left]*(1-across)+grid.heights[second*grid.width+right]*across;
      result[y*outputSize+x] = top*(1-weight)+bottom*weight;
    }
  }
  return result;
}

function abortError() { return new DOMException('Terrain request aborted','AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function abortable(promise,signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
    const abort = ()=>{signal.removeEventListener('abort',abort);reject(abortError());};
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

function canvasFor(width,height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width,height);
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height; return canvas;
  }
  throw new Error('This browser cannot resample elevation images');
}

async function decodeTerrainImage(data,signal) {
  checkAbort(signal);
  if (typeof createImageBitmap !== 'function') throw new Error('Elevation image decoding is unavailable');
  const bitmap = await createImageBitmap(new Blob([data]),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  try {
    checkAbort(signal);
    if (bitmap.width !== TERRAIN_TILE_SIZE || bitmap.height !== TERRAIN_TILE_SIZE) throw new Error('Unexpected Mapterhorn tile dimensions');
    const canvas = canvasFor(bitmap.width,bitmap.height);
    const context = canvas.getContext('2d',{willReadFrequently:true});
    if (!context) throw new Error('Elevation decoding canvas is unavailable');
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap,0,0);
    return {width:bitmap.width,height:bitmap.height,heights:decodeTerrariumRgba(context.getImageData(0,0,bitmap.width,bitmap.height).data)};
  } finally { bitmap.close(); }
}

async function encodeTerrainImage(heights,width,height,signal) {
  checkAbort(signal);
  const canvas=canvasFor(width,height),context=canvas.getContext('2d');
  if (!context) throw new Error('Elevation encoding canvas is unavailable');
  const pixels=context.createImageData(width,height);
  pixels.data.set(encodeTerrariumRgba(heights));
  context.putImageData(pixels,0,0);
  const blob = typeof canvas.convertToBlob === 'function'
    ? await canvas.convertToBlob({type:'image/png'})
    : await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Elevation PNG encoding failed')),'image/png'));
  checkAbort(signal);
  return blob.arrayBuffer();
}

/**
 * Register with maplibregl.addProtocol(TERRAIN_PROTOCOL, handler).
 * URL: terrain-dem://{z}/{x}/{y}; raster-dem source: 512px, terrarium, maxzoom18.
 * decodeTile/encodeTile are injectable codecs for tests or alternative browser runtimes.
 * Only a bounded, in-memory cache is used. Call handler.dispose() when removing the app.
 */
export function createTerrainProtocol({fetchImpl=fetch,onTile=()=>{},decodeTile=decodeTerrainImage,encodeTile=encodeTerrainImage}={}) {
  const lifetime=new AbortController();
  const rawCache=new Map(), missing=new Map(), inFlight=new Map();
  const queue=[];
  let active=0,cacheBytes=0,catalogPromise;
  const MAX_CACHE_BYTES=32*1024*1024,MAX_CACHE_ENTRIES=32,MAX_MISSING=1024,MISSING_TTL=10*60*1000;

  function drain() {
    while(active<4 && queue.length) {
      const item=queue.shift();
      item.signal?.removeEventListener('abort',item.abort);
      if(item.signal?.aborted){item.reject(abortError());continue;}
      active++;
      Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{active--;drain();});
    }
  }
  function network(task,signal) {
    checkAbort(signal);
    return new Promise((resolve,reject)=>{
      const item={task,signal,resolve,reject};
      item.abort=()=>{const index=queue.indexOf(item);if(index>=0){queue.splice(index,1);reject(abortError());}};
      signal?.addEventListener('abort',item.abort,{once:true});
      queue.push(item);drain();
    });
  }
  async function request(url,signal,json=false) {
    return network(async()=>{
      checkAbort(signal);
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,15000);
      try {
        const response=await fetchImpl(url,{signal:controller.signal,mode:'cors'});
        if(!response.ok){const error=new Error(`Elevation source HTTP ${response.status}`);error.status=response.status;throw error;}
        const result=json?await response.json():await response.arrayBuffer();
        checkAbort(signal);return result;
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    },signal);
  }
  function trimCache() {
    while(rawCache.size>MAX_CACHE_ENTRIES || cacheBytes>MAX_CACHE_BYTES) {
      const key=rawCache.keys().next().value,entry=rawCache.get(key);
      rawCache.delete(key);cacheBytes-=entry.bytes;
    }
  }
  function cacheGet(key) {
    const entry=rawCache.get(key);
    if(entry){rawCache.delete(key);rawCache.set(key,entry);}
    return entry;
  }
  function cachePut(key,entry) {
    const old=rawCache.get(key);if(old)cacheBytes-=old.bytes;
    rawCache.delete(key);rawCache.set(key,entry);cacheBytes+=entry.bytes;trimCache();
  }
  function isMissing(key) {
    const until=missing.get(key);
    if(until && until>Date.now())return true;
    missing.delete(key);return false;
  }
  function markMissing(key) {
    missing.delete(key);missing.set(key,Date.now()+MISSING_TTL);
    while(missing.size>MAX_MISSING)missing.delete(missing.keys().next().value);
  }
  function catalog(signal) {
    catalogPromise ??= request(TERRAIN_CATALOG_URL,lifetime.signal,true)
      .then(value=>({coverage:createTerrainCoverageIndex(value),available:true}))
      .catch(()=>({coverage:new Map(),available:false}));
    return abortable(catalogPromise,signal);
  }
  async function nativeTile(tile,signal) {
    checkAbort(signal);
    const key=`${tile.z}/${tile.x}/${tile.y}`;
    const cached=cacheGet(key);if(cached)return cached;
    if(isMissing(key))return null;
    let job=inFlight.get(key);
    if(job?.controller.signal.aborted)job=null;
    if(!job) {
      const controller=new AbortController();
      job={controller,users:0,settled:false};
      job.promise=request(`${TILE_BASE}/${key}.webp`,controller.signal)
        .then(data=>{const entry={data,bytes:data.byteLength,key};cachePut(key,entry);return entry;})
        .catch(error=>{if(error.status===404 || error.status===410){markMissing(key);return null;}throw error;})
        .finally(()=>{job.settled=true;if(inFlight.get(key)===job)inFlight.delete(key);});
      inFlight.set(key,job);
    }
    job.users++;
    try {return await abortable(job.promise,signal);}
    finally {
      job.users--;
      if(job.users===0&&!job.settled){
        if(inFlight.get(key)===job)inFlight.delete(key);
        job.controller.abort();
      }
    }
  }
  async function heightGrid(entry,signal) {
    if(entry.grid)return entry.grid;
    // Shared decoding is independent of any one consumer's cancellation.
    entry.decoding ??= Promise.resolve().then(()=>decodeTile(entry.data,lifetime.signal)).then(grid=>{
      if(grid?.width!==TERRAIN_TILE_SIZE || grid?.height!==TERRAIN_TILE_SIZE || grid.heights?.length!==TERRAIN_TILE_SIZE**2)throw new Error('Unexpected decoded elevation dimensions');
      entry.grid=grid;
      if(rawCache.get(entry.key)===entry){cacheBytes-=entry.bytes;entry.bytes=entry.data.byteLength+grid.heights.byteLength;cacheBytes+=entry.bytes;trimCache();}
      return grid;
    }).finally(()=>{entry.decoding=null;});
    return abortable(entry.decoding,signal);
  }

  const handler=async(requestParameters,abortController)=>{
    checkAbort(lifetime.signal);
    const tile=parseTerrainTileUrl(requestParameters.url);
    const controller=new AbortController(),external=abortController?.signal;
    const abort=()=>controller.abort();
    external?.addEventListener('abort',abort,{once:true});lifetime.signal.addEventListener('abort',abort,{once:true});
    if(external?.aborted)controller.abort();
    const signal=controller.signal;
    try {
      checkAbort(signal);
      const coverage=tile.z>GLOBAL_MAX_ZOOM?await catalog(signal):{coverage:null,available:null};
      let nativeZoom=terrainNativeZoomLimit(tile,coverage.coverage),fallbackReason=coverage.available===false?'catalog-unavailable':null;
      while(nativeZoom>=0) {
        checkAbort(signal);
        const parent=ancestorTerrainTile(tile,nativeZoom);
        let entry;
        try {entry=await nativeTile(parent,signal);}
        catch(error) {
          checkAbort(signal);
          if(nativeZoom>GLOBAL_MAX_ZOOM){nativeZoom=GLOBAL_MAX_ZOOM;fallbackReason='source-unavailable';continue;}
          throw error;
        }
        if(!entry){nativeZoom--;fallbackReason ??='tile-unavailable';continue;}
        let data;
        if(nativeZoom===tile.z) {
          // MapLibre may transfer the returned buffer; retain our own cache copy.
          data=entry.data.slice(0);
        } else {
          const grid=await heightGrid(entry,signal);
          checkAbort(signal);
          const heights=cropTerrainHeights(grid,parent,tile);
          data=await encodeTile(heights,TERRAIN_TILE_SIZE,TERRAIN_TILE_SIZE,signal);
        }
        checkAbort(signal);
        try {onTile({usage:new URL(requestParameters.url).searchParams.get('usage'),x:tile.x,y:tile.y,requestedZoom:tile.z,nativeZoom,overzoomed:nativeZoom<tile.z,requestedTile:{...tile},nativeTile:parent,
          sourceUrl:`${TILE_BASE}/${parent.z}/${parent.x}/${parent.y}.webp`,catalogAvailable:coverage.available,fallbackReason});}catch{/* UI observers must not invalidate elevation data. */}
        return {data};
      }
      throw new Error('No measured terrain tile is available for this location');
    } finally {external?.removeEventListener('abort',abort);lifetime.signal.removeEventListener('abort',abort);}
  };
  handler.dispose=()=>{
    lifetime.abort();
    for(const job of inFlight.values())job.controller.abort();
    rawCache.clear();missing.clear();inFlight.clear();cacheBytes=0;
  };
  return handler;
}
