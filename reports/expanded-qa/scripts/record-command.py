#!/usr/bin/env python3
"""Capture one independent QA command without replacing any earlier evidence."""
import argparse, datetime, json, os, subprocess, time
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--case',required=True)
parser.add_argument('--cwd')
parser.add_argument('--timeout',type=int,default=600)
parser.add_argument('command',nargs=argparse.REMAINDER)
args=parser.parse_args()
command=args.command[1:] if args.command[:1]==['--'] else args.command
if not command:parser.error('command is required')
case=Path(args.case)
case.mkdir(parents=True,exist_ok=True)
if (case/'command-result.json').exists():raise SystemExit('Refusing to overwrite earlier QA command evidence; choose a new case directory')
started=time.monotonic()
environment={**os.environ,'DOCKER_CONFIG':'/tmp/review-analysis-docker-config'}
metadata={'command':command,'cwd':args.cwd,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'dockerConfig':environment['DOCKER_CONFIG']}
(case/'command.json').write_text(json.dumps(metadata,indent=2)+'\n')
with (case/'stdout.log').open('w') as out,(case/'stderr.log').open('w') as err:
    try:
        result=subprocess.run(command,cwd=args.cwd,env=environment,stdout=out,stderr=err,timeout=args.timeout)
        metadata['exitCode']=result.returncode
    except subprocess.TimeoutExpired:
        metadata.update(exitCode=124,timeout=True)
metadata['elapsedSeconds']=round(time.monotonic()-started,3)
(case/'command-result.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2),flush=True)
raise SystemExit(metadata['exitCode'])
