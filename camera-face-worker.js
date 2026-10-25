// Face inference stays inside a worker on the user's device. Only the model is downloaded.
let detector;
(async()=>{try{
 const {FaceDetector,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs');
 const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm');
 detector=await FaceDetector.createFromOptions(files,{
  baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',delegate:'CPU'},
  runningMode:'VIDEO',minDetectionConfidence:0.6
 });
 self.postMessage({type:'ready'});
}catch(error){console.warn('Narwhal tracker initialization failed:',error.message);self.postMessage({type:'error',stage:'init',message:error.message});}})();
self.onmessage=event=>{
 const {bitmap,timestamp}=event.data;if(!bitmap)return;
 try{
  if(!detector)throw Error('Tracker unavailable');
  const result=detector.detectForVideo(bitmap,timestamp);
  const faces=(result.detections||[]).slice(0,4).map(face=>{
   const b=face.boundingBox,eyes=face.keypoints||[];
   let angle=eyes.length>1?Math.atan2((eyes[1].y-eyes[0].y)*bitmap.height,(eyes[1].x-eyes[0].x)*bitmap.width):0;
   if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;
   return {x:(b.originX+b.width/2)/bitmap.width,y:(b.originY-b.height*.03)/bitmap.height,width:b.width*.9/bitmap.width,angle};
  });
  self.postMessage({type:'faces',faces});
 }catch(error){console.warn('Narwhal tracker frame failed:',error.message);self.postMessage({type:'error',stage:'frame',message:error.message});}
 finally{bitmap.close();}
};
