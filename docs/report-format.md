# Structured report semantics

CLI defaults to JSON. `schemaVersion: "1.0"` identifies this POC shape; source code exports `analyze(options)` and `preCodeGuidance(options)` for deterministic local use. Timing/cache observations can differ between equivalent runs; semantic source evidence is stable for a pinned input/build/config/date.

| Field | Meaning |
| --- | --- |
| `analyzer` | Version, implementation+lockfile SHA256 and pinned parser versions |
| `provenance` | Each snapshot type/root/revision/content hash/dirty state, rules hashes, exact report cache key |
| `changes` | Added/deleted/modified/identically renamed declaration; extracted contract-change flag; before/after source evidence |
| `impact.direct` | Conservative file dependency into a changed file, kind/confidence/reason, source/target evidence, declaration key only when known |
| `impact.indirect` | Likely file dependency with a same-revision source-edge chain; low confidence |
| `findings` | Rule owner/version, severity, new/pre-existing/worsened/resolved classification, source evidence, explicit exception status and advisory suppression |
| `guidance` | Developer task, applicable rule owners/versions/instructions, proposed/simulated/asserted example review status and verifiable source evidence |
| `unknowns` | Recognized unresolved/dynamic/ambiguous/external/missing/unsupported source references and syntax diagnostics |
| `focusedTests` | Suggested compatibility, consumer and likely indirect tests; never a record of execution |
| `coverage` | Always incomplete; fullRegressionMayBeSkipped is false; examined source-file counts, excluded sources and limitations |
| `cache` | Report disabled/miss/hit/bypass-dirty; parsed/reused-file counts and corrupt-entry misses |
| `metrics` | Elapsed analysis milliseconds, source byte count and report-cache-hit flag |

Source evidence has relative `path`, 1-based inclusive `range`, exact `revision`, full UTF-8 file `fileHash` SHA256, and an `excerpt` reproducing the corresponding complete lines. A directory revision is the SHA256 identity of the supported source path/hash set, not a Git commit or a guarantee about unsupported assets. No clickable repository source URLs are invented.

A high-confidence relative import proves which supplied source file its literal path names within the bounded resolver. Medium-confidence Java calls rely on lexical receiver type and unique method name/arity; HTTP edges match source literals with Spring annotations. No confidence label proves runtime dispatch, proxy/origin configuration, payload dataflow or complete coverage. A file can be both a direct dependency on an edited TypeScript API file and indirectly dependent on its HTTP endpoint.

Retained import debt is classified under current policy. An added policy rule can mark `newlyApplicableRule: true` while code debt stays pre-existing. Severity escalation with supplied prior policy is `worsened`, `changeCause: rule-policy`. Missing prior policy means the caller elected to apply current rules to both source snapshots; prior governance cannot be reconstructed. Multiple imported bindings/statements from one module share a finding and retain `additionalEvidence`.

A reviewed exception is an assertion in supplied configuration, requires reviewer/evidence/valid expiry, and can be `asserted-active`, `simulation-active`, `expired`, `unreviewed` or `invalid-expiry`. Active status affects advisory suppression, never source analysis or tests. Synthetic records are demonstrations only. The expiry date is inclusive; `--as-of` supplies the explicit analysis date. Reviewed source examples lacking hash+revision pins are `asserted-reviewed-unpinned`; mismatched source is `stale-source`, unavailable source is `missing-source`, and impossible configured ranges are `invalid-source-range` with no invented excerpt.

Use `--baseline-rules` when prior policy matters. For stable exact-commit comparisons use explicit commit SHAs. Cache hits still scan/read source snapshots and validate content/config/build keys; they do not authorize skipping tests.
