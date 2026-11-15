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
test('website iframe is sandboxed and explicitly labels unsynchronized viewing',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="websiteFrame"'));
 assert.ok(html.includes('sandbox="allow-scripts allow-presentation"'),'The external iframe must not get top-level navigation, forms, popups, or its own origin');
 assert.ok(!html.includes('sandbox="allow-scripts allow-same-origin'),'Untrusted sites must not receive same-origin access');
 assert.ok(html.includes('referrerpolicy="no-referrer"'));
 assert.ok(html.includes('id="openWebsite"')&&html.includes('rel="noopener noreferrer nofollow"'));
 assert.ok(html.includes('id="websiteForm"')&&html.includes('id="websiteURL"'));
 assert.ok(html.includes('/website-player.css?v=5'));
 assert.ok(html.includes('Never enter passwords in an embedded page.'));
 assert.ok(frontend.includes("socket.timeout(9000).emit('website'"),'Website URL must be shared through validated server event');
 assert.ok(frontend.includes('playback not synchronized'),'Do not falsely claim third-party playback synchronization');
 assert.ok(frontend.includes('if(websiteSelectedUrl!==target)'), 'Recurring room sync must not reload the external website');
 assert.ok(frontend.includes("if(frame.hasAttribute('src'))frame.removeAttribute('src')"),'Returning to YouTube should unload external page');
 assert.ok(frontend.includes("lastState?.source==='website'"),'Ignore YouTube player events while website mode is active');
 assert.ok(css.includes('website-mode #player'),'YouTube player must be hidden while website mode is active');
});

test('website compatibility is local, opt-in, reversible, and resets on URL changes',()=>{
 const frame={
  attrs:new Map([['sandbox','allow-scripts allow-presentation']]),
  actions:[],
  hasAttribute(name){return this.attrs.has(name)},
  getAttribute(name){return this.attrs.get(name)||null},
  removeAttribute(name){this.actions.push('remove:'+name);this.attrs.delete(name)},
  setAttribute(name,value){this.actions.push('set:'+name);this.attrs.set(name,value)}
 };
 const nodes=new Map();
 const node=id=>{
  if(id==='websiteFrame')return frame;
  if(!nodes.has(id))nodes.set(id,{
   value:'',href:'',textContent:'',
   classList:{toggle(){},add(){},remove(){}}
  });
  return nodes.get(id)
 };
 const context={URL,window:{confirm:()=>context.allow,addEventListener(){},removeEventListener(){}},$:node,allow:false,lastState:null};
 const begin=frontend.indexOf('const WEBSITE_FRAME_SANDBOX=');
 const finish=frontend.indexOf('function applyState(s){',begin);
 assert.ok(begin>0&&finish>begin,'Compatibility implementation missing');
 const source=frontend.slice(begin,finish);
 function evaluate(code){return vm.runInNewContext(source+'\n'+code,{...context})}
 // One session: simulate initial render and rejected user confirmation.
 const expected=evaluate(`
  lastState={source:'website',websiteUrl:'https://example.org/movie'};
  setWebsitePlayer(lastState);
  const initial=[$('websiteFrame').getAttribute('sandbox'),$('websiteFrame').getAttribute('src')];
  $('websiteCompatibility').onclick();
  [initial,$('websiteFrame').getAttribute('sandbox'),$('websiteFrame').getAttribute('src')]
 `);
 assert.equal(expected[0][0],'allow-scripts allow-presentation');
 assert.equal(expected[0][1],'https://example.org/movie');
 assert.equal(expected[1],'allow-scripts allow-presentation','Declined opt-in must stay sandboxed');
 assert.equal(expected[2],'https://example.org/movie');
 // A separate evaluation of the same source emulates a new viewer, with consent accepted.
 context.allow=true;
 const accepted=evaluate(`
  lastState={source:'website',websiteUrl:'https://example.org/movie'};
  setWebsitePlayer(lastState);
  $('websiteCompatibility').onclick();
  const approved=[$('websiteFrame').hasAttribute('sandbox'),$('websiteFrame').getAttribute('src')];
  const before=$('websiteFrame').actions.length;
  setWebsitePlayer(lastState);
  const repeat=$('websiteFrame').actions.length;
  $('websiteRestoreSandbox').onclick();
  const restored=[$('websiteFrame').getAttribute('sandbox'),$('websiteFrame').getAttribute('src')];
  $('websiteCompatibility').onclick();
  lastState={source:'website',websiteUrl:'https://another.example/next'};
  setWebsitePlayer(lastState);
  const switched=[$('websiteFrame').getAttribute('sandbox'),$('websiteFrame').getAttribute('src')];
  lastState={source:'youtube',video:'M7lc1UVf-VE'};
  setWebsitePlayer(lastState);
  [approved,before,repeat,restored,switched,$('websiteFrame').getAttribute('src'),$('websiteFrame').getAttribute('sandbox')]
 `);
 assert.equal(accepted[0][0],false,'Only a confirmed per-device action should remove sandbox');
 assert.equal(accepted[0][1],'https://example.org/movie');
 assert.equal(accepted[1],accepted[2],'Recurring room updates must not reload page');
 assert.equal(accepted[3][0],'allow-scripts allow-presentation','Restore protection must re-enable sandbox');
 assert.equal(accepted[3][1],'https://example.org/movie','Restoring the sandbox must reload the same site');
 assert.equal(accepted[4][0],'allow-scripts allow-presentation','A new website must revert to sandbox');
 assert.equal(accepted[4][1],'https://another.example/next');
 assert.equal(accepted[5],null,'Back to YouTube must unload external website');
 assert.equal(accepted[6],'allow-scripts allow-presentation');
 assert.ok(frontend.includes("$('websiteRestoreSandbox').onclick"),'User must be able to restore protection');
 assert.ok(html.includes('id="websiteRestoreSandbox"')&&html.includes('id="websiteCompatibility"'));
 assert.ok(html.includes('Try compatibility mode'));
 assert.ok(frontend.includes('if(!window.confirm(message))return'),'Compatibility must require user consent');
 assert.ok(!backend.includes('websiteCompatibilityFor'),'Compatibility must never persist on the room server');
});

test('website safety controls stop unsafe embeds without disconnecting the room',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="websiteStop"')&&html.includes('id="websiteResume"'));
 assert.ok(html.includes('id="websiteStopped"'));
 assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
 assert.ok(html.includes('referrerpolicy="no-referrer"'));
 assert.ok(html.includes('/website-player.css?v=5')&&html.includes('/app.js?v=16'));
 assert.ok(css.includes('.website-player-warning{z-index:4}'));
 assert.ok(backend.includes('geolocation=()')&&backend.includes('clipboard-write=(self)'));
 assert.ok(backend.includes('camera=(self), microphone=(self)'));
 assert.ok(!backend.includes('websiteStoppedFor'),'Stop and compatibility must stay local, not affect the shared room state');
 const events=new Map(),responses=[],classes=new Map();
 const frame={attrs:new Map([['sandbox','allow-scripts allow-presentation']]),actions:[],
  hasAttribute(k){return this.attrs.has(k)},
  getAttribute(k){return this.attrs.get(k)||null},
  setAttribute(k,v){this.attrs.set(k,v);this.actions.push('set:'+k)},
  removeAttribute(k){this.attrs.delete(k);this.actions.push('remove:'+k)}
 };
 const nodes=new Map();
 const element=id=>{
  if(id==='websiteFrame')return frame;
  if(!nodes.has(id)){
   const flags=new Set();
   nodes.set(id,{
    value:'',href:'',textContent:'',
    classList:{toggle:(key,on)=>on?flags.add(key):flags.delete(key),contains:k=>flags.has(k)}
   });
  }
  return nodes.get(id)
 };
 let allowed=false;
 const pageWindow={
  confirm:()=>allowed,
  addEventListener:(type,listener)=>{events.set(type,listener)},
  removeEventListener:(type,listener)=>{if(events.get(type)===listener)events.delete(type)}
 };
 const context={URL,window:pageWindow,$:element,toast:text=>responses.push(text),lastState:null};
 const begin=frontend.indexOf('const WEBSITE_FRAME_SANDBOX='),end=frontend.indexOf('function applyState(s){',begin);
 assert.ok(begin>0&&end>begin,'Safety code must exist in shared player state handler');
 const code=frontend.slice(begin,end);
 vm.runInNewContext(code+`
   lastState={source:'website',websiteUrl:'https://video.example/movie'};
   setWebsitePlayer(lastState);
 `,{...context});
 assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-presentation');
 assert.equal(frame.getAttribute('src'),'https://video.example/movie');
 assert.equal(events.has('beforeunload'),false,'Protected preview should not warn on normal navigation');
 // Each evaluation uses a fresh context. This one exercises an uninterrupted
 // real viewer session from open through opt-in, stop, and resume.
 allowed=true;frame.attrs.clear();frame.attrs.set('sandbox','allow-scripts allow-presentation');
 events.clear();nodes.clear();frame.actions=[];
 const notes=[];
 vm.runInNewContext(code+`
  lastState={source:'website',websiteUrl:'https://video.example/movie'};
  setWebsitePlayer(lastState);
  $('websiteCompatibility').onclick();
  note('compat',[$('websiteFrame').hasAttribute('sandbox'),hasGuard()]);
  let prevented=false,ev={preventDefault:()=>prevented=true,returnValue:null};
  onGuard(ev);
  note('warning',[prevented,ev.returnValue]);
  let before=$('websiteFrame').actions.length;
  setWebsitePlayer(lastState);
  note('sync',[$('websiteFrame').actions.length===before]);
  $('websiteStop').onclick();
  note('stopped',[
   $('websiteFrame').getAttribute('src'),
   $('websiteFrame').getAttribute('sandbox'),
   hasGuard(),
   $('websiteStopped').classList.contains('hidden'),
   $('websiteResume').classList.contains('hidden')
  ]);
  before=$('websiteFrame').actions.length;
  setWebsitePlayer(lastState);
  note('staysStopped',[$('websiteFrame').actions.length===before]);
  $('websiteResume').onclick();
  note('resumed',[$('websiteFrame').getAttribute('src'),$('websiteFrame').getAttribute('sandbox'),hasGuard()]);
  $('websiteCompatibility').onclick();
  lastState={source:'website',websiteUrl:'https://different.example/new'};
  setWebsitePlayer(lastState);
  note('newSite',[$('websiteFrame').getAttribute('sandbox'),hasGuard(),$('websiteFrame').getAttribute('src')]);
  $('websiteStop').onclick();
  lastState={source:'youtube'};
  setWebsitePlayer(lastState);
  note('youtube',[$('websiteFrame').getAttribute('src'),hasGuard()]);
 `,{...context,
    note:(key,value)=>notes.push([key,value]),
    hasGuard:()=>events.has('beforeunload'),
    onGuard:e=>events.get('beforeunload')?.(e)
 });
 const results=Object.fromEntries(notes.map(([key,value])=>[key,Array.from(value)]));
 assert.deepEqual(results.compat,[false,true],'Compatibility opt-in should remove sandbox and register exit guard');
 assert.deepEqual(results.warning,[true,true],'The exit guard should request a native browser leave confirmation');
 assert.deepEqual(results.sync,[true],'Repeated room state must not reload an active movie');
 assert.deepEqual(results.stopped,[null,'allow-scripts allow-presentation',false,false,false],'Emergency stop must unload and restore sandbox');
 assert.deepEqual(results.staysStopped,[true],'Normal sync must not restart a stopped website');
 assert.deepEqual(results.resumed,['https://video.example/movie','allow-scripts allow-presentation',false],'Resume must return to safe mode');
 assert.deepEqual(results.newSite,['allow-scripts allow-presentation',false,'https://different.example/new']);
 assert.deepEqual(results.youtube,[null,false],'YouTube must remove the external website and guard');
 assert.ok(responses.some(v=>v.includes('External website stopped')),'Stop should acknowledge the action');
 assert.ok(frontend.includes("setWebsiteExitGuard(false);leaveCall();location.href='/'"),'Deliberately leaving Togetherly should bypass unexpected-navigation warning');
});

test('optional FlexFlix suggestion only prefills the URL, with explicit sharing and third-party warning',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="suggestFlexflix"'),'Suggestion button must exist');
 assert.ok(html.includes('https://flexflix.site/'),'Show the exact website the user supplied');
 assert.ok(html.includes('Unverified third-party site'),'Do not imply endorsement or verified licensing');
 assert.ok(html.includes('not affiliated'),'Disclose that Togetherly is not affiliated');
 assert.ok(css.includes('.website-suggestion-button'),'The suggested link needs a visible control');
 const script=frontend.match(/\$\('suggestFlexflix'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/)?.[0];
 assert.ok(script,'Suggestion handler missing');
 let focused=false,loaded=false,feedback='';
 const field={value:'',focus(){focused=true}};
 const suggestion={onclick:null};
 const elems={suggestFlexflix:suggestion,websiteURL:field};
 vm.runInNewContext(script,{
  $:id=>elems[id],
  notice:message=>{feedback=message},
  socket:{emit(){loaded=true}}
 });
 suggestion.onclick();
 assert.equal(field.value,'https://flexflix.site/');
 assert.equal(focused,true);
 assert.equal(loaded,false,'Clicking suggestion must never broadcast or load a website');
 assert.match(feedback,/choose Show website/i);
 assert.ok(frontend.includes("socket.timeout(9000).emit('website'"),'User still must submit the normal shared URL form');
 assert.ok(html.includes('/website-player.css?v=5')&&html.includes('/app.js?v=16'));
});

test('FlexFlix uses default compatibility only on its exact HTTPS host while keeping safety controls',()=>{
 const frame={attrs:new Map([['sandbox','allow-scripts allow-presentation']]),actions:[],
  getAttribute(k){return this.attrs.get(k)||null},hasAttribute(k){return this.attrs.has(k)},
  setAttribute(k,v){this.attrs.set(k,v);this.actions.push('set:'+k)},
  removeAttribute(k){this.attrs.delete(k);this.actions.push('remove:'+k)}
 };
 const listeners=new Map(),elements=new Map();
 const element=id=>{
  if(id==='websiteFrame')return frame;
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{href:'',value:'',textContent:'',onclick:null,
    classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)}});
  }
  return elements.get(id)
 };
 const context={URL,$:element,lastState:null,toast(){},window:{
  confirm:()=>true,
  addEventListener:(name,fn)=>listeners.set(name,fn),
  removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}
 }};
 const begin=frontend.indexOf('const WEBSITE_FRAME_SANDBOX='),end=frontend.indexOf('function applyState(s){',begin);
 assert.ok(begin>=0&&end>begin);
 const js=frontend.slice(begin,end);
 const result=vm.runInNewContext(js+`
  const hosts=[
   'https://flexflix.site/',
   'https://www.flexflix.site/movie',
   'https://FLEXFLIX.SITE/movie',
   'https://flexflix.site.evil.com/movie',
   'https://evilflexflix.site/movie',
   'https://sub.flexflix.site/movie',
   'https://another.example/movie',
   'http://flexflix.site/movie',
   'https://flexflix.site:8443/movie',
   'https://someone:secret@flexflix.site/movie'
  ].map(websiteDefaultsToCompatibility);
  lastState={source:'website',websiteUrl:'https://flexflix.site/watch/movie'};
  setWebsitePlayer(lastState);
  const initial=[frame.getAttribute('sandbox'),frame.getAttribute('src'),listeners.has('beforeunload')];
  const before=frame.actions.length;
  setWebsitePlayer(lastState);
  const unchanged=frame.actions.length===before;
  $('websiteRestoreSandbox').onclick();
  const restored=[frame.getAttribute('sandbox'),listeners.has('beforeunload')];
  setWebsitePlayer(lastState);
  const stayedProtected=frame.hasAttribute('sandbox');
  $('websiteStop').onclick();
  const stopped=[frame.hasAttribute('src'),frame.getAttribute('sandbox'),listeners.has('beforeunload')];
  $('websiteResume').onclick();
  const resumed=[frame.hasAttribute('sandbox'),listeners.has('beforeunload')];
  lastState={source:'website',websiteUrl:'https://example.org/film'};
  setWebsitePlayer(lastState);
  const other=[frame.hasAttribute('sandbox'),listeners.has('beforeunload')];
  lastState={source:'youtube'};
  setWebsitePlayer(lastState);
  [hosts,initial,unchanged,restored,stayedProtected,stopped,resumed,other,frame.hasAttribute('src')]
 `,{...context,frame,listeners});
 const normalize=x=>JSON.parse(JSON.stringify(x));
 assert.deepEqual(normalize(result[0]),[true,true,true,false,false,false,false,false,false,false],'Default must be exact-host only');
 assert.deepEqual(normalize(result[1]),[null,'https://flexflix.site/watch/movie',true],'FlexFlix should begin without iframe sandbox');
 assert.equal(result[2],true,'Room sync should not reload movie');
 assert.deepEqual(normalize(result[3]),['allow-scripts allow-presentation',false],'Users can restore protection');
 assert.equal(result[4],true,'Restored protection must persist for the same URL');
 assert.deepEqual(normalize(result[5]),[false,'allow-scripts allow-presentation',false],'Stop must unload external content');
 assert.deepEqual(normalize(result[6]),[true,false],'Reopen protected must remain sandboxed');
 assert.deepEqual(normalize(result[7]),[true,false],'Unrelated websites must default to sandboxed');
 assert.equal(result[8],false,'Switching to YouTube must unload external iframe');
 assert.ok(html.includes('id="websiteStop"')&&html.includes('id="websiteRestoreSandbox"'),'Safety and restore controls must remain');
});
test('website fullscreen can expand Togetherly stage with cameras and permit nested player fullscreen',()=>{
 const css=fs.readFileSync(path.join(root,'public/website-player.css'),'utf8');
 assert.ok(html.includes('id="websiteFrame"')&&html.includes('allow="autoplay; fullscreen *" allowfullscreen'),'The external iframe must permit native fullscreen and nested frames');
 assert.ok(html.includes('id="websiteFullscreen"')&&html.includes('Fullscreen + cameras'));
 assert.ok(frontend.includes("$('websiteFullscreen').onclick=toggleTheater"),'Web fullscreen should use the Togetherly stage and cameras');
 assert.ok(frontend.includes("$('websiteFullscreen').textContent=active?'Exit Togetherly fullscreen':'Fullscreen + cameras'"));
 assert.ok(frontend.includes("$('websiteFullscreen').setAttribute('aria-pressed',String(active))"));
 assert.ok(frontend.includes("if(chatOpen)toggleChat(false)"),'Keep chat outside Togetherly fullscreen');
 assert.ok(frontend.includes("theaterShell.requestFullscreen"),'Use existing browser fullscreen implementation');
 assert.ok(css.includes('top:max(12px,env(safe-area-inset-top))!important'),'Fullscreen website controls should avoid the bottom player controls');
 assert.ok(css.includes('#videoShell.website-mode #websiteFullscreen'),'Button should be visibly styled');
 assert.ok(html.includes('may show ads or popups'),'Describe the added risks of default compatibility');
});
