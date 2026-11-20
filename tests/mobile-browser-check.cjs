'use strict';
// Browser-level smoke check of actual responsive CSS and WebRTC fake-device flows.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

const port=45639;
const origin='http://127.0.0.1:'+port;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(){
 for(let i=0;i<80;i++){
  try{const r=await fetch(origin+'/health');if(r.ok)return}catch{}
  await pause(250)
 }
 throw Error('Togetherly local service did not become healthy');
}
async function check(){
 const child=spawn(process.execPath,['server.js'],{
  env:{...process.env,PORT:String(port),NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe']
 });
 let output='';
 child.stdout.on('data',data=>output+=String(data));
 child.stderr.on('data',data=>output+=String(data));
 let browser;
 try{
  await ready();
  browser=await chromium.launch({
   headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']
  });
  const context=await browser.newContext({
   viewport:{width:390,height:844},permissions:['camera','microphone'],
   isMobile:true,hasTouch:true
  });
  const host=await context.newPage();
  const unexpected=[];
  host.on('pageerror',err=>unexpected.push('host: '+err.message));
  await host.goto(origin,{waitUntil:'domcontentloaded'});
  await host.locator('#name').fill('Mobile host');
  await host.locator('#create').click();
  await host.locator('#watch').waitFor({state:'visible',timeout:15000});
  await host.locator('#mobileNav').waitFor({state:'visible'});
  const url=host.url();
  assert.match(url,/\/room\/[a-f\d]{24}$/);
  assert.equal(await host.locator('#mobilePickerPanel').isVisible(),false);
  const overflow=await host.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(overflow<=2,'Unexpected mobile horizontal scroll: '+overflow);
  await host.locator('#mobileNavChoose').click();
  await host.locator('#mobilePickerPanel').waitFor({state:'visible'});
  assert.equal(await host.locator('#mobileNavChoose').getAttribute('aria-expanded'),'true');
  // Stable local metadata reproduces the Android screenshot without TMDB API dependency.
  await host.route('**/api/catalog/search*',route=>route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({source:'TMDB',results:[
    {id:1668,type:'tv',title:'Friends',year:'1994',
     poster:'https://image.tmdb.org/t/p/w92/friends.jpg',description:'Six friends make their way through life in New York.'},
    {id:7842,type:'tv',title:'Thomas & Friends',year:'1984',
     poster:'https://image.tmdb.org/t/p/w92/thomas.jpg',description:'Animated adventures of trains.'},
    {id:1885,type:'tv',title:'Among Friends',year:'1998'}]})
  }));
  await host.route('**/api/catalog/tv/1668/seasons',route=>route.fulfill({
   status:200,contentType:'application/json',body:JSON.stringify({
    seasons:[{season:1,episodes:24},{season:2,episodes:24}]})
  }));
  await host.locator('#catalogQuery').fill('Friends');
  await host.locator('#catalogSearchForm button[type="submit"]').click();
  await host.locator('#catalogResults .catalog-result').first().waitFor({state:'visible'});
  for(const width of [320,360,390,430]){
   await host.setViewportSize({width,height:844});
   const layout=await host.evaluate(()=>{
    const rect=id=>document.getElementById(id).getBoundingClientRect();
    const input=rect('catalogQuery'),action=document.querySelector('#catalogSearchForm button[type="submit"]').getBoundingClientRect();
    const label=document.querySelector('#catalogSearchForm label').getBoundingClientRect();
    const sheet=rect('mobilePickerPanel');
    return{input:{x:input.x,y:input.y,width:input.width,height:input.height,right:input.right},
     action:{x:action.x,y:action.y,width:action.width,height:action.height,right:action.right},
     label:{width:label.width,height:label.height},
     sheet:{x:sheet.x,right:sheet.right,width:sheet.width},
     horizontalOverflow:document.documentElement.scrollWidth-innerWidth};
   });
   assert.ok(layout.input.width>=140,'Movie search input too narrow at '+width+': '+JSON.stringify(layout));
   assert.ok(layout.label.width<=2,'Screen-reader-only label should not occupy space');
   assert.ok(Math.abs(layout.input.y-layout.action.y)<=3,'Search button must share same row at '+width);
   assert.ok(layout.input.right<=layout.action.x,'Search field must not overlap Find button');
   assert.ok(layout.action.right<=width+2,'Find button must fit within screen');
   assert.ok(layout.horizontalOverflow<=2,'No sideways scroll at '+width);
  }
  await host.setViewportSize({width:390,height:844});
  await host.locator('#catalogResults .catalog-result').first().click();
  await host.locator('#movieCatalog.is-title-selected').waitFor({state:'visible'});
  assert.equal(await host.locator('#catalogResults').isVisible(),false,'Results must disappear after selection');
  assert.equal(await host.locator('#catalogQuery').isVisible(),false,'Search should not compete with selection form');
  assert.equal((await host.locator('#catalogSelectedTitle').textContent()).trim(),'Friends');
  await host.locator('#catalogEpisodeHelp').waitFor({state:'visible'});
  const selection=await host.evaluate(()=>{
   const rect=id=>document.getElementById(id).getBoundingClientRect();
   const title=rect('catalogSelectedTitle'),meta=rect('catalogSelectedMeta'),
    button=rect('catalogChangeTitle'),poster=rect('catalogSelectedPoster');
   return{title:{width:title.width,height:title.height},meta:{width:meta.width},
    button:{width:button.width},poster:{width:poster.width},
    scrollWidth:document.documentElement.scrollWidth-innerWidth};
  });
  assert.ok(selection.title.width>=150,'Selected title column collapsed: '+JSON.stringify(selection));
  assert.ok(selection.meta.width>=150,'Title metadata column collapsed');
  assert.ok(selection.poster.width>=60,'Selected poster missing');
  assert.ok(selection.scrollWidth<=2,'Selected detail must not create horizontal scrolling');
  await host.locator('#catalogPlay').scrollIntoViewIfNeeded();
  const playBox=await host.locator('#catalogPlay').boundingBox();
  assert.ok(playBox.width>=300&&playBox.height>=48,'Primary watch button must be wide and tappable');
  await host.locator('#catalogChangeTitle').click();
  await host.locator('#catalogResults .catalog-result').first().waitFor({state:'visible'});
  assert.equal(await host.locator('#catalogPlayForm').isVisible(),false,'Back returns to search');
  await host.locator('#catalogQuery').evaluate(el=>el.blur());

  assert.equal(await host.locator('#mobileSheetBackdrop').isVisible(),true);
  await host.locator('#tabYouTube').click();
  await host.locator('#youtubeSourcePanel').waitFor({state:'visible'});
  await host.locator('#tabMovies').click();
  await host.locator('#movieSourcePanel').waitFor({state:'visible'});
  await host.locator('#mobileClosePicker').click();
  await host.locator('#mobilePickerPanel').waitFor({state:'hidden'});
  await host.locator('#mobileNavPeople').click();
  await host.locator('#peoplePanel').waitFor({state:'visible'});
  await host.locator('#call').waitFor({state:'visible'});
  await host.locator('#call').click();
  await host.locator('#callActiveControls').waitFor({state:'visible',timeout:12000});
  await host.locator('#mic').click();
  assert.match(await host.locator('#mic').textContent(),/Unmute microphone/);
  assert.equal(await host.locator('#mic').getAttribute('aria-pressed'),'true');
  await host.locator('#mic').click();
  await host.locator('#camera').click();
  assert.match(await host.locator('#camera').textContent(),/Turn camera on/);
  await host.locator('#camera').click();

  // Separate browser storage from the host; real guests have independent nicknames.
  const guestContext=await browser.newContext({
   viewport:{width:390,height:844},permissions:['camera','microphone'],
   isMobile:true,hasTouch:true
  });
  const guest=await guestContext.newPage();
  guest.on('pageerror',err=>unexpected.push('guest: '+err.message));
  await guest.goto(url,{waitUntil:'domcontentloaded'});
  await guest.locator('#name').fill('Guest');
  await guest.locator('#join').click();
  await guest.locator('#watch').waitFor({state:'visible',timeout:15000});
  await guest.locator('#mobileNavPeople').click();
  await guest.locator('#peoplePanel').waitFor({state:'visible'});
  await guest.waitForFunction(()=>document.querySelectorAll('#members .member').length===2,null,{timeout:12000});
  await guest.waitForFunction(()=>[...document.querySelectorAll('#callGrid video')]
   .some(video=>video.srcObject&&video.srcObject.getVideoTracks().length>0),null,{timeout:15000});
  const remoteVideos=await guest.evaluate(()=>[...document.querySelectorAll('#callGrid video')]
   .filter(video=>video.srcObject?.getVideoTracks().length>0).length);
  console.log('Guest remote camera streams:',remoteVideos);
  await guest.locator('#mobileClosePeople').click();
  await guest.locator('#mobileNavChat').click();
  await guest.locator('#chatPanel.chat-open').waitFor({state:'visible'});
  await guest.locator('#chatText').fill('Togetherly browser regression');
  await guest.locator('#chatSend').click();
  await host.waitForFunction(()=>document.querySelector('#chat')?.textContent?.includes('Togetherly browser regression'),{timeout:12000});
  await guest.evaluate(()=>{
   window.__chatClickTrace=[];
   const closer=document.getElementById('closeChat');
   closer.addEventListener('pointerdown',()=>window.__chatClickTrace.push('pointerdown close'),true);
   closer.addEventListener('click',()=>window.__chatClickTrace.push('click close capture'),true);
   document.addEventListener('click',e=>{
    if(e.target.closest('#closeChat'))window.__chatClickTrace.push('document clicked close')
   },true);
  });
  await guest.locator('#closeChat').click();
  await pause(160);
  const chatClosing=await guest.evaluate(()=>({
   className:document.getElementById('chatPanel').className,
   body:document.body.className,
   active:document.activeElement?.id,
   handler:typeof document.getElementById('closeChat').onclick,
   chatOpenValue:typeof chatOpen!=='undefined'?chatOpen:'missing',
   trace:window.__chatClickTrace,
   closeRect:document.getElementById('closeChat').getBoundingClientRect().toJSON()
  }));
  console.log('Chat dismissal diagnostic:',JSON.stringify(chatClosing));
  await guest.locator('#chatPanel.chat-open').waitFor({state:'hidden',timeout:3500});

  await guest.setViewportSize({width:780,height:390});
  const landscape=await guest.evaluate(()=>({
   innerWidth:innerWidth,innerHeight:innerHeight,body:document.body.className,
   mobileMatch:matchMedia('(max-width:800px), (pointer:coarse) and (max-width:1050px)').matches,
   navDisplay:getComputedStyle(document.getElementById('mobileNav')).display,
   navRect:document.getElementById('mobileNav').getBoundingClientRect().toJSON()
  }));
  console.log('Landscape mobile diagnostic:',JSON.stringify(landscape));
  await guest.locator('#mobileNav').waitFor({state:'visible',timeout:3000});
  await guest.locator('#mobileNavChoose').click();
  const bounds=await guest.locator('#mobilePickerPanel').boundingBox();
  assert.ok(bounds.width<=784&&bounds.height<=390,'Discover sheet overflows phone landscape');
  await guest.locator('#mobileClosePicker').click();
  await guest.locator('#toolbarFullscreen').click();
  await guest.locator('#videoShell.theater-mode').waitFor({state:'visible'});
  const control=await guest.locator('#theaterDock').boundingBox();
  assert.ok(control.x<80&&control.y<80,'Fullscreen Exit must stay in upper-left corner');
  await guest.locator('#fullscreenToggle').click();
  await guest.locator('#videoShell.theater-mode').waitFor({state:'hidden'});
  await host.locator('#mobileClosePeople').click();
  await host.locator('#mobileNavPeople').click();
  await host.locator('#hangup').click();
  await host.locator('#call').waitFor({state:'visible',timeout:12000});
  assert.equal(unexpected.length,0,'Unexpected page errors: '+unexpected.join(' | '));
  console.log('Mobile viewport, navigation, room chat, camera permission, mute controls, and fullscreen verified');
 }finally{
  if(browser)await browser.close();
  child.kill('SIGTERM');
 }
}
check().catch(err=>{console.error(err);process.exitCode=1});
