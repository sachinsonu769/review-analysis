import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {analyze,preCodeGuidance} from '../src/engine.js';
import {hash} from '../src/snapshot.js';
const root=path.resolve(import.meta.dirname,'..');
const cli=path.join(root,'src/cli.js');
const rules={version:'1',rules:[{id:'boundary',owner:'fixture-owner',kind:'forbidden-import',target:'^bad',severity:'warning'}]};
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-analysis-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const baseline=path.join(dir,'baseline');const candidate=path.join(dir,'candidate');const cache=path.join(dir,'cache');fs.mkdirSync(baseline);fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(baseline,'a.ts'),"export function a(): string { return 'old'; }\n");fs.writeFileSync(path.join(candidate,'a.ts'),"import x from 'bad';\nexport function a(): string { return 'new'; }\n");
  return {dir,baseline,candidate,cache,options:{baseline:{type:'directory',root:baseline},candidate:{type:'directory',root:candidate},rules,asOf:'2026-10-11',cacheDir:cache}};
}
test('report cache repeated hit and incremental parse reuse cannot hide content edits',t=>{
  const {options,candidate}=setup(t);const first=analyze(options);assert.equal(first.cache.report,'miss');assert.equal(first.cache.parsedFiles,2);
  const repeat=analyze(options);assert.equal(repeat.cache.report,'hit');assert.deepEqual(repeat.changes,first.changes);
  fs.writeFileSync(path.join(candidate,'a.ts'),"export function a(): number { return 42; }\n");
  const changed=analyze(options);assert.equal(changed.cache.report,'miss');assert.equal(changed.cache.parsedFiles,1);assert.equal(changed.cache.reusedFiles,1);assert.ok(changed.findings.every(f=>f.classification!=='new'));assert.match(changed.changes[0].after.excerpt,/number/);
});
test('rule/date/task/analyzer changes invalidate exact report cache',t=>{
  const {options}=setup(t);const first=analyze(options);
  for(const override of [{rules:{...rules,version:'2'}},{asOf:'2027-01-01'},{task:'New developer task'},{analyzerVersion:'test-next-version'}]) {
    const result=analyze({...options,...override});assert.equal(result.cache.report,'miss');assert.notEqual(result.provenance.cacheKey,first.provenance.cacheKey);
  }
});
test('cache corruption and stale payload fail closed to recomputation',t=>{
  const {options,cache}=setup(t);const first=analyze(options);
  fs.writeFileSync(path.join(cache,first.provenance.cacheKey+'.json'),JSON.stringify({key:first.provenance.cacheKey,digest:'stale',value:{changes:[]}}));
  const next=analyze(options);assert.equal(next.cache.report,'miss');assert.equal(next.cache.invalidEntries,1);assert.deepEqual(next.changes,first.changes);
});
test('exact Git revisions are pinned and dirty working trees bypass report cache without mutation',t=>{
  const {dir,cache}=setup(t);const repo=path.join(dir,'repo');fs.mkdirSync(repo);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(repo,'a.ts'),"export const value = 'old';\n");git('add','.');git('commit','-qm','baseline');const base=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(repo,'a.ts'),"export const value = 'new';\n");git('add','.');git('commit','-qm','candidate');const head=git('rev-parse','HEAD');
  const options={baseline:{type:'git',root:repo,revision:base},candidate:{type:'git',root:repo,revision:head},rules,asOf:'2026-10-11',cacheDir:cache};
  const first=analyze(options);assert.equal(first.provenance.baseline.revision,base);assert.equal(first.provenance.candidate.revision,head);assert.equal(analyze(options).cache.report,'hit');
  fs.writeFileSync(path.join(repo,'a.ts'),"export const value = 42;\n");const status=git('status','--porcelain');const sourceHash=hash(fs.readFileSync(path.join(repo,'a.ts')));
  const dirtyOptions={...options,candidate:{type:'worktree',root:repo}};
  for(let i=0;i<2;i++){const result=analyze(dirtyOptions);assert.equal(result.cache.report,'bypass-dirty');assert.equal(result.provenance.candidate.dirty,true);assert.match(result.changes[0].after.excerpt,/42/);}
  assert.equal(hash(fs.readFileSync(path.join(repo,'a.ts'))),sourceHash);assert.equal(git('status','--porcelain'),status);assert.equal(git('rev-parse','HEAD'),head);
});
test('cache/output locations inside examined roots and symlink aliases are rejected',t=>{
  const {options,candidate,dir}=setup(t);assert.throws(()=>analyze({...options,cacheDir:path.join(candidate,'.cache')}),/outside/);
  const alias=path.join(dir,'alias');fs.symlinkSync(candidate,alias);assert.throws(()=>analyze({...options,cacheDir:path.join(alias,'nested','cache')}),/outside/);
  const rulesPath=path.join(dir,'rules.json');fs.writeFileSync(rulesPath,JSON.stringify(rules));
  const result=spawnSync(process.execPath,[cli,'analyze','--baseline',options.baseline.root,'--candidate',candidate,'--rules',rulesPath,'--as-of',options.asOf,'--out',path.join(candidate,'report.json')],{encoding:'utf8'});assert.equal(result.status,2);assert.match(result.stderr,/outside/);assert.ok(!fs.existsSync(path.join(candidate,'report.json')));
});
test('symlinked source is never followed and unsupported source is explicitly excluded',t=>{
  const {options,candidate,dir}=setup(t);fs.writeFileSync(path.join(dir,'private.ts'),'export const hidden=1;');fs.symlinkSync(path.join(dir,'private.ts'),path.join(candidate,'hidden.ts'));
  const result=analyze(options);assert.ok(result.coverage.excluded.candidate.some(e=>e.path==='hidden.ts'&&/symlink/.test(e.reason)));assert.ok(!result.changes.some(c=>c.after?.path==='hidden.ts'));
});
test('CLI emits JSON/readable and guidance, and errors clearly on invalid arguments',t=>{
  const {options,dir,candidate}=setup(t);const rulesPath=path.join(dir,'rules.json');fs.writeFileSync(rulesPath,JSON.stringify(rules));
  const args=['analyze','--baseline',options.baseline.root,'--candidate',candidate,'--rules',rulesPath,'--as-of',options.asOf];
  const json=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(json.status,0,json.stderr);assert.equal(JSON.parse(json.stdout).advisory,true);
  const readable=spawnSync(process.execPath,[cli,...args,'--format','readable'],{encoding:'utf8'});assert.equal(readable.status,0);assert.match(readable.stdout,/Coverage incomplete/);
  const guide=spawnSync(process.execPath,[cli,'guide','--root',candidate,'--rules',rulesPath,'--task','Update API contract'],{encoding:'utf8'});assert.equal(guide.status,0,guide.stderr);assert.equal(JSON.parse(guide.stdout).guidance.task,'Update API contract');
  const invalid=spawnSync(process.execPath,[cli,...args,'--unknown','x'],{encoding:'utf8'});assert.equal(invalid.status,2);assert.match(invalid.stderr,/Unknown option/);
});
test('valid dates, rules and task are required rather than guessed',t=>{
  const {options,candidate}=setup(t);assert.throws(()=>analyze({...options,asOf:'2026-02-30'}),/valid/);assert.throws(()=>analyze({...options,rules:{rules:[]}}),/version/);assert.throws(()=>preCodeGuidance({root:candidate,rules,task:''}),/task/);
});
test('severity worsening and removed import debt are distinct from new debt',t=>{
  const {options,baseline,candidate}=setup(t);fs.copyFileSync(path.join(candidate,'a.ts'),path.join(baseline,'a.ts'));
  const stricter={...rules,version:'2',rules:rules.rules.map(r=>({...r,severity:'error'}))};
  const result=analyze({...options,rules:stricter,baselineRules:rules});assert.equal(result.findings[0].classification,'worsened');
  fs.writeFileSync(path.join(candidate,'a.ts'),'export const clean = 1;');const fixed=analyze({...options,rules:stricter});assert.equal(fixed.findings[0].classification,'resolved');
});
test('dangling output/cache symlinks cannot write inside analyzed source',t=>{
  const {options,candidate,dir}=setup(t);const dangling=path.join(dir,'outside-report.json');fs.symlinkSync(path.join(candidate,'new-report.json'),dangling);
  const rulesPath=path.join(dir,'rules.json');fs.writeFileSync(rulesPath,JSON.stringify(rules));
  const result=spawnSync(process.execPath,[cli,'analyze','--baseline',options.baseline.root,'--candidate',candidate,'--rules',rulesPath,'--as-of',options.asOf,'--out',dangling],{encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stderr,/outside/);assert.ok(!fs.existsSync(path.join(candidate,'new-report.json')));
  const danglingCache=path.join(dir,'outside-cache');fs.symlinkSync(path.join(candidate,'new-cache'),danglingCache);assert.throws(()=>analyze({...options,cacheDir:danglingCache}),/outside/);assert.ok(!fs.existsSync(path.join(candidate,'new-cache')));
});
