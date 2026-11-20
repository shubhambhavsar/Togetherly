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
test('two camera seats automatically publish to room spectators',async()=>{
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
 const passive=await c.ask('call:join',{role:'spectator'});
 assert.deepEqual(Array.from(passive.peers),[]);
 const first=await a.ask('call:join',{role:'camera'});
 assert.deepEqual(Array.from(first.peers),[]);
 assert.ok(first.callMembers.find(v=>v.id==='a'&&v.sharing),'Explicitly joined cameras must publish to their private room');
 assert.ok(relayed.some(x=>x.id==='c'&&x.event==='call:publisher-available'),'A joining camera should notify existing passive viewers');
 const second=await b.ask('call:join',{role:'camera'});
 assert.deepEqual(Array.from(second.peers),['a']);
 assert.ok(relayed.filter(x=>x.id==='c'&&x.event==='call:publisher-available').length>=2,'Both cameras should reach spectators');
 assert.equal((await c.ask('call:join',{role:'camera'})).code,'CAMERAS_FULL');
 c.fire('call:signal',{to:'a',data:{description:{type:'offer',sdp:'authorized'}}});
 assert.ok(relayed.some(x=>x.id==='a'&&x.event==='call:signal'),'A passive spectator can signal a shared camera');
 assert.equal((await a.ask('call:share',{enabled:false})).sharing,false);
 const signalCount=relayed.filter(x=>x.id==='a'&&x.event==='call:signal').length;
 c.fire('call:signal',{to:'a',data:{description:{type:'offer',sdp:'denied'}}});
 assert.equal(relayed.filter(x=>x.id==='a'&&x.event==='call:signal').length,signalCount,'Revoking sharing blocks spectator signals');
 assert.ok(relayed.some(x=>x.id==='c'&&x.event==='call:peer-left'),'Revoking sharing removes camera from viewers');
 assert.equal((await a.ask('call:share',{enabled:true})).sharing,true);
 b.fire('call:leave');
 assert.ok(relayed.some(x=>x.event==='call:peer-left'));
 const promotion=await c.ask('call:join',{role:'camera'});
 assert.equal(promotion.role,'camera','Passive spectators must be able to take a free camera seat');
 assert.deepEqual(Array.from(promotion.peers),['a']);
 assert.ok(promotion.callMembers.find(x=>x.id==='c'&&x.sharing),'A promoted viewer now publishes explicitly');
 const queued=await a.ask('queue:add',{url:'M7lc1UVf-VE',title:'Backrooms | horror film X 01'});
 assert.equal(queued.ok,true);
 const notification=relayed.find(x=>x.event==='queue:update'&&x.data.length);
 assert.ok(notification);
 assert.equal(notification.data[0].title,'Backrooms | horror film X 01');
 assert.equal((await c.ask('queue:play',{id:notification.data[0].id})).ok,true);
 assert.ok(relayed.some(x=>x.event==='state'));
});

test('fullscreen keeps cameras and Exit, while chat stays outside',()=>{
 assert.ok(html.includes('id="fullscreenToggle"'));
 assert.ok(html.includes('id="videoShell"'));
 assert.ok(html.includes('id="callOverlay"'));
 assert.ok(!html.includes('id="chatBubble"'),'No fullscreen chat button');
 const start=html.indexOf('id="videoShell"');
 const end=html.indexOf('class="player-toolbar"',start);
 assert.ok(start>0&&end>start);
 assert.ok(html.indexOf('id="callOverlay"',start)>start&&html.indexOf('id="callOverlay"',start)<end);
 assert.ok(html.indexOf('id="fullscreenToggle"',start)>start&&html.indexOf('id="fullscreenToggle"',start)<end);
 assert.ok(html.indexOf('id="chatPanel"')>end,'Chat drawer stays outside fullscreen player');
 assert.ok(frontend.includes("fs:0"));
 assert.ok(frontend.includes('theaterShell.requestFullscreen('));
 assert.ok(!frontend.includes('theaterShell.appendChild(theaterChat)'),'Fullscreen must not reparent chat');
 assert.ok(frontend.includes('if(active&&chatOpen)toggleChat(false)'),'Fullscreen must close chat');
 assert.ok(frontend.includes("if(show&&theaterActive())return;"),'Fullscreen must not open chat');
 assert.ok(frontend.includes('theaterFallback=true'));
 const css=fs.readFileSync(path.join(root,'public/no-fullscreen-chat.css'),'utf8');
 assert.ok(css.includes('body.theater-lock #chatPanel'),'Fullscreen chat drawer must be hidden');
 assert.ok(css.includes('.theater-dock-divider{display:none'),'Dock must not contain unused separator');
});
test('camera surface cycles compact, minimized, enlarged, then compact',()=>{
 assert.ok(html.includes('id="callBubble"'),'Minimized camera bubble is required');
 assert.ok(html.includes('id="callOverlay"'),'Interactive call surface is required');
 assert.ok(html.includes('role="button" tabindex="0" aria-label="Minimize camera tiles"'),'Keyboard access must be preserved');
 assert.ok(!html.includes('id="minimizeCall"'),'Redundant minimize button must be removed');
 assert.ok(!html.includes('id="expandCall"'),'Redundant expand button must be removed');
 assert.ok(frontend.includes("callViewMode=nextCallViewMode(callViewMode)"),'One-click state cycle must be used');
 assert.ok(frontend.includes("$('callOverlay').onclick=()=>cycleCallView()"),'Clicking video tiles must cycle sizes');
 assert.ok(frontend.includes("$('callBubble').onclick=()=>cycleCallView()"),'Clicking minimized bubble must enlarge');
 const start=frontend.indexOf('function nextCallViewMode(mode){');
 const end=frontend.indexOf('function cycleCallView(){',start);
 assert.ok(start>=0&&end>start,'Pure call-view state transition missing');
 const states=vm.runInNewContext(frontend.slice(start,end)+"\n[nextCallViewMode('compact'),nextCallViewMode('minimized'),nextCallViewMode('expanded')]"); 
 assert.deepEqual(Array.from(states),['minimized','expanded','compact']);
 assert.ok(!frontend.includes("socket.emit('call:leave')")||frontend.includes("async function leaveCall("),'Leave call should remain separate from preview resizing');
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
 for(const id of ['discoverModal','discoverInput','discoverResults','call','queueList','pasteLink'])assert.ok(html.includes('id="'+id+'"'),id+' missing');
 assert.ok(!html.includes('id="watchCall"'),'Watch call should not be a manual step');
 assert.ok(!html.includes('id="shareCall"'),'Room-visible camera consent should be conveyed at entry');
 assert.ok(frontend.includes('startSpectatorView()'),'Spectator mode must join automatically');
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
 for(const id of ['callEntry','callActiveControls','cameraButtons','call','mic','camera','hangup','syncLabel'])
  assert.ok(html.includes('id="'+id+'"'),id+' is missing');
 for(const obsolete of ['id="play"','id="pause"','id="sync"'])
  assert.ok(!html.includes(obsolete),obsolete+' is obsolete');
 assert.ok(frontend.includes("setInterval(()=>{if(room&&playerReady&&!document.hidden)socket.emit('sync')"),'Automatic synchronization missing');
 assert.ok(frontend.includes("updateCallActions()"),'Contextual call controls not wired');
 assert.ok(!frontend.includes("$('watchCall')"),'No manual spectator join button should remain');
 assert.ok(!frontend.includes("$('shareCall')"),'Redundant spectator share control should not remain');
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

test('theater dock contains only Exit fullscreen; chat works outside',()=>{
 for(const id of ['theaterDock','fullscreenToggle','toolbarChat','toolbarUnread'])
  assert.ok(html.includes('id="'+id+'"'),'Missing control: '+id);
 assert.ok(!html.includes('id="chatBubble"'),'Fullscreen chat button must be removed');
 assert.ok(!html.includes('id="unread"'),'No orphaned badge inside fullscreen');
 assert.ok(html.includes('/cinema-dock.css?v=1'));
 assert.ok(html.includes('/no-fullscreen-chat.css?v=1'));
 assert.ok(frontend.includes("$('toolbarChat').onclick=()=>toggleChat(!chatOpen)"),'Normal room chat should work');
 assert.ok(!frontend.includes("$('chatBubble').onclick"),'Fullscreen chat action should be removed');
 assert.ok(!frontend.includes('theaterAnchor'),'Chat stays in its original sidebar');
});
test('mobile fullscreen keeps the single right-edge Exit control',()=>{
 const compact=fs.readFileSync(path.join(root,'public/compact-mobile-dock.css'),'utf8');
 const noChat=fs.readFileSync(path.join(root,'public/no-fullscreen-chat.css'),'utf8');
 assert.ok(html.includes('/compact-mobile-dock.css?v=1'));
 assert.ok(html.includes('/no-fullscreen-chat.css?v=1'));
 assert.ok(html.includes('id="theaterLabel"'));
 assert.ok(html.includes('aria-label="Exit fullscreen"'));
 assert.ok(compact.includes('(pointer:coarse) and (max-width:1100px)'));
 assert.ok(noChat.includes('width:50px!important'),'Single button rail should be narrow');
 assert.ok(noChat.includes('height:44px!important'),'Exit button must remain tap-friendly');
 assert.ok(noChat.includes('right:max(7px,env(safe-area-inset-right))!important'),'Exit button stays at right edge');
 assert.ok(html.includes('id="toolbarChat"'),'Normal-mode chat remains');
});
test('automatic camera viewing does not request microphone or camera permission',()=>{
 const start=frontend.indexOf('async function startSpectatorView(){');
 const end=frontend.indexOf('async function joinCall(){',start);
 assert.ok(start>=0&&end>start,'Missing passive viewer implementation');
 const viewer=frontend.slice(start,end);
 assert.ok(!viewer.includes('getMedia()'),'Passive viewers must not request media permission');
 assert.ok(viewer.includes("role:'spectator'"),'Viewer uses receive-only role');
 assert.ok(frontend.includes("startSpectatorView()}"),'Room entry should automatically subscribe');
 assert.ok(frontend.includes("startSpectatorView();notice('Reconnected"),'Room reconnect should restore camera subscription');
 assert.ok(frontend.includes("pc.addTransceiver('video',{direction:'recvonly'})"),'Viewers must never publish video tracks');
 assert.ok(frontend.includes("if(callRole==='spectator')video.muted=true"),'Passive video should autoplay without blocked audio');
 assert.ok(html.includes('available to everyone with this room link'),'Explicit camera privacy notice must be shown');
});
test('normal mobile chat remains keyboard responsive outside fullscreen',()=>{
 const css=fs.readFileSync(path.join(root,'public/mobile-chat-fix.css'),'utf8');
 assert.ok(frontend.includes('window.visualViewport'),'Mobile chat should use VisualViewport');
 assert.ok(frontend.includes("window.visualViewport?.addEventListener('resize'"),'Resize listener required');
 assert.ok(css.includes('body.chat-typing:not(.theater-lock)'),'Keyboard layout applies to normal room');
 assert.ok(css.includes('font-size:16px!important'),'Avoid iOS input zoom');
 assert.ok(frontend.includes("if(show&&theaterActive())return;"),'Theater chat should not open');
 assert.ok(html.indexOf('/no-fullscreen-chat.css?v=1')>html.indexOf('/mobile-chat-fix.css?v=1'),'Fullscreen chat suppression takes CSS precedence');
});
test('spectator camera audio unlock does not minimize the video tile',()=>{
 assert.ok(frontend.includes('video.muted=true'), 'Passive camera playback must start muted for mobile compatibility');
 assert.ok(frontend.includes('event.stopPropagation()'), 'Unmuting must not trigger camera preview resize');
 assert.ok(frontend.includes("tileStatus(id,'Tap for audio')"), 'Spectator should see an audio activation hint');
 assert.ok(frontend.includes("video.play().then(()=>"), 'Audio activation should retry media playback after a gesture');
});

test('search discovery hides technical eligibility notices and player shows simple unavailable error',()=>{
 assert.ok(!frontend.includes('Prechecked for embedding and Canada/India availability.'),'No technical success message');
 assert.ok(!frontend.includes('Rights claims can still block playback.'),'No rights warning in success message');
 assert.ok(frontend.includes("playerHelp('This video is not available. Choose something else.',true)"),'Generic playback failure missing');
 assert.ok(frontend.includes("$('chooseAnother').classList.remove('hidden')"),'User must be able to find another video');
 assert.ok(frontend.includes("if(blocked)markUnplayable(lastState?.video)"),'Known blocked videos should be remembered');
 assert.ok(!html.includes('YouTube may still restrict some embedded videos even after eligibility checks.'),'No technical search banner');
 assert.ok(frontend.includes("No available videos found. Try another search."),'Empty search should have simple feedback');
 assert.ok(backend.includes("status?.embeddable===true"),'Keep backend filtering for video availability');
});

test('room capacity is eight participants without a global room count limit',async()=>{
 let onConnection;
 class FakeIO{on(event,fn){if(event==='connection')onConnection=fn}to(){return{emit(){}}}}
 const express=()=>({disable(){},use(){},get(){}});express.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?express:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'a'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 const makeSocket=id=>{
  const handlers={};onConnection({id,data:{},on:(event,fn)=>handlers[event]=fn,join(){},leave(){},to(){return{emit(){}}}});
  return {ask:(event,data)=>new Promise(resolve=>handlers[event](data,resolve))};
 };
 const a=makeSocket('a'),created=await a.ask('create',{name:'A'});
 assert.ok(created.id);
 for(let i=1;i<8;i++){
  const res=await makeSocket('peer'+i).ask('join',{id:created.id,name:'Peer'+i});
  assert.equal(res.members.length,i+1);
 }
 const overflow=await makeSocket('ninth').ask('join',{id:created.id,name:'Extra'});
 assert.equal(overflow.error,'Room full');
 const another=await makeSocket('fresh').ask('create',{name:'B'});
 assert.ok(another.id,'Creating another independent room remains possible');
 assert.ok(backend.includes('const MAX_ROOM_PARTICIPANTS=8'));
 assert.ok(!backend.includes('const MAX_ROOMS'),'No global room cap is configured');
});

test('shared HTTPS website source is validated, broadcast, and switched back to YouTube',async()=>{
 let connect;const outbound=[];
 class FakeIO{on(event,fn){if(event==='connection')connect=fn}to(roomId){return{emit:(event,data)=>outbound.push({roomId,event,data})}}}
 const express=()=>({disable(){},use(){},get(){}});express.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?express:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'c'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,URL:require('node:url').URL,process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 function client(id){
  const handlers={},socket={id,data:{},on:(event,fn)=>handlers[event]=fn,join(){},leave(){},
   to:()=>({emit:(event,data)=>outbound.push({roomId:'other',event,data})}),
   emit:(event,data)=>outbound.push({roomId:id,event,data})};
  connect(socket);
  return {ask:(event,data)=>new Promise(resolve=>handlers[event](data,resolve)),fire:(event,data)=>handlers[event](data)};
 }
 const a=client('owner'),b=client('guest');
 assert.match((await a.ask('website',{url:'https://flex.movie'})).error,/Join the room first/);
 const room=await a.ask('create',{name:'Owner'});
 assert.equal(room.state.source,'youtube');
 await b.ask('join',{id:room.id,name:'Guest'});
 for(const invalid of [
   'javascript:alert(1)','http://flex.movie','https://localhost/video',
   'https://127.0.0.1/movie','https://10.0.0.2/movie',
   'https://internal.local','https://everydaygrove.ca/room/foo',
   'https://user:secret@flex.movie/private',
   'https://flex.movie/video?access_token=secret',
   'https://flex.movie:444/video'
  ]){
   const reply=await a.ask('website',{url:invalid});
   assert.match(reply.error,/public HTTPS website/i,'Unsafe URL accepted: '+invalid);
 }
 const preview=await a.ask('website',{url:'https://flex.movie/'});
 assert.equal(preview.ok,true);
 const last=outbound.filter(x=>x.event==='state').pop().data;
 assert.equal(last.source,'website');
 assert.equal(last.websiteUrl,'https://flex.movie/');
 assert.equal(last.playing,false);
 b.fire('sync');
 assert.equal(outbound.at(-1).data.source,'website','Late joiners should see shared website state');
 const youtube=await a.ask('video',{url:'https://youtu.be/M7lc1UVf-VE'});
 assert.equal(youtube.ok,true);
 const current=outbound.filter(x=>x.event==='state').pop().data;
 assert.equal(current.source,'youtube');
 assert.equal(current.websiteUrl,'');
 assert.ok(backend.includes("r.source==='website'"),'Website mode must disable YouTube playback synchronization');
});
test('owner-authorized website timeline and automatic leader transfer',async()=>{
 let connected;const sent=[];
 class FakeIO{on(event,fn){if(event==='connection')connected=fn}to(id){return{emit:(event,data)=>sent.push({id,event,data})}}}
 const exp=()=>({disable(){},use(){},get(){}});exp.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?exp:id==='http'?{createServer:()=>({listen(){}})}:
 id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'd'.repeat(n*2)})}:
 id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,URL:require('node:url').URL,process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 function client(id){
  const handlers={},s={id,data:{},on:(e,fn)=>handlers[e]=fn,join(){},leave(){},
   to:()=>({emit:(e,d)=>sent.push({id:'other',event:e,data:d})}),
   emit:(e,d)=>sent.push({id,event:e,data:d})};
  connected(s);return{ask:(e,d)=>new Promise(resolve=>handlers[e](d,resolve)),fire:e=>handlers[e]()};
 }
 const host=client('host'),guest=client('guest');
 const created=await host.ask('create',{name:'Host'});
 assert.equal(created.state.websiteLeader,'host');
 await guest.ask('join',{id:created.id,name:'Guest'});
 assert.match((await host.ask('website:sample',{version:0,position:45,playing:true})).error,/No supported/);
 await host.ask('website',{url:'https://flexflix.site/movie'});
 const ver=sent.filter(e=>e.event==='state').at(-1).data.version;
 assert.match((await guest.ask('website:sample',{version:ver,position:45,playing:true})).error,/Only the room owner/);
 assert.match((await host.ask('website:sample',{version:ver,position:-1,playing:true})).error,/Invalid playback/);
 assert.equal((await host.ask('website:sample',{version:ver,position:80,playing:true})).ok,true);
 const latest=sent.filter(e=>e.event==='website:timeline').at(-1).data.timeline;
 assert.ok(latest.position>=80&&latest.playing);
 guest.fire('sync');
 assert.equal(sent.filter(e=>e.id==='guest'&&e.event==='state').at(-1).data.websiteLeader,'host');
 host.fire('disconnect');
 assert.equal(sent.filter(e=>e.event==='state').at(-1).data.websiteLeader,'guest');
 assert.equal((await guest.ask('website:sample',{version:ver,position:88,playing:false})).ok,true);
 await guest.ask('video',{url:'https://youtu.be/M7lc1UVf-VE'});
 assert.match((await guest.ask('website:sample',{version:ver+1,position:2,playing:false})).error,/No supported/);
});
test('catalog movie and TV adapters share exact validated third-party embed URLs',async()=>{
 let connect;const sent=[];
 class FakeIO{on(n,fn){if(n==='connection')connect=fn}to(id){return{emit:(event,data)=>sent.push({id,event,data})}}}
 const app=()=>({disable(){},use(){},get(){}});app.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?app:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'e'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,URL:require('node:url').URL,
  process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 function client(id){
  const handlers={},sock={id,data:{},on:(event,fn)=>handlers[event]=fn,join(){},leave(){},
   to:()=>({emit:(event,data)=>sent.push({id:'others',event,data})}),
   emit:(event,data)=>sent.push({id,event,data})};
  connect(sock);
  return{ask:(e,d)=>new Promise(resolve=>handlers[e](d,resolve)),fire:e=>handlers[e]()};
 }
 const host=client('host'),guest=client('guest');
 assert.match((await host.ask('catalog:play',{provider:'vidsrc',type:'movie',id:550})).error,/Join a room/);
 const created=await host.ask('create',{name:'Host'});
 await guest.ask('join',{id:created.id,name:'Guest'});
 for(const value of [
  {provider:'unknown',type:'movie',id:550},
  {provider:'vidsrc',type:'movie',id:0},
  {provider:'vidsrc',type:'movie',id:'<script>'},
  {provider:'vidfast',type:'tv',id:1399,season:0,episode:1},
  {provider:'vidfast',type:'tv',id:1399,season:1,episode:0},
  {provider:'__proto__',type:'movie',id:550},
  {provider:'vidlove',type:'tv',id:1399,season:100,episode:1}
 ])assert.match((await host.ask('catalog:play',value)).error,/supported provider/i);
 const movie=await host.ask('catalog:play',{provider:'vidsrc',type:'movie',id:550,title:'Fight Club'});
 assert.equal(movie.url,'https://vsembed.su/embed/movie/550');
 assert.equal(sent.filter(x=>x.event==='state').at(-1).data.catalog.title,'Fight Club');
 guest.fire('sync');
 assert.equal(sent.filter(x=>x.id==='guest'&&x.event==='state').at(-1).data.catalog.provider,'vidsrc');
 const tv=await guest.ask('catalog:play',{provider:'vidfast',type:'tv',id:1399,season:2,episode:3,title:'Series'});
 assert.equal(tv.url,'https://vidfast.vc/tv/1399/2/3');
 const state=sent.filter(x=>x.event==='state').at(-1).data;
 assert.equal(state.catalog.type,'tv');assert.equal(state.catalog.season,2);assert.equal(state.catalog.episode,3);
 const vidlove=await host.ask('catalog:play',{provider:'vidlove',type:'movie',id:550});
 assert.equal(vidlove.url,'https://player.vidlove.cc/embed/movie/550');
 await host.ask('website',{url:'https://example.org/'});
 assert.equal(sent.filter(x=>x.event==='state').at(-1).data.catalog,null);
 await host.ask('catalog:play',{provider:'vidfast',type:'movie',id:42});
 await host.ask('video',{url:'https://youtu.be/M7lc1UVf-VE'});
 assert.equal(sent.filter(x=>x.event==='state').at(-1).data.catalog,null);
});
test('catalog metadata search is limited, validated, cached and does not reveal TMDB credentials',async()=>{
 const routes={};let apiCalls=0;
 const app=()=>({disable(){},use(){},get:(path,fn)=>routes[path]=fn});app.static=()=>()=>{};
 class FakeIO{on(){ }to(){return{emit(){}}}}
 const requireFake=id=>id==='express'?app:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'f'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{
  require:requireFake,URL:require('node:url').URL,process:{env:{PORT:'3000',TMDB_API_READ_TOKEN:'private-tmdb-secret'}},
  AbortSignal:{timeout:()=>({})},
  fetch:async()=>{apiCalls++;return{ok:true,json:async()=>({results:[
   {media_type:'movie',id:550,title:'Fight Club',release_date:'1999-10-15',poster_path:'/abc.jpg'},
   {media_type:'person',id:2,name:'Someone'},
   {media_type:'tv',id:1399,name:'A Series',first_air_date:'2011-01-01'}
  ]})}},
  __dirname:'/app',console,setInterval:()=>({unref(){}})
 },{filename:'server.js'});
 assert.equal(typeof routes['/api/catalog/search'],'function');
 const request=async q=>{
  const res={code:200,body:null,headers:{},set(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
  await routes['/api/catalog/search']({query:{q},ip:'test-ip'},res);
  return res;
 };
 const invalid=await request('a');assert.equal(invalid.code,400);
 const results=await request('fight club');
 assert.equal(results.code,200);assert.equal(results.body.results.length,2);
 assert.equal(results.body.results[0].title,'Fight Club');
 assert.equal(results.body.results[1].type,'tv');
 assert.ok(!JSON.stringify(results.body).includes('private-tmdb-secret'));
 await request('fight club');
 assert.equal(apiCalls,1,'TMDB search results should be cached');
});
test('catalog search and provider picker use safe DOM and server-validated room events',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="catalogSearchForm"')&&html.includes('id="catalogPlayForm"'));
 for(const id of ['catalogQuery','catalogResults','catalogProvider','catalogId','catalogType',
  'catalogSeason','catalogEpisode','catalogStatus','catalogNowPlaying'])
  assert.ok(html.includes('id="'+id+'"'),'Missing catalogue input '+id);
 assert.ok(frontend.includes("socket.timeout(9000).emit('catalog:play'"));
 assert.ok(frontend.includes("fetch('/api/catalog/search?q='"));
 assert.ok(frontend.includes('row.textContent')===false,'Result rows should be structured');
 assert.ok(frontend.includes('title.textContent=item.title'),'Movie titles should not be inserted via HTML');
 assert.ok(!frontend.includes("catalogResults').innerHTML"),'Avoid raw search-result HTML');
 assert.ok(css.includes('.catalog-play-form'));
 assert.ok(html.includes('/app.js?v=20')&&html.includes('/website-player.css?v=8'));
 assert.ok(html.includes('not endorsed or certified by TMDB'),'Provide required third-party attribution');
 assert.ok(html.includes('Only watch content you are authorized to access'));
});

test('movie title suggestions work without a TMDB key using Wikidata IDs',async()=>{
 const routes={},calls=[];
 const exp=()=>({disable(){},use(){},get:(p,fn)=>routes[p]=fn});exp.static=()=>()=>{};
 class FakeIO{on(){}to(){return{emit(){}}}}
 const fakeRequire=id=>id==='express'?exp:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'd'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 const makeClaim=value=>[{rank:'normal',mainsnak:{datavalue:{value}}}];
 vm.runInNewContext(backend,{
  require:fakeRequire,URL:require('node:url').URL,process:{env:{PORT:'3000'}},
  AbortSignal:{timeout:()=>({})},console,
  fetch:async url=>{
   const dest=new URL(String(url));calls.push(dest);
   assert.equal(dest.hostname,'www.wikidata.org','No secret or untrusted provider should be queried');
   const action=dest.searchParams.get('action');
   if(action==='wbsearchentities')return{ok:true,json:async()=>({search:[
    {id:'Q100',label:'Inception',description:'2010 film'},
    {id:'Q101',label:'An actor',description:'actor'},
    {id:'Q102',label:'Inception series',description:'television series'},
    {id:'Q103',label:'Inception duplicate',description:'film'}
   ]})};
   if(action==='wbgetentities')return{ok:true,json:async()=>({entities:{
    Q100:{labels:{en:{value:'Inception'}},descriptions:{en:{value:'2010 science fiction film'}},
      claims:{P4947:makeClaim('27205')}},
    Q101:{labels:{en:{value:'An actor'}},claims:{}},
    Q102:{labels:{en:{value:'Inception series'}},descriptions:{en:{value:'2017 television series'}},
      claims:{P4983:makeClaim('1399')}},
    Q103:{labels:{en:{value:'Inception copy'}},claims:{P4947:makeClaim('27205')}}
   }})};
   throw Error('Unexpected Wikidata action '+action);
  },__dirname:'/app',setInterval:()=>({unref(){}})
 },{filename:'server.js'});
 const request=async q=>{
  const res={code:200,body:null,set(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
  await routes['/api/catalog/search']({query:{q},ip:'unit-test'},res);return res;
 };
 assert.equal((await request('i')).code,400);
 const result=await request('Inception');
 assert.equal(result.code,200);
 assert.equal(result.body.source,'Wikidata');
 assert.equal(result.body.results.length,2,'Only supported movie/TV metadata IDs should appear; duplicates excluded');
 assert.deepEqual(Array.from(result.body.results,x=>[x.id,x.type]),[[27205,'movie'],[1399,'tv']]);
 assert.equal(result.body.results[0].title,'Inception');
 assert.equal(result.body.results[0].year,'2010');
 assert.equal(calls.length,2,'Metadata lookup should require only a Wikidata search and details call');
 await request('Inception');
 assert.equal(calls.length,2,'Repeated title searches should use the cache');
});
test('movie discovery never asks users to know a TMDB ID',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="catalogQuery"')&&html.includes('placeholder="Search a movie or series'));
 assert.ok(html.includes('data-catalog-query="Interstellar"'));
 assert.ok(html.includes('id="catalogPlayForm" class="catalog-play-form hidden"'),'Watch options should appear only after selecting a title');
 assert.ok(html.includes('id="catalogId" type="hidden"'),'TMDB IDs must be internal');
 assert.ok(html.includes('id="catalogType" type="hidden"'));
 assert.ok(!html.includes('>TMDB ID<'),'Do not show technical movie IDs to viewers');
 assert.ok(frontend.includes("$('catalogQuery').addEventListener('input'"),'Suggestions must search while typing');
 assert.ok(frontend.includes('setTimeout(catalogSearchNow,390)'),'Search should be debounced');
 assert.ok(frontend.includes("catalogSearchController.abort()"),'Rapid typing must cancel stale requests');
 assert.ok(frontend.includes("title.textContent=item.title"),'Search result titles must remain safe text');
 assert.ok(frontend.includes("row.onclick=()=>catalogSelectTitle(item)"),'One click selects a title');
 assert.ok(frontend.includes("socket.timeout(9000).emit('catalog:play'"),'Watch button broadcasts to the room');
 assert.ok(css.includes('.catalog-result-poster')&&css.includes('.catalog-selection'));
 assert.ok(html.includes('/website-player.css?v=8')&&html.includes('/app.js?v=20'));
 assert.ok(html.includes('www.wikidata.org'),'Fallback metadata must be attributed');
});

test('the simplified room switches between movie search and YouTube',()=>{
 assert.ok(html.includes('id="tabMovies"')&&html.includes('id="tabYouTube"'));
 assert.ok(html.includes('id="movieSourcePanel"')&&html.includes('id="youtubeSourcePanel"'));
 assert.ok(html.includes('id="websiteFrame"')&&html.includes('id="websiteStop"'));
 assert.ok(!html.includes('id="websiteForm"')&&!html.includes('id="websiteSyncPanel"'));
 assert.ok(!html.includes('id="websiteCompatibility"')&&!html.includes('Try compatibility mode'));
 assert.ok(html.includes('/watch-redesign.css?v=1'));
 assert.ok(frontend.includes("setSourceTab('movies')")&&frontend.includes("setSourceTab('youtube')"));
});
test('automatic sandbox-free embed mode is restricted to server-defined catalogue sources',()=>{
 assert.ok(frontend.includes("const CATALOG_ALLOWED_PLAYERS=Object.freeze"));
 for(const host of ['vsembed.su','vidfast.vc','player.vidlove.cc'])assert.ok(frontend.includes(host));
 assert.ok(frontend.includes("return s.websiteUrl===expected"));
 assert.ok(frontend.includes("if(unrestricted)frame.removeAttribute('sandbox')"));
 assert.ok(frontend.includes("else frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX)"));
 assert.ok(frontend.includes('const trusted=verifiedCatalogPlayer(s)'));
 assert.ok(frontend.includes('loadWebsiteFrame(url,trusted)'));
 assert.ok(frontend.includes('websiteLastUnrestricted!==trusted'));
 assert.ok(frontend.includes("unloadWebsiteFrame()"));
 assert.ok(!frontend.includes("window.confirm(message)"));
});
