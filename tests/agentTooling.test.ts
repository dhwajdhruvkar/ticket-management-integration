import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestDirectory, verifyDirectories } from "../scripts/check-agent-tools.cjs";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("vendored agent-tool integrity", () => {
  it("detects changed, added and missing skill files", () => {
    const root = mkdtempSync(join(tmpdir(), "netlink-agent-tools-"));
    temporaryRoots.push(root);
    const skill = join(root, "skill");
    mkdirSync(skill);
    writeFileSync(join(skill, "SKILL.md"), "original");
    const pinned = { skill: digestDirectory(skill) };
    expect(verifyDirectories(root, pinned)).toEqual([]);
    writeFileSync(join(skill, "SKILL.md"), "changed");
    expect(verifyDirectories(root, pinned)).toEqual(["skill: content differs from the lock"]);
    writeFileSync(join(skill, "SKILL.md"), "original");
    writeFileSync(join(skill, "extra.md"), "extra");
    expect(verifyDirectories(root, pinned)).toHaveLength(1);
    rmSync(skill, { recursive: true });
    expect(verifyDirectories(root, pinned)).toEqual(["skill: missing or unreadable directory"]);
  });

  it("rejects lock paths outside the repository", () => {
    expect(() => verifyDirectories(process.cwd(), { "../outside": "hash" })).toThrow("Unsafe lock path");
  });
});
