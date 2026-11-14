'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'server.js'),'utf8');
const frontend=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
test('server and browser scripts parse',()=>{new vm.Script(backend);new vm.Script(frontend)});
test('browser controls have corresponding HTML elements',()=>{
 const ids=[...frontend.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of new Set(ids))assert.ok(html.includes('id="'+id+'"'),'Missing DOM element: '+id);
});
test('YouTube API starts after callback and failures have recovery UI',()=>{
 assert.ok(frontend.includes('window.onYouTubeIframeAPIReady='));
 assert.ok(frontend.includes('tag.src='));
 assert.ok(html.includes('id="playerFallback"'));
 assert.ok(!html.includes('<script src="https://www.youtube.com/iframe_api"></script>'));
});
test('rooms, queues, two cameras, private spectator access',async()=>{
 let connect;const relayed=[];
 class FakeIO{on(evt,fn){if(evt==='connection')connect=fn}to(id){return{emit:(event,data)=>relayed.push({id,event,data})}}}
 const express=()=>({disable(){},use(){},get(){}});
 express.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?express:id==='http'?{createServer:()=>({listen(){}})}:
 id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'a'.repeat(n*2)})}:
 id==='path'?{join:(...a)=>a.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 function client(id){
  const handlers={};const s={id,data:{},on:(event,fn)=>handlers[event]=fn,join(){},leave(){},to:()=>({emit:(event,data)=>relayed.push({id:'other',event,data})})};
  connect(s);return{ask:(event,data)=>new Promise(resolve=>handlers[event](data,resolve)),fire:(event,data)=>handlers[event](data)}
 }
 const a=client('a'),b=client('b'),c=client('c');
 assert.match((await a.ask('create',{name:''})).error,/name/i);
 const room=await a.ask('create',{name:'Alex'});
 assert.equal((await b.ask('join',{id:room.id,name:'Bea'})).members.length,2);
 assert.equal((await c.ask('join',{id:room.id,name:'Cory'})).members.length,3);
 assert.equal((await b.ask('room:rename',{name:'Bella'})).ok,true);
 assert.deepEqual(Array.from((await a.ask('call:join',{role:'camera'})).peers),[]);
 assert.deepEqual(Array.from((await b.ask('call:join',{role:'camera'})).peers),['a']);
 assert.equal((await c.ask('call:join',{role:'camera'})).code,'CAMERAS_FULL');
 assert.deepEqual(Array.from((await c.ask('call:join',{role:'spectator'})).peers),[]);
 c.fire('call:signal',{to:'a',data:{description:{type:'offer',sdp:'private'}}});
 assert.equal(relayed.some(x=>x.id==='a'&&x.event==='call:signal'),false,'Camera must not leak to spectators before consent');
 assert.equal((await a.ask('call:share',{enabled:true})).sharing,true);
 assert.ok(relayed.some(x=>x.id==='c'&&x.event==='call:publisher-available'));
 c.fire('call:signal',{to:'a',data:{description:{type:'offer',sdp:'permitted'}}});
 assert.ok(relayed.some(x=>x.id==='a'&&x.event==='call:signal'),'Consent allows signaling');
 c.fire('call:signal',{to:'b',data:{description:{type:'offer',sdp:'blocked'}}});
 assert.equal(relayed.some(x=>x.id==='b'&&x.event==='call:signal'),false,'Second camera must give consent independently');
 const queued=await a.ask('queue:add',{url:'M7lc1UVf-VE',title:'Backrooms | horror film X 01'});
 assert.equal(queued.ok,true);
 const queueNotification=relayed.find(x=>x.event==='queue:update'&&x.data.length);
 assert.ok(queueNotification,'Queue update must reach the whole room');
 assert.equal(queueNotification.data[0].title,'Backrooms | horror film X 01','Queue titles must never drop normal letters or digits');
 const itemId=queueNotification.data[0].id;
 assert.equal((await c.ask('queue:play',{id:itemId})).ok,true);
 assert.ok(relayed.some(x=>x.event==='state'),'Playing queued video should update shared playback state');
 assert.equal((await a.ask('call:share',{enabled:false})).sharing,false);
 assert.ok(relayed.some(x=>x.id==='c'&&x.event==='call:peer-left'),'Revoking consent closes spectator feed');
 b.fire('call:leave');
 assert.ok(relayed.some(x=>x.event==='call:peer-left'));
});

test('fullscreen preserves controls in the same canvas',()=>{
 assert.ok(html.includes('id="fullscreenToggle"'));
 assert.ok(html.includes('id="videoShell"'));
 assert.ok(html.includes('id="callOverlay"'));
 assert.ok(html.includes('id="chatBubble"'));
 const start=html.indexOf('id="videoShell"');
 const end=html.indexOf('id="fullscreenToggle"',start);
 assert.ok(start>0&&end>start);
 assert.ok(html.indexOf('id="callOverlay"',start)<end);
 assert.ok(html.indexOf('id="chatBubble"',start)<end);
 assert.ok(frontend.includes("fs:0"));
 assert.ok(frontend.includes('theaterShell.requestFullscreen('));
 assert.ok(frontend.includes('theaterShell.appendChild(theaterChat)'));
 assert.ok(frontend.includes('theaterAnchor.after(theaterChat)'));
 assert.ok(frontend.includes('theaterFallback=true'));
 const css=fs.readFileSync(path.join(root,'public/bluehour.css'),'utf8');
 assert.ok(css.includes('.video-shell.pseudo-fullscreen'));
 assert.ok(css.includes('.video-shell.theater-mode #chatPanel.chat-open'));
});
test('video calls can be minimized and restored without ending the call',()=>{
 assert.ok(html.includes('id="callBubble"'),'Collapsed call bubble missing');
 assert.ok(html.includes('id="minimizeCall"'),'Minimize button missing');
 assert.ok(frontend.includes("callMinimized=true;syncCallDock()"),'Minimizing should preserve call state');
 assert.ok(frontend.includes("callMinimized=false;syncCallDock()"),'Restore action missing');
 assert.ok(frontend.includes("!callActive||!callMinimized"),'Bubble should show only for minimized active calls');
});
test('cinema stylesheet is loaded and group calling requests room-scoped ICE servers',()=>{
 assert.ok(html.includes('/bluehour.css?v=1'),'Blue Hour Cinema stylesheet not loaded');
 assert.ok(frontend.includes("new URLSearchParams({room,sid:socket.id||''})"),'No scoped ICE request');
 assert.ok(backend.includes('allowRtcRequest(req)'),'TURN endpoint must check room membership');
 assert.ok(backend.includes('METERED_TURN_DOMAIN')&&backend.includes('METERED_TURN_API_KEY'),'Metered TURN integration missing');
});

test('Blue Hour discovery and spectator controls are present',()=>{
 const css=fs.readFileSync(path.join(root,'public/bluehour.css'),'utf8');
 for(const hex of ['#0B1420','#172433','#A8C7D8','#F4F1EB','#E9BB89','#92A4B7'])assert.ok(css.includes(hex),hex+' missing');
 for(const id of ['discoverModal','discoverInput','discoverResults','watchCall','shareCall','queueList','pasteLink'])assert.ok(html.includes('id="'+id+'"'),id+' missing');
 assert.ok(frontend.includes("joinCall('spectator')"),'Spectator mode missing');
 assert.ok(frontend.includes('callRole'), 'Audience mode missing');
 assert.ok(backend.includes("process.env.YOUTUBE_API_KEY"),'Optional search configuration missing');
 assert.ok(backend.includes("videoEmbeddable:'true'"),'Search must filter for embeddable videos');
});

test('chat acknowledgments, persistence and validation',async()=>{
 let connection;const relayed=[];
 class FakeSocketServer{
  on(event,fn){if(event==='connection')connection=fn}
  to(id){return{emit:(event,data)=>relayed.push({id,event,data})}}
 }
 const exp=()=>({disable(){},use(){},get(){}});
 exp.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?exp:
 id==='http'?{createServer:()=>({listen(){}})}:
 id==='socket.io'?{Server:FakeSocketServer}:
 id==='crypto'?{randomBytes:n=>({toString:()=> 'b'.repeat(n*2)})}:
 id==='path'?{join:(...a)=>a.join('/')}:
 require(id);
 vm.runInNewContext(backend,{
  require:fakeRequire,process:{env:{PORT:'3000'}},__dirname:'/app',console,
  setInterval:()=>({unref(){}})
 },{filename:'server.js'});
 function client(id){
  const handlers={};const socket={id,data:{},on:(e,fn)=>handlers[e]=fn,join(){},leave(){},to:()=>({emit:(e,d)=>relayed.push({id:'other',event:e,data:d})})};
  connection(socket);return{request:(event,data)=>new Promise(resolve=>handlers[event](data,resolve)),fire:(event,data)=>handlers[event](data)}
 }
 const a=client('a'),b=client('b');
 const room=await a.request('create',{name:'Alex'});
 await b.request('join',{id:room.id,name:'Bea'});
 const bad=await a.request('chat:send',{text:'  '});
 assert.match(bad.error,/empty/i);
 const sent=await a.request('chat:send',{text:'Movie night!'});
 assert.equal(sent.ok,true);
 assert.ok(sent.id);
 assert.ok(relayed.some(x=>x.event==='chat:new'&&x.data.text==='Movie night!'));
 assert.ok(relayed.some(x=>x.event==='message'&&x.data.text==='Movie night!'));
 const later=client('c');
 const history=await later.request('join',{id:room.id,name:'Cam'});
 assert.equal(history.messages[0].text,'Movie night!');
});
test('movie eligibility checks use videos.list and filter blocked regions',()=>{
 assert.ok(backend.includes("part:'status,contentDetails'"),'Missing secondary detail request');
 assert.ok(backend.includes("entry?.status?.embeddable===true"),'Missing embedding eligibility check');
 assert.ok(backend.includes("targets=['CA','IN']"),'Must check Canada and India');
 assert.ok(backend.includes("eligibility:'unverified'"),'Must label uncertain results honestly');
 assert.ok(frontend.includes('markUnplayable(lastState?.video)'), 'Remember failed embedded playback');
 assert.ok(html.includes('id="chooseAnother"'),'Missing fallback to search');
});
test('controls and chat are visible in responsive design',()=>{
 const layout=fs.readFileSync(path.join(root,'public/layout-fixes.css'),'utf8');
 for(const id of ['toolbarFullscreen','chatSend','chatConnection','chatFeedback'])assert.ok(html.includes('id="'+id+'"'),id+' not found');
 assert.ok(layout.includes('.room-rail{'),'Desktop rail height is uncontrolled');
 assert.ok(layout.includes('.conversation-section .chat{'),'Messages not constrained');
 assert.ok(layout.includes('.toolbar-actions{'),'No dedicated player actions');
 assert.ok(frontend.includes("socket.timeout(9000).emit('chat:send'"),'Chat needs delivery acknowledgement');
 assert.ok(frontend.includes("socket.on('chat:new'"),'Chat receiver needs a dedicated event');
 assert.ok(frontend.includes("if(!socket.connected||!room)"),'Offline sends must not be lost');
 assert.ok(frontend.includes("$('toolbarFullscreen').onclick=toggleTheater"),'Player fullscreen button not wired');
});

test('refreshing an invited room auto-joins using a saved nickname, without activating camera',()=>{
 assert.ok(frontend.includes("else if(roomFromPath&&!autoJoinAttempted&&nickname())"),'Refresh auto-join is missing');
 assert.ok(frontend.includes("autoJoinAttempted=true"),'Room refresh must not issue repeated joins');
 assert.ok(frontend.includes("join();"),'Stored name should rejoin without user interaction');
 assert.ok(frontend.includes("localStorage.getItem('togetherly.nickname')"),'User nickname must be remembered');
 assert.ok(!frontend.includes("if(roomFromPath){joinCall("),'Never activate camera automatically');
});
test('watch interface relies on YouTube controls and shows contextual call actions',()=>{
 for(const id of ['callEntry','callActiveControls','cameraButtons','call','watchCall','mic','camera','hangup','shareCall','syncLabel'])
  assert.ok(html.includes('id="'+id+'"'),id+' is missing');
 for(const obsolete of ['id="play"','id="pause"','id="sync"'])
  assert.ok(!html.includes(obsolete),obsolete+' is obsolete');
 assert.ok(frontend.includes("setInterval(()=>{if(room&&playerReady&&!document.hidden)socket.emit('sync')"),'Automatic synchronization missing');
 assert.ok(frontend.includes("updateCallActions()"),'Contextual call controls not wired');
 assert.ok(frontend.includes("viewers===0"),'Share-to-spectators action should be hidden without spectators');
 assert.ok(html.includes('/simplify.css?v=1'),'Updated UI layout stylesheet missing');
});
test('friendly queue titles decode entities while preserving source content',()=>{
 assert.ok(backend.includes(String.raw`/[\u0000-\u001f<>]/g`),'Title sanitizer should only strip control characters');
 assert.ok(frontend.includes('function humanTitle('),'Missing title entity decoder');
 assert.ok(frontend.includes("title.textContent=humanTitle(item.title)"),'Queue labels should use decoded titles');
 assert.ok(frontend.includes("title.title=title.textContent"),'Full queue title should be available on hover');
 assert.ok(html.includes('/simplify.css?v=1'));
});
test('TURN health response indicates configuration presence only',()=>{
 assert.ok(backend.includes('relayConfigured:Boolean('),'Health endpoint must report relay config presence');
 assert.ok(backend.includes('METERED_TURN_DOMAIN')&&backend.includes('METERED_TURN_API_KEY'));
 assert.ok(!backend.includes("res.json({ok:true,relayKey"),'Health response must not leak credentials');
});
