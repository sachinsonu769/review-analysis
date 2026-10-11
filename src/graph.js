import path from 'node:path';
import {evidence} from './snapshot.js';

const posix=path.posix;
export function declarations(snapshot,parsed) {
  return Object.entries(parsed).flatMap(([file,p])=>p.declarations.map(d=>({...d,path:file,language:p.language,evidence:evidence(snapshot,file,d.range)})));
}
function moduleTarget(file,module,files) {
  if (!module?.startsWith('.')) return null;
  const base=posix.normalize(posix.join(posix.dirname(file),module));
  const stem=base.replace(/\.(jsx?|tsx?)$/,'');
  const candidates=[base,...['.ts','.tsx','.js','.jsx'].map(ext=>stem+ext),...['.ts','.tsx','.js','.jsx'].map(ext=>base+'/index'+ext)].filter(p=>files[p]);
  return [...new Set(candidates)];
}
function routeMatches(url,route) {
  if(!url||!route||/\{[^}]+:[^}]+\}/.test(route)) return false;
  const clean=url.split('?')[0];
  if (/^https?:/.test(clean)) return false; // Unknown origins are not equated to local endpoints.
  const pattern=route.split('/').map(segment=>/^\{[^}]+\}$/.test(segment)?'[^/]+':segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
  return new RegExp('^'+pattern+'/?$').test(clean);
}
export function buildGraph(snapshot,parsed) {
  const all=declarations(snapshot,parsed);const edges=[];const unknowns=[];
  const add=(fromPath,target,ref,reason,confidence='high')=>{
    if(!target)return;
    edges.push({kind:ref.kind,fromPath,toPath:target.path,targetKey:target.key,confidence,reason,evidence:evidence(snapshot,fromPath,ref.range),targetEvidence:target.evidence});
  };
  for(const [file,p] of Object.entries(parsed)) {
    for(const ep of p.endpoints||[])if(/\{[^}]+:[^}]+\}/.test(ep.url))unknowns.push({reason:'unsupported-route-constraint',detail:ep.url,evidence:evidence(snapshot,file,ep.range)});
    for(const item of p.unknowns||[]) unknowns.push({...item,evidence:evidence(snapshot,file,item.range)});
    const imports=p.references.filter(r=>r.kind==='import');
    function javaTargets(type) {
      if(!type)return [];
      const stripped=type.replace(/<.*>/g,'').replace(/\[\]/g,'').trim();
      const matchingImports=imports.filter(r=>r.target?.split('.').at(-1)===stripped||r.name?.split('.').at(-1)===stripped);
      if(new Set(matchingImports.map(r=>r.target||r.name)).size>1)return [];
      const imported=matchingImports[0];const qualified=imported?.target||imported?.name;
      const own=all.find(d=>d.path===file&&!d.owner&&['class','interface','record','enum','annotation'].includes(d.kind));
      const pkg=own?.key.includes('.')?own.key.slice(0,own.key.lastIndexOf('.')):'';
      return all.filter(d=>['class','interface','record','enum','annotation'].includes(d.kind)&&(qualified?d.key===qualified:d.key===stripped||d.key===(pkg?pkg+'.':'')+stripped));
    }
    for(const ref of p.references) {
      if(ref.dynamic) {unknowns.push({reason:'dynamic-dependency',detail:'Runtime value prevents a resolved edge',evidence:evidence(snapshot,file,ref.range)});continue;}
      if(ref.kind==='http') {
        const matches=Object.entries(parsed).flatMap(([targetFile,targetP])=>(targetP.endpoints||[]).filter(ep=>(ep.method===ref.method||ep.method==='ANY'||ep.method==='*')&&routeMatches(ref.url,ep.url)).map(ep=>({ep,targetFile})));
        if(matches.length===1) {
          const {ep,targetFile}=matches[0];const target=all.find(d=>d.path===targetFile&&d.key===ep.declarationKey)||{path:targetFile,key:ep.declarationKey,evidence:evidence(snapshot,targetFile,ep.range)};
          add(file,target,ref,'Literal HTTP verb/path matches source Spring mapping; runtime origin/proxy not verified','medium');
        }else unknowns.push({reason:matches.length?'ambiguous-endpoint':'unmatched-endpoint',evidence:evidence(snapshot,file,ref.range),candidates:matches.map(x=>({path:x.targetFile,url:x.ep.url,method:x.ep.method}))});
        continue;
      }
      if(p.language==='typescript'||p.language==='javascript') {
        if(ref.kind==='import') {
          const targets=moduleTarget(file,ref.module||ref.target,snapshot.files);
          if(targets?.length===1) {
            const targetFile=targets[0];const target={path:targetFile,key:null,evidence:evidence(snapshot,targetFile)};
            add(file,target,ref,'Relative import resolves to supplied source file');
          } else if(targets) unknowns.push({reason:targets.length?'ambiguous-import':'missing-source',evidence:evidence(snapshot,file,ref.range),detail:ref.module||ref.target,candidates:targets});
          // Package modules outside supplied sources remain explicitly uncovered.
          else unknowns.push({reason:'external-module',detail:ref.module||ref.target,evidence:evidence(snapshot,file,ref.range)});
        } else if(ref.kind==='call'||ref.kind==='type') {
          if(ref.module) {
            if(ref.unresolvedMember){unknowns.push({reason:'unresolved-imported-member',detail:ref.name,evidence:evidence(snapshot,file,ref.range)});continue;}
            const targets=moduleTarget(file,ref.module,snapshot.files);
            if(targets?.length===1) {
              const candidates=all.filter(d=>d.path===targets[0]&&d.key===(ref.imported||ref.name)&&/^\s*export\s+/.test(d.signature));
              if(candidates.length===1)add(file,candidates[0],ref,'Imported binding resolves to a supplied named declaration');
              else unknowns.push({reason:'unresolved-imported-binding',evidence:evidence(snapshot,file,ref.range),detail:ref.imported||ref.name});
            }
          }else if(ref.target) {
            const candidates=all.filter(d=>d.path===file&&d.key===ref.target);
            if(candidates.length===1)add(file,candidates[0],ref,'Same-file lexical binding');
          } else unknowns.push({reason:'unresolved-call',detail:ref.name,evidence:evidence(snapshot,file,ref.range)});
        }
      } else {
        if(ref.kind==='import'||ref.kind==='type') {
          const targets=javaTargets(ref.target||ref.name);
          if(targets.length===1)add(file,targets[0],ref,'Java qualified import or same-package type resolves to supplied source');
          else if(targets.length>1)unknowns.push({reason:'ambiguous-type',evidence:evidence(snapshot,file,ref.range)});
          else unknowns.push({reason:'external-or-missing-java-source',detail:ref.target||ref.name,evidence:evidence(snapshot,file,ref.range)});
        } else if(ref.kind==='call') {
          let candidates=[];let classes=[];
          if(ref.receiverType) {
            classes=javaTargets(ref.receiverType);
            candidates=all.filter(d=>d.kind==='method'&&classes.some(c=>c.key===d.owner)&&d.name===ref.name&&(ref.arity===undefined||d.arity===ref.arity||d.varargs&&ref.arity>=d.arity-1));
          } else if(ref.target)candidates=all.filter(d=>d.path===file&&d.key===ref.target);
          const inherited=classes.some(c=>/\b(?:extends|implements)\b/.test(c.signature))||candidates.some(d=>all.some(c=>c.key===d.owner&&/\b(?:extends|implements)\b/.test(c.signature)));
          if(inherited){unknowns.push({reason:'java-inheritance-dispatch',detail:ref.name,evidence:evidence(snapshot,file,ref.range),candidates:candidates.map(d=>d.evidence)});continue;}
          if(candidates.some(d=>d.varargs)&&candidates.length===1){unknowns.push({reason:'java-varargs-resolution',detail:ref.name,evidence:evidence(snapshot,file,ref.range),candidates:candidates.map(d=>d.evidence)});continue;}
          if(candidates.length===1)add(file,candidates[0],ref,'Lexical receiver type and unique method name/arity match; no runtime dispatch proof','medium');
          else unknowns.push({reason:candidates.length?'ambiguous-call':'unresolved-call',detail:ref.name,evidence:evidence(snapshot,file,ref.range),candidates:candidates.map(d=>d.evidence)});
        }
      }
    }
  }
  return {edges,unknowns};
}
export function compareDeclarations(before,after) {
  const a=new Map(before.map(d=>[d.path+'::'+d.key,d]));const b=new Map(after.map(d=>[d.path+'::'+d.key,d]));const changes=[];
  const emit=(kind,old,current)=>changes.push({kind,name:(current||old).name,key:(current||old).key,language:(current||old).language,contractChanged:!old||!current||old.signature!==current.signature,before:old?.evidence||null,after:current?.evidence||null});
  for(const [id,old]of a) {
    const current=b.get(id);
    if(current) {if(old.signature!==current.signature||old.body!==current.body)emit('modified',old,current);b.delete(id);}
    else {
      const equivalent=[...b.entries()].filter(([_,d])=>d.key===old.key&&d.signature===old.signature&&d.body===old.body);
      if(equivalent.length===1) {emit('renamed',old,equivalent[0][1]);b.delete(equivalent[0][0]);}
      else emit('deleted',old,null);
    }
  }
  for(const d of b.values())emit('added',null,d);
  return changes;
}
export function impacts(changes,graphs) {
  const changed=new Set(changes.flatMap(c=>[c.before?.path,c.after?.path]).filter(Boolean));
  const direct=graphs.flatMap(g=>g.edges).filter(edge=>changed.has(edge.toPath)&&edge.fromPath!==edge.toPath);
  const seen=new Set();const unique=direct.filter(e=>{const id=JSON.stringify(e);if(seen.has(id))return false;seen.add(id);return true;});
  const indirect=[];const indirectPaths=new Set();
  for(const graph of graphs) {
    const queue=graph.edges.filter(e=>changed.has(e.toPath)&&e.fromPath!==e.toPath).map(e=>({path:e.fromPath,chain:[e],visited:new Set([e.toPath,e.fromPath])}));
    const expanded=new Set();
    while(queue.length) {
      const item=queue.shift();
      if(expanded.has(item.path))continue;expanded.add(item.path);
      for(const edge of graph.edges.filter(e=>e.toPath===item.path&&e.fromPath!==e.toPath)) {
        if(item.visited.has(edge.fromPath))continue;
        const chain=[edge,...item.chain];
        if(!changed.has(edge.fromPath)&&!indirectPaths.has(edge.fromPath)) {
          indirectPaths.add(edge.fromPath);indirect.push({path:edge.fromPath,confidence:'low',reason:'Likely indirect file dependency; inspect whether the changed declaration is used',chain});
        }
        queue.push({path:edge.fromPath,chain,visited:new Set([...item.visited,edge.fromPath])});
      }
    }
  }
  return {direct:unique,indirect};
}
