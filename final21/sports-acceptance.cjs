'use strict';
// QA acceptance derived from sportsEventTaxonomy.js normalizeSportsEventPrediction
// and backend _sports_event_result_from_scores. No product policy/threshold changes.
const contract={taxonomyVersion:'omc-sports-events-v1',promptVersion:'clip-vit-b32-sports-prompts-v1',promptSetHash:'bb7498a26d925eb6fb08f560066bdc67bde4ff0aaae00eeeb12ad30448e5fe59',scoreType:'clip_cosine_similarity'};
const events={running:'track',relay:'track',hurdles:'track',high_jump:'field',long_jump:'field',pole_vault:'field',solid_ball:'field',shot_put:'field'};
const families=['track','field'],scenes=['opening_ceremony','spectators','awards'];
function sportsIssues(value,{wire=false}={}){
 const issues=[];if(!value||value.available!==true)return['SPORTS_AVAILABLE_TRUE_REQUIRED'];
 for(const[k,v]of Object.entries(contract))if(value[k]!==v)issues.push('SPORTS_CONTRACT_'+k);
 if(value.calibrated!==false||value.verified!==false)issues.push('SPORTS_UNCALIBRATED_UNVERIFIED_REQUIRED');
 const finite=(v,b)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=b;
 for(const k of ['score','familySimilarity','sceneSimilarity'])if(!finite(value[k],1))issues.push('SPORTS_COSINE_'+k);
 for(const k of ['top1Margin','familyMargin','sceneMargin'])if(!finite(value[k],2))issues.push('SPORTS_MARGIN_'+k);
 function rows(key,ids,event=false){const rows=value[key];if(!Array.isArray(rows)){issues.push('SPORTS_ROWS_'+key);return;}
  const seen=new Set();for(const r of rows){if(!r||!ids.includes(r.id)||seen.has(r.id)||!finite(r.score,1)||(event&&r.familyId!==events[r.id]))issues.push('SPORTS_CANDIDATE_'+key);seen.add(r?.id);}
  if(rows.length!==ids.length||ids.some(id=>!seen.has(id)))issues.push('SPORTS_CANDIDATE_CLOSURE_'+key);
 }
 rows('candidates',Object.keys(events),true);rows('familyCandidates',families);rows('sceneCandidates',wire?[...scenes,'other_scene']:scenes);
 const valid=(id,ids)=>id==='unknown'||ids.includes(id);
 if(!valid(value.familyId,families)||!valid(value.eventId,Object.keys(events))||!valid(value.sceneId,scenes)
  ||(value.eventId!=='unknown'&&events[value.eventId]!==value.familyId)
  ||!['candidate','unknown'].includes(value.status)
  ||(value.status==='unknown'&&[value.familyId,value.eventId,value.sceneId].some(v=>v!=='unknown'))
  ||(value.status==='candidate'&&[value.familyId,value.eventId,value.sceneId].every(v=>v==='unknown')))issues.push('SPORTS_HIERARCHY');
 return issues;
}
function assertSportsPrediction(value,options){const errors=sportsIssues(value,options);if(errors.length)throw Object.assign(new Error(errors.join(',')),{code:'SPORTS_ACCEPTANCE_CONTRACT_FAILED'});return value;}
function validUnknownFixture({wire=false}={}){return{...contract,available:true,status:'unknown',familyId:'unknown',eventId:'unknown',sceneId:'unknown',calibrated:false,verified:false,score:.1,top1Margin:0,familySimilarity:.1,familyMargin:0,sceneSimilarity:.1,sceneMargin:0,candidates:Object.entries(events).map(([id,familyId])=>({id,familyId,score:.1})),familyCandidates:families.map(id=>({id,score:.1})),sceneCandidates:(wire?[...scenes,'other_scene']:scenes).map(id=>({id,score:.1}))};}
module.exports={sportsIssues,assertSportsPrediction,validUnknownFixture,contract};
