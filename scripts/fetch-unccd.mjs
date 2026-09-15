// Rebuild the bundled official national context. No interpolation or invented values.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const DATA = new URL('../data/', import.meta.url);
const API = 'https://unstats.un.org/SDGAPI/v1/sdg/Series/Data';
const BORDERS = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const SOURCE = 'https://unstats.un.org/sdgs/dataportal/database';
const sha256 = text => createHash('sha256').update(text).digest('hex');

async function getJSON(url) {
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok) throw new Error(`${response.status} ${url}`);
      const text=await response.text();
      return {data:JSON.parse(text),sha256:sha256(text),url};
    } catch(error) { if(attempt===2) throw error; }
  }
}

const asOf=new Date().toISOString();
const borderResponse=await getJSON(BORDERS);
const m49For=p=>[p.UN_A3,p.ISO_N3,p.ISO_N3_EH].find(code=>/^\d{1,3}$/.test(code));
const features=borderResponse.data.features.map(feature=>{
  const p=feature.properties,code=m49For(p);
  return {type:'Feature',properties:{m49:code?String(Number(code)):null,iso3:p.ISO_A3_EH&&p.ISO_A3_EH!=='-99'?p.ISO_A3_EH:p.ADM0_A3,name:p.NAME_LONG||p.NAME,nameKo:p.NAME_KO||p.NAME_LONG||p.NAME},bbox:feature.bbox,geometry:feature.geometry};
});
const countryCodes=new Set(features.map(f=>f.properties.m49).filter(Boolean));
const pages=[];
for(let page=1,totalPages=1;page<=totalPages;page++) {
  const url=`${API}?seriesCode=AG_LND_DGRD&pageSize=1000&page=${page}`;
  const response=await getJSON(url);
  if(!Array.isArray(response.data.data)||!Number.isInteger(response.data.totalPages)) throw new Error('Unexpected UN SDG API response');
  pages.push(response);totalPages=response.data.totalPages;
}
const raw=pages.flatMap(p=>p.data.data);
if(raw.length!==pages[0].data.totalElements) throw new Error('Incomplete UN SDG download');
const natureLabels=Object.fromEntries(pages[0].data.attributes.find(a=>a.id==='Nature').codes.map(c=>[c.code,c.description]));
const areas={};
for(const row of raw) {
  if(row.series!=='AG_LND_DGRD'||row.attributes.Units!=='PERCENT') throw new Error('Unexpected series or unit');
  const m49=String(Number(row.geoAreaCode));
  const area=areas[m49]??={m49,name:row.geoAreaName,scope:countryCodes.has(m49)?'national':'aggregate',observations:[]};
  const numeric=row.value!==null&&String(row.value).trim()!==''?Number(row.value):NaN;
  const percent=Number.isFinite(numeric)&&numeric>=0&&numeric<=100?numeric:null;
  area.observations.push({year:Number(row.timePeriodStart),percent,rawValue:row.value,unit:'PERCENT',nature:row.attributes.Nature,natureLabel:natureLabels[row.attributes.Nature]||row.attributes.Nature,source:row.source,reportingType:row.dimensions['Reporting Type'],footnotes:(row.footnotes||[]).filter(Boolean),timeCoverage:row.timeCoverage,timeDetail:row.time_detail,upperBound:row.upperBound,lowerBound:row.lowerBound,sourceUrl:row.geoInfoUrl||null});
}
for(const area of Object.values(areas)) area.observations.sort((a,b)=>a.year-b.year);
const national=Object.values(areas).filter(a=>a.scope==='national');
const dataset={schemaVersion:1,indicator:'15.3.1',series:'AG_LND_DGRD',title:'Proportion of land that is degraded over total land area (%)',provider:'United Nations Statistics Division / UNCCD',asOf,observationYears:[...new Set(raw.map(r=>r.timePeriodStart))].sort((a,b)=>a-b),scope:'national-and-regional',pointValidated:false,sourceUrl:SOURCE,dashboardUrl:'https://data.unccd.int/land-degradation',metadataUrl:'https://unstats.un.org/sdgs/metadata/files/Metadata-15-03-01.pdf',apiUrl:`${API}?seriesCode=AG_LND_DGRD&pageSize=1000`,provenance:pages.map(({url,sha256})=>({url,sha256})),counts:{observations:raw.length,nationalAreas:national.length,nationalAreasWithValues:national.filter(a=>a.observations.some(r=>r.percent!==null)).length,aggregateAreas:Object.values(areas).length-national.length},natureLabels,areas};
const borders={type:'FeatureCollection',schemaVersion:1,asOf,source:{name:'Natural Earth Admin 0 Countries, 1:50m',url:BORDERS,sha256:borderResponse.sha256,license:'Public domain',licenseUrl:'https://www.naturalearthdata.com/about/terms-of-use/',limitation:'Generalized country lookup only; not an authoritative boundary or coastline. Tiny islands and disputed boundaries may be unresolved.'},features};
await mkdir(DATA,{recursive:true});
await writeFile(new URL('unccd-reference.json',DATA),JSON.stringify(dataset));
await writeFile(new URL('country-boundaries.json',DATA),JSON.stringify(borders));
console.log(JSON.stringify({asOf,...dataset.counts,years:dataset.observationYears,boundaryFeatures:features.length}));
