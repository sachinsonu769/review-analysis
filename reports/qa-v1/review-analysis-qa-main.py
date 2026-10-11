import subprocess, json, datetime, time, pathlib, hashlib, shutil

ROOT=pathlib.Path('/tmp/review-analysis-qa-v1-nn0cdauu')
E=pathlib.Path('/workspace/review-analysis-deliverables/qa-v1')
CLI=['node',str(ROOT/'src/cli.js')]
RESULTS=[]
def run(name,argv,cwd=ROOT,expected=0):
    started=datetime.datetime.now(datetime.timezone.utc).isoformat(); t=time.monotonic()
    p=subprocess.run(argv,cwd=cwd,text=True,capture_output=True)
    (E/(name+'.stdout.log')).write_text(p.stdout); (E/(name+'.stderr.log')).write_text(p.stderr)
    row={'name':name,'argv':argv,'cwd':str(cwd),'startedUtc':started,'durationSeconds':round(time.monotonic()-t,3),'exitCode':p.returncode,'expectedExitCode':expected,'status':'pass' if p.returncode==expected else 'fail'}
    with (E/'commands.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
    RESULTS.append(row)
    print(name,row['status'],p.returncode,round(time.monotonic()-t,2),flush=True)
    return p
def sha(b):return hashlib.sha256(b).hexdigest()
def check_evidence(name,report,roots):
    issues=[]; count=0
    def walk(obj,location=''):
        nonlocal count
        if isinstance(obj,list):
            for i,v in enumerate(obj):walk(v,location+f'/{i}')
        elif isinstance(obj,dict):
            if all(k in obj for k in ['path','range','revision','fileHash','excerpt']):
                count+=1; root=roots.get(obj['revision']); file=root/obj['path'] if root else None
                if not file or not file.exists():issues.append({'location':location,'reason':'missing revision/path','evidence':obj})
                else:
                    text=file.read_text(); rg=obj['range']; start,end=rg['startLine'],rg['endLine']; lines=text.split('\n')
                    if not 1<=start<=end<=len(lines):issues.append({'location':location,'reason':'invalid range','range':rg})
                    if sha(file.read_bytes())!=obj['fileHash']:issues.append({'location':location,'reason':'source hash mismatch'})
                    if '\n'.join(lines[start-1:end])!=obj['excerpt']:issues.append({'location':location,'reason':'excerpt mismatch'})
            for k,v in obj.items():walk(v,location+'/'+k)
    walk(report)
    row={'name':name+'-evidence','status':'pass' if not issues else 'fail','evidenceCount':count,'issues':issues}
    RESULTS.append(row); (E/(name+'-evidence.json')).write_text(json.dumps(row,indent=2)+'\n')
    print(row['name'],row['status'],count,flush=True)
    return row

p=run('npm-test',['npm','test'])
p=run('benchmark',['npm','run','benchmark'])
for fixture,rules in [('lookup','rules.json'),('renamed','renamed-rules.json')]:
    before=ROOT/'fixtures'/fixture/'baseline';after=ROOT/'fixtures'/fixture/'candidate'
    args=['analyze','--baseline',str(before),'--candidate',str(after),'--rules',str(ROOT/'fixtures'/rules),'--as-of','2026-10-11','--task','Independent QA route and payload migration']
    p=run(fixture+'-directory',CLI+args)
    if p.returncode==0:
        report=json.loads(p.stdout); (E/(fixture+'-report.json')).write_text(p.stdout)
        roots={report['provenance']['baseline']['revision']:before,report['provenance']['candidate']['revision']:after}
        check_evidence(fixture,report,roots)
        print(json.dumps({'fixture':fixture,'changeKinds':[c['kind'] for c in report['changes']],'direct':len(report['impact']['direct']),'indirect':len(report['impact']['indirect']),'findings':len(report['findings']),'unknowns':len(report['unknowns'])}),flush=True)
    run(fixture+'-readable',CLI+args+['--format','readable'])
    g=run(fixture+'-guide',CLI+['guide','--root',str(after),'--rules',str(ROOT/'fixtures'/rules),'--task','Independent QA guidance','--paths','backend/src/main/java/'+('com/example/lookup/LookupController.java' if fixture=='lookup' else 'org/demo/inventory/InventoryResource.java')])
    if not g.returncode:
        gr=json.loads(g.stdout); check_evidence(fixture+'-guide',gr,{gr['provenance']['revision']:after})
    run(fixture+'-guide-readable',CLI+['guide','--root',str(after),'--rules',str(ROOT/'fixtures'/rules),'--task','Independent QA guidance','--format','readable'])
(E/'main-results.json').write_text(json.dumps(RESULTS,indent=2)+'\n')
