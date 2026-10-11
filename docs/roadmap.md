# Tested capabilities and remaining roadmap

| Area | Implemented model | Remaining scope / limits |
|---|---|---|
| Java/Spring | CST declarations, DTO/member contracts, verified explicit mapping annotations, literal routes, conservative typed receiver calls | Complete type/overload/DI/runtime resolution, reflection/generated sources and constrained routes unsupported |
| TS/JS | Compiler API declarations, lexical references, relative imports, literal fetch/axios | No project semantic compilation, dynamic/computed resolution, unconfigured aliases/reexports or payload flow |
| React | TSX declarations/component references and source import chains | Render/hooks/runtime/user acceptance unverified |
| Angular | Verified Component/Injectable/NgModule metadata and typed HttpClient literals; renamed fixtures | Templates, DI implementations, RxJS execution and generated/build wiring unverified |
| Projects | Monorepo directory modules, multiple roots, explicit HTTP/package-source mappings | Real source layouts and deployed topology require supplied mappings/acceptance |
| Architecture/SOLID | Governed import/contract rules, ownership/version/examples/expiry; selected parameter/method/field/cycle signals | Genuine approvals absent; signals do not establish SRP/OCP/LSP/ISP/DIP correctness |
| Quality | Pinned trusted ESLint/typescript-eslint, jscpd and PMD selected checks | No universal null/resource/async proof, type-aware project rules or exhaustive analyzers |
| Requirements | Confirmed input checklist, literal source/test mapping, missing edges, cross-project provenance | Business understanding, test execution, completeness and runtime compliance unverified |
| Local app | Built Linux amd64 image, Compose, Windows start/health/stop, exports | Actual Windows Docker Desktop host NOT RUN; other architectures untested |

Next acceptance should use an explicitly authorized representative real repository and human-reviewed policies/checklist, compared with runtime/full-regression outcomes. No private repository was examined. No deadline, efficacy percentage or complete coverage is guaranteed.
