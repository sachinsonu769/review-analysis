import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyze } from '../src/engine.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repository, 'fixtures');
const asOf = '2026-10-11';
const reports = new Map();

async function fixtureReport(suite = 'lookup') {
  if (!reports.has(suite)) {
    const rules = JSON.parse(await readFile(path.join(fixtureRoot, suite === 'lookup' ? 'rules.json' : 'renamed-rules.json'), 'utf8'));
    reports.set(suite, analyze({
      baseline: { type: 'directory', root: path.join(fixtureRoot, suite, 'baseline') },
      candidate: { type: 'directory', root: path.join(fixtureRoot, suite, 'candidate') },
      rules,
      asOf,
    }));
  }
  return reports.get(suite);
}

const endsWith = (value, suffix) => typeof value === 'string' && value.replaceAll('\\', '/').endsWith(suffix);
const evidenceText = (value) => `${value?.excerpt ?? ''} ${value?.path ?? ''}`;
const edgeFrom = (edge) => edge.fromPath ?? edge.evidence?.path;
const edgeTo = (edge) => edge.toPath ?? edge.targetEvidence?.path;
const findImportFinding = (report, basename) => report.findings.find((finding) =>
  finding.ruleId === 'architecture/no-raw-http' && endsWith(finding.evidence?.path, basename));

function changedDeclaration(report, basename, match) {
  return report.changes.find((change) =>
    endsWith(change.after?.path, basename) && change.contractChanged &&
    (!match || match.test(`${change.name ?? ''} ${change.key ?? ''}`)));
}

test('reports route, DTO member, and same-arity service signature changes from source evidence', async () => {
  const report = await fixtureReport();
  const controller = changedDeclaration(report, 'LookupController.java', /lookup/i);
  assert.ok(controller, 'literal Spring route migration should be a contract change');
  assert.match(evidenceText(controller.before), /\/lookup/);
  assert.match(evidenceText(controller.after), /\/catalog\/lookup/);

  const response = changedDeclaration(report, 'LookupResponse.java');
  assert.ok(response, 'Java record member rename should alter the DTO contract');
  assert.match(evidenceText(response.before), /String label/);
  assert.match(evidenceText(response.after), /String displayName/);

  const service = changedDeclaration(report, 'LookupService.java', /lookup/i);
  assert.ok(service, 'parameter type changes must be detected even when name and arity are unchanged');
  assert.match(evidenceText(service.before), /lookup\(String id\)/);
  assert.match(evidenceText(service.after), /lookup\(LookupQuery query\)/);

  const tsResponse = changedDeclaration(report, 'lookupApi.ts', /LookupResponse/);
  assert.ok(tsResponse, 'the TypeScript response interface is also a changed contract');
  assert.match(evidenceText(tsResponse.before), /label: string/);
  assert.match(evidenceText(tsResponse.after), /displayName: string/);
});

test('finds direct Java callers and literal HTTP consumers with source-to-target evidence', async () => {
  const report = await fixtureReport();
  for (const basename of ['AdminLookupJob.java', 'LookupExporter.java']) {
    const edge = report.impact.direct.find((item) => endsWith(edgeFrom(item), basename) && endsWith(edgeTo(item), 'LookupService.java'));
    assert.ok(edge, `${basename} calls the changed service`);
    assert.ok(edge.evidence && edge.targetEvidence, 'a direct dependency needs evidence at both ends');
    assert.ok(['high', 'medium'].includes(edge.confidence), 'resolved calls should not be speculative');
    assert.ok(edge.reason, 'the report should explain the dependency');
  }

  for (const basename of ['lookupApi.ts', 'axiosLookup.ts']) {
    const edge = report.impact.direct.find((item) => endsWith(edgeFrom(item), basename) && endsWith(edgeTo(item), 'LookupController.java'));
    assert.ok(edge, `${basename} is a literal HTTP consumer of the changed route`);
    assert.ok(edge.evidence && edge.targetEvidence);
  }
});

test('marks React import chains as likely indirect impact and excludes unrelated or nonexecuting text', async () => {
  const report = await fixtureReport();
  assert.ok(report.impact.direct.some((edge) => endsWith(edgeFrom(edge), 'LookupPanel.tsx') && endsWith(edgeTo(edge), 'lookupApi.ts')),
    'the panel directly imports the changed API contract');
  for (const basename of ['LookupPanel.tsx', 'App.tsx']) {
    const impact = report.impact.indirect.find((item) => endsWith(item.path, basename));
    assert.ok(impact, `${basename} should be reached through the import dependency graph`);
    assert.equal(impact.confidence, 'low');
    assert.ok(impact.reason);
    assert.ok(Array.isArray(impact.chain) && impact.chain.length >= 2, 'indirect impact must include at least two dependency edges');
  }

  for (const impact of report.impact.indirect) {
    const revision = impact.chain[0].evidence.revision;
    for (let index = 0; index < impact.chain.length; index++) {
      const edge = impact.chain[index];
      assert.equal(edge.evidence.revision, revision, 'a chain must not connect dependencies from different revisions');
      assert.equal(edge.targetEvidence.revision, revision);
      if (index > 0) assert.equal(edgeTo(impact.chain[index - 1]), edgeFrom(edge), 'consecutive edges must form a real path');
    }
  }

  const impactedPaths = [...report.impact.direct.map(edgeFrom), ...report.impact.indirect.map((item) => item.path)];
  for (const basename of ['billingApi.ts', 'InvoicePanel.tsx', 'stringDecoys.ts', 'dynamicLookup.ts']) {
    assert.ok(!impactedPaths.some((value) => endsWith(value, basename)), `${basename} has no confirmed lookup dependency`);
  }
});

test('distinguishes new violations from retained debt and keeps exception state explicit', async () => {
  const report = await fixtureReport();
  assert.equal(findImportFinding(report, 'AuditLogger.java')?.classification, 'new');
  assert.equal(findImportFinding(report, 'LookupService.java')?.classification, 'pre-existing');

  const simulated = findImportFinding(report, 'ApprovedLegacyGateway.java');
  assert.ok(simulated, 'a simulated exception remains visible in the report');
  assert.equal(simulated.exception?.status, 'simulation-active');

  const expired = findImportFinding(report, 'ExpiredGateway.java');
  assert.ok(expired);
  assert.equal(expired.exception?.status, 'expired');
  assert.equal(expired.classification, 'pre-existing');

  const proposed = findImportFinding(report, 'UnreviewedGateway.java');
  assert.ok(proposed, 'an unreviewed proposed exception cannot erase the finding');
  assert.equal(proposed.exception?.status, 'unreviewed');
});

test('guidance preserves proposed status, configured ownership, version, and simulated review evidence', async () => {
  const report = await fixtureReport();
  const rule = report.guidance.rules.find((item) => item.id === 'architecture/no-raw-http');
  assert.ok(rule);
  assert.ok(JSON.stringify(rule.owner).includes('example-platform'));
  assert.equal(rule.version, '2026.10.1-fixture');
  const proposed = rule.examples.find((example) => endsWith(example.path ?? example.evidence?.path, 'AuditLogger.java'));
  assert.ok(proposed, 'the configured proposed example should be available to reviewers');
  assert.equal(proposed.approval?.status, 'proposed', 'repository code must not become approved automatically');
  const simulated = rule.examples.find((example) => endsWith(example.path ?? example.evidence?.path, 'ApprovedLegacyGateway.java'));
  assert.equal(simulated?.approval?.simulation, true, 'simulated review evidence must remain labeled');
});

test('explicitly reports dynamic HTTP, missing imports, and ambiguous overloads instead of inventing links', async () => {
  const report = await fixtureReport();
  const unknownFor = (basename) => report.unknowns.filter((unknown) => endsWith(unknown.evidence?.path, basename));
  const dynamic = unknownFor('dynamicLookup.ts');
  assert.ok(dynamic.length > 0, 'runtime-composed HTTP URLs need an unknown');
  assert.match(JSON.stringify(dynamic), /dynamic|runtime|non.literal|unresolved/i);

  const missing = unknownFor('missingImport.ts');
  assert.ok(missing.length > 0, 'absent relative imports need an unknown');
  assert.match(JSON.stringify(missing), /missing|unresolved|not found/i);

  const ambiguous = unknownFor('OverloadConsumer.java');
  assert.ok(ambiguous.length > 0, 'a null argument cannot select between String and Integer overloads');
  assert.match(JSON.stringify(ambiguous), /ambig|overload/i);
  assert.ok(ambiguous.some((unknown) => Array.isArray(unknown.candidates) && unknown.candidates.length >= 2),
    'ambiguous calls should retain candidate evidence for review');
});

test('accounts for deletion and a content-preserving file rename with both revisions', async () => {
  const report = await fixtureReport();
  const deleted = report.changes.find((change) => change.kind === 'deleted' && endsWith(change.before?.path, 'RetiredLookupAdapter.java'));
  assert.ok(deleted);
  assert.equal(deleted.after, null);
  const renamed = report.changes.find((change) => change.kind === 'renamed' &&
    endsWith(change.before?.path, 'LookupBadge.ts') && endsWith(change.after?.path, 'CatalogBadge.ts'));
  assert.ok(renamed, 'identical declaration moved to another file should be reported as a rename');
  assert.equal(renamed.before.fileHash, renamed.after.fileHash);
});

test('evidence hashes and line ranges reproduce the actual baseline and candidate source', async () => {
  const report = await fixtureReport();
  const evidence = report.changes.flatMap((change) => [change.before && { snapshot: 'baseline', value: change.before }, change.after && { snapshot: 'candidate', value: change.after }]).filter(Boolean);
  assert.ok(evidence.length > 0);
  for (const { snapshot, value } of evidence) {
    assert.ok(typeof value.revision === 'string' && value.revision.length > 0);
    assert.match(value.fileHash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(value.range?.startLine) && value.range.startLine > 0);
    assert.ok(Number.isInteger(value.range?.endLine) && value.range.endLine >= value.range.startLine);
    const snapshotRoot = path.join(fixtureRoot, 'lookup', snapshot);
    const source = await readFile(path.isAbsolute(value.path) ? value.path : path.join(snapshotRoot, value.path), 'utf8');
    assert.equal(value.fileHash, createHash('sha256').update(source).digest('hex'));
    const lines = source.split(/\r?\n/);
    assert.ok(value.range.endLine <= lines.length, 'evidence ranges must remain within the source file');
    assert.equal(value.excerpt, lines.slice(value.range.startLine - 1, value.range.endLine).join('\n'));
  }
});

test('renaming every application identifier preserves semantic detection and dependency structure', async () => {
  const original = await fixtureReport();
  const renamed = await fixtureReport('renamed');
  assert.ok(changedDeclaration(renamed, 'InventoryResource.java'));
  assert.ok(changedDeclaration(renamed, 'InventoryResolver.java', /resolveInventory/));
  assert.ok(changedDeclaration(renamed, 'ProductReply.java'));
  assert.ok(renamed.impact.direct.some((edge) => endsWith(edgeFrom(edge), 'InventoryRefreshTask.java') && endsWith(edgeTo(edge), 'InventoryResolver.java')));
  assert.ok(renamed.impact.direct.some((edge) => endsWith(edgeFrom(edge), 'inventoryApi.ts') && endsWith(edgeTo(edge), 'InventoryResource.java')));
  assert.ok(renamed.impact.direct.some((edge) => endsWith(edgeFrom(edge), 'ProductPanel.tsx') && endsWith(edgeTo(edge), 'inventoryApi.ts')));
  assert.ok(renamed.impact.indirect.some((impact) => endsWith(impact.path, 'ProductPanel.tsx')));
  assert.ok(renamed.impact.indirect.some((impact) => endsWith(impact.path, 'App.tsx')));
  assert.equal(findImportFinding(renamed, 'ChangeJournal.java')?.classification, 'new');
  assert.equal(renamed.changes.length, original.changes.length, 'only names differ between equivalent snapshots');
  assert.equal(renamed.impact.direct.length, original.impact.direct.length);
  assert.equal(renamed.impact.indirect.length, original.impact.indirect.length);
});

test('an identical snapshot yields no changes or impact and no new architecture violations', async () => {
  const rules = JSON.parse(await readFile(path.join(fixtureRoot, 'rules.json'), 'utf8'));
  const baseline = { type: 'directory', root: path.join(fixtureRoot, 'lookup', 'baseline') };
  const report = await analyze({ baseline, candidate: baseline, rules, asOf });
  assert.deepEqual(report.changes, []);
  assert.deepEqual(report.impact.direct, []);
  assert.deepEqual(report.impact.indirect, []);
  assert.ok(!report.findings.some((finding) => finding.classification === 'new'));
});
