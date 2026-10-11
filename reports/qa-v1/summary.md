QA-v1 fails acceptance; repairs require a fresh artifact retest.

ZIP SHA256: `2cc8f0b4cbe0ee4e1cdbb3c00b376c412b0aa02d66791903c4a56598dd995df8`
Source tree: `5b05da471692520b2b28f6939ee02683d6c4b9908a89b1c91cd5e05edf4fa943`
Analyzer: `8ee7fcacee9a1b276b2bfab2665d8d3ab771e40eee5f3924f1f301192426e68f`

All 121 manifest files match before and after testing. Node v24.19.0, npm 11.9.0, Git 2.52.0. The packaged suite passes 57/57. 81 independent routine checks pass. 1816 source evidence entries were checked against exact revisions, file hashes, inclusive ranges, and excerpts.

Six supported-scope adversarial cases block acceptance, alongside the invalid incremental benchmark edit. Two additional strict semantic-target checks expose documented unsupported argument typing/inheritance; they are recorded separately.

- 04-java-arity-prefix: Single-argument call cannot target a ten-argument declaration Evidence: adversarial/04-java-arity-prefix.
- 08-http-template-regex: Template regex constraints must not claim a literal nonmatching request maps to configured route Evidence: adversarial/08-http-template-regex.
- 11-ts-namespace-nested-member: Nested property method on namespace import must not claim the container variable is the called declaration Evidence: adversarial/11-ts-namespace-nested-member.
- 12-java-ambiguous-explicit-imports: Conflicting explicit imports cannot acquire a guessed first-import receiver target (source is semantically invalid) Evidence: adversarial/12-java-ambiguous-explicit-imports.
- 13-ts-namespace-contract-member: Nested exported namespace method must use qualified member declaration or explicit uncertainty Evidence: adversarial/13-ts-namespace-contract-member.
- 14-js-with-lexical-shadow: Sloppy-script with object supplies custom fetch; outside global fetch remains a control Evidence: adversarial/14-js-with-lexical-shadow.
- benchmark-incremental-path: Packaged benchmark creates frontend/src/lookupApi.ts comment-only file instead of changing existing frontend/src/api/lookupApi.ts. Real API hash unchanged. Cold/warm timings remain a tiny-fixture measurement; incremental timing is invalid for an edit. Evidence: benchmark-probe.json.

Actual commands and timing are in commands.jsonl and adversarial case command files. Raw stdout/stderr, JSON/readable reports, manifest checks, synthetic Git input archive, and manual source inputs are retained in this directory.

Passing checks include original/renamed fixture CLI outputs, pre-code guidance, exact Git revisions, dirty report-cache bypass, source read-only checks, cache corruption and rule/date/task/analyzer invalidation, output/cache symlink and traversal guards, deletion/rename, source symlink exclusion, malformed input errors, simulated and unreviewed approval behavior, and inclusive exception expiry with date cache rollover (including endpoint suppression).

No UI, full application compilation/regression, private repository acceptance, human governance authenticity, remote push, deployment, or efficacy testing was performed. The fixture projects are incomplete source samples. The demo script was not executed because it would overwrite immutable packaged reports; equivalent actual CLI commands were run. Analyzer-version invalidation used the public engine API, with no source mutation.
