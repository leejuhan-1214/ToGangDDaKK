// Record metadata and test small HTTP range reads; never download the multi-GB files.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const bucket='trendsearth-public';
const prefix='unccd_reporting/2016-2023/';
const listUrl=`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&maxResults=100`;
const metadataUrl='https://api.datacite.org/dois/10.5281/zenodo.17514520';
const notebookUrl='https://github.com/ConservationInternational/trends.earth/blob/main/notebooks/TrendsEarth_Global_Data.ipynb';
const origin='https://leejuhan-1214.github.io';
const asOf=new Date().toISOString();

async function getJSON(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Metadata unavailable (${response.status})`);
  return response.json();
}

function headerTags(buffer) {
  if(buffer.readUInt16LE(0)!==0x4949||buffer.readUInt16LE(2)!==43)throw new Error('Expected little-endian BigTIFF');
  const offset=Number(buffer.readBigUInt64LE(8)),count=Number(buffer.readBigUInt64LE(offset)),tags={};
  const sizes={1:1,2:1,3:2,4:4,12:8,16:8};
  for(let i=0;i<count;i++) {
    const entry=offset+8+i*20,tag=buffer.readUInt16LE(entry),type=buffer.readUInt16LE(entry+2),n=Number(buffer.readBigUInt64LE(entry+4)),bytes=sizes[type]*n;
    const start=bytes>8?Number(buffer.readBigUInt64LE(entry+12)):entry+12;
    if(!bytes||start+bytes>buffer.length)continue;
    if(type===2) tags[tag]=buffer.toString('utf8',start,start+bytes).replace(/\0+$/,'');
    else tags[tag]=Array.from({length:n},(_,j)=>type===3?buffer.readUInt16LE(start+j*2):type===4?buffer.readUInt32LE(start+j*4):type===12?buffer.readDoubleLE(start+j*8):type===16?Number(buffer.readBigUInt64LE(start+j*8)):buffer[start+j]);
  }
  return tags;
}

const [listing,doi]=await Promise.all([getJSON(listUrl),getJSON(metadataUrl)]);
const sources=[];
for(const [id,suffix,name] of [['te','Trends.Earth','Trends.Earth'],['jrc','JRC','European Commission Joint Research Centre LPD'],['fao-wocat','FAO-WOCAT','FAO–WOCAT LPD']]) {
  const object=listing.items.find(o=>o.name===`${prefix}TrendsEarth_SDG15.3.1_2000-2023_${suffix}.tif`);
  if(!object?.mediaLink)throw new Error(`Missing ${id} published COG`);
  const response=await fetch(object.mediaLink,{headers:{Origin:origin,Range:'bytes=0-16383'},signal:AbortSignal.timeout(30000)});
  if(response.status!==206||response.headers.get('access-control-allow-origin')!==origin)throw new Error(`Browser range access unavailable: ${id}`);
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length!==16384)throw new Error('Server did not honor bounded range');
  const tags=headerTags(buffer);
  if(tags[277]?.[0]!==14||tags[42113]!=='-32768'||tags[339]?.some(v=>v!==2))throw new Error('Unexpected band format');
  const descriptions=[...tags[42112].matchAll(/<Item name="DESCRIPTION" sample="(\d+)" role="description">([^<]+)<\/Item>/g)].map(m=>({band:Number(m[1])+1,description:m[2]}));
  const sx=tags[33550][0],sy=tags[33550][1],west=tags[33922][3],north=tags[33922][4],width=tags[256][0],height=tags[257][0];
  sources.push({id,name,url:object.mediaLink,directUrl:`https://storage.googleapis.com/${bucket}/${object.name}`,objectName:object.name,generation:object.generation,bytes:Number(object.size),md5Base64:object.md5Hash,updated:object.updated,headerSha256:createHash('sha256').update(buffer).digest('hex'),rangeVerifiedAt:asOf,crs:'EPSG:4326',width,height,pixelSizeDegrees:[sx,sy],origin:[west,north],extent:[west,north-height*sy,west+width*sx,north],nominalResolutionMetersAtEquator:Math.round(sx*111319.49079327358),dataType:'Int16',noData:-32768,bandCount:14,statusBand:14,statusYear:2023,tileSize:[tags[322][0],tags[323][0]],compression:'LZW',planarConfiguration:tags[284][0],overviewResampling:'MODE',bands:descriptions});
}
const manifest={schemaVersion:1,asOf,title:'Trends.Earth SDG Indicator 15.3.1 Datasets',version:doi.data.attributes.version,publicationDate:doi.data.attributes.dates.find(d=>d.dateType==='Issued').date,doi:'10.5281/zenodo.17514520',sourceUrl:'https://doi.org/10.5281/zenodo.17514520',documentationUrl:'https://docs.trends.earth/en/latest/for_users/downloads/index.html',metadataUrl,notebookUrl,listUrl,provider:'Conservation International / Trends.Earth, with alternative FAO–WOCAT and JRC productivity datasets',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',baseline:[2000,2015],statusYear:2023,globalEstimatesNotNationalReports:true,independentFieldValidation:false,sources,statusClasses:{'-32768':{label:'No data',labelKo:'자료 없음',group:'no-data'},'1':{label:'Degradation (persistent)',labelKo:'지속 황폐화',group:'degraded'},'2':{label:'Degradation (recent)',labelKo:'최근 황폐화',group:'degraded'},'3':{label:'Degradation (baseline)',labelKo:'기준기간 황폐화',group:'degraded'},'4':{label:'Stability',labelKo:'안정',group:'stable'},'5':{label:'Improvement (baseline)',labelKo:'기준기간 개선',group:'improved'},'6':{label:'Improvement (recent)',labelKo:'최근 개선',group:'improved'},'7':{label:'Improvement (persistent)',labelKo:'지속 개선',group:'improved'}},indicatorClasses:{'-32768':'No data','-1':'Degradation','0':'No change','1':'Improvement'},productivityClasses:{'-32768':'No data','1':'Declining','2':'Moderate decline','3':'Stressed','4':'Stable','5':'Increasing'},soilCarbon:{band:13,unit:'percent change',depthCm:[0,30],classification:false},caveats:['These are published global estimates consistent with UNCCD guidance, not locally or nationally validated ground truth.','The three versions share land-cover and soil-carbon inputs; agreement is a method sensitivity check, not independent validation or accuracy.','Native-resolution point values and modal-overview display values differ in spatial support; overview values are not area statistics.','Publication metadata lists land cover and SOC bands 12/13 as 2015–2022; the downloaded TIFF band descriptions say 2015–2023. Retain this source discrepancy and do not claim a more precise verified final year.','Missing or invalid pixels must remain no data. A degraded-land indicator alone does not establish dryland desertification or predict future risk.']};
await writeFile(new URL('../data/degradation-cogs.json',import.meta.url),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({asOf,version:manifest.version,sources:sources.map(s=>({id:s.id,width:s.width,height:s.height,resolution:s.nominalResolutionMetersAtEquator,range:true,cors:true}))}));
