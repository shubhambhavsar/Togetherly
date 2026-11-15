'use strict';
// Pure correction algorithm; no video URL, network, or DOM access.
(function(){
 function decide(actual,target,playing,readyState){
  if(!Number.isFinite(actual)||!Number.isFinite(target)||target<0||target>86400||readyState<2)return null;
  const drift=target-actual,abs=Math.abs(drift);
  if(!playing)return {seek:abs>1.0?target:null,rate:1,playing:false,drift};
  if(abs>=2.5)return {seek:target,rate:1,playing:true,drift};
  if(abs>=0.65)return {seek:null,rate:drift>0?1.07:0.93,playing:true,drift};
  return {seek:null,rate:1,playing:true,drift};
 }
 globalThis.TogetherlyDrift={decide};
})();
