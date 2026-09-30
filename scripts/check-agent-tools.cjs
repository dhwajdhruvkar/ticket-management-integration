"use strict";

const { createHash } = require("node:crypto");
const { lstatSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function digestDirectory(directory) {
  const hash = createHash("sha256");
  function visit(relative) {
    const full = path.join(directory, relative);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error("Symlinks are not supported in vendored skills");
    if (stat.isDirectory()) {
      for (const name of readdirSync(full).sort()) visit(path.join(relative, name));
    } else if (stat.isFile()) {
      hash.update(relative.split(path.sep).join("/") + "\0");
      hash.update(createHash("sha256").update(readFileSync(full)).digest("hex") + "\n");
    } else {
      throw new Error("Unsupported vendored file type");
    }
  }
  visit("");
  return hash.digest("hex");
}

function verifyDirectories(root, directories) {
  const errors = [];
  for (const [relative, expected] of Object.entries(directories)) {
    const target = path.resolve(root, relative);
    const resolved = path.relative(path.resolve(root), target);
    if (!resolved || resolved === ".." || resolved.startsWith(".." + path.sep) || path.isAbsolute(resolved)) {
      throw new Error(`Unsafe lock path: ${relative}`);
    }
    try {
      if (digestDirectory(target) !== expected) errors.push(`${relative}: content differs from the lock`);
    } catch {
      errors.push(`${relative}: missing or unreadable directory`);
    }
  }
  return errors;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, "..");
    const lockPath = path.join(root, "agent-tools.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (process.argv.includes("--update-lock")) {
      const directories = [".agents/references", ...lock.sources.flatMap((source) =>
        source.skills.map((name) => `.agents/skills/${name}`))];
      lock.directories = Object.fromEntries(directories.map((directory) =>
        [directory, digestDirectory(path.join(root, directory))]));
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    }
    if (lock.schemaVersion !== 1 || !lock.directories || !Object.keys(lock.directories).length) {
      throw new Error("Invalid or empty agent tools lock");
    }
    const errors = verifyDirectories(root, lock.directories);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`[agent-tools] Verified ${Object.keys(lock.directories).length} pinned directories.`);
  } catch (error) {
    console.error(`[agent-tools] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { digestDirectory, verifyDirectories };
