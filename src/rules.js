import {evidence,hash} from './snapshot.js';
const levels={info:0,warning:1,error:2};
export function validateRules(config) {
  if(!config||typeof config.version!=='string'||!Array.isArray(config.rules))throw new Error('Rules require version and rules array');
  const ids=new Set();
  for(const rule of config.rules) {
    if(!rule.id||ids.has(rule.id)||!rule.owner)throw new Error('Each rule requires unique id and owner');ids.add(rule.id);
    if(!['forbidden-import','endpoint-contract-change'].includes(rule.kind))throw new Error('Unsupported rule kind: '+rule.kind);
    if(rule.severity&&!Object.hasOwn(levels,rule.severity))throw new Error('Unsupported severity');
    for(const field of ['from','target'])if(rule[field]!==undefined)new RegExp(rule[field]);
    if(rule.kind==='forbidden-import'&&!rule.target)throw new Error('forbidden-import requires target expression');
  }
  return config;
}
export function validateDate(date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('asOf must be a valid YYYY-MM-DD date');
}
function exceptionFor(rule,file,asOf) {
  const exception=(rule.exceptions||[]).find(ex=>ex.path===file);
  if(!exception)return {status:'none'};
  const approval=exception.approval||{};
  let status='unreviewed';
  if(approval.status==='reviewed'&&approval.reviewer&&approval.evidence&&exception.expires) {
    try {validateDate(exception.expires);status=exception.expires<asOf?'expired':approval.simulation?'simulation-active':'asserted-active';}catch{status='invalid-expiry';}
  }
  return {status,expires:exception.expires||null,approval,approvalVerification:'User-supplied assertion; human identity and review authenticity are not independently verified'};
}
function importFindings(snapshot,parsed,config,asOf) {
  const findings=[];
  for(const rule of config.rules.filter(r=>r.kind==='forbidden-import')) {
    const from=new RegExp(rule.from||'.*');const target=new RegExp(rule.target);
    for(const [file,p]of Object.entries(parsed))if(from.test(file))for(const ref of p.references.filter(r=>r.kind==='import')) {
      const name=ref.module||ref.target||ref.name||'';
      if(target.test(name))findings.push({ruleId:rule.id,kind:rule.kind,owner:rule.owner,ruleVersion:rule.version||config.version,severity:rule.severity||'warning',message:'Import violates configured architecture boundary: '+name,evidence:evidence(snapshot,file,ref.range),exception:exceptionFor(rule,file,asOf),fingerprint:hash([rule.id,file,name])});
    }
  }
  const unique=new Map();
  for(const finding of findings) {
    const previous=unique.get(finding.fingerprint);
    if(previous)(previous.additionalEvidence ||= []).push(finding.evidence);
    else unique.set(finding.fingerprint,finding);
  }
  return [...unique.values()];
}
export function evaluateRules(before,after,parsedBefore,parsedAfter,config,baselineRules,asOf) {
  const old=importFindings(before,parsedBefore,config,asOf);const previousPolicy=new Map(importFindings(before,parsedBefore,baselineRules||config,asOf).map(f=>[f.fingerprint,f]));const current=importFindings(after,parsedAfter,config,asOf);
  const oldBy=new Map(old.map(f=>[f.fingerprint,f]));const findings=[];
  for(const f of current) {
    const previous=oldBy.get(f.fingerprint);
    const priorPolicy=previousPolicy.get(f.fingerprint);
    f.classification=!previous?'new':priorPolicy&&levels[f.severity]>levels[priorPolicy.severity]?'worsened':'pre-existing';
    f.changeCause=!previous?'source':f.classification==='worsened'?'rule-policy':'none';
    f.newlyApplicableRule=Boolean(previous&&!priorPolicy);
    f.advisory=true;f.suppressed=['asserted-active','simulation-active'].includes(f.exception.status);
    if(previous) {f.baselineEvidence=previous.evidence;oldBy.delete(f.fingerprint);}
    findings.push(f);
  }
  for(const f of oldBy.values())findings.push({...f,classification:'resolved',advisory:true,suppressed:false});
  for(const rule of config.rules.filter(r=>r.kind==='endpoint-contract-change')) {
    const oldEndpoints=Object.entries(parsedBefore).flatMap(([file,p])=>(p.endpoints||[]).map(e=>({...e,path:file})));
    const newEndpoints=Object.entries(parsedAfter).flatMap(([file,p])=>(p.endpoints||[]).map(e=>({...e,path:file})));
    for(const ep of oldEndpoints) {
      const matches=newEndpoints.filter(n=>n.path===ep.path&&n.declarationKey===ep.declarationKey);
      if((!rule.from||new RegExp(rule.from).test(ep.path))&&!matches.some(n=>n.url===ep.url&&n.method===ep.method))findings.push({ruleId:rule.id,kind:rule.kind,owner:rule.owner,ruleVersion:rule.version||config.version,severity:rule.severity||'warning',classification:'new',message:`Removed or changed HTTP contract: ${ep.method} ${ep.url}`,evidence:evidence(before,ep.path,ep.range),candidateEvidence:matches.map(n=>evidence(after,n.path,n.range)),exception:exceptionFor(rule,ep.path,asOf),advisory:true,suppressed:['asserted-active','simulation-active'].includes(exceptionFor(rule,ep.path,asOf).status)});
    }
  }
  return findings;
}
export function guidance(snapshot,config,{task='Review changed source contracts',paths=[],asOf=new Date().toISOString().slice(0,10)}={}) {
  validateDate(asOf);
  const files=paths.length?paths:Object.keys(snapshot.files);
  return {task,ruleSetVersion:config.version,approvalGap:'No human approval is inferred. Reviewed examples/exceptions are assertions from supplied configuration; simulation records are demonstrations only.',rules:config.rules.filter(r=>!r.from||files.some(f=>new RegExp(r.from).test(f))).map(r=>({id:r.id,kind:r.kind,owner:r.owner,version:r.version||config.version,severity:r.severity||'warning',instruction:r.description||r.kind,examples:(r.examples||[]).map(ex=>{
    const source=snapshot.files[ex.path]; const range=ex.range||{startLine:1,endLine:source?.text.split(/\r?\n/).length||1};
    const matchesHash=!ex.fileHash||ex.fileHash===source?.hash;
    const matchesRevision=!ex.revision||ex.revision===snapshot.revision;
    const approval=ex.approval||{status:'proposed'};
    const reviewed=approval.status==='reviewed'&&approval.reviewer&&approval.evidence;
    const validRange=Number.isInteger(range.startLine)&&Number.isInteger(range.endLine)&&range.startLine>=1&&range.endLine>=range.startLine&&range.endLine<=(source?.text.split(/\r?\n/).length||0);
    let expiry='not-specified';
    if(ex.expires) {try{validateDate(ex.expires);expiry=ex.expires<asOf?'expired':'active';}catch{expiry='invalid-expiry';}}
    const status=!source?'missing-source':!validRange?'invalid-source-range':!matchesHash||!matchesRevision?'stale-source':expiry==='expired'?'expired-example':expiry==='invalid-expiry'?'invalid-example-expiry':reviewed?approval.simulation?'simulated-reviewed':ex.fileHash&&ex.revision?'asserted-reviewed':'asserted-reviewed-unpinned':'unreviewed';
    return {path:ex.path,status,approval,expiry,expires:ex.expires||null,asOf,evidence:source&&validRange?evidence(snapshot,ex.path,range):null};
  })}))};
}
