import {analyze,regions,classInfo,riskClassFromScore,greedyPlan,restorationScores,managementNetwork,routeToTarget,featureCollection,polygon,distanceKm,clamp} from './model.mjs';
import {loadLandMask,isLand} from './land-mask.mjs';
import {enhance21stControls} from './ui-controls.mjs';
import {viewportBounds,sameBounds,createViewportScheduler} from './viewport.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const format=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const state={region:'gobi',custom:false,autoViewport:true,scope:'preset',bounds:{...regions.gobi.bounds},focusBounds:{...regions.gobi.bounds},restoredCamera:null,threshold:65,budget:30,years:3,generations:3,effect:60,after:false,step:'risk',scene:'day',is3d:true,selected:null,drawing:false,points:[],tour:false,ready:false};
let analysis,plan,map,route=[],networkEdges=[],timer,tourFrame,loadingTimer,viewport;
let analysisWorker=null,workerUnavailable=false,workerSequence=0;
const workerJobs=new Map();
let resultPage=0;
function setPane(pane){
 $('#inspector-heading').textContent={explore:'지역 탐색',analysis:'위험 분석',restore:'복원 시나리오',layers:'지도 설정'}[pane];
 $('.workspace').classList.remove('panel-collapsed');
 $('#panel-toggle').setAttribute('aria-expanded','true');
 $$('[data-pane]').forEach(button=>{const active=button.dataset.pane===pane;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
 $$('[data-pane-panel]').forEach(panel=>{const active=panel.dataset.panePanel===pane;panel.classList.toggle('active',active);panel.hidden=!active;});
 closeInspection();
}
function closeInspection(){state.selected=null;$('#inspect-panel').hidden=true;if(state.ready)setData('selected',featureCollection());}
function collapsePanel(){closeInspection();$('.workspace').classList.add('panel-collapsed');$('#panel-toggle').setAttribute('aria-expanded','false');}
const zoneColors=['#87b995','#b4ad79','#a195bd','#769bab','#b58d78','#9aa667'];
function recompute(){viewport?.invalidate();analysis=analyze(state.bounds,state);networkEdges=managementNetwork(analysis.centers.filter(c=>c.visible));plan=greedyPlan(analysis.cells,state.budget,state.threshold);route=routeToTarget(analysis,plan.selected[0]);if(state.ready)renderLayers();renderSummary();renderResults();if(state.selected!==null)inspectCell(state.selected);viewport?.refresh();}
function point(coords,properties={}){return {type:'Feature',properties,geometry:{type:'Point',coordinates:coords}};}
function line(coords,properties={}){return {type:'Feature',properties,geometry:{type:'LineString',coordinates:coords}};}
function setData(id,data){map.getSource(id)?.setData(data);}
function riskData(){const scores=restorationScores(analysis.cells,plan.selected,state.after?state.effect:0);return featureCollection(analysis.cells.filter(c=>c.isLand).map(c=>polygon(c,{cellId:c.id,color:classInfo[riskClassFromScore(scores[c.index])].color,risk:scores[c.index],zoneColor:zoneColors[(analysis.centers[c.zone]?.colorIndex??0)%zoneColors.length]})));}
function renderLayers(){
 setData('cells',riskData());
 const visible=analysis.centers.filter(c=>c.visible);setData('centers',featureCollection(visible.map(c=>point(c.coords,{label:c.label}))));
 setData('network',featureCollection(networkEdges.map(e=>line([visible[e.from].coords,visible[e.to].coords]))));
 setData('sites',featureCollection(plan.selected.map((c,i)=>point(c.coords,{index:c.index,cellId:c.id,rank:i+1}))));
 setData('route',featureCollection(route.length>1?[line(route.map(c=>c.coords))]:[]));
 setData('boundary',featureCollection([polygon({bounds:state.bounds,index:0})]));
 setData('selected',featureCollection(state.selected!==null&&analysis.cells[state.selected]?[polygon(analysis.cells[state.selected])]:[]));
}
function renderSummary(){const land=analysis.cells.filter(c=>c.isLand),scores=restorationScores(analysis.cells,plan.selected,state.after?state.effect:0),areas=[0,0,0,0];let riskArea=0;
 land.forEach(c=>{areas[riskClassFromScore(scores[c.index])]+=c.area;if(scores[c.index]*100>=state.threshold)riskArea+=c.area;});
 const percentage=a=>analysis.area?a/analysis.area*100:0,pct=percentage(riskArea);
 $('#risk-percent').innerHTML=analysis.area?`${pct.toFixed(1)}<small>%</small>`:'—';$('#risk-ring-value').style.strokeDasharray=`${201*pct/100} 201`;
 $('#analysis-count').textContent=analysis.area?`육지 ${format.format(analysis.landCellCount)}셀`:'수역 · 분석 제외';
 $('#risk-area').textContent=analysis.area?`${format.format(riskArea)} km²`:'분석할 육지 없음';
 $('#distribution').innerHTML=areas.map((a,i)=>`<i style="width:${percentage(a)}%;background:${classInfo[i].color}"></i>`).join('');
 $('#distribution-labels').innerHTML=analysis.area?areas.map((a,i)=>`<span>${classInfo[i].label} ${percentage(a).toFixed(0)}%</span>`).join(''):'<span>바다·호수는 위험등급 없음</span>';
 $('#selected-count').textContent=plan.selected.length;$('#spent').textContent=`${plan.spent.toFixed(1)} / ${state.budget}억`;$('#budget-track').style.width=`${state.budget?plan.spent/state.budget*100:0}%`;
 const after=restorationScores(analysis.cells,plan.selected,state.effect),baseline=percentage(land.reduce((s,c)=>s+c.riskScore*c.area,0)),post=percentage(land.reduce((s,c)=>s+after[c.index]*c.area,0));
 $('#scenario-delta').textContent=analysis.area?`${baseline.toFixed(2)} → ${post.toFixed(2)}`:'분석할 육지 없음';
}
function renderResults(){
 const land=analysis.cells.filter(c=>c.isLand),avg=key=>analysis.area?land.reduce((s,c)=>s+c[key]*c.area,0)/analysis.area:0;
 const visible=analysis.centers.filter(c=>c.visible);
 const descriptions={
  risk:['NB + CA','육지의 위험 분포','합성 환경지표 6개와 주변 육지 셀로 위험도를 계산합니다.'],
  zones:['VORONOI','육지 관리구역','육지에 놓인 가상 거점까지의 거리로 담당 구역을 나눕니다.'],
  plan:['GREEDY','복원 우선순위','편익 대비 비용 순으로 예산 안에서 최대 7곳을 고릅니다.'],
  route:['PRIM + A*','거점과 현장 연결','수역을 지나는 연결을 제외한 모의 접근 계획입니다.']
 };
 const d=descriptions[state.step];$('#step-tag').textContent=d[0];$('#step-title').textContent=d[1];$('#step-description').textContent=d[2];
 let html='';
 if(!analysis.area)html='<div class="empty-result"><strong>이 화면은 수역입니다</strong><p>바다·호수에는 사막화 위험을 계산하지 않습니다. 육지로 이동하면 자동 분석이 이어집니다.</p></div>';
 else if(state.step==='risk')html=`<div class="result-metric"><span>분석 육지 면적</span><strong>${format.format(analysis.area)}<small>km²</small></strong></div><div class="metric-grid"><div class="metric-tile"><span>식생지수</span><b>${avg('ndvi').toFixed(2)}</b><small>NDVI · 합성</small></div><div class="metric-tile"><span>토양 수분</span><b>${avg('moisture').toFixed(1)}%</b><small>면적 가중 평균</small></div></div><p class="micro">수역 제외 · 육지 ${format.format(land.length)}셀 · CA ${state.generations}세대</p>`;
 else if(state.step==='zones')html=`<div class="metric-grid"><div class="metric-tile"><span>화면 안 거점</span><b>${visible.length}</b><small>육지의 가상 시설</small></div><div class="metric-tile"><span>담당 거점</span><b>${new Set(land.map(c=>c.zone).filter(z=>z!==null)).size}</b><small>화면 밖 인접 거점 포함</small></div></div><p class="micro">거점 간격은 지도 축척에 따라 바뀝니다.</p>`;
 else if(state.step==='plan'){
  const pageCount=Math.max(1,Math.ceil(plan.selected.length/2));resultPage=Math.min(resultPage,pageCount-1);
  html=plan.selected.length?`<div class="result-metric"><span>선정 육지 면적</span><strong>${format.format(plan.selected.reduce((s,c)=>s+c.area,0))}<small>km²</small></strong></div>${plan.selected.slice(resultPage*2,resultPage*2+2).map((c,i)=>`<button class="rank-row" data-cell="${c.index}"><span class="rank">${resultPage*2+i+1}</span><span><strong>복원 후보 · 위험 ${(c.riskScore*100).toFixed(0)}</strong><small>${c.latlng.lat.toFixed(2)}°, ${c.latlng.lng.toFixed(2)}°</small></span><span class="cost">${c.cost.toFixed(1)}억</span></button>`).join('')}<div class="result-pagination"><button id="plan-prev" aria-label="이전 복원 후보" ${resultPage===0?'disabled':''}>←</button><span id="plan-page">${resultPage+1} / ${pageCount} · 총 ${plan.selected.length}곳</span><button id="plan-next" aria-label="다음 복원 후보" ${resultPage===pageCount-1?'disabled':''}>→</button></div>`:`<p class="empty-result">${state.budget===0?'예산을 늘리면 복원 후보가 표시됩니다.':'선정 가능한 육지 후보가 없습니다. 복원 탭에서 예산이나 위험 기준을 조절해보세요.'}</p>`;
 }else if(state.step==='route'){
  const total=networkEdges.reduce((s,e)=>s+e.distance,0),length=route.reduce((s,c,i)=>i?s+distanceKm(route[i-1].coords,c.coords):s,0);
  html=`<div class="metric-grid"><div class="metric-tile"><span>육지 연결망</span><b>${format.format(total)}</b><small>km · ${networkEdges.length}개 연결</small></div><div class="metric-tile"><span>1순위 접근</span><b>${route.length?length.toFixed(1):'—'}</b><small>km · 모의 경로</small></div></div><p class="micro">${route.length?'실제 도로·경사·통행 조건은 반영하지 않습니다.':'연결할 거점·후보가 없거나 수역에 막혀 경로가 없습니다.'}</p>`;
 }
 $('#result-content').innerHTML=html;
 $$('[data-cell]').forEach(b=>b.addEventListener('click',()=>inspectCell(Number(b.dataset.cell))));
 $('#plan-prev')?.addEventListener('click',()=>{resultPage--;renderResults();$('#plan-prev')?.focus();});
 $('#plan-next')?.addEventListener('click',()=>{resultPage++;renderResults();$('#plan-next')?.focus();});
}
function initMap(){try{if(!window.maplibregl)throw Error('지도 라이브러리를 읽지 못했습니다.');map=new maplibregl.Map({container:'map',center:regions.gobi.center,zoom:6.4,pitch:55,bearing:-15,maxPitch:75,minZoom:2,maxZoom:16,attributionControl:{compact:true},style:{version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:18,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'},dem:{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:'Terrain © Mapzen / AWS & source providers'}},layers:[{id:'background',type:'background',paint:{'background-color':'#283728'}},{id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-.22,'raster-contrast':.12}}]}});
 map.on('load',()=>{map.setTerrain({source:'dem',exaggeration:2});['cells','centers','network','sites','route','boundary','selected','drawing'].forEach(id=>map.addSource(id,{type:'geojson',data:featureCollection()}));
 map.addLayer({id:'risk',type:'fill',source:'cells',paint:{'fill-color':['get','color'],'fill-opacity':.4}});
 map.addLayer({id:'zones',type:'fill',source:'cells',layout:{visibility:'none'},paint:{'fill-color':['get','zoneColor'],'fill-opacity':.46}});
 map.addLayer({id:'boundary',type:'line',source:'boundary',paint:{'line-color':'#d2ec96','line-width':1.4,'line-dasharray':[4,3]}});
 map.addLayer({id:'network',type:'line',source:'network',layout:{visibility:'none'},paint:{'line-color':'#d2ec96','line-width':2,'line-dasharray':[4,3]}});
 map.addLayer({id:'route',type:'line',source:'route',paint:{'line-color':'#8bdfe6','line-width':3}});
 map.addLayer({id:'centers',type:'circle',source:'centers',paint:{'circle-radius':4,'circle-color':'#1a251d','circle-stroke-width':1.5,'circle-stroke-color':'#d2ec96'}});
 map.addLayer({id:'sites',type:'circle',source:'sites',paint:{'circle-radius':8,'circle-color':'#d2ec96','circle-stroke-width':2.5,'circle-stroke-color':'#17261b'}});
 map.addLayer({id:'selected',type:'line',source:'selected',paint:{'line-color':'#ffffff','line-width':2.5}});
 map.addLayer({id:'drawing',type:'circle',source:'drawing',paint:{'circle-radius':7,'circle-color':'#ffffff','circle-stroke-width':2,'circle-stroke-color':'#182719'}});
 state.ready=true;renderLayers();$('#map-status').hidden=true;$('#map-error').hidden=true;clearTimeout(loadingTimer);bindMap();initViewportAnalysis();map.setTerrain(state.is3d?{source:'dem',exaggeration:2}:null);map.setPaintProperty('risk','fill-opacity',Number($('#opacity').value)/100);if(state.restoredCamera){map.jumpTo(state.restoredCamera);state.restoredCamera=null;}else setRegionCamera(false);applyScene();updateLayerVisibility();viewport.refresh();});
 map.on('error',e=>{if(!state.ready){$('#map-status').textContent='외부 지도 자료를 기다리는 중입니다. 연결 상태를 확인해주세요.';}});
 loadingTimer=setTimeout(()=>{if(!state.ready){$('#map-error').hidden=false;$('#map-error-text').textContent='지도 응답이 지연되고 있습니다. 인터넷 연결 또는 WebGL 지원 상태를 확인해주세요.';}},20000);
 }catch(e){$('#map-error').hidden=false;$('#map-error-text').textContent=e.message;$('#map-status').hidden=true;}}

function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('#toast').hidden=true,4500);}
function pressed(button,active){button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
function showDialog(){if(!$('#about-dialog').open)$('#about-dialog').showModal();}
function updateLayerVisibility() {if(!state.ready)return;$$('[data-layer]').forEach(input=>map.setLayoutProperty(input.dataset.layer,'visibility',input.checked?'visible':'none'));}
function setStep(step){state.step=step;resultPage=0;setPane('analysis');$$('[data-step]').forEach(b=>pressed(b,b.dataset.step===step));
 const layers={risk:['risk','route'],zones:['zones','network'],plan:['risk','route'],route:['risk','network','route']}[step];$$('[data-layer]').forEach(i=>i.checked=layers.includes(i.dataset.layer));updateLayerVisibility();renderResults();}
function replan(){viewport?.invalidate();plan=greedyPlan(analysis.cells,state.budget,state.threshold);route=routeToTarget(analysis,plan.selected[0]);if(state.ready)renderLayers();renderSummary();renderResults();if(state.selected!==null)inspectCell(state.selected);viewport?.refresh();}
function applyScenario(after){state.after=after;pressed($('#before-btn'),!after);pressed($('#after-btn'),after);if(state.ready)setData('cells',riskData());renderSummary();if(state.selected!==null)inspectCell(state.selected);}
function syncControls(){for(const key of ['threshold','budget','years','generations','effect'])$('#'+key).value=state[key];$('#threshold-value').innerHTML=`${state.threshold}<span> / 100</span>`;$('#budget-value').innerHTML=`${state.budget}<span>억 원</span>`;$('#effect-value').textContent=`${state.effect/2}%`;}
function setRegionCamera(animate=true){if(!state.ready)return;stopTour();const b=state.focusBounds;map.fitBounds([[b.west,b.south],[b.east,b.north]],{padding:window.innerWidth>850?{top:95,bottom:135,left:365,right:75}:{top:90,bottom:130,left:25,right:60},pitch:state.is3d?55:0,bearing:state.is3d?-15:0,duration:animate&&!reduced.matches?1400:0});}
function regionIdentity(){const r=regions[state.region],live=state.scope==='viewport';$('#region-title').replaceChildren(document.createTextNode(live?'현재 지도':state.custom?'선택 구역':r.name),Object.assign(document.createElement('span'),{textContent:live?'이동하는 화면을 육지 기준으로 분석합니다':state.custom?'선택한 육지의 변화를 살펴보세요':'육지의 변화를 탐색하세요'}));$('#region-kicker').textContent=live?'이동하는 화면을 따라':state.custom?'직접 선택한 분석 범위':r.sub;$('#area-status').textContent=state.autoViewport?'이동·확대·축소할 때 화면 전체를 자동 분석':'분석 구역 고정 · 자동 분석을 켜면 화면을 따라갑니다';$('#auto-viewport').checked=state.autoViewport;$('.live-indicator').textContent=state.autoViewport?'자동 갱신':'구역 고정';$$('[data-region]').forEach(b=>pressed(b,!state.custom&&b.dataset.region===state.region));}
function selectRegion(key){viewport?.invalidate();cancelDrawing();state.region=key;state.custom=false;state.scope='preset';state.autoViewport=true;state.bounds={...regions[key].bounds};state.focusBounds={...state.bounds};state.selected=null;$('#inspect-panel').hidden=true;regionIdentity();recompute();setRegionCamera();}
function inspectCell(index){const c=analysis.cells[index];if(!c)return;if(!c.isLand){closeInspection();return toast('수역 · 바다와 호수는 사막화 분석에서 제외됩니다.');}state.selected=index;const chosen=plan.selected.some(p=>p.index===index);const score=c.riskScore*(state.after&&chosen?1-state.effect/200:1);$('#inspect-panel').hidden=false;$('#inspect-title').textContent=chosen?'복원 선정 셀':'선택 셀';$('#cell-id').textContent=c.id;$('#cell-risk').innerHTML=`${(score*100).toFixed(1)}<small>${classInfo[riskClassFromScore(score)].label} · 모의 위험점수</small>`;$('#cell-risk').style.color=classInfo[riskClassFromScore(score)].color;
 const items=[['NDVI',c.ndvi.toFixed(2)],['식생 변화',`${c.ndviTrend.toFixed(1)}%`],['월 강수량',`${c.rainfall.toFixed(1)} mm`],['토양 수분',`${c.moisture.toFixed(1)}%`],['지표 온도',`${c.temperature.toFixed(1)}°C`],['나지 비율',`${c.bareSoil.toFixed(1)}%`],['NB / CA 점수',`${(c.nbRiskScore*100).toFixed(1)} / ${(c.riskScore*100).toFixed(1)}`],['셀의 육지 면적',`${c.area.toFixed(2)} km²`],['가상 비용',`${c.cost.toFixed(2)}억 원`]];$('#cell-metrics').innerHTML=items.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('');if(state.ready)setData('selected',featureCollection([polygon(c)]));}
function applyScene(){if(!state.ready)return;const settings={day:[-.22,1,.12],dusk:[.05,.82,.18],night:[-.72,.43,.22]}[state.scene];map.setPaintProperty('satellite','raster-saturation',settings[0]);map.setPaintProperty('satellite','raster-brightness-max',settings[1]);map.setPaintProperty('satellite','raster-contrast',settings[2]);}
function setView(is3d){state.is3d=is3d;pressed($('#view-3d'),is3d);pressed($('#view-2d'),!is3d);$('#terrain-caption').textContent=is3d?'실제 표고 · 높이 2×':'평면 지도 · 지형 강조 없음';if(state.ready){map.setTerrain(is3d?{source:'dem',exaggeration:2}:null);map.easeTo({pitch:is3d?55:0,bearing:is3d?map.getBearing():0,duration:reduced.matches?0:800});}}
function stopTour(){const wasTour=state.tour;state.tour=false;cancelAnimationFrame(tourFrame);pressed($('#tour-btn'),false);if(wasTour)viewport?.settle();}
function toggleTour(){if(state.tour){stopTour();return;}if(!state.ready)return toast('지도를 불러온 뒤 다시 시도해주세요.');if(reduced.matches)return toast('기기의 동작 줄이기 설정으로 자동 회전이 꺼져 있습니다.');state.tour=true;pressed($('#tour-btn'),true);let prev=performance.now();const tick=now=>{if(!state.tour)return;map.setBearing(map.getBearing()+Math.min(now-prev,50)*.002);prev=now;tourFrame=requestAnimationFrame(tick);};tourFrame=requestAnimationFrame(tick);}
function cancelDrawing(){const wasDrawing=state.drawing;state.drawing=false;state.points=[];$('#draw-btn').textContent='⌗ 구역 직접 지정';$('#draw-btn').classList.remove('active');if(map){map.getCanvas().style.cursor='';if(state.ready)setData('drawing',featureCollection());}$('#map-status').hidden=state.ready;if(wasDrawing)viewport?.refresh();}
function normalizedBounds(b){return viewportBounds(b);}
function setBounds(bounds){try{bounds=normalizedBounds(bounds);const next=analyze(bounds,state);viewport?.invalidate();state.autoViewport=false;state.scope='fixed';state.bounds={...bounds};state.focusBounds={...bounds};state.custom=true;analysis=next;networkEdges=managementNetwork(analysis.centers.filter(c=>c.visible));state.selected=null;$('#inspect-panel').hidden=true;regionIdentity();replan();return true;}catch(e){toast(e.message);return false;}}

function computeAnalysisJob(payload){const next=analyze(payload.bounds,payload),nextPlan=greedyPlan(next.cells,payload.budget,payload.threshold);return {analysis:next,plan:nextPlan,route:routeToTarget(next,nextPlan.selected[0]),network:managementNetwork(next.centers.filter(c=>c.visible))};}
function computeViewport(bounds){
 if(sameBounds(bounds,state.bounds)){state.scope='viewport';state.custom=true;regionIdentity();return Promise.resolve(null);}
 $('#area-status').textContent='이동한 화면 전체를 분석하는 중…';
 const payload={id:++workerSequence,bounds,years:state.years,generations:state.generations,budget:state.budget,threshold:state.threshold};
 if(!analysisWorker&&!workerUnavailable){try{
  analysisWorker=new Worker(new URL('./analysis.worker.mjs',import.meta.url),{type:'module',name:'land15-analysis'});
  analysisWorker.onmessage=({data})=>{const job=workerJobs.get(data.id);if(!job)return;workerJobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.result);};
  analysisWorker.onerror=()=>{analysisWorker?.terminate();analysisWorker=null;workerUnavailable=true;for(const job of workerJobs.values()){try{job.resolve(computeAnalysisJob(job.payload));}catch(error){job.reject(error);}}workerJobs.clear();};
 }catch{workerUnavailable=true;}}
 if(!analysisWorker)return Promise.resolve(computeAnalysisJob(payload));
 return new Promise((resolve,reject)=>{workerJobs.set(payload.id,{resolve,reject,payload});analysisWorker.postMessage(payload);});
}
function applyViewportResult(result){
 analysis=result.analysis;plan=result.plan;route=result.route;networkEdges=result.network;state.bounds={...analysis.bounds};state.custom=true;state.scope='viewport';state.selected=null;$('#inspect-panel').hidden=true;
 regionIdentity();renderLayers();renderSummary();renderResults();
}
function initViewportAnalysis(){
 viewport=createViewportScheduler({
  readBounds(){const b=map.getBounds();return viewportBounds({west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()});},
  compute:computeViewport,apply:applyViewportResult,
  enabled:()=>state.ready&&state.autoViewport&&!state.drawing&&!document.hidden,
  onError(error){$('#area-status').textContent='자동 분석을 다시 시도하려면 현재 화면 분석을 눌러주세요.';toast(error.message);}
 });
 map.on('move',()=>viewport.move());map.on('moveend',()=>viewport.settle());map.on('resize',()=>viewport.settle());
 window.addEventListener('pagehide',event=>{if(event.persisted){viewport.invalidate();return;}viewport.dispose();analysisWorker?.terminate();workerJobs.clear();});
 window.addEventListener('pageshow',event=>{if(event.persisted)viewport.refresh();});
}
function bindMap(){
 map.on('click',e=>{if(state.drawing){const drawLng=state.points.length?e.lngLat.lng+360*Math.round((state.points[0][0]-e.lngLat.lng)/360):e.lngLat.lng;state.points.push([drawLng,e.lngLat.lat]);setData('drawing',featureCollection(state.points.map(p=>point(p))));if(state.points.length===1){$('#map-status').textContent='반대쪽 모서리를 선택해주세요. Esc로 취소할 수 있습니다.';return;}const [a,b]=state.points;const bounds={west:Math.min(a[0],b[0]),east:Math.max(a[0],b[0]),south:Math.min(a[1],b[1]),north:Math.max(a[1],b[1])};if(bounds.east-bounds.west<.005||bounds.north-bounds.south<.005){toast('분석 구역이 너무 작습니다. 두 모서리를 다시 선택해주세요.');state.points=[];setData('drawing',featureCollection());return;}cancelDrawing();if(setBounds(bounds))setRegionCamera();return;}
 const features=map.queryRenderedFeatures(e.point,{layers:['sites']});if(features.length){const f=features[0],index=Number(f.properties.index);if(analysis.cells[index]?.id===f.properties.cellId)inspectCell(index);return;}const b=state.bounds,lng=e.lngLat.lng+360*Math.round(((b.west+b.east)/2-e.lngLat.lng)/360),lat=e.lngLat.lat;if(lng>=b.west&&lng<=b.east&&lat>=b.south&&lat<=b.north){if(!isLand([lng,lat])){closeInspection();return toast('수역 · 바다와 호수는 사막화 분석에서 제외됩니다.');}const col=Math.min(63,Math.floor((lng-b.west)/(b.east-b.west)*64)),row=Math.min(47,Math.floor((b.north-lat)/(b.north-b.south)*48));inspectCell(row*64+col);}});
 map.on('move',()=>{const c=map.getCenter();$('#map-coordinates').textContent=`${Math.abs(c.lat).toFixed(4)}° ${c.lat>=0?'N':'S'}   ${Math.abs(c.lng).toFixed(4)}° ${c.lng>=0?'E':'W'}`;});
 map.on('mousedown',stopTour);map.on('touchstart',stopTour);map.on('wheel',stopTour);
 map.on('error',e=>{if(state.ready&&/tile|fetch|network/i.test(e.error?.message||'')){clearTimeout(timer);$('#map-status').hidden=false;$('#map-status').textContent='일부 배경 자료를 불러오지 못했습니다. 분석값은 합성 데이터입니다.';}});
 map.getCanvas().addEventListener('webglcontextlost',()=>{$('#map-error').hidden=false;$('#map-error-text').textContent='그래픽 연결이 끊겼습니다. 다시 불러오거나 다른 브라우저에서 열어주세요.';});
}
function exportCsv(){const post=restorationScores(analysis.cells,plan.selected,state.effect),selected=new Set(plan.selected.map(c=>c.index));const rows=[['data_type','region','cell_id','latitude','longitude','area_km2','ndvi','ndvi_trend_pct','rainfall_mm','moisture_pct','temperature_c','bare_soil_pct','nb_risk_score','ca_risk_score','scenario_risk_score','selected','virtual_cost_100m_krw','budget_100m_krw','threshold','scenario_reduction_pct']];analysis.cells.forEach((c,i)=>{if(c.isLand)rows.push(['SYNTHETIC_EDUCATIONAL',state.scope==='viewport'?'viewport':state.custom?'custom':state.region,c.id,c.latlng.lat,c.latlng.lng,c.area,c.ndvi,c.ndviTrend,c.rainfall,c.moisture,c.temperature,c.bareSoil,c.nbRiskScore,c.riskScore,post[i],selected.has(i),c.cost,state.budget,state.threshold,state.effect/2]);});const blob=new Blob(['\ufeff'+rows.map(r=>r.join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`LAND15-${state.scope === 'viewport' ? 'viewport' : state.custom ? 'custom' : state.region}-synthetic.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('합성 데이터 표시가 포함된 CSV를 저장했습니다.');}
async function shareSettings(){const q=new URLSearchParams({region:state.region,budget:String(state.budget),threshold:String(state.threshold),years:String(state.years),ca:String(state.generations),effect:String(state.effect),after:state.after?'1':'0',bounds:[state.bounds.west,state.bounds.south,state.bounds.east,state.bounds.north].map(v=>v.toFixed(7)).join(','),auto:state.autoViewport?'1':'0'});if(state.ready){const c=map.getCenter();q.set('camera',[c.lng,c.lat,map.getZoom(),map.getBearing(),map.getPitch()].map(v=>v.toFixed(7)).join(','));}const url=new URL(location.href);url.search='';url.hash=q.toString();history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url.href);toast('현재 지역·분석 조건·복원 가정이 담긴 링크를 복사했습니다.');}catch{toast('주소창에 설정을 저장했습니다. 주소를 복사해 사용할 수 있습니다.');}}
function restoreSettings(){try{const q=new URLSearchParams(location.hash.slice(1)),region=q.get('region');if(region&&!Object.hasOwn(regions,region))throw Error('지역');if(region){state.region=region;state.bounds={...regions[region].bounds};}
 for(const [key,param,min,max]of [['budget','budget',0,80],['threshold','threshold',20,95],['years','years',1,8],['generations','ca',0,8],['effect','effect',0,100]])if(q.has(param)){const value=Number(q.get(param));if(!Number.isFinite(value)||value<min||value>max)throw Error(param);state[key]=value;}
 if(![1,3,5,8].includes(state.years)||![0,1,3,5,8].includes(state.generations))throw Error('기간');
 if(q.has('bounds')){const values=q.get('bounds').split(',').map(Number);if(values.length!==4||values.some(v=>!Number.isFinite(v)))throw Error('구역');state.bounds=normalizedBounds({west:values[0],south:values[1],east:values[2],north:values[3]});analyze(state.bounds,state);state.custom=Object.keys(state.bounds).some(k=>Math.abs(state.bounds[k]-regions[state.region].bounds[k])>1e-6);}
 state.after=q.get('after')==='1';state.autoViewport=q.has('auto')?q.get('auto')!=='0':!q.has('bounds');state.focusBounds={...state.bounds};state.scope=state.custom?'fixed':'preset';
 if(q.has('camera')){const values=q.get('camera').split(',').map(Number);if(values.length!==5||values.some(v=>!Number.isFinite(v))||Math.abs(values[1])>85.0511287798066||values[2]<2||values[2]>16||values[4]<0||values[4]>75)throw Error('카메라');state.restoredCamera={center:values.slice(0,2),zoom:values[2],bearing:values[3],pitch:values[4]};state.is3d=values[4]>0;}
 }catch{Object.assign(state,{region:'gobi',custom:false,autoViewport:true,scope:'preset',focusBounds:{...regions.gobi.bounds},restoredCamera:null,bounds:{...regions.gobi.bounds},budget:30,threshold:65,years:3,generations:3,effect:60,after:false});toast('유효하지 않은 설정 링크입니다. 기본 고비 시나리오로 시작합니다.');}}
function bindControls(){
 const paneButtons=$$('[data-pane]');
 if(window.matchMedia('(max-width: 700px), (max-height: 600px)').matches){$('.workspace').classList.add('panel-collapsed');$('#panel-toggle').setAttribute('aria-expanded','false');}
 paneButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>{if(button.classList.contains('active')&&!$('.workspace').classList.contains('panel-collapsed')&&state.selected===null)collapsePanel();else setPane(button.dataset.pane);});
  button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%paneButtons.length;else if(event.key==='ArrowLeft')next=(index+paneButtons.length-1)%paneButtons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=paneButtons.length-1;else return;event.preventDefault();setPane(paneButtons[next].dataset.pane);paneButtons[next].focus();});
 });
 $('#panel-toggle').addEventListener('click',()=>{const collapsed=$('.workspace').classList.toggle('panel-collapsed');$('#panel-toggle').setAttribute('aria-expanded',String(!collapsed));closeInspection();});
 $$('[data-region]').forEach(b=>b.addEventListener('click',()=>selectRegion(b.dataset.region)));$$('[data-layer]').forEach(i=>i.addEventListener('change',updateLayerVisibility));$$('[data-step]').forEach(b=>b.addEventListener('click',()=>setStep(b.dataset.step)));$$('[data-scene]').forEach(b=>b.addEventListener('click',()=>{state.scene=b.dataset.scene;$$('[data-scene]').forEach(v=>pressed(v,v===b));applyScene();}));
 ['threshold','budget'].forEach(key=>$('#'+key).addEventListener('input',e=>{state[key]=Number(e.target.value);syncControls();replan();}));['years','generations'].forEach(key=>$('#'+key).addEventListener('change',e=>{state[key]=Number(e.target.value);recompute();}));
 $('#effect').addEventListener('input',e=>{state.effect=Number(e.target.value);syncControls();applyScenario(state.after);});$('#before-btn').addEventListener('click',()=>applyScenario(false));$('#after-btn').addEventListener('click',()=>applyScenario(true));
 $('#opacity').addEventListener('input',e=>{const value=Number(e.target.value);$('#opacity-value').textContent=`${value}%`;if(state.ready)map.setPaintProperty('risk','fill-opacity',value/100);});
 $('#plan-btn').addEventListener('click',()=>setStep('plan'));
 for(const id of ['about-btn','sources-btn','method-btn'])$('#'+id).addEventListener('click',showDialog);$('#about-close').addEventListener('click',()=>$('#about-dialog').close());$('#about-dialog').addEventListener('click',e=>{if(e.target===$('#about-dialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
 $('#inspect-close').addEventListener('click',closeInspection);
 $('#view-3d').addEventListener('click',()=>setView(true));$('#view-2d').addEventListener('click',()=>setView(false));$('#tour-btn').addEventListener('click',toggleTour);$('#north-btn').addEventListener('click',()=>{stopTour();map?.easeTo({bearing:0,duration:reduced.matches?0:500});});$('#home-btn').addEventListener('click',()=>setRegionCamera());$('#zoom-in').addEventListener('click',()=>{stopTour();map?.zoomIn({duration:reduced.matches?0:300});});$('#zoom-out').addEventListener('click',()=>{stopTour();map?.zoomOut({duration:reduced.matches?0:300});});
 $('#fullscreen-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('.workspace').requestFullscreen)await $('.workspace').requestFullscreen();else return toast('이 브라우저는 전체 화면을 지원하지 않습니다.');map?.resize();}catch{toast('전체 화면 전환을 사용할 수 없습니다.');}});document.addEventListener('fullscreenchange',()=>map?.resize());
 $('#draw-btn').addEventListener('click',()=>{if(!state.ready)return toast('지도를 불러온 뒤 구역을 지정해주세요.');if(state.drawing)return cancelDrawing();stopTour();viewport?.invalidate();state.drawing=true;state.points=[];$('#draw-btn').textContent='지정 취소 · Esc';$('#draw-btn').classList.add('active');map.getCanvas().style.cursor='crosshair';$('#map-status').hidden=false;$('#map-status').textContent='분석할 사각 구역의 첫 번째 모서리를 선택해주세요.';});
 $('#viewport-btn').addEventListener('click',()=>{if(!state.ready)return toast('지도를 불러온 뒤 다시 시도해주세요.');cancelDrawing();state.autoViewport=true;regionIdentity();viewport.refresh();toast('화면 전체 자동 분석을 시작했습니다.');});
 $('#auto-viewport').addEventListener('change',e=>{viewport?.invalidate();state.autoViewport=e.target.checked;if(!state.autoViewport){state.focusBounds={...state.bounds};state.scope='fixed';state.custom=true;}regionIdentity();if(state.autoViewport)viewport?.refresh();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.drawing)cancelDrawing();});document.addEventListener('visibilitychange',()=>{if(document.hidden){stopTour();viewport?.invalidate();}else viewport?.refresh();});reduced.addEventListener('change',()=>{if(reduced.matches)stopTour();});
 $('#reset-btn').addEventListener('click',()=>{Object.assign(state,{threshold:65,budget:30,years:3,generations:3,effect:60,after:false});syncControls();applyScenario(false);setView(true);selectRegion('gobi');setStep('risk');state.scene='day';$$('[data-scene]').forEach(b=>pressed(b,b.dataset.scene==='day'));applyScene();$('#opacity').value=40;$('#opacity-value').textContent='40%';if(state.ready)map.setPaintProperty('risk','fill-opacity',.4);history.replaceState(null,'',location.pathname+location.search);toast('고비 기본 시나리오로 돌아왔습니다.');});$('#retry-btn').addEventListener('click',()=>location.reload());$('#export-btn').addEventListener('click',exportCsv);$('#share-btn').addEventListener('click',shareSettings);
}
function registerAgentTools(){if(!document.modelContext?.registerTool)return;const lifecycle=new AbortController();const tools=[
 {name:'read_land15_analysis',title:'LAND:15 분석 읽기',description:'Read the active synthetic region, budget, risk threshold and selected restoration cells.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return {dataType:'synthetic_educational',region:state.scope==='viewport'?'viewport':state.custom?'custom':state.region,analysisMode:state.autoViewport?'viewport':'fixed',bounds:state.bounds,budget:state.budget,threshold:state.threshold,spent:plan.spent,selected:plan.selected.map(c=>({id:c.id,coordinates:c.coords,risk:c.riskScore,cost:c.cost}))};}},
 {name:'configure_land15_scenario',title:'LAND:15 복원 시나리오 설정',description:'Change the visible region, virtual budget and threshold, then calculate a synthetic restoration plan.',inputSchema:{type:'object',properties:{region:{type:'string',enum:Object.keys(regions)},budget:{type:'integer',minimum:0,maximum:80},threshold:{type:'integer',minimum:20,maximum:95}},required:['region','budget','threshold'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['region','budget','threshold'].includes(k))||!Object.hasOwn(regions,input.region)||!Number.isInteger(input.budget)||input.budget<0||input.budget>80||!Number.isInteger(input.threshold)||input.threshold<20||input.threshold>95)throw Error('Invalid LAND:15 scenario');state.budget=input.budget;state.threshold=input.threshold;syncControls();selectRegion(input.region);setStep('plan');return {dataType:'synthetic_educational',region:state.region,budget:state.budget,threshold:state.threshold,spent:plan.spent,selectedCount:plan.selected.length};}}
 ];for(const tool of tools)try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
await startApp();
async function startApp(){
 try {
 $('#map-status').textContent='해안선과 호수 경계를 불러오는 중…';
 await loadLandMask();
 $('#map-status').textContent='위성영상과 지형을 불러오는 중…';
 const cleanUpControls=enhance21stControls();
 window.addEventListener('pagehide',event=>{if(!event.persisted)cleanUpControls();},{once:true});
 restoreSettings();syncControls();bindControls();recompute();regionIdentity();pressed($('#before-btn'),!state.after);pressed($('#after-btn'),state.after);pressed($('#view-3d'),state.is3d);pressed($('#view-2d'),!state.is3d);$('#terrain-caption').textContent=state.is3d?'실제 표고 · 높이 2×':'평면 지도 · 지형 강조 없음';initMap();registerAgentTools();
 }catch(error){
 $('#map-status').hidden=true;$('#map-error').hidden=false;$('#map-error-text').textContent='육지 경계를 불러오지 못해 분석을 중지했습니다. '+error.message;
 $('#retry-btn').addEventListener('click',()=>location.reload());
 }
}
