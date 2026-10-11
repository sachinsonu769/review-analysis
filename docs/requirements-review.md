# Requirements review

`src/requirements.js` maps a supplied business checklist to literal text in a source snapshot. It is deterministic, synchronous, read-only, and offline. It does not call a model, contact a service, execute the application, or run application tests.

Start with [the draft checklist](../fixtures/requirements/draft-checklist.json). Its criteria are examples awaiting owner confirmation. The [confirmed simulation](../fixtures/requirements/confirmed-simulation-checklist.json) is test data, labeled with `simulation: true`, a simulated owner, and a simulated reviewer. Neither file supplies real customer approval. The fixture [sample sources](../fixtures/requirements/sample/) are an illustrative customer lookup, not a complete built application.

## API

```js
import fs from 'node:fs';
import {readSnapshot} from '../src/snapshot.js';
import {reviewRequirements, reviewWorkspaceRequirements, validateChecklist} from '../src/requirements.js';

const snapshot = readSnapshot({
  type: 'directory', root: 'fixtures/requirements/sample'
});
const checklist = JSON.parse(fs.readFileSync(
  'fixtures/requirements/draft-checklist.json', 'utf8'
));
validateChecklist(checklist); // Returns a normalized copy; never confirms it.
const review = reviewRequirements({snapshot, checklist});
```

`reviewRequirements({snapshot, checklist, graph?, projectId?})` accepts the snapshot produced by `readSnapshot`, with `revision` and `files[path] = {text, hash}`. It reads only those supplied file records. SHA256 hashes are checked against every file's text before evidence is returned. Revision identity comes from the snapshot reader; the review does not independently query Git. An optional dependency graph is accepted for integration, but does not establish semantic satisfaction and is not used in this initial matcher.

Invalid input throws an error. A report with uncertainty or missing evidence is a successful advisory review, not an input error. No criterion authorizes skipping full regression.

For a workspace, call `reviewWorkspaceRequirements({projects, checklist, graph?})` with identified project snapshots:

```js
const projects = ['backend', 'frontend'].map(id => ({
  id, snapshot: readSnapshot({
    type: 'directory', root: `fixtures/requirements/sample/${id}`
  })
}));
const checklist = JSON.parse(fs.readFileSync(
  'fixtures/requirements/workspace-draft-checklist.json', 'utf8'
));
const review = reviewWorkspaceRequirements({projects, checklist});
```

The workspace helper evaluates each criterion once, combining its explicitly selected backend source and frontend test mappings. It does not duplicate a checklist per project. Every workspace evidence entry, including entries nested in checks and edge cases, retains `projectId`, its original relative path, actual snapshot revision, and actual file hash. Projects can have identical paths without sharing an evidence identity. There is no invented common revision: `provenance.projects` records each `{id, revision, contentHash}` separately.

## Checklist schema

```json
{
  "schemaVersion": "1",
  "revision": "customer-checklist-v1",
  "owner": "Supplied business owner",
  "confirmation": {"status": "draft"},
  "criteria": [
    {
      "id": "display-name",
      "description": "Display the customer's displayName from the lookup response.",
      "source": [
        {"pathPattern": "frontend/src/CustomerResult.tsx", "pattern": "result?.displayName"}
      ],
      "tests": [
        {"pathPattern": "backend/src/test/**/*.java", "name": "returnsDisplayName"}
      ],
      "edgeCases": [
        {
          "id": "missing-name",
          "description": "Handle a missing display name.",
          "tests": [
            {"pathPattern": "backend/src/test/**/*.java", "name": "handlesMissingDisplayName"}
          ]
        }
      ]
    }
  ]
}
```

`revision` versions the checklist, not the source repository. `owner` identifies the owner as supplied by the caller. Criterion IDs must be unique; edge-case IDs must be unique within a criterion. Descriptions are human context and are never interpreted as evidence selectors.

An owner-confirmed checklist supplies `confirmation.status: "confirmed"`, a nonempty `confirmedBy`, and a valid ISO 8601 `confirmedAt` timestamp with a timezone. These fields are input assertions; the engine cannot authenticate them. `simulation: true` keeps synthetic records visibly simulated. Confirmation is never inferred from a name, date, source match, or passing analyzer test. A draft stays draft even if `confirmedBy` happens to be present.

Source selectors accept `pathPattern`, `pattern`, `symbol`, and optional `projectId`. Test selectors accept `pathPattern`, `pattern`, `name`, and optional `projectId`. Each selector requires a path and at least one literal anchor. `source`, `tests`, and `edgeCases` may be omitted; they normalize to empty arrays and produce uncertainty or missing edge evidence rather than invented selectors. An edge case uses the same `tests` selector array as a criterion.

In a workspace, `projectId` searches only that selected project; an unknown ID produces an unmatched check rather than broadening the search. If omitted, the selector searches all selected project snapshots and reports which projects it searched. IDs must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens. These IDs are caller-supplied project identities, not filesystem paths or authenticated repository identities. A single-snapshot call with a project selector must explicitly pass the matching `projectId` option, or use the workspace helper.

All anchors are case-sensitive literal substrings. A `symbol` anchor is literal text, not a resolved declaration. A test `name` anchor is literal text, not a discovered or executed test. If a selector has two anchors, both must occur in the same selected file in the same project. Different selectors may map to different files or projects; all declared selectors must match for a criterion to be evidenced.

Paths use relative POSIX separators. `*` matches characters within one segment, and a standalone `**` matches zero or more segments. `src/*.ts` and `backend/src/test/**/*.java` are supported. Absolute paths, parent traversal, backslashes, `?`, brackets, braces, and embedded `**` such as `**.ts` are rejected. No user regular expression is compiled or executed; regex punctuation in an anchor is literal text.

Test selectors search recognized test sources: `.test.ts`, `.test.tsx`, `.test.js`, `.test.jsx`, corresponding `.spec` files; Java names ending in `Test.java` or `Tests.java` or starting with `Test`; and files inside `test`, `tests`, or `__tests__` directories. A literal in an ordinary implementation file cannot become test evidence just by supplying a test selector.

Optional `evidenceScope` pins the context in which a checklist was reviewed:

```json
{
  "snapshotRevision": "supplied-exact-snapshot-revision",
  "fileHashes": {
    "frontend/src/CustomerResult.tsx": "64-lowercase-SHA256-hex-characters"
  }
}
```

This illustrative hash is a placeholder and must be replaced with a real SHA256 value. Supply this object at the checklist's top level, beside `confirmation` and `criteria`. Either a revision or one or more file hashes is required. A mismatched revision, changed file hash, or missing pinned file makes the scope stale and every criterion unverified. Current literal matches remain available for inspection; they do not silently refresh the old scope or confirmation. Without `evidenceScope`, confirmation is unscoped to source revisions. There is no inferred expiration date.

A multi-project workspace pins each project separately:

```json
{
  "evidenceScope": {
    "projects": {
      "backend": {"snapshotRevision": "backend-exact-revision"},
      "frontend": {"snapshotRevision": "frontend-exact-revision"}
    }
  }
}
```

Each project scope also accepts `fileHashes` using original relative paths. Missing pinned projects and any fingerprint mismatch make the overall scope stale and all criteria unverified. The scope reports `unpinnedProjectIds` when only some projects are pinned, so partial scope is visible. Global and per-project scope fields cannot be mixed; a global revision/file hash scope is rejected when more than one project is selected because identical paths and revisions could be ambiguous. Per-project scope uses the workspace helper.

Unknown schema fields are rejected, including unsupported `regex`, execution results, and implicit `testPattern` edge-case shortcuts. API limits are 100 criteria, 500 total selectors, 20 selectors per source/test array, and 50 edge cases per criterion. Paths are at most 512 characters, anchors 2,000 characters, and descriptions 4,000 characters. Snapshots are bounded to 10,000 files, 4 MiB per file, and 64 MiB of total text; file count and total text bounds apply across all projects in a workspace. Workspaces accept at most 100 uniquely identified projects. Deterministic work budgets limit wildcard matching to 20,971,520 estimated dynamic-programming steps and literal scans to 134,217,728 estimated characters; oversized work fails explicitly and requires narrower path selectors or a smaller snapshot. Exact paths use direct lookup and repeated globs share results. Evidence retains up to 20 matching files per selector and 1,600 characters per excerpt; truncation is reported explicitly and the matching-file count is preserved.

## Report interpretation

The report status is `draft`, `confirmed-assertion`, or `simulated-confirmed`, preserving the supplied confirmation state. `provenance` includes the snapshot revision and content hash (or the workspace's separate project snapshots), checked file hashes, and scope status (`unscoped`, `matched`, or `stale`). `checklist` includes its revision, owner, and hash. Evidence entries identify the supplied revision, file SHA256, path, line range, excerpt, matched literal, anchor role, and source/test-source kind. Workspace entries additionally identify their actual project.

| Criterion assessment | Meaning |
| --- | --- |
| `evidenced` | A confirmed assertion has at least one explicit source selector and one explicit test selector; every declared source, test, and edge-case selector matched text in the supplied eligible files. |
| `potential-mismatch` | A confirmed assertion with explicit source selectors has an unmatched requested source or test selector, or a listed edge case lacks test source evidence. Wrong selectors or incomplete snapshots can also cause this result. |
| `unverified` | The checklist is draft, its pinned evidence scope is stale, it has no source selectors, or it has matched source selectors but no explicit criterion test selectors. |

Each criterion provides `reasons`, `sourceChecks`, `testChecks`, `sourceEvidence`, `testEvidence`, `edgeCases`, and `missingEdgeCases`. Missing edge cases are exclusively those the owner listed with absent or unmatched test selectors. The reviewer cannot enumerate every business scenario from a description. Missing evidence is not proof of a defect.

Every report and criterion has `runtime: "unverified"`; evidence has `execution: "unverified"`. Even `evidenced` describes text presence only. Comments, strings, planned test descriptions, incomplete assertions, and dead code can match. The module neither proves business behavior nor verifies a test was run or passed. Actual runtime/test execution evidence must come from a separate execution and acceptance process.

For the simulated customer fixture, two criteria are evidenced, three are potential mismatches, one is unverified, and four listed edge cases lack test source evidence. The draft variant has six unverified criteria while retaining preliminary matches. The [workspace draft](../fixtures/requirements/workspace-draft-checklist.json) and [workspace confirmed simulation](../fixtures/requirements/workspace-confirmed-simulation-checklist.json) map split `backend` and `frontend` roots: confirmation gives one evidenced criterion, one potential mismatch, and one missing listed edge case; the draft keeps both criteria unverified. All results remain runtime-unverified. The sample browser test is source only, with no configured runner or execution evidence.

Verification is in [test/requirements.test.js](../test/requirements.test.js): draft handling, confirmation assertions, multiple positive/negative criteria, stale source fingerprints, hash tampering, exact evidence, safe literal/glob matching and work budgets, TS/Java test paths, missing edge cases, source decoys, combined cross-project requirements, same-path disambiguation, unknown project selectors, original nested evidence provenance, and per-project scope handling.

```sh
node --test test/requirements.test.js
```
