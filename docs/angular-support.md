# Angular source support

`parseTypeScript(path, text)` extracts Angular evidence from the same pinned
TypeScript Compiler API and source-local checker as ordinary TypeScript. It does
not require Angular or RxJS packages, load a workspace, read templates, run a
compiler or contact the network. Angular support does not change the Java/Spring
endpoint parser or the report's evidence and confidence rules.

## Verified decorators and metadata

Only decorator calls whose lexical import binding resolves to `Component`,
`Injectable` or `NgModule` from the literal module `@angular/core` count as Angular
metadata. Named aliases and namespace access retain that import provenance.
Same-named local functions, imports from other modules, shadowed bindings,
type-only decorator imports, comments and strings cannot establish Angular
metadata.

The parser may add this optional JSON field to its ordinary interchange result:

```json
{
  "angular": {
    "components": [],
    "injectables": [],
    "modules": []
  }
}
```

The field is omitted when there are no verified Angular decorators. Each entry
identifies its source declaration with `declarationKey` and a 1-based, inclusive
decorator `range`. Component metadata can include a literal `selector`, literal
boolean `standalone`, arrays for `imports`, `providers` and `viewProviders`, and a
`template`. NgModule metadata can include arrays for `imports`, `declarations`,
`exports`, `bootstrap` and `providers`; Injectable metadata can retain a literal
string/null `providedIn`. Omitted metadata remains unspecified; Angular runtime
defaults are not inferred. These fields are defined by Angular's
[Component](https://angular.dev/api/core/Component),
[NgModule](https://angular.dev/api/core/NgModule) and
[Injectable](https://angular.dev/api/core/Injectable) APIs; the parser extracts the
subset described here.

An import/declaration/provider descriptor has the source shape
`{name, target?, module?, imported?, range}`. `target` is present only for an
actually resolved source-local declaration; imported names retain their module
and original import name instead of acquiring a guessed target. The analysis
engine separately resolves supported local imports. Dynamic metadata and runtime
provider wiring cannot create a confirmed declaration edge.

Metadata requires direct object literals with property assignments or shorthand
fields, without spreads, computed keys, getters or methods.
Dependency arrays require direct array literals containing identifiers or
namespace members. Object provider recipes, factories, spreads, computed entries
and other dynamic expressions produce `angular_dynamic_metadata`; unbound static
dependencies produce `angular_unresolved_metadata_dependency`. A verified
decorator still retains its declaration identity when its configuration is
unsupported.

Decorator metadata is source evidence. `standalone: true`, an `imports` array or
an NgModule provider list does not prove Angular compiled the application,
instantiated a service or rendered a component.

## Template boundaries

A component's template descriptor is either
`{kind:'inline', text, range, analysis:'unverified'}` or
`{kind:'external', url, range, analysis:'unverified'}`. Inline text and external
URLs retain their literal contents when statically available. Supported inline and
external template metadata produces an `angular_template_unverified` unknown.

External template files are never loaded or semantically analyzed. Inline
template contents are never scanned as TypeScript. HTML component tags,
interpolation, pipes, event bindings, structural directives, selectors and code-
looking strings therefore do not create verified calls, type references, HTTP
requests or cross-component edges. A template's old DTO field can be useful
review context, but this parser does not verify its compatibility.

## Typed HttpClient requests

An Angular HTTP reference requires the receiver's explicit lexical type to
resolve to the `HttpClient` import from `@angular/common/http`. Named aliases,
namespace-qualified types and type-only imports can preserve this source type
evidence. A constructor parameter property such as
`private readonly http: AngularHttp` supports `this.http.get(...)`; the
receiver's name alone never identifies an Angular client.

Supported verb calls include `get`, `delete`, `head`, `options`, `post`, `put`
and `patch`. Their method is determined by the verb. The supported
`request(method, url, ...)` form records the literal method and URL when they are
available. Literal strings and template literals without substitutions can
establish a source HTTP route. Source-local binding must also rule out
same-named fake types or shadowing; unrelated objects with a `get` method are
ordinary calls. Angular's [HttpClient API](https://angular.dev/api/common/http/HttpClient)
documents these verb methods and `request` overloads. The `request(HttpRequest)`
overload remains dynamic because its method and URL are not literals in those
argument positions; options, headers and payload semantics are not evaluated.

Dynamic URLs or methods retain any known literal fields and produce explicit
unknowns rather than an endpoint guess. URL concatenation, interpolation,
runtime base URLs, wrappers, interceptors, injection configuration and reassigned
receivers are not evaluated. The parser does not infer `HttpClient` from an
untyped `inject(...)` initializer or another runtime factory.

Every recognized Angular HTTP call also produces
`angular_http_runtime_unverified`. Matching a literal route to a Spring endpoint
means the source requests that contract; it does not prove a request executes.
RxJS subscriptions, operator chains, scheduling, cancellation, retries, async
template pipes and runtime asynchronous behavior remain unknown.

## Fixtures and impact interpretation

The synthetic pairs in [`fixtures/angular`](../fixtures/angular/README.md) cover
the `/api/lookup` to `/api/catalog/lookup` migration and an equivalent renamed
inventory migration. They include typed literal and dynamic calls, standalone
component imports, NgModule metadata, fake APIs, inline/external template decoys
and an unrelated billing consumer.

Literal HTTP consumers can carry direct endpoint evidence. Resolved local
service/component imports can carry likely indirect impact through the existing
source dependency graph. Confidence must continue to describe source evidence,
and reports must keep template/runtime unknowns visible. No Angular runtime,
template loading or inferred dependency-injection graph is claimed.
