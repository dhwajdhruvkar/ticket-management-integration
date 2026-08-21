import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { pickAssignee, pickReassignee, reassignToLeastLoaded } from "@/server/services/groupService";
import { intakeTicket } from "@/server/services/intake";
import type { UserRow } from "@/server/domain/models";

const TENANT = "tenant_netlink";

function mkMember(id: string, active = true, available = true): UserRow {
  return {
    id,
    tenantId: TENANT,
    email: `${id}@x.com`,
    name: id,
    role: "agent",
    active,
    available,
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

describe("pickReassignee", () => {
  const members = [mkMember("a"), mkMember("b"), mkMember("c")];
  const counts = new Map([
    ["a", 1],
    ["b", 4],
    ["c", 2],
  ]);

  it("picks the lightest-loaded candidate", () => {
    expect(pickReassignee(members, counts, "b")?.id).toBe("a");
  });

  it("never hands the ticket back to the current assignee", () => {
    // "a" is lightest but already owns it, so "c" is next.
    expect(pickReassignee(members, counts, "a")?.id).toBe("c");
  });

  it("skips members who are away or deactivated", () => {
    const pool = [mkMember("a", true, false), mkMember("b", false), mkMember("c")];
    expect(pickReassignee(pool, counts, null)?.id).toBe("c");
  });

  it("breaks ties on name so the pick is stable", () => {
    const tied = [mkMember("z"), mkMember("m"), mkMember("q")];
    expect(pickReassignee(tied, new Map(), null)?.id).toBe("m");
  });

  it("returns null when nobody else can take it", () => {
    expect(pickReassignee([mkMember("solo")], new Map(), "solo")).toBeNull();
    expect(pickReassignee([], new Map(), null)).toBeNull();
  });
});

describe("reassignToLeastLoaded", () => {
  it("moves a stalled ticket off its current owner", async () => {
    const store = await getStore();
    const created = await intakeTicket(TENANT, {
      subject: "Access switch on floor 2 keeps flapping",
      body: "Ports on the floor-2 access switch drop every few minutes.",
      requesterEmail: "sam.patel@netlink.com",
      channel: "portal",
      category: "Network",
      autoResolve: false,
    });

    const owner = (await store.users.list({ tenantId: TENANT })).find(
      (u) => u.role === "agent" && u.active
    )!;
    await store.tickets.update(created.id, { assigneeId: owner.id });
    const before = (await store.tickets.get(created.id))!;
    expect(before.assigneeId).toBe(owner.id);

    const moved = await reassignToLeastLoaded(before);
    expect(moved).toBeTruthy();
    expect(moved!.assigneeId).toBeTruthy();
    expect(moved!.assigneeId).not.toBe(owner.id);
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
