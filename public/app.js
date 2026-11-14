'use strict';
const $=id=>document.getElementById(id);
const socket=io({reconnection:true,reconnectionDelay:500});
const roomFromPath=location.pathname.match(/^\/room\/([a-f0-9]{24})$/)?.[1];
let room=null,me=null,participants=[],player=null,playerReady=false,ytReady=false,applying=false,lastState=null,version=0;
let roomQueue=[],searchReady=false,searching=false;
let localStream=null,callActive=false,callJoining=false,iceConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
let callMembers=[],unread=0,chatOpen=false,callMinimized=false,callRole=null,sharingCall=false;
const cameraMembers=()=>callMembers.filter(m=>m.role==='camera');
const callUser=id=>callMembers.find(m=>m.id===id);
const connections=new Map(),remoteStreams=new Map(),candidateQueues=new Map(),videoTiles=new Map();
const toast=msg=>{const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.add('hidden'),3800)};
function notice(msg){$('notice').textContent=msg}
let currentName='';
try{$('name').value=localStorage.getItem('togetherly.nickname')||''}catch{}
function nickname(){return $('name').value.trim().slice(0,25)}
function saveName(n){currentName=n;$('name').value=n;try{localStorage.setItem('togetherly.nickname',n)}catch{}}
function requireName(){const n=nickname();if(!n){toast('Enter your name before joining');$('name').focus();return null}saveName(n);return n}
$('rename').onclick=()=>{if(!room)return;const v=prompt('What name should others see?',currentName||nickname());if(v===null)return;const n=v.trim().slice(0,25);if(!n)return toast('Name cannot be empty');socket.emit('room:rename',{name:n},result=>{if(result?.ok){saveName(n);toast('Name updated')}else toast(result?.error||'Could not update name')})};
function setupRoom(d){saveName(nickname());room=d.id;me=socket.id;participants=d.members||[];callMembers=d.callMembers||[];roomQueue=d.queue||[];renderQueue();lastState=d.state;version=d.state.version;$('landing').style.display='none';$('watch').style.display='block';history.replaceState({},'', '/room/'+room);showMembers();$('chat').replaceChildren();(d.messages||[]).forEach(m=>addMessage(m,false));initPlayer()}
function create(){const n=requireName();if(!n)return;socket.emit('create',{name:n},d=>{if(d?.error)return toast(d.error);if(d)setupRoom(d)})}
function join(){const n=requireName();if(!n)return;socket.emit('join',{id:roomFromPath||room,name:n},d=>{if(d?.error)return toast(d.error);if(d)setupRoom(d)})}
$('create').onclick=create;$('join').onclick=join;
if(roomFromPath){$('joinbox').classList.remove('hidden');$('create').textContent='Create a different room'}
$('copy').onclick=async()=>{const url=location.origin+'/room/'+room;try{await navigator.clipboard.writeText(url);toast('Invite link copied')}catch{prompt('Copy this room link:',url)}};
$('leave').onclick=()=>{leaveCall();location.href='/'};
function showMembers(){
 for(const [id,item] of videoTiles){if(id!=='self'){const label=item.tile.querySelector('.tile-label');if(label)label.textContent=participants.find(p=>p.id===id)?.name||'Participant'}}
 const box=$('members');box.replaceChildren();$('count').textContent=participants.length+' watching together';$('roomSeats').textContent=cameraMembers().length+'/2 camera seats';
 for(const m of participants){
  const row=document.createElement('div');row.className='member';
  const label=document.createElement('span'),avatar=document.createElement('span');
  avatar.className='avatar';avatar.textContent=m.name.charAt(0).toUpperCase();
  label.append(avatar,document.createTextNode(m.name+(m.id===me?' (you)':'')));row.append(label);
  const role=callUser(m.id),badge=document.createElement('span');badge.className='pill';
  badge.textContent=role?(role.role==='camera'?'On camera':'Watching call'):'Watching';
  row.append(badge);box.append(row)
 }
 $('call').disabled=callActive||callJoining||cameraMembers().length>=2;
 $('watchCall').disabled=callActive||callJoining;
 $('call').textContent=cameraMembers().length>=2?'Camera seats full':'Join on camera';
}
socket.on('members',m=>{participants=m;showMembers();for(const id of connections.keys())if(!participants.some(p=>p.id===id))removePeer(id)});
socket.on('call:members',members=>{
 callMembers=members;syncCallDock();showMembers();
 if(!callActive)$('callStatus').textContent=cameraMembers().length?'Camera call in progress':'No one on camera yet';
 else if(callRole==='spectator')$('callStatus').textContent='Watching the call';
 else $('callStatus').textContent='On camera';
 const mine=callUser(me);if(mine?.role==='camera'){sharingCall=!!mine.sharing;updateSharingUI()}
});
function addMessage(m,notify=true){const line=document.createElement('div');line.className='msg',name=document.createElement('b');name.textContent=m.name+': ';line.append(name,document.createTextNode(m.text));$('chat').append(line);$('chat').scrollTop=$('chat').scrollHeight;if(notify&&!chatOpen&&matchMedia('(max-width:850px)').matches){unread=Math.min(99,unread+1);$('unread').textContent=unread;$('unread').classList.remove('hidden')}}
socket.on('message',m=>addMessage(m));

socket.on('queue:update',items=>{roomQueue=Array.isArray(items)?items:[];renderQueue()});
function clip(text,n=100){return String(text||'').slice(0,n)}
function renderQueue(){
 $('queueCount').textContent=String(roomQueue.length);
 const parent=$('queueList');parent.replaceChildren();
 if(!roomQueue.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Nothing queued yet. Start a watch list for tonight.';parent.append(empty);return}
 roomQueue.forEach((item,index)=>{
  const row=document.createElement('div');row.className='queue-item';
  const count=document.createElement('span');count.className='queue-number';count.textContent=String(index+1).padStart(2,'0');
  const info=document.createElement('div');info.className='queue-info';
  const title=document.createElement('div');title.className='queue-title';title.textContent=clip(item.title,100);
  const by=document.createElement('div');by.className='queue-sub';by.textContent='Added by '+clip(item.addedBy,25);
  info.append(title,by);
  const play=document.createElement('button');play.className='secondary-button small';play.textContent='Play';
  play.onclick=()=>socket.emit('queue:play',{id:item.id},res=>{if(res?.error)toast(res.error)});
  const remove=document.createElement('button');remove.className='text-button';remove.title='Remove from queue';remove.setAttribute('aria-label','Remove '+clip(item.title)+' from queue');remove.textContent='✕';
  remove.onclick=()=>socket.emit('queue:remove',{id:item.id},res=>{if(res?.error)toast(res.error)});
  row.append(count,info,play,remove);parent.append(row)
 })
}
function getRecents(){try{return JSON.parse(localStorage.getItem('togetherly.recents')||'[]').filter(x=>/^[\w-]{11}$/.test(x.id)).slice(0,10)}catch{return []}}
function saveRecent(item){
 if(!item?.id||!/^[\w-]{11}$/.test(item.id)||item.id==='M7lc1UVf-VE')return;
 const existing=getRecents().filter(x=>x.id!==item.id);
 existing.unshift({id:item.id,title:clip(item.title||'YouTube video',100),channel:clip(item.channel||'',70)});
 try{localStorage.setItem('togetherly.recents',JSON.stringify(existing.slice(0,10)))}catch{}
 renderRecent()
}
function youtubeThumbnail(id){return 'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'}
function createResult(item){
 const row=document.createElement('div');row.className='video-result';
 const img=document.createElement('img');img.src=youtubeThumbnail(item.id);img.loading='lazy';img.alt='';
 const body=document.createElement('div');body.className='video-result-content';
 const title=document.createElement('div');title.className='video-result-title';title.textContent=clip(item.title,150);
 const channel=document.createElement('div');channel.className='video-result-channel';channel.textContent=clip(item.channel||'YouTube',80);
 const actions=document.createElement('div');actions.className='video-result-actions';
 const play=document.createElement('button');play.className='primary-button small';play.textContent='Watch now';
 play.onclick=()=>{
  const url='https://www.youtube.com/watch?v='+item.id;
  socket.emit('video',{url},result=>{if(result?.error)return toast(result.error);saveRecent(item);closeExplore()})
 };
 const queue=document.createElement('button');queue.className='secondary-button small';queue.textContent='+ Queue';
 queue.onclick=()=>socket.emit('queue:add',{url:item.id,title:item.title},result=>{if(result?.error)return toast(result.error);saveRecent(item);toast('Added to the watch queue')});
 actions.append(play,queue);body.append(title,channel,actions);row.append(img,body);return row
}
function renderRecent(){
 const list=$('recentList');list.replaceChildren();const data=getRecents();
 $('recentSection').classList.toggle('hidden',data.length===0);
 data.forEach(item=>list.append(createResult(item)))
}
async function openExplore(){
 if(theaterActive())await toggleTheater();
 $('discoverModal').classList.remove('hidden');document.body.classList.add('modal-lock');renderRecent();
 setTimeout(()=>$('discoverInput').focus(),60);
 try{const res=await fetch('/api/discovery-status');searchReady=!!(await res.json()).searchReady}catch{searchReady=false}
 $('searchHint').textContent=searchReady?'Find embeddable videos directly from YouTube.':'YouTube search needs an API key. You can still use recent videos, the shared queue, or browse YouTube and use the Paste button.';
}
function closeExplore(){
 $('discoverModal').classList.add('hidden');document.body.classList.remove('modal-lock');
}
$('openExplore').onclick=openExplore;$('queueExplore').onclick=openExplore;
$('closeExplore').onclick=closeExplore;$('discoverScrim').onclick=closeExplore;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('discoverModal').classList.contains('hidden'))closeExplore()});
function updateBrowseUrl(q){$('openYouTubeSearch').href='https://www.youtube.com/results?search_query='+encodeURIComponent(q||'full movie official')}
$('discoverForm').onsubmit=async e=>{
 e.preventDefault();if(searching)return;
 const q=$('discoverInput').value.trim();if(q.length<2)return toast('Enter a video or movie name');
 updateBrowseUrl(q);
 if(!searchReady){$('searchHint').textContent='In-app search requires a YouTube API key. Browse YouTube, copy a video, then tap Paste on Togetherly.';return}
 searching=true;$('searchHint').textContent='Looking for something good…';
 try{
  const data=await new Promise((resolve,reject)=>{
    socket.timeout(13000).emit('discover:search',{q},(err,result)=>{
      if(err)reject(Error('Search timed out. Please try again.'));
      else if(result?.error)reject(Error(result.error));
      else resolve(result)
    })
  });
  const results=$('discoverResults');results.replaceChildren();
  for(const item of data.items||[])results.append(createResult(item));
  $('searchHint').textContent=(data.items||[]).length?'Results may vary by region or embedding permissions.':'No playable results. Try different words.';
 }catch(err){$('searchHint').textContent=err.message}
 finally{searching=false}
};
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{
 $('discoverInput').value=b.dataset.query;updateBrowseUrl(b.dataset.query);$('discoverForm').requestSubmit()
});
$('pasteLink').onclick=async()=>{
 try{
  const text=(await navigator.clipboard.readText()).trim();
  if(!text)throw Error('Clipboard is empty');
  $('videoURL').value=text;
  toast('Link pasted — select Play now');
 }catch{toast('Paste permission was unavailable. Tap the link field and paste manually.');$('videoURL').focus()}
};
renderQueue();

$('chatForm').onsubmit=e=>{e.preventDefault();const text=$('chatText').value.trim();if(text){socket.emit('message',{text});$('chatText').value=''}};
function toggleChat(show){chatOpen=show;$('chatPanel').classList.toggle('chat-open',show);if(show){unread=0;$('unread').classList.add('hidden');setTimeout(()=>$('chatText').focus(),50)}}
$('chatBubble').onclick=()=>toggleChat(!chatOpen);$('closeChat').onclick=()=>toggleChat(false);
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape')return;
 if(chatOpen){toggleChat(false);return}
 if(theaterFallback){theaterFallback=false;updateTheaterUI()}
});

// A fullscreen YouTube iframe hides every sibling overlay. Fullscreen Togetherly's
// containing element instead so the call tiles and chat remain in the same top layer.
const theaterShell=$('videoShell');
const theaterChat=$('chatPanel');
const theaterHome=theaterChat.parentNode;
const theaterAnchor=document.createComment('Restore chat here after theater');
theaterHome.insertBefore(theaterAnchor,theaterChat);
let theaterFallback=false;
function theaterActive(){return document.fullscreenElement===theaterShell||theaterFallback}
function updateTheaterUI(){
 const active=theaterActive();
 theaterShell.classList.toggle('theater-mode',active);
 theaterShell.classList.toggle('pseudo-fullscreen',theaterFallback);
 document.body.classList.toggle('theater-lock',active);
 $('fullscreenToggle').setAttribute('aria-pressed',String(active));
 $('fullscreenToggle').setAttribute('aria-label',active?'Exit watch fullscreen':'Enter watch fullscreen');
 $('theaterLabel').textContent=active?'Exit fullscreen':'Fullscreen';
 if(active){
  if(theaterChat.parentNode!==theaterShell)theaterShell.appendChild(theaterChat);
 }else{
  if(chatOpen)toggleChat(false);
  if(theaterChat.parentNode!==theaterHome)theaterAnchor.after(theaterChat);
 }
}
async function toggleTheater(){
 if(theaterActive()){
  if(document.fullscreenElement===theaterShell){
   try{await document.exitFullscreen()}catch(e){console.warn('Could not exit fullscreen',e)}
  }else theaterFallback=false;
  updateTheaterUI();return;
 }
 // Place chat within the fullscreen element before the browser changes top layers.
 theaterShell.appendChild(theaterChat);
 // iPhone Safari does not reliably support requestFullscreen on ordinary elements.
 if(typeof theaterShell.requestFullscreen==='function'&&document.fullscreenEnabled){
  try{
   await theaterShell.requestFullscreen({navigationUI:'hide'});
   theaterFallback=false;
   updateTheaterUI();return;
  }catch(e){console.info('Using in-page theater mode:',e)}
 }
 theaterFallback=true;
 updateTheaterUI();
}
$('fullscreenToggle').onclick=toggleTheater;
document.addEventListener('fullscreenchange',()=>{
 if(document.fullscreenElement!==theaterShell&&theaterFallback===false){updateTheaterUI()}
 else updateTheaterUI();
});

$('load').onclick=()=>{if(!room)return;socket.emit('video',{url:$('videoURL').value},d=>{if(d?.error)toast(d.error)})};
let ytScriptStarted=false,playerTimeout=null;
function playerHelp(message,error=false){
 $('playerMessage').textContent=message;$('playerFallback').classList.remove('hidden');
 $('retryPlayer').textContent=error?'Try again':'Retry player';
 $('youtubeLink').href=lastState?.video?'https://www.youtube.com/watch?v='+encodeURIComponent(lastState.video):'https://www.youtube.com/';
}
function playerReadyUI(){clearTimeout(playerTimeout);$('playerFallback').classList.add('hidden');notice('')}
function loadYouTubeAPI(){
 if(window.YT&&typeof window.YT.Player==='function'){ytReady=true;initPlayer();return}
 window.onYouTubeIframeAPIReady=()=>{ytReady=true;initPlayer()};
 if(!ytScriptStarted){ytScriptStarted=true;const tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';tag.async=true;tag.id='ytApiTag';
  tag.onerror=()=>{ytScriptStarted=false;playerHelp('YouTube failed to load. Check your network or content blocker, then retry.',true)};
  document.head.appendChild(tag)}
 clearTimeout(playerTimeout);
 playerTimeout=setTimeout(()=>{if(!playerReady)playerHelp('YouTube is taking too long to load. Check your network, then retry.',true)},13000);
}
function initPlayer(){
 if(player||!ytReady||!room)return;
 playerHelp('Opening YouTube player…');
 try{player=new YT.Player('player',{width:'100%',height:'100%',videoId:lastState?.video||'M7lc1UVf-VE',playerVars:{playsinline:1,rel:0,fs:0,origin:location.origin},events:{
  onReady:e=>{playerReady=true;try{e.target.getIframe().setAttribute('referrerpolicy','strict-origin-when-cross-origin')}catch{}playerReadyUI();applyState(lastState)},
  onStateChange:e=>{if(applying||!room||!playerReady)return;if(e.data===YT.PlayerState.PLAYING)sendPlayback('play');else if(e.data===YT.PlayerState.PAUSED)sendPlayback('pause')},
  onAutoplayBlocked:()=>notice('Your browser blocked autoplay. Tap the YouTube player to start.'),
  onError:e=>{const reasons={2:'Invalid video ID',5:'YouTube playback error',100:'Video unavailable or private',101:'Video owner disabled embedding',150:'Video owner disabled embedding',153:'YouTube requires referring website identification'};playerHelp((reasons[e.data]||'YouTube playback failed')+' (error '+e.data+'). Try another video or open it on YouTube.',true)}
 }})}catch(e){player=null;playerHelp('Could not start YouTube player: '+e.message,true)}
}
$('retryPlayer').onclick=()=>{
 clearTimeout(playerTimeout);
 if(player){try{player.destroy()}catch{}player=null}
 playerReady=false;const div=document.createElement('div');div.id='player';
 $('videoShell').querySelector('#player')?.remove();$('videoShell').prepend(div);
 if(!ytReady){document.getElementById('ytApiTag')?.remove();ytScriptStarted=false}playerHelp('Retrying YouTube…');loadYouTubeAPI();
};
loadYouTubeAPI();
function sendPlayback(action){if(!playerReady||applying)return;const p=player.getCurrentTime();if(!Number.isFinite(p))return;socket.emit('playback',{action,position:p,version});if(lastState){lastState={...lastState,position:p,playing:action==='play'?true:action==='pause'?false:lastState.playing}}}
function applyState(s){if(!s)return;const old=lastState;lastState=s;version=s.version;if(old?.video!==s.video)saveRecent({id:s.video,title:'YouTube video'});$('videoURL').value='https://www.youtube.com/watch?v='+s.video;$('youtubeLink').href=$('videoURL').value;if(!playerReady)return;applying=true;try{const video=player.getVideoData()?.video_id;if(video!==s.video){player.cueVideoById(s.video,s.position);notice('New video ready. Tap Play if your browser blocks autoplay.')}else{const t=player.getCurrentTime();if(Math.abs(t-s.position)>2.5)player.seekTo(s.position,true);const status=player.getPlayerState();if(s.playing&&status!==YT.PlayerState.PLAYING)player.playVideo();else if(!s.playing&&status===YT.PlayerState.PLAYING)player.pauseVideo()}$('syncLabel').textContent='In sync';if(old?.video!==s.video)$('videoURL').value='https://www.youtube.com/watch?v='+s.video}catch(e){console.warn('Player sync:',e)}finally{setTimeout(()=>applying=false,850)}}
socket.on('state',applyState);
$('play').onclick=()=>{if(playerReady){player.playVideo();sendPlayback('play')}};
$('pause').onclick=()=>{if(playerReady){player.pauseVideo();sendPlayback('pause')}};
$('sync').onclick=()=>socket.emit('sync');
setInterval(()=>{if(room&&playerReady&&!document.hidden)socket.emit('sync')},22000);
socket.on('connect',()=>{me=socket.id;if(room){leaveCall(false);socket.emit('join',{id:room,name:currentName||nickname()},d=>{if(d?.error){toast(d.error);notice('Room expired. Please create a new room.');return}lastState=d.state;version=d.state.version;participants=d.members;callMembers=d.callMembers||[];roomQueue=d.queue||[];renderQueue();showMembers();socket.emit('sync');notice('Reconnected. Rejoin your video call if needed.')})}});
socket.on('disconnect',()=>{notice('Connection lost. Trying to reconnect…');leaveCall(false)});
async function getMedia(){
 if(localStream&&localStream.active)return localStream;
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera and microphone need HTTPS and a compatible browser');
 localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:{facingMode:'user',width:{ideal:320},height:{ideal:240},frameRate:{ideal:15,max:24}}});
 return localStream
}
function displayTile(id,isLocal=false){
 if(videoTiles.has(id))return videoTiles.get(id).video;
 const tile=document.createElement('div');tile.className='call-tile'+(isLocal?' local':'');
 const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=isLocal;
 video.setAttribute('playsinline','');video.setAttribute('autoplay','');
 const label=document.createElement('span');label.className='tile-label';label.textContent=isLocal?'You':(participants.find(x=>x.id===id)?.name||'Participant');
 tile.append(video,label);
 if(!isLocal){const state=document.createElement('span');state.className='tile-status';state.textContent='Connecting…';tile.append(state);tile.onclick=()=>{video.play().catch(()=>toast('Tap again to enable call audio'))}}
 videoTiles.set(id,{tile,video});$('callGrid').append(tile);$('callOverlay').classList.remove('hidden');return video
}
function tileStatus(id,msg){const node=videoTiles.get(id)?.tile.querySelector('.tile-status');if(node)node.textContent=msg}
function removePeer(id){
 const pc=connections.get(id);if(pc){pc.onicecandidate=null;pc.ontrack=null;pc.onconnectionstatechange=null;pc.close()}
 connections.delete(id);candidateQueues.delete(id);remoteStreams.delete(id);
 videoTiles.get(id)?.tile.remove();videoTiles.delete(id);
}
function syncCallDock(){
 $('callBubbleCount').textContent=String(cameraMembers().length||1);
 $('callBubble').classList.toggle('hidden',!callActive||!callMinimized);
 $('callOverlay').classList.toggle('collapsed',callActive&&callMinimized);
 $('minimizeCall').disabled=!callActive;
}
function setCallUI(active){
 $('callOverlay').classList.toggle('hidden',!active);
 $('hangup').classList.toggle('hidden',!active);
 $('mic').disabled=!active||callRole!=='camera';$('camera').disabled=!active||callRole!=='camera';$('call').disabled=active||callJoining;
 $('watchCall').disabled=active||callJoining;
 $('shareCall').classList.toggle('hidden',!active||callRole!=='camera');
 updateSharingUI();
 $('mic').textContent='Mute mic';$('camera').textContent='Camera off';
 $('callStatus').textContent=active?(callRole==='spectator'?'Waiting for shared cameras…':'Connecting…'):'No one on camera yet';
 $('hangup').textContent=callRole==='spectator'?'Stop watching call':'Leave call';
 if(!active){callMinimized=false;callRole=null;sharingCall=false;}
 syncCallDock();showMembers();
}
async function leaveCall(send=true){
 if(send&&socket.connected&&callActive)socket.emit('call:leave');
 callActive=false;callJoining=false;
 [...connections.keys()].forEach(removePeer);
 localStream?.getTracks().forEach(t=>t.stop());localStream=null;
 videoTiles.get('self')?.tile.remove();videoTiles.delete('self');
 $('callGrid').replaceChildren();$('callOverlay').classList.add('hidden');setCallUI(false)
}
async function createPeer(id,initiator=false){
 if(connections.has(id))return connections.get(id);
 if(!callActive||(callRole==='camera'&&!localStream))return null;
 const pc=new RTCPeerConnection({iceServers:iceConfig.iceServers});connections.set(id,pc);
 const remote=new MediaStream();remoteStreams.set(id,remote);
 const showRemote=callRole==='spectator'||callUser(id)?.role==='camera';
 const video=showRemote?displayTile(id):null;if(video)video.srcObject=remote;
 if(callRole==='camera'&&localStream)localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
 else{pc.addTransceiver('audio',{direction:'recvonly'});pc.addTransceiver('video',{direction:'recvonly'})}
 pc.ontrack=e=>{const stream=remoteStreams.get(id);if(!stream)return;const tracks=e.streams?.[0]?.getTracks()||[e.track];for(const track of tracks)if(!stream.getTracks().some(t=>t.id===track.id))stream.addTrack(track);if(video){video.srcObject=stream;video.play().catch(()=>tileStatus(id,'Tap to play audio'))}};
 pc.onicecandidate=e=>{if(e.candidate&&socket.connected)socket.emit('call:signal',{to:id,data:{candidate:e.candidate.toJSON()}})};
 pc.onconnectionstatechange=()=>{
   if(connections.get(id)!==pc)return;
   const state=pc.connectionState;
   if(state==='connected'){
    pc._restartAttempts=0;
    const label=videoTiles.get(id)?.tile.querySelector('.tile-status');if(label)label.remove();
    $('callStatus').textContent='Connected';
   }else if(state==='failed'){
    tileStatus(id,iceConfig.relayAvailable?'Connection failed — retrying':'Connection failed — TURN relay needed');
    $('callStatus').textContent='Connection issue';
    const attempts=pc._restartAttempts||0;
    if(attempts>=2){toast('Unable to connect this person. Please try another network or configure TURN.');return}
    if(me<id&&pc.signalingState==='stable'){
      pc._restartAttempts=attempts+1;
      setTimeout(async()=>{
        if(connections.get(id)!==pc||pc.signalingState!=='stable'||!callActive)return;
        try{
          const offer=await pc.createOffer({iceRestart:true});
          await pc.setLocalDescription(offer);
          socket.emit('call:signal',{to:id,data:{description:pc.localDescription.toJSON()}});
        }catch(e){console.warn('ICE retry failed',e)}
      },1500*(attempts+1))
    }
   }else if(state==='disconnected')tileStatus(id,'Reconnecting…');
   else tileStatus(id,state)
  };
 if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('call:signal',{to:id,data:{description:pc.localDescription.toJSON()}})}
 return pc
}
async function drainCandidates(id,pc){const q=candidateQueues.get(id)||[];candidateQueues.delete(id);for(const c of q){try{await pc.addIceCandidate(c)}catch(e){console.warn('ICE candidate',e)}}}
async function onSignal({from,data}){
 if(!callActive||!participants.some(x=>x.id===from)||!data)return;
 try{
  const pc=await createPeer(from,false);if(!pc)return;
  if(data.description){
   await pc.setRemoteDescription(new RTCSessionDescription(data.description));
   await drainCandidates(from,pc);
   if(data.description.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('call:signal',{to:from,data:{description:pc.localDescription.toJSON()}})}
  }else if(data.candidate){
   if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
   else{if(!candidateQueues.has(from))candidateQueues.set(from,[]);candidateQueues.get(from).push(data.candidate)}
  }
 }catch(e){console.error('Call signaling failed',e);tileStatus(from,'Connection error');toast('Call signaling error. Try leaving and rejoining.')}
}
function updateSharingUI(){
 $('shareCall').textContent=sharingCall?'✓ Guests can see/hear me':'Allow guests to see/hear my camera';
 $('shareCall').setAttribute('aria-pressed',String(sharingCall))
}
async function joinCall(role='camera'){
 if(callActive||callJoining||!room)return;
 if(role==='camera'&&cameraMembers().length>=2){toast('Both camera seats are taken. Choose Watch the call instead.');return}
 callJoining=true;$('call').disabled=true;$('watchCall').disabled=true;
 $('callStatus').textContent=role==='camera'?'Requesting camera permission…':'Joining as spectator…';
 try{
  if(role==='camera')await getMedia();
  try{
   const params=new URLSearchParams({room,sid:socket.id||''});
   const response=await fetch('/api/rtc?'+params.toString(),{cache:'no-store'});
   if(response.ok){const config=await response.json();if(Array.isArray(config.iceServers))iceConfig=config}
  }catch(e){console.warn('RTC configuration unavailable:',e)}
  socket.timeout(10000).emit('call:join',{role},async(err,result)=>{
   if(err||result?.error){toast(result?.error||'Unable to join the call');leaveCall(false);return}
   callRole=result.role;callActive=true;callJoining=false;sharingCall=false;
   callMembers=result.callMembers||callMembers;
   if(callRole==='camera')displayTile('self',true).srcObject=localStream;
   setCallUI(true);
   if(callRole==='spectator')$('callNote').textContent='Guests see live cameras only when their owners approve. Your own camera and mic remain off.';
   try{for(const id of result.peers||[])await createPeer(id,true)}catch(e){console.warn('Participant connection failed:',e);toast('Some cameras may not connect on this network.')}
  })
 }catch(e){toast(e.message||'Camera and microphone permission denied');leaveCall(false)}
}
$('call').onclick=()=>joinCall('camera');
$('watchCall').onclick=()=>joinCall('spectator');
$('shareCall').onclick=()=>{
 if(!callActive||callRole!=='camera')return;
 const enabled=!sharingCall;
 socket.emit('call:share',{enabled},ack=>{
  if(ack?.error)return toast(ack.error);
  sharingCall=ack?.sharing===true;updateSharingUI();
  toast(sharingCall?'Guests can see and hear you':'Your camera is private to the other caller')
 });
};
$('hangup').onclick=()=>leaveCall(true);
$('mic').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(!t)return;t.enabled=!t.enabled;$('mic').textContent=t.enabled?'Mute mic':'Unmute mic'};
$('camera').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(!t)return;t.enabled=!t.enabled;$('camera').textContent=t.enabled?'Camera off':'Camera on'};
$('expandCall').onclick=()=>{$('callOverlay').classList.toggle('expanded');$('expandCall').textContent=$('callOverlay').classList.contains('expanded')?'⤡':'⤢'};
$('minimizeCall').onclick=()=>{if(!callActive)return;callMinimized=true;syncCallDock()};
$('callBubble').onclick=()=>{if(!callActive)return;callMinimized=false;syncCallDock()};

socket.on('call:peer-joined',d=>{if(callActive&&d.id!==me&&d.role==='camera')toast((participants.find(p=>p.id===d.id)?.name||'Someone')+' joined on camera')});
socket.on('call:publisher-available',async d=>{if(callActive&&callRole==='spectator'&&!connections.has(d.id)){
 try{await createPeer(d.id,true)}catch(e){console.warn('Spectator handshake failed',e)}
}});
socket.on('call:peer-left',d=>removePeer(d.id));
socket.on('call:signal',onSignal);
window.addEventListener('pagehide',()=>{theaterFallback=false;document.body.classList.remove('theater-lock');if(callActive)socket.emit('call:leave');localStream?.getTracks().forEach(t=>t.stop())});
