// Historical imagery and observations are independent of the synthetic risk model.
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function timelineValues(series,metric){
 return series.map(row=>({year:row.year,value:Number.isFinite(row[metric])?row[metric]:null}));
}
export function yearDifference(series,metric,before,after){
 const a=series.find(row=>row.year===Number(before))?.[metric],b=series.find(row=>row.year===Number(after))?.[metric];
 return Number.isFinite(a)&&Number.isFinite(b)?b-a:null;
}
export function timelineSvg(series,metric,before,after){
 const rows=timelineValues(series,metric),rain=metric==='precipitationMm',valid=rows.filter(row=>row.value!==null);
 if(!valid.length)return '<p class="history-empty">이 지표의 확인된 수치가 없습니다. 지도는 NASA의 실제 식생 영상을 표시합니다.</p>';
 const width=280,height=116,left=24,right=20,top=22,bottom=25,min=rain?0:Math.min(0,...valid.map(row=>row.value)),max=rain?Math.max(1,...valid.map(row=>row.value))*1.2:Math.max(.8,...valid.map(row=>row.value));
 const x=index=>left+index*(width-left-right)/Math.max(1,rows.length-1),y=value=>top+(max-value)/(max-min)*(height-top-bottom),display=value=>rain?Math.round(value).toLocaleString('ko-KR'):value.toFixed(2);
 const marks=rows.map((row,index)=>{
  const selected=row.year===Number(before)||row.year===Number(after),color=selected?'#a8beff':'#76829d';
  return `<text x="${x(index)}" y="110" text-anchor="middle" fill="${color}" font-size="10">${row.year}</text>`+(row.value===null?`<text x="${x(index)}" y="60" text-anchor="middle" fill="#8190ad" font-size="12">—</text>`:`<line x1="${x(index)}" y1="${y(row.value)}" x2="${x(index)}" y2="${height-bottom}" stroke="${selected?'#4f7dff':'#334461'}" stroke-width="16" stroke-linecap="round"/><text x="${x(index)}" y="${y(row.value)-9}" text-anchor="middle" fill="${color}" font-size="10">${display(row.value)}</text>`);
 }).join('');
 const title=rows.map(row=>`${row.year}년 ${row.value===null?'자료 없음':display(row.value)+(rain?' mm':'')}`).join(', ');
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><line x1="10" x2="276" y1="${height-bottom}" y2="${height-bottom}" stroke="#ffffff16"/>${marks}</svg>`;
}

export function createHistoryView({dialog,regions,onOpen,onClose}){
 let data=null,loadPromise=null,maps=[],observer=null,epoch=0,region='gobi',before=2001,after=2025,metric='ndvi',split=50,tileFailures=new Set(),tileTimer=null;
 const $=selector=>dialog.querySelector(selector);
 const markup=`<header class="history-head"><div><span class="eyebrow">실제 위성자료 비교</span><h2>연도별 변화<span>실제 자료</span></h2></div><button id="history-close" class="close-btn history-return" aria-label="연도 비교 닫고 지도로 돌아가기"><span aria-hidden="true">←</span> 지도로 돌아가기</button></header>
 <div class="history-loading" role="status">실제 연도별 자료를 불러오는 중…</div>
 <div class="history-layout" hidden>
  <section class="history-map-area" aria-label="동일 위치의 연도별 식생지도 비교"><div id="history-before-map" class="history-map"></div><div id="history-after-map" class="history-map history-after-map" aria-hidden="true"></div><div class="history-year-tag history-tag-left" id="history-before-label"></div><div class="history-year-tag history-tag-right" id="history-after-label"></div><button id="history-divider" class="history-divider" aria-label="비교 경계. 아래 슬라이더나 방향키로 조절"><span>↔</span></button><div id="history-tile-status" class="history-tile-status" role="status" hidden></div><div class="history-map-controls"><button id="history-zoom-in" aria-label="비교 지도 확대">+</button><button id="history-zoom-out" aria-label="비교 지도 축소">−</button><button id="history-center" aria-label="참조 지점으로 이동">⌖</button></div><div class="history-split-control"><span id="history-split-label">비교 경계</span><input type="range" id="history-split" min="0" max="100" value="50" aria-labelledby="history-split-label"></div></section>
  <aside class="history-sidebar"><div class="history-selectors"><label class="history-region-label">참조 지역<select id="history-region"></select></label><div class="history-year-selects"><label>왼쪽 연도<select id="history-before-year"></select></label><span>↔</span><label>오른쪽 연도<select id="history-after-year"></select></label></div><p class="history-season">같은 8월의 월간 식생지수(NDVI) 비교</p></div>
  <div class="history-mobile-tabs" role="group" aria-label="연도 비교 화면"><button id="history-map-tab" aria-pressed="true">지도 비교</button><button id="history-chart-tab" aria-pressed="false">지표 변화</button></div>
  <section class="history-observations"><div class="history-chart-heading"><h3>참조 지점의 변화</h3><span id="history-coordinate"></span></div><div class="history-metric-tabs" role="group" aria-label="실제 지표 선택"><button data-history-metric="ndvi" aria-pressed="true">식생 NDVI</button><button data-history-metric="precipitationMm" aria-pressed="false">연 강수량</button></div><div id="history-chart"></div><div class="history-change"><span id="history-change-label"></span><strong id="history-change-value"></strong></div><p id="history-series-note"></p><p class="history-reference-note">그래프는 선택한 참조 지점의 자료입니다. 지도 이동으로 그래프의 지점이 바뀌지는 않습니다.</p></section>
  <div class="history-legend"><div><span>식생 적음</span><span>식생 많음</span></div><div class="history-legend-scale"></div><div><span>0</span><span>NDVI 1</span></div><p>빈 영역은 구름·눈·수역 또는 자료 없음일 수 있습니다.</p></div>
  <footer class="history-sources"><a id="history-imagery-source" target="_blank" rel="noopener">NASA 식생지도 출처 ↗</a><a id="history-series-source" target="_blank" rel="noopener">지점 자료 출처 ↗</a><p>월간 영상 비교는 사막화 진단이 아닙니다. 복원 모의 점수와 별도로 봅니다.</p></footer></aside></div>`;
 dialog.innerHTML=markup;
 const status=(message,show=true)=>{$('#history-tile-status').textContent=message;$('#history-tile-status').hidden=!show;};
 const setSplit=value=>{split=Math.max(0,Math.min(100,Number(value)));$('#history-after-map').style.clipPath=`inset(0 0 0 ${split}%)`;$('#history-divider').style.left=`${split}%`;$('#history-split').value=split;};
 const load=()=>{if(data)return Promise.resolve(data);if(!loadPromise)loadPromise=fetch(new URL('./data/history.json',import.meta.url),{signal:AbortSignal.timeout(20000)}).then(response=>{if(!response.ok)throw Error('연도별 자료를 읽지 못했습니다.');return response.json();}).then(value=>{if(value.schemaVersion!==1||!value.imagery?.ndvi||!value.regions?.gobi||!value.years?.length)throw Error('자료 형식이 올바르지 않습니다.');data=value;return value;}).catch(error=>{loadPromise=null;throw error;});return loadPromise;};
 function tileUrl(year){const imagery=data.imagery.ndvi,date=imagery.dateByYear[year];return imagery.tileUrlTemplate.replaceAll('{date}',date).replaceAll('{time}',date);}
 function refreshCharts(){
  const current=data.regions[region],series=current.series,difference=yearDifference(series,metric,before,after),rain=metric==='precipitationMm';
  $('#history-chart').innerHTML=timelineSvg(series,metric,before,after);
  $('#history-change-label').textContent=`${before} → ${after} 변화`;
  $('#history-change-value').textContent=difference===null?'자료 없음':`${difference>0?'+':''}${rain?Math.round(difference).toLocaleString('ko-KR'):difference.toFixed(3)}${rain?' mm':''}`;
  const coordinate=current.coordinate;$('#history-coordinate').textContent=`${coordinate[1].toFixed(2)}°, ${coordinate[0].toFixed(2)}°`;
  $('#history-series-note').textContent=rain?'연 강수량 · NASA POWER / MERRA-2 재분석 근사 합계':'250m 대표 픽셀 · 8월 중순 16일 합성. 지도는 8월 월 합성입니다. —는 구름·품질 미충족입니다.';
  const source=rain?current.sources.precipitationUrl:'https://doi.org/10.5067/MODIS/MOD13Q1.061';
  $('#history-series-source').hidden=!source;if(source)$('#history-series-source').href=source;
  dialog.querySelectorAll('[data-history-metric]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.historyMetric===metric)));
 }
 function updateYears(){
  before=Number($('#history-before-year').value);after=Number($('#history-after-year').value);
  $('#history-before-label').textContent=`${before}년 8월`;$('#history-after-label').textContent=`${after}년 8월`;
  tileFailures.clear();status('선택한 연도의 위성 자료를 불러오는 중…');clearTimeout(tileTimer);tileTimer=setTimeout(()=>{if(dialog.open)status('위성 자료 응답이 지연되고 있습니다. 지도를 이동하거나 연도를 다시 선택해 주세요.');},20000);
  maps.forEach((map,index)=>{const source=map.getSource('historical');if(source)source.setTiles([tileUrl(index?after:before)]);});refreshCharts();
 }
 function setRegion(key){region=key;tileFailures.clear();status('선택한 지역의 위성 자료를 불러오는 중…');refreshCharts();const coords=data.regions[region].coordinate;maps[0]?.jumpTo({center:coords,zoom:Math.min(regions[region].zoom,7),bearing:0,pitch:0});maps.forEach(map=>map.getSource('reference')?.setData({type:'Feature',geometry:{type:'Point',coordinates:coords}}));}
 function createMaps(){
  const imagery=data.imagery.ndvi,coords=data.regions[region].coordinate;
  maps=[0,1].map(index=>{
   const map=new window.maplibregl.Map({container:index?'history-after-map':'history-before-map',center:coords,zoom:Math.min(regions[region].zoom,7),minZoom:2,maxZoom:9,renderWorldCopies:false,interactive:!index,attributionControl:index?false:{compact:true},style:{version:8,sources:{historical:{type:'raster',tiles:[tileUrl(index?after:before)],tileSize:imagery.tileSize||256,maxzoom:imagery.maxzoom,attribution:'NASA GIBS · MODIS Terra · NDVI'}},layers:[{id:'history-background',type:'background',paint:{'background-color':'#182332'}},{id:'historical',type:'raster',source:'historical',paint:{'raster-fade-duration':0}}]}});
   map.on('load',()=>{if(!dialog.open)return;map.addSource('reference',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:data.regions[region].coordinate}}});map.addLayer({id:'reference-point',type:'circle',source:'reference',paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-color':'#315fee','circle-stroke-width':2}});map.getSource('historical').setTiles([tileUrl(index?after:before)]);});
   map.on('error',()=>{tileFailures.add(index);clearTimeout(tileTimer);status('일부 과거 영상에 연결하지 못했습니다. 빈 타일을 관측값으로 해석하지 마세요.');});
   map.on('idle',()=>{if(!dialog.open)return;if(maps.length===2&&maps.every(item=>item.isStyleLoaded()&&item.areTilesLoaded())){clearTimeout(tileTimer);if(!tileFailures.size)status('',false);}});
   return map;
  });
  maps[0].on('move',()=>{const source=maps[0];maps[1]?.jumpTo({center:source.getCenter(),zoom:source.getZoom(),bearing:source.getBearing(),pitch:source.getPitch()});});
  observer=new ResizeObserver(()=>maps.forEach(map=>map.resize()));observer.observe($('.history-map-area'));setSplit(split);
 }
 function cleanup(){epoch++;clearTimeout(tileTimer);observer?.disconnect();observer=null;maps.forEach(map=>map.remove());maps=[];$('.history-layout').hidden=true;onClose?.();}
 dialog.addEventListener('close',cleanup);
 $('#history-close').addEventListener('click',()=>dialog.close());
 $('#history-region').addEventListener('change',event=>setRegion(event.target.value));
 for(const id of ['history-before-year','history-after-year'])$('#'+id).addEventListener('change',updateYears);
 $('#history-split').addEventListener('input',event=>setSplit(event.target.value));
 $('#history-divider').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setSplit(event.key==='Home'?0:event.key==='End'?100:split+(event.key==='ArrowRight'?5:-5));}});
 $('#history-divider').addEventListener('pointerdown',event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);});
 $('#history-divider').addEventListener('pointermove',event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const bounds=$('.history-map-area').getBoundingClientRect();setSplit((event.clientX-bounds.left)/bounds.width*100);});
 $('#history-zoom-in').addEventListener('click',()=>maps[0]?.zoomIn({duration:0}));$('#history-zoom-out').addEventListener('click',()=>maps[0]?.zoomOut({duration:0}));$('#history-center').addEventListener('click',()=>setRegion(region));
 dialog.querySelectorAll('[data-history-metric]').forEach(button=>button.addEventListener('click',()=>{metric=button.dataset.historyMetric;refreshCharts();}));
 for(const [id,chart] of [['history-map-tab',false],['history-chart-tab',true]])$('#'+id).addEventListener('click',()=>{dialog.classList.toggle('history-charts-open',chart);$('#history-map-tab').setAttribute('aria-pressed',String(!chart));$('#history-chart-tab').setAttribute('aria-pressed',String(chart));maps.forEach(map=>map.resize());});
 return {get active(){return dialog.open;},close(){if(dialog.open)dialog.close();},async open(key='gobi'){
  if(dialog.open)return;const current=++epoch;region=Object.hasOwn(regions,key)?key:'gobi';dialog.classList.remove('history-charts-open');$('#history-map-tab').setAttribute('aria-pressed','true');$('#history-chart-tab').setAttribute('aria-pressed','false');$('.history-loading').hidden=false;$('.history-loading').textContent='실제 연도별 자료를 불러오는 중…';dialog.showModal();onOpen?.();
  try{await load();if(current!==epoch||!dialog.open)return;
   $('#history-region').innerHTML=Object.entries(data.regions).map(([key,value])=>`<option value="${key}">${escapeHtml(value.name)}</option>`).join('');$('#history-region').value=region;
   for(const id of ['history-before-year','history-after-year'])$('#'+id).innerHTML=data.years.map(year=>`<option value="${year}">${year}년</option>`).join('');
   before=data.years[0];after=data.years.at(-1);$('#history-before-year').value=before;$('#history-after-year').value=after;
   $('#history-imagery-source').href=data.imagery.ndvi.sourceUrl;$('.history-loading').hidden=true;$('.history-layout').hidden=false;updateYears();createMaps();$('#history-close').focus();
  }catch(error){$('.history-loading').textContent=error.message+' 창을 닫고 다시 열어주세요.';}
 }};
}
