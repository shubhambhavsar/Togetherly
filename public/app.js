'use strict';
const $=id=>document.getElementById(id);
const socket=io({reconnection:true,reconnectionDelay:500});
const roomFromPath=location.pathname.match(/^\/room\/([a-f0-9]{24})$/)?.[1];
let room=null,me=null,participants=[],player=null,playerReady=false,ytReady=false,applying=false,lastState=null,version=0;
let roomQueue=[],searchReady=false,searching=false,autoJoinAttempted=false;
const displayedChatIds=new Set(),unplayableVideos=new Set();
try{for(const id of JSON.parse(sessionStorage.getItem('togetherly.unplayable')||'[]'))if(/^[\w-]{11}$/.test(id))unplayableVideos.add(id)}catch{}
function markUnplayable(id){if(!id||!/^[\w-]{11}$/.test(id))return;unplayableVideos.add(id);try{sessionStorage.setItem('togetherly.unplayable',JSON.stringify([...unplayableVideos].slice(-50)))}catch{}}
let localStream=null,callActive=false,callJoining=false,iceConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
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
function setupRoom(d){saveName(nickname());room=d.id;me=socket.id;participants=d.members||[];callMembers=d.callMembers||[];roomQueue=d.queue||[];renderQueue();lastState=d.state;version=d.state.version;$('landing').style.display='none';$('watch').style.display='block';history.replaceState({},'', '/room/'+room);showMembers();$('chat').replaceChildren();displayedChatIds.clear();(d.messages||[]).forEach(m=>addMessage(m,false));updateChatConnection();applyState(d.state);initPlayer();startSpectatorView()}
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
}
socket.on('members',m=>{participants=m;showMembers();for(const id of connections.keys())if(!participants.some(p=>p.id===id))removePeer(id)});
socket.on('call:members',members=>{
 callMembers=members;syncCallDock();showMembers();
 $('callStatus').textContent=callRole==='camera'?'On camera — visible to room':cameraMembers().length?'Cameras appear automatically':'No one on camera yet';
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
  for(const id of ['toolbarUnread']){
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
  socket.emit('video',{url},result=>{if(result?.error)return toast(result.error);saveRecent(item);closeExplore()})
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
  // On mobile, opening messages must not automatically summon the keyboard.
  if(!theaterActive()&&!matchMedia('(max-width:860px)').matches)setTimeout(()=>$('chatText').focus(),50)
 }else if(document.activeElement===$('chatText'))$('chatText').blur();
 updateChatViewport()
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

$('load').onclick=()=>{if(!room)return;socket.emit('video',{url:$('videoURL').value},d=>{if(d?.error)toast(d.error)})};
// This suggestion only pre-fills the form. It never navigates or starts a
// third-party page until a room member explicitly chooses Show website.
$('suggestFlexflix').onclick=()=>{
 $('websiteURL').value='https://flexflix.site/';
 $('websiteURL').focus();
 notice('Third-party website selected. Review the address and choose Show website to share it.');
};
// Streambert-inspired movie catalogue. TMDB supplies metadata only; sources are
// provider-controlled embedded sites, not direct playable video under our control.
// Movie IDs are internal to the catalogue. Viewers select a title instead.
let catalogChoice=null,catalogSearchTimer=null,catalogSearchController=null,catalogSearchSequence=0;
function catalogEpisodeFields(){
 const tv=$('catalogType').value==='tv';
 document.querySelectorAll('#movieCatalog .catalog-tv-only').forEach(n=>n.classList.toggle('hidden',!tv));
}
function catalogClearSelection(){
 catalogChoice=null;
 $('catalogId').value='';
 $('catalogPlayForm').classList.add('hidden');
}
function catalogSelectTitle(item){
 if(!item||!Number.isSafeInteger(item.id)||!['movie','tv'].includes(item.type))return;
 catalogChoice={id:item.id,type:item.type,title:item.title};
 $('catalogType').value=item.type;
 $('catalogId').value=String(item.id);
 $('catalogSelectedTitle').textContent=item.title;
 $('catalogSelectedMeta').textContent=(item.type==='movie'?'Movie':'TV series')+
  (item.year?' · '+item.year:'');
 catalogEpisodeFields();
 $('catalogPlayForm').classList.remove('hidden');
 $('catalogStatus').textContent='Selected '+item.title+'. Choose a playback source and watch with your room.';
 document.querySelectorAll('#catalogResults .catalog-result').forEach(button=>{
  const selected=button.dataset.catalogKey===item.type+':'+item.id;
  button.classList.toggle('is-selected',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 $('catalogPlayForm').scrollIntoView?.({behavior:'smooth',block:'nearest'});
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
 $('catalogQuery').focus();
 $('catalogStatus').textContent='Choose another result or search for a different title.';
};
catalogEpisodeFields();
$('catalogPlayForm').onsubmit=event=>{
 event.preventDefault();
 if(!room)return toast('Join a room before sharing a movie');
 const type=$('catalogType').value,id=Number($('catalogId').value);
 if(!catalogChoice||catalogChoice.id!==id||catalogChoice.type!==type){
  return toast('Select a movie or series from the suggestions first');
 }
 const season=Number($('catalogSeason').value),episode=Number($('catalogEpisode').value);
 if(type==='tv'&&(!Number.isSafeInteger(season)||season<1||season>99||
  !Number.isSafeInteger(episode)||episode<1||episode>999)){
  return toast('Enter a valid season and episode');
 }
 const button=$('catalogPlay');button.disabled=true;
 $('catalogStatus').textContent='Sharing '+catalogChoice.title+' with your room…';
 socket.timeout(9000).emit('catalog:play',{
  type,id,season,episode,provider:$('catalogProvider').value,title:catalogChoice.title
 },(error,ack)=>{
  button.disabled=false;
  if(error||ack?.error){
   $('catalogStatus').textContent=ack?.error||'Could not load this source';return;
  }
  $('catalogStatus').textContent='Player shared. Each viewer loads the third-party source independently. If it fails, try a different source.';
 });
};
$('websiteForm').onsubmit=event=>{
 event.preventDefault();
 if(!room)return toast('Join a room first');
 const value=$('websiteURL').value.trim();
 if(!/^https:\/\//i.test(value))return toast('Enter a public HTTPS website address');
 $('openWebsiteInRoom').disabled=true;
 socket.timeout(9000).emit('website',{url:value},(error,ack)=>{
  $('openWebsiteInRoom').disabled=false;
  if(error||ack?.error)toast(ack?.error||'Could not share this website');
 })
};

// Movie timing requires a separately installed browser companion with access
// to the actual HTML5 media element. Same-origin policy forbids direct iframe reads.
const WEBSITE_SYNC_CHANNEL='togetherly-sync-v1';
let websiteSyncActive=false,websiteCompanionSeen=false,websitePlayerSeenAt=0;
let websiteSyncUrl='',websiteSyncTimeline=null,websiteSyncLastPublishAt=0;
function supportsWebsiteSync(raw){
 try{const u=new URL(raw);return u.protocol==='https:'&&
  (u.hostname==='flexflix.site'||u.hostname==='www.flexflix.site')}catch{return false}
}
function websiteSyncReady(){
 return !!room&&lastState?.source==='website'&&
  supportsWebsiteSync(lastState.websiteUrl)&&
  websiteStoppedFor!==lastState.websiteUrl;
}
function websiteSyncRole(){
 return me&&lastState?.websiteLeader===me?'host':'guest';
}
function websiteSyncPost(action,payload={}){
 window.postMessage({channel:WEBSITE_SYNC_CHANNEL,from:'page',action,...payload},location.origin);
}
function websiteSyncStatus(){
 const btn=$('websiteSyncToggle'),status=$('websiteSyncStatus');
 btn.setAttribute('aria-pressed',String(websiteSyncActive));
 btn.textContent=websiteSyncActive?'Disable auto sync':'Enable auto sync';
 btn.disabled=!websiteSyncReady();
 if(!websiteSyncReady()){
  status.textContent='Share a FlexFlix website in a room to enable optional sync.';return
 }
 if(!websiteSyncActive){
  status.textContent='Off · Each viewer controls their own movie.';return
 }
 if(!websiteCompanionSeen){
  status.textContent='Companion not detected. Install it on each desktop browser, then reload.';return
 }
 if(Date.now()-websitePlayerSeenAt>9000){
  status.textContent='Looking for an accessible HTML5 player. External nested player frames may be unsupported.';return
 }
 status.textContent=websiteSyncRole()==='host'
  ?'Host timing active · Broadcasting your movie position.'
  :(websiteSyncTimeline?'Guest drift correction active.':'Connected · Waiting for the host timeline.');
}
function websiteSyncDisable(){
 websiteSyncActive=false;websiteSyncTimeline=null;websitePlayerSeenAt=0;
 websiteSyncPost('DISABLE');websiteSyncStatus();
}
$('websiteSyncToggle').onclick=()=>{
 if(!websiteSyncReady())return;
 if(websiteSyncActive){websiteSyncDisable();return}
 websiteSyncActive=true;websiteCompanionSeen=false;websitePlayerSeenAt=0;
 websiteSyncPost('HELLO');
 websiteSyncPost('ENABLE',{role:websiteSyncRole()});
 websiteSyncStatus();
};
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin)return;
 const d=event.data;
 if(d?.channel!==WEBSITE_SYNC_CHANNEL||d.from!=='companion')return;
 if(d.type==='AVAILABLE'){websiteCompanionSeen=true;websiteSyncStatus();return}
 if(!websiteSyncActive||!websiteSyncReady())return;
 if(d.type==='SAMPLE'&&d.sample){
  const sample=d.sample;
  if(!Number.isFinite(sample.position)||sample.position<0||sample.position>86400||
    typeof sample.playing!=='boolean')return;
  websitePlayerSeenAt=Date.now();
  if(websiteSyncRole()==='host'&&websitePlayerSeenAt-websiteSyncLastPublishAt>=1000){
   websiteSyncLastPublishAt=websitePlayerSeenAt;
   socket.emit('website:sample',{version,position:sample.position,playing:sample.playing});
  }
  websiteSyncStatus();return
 }
 if(d.type==='PLAY_BLOCKED')$('websiteSyncStatus').textContent='Tap Play on the movie once to allow browser playback.';
});
function websiteSyncTarget(timeline){
 if(!websiteSyncActive||!websiteSyncReady()||websiteSyncRole()==='host')return;
 if(timeline?.version!==version||!Number.isFinite(timeline.position))return;
 websiteSyncTimeline=timeline;
 websiteSyncPost('TARGET',{timeline:{
  position:timeline.position,playing:timeline.playing,version:timeline.version
 }});
 websiteSyncStatus();
}
socket.on('website:timeline',d=>{
 if(!d||d.version!==version)return;
 websiteSyncTarget(d.timeline);
});
setInterval(()=>{
 if(!websiteSyncReady())return;
 websiteSyncPost('HELLO');
 if(websiteSyncActive){
  websiteSyncPost('ENABLE',{role:websiteSyncRole()});
  websiteSyncStatus();
 }
},5000);

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
// External sites are sandboxed by default. Every browser must explicitly opt into
// removing the sandbox for an individual exact URL; this never changes room state.
const WEBSITE_FRAME_SANDBOX='allow-scripts allow-presentation';
let websiteCompatibilityFor=null,websiteStoppedFor=null,websiteSelectedUrl=null;
let websiteExitGuardArmed=false;
function websiteRoomUrl(){
 if(lastState?.source!=='website'||typeof lastState.websiteUrl!=='string')return null;
 try{
  const u=new URL(lastState.websiteUrl);
  return u.protocol==='https:'?u.toString():null;
 }catch{return null}
}
// This is a best-effort browser warning, not a reliable popup or redirect blocker.
// Browsers only show it in some circumstances, typically after user interaction.
function warnBeforeExternalNavigation(event){
 event.preventDefault();
 event.returnValue=true;
}
function setWebsiteExitGuard(enabled){
 if(websiteExitGuardArmed===enabled)return;
 websiteExitGuardArmed=enabled;
 if(enabled)window.addEventListener('beforeunload',warnBeforeExternalNavigation);
 else window.removeEventListener('beforeunload',warnBeforeExternalNavigation);
}
function unloadWebsiteFrame(){
 const frame=$('websiteFrame');
 if(frame.hasAttribute('src'))frame.removeAttribute('src');
 frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX);
 setWebsiteExitGuard(false);
}
function loadWebsiteFrame(url,compatibility=false){
 const frame=$('websiteFrame');
 // Reset before changing sandbox flags. A new navigation is required for a
 // sandbox change to apply to the embedded document.
 if(frame.hasAttribute('src'))frame.removeAttribute('src');
 if(compatibility)frame.removeAttribute('sandbox');
 else frame.setAttribute('sandbox',WEBSITE_FRAME_SANDBOX);
 frame.setAttribute('src',url);
 setWebsiteExitGuard(compatibility);
}
function updateWebsiteCompatibilityControls(url){
 const stopped=!!url&&websiteStoppedFor===url;
 const enabled=!stopped&&!!url&&websiteCompatibilityFor===url;
 $('websiteCompatibility').classList.toggle('hidden',enabled||stopped);
 $('websiteRestoreSandbox').classList.toggle('hidden',!enabled);
 $('websiteStop').classList.toggle('hidden',stopped||!url);
 $('websiteResume').classList.toggle('hidden',!stopped);
 $('websiteStopped').classList.toggle('hidden',!stopped);
 $('websiteModeStatus').textContent=stopped
  ?'Stopped on this device · Togetherly room stays open'
  :enabled
   ?'Compatibility mode · Browser may warn before leaving Togetherly'
   :'Protected preview · Playback is not synchronized';
}
function setWebsitePlayer(s){
 const external=s?.source==='website'&&typeof s.websiteUrl==='string'&&s.websiteUrl.startsWith('https://');
 const shell=$('videoShell'),frame=$('websiteFrame');
 shell.classList.toggle('website-mode',external);
 $('websitePlayer').classList.toggle('hidden',!external);
 if(external){
  const url=new URL(s.websiteUrl);
  const target=url.toString();
  $('websiteHost').textContent=url.hostname;
  $('openWebsite').href=target;
  $('websiteURL').value=target;
  // A new shared URL must revoke any local exception or stopped state.
  if(websiteSelectedUrl!==target){
   websiteSelectedUrl=target;
   websiteCompatibilityFor=null;
   websiteStoppedFor=null;
   loadWebsiteFrame(target,false);
  }else if(websiteStoppedFor!==target&&!frame.hasAttribute('src')){
   // Recover a page that was unloaded without changing the shared room URL.
   websiteCompatibilityFor=null;
   loadWebsiteFrame(target,false);
  }
  updateWebsiteCompatibilityControls(target);
 }else{
  websiteSelectedUrl=null;
  websiteCompatibilityFor=null;
  websiteStoppedFor=null;
  unloadWebsiteFrame();
  updateWebsiteCompatibilityControls(null);
 }
 return external
}
$('websiteCompatibility').onclick=()=>{
 const url=websiteRoomUrl();
 if(!url||websiteStoppedFor===url)return;
 const host=new URL(url).hostname;
 const message='Compatibility mode will load '+host+' without iframe sandbox restrictions on this device.\n\n'
  +'That website may open popups or try to redirect the Togetherly tab. '
  +'We will ask your browser to warn before leaving, but browsers cannot guarantee protection. '
  +'Only continue if you trust this website and have permission to view its content.\n\nContinue?';
 if(!window.confirm(message))return;
 websiteCompatibilityFor=url;
 loadWebsiteFrame(url,true);
 updateWebsiteCompatibilityControls(url);
};
$('websiteRestoreSandbox').onclick=()=>{
 const url=websiteRoomUrl();
 if(!url||websiteStoppedFor===url)return;
 websiteCompatibilityFor=null;
 loadWebsiteFrame(url,false);
 updateWebsiteCompatibilityControls(url);
};
$('websiteStop').onclick=()=>{
 const url=websiteRoomUrl();
 if(!url)return;
 websiteStoppedFor=url;
 websiteCompatibilityFor=null;
 if(websiteSyncActive)websiteSyncDisable();
 unloadWebsiteFrame();
 updateWebsiteCompatibilityControls(url);
 toast('External website stopped on this device.');
};
$('websiteResume').onclick=()=>{
 const url=websiteRoomUrl();
 if(!url||websiteStoppedFor!==url)return;
 websiteStoppedFor=null;
 websiteCompatibilityFor=null;
 loadWebsiteFrame(url,false);
 updateWebsiteCompatibilityControls(url);
};
function applyState(s){
 if(!s)return;
 const old=lastState;
 lastState=s;version=s.version;
 $('catalogNowPlaying').textContent=s.catalog
  ?'Shared: '+s.catalog.title+' · '+s.catalog.label+
   (s.catalog.type==='tv'?' · S'+s.catalog.season+' E'+s.catalog.episode:'')
  :'';
 const nextSyncUrl=s.source==='website'&&supportsWebsiteSync(s.websiteUrl)?s.websiteUrl:'';
 if(websiteSyncUrl!==nextSyncUrl){
  if(websiteSyncActive)websiteSyncDisable();
  websiteSyncUrl=nextSyncUrl;websiteSyncTimeline=null;
 }
 if(websiteSyncActive&&websiteSyncReady()){
  websiteSyncPost('ENABLE',{role:websiteSyncRole()});
  if(s.websiteTimeline)websiteSyncTarget(s.websiteTimeline);
 }
 websiteSyncStatus();
 if(old?.video!==s.video&&s.source!=='website')saveRecent({id:s.video,title:'YouTube video'});
 $('videoURL').value='https://www.youtube.com/watch?v='+s.video;
 $('youtubeLink').href=$('videoURL').value;
 if(setWebsitePlayer(s)){
  // An embedded website is its own player; mute the former YouTube playback.
  if(playerReady){applying=true;try{player.pauseVideo()}catch{}finally{setTimeout(()=>applying=false,850)}}
  $('syncLabel').textContent='Shared website · playback not synchronized';
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
 if(websiteSyncActive)websiteSyncPost('DISABLE');
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
function removePeer(id){
 const pc=connections.get(id);if(pc){pc.onicecandidate=null;pc.ontrack=null;pc.onconnectionstatechange=null;pc.close()}
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
 $('callStatus').textContent=callRole==='camera'?'On camera — visible to room':cameraMembers().length?'Cameras appear automatically':'No one on camera yet';
 syncCallDock();showMembers()
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
 const video=showRemote?displayTile(id):null;if(video){video.srcObject=remote;if(callRole==='spectator')video.muted=true;}
 if(callRole==='camera'&&localStream)localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
 else{pc.addTransceiver('audio',{direction:'recvonly'});pc.addTransceiver('video',{direction:'recvonly'})}
 pc.ontrack=e=>{const stream=remoteStreams.get(id);if(!stream)return;const tracks=e.streams?.[0]?.getTracks()||[e.track];for(const track of tracks)if(!stream.getTracks().some(t=>t.id===track.id))stream.addTrack(track);if(video){video.srcObject=stream;video.play().catch(()=>tileStatus(id,'Tap to hear audio'))}};
 pc.onicecandidate=e=>{if(e.candidate&&socket.connected)socket.emit('call:signal',{to:id,data:{candidate:e.candidate.toJSON()}})};
 pc.onconnectionstatechange=()=>{
   if(connections.get(id)!==pc)return;
   const state=pc.connectionState;
   if(state==='connected'){
    pc._restartAttempts=0;
    const label=videoTiles.get(id)?.tile.querySelector('.tile-status');
    if(callRole==='spectator'&&video?.muted)tileStatus(id,'Tap for audio');
    else if(label)label.remove();
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
 callJoining=true;updateCallActions();
 try{
  await loadIceServers();
  if(!room||!socket.connected){callJoining=false;updateCallActions();return}
  socket.timeout(10000).emit('call:join',{role:'spectator'},(err,result)=>{
   callJoining=false;
   if(err||result?.error){console.warn('Room camera viewing unavailable:',result?.error||err);updateCallActions();return}
   callRole='spectator';callActive=true;callMembers=result.callMembers||callMembers;
   setCallUI(true);offerAvailableCameras(result.peers)
  })
 }catch(error){callJoining=false;updateCallActions();console.warn('Passive viewer could not start:',error)}
}
// Camera joining is an explicit choice; the room can see and hear the camera owner.
async function joinCall(){
 if(callJoining||!room||callRole==='camera')return;
 if(cameraMembers().length>=2)return toast('Both camera seats are currently occupied');
 callJoining=true;updateCallActions();
 $('callStatus').textContent='Requesting camera permission…';
 try{
  await getMedia();
  await loadIceServers();
  if(!socket.connected)throw Error('Connection lost; please reconnect to your room');
  socket.timeout(10000).emit('call:join',{role:'camera'},(err,result)=>{
   callJoining=false;
   if(err||result?.error){
    localStream?.getTracks().forEach(t=>t.stop());localStream=null;
    toast(result?.error||'Could not join on camera');updateCallActions();return
   }
   // Existing passive connections are no longer valid after role promotion.
   [...connections.keys()].forEach(removePeer);
   callRole='camera';callActive=true;sharingCall=true;
   callMembers=result.callMembers||callMembers;
   displayTile('self',true).srcObject=localStream;
   setCallUI(true);offerAvailableCameras(result.peers)
  })
 }catch(error){
  callJoining=false;
  localStream?.getTracks().forEach(t=>t.stop());localStream=null;
  updateCallActions();toast(error.message||'Could not access your camera')
 }
}
$('call').onclick=joinCall;
$('hangup').onclick=()=>{leaveCall(true);startSpectatorView()};
$('mic').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(!t)return;t.enabled=!t.enabled;$('mic').textContent=t.enabled?'Mute microphone':'Unmute microphone';$('mic').setAttribute('aria-pressed',String(!t.enabled))};
$('camera').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(!t)return;t.enabled=!t.enabled;$('camera').textContent=t.enabled?'Turn camera off':'Turn camera on';$('camera').setAttribute('aria-pressed',String(!t.enabled))};
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
window.addEventListener('pagehide',()=>{theaterFallback=false;document.body.classList.remove('theater-lock');if(callActive)socket.emit('call:leave');localStream?.getTracks().forEach(t=>t.stop())});
