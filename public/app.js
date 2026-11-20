'use strict';
const $=id=>document.getElementById(id);
const socket=io({reconnection:true,reconnectionDelay:500});
const roomFromPath=location.pathname.match(/^\/room\/([a-f0-9]{24})$/)?.[1];
let room=null,me=null,participants=[],player=null,playerReady=false,ytReady=false,applying=false,lastState=null,version=0;
let roomQueue=[],searchReady=false,searching=false,autoJoinAttempted=false;
const displayedChatIds=new Set(),unplayableVideos=new Set();
try{for(const id of JSON.parse(sessionStorage.getItem('togetherly.unplayable')||'[]'))if(/^[\w-]{11}$/.test(id))unplayableVideos.add(id)}catch{}
function markUnplayable(id){if(!id||!/^[\w-]{11}$/.test(id))return;unplayableVideos.add(id);try{sessionStorage.setItem('togetherly.unplayable',JSON.stringify([...unplayableVideos].slice(-50)))}catch{}}
let localStream=null,callActive=false,callJoining=false,callAttempt=0,cameraInterrupted=false,cameraNeedsRejoin=false,
 iceConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
let callMembers=[],unread=0,chatOpen=false,callMinimized=false,callViewMode='compact',callRole=null,sharingCall=false;
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
function setupRoom(d){saveName(nickname());room=d.id;me=socket.id;participants=d.members||[];callMembers=d.callMembers||[];roomQueue=d.queue||[];renderQueue();lastState=d.state;version=d.state.version;$('landing').hidden=true;$('landing').style.display='none';$('watch').style.display='block';history.replaceState({},'', '/room/'+room);showMembers();$('chat').replaceChildren();displayedChatIds.clear();(d.messages||[]).forEach(m=>addMessage(m,false));updateChatConnection();applyState(d.state);initPlayer();startSpectatorView()}
function create(){const n=requireName();if(!n)return;socket.emit('create',{name:n},d=>{if(d?.error)return toast(d.error);if(d)setupRoom(d)})}
function join(){const n=requireName();if(!n)return;socket.emit('join',{id:roomFromPath||room,name:n},d=>{if(d?.error)return toast(d.error);if(d)setupRoom(d)})}
$('create').onclick=create;$('join').onclick=join;
if(roomFromPath){$('joinbox').classList.remove('hidden');$('create').textContent='Create a different room'}
$('copy').onclick=async()=>{const url=location.origin+'/room/'+room;try{await navigator.clipboard.writeText(url);toast('Invite link copied')}catch{prompt('Copy this room link:',url)}};
$('leave').onclick=()=>{setWebsiteExitGuard(false);leaveCall();location.href='/'};
function showMembers(){
 for(const [id,item] of videoTiles){if(id!=='self'){const label=item.tile.querySelector('.tile-label');if(label)label.textContent=participants.find(p=>p.id===id)?.name||'Participant'}}
 const box=$('members');box.replaceChildren();$('count').textContent=participants.length+' watching together';$('roomSeats').textContent=cameraMembers().length+'/2 camera seats';
 for(const m of participants){
  const row=document.createElement('div');row.className='member';
  const label=document.createElement('span'),avatar=document.createElement('span');
  avatar.className='avatar';avatar.textContent=m.name.charAt(0).toUpperCase();
  label.append(avatar,document.createTextNode(m.name+(m.id===me?' (you)':'')));row.append(label);
  const role=callUser(m.id),badge=document.createElement('span');badge.className='pill';
  badge.textContent=role?.role==='camera'?'On camera':'Watching';
  row.append(badge);box.append(row)
 }
 updateCallActions();
 updateMobilePeopleCount();
}
socket.on('members',m=>{participants=m;showMembers();for(const id of connections.keys())if(!participants.some(p=>p.id===id))removePeer(id)});
socket.on('call:members',members=>{
 callMembers=members;syncCallDock();showMembers();
 $('callStatus').textContent=callRole==='camera'?'On camera — visible to room':cameraNeedsRejoin?
  'Your camera was paused by a network interruption. Tap Join on camera to restart it.':
  cameraMembers().length?'Cameras appear automatically':'No one on camera yet';
 // Recover if a new publisher joined while passive viewers were reconnecting.
 if(callActive&&callRole==='spectator'){
  offerAvailableCameras(members.filter(m=>m.role==='camera'&&m.sharing).map(m=>m.id))
 }
});
function addMessage(m,notify=true){
 if(!m||typeof m.text!=='string')return;
 if(m.id&&displayedChatIds.has(m.id))return;
 if(m.id){displayedChatIds.add(m.id);if(displayedChatIds.size>120)displayedChatIds.delete(displayedChatIds.values().next().value)}
 const line=document.createElement('div');line.className='msg';
 const who=document.createElement('b');who.textContent=(m.name||'Participant')+': ';
 const content=document.createElement('span');content.textContent=m.text;
 line.append(who,content);$('chat').append(line);
 $('chat').scrollTop=$('chat').scrollHeight;
 if(notify&&!chatOpen&&(theaterActive()||matchMedia('(max-width:850px)').matches)){
  unread=Math.min(99,unread+1);
  for(const id of ['toolbarUnread','mobileNavUnread']){
    $(id).textContent=String(unread);$(id).classList.remove('hidden')
  }
 }
}
socket.on('chat:new',m=>addMessage(m));

socket.on('queue:update',items=>{roomQueue=Array.isArray(items)?items:[];renderQueue()});
function clip(text,n=100){return String(text||'').slice(0,n)}
function humanTitle(text){
 const map={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',hellip:'…'};
 return String(text||'').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|hellip);/gi,(_full,entity)=>{
  if(entity[0]==='#'){
   const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
   return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';
  }
  return map[entity.toLowerCase()]??_full;
 }).replace(/\s+/g,' ').trim();
}
function renderQueue(){
 $('queueCount').textContent=String(roomQueue.length);
 const parent=$('queueList');parent.replaceChildren();
 if(!roomQueue.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Nothing queued yet. Start a watch list for tonight.';parent.append(empty);return}
 roomQueue.forEach((item,index)=>{
  const row=document.createElement('div');row.className='queue-item';
  const count=document.createElement('span');count.className='queue-number';count.textContent=String(index+1).padStart(2,'0');
  const info=document.createElement('div');info.className='queue-info';
  const title=document.createElement('div');title.className='queue-title';
  title.textContent=humanTitle(item.title)||'YouTube video';title.title=title.textContent;
  const by=document.createElement('div');by.className='queue-sub';by.textContent='Added by '+clip(item.addedBy,25);
  info.append(title,by);
  const play=document.createElement('button');play.className='secondary-button small';play.textContent='Play';
  play.onclick=()=>socket.emit('queue:play',{id:item.id},res=>{if(res?.error)toast(res.error)});
  const remove=document.createElement('button');remove.className='text-button';remove.title='Remove from queue';remove.setAttribute('aria-label','Remove '+clip(item.title)+' from queue');remove.textContent='✕';
  remove.onclick=()=>socket.emit('queue:remove',{id:item.id},res=>{if(res?.error)toast(res.error)});
  if(/^[\w-]{11}$/.test(item.video||'')){
   const thumb=document.createElement('img');thumb.className='queue-thumb';thumb.src=youtubeThumbnail(item.video);thumb.alt='';thumb.loading='lazy';row.append(count,thumb,info,play,remove)
  }else row.append(count,info,play,remove);
  parent.append(row)
 })
}
function getRecents(){try{return JSON.parse(localStorage.getItem('togetherly.recents')||'[]').filter(x=>/^[\w-]{11}$/.test(x.id)).slice(0,10)}catch{return []}}
function saveRecent(item){
 if(!item?.id||!/^[\w-]{11}$/.test(item.id)||item.id==='M7lc1UVf-VE')return;
 const existing=getRecents().filter(x=>x.id!==item.id);
 existing.unshift({id:item.id,title:humanTitle(clip(item.title||'YouTube video',140)),channel:clip(item.channel||'',70)});
 try{localStorage.setItem('togetherly.recents',JSON.stringify(existing.slice(0,10)))}catch{}
 renderRecent()
}
function youtubeThumbnail(id){return 'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'}
function createResult(item){
 const row=document.createElement('div');row.className='video-result';
 const img=document.createElement('img');img.src=youtubeThumbnail(item.id);img.loading='lazy';img.alt='';
 const body=document.createElement('div');body.className='video-result-content';
 const title=document.createElement('div');title.className='video-result-title';title.textContent=humanTitle(clip(item.title,150));
 const channel=document.createElement('div');channel.className='video-result-channel';
 const blocked=unplayableVideos.has(item.id);
 channel.textContent=blocked?'This video is not available':clip(item.channel||'YouTube',80);
 const actions=document.createElement('div');actions.className='video-result-actions';
 const play=document.createElement('button');play.className='primary-button small';play.textContent=blocked?'Unavailable':'Watch now';play.disabled=blocked;
 play.onclick=()=>{
  const url='https://www.youtube.com/watch?v='+item.id;
  socket.emit('video',{url},result=>{if(result?.error)return toast(result.error);saveRecent(item);closeExplore();if(mobileIsCompact())mobileClosePanels()})
 };
 const queue=document.createElement('button');queue.className='secondary-button small';queue.textContent='+ Queue';queue.disabled=blocked;
 queue.onclick=()=>socket.emit('queue:add',{url:item.id,title:humanTitle(item.title)},result=>{if(result?.error)return toast(result.error);saveRecent(item);toast('Added to the watch queue')});
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
 $('searchHint').textContent=searchReady?'':'YouTube search needs an API key. You can still use recent videos, the shared queue, or paste a YouTube link.';
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
  $('searchHint').textContent=(data.items||[]).length?'':'No available videos found. Try another search.';
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

let chatSending=false;
function chatFeedback(message,failed=false){
 const element=$('chatFeedback');element.textContent=message;
 element.classList.toggle('failed',failed)
}
function updateChatConnection(){
 const live=socket.connected&&!!room;
 $('chatConnection').textContent=live?'● Connected':'○ Disconnected';
 $('chatConnection').classList.toggle('offline',!live);
 if(!live)chatFeedback('Connection lost. Your message will stay here until you reconnect.',true);
 else if(!chatSending)chatFeedback('')
}
$('chatForm').onsubmit=e=>{
 e.preventDefault();
 if(chatSending)return;
 const text=$('chatText').value.trim();
 if(!text){chatFeedback('Type a message first.');return}
 if(!socket.connected||!room){chatFeedback('Not connected. Reconnect before sending.',true);return}
 chatSending=true;$('chatSend').disabled=true;chatFeedback('Sending…');
 socket.timeout(9000).emit('chat:send',{text},(error,result)=>{
  chatSending=false;$('chatSend').disabled=false;
  if(error||!result?.ok){chatFeedback(result?.error||'Message could not be delivered. Try again.',true);return}
  if($('chatText').value.trim()===text)$('chatText').value='';
  chatFeedback('Sent ✓');$('chatText').focus();
 })
};
function updateChatViewport(){
 const vp=window.visualViewport;
 const top=Math.max(0,Math.round(vp?.offsetTop||0));
 const height=Math.max(110,Math.round(vp?.height||window.innerHeight));
 const typing=chatOpen&&document.activeElement===$('chatText');
 document.documentElement.style.setProperty('--chat-visible-top',top+'px');
 document.documentElement.style.setProperty('--chat-visible-height',height+'px');
 document.body.classList.toggle('chat-typing',typing);
 theaterShell.classList.toggle('chat-typing',typing);
}
function toggleChat(show){
 if(show&&theaterActive())return;
 chatOpen=Boolean(show);
 $('chatPanel').classList.toggle('chat-open',chatOpen);
 $('toolbarChat').setAttribute('aria-expanded',String(chatOpen));
 $('toolbarChat').setAttribute('aria-label',chatOpen?'Close chat':'Open chat');
 if(chatOpen){
  unread=0;
  $('toolbarUnread').classList.add('hidden');
  $('mobileNavUnread').classList.add('hidden');
  // On mobile, opening messages must not automatically summon the keyboard.
  if(!theaterActive()&&!matchMedia('(max-width:860px)').matches)setTimeout(()=>$('chatText').focus(),50)
 }else if(document.activeElement===$('chatText'))$('chatText').blur();
 updateChatViewport();
 updateMobileChrome();
}
$('toolbarChat').onclick=()=>toggleChat(!chatOpen);
$('closeChat').onclick=()=>toggleChat(false);
$('chatText').addEventListener('focus',updateChatViewport);
$('chatText').addEventListener('blur',()=>{updateChatViewport();setTimeout(updateChatViewport,180)});
window.visualViewport?.addEventListener('resize',updateChatViewport);
window.visualViewport?.addEventListener('scroll',updateChatViewport);
window.addEventListener('resize',updateChatViewport);
window.addEventListener('orientationchange',()=>setTimeout(updateChatViewport,250));
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape')return;
 if(chatOpen){toggleChat(false);return}
 if(theaterFallback){theaterFallback=false;updateTheaterUI()}
});

// Fullscreen the video canvas only. Chat stays outside, available after leaving fullscreen.
const theaterShell=$('videoShell');
let theaterFallback=false;
function theaterActive(){return document.fullscreenElement===theaterShell||theaterFallback}
function updateTheaterUI(){
 const active=theaterActive();
 theaterShell.classList.toggle('theater-mode',active);
 theaterShell.classList.toggle('pseudo-fullscreen',theaterFallback);
 document.body.classList.toggle('theater-lock',active);
 $('fullscreenToggle').setAttribute('aria-pressed',String(active));
 $('fullscreenToggle').setAttribute('aria-label',active?'Exit watch fullscreen':'Enter watch fullscreen');
 $('toolbarFullscreen').setAttribute('aria-pressed',String(active));
 $('theaterLabel').textContent=active?'Exit fullscreen':'Fullscreen';
 if(active&&chatOpen)toggleChat(false);
 updateChatViewport();
}
async function toggleTheater(){
 if(theaterActive()){
  if(document.fullscreenElement===theaterShell){
   try{await document.exitFullscreen()}catch(e){console.warn('Could not exit fullscreen',e)}
  }else theaterFallback=false;
  updateTheaterUI();return;
 }
 // The chat panel intentionally stays outside fullscreen and never opens over the movie.
 if(chatOpen)toggleChat(false);
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
$('toolbarFullscreen').onclick=toggleTheater;
document.addEventListener('fullscreenchange',()=>{
 if(document.fullscreenElement!==theaterShell&&theaterFallback===false){updateTheaterUI()}
 else updateTheaterUI();
});

$('load').onclick=()=>{if(!room)return;socket.emit('video',{url:$('videoURL').value},d=>{
 if(d?.error)toast(d.error);
 else if(mobileIsCompact())mobileClosePanels();
})};
// Movies and YouTube are now separate, discoverable tabs.
let activeSourceTab='movies';
function setSourceTab(tab){
 activeSourceTab=tab==='youtube'?'youtube':'movies';
 const movies=activeSourceTab==='movies';
 $('tabMovies').classList.toggle('is-active',movies);
 $('tabYouTube').classList.toggle('is-active',!movies);
 $('tabMovies').setAttribute('aria-selected',String(movies));
 $('tabYouTube').setAttribute('aria-selected',String(!movies));
 $('movieSourcePanel').classList.toggle('hidden',!movies);
 $('youtubeSourcePanel').classList.toggle('hidden',movies);
}
$('tabMovies').onclick=()=>setSourceTab('movies');

$('tabYouTube').onclick=()=>setSourceTab('youtube');
$('youtubeBrowse').onclick=()=>openExplore();
setSourceTab('movies');

/* Mobile watch-first navigation. Keep actual video/rooms/chats in their
   original DOM containers; only reveal lightweight sheets on touch layouts. */
const mobileIsCompact=()=>matchMedia('(max-width:800px), (pointer:coarse) and (max-width:1050px)').matches;
let mobileSheet=null,mobileSheetReturnFocus=null;
function mobileSetCurrent(destination){
 for(const [name,id] of [['watch','mobileNavWatch'],['choose','mobileNavChoose'],
  ['people','mobileNavPeople'],['chat','mobileNavChat']]){
  const node=$(id),selected=name===destination;
  node.classList.toggle('is-current',selected);
  if(selected)node.setAttribute('aria-current','page');
  else node.removeAttribute('aria-current');
 }
}
function updateMobilePeopleCount(){
 $('mobileNavPeopleCount').textContent=String(participants.length||1);
}
function updateMobileChrome(){
 const compact=mobileIsCompact();
 const picker=compact&&mobileSheet==='choose';
 const people=compact&&mobileSheet==='people';
 const messaging=compact&&chatOpen;
 const any=picker||people||messaging;
 $('mobilePickerPanel').classList.toggle('mobile-open',picker);
 $('peoplePanel').classList.toggle('mobile-open',people);
 $('mobileSheetBackdrop').classList.toggle('hidden',!any);
 document.body.classList.toggle('mobile-sheet-open',picker||people);
 document.body.classList.toggle('mobile-chat-open',messaging);
 $('mobileNavChoose').setAttribute('aria-expanded',String(picker));
 $('mobileNavPeople').setAttribute('aria-expanded',String(people));
 $('mobileNavChat').setAttribute('aria-expanded',String(messaging));
 for(const [id,shown] of [['mobilePickerPanel',picker],['peoplePanel',people]]){
  const panel=$(id);
  if(shown){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true')}
  else{panel.removeAttribute('role');panel.removeAttribute('aria-modal')}
 }
 mobileSetCurrent(picker?'choose':people?'people':messaging?'chat':'watch');
}
function mobileClosePanels(closeChat=true){
 const wasOpen=Boolean(mobileSheet||chatOpen);
 mobileSheet=null;
 if(closeChat&&chatOpen)toggleChat(false);
 else updateMobileChrome();
 if(wasOpen&&mobileIsCompact()){
  const target=mobileSheetReturnFocus;
  mobileSheetReturnFocus=null;
  if(target?.isConnected&&typeof target.focus==='function')target.focus({preventScroll:true});
 }
}
function mobileShowSheet(name){
 if(!mobileIsCompact())return;
 if(theaterActive()){toggleTheater().then(()=>mobileShowSheet(name));return}
 const next=mobileSheet===name?null:name;
 if(!mobileSheet&&!chatOpen)mobileSheetReturnFocus=document.activeElement;
 if(chatOpen)toggleChat(false);
 mobileSheet=next;updateMobileChrome();
 if(next==='choose')$('mobileClosePicker').focus({preventScroll:true});
 else if(next==='people')$('mobileClosePeople').focus({preventScroll:true});
 else if(!next)mobileClosePanels(false);
}
$('mobileNavWatch').onclick=()=>{
 mobileClosePanels();
 $('videoShell').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
};
$('mobileNavChoose').onclick=()=>mobileShowSheet('choose');
$('mobileNavPeople').onclick=()=>mobileShowSheet('people');
$('mobileNavChat').onclick=async()=>{
 if(theaterActive())await toggleTheater();
 const open=!chatOpen;
 if(!mobileSheet&&!chatOpen)mobileSheetReturnFocus=document.activeElement;
 mobileSheet=null;
 toggleChat(open);
};
$('mobileClosePicker').onclick=()=>mobileClosePanels();
$('mobileClosePeople').onclick=()=>mobileClosePanels();
$('mobileSheetBackdrop').onclick=()=>mobileClosePanels();
// Touching Close while the keyboard is up can resize the viewport before
// mouseup/click fires. Close on pointerdown; retain click for keyboard/AT.
function onMobileChatClose(event){
 if(!mobileIsCompact()||!chatOpen)return;
 event.preventDefault();
 event.stopPropagation();
 if(event.type==='click')event.stopImmediatePropagation();
 mobileClosePanels();
}
$('closeChat').addEventListener('pointerdown',onMobileChatClose,true);
$('closeChat').addEventListener('click',onMobileChatClose,true);
$('mobileRename').onclick=()=>$('rename').click();
$('mobileLeave').onclick=()=>$('leave').click();
$('mobileCatchup').onclick=()=>movieCatchupNow();
$('mobileQueueToggle').onclick=()=>{
 const parent=document.querySelector('#watch .watch-queue'),expanded=parent.classList.toggle('is-open');
 $('mobileQueueToggle').setAttribute('aria-expanded',String(expanded));
 $('mobileQueueToggle').innerHTML=expanded?'Hide queue <span aria-hidden="true">⌃</span>':
  'Show queue <span aria-hidden="true">⌄</span>';
};
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&mobileIsCompact()&&(mobileSheet||chatOpen)){
  event.preventDefault();mobileClosePanels();
 }
});
window.addEventListener('resize',()=>{
 if(!mobileIsCompact()&&(mobileSheet||document.body.classList.contains('mobile-chat-open'))){
  mobileSheet=null;updateMobileChrome()
 }
});
updateMobileChrome();
updateMobilePeopleCount();

// Streambert-inspired movie catalogue. TMDB supplies metadata only; sources are
// provider-controlled embedded sites, not direct playable video under our control.
// Movie IDs are internal to the catalogue. Viewers select a title instead.
let catalogChoice=null,catalogSearchTimer=null,catalogSearchController=null,catalogSearchSequence=0;
let catalogEpisodeCounts=null,catalogEpisodeLoading=false,catalogEpisodeLookup=0,catalogPlaySequence=0;
function catalogEpisodeFields(){
 const tv=$('catalogType').value==='tv';
 document.querySelectorAll('#movieCatalog .catalog-tv-only').forEach(n=>n.classList.toggle('hidden',!tv));
 $('catalogEpisodeHelp').classList.toggle('hidden',!tv);
}
function catalogUpdateEpisodeGuide(){
 const tv=$('catalogType').value==='tv',help=$('catalogEpisodeHelp');
 if(!tv){help.classList.add('hidden');$('catalogPlay').disabled=false;return}
 help.classList.remove('hidden');
 const season=Number($('catalogSeason').value),episode=Number($('catalogEpisode').value);
 let invalid=false;
 if(catalogEpisodeLoading){
  help.textContent='Checking available seasons and episodes…';
 }else if(Array.isArray(catalogEpisodeCounts)){
  const found=catalogEpisodeCounts.find(x=>x.season===season);
  if(!found){
   help.textContent='Season '+season+' is not listed in TMDB. Choose an available season.';
   invalid=true;
  }else if(episode<1||episode>found.episodes){
   help.textContent='Season '+season+' has '+found.episodes+' listed episodes. Choose episode 1–'+found.episodes+'.';
   invalid=true;
  }else{
   help.textContent='Season '+season+' · episode '+episode+' of '+found.episodes+' listed by TMDB. Player availability is not guaranteed.';
  }
 }else{
  help.textContent='Episode counts could not be verified. Check the season and episode manually before sharing.';
 }
 $('catalogPlay').disabled=catalogEpisodeLoading||invalid;
}
async function catalogLoadTvEpisodes(id){
 const seq=++catalogEpisodeLookup;
 catalogEpisodeLoading=true;catalogEpisodeCounts=null;catalogUpdateEpisodeGuide();
 try{
  const response=await fetch('/api/catalog/tv/'+encodeURIComponent(id)+'/seasons',{credentials:'same-origin'});
  const payload=await response.json();
  if(seq!==catalogEpisodeLookup||catalogChoice?.id!==id||catalogChoice?.type!=='tv')return;
  if(!response.ok)throw Error(payload.error||'Episode lookup unavailable');
  catalogEpisodeCounts=(Array.isArray(payload.seasons)?payload.seasons:[])
    .filter(x=>Number.isSafeInteger(x.season)&&x.season>=1&&x.season<=99&&
      Number.isSafeInteger(x.episodes)&&x.episodes>=1&&x.episodes<=999);
  // A season may be numbered non-contiguously, so pick the first real season.
  if(catalogEpisodeCounts.length&&!catalogEpisodeCounts.some(x=>x.season===Number($('catalogSeason').value)))
   $('catalogSeason').value=String(catalogEpisodeCounts[0].season);
  catalogEpisodeLoading=false;catalogUpdateEpisodeGuide();
 }catch(error){
  if(seq!==catalogEpisodeLookup||catalogChoice?.id!==id||catalogChoice?.type!=='tv')return;
  catalogEpisodeLoading=false;catalogEpisodeCounts=null;catalogUpdateEpisodeGuide();
 }
}
function catalogClearSelection(){
 catalogEpisodeLookup++;catalogPlaySequence++;catalogEpisodeLoading=false;catalogEpisodeCounts=null;
 catalogChoice=null;
 $('movieCatalog').classList.remove('is-title-selected');
 $('catalogId').value='';
 $('catalogShareFeedback').textContent='';
 $('catalogShareFeedback').classList.add('hidden');
 $('catalogSelectedPoster').removeAttribute('src');
 $('catalogSelectedPoster').classList.add('hidden');
 $('catalogSelectedDescription').textContent='';
 $('catalogSelectedDescription').classList.add('hidden');
 $('catalogPlayForm').classList.add('hidden');
 $('catalogEpisodeHelp').classList.add('hidden');
 $('catalogPlay').disabled=false;
 document.querySelectorAll('#catalogResults .catalog-result').forEach(button=>{
  button.classList.remove('is-selected');button.setAttribute('aria-pressed','false');
 });
}
function catalogSelectTitle(item){
 if(!item||!Number.isSafeInteger(item.id)||!['movie','tv'].includes(item.type))return;
 catalogClearSelection();
 catalogChoice={id:item.id,type:item.type,title:item.title};
 const posterUrl=typeof item.poster==='string'&&item.poster.startsWith('https://image.tmdb.org/t/p/w92/')?item.poster:null;
 if(posterUrl){
  $('catalogSelectedPoster').src=posterUrl;
  $('catalogSelectedPoster').classList.remove('hidden');
 }
 const description=typeof item.description==='string'?item.description.trim().slice(0,165):'';
 $('catalogSelectedDescription').textContent=description;
 $('catalogSelectedDescription').classList.toggle('hidden',!description);
 $('catalogType').value=item.type;
 $('catalogId').value=String(item.id);
 $('catalogSeason').value='1';$('catalogEpisode').value='1';
 $('catalogSelectedTitle').textContent=item.title;
 $('catalogSelectedMeta').textContent=(item.type==='movie'?'Movie':'TV series')+
  (item.year?' · '+item.year:'');
 catalogEpisodeFields();
 $('catalogPlayForm').classList.remove('hidden');
 $('movieCatalog').classList.add('is-title-selected');
 $('catalogStatus').textContent='Selected '+item.title+' — not shared yet. Use Watch with room to change what guests see.';
 catalogUpdateEpisodeGuide();
 if(item.type==='tv')catalogLoadTvEpisodes(item.id);
 document.querySelectorAll('#catalogResults .catalog-result').forEach(button=>{
  const selected=button.dataset.catalogKey===item.type+':'+item.id;
  button.classList.toggle('is-selected',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 if(mobileIsCompact()){
  if(document.activeElement===$('catalogQuery'))$('catalogQuery').blur();
  $('mobilePickerPanel').scrollTop=0;
 }else $('catalogPlayForm').scrollIntoView?.({behavior:'smooth',block:'nearest'});
}
function catalogShowResults(results,source){
 const out=$('catalogResults');
 out.replaceChildren();
 for(const item of results){
  if(!Number.isSafeInteger(item.id)||!['movie','tv'].includes(item.type))continue;
  const row=document.createElement('button');
  row.type='button';
  row.className='catalog-result';
  row.dataset.catalogKey=item.type+':'+item.id;
  row.setAttribute('aria-pressed','false');
  const poster=document.createElement('span');poster.className='catalog-result-poster';
  if(typeof item.poster==='string'&&item.poster.startsWith('https://image.tmdb.org/t/p/w92/')){
   const img=document.createElement('img');img.src=item.poster;img.alt='';img.loading='lazy';
   poster.append(img);
  }else poster.textContent=item.type==='tv'?'📺':'🎬';
  const details=document.createElement('span');details.className='catalog-result-details';
  const title=document.createElement('strong');title.textContent=item.title;
  const subtitle=document.createElement('small');
  subtitle.textContent=(item.type==='movie'?'Movie':'TV series')+
   (item.year?' · '+item.year:'');
  details.append(title,subtitle);
  if(item.description){
   const info=document.createElement('small');
   info.textContent=String(item.description).slice(0,90);
   details.append(info);
  }
  const action=document.createElement('span');action.className='catalog-result-action';
  action.textContent='Select';
  row.append(poster,details,action);
  row.onclick=()=>catalogSelectTitle(item);
  out.append(row);
 }
 $('catalogResultCount').textContent=String(out.childElementCount)+' titles';
 $('catalogResultHeading').classList.toggle('hidden',out.childElementCount===0);
 $('catalogStatus').textContent=out.childElementCount
  ?'Choose a title from the results.'+
    (source==='Wikidata'?' Limited results from Wikidata; some titles may be missing.':'')
  :'No matching movies or series found. Try a different spelling or more of the title.';
}
async function catalogSearchNow(){
 const q=$('catalogQuery').value.trim();
 if(catalogSearchController)catalogSearchController.abort();
 catalogSearchController=null;
 const searchId=++catalogSearchSequence;
 $('catalogResultHeading').classList.add('hidden');
 if(q.length<2){
  $('catalogResults').replaceChildren();
  $('catalogStatus').textContent='Type at least two characters to see suggestions.';
  return;
 }
 $('catalogStatus').textContent='Finding movies and series…';
 $('catalogResults').replaceChildren();
 const controller=new AbortController();
 catalogSearchController=controller;
 try{
  const response=await fetch('/api/catalog/search?q='+encodeURIComponent(q),{
   credentials:'same-origin',signal:controller.signal
  });
  const data=await response.json();
  if(searchId!==catalogSearchSequence)return;
  if(!response.ok)throw Error(data.error||'Movie search failed');
  catalogShowResults(Array.isArray(data.results)?data.results:[],data.source);
 }catch(error){
  if(controller.signal.aborted||searchId!==catalogSearchSequence)return;
  $('catalogStatus').textContent=error?.message||'Movie search is temporarily unavailable.';
  $('catalogResults').replaceChildren();
 }
}
$('catalogQuery').addEventListener('input',()=>{
 clearTimeout(catalogSearchTimer);
 if(catalogSearchController)catalogSearchController.abort();
 catalogSearchSequence++;
 catalogClearSelection();
 if($('catalogQuery').value.trim().length<2){
  catalogSearchNow();return;
 }
 catalogSearchTimer=setTimeout(catalogSearchNow,390);
});
$('catalogSearchForm').onsubmit=event=>{
 event.preventDefault();
 clearTimeout(catalogSearchTimer);
 catalogClearSelection();
 catalogSearchNow();
};
document.querySelectorAll('#catalogExamples .catalog-example').forEach(button=>{
 button.onclick=()=>{
  $('catalogQuery').value=button.dataset.catalogQuery||'';
  $('catalogQuery').focus();
  catalogClearSelection();
  clearTimeout(catalogSearchTimer);
  catalogSearchNow();
 };
});
$('catalogChangeTitle').onclick=()=>{
 catalogClearSelection();
 if(mobileIsCompact())$('mobilePickerPanel').scrollTop=0;
 $('catalogQuery').focus();
 $('catalogStatus').textContent='Choose another result or search for a different title.';
};
catalogEpisodeFields();
$('catalogSeason').addEventListener('input',()=>{
 $('catalogEpisode').value='1';
 catalogUpdateEpisodeGuide();
});
$('catalogEpisode').addEventListener('input',catalogUpdateEpisodeGuide);
$('catalogPlayForm').onsubmit=event=>{
 event.preventDefault();
 if(!room)return toast('Join a room before sharing a movie');
 const type=$('catalogType').value,id=Number($('catalogId').value);
 if(!catalogChoice||catalogChoice.id!==id||catalogChoice.type!==type){
  return toast('Select a movie or series from the suggestions first');
 }
 const season=Number($('catalogSeason').value),episode=Number($('catalogEpisode').value);
 if(type==='tv'&&catalogEpisodeLoading)return toast('Wait for the episode list to load');
 const knownSeason=Array.isArray(catalogEpisodeCounts)?
  catalogEpisodeCounts.find(x=>x.season===season):null;
 if(type==='tv'&&(!Number.isSafeInteger(season)||season<1||season>99||
  !Number.isSafeInteger(episode)||episode<1||episode>999||
  (Array.isArray(catalogEpisodeCounts)&&(!knownSeason||episode>knownSeason.episodes)))){
  return toast('Choose an available season and episode');
 }
 const requestId=++catalogPlaySequence,choiceId=catalogChoice.id,choiceType=catalogChoice.type;
 const button=$('catalogPlay');button.disabled=true;
 $('catalogShareFeedback').textContent='Starting this title for your room…';
 $('catalogShareFeedback').classList.remove('hidden');
 $('catalogStatus').textContent='Sharing '+catalogChoice.title+' with your room…';
 socket.timeout(9000).emit('catalog:play',{
  type,id,season,episode,provider:$('catalogProvider').value,title:catalogChoice.title
 },(error,ack)=>{
  if(requestId!==catalogPlaySequence||catalogChoice?.id!==choiceId||catalogChoice?.type!==choiceType)return;
  catalogUpdateEpisodeGuide();
  if(error||ack?.error){
   const message=ack?.error||'Could not load this source';
   $('catalogStatus').textContent=message;
   $('catalogShareFeedback').textContent=message;
   $('catalogShareFeedback').classList.remove('hidden');
   return;
  }
  $('catalogShareFeedback').textContent='';
  $('catalogShareFeedback').classList.add('hidden');
  $('catalogStatus').textContent='Shared with room. Guests load near the estimated room time; actual player timing may differ.';
  if(mobileIsCompact())mobileClosePanels();
 });
};
let ytScriptStarted=false,playerTimeout=null;
function playerHelp(message,error=false){
 $('playerMessage').textContent=message;$('playerFallback').classList.remove('hidden');
 $('retryPlayer').textContent=error?'Try again':'Retry player';
 $('youtubeLink').href=lastState?.video?'https://www.youtube.com/watch?v='+encodeURIComponent(lastState.video):'https://www.youtube.com/';
}
function playerReadyUI(){clearTimeout(playerTimeout);$('playerFallback').classList.add('hidden');$('chooseAnother').classList.add('hidden');$('retryPlayer').classList.remove('hidden');notice('')}
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
  onStateChange:e=>{if(applying||!room||!playerReady||lastState?.source==='website')return;if(e.data===YT.PlayerState.PLAYING)sendPlayback('play');else if(e.data===YT.PlayerState.PAUSED)sendPlayback('pause')},
  onAutoplayBlocked:()=>notice('Your browser blocked autoplay. Tap the YouTube player to start.'),
  onError:e=>{
   const blocked=[100,101,150].includes(e.data);
   if(blocked)markUnplayable(lastState?.video);
   console.warn('YouTube embedded playback failed',e.data);
   playerHelp('This video is not available. Choose something else.',true);
   $('chooseAnother').classList.remove('hidden');
   if(blocked)$('retryPlayer').classList.add('hidden');
  }
 }})}catch(e){player=null;playerHelp('Could not start YouTube player: '+e.message,true)}
}
$('chooseAnother').onclick=()=>openExplore();
$('retryPlayer').onclick=()=>{
 clearTimeout(playerTimeout);
 if(player){try{player.destroy()}catch{}player=null}
 playerReady=false;const div=document.createElement('div');div.id='player';
 $('videoShell').querySelector('#player')?.remove();$('videoShell').prepend(div);
 if(!ytReady){document.getElementById('ytApiTag')?.remove();ytScriptStarted=false}playerHelp('Retrying YouTube…');loadYouTubeAPI();
};
loadYouTubeAPI();
function sendPlayback(action){if(!playerReady||applying||lastState?.source==='website')return;const p=player.getCurrentTime();if(!Number.isFinite(p))return;socket.emit('playback',{action,position:p,version});if(lastState){lastState={...lastState,position:p,playing:action==='play'?true:action==='pause'?false:lastState.playing}}}
// The external movie provider needs unsandboxed compatibility to play reliably.
// Grant compatibility ONLY to exact server-verified catalogue URLs; all other
// frames retain a restrictive sandbox. Unrestricted external iframes can open
// popups and attempt redirects; a beforeunload guard is best-effort, not a blocker.
// Native child fullscreen remains disallowed so Togetherly Theater shows cameras.
const WEBSITE_FRAME_SANDBOX='allow-scripts allow-same-origin allow-forms';
const CATALOG_ALLOWED_PLAYERS=Object.freeze({
 vidfast:{movie:id=>'https://vidfast.vc/movie/'+id,tv:(id,s,e)=>'https://vidfast.vc/tv/'+id+'/'+s+'/'+e}
});
let websiteSelectedUrl=null,websiteStoppedFor=null,websiteExitGuardArmed=false;
const MOVIE_CONTROL_WINDOW_MS=12000;
let websiteControlsUnlocked=false,websiteControlTimer=null;
function setWebsiteClickGuard(unlocked=false){
 if(websiteControlTimer){clearTimeout(websiteControlTimer);websiteControlTimer=null}
 const active=Boolean(websiteSelectedUrl&&
  websiteStoppedFor!==websiteSelectedUrl&&$('websiteFrame').hasAttribute('src'));
 websiteControlsUnlocked=Boolean(active&&unlocked);
 $('websiteClickShield').classList.toggle('hidden',!active||websiteControlsUnlocked);
 const toggle=$('websiteInteractionToggle');
 toggle.classList.toggle('hidden',!active);
 toggle.textContent=websiteControlsUnlocked?'◈ Lock player':'◈ Use controls';
 toggle.setAttribute('aria-pressed',String(websiteControlsUnlocked));
 toggle.setAttribute('aria-label',websiteControlsUnlocked?'Lock movie player interactions':'Temporarily unlock movie player controls');
 if(websiteControlsUnlocked)websiteControlTimer=setTimeout(()=>{
  websiteControlTimer=null;
  setWebsiteClickGuard(false);
 },MOVIE_CONTROL_WINDOW_MS);
}
function toggleWebsiteControls(){
 if(!websiteSelectedUrl||websiteStoppedFor===websiteSelectedUrl)return;
 const unlock=!websiteControlsUnlocked;
 setWebsiteClickGuard(unlock);
 if(unlock)toast('Controls unlocked for 12 seconds. Third-party clicks may open tabs.');
}
$('websiteInteractionToggle').onclick=toggleWebsiteControls;
$('websiteUnlock').onclick=event=>{event.stopPropagation();toggleWebsiteControls()};
$('websiteClickShield').onclick=()=>toast('Protected view is on. Use controls to interact with this external player.');

let websiteSelectedVersion=null,movieSnapshot=null,movieSnapshotAt=0;
let movieFrameEventsSeen=false,movieFrameLastProgress=null,movieFrameLastProgressAt=0;
let movieFrameLastPlaying=null,movieLastPlaybackCommandAt=0;
let movieLastReportedAt=0,movieLastCorrectionAt=0;
function verifiedCatalogPlayer(s){
 const c=s?.catalog,p=CATALOG_ALLOWED_PLAYERS[c?.provider];
 if(!p||!['movie','tv'].includes(c.type))return false;
 const id=Number(c.id),season=Number(c.season),episode=Number(c.episode);
 if(!Number.isSafeInteger(id)||id<1||id>999999999)return false;
 if(c.type==='tv'&&(!Number.isSafeInteger(season)||season<1||season>99||
  !Number.isSafeInteger(episode)||episode<1||episode>999))return false;
 const expected=c.type==='movie'?p.movie(id):p.tv(id,season,episode);
 return s.websiteUrl===expected;
}
// VidFast documents startAt, but does not guarantee that play/pause/seek messages
// work in every embedded player. Never access cross-origin iframe DOM.
const MOVIE_PLAYER_ORIGIN='https://vidfast.vc';
function movieClockNow(){
 if(!movieSnapshot)return null;
 return Math.max(0,Math.min(86400,movieSnapshot.position+
  (movieSnapshot.playing?Math.max(0,(Date.now()-movieSnapshotAt)/1000):0)));
}
function moviePositionText(seconds){
 if(!Number.isFinite(seconds))return '--:--';
 const n=Math.max(0,Math.floor(seconds)),h=Math.floor(n/3600);
 const m=String(Math.floor(n%3600/60)).padStart(h?2:1,'0');
 const sec=String(n%60).padStart(2,'0');
 return (h?h+':':'')+m+':'+sec;
}
function movieParseTime(input){
 const parts=String(input||'').trim().split(':');
 if(parts.length<2||parts.length>3||parts.some(x=>!/^\d{1,2}$/.test(x)))return null;
 const values=parts.map(Number);
 if(values.at(-1)>59||(parts.length===3&&values[1]>59))return null;
 const seconds=values.reduce((acc,v)=>acc*60+v,0);
 return Number.isFinite(seconds)&&seconds<=86400?seconds:null;
}
function movieIsHost(){
 return Boolean(room&&me&&lastState?.websiteLeader===me);
}
function movieUpdateSnapshot(t){
 if(!t||t.version!==lastState?.version)return;
 if(!Number.isFinite(t.position)||t.position<0||t.position>86400||typeof t.playing!=='boolean')return;
 movieSnapshot={...t};
 movieSnapshotAt=Date.now();
 updateMovieSyncUI();
}
function updateMovieSyncUI(){
 const active=lastState?.source==='website'&&verifiedCatalogPlayer(lastState);
 $('movieRoomSync').classList.toggle('hidden',!active);
 $('mobileCatchup').classList.toggle('hidden',!active);
 if(!active)return;
 const current=movieClockNow();
 const prefix=movieSnapshot?.origin==='player'?'Player-reported':'Estimated';
 $('movieSyncStatus').textContent=prefix+' room time: '+moviePositionText(current)+
  (movieSnapshot?.playing?' · playing':' · paused');
 const host=movieIsHost();
 $('movieHostControls').classList.toggle('hidden',!host);
 $('moviePlayClock').disabled=!host||Boolean(movieSnapshot?.playing&&movieSnapshot?.origin!=='estimated');
 $('moviePauseClock').disabled=!host||!movieSnapshot?.playing;
 $('movieSyncHint').textContent=host
  ?'If playback starts late or you seek, update the room clock. Exact sync is not guaranteed.'
  :'Tap Catch up to jump near the room time. Actual playback can drift.';
}
function movieEmbedUrl(base,timeline){
 const url=new URL(base);
 const position=Number(timeline?.position);
 if(Number.isFinite(position)&&position>0)url.searchParams.set('startAt',String(Math.floor(Math.min(86400,position))));
 if(timeline?.playing===true)url.searchParams.set('autoPlay','true');
 return url.toString();
}
function movieSendControl(action,position,playing,then){
 if(!movieIsHost()||!Number.isFinite(position)||position<0||position>86400)return;
 const payload={action,position,version:lastState.version};
 if(action==='sample')payload.playing=Boolean(playing);
 socket.timeout(9000).emit('movie:control',payload,(error,ack)=>{
  if(error||!ack?.ok){if(action!=='sample')toast(ack?.error||'Could not update room time');return}
  if(ack.timeline)movieUpdateSnapshot(ack.timeline);
  if(typeof then==='function')then();
 });
}
function moviePostCommand(command,time){
 if(!movieFrameEventsSeen||!websiteSelectedUrl||!verifiedCatalogPlayer(lastState))return false;
 const target=$('websiteFrame').contentWindow;
 if(!target)return false;
 try{
  target.postMessage(command==='seek'?{command:'seek',time}: {command},MOVIE_PLAYER_ORIGIN);
  return true;
 }catch{return false}
}
function movieCatchupNow(){
 if(!websiteSelectedUrl||!verifiedCatalogPlayer(lastState))return;
 const pos=movieClockNow();
 if(pos===null)return toast('Waiting for the room timeline');
 websiteStoppedFor=null;
 loadWebsiteFrame(movieEmbedUrl(websiteSelectedUrl,{position:pos,playing:movieSnapshot?.playing}),true);
 websiteSelectedVersion=lastState.version;
 updateWebsitePlayerActions(websiteSelectedUrl);
 toast('Loaded near '+moviePositionText(pos)+'. Press Play if your browser blocks autoplay.');
}
$('movieCatchup').onclick=movieCatchupNow;
$('moviePlayClock').onclick=()=>{
 const firstStart=movieSnapshot?.origin==='estimated'&&!movieFrameEventsSeen;
 const position=firstStart?0:(movieFrameLastProgress!==null&&movieFrameEventsSeen?
  movieFrameLastProgress:movieClockNow()??0);
 movieSendControl('play',position);
};
$('moviePauseClock').onclick=()=>{
 const position=movieFrameLastProgress!==null&&movieFrameEventsSeen?
  movieFrameLastProgress:movieClockNow()??0;
 movieSendControl('pause',position);
};
$('movieSetTime').onclick=()=>{
 const seconds=movieParseTime($('movieTimeInput').value);
 if(seconds===null)return toast('Enter a time such as 12:34 or 1:02:15');
 movieSendControl('seek',seconds,null,()=>{
  if(!moviePostCommand('seek',seconds))movieCatchupNow();
 });
};
function movieCorrectGuestDrift(){
 if(!room||movieIsHost()||!movieFrameEventsSeen||!movieSnapshot||
  !verifiedCatalogPlayer(lastState)||websiteStoppedFor===websiteSelectedUrl)return;
 const target=movieClockNow();
 if(target===null||movieFrameLastProgress===null)return;
 const now=Date.now();
 const local=movieFrameLastProgress+
  (movieFrameLastPlaying?Math.max(0,(now-movieFrameLastProgressAt)/1000):0);
 if(Math.abs(local-target)>6&&now-movieLastCorrectionAt>15000){
  movieLastCorrectionAt=now;moviePostCommand('seek',Math.floor(target));
 }
}
window.addEventListener('message',event=>{
 if(event.origin!==MOVIE_PLAYER_ORIGIN||!websiteSelectedUrl||
  event.source!==$('websiteFrame').contentWindow||!verifiedCatalogPlayer(lastState))return;
 const data=event.data;
 if(!data||typeof data!=='object'||Array.isArray(data)||data.type!=='PLAYER_EVENT')return;
 const info=data.data;
 if(!info||typeof info!=='object'||Array.isArray(info))return;
 if(info.tmdbId!==undefined&&Number(info.tmdbId)!==Number(lastState.catalog.id))return;
 if(info.mediaType&&info.mediaType!==lastState.catalog.type)return;
 const eventType=String(info.event||'');
 if(!['play','playing','pause','paused','seeked','timeupdate','playerstatus','ended'].includes(eventType))return;
 const position=Number(info.currentTime);
 if(!Number.isFinite(position)||position<0||position>86400)return;
 const playing=typeof info.playing==='boolean'?info.playing:
  ['play','playing','timeupdate','seeked'].includes(eventType)?true:false;
 movieFrameEventsSeen=true;
 movieFrameLastProgress=position;movieFrameLastProgressAt=Date.now();movieFrameLastPlaying=playing;
 if(movieIsHost()&&Date.now()-movieLastReportedAt>=1550){
  movieLastReportedAt=Date.now();movieSendControl('sample',position,playing);
 }else movieCorrectGuestDrift();
});
socket.on('movie:timeline',t=>{
 movieUpdateSnapshot(t);
 // Only attempt optional cross-origin commands after the player sends real events.
 if(!movieIsHost()&&movieFrameEventsSeen&&t?.playing!==undefined){
  if(movieFrameLastPlaying!==t.playing&&Date.now()-movieLastPlaybackCommandAt>12000){
   movieLastPlaybackCommandAt=Date.now();
   moviePostCommand(t.playing?'play':'pause');
  }
  movieCorrectGuestDrift();
 }
});
setInterval(()=>{
 if(room&&lastState?.source==='website'){
  updateMovieSyncUI();
  if(!document.hidden)movieCorrectGuestDrift();
 }
},1500);
function warnBeforeExternalNavigation(e){e.preventDefault();e.returnValue=true}
function setWebsiteExitGuard(on){
 if(websiteExitGuardArmed===on)return;
 websiteExitGuardArmed=on;
 if(on)window.addEventListener('beforeunload',warnBeforeExternalNavigation);
 else window.removeEventListener('beforeunload',warnBeforeExternalNavigation);
}
function unloadWebsiteFrame(){
 const frame=$('websiteFrame');
 if(frame.hasAttribute('src'))frame.removeAttribute('src');
 frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX);
 setWebsiteClickGuard(false);
 setWebsiteExitGuard(false);
}
function loadWebsiteFrame(url,compatibilityMode=false){
 const frame=$('websiteFrame');
 movieFrameEventsSeen=false;movieFrameLastProgress=null;movieFrameLastProgressAt=0;
 movieFrameLastPlaying=null;movieLastCorrectionAt=Date.now();movieLastPlaybackCommandAt=Date.now();
 if(frame.hasAttribute('src'))frame.removeAttribute('src');
 // Only the verified movie-source adapter is eligible for compatibility mode.
 // This also means in-frame ad clicks may create tabs; browsers give the parent
 // no guaranteed way to suppress popups from an unsandboxed cross-origin frame.
 if(compatibilityMode)frame.removeAttribute('sandbox');
 else frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX);
 frame.removeAttribute('allowfullscreen');
 frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
 setWebsiteExitGuard(compatibilityMode);
 frame.setAttribute('src',url);
 setWebsiteClickGuard(false);
}
function updateWebsitePlayerActions(url){
 const stopped=Boolean(url&&websiteStoppedFor===url);
 $('websiteStop').classList.toggle('hidden',!url||stopped);
 $('websiteResume').classList.toggle('hidden',!stopped);
 $('websiteStopped').classList.toggle('hidden',!stopped);
}
function setWebsitePlayer(s){
 const external=s?.source==='website'&&verifiedCatalogPlayer(s);
 const shell=$('videoShell'),frame=$('websiteFrame');
 shell.classList.toggle('website-mode',external);
 $('websitePlayer').classList.toggle('hidden',!external);
 if(external){
  let target;
  try{target=new URL(s.websiteUrl);if(target.protocol!=='https:')throw Error('Invalid protocol')}
  catch{unloadWebsiteFrame();return false}
  const url=target.toString();
  if(websiteSelectedUrl!==url||websiteSelectedVersion!==s.version){
   websiteSelectedUrl=url;websiteSelectedVersion=s.version;
   websiteStoppedFor=null;
   loadWebsiteFrame(movieEmbedUrl(url,s.movieTimeline),true);
  }else if(websiteStoppedFor!==url&&!frame.hasAttribute('src')){
   loadWebsiteFrame(movieEmbedUrl(url,s.movieTimeline),true);
  }
  updateWebsitePlayerActions(url);
 }else{
  websiteSelectedUrl=null;websiteStoppedFor=null;websiteSelectedVersion=null;
  movieFrameEventsSeen=false;movieFrameLastProgress=null;
  unloadWebsiteFrame();updateWebsitePlayerActions(null);
 }
 return external;
}
$('websiteStop').onclick=()=>{
 if(!websiteSelectedUrl)return;
 websiteStoppedFor=websiteSelectedUrl;
 unloadWebsiteFrame();
 updateWebsitePlayerActions(websiteSelectedUrl);
 toast('Player stopped on this device.');
};
$('websiteResume').onclick=()=>{
 if(!websiteSelectedUrl||websiteStoppedFor!==websiteSelectedUrl)return;
 websiteStoppedFor=null;
 loadWebsiteFrame(movieEmbedUrl(websiteSelectedUrl,{position:movieClockNow()??0,playing:movieSnapshot?.playing}),verifiedCatalogPlayer(lastState));
 updateWebsitePlayerActions(websiteSelectedUrl);
};
function applyState(s){
 if(!s)return;
 const old=lastState;
 lastState=s;version=s.version;
 movieSnapshot=null;movieSnapshotAt=0;
 if(s.movieTimeline)movieUpdateSnapshot(s.movieTimeline);
 updateMovieSyncUI();
 if(old?.source&&old.source!==s.source)setSourceTab(s.source==='website'?'movies':'youtube');
 $('catalogNowPlaying').classList.toggle('hidden',!s.catalog);
 $('catalogNowPlaying').textContent=s.catalog
  ?'Currently shared in this room: '+s.catalog.title+
   (s.catalog.type==='tv'?' · S'+s.catalog.season+' E'+s.catalog.episode:'')+
   ' · '+s.catalog.label
  :'';
 if(old?.video!==s.video&&s.source!=='website')saveRecent({id:s.video,title:'YouTube video'});
 $('videoURL').value='https://www.youtube.com/watch?v='+s.video;
 $('youtubeLink').href=$('videoURL').value;
 if(setWebsitePlayer(s)){
  // An embedded website is its own player; mute the former YouTube playback.
  if(playerReady){applying=true;try{player.pauseVideo()}catch{}finally{setTimeout(()=>applying=false,850)}}
  $('syncLabel').textContent='Movie room clock · approximate join position';
  return
 }
 if(!playerReady)return;
 applying=true;
 try{
  const video=player.getVideoData()?.video_id;
  if(video!==s.video||old?.source==='website'){
   playerReadyUI();player.cueVideoById(s.video,s.position);
   notice('New video ready. Tap Play if your browser blocks autoplay.');
  }else{
   const t=player.getCurrentTime();
   if(Math.abs(t-s.position)>2.5)player.seekTo(s.position,true);
   const status=player.getPlayerState();
   if(s.playing&&status!==YT.PlayerState.PLAYING)player.playVideo();
   else if(!s.playing&&status===YT.PlayerState.PLAYING)player.pauseVideo()
  }
  $('syncLabel').textContent='Auto-sync on';
 }catch(e){console.warn('Player sync:',e)}
 finally{setTimeout(()=>applying=false,850)}
}
socket.on('state',applyState);
// YouTube's own playback controls are the source of truth; keep synchronization automatic.
setInterval(()=>{if(room&&playerReady&&!document.hidden)socket.emit('sync')},22000);
socket.on('connect',()=>{
 me=socket.id;updateChatConnection();
 if(cameraInterrupted){
  cameraInterrupted=false;
  cameraNeedsRejoin=true;
  toast('Connection restored. Camera stayed off — rejoin from People when ready.');
 }
 if(room){
  leaveCall(false);
  socket.emit('join',{id:room,name:currentName||nickname()},d=>{
   if(d?.error){toast(d.error);notice('Could not rejoin room. Try opening the invitation link again.');return}
   participants=d.members;callMembers=d.callMembers||[];applyState(d.state);
   roomQueue=d.queue||[];renderQueue();showMembers();updateChatConnection();socket.emit('sync');
   startSpectatorView();notice('Reconnected to your room.');
  });
 }else if(roomFromPath&&!autoJoinAttempted&&nickname()){
  // Room links are persistent and the nickname is saved locally. Never auto-start camera/mic.
  autoJoinAttempted=true;
  join();
 }
});
socket.on('disconnect',()=>{
 if(callRole==='camera'&&callActive)cameraInterrupted=true;
 notice('Connection lost. Trying to reconnect…');
 $('syncLabel').textContent='Reconnecting…';
 updateChatConnection();leaveCall(false)
});
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
 if(!isLocal){const state=document.createElement('span');state.className='tile-status';state.textContent='Connecting…';tile.append(state);tile.onclick=event=>{
   if(callRole==='spectator'&&video.muted){
    // First tap unlocks audio without minimizing the camera preview.
    event.stopPropagation();
    video.muted=false;
    video.play().then(()=>{
     videoTiles.get(id)?.tile.querySelector('.tile-status')?.remove()
    }).catch(()=>{video.muted=true;tileStatus(id,'Tap to hear audio')});
   }else video.play().catch(()=>{});
  }}
 videoTiles.set(id,{tile,video});$('callGrid').append(tile);$('callOverlay').classList.remove('hidden');return video
}
function tileStatus(id,msg){const node=videoTiles.get(id)?.tile.querySelector('.tile-status');if(node)node.textContent=msg}
function removePeer(id,preserveRecovery=false){
 if(!preserveRecovery)clearPeerRecovery(id);
 const pc=connections.get(id);if(pc){pc.onicecandidate=null;pc.ontrack=null;pc.onconnectionstatechange=null;pc.oniceconnectionstatechange=null;pc.close()}
 connections.delete(id);candidateQueues.delete(id);remoteStreams.delete(id);
 videoTiles.get(id)?.tile.remove();videoTiles.delete(id);
}
function updateCallActions(){
 const cameras=cameraMembers().length;
 const onCamera=callActive&&callRole==='camera';
 $('callEntry').classList.toggle('hidden',onCamera||cameras>=2);
 $('callActiveControls').classList.toggle('hidden',!onCamera);
 $('cameraButtons').classList.toggle('hidden',!onCamera);
 $('call').classList.toggle('hidden',onCamera||cameras>=2);
 $('call').disabled=callJoining||onCamera||cameras>=2;
 $('call').textContent='Join on camera';
 $('hangup').textContent='Leave camera';
 $('callNote').textContent=onCamera
  ?'Your camera and microphone are visible to people in this room. Leave camera to stop sharing.'
  :'Your movie and chat are always available. Choosing Join on camera shares your video and audio with everyone in this private room.';
}
function syncCallDock(){
 callMinimized=callViewMode==='minimized';
 const enlarged=callViewMode==='expanded';
 $('callBubbleCount').textContent=String(cameraMembers().length||1);
 $('callBubble').classList.toggle('hidden',!callActive||!callMinimized);
 $('callOverlay').classList.toggle('collapsed',callActive&&callMinimized);
 $('callOverlay').classList.toggle('expanded',callActive&&enlarged);
 const nextAction=callViewMode==='compact'?'Minimize':callViewMode==='minimized'?'Enlarge':'Resize';
 $('callOverlay').setAttribute('aria-label',nextAction+' camera tiles');
 $('callOverlay').title='Tap to '+nextAction.toLowerCase()+' camera tiles';
 $('callBubble').setAttribute('aria-label','Enlarge camera tiles');
}
function nextCallViewMode(mode){
 if(mode==='compact')return 'minimized';
 if(mode==='minimized')return 'expanded';
 return 'compact';
}
function cycleCallView(){
 if(!callActive)return;
 callViewMode=nextCallViewMode(callViewMode);
 syncCallDock()
}
function setCallUI(active){
 $('callOverlay').classList.toggle('hidden',!active||!videoTiles.size);
 if(!active){callMinimized=false;callViewMode='compact';callRole=null;sharingCall=false}
 $('mic').textContent='Mute microphone';
 $('camera').textContent='Turn camera off';
 $('mic').setAttribute('aria-pressed','false');$('mic').disabled=false;
 $('camera').setAttribute('aria-pressed','false');$('camera').disabled=false;
 $('callStatus').textContent=callRole==='camera'?'On camera — visible to room':cameraMembers().length?'Cameras appear automatically':'No one on camera yet';
 syncCallDock();showMembers()
}
async function leaveCall(send=true){
 const pending=callJoining;
 callAttempt++;
 if(send&&socket.connected&&(callActive||pending))socket.emit('call:leave');
 callActive=false;callJoining=false;
 [...connections.keys()].forEach(removePeer);
 localStream?.getTracks().forEach(t=>t.stop());localStream=null;
 videoTiles.get('self')?.tile.remove();videoTiles.delete('self');
 $('callGrid').replaceChildren();$('callOverlay').classList.add('hidden');setCallUI(false)
}
// Per-peer ICE recovery, independent of room sync and camera publishing.
// A temporary disconnect may self-heal, so wait before renegotiating.
const peerRecovery=new Map();
const PEER_RETRY_LIMIT=3;
function clearPeerRecovery(id){
 const recovery=peerRecovery.get(id);
 if(recovery?.timer)clearTimeout(recovery.timer);
 peerRecovery.delete(id);
}
function schedulePeerRecovery(id,pc,urgent=false){
 if(!callActive||!socket.connected||connections.get(id)!==pc)return;
 if(pc.connectionState==='connected'||(
   !['disconnected','failed'].includes(pc.connectionState)&&
   ['connected','completed'].includes(pc.iceConnectionState)))return;
 if(!participants.some(p=>p.id===id)||!callUser(id))return;
 let recovery=peerRecovery.get(id);
 if(!recovery){
  recovery={timer:null,attempts:0,rebuilds:0,busy:false,unstableSince:Date.now()};
  peerRecovery.set(id,recovery);
 }
 if(recovery.timer||recovery.busy)return;
 const delay=urgent?1300:(recovery.attempts?7000:4500);
 recovery.timer=setTimeout(async()=>{
  recovery.timer=null;
  if(connections.get(id)!==pc||!socket.connected||!callActive)return;
  if(pc.connectionState==='connected'||['connected','completed'].includes(pc.iceConnectionState)){
   clearPeerRecovery(id);return;
  }
  if(recovery.busy)return;
  recovery.busy=true;
  try{
   if(recovery.attempts>=PEER_RETRY_LIMIT){
    if(recovery.rebuilds>=1){
     tileStatus(id,'Unable to restore video. Check network or try rejoining.');
     $('callStatus').textContent='Video connection needs attention';
     return;
    }
    recovery.rebuilds++;
    recovery.attempts=0;
    tileStatus(id,'Rebuilding the connection…');
    // Preserve local media tracks: an existing camera must never request
    // permission again or auto-publish new media from a spectator.
    removePeer(id,true);
    await loadIceServers();
    if(!callActive||!socket.connected||!participants.some(p=>p.id===id)||!callUser(id))return;
    await createPeer(id,true);
    return;
   }
   if(pc.signalingState!=='stable'){
    // Stale offers can stall during network switching; give them a short
    // opportunity to settle, then rebuild after bounded attempts.
    recovery.attempts++;
    return;
   }
   recovery.attempts++;
   tileStatus(id,'Restoring video connection…');
   $('callStatus').textContent='Restoring video connection…';
   const offer=await pc.createOffer({iceRestart:true});
   if(connections.get(id)!==pc||!callActive||!socket.connected||pc.signalingState!=='stable')return;
   await pc.setLocalDescription(offer);
   if(connections.get(id)===pc&&socket.connected)
    socket.emit('call:signal',{to:id,data:{description:pc.localDescription.toJSON()}});
  }catch(error){
   console.warn('Video recovery attempt failed:',error?.message||error);
  }finally{
   recovery.busy=false;
   if(callActive&&socket.connected&&connections.get(id)===pc&&
      pc.connectionState!=='connected'&&
      !['connected','completed'].includes(pc.iceConnectionState)){
    // One watchdog per broken peer: retries are bounded and spaced out.
    schedulePeerRecovery(id,pc,false);
   }
  }
 },delay);
}
async function createPeer(id,initiator=false){
 if(connections.has(id))return connections.get(id);
 if(!callActive||(callRole==='camera'&&!localStream))return null;
 const pc=new RTCPeerConnection({iceServers:iceConfig.iceServers});connections.set(id,pc);
 const remote=new MediaStream();remoteStreams.set(id,remote);
 const showRemote=callRole==='spectator'||callUser(id)?.role==='camera';
 const video=showRemote?displayTile(id):null;if(video){video.srcObject=remote;if(callRole==='spectator')video.muted=true;}
 if(callRole==='camera'&&localStream)localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
 else{pc.addTransceiver('audio',{direction:'recvonly'});pc.addTransceiver('video',{direction:'recvonly'})}
 pc.ontrack=e=>{const stream=remoteStreams.get(id);if(!stream)return;const tracks=e.streams?.[0]?.getTracks()||[e.track];for(const track of tracks)if(!stream.getTracks().some(t=>t.id===track.id))stream.addTrack(track);if(video){video.srcObject=stream;video.play().catch(()=>tileStatus(id,'Tap to hear audio'))}};
 pc.onicecandidate=e=>{if(e.candidate&&socket.connected)socket.emit('call:signal',{to:id,data:{candidate:e.candidate.toJSON()}})};
 function onPeerTransportChange(){
  if(connections.get(id)!==pc)return;
  const state=pc.connectionState,ice=pc.iceConnectionState;
  if(state==='failed'||ice==='failed'){
   tileStatus(id,iceConfig.relayAvailable?'Connection interrupted — recovering':'Connection interrupted — a TURN relay may help');
   $('callStatus').textContent='Reconnecting video…';
   schedulePeerRecovery(id,pc,true);
  }else if(state==='disconnected'||ice==='disconnected'){
   tileStatus(id,'Trying to reconnect…');
   $('callStatus').textContent='Trying to reconnect video…';
   schedulePeerRecovery(id,pc,false);
  }else if(state==='connected'||ice==='connected'||ice==='completed'){
   clearPeerRecovery(id);
   const label=videoTiles.get(id)?.tile.querySelector('.tile-status');
   if(callRole==='spectator'&&video?.muted)tileStatus(id,'Tap for audio');
   else if(label)label.remove();
   $('callStatus').textContent='Connected';
  }else if(state!=='closed')tileStatus(id,state||'connecting');
 }
 pc.onconnectionstatechange=onPeerTransportChange;
 pc.oniceconnectionstatechange=onPeerTransportChange;
 if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('call:signal',{to:id,data:{description:pc.localDescription.toJSON()}})}
 return pc
}
async function drainCandidates(id,pc){const q=candidateQueues.get(id)||[];candidateQueues.delete(id);for(const c of q){try{await pc.addIceCandidate(c)}catch(e){console.warn('ICE candidate',e)}}}
async function onSignal({from,data}){
 if(!callActive||!participants.some(x=>x.id===from)||!data)return;
 try{
  const pc=await createPeer(from,false);if(!pc)return;
  if(data.description){
   const description=new RTCSessionDescription(data.description);
   const collision=description.type==='offer'&&pc.signalingState!=='stable';
   // Deterministic polite peer avoids simultaneous-offer glare on reconnect.
   if(collision){
    if(String(me)<String(from))return;
    await pc.setLocalDescription({type:'rollback'});
   }
   if(description.type==='answer'&&pc.signalingState!=='have-local-offer')return;
   await pc.setRemoteDescription(description);
   await drainCandidates(from,pc);
   if(description.type==='offer'){
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if(callActive&&socket.connected)socket.emit('call:signal',{to:from,data:{description:pc.localDescription.toJSON()}});
   }
  }else if(data.candidate){
   if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
   else{
    if(!candidateQueues.has(from))candidateQueues.set(from,[]);
    const queue=candidateQueues.get(from);
    if(queue.length<128)queue.push(data.candidate);
   }
  }
 }catch(e){console.error('Call signaling failed',e);tileStatus(from,'Connection error');toast('Call signaling error. Try leaving and rejoining.')}
}
async function loadIceServers(){
 try{
  const params=new URLSearchParams({room,sid:socket.id||''});
  const response=await fetch('/api/rtc?'+params.toString(),{cache:'no-store'});
  if(!response.ok)return;
  const config=await response.json();
  if(Array.isArray(config.iceServers))iceConfig=config
 }catch(error){console.warn('RTC configuration unavailable:',error)}
}
function offerAvailableCameras(ids){
 for(const id of ids||[]){
  if(!connections.has(id))createPeer(id,true).catch(error=>console.warn('Camera subscription failed',error))
 }
}
// All room members are receive-only subscribers by default. No media permissions.
async function startSpectatorView(){
 if(!room||!socket.connected||callActive||callJoining)return;
 const attempt=++callAttempt;
 callJoining=true;updateCallActions();
 try{
  await loadIceServers();
  if(attempt!==callAttempt)return;
  if(!room||!socket.connected){callJoining=false;updateCallActions();return}
  socket.timeout(10000).emit('call:join',{role:'spectator'},(err,result)=>{
   if(attempt!==callAttempt)return;
   callJoining=false;
   if(err||result?.error){
    console.warn('Room camera viewing unavailable:',result?.error||err);
    $('callStatus').textContent='Unable to connect to cameras — retry from People';
    updateCallActions();return
   }
   callRole='spectator';callActive=true;callMembers=result.callMembers||callMembers;
   setCallUI(true);offerAvailableCameras(result.peers)
  })
 }catch(error){
  if(attempt!==callAttempt)return;
  callJoining=false;updateCallActions();
  $('callStatus').textContent='Camera viewing unavailable — try reconnecting';
  console.warn('Passive viewer could not start:',error)
 }
}
// Camera joining is an explicit choice; the room can see and hear the camera owner.
async function joinCall(){
 if(callJoining||!room||callRole==='camera')return;
 if(cameraMembers().length>=2)return toast('Both camera seats are currently occupied');
 const attempt=++callAttempt;
 callJoining=true;updateCallActions();
 $('callStatus').textContent='Requesting camera permission…';
 try{
  const stream=await getMedia();
  if(attempt!==callAttempt||!room||!socket.connected){
   stream.getTracks().forEach(t=>t.stop());
   if(localStream===stream)localStream=null;
   return;
  }
  await loadIceServers();
  if(attempt!==callAttempt||!room||!socket.connected){
   stream.getTracks().forEach(t=>t.stop());
   if(localStream===stream)localStream=null;
   return;
  }
  socket.timeout(10000).emit('call:join',{role:'camera'},(err,result)=>{
   if(attempt!==callAttempt)return;
   callJoining=false;
   if(err||result?.error){
    localStream?.getTracks().forEach(t=>t.stop());localStream=null;
    $('callStatus').textContent='Camera unavailable — try again';
    toast(result?.error||'Could not join on camera');updateCallActions();return
   }
   // Existing passive connections must be rebuilt when publishing starts.
   [...connections.keys()].forEach(removePeer);
   callRole='camera';callActive=true;sharingCall=true;cameraNeedsRejoin=false;
   callMembers=result.callMembers||callMembers;
   displayTile('self',true).srcObject=stream;
   setCallUI(true);offerAvailableCameras(result.peers);
   for(const track of stream.getTracks()){
    track.addEventListener('ended',()=>{
     if(attempt!==callAttempt||callRole!=='camera')return;
     if(track.kind==='video'){
      $('camera').textContent='Camera unavailable';
      $('camera').disabled=true;
      $('callStatus').textContent='Camera device disconnected';
      toast('Camera disconnected. Leave and rejoin to recover.');
     }else{
      $('mic').textContent='Microphone unavailable';
      $('mic').disabled=true;
      toast('Microphone disconnected. Rejoin the call to recover.');
     }
    },{once:true});
   }
  })
 }catch(error){
  if(attempt!==callAttempt)return;
  callJoining=false;
  localStream?.getTracks().forEach(t=>t.stop());localStream=null;
  $('callStatus').textContent='Camera permission or device unavailable';
  updateCallActions();toast(error.message||'Could not access your camera')
 }
}
$('call').onclick=joinCall;
$('hangup').onclick=()=>{leaveCall(true);startSpectatorView()};
$('mic').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(!t||t.readyState!=='live')return;t.enabled=!t.enabled;$('mic').textContent=t.enabled?'Mute microphone':'Unmute microphone';$('mic').setAttribute('aria-pressed',String(!t.enabled))};
$('camera').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(!t||t.readyState!=='live')return;t.enabled=!t.enabled;$('camera').textContent=t.enabled?'Turn camera off':'Turn camera on';$('camera').setAttribute('aria-pressed',String(!t.enabled))};
// Tapping any camera tile cycles compact → minimized bubble → enlarged → compact.
// The media stream stays active: changing the preview size never mutes or ends the call.
$('callOverlay').onclick=()=>cycleCallView();
$('callOverlay').onkeydown=e=>{
 if(e.target!==$('callOverlay'))return;
 if(e.key==='Enter'||e.key===' '){e.preventDefault();cycleCallView()}
};
$('callBubble').onclick=()=>cycleCallView();

socket.on('call:peer-joined',d=>{if(callActive&&d.id!==me&&d.role==='camera')toast((participants.find(p=>p.id===d.id)?.name||'Someone')+' joined on camera')});
socket.on('call:publisher-available',async d=>{if(callActive&&callRole==='spectator'&&!connections.has(d.id)){
 try{await createPeer(d.id,true)}catch(e){console.warn('Spectator handshake failed',e)}
}});
socket.on('call:peer-left',d=>removePeer(d.id));
socket.on('call:signal',onSignal);
// A browser returning from the background may resume before ICE notices a failure.
document.addEventListener('visibilitychange',()=>{
 if(document.hidden||!callActive||!socket.connected)return;
 for(const [id,pc] of connections){
  if(['disconnected','failed'].includes(pc.connectionState)||
     ['disconnected','failed'].includes(pc.iceConnectionState))
   schedulePeerRecovery(id,pc,true);
 }
});
window.addEventListener('pagehide',()=>{theaterFallback=false;document.body.classList.remove('theater-lock');if(callActive)socket.emit('call:leave');localStream?.getTracks().forEach(t=>t.stop())});
