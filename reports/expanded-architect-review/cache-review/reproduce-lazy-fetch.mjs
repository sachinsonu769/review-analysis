import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readSnapshot} from '/workspace/review-analysis/src/snapshot.js';

const reviewDir=path.dirname(new URL(import.meta.url).pathname);
const expectSafe=process.argv.includes('--expect-safe');
const runDir=fs.mkdtempSync(path.join(reviewDir,'lazy-fetch-'));
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const origin=path.join(runDir,'synthetic-origin');
const partial=path.join(runDir,'synthetic-partial-clone');
fs.mkdirSync(origin);
git(origin,'init','-q');
git(origin,'config','user.name','Synthetic Review');
git(origin,'config','user.email','synthetic@example.invalid');
git(origin,'config','uploadpack.allowFilter','true');
git(origin,'config','uploadpack.allowAnySHA1InWant','true');
fs.writeFileSync(path.join(origin,'a.ts'),'export const lazilyFetched = 1;\n');
git(origin,'add','.');
git(origin,'commit','-qm','synthetic partial clone source');
execFileSync('git',['-c','protocol.file.allow=always','clone','-q','--no-local','--filter=blob:none','--no-checkout',origin,partial],{encoding:'utf8'});
const head=git(partial,'rev-parse','HEAD');
const marker=path.join(partial,'executed-by-promisor-transport.ts');
const helper=path.join(runDir,'synthetic-local-promisor-transport');
fs.writeFileSync(helper,`#!/bin/sh\nprintf 'export const promisorTransportExecuted = true;\\n' > '${marker}'\nexec git upload-pack '${origin}'\n`,{mode:0o755});
git(partial,'config','remote.origin.url',`ext::${helper}`);
git(partial,'config','protocol.ext.allow','always');
const packDir=path.join(partial,'.git','objects','pack');
const packsBefore=fs.readdirSync(packDir).sort();
const markerBefore=fs.existsSync(marker);
let snapshot,snapshotError;
try {snapshot=readSnapshot({type:'git',root:partial,revision:head});}
catch(error) {if(!expectSafe)throw error;snapshotError=error.message;}
const markerAfter=fs.existsSync(marker);
const packsAfter=fs.readdirSync(packDir).sort();
assert.equal(markerBefore,false);
if(expectSafe) {
  assert.equal(markerAfter,false);
  assert.deepEqual(packsAfter,packsBefore);
  assert.ok(snapshotError);
} else {
  assert.equal(markerAfter,true);
  assert.ok(packsAfter.length>packsBefore.length);
  assert.equal(snapshot.files['a.ts'].text,'export const lazilyFetched = 1;\n');
}
const summary={recordedAt:new Date().toISOString(),expectation:expectSafe?'fixed source refuses missing local blob without transport execution or object writes':'original lazy-fetch defect reproduced',snapshotSourceHash:createHash('sha256').update(fs.readFileSync('/workspace/review-analysis/src/snapshot.js')).digest('hex'),runtime:{node:process.version,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim()},origin,partial,head,configuredTransport:helper,markerPath:marker,markerBefore,markerAfter,packsBefore,packsAfter,returnedSnapshotFiles:snapshot?Object.keys(snapshot.files):null,snapshotError,transport:'Synthetic local Git ext transport; no external network or private repository used'};
fs.writeFileSync(path.join(reviewDir,expectSafe?'fixed-lazy-fetch-summary.json':'lazy-fetch-summary.json'),JSON.stringify(summary,null,2)+'\n');
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
