'use strict';
function validateRoute(config){const formal=new URL(config.formalMetadataPrefix),qa=new URL(config.qaMetadataPrefix);if(formal.href!=='https://omc.xiaoa.cyou/updates/metadata/'||qa.protocol!=='https:'||qa.hostname!=='omc.xiaoa.cyou'||qa.port||qa.username||qa.password||qa.search||qa.hash||!/^\/updates\/qa-r1\/[A-Za-z0-9_-]{16,96}\/$/.test(qa.pathname))throw Error('QA_ROUTE_CONFIG_INVALID');return{formalMetadataPrefix:formal.href,qaMetadataPrefix:qa.href};}
// Serializable into the paused normal main. Body/status/headers are not rewritten.
function installControlledRoute(config){
 const formal=new URL(config.formalMetadataPrefix),qa=new URL(config.qaMetadataPrefix);
 if(formal.href!=='https://omc.xiaoa.cyou/updates/metadata/'||qa.protocol!=='https:'||qa.hostname!=='omc.xiaoa.cyou'||qa.port||qa.username||qa.password||qa.search||qa.hash||!/^\/updates\/qa-r1\/[A-Za-z0-9_-]{16,96}\/$/.test(qa.pathname))throw Error('QA_ROUTE_CONFIG_INVALID');
 if(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__)throw Error('QA_ROUTE_ALREADY_INSTALLED');const original=globalThis.fetch;if(typeof original!=='function')throw Error('GLOBAL_FETCH_NOT_READY');
 const observation={controlledTransportRoute:true,formalUrlServingTested:false,metadataRequestsRouted:0,targetRequestsRouted:0,packageRequestsRouted:0,packageSha256Routed:null,nonMetadataRequestsForwarded:0,unexpectedActualRedirects:0};
 globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__=observation;
 globalThis.fetch=async function(input,options){
  const raw=typeof input==='string'?input:input.url??input.href,requested=new URL(raw);
  const m=/^https:\/\/[^/?#]+(\/[^?#]*)?(?:[?#].*)?$/i.exec(raw),rawPath=m?.[1]||'/';
  if(requested.origin===formal.origin&&(!m||/[%\\]/.test(rawPath)||rawPath.includes('//')))throw Error('QA_ROUTE_PATH_INVALID');
  const prefixes={metadata:'/updates/metadata/',target:'/updates/targets/'};
  const kind=requested.origin===formal.origin?Object.keys(prefixes).find(k=>requested.pathname.startsWith(prefixes[k])):null;
  if(!kind){if(requested.origin===formal.origin&&Object.values(prefixes).some(p=>rawPath.startsWith(p)))throw Error('QA_ROUTE_PATH_INVALID');observation.nonMetadataRequestsForwarded++;return original.call(this,input,options);}
  const tail=requested.pathname.slice(prefixes[kind].length);
  if(requested.username||requested.password||requested.search||requested.hash||requested.pathname!==rawPath||!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(tail)||tail.split('/').some(x=>x==='.'||x==='..')||(kind==='metadata'&&!tail.endsWith('.json')))throw Error('QA_ROUTE_PATH_INVALID');
  const mapped=new URL((kind==='target'?'targets/':'')+tail,qa).href,mappedInput=typeof input==='string'?mapped:new Request(mapped,input);
  const response=await original.call(this,mappedInput,{...options,redirect:'manual'});
  if((response.status>=300&&response.status<400)||(response.url&&response.url!==mapped)){observation.unexpectedActualRedirects++;throw Error('QA_ACTUAL_TRANSPORT_REDIRECT');}
  Object.defineProperty(response,'url',{value:requested.href,configurable:true});if(kind==='metadata')observation.metadataRequestsRouted++;else{observation.targetRequestsRouted++;const pkg=/^releases\/([a-f0-9]{64})\.[A-Za-z0-9_.-]+\.pkg$/.exec(tail);if(pkg&&(response.status===200||response.status===206)){observation.packageRequestsRouted++;observation.packageSha256Routed=pkg[1];}}return response;
 };
 return{...observation,installedBeforeApplicationResume:true};
}
module.exports={validateRoute,installControlledRoute};
