import path from 'node:path';
import ts from 'typescript';
import {parseJava} from './java.js';
import {parseTypeScript} from './typescript.js';
import {buildGraph} from './graph.js';
import {classifyFindings} from './quality.js';
import {evidence,hash} from './snapshot.js';

const DEFAULT={forbiddenImports:[],maxParameters:5,maxClassMethods:20,checkPublicMutableFields:true,checkModuleCycles:true};
export function validateConventionConfig(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('convention config must be an object');
  for(const key of Object.keys(input))if(!(key in DEFAULT))throw new Error(`Unknown convention config property: ${key}`);
  const config={...DEFAULT,...input};
  for(const key of ['maxParameters','maxClassMethods'])if(!Number.isSafeInteger(config[key])||config[key]<1||config[key]>100000)throw new Error(`${key} must be an integer between 1 and 100000`);
  for(const key of ['checkPublicMutableFields','checkModuleCycles'])if(typeof config[key]!=='boolean')throw new Error(`${key} must be boolean`);
  if(!Array.isArray(config.forbiddenImports))throw new Error('forbiddenImports must be an array');
  const ids=new Set();
  for(const policy of config.forbiddenImports) {
    if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new Error('forbiddenImports entries must be objects');
    for(const key of Object.keys(policy))if(!['id','pathPrefix','importPrefixes','owner','version'].includes(key))throw new Error(`Unknown forbiddenImports property: ${key}`);
    for(const key of ['id','pathPrefix','owner','version'])if(typeof policy[key]!=='string'||!policy[key].trim())throw new Error(`forbiddenImports ${key} is required`);
    if(ids.has(policy.id))throw new Error('forbiddenImports id must be unique');ids.add(policy.id);
    if(policy.pathPrefix.includes('\\')||path.posix.isAbsolute(policy.pathPrefix)||policy.pathPrefix.split('/').some(x=>x==='..'||x==='.'))throw new Error('forbiddenImports pathPrefix must be a relative source directory');
    if(!Array.isArray(policy.importPrefixes)||!policy.importPrefixes.length||policy.importPrefixes.some(x=>typeof x!=='string'||!x.trim()))throw new Error('forbiddenImports importPrefixes must be a nonempty string array');
  }
  return config;
}

function parse(snapshot) {
  return Object.fromEntries(Object.entries(snapshot.files).map(([file,source])=>[file,file.endsWith('.java')?parseJava(file,source.text):parseTypeScript(file,source.text)]));
}

function finding(snapshot,file,ruleId,message,range,stable,{basis='inferred-convention',severity='warning',certainty='potential',...extra}={}) {
  return {tool:'source-design',ruleId,basis,severity,certainty,message,evidence:evidence(snapshot,file,range),fingerprint:hash(['source-design',ruleId,file,stable]),...extra};
}

function importPrefixMatches(module,prefix) {
  // Boundary matching prevents "react" from accidentally covering "reactive".
  if(prefix.endsWith('/')||prefix.endsWith('.'))return module.startsWith(prefix);
  return module===prefix||module.startsWith(prefix+'/')||module.startsWith(prefix+'.');
}
function directoryMatches(file,prefix) {const clean=prefix.replace(/\/+$/,'');return file===clean||file.startsWith(clean+'/');}

function typescriptSignals(snapshot,file,config) {
  const source=ts.createSourceFile(file,snapshot.files[file].text,ts.ScriptTarget.Latest,true,/\.tsx$/.test(file)?ts.ScriptKind.TSX:/\.jsx$/.test(file)?ts.ScriptKind.JSX:/\.js$/.test(file)?ts.ScriptKind.JS:ts.ScriptKind.TS);
  const findings=[];
  const range=node=>({startLine:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,endLine:source.getLineAndCharacterOfPosition(Math.max(node.getStart(source),node.end-1)).line+1});
  const name=node=>node.name?.getText(source)||(ts.isConstructorDeclaration(node)?'constructor':undefined);
  const modifier=(node,kind)=>node.modifiers?.some(m=>m.kind===kind);
  const scope=node=>{const names=[];for(let current=node;current;current=current.parent)if(ts.isClassDeclaration(current)||ts.isClassExpression(current)||ts.isFunctionDeclaration(current)||ts.isMethodDeclaration(current)||ts.isConstructorDeclaration(current)){const label=name(current);if(label)names.unshift(label);}return names.join('.')||'<anonymous>';};
  function visit(node) {
    if((ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isConstructorDeclaration(node))&&node.body&&node.parameters.length>config.maxParameters)
      findings.push(finding(snapshot,file,'parameter-count',`${scope(node)} has ${node.parameters.length} parameters; review the convention limit ${config.maxParameters}`,range(node),scope(node),{magnitude:node.parameters.length,threshold:config.maxParameters}));
    if(ts.isClassDeclaration(node)||ts.isClassExpression(node)) {
      const methods=node.members.filter(m=>ts.isMethodDeclaration(m)&&m.body);
      if(methods.length>config.maxClassMethods)findings.push(finding(snapshot,file,'class-method-count',`${scope(node)} declares ${methods.length} implemented methods; review the convention limit ${config.maxClassMethods}`,range(node),scope(node),{magnitude:methods.length,threshold:config.maxClassMethods}));
      if(config.checkPublicMutableFields) {
        for(const member of node.members.filter(m=>ts.isPropertyDeclaration(m))) {
          const privateName=member.name&&ts.isPrivateIdentifier(member.name);
          if(!privateName&&!modifier(member,ts.SyntaxKind.PrivateKeyword)&&!modifier(member,ts.SyntaxKind.ProtectedKeyword)&&!modifier(member,ts.SyntaxKind.ReadonlyKeyword))
            findings.push(finding(snapshot,file,'public-mutable-field',`${scope(node)}.${name(member)} exposes a writable field; review whether direct mutation is intended`,range(member),scope(node)+'.'+name(member),{severity:'info'}));
        }
        for(const constructor of node.members.filter(ts.isConstructorDeclaration))for(const parameter of constructor.parameters) {
          if(modifier(parameter,ts.SyntaxKind.PublicKeyword)&&!modifier(parameter,ts.SyntaxKind.ReadonlyKeyword))findings.push(finding(snapshot,file,'public-mutable-field',`${scope(node)}.${name(parameter)} exposes a writable constructor field; review whether direct mutation is intended`,range(parameter),scope(node)+'.'+name(parameter),{severity:'info'}));
        }
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);return findings;
}

function cycleSignals(snapshot,graph) {
  // Tarjan SCCs over resolved imports only. Calls/HTTP edges are excluded.
  const edges=(graph.edges||[]).filter(e=>e.kind==='import'&&e.fromPath!==e.toPath&&/\.(?:tsx?|jsx?)$/.test(e.fromPath)&&/\.(?:tsx?|jsx?)$/.test(e.toPath)&&snapshot.files[e.fromPath]&&snapshot.files[e.toPath]);
  const adjacent=new Map();for(const edge of edges){const list=adjacent.get(edge.fromPath)||[];list.push(edge.toPath);adjacent.set(edge.fromPath,list);}
  const indices=new Map(),low=new Map(),stack=[],active=new Set(),groups=[];let index=0;
  function visit(file) {
    indices.set(file,index);low.set(file,index++);stack.push(file);active.add(file);
    for(const target of adjacent.get(file)||[])if(!indices.has(target)){visit(target);low.set(file,Math.min(low.get(file),low.get(target)));}else if(active.has(target))low.set(file,Math.min(low.get(file),indices.get(target)));
    if(low.get(file)===indices.get(file)){const group=[];let member;do{member=stack.pop();active.delete(member);group.push(member);}while(member!==file);if(group.length>1)groups.push(group.sort());}
  }
  for(const file of Object.keys(snapshot.files).sort())if(!indices.has(file))visit(file);
  return groups.map(group=>{
    const supporting=edges.filter(e=>group.includes(e.fromPath)&&group.includes(e.toPath)).sort((a,b)=>[a.fromPath,a.toPath].join('\0').localeCompare([b.fromPath,b.toPath].join('\0')));
    const first=supporting[0];
    return finding(snapshot,first.fromPath,'module-cycle',`Resolved source imports form a cycle among ${group.join(', ')}; review initialization and coupling`,first.evidence?.range||{startLine:1,endLine:1},group,{magnitude:group.length,members:group,relatedEvidence:supporting.slice(1).map(e=>e.evidence).filter(Boolean),edgeEvidence:supporting.map(e=>({fromPath:e.fromPath,toPath:e.toPath,evidence:e.evidence})),limitations:'Source import cycle does not prove a runtime initialization fault or a SOLID violation'});
  });
}

function scan(snapshot,parsed,graph,config) {
  const findings=[],unsupported=[];
  for(const [file,item]of Object.entries(parsed)) {
    if(item.unknowns?.some(u=>/parse.*(?:error|diagnostic)|(?:error|diagnostic).*parse/i.test(u.reason))) {unsupported.push({tool:'source-design',path:file,reason:'parse-error',detail:'Design checks are unavailable for source that could not be parsed'});continue;}
    for(const policy of config.forbiddenImports.filter(p=>directoryMatches(file,p.pathPrefix)))for(const ref of item.references.filter(r=>r.kind==='import')) {
      const module=ref.module||ref.target||ref.name;
      if(typeof module==='string'&&policy.importPrefixes.some(prefix=>importPrefixMatches(module,prefix)))findings.push(finding(snapshot,file,'forbidden-import',`Configured boundary ${policy.id} forbids ${module} in ${policy.pathPrefix}`,ref.range,[policy.id,module],{basis:'configured-policy',certainty:'evidenced',governance:{id:policy.id,owner:policy.owner,version:policy.version},import:module,policyHash:hash(policy)}));
    }
    if(item.language==='java') {
      for(const declaration of item.declarations.filter(d=>['method','constructor'].includes(d.kind)&&d.arity>config.maxParameters)) {
        const named=declaration.key.replace(/\/\d+$/,'');
        const overloaded=item.declarations.filter(d=>['method','constructor'].includes(d.kind)&&d.key.replace(/\/\d+$/,'')===named).length>1;
        findings.push(finding(snapshot,file,'parameter-count',`${declaration.key} has ${declaration.arity} parameters; review the convention limit ${config.maxParameters}`,declaration.range,overloaded?declaration.key:named,{magnitude:declaration.arity,threshold:config.maxParameters}));
      }
      for(const cls of item.declarations.filter(d=>['class','record','enum'].includes(d.kind))) {
        const methods=item.declarations.filter(d=>d.owner===cls.key&&d.kind==='method');
        if(methods.length>config.maxClassMethods)findings.push(finding(snapshot,file,'class-method-count',`${cls.key} declares ${methods.length} methods; review the convention limit ${config.maxClassMethods}`,cls.range,cls.key,{magnitude:methods.length,threshold:config.maxClassMethods}));
      }
      if(config.checkPublicMutableFields)for(const field of item.declarations.filter(d=>d.kind==='field'&&/\bpublic\b/.test(d.signature)&&!/\bfinal\b/.test(d.signature)))findings.push(finding(snapshot,file,'public-mutable-field',`${field.key} exposes a writable field; review whether direct mutation is intended`,field.range,field.key,{severity:'info'}));
    } else findings.push(...typescriptSignals(snapshot,file,config));
  }
  if(config.checkModuleCycles)findings.push(...cycleSignals(snapshot,graph));
  return {findings,unsupported};
}

export function analyzeConventions({baselineSnapshot,candidateSnapshot,config:input={},baselineParsed,candidateParsed,baselineGraph,candidateGraph,graph}) {
  const config=validateConventionConfig(input);
  const beforeParsed=baselineParsed||parse(baselineSnapshot),afterParsed=candidateParsed||parse(candidateSnapshot);
  const beforeGraph=baselineGraph||graph?.baseline||buildGraph(baselineSnapshot,beforeParsed),afterGraph=candidateGraph||graph?.candidate||buildGraph(candidateSnapshot,afterParsed);
  const before=scan(baselineSnapshot,beforeParsed,beforeGraph,config),after=scan(candidateSnapshot,afterParsed,afterGraph,config);
  return {configHash:hash(config),config,tools:[{name:'source-design',version:'1.0',rules:['forbidden-import','parameter-count','class-method-count','public-mutable-field','module-cycle'],sourceOnly:true}],findings:classifyFindings(before.findings,after.findings,{candidateSnapshot,uncovered:after.unsupported}),unsupported:[...before.unsupported.map(u=>({...u,snapshot:'baseline'})),...after.unsupported.map(u=>({...u,snapshot:'candidate'})),{tool:'source-design',reason:'bounded-design-coverage',detail:'Selected import boundaries and declaration conventions only; no universal SRP/OCP/LSP/ISP/DIP judgment, runtime DI resolution, inheritance substitutability or behavioral proof'}],metrics:{configuredPolicies:config.forbiddenImports.length,baselineFindings:before.findings.length,candidateFindings:after.findings.length}};
}
