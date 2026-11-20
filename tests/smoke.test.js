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
test('mobile fullscreen keeps accessible Exit and final layout moves it out of the video center',()=>{
 const compact=fs.readFileSync(path.join(root,'public/compact-mobile-dock.css'),'utf8');
 const noChat=fs.readFileSync(path.join(root,'public/no-fullscreen-chat.css'),'utf8');
 assert.ok(html.includes('/compact-mobile-dock.css?v=1'));
 assert.ok(html.includes('/no-fullscreen-chat.css?v=1'));
 assert.ok(html.includes('id="theaterLabel"'));
 assert.ok(html.includes('aria-label="Exit fullscreen"'));
 assert.ok(compact.includes('(pointer:coarse) and (max-width:1100px)'));
 assert.ok(noChat.includes('width:50px!important'),'Single button rail should be narrow');
 assert.ok(noChat.includes('height:44px!important'),'Exit button must remain tap-friendly');
 const latest=fs.readFileSync(path.join(root,'public/watch-redesign.css'),'utf8');
 assert.ok(latest.includes('left:max(12px,env(safe-area-inset-left))!important'),'Latest layout positions Exit on the upper left');
 assert.ok(latest.includes('bottom:auto!important'),'Exit button cannot obscure the bottom-center movie');
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

test('legacy arbitrary website sharing is disabled',async()=>{
 let connect;
 class FakeIO{on(event,fn){if(event==='connection')connect=fn}to(){return{emit(){}}}}
 const exp=()=>({disable(){},use(){},get(){}});exp.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?exp:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'c'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{require:fakeRequire,URL:require('node:url').URL,
  process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})},{filename:'server.js'});
 const handlers={},sock={id:'owner',data:{},on:(event,fn)=>handlers[event]=fn,
  join(){},leave(){},to:()=>({emit(){}}),emit(){}};
 connect(sock);
 const reply=await new Promise(resolve=>handlers.website({url:'https://untrusted.example/movie'},resolve));
 assert.match(reply.error,/disabled for safety/i);
 const created=await new Promise(resolve=>handlers.create({name:'Host'},resolve));
 assert.equal(created.state.source,'youtube');
 const blocked=await new Promise(resolve=>handlers.website({url:'https://vsembed.su/embed/movie/550'},resolve));
 assert.match(blocked.error,/disabled for safety/i);
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
 assert.match((await host.ask('catalog:play',{provider:'vidfast',type:'movie',id:550})).error,/Join a room/);
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
 const movie=await host.ask('catalog:play',{provider:'vidfast',type:'movie',id:550,title:'Fight Club'});
 assert.equal(movie.url,'https://vidfast.vc/movie/550');
 assert.equal(sent.filter(x=>x.event==='state').at(-1).data.catalog.title,'Fight Club');
 guest.fire('sync');
 assert.equal(sent.filter(x=>x.id==='guest'&&x.event==='state').at(-1).data.catalog.provider,'vidfast');
 const tv=await guest.ask('catalog:play',{provider:'vidfast',type:'tv',id:1399,season:2,episode:3,title:'Series'});
 assert.equal(tv.url,'https://vidfast.vc/tv/1399/2/3');
 const state=sent.filter(x=>x.event==='state').at(-1).data;
 assert.equal(state.catalog.type,'tv');assert.equal(state.catalog.season,2);assert.equal(state.catalog.episode,3);
 assert.match((await host.ask('catalog:play',{provider:'vidlove',type:'movie',id:550})).error,/supported provider/i);
 assert.match((await host.ask('website',{url:'https://example.org/'})).error,/disabled for safety/i);
 assert.equal(sent.filter(x=>x.event==='state').at(-1).data.catalog.type,'tv');
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
 assert.ok(html.includes('/app.js?v=25')&&html.includes('/website-player.css?v=8'));
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
 assert.ok(html.includes('id="catalogQuery"')&&html.includes('placeholder="Search films &amp; series'));
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
 assert.ok(html.includes('/website-player.css?v=8')&&html.includes('/app.js?v=25'));
 assert.ok(html.includes('www.wikidata.org'),'Fallback metadata must be attributed');
});

test('the simplified room switches between movie search and YouTube',()=>{
 assert.ok(html.includes('id="tabMovies"')&&html.includes('id="tabYouTube"'));
 assert.ok(html.includes('id="movieSourcePanel"')&&html.includes('id="youtubeSourcePanel"'));
 assert.ok(html.includes('id="websiteFrame"')&&html.includes('id="websiteStop"'));
 assert.ok(!html.includes('website-player-warning'),'The old video overlay band must be absent');
 assert.ok(html.includes('class="toolbar-actions"'),'Player exit action stays outside the video');
 assert.ok(!html.includes('id="websiteForm"')&&!html.includes('id="websiteSyncPanel"'));
 assert.ok(!html.includes('id="websiteCompatibility"')&&!html.includes('Try compatibility mode'));
 assert.ok(html.includes('/watch-redesign.css?v=4'));
 assert.ok(frontend.includes("setSourceTab('movies')")&&frontend.includes("setSourceTab('youtube')"));
});
test('movie embeds are restricted to the remaining exact-match source and no overlay',()=>{
 assert.ok(frontend.includes("const CATALOG_ALLOWED_PLAYERS=Object.freeze"));
 assert.ok(frontend.includes('vidfast.vc'));
 for(const host of ['vsembed.su','player.vidlove.cc']){
  assert.ok(!frontend.includes(host),'Flagged host still allowed in frontend: '+host);
  assert.ok(!backend.includes(host),'Flagged host still allowed in backend: '+host);
 }
 assert.ok(html.includes('id="catalogProvider" type="hidden" value="vidfast"'));
 assert.ok(frontend.includes("return s.websiteUrl===expected"));
 assert.ok(frontend.includes("const WEBSITE_FRAME_SANDBOX='allow-scripts allow-same-origin allow-forms'"));
 assert.ok(frontend.includes("frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX)"));
 assert.ok(!frontend.includes("frame.removeAttribute('sandbox')"),'Movie iframe must stay sandboxed');
 assert.ok(!frontend.includes('websiteLastUnrestricted'),'No implicit compatibility exception');
 assert.ok(frontend.includes('loadWebsiteFrame(movieEmbedUrl(url,s.movieTimeline))'));
 assert.ok(frontend.includes("unloadWebsiteFrame()"));
 assert.ok(!frontend.includes("window.confirm(message)"));
});

test('unverified sources are not called safe and no antivirus bypass is attempted',()=>{
 assert.ok(html.includes('Unverified player. Never bypass an antivirus warning.'));
 assert.ok(!html.includes('option value="vidsrc"')&&!html.includes('option value="vidlove"'));
 assert.ok(!html.includes('id="openWebsite"'));
 assert.ok(!frontend.includes("window.confirm(message)"));
 assert.ok(!backend.includes('https://vsembed.su')&&!backend.includes('player.vidlove.cc'));
});


test('TV metadata endpoint and all movie/season/episode combinations are validated before room sharing',async()=>{
 const routes={},events=[],fetched=[];
 let connect;
 class FakeIO{
  on(n,fn){if(n==='connection')connect=fn}
  to(id){return{emit:(event,data)=>events.push({id,event,data})}}
 }
 const app=()=>({disable(){},use(){},get:(route,fn)=>routes[route]=fn});
 app.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?app:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'e'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 const context={
  require:fakeRequire,URL:require('node:url').URL,
  AbortSignal:{timeout:()=>({})},
  process:{env:{PORT:'3000',TMDB_API_READ_TOKEN:'private-test-token'}},
  __dirname:'/app',console,setInterval:()=>({unref(){}}),
  fetch:async(url,options)=>{
   const u=new URL(String(url));fetched.push({url:u,auth:options.headers.Authorization});
   assert.equal(u.origin,'https://api.themoviedb.org');
   assert.equal(u.pathname,'/3/tv/1399');
   assert.equal(u.searchParams.has('api_key'),false,'Credentials must not be copied to URLs');
   assert.equal(options.headers.Authorization,'Bearer private-test-token');
   return{ok:true,json:async()=>({seasons:[
    {season_number:0,episode_count:11},
    {season_number:1,episode_count:7},
    {season_number:2,episode_count:13},
    {season_number:5,episode_count:16},
    {season_number:99,episode_count:0}
   ]})};
  }
 };
 vm.runInNewContext(backend,context,{filename:'server.js'});
 const response=()=>({code:200,body:null,set(){return this},status(n){this.code=n;return this},
  json(body){this.body=body;return this}});
 const api=async(id,ip='test-ip')=>{
  const r=response();
  await routes['/api/catalog/tv/:id/seasons']({params:{id},ip},r);return r;
 };
 for(const id of ['0','-1','bad','1399oops','01399'])assert.equal((await api(id)).code,400);
 const details=await api('1399');
 assert.equal(details.code,200);
 assert.deepEqual(Array.from(details.body.seasons,x=>[x.season,x.episodes]),[[1,7],[2,13],[5,16]]);
 assert.equal(JSON.stringify(details.body).includes('private-test-token'),false);
 assert.equal((await api('1399')).code,200);
 assert.equal(fetched.length,1,'Series details should be cached');

 const client=id=>{
  const handlers={},sock={id,data:{},on:(n,fn)=>handlers[n]=fn,join(){},leave(){},
   emit:(event,data)=>events.push({id,event,data}),
   to:()=>({emit:(event,data)=>events.push({id:'other',event,data})})};
  connect(sock);
  return{ask:(name,data)=>new Promise(resolve=>handlers[name](data,resolve)),
   fire:name=>handlers[name]()};
 };
 const host=client('host'),guest=client('guest');
 assert.match((await host.ask('catalog:play',{provider:'vidfast',type:'movie',id:1})).error,/Join a room/);
 const created=await host.ask('create',{name:'Host'});
 await guest.ask('join',{id:created.id,name:'Guest'});
 for(const id of [1,2,550,603,999999999]){
  const a=await host.ask('catalog:play',{provider:'vidfast',type:'movie',id,title:'Movie '+id});
  assert.equal(a.url,'https://vidfast.vc/movie/'+id);
 }
 for(const id of [0,-1,1.5,1000000000,null,'not-a-number']){
  const a=await host.ask('catalog:play',{provider:'vidfast',type:'movie',id});
  assert.match(a.error,/valid TMDB/);
 }
 for(const [season,episode] of [[1,1],[1,7],[2,1],[2,13],[5,16]]){
  const a=await host.ask('catalog:play',{provider:'vidfast',type:'tv',id:1399,season,episode,title:'Series'});
  assert.equal(a.url,'https://vidfast.vc/tv/1399/'+season+'/'+episode);
  guest.fire('sync');
  const last=events.filter(x=>x.id==='guest'&&x.event==='state').at(-1).data;
  assert.equal(last.catalog.season,season);
  assert.equal(last.catalog.episode,episode);
 }
 for(const [season,episode] of [[1,8],[2,14],[5,17],[3,1],[99,999],[0,1],[1,0],[-1,1],[100,1]]){
  const a=await host.ask('catalog:play',{provider:'vidfast',type:'tv',id:1399,season,episode});
  assert.match(a.error,/(does not exist|valid TMDB)/);
 }
 for(const p of ['vidsrc','vidlove','unknown','__proto__']){
  assert.match((await host.ask('catalog:play',{provider:p,type:'movie',id:550})).error,/supported provider/);
 }
 assert.equal(fetched.length,1,'Room changes and episode checks should reuse TV metadata');
 const youtube=await guest.ask('video',{url:'https://youtu.be/M7lc1UVf-VE'});
 assert.equal(youtube.ok,true);
 guest.fire('sync');
 assert.equal(events.filter(x=>x.id==='guest'&&x.event==='state').at(-1).data.catalog,null);
 assert.match((await guest.ask('website',{url:'https://example.org/'})).error,/disabled for safety/);
});

test('movie-selection UI handles TV bounds, movie switch, changing title and stale replies',async()=>{
 const begin=frontend.indexOf('let catalogChoice='),end=frontend.indexOf('let ytScriptStarted=false',begin);
 assert.ok(begin>0&&end>begin,'Movie picker module should be isolatable');
 const source=frontend.slice(begin,end);
 const nodes=new Map(),callbacks=new Map(),shared=[],notices=[];
 const makeNode=()=>{
  const flags=new Set(['hidden']),listeners={};
  return{
   value:'',textContent:'',disabled:false,dataset:{},
   classList:{add:k=>flags.add(k),remove:k=>flags.delete(k),
    contains:k=>flags.has(k),toggle:(k,on)=>on?flags.add(k):flags.delete(k)},
   addEventListener:(k,fn)=>listeners[k]=fn,
   emitInput:k=>listeners[k]?.(),
   setAttribute(){},removeAttribute(){},focus(){},blur(){},scrollIntoView(){},
   get listeners(){return listeners}
  };
 };
 const $=id=>{if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id)};
 $('catalogProvider').value='vidfast';
 const tvFields=[makeNode(),makeNode()];
 let resolveSeasons;
 const context={
  $,document:{querySelectorAll:selector=>selector.includes('.catalog-tv-only')?tvFields:[]},
  room:'room1',toast:msg=>notices.push(msg),encodeURIComponent,
  Number,AbortController,clearTimeout,setTimeout,
  mobileIsCompact:()=>false,mobileClosePanels:()=>{},
  socket:{timeout:()=>({emit:(name,details,cb)=>{
   shared.push({name,details});callbacks.set(shared.length,cb);
  }})},
  fetch:()=>new Promise(resolve=>{resolveSeasons=resolve})
 };
 vm.runInNewContext(source+'\nthis.testSelect=catalogSelectTitle;this.testClear=catalogClearSelection;',context);
 context.testSelect({id:1399,type:'tv',title:'Breaking Bad',year:'2008'});
 assert.equal($('movieCatalog').classList.contains('is-title-selected'),true,'Selected title uses detail step');
 assert.equal($('catalogSelectedTitle').textContent,'Breaking Bad');
 assert.equal($('catalogType').value,'tv');
 assert.equal($('catalogPlay').disabled,true,'TV actions must wait for metadata');
 resolveSeasons({ok:true,json:async()=>({seasons:[{season:1,episodes:7},{season:2,episodes:13}]})});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal($('catalogPlay').disabled,false);
 $('catalogEpisode').value='8';
 $('catalogEpisode').emitInput('input');
 assert.equal($('catalogPlay').disabled,true,'Nonexistent episodes must be disabled');
 $('catalogPlayForm').onsubmit({preventDefault(){}});
 assert.equal(shared.length,0,'Invalid episode must not be sent');
 $('catalogEpisode').value='7';
 $('catalogEpisode').emitInput('input');
 $('catalogPlayForm').onsubmit({preventDefault(){}});
 assert.equal(shared.length,1);
 assert.equal(shared[0].details.type,'tv');
 assert.equal(shared[0].details.season,1);
 assert.equal(shared[0].details.episode,7);
 const previousCallback=callbacks.get(1);
 // A user can select a new movie before the previous share response arrives.
 context.testSelect({id:603,type:'movie',title:'The Matrix',year:'1999'});
 assert.equal($('catalogType').value,'movie');
 assert.equal($('catalogSeason').value,'1');
 assert.equal($('catalogEpisode').value,'1');
 assert.equal($('catalogEpisodeHelp').classList.contains('hidden'),true);
 const before=$('catalogStatus').textContent;
 previousCallback(null,{ok:true});
 assert.equal($('catalogStatus').textContent,before,'Old ACK must not overwrite new selection');
 $('catalogPlayForm').onsubmit({preventDefault(){}});
 assert.equal(shared.length,2);
 assert.equal(shared[1].details.type,'movie');
 assert.equal(shared[1].details.id,603);
 assert.equal(shared[1].details.provider,'vidfast');
 callbacks.get(2)(null,{ok:true});
 assert.match($('catalogStatus').textContent,/Shared with room/);
 $('catalogChangeTitle').onclick();
 assert.equal($('movieCatalog').classList.contains('is-title-selected'),false,'Back restores search results');
 assert.equal($('catalogPlayForm').classList.contains('hidden'),true);
 assert.equal($('catalogId').value,'');
});

test('the new movie form spans the available width and distinguishes room playback from selected titles',()=>{
 const css=fs.readFileSync(path.join(root,'public/watch-redesign.css'),'utf8');
 assert.ok(css.includes('#watch .catalog-play-form{')&&css.includes('align-items:stretch'));
 assert.ok(css.includes('#watch .catalog-play-options{')&&css.includes('width:100%'));
 assert.ok(css.includes('#watch .catalog-now-playing{'));
 assert.ok(html.includes('id="catalogNowPlaying" class="catalog-now-playing hidden"'));
 assert.ok(html.includes('id="catalogEpisodeHelp"'));
 assert.ok(frontend.includes('Currently shared in this room: '));
 assert.ok(frontend.includes(' — not shared yet.'));
 assert.ok(backend.includes("app.get('/api/catalog/tv/:id/seasons'"));
 assert.ok(backend.includes('await catalogTvSeasons(choice.id)'));
});


test('slow TV metadata cannot override a newer room choice; simultaneous lookups are deduplicated',async()=>{
 let connect,resolveDetails,callCount=0;
 const outbound=[];
 class FakeIO{on(event,fn){if(event==='connection')connect=fn}
  to(room){return{emit:(event,data)=>outbound.push({room,event,data})}}}
 const exp=()=>({disable(){},use(){},get(){}});exp.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?exp:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'a'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{
  require:fakeRequire,URL:require('node:url').URL,
  AbortSignal:{timeout:()=>({})},process:{env:{PORT:'3000',TMDB_API_READ_TOKEN:'hidden-token'}},
  console,__dirname:'/app',setInterval:()=>({unref(){}}),
  fetch:async()=>{
   callCount++;
   return new Promise(resolve=>{resolveDetails=()=>resolve({
    ok:true,json:async()=>({seasons:[{season_number:1,episode_count:7}]})
   })});
  }
 },{filename:'server.js'});
 const client=id=>{
  const handlers={},sock={id,data:{},join(){},leave(){},
   on:(event,fn)=>handlers[event]=fn,
   to:()=>({emit:(event,data)=>outbound.push({room:'other',event,data})}),
   emit:(event,data)=>outbound.push({room:id,event,data})};
  connect(sock);
  return{ask:(event,data)=>new Promise(resolve=>handlers[event](data,resolve)),
   fire:event=>handlers[event]()};
 };
 const host=client('host'),guest=client('guest');
 const room=await host.ask('create',{name:'Host'});
 await guest.ask('join',{id:room.id,name:'Guest'});
 const first=host.ask('catalog:play',{type:'tv',id:1399,provider:'vidfast',season:1,episode:1});
 const second=guest.ask('catalog:play',{type:'tv',id:1399,provider:'vidfast',season:1,episode:2});
 assert.equal(callCount,1,'Concurrent requests must share one TMDB lookup');
 const movie=await guest.ask('catalog:play',{type:'movie',id:603,provider:'vidfast'});
 assert.equal(movie.url,'https://vidfast.vc/movie/603');
 resolveDetails();
 assert.match((await first).error,/changed the room playback/);
 assert.match((await second).error,/changed the room playback/);
 guest.fire('sync');
 const state=outbound.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(state.catalog.type,'movie');
 assert.equal(state.catalog.id,603);
 assert.equal(callCount,1);
});


test('movie room clock: late joins, pauses, seeking, host-only control, switching and host transfer',async()=>{
 let connect,now=1_900_000_000_000;const sent=[];
 class Clock extends Date{static now(){return now}}
 class FakeIO{on(name,fn){if(name==='connection')connect=fn}to(room){return{emit:(event,data)=>sent.push({room,event,data})}}}
 const exp=()=>({disable(){},use(){},get(){}});exp.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?exp:id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:id==='crypto'?{randomBytes:n=>({toString:()=> 'f'.repeat(n*2)})}:
  id==='path'?{join:(...p)=>p.join('/')}:require(id);
 vm.runInNewContext(backend,{
  Date:Clock,require:fakeRequire,URL:require('node:url').URL,
  process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})
 },{filename:'server.js'});
 const client=id=>{
  const handlers={},sock={id,data:{},on:(e,fn)=>handlers[e]=fn,join(){},leave(){},
   to:()=>({emit:(event,data)=>sent.push({room:'others',event,data})}),
   emit:(event,data)=>sent.push({room:id,event,data})};
  connect(sock);
  return{
   ask:(e,data)=>new Promise(resolve=>handlers[e](data,resolve)),
   fire:(e,data)=>handlers[e](data)
  };
 };
 const host=client('host'),guest=client('guest');
 const created=await host.ask('create',{name:'Host'});const id=created.id;
 assert.equal(created.state.movieTimeline,null);
 assert.match((await guest.ask('movie:control',{action:'play',position:0,version:0})).error,/No movie/);
 const join=await guest.ask('join',{id,name:'Guest'});
 assert.equal(join.state.websiteLeader,'host');
 const movie=await host.ask('catalog:play',{provider:'vidfast',type:'movie',id:603,title:'The Matrix'});
 assert.equal(movie.ok,true);
 assert.equal(movie.url,'https://vidfast.vc/movie/603');
 now+=75_000;
 guest.fire('sync');
 let roomState=sent.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(roomState.catalog.title,'The Matrix');
 assert.equal(roomState.movieTimeline.position,75);
 assert.equal(roomState.movieTimeline.playing,true);
 assert.equal(roomState.movieTimeline.origin,'estimated');
 let reply=await guest.ask('movie:control',{version:roomState.version,action:'pause',position:75});
 assert.match(reply.error,/Only the room host/);
 const version=roomState.version;
 reply=await host.ask('movie:control',{version,action:'pause',position:75});
 assert.equal(reply.ok,true);
 now+=28_000;
 guest.fire('sync');roomState=sent.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(roomState.movieTimeline.position,75,'Paused room clock must not advance');
 assert.equal(roomState.movieTimeline.playing,false);
 reply=await host.ask('movie:control',{version,action:'seek',position:125});
 assert.equal(reply.ok,true);
 guest.fire('sync');roomState=sent.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(roomState.movieTimeline.position,125);
 assert.equal(roomState.movieTimeline.playing,false);
 reply=await host.ask('movie:control',{version,action:'play',position:125});
 assert.equal(reply.ok,true);
 now+=35_500;
 guest.fire('sync');roomState=sent.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(roomState.movieTimeline.position,160.5);
 assert.equal(roomState.movieTimeline.playing,true);
 assert.match((await host.ask('movie:control',{version,action:'seek',position:-1})).error,/Invalid movie/);
 assert.match((await host.ask('movie:control',{version,action:'seek',position:86401})).error,/Invalid movie/);
 assert.match((await host.ask('movie:control',{version:version-1,action:'pause',position:120})).error,/Invalid movie/);
 assert.match((await host.ask('movie:control',{version,action:'sample',position:170})).error,/Invalid player sample/);
 reply=await host.ask('movie:control',{version,action:'sample',position:171,playing:true});
 assert.equal(reply.ok,true);assert.equal(reply.timeline.origin,'player');
 reply=await host.ask('movie:control',{version,action:'sample',position:172,playing:true});
 assert.match(reply.error,/too frequent/i);
 now+=1500;
 reply=await host.ask('movie:control',{version,action:'sample',position:175,playing:false});
 assert.equal(reply.ok,true);assert.equal(reply.timeline.playing,false);
 guest.fire('sync');roomState=sent.filter(x=>x.room==='guest'&&x.event==='state').at(-1).data;
 assert.equal(roomState.movieTimeline.position,175);
 assert.equal(roomState.movieTimeline.origin,'player');
 host.fire('disconnect');
 const newState=sent.filter(x=>x.event==='state').at(-1).data;
 assert.equal(newState.websiteLeader,'guest');
 reply=await guest.ask('movie:control',{version,action:'play',position:175});
 assert.equal(reply.ok,true,'Control should transfer to the remaining member');
 now+=10_000;
 const late=client('late');const lateJoin=await late.ask('join',{id,name:'Late viewer'});
 assert.equal(lateJoin.state.movieTimeline.position,185);
 assert.equal(lateJoin.state.websiteUrl,'https://vidfast.vc/movie/603');
 assert.equal(lateJoin.state.movieTimeline.playing,true);
 reply=await guest.ask('video',{url:'https://youtu.be/M7lc1UVf-VE'});
 assert.equal(reply.ok,true);
 late.fire('sync');
 const youtube=sent.filter(x=>x.room==='late'&&x.event==='state').at(-1).data;
 assert.equal(youtube.movieTimeline,null);
 assert.equal(youtube.catalog,null);
 assert.equal(youtube.source,'youtube');
 assert.match((await guest.ask('movie:control',{version,action:'play',position:185})).error,/No movie/);
});

test('movie time formatting and VidFast join URL preserve exact canonical source',()=>{
 const start=frontend.indexOf('function movieClockNow(){');
 const end=frontend.indexOf('function movieUpdateSnapshot(',start);
 assert.ok(start>0&&end>start,'Room movie time functions missing');
 const startUrl=frontend.indexOf('function movieEmbedUrl(base,timeline){');
 const endUrl=frontend.indexOf('function movieSendControl(',startUrl);
 assert.ok(startUrl>0&&endUrl>startUrl,'Late join embed URL helper missing');
 const context={movieSnapshot:{position:125.5,playing:true},movieSnapshotAt:1000,
  Date:class extends Date{static now(){return 31500}},URL};
 vm.runInNewContext(frontend.slice(start,end)+frontend.slice(startUrl,endUrl)+
  '\nthis.testMovieClock=movieClockNow;this.testFormat=moviePositionText;this.testParse=movieParseTime;this.testUrl=movieEmbedUrl;',context);
 assert.equal(context.testMovieClock(),156);
 assert.equal(context.testFormat(1955),'32:35');
 assert.equal(context.testFormat(3661),'1:01:01');
 assert.equal(context.testParse('12:34'),754);
 assert.equal(context.testParse('1:02:15'),3735);
 for(const bad of ['','12','1:60','1:01:60','1:2:3:4','-1:22','999:00'])
  assert.equal(context.testParse(bad),null,'Invalid movie time should fail: '+bad);
 const url=context.testUrl('https://vidfast.vc/movie/603',{position:1955.6,playing:true});
 assert.equal(url,'https://vidfast.vc/movie/603?startAt=1955&autoPlay=true');
 assert.equal(context.testUrl('https://vidfast.vc/tv/1399/1/2',{position:0,playing:false}),
  'https://vidfast.vc/tv/1399/1/2');
 assert.ok(frontend.includes('websiteSelectedVersion!==s.version'),
  'New movie selection must reload even when sharing the same URL');
 assert.ok(frontend.includes('loadWebsiteFrame(movieEmbedUrl(url,s.movieTimeline),trusted)'));
 assert.ok(frontend.includes('movieCatchupNow()'));
});

test('movie postMessage handling validates exact origin, iframe identity, movie and timestamp',()=>{
 assert.ok(frontend.includes("const MOVIE_PLAYER_ORIGIN='https://vidfast.vc'"));
 assert.ok(frontend.includes('event.origin!==MOVIE_PLAYER_ORIGIN'));
 assert.ok(frontend.includes("event.source!==$('websiteFrame').contentWindow"));
 assert.ok(frontend.includes("data.type!=='PLAYER_EVENT'"));
 assert.ok(frontend.includes("Number(info.tmdbId)!==Number(lastState.catalog.id)"));
 assert.ok(frontend.includes('!Number.isFinite(position)||position<0||position>86400'));
 assert.ok(frontend.includes("socket.on('movie:timeline'"));
 assert.ok(frontend.includes('movieLastCorrectionAt>15000'),'Rate-limit repeated correction commands');
 assert.ok(frontend.includes("movieSendControl('sample',position,playing)"));
 assert.ok(!frontend.includes('frame.contentDocument'),'Never read cross-origin player DOM');
});

test('fullscreen exit is an accessible unobtrusive top-left icon, not a bottom-center overlay',()=>{
 const css=fs.readFileSync(path.join(root,'public/watch-redesign.css'),'utf8');
 const block=css.slice(css.indexOf('/* Unobtrusive fullscreen exit:'));
 assert.ok(block.includes('#watch #videoShell.theater-mode .theater-dock'));
 assert.ok(block.includes('top:max(12px,env(safe-area-inset-top))!important'));
 assert.ok(block.includes('left:max(12px,env(safe-area-inset-left))!important'));
 assert.ok(block.includes('bottom:auto!important'));
 assert.ok(block.includes('right:auto!important'));
 assert.ok(block.includes('transform:none!important'));
 assert.ok(block.includes('max-width:48px!important'));
 assert.ok(block.includes('#watch #videoShell.theater-mode #theaterLabel{display:none!important}'));
 assert.ok(block.includes('focus-visible'));
 assert.ok(html.indexOf('/watch-redesign.css?v=4')>html.indexOf('/no-fullscreen-chat.css?v=1'));
 assert.ok(frontend.includes("document.addEventListener('keydown'"));
 assert.ok(html.includes('id="fullscreenToggle"'));
});


test('mobile cinema has a four-item accessible dock and focused discover/people sheets',()=>{
 const css=fs.readFileSync(path.join(root,'public/mobile-cinema.css'),'utf8');
 for(const id of ['mobileNav','mobileNavWatch','mobileNavChoose','mobileNavPeople','mobileNavChat',
  'mobilePickerPanel','mobileClosePicker','mobileClosePeople','mobileSheetBackdrop',
  'mobileCatchup','mobileQueueToggle','mobileNavUnread','mobileNavPeopleCount'])
  assert.ok(html.includes('id="'+id+'"'),'Mobile control missing: '+id);
 assert.ok(html.includes('/mobile-cinema.css?v=2'));
 assert.ok(html.indexOf('/mobile-cinema.css?v=2')>html.indexOf('/watch-redesign.css?v=4'));
 assert.ok(css.includes('body.theater-lock #mobileNav'),'Dock must not cover fullscreen');
 assert.ok(css.includes('env(safe-area-inset-bottom)'),'Safe area padding must be present');
 assert.ok(css.includes('min-height:57px'),'Dock targets must be thumb-sized');
 assert.ok(css.includes('#watch .source-library.mobile-open'));
 assert.ok(css.includes('#watch #peoplePanel.mobile-open'));
 assert.ok(css.includes('#watch #chatPanel.chat-open'));
 assert.ok(css.includes('var(--chat-visible-height,100dvh)'),'Chat should avoid virtual keyboard');
 assert.ok(css.includes('prefers-reduced-motion:reduce'));
 assert.ok(html.includes('catalog-safety-details')&&html.includes('Never bypass an antivirus warning.'));
 assert.ok(!html.includes('This is an unverified third-party player. If your antivirus flags its site or redirects'));
});

test('mobile nav opens one sheet at a time, closes with backdrop and updates unread counters',async()=>{
 const from=frontend.indexOf('/* Mobile watch-first navigation.');
 const until=frontend.indexOf('// Streambert-inspired movie catalogue.',from);
 assert.ok(from>=0&&until>from,'Mobile navigation behavior should be isolated for testing');
 const source=frontend.slice(from,until);
 function node(){
  const flags=new Set(['hidden']),attrs={};
  return{classList:{add:x=>flags.add(x),remove:x=>flags.delete(x),contains:x=>flags.has(x),
    toggle:(x,value)=>{if(value===undefined)value=!flags.has(x);value?flags.add(x):flags.delete(x);return value}},
   setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],
   addEventListener(){},
   getAttribute:k=>attrs[k],textContent:'',innerHTML:'',isConnected:true,
   focus(){this.focused=true},scrollIntoView(){this.scrolled=true}};
 }
 const nodes=new Map(),$=id=>{
  if(!nodes.has(id))nodes.set(id,node());
  return nodes.get(id);
 };
 const body=node(),queue=node();
 const document={body,activeElement:$('mobileNavChoose'),querySelector:()=>queue,
  addEventListener(){}};
 const context={
  $,matchMedia:()=>({matches:true}),document,window:{addEventListener(){}},
  participants:[{id:'a'},{id:'b'}],chatOpen:false,
  theaterActive:()=>false,movieCatchupNow(){},toggleTheater:async()=>{},toast(){},
  toggleChat(show){context.chatOpen=show;context.testChrome();}
 };
 vm.runInNewContext(source+'\nthis.testChrome=updateMobileChrome;this.testClose=mobileClosePanels;',context);
 assert.equal($('mobileNavPeopleCount').textContent,'2');
 $('mobileNavChoose').onclick();
 assert.equal($('mobilePickerPanel').classList.contains('mobile-open'),true);
 assert.equal($('peoplePanel').classList.contains('mobile-open'),false);
 assert.equal($('mobileNavChoose').getAttribute('aria-expanded'),'true');
 assert.equal(body.classList.contains('mobile-sheet-open'),true);
 $('mobileNavPeople').onclick();
 assert.equal($('mobilePickerPanel').classList.contains('mobile-open'),false);
 assert.equal($('peoplePanel').classList.contains('mobile-open'),true);
 $('mobileSheetBackdrop').onclick();
 assert.equal($('peoplePanel').classList.contains('mobile-open'),false);
 assert.equal($('mobileSheetBackdrop').classList.contains('hidden'),true);
 await $('mobileNavChat').onclick();
 assert.equal(context.chatOpen,true);
 assert.equal(body.classList.contains('mobile-chat-open'),true);
 context.testClose();
 assert.equal(context.chatOpen,false);
 assert.equal(body.classList.contains('mobile-chat-open'),false);
 $('mobileQueueToggle').onclick();
 assert.equal(queue.classList.contains('is-open'),true);
 assert.equal($('mobileQueueToggle').getAttribute('aria-expanded'),'true');
 $('mobileQueueToggle').onclick();
 assert.equal(queue.classList.contains('is-open'),false);
});

test('camera permission promises are canceled when leaving so late replies cannot republish',async()=>{
 const leaveStart=frontend.indexOf('async function leaveCall(send=true){');
 const leaveEnd=frontend.indexOf('async function createPeer(',leaveStart);
 const joinStart=frontend.indexOf('async function joinCall(){');
 const joinEnd=frontend.indexOf("$('call').onclick=joinCall;",joinStart);
 assert.ok(leaveStart>0&&leaveEnd>leaveStart&&joinStart>0&&joinEnd>joinStart);
 const events=[],toasts=[],tracks=[],nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{add(){},remove(){}},
   replaceChildren(){},disabled:false,setAttribute(){}});
  return nodes.get(id);
 };
 const mediaTrack={stopped:false,stop(){this.stopped=true},addEventListener(){}};
 const stream={getTracks:()=>[mediaTrack]};
 let resolveMedia,joinCallback;
 const context={
  $,room:'room-id',callRole:'spectator',callActive:true,callJoining:false,
  callAttempt:0,localStream:null,callMembers:[],cameraMembers:()=>[],
  socket:{connected:true,emit:(name,data,callback)=>{events.push(name);if(name==='call:join')joinCallback=callback},
   timeout:()=>({emit:(name,data,cb)=>{events.push(name);joinCallback=cb}})},
  getMedia:()=>new Promise(resolve=>{resolveMedia=resolve}),loadIceServers:async()=>{},
  toast:text=>toasts.push(text),updateCallActions(){},setCallUI(){},
  connections:new Map(),videoTiles:new Map(),removePeer(){},
  startSpectatorView(){},offerAvailableCameras(){},displayTile:()=>({}),
  console
 };
 vm.runInNewContext(frontend.slice(leaveStart,leaveEnd)+'\n'+frontend.slice(joinStart,joinEnd)+
  '\nthis.testJoinCall=joinCall;this.testLeaveCall=leaveCall;',context);
 const joining=context.testJoinCall();
 assert.equal(context.callJoining,true);
 await context.testLeaveCall(true);
 assert.equal(context.callJoining,false);
 resolveMedia(stream);
 await joining;
 assert.equal(mediaTrack.stopped,true);
 assert.equal(events.includes('call:join'),false,'Canceled camera permission must not join a call');
 assert.equal(context.callActive,false);
 assert.equal(context.callAttempt,2);
 // A server response delivered after leaving also must not re-enable publishing.
 const secondTrack={stopped:false,stop(){this.stopped=true},addEventListener(){}};
 context.getMedia=async()=>{const secondStream={getTracks:()=>[secondTrack]};context.localStream=secondStream;return secondStream};
 const second=context.testJoinCall();await second;
 assert.equal(events.filter(x=>x==='call:join').length,1);
 await context.testLeaveCall(true);
 joinCallback(null,{role:'camera',peers:[],callMembers:[]});
 assert.equal(context.callActive,false);
 assert.equal(secondTrack.stopped,true);
});

test('WebRTC collision handling uses polite rollback and bounds queued ICE candidates',async()=>{
 const from=frontend.indexOf('async function onSignal({from,data}){');
 const until=frontend.indexOf('async function loadIceServers(){',from);
 assert.ok(from>0&&until>from);
 const code=frontend.slice(from,until);
 const actions=[],outbound=[];
 const pc={signalingState:'have-local-offer',remoteDescription:null,localDescription:{toJSON:()=>({type:'answer'})},
  async setLocalDescription(desc){actions.push('local:'+desc.type);this.signalingState=desc.type==='rollback'?'stable':'stable'},
  async setRemoteDescription(desc){actions.push('remote:'+desc.type);this.remoteDescription=desc;this.signalingState='have-remote-offer'},
  async createAnswer(){return{type:'answer'}}
 };
 const queues=new Map();
 const context={
  callActive:true,participants:[{id:'a'},{id:'b'}],me:'b',
  createPeer:async()=>pc,drainCandidates:async()=>{},
  RTCSessionDescription:function(d){return d},RTCIceCandidate:function(d){return d},
  socket:{connected:true,emit:(...args)=>outbound.push(args)},
  candidateQueues:queues,console,tileStatus(){},toast(){}
 };
 vm.runInNewContext(code+'\nthis.handleSignal=onSignal;',context);
 await context.handleSignal({from:'a',data:{description:{type:'offer'}}});
 assert.deepEqual(actions.slice(0,3),['local:rollback','remote:offer','local:answer']);
 assert.equal(outbound.length,1);
 actions.length=0;context.me='a';pc.signalingState='have-local-offer';
 await context.handleSignal({from:'b',data:{description:{type:'offer'}}});
 assert.equal(actions.length,0,'Impolite peer must ignore collision');
 pc.remoteDescription=null;pc.signalingState='stable';
 for(let i=0;i<140;i++)await context.handleSignal({from:'b',data:{candidate:{candidate:'test'+i}}});
 assert.equal(queues.get('b').length,128,'Queue must be bounded');
});

test('mobile movie finder has a dedicated responsive detail step',()=>{
 const css=fs.readFileSync(path.join(root,'public/mobile-cinema.css'),'utf8');
 for(const id of ['catalogResultHeading','catalogResultCount','catalogSelectedPoster',
  'catalogSelectedDescription','catalogShareFeedback','catalogChangeTitle'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('/mobile-cinema.css?v=2')&&html.includes('/app.js?v=25'));
 assert.ok(css.includes('.sr-only{')&&css.includes('clip-path:inset(50%)'));
 assert.ok(css.includes('grid-template-columns:minmax(0,1fr) 77px'),'Find action must stay beside input');
 assert.ok(css.includes('#watch #movieCatalog.is-title-selected #catalogResults'));
 assert.ok(css.includes('#watch #movieCatalog.is-title-selected .catalog-selection-copy'));
 assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
 assert.ok(css.includes('calc(46px + env(safe-area-inset-bottom))'));
 assert.ok(frontend.includes("$('mobilePickerPanel').scrollTop=0"));
 assert.ok(frontend.includes("$('catalogShareFeedback').textContent=message"));
});


test('two visual themes can be selected locally without sharing through the room',()=>{
 const theme=fs.readFileSync(path.join(root,'public/theme.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'public/theme-variants.css'),'utf8');
 assert.ok(html.includes('id="themeToggle"'));
 assert.ok(html.includes('id="themeToggleLabel"'));
 assert.ok(html.includes('id="themeToggleIcon"'));
 assert.ok(html.includes('/theme.js?v=1')&&html.includes('/theme-variants.css?v=1'));
 assert.ok(html.indexOf('/theme-variants.css?v=1')>html.indexOf('/mobile-cinema.css?v=2'));
 assert.ok(theme.includes("const KEY='togetherly.appearance'"));
 assert.ok(theme.includes("document.documentElement.dataset.theme=valid"));
 assert.ok(theme.includes("localStorage.setItem(KEY,valid)"));
 assert.ok(!theme.includes('socket.')&&!theme.includes('call:')&&!theme.includes('catalog:play'));
 assert.ok(css.includes('html[data-theme="lounge"]'));
 for(const screen of ['.landing-entry','#watch .source-library','#watch .watch-queue',
  '#watch .rail-section','#watch #peoplePanel.mobile-open',
  '#watch #chatPanel.chat-open','#watch .mobile-nav',
  '#watch #movieCatalog.is-title-selected #catalogPlay']){
  assert.ok(css.includes(screen),'Light theme missing '+screen);
 }
 assert.ok(css.includes('color-scheme:light'));
 assert.ok(css.includes('#watch .video-shell'));
});

test('theme preference is restored per browser and switch updates accessibility',()=>{
 const source=fs.readFileSync(path.join(root,'public/theme.js'),'utf8');
 const listeners={},nodes=new Map(),local={};
 const elem=id=>{
  if(!nodes.has(id))nodes.set(id,{attributes:{},textContent:'',listeners:{},
   setAttribute(k,v){this.attributes[k]=v},
   addEventListener(event,fn){this.listeners[event]=fn}});
  return nodes.get(id);
 };
 const storage={getItem:key=>local[key]||null,setItem:(key,value)=>local[key]=value};
 const doc={documentElement:{dataset:{}},
  querySelector:selector=>selector==='meta[name="theme-color"]'?elem('meta'):null,
  getElementById:elem,addEventListener:(event,fn)=>listeners[event]=fn};
 const run=()=>vm.runInNewContext(source,{document:doc,localStorage:storage});
 run();listeners.DOMContentLoaded();
 assert.equal(doc.documentElement.dataset.theme,'cinema');
 assert.equal(elem('themeToggle').attributes['aria-pressed'],'false');
 elem('themeToggle').listeners.click();
 assert.equal(doc.documentElement.dataset.theme,'lounge');
 assert.equal(local['togetherly.appearance'],'lounge');
 assert.equal(elem('themeToggleLabel').textContent,'Private Cinema');
 assert.equal(elem('themeToggle').attributes['aria-label'],'Switch to Private Cinema dark theme');
 assert.equal(elem('meta').attributes.content,'#FAF5EC');
 run();listeners.DOMContentLoaded();
 assert.equal(doc.documentElement.dataset.theme,'lounge','Theme should survive reload');
 elem('themeToggle').listeners.click();
 assert.equal(doc.documentElement.dataset.theme,'cinema');
 assert.equal(local['togetherly.appearance'],'cinema');
 assert.equal(elem('themeToggle').attributes['aria-pressed'],'false');
});

test('WebRTC reconnect waits for transient drops, restarts ICE, and cancels upon recovery',async()=>{
 const start=frontend.indexOf('const peerRecovery=new Map();');
 const end=frontend.indexOf('async function createPeer(',start);
 assert.ok(start>0&&end>start,'Recovery controller should be isolated');
 const source=frontend.slice(start,end);
 const pending=[],sent=[],status=[];
 const context={
  callActive:true,room:'room-a',
  participants:[{id:'guest'}],
  callUser:()=>({role:'camera'}),
  socket:{connected:true,emit:(...v)=>sent.push(v)},
  connections:new Map(),
  tileStatus:(id,message)=>status.push(message),
  $:()=>({textContent:''}),
  loadIceServers:async()=>{},
  removePeer:()=>{},
  createPeer:async()=>{},
  Date,
  setTimeout:(fn,delay)=>{const handle={fn,delay,canceled:false};pending.push(handle);return handle},
  clearTimeout:handle=>{handle.canceled=true},
  console
 };
 const pc={
  connectionState:'disconnected',iceConnectionState:'disconnected',
  signalingState:'stable',localDescription:{toJSON:()=>({type:'offer',sdp:'ice-restart'})},
  async createOffer(options){assert.equal(options.iceRestart,true);return{type:'offer'}},
  async setLocalDescription(){}
 };
 context.connections.set('guest',pc);
 vm.runInNewContext(source+'\nthis.schedule=schedulePeerRecovery;this.clearRecovery=clearPeerRecovery;this.getRec=()=>peerRecovery.get("guest");',context);
 context.schedule('guest',pc);
 assert.equal(pending[0].delay,4500,'Temporary disconnected state needs a grace period');
 assert.equal(sent.length,0);
 await pending.shift().fn();
 assert.equal(sent.length,1);
 assert.equal(sent[0][0],'call:signal');
 assert.equal(context.getRec().attempts,1);
 pc.connectionState='connected';pc.iceConnectionState='connected';
 context.clearRecovery('guest');
 assert.equal(context.getRec(),undefined);
 const last=pending.at(-1);
 assert.equal(last.canceled,true,'Any pending watchdog must be canceled once connected');
 context.schedule('guest',pc);
 assert.equal(pending.length,1,'Do not restart a healthy connection');
 pc.connectionState='disconnected';pc.iceConnectionState='disconnected';
 context.schedule('guest',pc);
 assert.equal(pending.length,2,'A new drop should receive a fresh grace period');
 assert.equal(pending.at(-1).delay,4500);
 context.clearRecovery('guest');
 pc.iceConnectionState='connected';pc.connectionState='disconnected';
 context.schedule('guest',pc);
 assert.equal(pending.length,3,'Disconnected aggregate transport still needs recovery even if ICE substate is healthy');
});

test('WebRTC recovery never restarts a peer who has left the room',()=>{
 const source=frontend.slice(frontend.indexOf('const peerRecovery=new Map();'),
  frontend.indexOf('async function createPeer(',frontend.indexOf('const peerRecovery=new Map();')));
 assert.ok(source.includes('participants.some(p=>p.id===id)'));
 assert.ok(source.includes('!callActive||!socket.connected'));
 assert.ok(source.includes("pc.createOffer({iceRestart:true})"));
 assert.ok(source.includes('removePeer(id,true)'),'Bounded rebuild must preserve camera tracks');
 assert.ok(source.includes('PEER_RETRY_LIMIT=3'));
 assert.ok(frontend.includes('document.addEventListener(\'visibilitychange\''));
 assert.ok(frontend.includes('cameraNeedsRejoin=true'));
 assert.ok(frontend.includes('Your camera was paused by a network interruption'));
 assert.ok(frontend.includes("callRole='camera';callActive=true;sharingCall=true;cameraNeedsRejoin=false"));
});

test('movie frame blocks popups and nested fullscreen while keeping Togetherly theater available',()=>{
 const start=html.indexOf('<iframe id="websiteFrame"');
 const end=html.indexOf('</iframe>',start);
 assert.ok(start>0&&end>start,'Movie frame missing');
 const iframe=html.slice(start,end);
 assert.ok(iframe.includes('sandbox="allow-scripts allow-same-origin allow-forms"'));
 for(const permission of ['allow-popups','allow-top-navigation','allow-downloads','allow-presentation',
  'allowfullscreen','fullscreen;']){
  assert.ok(!iframe.includes(permission),'Unwanted frame permission: '+permission);
 }
 assert.ok(!frontend.includes("frame.removeAttribute('sandbox')"));
 assert.ok(frontend.includes("frame.removeAttribute('allowfullscreen')"));
 assert.ok(frontend.includes("frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture')"));
 assert.ok(backend.includes('fullscreen=(self)'));
 assert.ok(frontend.includes('theaterShell.requestFullscreen('));
 assert.ok(html.includes('id="callOverlay"'));
});
