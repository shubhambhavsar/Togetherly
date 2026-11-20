'use strict';
// Appearance is a per-browser preference, never a room or socket setting.
(function initTogetherlyTheme(){
 const KEY='togetherly.appearance';
 let selected='cinema';
 try{const stored=localStorage.getItem(KEY);if(stored==='lounge'||stored==='cinema')selected=stored}catch{}
 function apply(theme,persist){
  const valid=theme==='lounge'?'lounge':'cinema';
  document.documentElement.dataset.theme=valid;
  if(persist)try{localStorage.setItem(KEY,valid)}catch{}
  const light=valid==='lounge';
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',light?'#FAF5EC':'#0B1420');
  const toggle=document.getElementById('themeToggle');
  if(toggle){
   toggle.setAttribute('aria-pressed',String(light));
   toggle.setAttribute('aria-label',light?'Switch to Private Cinema dark theme':'Switch to Living Room light theme');
   toggle.setAttribute('title',light?'Switch to Private Cinema':'Switch to Living Room');
  }
  const label=document.getElementById('themeToggleLabel');
  if(label)label.textContent=light?'Private Cinema':'Living Room';
  const icon=document.getElementById('themeToggleIcon');
  if(icon)icon.textContent=light?'☾':'☀';
 }
 apply(selected,false);
 document.addEventListener('DOMContentLoaded',()=>{
  apply(document.documentElement.dataset.theme,false);
  document.getElementById('themeToggle')?.addEventListener('click',()=>{
   apply(document.documentElement.dataset.theme==='lounge'?'cinema':'lounge',true);
  });
 });
})();
