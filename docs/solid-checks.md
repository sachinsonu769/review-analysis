# Design conventions and SOLID review signals

The conventions stage separates a configured architecture boundary from inferred design concerns. It reports source evidence and a review reason. It does not certify SOLID compliance or turn an arbitrary size limit into a universal design rule.

Dependency inversion concerns the direction of source dependencies between policy and implementation detail; enforcing a team's explicit import boundary can support that intent. The correct boundary still depends on the application architecture. [Robert C. Martin: dependency inversion](https://blog.cleancoder.com/uncle-bob/2016/01/04/ALittleArchitecture.html)

## Configured import boundaries

An explicit policy fragment can state which import prefixes are forbidden in a source path prefix:

```json
{
  "conventions": {
    "forbiddenImports": [
      {
        "id": "domain/no-storage-detail",
        "pathPrefix": "frontend/src/domain/",
        "importPrefixes": ["../storage/", "@app/storage/"],
        "owner": "domain-team",
        "version": "1"
      }
    ],
    "maxParameters": 5,
    "maxClassMethods": 20,
    "checkPublicMutableFields": true,
    "checkModuleCycles": true
  }
}
```

The paths and owner above are examples, not adopted project policy or evidence of human approval. Supply the real team's boundary and governance details. Prefix matching checks the literal import representation extracted from supplied source; it does not infer dependency inversion from a framework/package name or resolve every alias, barrel, dynamic import, or generated dependency.

A matching import yields `basis: "configured-policy"` with rule ID, owner/version governance, and evidence of the importing source. This establishes that the observed import matches the supplied boundary. It does not establish that the boundary is appropriate, that the owner approved it, or that runtime dependency injection violates the intended abstraction. Existing architecture rules and their governed exceptions are described in [report semantics](report-format.md).

## Inferred review signals

| Signal | Default | What to review |
| --- | --- | --- |
| Parameter count | More than 5 declared parameters | Consider whether arguments describe one coherent operation and whether related data has a useful abstraction. |
| Class method count | More than 20 declared methods | Review cohesion and reasons for change; method count alone does not prove multiple responsibilities. |
| Public mutable fields | Enabled; informational | Review intended state exposure, DTO/framework conventions, and whether read-only access would help. |
| Module cycles | Enabled; warning | Review a cycle in resolved relative JS/TS source imports; the graph is a source signal, not proof of a runtime initialization failure. |

These findings use `basis: "inferred-convention"` and potential certainty. Counts concern declarations visible to the bounded extractors, rather than inherited members, generated code, or a complete semantic type graph. Java `final` and TypeScript `readonly` express declaration restrictions; they do not establish deep object immutability. Public fields may be appropriate in a DTO or Angular component. Method and parameter thresholds are configurable review defaults.

Module cycles retain the participating import evidence. Missing targets, external packages, aliases, dynamic imports, and unsupported resolution limit the graph. Type-level dependencies and runtime module evaluation are different concerns; a source cycle needs inspection of actual bindings and build behavior before concluding that it causes a runtime problem.

The single responsibility principle concerns the people/business functions that drive change, which a method count cannot identify. [Robert C. Martin: single responsibility](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html) The analyzer does not prove open/closed behavior, Liskov substitutability, or interface segregation: those judgments need contracts, consumers, change context, and behavioral evidence beyond the selected source patterns.

## Report interpretation

The conventions result has `tools`, `findings`, `unsupported`, `metrics`, and `configHash`. Findings contain rule identity, classification, severity, certainty, source evidence, and a fingerprint; applicable policy governance accompanies configured boundary findings. Baseline/candidate classifications distinguish introduced, retained, increased, and removed observations. Parse gaps must stay visible and must not silently turn uncertain checks into resolved debt. See [quality comparison semantics](code-quality.md#evidence-change-classification-and-gaps).

A review should confirm the actual convention, inspect the supplied lines, and consider framework contracts before accepting or dismissing a signal. Neither a clean conventions result nor a suppressed finding establishes complete design quality, architect approval, or permission to reduce regression coverage.
