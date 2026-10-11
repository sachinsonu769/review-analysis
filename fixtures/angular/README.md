# Synthetic Angular review fixtures

These source snapshots exercise Java/Spring contracts consumed by Angular
TypeScript. They are analysis inputs, not buildable Angular applications; Angular,
RxJS and Spring are intentionally not installed. No fixture asserts production
approval or runtime behavior.

`lookup/baseline` and `lookup/candidate` contain a focused API migration:

| Evidence | Baseline | Candidate | Expected analysis |
| --- | --- | --- | --- |
| Spring endpoint | `GET /api/lookup` | `GET /api/catalog/lookup` | Contract change with source evidence from both revisions |
| Java record and TS interface | `label` | `displayName` | DTO member contract change |
| `LookupService.lookup` | Typed `HttpClient.get` of old route | Typed `HttpClient.get` of new route | Literal HTTP dependency on the corresponding endpoint |
| `LookupService.legacyLookup` | Typed `HttpClient.request('GET', old route)` | Same old route | Retained source consumer requiring review |
| `LookupPanel` | Imports service and standalone badge | Keeps old `response.label` access | Local service/import dependency; field compatibility requires review |
| `AppComponent` and `LookupModule` | Import panel/service through Angular metadata | Same | Source import paths can carry likely indirect impact |
| `DynamicLookupService` | Namespace-typed `Http.HttpClient` with interpolated URL | Same | Dynamic HTTP URL unknown; no confirmed endpoint match |
| Verified inline/external templates | Endpoint-looking text and old DTO field text | Same | Template metadata recorded as unverified; text is never parsed as TypeScript |
| `decoys.ts` | Local fake `Component` and `HttpClient`, string/comment examples | Same | No Angular metadata or HTTP dependency inferred from these decoys |
| `BillingService` / `BillingPanel` | Independent literal billing request | Same | Excluded from lookup impact |

The component decorators deliberately use named aliases and an `@angular/core`
namespace import. The literal service uses an aliased `HttpClient` import and a
typed constructor parameter property. The dynamic service uses a namespace type.
This verifies source bindings rather than matching decorator or receiver names.

`renamed` preserves the same file/dependency structure and edits while replacing
the application-specific route, package, class, function, DTO member and file
names. Its endpoint changes from `/api/inventory/search` to
`/api/warehouse/resolve`; `ProductReply.title` becomes `description`, and the
typed consumer is `InventoryClient.resolveInventory`. Analysis should follow the
same evidence and confidence rules for both suites.

The `.html` files exist to make external-template references representative. The
snapshot reader excludes their extension, and the TypeScript parser never reads
them. Even inline template expressions, selectors and component tags do not prove
runtime component usage or field compatibility. See
[Angular support](../../docs/angular-support.md) for the precise boundary.
