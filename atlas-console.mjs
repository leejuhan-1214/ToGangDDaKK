// Interface utilities only: search, display controls, and two-point distance.
// None of these values participate in the environmental analysis.
const RADIANS=Math.PI/180,EARTH_RADIUS_KM=6371.0088;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const wrapLongitude=value=>((value+180)%360+360)%360-180;
const validCoordinate=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
const normalize=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');

export const CONSOLE_PLACES=Object.freeze([
 {name:'한반도 산지',detail:'대한민국 · 산림 지형',coordinate:[127.6,37.55],zoom:12,aliases:'한국 korea 산림'},
 {name:'고비 전이지대',detail:'몽골 · 건조지',coordinate:[104.85,45],zoom:9,aliases:'gobi 몽골 사막'},
 {name:'사헬 서부',detail:'세네갈 · 건조지 전이지대',coordinate:[-14.65,15.5],zoom:9,aliases:'sahel 세네갈 africa'},
 {name:'아랄해 동부',detail:'중앙아시아 · 호수 주변',coordinate:[62.5,44.65],zoom:9,aliases:'aral 아랄 우즈베키스탄'},
 {name:'서울',detail:'대한민국 · 도시와 산지',coordinate:[126.978,37.5665],zoom:12,aliases:'seoul 대한민국 수도'},
 {name:'제주 한라산',detail:'대한민국 · 화산 지형',coordinate:[126.529,33.3617],zoom:12,aliases:'jeju hallasan 제주도'},
 {name:'에베레스트',detail:'네팔·중국 · 히말라야',coordinate:[86.925,27.9881],zoom:12,aliases:'everest himalaya 히말라야'},
 {name:'그랜드 캐니언',detail:'미국 · 콜로라도 고원',coordinate:[-112.112,36.1069],zoom:12,aliases:'grand canyon 그랜드캐니언'},
 {name:'알프스 마터호른',detail:'스위스·이탈리아 · 고산 지형',coordinate:[7.6586,45.9763],zoom:13,aliases:'alps matterhorn 알프스 스위스'},
 {name:'아마존',detail:'브라질 · 마나우스 주변',coordinate:[-60.0217,-3.119],zoom:9,aliases:'amazon manaus 브라질 열대우림'}
]);

/** Input order is explicitly latitude, longitude; output follows GeoJSON. */
export function parseCoordinates(value){
 const match=String(value??'').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*([EW])?$/i);
 if(!match)return null;
 let lat=Number(match[1]),lng=Number(match[3]);
 if((match[2]&&lat<0)||(match[4]&&lng<0))return null;
 if(match[2]?.toUpperCase()==='S')lat=-lat;
 if(match[4]?.toUpperCase()==='W')lng=-lng;
 if(!validCoordinate([lng,lat])||Math.abs(lat)>85)return null;
 return [lng,lat];
}

export function searchLocalPlaces(query,{limit=5}={}){
 const text=normalize(query),tokens=text.split(' ').filter(Boolean);
 return CONSOLE_PLACES.map((place,index)=>({place,index,text:normalize(`${place.name} ${place.detail} ${place.aliases}`)}))
  .filter(entry=>tokens.every(token=>entry.text.includes(token)))
  .sort((a,b)=>(normalize(b.place.name)===text)-(normalize(a.place.name)===text)||a.index-b.index)
  .slice(0,clamp(Math.floor(limit)||5,1,10)).map(({place})=>({...place,coordinate:[...place.coordinate],source:'등록 지점'}));
}

export function greatCircleDistanceKm(a,b){
 if(!validCoordinate(a)||!validCoordinate(b))throw new RangeError('Valid [longitude, latitude] coordinates required');
 const dLat=(b[1]-a[1])*RADIANS,dLng=(b[0]-a[0])*RADIANS;
 const h=Math.sin(dLat/2)**2+Math.cos(a[1]*RADIANS)*Math.cos(b[1]*RADIANS)*Math.sin(dLng/2)**2;
 return 2*EARTH_RADIUS_KM*Math.asin(Math.sqrt(clamp(h,0,1)));
}

/** A sampled great-circle arc, split at ±180° so no line crosses the whole map. */
export function greatCircleGeometry(a,b,{steps=64}={}){
 if(!validCoordinate(a)||!validCoordinate(b))throw new RangeError('Valid [longitude, latitude] coordinates required');
 const vector=([lng,lat])=>[Math.cos(lat*RADIANS)*Math.cos(lng*RADIANS),Math.cos(lat*RADIANS)*Math.sin(lng*RADIANS),Math.sin(lat*RADIANS)];
 const u=vector(a),v=vector(b),dot=clamp(u.reduce((sum,x,i)=>sum+x*v[i],0),-1,1),angle=Math.acos(dot);
 let normal=v.map((x,i)=>x-dot*u[i]),length=Math.hypot(...normal);
 if(length<1e-10){normal=Math.abs(u[2])<.9?[-u[1],u[0],0]:[u[2],0,-u[0]];length=Math.hypot(...normal);}
 normal=normal.map(x=>x/length);
 const count=clamp(Math.round(steps)||64,2,256),points=[];
 for(let i=0;i<=count;i++){
  if(i===0){points.push([...a]);continue;}if(i===count){points.push([...b]);continue;}
  const t=angle*i/count,w=u.map((x,j)=>x*Math.cos(t)+normal[j]*Math.sin(t));
  points.push([wrapLongitude(Math.atan2(w[1],w[0])/RADIANS),Math.asin(clamp(w[2],-1,1))/RADIANS]);
 }
 const lines=[[points[0]]];
 for(let i=1;i<points.length;i++){
  const previous=points[i-1],current=points[i];
  if(Math.abs(current[0]-previous[0])>180){
   const adjusted=current[0]+(current[0]<previous[0]?360:-360),edge=previous[0]>=0?180:-180;
   const t=(edge-previous[0])/(adjusted-previous[0]),latitude=previous[1]+t*(current[1]-previous[1]);
   lines.at(-1).push([edge,latitude]);lines.push([[-edge,latitude],current]);
  }else lines.at(-1).push(current);
 }
 return lines.length===1?{type:'LineString',coordinates:lines[0]}:{type:'MultiLineString',coordinates:lines};
}

export function parsePhotonResults(payload){
 if(!payload||!Array.isArray(payload.features))throw new TypeError('Invalid geocoder response');
 const seen=new Set(),results=[];
 for(const feature of payload.features.slice(0,30)){
  const coordinate=feature?.geometry?.coordinates,p=feature?.properties;
  if(feature?.geometry?.type!=='Point'||!validCoordinate(coordinate)||Math.abs(coordinate[1])>85||!p||typeof p.name!=='string'||!p.name.trim())continue;
  const name=p.name.trim().slice(0,160),key=`${name}:${coordinate.join(',')}`;
  if(seen.has(key))continue;seen.add(key);
  const detail=[p.city,p.state,p.country].filter(value=>typeof value==='string'&&value.trim()&&value!==name);
  results.push({name,coordinate:[...coordinate],detail:[...new Set(detail)].join(' · ').slice(0,220)||'OpenStreetMap 등록 지점',zoom:['country','state'].includes(p.type)?6:12,source:'Photon · © OpenStreetMap'});
  if(results.length===5)break;
 }
 return results;
}

export function cameraShareURL(href,camera,display={}){
 const {lng,lat,zoom,bearing,pitch}=camera;
 if(![lng,lat,zoom,bearing,pitch].every(Number.isFinite)||Math.abs(lat)>85||zoom<0||zoom>22||pitch<0||pitch>75)throw new RangeError('Invalid camera');
 const url=new URL(href);
 url.searchParams.set('camera',[wrapLongitude(lng).toFixed(5),lat.toFixed(5),zoom.toFixed(2),bearing.toFixed(1),pitch.toFixed(1)].join(','));
 for(const key of ['night','quality','overlay','shade','terrain'])if(typeof display[key]==='boolean')url.searchParams.set(key,display[key]?'1':'0');
 if(Number.isFinite(display.opacity))url.searchParams.set('opacity',String(clamp(display.opacity,0,85)));
 return url.href;
}

export function createAtlasConsole({map,selectLocation,onTab=()=>{},onHistory=()=>{},onHelp=()=>{},onHome=()=>{},onPanelToggle=()=>{},onOrbit=()=>{},onMeasureChange=()=>{},onFullscreen,initialNight=false,fetchImpl=globalThis.fetch}={}){
 if(!map)throw new TypeError('A loaded map is required');
 const $=id=>document.getElementById(id),listeners=[],mapListeners=[],empty=()=>({type:'FeatureCollection',features:[]});
 const listen=(element,event,handler)=>{if(!element)return;element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler));};
 const listenMap=(event,handler)=>{map.on(event,handler);mapListeners.push(()=>map.off(event,handler));};
 let disposed=false,searchController=null,searchRequest=0,lastSearchAt=0,searchTimeout=null,searchDelay=null;
 let measuring=false,measurePoints=[],preview=null,pointer=null,frame=null,noticeTimer=null,results=[],lowLight=false;
 const canvas=map.getCanvas(),originalCursor=canvas.style.cursor;
 const originalPaint=Object.fromEntries(['raster-brightness-max','raster-saturation','raster-contrast'].map(name=>[name,map.getPaintProperty('satellite',name)??null]));
 const text=(id,value)=>{if($(id))$(id).textContent=value;};
 const announce=message=>{text('console-notice',message);if($('console-notice')){$('console-notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('console-notice').hidden=true;},5000);}};
 const camera=()=>{const c=map.getCenter();return{lng:c.lng,lat:c.lat,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};};
 const updateCamera=()=>{const c=camera();text('console-camera',`Z ${c.zoom.toFixed(1)} · ${Math.round(c.pitch)}° · ${Math.round((c.bearing+360)%360)}° N`);};
 const updateClock=()=>{const iso=new Date().toISOString();text('console-clock',iso.slice(11,19));$('console-clock')?.setAttribute('datetime',iso);};
 updateClock();updateCamera();const clockTimer=setInterval(updateClock,1000);listenMap('move',updateCamera);

 function stopSearch(){searchRequest++;searchController?.abort();searchController=null;clearTimeout(searchTimeout);searchTimeout=null;if(searchDelay){clearTimeout(searchDelay.timer);searchDelay.resolve();searchDelay=null;}}
 function renderResults(items){
  results=items;const target=$('console-search-results');if(!target)return;target.replaceChildren();
  items.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.className='console-search-result';button.dataset.searchIndex=String(index);
   const title=document.createElement('strong'),detail=document.createElement('span'),source=document.createElement('small');title.textContent=item.name;detail.textContent=item.detail;source.textContent=item.source;button.append(title,detail,source);target.append(button);
  });
 }
 function openSearch(){
  const dialog=$('console-search-dialog');if(!dialog)return;if(document.querySelector('dialog[open]')&&!dialog.open)return;
  if(!dialog.open)dialog.showModal();if(!$('console-search-input')?.value.trim()){renderResults(searchLocalPlaces(''));text('console-search-status','지명 또는 위도, 경도 입력 · 검색 버튼을 누르면 Photon에 지명을 조회합니다.');}
  $('console-search-input')?.focus();
 }
 function closeSearch(){stopSearch();$('console-search-dialog')?.close();}
 function chooseResult(index){const result=results[index];if(!result)return;closeSearch();setMeasurement(false);if(selectLocation)selectLocation([...result.coordinate],{name:result.name,zoom:result.zoom});else map.flyTo({center:result.coordinate,zoom:result.zoom});announce(`${result.name} 위치로 이동합니다.`);}
 async function submitSearch(event){
  event.preventDefault();stopSearch();const query=$('console-search-input')?.value.trim().slice(0,180)||'';
  if(!query){renderResults(searchLocalPlaces(''));text('console-search-status','지명 또는 위도, 경도를 입력하세요.');return;}
  const coordinate=parseCoordinates(query);
  if(coordinate){renderResults([{name:'입력 좌표',coordinate,zoom:13,detail:`${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,source:'위도, 경도'}]);text('console-search-status','좌표를 확인했습니다. 결과를 선택해 이동하세요.');return;}
  if(/\d/.test(query)&&/^[\s\d.,;°+\-NSEW]+$/i.test(query)){renderResults([]);text('console-search-status','좌표는 위도, 경도 순서입니다. 위도 −85~85, 경도 −180~180 범위로 입력하세요.');return;}
  const local=searchLocalPlaces(query),id=++searchRequest;
  renderResults(local);text('console-search-status','Photon에서 지명을 검색하는 중…');
  const wait=Math.max(0,1000-(Date.now()-lastSearchAt));
  if(wait)await new Promise(resolve=>{searchDelay={resolve,timer:setTimeout(()=>{searchDelay=null;resolve();},wait)};});
  if(disposed||id!==searchRequest)return;
  const controller=new AbortController();searchController=controller;lastSearchAt=Date.now();searchTimeout=setTimeout(()=>controller.abort(),12000);
  try{
   const url=new URL('https://photon.komoot.io/api/');url.searchParams.set('q',query);url.searchParams.set('limit','5');
   const response=await fetchImpl(url.href,{signal:controller.signal,headers:{Accept:'application/json'},credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
   if(!response.ok)throw new Error(response.status===429?'검색 서비스 요청이 많습니다. 잠시 뒤 다시 시도하세요.':`지명 서비스 응답 오류 (${response.status})`);
   const remote=parsePhotonResults(await response.json());if(disposed||id!==searchRequest)return;
   const combined=[...local];for(const item of remote)if(!combined.some(existing=>greatCircleDistanceKm(existing.coordinate,item.coordinate)<.2&&normalize(existing.name)===normalize(item.name)))combined.push(item);
   renderResults(combined.slice(0,5));text('console-search-status',combined.length?'위치 결과를 선택하세요 · 지명 제공: Photon / OpenStreetMap':'일치하는 지명을 찾지 못했습니다. 다른 표기나 위도, 경도를 입력하세요.');
  }catch(error){if(!disposed&&id===searchRequest){renderResults(local);text('console-search-status',`${error.name==='AbortError'?'지명 서비스 응답이 지연되었습니다.':error.message||'지명 서비스에 연결하지 못했습니다.'}${local.length?' 등록 지점은 이용할 수 있습니다.':' 좌표 입력은 계속 사용할 수 있습니다.'}`);}}
  finally{if(id===searchRequest){clearTimeout(searchTimeout);searchTimeout=null;searchController=null;}}
 }
 listen($('console-search-trigger'),'click',openSearch);listen($('console-search-close'),'click',closeSearch);listen($('console-search-form'),'submit',submitSearch);
 listen($('console-search-dialog'),'close',stopSearch);
 listen($('console-search-input'),'input',()=>{stopSearch();const query=$('console-search-input').value;renderResults(searchLocalPlaces(query));text('console-search-status','등록 지점만 표시 중 · 검색을 눌러 전 세계 지명을 조회하세요.');});
 listen($('console-search-results'),'click',event=>{const button=event.target.closest('button[data-search-index]');if(button)chooseResult(Number(button.dataset.searchIndex));});

 function ensureMeasurementLayers(){
  if(map.getSource('console-measure'))return;
  map.addSource('console-measure',{type:'geojson',data:empty()});
  map.addLayer({id:'console-measure-line',type:'line',source:'console-measure',filter:['==',['get','kind'],'path'],paint:{'line-color':'#62cafa','line-width':2,'line-dasharray':[3,2]}});
  map.addLayer({id:'console-measure-points',type:'circle',source:'console-measure',filter:['==',['get','kind'],'point'],paint:{'circle-radius':5,'circle-color':'#122630','circle-stroke-color':'#b5e7ff','circle-stroke-width':2}});
 }
 function drawMeasurement(){
  const source=map.getSource('console-measure');if(!source)return;const coordinates=[...measurePoints];if(coordinates.length===1&&preview)coordinates.push(preview);
  const features=measurePoints.map(coordinate=>({type:'Feature',properties:{kind:'point'},geometry:{type:'Point',coordinates:coordinate}}));
  if(coordinates.length===2)features.unshift({type:'Feature',properties:{kind:'path'},geometry:greatCircleGeometry(...coordinates)});
  source.setData({type:'FeatureCollection',features});
  const label=coordinates.length===2?(()=>{const distance=greatCircleDistanceKm(...coordinates);return `${distance<1?`${Math.round(distance*1000)} m`:`${distance.toLocaleString('ko-KR',{maximumFractionDigits:2})} km`} · 대권거리${measurePoints.length===1?' 미리보기':''}`;})():measurePoints.length?'종료 지점을 선택하세요':'지도에서 두 지점을 선택하세요';
  text('console-measure-value',measuring?label:'거리 측정');
 }
 function setMeasurement(active){
  measuring=active;measurePoints=[];preview=null;canvas.style.cursor=active?'crosshair':originalCursor;
  $('console-measure-trigger')?.setAttribute('aria-pressed',String(active));document.body.classList.toggle('console-measuring',active);
  if(active)ensureMeasurementLayers();map.getSource('console-measure')?.setData(empty());text('console-measure-value',active?'지도에서 시작 지점을 선택하세요':'거리 측정');
  if($('console-measure-value')){$('console-measure-value').hidden=!active;$('console-measure-value').title='두 지점 사이의 구면 대권거리입니다. 고도·지형 굴곡·실제 이동 경로는 반영하지 않습니다.';}
  onMeasureChange(active);
  if(active)announce('지도에서 두 지점을 선택하세요. 고도·경로를 제외한 대권거리입니다. Esc로 종료합니다.');
 }
 function handleMapClick(event){
  if(!measuring)return false;const {lng,lat}=event.lngLat;if(!Number.isFinite(lng)||!Number.isFinite(lat))return true;
  if(measurePoints.length===2)measurePoints=[];measurePoints.push([wrapLongitude(lng),clamp(lat,-90,90)]);preview=null;drawMeasurement();
  if(measurePoints.length===2)announce('두 지점의 대권거리를 표시합니다. 새 측정은 지도를 다시 클릭하세요.');return true;
 }
 listen($('console-measure-trigger'),'click',()=>setMeasurement(!measuring));
 listenMap('mousemove',event=>{if(!event.lngLat)return;pointer=[wrapLongitude(event.lngLat.lng),event.lngLat.lat];preview=pointer;if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;if(disposed||!pointer)return;const [lng,lat]=pointer;text('console-cursor',`${Math.abs(lat).toFixed(4)}° ${lat<0?'S':'N'} / ${Math.abs(lng).toFixed(4)}° ${lng<0?'W':'E'}`);if(measuring&&measurePoints.length===1)drawMeasurement();});});

 function toggleFocus(){const active=document.body.classList.toggle('console-focus');$('console-focus-trigger')?.setAttribute('aria-pressed',String(active));announce(active?'지도 집중 모드 · 같은 버튼으로 패널 복원':'분석 패널을 복원했습니다.');}
 function toggleLowLight(){lowLight=!lowLight;for(const [name,value] of Object.entries(lowLight?{'raster-brightness-max':.62,'raster-saturation':-.45,'raster-contrast':.12}:originalPaint))map.setPaintProperty('satellite',name,value);$('console-night-trigger')?.setAttribute('aria-pressed',String(lowLight));document.body.classList.toggle('console-night',lowLight);announce(lowLight?'저조도 표시 켬 · 위성영상의 밝기만 조절합니다.':'위성영상을 원래 밝기로 표시합니다.');}
 async function fullscreen(){try{if(onFullscreen){await onFullscreen();return;}if(document.fullscreenElement)await document.exitFullscreen();else await (document.querySelector('.live-shell')||map.getContainer()).requestFullscreen();}catch{announce('이 브라우저에서 전체 화면을 사용할 수 없습니다.');}}
 function openShortcuts(){const dialog=$('console-shortcuts-dialog');if(dialog&&!document.querySelector('dialog[open]'))dialog.showModal();else if(!dialog)onHelp();}
 listen($('console-focus-trigger'),'click',toggleFocus);listen($('console-night-trigger'),'click',toggleLowLight);
 listen($('console-shortcuts-trigger'),'click',openShortcuts);listen($('console-shortcut-footer'),'click',openShortcuts);listen($('console-shortcuts-close'),'click',()=>$('console-shortcuts-dialog')?.close());
 listen($('console-share-trigger'),'click',async()=>{const url=cameraShareURL(location.href,camera(),{night:lowLight,terrain:$('live-3d')?.getAttribute('aria-pressed')==='true',quality:$('imagery-quality-toggle')?.checked,overlay:$('official-layer-toggle')?.checked,shade:$('shade-toggle')?.checked,opacity:Number($('official-opacity')?.value)});history.replaceState(history.state,'',url);try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(url);announce('현재 위치·시점·지도 표시의 링크를 복사했습니다.');}catch{announce('링크 복사가 차단되었습니다. 현재 시점을 반영한 브라우저 주소를 직접 복사해주세요.');}});
 listen(document,'keydown',event=>{
  if(event.defaultPrevented||event.isComposing)return;
  const input=event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'),dialog=document.querySelector('dialog[open]');
  if(event.key==='Escape'&&measuring&&!dialog){event.preventDefault();setMeasurement(false);return;}
  if(input||dialog)return;
  if(((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k')||(!event.ctrlKey&&!event.metaKey&&event.key==='/')){event.preventDefault();openSearch();return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(['1','2','3','4'].includes(event.key)){event.preventDefault();onTab(['explore','observe','verify','map'][Number(event.key)-1]);}
  else if(event.key.toLowerCase()==='f'){event.preventDefault();fullscreen();}
  else if(event.key.toLowerCase()==='r'){event.preventDefault();onHome();}
  else if(event.key.toLowerCase()==='o'){event.preventDefault();onOrbit();}
  else if(event.key==='?'){event.preventDefault();openShortcuts();}
 });
 if(initialNight)toggleLowLight();

 return {
  handleMapClick,
  openSearch,
  updateStatus({state,label,layerCount}={}){if(label!==undefined)text('console-state',label);if(state&&$('console-state'))$('console-state').dataset.state=state;if(layerCount!==undefined)text('console-layer-count',String(layerCount));},
  dispose(){if(disposed)return;disposed=true;stopSearch();clearInterval(clockTimer);clearTimeout(noticeTimer);if(frame!==null)cancelAnimationFrame(frame);listeners.forEach(remove=>remove());mapListeners.forEach(remove=>remove());canvas.style.cursor=originalCursor;document.body.classList.remove('console-measuring','console-focus','console-night');for(const id of ['console-measure-points','console-measure-line'])if(map.getLayer(id))map.removeLayer(id);if(map.getSource('console-measure'))map.removeSource('console-measure');if(lowLight&&map.getLayer('satellite'))for(const [name,value] of Object.entries(originalPaint))map.setPaintProperty('satellite',name,value);}
 };
}
