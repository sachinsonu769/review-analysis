# Visible review workspace

The browser client is self-contained HTML, JavaScript, and CSS. The local server serves `index.html`, `app.js`, and `styles.css` and provides `GET /api/demos` and `POST /api/analyze`. There are no client libraries, CDN requests, external fonts, AI calls, or publishing steps.

## User flow

1. Open the server URL. The React + Spring fixture loads automatically, with no confirmed requirement checklist.
2. Select React, Angular, or split repositories, enter the **Developer review task**, and press **Analyze change**. The task is submitted to the engine and displayed with the returned architecture guidance. The analysis summary, graph, evidence panel, and shared review surface update from the same returned report.
3. Choose a changed source in **Change to trace**. The graph opens its impact neighborhood; the **Dependency impact** lens lists canonical engine paths for that selected target. Select a path to highlight its nodes and exact edge IDs. Baseline and candidate path provenance is visible, and the browser never reconstructs cross-revision paths.
4. Inspect a graph node, graph edge, finding, requirement source match, or test-source match. The evidence panel shows supplied source path, line range, revision, full-file SHA256, and excerpt. Strings are inserted using `textContent`; source and checklist text cannot become HTML.
5. Search or filter by project, repository, module, changed status, graph detail, or edge certainty. Disable **Impact neighborhood** to see the broader graph. Nodes and arrows retain typed graph identity; arrow direction is source → dependency. Fit, pan, zoom, and keyboard navigation are available.
6. Change the shared review lens between architecture, dependency impact, code quality, and requirements. The graph and evidence remain visible.
7. In **Requirements**, edit or upload structured JSON. Explicitly check the intent confirmation and press **Review confirmed checklist**. Editing the draft clears confirmation. The submitted confirmation is visibly an assertion; existing simulation metadata is preserved. Requirement results show `assessment`, source and test checks, edge-case results, and runtime uncertainty.
8. To analyze mounted user sources, expand **Review your own mounted sources**, edit or load the workspace JSON, and check **Use this workspace configuration** before analyzing. User source paths must be read-only mounted under `/inputs`; server-side validation is authoritative. The server returns clear validation errors without changing source files.
9. Export the complete current JSON report with **Export report**.

## Browser acceptance checks

- Initial load completes with no browser error; summary counts match the API report.
- The developer review task has a useful default. Editing it submits the exact text in `POST /api/analyze`; architecture guidance displays the engine-returned task as plain text.
- All three fixture demos can be analyzed. Split-repository graph nodes have project/repository filters; mapped edges expose their mapping ID and source evidence.
- Changing the source selects the same graph node ID and refreshes canonical `impact.paths` whose target is that source. Direct and likely-indirect filters show appropriate paths. Path selection highlights only its `edgeIds` and `nodeIds`.
- Candidate-only and baseline-only edges are never combined in a displayed path. Each path displays its supplied phase and confidence. The graph itself can include both phases, with provenance available on edge inspection.
- Search and filters narrow the graph and support an empty state. Clearing them restores nodes. Fit restores the viewport; pan and zoom alter the SVG transform.
- Selecting graph nodes, edges, architecture/quality findings, and requirement source/test-source matches displays correct path/range/revision/hash/excerpt. Evidence may be missing; the UI explicitly says so.
- Architecture shows rule, owner, severity, classification, exception state/expiry, and simulated approval markers. Quality shows supplied checker name/version/status and unsupported checks.
- No checklist is automatically confirmed. Applying one is disabled until the confirmation checkbox is selected. Changing JSON clears that checkbox. Invalid JSON shows an error. Confirmed criteria display engine `assessment` and edge-case `assessment`, not an invented pass/fail verdict.
- Loading a workspace JSON enables the explicit workspace override; an invalid configuration shows a server/client error without silently substituting a demo.
- Exported JSON equals the current API report; exported filename identifies the analyzed demo.
- Keyboard Tab reaches every control and graph node; Enter/Space selects nodes; left/right arrows navigate review tabs; graph +/- zoom, 0 fits, and arrow keys pan. A skip link leads to the workspace. Loading/error updates use a live region.
- At a 390 px viewport, controls wrap, graph/evidence stack, review tabs scroll, and no document-level horizontal overflow occurs.

## Stable selectors

Global: `demo-select`, `review-task`, `analyze-button`, `app-status`, `summary-strip`, `report-download`.

Graph: `graph`, `graph-node` (`data-node-id`), `graph-edge` (`data-edge-id`), `source-select`, `project-filter`, `repository-filter`, `module-filter`, `graph-search`, `changed-only`, `impact-only`, `node-level`, `certainty-filter`, `phase-filter`, `graph-fit`, `zoom-in`, `zoom-out`, `node-evidence`, `declaration-evidence`.

Review: `review-tab-architecture`, `review-tab-impact`, `review-tab-quality`, `review-tab-requirements`, `review-content`, `finding-filter`, `finding-card`, `finding-evidence`, `impact-mode`, `impact-path`, `requirements-status`, `requirement-criterion` (`data-assessment`), `checklist-json`, `checklist-file`, `confirm-checklist`, `apply-checklist`.

Custom sources: `workspace-config`, `workspace-json`, `workspace-file`, `workspace-enable`.

## Bounded presentation

The UI consumes the canonical typed graph and canonical engine impact paths. It does not add inferred dependency edges or execute project code. The initial view favors files/endpoints and the selected impact neighborhood; declaration counts and inspectable declaration evidence are available when supplied. Lists initially show a bounded number of findings, paths, or excerpts, with expansion controls or an explicit export note. The complete report remains downloadable. Source-static findings and literal test-source matches do not establish runtime behavior or authorize skipping regression.
