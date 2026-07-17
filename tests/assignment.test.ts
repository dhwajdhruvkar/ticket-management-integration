import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { pickAssignee } from "@/server/services/groupService";
import { intakeTicket } from "@/server/services/intake";
import type { UserRow } from "@/server/domain/models";

const TENANT = "tenant_netlink";

function mkMember(id: string, active = true): UserRow {
  return {
    id,
    tenantId: TENANT,
    email: `${id}@x.com`,
    name: id,
    role: "agent",
    active,
    createdAt: "",
    updatedAt: "",
  };
}

beforeAll(async () => {
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

describe("pickAssignee", () => {
  const members = [mkMember("a"), mkMember("b"), mkMember("c")];

  it("round robin cycles through active members", () => {
    const first = pickAssignee("round_robin", members, 0, new Map());
    expect(first).toEqual({ userId: "b", nextIndex: 1 });
    const second = pickAssignee("round_robin", members, 1, new Map());
    expect(second).toEqual({ userId: "c", nextIndex: 2 });
    const wrap = pickAssignee("round_robin", members, 2, new Map());
    expect(wrap).toEqual({ userId: "a", nextIndex: 0 });
  });

  it("round robin skips inactive members", () => {
    const withInactive = [mkMember("a"), mkMember("b", false), mkMember("c")];
    // Active list is [a, c]; index cycles over it.
    const pick = pickAssignee("round_robin", withInactive, 0, new Map());
    expect(pick?.userId).toBe("c");
  });

  it("least loaded picks the member with the fewest open tickets", () => {
    const counts = new Map([
      ["a", 5],
      ["b", 1],
      ["c", 3],
    ]);
    expect(pickAssignee("least_loaded", members, 0, counts)?.userId).toBe("b");
  });

  it("returns null for manual strategy or empty groups", () => {
    expect(pickAssignee("manual", members, 0, new Map())).toBeNull();
    expect(pickAssignee("round_robin", [], 0, new Map())).toBeNull();
  });
});

describe("VIP intake", () => {
  it("bumps urgency/priority and tags vip tickets", async () => {
    const store = await getStore();
    const users = await store.users.list({ tenantId: TENANT });
    const dana = users.find((u) => u.email === "dana.lee@netlink.com");
    expect(dana).toBeTruthy();
    await store.users.update(dana!.id, { vip: true });

    const ticket = await intakeTicket(TENANT, {
      subject: "Projector remote missing",
      body: "The meeting room projector remote is missing.",
      requesterEmail: "dana.lee@netlink.com",
      channel: "portal",
      autoResolve: false,
    });
    expect(ticket.tags).toContain("vip");
    expect(ticket.urgency).toBe("high");
    expect(["critical", "high", "medium"]).toContain(ticket.priority);

    await store.users.update(dana!.id, { vip: false });
  });
});
