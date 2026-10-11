import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const artifactZipSha256=process.env.ADVERSARIAL_ARTIFACT_SHA256 || '2cc8f0b4cbe0ee4e1cdbb3c00b376c412b0aa02d66791903c4a56598dd995df8';
const build=process.env.ADVERSARIAL_BUILD || '/tmp/review-analysis-qa-v1-nn0cdauu';
const root=process.env.ADVERSARIAL_CASE_ROOT || '/tmp/review-analysis-adversarial-v1-anUajX';
const out=process.env.ADVERSARIAL_OUT || '/workspace/review-analysis-deliverables/qa-v1/adversarial';
fs.mkdirSync(root,{recursive:true});
fs.mkdirSync(out,{recursive:true});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const rules={version:'independent-adversarial-v1',rules:[{id:'independent/http-contract',kind:'endpoint-contract-change',owner:'synthetic-qa',severity:'warning'}]};
fs.writeFileSync(path.join(root,'rules.json'),JSON.stringify(rules,null,2)+'\n');
const cases=[];
function define(id,description,baseline,updates,checks){cases.push({id,description,baseline,updates,checks});}
const edge=(report,file,line,kind='call')=>report.impact.direct.filter(e=>e.fromPath===file&&e.evidence.range.startLine===line&&e.kind===kind);
const unknown=(report,file,line,pattern)=>report.unknowns.filter(u=>u.evidence?.path===file&&u.evidence?.range.startLine===line&&pattern.test(u.reason));
const line=(source,token)=>source.split('\n').findIndex(l=>l.includes(token))+1;
const changed=source=>source.replace('return "v1"','return "v2"').replace('return 1','return 2');
const spring='package qa;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.PostMapping;\nimport org.springframework.web.bind.annotation.RequestMapping;\n';
const controller=spring+`@RequestMapping("/audit")
class Resource {
 @GetMapping("/real") String real() { return "v1"; }
 @GetMapping("/fake") String fake() { return "v1"; }
 @PostMapping("/real") String post() { return "v1"; }
}`;
const http=`import transport from 'axios';
fetch('/audit/real'); // positive-global
fetch(\`/audit/real\`); // positive-template
globalThis.fetch('/audit/real'); // positive-member
transport.get('/audit/real'); // positive-axios
function scope(window: any, self: any, globalThis: any) {
 window.fetch('/audit/fake'); // negative-window
 self.fetch('/audit/fake'); // negative-self
 globalThis.fetch('/audit/fake'); // negative-globalthis
}
function parameters({fetch, transport}: any) {
 fetch('/audit/fake'); // negative-fetch
 transport.get('/audit/fake'); // negative-axios
}
const prefix = '/audit';
fetch(prefix + '/real'); // dynamic-concat
const options = {method: 'GET'};
fetch('/audit/real', options); // dynamic-options
fetch('/audit/real', {method: 'GET', method: 'POST'}); // positive-last-property
fetch('/audit/real', {method: 'GET', ...options}); // dynamic-spread
const fake = "fetch('/audit/fake')"; // negative-string
// fetch('/audit/fake'); negative-comment
`;
define('01-http-lexical-static-dynamic','Global receiver and destructured parameter shadows; static templates versus constant concatenation; literal object override order',{'backend/Resource.java':controller,'frontend/http.ts':http},{'backend/Resource.java':changed(controller)},r=>{
 const assertions=[];
 for(const token of ['positive-global','positive-template','positive-member','positive-axios','positive-last-property'])assertions.push([token,edge(r,'frontend/http.ts',line(http,token),'http').length===2]);
 for(const token of ['negative-window','negative-self','negative-globalthis','negative-fetch','negative-axios','negative-string','negative-comment'])assertions.push([token,edge(r,'frontend/http.ts',line(http,token),'http').length===0]);
 for(const token of ['dynamic-concat','dynamic-options','dynamic-spread'])assertions.push([token,edge(r,'frontend/http.ts',line(http,token),'http').length===0&&unknown(r,'frontend/http.ts',line(http,token),/dynamic/).length>0]);
 return assertions;
});
const lib=`export function work(x: number): number { return 1; }
export interface Packet { value: number }
export const nonCallable = 3;
`;
const consumer=`import {work as act, type Packet} from './lib';
import * as tools from './lib';
import {missing} from './absent';
export function use(value: Packet) { act(1); } // imported-call
export function namespaceUse() { tools.work(1); } // namespace-call
export function shadow(act: () => number) { return act(); } // parameter-shadow
export function local() { before(); function before() { return 4; } } // nested-local
missing(); // missing-source
`;
define('02-ts-import-shadow-missing','Named and namespace bindings, nested forward local call, absent relative import',{'frontend/lib.ts':lib,'frontend/consumer.ts':consumer},{'frontend/lib.ts':changed(lib)},r=>[
 ['named import call',edge(r,'frontend/consumer.ts',line(consumer,'imported-call')).every(e=>e.targetKey==='work')&&edge(r,'frontend/consumer.ts',line(consumer,'imported-call')).length===2],
 ['namespace import call',edge(r,'frontend/consumer.ts',line(consumer,'namespace-call')).every(e=>e.targetKey==='work')&&edge(r,'frontend/consumer.ts',line(consumer,'namespace-call')).length===2],
 ['parameter does not inherit imported target',edge(r,'frontend/consumer.ts',line(consumer,'parameter-shadow')).length===0],
 ['missing source remains unknown',r.unknowns.some(u=>u.reason==='missing-source'&&u.detail==='./absent')],
 ['nested function does not target top-level import',edge(r,'frontend/consumer.ts',line(consumer,'nested-local')).length===0]
]);
const ambiguous=`import {work} from './lib';
work(1); // ambiguous-call
`;
define('03-ts-ambiguous-module','Both .ts and .tsx candidate files prevent unique imported call',{'frontend/lib.ts':lib,'frontend/lib.tsx':lib,'frontend/consumer.ts':ambiguous},{'frontend/lib.ts':changed(lib),'frontend/lib.tsx':changed(lib)},r=>[
 ['ambiguous source reported',r.unknowns.some(u=>u.reason==='ambiguous-import'&&u.candidates.length===2)],
 ['no fabricated call edge',edge(r,'frontend/consumer.ts',line(ambiguous,'ambiguous-call')).length===0]
]);
const targetTen=`package qa;
class Target {
 int run(int a,int b,int c,int d,int e,int f,int g,int h,int i,int j) { return 1; }
}`;
const wrongArity=`package qa;
class Caller {
 Target target;
 void use() { target.run(1); } // wrong-arity
}`;
define('04-java-arity-prefix','Single-argument call cannot target a ten-argument declaration',{'backend/Target.java':targetTen,'backend/Caller.java':wrongArity},{'backend/Target.java':changed(targetTen)},r=>[
 ['no false ten-argument call target',edge(r,'backend/Caller.java',line(wrongArity,'wrong-arity')).length===0],
 ['arity mismatch remains unknown',unknown(r,'backend/Caller.java',line(wrongArity,'wrong-arity'),/unresolved-call/).length>0]
]);
const service=`package qa;
class Service {
 String run(String x) { return "v1"; }
 String run(Integer x) { return "v1"; }
 String zero() { return "v1"; }
}`;
const javaCalls=`package qa;
class Caller {
 Service service;
 void use() { service.run(null); } // ambiguous-overload
 void zero() { service.zero(); } // unique-zero
 void param(Object service) { service.zero(); } // object-shadow
 void block() { { var service = dynamic(); service.zero(); } service.zero(); } // var-shadow-and-restoration
 Object dynamic() { return null; }
}`;
define('05-java-overload-receiver-shadow','Same-arity overload candidate evidence plus typed Object and var field shadows',{'backend/Service.java':service,'backend/Caller.java':javaCalls},{'backend/Service.java':changed(service).replaceAll('return "v1"','return "v2"')},r=>[
 ['overload stays ambiguous with candidate evidence',edge(r,'backend/Caller.java',line(javaCalls,'ambiguous-overload')).length===0&&unknown(r,'backend/Caller.java',line(javaCalls,'ambiguous-overload'),/ambiguous-call/).some(u=>u.candidates.length===2)],
 ['unique zero-arg call resolves',edge(r,'backend/Caller.java',line(javaCalls,'unique-zero')).length===2],
 ['Object parameter shadows field receiver',edge(r,'backend/Caller.java',line(javaCalls,'object-shadow')).length===0],
 ['var shadow remains dynamic; restored field resolves',unknown(r,'backend/Caller.java',line(javaCalls,'var-shadow-and-restoration'),/dynamic/).length>0&&edge(r,'backend/Caller.java',line(javaCalls,'var-shadow-and-restoration')).length===2]
]);
const pattern=`package qa;
class Caller {
 Service service;
 void use(Object value) {
  if (value instanceof Other service) { service.zero(); } // pattern-shadow
 }
}`;
const other=`package qa;
class Other { String zero() { return "v1"; } }`;
define('06-java-pattern-shadow','Valid instanceof pattern binding must not inherit same-named field type',{'backend/Service.java':service,'backend/Other.java':other,'backend/Caller.java':pattern},{'backend/Service.java':changed(service).replaceAll('return "v1"','return "v2"'),'backend/Other.java':changed(other)},r=>[
 ['pattern call never binds field Service',!edge(r,'backend/Caller.java',line(pattern,'pattern-shadow')).some(e=>e.targetKey.startsWith('qa.Service#'))],
 ['Other or explicit unknown',edge(r,'backend/Caller.java',line(pattern,'pattern-shadow')).some(e=>e.targetKey==='qa.Other#zero/0')||unknown(r,'backend/Caller.java',line(pattern,'pattern-shadow'),/unresolved|dynamic|pattern/i).length>0]
]);
const constants=spring+`class Constants {
 static final String ROOT = "/audit";
 @GetMapping(ROOT + "/real") String concatenated() { return "v1"; }
 @GetMapping("/audit/real") String literal() { return "v1"; }
 @GetMapping("\\u002Faudit\\u002Fother") String unicode() { return "v1"; }
}`;
const constantsClient=`fetch('/audit/real'); // literal-route
fetch('/audit/other'); // escaped-route
`;
define('07-java-static-constant-routing','Literal mapping remains matchable while constant concatenation mapping stays unknown',{'backend/Constants.java':constants,'frontend/client.ts':constantsClient},{'backend/Constants.java':changed(constants).replaceAll('return "v1"','return "v2"')},r=>[
 ['constant mapping explicit unknown',r.unknowns.some(u=>/Dynamic Spring/.test(u.reason))],
 ['literal not contaminated by constant',edge(r,'frontend/client.ts',line(constantsClient,'literal-route'),'http').length===2&&edge(r,'frontend/client.ts',line(constantsClient,'literal-route'),'http').every(e=>e.targetKey==='qa.Constants#literal/0')],
 ['escaped literal routes supported',edge(r,'frontend/client.ts',line(constantsClient,'escaped-route'),'http').length===2]
]);
const regexController=spring+`class NumericResource {
 @GetMapping("/numeric/{id:[0-9]+}") String numeric() { return "v1"; }
}`;
const regexClient=`fetch('/numeric/123'); // valid-template
fetch('/numeric/nope'); // excluded-by-regex
fetch('https://other.example/numeric/123'); // unknown-origin
`;
define('08-http-template-regex','Template regex constraints must not claim a literal nonmatching request maps to configured route',{'backend/NumericResource.java':regexController,'frontend/client.ts':regexClient},{'backend/NumericResource.java':changed(regexController)},r=>[
 ['valid template supported or explicit unknown',edge(r,'frontend/client.ts',line(regexClient,'valid-template'),'http').length>0||unknown(r,'frontend/client.ts',line(regexClient,'valid-template'),/endpoint|dynamic|template/).length>0],
 ['regex-rejected literal has no matching edge',edge(r,'frontend/client.ts',line(regexClient,'excluded-by-regex'),'http').length===0],
 ['absolute origin never matched to local route',edge(r,'frontend/client.ts',line(regexClient,'unknown-origin'),'http').length===0&&unknown(r,'frontend/client.ts',line(regexClient,'unknown-origin'),/unmatched-endpoint/).length>0]
]);
const dupController=controller;
define('09-http-ambiguous-controllers','Duplicate matching endpoints across controllers remain ambiguous with source candidates',{'backend/Resource.java':controller,'backend/OtherResource.java':controller.replace('class Resource','class OtherResource'),'frontend/client.ts':"fetch('/audit/real');\n"},{'backend/Resource.java':changed(controller)},r=>[
 ['multiple mappings remain unknown',r.unknowns.some(u=>u.reason==='ambiguous-endpoint'&&u.candidates.length===2)],
 ['no unique HTTP edge',r.impact.direct.every(e=>e.kind!=='http')]
]);
const invalidJava=`package qa;
class Broken { String text = "unterminated;
`;
const invalidTs=`import {work} from './lib';
export function broken( { work(1); // syntax-broken
`;
define('10-source-parse-diagnostics','Malformed supplied Java and TS must retain explicit diagnostics alongside any recovered declarations',{'backend/Broken.java':invalidJava,'frontend/lib.ts':lib,'frontend/broken.ts':invalidTs},{'frontend/lib.ts':changed(lib)},r=>[
 ['Java parse failure visible',r.unknowns.some(u=>u.evidence?.path==='backend/Broken.java'&&/parse/i.test(u.reason))],
 ['TS syntax diagnostic visible',r.unknowns.some(u=>u.evidence?.path==='frontend/broken.ts'&&u.reason==='parse_diagnostic')],
 ['advisory flags preserved',r.advisory===true&&r.coverage.complete===false&&r.coverage.fullRegressionMayBeSkipped===false]
]);
const namespaceLib=`export const service = { run() { return 1; } };
`;
const namespaceCaller=`import * as api from './lib';
export function use() { api.service.run(); } // nested-member
`;
define('11-ts-namespace-nested-member','Nested property method on namespace import must not claim the container variable is the called declaration',{'frontend/lib.ts':namespaceLib,'frontend/consumer.ts':namespaceCaller},{'frontend/lib.ts':changed(namespaceLib)},r=>[
 ['no wrong container call declaration',!edge(r,'frontend/consumer.ts',line(namespaceCaller,'nested-member')).some(e=>e.targetKey==='service')],
 ['file-level import still resolves',r.impact.direct.some(e=>e.fromPath==='frontend/consumer.ts'&&e.kind==='import')]
]);
const aTarget='package a;\npublic class Target { public int run() { return 1; } }';
const bTarget='package b;\npublic class Target { public int run() { return 1; } }';
const ambiguousJava=`package qa;
import a.Target;
import b.Target;
class Caller {
 Target target;
 void use(){ target.run(); } // ambiguous-import-receiver
}`;
define('12-java-ambiguous-explicit-imports','Conflicting explicit imports cannot acquire a guessed first-import receiver target (source is semantically invalid)',{'backend/a/Target.java':aTarget,'backend/b/Target.java':bTarget,'backend/Caller.java':ambiguousJava},{'backend/a/Target.java':changed(aTarget),'backend/b/Target.java':changed(bTarget)},r=>[
 ['no first-import call guess',edge(r,'backend/Caller.java',line(ambiguousJava,'ambiguous-import-receiver')).length===0],
 ['ambiguous binding explicit unknown',unknown(r,'backend/Caller.java',line(ambiguousJava,'ambiguous-import-receiver'),/ambiguous|unresolved/).length>0]
]);
const namespaceContract=`export namespace Api { export function run() { return 1; } }
`;
const namespaceContractCaller=`import * as api from './lib';
export function use() { api.Api.run(); } // namespace-member
`;
define('13-ts-namespace-contract-member','Nested exported namespace method must use qualified member declaration or explicit uncertainty',{'frontend/lib.ts':namespaceContract,'frontend/consumer.ts':namespaceContractCaller},{'frontend/lib.ts':changed(namespaceContract)},r=>[
 ['no wrong namespace declaration for method call',!edge(r,'frontend/consumer.ts',line(namespaceContractCaller,'namespace-member')).some(e=>e.targetKey==='Api')],
 ['qualified member or explicit uncertainty',edge(r,'frontend/consumer.ts',line(namespaceContractCaller,'namespace-member')).some(e=>e.targetKey==='Api.run')||unknown(r,'frontend/consumer.ts',line(namespaceContractCaller,'namespace-member'),/unresolved|dynamic/).length>0]
]);
const withShadow=`with ({fetch: () => null}) {
 fetch('/audit/fake'); // with-object-shadow
}
fetch('/audit/real'); // outside-with-control
`;
define('14-js-with-lexical-shadow','Sloppy-script with object supplies custom fetch; outside global fetch remains a control',{'backend/Resource.java':controller,'frontend/shadow.js':withShadow},{'backend/Resource.java':changed(controller).replaceAll('return "v1"','return "v2"')},r=>[
 ['with object fetch never fabricates HTTP edge',edge(r,'frontend/shadow.js',line(withShadow,'with-object-shadow'),'http').length===0],
 ['unsupported with scope explicit uncertainty',unknown(r,'frontend/shadow.js',line(withShadow,'with-object-shadow'),/unresolved|dynamic|with/i).length>0||r.unknowns.some(u=>u.evidence?.path==='frontend/shadow.js'&&/with/i.test(u.reason))],
 ['outside fetch still maps known route',edge(r,'frontend/shadow.js',line(withShadow,'outside-with-control'),'http').length===2]
]);
const varargWorker=`package qa;
class Worker {
 String run(String... values) { return "v1"; }
 String run(int a, int b) { return "v1"; }
}`;
const varargCaller=`package qa;
class Caller {
 Worker worker;
 void use(){ worker.run("x", "y"); } // vararg-overload
}`;
define('15-java-varargs-overload','Valid two-string invocation must not resolve to int,int fixed overload when a varargs overload exists',{'backend/Worker.java':varargWorker,'backend/Caller.java':varargCaller},{'backend/Worker.java':changed(varargWorker).replaceAll('return "v1"','return "v2"')},r=>[
 ['no incompatible fixed-arity call target',!edge(r,'backend/Caller.java',line(varargCaller,'vararg-overload')).some(e=>e.targetKey==='qa.Worker#run/2')],
 ['varargs alternative produces uncertainty or correct target',unknown(r,'backend/Caller.java',line(varargCaller,'vararg-overload'),/ambiguous|unresolved|varargs/i).length>0||edge(r,'backend/Caller.java',line(varargCaller,'vararg-overload')).some(e=>e.targetKey==='qa.Worker#run/1')]
]);
const inheritedBase=`package qa;
class Base { String run(String value) { return "v1"; } }`;
const inheritedChild=`package qa;
class Child extends Base { String run(Integer value) { return "v1"; } }`;
const inheritedCaller=`package qa;
class Caller {
 Child child;
 void use(){ child.run("x"); } // inherited-overload
}`;
define('16-java-inherited-overload','Declared unsupported inherited overload should not be narrowed to incompatible locally declared member',{'backend/Base.java':inheritedBase,'backend/Child.java':inheritedChild,'backend/Caller.java':inheritedCaller},{'backend/Base.java':changed(inheritedBase),'backend/Child.java':changed(inheritedChild)},r=>[
 ['no incompatible Child Integer call target',!edge(r,'backend/Caller.java',line(inheritedCaller,'inherited-overload')).some(e=>e.targetKey==='qa.Child#run/1')],
 ['inheritance alternative remains uncertainty or correct target',unknown(r,'backend/Caller.java',line(inheritedCaller,'inherited-overload'),/ambiguous|unresolved|inherit/i).length>0||edge(r,'backend/Caller.java',line(inheritedCaller,'inherited-overload')).some(e=>e.targetKey==='qa.Base#run/1')]
]);
cases.length=0;
const exactArityWorker=`package qa;
class Worker {
 int run(int value) { return 1; }
 int run(int a,int b,int c,int d,int e,int f,int g,int h,int i,int j) { return 1; }
}`;
const exactArityCaller=`package qa;
class Caller {
 Worker worker;
 void one() { worker.run(7); } // exact-one
 void ten() { worker.run(1,2,3,4,5,6,7,8,9,10); } // exact-ten
}`;
define('17-positive-exact-java-arity','One and ten arguments select only matching formal arity and retain direct call evidence',{'backend/Worker.java':exactArityWorker,'backend/Caller.java':exactArityCaller},{'backend/Worker.java':exactArityWorker.replaceAll('return 1','return 2')},r=>[
 ['one arg resolves only /1',edge(r,'backend/Caller.java',line(exactArityCaller,'exact-one')).length===2&&edge(r,'backend/Caller.java',line(exactArityCaller,'exact-one')).every(e=>e.targetKey==='qa.Worker#run/1')],
 ['ten args resolve only /10',edge(r,'backend/Caller.java',line(exactArityCaller,'exact-ten')).length===2&&edge(r,'backend/Caller.java',line(exactArityCaller,'exact-ten')).every(e=>e.targetKey==='qa.Worker#run/10')],
 ['supported calls have no unresolved/ambiguous call unknown',!r.unknowns.some(u=>u.evidence?.path==='backend/Caller.java'&&/ambiguous-call|unresolved-call|inheritance/.test(u.reason))]
]);
const templateResource=spring+`class TemplateResource {
 @GetMapping("/catalog/{id}") String get() { return "v1"; }
 @GetMapping("/catalog/{id}/details") String details() { return "v1"; }
 @GetMapping("/numbers/{id:[0-9]+}") String constrained() { return "v1"; }
}`;
const templateClient=`fetch('/catalog/abc'); // simple-template
fetch('/catalog/a?trace=1'); // query-template
fetch('/catalog/a/'); // trailing-template
fetch('/catalog/a/details'); // longer-template
fetch('/catalog/a/b'); // reject-multiple-segments
fetch('/numbers/nope'); // regex-stays-unknown
`;
define('18-positive-unconstrained-template','Unconstrained URI template consumers remain mapped after constrained route suppression',{'backend/TemplateResource.java':templateResource,'frontend/client.ts':templateClient},{'backend/TemplateResource.java':templateResource.replaceAll('return "v1"','return "v2"')},r=>[
 ...['simple-template','query-template','trailing-template'].map(token=>[token,edge(r,'frontend/client.ts',line(templateClient,token),'http').length===2&&edge(r,'frontend/client.ts',line(templateClient,token),'http').every(e=>e.targetKey==='qa.TemplateResource#get/0')]),
 ['longer template selects details',edge(r,'frontend/client.ts',line(templateClient,'longer-template'),'http').length===2&&edge(r,'frontend/client.ts',line(templateClient,'longer-template'),'http').every(e=>e.targetKey==='qa.TemplateResource#details/0')],
 ['placeholder never spans slash',edge(r,'frontend/client.ts',line(templateClient,'reject-multiple-segments'),'http').length===0&&unknown(r,'frontend/client.ts',line(templateClient,'reject-multiple-segments'),/unmatched-endpoint/).length>0],
 ['constrained route suppression has explicit unknown',edge(r,'frontend/client.ts',line(templateClient,'regex-stays-unknown'),'http').length===0&&r.unknowns.some(u=>u.reason==='unsupported-route-constraint')]
]);
function fileMap(dir) { const result={}; function walk(d) {for(const entry of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,entry.name); if(entry.isDirectory())walk(p); else if(/\.(java|tsx?|jsx?)$/.test(p))result[path.relative(dir,p).replaceAll('\\','/')]=fs.readFileSync(p,'utf8');}} walk(dir); return result; }
function treeHash(files){return sha(JSON.stringify(Object.keys(files).sort().map(p=>[p,sha(files[p])])));}
function validateEvidence(report,baseline,candidate){const errors=[];let count=0;const roots={};for(const [side,files]of [['baseline',baseline],['candidate',candidate]]){const expected=treeHash(files);const prov=report.provenance[side];if(prov.contentHash!==expected||prov.revision!=='tree-sha256:'+expected)errors.push(side+' tree identity mismatch');roots[prov.revision]=files;}
 function walk(value,p='$'){if(!value||typeof value!=='object')return;if(value.path&&value.range&&value.revision&&value.fileHash!==undefined&&value.excerpt!==undefined){count++;const files=roots[value.revision],text=files?.[value.path],range=value.range;if(text===undefined)errors.push(p+' missing source/revision');else{if(sha(text)!==value.fileHash)errors.push(p+' hash mismatch');const lines=text.split(/\r?\n/);if(!Number.isInteger(range.startLine)||!Number.isInteger(range.endLine)||range.startLine<1||range.endLine<range.startLine||range.endLine>lines.length)errors.push(p+' invalid range');if(lines.slice(range.startLine-1,range.endLine).join('\n')!==value.excerpt)errors.push(p+' excerpt mismatch');}}for(const [k,v]of Object.entries(value))walk(v,p+'.'+k);} walk(report);return {checkedEvidenceRecords:count,errors}; }
const manifest=JSON.parse(fs.readFileSync(path.join(build,'BUILD-MANIFEST.json'),'utf8'));
function verifyManifest(){return Object.entries(manifest.files).map(([file,expected])=>({file,expected,actual:sha(fs.readFileSync(path.join(build,file)))})).filter(x=>x.actual!==x.expected);}
const preManifest=verifyManifest();fs.writeFileSync(path.join(out,'environment.json'),JSON.stringify({build,sourceCaseRoot:root,artifactZipSha256,manifestSha256:sha(fs.readFileSync(path.join(build,'BUILD-MANIFEST.json'))),manifestFiles:Object.keys(manifest.files).length,node:process.version,manifestErrorsBefore:preManifest,reviewedDocs:['README.md','docs/architecture.md','docs/parser-contract.md','docs/java-parser.md','docs/typescript-parser.md','docs/verification.md']},null,2)+'\n');
const results=[];const commands=[];
for(const c of cases){const dir=path.join(root,c.id),base=path.join(dir,'baseline'),candidate=path.join(dir,'candidate'),caseOut=path.join(out,c.id);fs.mkdirSync(base,{recursive:true});fs.mkdirSync(candidate,{recursive:true});fs.mkdirSync(caseOut,{recursive:true});for(const [file,text]of Object.entries(c.baseline)){for(const dest of [base,candidate]){fs.mkdirSync(path.dirname(path.join(dest,file)),{recursive:true});fs.writeFileSync(path.join(dest,file),text);}}for(const [file,text]of Object.entries(c.updates))fs.writeFileSync(path.join(candidate,file),text);
 const argv=[path.join(build,'src/cli.js'),'analyze','--baseline',base,'--candidate',candidate,'--rules',path.join(root,'rules.json'),'--as-of','2026-10-11','--task',c.description,'--format','json'];fs.cpSync(base,path.join(caseOut,'input','baseline'),{recursive:true});fs.cpSync(candidate,path.join(caseOut,'input','candidate'),{recursive:true});fs.copyFileSync(path.join(root,'rules.json'),path.join(caseOut,'input','rules.json')); const command={command:process.execPath,args:argv,cwd:build};commands.push(command);fs.writeFileSync(path.join(caseOut,'command.json'),JSON.stringify(command,null,2)+'\n');const run=spawnSync(process.execPath,argv,{cwd:build,encoding:'utf8'});fs.writeFileSync(path.join(caseOut,'stdout.json'),run.stdout||'');fs.writeFileSync(path.join(caseOut,'stderr.log'),run.stderr||'');let report=null,evidence=null,assertions=[];if(run.status===0){report=JSON.parse(run.stdout);evidence=validateEvidence(report,fileMap(base),fileMap(candidate));assertions=c.checks(report).map(([name,pass])=>({name,status:pass?'pass':'fail'}));assertions.push({name:'all source evidence hashes/ranges/excerpts/revisions independently reproduce',status:evidence.errors.length?'fail':'pass'});const readable=spawnSync(process.execPath,[...argv.slice(0,-1),'readable'],{cwd:build,encoding:'utf8'});fs.writeFileSync(path.join(caseOut,'readable.stdout.txt'),readable.stdout||'');fs.writeFileSync(path.join(caseOut,'readable.stderr.log'),readable.stderr||'');commands.push({command:process.execPath,args:[...argv.slice(0,-1),'readable'],cwd:build});assertions.push({name:'readable actual CLI exits 0',status:readable.status===0?'pass':'fail'});}
 const summary={id:c.id,description:c.description,status:run.status!==0?'fail':assertions.some(a=>a.status==='fail')?'fail':'pass',exitCode:run.status,sourcePaths:{baseline:base,candidate},sourceHashes:{baseline:Object.fromEntries(Object.entries(fileMap(base)).map(([p,t])=>[p,sha(t)])),candidate:Object.fromEntries(Object.entries(fileMap(candidate)).map(([p,t])=>[p,sha(t)]))},evidence,assertions,reportStats:report?{changes:report.changes.length,directEdges:report.impact.direct.length,unknowns:report.unknowns.length,sourceBuildHash:report.analyzer.sourceBuildHash}:null};fs.writeFileSync(path.join(caseOut,'checks.json'),JSON.stringify(summary,null,2)+'\n');results.push(summary);console.log(c.id+': '+summary.status+' '+assertions.filter(a=>a.status==='fail').map(a=>a.name).join('; '));}
const final={artifactZipSha256,build,caseRoot:root,cases:results.length,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,notRun:0,manifestErrorsBefore:preManifest,manifestErrorsAfter:verifyManifest(),results};fs.writeFileSync(path.join(out,'commands.json'),JSON.stringify(commands,null,2)+'\n');fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(final,null,2)+'\n');
console.log(JSON.stringify({cases:final.cases,passed:final.passed,failed:final.failed,notRun:final.notRun,manifestErrorsAfter:final.manifestErrorsAfter}));
