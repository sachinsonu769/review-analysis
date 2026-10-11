import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readSnapshot} from '/workspace/review-analysis/src/snapshot.js';
import {analyze} from '/workspace/review-analysis/src/engine.js';

const reviewDir = path.dirname(new URL(import.meta.url).pathname);
const expectSafe = process.argv.includes('--expect-safe');
const runDir = fs.mkdtempSync(path.join(reviewDir, 'repro-'));
const sha = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const git = (repo,...args) => execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
function initRepo(name) {
  const repo=path.join(runDir,name);
  fs.mkdirSync(repo);
  git(repo,'init','-q');
  git(repo,'config','user.name','Synthetic Review');
  git(repo,'config','user.email','synthetic@example.invalid');
  return repo;
}

// The repository's filesystem monitor command is not application code and is
// never called explicitly by this repro. The analyzer's git status invokes it.
const hookRepo = initRepo('fsmonitor-repository');
fs.writeFileSync(path.join(hookRepo,'a.ts'),'export const unchanged = 1;\n');
git(hookRepo,'add','.');
git(hookRepo,'commit','-qm','synthetic baseline');
const hook=path.join(hookRepo,'.git','synthetic-fsmonitor');
const marker=path.join(hookRepo,'executed-by-repository-hook.ts');
fs.writeFileSync(hook,`#!/bin/sh\nprintf 'export const fsmonitorExecuted = true;\\n' > '${marker}'\nprintf 'synthetic-token\\000'\n`,{mode:0o755});
git(hookRepo,'config','core.fsmonitor',hook);
const markerBefore=fs.existsSync(marker);
const worktree=readSnapshot({type:'worktree',root:hookRepo});
const markerAfter=fs.existsSync(marker);
assert.equal(markerBefore,false);
assert.equal(markerAfter,!expectSafe);
assert.equal(Boolean(worktree.files['executed-by-repository-hook.ts']),false);

// No source changes occur between HEAD and its worktree. Only the snapshot
// kinds differ; the accepted source sets should be compared deliberately.
const exclusionRepo=initRepo('clean-exclusion-repository');
fs.mkdirSync(path.join(exclusionRepo,'build'));
fs.writeFileSync(path.join(exclusionRepo,'a.ts'),'export const a = 1;\n');
fs.writeFileSync(path.join(exclusionRepo,'build','b.ts'),'export function b(): string { return "stable"; }\n');
git(exclusionRepo,'add','.');
git(exclusionRepo,'commit','-qm','synthetic baseline including tracked source');
const head=git(exclusionRepo,'rev-parse','HEAD');
const report=analyze({baseline:{type:'git',root:exclusionRepo,revision:head},candidate:{type:'worktree',root:exclusionRepo},rules:{version:'synthetic',rules:[]},asOf:'2026-10-11'});
const status=git(exclusionRepo,'status','--porcelain=v1','--untracked-files=all');
assert.equal(status,'');
assert.equal(report.provenance.candidate.dirty,false);
if(expectSafe) assert.equal(report.changes.length,0);
else assert.ok(report.changes.some(change=>change.kind==='deleted'&&change.before?.path==='build/b.ts'));

const summary={
  recordedAt:new Date().toISOString(),
  expectation:expectSafe?'fixed source blocks hook and avoids clean-worktree false deletion':'original defects reproduced',
  runtime:{node:process.version,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim()},
  reviewedSources:Object.fromEntries(['src/snapshot.js','src/engine.js','src/cache.js','src/cli.js','app/workspace.ts'].map(file=>[file,sha(path.join('/workspace/review-analysis',file))])),
  fsmonitor:{repository:hookRepo,configuredHook:hook,markerPath:marker,markerBefore,markerAfter,markerSource:markerAfter?fs.readFileSync(marker,'utf8'):null,returnedSnapshotFiles:Object.keys(worktree.files),dirty:worktree.dirty},
  cleanGitWorktree:{repository:exclusionRepo,head,status,candidateDirty:report.provenance.candidate.dirty,sourceFiles:report.coverage.sourceFiles,changes:report.changes,exclusions:report.coverage.excluded,fullRegressionMayBeSkipped:report.coverage.fullRegressionMayBeSkipped,advisory:report.advisory},
};
fs.writeFileSync(path.join(reviewDir,expectSafe?'fixed-source-summary.json':'reproduction-summary.json'),JSON.stringify(summary,null,2)+'\n');
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
