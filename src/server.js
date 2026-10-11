import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWorkspace, validateWorkspace } from "../app-dist/workspace.js";
import { buildIdentity } from "./engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "fixtures");
const allowedRoots = [
  fixtureRoot,
  ...(process.env.REVIEW_ANALYSIS_INPUT_ROOTS || "/inputs").split(
    path.delimiter,
  ),
]
  .filter((p) => fs.existsSync(p))
  .map((p) => fs.realpathSync(p));
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const emptyRules = {
  version: "demo-2026.10",
  rules: [
    {
      id: "api/contract-change",
      kind: "endpoint-contract-change",
      owner: "Synthetic demo team",
      severity: "warning",
      description:
        "Review consumers and API compatibility before changing a lookup contract.",
    },
  ],
};
export function demos() {
  const project = (id, repository, module, base, sub = "") => ({
    id,
    label: module,
    repository,
    module,
    ...(!sub
      ? {
          modules: [
            { id: "Backend", pathPrefix: "backend/" },
            { id: "Frontend", pathPrefix: "frontend/" },
          ],
        }
      : {}),
    baseline: {
      type: "directory",
      root: path.join(fixtureRoot, base, "baseline", sub),
    },
    candidate: {
      type: "directory",
      root: path.join(fixtureRoot, base, "candidate", sub),
    },
    rules: sub
      ? emptyRules
      : base === "lookup"
        ? json(path.join(fixtureRoot, "rules.json"))
        : emptyRules,
  });
  return [
    {
      id: "lookup",
      label: "Java / Spring + React",
      description:
        "API contract migration, legacy debt, new deviations and conservative caller evidence.",
      workspace: {
        version: "demo-1",
        projects: [
          project("monorepo", "example/monorepo", "backend + React", "lookup"),
        ],
        mappings: [],
      },
    },
    {
      id: "angular",
      label: "Java / Spring + Angular",
      description:
        "Verified Angular decorators and typed HttpClient calls; templates and runtime remain unverified.",
      workspace: {
        version: "demo-angular-1",
        projects: [
          project(
            "angular-monorepo",
            "example/angular-monorepo",
            "backend + Angular",
            "angular/lookup",
          ),
        ],
        mappings: [],
      },
    },
    {
      id: "split",
      label: "Split backend / React repositories",
      description:
        "Separate source roots connected only by an explicit versioned HTTP mapping.",
      workspace: {
        version: "demo-split-1",
        projects: [
          project(
            "backend",
            "example/backend",
            "Spring API",
            "lookup",
            "backend",
          ),
          project(
            "react",
            "example/frontend",
            "React consumer",
            "lookup",
            "frontend",
          ),
        ],
        mappings: [
          {
            id: "demo-api-origin",
            kind: "http",
            fromProject: "react",
            toProject: "backend",
            urlPrefix: "/api/",
            owner: "Synthetic demo team",
            version: "1",
          },
        ],
      },
    },
    {
      id: "quality",
      label: "Code quality + checklist evidence",
      description:
        "Selected reputable analyzer checks and draft business criteria; confirmation is supplied by the user.",
      workspace: {
        version: "demo-quality-1",
        projects: [
          project(
            "quality",
            "example/quality",
            "Selected quality cases",
            "quality",
          ),
        ],
        mappings: [],
      },
    },
    {
      id:"requirements",label:"Business checklist evidence",description:"Draft source/test criteria, missing edge cases and visibly unverified runtime behavior.",
      workspace:{version:"demo-requirements-1",projects:[{id:"requirements",label:"Customer checklist sample",repository:"example/customer-sample",module:"Business evidence",modules:[{id:"Backend",pathPrefix:"backend/"},{id:"Frontend",pathPrefix:"frontend/"}],baseline:{type:"directory",root:path.join(fixtureRoot,"requirements/sample")},candidate:{type:"directory",root:path.join(fixtureRoot,"requirements/sample")},rules:emptyRules}],mappings:[]},
    },
  ].filter((d) =>
    d.workspace.projects.every(
      (p) => fs.existsSync(p.baseline.root) && fs.existsSync(p.candidate.root),
    ),
  );
}
function authorizeWorkspace(workspace) {
  validateWorkspace(workspace);
  for (const project of workspace.projects)
    for (const spec of [project.baseline, project.candidate]) {
      if (spec.root.split(/[\\/]/).includes(".."))
        throw new Error("Input root cannot contain parent traversal");
      const real = fs.realpathSync(spec.root);
      if (
        !allowedRoots.some((base) => {
          const relative = path.relative(base, real);
          return (
            relative === "" ||
            (relative !== ".." &&
              !relative.startsWith(".." + path.sep) &&
              !path.isAbsolute(relative))
          );
        })
      )
        throw new Error(
          "Input root must be within a configured read-only /inputs mount or bundled fixtures",
        );
      spec.root = real;
    }
  return workspace;
}
function send(res, status, value) {
  const data = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}
async function body(req) {
  let bytes = 0,
    parts = [];
  for await (const part of req) {
    bytes += part.length;
    if (bytes > 1024 * 1024) throw new Error("Request JSON exceeds 1 MiB");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
let running = 0;
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health")
        return send(res, 200, {
          status: "ok",
          version: "0.2.0",
          build: buildIdentity(),
          runtime: process.version,
          analysis: "read-only-advisory",
        });
      if (req.method === "GET" && url.pathname === "/api/demos")
        return send(res, 200, {
          demos: demos(),
          checklistDraft: json(
            path.join(fixtureRoot, "requirements/draft-checklist.json"),
          ),
          inputPolicy:
            "Configured read-only /inputs roots or bundled fixtures only",
        });
      if (req.method === "POST" && url.pathname === "/api/analyze") {
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          return send(res, 403, {
            error: "Same-origin analysis requests required",
          });
        if (running >= 2)
          return send(res, 429, {
            error: "Two analyses are running; retry after they finish",
          });
        const input = await body(req),
          demo = demos().find((d) => d.id === input.demo);
        const workspace = authorizeWorkspace(
          input.workspace || demo?.workspace,
        );
        if (running >= 2)
          return send(res, 429, {
            error: "Two analyses are running; retry after they finish",
          });
        running++;
        try {
          return send(
            res,
            200,
            await analyzeWorkspace({
              workspace,
              asOf: input.asOf || new Date().toISOString().slice(0, 10),
              task:
                input.task || "Review proposed API and lookup contract changes",
              checklist:
                input.checklist ||
                json(
                  path.join(fixtureRoot, "requirements/draft-checklist.json"),
                ),
              quality: input.quality,
              cacheDir:
                process.env.REVIEW_ANALYSIS_CACHE ||
                "/tmp/review-analysis-cache",
            }),
          );
        } finally {
          running--;
        }
      }
      if (req.method === "GET") {
        const routes = {
          "/": "index.html",
          "/index.html": "index.html",
          "/app.js": "app.js",
          "/styles.css": "styles.css",
        };
        const file = routes[url.pathname];
        if (file && fs.existsSync(path.join(root, "ui", file))) {
          res.writeHead(200, {
            "content-type": file.endsWith(".html")
              ? "text/html; charset=utf-8"
              : file.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/css; charset=utf-8",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
            "content-security-policy":
              "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          });
          return res.end(fs.readFileSync(path.join(root, "ui", file)));
        }
      }
      send(res, 404, { error: "Route not found" });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  createServer().listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "0.0.0.0",
    () =>
      console.log(
        "Review Analysis ready at http://localhost:" +
          (process.env.PORT || 8787),
      ),
  );
