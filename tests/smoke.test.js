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
 const queued=await a.ask('queue:add',{url:'https://youtu.be/M7lc1UVf-VE',title:'Example video'});
 assert.equal(queued.ok,true);
 const queueNotification=relayed.find(x=>x.event==='queue:update'&&x.data.length);
 assert.ok(queueNotification,'Queue update must reach the whole room');
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
