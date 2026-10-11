# Synthetic review fixtures

These snapshots are source-analysis inputs, not a buildable application. Spring,
React, Axios, and the legacy transport library are intentionally not vendored.
Some candidate callers deliberately retain the old contract so the analyzer has
real compatibility risks to explain. All teams, reviewers, and approvals below
are synthetic test data; nobody has approved production code.

`lookup/baseline` and `lookup/candidate` model one lookup API migration:

| Evidence | Baseline | Candidate | Expected analysis |
| --- | --- | --- | --- |
| Spring controller | `GET /api/lookup` | `GET /api/catalog/lookup` | Contract change with both revisions and source lines |
| Java response record | `label` | `displayName` | DTO member contract change |
| Java service | `lookup(String)` | `lookup(LookupQuery)` | Same-arity signature change; direct Java callers |
| TS response interface | `label` | `displayName` | TS contract change |
| TS API wrapper | Fetches old literal route | Fetches new literal route | Direct known endpoint consumer |
| Axios consumer | Fetches old literal route | Still fetches old literal route | Direct known endpoint consumer requiring review |
| React panel and App | Imports API and renders panel | Retains old DTO field | Direct panel API dependency; likely indirect panel/App paths to the backend endpoint |
| Legacy transport import | Existing in service and gateways | Existing imports retained | Pre-existing findings |
| Audit logger | Absent | Imports forbidden transport | New finding |
| Retired adapter | Present | Deleted | Deletion with baseline provenance |
| Badge module | `LookupBadge.ts` | Identical body at `CatalogBadge.ts` | Rename with evidence from both paths |
| Dynamic fetch | Runtime origin/path | Same | Explicit unknown, never a confirmed endpoint match |
| Missing import | `./missingClient` absent | Still absent | Explicit unresolved dependency |
| Overload consumer | Calls `resolve(null)` | Same | Ambiguous overload with both candidate declarations |
| String/comment decoys | Contains endpoint and method text | Same | No executable dependency inferred |
| Billing consumer/UI | Unrelated endpoint/import graph | Same | Excluded from lookup impact |

`renamed` has the same dependency structure and edits, but changes every
application-specific class, exported API function, DTO member, endpoint, and
relevant file name. In this pair the routes are `/api/inventory/search` and
`/api/warehouse/resolve`; the service is `InventoryResolver`, the response is
`ProductReply`, and the React consumer is `ProductPanel`. This checks that the
analysis follows source evidence rather than recognizing fixture names.

`rules.json` and `renamed-rules.json` carry a version, a synthetic owner,
unreviewed proposed examples, and three exception states: a current simulated
review, an expired simulated review, and a current unreviewed proposal. An
unreviewed proposal must not suppress a violation. Simulation flags must remain
visible in reports and guidance. The analyzer's `asOf` test date is 2026-10-11.

The fixture-only review record is [exception-review.simulation.md](exception-review.simulation.md).
