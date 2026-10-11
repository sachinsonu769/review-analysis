import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {readSnapshot, hash} from '../src/snapshot.js';
import {reviewRequirements, reviewWorkspaceRequirements, validateChecklist} from '../src/requirements.js';

const fixtureRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures/requirements');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(fixtureRoot,name),'utf8'));
const sample=()=>readSnapshot({type:'directory',root:path.join(fixtureRoot,'sample')});
const confirmed=()=>fixture('confirmed-simulation-checklist.json');
function snapshot(files,revision='test-revision') {
  return {root:'/no-filesystem-access-is-needed',revision,files:Object.fromEntries(Object.entries(files).map(([file,text])=>[file,{text,hash:hash(text)}]))};
}
function checklist(criteria,confirmation={status:'confirmed',confirmedBy:'SIMULATED test reviewer',confirmedAt:'2026-10-11T12:00:00Z',simulation:true}) {
  return {schemaVersion:'1',revision:'test-checklist-v1',owner:'SIMULATED test owner',confirmation,criteria};
}
function criterion(overrides={}) {
  return {id:'lookup',description:'Return a customer display name',source:[{pathPattern:'src/customer.ts',pattern:'displayName'}],tests:[{pathPattern:'src/customer.test.ts',name:'returns a customer display name'}],edgeCases:[],...overrides};
}
const smallSnapshot=()=>snapshot({'src/customer.ts':'export const displayName = "Ada";','src/customer.test.ts':'test("returns a customer display name", () => assert.equal(displayName, "Ada"));'});

test('default business checklist is draft and cannot establish confirmed requirements',()=>{
  const input=fixture('draft-checklist.json');const original=structuredClone(input);
  const report=reviewRequirements({snapshot:sample(),checklist:input});
  assert.equal(report.status,'draft');
  assert.equal(report.summary.evidenced,0);
  assert.equal(report.summary.unverified,input.criteria.length);
  assert.ok(report.criteria[0].sourceEvidence.length>0,'preliminary literal matches remain reviewable');
  assert.equal(report.confirmation.confirmedBy,undefined);
  assert.equal(report.runtime,'unverified');
  assert.deepEqual(input,original,'review must not mutate or confirm business input');
});

test('confirmed simulation maps multiple customer criteria and retains negative cases',()=>{
  const report=reviewRequirements({snapshot:sample(),checklist:confirmed()});
  assert.equal(report.status,'simulated-confirmed');
  assert.match(report.confirmation.confirmedBy,/SIMULATED/);
  assert.deepEqual(report.summary,{total:6,evidenced:2,potentialMismatch:3,unverified:1,missingEdgeCases:4});
  const byId=Object.fromEntries(report.criteria.map(item=>[item.id,item]));
  assert.equal(byId['customer-lookup-by-id'].assessment,'evidenced');
  assert.equal(byId['display-name'].assessment,'evidenced');
  assert.equal(byId['blank-identifier'].assessment,'potential-mismatch');
  assert.equal(byId['blank-identifier'].sourceEvidence.length,0);
  assert.equal(byId['blank-identifier'].missingEdgeCases.length,2);
  assert.equal(byId['customer-not-found'].sourceEvidence.length,1);
  assert.equal(byId['customer-not-found'].testEvidence.length,0);
  assert.equal(byId['confirmation-needed-detail'].assessment,'unverified');
  for(const item of report.criteria)assert.equal(item.runtime,'unverified');
  assert.ok(report.limitations.some(line=>line.includes('does not authenticate')));
  assert.ok(report.limitations.some(line=>line.includes('does not show that tests were executed')));
});

test('real-looking confirmation remains an assertion and never authenticates an owner',()=>{
  const input=confirmed();delete input.confirmation.simulation;
  input.confirmation.confirmedBy='Provided customer owner identity';
  const report=reviewRequirements({snapshot:sample(),checklist:input});
  assert.equal(report.status,'confirmed-assertion');
  assert.equal(report.confirmation.confirmedBy,input.confirmation.confirmedBy);
  assert.equal(report.confirmation.simulation,undefined);
  assert.equal(report.runtime,'unverified');
  const draft=checklist([criterion()],{status:'draft',confirmedBy:'Supplied but still draft',confirmedAt:'2026-10-11T12:00:00Z'});
  assert.equal(reviewRequirements({snapshot:smallSnapshot(),checklist:draft}).status,'draft');
});

test('evidence uses exact snapshot revision, validated file hashes, and line excerpts',()=>{
  const sources=smallSnapshot();sources.files['src/customer.ts']={text:'// introduction\nexport const displayName = "Ada";\n',hash:hash('// introduction\nexport const displayName = "Ada";\n')};
  const report=reviewRequirements({snapshot:sources,checklist:checklist([criterion()])});
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.provenance.revision,sources.revision);
  assert.equal(report.provenance.fileHashesVerified,true);
  assert.equal(report.provenance.scope.status,'unscoped');
  for(const item of [...report.criteria[0].sourceEvidence,...report.criteria[0].testEvidence]) {
    assert.equal(item.revision,sources.revision);
    assert.equal(item.fileHash,hash(sources.files[item.path].text));
    assert.equal(item.excerpt,sources.files[item.path].text.split(/\r?\n/).slice(item.range.startLine-1,item.range.endLine).join('\n'));
    assert.equal(item.execution,'unverified');
  }
  assert.deepEqual(report.criteria[0].sourceEvidence[0].range,{startLine:2,endLine:2});
  assert.equal(report.criteria[0].testEvidence[0].kind,'test-source-literal');
});

test('stale revision and source fingerprints suppress satisfaction without hiding matches',()=>{
  const sources=smallSnapshot();const input=checklist([criterion()]);
  input.evidenceScope={snapshotRevision:'old-revision',fileHashes:{'src/customer.ts':hash('previous version'),'src/removed.ts':hash('removed')}};
  const report=reviewRequirements({snapshot:sources,checklist:input});
  assert.equal(report.status,'simulated-confirmed');
  assert.equal(report.provenance.scope.status,'stale');
  assert.deepEqual(report.provenance.scope.issues.map(item=>item.kind),['revision-mismatch','file-hash-mismatch','missing-pinned-file']);
  assert.equal(report.criteria[0].assessment,'unverified');
  assert.ok(report.criteria[0].sourceEvidence.length,'current source text is still available for review');
  input.evidenceScope={snapshotRevision:sources.revision,fileHashes:{'src/customer.ts':sources.files['src/customer.ts'].hash}};
  const current=reviewRequirements({snapshot:sources,checklist:input});
  assert.equal(current.provenance.scope.status,'matched');
  assert.equal(current.criteria[0].assessment,'evidenced');
});

test('supplied snapshot digest cannot certify different file text',()=>{
  const sources=smallSnapshot();sources.files['src/customer.ts'].text+='\nchanged';
  assert.throws(()=>reviewRequirements({snapshot:sources,checklist:checklist([criterion()])}),/hash does not match file text/);
});

test('explicit anchors must occur together in a selected file, rather than across files',()=>{
  const sources=snapshot({'src/a.ts':'function lookup() {}','src/b.ts':'const displayName = "Ada";','src/a.test.ts':'test("returns a customer display name", () => {});'});
  const input=checklist([criterion({source:[{pathPattern:'src/*.ts',symbol:'lookup',pattern:'displayName'}],tests:[{pathPattern:'src/a.test.ts',name:'returns a customer display name'}]})]);
  const report=reviewRequirements({snapshot:sources,checklist:input});
  assert.equal(report.criteria[0].assessment,'potential-mismatch');
  assert.equal(report.criteria[0].sourceEvidence.length,0);
  assert.match(report.criteria[0].sourceChecks[0].reason,/all explicit literal anchors/);
});

test('globs handle nested and zero-depth paths with literal regex punctuation',()=>{
  const sources=snapshot({'customer.ts':'displayName','src/deep/customer.ts':'displayName','src/(customer)+$.ts':'displayName','tests/customer.spec.ts':'returns a customer display name'});
  const input=checklist([criterion({source:[{pathPattern:'**/customer.ts',pattern:'displayName'},{pathPattern:'src/(customer)+$.ts',pattern:'displayName'}],tests:[{pathPattern:'tests/*.spec.ts',name:'returns a customer display name'}]})]);
  const report=reviewRequirements({snapshot:sources,checklist:input});
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.criteria[0].sourceChecks[0].matchingFileCount,2);
  assert.equal(report.criteria[0].sourceChecks[1].matchingFileCount,1);
  assert.deepEqual(report,reviewRequirements({snapshot:sources,checklist:input}),'same inputs give deterministic evidence');
});

test('test/spec TS, TSX, JSX, Java names and test directories are recognized as source evidence',()=>{
  const paths=['src/customer.test.ts','src/customer.spec.tsx','src/customer.test.jsx','src/CustomerTest.java','src/CustomerTests.java','src/TestCustomer.java','src/__tests__/customer.ts','backend/src/test/java/example/Customer.java'];
  const sources=snapshot({'src/customer.ts':'displayName',...Object.fromEntries(paths.map(file=>[file,'returns a customer display name']))});
  const report=reviewRequirements({snapshot:sources,checklist:checklist([criterion({tests:paths.map(pathPattern=>({pathPattern,name:'returns a customer display name'}))})])});
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.criteria[0].testEvidence.length,paths.length);
  assert.ok(report.criteria[0].testEvidence.every(item=>item.execution==='unverified'));
  const bad=reviewRequirements({snapshot:smallSnapshot(),checklist:checklist([criterion({tests:[{pathPattern:'src/customer.ts',pattern:'displayName'}]})])});
  assert.equal(bad.criteria[0].assessment,'potential-mismatch');
  assert.equal(bad.criteria[0].testEvidence.length,0);
  assert.match(bad.criteria[0].testChecks[0].reason,/not recognized test source/);
});

test('descriptions alone and omitted test selectors remain unverified',()=>{
  const input=checklist([criterion({id:'prose',source:[],tests:[],description:'displayName returns a customer display name'}),criterion({id:'source-only',tests:[]})]);
  const report=reviewRequirements({snapshot:smallSnapshot(),checklist:input});
  assert.equal(report.criteria[0].assessment,'unverified');
  assert.equal(report.criteria[0].sourceEvidence.length,0);
  assert.equal(report.criteria[1].assessment,'unverified');
  assert.ok(report.criteria[1].sourceEvidence.length>0);
});

test('only listed edge cases are inspected and missing explicit edge selectors stay visible',()=>{
  const input=checklist([criterion({edgeCases:[{id:'blank',description:'Reject blank customer identifiers',tests:[]},{id:'unknown',description:'An unknown identifier produces not found',tests:[{pathPattern:'src/customer.test.ts',name:'not found'}]}]})]);
  const report=reviewRequirements({snapshot:smallSnapshot(),checklist:input});
  assert.equal(report.criteria[0].assessment,'potential-mismatch');
  assert.deepEqual(report.criteria[0].missingEdgeCases.map(item=>item.id),['blank','unknown']);
  assert.equal(report.criteria[0].edgeCases.length,2);
  assert.match(report.criteria[0].missingEdgeCases[0].reason,/No explicit test selector/);
});

test('comments and string decoys are labeled text presence rather than behavioral proof',()=>{
  const sources=snapshot({'src/customer.ts':'// displayName is a planned behavior, not implemented','src/customer.test.ts':'// Planned test: returns a customer display name'});
  const report=reviewRequirements({snapshot:sources,checklist:checklist([criterion()]),graph:{edges:[]}});
  assert.equal(report.criteria[0].assessment,'evidenced','this means literal evidence only');
  assert.equal(report.criteria[0].runtime,'unverified');
  assert.ok(report.limitations.some(line=>line.includes('Comments and string literals can match')));
  assert.ok(report.limitations.some(line=>line.includes('not used to infer semantic satisfaction')));
});

test('regex-looking literal selectors are never interpreted as regex',()=>{
  const sources=snapshot({'src/customer.ts':'aaaaaaaaaaaaaaaaaaaaa!','src/customer.test.ts':'returns a customer display name'});
  const input=checklist([criterion({source:[{pathPattern:'src/customer.ts',pattern:'(a+)+$'}]})]);
  const report=reviewRequirements({snapshot:sources,checklist:input});
  assert.equal(report.criteria[0].assessment,'potential-mismatch');
  assert.equal(report.criteria[0].sourceEvidence.length,0);
  sources.files['src/customer.ts']={text:'literal (a+)+$',hash:hash('literal (a+)+$')};
  assert.equal(reviewRequirements({snapshot:sources,checklist:input}).criteria[0].assessment,'evidenced');
});

test('invalid confirmations, schema fields, IDs and unsafe paths fail explicitly',()=>{
  const mutate=callback=>{const value=checklist([criterion()]);callback(value);return value;};
  const cases=[
    [mutate(value=>delete value.confirmation.confirmedBy),/requires supplied/],
    [mutate(value=>value.confirmation.confirmedAt='2026-02-31T12:00:00Z'),/invalid calendar/],
    [mutate(value=>value.confirmation.confirmedAt='2026-10-11'),/ISO 8601/],
    [mutate(value=>value.confirmation.simulation='true'),/must be a boolean/],
    [mutate(value=>value.criteria.push(criterion())),/must be unique/],
    [mutate(value=>value.criteria[0].source[0].regex='(a+)+$'),/unsupported field regex/],
    [mutate(value=>delete value.criteria[0].source[0].pattern),/requires an explicit literal/],
    [mutate(value=>value.criteria[0].source[0].pathPattern='../private.ts'),/unsupported path segment/],
    [mutate(value=>value.criteria[0].source[0].pathPattern='/private.ts'),/relative POSIX path/],
    [mutate(value=>value.criteria[0].source[0].pathPattern='src/**.ts'),/unsupported path segment/],
    [mutate(value=>value.criteria[0].source[0].pathPattern='src/[a-z].ts'),/relative POSIX path/],
    [mutate(value=>value.criteria[0].edgeCases=[{id:'same',description:'one'},{id:'same',description:'two'}]),/unique within/],
    [mutate(value=>value.evidenceScope={fileHashes:{'src/customer.ts':'bad'}}),/lowercase SHA256/],
    [mutate(value=>value.evidenceScope={}),/must pin/]
  ];
  for(const [input,message]of cases)assert.throws(()=>validateChecklist(input),message);
  assert.throws(()=>validateChecklist({...checklist([criterion()]),schemaVersion:'2'}),/schemaVersion/);
});

test('bounded input and evidence output handle oversized selectors and long lines',()=>{
  const long=checklist([criterion({source:[{pathPattern:'src/customer.ts',pattern:'x'.repeat(2001)}]})]);
  assert.throws(()=>validateChecklist(long),/at most 2000/);
  assert.throws(()=>validateChecklist(checklist(Array.from({length:101},(_,index)=>criterion({id:String(index)})))),/at most 100/);
  const sources=snapshot({'src/customer.ts':'displayName'+' '.repeat(2000),'src/customer.test.ts':'returns a customer display name'});
  const item=reviewRequirements({snapshot:sources,checklist:checklist([criterion()])}).criteria[0].sourceEvidence[0];
  assert.equal(item.excerpt.length,1600);
  assert.equal(item.excerptTruncated,true);
});

test('adversarial wildcard work is stopped by a deterministic review budget',()=>{
  const files=Object.fromEntries(Array.from({length:400},(_,index)=>[`src/${'a'.repeat(260)}${index}.ts`,'displayName']));
  files['test/customer.ts']='returns a customer display name';
  const sources=snapshot(files);
  const input=checklist([criterion({source:[{pathPattern:`src/${'a*'.repeat(120)}z.ts`,pattern:'displayName'}],tests:[{pathPattern:'test/customer.ts',name:'returns a customer display name'}]})]);
  assert.throws(()=>reviewRequirements({snapshot:sources,checklist:input}),/bounded matching work limits/);
});

function splitProjects() {
  return [
    {id:'backend',snapshot:snapshot({'src/customer.ts':'export const displayName = "Ada";'},'backend-exact-revision')},
    {id:'frontend',snapshot:snapshot({'src/customer.test.ts':'test("returns a customer display name", () => {});'},'frontend-exact-revision')}
  ];
}

test('one criterion combines backend source and frontend tests with original project provenance',()=>{
  const input=checklist([criterion({source:[{projectId:'backend',pathPattern:'src/customer.ts',pattern:'displayName'}],tests:[{projectId:'frontend',pathPattern:'src/customer.test.ts',name:'returns a customer display name'}],edgeCases:[{id:'known-customer',description:'A known customer has a display name',tests:[{projectId:'frontend',pathPattern:'src/customer.test.ts',name:'returns a customer display name'}]}]})]);
  const projects=splitProjects();const report=reviewWorkspaceRequirements({projects,checklist:input});
  assert.equal(report.criteria.length,1,'a cross-project requirement is evaluated once');
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.provenance.mode,'workspace');
  assert.equal(report.provenance.revision,undefined,'there is no invented combined revision');
  assert.deepEqual(report.provenance.projects.map(project=>[project.id,project.revision]),[['backend','backend-exact-revision'],['frontend','frontend-exact-revision']]);
  const item=report.criteria[0];
  for(const evidenceItem of [...item.sourceEvidence,...item.testEvidence,...item.sourceChecks.flatMap(check=>check.evidence),...item.testChecks.flatMap(check=>check.evidence),...item.edgeCases.flatMap(edge=>edge.testEvidence),...item.edgeCases.flatMap(edge=>edge.checks.flatMap(check=>check.evidence))]) {
    const project=projects.find(project=>project.id===evidenceItem.projectId);
    assert.ok(project,'every nested evidence identifies its actual project');
    assert.equal(evidenceItem.revision,project.snapshot.revision);
    assert.equal(evidenceItem.fileHash,project.snapshot.files[evidenceItem.path].hash);
    assert.equal(evidenceItem.execution,'unverified');
  }
  assert.equal(item.sourceEvidence[0].projectId,'backend');
  assert.equal(item.testEvidence[0].projectId,'frontend');
  assert.deepEqual(report,reviewWorkspaceRequirements({projects:[...projects].reverse(),checklist:input}),'project input ordering does not alter combined evidence');
});

test('same-path projects remain distinct and explicit project selectors never broaden',()=>{
  const projects=[
    {id:'backend',snapshot:snapshot({'src/customer.ts':'displayName','src/customer.test.ts':'returns a customer display name'},'backend-v1')},
    {id:'frontend',snapshot:snapshot({'src/customer.ts':'legacyName'},'frontend-v2')}
  ];
  const input=checklist([criterion({source:[{projectId:'frontend',pathPattern:'src/customer.ts',pattern:'displayName'}],tests:[{projectId:'backend',pathPattern:'src/customer.test.ts',name:'returns a customer display name'}]})]);
  const wrongProject=reviewWorkspaceRequirements({projects,checklist:input});
  assert.equal(wrongProject.criteria[0].assessment,'potential-mismatch');
  assert.equal(wrongProject.criteria[0].sourceEvidence.length,0);
  assert.deepEqual(wrongProject.criteria[0].sourceChecks[0].searchedProjectIds,['frontend']);
  input.criteria[0].source[0].projectId='not-selected';
  const absentProject=reviewWorkspaceRequirements({projects,checklist:input});
  assert.equal(absentProject.criteria[0].sourceEvidence.length,0);
  assert.match(absentProject.criteria[0].sourceChecks[0].reason,/No selected project/);
  assert.deepEqual(absentProject.criteria[0].sourceChecks[0].searchedProjectIds,[]);
});

test('unscoped selectors search selected projects and retain same-path evidence identities',()=>{
  const projects=splitProjects();
  projects[1].snapshot.files['src/customer.ts']={text:'const displayName = "Other";',hash:hash('const displayName = "Other";')};
  const report=reviewWorkspaceRequirements({projects,checklist:checklist([criterion()])});
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.criteria[0].sourceChecks[0].matchingFileCount,2);
  assert.deepEqual(report.criteria[0].sourceEvidence.map(item=>[item.projectId,item.path,item.revision]),[['backend','src/customer.ts','backend-exact-revision'],['frontend','src/customer.ts','frontend-exact-revision']]);
});

test('literal anchors cannot be combined across projects even when paths are identical',()=>{
  const projects=[{id:'backend',snapshot:snapshot({'src/customer.ts':'function lookup() {}'},'backend-v1')},{id:'frontend',snapshot:snapshot({'src/customer.ts':'displayName','src/customer.test.ts':'returns a customer display name'},'frontend-v1')}];
  const report=reviewWorkspaceRequirements({projects,checklist:checklist([criterion({source:[{pathPattern:'src/customer.ts',symbol:'lookup',pattern:'displayName'}]})])});
  assert.equal(report.criteria[0].assessment,'potential-mismatch');
  assert.equal(report.criteria[0].sourceEvidence.length,0);
});

test('per-project fingerprints detect stale revisions, changed files and missing projects',()=>{
  const projects=splitProjects();const input=checklist([criterion()]);
  input.evidenceScope={projects:{backend:{snapshotRevision:'backend-exact-revision',fileHashes:{'src/customer.ts':projects[0].snapshot.files['src/customer.ts'].hash}},frontend:{snapshotRevision:'frontend-exact-revision'}}};
  const current=reviewWorkspaceRequirements({projects,checklist:input});
  assert.equal(current.provenance.scope.status,'matched');
  assert.deepEqual(current.provenance.scope.unpinnedProjectIds,[]);
  assert.equal(current.criteria[0].assessment,'evidenced');
  input.evidenceScope.projects.backend.fileHashes['src/customer.ts']=hash('old source');
  input.evidenceScope.projects.frontend.snapshotRevision='old frontend';
  input.evidenceScope.projects.retired={snapshotRevision:'old retired project'};
  const stale=reviewWorkspaceRequirements({projects,checklist:input});
  assert.equal(stale.provenance.scope.status,'stale');
  assert.equal(stale.criteria[0].assessment,'unverified');
  assert.deepEqual(stale.provenance.scope.issues.map(item=>[item.kind,item.projectId]),[['file-hash-mismatch','backend'],['revision-mismatch','frontend'],['missing-pinned-project','retired']]);
  assert.ok(stale.criteria[0].sourceEvidence.length>0,'scope does not rewrite or discard current evidence');
  input.evidenceScope={projects:{backend:{snapshotRevision:'backend-exact-revision'}}};
  assert.deepEqual(reviewWorkspaceRequirements({projects,checklist:input}).provenance.scope.unpinnedProjectIds,['frontend']);
});

test('workspace API rejects ambiguous global fingerprints and malformed project identities',()=>{
  const projects=splitProjects();const input=checklist([criterion()]);
  input.evidenceScope={snapshotRevision:'backend-exact-revision'};
  assert.throws(()=>reviewWorkspaceRequirements({projects,checklist:input}),/must use per-project fingerprints/);
  assert.equal(reviewWorkspaceRequirements({projects:[projects[0]],checklist:input}).provenance.scope.status,'matched');
  assert.throws(()=>reviewWorkspaceRequirements({projects:[projects[0],projects[0]],checklist:checklist([criterion()])}),/Duplicate requirements project ID/);
  assert.throws(()=>reviewWorkspaceRequirements({projects:[{id:'../backend',snapshot:projects[0].snapshot}],checklist:checklist([criterion()])}),/literal project ID/);
  assert.throws(()=>reviewWorkspaceRequirements({projects:[],checklist:input}),/between 1 and 100/);
  input.evidenceScope={projects:{backend:{snapshotRevision:'backend-exact-revision'}},snapshotRevision:'ambiguous'};
  assert.throws(()=>validateChecklist(input),/cannot mix global and per-project/);
});

test('single-snapshot project selectors require an explicitly supplied matching identity',()=>{
  const input=checklist([criterion({source:[{projectId:'backend',pathPattern:'src/customer.ts',pattern:'displayName'}]})]);
  assert.throws(()=>reviewRequirements({snapshot:smallSnapshot(),checklist:input}),/require a projectId option/);
  const report=reviewRequirements({snapshot:smallSnapshot(),projectId:'backend',checklist:input});
  assert.equal(report.criteria[0].assessment,'evidenced');
  assert.equal(report.criteria[0].sourceEvidence[0].projectId,'backend');
  const wrong=reviewRequirements({snapshot:smallSnapshot(),projectId:'frontend',checklist:input});
  assert.equal(wrong.criteria[0].assessment,'potential-mismatch');
  input.evidenceScope={projects:{backend:{snapshotRevision:'test-revision'}}};
  assert.throws(()=>reviewRequirements({snapshot:smallSnapshot(),projectId:'backend',checklist:input}),/requires reviewWorkspaceRequirements/);
});

test('split customer lookup fixture evaluates confirmed and draft business requirements once',()=>{
  const projects=['backend','frontend'].map(id=>({id,snapshot:readSnapshot({type:'directory',root:path.join(fixtureRoot,'sample',id)})}));
  const report=reviewWorkspaceRequirements({projects,checklist:fixture('workspace-confirmed-simulation-checklist.json')});
  assert.equal(report.status,'simulated-confirmed');
  assert.deepEqual(report.summary,{total:2,evidenced:1,potentialMismatch:1,unverified:0,missingEdgeCases:1});
  assert.equal(report.criteria[0].sourceEvidence[0].projectId,'backend');
  assert.equal(report.criteria[0].sourceEvidence[1].projectId,'frontend');
  assert.deepEqual(report.criteria[0].testEvidence.map(item=>item.projectId),['backend','frontend']);
  assert.equal(report.criteria[1].missingEdgeCases[0].checks[0].selector.projectId,'frontend');
  const draft=reviewWorkspaceRequirements({projects,checklist:fixture('workspace-draft-checklist.json')});
  assert.equal(draft.criteria.length,2);
  assert.equal(draft.summary.unverified,2);
});
