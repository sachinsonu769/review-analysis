import { analyze, buildIdentity, inspectSnapshot } from "../src/engine.js";
import { evidence, hash, assertOutside } from "../src/snapshot.js";
import { cacheStore } from "../src/cache.js";
import { analyzeQuality, qualityToolIdentity } from "../src/quality.js";
import { analyzeConventions } from "../src/conventions.js";
import { reviewWorkspaceRequirements } from "../src/requirements.js";
import {
  impactPaths,
  type TypedGraph,
  type GraphNode,
  type GraphEdge,
  type SourceEvidence,
  type RevisionPhase,
} from "./graph-model.js";

export interface SnapshotSpec {
  type: "directory" | "git" | "worktree";
  root: string;
  revision?: string;
}
export interface ProjectSpec {
  id: string;
  label?: string;
  repository: string;
  module: string;
  modules?: Array<{ id: string; pathPrefix: string }>;
  baseline: SnapshotSpec;
  candidate: SnapshotSpec;
  rules?: any;
  baselineRules?: any;
  conventions?: any;
}
export interface HttpMapping {
  id: string;
  kind: "http";
  fromProject: string;
  toProject: string;
  urlPrefix: string;
  stripPrefix?: string;
  routePrefix?: string;
  owner: string;
  version: string;
}
export interface ImportMapping {
  id: string;
  kind: "import";
  fromProject: string;
  toProject: string;
  specifier: string;
  targetPath: string;
  owner: string;
  version: string;
}
export type CrossProjectMapping = HttpMapping | ImportMapping;
export interface WorkspaceSpec {
  version: string;
  projects: ProjectSpec[];
  mappings: CrossProjectMapping[];
}
export interface WorkspaceOptions {
  workspace: WorkspaceSpec;
  asOf: string;
  task?: string;
  checklist?: any;
  quality?: any;
  cacheDir?: string;
}
const emptyRules = { version: "unconfigured", rules: [] };
const nodeId = (project: string, file: string) => `${project}::${file}`;
const ev = (value: any, project: ProjectSpec): SourceEvidence => ({
  ...value,
  projectId: project.id,
  repository: project.repository,
});
export function validateWorkspace(workspace: WorkspaceSpec): WorkspaceSpec {
  const text=(value:unknown,max=200):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!value.includes('\0');
  if (
    !workspace ||
    !text(workspace.version) ||
    !Array.isArray(workspace.projects) ||
    !workspace.projects.length ||
    workspace.projects.length > 20 ||
    !Array.isArray(workspace.mappings) ||workspace.mappings.length>200
  )
    throw new Error(
      "Workspace requires version, 1–20 projects and explicit mappings array",
    );
  const ids = new Set<string>();
  for (const project of workspace.projects) {
    if (!project||!text(project.id,80)||!/^[a-zA-Z0-9_-]{1,80}$/.test(project.id) || ids.has(project.id))
      throw new Error("Project ids must be unique and use letters/numbers/_/-");
    ids.add(project.id);
    if (!text(project.repository)||!text(project.module))
      throw new Error("Project repository and module are required");
    if (
      project.modules &&
      (!Array.isArray(project.modules) ||project.modules.length>100||
        project.modules.some(
          (m) =>
            !m||!text(m.id)||!text(m.pathPrefix,4096)||
            m.pathPrefix.startsWith("/") ||
            m.pathPrefix.split("/").includes("..")||m.pathPrefix.includes('\\'),
        ))
    )
      throw new Error("Project modules require id and relative pathPrefix");
    for (const spec of [project.baseline, project.candidate])
      if (
        !spec ||
        !["directory", "git", "worktree"].includes(spec.type) ||
        !text(spec.root,4096) ||
        (spec.type === "git" && !text(spec.revision,1024))
      )
        throw new Error(
          "Each project requires baseline/candidate snapshot specifications",
        );
  }
  const mappingIds = new Set<string>();
  for (const m of workspace.mappings) {
    if (
      !m||!text(m.id)||
      mappingIds.has(m.id) ||
      !ids.has(m.fromProject) ||
      !ids.has(m.toProject) ||
      m.fromProject === m.toProject ||
      !text(m.owner)||
      !text(m.version)
    )
      throw new Error(
        "Mappings require unique id, distinct existing projects, owner and version",
      );
    mappingIds.add(m.id);
    if (m.kind === "http") {
      if (
        !text(m.urlPrefix,4096)||
        (m.stripPrefix !== undefined && typeof m.stripPrefix !== "string") ||
        (m.routePrefix !== undefined && typeof m.routePrefix !== "string")
      )
        throw new Error("HTTP mapping requires a literal nonempty urlPrefix");
    } else if (m.kind === "import") {
      if (
        !text(m.specifier,4096)||
        !text(m.targetPath,4096)||
        m.targetPath.startsWith("/") ||
        m.targetPath.split("/").includes("..") ||
        m.targetPath.includes("\\")
      )
        throw new Error(
          "Import mapping requires literal specifier and relative targetPath",
        );
    } else throw new Error("Unsupported cross-project mapping kind");
  }
  return workspace;
}
function routeMatches(url: string, route: string): boolean {
  if (!url || !route || /\{[^}]+:[^}]+\}/.test(route)) return false;
  const clean = url.split("?")[0];
  const pattern = route
    .split("/")
    .map((segment) =>
      /^\{[^}]+\}$/.test(segment)
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp("^" + pattern + "/?$").test(clean);
}
function addGraphEdge(
  edges: GraphEdge[],
  from: ProjectSpec,
  to: ProjectSpec,
  file: string,
  targetFile: string,
  ref: any,
  targetEvidence: any,
  phase: RevisionPhase,
  reason: string,
  confidence: "high" | "medium",
  sourceSnapshot: any,
  mapping?: CrossProjectMapping,
  targetKey?: string | null,
) {
  const base = {
    source: nodeId(from.id, file),
    target: nodeId(to.id, targetFile),
    kind: ref.kind,
    confidence,
    reason,
    evidence: ev(evidence(sourceSnapshot, file, ref.range), from),
    targetEvidence: ev(targetEvidence, to),
    phase,
    crossRepository: from.repository !== to.repository,
    ...(mapping ? { mappingId: mapping.id } : {}),
    targetKey,
  };
  edges.push({ id: hash(base).slice(0, 24), ...base });
}
/** One typed graph is the source of UI and impact paths, including explicitly configured cross-project edges. */
export async function analyzeWorkspace(options: WorkspaceOptions) {
  const started = performance.now(),
    workspace = validateWorkspace(options.workspace),
    build = buildIdentity();
  const cacheDir = assertOutside(
    options.cacheDir,
    workspace.projects.flatMap((p) => [p.baseline.root, p.candidate.root]),
  );
  const records = workspace.projects.map((project) => {
    const before = inspectSnapshot(project.baseline, { cacheDir }),
      after = inspectSnapshot(project.candidate, { cacheDir });
    return {
      project,
      before,
      after,
      report: analyze({
        baseline: project.baseline,
        candidate: project.candidate,
        baselineSnapshot: before.snapshot,
        candidateSnapshot: after.snapshot,
        parsedBaseline: before.parsed,
        parsedCandidate: after.parsed,
        rules: project.rules || emptyRules,
        baselineRules: project.baselineRules,
        asOf: options.asOf,
        task: options.task,
        cacheDir,
      }),
    };
  });
  const nodes = new Map<string, GraphNode>(),
    edges: GraphEdge[] = [],
    unknowns: any[] = [];
  for (const record of records) {
    const { project, report } = record;
    const changes = new Map<string, string[]>();
    for (const change of report.changes)
      for (const file of new Set(
        [change.before?.path, change.after?.path].filter(Boolean),
      ))
        changes.set(file, [...(changes.get(file) || []), change.kind]);
    for (const file of new Set([
      ...Object.keys(record.before.snapshot.files),
      ...Object.keys(record.after.snapshot.files),
    ]))
      if (
        record.before.snapshot.files[file]?.hash !==
          record.after.snapshot.files[file]?.hash &&
        !changes.has(file)
      )
        changes.set(file, [
          record.before.snapshot.files[file]
            ? record.after.snapshot.files[file]
              ? "source-modified"
              : "source-deleted"
            : "source-added",
        ]);
    for (const [phase, analysis] of [
      ["baseline", record.before],
      ["candidate", record.after],
    ] as const) {
      for (const [file, parsed] of Object.entries<any>(analysis.parsed)) {
        const id = nodeId(project.id, file),
          previous = nodes.get(id);
        const module =
          project.modules
            ?.filter((m) => file.startsWith(m.pathPrefix))
            .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0]?.id ||
          project.module;
        nodes.set(id, {
          id,
          kind: "file",
          label: file.split("/").at(-1)!,
          path: file,
          projectId: project.id,
          repository: project.repository,
          module,
          language: parsed.language,
          changed: changes.has(file),
          changeKinds: [...new Set(changes.get(file) || [])],
          evidence: ev(evidence(analysis.snapshot, file), project),
          declarations: analysis.declarations
            .filter((d: any) => d.path === file)
            .map((d: any) => ({
              key: d.key,
              name: d.name,
              kind: d.kind,
              signature: d.signature,
              evidence: ev(d.evidence, project),
            })),
          phases: [...(previous?.phases || []), phase],
        });
      }
      for (const edge of analysis.graph.edges)
        addGraphEdge(
          edges,
          project,
          project,
          edge.fromPath,
          edge.toPath,
          { ...edge, range: edge.evidence.range },
          edge.targetEvidence,
          phase,
          edge.reason,
          edge.confidence,
          analysis.snapshot,
          undefined,
          edge.targetKey,
        );
      unknowns.push(
        ...analysis.graph.unknowns.map((u: any) => ({
          ...u,
          phase,
          projectId: project.id,
          ...(u.evidence ? { evidence: ev(u.evidence, project) } : {}),
        })),
      );
    }
  }
  for (const phase of ["baseline", "candidate"] as const)
    for (const mapping of workspace.mappings) {
      const from = records.find((r) => r.project.id === mapping.fromProject)!,
        to = records.find((r) => r.project.id === mapping.toProject)!;
      const src = phase === "baseline" ? from.before : from.after,
        dst = phase === "baseline" ? to.before : to.after;
      for (const [file, parsed] of Object.entries<any>(src.parsed))
        for (const ref of parsed.references) {
          if (
            mapping.kind === "http" &&
            ref.kind === "http" &&
            !ref.dynamic &&
            typeof ref.url === "string" &&
            ref.url.startsWith(mapping.urlPrefix)
          ) {
            const strip = mapping.stripPrefix || "";
            if (strip && !ref.url.startsWith(strip)) continue;
            const url =
              (mapping.routePrefix || "") + ref.url.slice(strip.length);
            const matches = Object.entries<any>(dst.parsed).flatMap(
              ([targetFile, p]) =>
                (p.endpoints || [])
                  .filter(
                    (ep: any) =>
                      (ep.method === ref.method ||
                        ["ANY", "*"].includes(ep.method)) &&
                      routeMatches(url, ep.url),
                  )
                  .map((ep: any) => ({ targetFile, ep })),
            );
            if (matches.length === 1) {
              const { targetFile, ep } = matches[0];
              addGraphEdge(
                edges,
                from.project,
                to.project,
                file,
                targetFile,
                ref,
                evidence(dst.snapshot, targetFile, ep.range),
                phase,
                "Literal verb/path plus explicit project mapping; runtime origin and deployment remain unverified",
                "medium",
                src.snapshot,
                mapping,
                ep.declarationKey,
              );
            } else
              unknowns.push({
                reason: matches.length
                  ? "ambiguous-cross-project-endpoint"
                  : "unmatched-cross-project-endpoint",
                phase,
                projectId: from.project.id,
                mappingId: mapping.id,
                evidence: ev(
                  evidence(src.snapshot, file, ref.range),
                  from.project,
                ),
                candidates: matches.map((m) => ({
                  projectId: to.project.id,
                  path: m.targetFile,
                  method: m.ep.method,
                  url: m.ep.url,
                })),
              });
          }
          if (
            mapping.kind === "import" &&
            ref.kind === "import" &&
            (ref.module || ref.target) === mapping.specifier
          ) {
            if (dst.snapshot.files[mapping.targetPath])
              addGraphEdge(
                edges,
                from.project,
                to.project,
                file,
                mapping.targetPath,
                ref,
                evidence(dst.snapshot, mapping.targetPath),
                phase,
                "Literal module specifier resolves through explicit source mapping; package build/runtime resolution unverified",
                "medium",
                src.snapshot,
                mapping,
                null,
              );
            else
              unknowns.push({
                reason: "missing-cross-project-source",
                phase,
                mappingId: mapping.id,
                evidence: ev(
                  evidence(src.snapshot, file, ref.range),
                  from.project,
                ),
                targetPath: mapping.targetPath,
              });
          }
        }
    }
  const graph: TypedGraph = {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...new Map(edges.map((e) => [e.id, e])).values()],
    complete: false,
    direction: "consumer-to-dependency",
  };
  const paths = impactPaths(
    graph,
    graph.nodes.filter((n) => n.changed).map((n) => n.id),
  );
  const qualityResults: any[] = [],
    toolchain = await qualityToolIdentity();
  for (const record of records) {
    const stats = { invalidEntries: 0 },
      store = cacheStore(cacheDir, stats);
    const key = hash({
      kind: "workspace-quality-v1",
      build,
      toolchain,
      config: options.quality || {},
      before: record.before.snapshot.contentHash,
      after: record.after.snapshot.contentHash,
      baselineRevision: record.before.snapshot.revision,
      candidateRevision: record.after.snapshot.revision,
      roots: [record.before.snapshot.root, record.after.snapshot.root],
    });
    const dirty = record.before.snapshot.dirty || record.after.snapshot.dirty;
    let quality = !dirty && cacheDir ? store.get(key) : null;
    const cached = Boolean(quality);
    if (!quality) {
      quality = await analyzeQuality({
        baselineSnapshot: record.before.snapshot,
        candidateSnapshot: record.after.snapshot,
        config: options.quality,
      });
      if (!dirty) store.set(key, quality);
    }
    const conventions = analyzeConventions({
      baselineSnapshot: record.before.snapshot,
      candidateSnapshot: record.after.snapshot,
      config: record.project.conventions,
      baselineParsed: record.before.parsed,
      candidateParsed: record.after.parsed,
      baselineGraph: record.before.graph,
      candidateGraph: record.after.graph,
    });
    qualityResults.push({
      ...quality,
      conventions,
      projectId: record.project.id,
      cache: dirty
        ? "bypass-dirty"
        : cached
          ? "hit"
          : cacheDir
            ? "miss"
            : "disabled",
      findings: [...quality.findings, ...conventions.findings].map(
        (f: any) => ({
          ...f,
          projectId: record.project.id,
          evidence: f.evidence ? ev(f.evidence, record.project) : null,
          relatedEvidence: f.relatedEvidence?.map((e: any) =>
            ev(e, record.project),
          ),
        }),
      ),
      unsupported: [...quality.unsupported, ...conventions.unsupported].map(
        (u: any) => ({ ...u, projectId: record.project.id }),
      ),
    });
  }
  const checklist = options.checklist;
  const requirements = checklist
    ? reviewWorkspaceRequirements({projects:records.map(record=>({id:record.project.id,snapshot:record.after.snapshot})),checklist,graph})
    : {status:"draft",criteria:[],limitations:["No business checklist configured; runtime intent remains unverified"]};
  const changes = records.flatMap((r) =>
    r.report.changes.map((c: any) => ({
      ...c,
      projectId: r.project.id,
      before: c.before ? ev(c.before, r.project) : null,
      after: c.after ? ev(c.after, r.project) : null,
    })),
  );
  return {
    schemaVersion: "2.0",
    build,
    analyzer: build,
    advisory: true,
    asOf: options.asOf,
    graph,
    projectMetadata: workspace.projects.map((p) => ({
      id: p.id,
      label: p.label || p.id,
      repository: p.repository,
      module: p.module,
    })),
    workspace: {
      version: workspace.version,
      mappings: workspace.mappings,
      configHash: hash(workspace),
    },
    changes,
    impact: {
      paths,
      limits: {
        maxDepth: 12,
        representativePaths: true,
        complete: false,
        reason:
          "One bounded representative chain per expanded node and phase; alternate paths and deeper chains may be omitted",
      },
      direct: paths.filter((p) => p.kind === "direct"),
      indirect: paths.filter((p) => p.kind === "likely-indirect"),
    },
    findings: records.flatMap((r) =>
      r.report.findings.map((f: any) => ({
        ...f,
        projectId: r.project.id,
        evidence: ev(f.evidence, r.project),
      })),
    ),
    guidance: {
      projects: records.map((r) => ({
        projectId: r.project.id,
        ...r.report.guidance,
      })),
    },
    quality: {
      tools: qualityResults.flatMap((q) => q.tools),
      findings: qualityResults.flatMap((q) => q.findings),
      unsupported: qualityResults.flatMap((q) => q.unsupported),
      projects: qualityResults,
    },
    requirements,
    unknowns,
    focusedTests: records.flatMap((r) =>
      r.report.focusedTests.map((t: any) => ({
        ...t,
        projectId: r.project.id,
      })),
    ),
    coverage: {
      complete: false,
      fullRegressionMayBeSkipped: false,
      limitations: [
        ...new Set(records.flatMap((r) => r.report.coverage.limitations)),
        "Cross-project dependencies require explicit mappings; mappings are assertions, not deployment proof",
        "Selected quality and SOLID signals do not establish universal design correctness",
        "Requirement criteria are literal source/test evidence only; runtime remains unverified",
      ],
    },
    provenance: {
      projects: records.map((r) => ({
        projectId: r.project.id,
        ...r.report.provenance,
      })),
    },
    cache: {
      projects: records.map((r) => ({
        projectId: r.project.id,
        ...r.report.cache,
      })),
      quality: qualityResults.map((q) => ({
        projectId: q.projectId,
        status: q.cache,
      })),
    },
    metrics: {
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      projects: records.length,
      sourceFiles: graph.nodes.length,
      edges: graph.edges.length,
    },
  };
}
