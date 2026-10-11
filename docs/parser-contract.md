# Parser interchange contract

`parseJava(path, text)` and `parseTypeScript(path, text)` return `{language, declarations, references, endpoints, unknowns}`. Engines add provenance (path, line ranges, revision, SHA256). Return only JSON values.

- Declaration: `{key, name, kind, signature, body, range:{startLine,endLine}, owner?}`. Keys stable across contract changes: Java qualified class + method name/arity (overload signatures as suffix if needed); TS exported/top-level named declarations. Include DTO/classes/interfaces and their member contracts. Java methods additionally carry numeric `arity` and boolean `varargs`. Signature includes annotations, types and parameters; body contains source text of declaration (engine hashes both).
- Reference: `{kind:'import'|'call'|'type'|'http', name?, target?, receiver?, receiverType?, arity?, module?, imported?, method?, url?, dynamic?, range}`. `target` only when actually resolved lexically, never guessed. HTTP literal URL includes configured Spring routes; dynamic calls are unknown. Caller name/owner optional. TS `unresolvedMember` identifies imported receiver members that need unavailable module-member resolution.
- Endpoint: `{name, declarationKey, method, url, range}` from supported literal Spring mapping annotations.
- Unknown: `{reason, range?, detail?}` for parse diagnostics or recognized unresolved/dynamic syntax.

Parsing must use pinned supported parsers. Resolution is a separate conservative engine stage. No application-specific names. No filesystem reads/writes inside parsers. Capture comments/string text without interpreting them as code. Document unsupported constructs.
