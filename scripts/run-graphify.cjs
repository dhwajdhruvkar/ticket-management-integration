"use strict";

const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const python = path.join(root, ".tools", "graphify-venv",
  ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));

if (!existsSync(python)) {
  console.error("Graphify is not installed locally. Follow docs/AGENT_TOOLING.md to create .tools/graphify-venv.");
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const commands = args[0] === "--build" ? [
    ["extract", "src", "--code-only", "--out", ".", "--max-workers", "4"],
    ["cluster-only", ".", "--no-label"],
    ["export", "html"],
  ] : [args.length ? args : ["--help"]];
  for (const command of commands) {
    const result = spawnSync(python, ["-m", "graphify", ...command], {
      cwd: root, stdio: "inherit",
      env: { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: "1", PYTHONIOENCODING: "utf-8" },
    });
    if (result.error || result.status !== 0) {
      if (result.error) console.error(result.error.message);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
