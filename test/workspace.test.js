import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {analyzeWorkspace,validateWorkspace} from '../app-dist/workspace.js';
import {impactPaths} from '../app-dist/graph-model.js';
import {readSnapshot,hash} from '../src/snapshot.js';
import {guidance} from '../src/rules.js';
import {demos} from '../src/server.js';
const quality={pmdEnabled:false,duplication:{minTokens:100000,minLines:100000}};
const analyze=(workspace,extra={})=>analyzeWorkspace({workspace,asOf:'2026-10-11',quality,...extra});
function tmp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-workspace-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function write(root,file,text){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
const fixture=(id,baseline,candidate)=>({id,repository:'example/'+id,module:id,baseline:{type:'directory',root:baseline},candidate:{type:'directory',root:candidate}});

test('central graph maps split HTTP dependencies only through explicit versioned mappings',async()=>{
  const configured=demos().find(d=>d.id==='split').workspace;
  const mapped=await analyze(configured);
  assert(mapped.graph.edges.some(e=>e.crossRepository&&e.mappingId==='demo-api-origin'&&e.kind==='http'));
  assert(mapped.impact.paths.some(p=>p.edgeIds.some(id=>mapped.graph.edges.find(e=>e.id===id)?.crossRepository)));
  const unmapped=await analyze({...configured,mappings:[]});
  assert(!unmapped.graph.edges.some(e=>e.crossRepository));
  assert(unmapped.unknowns.some(u=>u.reason==='unmatched-endpoint'));
  assert.equal(mapped.requirements.status,'draft');assert.equal(mapped.requirements.criteria.length,0);
});

test('typed graph keeps same-phase bounded paths and low certainty for indirect chains',()=>{
  const edge=(id,source,target,phase)=>({id,source,target,phase,confidence:'high'});
  const mixed={edges:[edge('old','A','B','baseline'),edge('new','B','C','candidate')],nodes:[]};
  assert.deepEqual(impactPaths(mixed,['C']).map(p=>p.nodeIds),[['B','C']]);
  const joined={edges:[edge('a','A','B','candidate'),edge('b','B','C','candidate'),edge('cycle','C','A','candidate')],nodes:[]};
  const paths=impactPaths(joined,['C']);assert(paths.some(p=>p.kind==='likely-indirect'&&p.confidence==='low'));assert(paths.every(p=>new Set(p.nodeIds).size===p.nodeIds.length));
});

test('import-only edits mark changed nodes and their incoming impact without inventing declarations',async(t)=>{
  const dir=tmp(t),baseline=path.join(dir,'baseline'),candidate=path.join(dir,'candidate');
  write(baseline,'feature.ts',"import './old';\n");write(candidate,'feature.ts',"import './new';\n");
  for(const root of [baseline,candidate]){write(root,'caller.ts',"import './feature';\n");write(root,'old.ts','');write(root,'new.ts','');}
  const report=await analyze({version:'1',projects:[fixture('one',baseline,candidate)],mappings:[]});
  assert.equal(report.changes.length,0);
  assert(report.graph.nodes.find(n=>n.path==='feature.ts').changed);
  assert(report.impact.paths.some(p=>p.source==='one::caller.ts'&&p.target==='one::feature.ts'));
});

test('explicit package-source mapping has missing-source and safe-path negatives',async(t)=>{
  const dir=tmp(t),a=path.join(dir,'a'),b=path.join(dir,'b');write(a,'consumer.ts',"import {Contract} from '@shared/contracts';\nexport type Model=Contract;\n");write(b,'contracts.ts','export interface Contract {id:string}\n');
  const mapping={id:'contracts',kind:'import',fromProject:'frontend',toProject:'shared',specifier:'@shared/contracts',targetPath:'contracts.ts',owner:'Fixture owner',version:'1'};
  const workspace={version:'1',projects:[fixture('frontend',a,a),fixture('shared',b,b)],mappings:[mapping]};
  const mapped=await analyze(workspace);assert(mapped.graph.edges.some(e=>e.mappingId==='contracts'));
  const missing=await analyze({...workspace,mappings:[{...mapping,targetPath:'missing.ts'}]});assert(missing.unknowns.some(u=>u.reason==='missing-cross-project-source'));
  assert.throws(()=>validateWorkspace({...workspace,mappings:[{...mapping,targetPath:'../escape.ts'}]}),/relative targetPath/);
});

test('all central edge provenance reproduces exact project source and revisions',async()=>{
  const workspace=demos().find(d=>d.id==='angular').workspace,report=await analyze(workspace);
  const snapshots=new Map(workspace.projects.flatMap(p=>[['baseline','candidate'].map(phase=>[p.id+':'+phase,readSnapshot(p[phase])])]).flat());
  for(const edge of report.graph.edges)for(const evidence of [edge.evidence,edge.targetEvidence]) {
    const snapshot=snapshots.get(evidence.projectId+':'+edge.phase),source=snapshot.files[evidence.path];
    assert.equal(evidence.revision,snapshot.revision);assert.equal(evidence.fileHash,hash(source.text));assert.equal(evidence.excerpt,source.text.split(/\r?\n/).slice(evidence.range.startLine-1,evidence.range.endLine).join('\n'));
  }
  assert.deepEqual(new Set(report.graph.nodes.map(n=>n.module)),new Set(['Backend','Frontend']));
  assert.equal(report.impact.limits.maxDepth,12);assert.equal(report.impact.limits.complete,false);
});

test('repeated workspace quality cache invalidates configuration while keeping source read-only',async(t)=>{
  const dir=tmp(t),baseline=path.join(dir,'baseline'),candidate=path.join(dir,'candidate');write(baseline,'x.ts','export function x(){return 1;}\n');write(candidate,'x.ts','export function x(){if(true)return 1;return 2;}\n');
  const workspace={version:'1',projects:[fixture('one',baseline,candidate)],mappings:[]},cacheDir=path.join(dir,'cache'),before=readSnapshot({type:'directory',root:candidate}).contentHash;
  await analyze(workspace,{cacheDir});const repeated=await analyze(workspace,{cacheDir});assert.equal(repeated.cache.quality[0].status,'hit');
  const changed=await analyze(workspace,{cacheDir,quality:{...quality,complexityThreshold:1}});assert.equal(changed.cache.quality[0].status,'miss');assert.equal(readSnapshot({type:'directory',root:candidate}).contentHash,before);
});

test('repository fsmonitor cannot execute during worktree reads and generated exclusion is consistent',t=>{
  const dir=tmp(t),repo=path.join(dir,'repo');fs.mkdirSync(repo);const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Synthetic test');git('config','user.email','fixture@example.invalid');write(repo,'source.ts','export const a=1;\n');write(repo,'build/generated.ts','export const generated=1;\n');git('add','.');git('commit','-qm','fixture');const commit=git('rev-parse','HEAD');
  const marker=path.join(dir,'hook-ran'),hook=path.join(dir,'fsmonitor.sh');fs.writeFileSync(hook,'#!/bin/sh\ntouch "'+marker+'"\n');fs.chmodSync(hook,0o755);git('config','core.fsmonitor',hook);
  const immutable=readSnapshot({type:'git',root:repo,revision:commit}),working=readSnapshot({type:'worktree',root:repo});
  assert(!fs.existsSync(marker));assert.equal(working.dirty,false);assert.deepEqual(Object.keys(working.files),Object.keys(immutable.files));
});

test('replacement refs cannot alter bytes attributed to the original exact commit',t=>{
  const dir=tmp(t),repo=path.join(dir,'repo');fs.mkdirSync(repo);const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Synthetic test');git('config','user.email','fixture@example.invalid');write(repo,'source.ts','export const original=1;\n');git('add','.');git('commit','-qm','original');const original=git('rev-parse','HEAD');write(repo,'source.ts','export const replacement=2;\n');git('add','.');git('commit','-qm','replacement');git('replace',original,git('rev-parse','HEAD'));
  const snapshot=readSnapshot({type:'git',root:repo,revision:original});assert.equal(snapshot.revision,original);assert.equal(snapshot.files['source.ts'].text,'export const original=1;\n');
});

test('reviewed source example expiry is evaluated against the analysis date',()=>{
  const workspace=demos()[0].workspace,snapshot=readSnapshot(workspace.projects[0].candidate),file=Object.keys(snapshot.files)[0];
  const rules={version:'1',rules:[{id:'example',owner:'Fixture owner',kind:'endpoint-contract-change',examples:[{path:file,expires:'2020-01-01',approval:{status:'reviewed',reviewer:'SIMULATED',evidence:'Fixture only',simulation:true}}]}]};
  assert.equal(guidance(snapshot,rules,{asOf:'2026-10-11'}).rules[0].examples[0].status,'expired-example');
});

test('workspace identity fields are strings rather than coerced numbers or missing values',()=>{
  const workspace=demos()[0].workspace;
  for(const id of [undefined,123,''])assert.throws(()=>validateWorkspace({...workspace,projects:[{...workspace.projects[0],id}]}),/Project ids/);
  assert.throws(()=>validateWorkspace({...workspace,projects:[{...workspace.projects[0],repository:1}]}),/repository and module/);
  assert.throws(()=>validateWorkspace({...workspace,projects:[{...workspace.projects[0],baseline:{type:'directory',root:1}}]}),/snapshot specifications/);
  const split=demos().find(d=>d.id==='split').workspace;
  assert.throws(()=>validateWorkspace({...split,mappings:[{...split.mappings[0],owner:123}]}),/Mappings require/);
});
