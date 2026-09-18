// Camera lifecycle is deliberately separate from model inference and map movement.
export function cameraErrorMessage(error) {
 const messages={NotAllowedError:'카메라 권한이 허용되지 않았습니다. 주소창의 사이트 권한을 확인한 뒤 다시 시작해주세요.',SecurityError:'이 브라우저에서는 카메라 접근이 제한됩니다. HTTPS 주소를 Chrome 또는 Edge에서 열어주세요.',NotFoundError:'연결된 카메라를 찾지 못했습니다. 웹캠을 연결한 뒤 다시 시작해주세요.',NotReadableError:'다른 앱이 카메라를 사용 중이거나 장치를 열 수 없습니다.',OverconstrainedError:'이 카메라의 영상 설정을 사용할 수 없습니다.',AbortError:'카메라 시작이 취소되었습니다.'};
 return messages[error?.name]||'손동작 인식을 시작하지 못했습니다. 카메라와 네트워크 연결을 확인한 뒤 다시 시도해주세요.';
}
export function createCameraSession({video,mediaDevices,onEnded=()=>{}}) {
 let generation=0,stream=null,disposed=false;
 const release=value=>{for(const track of value?.getTracks?.()||[])track.stop();};
 function stop(){generation++;release(stream);stream=null;video.pause?.();video.srcObject=null;}
 async function start(){
  if(disposed)throw new Error('Camera session disposed');stop();const id=generation;
  const acquired=await mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}},audio:false});
  if(disposed||id!==generation){release(acquired);return false;}
  stream=acquired;video.srcObject=stream;
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(id===generation){stop();onEnded();}},{once:true});
  try{await video.play();}catch(error){if(id===generation)stop();throw error;}
  return !disposed&&id===generation;
 }
 return {start,stop,dispose(){disposed=true;stop();},isActive:()=>!!stream};
}
