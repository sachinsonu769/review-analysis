import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {demos} from '../src/server.js';
import {analyzeWorkspace} from '../app-dist/workspace.js';
import {buildIdentity} from '../src/engine.js';
const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'review-analysis-measure-'));
const measurements=[];
try {
  for(const demo of demos()) {
    const options={workspace:demo.workspace,asOf:'2026-10-11',task:'Demonstrate a bounded evidence-based change review',cacheDir,checklist:JSON.parse(fs.readFileSync('fixtures/requirements/draft-checklist.json','utf8'))};
    const started=performance.now(),report=await analyzeWorkspace(options),coldMs=performance.now()-started;
    const warmStarted=performance.now(),warm=await analyzeWorkspace(options),warmMs=performance.now()-warmStarted;
    fs.mkdirSync('reports/expanded',{recursive:true});
    fs.writeFileSync(`reports/expanded/${demo.id}.json`,JSON.stringify(report,null,2)+'\n');
    const at=e=>e?`${e.projectId||''}:${e.path}:${e.range.startLine}-${e.range.endLine} @ ${e.revision} sha256:${e.fileHash}`:'No source evidence';
    const text=[`Review Analysis — ${demo.label}`,`Build: ${report.build.sourceBuildHash}`,`Advisory; incomplete source-only coverage; runtime and full regression remain unverified.`,`${report.changes.length} changed declarations, ${report.graph.nodes.filter(n=>n.changed).length} changed files, ${report.graph.edges.length} edges.`,`${report.impact.direct.length} direct representative paths; ${report.impact.indirect.length} likely indirect paths (low certainty).`,`Limits: depth ${report.impact.limits.maxDepth}; alternate/deeper paths may be omitted.`,`Architecture findings: ${report.findings.length}; quality/design findings: ${report.quality.findings.length}; unresolved source facts: ${report.unknowns.length}.`,`Checklist: ${report.requirements.status}; ${report.requirements.criteria.length} criteria; runtime unverified.`,...report.changes.map(c=>`${c.kind}: ${c.key}\n  ${at(c.after||c.before)}`),...report.findings.map(f=>`Architecture ${f.classification}: ${f.ruleId}: ${f.message}\n  ${at(f.evidence)}`),...report.quality.findings.map(f=>`Quality ${f.classification}/${f.certainty}: ${f.tool}/${f.ruleId}: ${f.message}\n  ${at(f.evidence)}`),...report.requirements.criteria.map(c=>`Requirement ${c.assessment}: ${c.id}; missing edge cases: ${c.missingEdgeCases.length}; runtime ${c.runtime}`)];
    fs.writeFileSync(`reports/expanded/${demo.id}.txt`,text.join('\n\n')+'\n');
    measurements.push({demo:demo.id,coldMs:Math.round(coldMs*100)/100,warmMs:Math.round(warmMs*100)/100,files:report.graph.nodes.length,edges:report.graph.edges.length,qualityTools:report.quality.tools,qualityCache:warm.cache.quality,build:report.build.sourceBuildHash});
    console.log(JSON.stringify(measurements.at(-1)));
  }
  fs.writeFileSync('reports/expanded/measurements.json',JSON.stringify({build:buildIdentity(),runtime:process.version,platform:process.platform,arch:process.arch,method:'One cold and one repeated in-process workspace analysis per tiny fixture; all actual enabled tools. No scale or efficacy inference.',measurements},null,2)+'\n');
}finally{fs.rmSync(cacheDir,{recursive:true,force:true});}
