#!/usr/bin/env python3
"""Package only this dedicated checkout's deliverables; no .git or dependencies."""
import argparse, hashlib, json, subprocess, zipfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--label',default='review-analysis-poc');parser.add_argument('--image');parser.add_argument('--image-id');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];destination=Path(args.out).resolve()
if destination.is_relative_to(root):raise SystemExit('Bundle destination must be outside checkout')
files={}
for directory in ['src','app','app-dist','ui','scripts','test','fixtures','docs','reports']:
    for file in sorted((root/directory).rglob('*')):
        if file.is_file() and not any(part in {'.git','node_modules','__pycache__'} for part in file.relative_to(root).parts) and file.suffix!='.pyc': files[file.relative_to(root).as_posix()]=file.read_bytes()
for name in ['README.md','package.json','package-lock.json','.gitignore','tsconfig.json','Dockerfile','compose.yaml','.dockerignore']:
    files[name]=(root/name).read_bytes()
digest=lambda data:hashlib.sha256(data).hexdigest()
def git_metadata():
    if (root/'.git').exists():
        return {'baseCommit':subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip(),'branch':subprocess.check_output(['git','-C',str(root),'branch','--show-current'],text=True).strip(),'uncommittedBuild':bool(subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip())}
    previous=json.loads((root/'BUILD-MANIFEST.json').read_text()) if (root/'BUILD-MANIFEST.json').exists() else {}
    return {'baseCommit':previous.get('baseCommit'),'branch':previous.get('branch'),'uncommittedBuild':None}
manifest={'label':args.label,'repository':'sachinsonu769/review-analysis','repositoryId':1414531073,**git_metadata(),'files':{name:digest(data) for name,data in sorted(files.items())}}
manifest['sourceTreeHash']=digest(json.dumps(manifest['files'],sort_keys=True,separators=(',',':')).encode())
if args.image:
    image=Path(args.image).resolve()
    if not image.is_file() or not args.image_id:raise SystemExit('--image needs an existing image archive and --image-id')
    files['review-analysis-image.tar.gz']=image.read_bytes()
    manifest['files']['review-analysis-image.tar.gz']=digest(files['review-analysis-image.tar.gz'])
    manifest['runtimeImage']={'id':args.image_id,'archive':'review-analysis-image.tar.gz','sha256':manifest['files']['review-analysis-image.tar.gz'],'bytes':image.stat().st_size,'platform':'linux/amd64'}
files['BUILD-MANIFEST.json']=(json.dumps(manifest,indent=2)+'\n').encode();destination.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as archive:
    for name,data in sorted(files.items()):
        entry=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_STORED if name.endswith('.tar.gz') else zipfile.ZIP_DEFLATED;entry.external_attr=(0o755 if name.endswith('.sh') or name in ['src/cli.js','src/workspace-cli.js'] else 0o644)<<16;archive.writestr(entry,data)
print(json.dumps({'file':str(destination),'sha256':digest(destination.read_bytes()),'sourceTreeHash':manifest['sourceTreeHash'],'files':len(files),'bytes':destination.stat().st_size},indent=2))
