/* Classic worker; synchronous MediaPipe inference never runs on the map's UI thread. */
let recognizer=null,initializing=false;
const revision=new URL(self.location.href).search;
const asset=path=>{const url=new URL(path,self.location.href);if(revision)url.search=revision;return url.href;};
self.onmessage=async({data})=>{
 if(data.type==='init'){
  if(recognizer){self.postMessage({type:'ready'});return;}if(initializing)return;initializing=true;
  try{
   importScripts(asset('./vendor/mediapipe/vision_bundle.js'));
   const files=await Vision.FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm',self.location.href).href);
   for(const key of ['wasmLoaderPath','wasmBinaryPath'])if(files[key])files[key]+=revision;
   recognizer=await Vision.GestureRecognizer.createFromOptions(files,{baseOptions:{modelAssetPath:asset('./vendor/mediapipe/gesture_recognizer.task'),delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.65,cannedGesturesClassifierOptions:{maxResults:1,scoreThreshold:.5}});
   self.postMessage({type:'ready'});
  }catch{self.postMessage({type:'error'});}finally{initializing=false;}
 }else if(data.type==='frame'){
  const {bitmap,timestamp}=data;
  try{
   if(!recognizer||!bitmap||!Number.isFinite(timestamp))return;
   const result=recognizer.recognizeForVideo(bitmap,timestamp);
   self.postMessage({type:'result',timestamp,result:{gestures:result.gestures,landmarks:result.landmarks}});
  }catch{self.postMessage({type:'error'});}finally{bitmap?.close();}
 }
};
