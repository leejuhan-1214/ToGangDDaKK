/** A fixed-snapshot presentation of LAND:15's synthetic educational analysis. */
export const STORY_STEPS=['문제 지역','위험 요인','복원 후보','전후 비교','결과 요약'];
const number=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const scoreNumber=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:3});
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>number.format(value);
const score=value=>value===null?'—':scoreNumber.format(value);

/** All score inputs are 0–100 points; areas are km²; costs are 100 million KRW. */
export function normalizePresentationSnapshot(input={}){
 const landArea=Math.max(0,finite(input.landArea));
 const hasLand=input.hasLand!==false&&landArea>0;
 const riskArea=hasLand?clamp(finite(input.riskArea),0,landArea):0;
 const selected=hasLand&&Array.isArray(input.selected)?input.selected.map((item,index)=>({rank:index+1,risk:clamp(finite(item.risk),0,100),cost:Math.max(0,finite(item.cost)),area:Math.max(0,finite(item.area))})):[];
 const budget=Math.max(0,finite(input.budget));
 const beforeScore=hasLand&&Number.isFinite(input.beforeScore)?clamp(input.beforeScore,0,100):null;
 const afterScore=hasLand&&Number.isFinite(input.afterScore)?clamp(input.afterScore,0,100):null;
 return {
  regionName:String(input.regionName||'현재 지도'),hasLand,landArea:hasLand?landArea:0,riskArea,
  riskPercent:hasLand?riskArea/landArea*100:null,threshold:clamp(finite(input.threshold,65),0,100),budget,
  spent:hasLand?Math.max(0,finite(input.spent)):0,selectedCount:selected.length,selected,
  beforeScore,afterScore,scoreDifference:beforeScore===null||afterScore===null?null:beforeScore-afterScore,
  reductionPercent:clamp(finite(input.reductionPercent),0,100),
  explanation:hasLand&&input.explanation?{
   summary:String(input.explanation.summary||''),note:String(input.explanation.note||''),
   nbScore:Number.isFinite(input.explanation.nbScore)?input.explanation.nbScore:null,
   caScore:Number.isFinite(input.explanation.caScore)?input.explanation.caScore:null,
   neighborDelta:finite(input.explanation.neighborDelta),
   factors:(input.explanation.factors||[]).slice(0,3).map(f=>({label:String(f.label||''),valueText:String(f.valueText||''),delta:finite(f.delta),detail:String(f.detail||'')}))
  }:null
 };
}

/** Injectable timers make automatic completion, manual jumps, and cancellation deterministic. */
export function createStoryTimeline({onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,delay=8000}={}){
 let active=false,playing=false,index=0,after=false,timer=null;
 const state=()=>({active,playing,index,after});
 const cancel=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 const notify=reason=>onChange({...state(),reason});
 const schedule=()=>{cancel();if(active&&playing&&index<STORY_STEPS.length-1)timer=setTimer(()=>{timer=null;select(index+1);},Math.max(7000,delay));};
 function select(next){if(!active)return;index=clamp(Math.trunc(finite(next)),0,STORY_STEPS.length-1);after=index===3;if(index===STORY_STEPS.length-1)playing=false;schedule();notify('step');}
 return {
  start(){cancel();active=true;playing=false;index=0;after=false;notify('start');},
  select,next(){select(index+1);},previous(){select(index-1);},
  play(){if(!active||index===STORY_STEPS.length-1)return;playing=true;schedule();notify('play');},
  pause(){playing=false;cancel();if(active)notify('pause');},
  toggleComparison(value){if(!active||index!==3)return;after=Boolean(value);notify('comparison');},
  close(){if(!active)return;cancel();active=false;playing=false;notify('close');},
  get state(){return state();}
 };
}

const metric=(label,value,unit='')=>`<div class="story-metric"><span>${escape(label)}</span><strong>${escape(value)}${unit?`<small>${escape(unit)}</small>`:''}</strong></div>`;
function contentFor(index,snapshot,after){
 const s=snapshot;
 if(!s.hasLand)return {title:'수역은 분석하지 않습니다',lead:'현재 범위에 분석할 육지가 없습니다. 발표를 닫고 육지가 보이는 곳으로 이동해 주세요.',body:'<div class="story-empty"><span aria-hidden="true">≈</span><p>바다·호수 제외<br><strong>위험점수와 복원 후보 없음</strong></p></div>'};
 if(index===0)return {title:'어디부터 복원할까요?',lead:`${s.regionName}의 육지 ${fmt(s.landArea)} km²에서 기준 ${fmt(s.threshold)}점 이상의 셀을 찾았습니다.`,body:`<div class="story-stat-row">${metric('모의 고위험 비율',fmt(s.riskPercent),'%')}${metric('모의 고위험 면적',fmt(s.riskArea),'km²')}</div><p class="story-insight">지도의 색은 교육용 위험 분류입니다. 위성영상에서 관측한 피해 면적을 뜻하지 않습니다.</p>`};
 if(index===1){
  const explanation=s.explanation;
  return {title:'위험점수를 높인 입력',lead:explanation?.summary||'대표 육지 셀의 식생·강수·수분 등 합성 입력을 함께 살펴봅니다.',body:explanation?.factors.length?`<div class="story-factors">${explanation.factors.map(f=>`<div class="story-factor"><div><span>${escape(f.label)}</span><strong>${escape(f.valueText)}</strong></div><div class="story-factor-meter"><i style="width:${clamp(Math.abs(f.delta),2,100)}%"></i></div><small>${f.delta>=0?'+':'−'}${fmt(Math.abs(f.delta))}점</small></div>`).join('')}</div><p class="story-insight">대표 셀 · 기준 입력으로 하나씩 대체한 NB 차이입니다. 인과관계나 기여도의 합을 뜻하지 않습니다.</p>`:'<div class="story-empty"><p>합성 지표를 기준으로 위험도를 계산합니다.<br>셀을 선택하면 각 입력의 영향을 확인할 수 있습니다.</p></div>'};
 }
 if(index===2)return {title:s.selectedCount?'예산에 맞춘 복원 후보':'선정 가능한 후보가 없습니다',lead:`가상 예산 ${fmt(s.budget)}억 원 중 ${fmt(s.spent)}억 원을 배정했습니다. 모의 편익/비용 순으로 최대 7곳을 선정합니다.`,body:s.selectedCount?`<div class="story-candidates">${s.selected.slice(0,3).map(c=>`<div><b>${c.rank}</b><span>후보 ${c.rank}<small>위험 ${fmt(c.risk)}점 · ${fmt(c.area)} km²</small></span><strong>${fmt(c.cost)}<small>억 원</small></strong></div>`).join('')}</div><p class="story-insight">총 ${s.selectedCount}곳 중 상위 ${Math.min(3,s.selectedCount)}곳 · 가상 비용이며 최적해를 보장하지 않습니다.</p>`:'<div class="story-empty"><p>예산 또는 위험 기준을 바꾸면<br>선정 결과가 달라질 수 있습니다.</p></div>'};
 if(index===3)return {title:'복원 전과 후를 비교하세요',lead:`선정 셀에 ${fmt(s.reductionPercent)}% 위험 감소를 가정합니다. 아래 값은 전체 육지의 면적가중 평균입니다.`,body:`<div class="story-compare" role="group" aria-label="발표 지도 전후 비교"><button data-story-compare="before" aria-pressed="${!after}">복원 전</button><button data-story-compare="after" aria-pressed="${after}">복원 후</button></div><div class="story-stat-row">${metric('복원 전',score(s.beforeScore),'점')}${metric('복원 후',score(s.afterScore),'점')}</div><p class="story-insight">전체 평균 ${score(s.scoreDifference)}점 감소 · 실제 미래 예측이나 관측 결과가 아닙니다.</p>`};
 return {title:'복원 계획, 한 장으로 정리',lead:`${s.regionName} · 발표를 시작할 때의 분석 조건과 결과를 저장합니다.`,body:`<div class="story-summary-grid">${metric('선정 후보',s.selectedCount,'곳')}${metric('가상 배정액',fmt(s.spent),'억 원')}${metric('평균 위험 감소',score(s.scoreDifference),'점')}</div><button class="story-save" data-story-save><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" stroke-linecap="round" stroke-linejoin="round"/></svg>결과 카드 PNG 저장</button><p class="story-save-status" role="status" aria-live="polite"></p>`};
}

export function createPresentation({container,onStep=()=>{},onClose=()=>{}}){
 if(!container)throw new TypeError('Presentation container is required');
 const doc=container.ownerDocument;
 let snapshot=null,previousFocus=null,lastContentKey='',saving=false;
 container.classList.add('presentation-panel');
 container.setAttribute('role','region');container.setAttribute('aria-label','발표용 스토리');container.hidden=true;
 container.innerHTML=`<div class="story-header"><span><i></i>LAND:15 <b>STORY</b></span><button class="story-close" aria-label="발표 닫기" title="발표 닫기 (Esc)">×</button></div><nav class="story-steps" aria-label="발표 단계">${STORY_STEPS.map((name,index)=>`<button data-story-step="${index}" aria-label="${index+1}단계 ${name}"><span>${index+1}</span><small>${name}</small></button>`).join('')}</nav><div class="story-content" aria-live="polite" aria-atomic="true"></div><div class="story-disclaimer">합성 데이터 · 교육용 시뮬레이션 · 수역 제외</div><footer class="story-footer"><button class="story-prev" aria-label="이전 발표 단계">← 이전</button><button class="story-play" aria-label="발표 자동 재생" aria-pressed="false">자동 재생</button><button class="story-next">다음 →</button></footer>`;
 const content=container.querySelector('.story-content'),play=container.querySelector('.story-play'),previous=container.querySelector('.story-prev'),next=container.querySelector('.story-next');
 const timeline=createStoryTimeline({onChange(state){
  if(state.reason==='close'){
   container.hidden=true;doc.removeEventListener('keydown',keyDown,true);doc.removeEventListener('visibilitychange',visibilityChanged);lastContentKey='';onClose();
   if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});return;
  }
  container.hidden=false;
  const key=`${state.index}:${state.after}`;
  if(key!==lastContentKey||state.reason==='start'){
   const view=contentFor(state.index,snapshot,state.after);
   content.innerHTML=`<div class="story-copy"><span class="story-eyebrow">${String(state.index+1).padStart(2,'0')} / 05 · ${STORY_STEPS[state.index]}</span><h2>${escape(view.title)}</h2><p class="story-lead">${escape(view.lead)}</p></div><div class="story-detail">${view.body}</div>`;lastContentKey=key;
  }
  container.querySelectorAll('[data-story-step]').forEach(button=>{const current=Number(button.dataset.storyStep)===state.index;button.setAttribute('aria-current',current?'step':'false');button.classList.toggle('active',current);});
  previous.disabled=state.index===0;next.textContent=state.index===4?'발표 마치기':'다음 →';
  play.textContent=state.playing?'일시정지':'자동 재생';play.setAttribute('aria-label',state.playing?'발표 자동 재생 일시정지':'발표 자동 재생');play.setAttribute('aria-pressed',String(state.playing));play.disabled=state.index===4;
  if(['start','step','comparison'].includes(state.reason))onStep(state.index,state.after);
 }});
 function keyDown(event){
  if(!timeline.state.active)return;
  if(doc.querySelector('dialog[open]'))return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();timeline.close();}
  if(container.contains(event.target)&&event.target.matches('[data-story-step]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
   event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?4:clamp(timeline.state.index+(event.key==='ArrowRight'?1:-1),0,4);timeline.select(i);container.querySelector(`[data-story-step="${i}"]`).focus();
  }
 }
 function visibilityChanged(){if(doc.visibilityState==='hidden')timeline.pause();}
 container.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!container.contains(button))return;
  if(button.matches('.story-close'))timeline.close();
  else if(button.matches('[data-story-step]'))timeline.select(Number(button.dataset.storyStep));
  else if(button.matches('.story-prev'))timeline.previous();
  else if(button.matches('.story-next'))timeline.state.index===4?timeline.close():timeline.next();
  else if(button.matches('.story-play'))timeline.state.playing?timeline.pause():timeline.play();
  else if(button.matches('[data-story-compare]')){const mode=button.dataset.storyCompare;timeline.toggleComparison(mode==='after');container.querySelector(`[data-story-compare="${mode}"]`).focus({preventScroll:true});}
  else if(button.matches('[data-story-save]')&&!saving){
   saving=true;button.disabled=true;const status=container.querySelector('.story-save-status');status.textContent='결과 카드를 만드는 중…';
   try{await previewPresentationPng(snapshot,doc);if(status.isConnected)status.textContent='PNG 미리보기를 열었습니다. 다운로드 버튼으로 저장하세요.';}catch{if(status.isConnected)status.textContent='미리보기를 만들지 못했습니다. 다시 시도해 주세요.';}
   finally{saving=false;if(button.isConnected)button.disabled=false;}
  }
 });
 return {
  start(input){snapshot=normalizePresentationSnapshot(input);if(!timeline.state.active)previousFocus=doc.activeElement;doc.addEventListener('keydown',keyDown,true);doc.addEventListener('visibilitychange',visibilityChanged);timeline.start();container.querySelector('.story-close').focus({preventScroll:true});},
  close(){timeline.close();},get active(){return timeline.state.active;}
 };
}

function wrappedText(context,text,x,y,maxWidth,lineHeight,maxLines=3){
 const words=Array.from(String(text));let line='',lines=0;
 for(let i=0;i<words.length;i++){
  const proposed=line+words[i];
  if(line&&context.measureText(proposed).width>maxWidth){context.fillText(line,x,y);y+=lineHeight;lines++;line=words[i];if(lines===maxLines-1){while(i+1<words.length&&context.measureText(line+words[i+1]+'…').width<=maxWidth)line+=words[++i];if(i+1<words.length)line+='…';break;}}
  else line=proposed;
 }
 if(line)context.fillText(line,x,y);
 return y+lineHeight;
}

/** A standalone report card; no web map pixels or live imagery are exported. */
export async function previewPresentationPng(input,doc=document){
 const s=normalizePresentationSnapshot(input);
 if(doc.fonts){await doc.fonts.ready;await doc.fonts.load('600 30px "SUIT"');}
 const canvas=doc.createElement('canvas');canvas.width=1600;canvas.height=1000;
 const c=canvas.getContext('2d');if(!c)throw Error('Canvas unavailable');
 c.fillStyle='#142124';c.fillRect(0,0,1600,1000);
 const glow=c.createRadialGradient(1250,0,20,1250,0,720);glow.addColorStop(0,'#285743');glow.addColorStop(1,'#142124');c.fillStyle=glow;c.fillRect(0,0,1600,1000);
 const font=(size,weight=400)=>{c.font=`${weight} ${size}px "SUIT", sans-serif`;};
 font(23,600);c.fillStyle='#a7e7d8';c.fillText('LAND:15  /  RESTORATION STORY',76,78);
 font(48,600);c.fillStyle='#f0f5ff';wrappedText(c,s.regionName,76,152,1430,60,1);
 font(23);c.fillStyle='#adc0df';c.fillText(`발표 시작 시점의 분석 요약 · 고위험 기준 ${fmt(s.threshold)}점`,78,205);
 const metrics=[['분석 육지',`${fmt(s.landArea)} km²`],['모의 고위험 면적',s.hasLand?`${fmt(s.riskArea)} km²`:'수역 · 분석 제외'],['모의 고위험 비율',s.hasLand?`${fmt(s.riskPercent)}%`:'해당 없음']];
 metrics.forEach(([label,value],i)=>{const x=76+i*490;c.fillStyle='#152038';c.fillRect(x,255,466,170);font(22);c.fillStyle='#a7b9d7';c.fillText(label,x+26,297);font(36,600);c.fillStyle='#f1f5ff';wrappedText(c,value,x+26,366,415,40,1);});
 c.fillStyle='#75d4bf';c.fillRect(76,470,5,310);font(29,600);c.fillStyle='#e4f2ea';c.fillText('복원 시나리오',103,505);
 font(23);c.fillStyle='#bed0ef';c.fillText(`선정 후보 ${s.selectedCount}곳    ·    가상 배정액 ${fmt(s.spent)} / ${fmt(s.budget)}억 원`,103,555);
 c.fillText(`선정 셀의 위험점수 ${fmt(s.reductionPercent)}% 감소 가정`,103,603);
 font(23);c.fillStyle='#a1b7da';c.fillText('전체 분석 육지의 면적가중 평균 위험점수',103,660);
 font(48,600);c.fillStyle='#eef4ff';c.fillText(`${score(s.beforeScore)} → ${score(s.afterScore)}점`,103,725);
 font(22);c.fillStyle='#9bb8f6';c.fillText(s.hasLand?`전체 평균 ${score(s.scoreDifference)}점 감소`:'육지가 없어 위험도와 복원 효과를 계산하지 않았습니다.',103,774);
 font(23,600);c.fillStyle='#bbcdf1';c.fillText('해석 시 유의사항',925,505);
 font(22);c.fillStyle='#a1b3cf';wrappedText(c,'위험도·환경지표·비용·복원 효과는 교육용 합성값입니다. 실제 사막화 진단이나 미래 예측으로 사용할 수 없습니다.',925,555,560,37,4);
 wrappedText(c,'육지 면적은 Natural Earth 경계에 따른 근사값입니다. 바다와 호수는 분석에서 제외합니다.',925,726,560,37,3);
 c.fillStyle='#7c98c2';c.fillRect(76,840,1448,1);font(20);c.fillStyle='#94acd1';
 c.fillText('교육용 시뮬레이션 · 합성 데이터 · 면적 km² / 점수 0–100 / 가상 비용 억 원',76,890);
 font(19);c.fillStyle='#728bad';c.fillText('leejuhan-1214.github.io/ToGangDDaKK',76,937);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed')),'image/png'));
 const view=doc.defaultView||globalThis,url=view.URL.createObjectURL(blob),dialog=doc.createElement('dialog');
 dialog.className='story-export-dialog';dialog.setAttribute('aria-label','PNG 결과 카드 미리보기');
 dialog.innerHTML='<div class="story-export-header"><h2>결과 카드 미리보기</h2><button class="story-export-close" aria-label="PNG 미리보기 닫기">×</button></div><img class="story-export-image" width="1600" height="1000" alt="발표 시작 시점의 육지 분석과 복원 시뮬레이션을 정리한 결과 카드"><div class="story-export-footer"><p>1600 × 1000 PNG · 합성 데이터 · 교육용 시뮬레이션</p><a class="story-export-download">PNG 다운로드</a></div>';
 const image=dialog.querySelector('img'),link=dialog.querySelector('a');
 image.src=url;link.href=url;link.download=`LAND15-${s.regionName.replace(/[^\p{L}\p{N}_-]/gu,'-').slice(0,50)}-synthetic-summary.png`;
 let cleaned=false;
 const cleanUp=()=>{if(cleaned)return;cleaned=true;view.URL.revokeObjectURL(url);dialog.remove();};
 dialog.addEventListener('close',cleanUp,{once:true});dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 try{await image.decode();doc.body.append(dialog);dialog.showModal();return dialog;}catch(error){cleanUp();throw error;}
}
