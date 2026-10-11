import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const supported = /\.(java|tsx?|jsx?)$/;
const ignored = new Set(['.git', 'node_modules', 'target', 'build', 'dist', '.cache']);
export function git(root, ...args) {
  return execFileSync('git', ['-c','safe.directory='+fs.realpathSync(root),'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false','-C', root, ...args], {encoding:'utf8',maxBuffer:64*1024*1024, env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'',GIT_NO_REPLACE_OBJECTS:'1'}});
}
export function assertOutside(destination, roots) {
  if (!destination) return;
  if (destination.split(/[\\/]/).includes('..')) throw new Error('Output/cache destination cannot contain parent traversal');
  function resolveDestination(value, seen=new Set()) {
    const absolute=path.resolve(value);
    if(seen.has(absolute)||seen.size>40)throw new Error('Output/cache symlink loop');seen.add(absolute);
    let ancestor=absolute;let stat;
    while(!stat) {
      try {stat=fs.lstatSync(ancestor);}catch(error){if(error.code!=='ENOENT')throw error;ancestor=path.dirname(ancestor);}
    }
    if(stat.isSymbolicLink()) {
      const target=path.resolve(path.dirname(ancestor),fs.readlinkSync(ancestor));
      return resolveDestination(path.join(target,path.relative(ancestor,absolute)),seen);
    }
    return path.join(fs.realpathSync(ancestor),path.relative(ancestor,absolute));
  }
  const real=resolveDestination(destination);
  for (const root of roots) {
    const realRoot=fs.realpathSync(root);
    const rel=path.relative(realRoot,real);
    if (!rel || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel))) throw new Error('Output/cache must be outside the analyzed repository: '+root);
  }
  return real;
}
export function readSnapshot(spec) {
  const root=fs.realpathSync(spec.root);
  const files={}; const excluded=[]; let revision; let dirty=false;
  if (spec.type==='git') {
    revision=git(root,'rev-parse','--verify','--end-of-options',`${spec.revision}^{commit}`).trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Cannot resolve exact commit');
    const entries=git(root,'ls-tree','-r','-z',revision).split('\0').filter(Boolean);
    for (const entry of entries) {
      const tab=entry.indexOf('\t'); const [mode,type,oid]=entry.slice(0,tab).split(' '); const name=entry.slice(tab+1);
      if (mode==='120000'||type!=='blob') {excluded.push({path:name,reason:'symlink or submodule'});continue;}
      if(name.split('/').slice(0,-1).some(part=>ignored.has(part))) {excluded.push({path:name,reason:'generated/vendor directory'});continue;}
      if (!supported.test(name)) {excluded.push({path:name,reason:'unsupported extension'});continue;}
      const text=git(root,'show',`${revision}:${name}`);
      files[name]={text,hash:hash(text)};
    }
  } else if (spec.type==='directory'||spec.type==='worktree') {
    function walk(dir) {
      for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
        const full=path.join(dir,entry.name); const name=path.relative(root,full).split(path.sep).join('/');
        if (entry.isSymbolicLink()) {excluded.push({path:name,reason:'symlink not followed'});continue;}
        if (entry.isDirectory()) {if (!ignored.has(entry.name)) walk(full);else excluded.push({path:name,reason:'generated/vendor directory'});}
        else if (entry.isFile()&&supported.test(name)) {const text=fs.readFileSync(full,'utf8');files[name]={text,hash:hash(text)};}
        else if(entry.isFile())excluded.push({path:name,reason:'unsupported extension'});
      }
    }
    walk(root);
    if (spec.type==='worktree') {
      const head=git(root,'rev-parse','HEAD').trim();
      dirty=Boolean(git(root,'status','--porcelain=v1','--untracked-files=all').trim());
      revision=`worktree:${head}:${hash(Object.entries(files).map(([p,f])=>[p,f.hash])).slice(0,16)}`;
    }
  } else throw new Error('Snapshot type must be directory, git or worktree');
  const contentHash=hash(Object.entries(files).sort().map(([p,f])=>[p,f.hash]));
  revision ||= `tree-sha256:${contentHash}`;
  return {root,type:spec.type,revision,dirty,contentHash,files,excluded};
}
export function evidence(snapshot,file,range={startLine:1,endLine:1}) {
  const source=snapshot.files[file];
  if (!source) return null;
  return {path:file,range,revision:snapshot.revision,fileHash:source.hash,excerpt:source.text.split(/\r?\n/).slice(range.startLine-1,range.endLine).join('\n')};
}
