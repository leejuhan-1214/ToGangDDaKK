import {createHandMotion} from './hand-motion.mjs';
import {createCameraSession,cameraErrorMessage} from './hand-camera.mjs';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const labels={pan:'손바닥 · 지도 이동',rotate:'V 모양 · 회전 / 기울기',zoom:'엄지 · 확대 / 축소',pause:'주먹 · 정지',arming:'손 모양 유지…',idle:'손 하나를 화면에 보여주세요'};
const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

/** Opt-in, local-only camera UI. A single frame is in flight; stale results never move the map. */
export function createHandControls({map,onStart=()=>{},onRotate=()=>{}}){
 const $=id=>document.getElementById(id),panel=$('hand-panel'),video=$('hand-video'),canvas=$('hand-landmarks'),context=canvas.getContext('2d');
 const trigger=$('console-hand-trigger'),startButton=$('hand-start'),motion=createHandMotion(),listeners=[];
 let worker=null,epoch=0,enabled=false,starting=false,disposed=false,raf=null,inFlight=false,lastFrame=0,lastVideoTime=-1,suspendUntil=0,watchdog=null,readyReject=null,lastResult=0,externalMoving=false,pointerHeld=false;
 const camera=createCameraSession({video,mediaDevices:navigator.mediaDevices,onEnded:()=>stop('카메라 연결이 끊겼습니다. 다시 시작해주세요.')});
 function listen(target,event,callback,options){target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options));}
 function status(value){if($('hand-status').textContent!==value)$('hand-status').textContent=value;}
 function setMode(value){panel.dataset.mode=value;for(const item of panel.querySelectorAll('[data-hand-mode]'))item.classList.toggle('active',item.dataset.handMode===value);}
 function updateButtons(){startButton.textContent=starting?'시작 취소':enabled?'카메라 끄기':'카메라 시작';startButton.setAttribute('aria-pressed',String(enabled||starting));trigger.setAttribute('aria-pressed',String(enabled));trigger.setAttribute('aria-expanded',String(!panel.hidden));panel.dataset.state=starting?'loading':enabled?'running':'off';document.body.classList.toggle('hand-enabled',enabled);}
 function stop(message='카메라 꺼짐 · 영상은 저장되지 않습니다.'){
  epoch++;enabled=false;starting=false;camera.stop();worker?.terminate();worker=null;
  readyReject?.(new Error('cancelled'));readyReject=null;clearTimeout(watchdog);watchdog=null;
  if(raf!==null)cancelAnimationFrame(raf);raf=null;inFlight=false;lastVideoTime=-1;lastFrame=0;lastResult=0;pointerHeld=false;externalMoving=false;suspendUntil=0;motion.reset();
  context.clearRect(0,0,canvas.width,canvas.height);setMode('idle');status(message);$('hand-performance').textContent='기기 내 처리';updateButtons();
 }
 function open(){if(disposed)return;panel.hidden=false;document.body.classList.add('hand-ui-open');onStart();updateButtons();}
 function close(restoreFocus=true){stop();panel.hidden=true;document.body.classList.remove('hand-ui-open');updateButtons();if(restoreFocus)trigger.focus();}
 function draw(result){
  context.clearRect(0,0,canvas.width,canvas.height);
  if(result.landmarks?.length!==1)return;const points=result.landmarks[0];if(points.length!==21)return;
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
  context.strokeStyle='#ead58a';context.fillStyle='#77d5df';context.lineWidth=2;context.beginPath();
  for(const [a,b]of edges){context.moveTo((1-points[a].x)*canvas.width,points[a].y*canvas.height);context.lineTo((1-points[b].x)*canvas.width,points[b].y*canvas.height);}context.stroke();
  for(const p of points){context.beginPath();context.arc((1-p.x)*canvas.width,p.y*canvas.height,2.5,0,2*Math.PI);context.fill();}
 }
 function apply(command){
  if(!command.active)return;const eventData={land15HandControl:true};
  if(command.mode==='pan'){
   const element=map.getContainer(),scale=Math.min(1200,Math.max(element.clientWidth,element.clientHeight))*1.5;
   map.panBy([clamp(-command.dx*scale,-65,65),clamp(-command.dy*scale,-65,65)],{duration:0},eventData);
  }else if(command.mode==='rotate'){
   onRotate();map.jumpTo({bearing:map.getBearing()+command.dx*160,pitch:clamp(map.getPitch()-command.dy*110,0,75)},eventData);
  }else if(command.mode==='zoom')map.jumpTo({zoom:clamp(map.getZoom()+command.dz,map.getMinZoom(),map.getMaxZoom())},eventData);
 }
 function receive(event,run){
  if(run!==epoch||disposed)return;const message=event.data;
  if(message.type==='error'){stop('인식 모델을 실행하지 못했습니다. Chrome·Edge에서 다시 시작해주세요.');return;}
  if(message.type!=='result'||!enabled)return;
  inFlight=false;clearTimeout(watchdog);watchdog=null;const now=performance.now();
  if(!Number.isFinite(message.timestamp)||now-message.timestamp>400){motion.reset();setMode('idle');status('영상 처리 지연 · 손동작 대기');return;}
  if(externalMoving||pointerHeld||now<suspendUntil||document.querySelector('dialog[open]')){motion.reset();setMode('pause');status('직접 조작 중 · 잠시 대기');return;}
  const command=motion.update(message.result,message.timestamp);draw(message.result);setMode(command.mode);
  status(command.reason==='multiple-hands'?'한 손만 보여주세요 · 지도 정지':labels[command.mode]||labels.idle);
  if(lastResult&&now-lastResult>0)$('hand-performance').textContent=`${Math.round(1000/(now-lastResult))} fps · 기기 내 처리`;lastResult=now;
  apply(command);
 }
 async function frame(now,run){
  if(run!==epoch||!enabled)return;raf=requestAnimationFrame(time=>frame(time,run));
  if(inFlight||now-lastFrame<66||video.readyState<2||video.currentTime===lastVideoTime)return;
  if(document.hidden)return;
  if(document.querySelector('dialog[open]')){motion.reset();status('안내 창 열림 · 지도 정지');setMode('pause');return;}
  inFlight=true;lastFrame=now;lastVideoTime=video.currentTime;
  let bitmap=null;try{
   const width=Math.min(480,video.videoWidth),height=Math.round(width*video.videoHeight/video.videoWidth);
   bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:height});
   if(run!==epoch||!enabled){bitmap.close();return;}
   if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
   worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);
   bitmap=null;
   watchdog=setTimeout(()=>{if(run===epoch)stop('영상 인식 응답이 지연되어 카메라를 껐습니다. 다시 시작해주세요.');},8000);
  }catch{bitmap?.close();if(run===epoch)stop('카메라 영상을 읽지 못했습니다. 다른 브라우저에서 다시 시작해주세요.');}
 }
 async function start(){
  if(starting||enabled||disposed)return;
  open();if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){status('카메라를 지원하는 Chrome·Edge에서 HTTPS 주소를 열어주세요.');return;}
  if(!window.Worker||!window.createImageBitmap){status('이 브라우저는 손동작 인식을 지원하지 않습니다. Chrome·Edge에서 열어주세요.');return;}
  const run=++epoch;starting=true;updateButtons();status('카메라 권한을 허용해주세요. 마이크는 사용하지 않습니다.');
  try{
   if(!await camera.start()||run!==epoch)return;
   status('손 인식 모델 준비 중 · 처음에는 잠시 걸립니다.');
   const workerURL=new URL('./hand-tracker.worker.mjs',import.meta.url);
   worker=new Worker(workerURL); // Classic worker: MediaPipe's WASM loader uses importScripts.
   worker.addEventListener('message',event=>receive(event,run));
   const ready=new Promise((resolve,reject)=>{
    readyReject=reject;
    const timeout=setTimeout(()=>reject(new Error('model timeout')),60000);
    worker.addEventListener('message',event=>{if(event.data.type==='ready'){clearTimeout(timeout);resolve();}else if(event.data.type==='error'){clearTimeout(timeout);reject(new Error('model failed'));}});
    worker.addEventListener('error',()=>{clearTimeout(timeout);if(starting)reject(new Error('worker failed'));else if(run===epoch)stop('손 인식 실행이 중단됐습니다. 다시 시작해주세요.');});
    // The model and WASM are fetched from this same site, only after camera opt-in.
    worker.postMessage({type:'init',baseURL:new URL('./vendor/mediapipe/',import.meta.url).href});
    readyReject=error=>{clearTimeout(timeout);reject(error);};
   });
   await ready;if(run!==epoch)return;readyReject=null;starting=false;enabled=true;externalMoving=map.isMoving();motion.reset();updateButtons();status('손바닥을 펴고 천천히 움직여보세요.');raf=requestAnimationFrame(time=>frame(time,run));
  }catch(error){if(run!==epoch)return;const permission=error?.name&&error.name!=='Error';stop(permission?cameraErrorMessage(error):'손 인식 모델을 불러오지 못했습니다. 네트워크 연결을 확인하고 다시 시작해주세요.');}
 }
 listen(trigger,'click',()=>panel.hidden?open():close());listen($('hand-close'),'click',close);listen(startButton,'click',()=>enabled||starting?stop():start());
 listen(document,'visibilitychange',()=>{if(document.hidden&&(enabled||starting))stop('다른 화면으로 이동하여 카메라를 껐습니다. 다시 시작해주세요.');});
 listen(document,'keydown',event=>{if(event.key==='Escape'&&!panel.hidden){stop();}if(event.key.toLowerCase()==='h'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target?.closest?.('input,textarea,select,[contenteditable]')&&!document.querySelector('dialog[open]')){event.preventDefault();panel.hidden?open():close();}});
 const manual=event=>{if(event?.land15HandControl)return;motion.reset();suspendUntil=performance.now()+1000;};
 const beginMove=event=>{if(event?.land15HandControl)return;externalMoving=true;manual(event);};
 const endMove=event=>{if(event?.land15HandControl)return;externalMoving=false;manual(event);};
 map.on('movestart',beginMove);map.on('moveend',endMove);
 listen(map.getContainer(),'pointerdown',event=>{pointerHeld=true;manual(event);},{passive:true});
 for(const type of ['pointerup','pointercancel'])listen(window,type,event=>{if(pointerHeld){pointerHeld=false;manual(event);}},{passive:true});
 listen(map.getContainer(),'wheel',manual,{passive:true});
 return {stop,dismiss(){if(!panel.hidden)close(false);},isActive:()=>enabled,dispose(){if(disposed)return;disposed=true;stop();document.body.classList.remove('hand-ui-open');camera.dispose();listeners.forEach(remove=>remove());map.off('movestart',beginMove);map.off('moveend',endMove);}};
}
