# TypeScript parser

`parseTypeScript(path, text)` in `src/typescript.js` uses the pinned TypeScript **5.9.3** Compiler API. It returns the JSON interchange shape documented in `parser-contract.md`. The path selects TS, TSX, JS or JSX grammar; it is not read. The in-memory compiler host serves only the supplied text, disables library and module loading (`noLib`, `noResolve`), and has no filesystem or network calls. Module/path resolution belongs to the separate analysis engine.

## Declarations and identities

The parser records named top-level functions, variables, classes, interfaces, type aliases, enums and namespaces. Namespaces also contribute named members. Classes, interfaces and literal object type aliases contribute member contracts, including properties, methods, constructors, accessors, constructor parameter properties and call/construct/index signatures. Destructured top-level bindings are recorded separately.

Declaration keys are the source name (`load`) or qualified owner/member name (`Result.label`, `Store.load`, `Api.run`). They do not contain types, implementation text, path or source line numbers. Overloads and getter/setter pairs share one identity, with their signatures and source texts concatenated in source order. Anonymous call/construct/index signatures use an ordinal within their kind; inserting or removing such a signature can change its identity. Duplicate/redeclared names share a contract, so this is not a full declaration-merging implementation.

Function and method signatures preserve written modifiers, decorators, generics, parameters and return types but omit implementation bodies. Variable signatures preserve written declaration modifiers and types; function/arrow initializers additionally contribute their written function signature. Class signatures include the header and member signatures, excluding method bodies and property initializer expressions. Interface and type alias signatures preserve their written type contracts. The `body` field contains the source text of each declaration, including implementation/string/comment text inside its AST span. Leading comments outside a declaration span are not included. Line ranges are 1-based and inclusive, calculated from the first AST token through the last character of the node.

No public type contract is inferred for unannotated return types, ordinary variable initializers or class property initializers. For example, changing a returned object shape in an unannotated function changes its source body but does not automatically change its extracted signature. Type alias text and interface members capture syntactic type contracts; this parser does not compute assignability or whether a change is breaking.

## Source references

Imports preserve their local names, original imported names and literal modules, including default imports, renamed named imports, namespace imports and `import type`. Calls carry an original import name/module where the source binding identifies one. Import targets are not fabricated: external declaration resolution is left to the engine.

Calls through imported object/nested namespace receivers record `unresolvedMember`, since module member resolution is unsupported; they never become direct call edges to the receiver export. Within a JS `with` body, all callee bindings remain dynamic and no global HTTP edge is invented.

The in-memory TypeScript checker supplies source-local symbol binding, handling forward declarations, parameters, destructuring, catch bindings and block shadowing. A call/type reference gets `target` only when that symbol maps uniquely to a declaration recorded from this source. Local class/interface members can therefore link to their declared member contract. This is a lexical/contract reference, not proof of a runtime implementation: overrides, mutation, dynamic dispatch and external types are not evaluated. Calls through parameters, unknown objects or non-recorded local functions remain unresolved and contribute an unknown. Explicit receiver type annotations or direct `new Class()` initializers are recorded as `receiverType`; imported type definitions are not loaded.

TSX is parsed with the correct grammar. JSX component tags are recorded as type references to their source/import binding; lowercase intrinsic tags and JSX text are ignored. JSX component attributes are not treated as positional call arguments. Optional calls retain the same lexical binding handling. Comments, string literals and JSX text are never scanned as code.

## HTTP requests

Supported fetch forms are unshadowed global `fetch`, `globalThis.fetch`, `window.fetch`, `self.fetch`, default imports from `node-fetch`/`cross-fetch`/`isomorphic-fetch`, and named `fetch` imports from `undici`/`cross-fetch`. Supported axios forms use a default or namespace import from the literal module `axios`, with any local alias: callable URL/config forms, `.request(config)` and `.get/.delete/.head/.options/.post/.put/.patch`.

Literal string URLs and template literals without substitutions are recorded exactly as written. Methods normalize to uppercase. Fetch and config-style axios calls default to GET only when their direct options are absent or an object literal proves no method was supplied. A dynamic one-argument axios call may be a whole config, so neither URL nor method is assumed. Explicit axios verb methods determine the method from the verb. Object literal duplicate properties follow the final property in source order; spreads, computed keys or nonliteral method values produce uncertainty. Headers and payloads are not interpreted.

Recognized dynamic HTTP syntax still produces a reference with `dynamic: true`, known literal fields where available, and `dynamic_http_url` and/or `dynamic_http_method` unknowns. The parser never guesses template interpolation, string concatenation, options variables, environment variables, base URLs, `new Request(...)`, wrappers or axios instances from `.create()`. URLs are source literals and may be relative: no runtime-origin/base-URL expansion is performed. The TypeScript parser does not produce backend endpoint declarations.

## Explicit limits and unknowns

- Syntax diagnostics become `parse_diagnostic` unknowns with line ranges. Recovered AST declarations/references can still be returned, and must be interpreted alongside those diagnostics.
- Computed property calls, even `client['get'](...)`, produce `computed_property_call`; other expression callees produce `dynamic_call`. No target is invented.
- Calls without a resolvable recorded local/import binding produce `unresolved_call`. This includes external platform APIs whose definitions are intentionally unavailable.
- Computed declaration names and class static blocks produce explicit unknowns rather than fabricated stable member contracts.
- Anonymous default exports, export expressions, renamed local export aliases, external reexports and import-equals syntax produce unknowns. Export/reexport resolution and files outside this source belong to a later resolver.
- Nested implementation-local declarations are not separately emitted as public/top-level contracts. Their shadowing is respected, and their calls cannot accidentally target a similarly named outer binding.
- Dynamic module imports are ordinary unresolved/dynamic source calls. React higher-order components, runtime aliases/reassignment, reflection, ambient libraries, inferred types, cross-file inheritance and package declarations are not semantically resolved.

The focused suite in `test/typescript.test.js` checks these behaviors, including source-equivalent renamed fixtures to guard against application-specific names.
