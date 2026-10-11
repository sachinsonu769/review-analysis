import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {analyzeQuality,validateQualityConfig,classifyFindings,qualityToolIdentity} from '../src/quality.js';
import {analyzeConventions,validateConventionConfig} from '../src/conventions.js';
import {hash,readSnapshot} from '../src/snapshot.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(here,'../fixtures/quality');
const snapshots=()=>({baselineSnapshot:readSnapshot({type:'directory',root:path.join(fixture,'baseline')}),candidateSnapshot:readSnapshot({type:'directory',root:path.join(fixture,'candidate')})});
const snapshot=files=>({root:'/virtual/inert',revision:hash(files),files:Object.fromEntries(Object.entries(files).map(([file,text])=>[file,{text,hash:hash(text)}]))});

test('trusted analyzers compare existing, worsened, resolved and new TypeScript findings',async()=>{
  const report=await analyzeQuality({...snapshots(),config:{pmdEnabled:false,complexityThreshold:3}});
  const find=(ruleId,classification)=>report.findings.find(f=>f.ruleId===ruleId&&f.classification===classification);
  assert.ok(find('@typescript-eslint/no-non-null-assertion','pre-existing'));
  const complexity=find('complexity','worsened');assert.ok(complexity);assert.ok(complexity.magnitude>complexity.baselineMagnitude);
  assert.ok(find('no-unreachable','resolved'));assert.ok(find('no-constant-condition','new'));assert.ok(find('no-async-promise-executor','new'));
  const duplicate=find('duplicate-block','new');assert.ok(duplicate);assert.equal(duplicate.tool,'jscpd');assert.equal(duplicate.relatedEvidence.length,1);
  assert.equal(report.tools.find(t=>t.name==='eslint').version,'10.12.0');
  assert.equal(report.tools.find(t=>t.name==='jscpd').version,'4.0.5');
  assert.ok(!report.unsupported.some(u=>['parse-error','tool-failure','invalid-tool-report'].includes(u.reason)));
  for(const finding of report.findings){assert.ok(finding.evidence.fileHash);assert.ok(finding.evidence.revision);assert.ok(finding.fingerprint);}
});

test('line insertions and unrelated declarations preserve semantic issue identity',async()=>{
  const code='export function f(value?: string) { return value!; }';
  const report=await analyzeQuality({baselineSnapshot:snapshot({'a.ts':code}),candidateSnapshot:snapshot({'a.ts':'// inserted\nexport const other = 1;\n'+code}),config:{pmdEnabled:false}});
  const issue=report.findings.find(f=>f.ruleId==='@typescript-eslint/no-non-null-assertion');
  assert.equal(issue.classification,'pre-existing');assert.notEqual(issue.beforeEvidence.range.startLine,issue.afterEvidence.range.startLine);
  assert.ok(!report.unsupported.some(u=>u.tool==='jscpd'));
});

test('named arrow-function complexity matches the function when declaration order changes',async()=>{
  const a='export const a=(v:number)=>{if(v>1)return 1;if(v>2)return 2;return 0;};';
  const b='export const b=(v:number)=>{if(v>1)return 1;if(v>2)return 2;return 0;};';
  const worse=a.replace('return 0;','if(v>3)return 3;return 0;');
  const report=await analyzeQuality({baselineSnapshot:snapshot({'a.ts':a+'\n'+b}),candidateSnapshot:snapshot({'a.ts':b+'\n'+worse}),config:{pmdEnabled:false,complexityThreshold:1}});
  const complexity=report.findings.filter(f=>f.ruleId==='complexity');
  assert.equal(complexity.length,2);assert.equal(complexity.find(f=>f.scope.includes('a')).classification,'worsened');assert.equal(complexity.find(f=>f.scope.includes('b')).classification,'pre-existing');
});

test('source text and project config are inert, and inline ESLint suppressions cannot change review rules',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'quality-inert-'));const marker=path.join(root,'executed');
  try {
    fs.writeFileSync(path.join(root,'eslint.config.js'),`throw new Error('repository config must not load');`);
    fs.writeFileSync(path.join(root,'source.ts'),`// eslint-disable-next-line no-constant-condition\nif (true) { globalThis.__reviewExecuted = true; }\n`);
    const empty=snapshot({});const candidate=readSnapshot({type:'directory',root});
    const report=await analyzeQuality({baselineSnapshot:empty,candidateSnapshot:candidate,config:{pmdEnabled:false}});
    assert.ok(report.findings.some(f=>f.ruleId==='no-constant-condition'));
    assert.equal(globalThis.__reviewExecuted,undefined);assert.equal(fs.existsSync(marker),false);
    assert.ok(!report.unsupported.some(u=>u.tool==='eslint'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('unparseable candidate source cannot falsely resolve an existing issue',async()=>{
  const report=await analyzeQuality({baselineSnapshot:snapshot({'a.ts':'function f(x?: string) { return x!; }'}),candidateSnapshot:snapshot({'a.ts':'function f( {'}),config:{pmdEnabled:false}});
  const issue=report.findings.find(f=>f.ruleId==='@typescript-eslint/no-non-null-assertion');
  assert.equal(issue.classification,'pre-existing');assert.equal(issue.candidateUnverified,true);
  assert.ok(report.unsupported.some(u=>u.tool==='eslint'&&u.snapshot==='candidate'&&u.reason==='parse-error'));
});

test('governed import boundaries are separate from potential design conventions',()=>{
  const report=analyzeConventions({...snapshots(),config:{forbiddenImports:[{id:'domain-framework',pathPrefix:'frontend/domain',importPrefixes:['@angular'],owner:'architecture-team',version:'1'}],maxParameters:5}});
  const policy=report.findings.find(f=>f.ruleId==='forbidden-import');assert.equal(policy.classification,'new');assert.equal(policy.basis,'configured-policy');assert.equal(policy.certainty,'evidenced');assert.equal(policy.governance.owner,'architecture-team');
  for(const rule of ['parameter-count','module-cycle','public-mutable-field']){const issue=report.findings.find(f=>f.ruleId===rule);assert.ok(issue,rule);assert.equal(issue.basis,'inferred-convention');assert.equal(issue.certainty,'potential');}
  assert.equal(report.findings.filter(f=>f.ruleId==='public-mutable-field'&&f.evidence.path.endsWith('order.ts')).length,1);
  assert.ok(!report.unsupported.some(u=>u.reason==='parse-error'));
});

test('method-count increase has stable identity and import-prefix boundaries avoid false positives',()=>{
  const before=snapshot({'domain/a.ts':'import x from "reactive"; export class A { a() {} b() {} }'});
  const after=snapshot({'domain/a.ts':'// lines moved\nimport x from "reactive"; export class A { a() {} b() {} c() {} }'});
  const report=analyzeConventions({baselineSnapshot:before,candidateSnapshot:after,config:{maxClassMethods:1,forbiddenImports:[{id:'framework',pathPrefix:'domain',importPrefixes:['react'],owner:'team',version:'v1'}]}});
  assert.equal(report.findings.find(f=>f.ruleId==='class-method-count').classification,'worsened');
  assert.ok(!report.findings.some(f=>f.ruleId==='forbidden-import'));
});

test('configuration is numeric/structural data only, with mandatory policy governance',()=>{
  assert.throws(()=>validateQualityConfig({rules:{}}),/Unknown/);
  assert.throws(()=>validateQualityConfig({complexityThreshold:0}),/integer/);
  assert.throws(()=>validateQualityConfig({duplication:{minLines:0}}),/integer/);
  assert.throws(()=>validateQualityConfig({duplication:null}),/object/);
  assert.throws(()=>validateConventionConfig({forbiddenImports:[{id:'x',pathPrefix:'domain',importPrefixes:['react']}]}),/owner/);
  assert.throws(()=>validateConventionConfig({forbiddenImports:[{id:'x',pathPrefix:'../domain',importPrefixes:['react'],owner:'team',version:'1'}]}),/relative/);
});

test('trusted PMD identity changes for a modified script or JAR at the same installation path',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quality-identity-')),binary=path.join(temp,'bin/pmd'),jar=path.join(temp,'lib/pmd-test.jar');
  const previous=process.env.REVIEW_ANALYSIS_PMD_BIN;
  try {
    fs.mkdirSync(path.dirname(binary));fs.mkdirSync(path.dirname(jar));fs.writeFileSync(binary,'#!/bin/sh\n# not executed\n',{mode:0o755});fs.writeFileSync(jar,'trusted-v1');
    process.env.REVIEW_ANALYSIS_PMD_BIN=binary;
    const first=await qualityToolIdentity();assert.equal(first.pmd.status,'available');assert.equal(first.pmd.jarCount,1);
    fs.writeFileSync(jar,'trusted-v2');const second=await qualityToolIdentity();assert.notEqual(first.pmd.distributionHash,second.pmd.distributionHash);
    fs.writeFileSync(binary,'#!/bin/sh\n# also not executed\n');const third=await qualityToolIdentity();assert.notEqual(second.pmd.distributionHash,third.pmd.distributionHash);
    fs.rmSync(binary);assert.equal((await qualityToolIdentity()).pmd.status,'unavailable');
  } finally {if(previous===undefined)delete process.env.REVIEW_ANALYSIS_PMD_BIN;else process.env.REVIEW_ANALYSIS_PMD_BIN=previous;fs.rmSync(temp,{recursive:true,force:true});}
});

test('findings with uncovered related source remain candidate-unverified',()=>{
  const old={tool:'jscpd',ruleId:'duplicate-block',fingerprint:'stable',evidence:{path:'a.ts'},relatedEvidence:[{path:'b.ts'}]};
  const result=classifyFindings([old],[],{candidateSnapshot:snapshot({'a.ts':'','b.ts':''}),uncovered:[{tool:'jscpd',path:'b.ts',reason:'suppression'}]});
  assert.equal(result[0].classification,'pre-existing');assert.equal(result[0].candidateUnverified,true);
});

test('unsafe virtual source paths are rejected before materialization',async()=>{
  await assert.rejects(analyzeQuality({baselineSnapshot:snapshot({}),candidateSnapshot:snapshot({'../outside.ts':'export const a=1;'}),config:{pmdEnabled:false}}),/Unsafe snapshot/);
});

test('Java PMD reports null, resource and literal-condition evidence when installed',async(t)=>{
  if(!fs.existsSync(process.env.REVIEW_ANALYSIS_PMD_BIN||'/opt/pmd/bin/pmd')){t.skip('PMD is provided by the default container; unavailable in this host');return;}
  const report=await analyzeQuality(snapshots());
  assert.equal(report.tools.find(tool=>tool.name==='pmd').status,'available');
  for(const ruleId of ['BrokenNullCheck','CloseResource','UnconditionalIfStatement'])assert.ok(report.findings.some(f=>f.tool==='pmd'&&f.ruleId===ruleId&&f.classification==='new'),ruleId);
  assert.ok(!report.unsupported.some(u=>u.tool==='pmd'&&['tool-failure','configuration-error','parse-or-processing-error'].includes(u.reason)));
});

test('PMD processing gaps preserve healthy-file findings and cannot resolve old Java debt',async(t)=>{
  if(!fs.existsSync(process.env.REVIEW_ANALYSIS_PMD_BIN||'/opt/pmd/bin/pmd')){t.skip('PMD is provided by the default container; unavailable in this host');return;}
  const broken='class A { boolean test() { if (true) return true; return false; } }';
  const report=await analyzeQuality({baselineSnapshot:snapshot({'A.java':broken}),candidateSnapshot:snapshot({'A.java':'class A { boolean test( {','B.java':broken.replace('class A','class B')})});
  const old=report.findings.find(f=>f.tool==='pmd'&&f.evidence.path==='A.java');
  assert.equal(old.classification,'pre-existing');assert.equal(old.candidateUnverified,true);
  assert.ok(report.findings.some(f=>f.tool==='pmd'&&f.evidence.path==='B.java'&&f.classification==='new'));
  assert.ok(report.unsupported.some(u=>u.tool==='pmd'&&u.path==='A.java'&&u.snapshot==='candidate'&&u.reason==='parse-or-processing-error'));
});
