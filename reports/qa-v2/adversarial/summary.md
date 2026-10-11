# Independent adversarial exact-build QA — v2

**Outcome: PASS within the bounded source-analysis scope.** The unchanged sixteen v1 cases and two added positive controls passed the real JSON and readable CLI: 18 pass, 0 fail, 0 not-run, 36 CLI invocations. No remaining supported blocker.

Independently reproduced 638 evidence records: full source SHA256, inclusive line ranges, excerpts and directory tree revisions. All sixteen baseline/candidate input sets are byte-identical to v1 and their tree revisions match. All 124 packaged manifest entries match before and after; the extracted build stayed unchanged.

Artifact ZIP SHA256 supplied by parent: `a140834fe7d26c707a04dc43ae225178bc39756154ca52e63f8dd7db91582897`. Analyzer implementation/lockfile hash: `ca04bac50b7584aaafd9d5602acc8055152e81e25de5fa1b15bb710f76f53ac9`. Manifest SHA256: `87d4a883a987672fd0441b660ef0026163ef00e7cc2536b4dbb97413cd72d344`. Runtime Node v24.19.0, npm 11.9.0; exact commands, UTC times and wall durations are in the driver timing JSON files. Original cases: 16.987 seconds; supplemental controls: 2.196 seconds. These are QA driver observations, not application benchmarks.

| Retested failure / positive control | Result | Evidence |
| --- | --- | --- |
| 04-java-arity-prefix | PASS — No `/10` edge for one argument; unresolved-call is visible. | [raw JSON](04-java-arity-prefix/stdout.json), [checks](04-java-arity-prefix/checks.json) |
| 08-http-template-regex | PASS — Regex route produces unsupported-route-constraint; no falsely matched literal request. | [raw JSON](08-http-template-regex/stdout.json), [checks](08-http-template-regex/checks.json) |
| 11-ts-namespace-nested-member | PASS — Object container is not a call target; unresolved-imported-member remains. | [raw JSON](11-ts-namespace-nested-member/stdout.json), [checks](11-ts-namespace-nested-member/checks.json) |
| 12-java-ambiguous-explicit-imports | PASS — Conflicting imports no longer pick first receiver; unresolved-call remains. | [raw JSON](12-java-ambiguous-explicit-imports/stdout.json), [checks](12-java-ambiguous-explicit-imports/checks.json) |
| 13-ts-namespace-contract-member | PASS — Namespace container is not a call target; unresolved-imported-member remains. | [raw JSON](13-ts-namespace-contract-member/stdout.json), [checks](13-ts-namespace-contract-member/checks.json) |
| 14-js-with-lexical-shadow | PASS — with_dynamic_scope prevents fabricated body HTTP edge; outside global fetch still maps. | [raw JSON](14-js-with-lexical-shadow/stdout.json), [checks](14-js-with-lexical-shadow/checks.json) |
| 15-java-varargs-overload | PASS — ambiguous-call contains both candidate declarations; no incompatible fixed overload. | [raw JSON](15-java-varargs-overload/stdout.json), [checks](15-java-varargs-overload/checks.json) |
| 16-java-inherited-overload | PASS — java-inheritance-dispatch preserves call uncertainty; type/import chains remain. | [raw JSON](16-java-inherited-overload/stdout.json), [checks](16-java-inherited-overload/checks.json) |
| 17-positive-exact-java-arity | PASS — One and ten arguments select exact `/1` and `/10` declaration keys. | [raw JSON](positive-controls/17-positive-exact-java-arity/stdout.json), [checks](positive-controls/17-positive-exact-java-arity/checks.json) |
| 18-positive-unconstrained-template | PASS — Simple/query/trailing and longer templates still match; placeholder cannot span a slash. | [raw JSON](positive-controls/18-positive-unconstrained-template/stdout.json), [checks](positive-controls/18-positive-unconstrained-template/checks.json) |

The other eight unchanged cases pass lexical shadows, named/namespace binding controls, missing/ambiguous modules, ordinary overload and receiver scopes, pattern shadows, literal versus constant Java routes, duplicate controllers, malformed Java/TS diagnostics, and conservative coverage flags. Relevant uncertainty is present in readable reports as well as JSON.

Varargs, inheritance, constrained route regexes, imported nested member resolution and with-object scope remain documented unsupported semantics. The fix is conservative: these calls/routes now stay unknown instead of acquiring the wrong declaration. Positive controls establish that ordinary exact arities, unshadowed global/axios calls, named/namespace imports and unconstrained templates continue to resolve.

A read-only review also observed conservative suppression for generic-bound class headers under the inheritance guard. This stays a support-boundary observation; no complete generic or inheritance dispatch is claimed. No private-repository acceptance, application compilation/execution, UI, real network AI request, remote push, merge or deployment was run.

Artifacts preserve the original sixteen-case `summary.json`, unchanged runner copy, per-case command/JSON/readable stdout/stderr/checks/input files, and added controls under `positive-controls/`. `combined-summary.json` is the full result. `resolved-failure-evidence.json`, `v1-v2-input-comparison.json`, `readable-unknown-verification.json` and `after-manifest-verification.json` contain supporting verification. `all-commands.json` contains all 36 CLI commands.
