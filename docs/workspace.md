# Workspace and central graph contract

`app/graph-model.ts` defines the graph consumed by `analyzeWorkspace` and the UI. It deliberately uses **file nodes**, with typed declaration facts and their own evidence inside each node. Edges retain target declaration keys when resolved. Selecting a declaration inspects source; impact remains a conservative file dependency calculation, not complete semantic dataflow.

Each edge has a stable ID, source/target IDs, kind, certainty, reason, baseline/candidate phase, source and target evidence, and optional explicit mapping ID. Evidence retains project ID, relative path, inclusive line range, original revision, file SHA256 and excerpt. Deleted files retain baseline evidence. File hash differences mark changes even for import-only edits. All stages consume the same acquired snapshots.

Canonical paths come from this module, not the browser. They preserve phase, bound cycles/depth at 12 and use representative expansion per node. Indirect chains remain low certainty. Alternate/deeper coverage is incomplete and explicit. Source dependency paths do not prove execution.

## Input

```json
{"version":"workspace-1","projects":[
  {"id":"backend","repository":"team/backend","module":"Spring API",
   "baseline":{"type":"git","root":"/inputs/backend","revision":"BASE_SHA"},
   "candidate":{"type":"worktree","root":"/inputs/backend"},
   "rules":{"version":"rules-1","rules":[]}},
  {"id":"frontend","repository":"team/frontend","module":"Web app",
   "baseline":{"type":"directory","root":"/inputs/frontend-before"},
   "candidate":{"type":"directory","root":"/inputs/frontend-after"}}
],"mappings":[{"id":"api-source","kind":"http","fromProject":"frontend","toProject":"backend",
  "urlPrefix":"/api/","owner":"Supplied team owner","version":"1"}]}
```

Replace placeholders with explicitly authorized roots/revisions. IDs are bounded strings; duplicates/unsafe mapping paths are rejected. HTTP mappings select literal URL prefixes; optional stripPrefix/routePrefix translate configured origins/base paths. A unique verb/path match yields medium certainty, with runtime still unverified. Import mappings specify an exact module specifier and supplied relative targetPath. Cross-project edges are not guessed. Projects can share a repository for a monorepo; modules:[{id,pathPrefix}] provides directory filters.

The server accepts bundled fixtures or configured read-only /inputs mounts. Paste/upload Workspace JSON in the UI. CLI: `node src/workspace-cli.js --workspace FILE --as-of YYYY-MM-DD [--checklist FILE] [--cache DIR] [--out FILE]` returns schema 2 JSON. The original single-comparison CLI retains schema 1 JSON/readable reports.

Workspace rules are governed architectural data; optional conventions configure precise selected design signals. Quality accepts data-only selected settings. Examined ESLint/PMD/npm/build configurations are not executed. [Requirement selectors](requirements-review.md) evaluate once across projects with original evidence.

## APIs and caches

GET /health, GET /api/demos and POST /api/analyze support the local UI. Analysis accepts {demo,workspace?,task?,asOf?,checklist?,quality?}. Input JSON is capped at 1 MiB; two analyses may run. Source scanning is synchronous, not a large-repository scheduler.

Parse/report keys include source/build/lock/config/date/task/revision; dirty worktree reports bypass caching. Quality additionally fingerprints trusted PMD script/jars and actual npm tool versions, configuration, both content identities and revisions. Checklists are reevaluated each run; mapping/config changes rebuild the graph. Cache/output stays outside examined roots. All snapshot modes skip symlinks and consistent generated/vendor directories.

Git reads disable hooks/fsmonitor, optional locks, lazy fetch/transports, prompts and replace refs. Only the explicitly selected canonical root is trusted via safe.directory. Missing local objects fail instead of fetching. Directory acquisition is not atomic under concurrent edits; immutable commits are preferred.
