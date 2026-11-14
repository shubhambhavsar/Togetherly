'use strict';
const express=require('express'),http=require('http'),{Server}=require('socket.io'),{randomBytes}=require('crypto'),path=require('path');
const app=express(),server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:16000});
const rooms=new Map();
const MAX_CALL_PARTICIPANTS=4;
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');res.set('Permissions-Policy','camera=(self), microphone=(self)');next()});
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_req,res)=>res.json({ok:true}));
app.get('/api/rtc',(_req,res)=>{const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];if(process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)iceServers.push({urls:process.env.TURN_URL.split(','),username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});res.set('Cache-Control','no-store').json({iceServers,relayAvailable:iceServers.some(entry=>[].concat(entry.urls).some(u=>u.startsWith('turn:')||u.startsWith('turns:')))})});
app.get('/room/:id',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const safeName=x=>typeof x==='string'?x.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,25):'';
const validRoom=x=>typeof x==='string'&&/^[a-f0-9]{24}$/.test(x);
const getVideo=x=>{if(typeof x!=='string'||x.length>500)return null;x=x.trim();if(/^[\w-]{11}$/.test(x))return x;try{const u=new URL(x);let id=null;if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)){id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]}else if(['youtu.be','www.youtu.be'].includes(u.hostname))id=u.pathname.split('/')[1];return /^[\w-]{11}$/.test(id||'')?id:null}catch{return null}};
const roomOf=s=>{const r=rooms.get(s.data.room);return r?.users.has(s.id)?r:null};
const state=r=>({video:r.video,playing:r.playing,position:r.position+(r.playing?(Date.now()-r.at)/1000:0),version:r.version});
const members=r=>[...r.users].map(([id,name])=>({id,name}));
function leaveCall(s) {
 const r=roomOf(s);
 if(!r?.callUsers?.has(s.id))return;
 r.callUsers.delete(s.id);
 s.to(r.id).emit('call:peer-left',{id:s.id});
 io.to(r.id).emit('call:members',[...r.callUsers]);
}
function leave(s){leaveCall(s);const r=roomOf(s);if(!r)return;r.users.delete(s.id);s.leave(r.id);s.data.room=null;io.to(r.id).emit('members',members(r));if(!r.users.size)rooms.delete(r.id)}
io.on('connection',s=>{
s.on('create',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before creating a room'});if(roomOf(s))return ack({error:'Already in a room'});const id=randomBytes(12).toString('hex'),r={id,users:new Map(),video:'M7lc1UVf-VE',playing:false,position:0,at:Date.now(),version:0,messages:[],callUsers:new Set()};rooms.set(id,r);r.users.set(s.id,safeName(d?.name));s.data.room=id;s.join(id);ack({id,state:state(r),members:members(r),messages:[],callMembers:[]})});
s.on('join',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before joining'});const r=validRoom(d?.id)?rooms.get(d.id):null;if(!r)return ack({error:'Room not found. Ask for a new link.'});if(r.users.size>=8)return ack({error:'Room full'});if(roomOf(s))leave(s);r.users.set(s.id,safeName(d.name));s.data.room=r.id;s.join(r.id);ack({id:r.id,state:state(r),members:members(r),messages:r.messages,callMembers:[...r.callUsers]});io.to(r.id).emit('members',members(r))});
s.on('room:rename',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Not in a room'});
 const newName=safeName(d?.name);if(!newName)return ack?.({error:'Name is required'});
 r.users.set(s.id,newName);io.to(r.id).emit('members',members(r));
 ack?.({ok:true});
});
s.on('video',(d,ack)=>{const r=roomOf(s);if(!r)return;const video=getVideo(d?.url);if(!video)return ack?.({error:'Enter a valid YouTube link'});r.video=video;r.position=0;r.playing=false;r.at=Date.now();r.version++;io.to(r.id).emit('state',state(r));ack?.({ok:true})});
s.on('playback',d=>{const r=roomOf(s);if(!r||d?.version!==r.version||!['play','pause','seek'].includes(d?.action)||!Number.isFinite(d.position)||d.position<0||d.position>86400)return;r.position=d.position;r.playing=d.action==='play'?true:d.action==='pause'?false:r.playing;r.at=Date.now();s.to(r.id).emit('state',state(r))});
s.on('sync',()=>{const r=roomOf(s);if(r)s.emit('state',state(r))});
s.on('message',d=>{const r=roomOf(s);if(!r||typeof d?.text!=='string')return;const text=d.text.trim().slice(0,500);if(!text)return;const m={id:randomBytes(6).toString('hex'),name:r.users.get(s.id),text};r.messages.push(m);if(r.messages.length>40)r.messages.shift();io.to(r.id).emit('message',m)});
s.on('call:join',(_,ack)=>{
 const r=roomOf(s);
 if(typeof ack!=='function')return;
 if(!r)return ack({error:'Join a room first'});
 if(r.callUsers.has(s.id))return ack({peers:[...r.callUsers].filter(id=>id!==s.id)});
 if(r.callUsers.size>=MAX_CALL_PARTICIPANTS)return ack({error:'Group call is full (maximum 4)'});
 const peers=[...r.callUsers];
 r.callUsers.add(s.id);
 ack({peers});
 io.to(r.id).emit('call:members',[...r.callUsers]);
 s.to(r.id).emit('call:peer-joined',{id:s.id});
});
s.on('call:leave',()=>leaveCall(s));
s.on('call:signal',d=>{
 const r=roomOf(s);
 if(!r||!r.callUsers.has(s.id)||!r.callUsers.has(d?.to)||d.to===s.id)return;
 if(!d.data||typeof d.data!=='object'||Array.isArray(d.data))return;
 let len;try{len=JSON.stringify(d.data).length}catch{return}
 if(len>16000)return;
 io.to(d.to).emit('call:signal',{from:s.id,data:d.data});
});
s.on('disconnect',()=>leave(s))
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Togetherly listening'));