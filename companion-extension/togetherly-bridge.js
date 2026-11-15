'use strict';
// Bridges the trusted Togetherly page to the companion's isolated extension.
// Other framed websites cannot spoof window-originated Togetherly messages.
(function(){
 if(window.top!==window||location.origin!=='https://everydaygrove.ca')return;
 const CHANNEL='togetherly-sync-v1';
 function deliver(type,data={}){
  window.postMessage({channel:CHANNEL,from:'companion',type,...data},location.origin);
 }
 window.addEventListener('message',e=>{
  if(e.source!==window||e.origin!==location.origin)return;
  const d=e.data;
  if(d?.channel!==CHANNEL||d.from!=='page')return;
  if(!['HELLO','ENABLE','DISABLE','TARGET'].includes(d.action))return;
  if(d.action==='HELLO'){deliver('AVAILABLE');return}
  chrome.runtime.sendMessage({type:'CONTROL',action:d.action,role:d.role,timeline:d.timeline}).catch(()=>{});
 });
 chrome.runtime.onMessage.addListener(message=>{
  if(message?.type==='PLAYER_SAMPLE')deliver('SAMPLE',{sample:message.sample});
  if(message?.type==='PLAYER_BLOCKED')deliver('PLAY_BLOCKED');
 });
 deliver('AVAILABLE');
})();
