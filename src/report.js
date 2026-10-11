const location=e=>e?`${e.path}:${e.range.startLine}-${e.range.endLine} @ ${e.revision} (sha256 ${e.fileHash})`:'No source evidence';
export function readableReport(report) {
  const lines=['Review Analysis — advisory source report',`Analyzer ${report.analyzer.version}; build ${report.analyzer.sourceBuildHash}`,`As of ${report.asOf||'pre-code guidance'}`];
  if(report.provenance.baseline)lines.push(`Baseline: ${report.provenance.baseline.revision}`,`Candidate: ${report.provenance.candidate.revision}`);
  lines.push('',`Task: ${report.guidance.task}`,'Applicable rules:');
  for(const rule of report.guidance.rules) {
    lines.push(`- ${rule.id} v${rule.version}; owner ${rule.owner}: ${rule.instruction}`);
    for(const example of rule.examples)lines.push(`  Example (${example.status}): ${location(example.evidence)}`);
  }
  lines.push(report.guidance.approvalGap);
  if(!report.changes)return lines.join('\n')+'\n';
  lines.push('',`Changed declarations (${report.changes.length}):`);
  for(const change of report.changes)lines.push(`- ${change.kind}: ${change.key}; ${change.contractChanged?'contract changed':'body/path changed'}`,`  Before: ${location(change.before)}`,`  After: ${location(change.after)}`);
  lines.push('',`Direct dependencies (${report.impact.direct.length}):`);
  for(const edge of report.impact.direct)lines.push(`- ${edge.fromPath} -> ${edge.toPath} (${edge.kind}, ${edge.confidence}): ${edge.reason}`,`  ${location(edge.evidence)}`);
  lines.push('',`Likely indirect dependencies (${report.impact.indirect.length}):`);
  for(const item of report.impact.indirect)lines.push(`- ${item.path} (${item.confidence}): ${item.chain.map(e=>e.fromPath+' -> '+e.toPath).join('; ')}`);
  lines.push('',`Architecture findings (${report.findings.length}):`);
  for(const finding of report.findings)lines.push(`- ${finding.classification} ${finding.severity} [${finding.ruleId}]: ${finding.message}; exception ${finding.exception.status}${finding.suppressed?' (advisory suppression)':''}`,`  ${location(finding.evidence)}`);
  lines.push('',`Unknowns (${report.unknowns.length}):`);
  for(const unknown of report.unknowns)lines.push(`- ${unknown.reason}: ${unknown.detail||''}; ${location(unknown.evidence)}`);
  lines.push('',`Focused tests (${report.focusedTests.length}; recommendations, not executed by analyzer):`);
  for(const test of report.focusedTests)lines.push(`- ${test.kind}: ${test.reason}; ${test.path||location(test.evidence)}`);
  lines.push('','Coverage incomplete. This report never authorizes skipping full regression.',...report.coverage.limitations.map(x=>'- '+x),`Cache: ${JSON.stringify(report.cache)}`,`Analysis metrics: ${JSON.stringify(report.metrics)}`);
  return lines.join('\n')+'\n';
}
