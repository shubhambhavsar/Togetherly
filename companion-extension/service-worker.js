'use strict';
const sessions=new Map();
function originOf(raw){try{return new URL(raw).origin}catch{return ''}}
function isFlexflix(raw){return ['https://flexflix.site','https://www.flexflix.site'].includes(originOf(raw))}
const isTogetherly=raw=>originOf(raw)==='https://everydaygrove.ca';
function toTab(id,message,frameId){
 try{chrome.tabs.sendMessage(id,message,{frameId}).catch(()=>{})}catch{}
}
chrome.runtime.onMessage.addListener((message,sender)=>{
 const tabId=sender.tab?.id;
 if(!Number.isInteger(tabId)||tabId<0)return;
 if(message?.type==='CONTROL'&&isTogetherly(sender.url)&&sender.frameId===0){
  const action=message.action;
  if(action==='DISABLE'){sessions.delete(tabId);return}
  if(action==='ENABLE'){
   const existing=sessions.get(tabId);
   const role=message.role==='host'?'host':'guest';
   sessions.set(tabId,{enabled:true,role,playerFrameId:existing?.playerFrameId??null});
   return
  }
  if(action==='TARGET'){
   const state=sessions.get(tabId);
   const t=message.timeline;
   if(state?.enabled&&state.role==='guest'&&Number.isInteger(state.playerFrameId)&&
      Number.isFinite(t?.position)&&t.position>=0&&t.position<=86400&&
      typeof t.playing==='boolean'&&Number.isInteger(t.version))
    toTab(tabId,{type:'TARGET',timeline:{position:t.position,playing:t.playing,version:t.version}},state.playerFrameId);
  }
  return
 }
 if(!isFlexflix(sender.url))return;
 const state=sessions.get(tabId);
 if(!state?.enabled)return;
 if(message?.type==='PLAYER_SAMPLE'&&Number.isFinite(message.sample?.position)){
  if(message.sample.position<0||message.sample.position>86400||
     typeof message.sample.playing!=='boolean')return;
  state.playerFrameId=sender.frameId;
  toTab(tabId,{type:'PLAYER_SAMPLE',sample:{
   position:message.sample.position,playing:message.sample.playing
  }},0);
 }else if(message?.type==='PLAYER_BLOCKED'){
  toTab(tabId,{type:'PLAYER_BLOCKED'},0);
 }
});
chrome.tabs.onRemoved.addListener(id=>sessions.delete(id));
