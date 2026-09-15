// Read published SDG 15.3.1 COG values. There is no synthetic classification here.
// Source overview pixels use MODE; they are display samples, never area statistics.
export const DEGRADATION_NODATA=-32768;
const RANGE_LIMIT=4*1024*1024, OPERATION_BYTE_LIMIT=24*1024*1024;
const nativeSamples=Array.from({length:14},(_,i)=>i);
const finite=Number.isFinite;
const abortError=()=>new DOMException('취소된 지도 자료 요청입니다.','AbortError');
const checkAbort=signal=>{if(signal?.aborted)throw signal.reason||abortError();};
function queue(limit){let active=0;const pending=[];const next=()=>{if(active>=limit||!pending.length)return;const {fn,resolve,reject}=pending.shift();active++;Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;next();});};return fn=>new Promise((resolve,reject)=>{pending.push({fn,resolve,reject});next();});}
const networkQueue=queue(2);

/** A strict HTTP range client. A 200/full-file response is cancelled before body reads. */
export function createBoundedRangeClient(url,{getContext,fetchImpl=globalThis.fetch}={}){
  return {url,async request({headers={},signal}={}){
    const context=getContext?.()||{requests:0,bytes:0,signal};
    const fail=message=>{const error=new Error(message);context.lastError=error;throw error;};
    const requestSignal=context.signal||signal;
    checkAbort(requestSignal);checkAbort(signal);
    const range=new Headers(headers).get('Range'),match=/^bytes=(\d+)-(\d+)$/.exec(range||'');
    if(!match)fail('단일 바이트 범위가 없는 원본 다운로드는 허용하지 않습니다.');
    const start=Number(match[1]),end=Number(match[2]),length=end-start+1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||length<1||length>RANGE_LIMIT)fail('COG 요청 범위가 안전 한도를 초과했습니다.');
    context.requests++;context.bytes+=length;
    if(context.requests>160||context.bytes>OPERATION_BYTE_LIMIT)fail('지도 부분 읽기 한도를 초과했습니다. 더 좁은 구역을 선택해 주세요.');
    return networkQueue(async()=>{
      checkAbort(requestSignal);checkAbort(signal);
      const response=await fetchImpl(url,{headers,signal:requestSignal,credentials:'omit'});
      const cancel=async()=>{try{await response.body?.cancel();}catch{ /* response already closed */ }};
      if(response.status!==206){await cancel();throw new Error(`부분 읽기 HTTP 206이 필요합니다 (응답 ${response.status}). 원본 전체 다운로드를 차단했습니다.`);}
      const responseRange=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
      const responseStart=Number(responseRange?.[1]),responseEnd=Number(responseRange?.[2]),total=Number(responseRange?.[3]);
      const responseLength=responseEnd-responseStart+1;
      if(!responseRange||responseStart!==start||responseEnd!==Math.min(end,total-1)||responseLength<1||responseLength>length){await cancel();throw new Error('서버의 바이트 범위가 요청과 일치하지 않습니다.');}
      const declared=response.headers.get('content-length');
      if(declared!==null&&Number(declared)!==responseLength){await cancel();throw new Error('부분 응답 크기가 일치하지 않습니다.');}
      let buffer;
      if(response.body?.getReader){
        const reader=response.body.getReader(),chunks=[];let received=0;
        try{while(true){checkAbort(requestSignal);const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>responseLength){await reader.cancel();throw new Error('부분 응답이 허용 크기를 초과했습니다.');}chunks.push(value);}}
        finally{reader.releaseLock();}
        if(received!==responseLength)throw new Error('지도 타일 데이터가 잘렸습니다.');
        const merged=new Uint8Array(received);let at=0;for(const chunk of chunks){merged.set(chunk,at);at+=chunk.byteLength;}buffer=merged.buffer;
      }else{buffer=await response.arrayBuffer();if(buffer.byteLength!==responseLength)throw new Error('지도 타일 데이터 크기가 일치하지 않습니다.');}
      checkAbort(requestSignal);
      context.transferredBytes=(context.transferredBytes||0)+buffer.byteLength;
      return {ok:true,status:206,getHeader:name=>response.headers.get(name)||undefined,getData:async()=>buffer};
    }).catch(error=>{context.lastError=error;throw error;});
  }};
}

export function normalizeDegradationBounds(input){
  let bounds;
  if(Array.isArray(input))bounds=input.length===2&&Array.isArray(input[0])?[input[0][0],input[0][1],input[1][0],input[1][1]]:[...input];
  else if(input?.getWest)bounds=[input.getWest(),input.getSouth(),input.getEast(),input.getNorth()];
  else bounds=[input?.west,input?.south,input?.east,input?.north];
  if(bounds.length!==4||!bounds.every(finite))throw new RangeError('유효한 지도 범위가 필요합니다.');
  let [west,south,east,north]=bounds;
  if(east<west)east+=360;
  if(east-west>360){west=-180;east=180;}
  if(east<=west||north<=south)throw new RangeError('빈 지도 범위입니다.');
  south=Math.max(-90,south);north=Math.min(90,north);
  if(north<=south)throw new RangeError('자료 범위를 벗어났습니다.');
  return [west,south,east,north];
}

export function pointToDegradationPixel(lng,lat,metadata){
  if(!finite(lng)||!finite(lat)||lat < -90||lat > 90)throw new RangeError('유효한 좌표가 필요합니다.');
  const longitude=(((lng+180)%360)+360)%360-180;
  const [west,north]=metadata.origin,[dx,dy]=metadata.resolutionDegrees;
  const x=Math.floor((longitude-west)/dx),y=Math.floor((north-lat)/dy);
  if(x<0||y<0||x>=metadata.width||y>=metadata.height)return null;
  return {x,y,coordinate:[longitude,lat],bounds:[west+x*dx,north-(y+1)*dy,west+(x+1)*dx,north-y*dy]};
}

const indicatorLabels={'-1':'황폐화','0':'변화 없음','1':'개선'};
const productivityLabels={1:'생산성 감소',2:'보통 감소',3:'스트레스',4:'안정',5:'생산성 증가'};
function decodeIndicator(value){return Object.hasOwn(indicatorLabels,value)?{code:value,label:indicatorLabels[value],group:value===-1?'degraded':value===1?'improved':'stable'}:{code:null,label:'자료 없음',group:'no-data'};}
export function decodeDegradationStatus(value,manifest){
  const definition=Number.isInteger(value)&&value>=1&&value<=7?manifest.statusClasses?.[String(value)]:null;
  return definition?{code:value,label:definition.labelKo||definition.label,group:definition.group}:{code:null,label:'자료 없음',group:'no-data'};
}
export function decodeDegradationPoint(values,metadata,manifest,pixel){
  if(values.length!==14)throw new Error('14개 원본 밴드가 필요합니다.');
  const bands=Array.from(values,value=>Number.isInteger(value)&&value!==DEGRADATION_NODATA?value:null);
  const status=decodeDegradationStatus(bands[13],manifest),validStatus=status.code!==null;
  const productivity=validStatus&&Object.hasOwn(productivityLabels,bands[10])?{code:bands[10],label:productivityLabels[bands[10]]}:{code:null,label:'자료 없음'};
  // Some masked/unclassified source pixels contain zero in individual bands.
  // Retain those raw values but do not turn them into a healthy-land interpretation.
  return {provider:metadata.provider,providerName:metadata.providerName,bands,status,
    sdg:decodeIndicator(validStatus?bands[9]:null),productivity,landCover:decodeIndicator(validStatus?bands[11]:null),soilCarbonPercent:validStatus?bands[12]:null,
    interpretation:{eligible:validStatus,reason:validStatus?null:'status-unavailable',note:validStatus?'유효한 원본 상태 분류가 있는 픽셀입니다.':'2023 상태 분류가 없거나 유효하지 않아 개별 밴드의 값을 정상·황폐화·개선으로 해석하지 않습니다. 원본 값은 bands에 보존합니다.'},
    soilCarbonUnit:'% 변화량',soilCarbonPeriodNote:'원본 TIFF는 2015–2023, 배포 설명은 2015–2022로 표기해 최종 연도가 일치하지 않습니다.',
    pixelBounds:pixel?.bounds||null,resolutionDegrees:metadata.resolutionDegrees,nominalResolutionMetersAtEquator:metadata.nominalResolutionMetersAtEquator,
    sourceUrl:metadata.sourceUrl,bandDescriptions:metadata.bands,statusYear:manifest.statusYear,baseline:manifest.baseline,
    spatialSupport:'원본 해상도에서 선택 좌표를 포함하는 픽셀 1개'};
}

export function compareDegradationMethods(primary,other){
  const statusComparable=[primary.status.code,other.status.code].every(value=>Number.isInteger(value)&&value>=1&&value<=7);
  const sdgComparable=statusComparable&&[primary.sdg.code,other.sdg.code].every(value=>value===-1||value===0||value===1);
  return {status:statusComparable?(primary.status.code===other.status.code?'same':'different'):'unavailable',
    group:statusComparable?(primary.status.group===other.status.group?'same':'different'):'unavailable',
    sdg:sdgComparable?(primary.sdg.code===other.sdg.code?'same':'different'):'unavailable',
    label:statusComparable?(primary.status.code===other.status.code?'두 방법의 상태 분류 일치':'두 방법의 상태 분류 불일치'):'비교할 유효 자료 부족',
    limitation:'토지피복·토양탄소 입력이 공유됩니다. 방법 간 민감도 비교이며 독립 현장 검증이나 정확도 점수가 아닙니다.'};
}

export function selectDegradationOverview(images,bounds,width,height){
  const target=Math.min((bounds[2]-bounds[0])/width,(bounds[3]-bounds[1])/height);
  let chosen=images[0];
  for(const image of images)if(Math.max(...image.resolutionDegrees)<=target)chosen=image;
  return chosen;
}

// CanvasSource interpolates texture rows in Web Mercator, not degrees latitude.
// Sample at those projected row centres so high-latitude classifications stay aligned.
export function degradationGridRowLatitudes(bounds,height,projection='EPSG:3857'){
  if(!Number.isInteger(height)||height<1)throw new RangeError('유효한 행 개수가 필요합니다.');
  if(projection==='EPSG:4326')return Array.from({length:height},(_,y)=>bounds[3]-(y+0.5)*(bounds[3]-bounds[1])/height);
  if(projection!=='EPSG:3857')throw new RangeError('지원하지 않는 표시 좌표계입니다.');
  const mercator=lat=>Math.asinh(Math.tan(lat*Math.PI/180));
  const north=mercator(bounds[3]),south=mercator(bounds[1]);
  return Array.from({length:height},(_,y)=>Math.atan(Math.sinh(north-(y+0.5)*(north-south)/height))*180/Math.PI);
}

let libraryPromise;
async function loadLibrary(){
  if(!libraryPromise)libraryPromise=import('./vendor/geotiff/geotiff.js').then(module=>{
    const library=module.fromCustomClient?module:module.default?.fromCustomClient?module.default:globalThis.GeoTIFF;
    if(!library?.fromCustomClient)throw new Error('GeoTIFF 읽기 도구를 불러오지 못했습니다.');return library;
  }).catch(error=>{libraryPromise=null;throw error;});
  return libraryPromise;
}

/** Create an isolated reader; dependencies may be injected for validation. */
export function createDegradationReader({manifest:providedManifest,fetchImpl=globalThis.fetch,decoder}={}){
  let manifestPromise;
  const datasets=new Map(),serial=queue(1);
  async function manifest(signal){
    checkAbort(signal);
    if(providedManifest)return providedManifest;
    if(!manifestPromise)manifestPromise=fetchImpl(new URL('./data/degradation-cogs.json',import.meta.url),{signal}).then(async response=>{
      if(!response.ok)throw new Error('공식 자료 목록을 읽을 수 없습니다.');const data=await response.json();
      if(data.schemaVersion!==1||data.statusYear!==2023||!Array.isArray(data.sources))throw new Error('자료 목록 형식이 예상과 다릅니다.');return data;
    }).catch(error=>{manifestPromise=null;throw error;});
    const result=await manifestPromise;checkAbort(signal);return result;
  }
  async function operate(provider,options,callback){
    return serial(async()=>{
      checkAbort(options.signal);
      const sourceManifest=await manifest(options.signal);
      const source=sourceManifest.sources.find(item=>item.id===provider||(provider==='te'&&item.id==='trends-earth'));
      if(!source)throw new Error('요청한 자료 제공기관을 찾을 수 없습니다.');
      const controller=new AbortController(),abort=()=>controller.abort(options.signal.reason||abortError());
      if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>controller.abort(new DOMException('지형 자료 부분 읽기 시간이 초과되었습니다.','TimeoutError')),Math.min(60000,Math.max(100,options.timeoutMs??45000)));
      const context={signal:controller.signal,requests:0,bytes:0,transferredBytes:0};
      let dataset=datasets.get(provider);
      try{
        if(!dataset){
          dataset={context,images:null,uses:0};
          const library=decoder||await loadLibrary();
          const client=createBoundedRangeClient(source.url,{getContext:()=>dataset.context,fetchImpl});
          dataset.tiff=await library.fromCustomClient(client,{allowFullFile:false,maxRanges:0,blockSize:65536,cacheSize:64},controller.signal);
          const native=await dataset.tiff.getImage();
          const keys=native.getGeoKeys(),origin=native.getOrigin(),resolution=native.getResolution();
          if(keys?.GeographicTypeGeoKey!==4326||keys?.ProjectedCSTypeGeoKey||resolution[0]<=0||resolution[1]>=0||native.getSamplesPerPixel()!==14||native.getGDALNoData()!==DEGRADATION_NODATA||native.getSampleFormat()!==2)throw new Error('원본의 좌표계·밴드·결측 정의가 검증 목록과 다릅니다.');
          if(native.getWidth()!==source.width||native.getHeight()!==source.height||Math.abs(origin[0]-source.origin[0])>1e-8||Math.abs(origin[1]-source.origin[1])>1e-8||Math.abs(resolution[0]-source.pixelSizeDegrees[0])>1e-10)throw new Error('원본 자료의 해상도·위치가 검증 목록과 일치하지 않습니다.');
          const count=await dataset.tiff.getImageCount();
          if(count<2||count>16)throw new Error('안전한 축소 지도를 찾을 수 없습니다.');
          dataset.images=[];
          for(let i=0;i<count;i++){
            const image=i===0?native:await dataset.tiff.getImage(i),res=image.getResolution(native);
            dataset.images.push({index:i,image,width:image.getWidth(),height:image.getHeight(),resolutionDegrees:[res[0],Math.abs(res[1])]});
          }
          dataset.images.sort((a,b)=>a.resolutionDegrees[0]-b.resolutionDegrees[0]);
          dataset.metadata={provider,providerName:source.name,sourceUrl:source.url,width:native.getWidth(),height:native.getHeight(),origin:origin.slice(0,2),
            resolutionDegrees:[resolution[0],Math.abs(resolution[1])],extent:native.getBoundingBox(),noData:DEGRADATION_NODATA,
            bands:source.bands,nominalResolutionMetersAtEquator:source.nominalResolutionMetersAtEquator,statusYear:sourceManifest.statusYear,
            overviewCount:count-1,overviewResampling:source.overviewResampling};
          datasets.set(provider,dataset);
        }
        dataset.context=context;
        const value=await callback(dataset,sourceManifest);checkAbort(controller.signal);checkAbort(options.signal);
        // Retire IFDs periodically as their lazy indexed-offset caches can also grow.
        dataset.uses++;if(dataset.uses>=24)datasets.delete(provider);
        return {...value,transfer:{requests:context.requests,requestedBytes:context.bytes,transferredBytes:context.transferredBytes,fullFileDownloaded:false}};
      }catch(error){
        datasets.delete(provider);checkAbort(options.signal);checkAbort(controller.signal);
        // GeoTIFF BlockedSource replaces failed block causes with a generic aggregate.
        // Preserve our strict client's concrete HTTP/range/network error for the UI.
        if(error?.message==='Request failed'&&context.lastError)throw context.lastError;
        throw error;
      }
      finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
    });
  }
  async function loadDegradation(options={}){
    const sourceManifest=await manifest(options.signal);
    const data=await operate('te',options,async dataset=>({metadata:dataset.metadata}));
    return {manifest:sourceManifest,providers:{te:data.metadata},transfer:data.transfer};
  }
  async function sampleProvider(lng,lat,provider,options,samples=nativeSamples){
    return operate(provider,options,async(dataset,sourceManifest)=>{
      const pixel=pointToDegradationPixel(lng,lat,dataset.metadata);
      let bands=Array(14).fill(DEGRADATION_NODATA);
      if(pixel){
        const image=dataset.images.find(item=>item.index===0).image;
        const data=await image.readRasters({window:[pixel.x,pixel.y,pixel.x+1,pixel.y+1],samples,interleave:true,signal:dataset.context.signal});
        if(data.length!==samples.length)throw new Error('원본 픽셀 밴드 개수가 일치하지 않습니다.');
        samples.forEach((band,i)=>{bands[band]=data[i];});
      }
      return decodeDegradationPoint(bands,dataset.metadata,sourceManifest,pixel);
    });
  }
  async function sampleDegradation(lng,lat,options={}){
    const primary=await sampleProvider(lng,lat,'te',options),errors=[];
    let comparison=null;
    if(options.crossCheck!==false){
      try{const other=await sampleProvider(lng,lat,'jrc',options,[9,13]);comparison={...other,agreement:compareDegradationMethods(primary,other)};}
      catch(error){checkAbort(options.signal);errors.push({provider:'jrc',message:String(error.message||error)});}
    }
    checkAbort(options.signal);const sourceManifest=await manifest(options.signal);
    return {coordinate:[(((lng+180)%360)+360)%360-180,lat],primary,comparison,errors,sourceUrls:[primary.sourceUrl,...(comparison?[comparison.sourceUrl]:[])],
      checkedAt:new Date().toISOString(),statusYear:sourceManifest.statusYear,baseline:sourceManifest.baseline,publicationDate:sourceManifest.publicationDate,
      verdict:'published-land-degradation-estimate',scope:'2023년 상태의 공개 전 지구 추정자료를 원본 픽셀에서 읽었습니다. 실시간 촬영·국가 확정 판정·현장 검증 결과가 아닙니다.',
      desertificationConfirmed:false,limitation:'황폐화 지표만으로 건조지 사막화를 확정하거나 미래 위험 확률을 계산할 수 없습니다.'};
  }
  async function readDegradationGrid(input,options={}){
    const bounds=normalizeDegradationBounds(input);
    const projection=options.projection??'EPSG:3857';
    if(projection==='EPSG:3857'){bounds[1]=Math.max(-85.0511287798066,bounds[1]);bounds[3]=Math.min(85.0511287798066,bounds[3]);}
    if(bounds[3]<=bounds[1])throw new RangeError('표시 지도 좌표계의 범위를 벗어났습니다.');
    const width=Math.min(384,Math.max(16,Math.round(options.width??192))),height=Math.min(256,Math.max(16,Math.round(options.height??128)));
    if(!finite(width)||!finite(height))throw new RangeError('지도 출력 크기가 잘못되었습니다.');
    const rowLatitudes=degradationGridRowLatitudes(bounds,height,projection);
    return operate('te',options,async(dataset,sourceManifest)=>{
      const chosen=selectDegradationOverview(dataset.images,bounds,width,height),[dx,dy]=chosen.resolutionDegrees,[originX,originY]=dataset.metadata.origin;
      const output=new Int16Array(width*height).fill(DEGRADATION_NODATA);
      const sampleCoordinates=[];
      // Wrap longitude before sampling, so windows crossing the dateline remain correct.
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const lat=rowLatitudes[y],rawLng=bounds[0]+(x+0.5)*(bounds[2]-bounds[0])/width;
        const lng=(((rawLng+180)%360)+360)%360-180;
        sampleCoordinates.push({out:y*width+x,x:Math.floor((lng-originX)/dx),y:Math.floor((originY-lat)/dy)});
      }
      // Group by source tile to avoid allocating a worldwide native-resolution window.
      const tileWidth=chosen.image.getTileWidth(),tileHeight=chosen.image.getTileHeight(),tiles=new Map();
      for(const sample of sampleCoordinates){
        if(sample.x<0||sample.y<0||sample.x>=chosen.width||sample.y>=chosen.height)continue;
        const tx=Math.floor(sample.x/tileWidth),ty=Math.floor(sample.y/tileHeight),key=`${tx},${ty}`;
        if(!tiles.has(key))tiles.set(key,{tx,ty,samples:[]});tiles.get(key).samples.push(sample);
      }
      if(tiles.size>48)throw new Error('지도 타일 수가 한도를 넘었습니다. 화면 범위를 조정해 주세요.');
      for(const {tx,ty,samples} of tiles.values()){
        checkAbort(dataset.context.signal);
        const left=Math.min(...samples.map(p=>p.x)),top=Math.min(...samples.map(p=>p.y)),right=Math.max(...samples.map(p=>p.x))+1,bottom=Math.max(...samples.map(p=>p.y))+1;
        const data=await chosen.image.readRasters({window:[left,top,right,bottom],samples:[13],interleave:true,signal:dataset.context.signal});
        const rowWidth=right-left;
        for(const sample of samples){const value=data[(sample.y-top)*rowWidth+sample.x-left];if(Number.isInteger(value)&&value>=1&&value<=7)output[sample.out]=value;}
      }
      return {values:output,width,height,bounds,coordinates:[[bounds[0],bounds[3]],[bounds[2],bounds[3]],[bounds[2],bounds[1]],[bounds[0],bounds[1]]],
        noData:DEGRADATION_NODATA,band:14,provider:'te',projection,overviewIndex:chosen.index,resolutionDegrees:chosen.resolutionDegrees,
        nativeResolutionDegrees:dataset.metadata.resolutionDegrees,sourceUrl:dataset.metadata.sourceUrl,statusYear:sourceManifest.statusYear,baseline:sourceManifest.baseline,
        resampling:chosen.index?'source MODE overview, nearest sample':'native pixel, nearest sample',
        scope:'화면 표시용 대표 셀입니다. 면적·황폐화 비율 통계가 아니며 작은 변화 구역은 축소 과정에서 보이지 않을 수 있습니다.'};
    });
  }
  return {loadDegradation,sampleDegradation,readDegradationGrid,clear(){datasets.clear();}};
}
const defaultReader=createDegradationReader();
export const loadDegradation=options=>defaultReader.loadDegradation(options);
export const sampleDegradation=(lng,lat,options)=>defaultReader.sampleDegradation(lng,lat,options);
export const readDegradationGrid=(bounds,options)=>defaultReader.readDegradationGrid(bounds,options);
