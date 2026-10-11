import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {hash,readSnapshot,assertOutside} from './snapshot.js';
import {cacheStore} from './cache.js';
import {parseJava} from './java.js';
import {parseTypeScript} from './typescript.js';
import {declarations,buildGraph,compareDeclarations,impacts} from './graph.js';
import {validateRules,validateDate,evaluateRules,guidance} from './rules.js';
export const ANALYZER_VERSION='0.2.0';
export function buildIdentity() {
  const root=path.dirname(fileURLToPath(import.meta.url));
  const sources=fs.readdirSync(root).filter(p=>p.endsWith('.js')).sort().map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]);
  for(const folder of ['app','ui']) {
    const dir=path.join(root,'..',folder);
    if(!fs.existsSync(dir))continue;
    const walk=(base)=>fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?walk(path.join(base,entry.name)):entry.isFile()?[[path.relative(path.join(root,'..'),path.join(base,entry.name)),hash(fs.readFileSync(path.join(base,entry.name)))]]:[]);
    sources.push(...walk(dir));
  }
  const lock=fs.readFileSync(path.join(root,'../package-lock.json'));
  return {version:ANALYZER_VERSION,sourceBuildHash:hash([sources,hash(lock)]),parsers:{java:'java-parser@3.0.1',typescript:'typescript@5.9.3'}};
}
/** Shared source facts for the typed workspace graph; does not execute examined code. */
export function inspectSnapshot(spec,{cacheDir}={}) {
  const snapshot=readSnapshot(spec),identity=buildIdentity();
  const stats={parsedFiles:0,reusedFiles:0,invalidEntries:0};
  const store=cacheStore(assertOutside(cacheDir,[spec.root]),stats),parsed={};
  for(const [file,source]of Object.entries(snapshot.files)) {
    const key=hash({kind:'parse-v1',identity,file,contentHash:source.hash});
    const existing=store.get(key);
    if(existing){parsed[file]=existing;stats.reusedFiles++;continue;}
    try{parsed[file]=file.endsWith('.java')?parseJava(file,source.text):parseTypeScript(file,source.text);}
    catch(error){parsed[file]={language:file.endsWith('.java')?'java':'typescript',declarations:[],references:[],endpoints:[],unknowns:[{reason:'parse-error',detail:error.message,range:{startLine:1,endLine:1}}]};}
    stats.parsedFiles++;store.set(key,parsed[file]);
  }
  return {snapshot,parsed,graph:buildGraph(snapshot,parsed),declarations:declarations(snapshot,parsed),cache:stats};
}
export function analyze(options) {
  const started=performance.now();
  validateDate(options.asOf);const config=validateRules(options.rules);if(options.baselineRules)validateRules(options.baselineRules);
  const cacheDir=assertOutside(options.cacheDir,[options.baseline.root,options.candidate.root]);
  const before=options.baselineSnapshot||readSnapshot(options.baseline);const after=options.candidateSnapshot||readSnapshot(options.candidate);
  const identity=buildIdentity();if(options.analyzerVersion)identity.version=options.analyzerVersion;
  const stats={report:options.cacheDir?'miss':'disabled',parsedFiles:0,reusedFiles:0,invalidEntries:0};
  const store=cacheStore(cacheDir,stats);
  const reportKey=hash({kind:'report-v1',identity,baseline:{root:before.root,revision:before.revision,hash:before.contentHash,excluded:before.excluded},candidate:{root:after.root,revision:after.revision,hash:after.contentHash,excluded:after.excluded},rules:config,baselineRules:options.baselineRules||null,asOf:options.asOf,task:options.task||null,paths:options.paths||[]});
  const dirty=before.dirty||after.dirty;
  if(dirty)stats.report='bypass-dirty';
  if(!dirty&&options.cacheDir) {
    const cached=store.get(reportKey);
    if(cached)return {...cached,cache:{...stats,report:'hit'},metrics:{...cached.metrics,elapsedMs:Math.round((performance.now()-started)*100)/100,reportCacheHit:true}};
  }
  function parse(snapshot) {
    const result={};
    for(const [file,source]of Object.entries(snapshot.files)) {
      const key=hash({kind:'parse-v1',identity,file,contentHash:source.hash});
      const cached=store.get(key);
      if(cached){result[file]=cached;stats.reusedFiles++;continue;}
      let parsed;
      try {parsed=file.endsWith('.java')?parseJava(file,source.text):parseTypeScript(file,source.text);}catch(error){parsed={language:file.endsWith('.java')?'java':'typescript',declarations:[],references:[],endpoints:[],unknowns:[{reason:'parse-error',detail:error.message,range:{startLine:1,endLine:1}}]};}
      result[file]=parsed;stats.parsedFiles++;store.set(key,parsed);
    }
    return result;
  }
  const parsedBefore=options.parsedBaseline||parse(before);const parsedAfter=options.parsedCandidate||parse(after);
  const changes=compareDeclarations(declarations(before,parsedBefore),declarations(after,parsedAfter));
  const graphBefore=buildGraph(before,parsedBefore);const graphAfter=buildGraph(after,parsedAfter);
  const impact=impacts(changes,[graphBefore,graphAfter]);
  const findings=evaluateRules(before,after,parsedBefore,parsedAfter,config,options.baselineRules,options.asOf);
  const unknowns=[...graphBefore.unknowns,...graphAfter.unknowns];
  const changedPaths=[...new Set(changes.flatMap(c=>[c.before?.path,c.after?.path]).filter(Boolean))];
  const tests=[];
  for(const change of changes.filter(c=>c.contractChanged))tests.push({kind:'contract',reason:`Verify ${change.name} parameter, return and payload compatibility; removed declarations need caller compile checks`,evidence:change.after||change.before});
  for(const edge of impact.direct.filter(e=>e.kind==='http'))tests.push({kind:'api-consumer',reason:'Exercise HTTP route, verb, serialization, empty/not-found/error responses and consumer rendering',evidence:edge.evidence,targetEvidence:edge.targetEvidence});
  for(const item of impact.indirect)tests.push({kind:'indirect-consumer',reason:'Exercise likely indirect consumer with changed payload and failure/empty states',path:item.path,chain:item.chain});
  const report={schemaVersion:'1.0',analyzer:identity,advisory:true,asOf:options.asOf,provenance:{baseline:{root:before.root,type:before.type,revision:before.revision,contentHash:before.contentHash,dirty:before.dirty},candidate:{root:after.root,type:after.type,revision:after.revision,contentHash:after.contentHash,dirty:after.dirty},rulesHash:hash(config),baselineRulesHash:hash(options.baselineRules||config),cacheKey:reportKey},changes,impact,findings,guidance:guidance(after,config,{task:options.task,paths:options.paths||changedPaths,asOf:options.asOf}),unknowns,focusedTests:tests,coverage:{complete:false,fullRegressionMayBeSkipped:false,sourceFiles:{baseline:Object.keys(before.files).length,candidate:Object.keys(after.files).length},excluded:{baseline:before.excluded,candidate:after.excluded},limitations:['Source-only analysis; no Java/TypeScript semantic compilation, runtime dispatch, reflection, DI wiring, proxy/origin verification or transitive external package sources','Edges are evidence-backed approximations; indirect file dependencies do not prove execution','Renames inferred only for identical declaration key/signature/body; edited renames remain delete/add','Unknown syntax and unresolved/dynamic dependencies remain visible; passing fixture tests is not private-repository acceptance']},cache:stats,metrics:{elapsedMs:Math.round((performance.now()-started)*100)/100,bytesRead:Object.values(before.files).concat(Object.values(after.files)).reduce((sum,f)=>sum+Buffer.byteLength(f.text),0),reportCacheHit:false}};
  if(!dirty)store.set(reportKey,report);
  return report;
}
export function preCodeGuidance({root,rules,task,paths=[]}) {
  if(!task?.trim())throw new Error('A developer task is required for pre-code guidance');
  const snapshot=readSnapshot({type:'directory',root});validateRules(rules);
  return {analyzer:buildIdentity(),advisory:true,provenance:{revision:snapshot.revision,contentHash:snapshot.contentHash},guidance:guidance(snapshot,rules,{task,paths})};
}
