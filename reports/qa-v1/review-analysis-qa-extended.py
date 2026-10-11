import subprocess, json, datetime, time, pathlib, hashlib, shutil, tempfile, os
ROOT=pathlib.Path('/tmp/review-analysis-qa-v1-nn0cdauu');E=pathlib.Path('/workspace/review-analysis-deliverables/qa-v1')
CLI=['node',str(ROOT/'src/cli.js')]; RESULTS=[]
TEMP=pathlib.Path(tempfile.mkdtemp(prefix='review-analysis-qa-integration-')); REPO=TEMP/'repo'; CACHE=TEMP/'cache'
RULES=ROOT/'fixtures/rules.json'; B=ROOT/'fixtures/lookup/baseline'; C=ROOT/'fixtures/lookup/candidate'
def run(name,argv,cwd=ROOT,expected=0):
 started=datetime.datetime.now(datetime.timezone.utc).isoformat(); t=time.monotonic();p=subprocess.run([str(a) for a in argv],cwd=cwd,text=True,capture_output=True,env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'})
 (E/(name+'.stdout.log')).write_text(p.stdout);(E/(name+'.stderr.log')).write_text(p.stderr)
 row={'name':name,'argv':[str(a) for a in argv],'cwd':str(cwd),'startedUtc':started,'durationSeconds':round(time.monotonic()-t,3),'exitCode':p.returncode,'expectedExitCode':expected,'status':'pass' if p.returncode==expected else 'fail'}
 with (E/'commands.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
 RESULTS.append(row); print(name,row['status'],p.returncode,flush=True);return p
def check(name,condition,detail=None):
 row={'name':name,'status':'pass' if condition else 'fail','detail':detail}; RESULTS.append(row);print(name,row['status'],flush=True)
def git(*a):return subprocess.check_output(['git','-C',str(REPO),*a],text=True,env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'}).strip()
def inventory(root):return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
def report(name,args):
 p=run(name,CLI+args)
 if p.returncode:return {}
 r=json.loads(p.stdout);(E/(name+'.json')).write_text(p.stdout);return r
def evidence_check(name,r,roots):
 issues=[];count=0
 def walk(v,loc=''):
  nonlocal count
  if isinstance(v,list):
   for i,x in enumerate(v):walk(x,loc+f'/{i}')
  if isinstance(v,dict):
   if all(k in v for k in ['path','range','revision','fileHash','excerpt']):
    count+=1;root=roots.get(v['revision']);f=root/v['path'] if root else None
    if not f or not f.exists():issues.append({'location':loc,'reason':'missing evidence path/revision'})
    else:
     txt=f.read_text();lines=txt.split('\n');s,t=v['range']['startLine'],v['range']['endLine']
     if not 1<=s<=t<=len(lines):issues.append({'location':loc,'reason':'range'})
     if hashlib.sha256(f.read_bytes()).hexdigest()!=v['fileHash']:issues.append({'location':loc,'reason':'hash'})
     if '\n'.join(lines[s-1:t])!=v['excerpt']:issues.append({'location':loc,'reason':'excerpt'})
   for k,x in v.items():walk(x,loc+'/'+k)
 walk(r);check(name,not issues,{'evidenceCount':count,'issues':issues})

shutil.copytree(B,REPO)
for name,args in [('git-init',['init','-q']),('git-config-name',['config','user.name','Independent synthetic QA']),('git-config-email',['config','user.email','qa@example.invalid']),('git-add-baseline',['add','.']),('git-commit-baseline',['commit','-qm','Independent QA baseline'])]:run(name,['git','-C',REPO]+args)
base=git('rev-parse','HEAD')
for child in REPO.iterdir():
 if child.name!='.git':shutil.rmtree(child) if child.is_dir() else child.unlink()
for child in C.iterdir():shutil.copytree(child,REPO/child.name) if child.is_dir() else shutil.copy2(child,REPO/child.name)
run('git-add-candidate',['git','-C',REPO,'add','.']);run('git-commit-candidate',['git','-C',REPO,'commit','-qm','Independent QA candidate'])
head=git('rev-parse','HEAD');before=inventory(REPO)
args=['analyze','--repo',str(REPO),'--base',base,'--head',head,'--rules',str(RULES),'--as-of','2026-10-11','--cache',str(CACHE)]
cold=report('git-cold',args);warm=report('git-warm',args)
check('git-exact-revisions',cold['provenance']['baseline']['revision']==base and cold['provenance']['candidate']['revision']==head,{'base':base,'head':head})
check('git-cache-cold-warm',cold['cache']['report']=='miss' and warm['cache']['report']=='hit',{'cold':cold['cache'],'warm':warm['cache']})
evidence_check('git-evidence',cold,{base:B,head:C});check('git-read-only',before==inventory(REPO))

# Stale report/rules/date/task and parser identity, preserving source files.
cachefile=CACHE/(cold['provenance']['cacheKey']+'.json');cachefile.write_text(json.dumps({'key':cold['provenance']['cacheKey'],'digest':'invalid stale payload','value':{'changes':[]}}))
corrupt=report('git-cache-corrupt',args);check('cache-corruption-recomputed',corrupt['cache']['report']=='miss' and corrupt['cache']['invalidEntries']==1 and corrupt['changes']==cold['changes'],corrupt['cache'])
newrules=json.loads(RULES.read_text());newrules['version']='independent-qa-policy-v2';rp=TEMP/'rules-v2.json';rp.write_text(json.dumps(newrules))
for name,key,value in [('rules-change','--rules',str(rp)),('date-change','--as-of','2027-01-01')]:
 altered=args.copy();altered[altered.index(key)+1]=value;r=report('cache-'+name,altered)
 check('cache-'+name+'-miss',r['cache']['report']=='miss' and r['provenance']['cacheKey']!=cold['provenance']['cacheKey'],r['cache'])
task=report('cache-task-change',args+['--task','Independent changed task']);check('cache-task-change-miss',task['cache']['report']=='miss' and task['provenance']['cacheKey']!=cold['provenance']['cacheKey'],task['cache'])

# Dirty worktree repeats bypass the report but may reuse unchanged parse entries.
service=REPO/'backend/src/main/java/com/example/lookup/LookupService.java';service.write_text(service.read_text().replace('return new LookupResponse(', 'return new LookupResponse(')+'\n// Independent QA dirty source\n')
(REPO/'untracked.ts').write_text('export const independentUntracked = 7;\n')
dirtyBefore=inventory(REPO);status=git('status','--porcelain');dirtyargs=args.copy();dirtyargs[dirtyargs.index('--head')+1]='worktree'
d1=report('dirty-first',dirtyargs);d2=report('dirty-repeat',dirtyargs)
check('dirty-bypass-repeated',d1['cache']['report']=='bypass-dirty' and d2['cache']['report']=='bypass-dirty' and d1['provenance']['candidate']['dirty'],{'first':d1['cache'],'repeat':d2['cache']})
check('dirty-source-content-visible',any(c.get('after',{}).get('path')=='untracked.ts' for c in d1['changes'] if c.get('after')))
evidence_check('dirty-evidence',d1,{base:B,d1['provenance']['candidate']['revision']:REPO})
check('dirty-read-only',dirtyBefore==inventory(REPO) and git('status','--porcelain')==status and git('rev-parse','HEAD')==head)

# Destination boundary negatives, symlink destinations, traversal, and allowed sibling prefix.
dest=TEMP/'dest';dest.mkdir();alias=dest/'alias';alias.symlink_to(REPO,target_is_directory=True)
dangling=dest/'dangling-report';dangling.symlink_to(REPO/'new-report.json')
danglingcache=dest/'dangling-cache';danglingcache.symlink_to(REPO/'new-cache',target_is_directory=True)
cases=[('out-inside','--out',REPO/'report.json'),('cache-inside','--cache',REPO/'cache'),('out-symlink','--out',alias/'report.json'),('cache-symlink','--cache',alias/'cache'),('out-dangling-symlink','--out',dangling),('cache-dangling-symlink','--cache',danglingcache),('out-parent-traversal','--out',str(dest/'nest'/'..'/'report.json'))]
for name,key,val in cases:
 altered=dirtyargs.copy()
 if key in altered:altered[altered.index(key)+1]=str(val)
 else:altered.extend([key,str(val)])
 p=run('guard-'+name,CLI+altered,expected=2);check('guard-'+name+'-error-message','outside' in p.stderr or 'traversal' in p.stderr,p.stderr.strip())
check('guards-read-only',dirtyBefore==inventory(REPO))
allowed=TEMP/'repo-sibling-report.json';allowedargs=dirtyargs+['--out',str(allowed)];run('out-prefix-sibling-allowed',CLI+allowedargs);check('out-prefix-sibling-created',allowed.exists())

# Explicit expiration boundaries and deletion/identical rename from real CLI output.
lookup=json.loads((E/'lookup-report.json').read_text())
check('fixture-identical-rename',any(c['kind']=='renamed' and c['before']['path'].endswith('LookupBadge.ts') and c['after']['path'].endswith('CatalogBadge.ts') for c in lookup['changes']))
check('fixture-deletion-baseline-only',any(c['kind']=='deleted' and 'RetiredLookupAdapter.java' in c['before']['path'] and c.get('after') is None for c in lookup['changes']))
check('fixture-unreviewed-never-suppressed',any(f['exception']['status']=='unreviewed' and not f['suppressed'] for f in lookup['findings']))
dateargs=['analyze','--baseline',str(B),'--candidate',str(C),'--rules',str(RULES),'--as-of','2026-12-31','--cache',str(TEMP/'expiry-cache')]
same=report('expiry-on-day',dateargs);dateargs[dateargs.index('--as-of')+1]='2027-01-01';expired=report('expiry-next-day',dateargs)
def approved(r):return next(f for f in r['findings'] if f['evidence']['path'].endswith('ApprovedLegacyGateway.java'))
check('expiry-inclusive-on-day',approved(same)['suppressed'] and approved(same)['exception']['status']=='simulation-active')
check('expiry-next-day-unsuppressed',not approved(expired)['suppressed'] and approved(expired)['exception']['status']=='expired')
check('expiry-date-cache-invalidation',same['provenance']['cacheKey']!=expired['provenance']['cacheKey'] and expired['cache']['report']=='miss')

# Fail-closed malformed inputs independent of implementation test assertions.
invalids=[('invalid-date',['--as-of','2026-02-30']),('invalid-revision',['--base','--not-a-commit']),('missing-rules',['--rules',str(TEMP/'absent.json')])]
for name,pair in invalids:
 a=args.copy();a[a.index(pair[0])+1]=pair[1];run(name,CLI+a,expected=2)
check('final-git-source-unchanged',dirtyBefore==inventory(REPO))
(E/'integration-context.json').write_text(json.dumps({'temporaryRoot':str(TEMP),'repo':str(REPO),'baselineCommit':base,'candidateCommit':head,'cache':str(CACHE),'dirtyStatus':status},indent=2)+'\n')
(E/'integration-results.json').write_text(json.dumps(RESULTS,indent=2)+'\n')
