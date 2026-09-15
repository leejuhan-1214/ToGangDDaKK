// Live public NASA / ORNL observations. No generated environmental values.
// MOD17 NPP is a satellite-driven carbon model, NOT a desertification diagnosis.
export const OBSERVATION_SOURCES = Object.freeze({
  product:'https://doi.org/10.5067/MODIS/MOD17A3HGF.061',
  methodology:'https://lpdaac.usgs.gov/documents/972/MOD17_User_Guide_V61.pdf',
  service:'https://modis.ornl.gov/data/modis_webservice.html',
  rainfallMethodology:'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/',
});
const BASE='https://modis.ornl.gov/rst/api/v1/MOD17A3HGF';
const cache=new Map();
const CACHE_TTL=12*60*60*1000, CACHE_LIMIT=128;
const fillReasons={32767:'missing',32766:'water',32765:'barren-or-sparse',32764:'snow-or-ice',32763:'wetland',32762:'urban',32761:'unclassified'};
const qcReasons={255:'missing',254:'water',253:'barren-or-sparse',252:'snow-or-ice',251:'wetland',250:'urban',249:'unclassified'};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length?a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2:null;};

export function normalizeCoordinate(lng,lat){
  if(!finite(lng)||!finite(lat)||lat < -90||lat > 90)throw new RangeError('유효한 경도·위도가 필요합니다.');
  return [Number(((((lng+180)%360)+360)%360-180).toFixed(5)),Number(lat.toFixed(5))];
}

export function normalizeNpp(raw,qualityPercent,{maxGapFillPercent=50}={}){
  if(!finite(maxGapFillPercent)||maxGapFillPercent<0||maxGapFillPercent>100)throw new RangeError('Invalid quality threshold');
  const validRaw=Number.isInteger(raw)&&raw>=-30000&&raw<=32700;
  const validQuality=Number.isInteger(qualityPercent)&&qualityPercent>=0&&qualityPercent<=100;
  const reason=(Number.isInteger(raw)?fillReasons[raw]:null)||(Number.isInteger(qualityPercent)?qcReasons[qualityPercent]:null)||(!validRaw?'invalid-npp':!validQuality?'missing-quality':qualityPercent>maxGapFillPercent?'high-gap-fill':null);
  return {nppKgC:reason?null:Number((raw*0.0001).toFixed(4)),rawNpp:finite(raw)?raw:null,
    rawNppKgC:validRaw?Number((raw*0.0001).toFixed(4)):null,qualityPercent:validQuality?qualityPercent:null,rawQuality:finite(qualityPercent)?qualityPercent:null,reason};
}

export function normalizeAnnualDates(payload,{lastCompleteYear=new Date().getUTCFullYear()-1,maxYears=25}={}){
  if(!Array.isArray(payload?.dates))throw new Error('관측 날짜 목록을 읽을 수 없습니다.');
  const years=new Map();
  for(const row of payload.dates){
    const match=/^A(\d{4})001$/.exec(row?.modis_date);
    if(!match)continue;
    const year=Number(match[1]);
    if(year>=2001&&year<=lastCompleteYear&&row.calendar_date===`${year}-01-01`)years.set(year,{year,modisDate:row.modis_date,date:row.calendar_date});
  }
  return [...years.values()].sort((a,b)=>a.year-b.year).slice(-Math.min(25,Math.max(1,maxYears)));
}

export function normalizeNppSubset(payload,dates,options={}){
  if(payload?.nrows!==1||payload?.ncols!==1||!Array.isArray(payload.subset))throw new Error('예상한 단일 위성 픽셀이 아닙니다.');
  const pixel={cellSizeM:Number(payload.cellsize),xllcorner:Number(payload.xllcorner),yllcorner:Number(payload.yllcorner),projection:'MODIS Sinusoidal'};
  if(!finite(pixel.cellSizeM)||pixel.cellSizeM<=0||!finite(pixel.xllcorner)||!finite(pixel.yllcorner))throw new Error('위성 픽셀 위치 정보가 없습니다.');
  const byDate=new Map();
  for(const row of payload.subset){
    if(!['Npp_500m','Npp_QC_500m'].includes(row.band))continue;
    if(!Array.isArray(row.data)||row.data.length!==1)throw new Error('위성 픽셀 크기가 예상과 다릅니다.');
    const values=byDate.get(row.modis_date)||{};
    if(Object.hasOwn(values,row.band))throw new Error('중복 관측값으로 분석을 중단했습니다.');
    values[row.band]=row.data[0];byDate.set(row.modis_date,values);
  }
  return {pixel,series:dates.map(date=>{
    const row=byDate.get(date.modisDate);
    return {...date,...normalizeNpp(row?.Npp_500m,row?.Npp_QC_500m,options)};
  })};
}

// Two-sided normal approximation; ties + continuity correction are handled below.
function normalCdf(x){
  const z=Math.abs(x),t=1/(1+0.2316419*z);
  const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?1-tail:tail;
}

export function calculateProductivityTrend(series,{minYears=15,minCoverage=0.7}={}){
  const points=series.filter(row=>Number.isInteger(row.year)&&finite(row.nppKgC)).sort((a,b)=>a.year-b.year);
  if(new Set(points.map(row=>row.year)).size!==points.length)throw new Error('Trend requires one observation per year');
  const n=points.length,span=n?points.at(-1).year-points[0].year+1:0;
  const requestedYears=series.filter(row=>Number.isInteger(row.year)).map(row=>row.year);
  const requestedSpan=requestedYears.length?Math.max(...requestedYears)-Math.min(...requestedYears)+1:0;
  const coverage=requestedSpan?n/requestedSpan:0;
  const base={status:'insufficient-data',validYears:n,spanYears:span,coverage,slopePerYear:null,pValue:null,tau:null,
    method:'Theil–Sen slope + tie-corrected Mann–Kendall (two-sided, nominal p)',
    unit:'kg C/m²/year per year',minimumYears:minYears,minimumCoverage:minCoverage,
    scope:'선택한 500m급 픽셀의 연간 생산성 추세',
    limitation:'위성 기반 모형의 탐색적 추세입니다. 연속 연도 간 상관과 여러 지점의 반복 검정은 보정하지 않았으며 사막화 확정·위험 확률이 아닙니다.'};
  if(n<minYears||span<minYears||coverage<minCoverage)return base;
  const slopes=[],ties=new Map();let s=0;
  for(let i=0;i<n;i++){
    ties.set(points[i].nppKgC,(ties.get(points[i].nppKgC)||0)+1);
    for(let j=i+1;j<n;j++){
      const delta=points[j].nppKgC-points[i].nppKgC;
      s+=Math.sign(delta);slopes.push(delta/(points[j].year-points[i].year));
    }
  }
  const tieCorrection=[...ties.values()].reduce((total,t)=>total+t*(t-1)*(2*t+5),0);
  const variance=(n*(n-1)*(2*n+5)-tieCorrection)/18;
  const z=variance>0?(s>0?s-1:s<0?s+1:0)/Math.sqrt(variance):0;
  const pValue=Math.max(0,Math.min(1,2*(1-normalCdf(Math.abs(z)))));
  const slopePerYear=median(slopes);
  return {...base,status:pValue<0.05&&slopePerYear<0?'declining':pValue<0.05&&slopePerYear>0?'increasing':'no-clear-trend',
    slopePerYear,pValue,tau:s/(n*(n-1)/2),firstYear:points[0].year,lastYear:points.at(-1).year};
}

export function normalizeRainfall(payload,startYear,endYear){
  if(payload?.parameters?.PRECTOTCORR?.units!=='mm/day'||!payload?.properties?.parameter?.PRECTOTCORR)throw new Error('강수량 자료의 단위가 예상과 다릅니다.');
  const values=payload.properties.parameter.PRECTOTCORR,fill=payload.header?.fill_value;
  const series=Array.from({length:endYear-startYear+1},(_,i)=>{
    const year=startYear+i,months=Array.from({length:12},(_,m)=>values[`${year}${String(m+1).padStart(2,'0')}`]);
    const good=months.every(value=>finite(value)&&value>=0&&value!==fill);
    return {year,precipitationMm:good?Number(months.reduce((sum,v,m)=>sum+v*new Date(Date.UTC(year,m+1,0)).getUTCDate(),0).toFixed(2)):null};
  });
  return {series,validYears:series.filter(row=>row.precipitationMm!==null).length,
    sources:payload.header?.sources||[],unit:'mm/year',resolution:'MERRA-2 약 0.5° × 0.625° 격자',
    methodology:'월평균 일강수량 × 각 월의 일수를 12개월 합산한 근사 연강수량입니다.',
    limitation:'넓은 기상 격자의 재분석 자료이며 500m 픽셀의 직접 강우 관측이나 건조지 판정이 아닙니다.'};
}

function abortError(){return new DOMException('취소된 관측 요청입니다.','AbortError');}
function checkAbort(signal){if(signal?.aborted)throw signal.reason||abortError();}
function putCache(key,data){cache.delete(key);cache.set(key,{time:Date.now(),data:structuredClone(data)});while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);}
export function clearObservationCache(){cache.clear();}

async function getJson(url,{signal,fetchImpl,timeoutMs,cacheEnabled,onRecord}){
  checkAbort(signal);
  const cached=cacheEnabled&&cache.get(url);
  if(cached&&Date.now()-cached.time<CACHE_TTL){onRecord?.({url,fetchedAt:new Date(cached.time).toISOString(),cacheHit:true});return structuredClone(cached.data);}
  const controller=new AbortController();
  const abort=()=>controller.abort(signal.reason||abortError());
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('자료 제공기관의 응답 시간이 초과되었습니다.','TimeoutError')),timeoutMs);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`자료 제공기관 HTTP ${response.status}`);
    const json=await response.json();checkAbort(signal);checkAbort(controller.signal);
    if(cacheEnabled)putCache(url,json);
    onRecord?.({url,fetchedAt:new Date().toISOString(),cacheHit:false});
    return json;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function makeQueue(max=2){
  let active=0;const waiting=[];
  const next=()=>{if(active>=max||!waiting.length)return;const {fn,resolve,reject}=waiting.shift();active++;Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;next();});};
  return fn=>new Promise((resolve,reject)=>{waiting.push({fn,resolve,reject});next();});
}

/** One clicked point, latest <=25 completed annual observations; normally 6 requests.
 * Returns partial evidence on provider errors; cancellation rejects with AbortError.
 * onProgress receives {phase,completed,total}. Cache lasts 12 h, max 128 URLs.
 * QC <=50% is this app's conservative screening choice, not a NASA rejection rule.
 */
export async function fetchPointObservations(lng,lat,options={}){
  const coordinate=normalizeCoordinate(lng,lat),[longitude,latitude]=coordinate;
  const {signal,onProgress,fetchImpl=globalThis.fetch,maxGapFillPercent=50}=options;
  checkAbort(signal);normalizeNpp(0,0,{maxGapFillPercent});
  const timeoutMs=Math.min(60000,Math.max(10,options.timeoutMs??45000));
  const lastCompleteYear=(options.now?new Date(options.now):new Date()).getUTCFullYear()-1;
  const queue=makeQueue(2),errors=[],missingFlags=[],sourceRequests=[];
  let completed=0,total=2;
  const request=url=>queue(async()=>{
    try{return await getJson(url,{signal,fetchImpl,timeoutMs,cacheEnabled:options.cache!==false,onRecord:record=>sourceRequests.push(record)});}
    finally{completed++;onProgress?.({phase:'observations',completed,total});}
  });
  const sourceUrls={...OBSERVATION_SOURCES,bands:`${BASE}/bands`,dates:`${BASE}/dates?latitude=${latitude}&longitude=${longitude}`,subsets:[],rainfall:null};
  onProgress?.({phase:'metadata',completed,total});
  const recordError=(source,error)=>{checkAbort(signal);errors.push({source,message:String(error.message||error)});missingFlags.push(`${source}-unavailable`);};
  const [dateResult,bandResult]=await Promise.allSettled([request(sourceUrls.dates),request(sourceUrls.bands)]);
  checkAbort(signal);
  let dates=[],metadataValid=false;
  if(dateResult.status==='fulfilled'){
    try{dates=normalizeAnnualDates(dateResult.value,{lastCompleteYear,maxYears:options.maxYears??25});}
    catch(error){recordError('dates',error);}
  }else recordError('dates',dateResult.reason);
  if(bandResult.status==='fulfilled'){
    const band=bandResult.value?.bands?.find(row=>row.band==='Npp_500m');
    metadataValid=Number(band?.scale_factor)===0.0001&&Number(band?.add_offset)===0&&String(band?.valid_range)==='-30000 to 32700';
    if(!metadataValid)recordError('metadata',new Error('생산성 단위·축척이 공식 정의와 일치하지 않습니다.'));
  }else recordError('metadata',bandResult.reason);
  const batches=[];
  if(metadataValid)for(let i=0;i<dates.length;i+=10)batches.push(dates.slice(i,i+10));
  const period=dates.length?{start:dates[0].year,end:dates.at(-1).year}:null;
  const rainStart=period?.start??Math.max(2001,lastCompleteYear-24),rainEnd=period?.end??lastCompleteYear;
  sourceUrls.rainfall=`https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR&community=AG&longitude=${longitude}&latitude=${latitude}&format=JSON&start=${rainStart}&end=${rainEnd}`;
  total+=batches.length+1;
  let pixel=null,climate=null;
  const seriesByYear=new Map(dates.map(date=>[date.year,{...date,nppKgC:null,qualityPercent:null,rawNpp:null,rawNppKgC:null,rawQuality:null,reason:metadataValid?'request-failed':'metadata-unverified'}]));
  const jobs=batches.map(batch=>{
    const url=`${BASE}/subset?latitude=${latitude}&longitude=${longitude}&startDate=${batch[0].modisDate}&endDate=${batch.at(-1).modisDate}&kmAboveBelow=0&kmLeftRight=0`;
    sourceUrls.subsets.push(url);
    return request(url).then(payload=>{
      if(!finite(payload.latitude)||!finite(payload.longitude)||Math.abs(payload.latitude-latitude)>0.00001||Math.abs(payload.longitude-longitude)>0.00001)throw new Error('응답 좌표가 선택한 지점과 다릅니다.');
      const result=normalizeNppSubset(payload,batch,{maxGapFillPercent});
      if(pixel&&(pixel.xllcorner!==result.pixel.xllcorner||pixel.yllcorner!==result.pixel.yllcorner||pixel.cellSizeM!==result.pixel.cellSizeM))throw new Error('연도별 위성 픽셀 위치가 서로 다릅니다.');
      pixel=result.pixel;for(const row of result.series)seriesByYear.set(row.year,{...row,sourceUrl:url});
    }).catch(error=>recordError('npp',error));
  });
  jobs.push(request(sourceUrls.rainfall).then(data=>{climate=normalizeRainfall(data,rainStart,rainEnd);}).catch(error=>recordError('rainfall',error)));
  await Promise.all(jobs);checkAbort(signal);
  const series=[...seriesByYear.values()].sort((a,b)=>a.year-b.year),valid=series.filter(row=>row.nppKgC!==null);
  const reasonCounts=series.filter(row=>row.reason).reduce((out,row)=>{out[row.reason]=(out[row.reason]||0)+1;return out;},{});
  if(!dates.length)missingFlags.push('no-published-annual-observations');
  if(valid.length<15)missingFlags.push('insufficient-productivity-years');
  if(series.some(row=>row.reason))missingFlags.push('excluded-observations');
  if(climate&&climate.validYears<climate.series.length)missingFlags.push('incomplete-rainfall');
  // These data requirements are not supplied by NPP + precipitation alone.
  missingFlags.push('land-cover-change-not-validated','soil-carbon-not-validated','dryland-aridity-not-validated','local-field-validation-missing');
  const observationRetrievals=sourceRequests.filter(row=>row.url.includes('/subset?')||row.url===sourceUrls.rainfall).map(row=>row.fetchedAt).sort();
  const result={schemaVersion:1,coordinate,retrievedAt:observationRetrievals[0]??null,checkedAt:new Date().toISOString(),cacheUsed:sourceRequests.some(row=>row.cacheHit),sourceRequests,product:'MOD17A3HGF',productLabel:'NASA MODIS 연간 순일차생산성',
    period,latestObservation:valid.at(-1)||null,latestPublishedYear:period?.end??null,series,pixel,
    quality:{validYears:valid.length,totalYears:series.length,excludedYears:series.length-valid.length,reasonCounts,maxGapFillPercent,
      note:`연간 유효 범위와 QC를 검사하며, 입력 보간 일수 비율 ${maxGapFillPercent}% 초과는 이 앱의 보수적 기준으로 추세 계산에서 제외합니다. QC는 확률이나 비트 플래그가 아닙니다.`},
    trend:calculateProductivityTrend(series),climate,sourceUrls,missingFlags:[...new Set(missingFlags)],errors,
    scope:'선택 좌표가 속한 500m급 위성 픽셀 1개입니다. 화면 전체·국가 전체 평균이 아닙니다.',
    timeliness:'제공기관의 최신 완료 연도 자료를 조회하며, 같은 요청은 최대 12시간 임시 보관합니다. 위성 촬영이나 사막화 실시간 확정 서비스가 아닙니다.',
    verdict:'not-confirmed',verdictLabel:'사막화 확정 불가',
    limitation:'MOD17은 위성 관측과 기상 입력으로 계산된 생산성 모형입니다. 강수 맥락과 함께 검토하되, 건조지 해당 여부·토지피복 변화·토양유기탄소·현장 검증 없이 사막화로 판정하지 않습니다.'};
  onProgress?.({phase:'complete',completed,total});return result;
}

// Optional UI helper: a new selection cancels earlier requests and stale results.
export function createObservationLoader(defaults={}){
  let controller=null,generation=0;
  return {
    cancel(){generation++;controller?.abort(abortError());controller=null;},
    async load(lng,lat,options={}){
      controller?.abort(abortError());const own=new AbortController();controller=own;const id=++generation;
      const externalAbort=()=>own.abort(options.signal.reason||abortError());
      if(options.signal?.aborted)externalAbort();else options.signal?.addEventListener('abort',externalAbort,{once:true});
      try{const result=await fetchPointObservations(lng,lat,{...defaults,...options,signal:own.signal});if(id!==generation)throw abortError();return result;}
      finally{options.signal?.removeEventListener('abort',externalAbort);if(id===generation)controller=null;}
    }
  };
}
