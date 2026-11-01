'use strict';
function validateRoute(config){const formal=new URL(config.formalMetadataPrefix),qa=new URL(config.qaMetadataPrefix);if(formal.href!=='https://omc.xiaoa.cyou/updates/metadata/'||qa.protocol!=='https:'||qa.hostname!=='omc.xiaoa.cyou'||qa.port||qa.username||qa.password||qa.search||qa.hash||!/^\/updates\/qa-r1\/[A-Za-z0-9_-]{16,96}\/$/.test(qa.pathname))throw Error('QA_ROUTE_CONFIG_INVALID');return{formalMetadataPrefix:formal.href,qaMetadataPrefix:qa.href};}
// Serializable into the paused normal main. Body/status/headers are not rewritten.
function installControlledRoute(config){
 const formal=new URL(config.formalMetadataPrefix),qa=new URL(config.qaMetadataPrefix);
 if(formal.href!=='https://omc.xiaoa.cyou/updates/metadata/'||qa.protocol!=='https:'||qa.hostname!=='omc.xiaoa.cyou'||qa.port||qa.username||qa.password||qa.search||qa.hash||!/^\/updates\/qa-r1\/[A-Za-z0-9_-]{16,96}\/$/.test(qa.pathname))throw Error('QA_ROUTE_CONFIG_INVALID');
 if(globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__)throw Error('QA_ROUTE_ALREADY_INSTALLED');const original=globalThis.fetch;if(typeof original!=='function')throw Error('GLOBAL_FETCH_NOT_READY');
 const observation={controlledTransportRoute:true,formalUrlServingTested:false,metadataRequestsRouted:0,nonMetadataRequestsForwarded:0,unexpectedActualRedirects:0};
 globalThis.__OMC_CONTROLLED_ROUTE_EVIDENCE__=observation;
 globalThis.fetch=async function(input,options){const requested=new URL(typeof input==='string'?input:input.url??input.href);if(!requested.href.startsWith(formal.href)){observation.nonMetadataRequestsForwarded++;return original.call(this,input,options);}const tail=requested.href.slice(formal.href.length);if(!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(tail)||tail.split('/').includes('..'))throw Error('QA_METADATA_PATH_INVALID');const mapped=new URL(tail,qa).href;const response=await original.call(this,mapped,options);if(response.url&&response.url!==mapped){observation.unexpectedActualRedirects++;throw Error('QA_ACTUAL_TRANSPORT_REDIRECT');}Object.defineProperty(response,'url',{value:requested.href,configurable:true});observation.metadataRequestsRouted++;return response;};
 return{...observation,installedBeforeApplicationResume:true};
}
module.exports={validateRoute,installControlledRoute};
