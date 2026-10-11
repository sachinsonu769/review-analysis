import {evidence, hash} from './snapshot.js';

// These bounds also apply to API callers, not just the JSON upload UI.
const LIMITS = Object.freeze({criteria:100,selectors:500,files:10000,fileBytes:4*1024*1024,snapshotBytes:64*1024*1024,evidencePerSelector:20,globSteps:20*1024*1024,textCharacters:128*1024*1024});
const HEX = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(label, detail) { throw new Error(`Invalid requirements checklist: ${label} ${detail}`); }
function object(value, label, keys) {
  if (!record(value)) fail(label, 'must be an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(label, `contains unsupported field ${key}`);
}
function string(value, label, maximum=4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) fail(label, `must be a nonempty string of at most ${maximum} characters`);
  return value;
}
function relativePath(value, label, glob=false) {
  string(value, label, 512);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || /[?\[\]{}]/.test(value)) fail(label, 'must be a relative POSIX path using only literal text and optional * or ** globs');
  const parts=value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || (!glob && part.includes('*')) || (part.includes('**') && part !== '**'))) fail(label, 'contains an unsupported path segment');
  return value;
}
function array(value, label, maximum=100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) fail(label, `must be an array of at most ${maximum} items`);
  return value;
}
function timestamp(value, label) {
  string(value,label,100);
  // Check the calendar date as well as Date.parse, which otherwise normalizes February 31.
  const match=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) fail(label,'must be a valid ISO 8601 timestamp with a timezone');
  const date=new Date(0);date.setUTCFullYear(Number(match[1]),Number(match[2])-1,Number(match[3]));
  if (date.getUTCFullYear()!==Number(match[1]) || date.getUTCMonth()+1!==Number(match[2]) || date.getUTCDate()!==Number(match[3])) fail(label,'contains an invalid calendar date');
  return value;
}
function projectIdentifier(value,label='projectId') {
  string(value,label,100);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))fail(label,'must be a literal project ID containing letters, numbers, dots, underscores, or hyphens');
  return value;
}
function normalizeScope(value,label='evidenceScope',allowProjects=true) {
  object(value,label,allowProjects?['snapshotRevision','fileHashes','projects']:['snapshotRevision','fileHashes']);
  if(own(value,'projects')) {
    if(own(value,'snapshotRevision')||own(value,'fileHashes'))fail(label,'cannot mix global and per-project fingerprints');
    if(!record(value.projects)||!Object.keys(value.projects).length||Object.keys(value.projects).length>100)fail(`${label}.projects`,'must be a nonempty bounded project-to-scope object');
    return {projects:Object.fromEntries(Object.entries(value.projects).map(([id,scope])=>[projectIdentifier(id,`${label}.projects ID`),normalizeScope(scope,`${label}.projects.${id}`,false)]))};
  }
  const result={};
  if(own(value,'snapshotRevision'))result.snapshotRevision=string(value.snapshotRevision,`${label}.snapshotRevision`,300);
  if(own(value,'fileHashes')) {
    if(!record(value.fileHashes)||Object.keys(value.fileHashes).length>LIMITS.files)fail(`${label}.fileHashes`,'must be a bounded path-to-SHA256 object');
    result.fileHashes={};
    for(const [file,digest]of Object.entries(value.fileHashes)) {
      relativePath(file,`${label}.fileHashes path`);
      if(typeof digest!=='string'||!HEX.test(digest))fail(`${label}.fileHashes`,'must contain lowercase SHA256 values');
      Object.defineProperty(result.fileHashes,file,{value:digest,enumerable:true,writable:true,configurable:true});
    }
  }
  if(!result.snapshotRevision&&!Object.keys(result.fileHashes||{}).length)fail(label,'must pin a snapshot revision or at least one file hash');
  return result;
}

/** Validate and normalize without modifying or confirming the supplied checklist. */
export function validateChecklist(checklist) {
  object(checklist,'checklist',['schemaVersion','revision','owner','confirmation','evidenceScope','criteria']);
  if (checklist.schemaVersion !== '1') fail('schemaVersion','must be "1"');
  const revision=string(checklist.revision,'revision',200);
  const owner=string(checklist.owner,'owner',200);
  object(checklist.confirmation,'confirmation',['status','confirmedBy','confirmedAt','simulation']);
  const confirmation={status:checklist.confirmation.status};
  if (!['draft','confirmed'].includes(confirmation.status)) fail('confirmation.status','must be draft or confirmed');
  if (own(checklist.confirmation,'simulation')) {
    if (typeof checklist.confirmation.simulation !== 'boolean') fail('confirmation.simulation','must be a boolean');
    confirmation.simulation=checklist.confirmation.simulation;
  }
  if (own(checklist.confirmation,'confirmedBy')) confirmation.confirmedBy=string(checklist.confirmation.confirmedBy,'confirmation.confirmedBy',200);
  if (own(checklist.confirmation,'confirmedAt')) confirmation.confirmedAt=timestamp(checklist.confirmation.confirmedAt,'confirmation.confirmedAt');
  if (confirmation.status==='confirmed' && (!confirmation.confirmedBy || !confirmation.confirmedAt)) fail('confirmation','requires supplied confirmedBy and confirmedAt when status is confirmed');
  const evidenceScope=checklist.evidenceScope===undefined?undefined:normalizeScope(checklist.evidenceScope);
  let selectorCount=0;
  function selectors(value,label,kind) {
    return array(value,label,20).map((selector,index)=>{
      const at=`${label}[${index}]`;
      object(selector,at,kind==='source'?['pathPattern','symbol','pattern','projectId']:['pathPattern','name','pattern','projectId']);
      const result={pathPattern:relativePath(selector.pathPattern,`${at}.pathPattern`,true)};
      if(own(selector,'projectId'))result.projectId=projectIdentifier(selector.projectId,`${at}.projectId`);
      for (const key of kind==='source'?['symbol','pattern']:['name','pattern']) if (own(selector,key)) result[key]=string(selector[key],`${at}.${key}`,2000);
      if (!result.symbol && !result.name && !result.pattern) fail(at,'requires an explicit literal pattern, symbol, or test name');
      if (++selectorCount>LIMITS.selectors) fail('selectors',`exceed the ${LIMITS.selectors} item limit`);
      return result;
    });
  }
  const ids=new Set();
  const criteria=array(checklist.criteria,'criteria',LIMITS.criteria).map((criterion,index)=>{
    const at=`criteria[${index}]`;
    object(criterion,at,['id','description','source','tests','edgeCases']);
    const id=string(criterion.id,`${at}.id`,100);
    if (ids.has(id)) fail(`${at}.id`,'must be unique');
    ids.add(id);
    const edgeIds=new Set();
    return {id,description:string(criterion.description,`${at}.description`),source:selectors(criterion.source,`${at}.source`,'source'),tests:selectors(criterion.tests,`${at}.tests`,'test'),edgeCases:array(criterion.edgeCases,`${at}.edgeCases`,50).map((edge,edgeIndex)=>{
      const edgeAt=`${at}.edgeCases[${edgeIndex}]`;
      object(edge,edgeAt,['id','description','tests']);
      const edgeId=string(edge.id,`${edgeAt}.id`,100);
      if(edgeIds.has(edgeId)) fail(`${edgeAt}.id`,'must be unique within its criterion');
      edgeIds.add(edgeId);
      return {id:edgeId,description:string(edge.description,`${edgeAt}.description`),tests:selectors(edge.tests,`${edgeAt}.tests`,'test')};
    })};
  });
  if (!criteria.length) fail('criteria','must contain at least one criterion');
  return {schemaVersion:'1',revision,owner,confirmation,...(evidenceScope?{evidenceScope}:{}),criteria};
}

function spend(budget,kind,amount) {
  budget[kind]+=amount;
  if(budget[kind]>LIMITS[kind])throw new Error('Requirements review exceeds bounded matching work limits; narrow path selectors or review a smaller snapshot');
}
// Dynamic-programming globs never turn user input into regular expressions.
function segmentMatches(pattern,value,budget) {
  if(!pattern.includes('*'))return pattern===value;
  if(pattern==='*')return true;
  spend(budget,'globSteps',pattern.length*(value.length+1));
  let row=Array(value.length+1).fill(false);row[0]=true;
  for (const character of pattern) {
    const next=Array(value.length+1).fill(false);
    if (character==='*') next[0]=row[0];
    for (let index=1;index<=value.length;index++) next[index]=character==='*'?(row[index]||next[index-1]):(row[index-1]&&character===value[index-1]);
    row=next;
  }
  return row[value.length];
}
function pathMatches(pattern,value,budget) {
  if(!pattern.includes('*'))return pattern===value;
  const parts=pattern.split('/');const segments=value.split('/');
  spend(budget,'globSteps',parts.length*(segments.length+1));
  let row=Array(segments.length+1).fill(false);row[0]=true;
  for (const part of parts) {
    const next=Array(segments.length+1).fill(false);
    if(part==='**')next[0]=row[0];
    for(let index=1;index<=segments.length;index++)next[index]=part==='**'?(row[index]||next[index-1]):(row[index-1]&&segmentMatches(part,segments[index-1],budget));
    row=next;
  }
  return row[segments.length];
}
function isTestPath(file) {
  return /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(file) || /\.(?:test|spec)\.[jt]sx?$/i.test(file) || /(?:^|\/)(?:[^/]*Tests?|Test[^/]*)\.java$/.test(file);
}
function validateSnapshot(snapshot) {
  if (!record(snapshot) || typeof snapshot.revision!=='string' || !snapshot.revision || !record(snapshot.files)) throw new Error('Requirements review needs a snapshot with a revision and file records');
  if(snapshot.revision.length>300 || Object.keys(snapshot.files).length>LIMITS.files)throw new Error('Requirements snapshot exceeds bounded review limits');
  let bytes=0;
  for (const [file,source] of Object.entries(snapshot.files)) {
    relativePath(file,'snapshot file path');
    if (!record(source) || typeof source.text!=='string' || typeof source.hash!=='string' || !HEX.test(source.hash)) throw new Error(`Invalid requirements snapshot file: ${file}`);
    const size=Buffer.byteLength(source.text);
    bytes+=size;
    if(size>LIMITS.fileBytes || bytes>LIMITS.snapshotBytes)throw new Error('Requirements snapshot exceeds bounded review size limits');
    if(hash(source.text)!==source.hash)throw new Error(`Requirements snapshot hash does not match file text: ${file}`);
  }
  return {bytes,files:Object.keys(snapshot.files).length};
}
function scopeReview(snapshot,scope) {
  if(!scope)return {status:'unscoped',issues:[]};
  const issues=[];
  if(scope.snapshotRevision && scope.snapshotRevision!==snapshot.revision)issues.push({kind:'revision-mismatch',expected:scope.snapshotRevision,actual:snapshot.revision});
  for(const [file,digest]of Object.entries(scope.fileHashes||{}))if(snapshot.files[file]?.hash!==digest)issues.push({kind:snapshot.files[file]?'file-hash-mismatch':'missing-pinned-file',path:file,expected:digest,actual:snapshot.files[file]?.hash||null});
  return {status:issues.length?'stale':'matched',issues};
}
function locate(snapshot,file,literal,kind,anchor,projectId) {
  const text=snapshot.files[file].text;const index=text.indexOf(literal);
  const startLine=text.slice(0,index).split(/\r?\n/).length;
  const endLine=startLine+literal.split(/\r?\n/).length-1;
  const item=evidence(snapshot,file,{startLine,endLine});
  const truncated=item.excerpt.length>1600;
  return {...item,...(projectId===undefined?{}:{projectId}),excerpt:truncated?item.excerpt.slice(0,1600):item.excerpt,...(truncated?{excerptTruncated:true}:{}),kind:kind==='source'?'source-literal':'test-source-literal',anchor,matchedLiteral:literal,execution:'unverified'};
}

/** Source-only mapping from explicit business criteria to supplied source/test text. */
export function reviewRequirements({snapshot,checklist,graph,projectId}={}) {
  const config=validateChecklist(checklist);
  validateSnapshot(snapshot);
  if(projectId!==undefined)projectIdentifier(projectId);
  if(config.evidenceScope?.projects)throw new Error('Per-project requirements evidenceScope requires reviewWorkspaceRequirements');
  const selectors=config.criteria.flatMap(item=>[...item.source,...item.tests,...item.edgeCases.flatMap(edge=>edge.tests)]);
  if(projectId===undefined&&selectors.some(selector=>selector.projectId!==undefined))throw new Error('Requirements selectors with projectId require a projectId option or reviewWorkspaceRequirements');
  const scope=scopeReview(snapshot,config.evidenceScope);
  const paths=Object.keys(snapshot.files).sort();
  const provenance={revision:snapshot.revision,contentHash:hash(paths.map(file=>[file,snapshot.files[file].hash])),fileHashesVerified:true,...(projectId===undefined?{}:{projectId}),scope};
  return evaluateReview({contexts:[{id:projectId,snapshot,paths}],config,scope,provenance,graph});
}

/** Evaluate each criterion once across explicitly identified project snapshots. */
export function reviewWorkspaceRequirements({projects,checklist,graph}={}) {
  const config=validateChecklist(checklist);
  if(!Array.isArray(projects)||!projects.length||projects.length>100)throw new Error('Workspace requirements review needs between 1 and 100 identified project snapshots');
  const ids=new Set();let bytes=0;let files=0;
  const contexts=projects.map(project=>{
    if(!record(project))throw new Error('Workspace requirements project must provide id and snapshot');
    const id=projectIdentifier(project.id,'projects[].id');
    if(ids.has(id))throw new Error(`Duplicate requirements project ID: ${id}`);
    ids.add(id);
    const sizes=validateSnapshot(project.snapshot);bytes+=sizes.bytes;files+=sizes.files;
    if(bytes>LIMITS.snapshotBytes||files>LIMITS.files)throw new Error('Requirements workspace exceeds aggregate bounded review size limits');
    return {id,snapshot:project.snapshot,paths:Object.keys(project.snapshot.files).sort()};
  }).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  let scope;
  if(!config.evidenceScope)scope={status:'unscoped',issues:[]};
  else if(config.evidenceScope.projects) {
    const issues=[];
    for(const [id,pin]of Object.entries(config.evidenceScope.projects)) {
      const context=contexts.find(project=>project.id===id);
      if(!context){issues.push({kind:'missing-pinned-project',projectId:id});continue;}
      issues.push(...scopeReview(context.snapshot,pin).issues.map(issue=>({...issue,projectId:id})));
    }
    scope={status:issues.length?'stale':'matched',issues,pinnedProjectIds:Object.keys(config.evidenceScope.projects).sort(),unpinnedProjectIds:contexts.filter(project=>!own(config.evidenceScope.projects,project.id)).map(project=>project.id)};
  } else {
    if(contexts.length!==1)throw new Error('Multi-project requirements evidenceScope must use per-project fingerprints in evidenceScope.projects');
    scope=scopeReview(contexts[0].snapshot,config.evidenceScope);
  }
  const provenance={mode:'workspace',fileHashesVerified:true,projects:contexts.map(({id,snapshot,paths})=>({id,revision:snapshot.revision,contentHash:hash(paths.map(file=>[file,snapshot.files[file].hash]))})),scope};
  return evaluateReview({contexts,config,scope,provenance,graph,workspace:true});
}

function evaluateReview({contexts,config,scope,provenance,graph,workspace=false}) {
  const status=config.confirmation.status==='draft'?'draft':config.confirmation.simulation===true?'simulated-confirmed':'confirmed-assertion';
  const preliminary=status==='draft';
  const matchCache=new Map();const pathCache=new Map();
  const budget={globSteps:0,textCharacters:0};
  function match(selector,kind) {
    const key=JSON.stringify([kind,selector]);
    if(matchCache.has(key))return matchCache.get(key);
    const anchors=Object.entries(selector).filter(([name])=>name!=='pathPattern'&&name!=='projectId');
    const selectedContexts=selector.projectId===undefined?contexts:contexts.filter(project=>project.id===selector.projectId);
    const candidates=selectedContexts.flatMap(context=>{
      const pathKey=JSON.stringify([context.id,selector.pathPattern]);
      if(!pathCache.has(pathKey))pathCache.set(pathKey,selector.pathPattern.includes('*')?context.paths.filter(file=>pathMatches(selector.pathPattern,file,budget)):(own(context.snapshot.files,selector.pathPattern)?[selector.pathPattern]:[]));
      return pathCache.get(pathKey).map(file=>({context,file}));
    });
    const eligible=kind==='test'?candidates.filter(item=>isTestPath(item.file)):candidates;
    const matchedPaths=eligible.filter(({context,file})=>{
      spend(budget,'textCharacters',context.snapshot.files[file].text.length*anchors.length);
      return anchors.every(([,literal])=>context.snapshot.files[file].text.includes(literal));
    });
    const matched=matchedPaths.length>0;
    const selectedPaths=matchedPaths.slice(0,LIMITS.evidencePerSelector);
    const evidenceItems=selectedPaths.flatMap(({context,file})=>anchors.map(([anchor,literal])=>locate(context.snapshot,file,literal,kind,anchor,context.id)));
    const reason=matched?'All explicit literal anchors occur in the same supplied file':!selectedContexts.length?'No selected project matches the explicit projectId':!candidates.length?'No supplied file matches the path selector':!eligible.length?'Matched paths are not recognized test source files':'No eligible file contains all explicit literal anchors';
    const result={selector:{...selector},status:matched?'matched':'unmatched',reason,matchingFileCount:matchedPaths.length,searchedFileCount:eligible.length,...(workspace?{searchedProjectIds:selectedContexts.map(project=>project.id)}:{}),evidence:evidenceItems,evidenceTruncated:matchedPaths.length>selectedPaths.length};
    matchCache.set(key,result);return result;
  }
  const criteria=config.criteria.map(criterion=>{
    const sourceChecks=criterion.source.map(selector=>match(selector,'source'));
    const testChecks=criterion.tests.map(selector=>match(selector,'test'));
    const sourceEvidence=sourceChecks.flatMap(check=>check.evidence);
    const testEvidence=testChecks.flatMap(check=>check.evidence);
    const edgeCases=criterion.edgeCases.map(edge=>{
      const checks=edge.tests.map(selector=>match(selector,'test'));
      const missing=!checks.length||checks.some(check=>check.status!=='matched');
      return {id:edge.id,description:edge.description,assessment:missing?'missing':'evidenced',checks,testEvidence:checks.flatMap(check=>check.evidence),runtime:'unverified',...(missing?{reason:!checks.length?'No explicit test selector supplied for this edge case':'One or more declared edge-case test selectors are unmatched'}:{})};
    });
    const missingEdgeCases=edgeCases.filter(edge=>edge.assessment==='missing').map(({id,description,reason,checks})=>({id,description,reason,checks}));
    const reasons=[];
    if(preliminary)reasons.push('Checklist is draft; business criteria have not been asserted as confirmed');
    if(scope.status==='stale')reasons.push('Pinned evidence scope does not match the supplied snapshot');
    if(!sourceChecks.length)reasons.push('No explicit source selectors supplied');
    if(!testChecks.length)reasons.push('No explicit test selectors supplied');
    const missingSource=sourceChecks.some(check=>check.status!=='matched');
    const missingTests=testChecks.some(check=>check.status!=='matched');
    if(missingSource)reasons.push('One or more declared source selectors are unmatched');
    if(missingTests)reasons.push('One or more declared test selectors are unmatched');
    if(missingEdgeCases.length)reasons.push('Declared edge cases have missing test source evidence');
    let assessment;
    if(preliminary||scope.status==='stale'||!sourceChecks.length)assessment='unverified';
    else if(missingSource||missingTests||missingEdgeCases.length)assessment='potential-mismatch';
    else if(!testChecks.length)assessment='unverified';
    else assessment='evidenced';
    if(assessment==='evidenced')reasons.push('Explicit source and test literals were found; behavioral correctness and test execution remain unverified');
    return {id:criterion.id,description:criterion.description,assessment,reasons,sourceChecks,testChecks,sourceEvidence,testEvidence,edgeCases,missingEdgeCases,runtime:'unverified'};
  });
  return {schemaVersion:'1',status,advisory:true,confirmation:{...config.confirmation},checklist:{revision:config.revision,owner:config.owner,hash:hash(config)},provenance,criteria,summary:{total:criteria.length,evidenced:criteria.filter(item=>item.assessment==='evidenced').length,potentialMismatch:criteria.filter(item=>item.assessment==='potential-mismatch').length,unverified:criteria.filter(item=>item.assessment==='unverified').length,missingEdgeCases:criteria.reduce((sum,item)=>sum+item.missingEdgeCases.length,0)},runtime:'unverified',limitations:[
    'Confirmation metadata is a supplied assertion; the engine does not authenticate an owner or invent approval. Simulated confirmations are demonstration data.',
    'Literal source matches, including symbol and test-name anchors, show text presence only. Comments and string literals can match; declarations, assertions and business behavior are not proved.',
    'Test source evidence does not show that tests were executed, passed, or cover the criterion at runtime. Runtime behavior always remains unverified.',
    'Only supplied snapshot files are searched. Test selectors are limited to test/spec filenames, Java Test/Tests names, or test/tests/__tests__ directories.',
    'Missing edge cases are only those explicitly listed in the checklist. The engine cannot infer all necessary business scenarios or permit skipping full regression.',
    'Path selectors use bounded * and ** globs; all other selectors are case-sensitive literal text. No user regular expressions, external AI, or local models are run.',
    'Snapshot revisions are supplied by the snapshot reader; file SHA256 values are checked against supplied text. Without evidenceScope, confirmation has no pinned source revision.',
    ...(workspace?['Workspace criteria are evaluated once across selected project snapshots. Unscoped selectors search every selected project; explicit projectId selectors search only that project. Evidence preserves each project ID, original path, revision and file hash.']:[]),
    ...(graph?['An optional dependency graph was supplied but is not used to infer semantic satisfaction of business criteria.']:[])
  ]};
}
