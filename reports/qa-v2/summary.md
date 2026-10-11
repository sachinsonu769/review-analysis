QA-v2 passes the bounded source-only POC acceptance scope. No tested-scope blockers remain.

ZIP SHA256: `a140834fe7d26c707a04dc43ae225178bc39756154ca52e63f8dd7db91582897`
Source tree: `97c934ed0473448f478ec731f056ba292febc1d76e2fdb532a1ad434e12cf241`
Analyzer: `ca04bac50b7584aaafd9d5602acc8055152e81e25de5fa1b15bb710f76f53ac9`

All 124 manifest files match before and after execution; ZIP membership also matches the manifest plus BUILD-MANIFEST.json. The freshly installed packaged suite passes 65/65. All 16 original manual adversarial cases and two nearby positive cases pass through actual JSON/readable CLI. 1926 source evidence records reproduce exact revisions, SHA256 hashes, inclusive source ranges and excerpts. 83 command/assertion check records pass; these are evidence records, not additional implementation tests.

Six prior incorrect targets are repaired: Java one-versus-ten argument matching; constrained HTTP route guessing; nested object/namespace calls; conflicting Java imports; and sloppy-JS with-object HTTP shadows. Supported one- and ten-argument Java calls, unconstrained templates, and the global fetch outside the with body still resolve. Varargs/inherited overload cases now produce explicit ambiguity/unsupported dispatch rather than incompatible targets.

Routine CLI retests cover original/renamed fixtures and guidance, exact synthetic Git commits, repeated/dirty caches, rule/date/task/analyzer changes, cache corruption, source read-only checks, direct/symlink/dangling/parent-traversal output/cache guards, sibling-prefix output, deletion/renames, missing/malformed input, source symlinks, and simulated/unreviewed/expired exception behavior (including endpoint suppression). CLI v2 against the existing v1 cache recomputed under the new analyzer build identity.

The corrected benchmark edits an existing API file, changing its hash. Incremental parsing: one file parsed, 42 reused. This tiny source fixture measured 643.47 ms median fresh CLI wall time, 122.7 ms median analyzer time, 2.69 ms warm same-process report access, and 5.54 ms incremental analysis. These measurements do not establish real-project scale or regression savings.

Raw commands/timing, stdout/stderr, JSON/readable reports, manually constructed input files and synthetic Git history are preserved here. QA-v1 failure evidence remains in the adjacent qa-v1 directory.

No UI, full application compilation/regression, real private repository acceptance, human approval authentication, remote push or deployment was performed. Fixture projects are intentionally incomplete sources. The demo script was not run because it rewrites immutable packaged reports; its CLI-equivalent behaviors were exercised. Final distribution envelope verification will separately confirm that executable sources remain byte-identical to this tested build.
