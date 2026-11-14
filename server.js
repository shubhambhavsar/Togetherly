'use strict';
const express=require('express'),http=require('http'),{Server}=require('socket.io'),{randomBytes}=require('crypto'),path=require('path');
const app=express(),server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:16000});
const rooms=new Map();
const MAX_CAMERA_PARTICIPANTS=2;
const MAX_ROOM_PARTICIPANTS=8;
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');res.set('Permissions-Policy','camera=(self), microphone=(self)');next()});
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_req,res)=>res.json({ok:true,relayConfigured:Boolean((process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)||(process.env.METERED_TURN_DOMAIN&&process.env.METERED_TURN_API_KEY))}));
// Relay credentials are provided only to live room members. A TURN credential
// is necessarily delivered to browsers that need to make encrypted WebRTC calls.
// No account-wide Metered secret is sent to the client.
const rtcCache={value:null,expires:0};
const rtcHits=new Map();
function allowRtcRequest(req){
 const sid=req.query.sid, roomId=req.query.room;
 if(typeof sid!=='string'||typeof roomId!=='string'||!(/^[a-f0-9]{24}$/.test(roomId)))return false;
 const client=io.sockets?.sockets?.get(sid);
 if(!client||client.data.room!==roomId||!rooms.get(roomId)?.users.has(sid))return false;
 const now=Date.now(),entry=rtcHits.get(sid)||{count:0,until:now+60000};
 if(now>entry.until){entry.count=0;entry.until=now+60000}
 entry.count++;rtcHits.set(sid,entry);
 return entry.count<=12;
}
async function meteredIceServers(){
 const domain=(process.env.METERED_TURN_DOMAIN||'').trim().toLowerCase();
 const apiKey=(process.env.METERED_TURN_API_KEY||'').trim();
 if(!domain||!apiKey)return [];
 if(!/^[a-z0-9-]+\.metered\.live$/.test(domain))throw new Error('Invalid Metered TURN domain');
 if(rtcCache.value&&rtcCache.expires>Date.now())return rtcCache.value;
 const url=new URL('https://'+domain+'/api/v1/turn/credentials');
 url.searchParams.set('apiKey',apiKey);
 const response=await fetch(url,{signal:AbortSignal.timeout(6000)});
 if(!response.ok)throw new Error('Metered credentials request failed: '+response.status);
 const records=await response.json();
 if(!Array.isArray(records))throw new Error('TURN provider returned invalid configuration');
 const servers=records.filter(entry=>entry&&
  (typeof entry.urls==='string'||Array.isArray(entry.urls))&&
  [].concat(entry.urls).every(u=>typeof u==='string'&&/^(stun:|turn:|turns:)/.test(u))
 ).slice(0,12).map(entry=>({
  urls:entry.urls,...(entry.username?{username:entry.username}:{}),
  ...(entry.credential?{credential:entry.credential}:{})
 }));
 if(!servers.some(entry=>[].concat(entry.urls).some(u=>u.startsWith('turn:')||u.startsWith('turns:'))))throw new Error('TURN provider did not supply relays');
 rtcCache.value=servers;rtcCache.expires=Date.now()+4*60*1000;return servers;
}
app.get('/api/rtc',async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 if(!allowRtcRequest(req))return res.status(403).json({error:'Join a room to configure video calls'});
 const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
 let relayError=false;
 if(process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL){
  iceServers.push({urls:process.env.TURN_URL.split(',').map(v=>v.trim()),username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
 }else{
  try{iceServers.push(...await meteredIceServers())}
  catch(error){relayError=true;console.warn('TURN configuration unavailable:',error.message)}
 }
 res.json({iceServers,
  relayAvailable:iceServers.some(entry=>[].concat(entry.urls).some(u=>u.startsWith('turn:')||u.startsWith('turns:'))),
  relayError});
});

// YouTube Data API searches are optional, quota-limited, and never expose the API key.
const searchCache=new Map(),searchRates=new Map();
const searchBudget={day:'',uses:0};
async function searchYouTube(q){
 const now=Date.now(),cacheKey=q.toLowerCase(),saved=searchCache.get(cacheKey);
 if(saved&&saved.until>now)return saved.items;
 const day=new Date().toISOString().slice(0,10);
 if(searchBudget.day!==day){searchBudget.day=day;searchBudget.uses=0}
 if(searchBudget.uses>=70)throw new Error('Daily free search allowance used. Paste a link or try tomorrow.');
 const url=new URL('https://www.googleapis.com/youtube/v3/search');
 const opts={part:'snippet',type:'video',videoEmbeddable:'true',maxResults:'10',safeSearch:'moderate',q,key:process.env.YOUTUBE_API_KEY};
 for(const [k,v] of Object.entries(opts))url.searchParams.set(k,v);
 searchBudget.uses++;
 const response=await fetch(url,{signal:AbortSignal.timeout(9000)});
 if(!response.ok){console.warn('YouTube discovery failed:',response.status);throw new Error('YouTube search is unavailable. Try later or use a link.')}
 const body=await response.json();
 const candidates=(body.items||[]).filter(x=>/^[A-Za-z0-9_-]{11}$/.test(x.id?.videoId||'')).map(x=>({
  id:x.id.videoId,
  title:String(x.snippet?.title||'Untitled video').slice(0,150),
  channel:String(x.snippet?.channelTitle||'').slice(0,80)
 }));
 let items=candidates;
 // Search's videoEmbeddable filter is not a guarantee. Cross-check status.embeddable
 // and regional restrictions with videos.list (1 quota unit for the batch).
 if(candidates.length){
  try{
   const detailUrl=new URL('https://www.googleapis.com/youtube/v3/videos');
   for(const [k,v] of Object.entries({part:'status,contentDetails',id:candidates.map(v=>v.id).join(','),key:process.env.YOUTUBE_API_KEY}))detailUrl.searchParams.set(k,v);
   const detailResponse=await fetch(detailUrl,{signal:AbortSignal.timeout(9000)});
   if(!detailResponse.ok)throw Error('Video eligibility lookup returned '+detailResponse.status);
   const details=await detailResponse.json();
   const byId=new Map((details.items||[]).map(entry=>[entry.id,entry]));
   const usableInRegions=entry=>{
    const restriction=entry.contentDetails?.regionRestriction;
    const targets=['CA','IN'];
    if(restriction?.blocked&&targets.some(code=>restriction.blocked.includes(code)))return false;
    if(restriction?.allowed&&targets.some(code=>!restriction.allowed.includes(code)))return false;
    return true
   };
   items=candidates.filter(v=>{
    const entry=byId.get(v.id);
    return entry?.status?.embeddable===true&&entry.status?.privacyStatus==='public'&&usableInRegions(entry)
   }).map(v=>({...v,eligibility:'prechecked'}));
  }catch(e){
   console.warn('Video eligibility check unavailable:',e.message);
   // Show unverified results rather than pretending that we checked them.
   items=candidates.map(v=>({...v,eligibility:'unverified'}))
  }
 }
 if(searchCache.size>120)searchCache.clear();
 searchCache.set(cacheKey,{items,until:now+10*60*1000});return items;
}
app.get('/api/discovery-status',(req,res)=>res.json({searchReady:!!process.env.YOUTUBE_API_KEY}));
app.get('/room/:id',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const safeName=x=>typeof x==='string'?x.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,25):'';
const validRoom=x=>typeof x==='string'&&/^[a-f0-9]{24}$/.test(x);
const getVideo=x=>{if(typeof x!=='string'||x.length>500)return null;x=x.trim();if(/^[\w-]{11}$/.test(x))return x;try{const u=new URL(x);let id=null;if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)){id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]}else if(['youtu.be','www.youtu.be'].includes(u.hostname))id=u.pathname.split('/')[1];return /^[\w-]{11}$/.test(id||'')?id:null}catch{return null}};
const roomOf=s=>{const r=rooms.get(s.data.room);return r?.users.has(s.id)?r:null};
const state=r=>({video:r.video,playing:r.playing,position:r.position+(r.playing?(Date.now()-r.at)/1000:0),version:r.version});
const members=r=>[...r.users].map(([id,name])=>({id,name}));
const callMembers=r=>[...r.callUsers].map(([id,meta])=>({id,role:meta.role,sharing:!!meta.sharing}));
const publishCall=r=>io.to(r.id).emit('call:members',callMembers(r));
function newRoom(id){return {id,users:new Map(),video:'M7lc1UVf-VE',playing:false,position:0,at:Date.now(),version:0,messages:[],callUsers:new Map(),queue:[],emptySince:Date.now()}}
setInterval(()=>{const cutoff=Date.now()-12*60*60*1000;for(const [id,r] of rooms){if(!r.users.size&&r.emptySince<cutoff)rooms.delete(id)}},30*60*1000).unref();

function leaveCall(s) {
 const r=roomOf(s);
 if(!r?.callUsers?.has(s.id))return;
 r.callUsers.delete(s.id);
 s.to(r.id).emit('call:peer-left',{id:s.id});
 publishCall(r);
}
function leave(s){leaveCall(s);const r=roomOf(s);if(!r)return;r.users.delete(s.id);s.leave(r.id);s.data.room=null;io.to(r.id).emit('members',members(r));if(!r.users.size)r.emptySince=Date.now()}
io.on('connection',s=>{
s.on('create',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before creating a room'});if(roomOf(s))return ack({error:'Already in a room'});const id=randomBytes(12).toString('hex'),r=newRoom(id);rooms.set(id,r);r.users.set(s.id,safeName(d?.name));s.data.room=id;s.join(id);ack({id,state:state(r),members:members(r),messages:[],callMembers:[],queue:[]})});
s.on('join',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before joining'});let r=validRoom(d?.id)?rooms.get(d.id):null;
 if(!r&&validRoom(d?.id)){r=newRoom(d.id);rooms.set(d.id,r)}
 if(!r)return ack({error:'Invalid room link'});if(r.users.size>=MAX_ROOM_PARTICIPANTS)return ack({error:'Room full'});if(roomOf(s))leave(s);r.users.set(s.id,safeName(d.name));s.data.room=r.id;s.join(r.id);ack({id:r.id,state:state(r),members:members(r),messages:r.messages,callMembers:callMembers(r),queue:r.queue});io.to(r.id).emit('members',members(r))});
s.on('room:rename',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Not in a room'});
 const newName=safeName(d?.name);if(!newName)return ack?.({error:'Name is required'});
 r.users.set(s.id,newName);io.to(r.id).emit('members',members(r));
 ack?.({ok:true});
});
s.on('video',(d,ack)=>{const r=roomOf(s);if(!r)return;const video=getVideo(d?.url);if(!video)return ack?.({error:'Enter a valid YouTube link'});r.video=video;r.position=0;r.playing=false;r.at=Date.now();r.version++;io.to(r.id).emit('state',state(r));ack?.({ok:true})});

s.on('discover:search',async(d,ack)=>{
 if(typeof ack!=='function')return;
 if(!roomOf(s))return ack({error:'Join the watch room before searching'});
 if(!process.env.YOUTUBE_API_KEY)return ack({error:'In-app search needs a YouTube API key. Use the recent shelf or paste a link for now.'});
 const q=typeof d?.q==='string'?d.q.trim().slice(0,80):'';
 if(q.length<2)return ack({error:'Enter at least two characters'});
 const now=Date.now(),rate=searchRates.get(s.id)||{count:0,until:now+3600000};
 if(rate.until<now){rate.count=0;rate.until=now+3600000}
 rate.count++;searchRates.set(s.id,rate);
 if(rate.count>12)return ack({error:'Search limit reached. Please try later.'});
 try{ack({items:await searchYouTube(q)})}catch(e){ack({error:e.message})}
});
s.on('queue:add',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Join the room first'});
 const id=getVideo(d?.url);if(!id)return ack?.({error:'Enter a valid YouTube video'});
 if(r.queue.length>=20)return ack?.({error:'The queue is full'});
 const title=typeof d.title==='string'?d.title.trim().replace(/[\u0000-\u001f<>]/g,'').slice(0,140):'';
 const item={id:randomBytes(6).toString('hex'),video:id,title:title||'YouTube video',addedBy:r.users.get(s.id)};
 r.queue.push(item);io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true});
});
s.on('queue:play',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Join the room first'});
 const i=r.queue.findIndex(x=>x.id===d?.id);if(i<0)return ack?.({error:'Video not found in queue'});
 const item=r.queue.splice(i,1)[0];r.video=item.video;r.playing=false;r.position=0;r.at=Date.now();r.version++;
 io.to(r.id).emit('state',state(r));io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true})
});
s.on('queue:remove',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Not in room'});
 const i=r.queue.findIndex(x=>x.id===d?.id);if(i<0)return ack?.({error:'Not in queue'});
 r.queue.splice(i,1);io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true})
});
s.on('playback',d=>{const r=roomOf(s);if(!r||d?.version!==r.version||!['play','pause','seek'].includes(d?.action)||!Number.isFinite(d.position)||d.position<0||d.position>86400)return;r.position=d.position;r.playing=d.action==='play'?true:d.action==='pause'?false:r.playing;r.at=Date.now();s.to(r.id).emit('state',state(r))});
s.on('sync',()=>{const r=roomOf(s);if(r)s.emit('state',state(r))});
function sendChat(d,ack){
 const r=roomOf(s);
 if(!r){ack?.({error:'You are not connected to a room'});return}
 if(typeof d?.text!=='string'){ack?.({error:'Enter a message'});return}
 const message=d.text.trim().slice(0,500);
 if(!message){ack?.({error:'Message cannot be empty'});return}
 const now=Date.now(),previous=s.data.lastChatAt||0;
 if(now-previous<250){ack?.({error:'Sending too quickly. Try again.'});return}
 s.data.lastChatAt=now;
 const m={id:randomBytes(8).toString('hex'),name:r.users.get(s.id),text:message,at:now};
 r.messages.push(m);if(r.messages.length>80)r.messages.shift();
 // Existing tabs use the legacy message event; new tabs use chat:new.
 io.to(r.id).emit('message',m);
 io.to(r.id).emit('chat:new',m);
 ack?.({ok:true,id:m.id});
}
s.on('chat:send',sendChat);
s.on('message',sendChat);

s.on('call:join',(data,ack)=>{
 const r=roomOf(s);if(typeof ack!=='function')return;
 if(!r)return ack({error:'Join the room first'});
 const role=data?.role==='camera'?'camera':'spectator';
 const previous=r.callUsers.get(s.id);
 if(previous?.role==='camera'||(previous&&role==='spectator'))return ack({error:'Already connected'});
 const cameras=[...r.callUsers].filter(([,meta])=>meta.role==='camera');
 if(role==='camera'&&cameras.length>=MAX_CAMERA_PARTICIPANTS)return ack({error:'Both camera seats are in use',code:'CAMERAS_FULL'});
 const peers=role==='camera'
 ?cameras.map(([id])=>id)
 :cameras.filter(([,meta])=>meta.sharing).map(([id])=>id);
 // Converting an automatic spectator to a camera seat does not require another join.
 if(previous?.role==='spectator'){
  r.callUsers.delete(s.id);
  s.to(r.id).emit('call:peer-left',{id:s.id});
 }
 // Camera publishing is explicitly requested by clicking "Join on camera —
 // visible to everyone in this room". Passive spectators never publish media.
 r.callUsers.set(s.id,{role,sharing:role==='camera'});
 ack({role,peers,callMembers:callMembers(r)});
 publishCall(r);
 s.to(r.id).emit('call:peer-joined',{id:s.id,role});
 if(role==='camera'){
  // Existing spectators are automatically invited to receive the new camera.
  for(const [id,meta] of r.callUsers){
   if(meta.role==='spectator')io.to(id).emit('call:publisher-available',{id:s.id});
  }
 }
});
s.on('call:share',(d,ack)=>{
 const r=roomOf(s),user=r?.callUsers.get(s.id);
 if(!user||user.role!=='camera')return ack?.({error:'Only camera participants can share their call'});
 const newValue=d?.enabled===true;
 if(user.sharing===newValue)return ack?.({ok:true});
 user.sharing=newValue;
 for(const [id,peer] of r.callUsers){
  if(peer.role!=='spectator')continue;
  io.to(id).emit(newValue?'call:publisher-available':'call:peer-left',{id:s.id});
  if(!newValue)io.to(s.id).emit('call:peer-left',{id});
 }
 publishCall(r);ack?.({ok:true,sharing:user.sharing});
});
s.on('call:leave',()=>leaveCall(s));
s.on('call:signal',d=>{
 const r=roomOf(s),from=r?.callUsers.get(s.id),to=r?.callUsers.get(d?.to);
 if(!from||!to||d.to===s.id||!d.data||typeof d.data!=='object'||Array.isArray(d.data))return;
 const cameraPair=from.role==='camera'&&to.role==='camera';
 const cameraToViewer=from.role==='camera'&&to.role==='spectator'&&from.sharing;
 const viewerToCamera=from.role==='spectator'&&to.role==='camera'&&to.sharing;
 if(!(cameraPair||cameraToViewer||viewerToCamera))return;
 let len;try{len=JSON.stringify(d.data).length}catch{return}
 if(len>16000)return;
 io.to(d.to).emit('call:signal',{from:s.id,data:d.data});
});
s.on('disconnect',()=>leave(s))
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Togetherly listening'));