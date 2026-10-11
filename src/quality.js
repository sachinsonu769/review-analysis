import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {Linter} from 'eslint';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import {parseJava} from './java.js';
import {evidence, hash} from './snapshot.js';

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const JS = /\.(?:tsx?|jsx?)$/i;
const JAVA = /\.java$/i;
const DEFAULT = {complexityThreshold:10,duplication:{minTokens:50,minLines:5},pmdEnabled:true};
const ESLINT_RULES = {
  'no-unreachable':'warn', 'no-constant-condition':['warn',{checkLoops:'all'}],
  'no-constant-binary-expression':'warn', 'no-dupe-else-if':'warn', 'no-unsafe-finally':'warn',
  'no-async-promise-executor':'warn', 'require-atomic-updates':'warn',
  '@typescript-eslint/no-non-null-assertion':'warn',
  '@typescript-eslint/no-non-null-asserted-optional-chain':'warn',
};
const POTENTIAL = new Set(['require-atomic-updates','@typescript-eslint/no-non-null-assertion','@typescript-eslint/no-non-null-asserted-optional-chain']);
const PMD_RULES = ['CyclomaticComplexity','BrokenNullCheck','CloseResource','UnconditionalIfStatement'];

/** Trusted installation identity, including actual Java analyzer bytes for cache invalidation. */
export async function qualityToolIdentity() {
  const binary=path.resolve(process.env.REVIEW_ANALYSIS_PMD_BIN||'/opt/pmd/bin/pmd');
  let pmd;
  try {
    await fs.access(binary,constants.X_OK);
    const realpath=await fs.realpath(binary);
    const binaryHash=hash(await fs.readFile(realpath));
    const libraries=path.resolve(path.dirname(realpath),'../lib');
    let names=[];
    try{names=(await fs.readdir(libraries)).filter(name=>name.endsWith('.jar')).sort();}catch(error){if(error.code!=='ENOENT')throw error;}
    const jars=await Promise.all(names.map(async name=>[name,hash(await fs.readFile(path.join(libraries,name)))]));
    pmd={status:'available',path:binary,realpath,binaryHash,distributionHash:hash([binaryHash,jars]),jarCount:jars.length};
  } catch(error) {
    pmd={status:error.code==='ENOENT'?'unavailable':'unreadable',path:binary,reason:error.code||error.message};
  }
  return {eslint:Linter.version,typescriptParser:tsParser.version,typescriptPlugin:tsPlugin.meta?.version,jscpd:'4.0.5',pmd};
}

export function validateQualityConfig(input={}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('quality config must be an object');
  for (const key of Object.keys(input)) if (!(key in DEFAULT)) throw new Error(`Unknown quality config property: ${key}`);
  const duplication={...DEFAULT.duplication,...input.duplication};
  if(input.duplication!==undefined && (!input.duplication||typeof input.duplication!=='object'||Array.isArray(input.duplication)))throw new Error('duplication config must be an object');
  for(const key of Object.keys(duplication))if(!['minTokens','minLines'].includes(key))throw new Error(`Unknown duplication property: ${key}`);
  const config={...DEFAULT,...input,duplication};
  for(const [key,value]of [['complexityThreshold',config.complexityThreshold],['minTokens',duplication.minTokens],['minLines',duplication.minLines]])
    if(!Number.isSafeInteger(value)||value<1||value>100000)throw new Error(`${key} must be an integer between 1 and 100000`);
  if(typeof config.pmdEnabled!=='boolean')throw new Error('pmdEnabled must be boolean');
  return config;
}

/** Match semantic fingerprints, never line numbers. Suppress resolution when a candidate file was not analyzed. */
export function classifyFindings(before,after,{candidateSnapshot,uncovered=[]}={}) {
  const old=new Map();
  for(const finding of before) {
    const bucket=old.get(finding.fingerprint)||[];bucket.push(finding);old.set(finding.fingerprint,bucket);
  }
  const result=[];
  for(const current of after) {
    const previous=old.get(current.fingerprint)?.shift();
    const worsened=previous&&((current.magnitude??0)>(previous.magnitude??0));
    result.push({...current,classification:previous?(worsened?'worsened':'pre-existing'):'new',beforeEvidence:previous?.evidence||null,afterEvidence:current.evidence,...(previous?.magnitude!==undefined?{baselineMagnitude:previous.magnitude}:{})});
  }
  for(const bucket of old.values())for(const previous of bucket) {
    const paths=[previous.evidence?.path,...(previous.relatedEvidence||[]).map(e=>e.path),...(previous.members||[])].filter(Boolean);
    const notCovered=uncovered.some(u=>u.tool===previous.tool&&(!u.path||paths.includes(u.path))&&paths.some(file=>!candidateSnapshot||candidateSnapshot.files[file]));
    result.push({...previous,classification:notCovered?'pre-existing':'resolved',beforeEvidence:previous.evidence,afterEvidence:null,...(notCovered?{candidateUnverified:true}:{}),...(previous.magnitude!==undefined?{baselineMagnitude:previous.magnitude}:{})});
  }
  return result.sort((a,b)=>[a.evidence?.path,a.ruleId,a.fingerprint].join('\0').localeCompare([b.evidence?.path,b.ruleId,b.fingerprint].join('\0')));
}

function safeSourcePath(name) {
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||path.posix.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`Unsafe snapshot source path: ${name}`);
  return name;
}

async function materialize(snapshot,base) {
  const root=path.join(base,'sources');await fs.mkdir(root,{recursive:true});
  for(const [file,source]of Object.entries(snapshot.files)) {
    safeSourcePath(file);
    if(!JS.test(file)&&!JAVA.test(file))continue;
    const destination=path.join(root,file);await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,source.text,{flag:'wx'});
  }
  return root;
}

function rangeOf(message) {
  return {startLine:message.line||message.beginline||1,endLine:message.endLine||message.endline||message.line||message.beginline||1,startColumn:message.column||message.begincolumn||1,endColumn:message.endColumn||message.endcolumn||message.column||message.begincolumn||1};
}

function astIdentity(sourceCode,message) {
  const line=message.line||1,column=message.column||1;
  const offset=sourceCode.getIndexFromLoc({line,column:column-1});
  let target,scope;
  function visit(node,ancestors=[]) {
    if(!node||typeof node!=='object'||!node.type||!node.range||offset<node.range[0]||offset>node.range[1])return;
    const complexityScope=message.ruleId==='complexity'&&['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type);
    if(complexityScope||message.ruleId!=='complexity'&&node.range[0]===offset&&(!message.nodeType||node.type===message.nodeType)) {
      if(!target||node.range[1]-node.range[0]<target.range[1]-target.range[0]){target=node;scope=ancestors;}
    }
    for(const [key,value]of Object.entries(node)) {
      if(['parent','tokens','comments','loc','range'].includes(key))continue;
      if(Array.isArray(value))for(const child of value)visit(child,[...ancestors,node]);
      else if(value?.type)visit(value,[...ancestors,node]);
    }
  }
  visit(sourceCode.ast);
  const named=node=>{
    const declared=node.id?.name||node.key?.name||node.key?.value||node.name;
    if(declared)return declared;
    if(node.parent?.type==='VariableDeclarator')return sourceCode.getText(node.parent.id);
    if(/Function/.test(node.type)&&node.parent?.type==='CallExpression') {
      const call=node.parent;
      return `<callback:${sourceCode.getTokens(call.callee).map(t=>t.value).join('')}:${call.arguments.indexOf(node)}:${node.params?.map(p=>sourceCode.getText(p)).join(',')||''}>`;
    }
    if(/Function/.test(node.type)&&node.parent?.type==='ExportDefaultDeclaration')return '<default-export>';
    return undefined;
  };
  const containers=[...(scope||[]),target].filter(Boolean).filter(n=>/(?:Function|Method|Class|VariableDeclarator)/.test(n.type)).map(n=>named(n)).filter(Boolean);
  const scopeKey=containers.join('.')||'<module>';
  const tokens=target?sourceCode.getTokens(target).map(t=>t.value).join('\0'):sourceCode.lines[line-1]?.trim();
  return {scopeKey,tokens,nodeType:target?.type||message.nodeType||'unknown'};
}

function eslintSnapshot(snapshot,config) {
  const linter=new Linter();const findings=[],unsupported=[],covered=[];
  for(const [file,source]of Object.entries(snapshot.files).sort()) {
    safeSourcePath(file);if(!JS.test(file))continue;
    const messages=linter.verify(source.text,{
      files:['**/*.{ts,tsx,js,jsx}'],
      languageOptions:{parser:tsParser,ecmaVersion:'latest',sourceType:'module',parserOptions:{project:false,projectService:false,tsconfigRootDir:os.tmpdir(),ecmaFeatures:{jsx:true}}},
      plugins:{'@typescript-eslint':tsPlugin},
      linterOptions:{noInlineConfig:true,reportUnusedDisableDirectives:'off'},
      rules:{...ESLINT_RULES,complexity:['warn',{max:config.complexityThreshold,variant:'classic'}]},
    },{filename:file,allowInlineConfig:false});
    if(messages.some(m=>m.fatal)) {
      for(const m of messages.filter(m=>m.fatal))unsupported.push({tool:'eslint',path:file,reason:'parse-error',detail:m.message,evidence:evidence(snapshot,file,rangeOf(m))});
      continue;
    }
    covered.push(file);
    const sourceCode=linter.getSourceCode();
    for(const message of messages) {
      if(!message.ruleId){unsupported.push({tool:'eslint',path:file,reason:'configuration-diagnostic',detail:message.message});continue;}
      const identity=astIdentity(sourceCode,message);
      const magnitude=message.ruleId==='complexity'?Number(message.message.match(/complexity of (\d+)/)?.[1]):undefined;
      const stable=message.ruleId==='complexity'?identity.scopeKey:[identity.scopeKey,identity.nodeType,identity.tokens];
      findings.push({tool:'eslint',ruleId:message.ruleId,basis:'analyzer',severity:'warning',certainty:POTENTIAL.has(message.ruleId)?'potential':'evidenced',message:message.message,evidence:evidence(snapshot,file,rangeOf(message)),fingerprint:hash(['eslint',message.ruleId,file,stable]),...(Number.isFinite(magnitude)?{magnitude,threshold:config.complexityThreshold}:{}),scope:identity.scopeKey});
    }
  }
  return {findings,unsupported,covered};
}

function pmdRules(config) {
  return `<?xml version="1.0"?>\n<ruleset name="Trusted Review Analysis" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">\n<description>Source-only selected quality checks. No examined repository rules are loaded.</description>\n<rule ref="category/java/design.xml/CyclomaticComplexity"><properties><property name="methodReportLevel" value="${config.complexityThreshold+1}"/><property name="classReportLevel" value="80"/></properties></rule>\n${PMD_RULES.slice(1).map(rule=>`<rule ref="category/java/errorprone.xml/${rule}"/>`).join('\n')}\n</ruleset>\n`;
}

function javaScope(snapshot,file,range) {
  const parsed=parseJava(file,snapshot.files[file].text);
  const scopes=parsed.declarations.filter(d=>['method','constructor','class','interface','record','enum'].includes(d.kind)&&d.range.startLine<=range.startLine&&d.range.endLine>=range.startLine);
  return scopes.sort((a,b)=>(a.range.endLine-a.range.startLine)-(b.range.endLine-b.range.startLine))[0]?.key||'<module>';
}

async function pmdSnapshot(snapshot,config,temp,sourceRoot) {
  const files=Object.keys(snapshot.files).filter(file=>JAVA.test(file));
  if(!files.length)return {findings:[],unsupported:[],covered:[],version:null};
  if(!config.pmdEnabled)return {findings:[],unsupported:files.map(file=>({tool:'pmd',path:file,reason:'disabled',detail:'Java PMD checks explicitly disabled'})),covered:[],version:null};
  const binary=process.env.REVIEW_ANALYSIS_PMD_BIN||'/opt/pmd/bin/pmd';
  const ruleFile=path.join(temp,'rules.xml'),output=path.join(temp,'pmd.json');
  await fs.writeFile(ruleFile,pmdRules(config));
  const args=['check','--dir',sourceRoot,'--rulesets',ruleFile,'--format','json','--report-file',output,'--no-cache','--no-progress','--use-version','java-21','--suppress-marker','__REVIEW_ANALYSIS_'+hash(temp)];
  let execution;
  try {execution=await runFile(binary,args,{cwd:temp,timeout:60000,maxBuffer:8*1024*1024,env:{...process.env,CLASSPATH:'',PMD_JAVA_OPTS:'',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:''}});}
  catch(error) {
    // Exit 4 reports violations; exit 5 can still carry usable results and per-file processing gaps.
    if(![4,5].includes(error.code))return {findings:[],covered:[],version:null,unsupported:files.map(file=>({tool:'pmd',path:file,reason:error.code==='ENOENT'?'tool-unavailable':'tool-failure',detail:String(error.stderr||error.message).slice(0,2000)}))};
    execution=error;
  }
  let report;
  try{report=JSON.parse(await fs.readFile(output,'utf8'));}catch(error){return {findings:[],covered:[],version:null,unsupported:files.map(file=>({tool:'pmd',path:file,reason:'invalid-tool-report',detail:error.message}))};}
  const findings=[],unsupported=[];
  const local=filename=>path.relative(sourceRoot,filename).split(path.sep).join('/');
  for(const error of report.processingErrors||[]) {
    const file=local(error.filename);unsupported.push({tool:'pmd',path:snapshot.files[file]?file:undefined,reason:'parse-or-processing-error',detail:error.message||error.msg||'PMD could not analyze the supplied source'});
  }
  for(const error of report.configurationErrors||[])unsupported.push({tool:'pmd',reason:'configuration-error',detail:error.issue||error.message||String(error)});
  for(const item of report.files||[]) {
    const file=local(item.filename);if(!snapshot.files[file])continue;
    for(const violation of item.violations||[]) {
      const range=rangeOf(violation),scope=javaScope(snapshot,file,range),ruleId=violation.rule;
      const magnitude=ruleId==='CyclomaticComplexity'?Number(violation.description.match(/(?:complexity of|complexity is)\s*(\d+)/i)?.[1]):undefined;
      const content=evidence(snapshot,file,range).excerpt.replace(/\s+/g,' ').trim();
      findings.push({tool:'pmd',ruleId,basis:'analyzer',severity:violation.priority<=2?'error':'warning',certainty:['CloseResource','BrokenNullCheck'].includes(ruleId)?'potential':'evidenced',message:violation.description,evidence:evidence(snapshot,file,range),scope,fingerprint:hash(['pmd',ruleId,file,scope,ruleId==='CyclomaticComplexity'?'metric':content]),...(Number.isFinite(magnitude)?{magnitude,threshold:scope.includes('#')?config.complexityThreshold:79}:{}),...(violation.externalInfoUrl?{documentation:violation.externalInfoUrl}:{})});
    }
  }
  // An annotation can suppress PMD internally. Keep that coverage limitation explicit.
  for(const file of files)if(/@SuppressWarnings\s*\(/.test(snapshot.files[file].text))unsupported.push({tool:'pmd',path:file,reason:'source-suppression-annotation',detail:'PMD honors @SuppressWarnings annotations; potentially suppressed checks remain uncovered'});
  const blocked=new Set(unsupported.filter(u=>u.reason!=='source-suppression-annotation').map(u=>u.path));
  return {findings,unsupported,covered:files.filter(file=>!blocked.has(file)&&!blocked.has(undefined)),version:report.pmdVersion||'7.17.0',diagnostic:execution.stderr?.slice(0,2000)};
}

async function duplicationSnapshot(snapshot,config,temp,sourceRoot) {
  const files=Object.keys(snapshot.files).filter(file=>JS.test(file)||JAVA.test(file));
  if(!files.length)return {findings:[],unsupported:[],covered:[],statistics:null};
  const oversized=files.filter(file=>Buffer.byteLength(snapshot.files[file].text)>128*1024*1024||snapshot.files[file].text.split('\n').length>1000000);
  const sizeLimit=oversized.map(file=>({tool:'jscpd',path:file,reason:'analyzer-size-limit',detail:'Duplication engine limit is 128 MiB or 1,000,000 lines per source file'}));
  const eligible=files.filter(file=>!oversized.includes(file)&&snapshot.files[file].text.split('\n').length>=config.duplication.minLines);
  if(!eligible.length)return {findings:[],unsupported:sizeLimit,covered:files.filter(file=>!oversized.includes(file)),statistics:{clones:0,duplicatedLines:0,duplicatedTokens:0}};
  const output=path.join(temp,'clones');
  const configFile=path.join(temp,'jscpd.json');
  const trusted={path:[sourceRoot],minTokens:config.duplication.minTokens,minLines:config.duplication.minLines,maxLines:1000000,maxSize:'128mb',mode:'strict',reporters:['json'],output,format:['typescript','tsx','javascript','jsx','java'],silent:true,gitignore:false,ignore:[],absolute:true,ignoreCase:false,skipLocal:false,noSymlinks:true};
  await fs.writeFile(configFile,JSON.stringify(trusted));
  let binary;
  try {binary=path.join(path.dirname(require.resolve('jscpd')),'../bin/jscpd');await runFile(process.execPath,[binary,'--config',configFile,sourceRoot],{cwd:temp,timeout:60000,maxBuffer:8*1024*1024});}
  catch(error){return {findings:[],covered:[],statistics:null,unsupported:files.map(file=>({tool:'jscpd',path:file,reason:'tool-failure',detail:String(error.stderr||error.message).slice(0,2000)}))};}
  let report;
  try{report=JSON.parse(await fs.readFile(path.join(output,'jscpd-report.json'),'utf8'));}catch(error){return {findings:[],covered:[],statistics:null,unsupported:files.map(file=>({tool:'jscpd',path:file,reason:'invalid-tool-report',detail:error.message}))};}
  const findings=[];
  for(const clone of report.duplicates||[]) {
    const occurrences=[clone.firstFile,clone.secondFile].map(part=>({path:path.relative(sourceRoot,part.name).split(path.sep).join('/'),range:{startLine:part.start,endLine:part.end}}));
    if(occurrences.some(part=>!snapshot.files[part.path]))continue;
    occurrences.sort((a,b)=>a.path.localeCompare(b.path)||a.range.startLine-b.range.startLine);
    const ev=occurrences.map(part=>evidence(snapshot,part.path,part.range));
    const fingerprint=hash(['jscpd','duplicate-block',clone.format,occurrences.map(part=>part.path),String(clone.fragment||ev[0].excerpt).replace(/\s+/g,' ').trim()]);
    findings.push({tool:'jscpd',ruleId:'duplicate-block',basis:'analyzer',severity:'warning',certainty:'evidenced',message:`Token clone detected across ${occurrences[0].path} and ${occurrences[1].path} (${clone.lines} lines, ${clone.tokens} tokens)`,evidence:ev[0],relatedEvidence:ev.slice(1),fingerprint,magnitude:clone.tokens,lines:clone.lines,format:clone.format,threshold:config.duplication.minTokens});
  }
  const unsupported=[...sizeLimit,...files.filter(file=>/jscpd:ignore-(?:start|end)/.test(snapshot.files[file].text)).map(file=>({tool:'jscpd',path:file,reason:'source-suppression-marker',detail:'jscpd ignore-block markers may suppress clones in this source'}))];
  return {findings,unsupported,covered:files.filter(file=>!oversized.includes(file)),statistics:report.statistics?.total||report.statistics||null};
}

async function scan(snapshot,config) {
  const eslint=eslintSnapshot(snapshot,config);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'review-analysis-quality-'));
  try {
    const sourceRoot=await materialize(snapshot,temp);
    const pmdTemp=path.join(temp,'pmd'),cloneTemp=path.join(temp,'duplication');
    await Promise.all([fs.mkdir(pmdTemp),fs.mkdir(cloneTemp)]);
    const [pmd,duplication]=await Promise.all([pmdSnapshot(snapshot,config,pmdTemp,sourceRoot),duplicationSnapshot(snapshot,config,cloneTemp,sourceRoot)]);
    return {findings:[...eslint.findings,...pmd.findings,...duplication.findings],unsupported:[...eslint.unsupported,...pmd.unsupported,...duplication.unsupported],counts:{eslint:eslint.covered.length,pmd:pmd.covered.length,jscpd:duplication.covered.length},duplication:duplication.statistics,pmdVersion:pmd.version};
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}

export async function analyzeQuality({baselineSnapshot,candidateSnapshot,config:input={}}) {
  const started=performance.now(),config=validateQualityConfig(input);
  const [before,after]=await Promise.all([scan(baselineSnapshot,config),scan(candidateSnapshot,config)]);
  const unsupported=[...before.unsupported.map(u=>({...u,snapshot:'baseline'})),...after.unsupported.map(u=>({...u,snapshot:'candidate'})),
    {tool:'typescript-eslint',reason:'type-aware-checks-unavailable',detail:'No repository tsconfig, dependencies or compiler project is loaded; no-floating-promises, no-unnecessary-condition and typed null/async rules are not run'},
    {tool:'pmd',reason:'source-only-type-resolution',detail:'JDK types only; external Java dependency types, dispatch and resource ownership contracts are not verified'}];
  return {configHash:hash(config),config,tools:[{name:'eslint',version:Linter.version,parser:'@typescript-eslint/parser@8.71.1',rules:['complexity',...Object.keys(ESLINT_RULES)],sourceOnly:true},{name:'jscpd',version:'4.0.5',rules:['duplicate-block'],sourceOnly:true},{name:'pmd',version:after.pmdVersion||before.pmdVersion||null,status:after.pmdVersion||before.pmdVersion?'available':config.pmdEnabled?'unavailable':'disabled',rules:PMD_RULES,sourceOnly:true}],findings:classifyFindings(before.findings,after.findings,{candidateSnapshot,uncovered:after.unsupported}),unsupported,metrics:{elapsedMs:Math.round((performance.now()-started)*100)/100,analyzedFiles:{baseline:before.counts,candidate:after.counts},duplication:{baseline:before.duplication,candidate:after.duplication}}};
}
