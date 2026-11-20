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

  const guest=await context.newPage();
  guest.on('pageerror',err=>unexpected.push('guest: '+err.message));
  await guest.goto(url,{waitUntil:'domcontentloaded'});
  await guest.locator('#name').fill('Guest');
  await guest.locator('#join').click();
  await guest.locator('#watch').waitFor({state:'visible',timeout:15000});
  await guest.locator('#mobileNavPeople').click();
  await guest.locator('#peoplePanel').waitFor({state:'visible'});
  await guest.waitForFunction(()=>document.querySelectorAll('#members .member').length===2,{timeout:12000});
  await guest.locator('#mobileClosePeople').click();
  await guest.locator('#mobileNavChat').click();
  await guest.locator('#chatPanel.chat-open').waitFor({state:'visible'});
  await guest.locator('#chatText').fill('Togetherly browser regression');
  await guest.locator('#chatSend').click();
  await host.waitForFunction(()=>document.querySelector('#chat')?.textContent?.includes('Togetherly browser regression'),{timeout:12000});
  await guest.locator('#closeChat').click();

  await guest.setViewportSize({width:780,height:390});
  await guest.locator('#mobileNav').waitFor({state:'visible'});
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
