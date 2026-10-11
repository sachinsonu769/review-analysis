import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {analyze,preCodeGuidance} from '../src/engine.js';
const asOf='2026-10-11';const rules={version:'1',rules:[]};
function setup(t,sources) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-regression-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const baseline=path.join(dir,'base');const candidate=path.join(dir,'next');fs.mkdirSync(baseline);fs.mkdirSync(candidate);
 for(const [file,text]of Object.entries(sources)){fs.writeFileSync(path.join(baseline,file),text);fs.writeFileSync(path.join(candidate,file),text);}
 return {baseline,candidate,options:{baseline:{type:'directory',root:baseline},candidate:{type:'directory',root:candidate},rules,asOf}};
}
test('same-package interface, record and enum consumers retain type edges',t=>{
 const {options,candidate}=setup(t,{'Api.java':'package sample; interface Api { Worker use(); }','Reply.java':'package sample; record Reply(Worker worker) {}','Mode.java':'package sample; enum Mode { A; Worker worker; }','Worker.java':'package sample; class Worker {}'});
 fs.writeFileSync(path.join(candidate,'Worker.java'),'package sample; class Worker { String field; }');const report=analyze(options);
 for(const name of ['Api.java','Reply.java','Mode.java'])assert.ok(report.impact.direct.some(e=>e.fromPath===name&&e.toPath==='Worker.java'),name);
});
test('missing same-package Java types remain explicit unknowns',t=>{
 const {options}=setup(t,{'Consumer.java':'package sample; class Consumer { Missing source; }'});const report=analyze(options);assert.ok(report.unknowns.some(u=>u.reason==='external-or-missing-java-source'&&u.detail==='Missing'));
});
test('TS names nested in namespaces or unexported declarations do not become imported call targets',t=>{
 const {options,candidate}=setup(t,{'consumer.ts':"import { run } from './lib'; run();",'lib.ts':'export namespace Api { export function run() {return 1;} }'});
 fs.writeFileSync(path.join(candidate,'lib.ts'),'export namespace Api { export function run() {return 2;} }');let report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='consumer.ts'));assert.ok(report.unknowns.some(u=>u.reason==='unresolved-imported-binding'));
 fs.writeFileSync(path.join(candidate,'lib.ts'),'function run() { return 2; }');report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='consumer.ts'));
});
test('multiple named imports and repeated statements retain one pre-existing debt identity',t=>{
 const configured={version:'1',rules:[{id:'boundary',owner:'fixture',kind:'forbidden-import',target:'^bad',severity:'warning'}]};
 const {options}=setup(t,{'consumer.ts':"import { a, b } from 'bad';\nimport { c } from 'bad';"});const report=analyze({...options,rules:configured});assert.equal(report.findings.length,1);assert.equal(report.findings[0].classification,'pre-existing');assert.ok(report.findings[0].additionalEvidence.length>=2);
 const stricter={version:'2',rules:configured.rules.map(r=>({...r,severity:'error'}))};const worsened=analyze({...options,rules:stricter,baselineRules:configured});assert.deepEqual(worsened.findings.map(f=>f.classification),['worsened']);assert.equal(worsened.findings[0].changeCause,'rule-policy');
});
test('new policy does not label retained source debt as newly introduced code',t=>{
 const {options}=setup(t,{'consumer.ts':"import { a } from 'bad';"});const configured={version:'2',rules:[{id:'new-boundary',owner:'fixture',kind:'forbidden-import',target:'^bad'}]};const report=analyze({...options,rules:configured,baselineRules:rules});assert.equal(report.findings[0].classification,'pre-existing');assert.equal(report.findings[0].newlyApplicableRule,true);
});
test('example provenance rejects stale hashes and impossible configured ranges',t=>{
 const {candidate}=setup(t,{'a.ts':'export const x=1;'});const configured={version:'1',rules:[{id:'b',owner:'fixture',kind:'forbidden-import',target:'bad',examples:[{path:'a.ts',fileHash:'stale'},{path:'a.ts',range:{startLine:99,endLine:100}}]}]};const result=preCodeGuidance({root:candidate,rules:configured,task:'Modify source'});const examples=result.guidance.rules[0].examples;assert.equal(examples[0].status,'stale-source');assert.equal(examples[1].status,'invalid-source-range');assert.equal(examples[1].evidence,null);
});
test('reviewed fixture exception expiry is inclusive and cached date rollover cannot keep suppression',t=>{
 const {options,candidate,baseline}=setup(t,{'a.ts':"import x from 'bad';"});const configured={version:'1',rules:[{id:'b',owner:'fixture',kind:'forbidden-import',target:'bad',exceptions:[{path:'a.ts',expires:'2026-10-11',approval:{status:'reviewed',reviewer:'SIMULATION',evidence:'Synthetic test only',simulation:true}}]}]};
 const cacheDir=path.join(path.dirname(candidate),'cache');let report=analyze({...options,rules:configured,cacheDir});assert.equal(report.findings[0].exception.status,'simulation-active');assert.equal(report.findings[0].suppressed,true);
 report=analyze({...options,rules:configured,cacheDir,asOf:'2026-10-12'});assert.equal(report.cache.report,'miss');assert.equal(report.findings[0].exception.status,'expired');assert.equal(report.findings[0].suppressed,false);
});
test('HTTP endpoint exception remains visibly simulated and consistently advisory-suppressed',t=>{
 const {options,candidate}=setup(t,{'Api.java':'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/old") String read(){return "x";} }'});fs.writeFileSync(path.join(candidate,'Api.java'),'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/next") String read(){return "x";} }');
 const configured={version:'1',rules:[{id:'http',owner:'fixture',kind:'endpoint-contract-change',exceptions:[{path:'Api.java',expires:'2026-12-31',approval:{status:'reviewed',reviewer:'SIMULATION',evidence:'Synthetic test only',simulation:true}}]}]};const report=analyze({...options,rules:configured});assert.equal(report.findings[0].exception.status,'simulation-active');assert.equal(report.findings[0].suppressed,true);assert.equal(report.findings[0].advisory,true);
});
test('Java call arity must be an exact integer rather than a key prefix',t=>{
 const ten='int a,int b,int c,int d,int e,int f,int g,int h,int i,int j';const {options,candidate}=setup(t,{'Caller.java':'package qa; class Caller { Target target; void use(){ target.run(1); } }','Target.java':`package qa; class Target { void run(${ten}){} }`});fs.writeFileSync(path.join(candidate,'Target.java'),`package qa; class Target { void run(${ten}){ int value=1; } }`);const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='Caller.java'));assert.ok(report.unknowns.some(u=>u.reason==='unresolved-call'&&u.detail==='run'));
});
test('constrained Spring routes never equate unsupported literal URLs to endpoint matches',t=>{
 const {options,candidate}=setup(t,{'Api.java':'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/numeric/{id:[0-9]+}") String read(){ return "old"; } }','consumer.ts':'fetch("/numeric/nope"); fetch("/numeric/42");'});fs.writeFileSync(path.join(candidate,'Api.java'),'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/numeric/{id:[0-9]+}") String read(){ return "next"; } }');const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='http'));assert.ok(report.unknowns.some(u=>u.reason==='unsupported-route-constraint'));
});
test('imported nested object member calls cannot target a non-callable exported variable',t=>{
 const {options,candidate}=setup(t,{'consumer.ts':"import * as api from './lib'; export function use(){ api.service.run(); }",'lib.ts':'export const service={run(){return 1;}};'});fs.writeFileSync(path.join(candidate,'lib.ts'),'export const service={run(){return 2;}};');const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='consumer.ts'));assert.ok(report.unknowns.some(u=>u.reason==='unresolved-imported-member'));
});
test('conflicting explicit Java imports never select the first receiver target',t=>{
 const {options,candidate,baseline}=setup(t,{'Caller.java':'package qa; import a.Target; import b.Target; class Caller { Target target; void use(){ target.run(); } }'});
 for(const root of [baseline,candidate]) {fs.mkdirSync(path.join(root,'a'));fs.mkdirSync(path.join(root,'b'));fs.writeFileSync(path.join(root,'a/Target.java'),'package a; class Target { void run(){} }');fs.writeFileSync(path.join(root,'b/Target.java'),'package b; class Target { void run(){} }');}
 fs.writeFileSync(path.join(candidate,'a/Target.java'),'package a; class Target { void run(){ int x=1; } }');const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='Caller.java'));assert.ok(report.unknowns.some(u=>u.reason==='unresolved-call'&&u.detail==='run'));
});
test('JS with-object shadowing leaves global fetch and lexical calls unknown',t=>{
 const {options,candidate}=setup(t,{'Api.java':'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/audit/fake") String read(){return "old";} }','consumer.js':'with ({fetch:()=>null}) { fetch("/audit/fake"); }'});fs.writeFileSync(path.join(candidate,'Api.java'),'import org.springframework.web.bind.annotation.GetMapping; class Api { @GetMapping("/audit/fake") String read(){return "next";} }');const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='http'));assert.ok(report.unknowns.some(u=>u.reason==='with_dynamic_scope'));
});
test('Java varargs and inherited overload sets remain unresolved rather than selecting incompatible methods',t=>{
 const {options,candidate}=setup(t,{'Caller.java':'package qa; class Caller { Worker worker; Child child; void use(){ worker.run("x","y"); child.run("x"); } }','Worker.java':'package qa; class Worker { void run(String... values){} void run(int a,int b){} }','Base.java':'package qa; class Base { void run(String value){} }','Child.java':'package qa; class Child extends Base { void run(Integer value){} }'});fs.writeFileSync(path.join(candidate,'Worker.java'),'package qa; class Worker { void run(String... values){int x=1;} void run(int a,int b){int x=1;} }');fs.writeFileSync(path.join(candidate,'Child.java'),'package qa; class Child extends Base { void run(Integer value){int x=1;} }');const report=analyze(options);assert.ok(!report.impact.direct.some(e=>e.kind==='call'&&e.fromPath==='Caller.java'));assert.ok(report.unknowns.some(u=>u.reason==='ambiguous-call'));assert.ok(report.unknowns.some(u=>u.reason==='java-inheritance-dispatch'));
});
