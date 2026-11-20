'use strict';
const express=require('express'),http=require('http'),{Server}=require('socket.io'),{randomBytes}=require('crypto'),path=require('path'),{isIP}=require('node:net');
const app=express(),server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:16000});
const rooms=new Map();
const MAX_CAMERA_PARTICIPANTS=2;
const MAX_ROOM_PARTICIPANTS=8;

/**
 * Independent Streambert-style adapter pattern. Providers are not verified
 * or endorsed; we never scrape, proxy, download or circumvent media controls.
 */
// Restrict embedded sources: two formerly listed domains have phishing flags.
// VidFast is unverified and may still redirect; browser security warnings prevail.
const CATALOG_SOURCES=Object.freeze({
 vidfast:{label:'Vidfast (unverified)',host:'vidfast.vc',
  movie:id=>'https://vidfast.vc/movie/'+id,
  tv:(id,s,e)=>'https://vidfast.vc/tv/'+id+'/'+s+'/'+e}
});
function catalogPlayer(d){
 if(!d||typeof d!=='object'||!Object.hasOwn(CATALOG_SOURCES,d.provider)||
  !['movie','tv'].includes(d.type))return null;
 const p=CATALOG_SOURCES[d.provider],id=Number(d.id),season=Number(d.season),episode=Number(d.episode);
 if(!Number.isSafeInteger(id)||id<1||id>999999999)return null;
 if(d.type==='tv'&&(!Number.isSafeInteger(season)||season<1||season>99||
  !Number.isSafeInteger(episode)||episode<1||episode>999))return null;
 const raw=d.type==='movie'?p.movie(id):p.tv(id,season,episode);
 const url=validateWebsiteUrl(raw);
 if(!url||new URL(url).hostname!==p.host)return null;
 const title=typeof d.title==='string'?d.title.trim().replace(/[\x00-\x1f<>]/g,'').slice(0,110):'';
 return {url,title:title||(d.type==='movie'?'Movie':'Series'),
  type:d.type,id,provider:d.provider,label:p.label,
  ...(d.type==='tv'?{season,episode}:{})};
}
const movieCatalogCache=new Map(),movieCatalogRate=new Map();
// Key-free fallback: Wikidata search + public TMDB identifier claims.
// Wikimedia metadata is incomplete. Never suggest that an ID implies rights.
async function wikidataTitleSearch(q){
 const base='https://www.wikidata.org/w/api.php';
 const headers={'Accept':'application/json','User-Agent':'Togetherly/1.0 (movie metadata lookup; github.com/shubhambhavsar/Togetherly)'};
 const search=new URL(base);
 for(const [key,value] of Object.entries({
  action:'wbsearchentities',search:q,language:'en',uselang:'en',type:'item',
  limit:'35',format:'json',formatversion:'2'
 }))search.searchParams.set(key,value);
 const first=await fetch(search,{headers,signal:AbortSignal.timeout(6500)});
 if(!first.ok)throw Error('Wikidata search unavailable');
 const found=await first.json();
 const matches=(Array.isArray(found.search)?found.search:[]).filter(x=>
  /^Q[1-9]\d*$/.test(x?.id||'')).slice(0,35);
 if(!matches.length)return [];
 const entitiesUrl=new URL(base);
 for(const [key,value] of Object.entries({
  action:'wbgetentities',ids:matches.map(x=>x.id).join('|'),
  props:'claims|labels|descriptions',languages:'en',format:'json',formatversion:'2'
 }))entitiesUrl.searchParams.set(key,value);
 const second=await fetch(entitiesUrl,{headers,signal:AbortSignal.timeout(6500)});
 if(!second.ok)throw Error('Wikidata details unavailable');
 const entities=(await second.json()).entities||{};
 const idFor=(entity,property)=>{
  const claims=entity?.claims?.[property];
  if(!Array.isArray(claims))return null;
  for(const claim of claims){
   if(claim?.rank==='deprecated')continue;
   const raw=claim?.mainsnak?.datavalue?.value;
   if(typeof raw!=='string'||! /^[1-9]\d{0,8}$/.test(raw))continue;
   const id=Number(raw);
   if(Number.isSafeInteger(id)&&id<=999999999)return id;
  }
  return null;
 };
 const entries=[],seen=new Set(),needle=q.toLocaleLowerCase('en').trim();
 for(const match of matches){
  const entity=entities[match.id];
  if(!entity)continue;
  const movie=idFor(entity,'P4947'),tv=idFor(entity,'P4983');
  const type=movie?'movie':tv?'tv':null;
  if(!type)continue;
  const id=movie||tv,identity=type+':'+id;
  if(seen.has(identity))continue;
  seen.add(identity);
  const title=String(entity.labels?.en?.value||match.label||'').slice(0,110);
  if(!title)continue;
  const description=String(entity.descriptions?.en?.value||match.description||'').slice(0,90);
  const m=description.match(/\b(?:18|19|20)\d{2}\b/);
  entries.push({id,type,title,year:m?m[0]:'',poster:null,description});
 }
 // Keep close title matches first without inventing title popularity.
 entries.sort((a,b)=>{
  const rank=x=>{
   const name=x.title.toLocaleLowerCase('en');
   return name===needle?0:name.startsWith(needle)?1:name.includes(needle)?2:3;
  };
  return rank(a)-rank(b);
 });
 return entries.slice(0,12);
}
// Validate a requested TV season and episode against TMDB metadata when
// configured. Episode counts are metadata, not proof a third-party player works.
const tvSeasonCache=new Map(),tvDetailsRate=new Map(),tvSeasonPending=new Map();
const tmdbCredentials=()=>({
 token:(process.env.TMDB_API_READ_TOKEN||'').trim(),
 key:(process.env.TMDB_API_KEY||'').trim()
});
async function catalogTvSeasons(id){
 if(!Number.isSafeInteger(id)||id<1||id>999999999)throw Error('Invalid series ID');
 const now=Date.now(),cached=tvSeasonCache.get(id);
 if(cached&&cached.until>now)return cached.seasons;
 const {token,key}=tmdbCredentials();
 if(!token&&!key)return null;
 const alreadyPending=tvSeasonPending.get(id);
 if(alreadyPending)return alreadyPending;
 const request=(async()=>{
  const url=new URL('https://api.themoviedb.org/3/tv/'+id);
  url.searchParams.set('language','en-US');
  if(!token)url.searchParams.set('api_key',key);
  const response=await fetch(url,{
   headers:token?{Authorization:'Bearer '+token}:{},
   signal:AbortSignal.timeout(6500)
  });
  if(!response.ok)throw Error('TV episode metadata unavailable');
  const body=await response.json();
  const seasons=(Array.isArray(body.seasons)?body.seasons:[])
   .filter(x=>Number.isSafeInteger(x.season_number)&&x.season_number>=1&&x.season_number<=99&&
     Number.isSafeInteger(x.episode_count)&&x.episode_count>=1&&x.episode_count<=999)
   .map(x=>({season:x.season_number,episodes:x.episode_count}))
   .sort((a,b)=>a.season-b.season);
  tvSeasonCache.set(id,{seasons,until:Date.now()+10*60*1000});
  if(tvSeasonCache.size>100)tvSeasonCache.delete(tvSeasonCache.keys().next().value);
  return seasons;
 })();
 tvSeasonPending.set(id,request);
 try{return await request}
 finally{tvSeasonPending.delete(id)}

}
app.get('/api/catalog/tv/:id/seasons',async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 const raw=String(req.params?.id||'');
 if(!/^[1-9]\d{0,8}$/.test(raw))return res.status(400).json({error:'Invalid TV series ID'});
 const now=Date.now(),ip=String(req.ip||'unknown'),hits=tvDetailsRate.get(ip)||{until:now+60000,n:0};
 if(now>hits.until){hits.until=now+60000;hits.n=0}
 hits.n++;tvDetailsRate.set(ip,hits);
 if(hits.n>30)return res.status(429).json({error:'Too many episode lookups. Try again shortly.'});
 if(!tmdbCredentials().token&&!tmdbCredentials().key)
  return res.status(503).json({error:'Episode counts unavailable without a TMDB credential'});
 try{
  const seasons=await catalogTvSeasons(Number(raw));
  return res.json({seasons:seasons||[]});
 }catch(error){
  console.warn('TV episode lookup failed:',error.message);
  return res.status(502).json({error:'Could not verify available seasons and episodes.'});
 }
});
app.get('/api/catalog/search',async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 const q=typeof req.query.q==='string'?req.query.q.trim():'';
 if(q.length<2||q.length>80)return res.status(400).json({error:'Enter a film or TV series name (2–80 characters)'});
 const now=Date.now(),ip=String(req.ip||'unknown'),hits=movieCatalogRate.get(ip)||{until:now+60000,n:0};
 if(hits.until<now){hits.until=now+60000;hits.n=0}
 hits.n++;movieCatalogRate.set(ip,hits);
 if(hits.n>25)return res.status(429).json({error:'Too many searches. Try again shortly.'});
 const cacheKey=q.toLowerCase(),cached=movieCatalogCache.get(cacheKey);
 if(cached&&cached.until>now)return res.json({results:cached.items,source:cached.source});
 const token=(process.env.TMDB_API_READ_TOKEN||'').trim();
 const key=(process.env.TMDB_API_KEY||'').trim();
 // Prefer TMDB posters and rich results when the owner has configured it.
 // Fall back to publicly indexed Wikidata IDs without requiring the user to
 // know an internal movie identifier or share API credentials.
 if(token||key){
  try{
   const url=new URL('https://api.themoviedb.org/3/search/multi');
   url.searchParams.set('query',q);url.searchParams.set('include_adult','false');
   url.searchParams.set('language','en-US');url.searchParams.set('page','1');
   if(!token)url.searchParams.set('api_key',key);
   const response=await fetch(url,{
    headers:token?{Authorization:'Bearer '+token}:{},
    signal:AbortSignal.timeout(6500)
   });
   if(!response.ok)throw Error('TMDB '+response.status);
   const payload=await response.json();
   const items=(Array.isArray(payload.results)?payload.results:[])
    .filter(x=>['movie','tv'].includes(x.media_type)&&Number.isSafeInteger(x.id)&&x.id>0)
    .slice(0,12).map(x=>({
     id:x.id,type:x.media_type,title:String(x.title||x.name||'Untitled').slice(0,110),
     year:String(x.release_date||x.first_air_date||'').slice(0,4),
     poster:/^\/[A-Za-z0-9_./-]+$/.test(x.poster_path||'')?'https://image.tmdb.org/t/p/w92'+x.poster_path:null,
     description:''
    }));
   movieCatalogCache.set(cacheKey,{items,source:'TMDB',until:now+10*60*1000});
   if(movieCatalogCache.size>100)movieCatalogCache.delete(movieCatalogCache.keys().next().value);
   return res.json({results:items,source:'TMDB'});
  }catch(error){console.warn('TMDB movie lookup failed; trying Wikidata fallback:',error.message)}
 }
 try{
  const items=await wikidataTitleSearch(q);
  movieCatalogCache.set(cacheKey,{items,source:'Wikidata',until:now+10*60*1000});
  if(movieCatalogCache.size>100)movieCatalogCache.delete(movieCatalogCache.keys().next().value);
  res.json({results:items,source:'Wikidata'});
 }catch(error){
  console.warn('Movie title lookup unavailable:',error.message);
  res.status(502).json({error:'Movie suggestions are temporarily unavailable. Please try again.'});
 }
});
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Content-Security-Policy',"frame-ancestors 'self'; frame-src 'self' https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://vidfast.vc");res.set('Referrer-Policy','strict-origin-when-cross-origin');res.set('Permissions-Policy','camera=(self), microphone=(self), geolocation=(), payment=(), display-capture=(), clipboard-read=(), clipboard-write=(self), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=()');next()});
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_req,res)=>res.json({ok:true,relayConfigured:Boolean((process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)||(process.env.METERED_TURN_DOMAIN&&process.env.METERED_TURN_API_KEY))}));
// Relay credentials are provided only to live room members. A TURN credential
// is necessarily delivered to browsers that need to make encrypted WebRTC calls.
// No account-wide Metered secret is sent to the client.
const rtcCache={value:null,expires:0};
const rtcHits=new Map();
function allowRtcRequest(req){
 const sid=req.query.sid, roomId=req.query.room;
 if(typeof sid!=='string'||typeof roomId!=='string'||!(/^[a-f0-9]{24}$/.test(roomId)))return false;
 const client=io.sockets?.sockets?.get(sid);
 if(!client||client.data.room!==roomId||!rooms.get(roomId)?.users.has(sid))return false;
 const now=Date.now(),entry=rtcHits.get(sid)||{count:0,until:now+60000};
 if(now>entry.until){entry.count=0;entry.until=now+60000}
 entry.count++;rtcHits.set(sid,entry);
 return entry.count<=12;
}
async function meteredIceServers(){
 const domain=(process.env.METERED_TURN_DOMAIN||'').trim().toLowerCase();
 const apiKey=(process.env.METERED_TURN_API_KEY||'').trim();
 if(!domain||!apiKey)return [];
 if(!/^[a-z0-9-]+\.metered\.live$/.test(domain))throw new Error('Invalid Metered TURN domain');
 if(rtcCache.value&&rtcCache.expires>Date.now())return rtcCache.value;
 const url=new URL('https://'+domain+'/api/v1/turn/credentials');
 url.searchParams.set('apiKey',apiKey);
 const response=await fetch(url,{signal:AbortSignal.timeout(6000)});
 if(!response.ok)throw new Error('Metered credentials request failed: '+response.status);
 const records=await response.json();
 if(!Array.isArray(records))throw new Error('TURN provider returned invalid configuration');
 const servers=records.filter(entry=>entry&&
  (typeof entry.urls==='string'||Array.isArray(entry.urls))&&
  [].concat(entry.urls).every(u=>typeof u==='string'&&/^(stun:|turn:|turns:)/.test(u))
 ).slice(0,12).map(entry=>({
  urls:entry.urls,...(entry.username?{username:entry.username}:{}),
  ...(entry.credential?{credential:entry.credential}:{})
 }));
 if(!servers.some(entry=>[].concat(entry.urls).some(u=>u.startsWith('turn:')||u.startsWith('turns:'))))throw new Error('TURN provider did not supply relays');
 rtcCache.value=servers;rtcCache.expires=Date.now()+4*60*1000;return servers;
}
app.get('/api/rtc',async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 if(!allowRtcRequest(req))return res.status(403).json({error:'Join a room to configure video calls'});
 const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
 let relayError=false;
 if(process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL){
  iceServers.push({urls:process.env.TURN_URL.split(',').map(v=>v.trim()),username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
 }else{
  try{iceServers.push(...await meteredIceServers())}
  catch(error){relayError=true;console.warn('TURN configuration unavailable:',error.message)}
 }
 res.json({iceServers,
  relayAvailable:iceServers.some(entry=>[].concat(entry.urls).some(u=>u.startsWith('turn:')||u.startsWith('turns:'))),
  relayError});
});

// YouTube Data API searches are optional, quota-limited, and never expose the API key.
const searchCache=new Map(),searchRates=new Map();
const searchBudget={day:'',uses:0};
async function searchYouTube(q){
 const now=Date.now(),cacheKey=q.toLowerCase(),saved=searchCache.get(cacheKey);
 if(saved&&saved.until>now)return saved.items;
 const day=new Date().toISOString().slice(0,10);
 if(searchBudget.day!==day){searchBudget.day=day;searchBudget.uses=0}
 if(searchBudget.uses>=70)throw new Error('Daily free search allowance used. Paste a link or try tomorrow.');
 const url=new URL('https://www.googleapis.com/youtube/v3/search');
 const opts={part:'snippet',type:'video',videoEmbeddable:'true',maxResults:'10',safeSearch:'moderate',q,key:process.env.YOUTUBE_API_KEY};
 for(const [k,v] of Object.entries(opts))url.searchParams.set(k,v);
 searchBudget.uses++;
 const response=await fetch(url,{signal:AbortSignal.timeout(9000)});
 if(!response.ok){console.warn('YouTube discovery failed:',response.status);throw new Error('YouTube search is unavailable. Try later or use a link.')}
 const body=await response.json();
 const candidates=(body.items||[]).filter(x=>/^[A-Za-z0-9_-]{11}$/.test(x.id?.videoId||'')).map(x=>({
  id:x.id.videoId,
  title:String(x.snippet?.title||'Untitled video').slice(0,150),
  channel:String(x.snippet?.channelTitle||'').slice(0,80)
 }));
 let items=candidates;
 // Search's videoEmbeddable filter is not a guarantee. Cross-check status.embeddable
 // and regional restrictions with videos.list (1 quota unit for the batch).
 if(candidates.length){
  try{
   const detailUrl=new URL('https://www.googleapis.com/youtube/v3/videos');
   for(const [k,v] of Object.entries({part:'status,contentDetails',id:candidates.map(v=>v.id).join(','),key:process.env.YOUTUBE_API_KEY}))detailUrl.searchParams.set(k,v);
   const detailResponse=await fetch(detailUrl,{signal:AbortSignal.timeout(9000)});
   if(!detailResponse.ok)throw Error('Video eligibility lookup returned '+detailResponse.status);
   const details=await detailResponse.json();
   const byId=new Map((details.items||[]).map(entry=>[entry.id,entry]));
   const usableInRegions=entry=>{
    const restriction=entry.contentDetails?.regionRestriction;
    const targets=['CA','IN'];
    if(restriction?.blocked&&targets.some(code=>restriction.blocked.includes(code)))return false;
    if(restriction?.allowed&&targets.some(code=>!restriction.allowed.includes(code)))return false;
    return true
   };
   items=candidates.filter(v=>{
    const entry=byId.get(v.id);
    return entry?.status?.embeddable===true&&entry.status?.privacyStatus==='public'&&usableInRegions(entry)
   }).map(v=>({...v,eligibility:'prechecked'}));
  }catch(e){
   console.warn('Video eligibility check unavailable:',e.message);
   // Show unverified results rather than pretending that we checked them.
   items=candidates.map(v=>({...v,eligibility:'unverified'}))
  }
 }
 if(searchCache.size>120)searchCache.clear();
 searchCache.set(cacheKey,{items,until:now+10*60*1000});return items;
}
app.get('/api/discovery-status',(req,res)=>res.json({searchReady:!!process.env.YOUTUBE_API_KEY}));
app.get('/room/:id',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const safeName=x=>typeof x==='string'?x.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,25):'';
const validRoom=x=>typeof x==='string'&&/^[a-f0-9]{24}$/.test(x);
const getVideo=x=>{if(typeof x!=='string'||x.length>500)return null;x=x.trim();if(/^[\w-]{11}$/.test(x))return x;try{const u=new URL(x);let id=null;if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)){id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]}else if(['youtu.be','www.youtu.be'].includes(u.hostname))id=u.pathname.split('/')[1];return /^[\w-]{11}$/.test(id||'')?id:null}catch{return null}};
// Shared external websites are experimental. No server-side fetching, proxying,
// credential handling, DRM bypassing, or remote play/pause control is provided.
function validateWebsiteUrl(raw){
 if(typeof raw!=='string'||raw.length>500||/[\x00-\x1f]/.test(raw))return null;
 try{
  const u=new URL(raw.trim());
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  if(!host.includes('.')||isIP(host)||host==='localhost'||host.endsWith('.localhost')||
     ['.local','.internal','.test','.invalid','.onion','.example'].some(suffix=>host.endsWith(suffix)))return null;
  if(host==='everydaygrove.ca'||host.endsWith('.everydaygrove.ca'))return null;
  if([...u.searchParams.keys()].some(k=>/^(access_token|auth|session|sessionid|apikey|api_key|password|credential|token|key)$/i.test(k)))return null;
  u.hash='';
  return u.toString();
 }catch{return null}
}
// Only opt-in browser companions can provide timing for supported HTML5 elements.
// The server never reads, relays, proxies, or identifies copyrighted video streams.
function flexflixHost(url){
 try{const u=new URL(url);return u.protocol==='https:'&&
  ['flexflix.site','www.flexflix.site'].includes(u.hostname.toLowerCase())}catch{return false}
}
const roomOf=s=>{const r=rooms.get(s.data.room);return r?.users.has(s.id)?r:null};
const websiteTimeline=r=>{
 const t=r.websiteTimeline;
 if(!t||r.source!=='website')return null;
 const now=Date.now();
 return {position:Math.max(0,Math.min(86400,t.position+(t.playing?(now-t.at)/1000:0))),
  playing:t.playing,version:r.version,receivedAt:now};
};
// A room timeline is an estimate until the host reports real player progress.
// It never depends on reading a cross-origin iframe directly.
const roomMovieTimeline=r=>{
 const t=r.movieTimeline;
 if(r.source!=='website'||!r.catalog||!t)return null;
 const now=Date.now();
 return {position:Math.max(0,Math.min(86400,t.position+(t.playing?(now-t.at)/1000:0))),
  playing:t.playing,version:r.version,receivedAt:now,
  origin:t.origin||'estimated'};
};
const state=r=>({source:r.source||'youtube',websiteUrl:r.websiteUrl||'',video:r.video,
 playing:r.source==='website'?false:r.playing,
 position:r.position+(r.playing&&r.source!=='website'?(Date.now()-r.at)/1000:0),
 version:r.version,catalog:r.catalog||null,websiteLeader:r.websiteLeader||null,
 movieTimeline:roomMovieTimeline(r),websiteTimeline:websiteTimeline(r)});
const members=r=>[...r.users].map(([id,name])=>({id,name}));
const callMembers=r=>[...r.callUsers].map(([id,meta])=>({id,role:meta.role,sharing:!!meta.sharing}));
const publishCall=r=>io.to(r.id).emit('call:members',callMembers(r));
function newRoom(id){return {id,users:new Map(),websiteLeader:null,websiteTimeline:null,movieTimeline:null,catalog:null,source:'youtube',websiteUrl:'',video:'M7lc1UVf-VE',playing:false,position:0,at:Date.now(),version:0,messages:[],callUsers:new Map(),queue:[],emptySince:Date.now()}}
setInterval(()=>{const cutoff=Date.now()-12*60*60*1000;for(const [id,r] of rooms){if(!r.users.size&&r.emptySince<cutoff)rooms.delete(id)}},30*60*1000).unref();

function leaveCall(s) {
 const r=roomOf(s);
 if(!r?.callUsers?.has(s.id))return;
 r.callUsers.delete(s.id);
 s.to(r.id).emit('call:peer-left',{id:s.id});
 publishCall(r);
}
function leave(s){leaveCall(s);const r=roomOf(s);if(!r)return;r.users.delete(s.id);s.leave(r.id);s.data.room=null;
 if(r.websiteLeader===s.id){r.websiteLeader=r.users.keys().next().value||null;r.websiteTimeline=null;io.to(r.id).emit('state',state(r))}
 io.to(r.id).emit('members',members(r));if(!r.users.size)r.emptySince=Date.now()}
io.on('connection',s=>{
s.on('create',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before creating a room'});if(roomOf(s))return ack({error:'Already in a room'});const id=randomBytes(12).toString('hex'),r=newRoom(id);rooms.set(id,r);r.users.set(s.id,safeName(d?.name));r.websiteLeader=s.id;s.data.room=id;s.join(id);ack({id,state:state(r),members:members(r),messages:[],callMembers:[],queue:[]})});
s.on('join',(d,ack)=>{if(typeof ack!=='function')return;if(!safeName(d?.name))return ack({error:'Enter your name before joining'});let r=validRoom(d?.id)?rooms.get(d.id):null;
 if(!r&&validRoom(d?.id)){r=newRoom(d.id);rooms.set(d.id,r)}
 if(!r)return ack({error:'Invalid room link'});if(r.users.size>=MAX_ROOM_PARTICIPANTS)return ack({error:'Room full'});if(roomOf(s))leave(s);r.users.set(s.id,safeName(d.name));if(!r.websiteLeader)r.websiteLeader=s.id;s.data.room=r.id;s.join(r.id);ack({id:r.id,state:state(r),members:members(r),messages:r.messages,callMembers:callMembers(r),queue:r.queue});io.to(r.id).emit('members',members(r))});
s.on('room:rename',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Not in a room'});
 const newName=safeName(d?.name);if(!newName)return ack?.({error:'Name is required'});
 r.users.set(s.id,newName);io.to(r.id).emit('members',members(r));
 ack?.({ok:true});
});
s.on('video',(d,ack)=>{const r=roomOf(s);if(!r)return;const video=getVideo(d?.url);if(!video)return ack?.({error:'Enter a valid YouTube link'});r.source='youtube';r.websiteUrl='';r.websiteTimeline=null;r.movieTimeline=null;r.catalog=null;r.video=video;r.position=0;r.playing=false;r.at=Date.now();r.version++;io.to(r.id).emit('state',state(r));ack?.({ok:true})});

// The old unrestricted website-sharing socket event remains reject-only for older clients.
s.on('website',(_d,ack)=>{
 ack?.({error:'Arbitrary website sharing was disabled for safety. Use the verified room controls.'});
});
s.on('catalog:play',async(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Join a room before sharing a movie'});
 const choice=catalogPlayer(d);
 if(!choice)return ack?.({error:'Select a supported provider and valid TMDB movie or episode'});
 const requestedVersion=r.version;
 // Reject nonexistent seasons/episodes when TMDB credentials are available.
 if(choice.type==='tv'){
  try{
   const seasons=await catalogTvSeasons(choice.id);
   if(seasons!==null){
    const match=seasons.find(x=>x.season===choice.season);
    if(!match||choice.episode>match.episodes)
     return ack?.({error:'That season or episode does not exist in TMDB metadata.'});
   }
  }catch(error){
   return ack?.({error:'Unable to verify TV episode details. Please retry.'});
  }
 }
 // The member might have disconnected while awaiting the metadata lookup.
 if(roomOf(s)!==r)return ack?.({error:'Room connection changed. Please try again.'});
 if(r.version!==requestedVersion)
  return ack?.({error:'Someone changed the room playback while the episode was being checked. Please try again.'});
 r.source='website';r.websiteUrl=choice.url;r.websiteTimeline=null;
 r.catalog={type:choice.type,id:choice.id,title:choice.title,provider:choice.provider,
   label:choice.label,...(choice.type==='tv'?{season:choice.season,episode:choice.episode}:{})};
 r.playing=false;r.position=0;r.at=Date.now();r.version++;
 // Start an approximate room clock as soon as the movie is shared.
 // The host can correct it after the real player starts or pauses.
 r.movieTimeline={position:0,playing:true,at:Date.now(),origin:'estimated'};
 io.to(r.id).emit('state',state(r));
 ack?.({ok:true,url:choice.url});
});
s.on('discover:search',async(d,ack)=>{
 if(typeof ack!=='function')return;
 if(!roomOf(s))return ack({error:'Join the watch room before searching'});
 if(!process.env.YOUTUBE_API_KEY)return ack({error:'In-app search needs a YouTube API key. Use the recent shelf or paste a link for now.'});
 const q=typeof d?.q==='string'?d.q.trim().slice(0,80):'';
 if(q.length<2)return ack({error:'Enter at least two characters'});
 const now=Date.now(),rate=searchRates.get(s.id)||{count:0,until:now+3600000};
 if(rate.until<now){rate.count=0;rate.until=now+3600000}
 rate.count++;searchRates.set(s.id,rate);
 if(rate.count>12)return ack({error:'Search limit reached. Please try later.'});
 try{ack({items:await searchYouTube(q)})}catch(e){ack({error:e.message})}
});
s.on('queue:add',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Join the room first'});
 const id=getVideo(d?.url);if(!id)return ack?.({error:'Enter a valid YouTube video'});
 if(r.queue.length>=20)return ack?.({error:'The queue is full'});
 const title=typeof d.title==='string'?d.title.trim().replace(/[\u0000-\u001f<>]/g,'').slice(0,140):'';
 const item={id:randomBytes(6).toString('hex'),video:id,title:title||'YouTube video',addedBy:r.users.get(s.id)};
 r.queue.push(item);io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true});
});
s.on('queue:play',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Join the room first'});
 const i=r.queue.findIndex(x=>x.id===d?.id);if(i<0)return ack?.({error:'Video not found in queue'});
 const item=r.queue.splice(i,1)[0];r.source='youtube';r.websiteUrl='';r.websiteTimeline=null;r.movieTimeline=null;r.catalog=null;r.video=item.video;r.playing=false;r.position=0;r.at=Date.now();r.version++;
 io.to(r.id).emit('state',state(r));io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true})
});
s.on('queue:remove',(d,ack)=>{
 const r=roomOf(s);if(!r)return ack?.({error:'Not in room'});
 const i=r.queue.findIndex(x=>x.id===d?.id);if(i<0)return ack?.({error:'Not in queue'});
 r.queue.splice(i,1);io.to(r.id).emit('queue:update',r.queue);ack?.({ok:true})
});
s.on('playback',d=>{const r=roomOf(s);if(!r||r.source==='website'||d?.version!==r.version||!['play','pause','seek'].includes(d?.action)||!Number.isFinite(d.position)||d.position<0||d.position>86400)return;r.position=d.position;r.playing=d.action==='play'?true:d.action==='pause'?false:r.playing;r.at=Date.now();s.to(r.id).emit('state',state(r))});
// Room-owner timeline controls are versioned and never touch third-party video URLs.
s.on('movie:control',(d,ack)=>{
 const r=roomOf(s);
 if(!r||r.source!=='website'||!r.catalog||!r.movieTimeline)
  return ack?.({error:'No movie is shared in this room'});
 if(r.websiteLeader!==s.id)return ack?.({error:'Only the room host can adjust the movie clock'});
 if(d?.version!==r.version||!['play','pause','seek','sample'].includes(d?.action)||
    !Number.isFinite(d?.position)||d.position<0||d.position>86400)
  return ack?.({error:'Invalid movie position or outdated room version'});
 if(d.action==='sample'&&typeof d.playing!=='boolean')
  return ack?.({error:'Invalid player sample'});
 const now=Date.now();
 if(d.action==='sample'&&now-(s.data.lastMovieSampleAt||0)<1000)
  return ack?.({error:'Player updates are too frequent'});
 if(d.action==='sample')s.data.lastMovieSampleAt=now;
 const previous=roomMovieTimeline(r);
 const playing=d.action==='play'?true:d.action==='pause'?false:
  d.action==='sample'?d.playing:r.movieTimeline.playing;
 const position=Math.min(86400,d.position);
 // Ignore tiny host event jitter rather than constantly adjusting the room.
 if(d.action==='sample'&&previous&&Math.abs(previous.position-position)<1.8&&
    previous.playing===playing)return ack?.({ok:true});
 r.movieTimeline={position,playing,at:now,
  origin:d.action==='sample'?'player':'manual'};
 io.to(r.id).emit('movie:timeline',roomMovieTimeline(r));
 ack?.({ok:true,timeline:roomMovieTimeline(r)});
});
s.on('sync',()=>{const r=roomOf(s);if(r)s.emit('state',state(r))});
s.on('website:sample',(d,ack)=>{
 const r=roomOf(s);
 if(!r||r.source!=='website'||!flexflixHost(r.websiteUrl))return ack?.({error:'No supported shared website'});
 if(r.websiteLeader!==s.id)return ack?.({error:'Only the room owner can set the website timeline'});
 if(d?.version!==r.version||!Number.isFinite(d?.position)||d.position<0||d.position>86400||
    typeof d.playing!=='boolean')return ack?.({error:'Invalid playback position'});
 const now=Date.now();
 if(now-(s.data.websiteSampleAt||0)<650)return ack?.({error:'Too many timing updates'});
 s.data.websiteSampleAt=now;
 r.websiteTimeline={position:d.position,playing:d.playing,at:now};
 io.to(r.id).emit('website:timeline',{leader:r.websiteLeader,version:r.version,
  timeline:websiteTimeline(r)});
 ack?.({ok:true});
});
function sendChat(d,ack){
 const r=roomOf(s);
 if(!r){ack?.({error:'You are not connected to a room'});return}
 if(typeof d?.text!=='string'){ack?.({error:'Enter a message'});return}
 const message=d.text.trim().slice(0,500);
 if(!message){ack?.({error:'Message cannot be empty'});return}
 const now=Date.now(),previous=s.data.lastChatAt||0;
 if(now-previous<250){ack?.({error:'Sending too quickly. Try again.'});return}
 s.data.lastChatAt=now;
 const m={id:randomBytes(8).toString('hex'),name:r.users.get(s.id),text:message,at:now};
 r.messages.push(m);if(r.messages.length>80)r.messages.shift();
 // Existing tabs use the legacy message event; new tabs use chat:new.
 io.to(r.id).emit('message',m);
 io.to(r.id).emit('chat:new',m);
 ack?.({ok:true,id:m.id});
}
s.on('chat:send',sendChat);
s.on('message',sendChat);

s.on('call:join',(data,ack)=>{
 const r=roomOf(s);if(typeof ack!=='function')return;
 if(!r)return ack({error:'Join the room first'});
 const role=data?.role==='camera'?'camera':'spectator';
 const previous=r.callUsers.get(s.id);
 if(previous?.role==='camera')return ack({error:'Already on camera'});
 const cameras=[...r.callUsers].filter(([,meta])=>meta.role==='camera');
 // Harmless repeat subscriptions can happen when a mobile network reconnects.
 if(previous?.role==='spectator'&&role==='spectator'){
  return ack({role,peers:cameras.filter(([,meta])=>meta.sharing).map(([id])=>id),callMembers:callMembers(r)});
 }
 if(role==='camera'&&cameras.length>=MAX_CAMERA_PARTICIPANTS)return ack({error:'Both camera seats are in use',code:'CAMERAS_FULL'});
 const peers=role==='camera'
 ?cameras.map(([id])=>id)
 :cameras.filter(([,meta])=>meta.sharing).map(([id])=>id);
 // Converting an automatic spectator to a camera seat does not require another join.
 if(previous?.role==='spectator'){
  r.callUsers.delete(s.id);
  s.to(r.id).emit('call:peer-left',{id:s.id});
 }
 // Camera publishing is explicitly requested by clicking "Join on camera —
 // visible to everyone in this room". Passive spectators never publish media.
 r.callUsers.set(s.id,{role,sharing:role==='camera'});
 ack({role,peers,callMembers:callMembers(r)});
 publishCall(r);
 s.to(r.id).emit('call:peer-joined',{id:s.id,role});
 if(role==='camera'){
  // Existing spectators are automatically invited to receive the new camera.
  for(const [id,meta] of r.callUsers){
   if(meta.role==='spectator')io.to(id).emit('call:publisher-available',{id:s.id});
  }
 }
});
s.on('call:share',(d,ack)=>{
 const r=roomOf(s),user=r?.callUsers.get(s.id);
 if(!user||user.role!=='camera')return ack?.({error:'Only camera participants can share their call'});
 const newValue=d?.enabled===true;
 if(user.sharing===newValue)return ack?.({ok:true});
 user.sharing=newValue;
 for(const [id,peer] of r.callUsers){
  if(peer.role!=='spectator')continue;
  io.to(id).emit(newValue?'call:publisher-available':'call:peer-left',{id:s.id});
  if(!newValue)io.to(s.id).emit('call:peer-left',{id});
 }
 publishCall(r);ack?.({ok:true,sharing:user.sharing});
});
s.on('call:leave',()=>leaveCall(s));
s.on('call:signal',d=>{
 const r=roomOf(s),from=r?.callUsers.get(s.id),to=r?.callUsers.get(d?.to);
 if(!from||!to||d.to===s.id||!d.data||typeof d.data!=='object'||Array.isArray(d.data))return;
 const cameraPair=from.role==='camera'&&to.role==='camera';
 const cameraToViewer=from.role==='camera'&&to.role==='spectator'&&from.sharing;
 const viewerToCamera=from.role==='spectator'&&to.role==='camera'&&to.sharing;
 if(!(cameraPair||cameraToViewer||viewerToCamera))return;
 let len;try{len=JSON.stringify(d.data).length}catch{return}
 if(len>16000)return;
 io.to(d.to).emit('call:signal',{from:s.id,data:d.data});
});
s.on('disconnect',()=>leave(s))
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Togetherly listening'));