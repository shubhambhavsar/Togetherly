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
test('room names and group-call signaling',async()=>{
 let connect;const relayed=[];
 class FakeIO{
  on(event,fn){if(event==='connection')connect=fn}
  to(id){return {emit:(event,data)=>relayed.push({id,event,data})}}
 }
 const express=()=>({disable(){},use(){},get(){}});
 express.static=()=>()=>{};
 const fakeRequire=id=>id==='express'?express:
  id==='http'?{createServer:()=>({listen(){}})}:
  id==='socket.io'?{Server:FakeIO}:
  id==='crypto'?{randomBytes:n=>({toString:()=> 'a'.repeat(n*2)})}:
  id==='path'?{join:(...a)=>a.join('/')}:
  require(id);
 vm.runInNewContext(backend,{require:fakeRequire,process:{env:{PORT:'3000'}},__dirname:'/app',console,setInterval:()=>({unref(){}})}, {filename:'server.js'});
 function client(id){
  const handlers={};
  const s={id,data:{},on:(event,fn)=>handlers[event]=fn,join(){},leave(){},to:()=>({emit:(event,data)=>relayed.push({id:'others',event,data})})};
  connect(s);
  return {ask:(event,data)=>new Promise(resolve=>handlers[event](data,resolve)),fire:(event,data)=>handlers[event](data)};
 }
 const a=client('a'),b=client('b'),c=client('c');
 assert.match((await a.ask('create',{name:''})).error,/name/i);
 const room=await a.ask('create',{name:'Alex'});
 assert.equal((await b.ask('join',{id:room.id,name:'Bea'})).members.length,2);
 assert.equal((await c.ask('join',{id:room.id,name:'Cory'})).members.length,3);
 assert.equal((await b.ask('room:rename',{name:'Bella'})).ok,true);
 assert.deepEqual(Array.from((await a.ask('call:join',{})).peers),[]);
 assert.deepEqual(Array.from((await b.ask('call:join',{})).peers),['a']);
 assert.deepEqual(Array.from((await c.ask('call:join',{})).peers),['a','b']);
 c.fire('call:signal',{to:'a',data:{description:{type:'offer',sdp:'demo'}}});
 assert.ok(relayed.some(x=>x.id==='a'&&x.event==='call:signal'));
 b.fire('call:leave');
 assert.ok(relayed.some(x=>x.event==='call:peer-left'));
});
