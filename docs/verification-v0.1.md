# Historical accepted v0.1 CLI verification

This record describes the earlier bounded CLI only. Current expanded model evidence is in verification.md.

# Verification record — bounded engine/CLI accepted after independent retest

Dedicated environment: `/workspace/review-analysis`, private remote `sachinsonu769/review-analysis`, GitHub ID 1414531073. Initial clean writable checkout: local `work` branch identical to origin/main at `7bc0c7adbc4de0165cb9ba2ea6b1b58e03ebba0d`; no AGENTS.md or local skill instructions. Deliverable remains uncommitted local work. No unrelated repository changes or remote mutations occurred.

Milestones completed: source/environment verified; working vertical slice; independent exact-build QA found defects; fixes and exact-input retest passed; final source/report/evidence bundle prepared. The parent thread owns project-record coordination and main-chat delivery.

## Independent exact-build QA

Separate tester installed into a fresh extraction from each pinned ZIP, verified every packaged hash, ran the actual CLI, and preserved input/command/output/range/hash evidence. This was independent runtime QA, not implementer self-review.

| Build | ZIP SHA256 | Analyzer source-build SHA256 | Result |
| --- | --- | --- | --- |
| QA-v1 | 2cc8f0b4cbe0ee4e1cdbb3c00b376c412b0aa02d66791903c4a56598dd995df8 | 8ee7fcacee9a1b276b2bfab2665d8d3ab771e40eee5f3924f1f301192426e68f | Failed adversarial acceptance despite 57/57 packaged tests and 81 routine checks |
| QA-v2 | a140834fe7d26c707a04dc43ae225178bc39756154ca52e63f8dd7db91582897 | ca04bac50b7584aaafd9d5602acc8055152e81e25de5fa1b15bb710f76f53ac9 | Passed bounded source-only POC acceptance |

QA-v2: **65/65 tests; 18/18 independent manual cases, comprising original 16 adversarial cases plus 2 nearby positive controls, exercised through 36 JSON/readable CLI runs; 83 routine command/assertion records; 1,926 independently verified evidence records; all 124 original package files unchanged.** The original 16 manual source input bytes and tree identities matched QA-v1 exactly, so the retest did not weaken reproductions.

Runtime: Node 24.19.0, npm 11.9.0, Git 2.52.0, Linux x64. Exact timestamps, commands and outcomes are in [QA-v1](../reports/qa-v1/summary.json) and [QA-v2](../reports/qa-v2/summary.json), with corresponding raw logs and durable synthetic input folders. Recorded absolute paths identify the original test environment; inputs are included for reproduction, not claimed readable from another environment.

## Failures fixed and retested

- Initial review: dangling output symlink escape; same-package non-class consumers/missing Java sources; TS non-exported/namespace matches and unrelated import evidence; duplicate named-import debt; inconsistent endpoint exception suppression. Regression tests retained.
- Independent QA-v1: integer arity prefix wrongly matched 1 argument to 10; constrained Spring template overmatching; imported nested member/namespace calls pointing at receiver exports; conflicting Java import choice; JS with-object fetch shadow; varargs and inherited overload certainty. QA-v2 returns exact matches or explicit ambiguity/unsupported unknowns; all original cases pass.
- Benchmark fixture path added a comment-only file. Corrected benchmark instrumentation proves the existing API source is edited and its hash changes; **1 file parsed and 42 reused**.
- Actual cached QA-v1 report/source entries miss under QA-v2's new source-build hash with identical analyzed sources, verifying real implementation invalidation as well as rule/date/task/content changes.

Routine checks included original/renamed equivalent fixtures; declaration, endpoint, caller, import and indirect-chain evidence; missing/dynamic/ambiguous/syntax cases; unchanged debt, new import, severity worsening, rule introduction, simulated/unreviewed/expired exceptions, inclusive expiry/cache rollover; deletion/identical and edited/ambiguous renames; exact Git revisions; repeated dirty worktree bypass with unchanged sources/index/status/HEAD; corrupt cache; outside-root output/cache guards including symlink/dangling/parent traversal; sibling output allowance; JSON/readable/pre-code CLI and invalid inputs.

## Measured performance

[Implementer benchmark](../reports/benchmark.json) on 21 baseline + 22 candidate source files (10,345 bytes): median fresh-process wall **697.61 ms**, analyzer **120.86 ms**, warm report hit **2.59 ms**, incremental **6.30 ms**. Independent corrected benchmark observed 643.47 ms wall, 122.70 ms analyzer, 2.69 ms warm and 5.54 ms incremental. Tiny fixture observations in this cloud environment; no real-repository scale or efficacy inference.

## Acceptance limits

No supported-scope blocker remains in the bounded fixture POC. UI is deliberately deferred. No complete Spring/React application build, real-private-repository acceptance, runtime DI/dispatch/proxy/serialization validation, or full regression has been performed. Focused tests in analyzer reports are suggestions, not execution results. Genuine rule/example/exception approval evidence was not supplied; all shipped approval records are proposed or explicitly simulated.

The final bundle adds documentation and raw QA records around the exact executable files tested in QA-v2. Its own SHA256 and per-file manifest are reported on delivery; final envelope/source equivalence and CLI smoke are checked independently before upload. No PR, push, merge or deployment. The call's 7/10 estimate remains subjective potential, not measured efficacy.
