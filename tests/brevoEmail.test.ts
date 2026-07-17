import { describe, expect, it } from "vitest";
import { parseBrevoItems } from "@/server/channels/brevoEmail";

// Representative Brevo Inbound Parsing payload (subset of real fields).
const payload = {
  items: [
    {
      Uuid: ["uuid-1"],
      MessageId: "<msg-1@mail.example.com>",
      InReplyTo: "<parent-1@mail.example.com>",
      From: { Name: "Erin External", Address: "Erin@Customer.com" },
      To: [{ Name: "Support", Address: "support@netlink.com" }],
      Subject: "Cannot open the expense portal",
      RawHtmlBody: "<p>The portal shows <b>error 500</b>.</p>",
      RawTextBody: "The portal shows error 500.",
      SentAtDate: "Tue, 06 Jul 2026 09:00:00 +0000",
      Attachments: [
        { Name: "screenshot.png", ContentType: "image/png", DownloadToken: "tok-abc" },
        { Name: "no-token.txt", ContentType: "text/plain" },
      ],
      Headers: {
        "Message-Id": "<msg-1@mail.example.com>",
        References: "<root@mail.example.com> <parent-1@mail.example.com>",
        "In-Reply-To": "<parent-1@mail.example.com>",
      },
    },
  ],
};

describe("parseBrevoItems", () => {
  it("maps a Brevo item to the InboundEmail shape", () => {
    const parsed = parseBrevoItems(payload);
    expect(parsed).toHaveLength(1);
    const { email } = parsed[0];
    expect(email.from).toBe("Erin@Customer.com");
    expect(email.to).toBe("support@netlink.com");
    expect(email.subject).toBe("Cannot open the expense portal");
    expect(email.internetMessageId).toBe("<msg-1@mail.example.com>");
    expect(email.inReplyTo).toBe("<parent-1@mail.example.com>");
    expect(email.referencesHeader).toContain("<root@mail.example.com>");
    expect(email.bodyHtml).toContain("error 500");
    expect(email.bodyText).toBe("The portal shows error 500.");
    expect(email.receivedAt).toBe("2026-07-06T09:00:00.000Z");
  });

  it("keeps only attachments that carry a download token", () => {
    const [{ attachments }] = parseBrevoItems(payload);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual({ name: "screenshot.png", contentType: "image/png", token: "tok-abc" });
  });

  it("falls back to Headers when top-level Message-Id / In-Reply-To are absent", () => {
    const [{ email }] = parseBrevoItems({
      items: [
        {
          From: { Address: "sam@customer.com" },
          Subject: "Re: printer",
          RawTextBody: "still broken",
          Headers: { "Message-Id": "<h-1@x>", "In-Reply-To": "<h-parent@x>" },
        },
      ],
    });
    expect(email.internetMessageId).toBe("<h-1@x>");
    expect(email.inReplyTo).toBe("<h-parent@x>");
  });

  it("handles multiple items and tolerates empty/invalid payloads", () => {
    const many = parseBrevoItems({
      items: [
        { From: { Address: "a@x.com" }, Subject: "one", RawTextBody: "1" },
        { From: { Address: "b@x.com" }, Subject: "two", RawTextBody: "2" },
      ],
    });
    expect(many.map((p) => p.email.from)).toEqual(["a@x.com", "b@x.com"]);

    expect(parseBrevoItems({})).toEqual([]);
    expect(parseBrevoItems(null)).toEqual([]);
    expect(parseBrevoItems({ items: "nope" })).toEqual([]);
  });

  it("defaults subject and sender when missing, and invalid dates become null", () => {
    const [{ email }] = parseBrevoItems({
      items: [{ RawTextBody: "no subject or sender", SentAtDate: "not-a-date" }],
    });
    expect(email.subject).toBe("(no subject)");
    expect(email.from).toBe("unknown@external");
    expect(email.receivedAt).toBeNull();
  });
});
