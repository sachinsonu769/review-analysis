import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readSnapshot,hash} from '/opt/review-analysis/src/snapshot.js';
import {buildIdentity} from '/opt/review-analysis/src/engine.js';
const expectedBuild=process.argv[2];assert.equal(buildIdentity().sourceBuildHash,expectedBuild);
const dir=fs.mkdtempSync('/tmp/expanded-qa-lazy-');
const origin=path.join(dir,'origin'),partial=path.join(dir,'partial');fs.mkdirSync(origin);
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
git(origin,'init','-q');git(origin,'config','user.name','Synthetic QA');git(origin,'config','user.email','synthetic@example.invalid');git(origin,'config','uploadpack.allowFilter','true');git(origin,'config','uploadpack.allowAnySHA1InWant','true');
fs.writeFileSync(path.join(origin,'a.ts'),'export const original = 1;\n');git(origin,'add','.');git(origin,'commit','-qm','synthetic');
execFileSync('git',['-c','protocol.file.allow=always','clone','-q','--no-local','--filter=blob:none','--no-checkout',origin,partial],{encoding:'utf8'});
const revision=git(partial,'rev-parse','HEAD'),helper=path.join(dir,'synthetic-transport'),marker=path.join(dir,'transport-executed');
fs.writeFileSync(helper,`#!/bin/sh\nprintf executed > '${marker}'\nexec git upload-pack '${origin}'\n`,{mode:0o755});
git(partial,'config','remote.origin.url','ext::'+helper);git(partial,'config','protocol.ext.allow','always');
function manifest(base){const files={};const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile())files[path.relative(base,full)]=hash(fs.readFileSync(full));}};walk(base);return files;}
const before=manifest(path.join(partial,'.git'));let readError;
try{readSnapshot({type:'git',root:partial,revision});}catch(error){readError=error.message;}
const after=manifest(path.join(partial,'.git'));
assert.ok(readError,'Missing local blob must fail visibly');assert.equal(fs.existsSync(marker),false);assert.deepEqual(after,before);
process.stdout.write(JSON.stringify({status:'pass',expectedBuild,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),trustedFixtureFilesystem:'Executable ephemeral /tmp; a filesystem noexec restriction cannot mask hook/transport guard behavior',revision,readError,transportExecuted:false,gitFilesUnchanged:Object.keys(before).length,network:'none; synthetic local origin only'},null,2)+'\n');
