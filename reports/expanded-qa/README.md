# Expanded 0.2 independent exact-build QA

Technical verdict: PASS for the pinned QA1 runtime source and image. All 121 tests passed with zero skips and actual PMD available. All 37 API/browser checkpoints passed against the actual container. There are no known blocking implementation defects in the executed scope.

`qa-verdict.json` records pins, totals, scope, and limitations. `pin-1/image-source-match.json` confirms all 184 production files including compiled app-dist match the pinned source. `pin-1/post-test-preservation.json` confirms 951 original source-manifest files and 37 input files, including the Git index, remained unchanged. Raw command, response, and test logs are retained beside their result files. The scripts and synthetic text inputs make the independent probes reviewable.

## Preserved failures and environment corrections

The initial full suite recorded 120 passes and one failure because its trusted fake executable was on the same noexec tmpfs used by the application. The unchanged suite then passed 121/121 with an explicit exec tmpfs only for trusted test fixtures; assertions were not changed and no tests were skipped. The application continued to run on delivered read-only/noexec defaults. See suite-environment-adjustment.json and app-runtime-verification.json.

The initial foreign-owned fixture preparation failed before analysis and was retried after correcting fixture ownership. The first browser run could not connect because a QA-only internal network prevented port publication; the successful run used the delivered default network. These original failures and corrected runs are preserved. `compose-final-configuration-verification.json` and `compose-config-final-default-network` describe the successful application configuration. The earlier `compose-configuration-verification.json` describes the superseded QA-only internal network and should not be used as the final configuration.

## Boundaries

Windows Docker Desktop and CMD execution were not run. Cloud Docker/Compose and real Chromium were used. Fixture coverage does not certify arbitrary private repositories, every design heuristic, or runtime business behavior. The final user ZIP has not yet been independently pinned and verified; the runtime verdict applies to the recorded QA1 source archive/image. Internal screenshots, binaries, node_modules, and extracted source copies are excluded from this report payload.
