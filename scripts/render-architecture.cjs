"use strict";

const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const now = new Date();
const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(),
  now.getHours(), now.getMinutes(), now.getSeconds()]
  .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0")).join("");
mkdirSync(path.join(root, ".archify"), { recursive: true });
const folder = mkdtempSync(path.join(root, ".archify", `architecture-ticket-intake-${stamp}-`));
const candidate = JSON.parse(readFileSync(path.join(root, "docs", "architecture", "ticket-intake.json"), "utf8"));
const output = path.join(folder, "ticket-intake.html");
candidate.meta.output = path.relative(root, output).split(path.sep).join("/");
const input = path.join(folder, "candidate.json");
writeFileSync(input, JSON.stringify(candidate, null, 2) + "\n");
const result = spawnSync(process.execPath, [
  path.join(root, ".agents", "skills", "archify", "bin", "archify.mjs"),
  "finalize", "architecture", input, output, "--repo-root", root, "--quality", "showcase", "--json",
], { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
console.log(`Architecture output: ${output}`);
