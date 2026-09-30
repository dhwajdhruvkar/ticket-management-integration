import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), ticket: vi.fn(), agent: vi.fn(), requester: vi.fn() }));
vi.mock("@/server/guards", () => ({ requirePermission: mocks.permission, loadTicket: mocks.ticket, isResponse: (value: unknown) => value instanceof Response }));
vi.mock("@/server/services/agentActions", () => ({ agentReply: mocks.agent, requesterReply: mocks.requester }));
import { POST } from "@/app/api/v1/tickets/[id]/messages/route";
const send = (body: unknown) => POST(new Request("https://example.test/api/v1/tickets/t/messages", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "t" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ role: "agent", actor: { id: "agent", name: "Agent", role: "agent" }, email: "agent@example.test" });
  mocks.ticket.mockResolvedValue({ id: "t", requesterEmail: "requester@example.test" });
  mocks.agent.mockResolvedValue({ id: "t" });
});
describe("ticket message input boundary", () => {
  it("rejects non-text bodies and invalid visibility before mutation", async () => {
    expect((await send({ body: 123 })).status).toBe(400);
    expect((await send({ body: "hello", visibility: "secret" })).status).toBe(400);
    expect(mocks.agent).not.toHaveBeenCalled();
  });
  it("does not let staff impersonate the requester", async () => {
    expect((await send({ body: "reopen", asRequester: true })).status).toBe(403);
    expect(mocks.requester).not.toHaveBeenCalled();
  });
});
