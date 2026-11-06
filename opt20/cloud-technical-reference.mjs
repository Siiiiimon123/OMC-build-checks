// Cloud-only actual React component rendering; no native app or photos needed.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [source,output]=process.argv.slice(2);
assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Siiiiimon123/OMC-build-checks');
assert(process.env.GITHUB_REF==='refs/heads/verify-optimization20'&&process.env.GITHUB_RUN_ATTEMPT==='1');
const require=createRequire(path.join(source,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const vite=await import(pathToFileURL(require.resolve('vite')).href);
const {createServer}=vite.default??vite;
let server;
try{
 server=await createServer({root:source,logLevel:'error',server:{middlewareMode:true},appType:'custom'});
 const {PhotoAnalysisSummary}=await server.ssrLoadModule('/src/components/PhotoAnalysisSummary.jsx');
 const {evaluateTechnicalWasteSignals,TECHNICAL_SIGNAL_REFERENCE_VERSION}=await server.ssrLoadModule('/src/services/ai/technicalWasteEvaluator.js');
 function section(triage){
  const html=renderToStaticMarkup(React.createElement(PhotoAnalysisSummary,{photo:{id:'generated',fileName:'generated.jpg',format:'jpg',width:800,height:600,
   analysis:{recommendation:'review',technicalTriage:triage,technical:{warnings:[]}}},expanded:true}));
  const value=html.match(/<section class="technical-triage-summary"[\s\S]*?<\/section>/)?.[0];
  assert(value,'Actual component must render its technical section');return value;
 }
 const current=evaluateTechnicalWasteSignals({model:{hardRejectProbability:.005,defectProbabilities:{blur:.988}}});
 assert.equal(current.signalReferenceVersion,TECHNICAL_SIGNAL_REFERENCE_VERSION);
 const high=section(current);
 assert(high.includes('待人工复核')&&high.includes('风险参考 99 / 100')&&high.includes('非淘汰概率'));
 assert(!high.includes('置信度')&&!high.includes('%'));
 assert.equal(current.decision,'review');assert.equal(current.certificationRequired,false);
 const legacy=section({version:'legacy',decision:'review',confidence:.005,reasons:[{code:'severe_focus',label:'历史模糊风险',confidence:.005}]});
 assert(legacy.includes('历史分析')&&legacy.includes('历史模糊风险'));
 assert(!legacy.includes('置信度')&&!legacy.includes('%')&&!/\d+\s*\/\s*100/.test(legacy));
 const severe=section(evaluateTechnicalWasteSignals({measured:{sharpnessRaw:2},model:{hardRejectProbability:.999,defectProbabilities:{blur:.999}}}));
 assert(severe.includes('严重缺陷候选（仍需认证）')&&severe.includes('非淘汰概率'));
 const result={status:'PASS_ACTUAL_REACT_TECHNICAL_REFERENCE_RENDER',cases:3,
  highDefectLowOverallReject:'Review reference retained; no automatic promotion',legacy:'Old mixed-head number hidden; reanalysis prompt shown',
  severe:'Existing certification notice retained',nativeInteractionTested:false,realPhotosUsed:false,recognitionAccuracyQualified:false};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await server?.close();}
