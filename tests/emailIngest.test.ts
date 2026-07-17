import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { processInboundEmail } from "@/server/channels/emailIngest";
import { getTicket } from "@/server/services/ticketService";

const TENANT = "tenant_netlink";

beforeAll(async () => {
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

describe("email ingestion pipeline", () => {
  it("creates a ticket from a fresh email (HTML body extracted)", async () => {
    const result = await processInboundEmail(TENANT, {
      internetMessageId: "<fresh-1@ext>",
      conversationId: "conv-fresh-1",
      from: "Erin External <erin@customer.com>",
      subject: "Cannot open the expense portal",
      bodyHtml: "<p>Hi team,</p><p>The expense portal shows <b>error 500</b>.</p>",
    });
    expect(result.status).toBe("processed");
    expect(result.ticketId).toBeTruthy();

    const ticket = await getTicket(result.ticketId!);
    expect(ticket?.channel).toBe("email");
    expect(ticket?.requesterEmail).toBe("erin@customer.com");
    expect(ticket?.body).toContain("error 500");
    expect(ticket?.body).not.toContain("<b>");
  });

  it("threads a reply onto the same ticket via subject token instead of duplicating", async () => {
    const first = await processInboundEmail(TENANT, {
      internetMessageId: "<orig-2@ext>",
      conversationId: "conv-2",
      from: "erin@customer.com",
      subject: "VPN drops on hotel wifi",
      bodyText: "It disconnects every few minutes.",
    });
    expect(first.status).toBe("processed");
    const ticket = await getTicket(first.ticketId!);

    const reply = await processInboundEmail(TENANT, {
      internetMessageId: "<reply-2@ext>",
      conversationId: "conv-2",
      from: "erin@customer.com",
      subject: `RE: [${ticket!.reference}] VPN drops on hotel wifi`,
      bodyText: "Still happening after reboot.\n\nOn Thu wrote:\n> old text",
    });
    expect(reply.status).toBe("processed");
    expect(reply.ticketId).toBe(first.ticketId);

    const store = await getStore();
    const messages = await store.messages.list({ ticketId: first.ticketId! });
    const bodies = messages.map((m) => m.body).join("\n");
    expect(bodies).toContain("Still happening after reboot.");
    expect(bodies).not.toContain("old text");
  });

  it("threads via conversationId when the subject token is missing", async () => {
    const first = await processInboundEmail(TENANT, {
      internetMessageId: "<orig-3@ext>",
      conversationId: "conv-3",
      from: "sam@customer.com",
      subject: "Printer offline in Berlin office",
      bodyText: "Both floors affected.",
    });
    const reply = await processInboundEmail(TENANT, {
      internetMessageId: "<reply-3@ext>",
      conversationId: "conv-3",
      from: "sam@customer.com",
      subject: "RE: Printer offline in Berlin office",
      bodyText: "Now the scanner is down too.",
    });
    expect(reply.ticketId).toBe(first.ticketId);
  });

  it("skips duplicate internetMessageIds", async () => {
    const mail = {
      internetMessageId: "<dup-4@ext>",
      from: "erin@customer.com",
      subject: "Duplicate test",
      bodyText: "same message twice",
    };
    const first = await processInboundEmail(TENANT, mail);
    const second = await processInboundEmail(TENANT, mail);
    expect(first.status).toBe("processed");
    expect(second.status).toBe("skipped_duplicate");
  });

  it("skips auto-replies and mail from the support mailbox (loop guard)", async () => {
    const ooo = await processInboundEmail(TENANT, {
      internetMessageId: "<ooo-5@ext>",
      from: "away@customer.com",
      subject: "Automatic reply: Out of office",
      bodyText: "I am away.",
    });
    expect(ooo.status).toBe("skipped_loop");

    const self = await processInboundEmail(
      TENANT,
      {
        internetMessageId: "<self-6@ext>",
        from: "support@netlink.com",
        subject: "We received your request",
        bodyText: "ack",
      },
      { supportMailbox: "support@netlink.com" }
    );
    expect(self.status).toBe("skipped_loop");
  });
});
