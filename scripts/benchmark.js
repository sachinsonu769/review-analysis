import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {analyze,buildIdentity} from '../src/engine.js';
const root=path.resolve(import.meta.dirname,'..');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'review-analysis-benchmark-'));
try {
 const cache=path.join(directory,'cache');const baseline=path.join(root,'fixtures/lookup/baseline');const candidate=path.join(directory,'candidate');fs.cpSync(path.join(root,'fixtures/lookup/candidate'),candidate,{recursive:true});
 const rulesPath=path.join(root,'fixtures/rules.json');const rules=JSON.parse(fs.readFileSync(rulesPath,'utf8'));const options={baseline:{type:'directory',root:baseline},candidate:{type:'directory',root:candidate},rules,asOf:'2026-10-11',cacheDir:cache};
 const processRuns=[];
 for(let i=0;i<3;i++) {const start=performance.now();const run=spawnSync(process.execPath,[path.join(root,'src/cli.js'),'analyze','--baseline',baseline,'--candidate',candidate,'--rules',rulesPath,'--as-of','2026-10-11'],{encoding:'utf8',maxBuffer:32*1024*1024});if(run.status!==0)throw new Error(run.stderr);const result=JSON.parse(run.stdout);processRuns.push({wallMs:Math.round((performance.now()-start)*100)/100,analysisMs:result.metrics.elapsedMs});}
 const cold=analyze(options);const warm=Array.from({length:5},()=>analyze(options));
 const modified=path.join(candidate,'frontend/src/api/lookupApi.ts');fs.appendFileSync(modified,'\n// incremental content change for benchmark\n');const incremental=analyze(options);
 const median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)];
 process.stdout.write(JSON.stringify({recordedAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,architecture:process.arch},analyzer:buildIdentity(),fixture:{sourceFiles:cold.coverage.sourceFiles,bytesRead:cold.metrics.bytesRead,changes:cold.changes.length},coldProcess:{runs:processRuns,medianWallMs:median(processRuns.map(r=>r.wallMs)),medianAnalysisMs:median(processRuns.map(r=>r.analysisMs))},sameProcessCold:{metrics:cold.metrics,cache:cold.cache},sameProcessWarm:{runsMs:warm.map(r=>r.metrics.elapsedMs),medianMs:median(warm.map(r=>r.metrics.elapsedMs)),cache:warm[0].cache},incremental:{metrics:incremental.metrics,cache:incremental.cache},limitations:'Tiny fixture measurement in this cloud environment; includes full source scan even on cache hits. Does not predict private repository scale or efficacy.'},null,2)+'\n');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
