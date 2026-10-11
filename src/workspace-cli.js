#!/usr/bin/env node
import fs from "node:fs";
import { analyzeWorkspace } from "../app-dist/workspace.js";
import { assertOutside } from "./snapshot.js";
const args = process.argv.slice(2),
  options = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--workspace", "--checklist", "--as-of", "--cache", "--out"].includes(
        args[i],
      ) ||
      !args[i + 1]
    )
      throw new Error(
        "Usage: node src/workspace-cli.js --workspace workspace.json --as-of YYYY-MM-DD [--checklist checklist.json] [--cache DIR] [--out FILE]",
      );
    options[args[i]] = args[i + 1];
  }
  const workspace = JSON.parse(fs.readFileSync(options["--workspace"], "utf8"));
  const out = assertOutside(
    options["--out"],
    workspace.projects.flatMap((p) => [p.baseline.root, p.candidate.root]),
  );
  const report = await analyzeWorkspace({
    workspace,
    asOf: options["--as-of"],
    checklist: options["--checklist"]
      ? JSON.parse(fs.readFileSync(options["--checklist"], "utf8"))
      : undefined,
    cacheDir: options["--cache"],
  });
  const text = JSON.stringify(report, null, 2) + "\n";
  if (out) fs.writeFileSync(out, text);
  else process.stdout.write(text);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
