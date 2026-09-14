// Rebuild the small, source-backed history snapshot. Requires Node.js 22+ and internet.
// Run from the repository root: node scripts/fetch-history.mjs
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

const cacheRoot = new URL('../../history-data/', import.meta.url);
const output = new URL('../data/history.json', import.meta.url);
const yearChoices = [2001, 2010, 2020, 2025];
const allYears = Array.from({length:25}, (_, index) => 2001 + index);
const points = {
  gobi:{name:'고비 전이지대',coordinate:[104.85,45]},
  sahel:{name:'사헬 서부',coordinate:[-14.65,15.5]},
  aral:{name:'아랄해 동부',coordinate:[62.5,44.65]}
};
const base = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
const capabilitiesUrl = `${base}1.0.0/WMTSCapabilities.xml`;
const colorMapUrl = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml';
const sourceUrls = {
  gibs:'https://nasa-gibs.github.io/gibs-api-docs/access-basics/',
  power:'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/',
  modis:'https://modis.ornl.gov/data/modis_webservice.html',
  ndvi:'https://doi.org/10.5067/MODIS/MOD13Q1.061'
};
const verification = [];
await mkdir(cacheRoot, {recursive:true});

async function request(url, type = 'json') {
  const key = createHash('sha256').update(type === 'csv' ? `${url}|csv` : url).digest('hex');
  const cacheFile = new URL(`${key}.json`, cacheRoot);
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    verification.push(cached.verification);
    return type === 'buffer' ? Buffer.from(cached.data, 'base64') : cached.data;
  } catch(error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(url, {
    headers:{Origin:'https://leejuhan-1214.github.io', Accept:type === 'json' ? 'application/json' : type === 'csv' ? 'text/csv' : '*/*'},
    signal:AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const record = {
    url, checkedAt:new Date().toISOString(), status:response.status,
    contentType:response.headers.get('content-type'),
    cors:response.headers.get('access-control-allow-origin')
  };
  const data = type === 'json' ? await response.json() : type === 'buffer' ? Buffer.from(await response.arrayBuffer()) : await response.text();
  await writeFile(cacheFile, JSON.stringify({verification:record,data:type === 'buffer' ? data.toString('base64') : data}));
  verification.push(record);
  return data;
}

function layerMetadata(capabilities, name) {
  const fragment = capabilities.split('<Layer>').find(layer => layer.includes(`<ows:Identifier>${name}</ows:Identifier>`));
  if (!fragment) throw new Error(`Missing advertised GIBS layer ${name}`);
  const layer = fragment.split('</Layer>')[0];
  const matrixSet = layer.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/)?.[1];
  const matrix = capabilities.split('<TileMatrixSet>').find(part => part.includes(`<ows:Identifier>${matrixSet}</ows:Identifier>`));
  const tileSize = Number(matrix?.match(/<TileWidth>(\d+)<\/TileWidth>/)?.[1]);
  if (tileSize !== 256) throw new Error(`Unexpected tile size for ${matrixSet}`);
  return {
    layer:name, matrixSet, tileSize, maxzoom:Number(matrixSet.match(/Level(\d+)/)[1]),
    availability:[...layer.matchAll(/<Value>([^<]+)<\/Value>/g)].map(match=>match[1])
  };
}

function advertised(date, availability) {
  return availability.some(range => {
    const [start, end] = range.split('/');
    return date >= start && date <= (end || start);
  });
}

function tileCoordinate([lng, lat], z) {
  const n = 2 ** z;
  return {z,x:Math.floor((lng + 180) / 360 * n),y:Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)};
}

// Decode 8-bit non-interlaced PNG pixels to reject empty/transparent image responses.
function pngStats(buffer) {
  if (buffer.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  let offset = 8, width, height, colorType, bitDepth, transparency, palette, compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), tag = buffer.toString('ascii',offset+4,offset+8);
    const data = buffer.subarray(offset+8,offset+8+length);
    if (tag === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNG not supported by validation');
    }
    if (tag === 'PLTE') palette = data;
    if (tag === 'tRNS') transparency = data;
    if (tag === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  if (bitDepth !== 8 || ![2,3,6].includes(colorType)) throw new Error(`Unexpected PNG ${bitDepth}/${colorType}`);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
  const rowLength = width * channels, inflated = inflateSync(Buffer.concat(compressed));
  let previous = Buffer.alloc(rowLength), position = 0, visiblePixels = 0;
  const colors = new Set();
  function paeth(a,b,c) {
    const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  for (let y=0;y<height;y++) {
    const filter = inflated[position++], row = Buffer.alloc(rowLength);
    for (let x=0;x<rowLength;x++) {
      const left=x>=channels?row[x-channels]:0, up=previous[x], upperLeft=x>=channels?previous[x-channels]:0;
      const predictor=[0,left,up,Math.floor((left+up)/2),paeth(left,up,upperLeft)][filter];
      if (predictor === undefined) throw new Error('Unexpected PNG filter');
      row[x]=(inflated[position++]+predictor)&255;
    }
    for (let x=0;x<width;x++) {
      const at=x*channels, index=row[at];
      const alpha=colorType === 6 ? row[at+3] : colorType === 3 ? transparency?.[index] ?? 255 : 255;
      if (alpha) {
        visiblePixels++;
        const rgb = colorType === 3 ? palette.subarray(index*3,index*3+3) : row.subarray(at,at+3);
        colors.add(rgb.toString('hex'));
      }
    }
    previous=row;
  }
  return {width,height,visiblePixels,uniqueVisibleColors:colors.size};
}

const capabilities = await request(capabilitiesUrl, 'text');
const colorMap = await request(colorMapUrl, 'text');
const ndviMeta = layerMetadata(capabilities, 'MODIS_Terra_L3_NDVI_Monthly');
const rgbMeta = layerMetadata(capabilities, 'MODIS_Terra_CorrectedReflectance_TrueColor');
const dateByYear = Object.fromEntries(yearChoices.map(year => [year,`${year}-08-01`]));
for (const date of Object.values(dateByYear)) {
  if (!advertised(date, ndviMeta.availability) || !advertised(`${date.slice(0,4)}-08-13`, rgbMeta.availability)) throw new Error(`Date outside GIBS availability: ${date}`);
}
const colorEntries = [...colorMap.matchAll(/<ColorMapEntry\s+([^>]+)\/>/g)].map(([,attributes])=>{
  const attr=Object.fromEntries([...attributes.matchAll(/(\w+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
  const range=attr.value?.match(/^\[([^,]+),([^\)\]]+)/);
  return {...attr,range:range?.slice(1).map(Number)};
});
const legendStops=[0.01,0.1,0.2,0.3,0.4,0.6,0.8,1].map(value=>{
  const entry=colorEntries.find(row=>row.range && value >= row.range[0] && value < row.range[1]);
  return {value,color:entry ? `#${entry.rgb.split(',').map(n=>Number(n).toString(16).padStart(2,'0')).join('')}` : null};
});
const imagery = {
  ndvi:{...ndviMeta,label:'8월 식생지수 · 월 합성',dateByYear,
    tileUrlTemplate:`${base}${ndviMeta.layer}/default/{date}/${ndviMeta.matrixSet}/{z}/{y}/{x}.png`,
    legendUrl:'https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg',colorMapUrl,legendStops,
    sourceUrl:sourceUrls.gibs, attribution:'NASA EOSDIS GIBS · MODIS Terra',
    noDataNote:'수역·0 이하 NDVI·결측은 투명합니다. 이 지도는 사막화 판정도가 아닌 월 식생지수 영상입니다.'},
  trueColor:{...rgbMeta,label:'8월 13일 실제 위성영상',dateByYear:Object.fromEntries(yearChoices.map(year=>[year,`${year}-08-13`])),
    tileUrlTemplate:`${base}${rgbMeta.layer}/default/{date}/${rgbMeta.matrixSet}/{z}/{y}/{x}.jpeg`,
    sourceUrl:sourceUrls.gibs, attribution:'NASA EOSDIS GIBS · MODIS Terra',
    noDataNote:'일별 위성사진에는 구름이나 관측 공백이 있을 수 있습니다.'}
};

const tileChecks = [];
for (const region of ['gobi','aral']) {
  for (const year of yearChoices) {
    const tile = tileCoordinate(points[region].coordinate,7);
    for (const [kind,settings] of Object.entries(imagery)) {
      const url=settings.tileUrlTemplate.replace('{date}',settings.dateByYear[year]).replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
      const data=await request(url,'buffer');
      const stats = kind === 'ndvi' ? pngStats(data) : {jpegSignature:data.subarray(0,2).toString('hex') === 'ffd8'};
      if (kind === 'ndvi' && (!stats.visiblePixels || stats.uniqueVisibleColors < 3)) throw new Error(`Empty NDVI image: ${url}`);
      if (kind === 'trueColor' && (!stats.jpegSignature || data.length < 5000)) throw new Error(`Empty/invalid true-color image: ${url}`);
      tileChecks.push({region,year,kind,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),...stats});
    }
  }
}

const bandMetadata = await request('https://modis.ornl.gov/rst/api/v1/MOD13Q1/bands');
const ndviBand=bandMetadata.bands.find(band=>band.band==='250m_16_days_NDVI');
if (Number(ndviBand.scale_factor)!==0.0001 || Number(ndviBand.fill_value)!==-3000) throw new Error('Unexpected NDVI band metadata');
const collectionCheckUrl='https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=45&longitude=104.85&startDate=A2001225&endDate=A2001225&kmAboveBelow=0&kmLeftRight=0';
const collectionFileIdentifier=(await request(collectionCheckUrl,'csv')).split(',')[0];
if (!collectionFileIdentifier.includes('.061.')) throw new Error('Expected MODIS Collection 6.1 identifier');
const historyRegions = {};
for (const [region,point] of Object.entries(points)) {
  const [lng,lat]=point.coordinate;
  const precipitationUrl=`https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR&community=AG&longitude=${lng}&latitude=${lat}&format=JSON&start=2001&end=2025`;
  const power=await request(precipitationUrl);
  if (power.parameters.PRECTOTCORR.units !== 'mm/day') throw new Error('Unexpected precipitation units');
  const monthly = power.properties.parameter.PRECTOTCORR;
  const precipitationSeries=allYears.map(year=>{
    const months=Array.from({length:12},(_,index)=>monthly[`${year}${String(index+1).padStart(2,'0')}`]);
    const good=months.every(value=>Number.isFinite(value)&&value>=0&&value!==power.header.fill_value);
    const total=good?months.reduce((sum,value,index)=>sum+value*new Date(Date.UTC(year,index+1,0)).getUTCDate(),0):null;
    return {year,precipitationMm:total===null?null:Number(total.toFixed(2)),monthlyMeanMmPerDay:months.map(value=>Number.isFinite(value)&&value>=0?value:null)};
  });
  const dateUrl=`https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates?latitude=${lat}&longitude=${lng}`;
  const dates=(await request(dateUrl)).dates;
  const series=[];
  for (const year of yearChoices) {
    const date=dates.find(value=>value.modis_date===`A${year}225`);
    let ndvi=null, ndviQuality=null, ndviRaw=null, ndviUrl=null, ndviDate=null, ndviPixel=null;
    if (date) {
      ndviUrl=`https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat}&longitude=${lng}&startDate=${date.modis_date}&endDate=${date.modis_date}&kmAboveBelow=0&kmLeftRight=0`;
      const subset=await request(ndviUrl);
      if (subset.nrows!==1||subset.ncols!==1) throw new Error('Expected one representative MODIS pixel');
      ndviRaw=subset.subset.find(value=>value.band==='250m_16_days_NDVI')?.data?.[0] ?? null;
      ndviQuality=subset.subset.find(value=>value.band==='250m_16_days_pixel_reliability')?.data?.[0] ?? null;
      const qualityBits=subset.subset.find(value=>value.band==='250m_16_days_VI_Quality')?.data?.[0] ?? null;
      // Require good reliability and MODLAND QA, valid source range, and land status.
      const landWater=Number.isInteger(qualityBits)?(qualityBits>>11)&7:null;
      if (Number.isFinite(ndviRaw)&&ndviRaw>=-2000&&ndviRaw<=10000&&ndviQuality===0&&(qualityBits&3)===0&&landWater===1) ndvi=Number((ndviRaw*Number(ndviBand.scale_factor)).toFixed(4));
      ndviDate=date.calendar_date;
      ndviPixel={cellSizeM:subset.cellsize,xllcorner:Number(subset.xllcorner),yllcorner:Number(subset.yllcorner),projection:'MODIS Sinusoidal',qualityBits,landWaterFlag:landWater};
    }
    series.push({year,precipitationMm:precipitationSeries.find(value=>value.year===year).precipitationMm,ndvi,ndviDate,ndviRaw,ndviQuality,ndviUrl,ndviPixel});
  }
  historyRegions[region]={...point,scope:'지역 중심 대표점 · 지역 전체 평균 아님',series,precipitationSeries,sources:{precipitationUrl,ndviDatesUrl:dateUrl,powerSource:power.header.sources,powerTimeStandard:power.header.time_standard}};
  console.log(`${region}: ${series.map(value=>`${value.year} rain=${value.precipitationMm} NDVI=${value.ndvi}`).join('; ')}`);
}
const document={
  schemaVersion:1,retrievedAt:new Date().toISOString(),years:yearChoices,imagery,regions:historyRegions,
  methodology:{
    precipitation:'NASA POWER / MERRA-2 PRECTOTCORR. Sum monthly mean daily precipitation (mm/day) multiplied by days in each month; an approximate annual total from rounded monthly API values.',
    precipitationKo:'NASA POWER / MERRA-2 월평균 일강수량(mm/day)에 해당 월의 일수를 곱한 뒤 12개월 합산합니다. API 월값의 반올림으로 연합계는 근사값입니다.',
    ndvi:'ORNL DAAC MOD13Q1 Collection 6.1, day-of-year 225 sixteen-day composite, one nominal 250 m pixel at each region center. Raw × 0.0001. Good reliability (0), good MODLAND QA (bits 0–1 = 0), land flag (bits 11–13 = 1), valid range only; otherwise null.',
    ndviKo:'지역 중심의 250m급 MODIS 대표 픽셀, 매년 연중 225일(8월12일 또는13일)부터 16일 합성입니다. 품질 양호·육지 픽셀만 사용하며 지도에 보이는 8월 월합성과 집계기간이 다릅니다.',
    caution:'식생지수의 증감이나 한 해의 강수량 차이만으로 사막화를 확정할 수 없습니다. 기존 위험도·복원 효과는 별도의 교육용 모형입니다.'
  },
  sources:sourceUrls,verification:{capabilitiesUrl,collectionFileIdentifier,tileChecks,http:verification}
};
await writeFile(output,JSON.stringify(document,null,2)+'\n');
console.log(`Saved ${output.pathname}; ${verification.length} verified requests.`);
