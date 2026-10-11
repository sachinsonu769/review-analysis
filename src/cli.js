#!/usr/bin/env node
import fs from 'node:fs';
import {analyze,preCodeGuidance} from './engine.js';
import {assertOutside} from './snapshot.js';
import {readableReport} from './report.js';
const help=`Review Analysis POC (advisory, source-only, read-only analysis)

Directory comparison:
  node src/cli.js analyze --baseline DIR --candidate DIR --rules FILE --as-of YYYY-MM-DD [--task TEXT]
Exact Git commits:
  node src/cli.js analyze --repo DIR --base REV --head REV --rules FILE --as-of YYYY-MM-DD
Working tree:
  node src/cli.js analyze --repo DIR --base REV --head worktree --rules FILE --as-of YYYY-MM-DD
Pre-code guidance:
  node src/cli.js guide --root DIR --rules FILE --task TEXT [--paths PATH,PATH]

Options: --format json|readable (default json), --out FILE (default stdout),
         --cache DIR (disabled by default; must be outside analyzed roots),
         --baseline-rules FILE (compare prior rule severity/version)
All dates, paths, rules and revisions are explicit. No network or code execution.
Exit 0: advisory report produced (including findings/unknowns). Exit 2: input/read error.
`;
try {
  const args=process.argv.slice(2);const command=args.shift();
  if(!command||['--help','help','-h'].includes(command)){process.stdout.write(help);process.exit(0);}
  const allowed=new Set(['baseline','candidate','rules','as-of','task','repo','base','head','format','out','cache','root','paths','baseline-rules']);const options={};
  while(args.length) {
    const flag=args.shift();if(!flag.startsWith('--')||!allowed.has(flag.slice(2)))throw new Error('Unknown option: '+flag);
    const value=args.shift();if(value===undefined||value.startsWith('--'))throw new Error('Missing value for '+flag);
    if(options[flag.slice(2)]!==undefined)throw new Error('Duplicate option: '+flag);options[flag.slice(2)]=value;
  }
  const required=key=>{if(!options[key])throw new Error('Required: --'+key);return options[key];};
  const rules=JSON.parse(fs.readFileSync(required('rules'),'utf8'));const format=options.format||'json';
  if(!['json','readable'].includes(format))throw new Error('--format must be json or readable');
  let report;let roots;
  if(command==='analyze') {
    let baseline,candidate;
    if(options.repo) {
      if(options.baseline||options.candidate)throw new Error('Choose --repo or directory pair');
      baseline={type:'git',root:options.repo,revision:required('base')};
      candidate={type:required('head')==='worktree'?'worktree':'git',root:options.repo,revision:options.head};
    }else{baseline={type:'directory',root:required('baseline')};candidate={type:'directory',root:required('candidate')};}
    roots=[baseline.root,candidate.root];options.out=assertOutside(options.out,roots);
    report=analyze({baseline,candidate,rules,baselineRules:options['baseline-rules']?JSON.parse(fs.readFileSync(options['baseline-rules'],'utf8')):undefined,asOf:required('as-of'),task:options.task,paths:options.paths?.split(','),cacheDir:options.cache});
  }else if(command==='guide') {
    roots=[required('root')];options.out=assertOutside(options.out,roots);report=preCodeGuidance({root:options.root,rules,task:required('task'),paths:options.paths?.split(',')});
  }else throw new Error('Unknown command: '+command);
  const output=format==='readable'?readableReport(report):JSON.stringify(report,null,2)+'\n';
  if(options.out)fs.writeFileSync(options.out,output);else process.stdout.write(output);
}catch(error){process.stderr.write('Review Analysis: '+error.message+'\n');process.exitCode=2;}
