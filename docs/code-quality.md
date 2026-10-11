# Source code quality checks

The quality stage runs selected static checks on the supplied baseline and candidate snapshots. Findings are advisory, carry source evidence, and describe the analyzer's observation. A detected pattern can be evidenced even when its runtime consequence remains potential. An empty result does not establish correctness or authorize skipping regression tests.

## Tools and trusted configuration

| Tool | Pinned version | Scope |
| --- | --- | --- |
| ESLint `Linter` API | `10.12.0` | `.js`, `.jsx`, `.ts`, `.tsx` source |
| `@typescript-eslint/parser` and plugin | `8.71.1` each | TypeScript syntax and selected syntax-only rules |
| jscpd | `4.0.5` | Token clone detection across supplied Java and JS/TS sources |
| PMD | `7.17.0` | Selected Java rules, Java 21 language mode |

ESLint receives source text and an analyzer-owned flat configuration object through [`Linter.verify`](https://eslint.org/docs/latest/integrate/nodejs-api#linter). It does not discover or import the examined repository's ESLint configuration, plugins, or processors. `allowInlineConfig: false` prevents source comments from changing the selected rules. Autofixes are not applied.

Parsing is source-only: no `parserOptions.project` or `projectService`, no repository `tsconfig` loading, and no type-aware linting. JSX/TSX and Angular-style TypeScript decorators are accepted syntactically; Angular templates, dependency injection, lifecycle behavior, and build validity are outside these checks. The parser supports explicit decorator options without a TypeScript project. [Parser options](https://typescript-eslint.io/packages/parser/)

jscpd and PMD receive only accepted snapshot files materialized into a fresh temporary directory outside the examined roots, with analyzer-owned options and rulesets. Repository build scripts, package installs, application code, and repository tool configurations are never executed. Temporary source copies support the analyzers; evidence points back to the original snapshot path, revision, hash, and lines.

The optional policy fragment is:

```json
{
  "quality": {
    "complexityThreshold": 10,
    "duplication": { "minTokens": 50, "minLines": 5 },
    "pmdEnabled": true
  }
}
```

## Selected checks

| ESLint rule | Observation and practical limit |
| --- | --- |
| [`complexity`](https://eslint.org/docs/latest/rules/complexity) | Classic cyclomatic complexity exceeds 10 by default; a maintainability signal, not a bug. |
| [`no-unreachable`](https://eslint.org/docs/latest/rules/no-unreachable) | Selected unreachable control-flow statements; does not find all unused or dead code. |
| [`no-constant-condition`](https://eslint.org/docs/latest/rules/no-constant-condition) | Constant test expressions; deliberate fixed conditions require review. |
| [`no-constant-binary-expression`](https://eslint.org/docs/latest/rules/no-constant-binary-expression) | Selected comparisons or short-circuit expressions have a constant outcome. |
| [`no-dupe-else-if`](https://eslint.org/docs/latest/rules/no-dupe-else-if) | Repeated/subsumed conditions in a branch chain; behavior can still depend on side effects. |
| [`no-unsafe-finally`](https://eslint.org/docs/latest/rules/no-unsafe-finally) | Control flow in `finally` may replace an earlier completion. |
| [`no-async-promise-executor`](https://eslint.org/docs/latest/rules/no-async-promise-executor) | An async executor may lose error propagation through the outer Promise. |
| [`require-atomic-updates`](https://eslint.org/docs/latest/rules/require-atomic-updates) | A read/update across `await` or `yield` may race; actual sharing/interleaving is unverified. |
| [`@typescript-eslint/no-non-null-assertion`](https://typescript-eslint.io/rules/no-non-null-assertion/) | A postfix non-null assertion bypasses a check; does not prove the value can be null. |
| [`@typescript-eslint/no-non-null-asserted-optional-chain`](https://typescript-eslint.io/rules/no-non-null-asserted-optional-chain/) | A non-null assertion follows optional chaining; actual nullability is unverified. |

Both non-null rules can report the same expression. They check expression assertions, rather than proving Angular's definite-assignment fields unsafe. No type-aware Promise, null-flow, or exception analysis is claimed.

PMD uses an explicit four-rule ruleset:

| PMD rule | Observation and practical limit |
| --- | --- |
| [`CyclomaticComplexity`](https://docs.pmd-code.org/pmd-doc-7.17.0/pmd_rules_java_design.html#cyclomaticcomplexity) | Method reporting starts at `complexityThreshold + 1` (11 by default); class aggregate reporting starts at 80 independently. Java and ESLint complexity values use different counting rules. |
| [`BrokenNullCheck`](https://docs.pmd-code.org/pmd-doc-7.17.0/pmd_rules_java_errorprone.html#brokennullcheck) | A recognized boolean/null-check pattern may dereference null; reachability and runtime inputs remain unverified. |
| [`CloseResource`](https://docs.pmd-code.org/pmd-doc-7.17.0/pmd_rules_java_errorprone.html#closeresource) | A recognized resource may lack expected closing; external resource types and ownership transfer may be unresolved. |
| [`UnconditionalIfStatement`](https://docs.pmd-code.org/pmd-doc-7.17.0/pmd_rules_java_errorprone.html#unconditionalifstatement) | A direct boolean-literal `if` condition; this is not general Java unreachable-code analysis. |

PMD does not run `javac` or obtain the application's build classpath. Type resolution, generated methods, framework-managed resource ownership, and runtime exception paths are incomplete. `SimplifyBooleanReturns`, duplicate-literal rules, and the general PMD rule categories are not enabled.

jscpd uses `strict` mode and reports token clones with default minima of 50 tokens and 5 lines. Strict mode compares all token types, including whitespace and newlines, apart from marked ignored blocks. These are token matches within supported formats, not semantic equivalence or proof of harmful duplication; short, renamed, or rewritten equivalents can be missed. It is the dedicated duplication detector; a PMD CPD-compatible report format would not mean PMD CPD was run. [Pinned jscpd v4 documentation](https://github.com/kucherenko/jscpd/blob/87a118f80343288c0099a4e3e47ccd875476bf6c/README.md)

## Evidence, change classification, and gaps

The quality result contains `tools`, `findings`, `unsupported`, `metrics`, and `configHash`. Findings retain tool/rule identity, severity, certainty, fingerprint, and original source evidence. `basis: "analyzer"` means a selected tool observed the pattern. Severity sets review priority; certainty states what the observation establishes.

Baseline/candidate comparison identifies `new`, `pre-existing`, `worsened`, and `resolved` findings using fingerprints that exclude line positions. Magnitudes, when available, show the measured change. If a candidate check is uncovered, earlier debt remains `candidate-unverified` instead of being falsely resolved. Moving a finding between lines alone should not create new debt; fingerprints are bounded matching, not universal rename recognition.

Source suppressions are coverage limitations: ESLint directives are disabled; PMD's ordinary `NOPMD` marker is replaced by an analyzer-owned sentinel, but Java `@SuppressWarnings("PMD...")` can still suppress selected rules; jscpd's ignore-block markers may exclude clones. Such suppressions are not authenticated architecture approvals. [PMD suppression behavior](https://docs.pmd-code.org/pmd-doc-7.17.0/pmd_userdocs_suppressing_warnings.html)

Tool availability, parse failures, excluded files, and unsupported syntax belong in the report. Findings establish only the reported checks on the accepted source snapshots. Full language compilation, runtime tests, complete exception/resource analysis, and private-repository acceptance remain separate work.
