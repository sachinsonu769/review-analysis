# Independent adversarial exact-build QA — v1

**Outcome: FAIL.** 16 independent source cases run through the real JSON and readable CLI: 8 pass, 8 fail, 0 not-run. The failures concern target certainty; every reported evidence hash, inclusive range, excerpt, and tree revision reproduced independently.

Checked 560 evidence records. All 121 packaged manifest files match before and after analysis; no extracted build or source checkout files changed. Artifact ZIP SHA256 supplied by the parent: `2cc8f0b4cbe0ee4e1cdbb3c00b376c412b0aa02d66791903c4a56598dd995df8`. Analyzer source-build hash: `8ee7fcacee9a1b276b2bfab2665d8d3ab771e40eee5f3924f1f301192426e68f`.

| Case | Status | Finding / coverage |
| --- | --- | --- |
| [01-http-lexical-static-dynamic](01-http-lexical-static-dynamic/checks.json) | PASS | Global receiver and destructured parameter shadows respected; static templates/axios match; concatenation, options variables and spreads stay unknown; duplicate properties honor final value. |
| [02-ts-import-shadow-missing](02-ts-import-shadow-missing/checks.json) | PASS | Named/namespace calls resolve source declaration; parameter and nested local shadowing avoid outer import; absent relative module stays unknown. |
| [03-ts-ambiguous-module](03-ts-ambiguous-module/checks.json) | PASS | Both .ts and .tsx candidates yield explicit ambiguous-import, no guessed call edge. |
| [04-java-arity-prefix](04-java-arity-prefix/checks.json) | FAIL | `target.run(1)` is assigned `qa.Target#run/10`; source contains ten required formal parameters. No unresolved-call. Arity prefix substring in graph permits impossible target. |
| [05-java-overload-receiver-shadow](05-java-overload-receiver-shadow/checks.json) | PASS | Same-arity overload remains ambiguous with candidate evidence; typed Object and var shadows respected; outer field restoration works. |
| [06-java-pattern-shadow](06-java-pattern-shadow/checks.json) | PASS | instanceof pattern binding does not inherit the same-named outer field receiver. |
| [07-java-static-constant-routing](07-java-static-constant-routing/checks.json) | PASS | Constant concatenation mapping stays unknown; literal and actual Java Unicode-escaped mappings remain matchable. |
| [08-http-template-regex](08-http-template-regex/checks.json) | FAIL | `/numeric/nope` gets a medium HTTP edge to `/numeric/{id:[0-9]+}`; regex constraint is discarded while report says verb/path matches. |
| [09-http-ambiguous-controllers](09-http-ambiguous-controllers/checks.json) | PASS | Two matching controllers stay ambiguous with candidates and no unique HTTP edge. |
| [10-source-parse-diagnostics](10-source-parse-diagnostics/checks.json) | PASS | Malformed Java and TS yield explicit parse unknowns; advisory, incomplete coverage and required full regression remain visible. |
| [11-ts-namespace-nested-member](11-ts-namespace-nested-member/checks.json) | FAIL | `api.service.run()` gets a high call edge to exported non-callable container variable `service`, without member-call uncertainty. |
| [12-java-ambiguous-explicit-imports](12-java-ambiguous-explicit-imports/checks.json) | FAIL | Conflicting `a.Target`/`b.Target` explicit imports narrow receiver call to first import. Semantically invalid source; lower priority robustness case. |
| [13-ts-namespace-contract-member](13-ts-namespace-contract-member/checks.json) | FAIL | `api.Api.run()` gets a high call edge to namespace `Api` despite known `Api.run` declaration; no call uncertainty. |
| [14-js-with-lexical-shadow](14-js-with-lexical-shadow/checks.json) | FAIL | Valid sloppy JS with-object `fetch` becomes a medium HTTP request to backend despite local custom callable. Generic unresolved_call does not prevent HTTP false match. |
| [15-java-varargs-overload](15-java-varargs-overload/checks.json) | FAIL | Valid two-string call chooses incompatible `run(int,int)` instead of existing `run(String...)`; no ambiguous/unresolved call. Varargs argument semantics are unsupported, so avoid a narrowed target. |
| [16-java-inherited-overload](16-java-inherited-overload/checks.json) | FAIL | Valid String argument call on Child chooses incompatible Child Integer overload instead of Base String overload. Inheritance/overload typing are documented unsupported; avoid narrowed target. |

Cases 04, 08, 11/13 and 14 directly violate the claimed literal/lexical/arity resolution. Case 12 strengthens ambiguity robustness on noncompiling input. Cases 15/16 are recorded support-boundary observations at explicitly documented semantic limits, not new hard acceptance blockers; conservative unknowns would be sufficient improvements. The eight failed adversarial expectations comprise six hard/robustness case failures and two support-boundary observations.

Each case contains the exact command arguments, JSON stdout, stderr, readable stdout/stderr, checked source hashes and durable `input/baseline`, `input/candidate`, and `input/rules.json`. `failures.json` collects the erroneous edges with their source and target evidence. `commands.json` contains all 32 CLI invocations; `run.stdout.log` is the raw execution summary. Runtime: Node v24.19.0, npm 11.9.0; raw version commands are in `runtime.log` and the driver invocation is in `driver-command.json`.

The runner lives at `run-adversarial.mjs`. It accepts `ADVERSARIAL_BUILD`, `ADVERSARIAL_CASE_ROOT`, `ADVERSARIAL_OUT`, and `ADVERSARIAL_ARTIFACT_SHA256` for a fresh extracted-build rerun. Inputs are synthetic and only read by the analyzer. No private repository, UI, app execution, real AI request, remote push, merge, or deployment was run. Exact Git/cache/output boundaries are sibling-QA scope. No claimed private-repository acceptance.
