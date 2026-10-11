#!/usr/bin/env python3
import argparse, hashlib, json, shutil
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('source_root');parser.add_argument('case_dir')
args=parser.parse_args()
source=Path(args.source_root);case=Path(args.case_dir);inputs=case/'inputs'
if inputs.exists():raise SystemExit('Choose a fresh case; inputs already exist')
inputs.mkdir(parents=True)
shutil.copytree(source/'fixtures/requirements/sample',inputs/'requirements')
(inputs/'outside-link').symlink_to('/opt/review-analysis/src',target_is_directory=True)
(inputs/'foreign-owned-git').mkdir()
projects=[]
for project in ['backend','frontend']:
    root=f'/inputs/requirements/{project}'
    projects.append({'id':project,'label':project,'repository':f'synthetic/{project}','module':project,'baseline':{'type':'directory','root':root},'candidate':{'type':'directory','root':root},'rules':{'version':'qa-synthetic-1','rules':[]}})
workspace={'version':'qa-mounted-requirements-1','projects':projects,'mappings':[{'id':'qa-explicit-api','kind':'http','fromProject':'frontend','toProject':'backend','urlPrefix':'/api/','owner':'Synthetic QA','version':'1'}]}
(case/'custom-workspace.json').write_text(json.dumps(workspace,indent=2)+'\n')
for filename in inputs.rglob('*'):
    if not filename.is_symlink():filename.chmod(0o755 if filename.is_dir() else 0o644)
def manifest():
    return {file.relative_to(inputs).as_posix():hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(inputs.rglob('*')) if file.is_file() and not file.is_symlink()}
(case/'input-manifest-pre-git.json').write_text(json.dumps(manifest(),indent=2)+'\n')
print(json.dumps({'inputs':str(inputs),'workspace':str(case/'custom-workspace.json')},indent=2))
