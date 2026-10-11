import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {buildIdentity} from '/opt/review-analysis/src/engine.js';
import {qualityToolIdentity} from '/opt/review-analysis/src/quality.js';
import {hash} from '/opt/review-analysis/src/snapshot.js';
const root='/opt/review-analysis';
const require=createRequire(path.join(root,'package.json'));
const files={};
function walk(folder){for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){const file=path.posix.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())files[file]=hash(fs.readFileSync(path.join(root,file)));}}
for(const folder of ['src','app','app-dist','ui','fixtures'])walk(folder);
for(const file of ['package.json','package-lock.json','tsconfig.json'])files[file]=hash(fs.readFileSync(path.join(root,file)));
const packages={};for(const name of ['eslint','@typescript-eslint/parser','@typescript-eslint/eslint-plugin','jscpd','typescript','java-parser']){try{packages[name]=require(name+'/package.json').version;}catch{packages[name]='exports-hidden';}}
const java=spawnSync('java',['-version'],{encoding:'utf8'});
process.stdout.write(JSON.stringify({build:buildIdentity(),uid:process.getuid(),runtime:process.version,platform:process.platform,architecture:process.arch,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),java:(java.stderr||java.stdout).trim(),pmd:execFileSync('/opt/pmd/bin/pmd',['--version'],{encoding:'utf8'}).trim(),qualityToolchain:await qualityToolIdentity(),packages,files},null,2)+'\n');
