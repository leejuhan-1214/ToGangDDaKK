/** Actual point observations only. Annual label differences are not verified land-cover change. */
export const LAND_COVER_SOURCE=Object.freeze({
 product:'MCD12Q1',provider:'NASA · ORNL DAAC',nominalResolutionMeters:500,
 api:'https://modis.ornl.gov/rst/api/v1/MCD12Q1',
 documentation:'https://modis.ornl.gov/data/modis_webservice.html',
 guide:'https://lpdaac.usgs.gov/documents/1409/MCD12_User_Guide_V61.pdf',
 collection:null,
 collectionNote:'ORNL 응답에는 collection 식별자가 없어 특정 판본을 단정하지 않습니다. QC는 C6/C6.1 공통 범례를 적용합니다.',
 warning:'연도별 분류명 차이는 실제 토지피복 변화나 사막화의 확정 근거가 아닙니다. 제공기관도 분류 불확실성 때문에 연도별 분류를 직접 비교해 변화를 판정하지 않도록 안내합니다.'
});
export const LAND_COVER_CLASSES=Object.freeze({
 1:'상록 침엽수림',2:'상록 활엽수림',3:'낙엽 침엽수림',4:'낙엽 활엽수림',5:'혼합림',
 6:'밀집 관목지',7:'개방 관목지',8:'수목 사바나',9:'사바나',10:'초지',11:'상시 습지',
 12:'농경지',13:'도시·인공 지표',14:'농경지·자연 식생 혼합',15:'상설 눈·얼음',16:'나지',17:'수역'
});
const QC_LABELS=Object.freeze({0:'분류된 육지',1:'결측 때문에 분류되지 않은 육지',2:'분류된 수역',3:'분류되지 않은 수역',4:'해빙 보정',5:'수역 오분류 보정',6:'눈·얼음 누락 보정',7:'눈·얼음 오분류 보정',8:'분류값 보충',9:'기후에 따른 산림 분류 보정',10:'수역 마스크 결측'});
const validClass=value=>Number.isInteger(value)&&value>=1&&value<=17;
const validNumber=value=>typeof value==='number'&&Number.isFinite(value);
const rawValue=row=>row&&Array.isArray(row.data)&&row.data.length===1&&Number.isInteger(row.data[0])?row.data[0]:null;
const sameGrid=(a,b)=>Boolean(a&&b&&typeof a.tile==='string'&&typeof a.proc_date==='string'&&a.tile===b.tile&&a.proc_date===b.proc_date);

export function parseLandCoverPoint(payload,dates){
 if(!payload||payload.nrows!==1||payload.ncols!==1||!Array.isArray(payload.subset))throw new Error('토지피복 응답이 단일 관측 픽셀 형식이 아닙니다.');
 const groups=new Map();
 for(const row of payload.subset){
  if(!['LC_Type1','QC','LW'].includes(row.band))continue;
  const key=`${row.modis_date}/${row.band}`;
  if(groups.has(key))throw new Error('같은 연도·밴드의 토지피복 관측이 중복되었습니다.');
  groups.set(key,row);
 }
 return dates.map(date=>{
  const cover=groups.get(`${date.modis_date}/LC_Type1`),qcRow=groups.get(`${date.modis_date}/QC`),waterRow=groups.get(`${date.modis_date}/LW`);
  const rawClass=rawValue(cover),qc=rawValue(qcRow),landWater=rawValue(waterRow);
  const aligned=sameGrid(cover,qcRow)&&sameGrid(cover,waterRow)&&[cover,qcRow,waterRow].every(row=>row.calendar_date===date.calendar_date);
  const acceptedLand=aligned&&validClass(rawClass)&&rawClass!==17&&qc===0&&landWater===2;
  const acceptedWater=aligned&&rawClass===17&&qc===2&&landWater===1;
  const accepted=acceptedLand||acceptedWater;
  const reason=accepted?null:!cover||!qcRow||!waterRow?'필수 관측 또는 품질자료 없음':!aligned?'관측 날짜·타일·처리 버전 불일치':!validClass(rawClass)?'미분류 또는 결측':qc!==0&&qc!==2?'보충·재분류·미분류 품질 상태': '토지피복·수역 마스크 불일치';
  return {year:Number(date.calendar_date.slice(0,4)),date:date.calendar_date,modisDate:date.modis_date,rawClass,qc,landWater,
   classCode:accepted?rawClass:null,label:accepted?LAND_COVER_CLASSES[rawClass]:null,
   status:acceptedLand?'classified-land':acceptedWater?'classified-water':'excluded',accepted,
   qualityLabel:QC_LABELS[qc]??'품질자료 없음',reason,tile:cover?.tile??null,processingDate:cover?.proc_date??null};
 });
}

export function summarizeLandCover(observations){
 const sorted=[...observations].sort((a,b)=>a.year-b.year),first=sorted[0]??null,latest=sorted.at(-1)??null;
 const accepted=sorted.filter(row=>row.accepted),different=first?.accepted&&latest?.accepted?first.classCode!==latest.classCode:null;
 return {
  latest,first,latestAccepted:accepted.at(-1)??null,
  availableCount:sorted.length,acceptedCount:accepted.length,excludedCount:sorted.length-accepted.length,
  labelDifference:different===null?null:{fromYear:first.year,toYear:latest.year,fromCode:first.classCode,toCode:latest.classCode,fromLabel:first.label,toLabel:latest.label,different},
  verifiedLandCoverChange:null,desertificationVerdict:null,
  warning:LAND_COVER_SOURCE.warning
 };
}

function validDates(payload){
 if(!Array.isArray(payload?.dates))throw new Error('토지피복 제공 연도 목록을 읽지 못했습니다.');
 const dates=payload.dates.filter(row=>/^A\d{4}001$/.test(row?.modis_date)&&/^\d{4}-01-01$/.test(row?.calendar_date)&&row.modis_date.slice(1,5)===row.calendar_date.slice(0,4));
 const unique=new Map(dates.map(row=>[row.modis_date,row]));
 return [...unique.values()].sort((a,b)=>a.modis_date.localeCompare(b.modis_date));
}

async function getJson(url,{fetchImpl,signal,timeoutMs}){
 const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
 const response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:requestSignal});
 if(!response.ok)throw new Error(`NASA 토지피복 자료 요청 실패 (HTTP ${response.status})`);
 return response.json();
}

/** At most four requests: dates, then <= 3 batches of at most 10 annual composites. */
export async function loadLandCoverHistory({lat,lng,signal,fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
 if(!validNumber(lat)||!validNumber(lng)||lat<=-90||lat>=90||lng<-180||lng>180)throw new Error('유효한 위도·경도가 필요합니다.');
 if(typeof fetchImpl!=='function')throw new Error('이 환경은 관측자료 요청을 지원하지 않습니다.');
 signal?.throwIfAborted();
 const requestUrls=[],request=async url=>{requestUrls.push(url);return getJson(url,{fetchImpl,signal,timeoutMs});};
 const coordinateParams=new URLSearchParams({latitude:String(lat),longitude:String(lng)});
 const datesUrl=`${LAND_COVER_SOURCE.api}/dates?${coordinateParams}`;
 const allDates=validDates(await request(datesUrl)),dates=allDates.slice(-30),observations=[];
 let pixel=null;
 for(let start=0;start<dates.length;start+=10){
  signal?.throwIfAborted();
  const chunk=dates.slice(start,start+10),params=new URLSearchParams(coordinateParams);
  params.set('startDate',chunk[0].modis_date);params.set('endDate',chunk.at(-1).modis_date);
  params.set('kmAboveBelow','0');params.set('kmLeftRight','0');
  const payload=await request(`${LAND_COVER_SOURCE.api}/subset?${params}`);
  if(payload.latitude!==lat||payload.longitude!==lng)throw new Error('요청 지점과 토지피복 응답 좌표가 일치하지 않습니다.');
  const cellsize=Number(payload.cellsize),xllcorner=Number(payload.xllcorner),yllcorner=Number(payload.yllcorner);
  if(!Number.isFinite(cellsize)||cellsize<=0||!Number.isFinite(xllcorner)||!Number.isFinite(yllcorner))throw new Error('토지피복 픽셀 위치 정보가 없습니다.');
  const nextPixel={cellsize,xllcorner,yllcorner,nrows:payload.nrows,ncols:payload.ncols,projection:'MODIS Sinusoidal',nominalResolutionMeters:500};
  if(pixel&&['cellsize','xllcorner','yllcorner'].some(key=>Math.abs(pixel[key]-nextPixel[key])>.001))throw new Error('연도 사이 관측 픽셀 위치가 달라 비교를 중지했습니다.');
  pixel=nextPixel;
  const radius=6371007.181,centerY=yllcorner+cellsize/2,centerLatRadians=centerY/radius;
  pixel.center={lat:centerLatRadians*180/Math.PI,lng:(xllcorner+cellsize/2)/(radius*Math.cos(centerLatRadians))*180/Math.PI};
  observations.push(...parseLandCoverPoint(payload,chunk));
 }
 return {source:LAND_COVER_SOURCE,point:{lat,lng},pixel,observations,summary:summarizeLandCover(observations),
  period:{startYear:observations[0]?.year??null,endYear:observations.at(-1)?.year??null,omittedOlderYears:allDates.length-dates.length},
  retrievedAt:new Date().toISOString(),requestUrls,realtimeObservation:false,
  qualityRule:'QC=0 + LW=2인 분류된 육지, 또는 QC=2 + LW=1인 분류된 수역만 표시. LC_Type1 범위 1–17. 보충·재분류·결측을 제외하며 QC는 정확도 확률이 아닙니다.'};
}
