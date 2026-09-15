// National reports are context, never evidence that an individual pixel is degraded.
let reference=null;
let boundaries=null;
let loading=null;

async function getJSON(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`UNCCD reference unavailable (${response.status})`);
  return response.json();
}

export function configureUnccdReference(data,borders) {
  if(data?.schemaVersion!==1||data.series!=='AG_LND_DGRD'||!data.areas||borders?.schemaVersion!==1||!Array.isArray(borders.features)) throw new Error('Invalid UNCCD reference dataset');
  reference=data;
  boundaries=borders;
  return reference;
}

export async function loadUnccdReference() {
  if(reference&&boundaries) return reference;
  if(!loading) loading=Promise.all([getJSON(new URL('./data/unccd-reference.json',import.meta.url)),getJSON(new URL('./data/country-boundaries.json',import.meta.url))]).then(([data,borders])=>configureUnccdReference(data,borders)).catch(error=>{loading=null;throw error;});
  return loading;
}

export function unccdReferenceReady() { return !!reference&&!!boundaries; }
export function getUnccdDataset() { return reference; }

function inRing([x,y],ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function inPolygon(point,rings) { return inRing(point,rings[0])&&!rings.slice(1).some(r=>inRing(point,r)); }

/** Returns null for seas, invalid points and unresolved/ambiguous country polygons. */
export function findCountry(point) {
  if(!boundaries) throw new Error('Load the UNCCD reference before querying a country');
  if(!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite)||Math.abs(point[1])>=90) return null;
  const p=[((point[0]+180)%360+360)%360-180,point[1]],matches=[];
  for(const feature of boundaries.features) {
    const b=feature.bbox;
    if(b&&(p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3])) continue;
    const g=feature.geometry;
    if(g.type==='Polygon'?inPolygon(p,g.coordinates):g.type==='MultiPolygon'&&g.coordinates.some(poly=>inPolygon(p,poly))) matches.push(feature.properties);
  }
  if(matches.length!==1) return null;
  return {...matches[0],boundarySource:boundaries.source.name,boundaryApproximate:true};
}

export function countryReference(point) {
  if(!reference) throw new Error('Load the UNCCD reference before querying national statistics');
  const country=findCountry(point);
  const area=country?.m49?reference.areas[country.m49]:null;
  const observations=area?.scope==='national'?area.observations:[];
  const latest=[...observations].reverse().find(o=>Number.isFinite(o.percent))||null;
  return {country:country?{...country,name:area?.name||country.name}:null,latest,observations,asOf:reference.asOf,sourceUrl:reference.sourceUrl,metadataUrl:reference.metadataUrl,dashboardUrl:country?.iso3?`${reference.dashboardUrl}?country=${encodeURIComponent(country.iso3)}`:reference.dashboardUrl,scope:'national',pointValidated:false,status:!country?'unresolved-country':latest?'available':'no-national-data'};
}
