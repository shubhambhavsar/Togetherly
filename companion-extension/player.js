'use strict';
// Runs only in matching FlexFlix frames. Does not inspect stream URLs, keys or ads.
(function(){
 const isSupported=location.protocol==='https:'&&
  (location.hostname==='flexflix.site'||location.hostname==='www.flexflix.site');
 if(!isSupported||!chrome.runtime?.id)return;
 let lastCorrection=0,lastVideo=null;
 function pickVideo(){
  return [...document.querySelectorAll('video')].filter(v=>
   Number.isFinite(v.duration)&&v.duration>=120&&v.readyState>=1&&
   Number.isFinite(v.currentTime)&&v.currentTime>=0
  ).sort((a,b)=>{
   const score=v=>(v.paused?0:1e8)+v.getBoundingClientRect().width*v.getBoundingClientRect().height;
   return score(b)-score(a);
  })[0]||null;
 }
 function sample(){
  const v=pickVideo();
  if(!v)return;
  lastVideo=v;
  chrome.runtime.sendMessage({type:'PLAYER_SAMPLE',
   sample:{position:Math.min(86400,v.currentTime),playing:!v.paused&&!v.ended,duration:v.duration}
  }).catch(()=>{});
 }
 function correct(t){
  const v=pickVideo()||lastVideo;
  if(!v||!Number.isFinite(t?.position)||typeof t?.playing!=='boolean')return;
  if(t.version===undefined||Date.now()-lastCorrection<650)return;
  const plan=globalThis.TogetherlyDrift?.decide(v.currentTime,t.position,t.playing,v.readyState);
  if(!plan)return;
  lastCorrection=Date.now();
  try{
   if(plan.seek!==null&&v.seekable?.length){
    const last=v.seekable.length-1;
    const min=v.seekable.start(0),max=v.seekable.end(last);
    if(Number.isFinite(min)&&Number.isFinite(max))
     v.currentTime=Math.max(min,Math.min(max,plan.seek));
   }
   if(v.playbackRate!==plan.rate)v.playbackRate=plan.rate;
   if(!plan.playing&&!v.paused)v.pause();
   else if(plan.playing&&v.paused)v.play().catch(()=>
    chrome.runtime.sendMessage({type:'PLAYER_BLOCKED'}).catch(()=>{}));
  }catch{}
 }
 chrome.runtime.onMessage.addListener(message=>{
  if(message?.type==='TARGET')correct(message.timeline);
 });
 setInterval(sample,2500);
 document.addEventListener('play',sample,true);
 document.addEventListener('pause',sample,true);
 document.addEventListener('seeked',sample,true);
 sample();
})();
