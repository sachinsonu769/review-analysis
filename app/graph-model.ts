export type Confidence = "high" | "medium" | "low";
export type RevisionPhase = "baseline" | "candidate";
export interface SourceEvidence {
  path: string;
  range: {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  revision: string;
  fileHash: string;
  excerpt: string;
  projectId?: string;
  repository?: string;
}
export interface GraphNode {
  id: string;
  kind: "file";
  label: string;
  path: string;
  projectId: string;
  repository: string;
  module: string;
  language: string;
  changed: boolean;
  changeKinds: string[];
  evidence: SourceEvidence;
  declarations: Array<{
    key: string;
    name: string;
    kind: string;
    signature: string;
    evidence: SourceEvidence;
  }>;
  phases: RevisionPhase[];
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  confidence: Confidence;
  reason: string;
  evidence: SourceEvidence;
  targetEvidence: SourceEvidence;
  phase: RevisionPhase;
  crossRepository: boolean;
  mappingId?: string;
  targetKey?: string | null;
}
export interface TypedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  complete: false;
  direction: "consumer-to-dependency";
}
export interface ImpactPath {
  source: string;
  target: string;
  edgeIds: string[];
  nodeIds: string[];
  phase: RevisionPhase;
  confidence: Confidence;
  kind: "direct" | "likely-indirect";
}
/** Same-revision reverse dependency walk. Each chain is evidence, not proof of execution. */
export function impactPaths(
  graph: TypedGraph,
  selectedIds: string[],
  maxDepth = 12,
): ImpactPath[] {
  const selected = new Set(selectedIds),
    paths: ImpactPath[] = [];
  for (const phase of ["baseline", "candidate"] as const) {
    const edges = graph.edges.filter(
      (e) => e.phase === phase && e.source !== e.target,
    );
    for (const target of selected) {
      const queue: Array<{
        node: string;
        edgeIds: string[];
        nodeIds: string[];
      }> = [{ node: target, edgeIds: [], nodeIds: [target] }];
      const expanded = new Set<string>();
      while (queue.length) {
        const item = queue.shift()!;
        if (item.edgeIds.length >= maxDepth || expanded.has(item.node))
          continue;
        expanded.add(item.node);
        for (const edge of edges.filter((e) => e.target === item.node)) {
          if (item.nodeIds.includes(edge.source)) continue;
          const ids = [edge.id, ...item.edgeIds],
            nodes = [edge.source, ...item.nodeIds];
          paths.push({
            source: edge.source,
            target,
            edgeIds: ids,
            nodeIds: nodes,
            phase,
            confidence: ids.length > 1 ? "low" : edge.confidence,
            kind: ids.length > 1 ? "likely-indirect" : "direct",
          });
          queue.push({ node: edge.source, edgeIds: ids, nodeIds: nodes });
        }
      }
    }
  }
  return paths;
}
