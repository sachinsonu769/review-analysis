# Review Analysis POC

A runnable local review model with one source graph and four review lenses: architectural guidance, dependency impact, selected code-quality checks, and structured business-requirement evidence. Java/Spring, TypeScript, React and selected Angular syntax are tested. Findings remain advisory, with source provenance and visible uncertainty. Examined application code and project configurations are not executed; no external AI is used.

## Windows: run the built app

Install Docker Desktop with Linux containers, extract the **built** ZIP, and double-click `scripts/windows/start.cmd`. Open <http://localhost:8787>. `health.cmd` checks the app; `stop.cmd` stops it. The built ZIP includes `review-analysis-image.tar.gz`, so no host Node, Java, Python or npm is needed. Docker Desktop installation and source-image builds need internet; loading the included image and using the bundled demos can run offline.

Start with React, Angular, split repositories, quality, or the business-checklist demo. Select a changed file, inspect direct and likely indirect paths, filter repositories/modules, and open source evidence. Review architecture, quality and requirements in the same surface. A checklist stays draft until the user explicitly confirms it; even confirmed matching source/test text does not prove runtime behavior.

To examine your own authorized sources, configure read-only Docker mounts and load Workspace JSON. [Windows launch and mount instructions](docs/windows-docker.md), [UI flow](ui/README.md), [workspace/report contract](docs/workspace.md), [full scope and acceptance](docs/acceptance.md), and [architecture rationale](docs/architecture.md) explain the supported model and limits. Windows-host acceptance is **NOT RUN** in this cloud environment.

## Developer installation and CLI

## Reproduce

Node.js 24+ and Git are required for source development; Python 3 is needed only for packaging. The Docker image contains the complete app runtime and PMD. `npm test` builds the typed workspace code first. Without PMD installed, its integration tests are explicitly skipped; authoritative container QA must run those tests with PMD available.

```sh
npm ci --ignore-scripts --cache /tmp/review-analysis-npm
npm test
npm run demo
npm run benchmark
```

Runtime analysis is offline after installation. Dependencies are pinned in package-lock.json: java-parser 3.0.1, TypeScript 5.9.3, ESLint 10.12.0, typescript-eslint 8.71.1 and jscpd 4.0.5. The image pins PMD 7.17.0 and base-image digests. Fixture projects are source samples, not complete built applications.

```sh
npm run build
npm start
# Open http://localhost:8787
node src/workspace-cli.js --workspace /path/to/workspace.json --as-of 2026-10-11 \
  --checklist /path/to/checklist.json --cache /tmp/review-analysis-cache \
  --out /tmp/workspace-review.json
```

Directory comparison:

```sh
node src/cli.js analyze \
  --baseline fixtures/lookup/baseline \
  --candidate fixtures/lookup/candidate \
  --rules fixtures/rules.json --as-of 2026-10-11 \
  --task 'Review the lookup API route and payload migration' \
  --format readable
```

Pre-code task guidance:

```sh
node src/cli.js guide --root fixtures/lookup/baseline \
  --rules fixtures/rules.json \
  --task 'Prepare a lookup API migration' \
  --paths backend/src/main/java/com/example/lookup/LookupController.java,frontend/src/api/lookupApi.ts
```

Exact Git commits or dirty working tree (use a separately authorized target repository):

```sh
node src/cli.js analyze --repo /path/to/authorized/repository \
  --base BASE_SHA --head HEAD_SHA \
  --rules /path/to/rules.json --as-of 2026-10-11 \
  --cache /tmp/review-analysis-cache --out /tmp/review-report.json
# Replace HEAD_SHA with worktree for current sources; dirty report cache is bypassed.
```

Cache and output must be outside the examined roots. Default output is JSON on stdout; `--format readable` makes a plain-text report. Exit 0 means an advisory report was produced, including any unknowns/findings. Exit 2 means invalid input/read failure. Rules/date/revisions are explicit. `--baseline-rules` permits policy version/severity comparison. `npm run demo` writes samples in `reports/`; those writes are outside the fixture roots it examines.

## What to inspect

- [Structured sample](reports/lookup-change.json) and [readable sample](reports/lookup-change.txt): changed declarations, baseline/candidate provenance, direct caller/import/endpoint edges, likely indirect React chains, confidence/unknowns, findings and focused test suggestions.
- [Pre-code guidance](reports/pre-code-guidance.txt): task, applicable rules, owners, versions and example review status.
- [Fixtures](fixtures/README.md): original and renamed equivalent applications plus dynamic/ambiguous/missing-source, deletion/rename and approval-expiry cases.
- [Architecture](docs/architecture.md), [Java extractor](docs/java-parser.md), [TypeScript extractor](docs/typescript-parser.md): decisions and exact supported/unsupported behavior.
- [Verification](docs/verification.md) and [benchmark](reports/benchmark.json): executed checks, exact build identities, QA and measurements.

There are no real human-approved rules/examples supplied with this task. Rules are illustrative demonstrations within the agreed task scope; proposed examples stay unreviewed. Synthetic reviewed examples/exceptions are visibly simulated. A deployment's genuine owner/reviewer evidence must come from its human governance process. Configured approvals are input assertions, not independently authenticated by the engine.

The graph is source-only and conservative. Direct dependencies into changed files can include unrelated members; indirect paths are likely impact, not guaranteed execution. Cross-project edges require explicit mappings. Paths retain their baseline or candidate phase and are bounded representative chains. Java type-overload resolution, inheritance/DI/reflection, generated symbols, unconfigured TS package aliases/reexports, Angular template/RxJS behavior, runtime origins/proxies and complete dependency coverage remain unsupported. Quality and SOLID signals are selected checks, not universal correctness. Requirements evidence is literal source/test text, not executed acceptance.

## Package

```sh
python3 scripts/package.py --out /tmp/review-analysis-source.zip --label review-analysis-source
# After a verified Docker build/export:
python3 scripts/package.py --out /tmp/review-analysis-built.zip --label review-analysis-built \
  --image /tmp/review-analysis-image.tar.gz --image-id sha256:EXACT_IMAGE_ID
```

The ZIP contains source, compiled typed code, UI, lockfile, fixtures, tests, Docker/Compose files, Windows launchers, docs, reports and a per-file SHA256 manifest. The built variant also contains the exact exported image. It excludes .git and host node_modules. Initial checkout base: `7bc0c7adbc4de0165cb9ba2ea6b1b58e03ebba0d`. Publication is authorized only to the dedicated `sachinsonu769/review-analysis` review branch after technical verification; no merge or deployment is authorized.

The 7/10 call estimate was subjective potential, not measured efficacy. The accepted v0.1 CLI evidence remains in reports/qa-v1 and reports/qa-v2. The expanded v0.2 model provides repeatable fixture demonstrations; Windows and real-private-repository acceptance require the user's separate checks.
