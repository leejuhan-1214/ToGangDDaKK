import {enhanceImageryRGBA} from './imagery-quality.mjs';

export const IMAGERY_ROOT='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
export const CAMERA_MAX_ZOOM=22;
export const IMAGERY_MAX_ZOOM=23;
const abortError=()=>new DOMException('Aborted','AbortError');
const check=signal=>{if(signal?.aborted)throw abortError();};
function keep(cache,key,value,limit){cache.delete(key);cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value);return value;}
export function parseImageryURL(value){
 const match=/^land15-imagery:\/\/(original|enhanced)\/(\d+)\/(\d+)\/(\d+)$/.exec(value);
 if(!match)throw new Error('Invalid imagery tile URL');
 const [mode,z,x,y]=[match[1],...match.slice(2).map(Number)];
 if(z>IMAGERY_MAX_ZOOM||x>=2**z||y>=2**z)throw new Error('Imagery tile outside world');
 return {mode,z,x,y};
}
export function tilePresence(result,x,y){
 if(result?.error?.code===422)return false;
 const box=result?.location;
 if(!box||![box.left,box.top,box.width,box.height].every(Number.isInteger)||box.width<1||box.height<1||box.width>128||box.height>128||!Array.isArray(result.data)||result.data.length!==box.width*box.height)throw new Error('Invalid imagery availability');
 const col=x-box.left,row=y-box.top;
 if(col<0||row<0||col>=box.width||row>=box.height)throw new Error('Availability does not cover requested tile');
 const value=result.data[row*box.width+col];
 if(value!==0&&value!==1)throw new Error('Unknown imagery availability');
 return value===1;
}
export function parentCrop(requested,parentZoom,size=256){
 if(!Number.isInteger(parentZoom)||parentZoom<0||parentZoom>requested.z)throw new Error('Invalid parent level');
 const factor=2**(requested.z-parentZoom),span=size/factor;
 return {x:Math.floor(requested.x/factor),y:Math.floor(requested.y/factor),sx:(requested.x%factor)*span,sy:(requested.y%factor)*span,span};
}
export async function resolveImageryTile(tile,exists,{signal}={}){
 for(let z=tile.z;z>=0;z--){check(signal);const parent=parentCrop(tile,z);if(await exists(z,parent.x,parent.y,signal))return {...parent,z};}
 throw new Error('No verified imagery available for this location');
}

// Only an ephemeral, bounded cache for the active viewer. No tile downloads or persistent derived imagery.
export function createImageryProtocol({fetchImpl=fetch,onTile=()=>{},renderTile=renderImageryTile}={}){
 const availability=new Map(),images=new Map(),pending=new Map(),queue=[];
 let active=0,disposed=false;
 function drain(){while(active<4&&queue.length){const job=queue.shift();if(job.signal.aborted){job.reject(abortError());continue;}active++;job.run().then(job.resolve,job.reject).finally(()=>{active--;drain();});}}
 function limited(run,signal){check(signal);return new Promise((resolve,reject)=>{queue.push({run,signal,resolve,reject});drain();});}
 function shared(key,cache,limit,run,signal){
  check(signal);if(disposed)return Promise.reject(abortError());
  if(cache.has(key)){const value=cache.get(key);keep(cache,key,value,limit);return Promise.resolve(value);}
  let entry=pending.get(key);
  if(!entry){const controller=new AbortController();entry={controller,users:0};pending.set(key,entry);entry.promise=limited(async()=>{const timer=setTimeout(()=>controller.abort(),15000);try{const value=await run(controller.signal);check(controller.signal);return keep(cache,key,value,limit);}finally{clearTimeout(timer);}},controller.signal).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});entry.promise.catch(()=>{});}
  entry.users++;
  return new Promise((resolve,reject)=>{let done=false;const finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',aborted);entry.users--;if(!entry.users&&pending.get(key)===entry){pending.delete(key);entry.controller.abort();}fn(value);};const aborted=()=>finish(reject,abortError());signal?.addEventListener('abort',aborted,{once:true});entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error));if(signal?.aborted)aborted();});
 }
 async function exists(z,x,y,signal){
  const width=Math.min(8,2**z),left=Math.floor(x/width)*width,top=Math.floor(y/width)*width;
  const result=await shared(`availability/${z}/${left}/${top}`,availability,256,async inner=>{
   const response=await fetchImpl(`${IMAGERY_ROOT}/tilemap/${z}/${top}/${left}/${width}/${width}?f=json`,{signal:inner});
   if(!response.ok&&response.status!==422)throw new Error(`Imagery availability HTTP ${response.status}`);
   const result=await response.json();tilePresence(result,x,y);return result;
  },signal);
  return tilePresence(result,x,y);
 }
 const handler=async(request,abortController)=>{
  const signal=abortController?.signal,tile=parseImageryURL(request.url),native=await resolveImageryTile(tile,exists,{signal});
  const blob=await shared(`image/${native.z}/${native.x}/${native.y}`,images,48,async inner=>{const response=await fetchImpl(`${IMAGERY_ROOT}/tile/${native.z}/${native.y}/${native.x}`,{signal:inner});if(!response.ok)throw new Error(`Imagery HTTP ${response.status}`);const blob=await response.blob();if(!/^image\//.test(blob.type)||blob.size>2*1024*1024)throw new Error('Invalid imagery response');return blob;},signal);
  check(signal);if(disposed)throw abortError();
  const data=await limited(()=>renderTile(blob,tile,native,signal),signal||new AbortController().signal);
  check(signal);if(disposed)throw abortError();
  try{onTile({x:tile.x,y:tile.y,requestedZoom:tile.z,nativeZoom:native.z,overzoomed:native.z<tile.z,enhanced:tile.mode==='enhanced'&&tile.z>=15});}catch{/* Display observers cannot invalidate a verified image. */}
  return {data};
 };
 handler.dispose=()=>{disposed=true;for(const entry of pending.values())entry.controller.abort();for(const job of queue.splice(0))job.reject(abortError());pending.clear();availability.clear();images.clear();};
 return handler;
}
async function renderImageryTile(blob,tile,native,signal){
 const enhanced=tile.mode==='enhanced'&&tile.z>=15;
 if(native.z===tile.z&&!enhanced)return blob.arrayBuffer();
 const bitmap=await createImageBitmap(blob);
 try{
  check(signal);
  const canvas=new OffscreenCanvas(256,256),context=canvas.getContext('2d',{willReadFrequently:enhanced});
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  const crop=parentCrop(tile,native.z,bitmap.width);
  context.drawImage(bitmap,crop.sx,crop.sy,crop.span,crop.span,0,0,256,256);
  if(enhanced){const result=enhanceImageryRGBA(context.getImageData(0,0,256,256),{strength:.45,scale:1});context.putImageData(new ImageData(result.data,result.width,result.height),0,0);}
  check(signal);return (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
 }finally{bitmap.close();}
}
