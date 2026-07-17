import { describe, expect, it } from "vitest";
import { extractReferenceToken, matchThread } from "@/server/channels/emailThreading";

describe("extractReferenceToken", () => {
  it("finds INC/REQ/PRB/CHG tokens case-insensitively", () => {
    expect(extractReferenceToken("[INC-8F3K2A] Re: printer")).toBe("INC-8F3K2A");
    expect(extractReferenceToken("RE: [req-b2] laptop")).toBe("REQ-B2");
    expect(extractReferenceToken("no token here")).toBeNull();
    expect(extractReferenceToken("[XYZ-123] unknown prefix")).toBeNull();
  });
});

describe("matchThread", () => {
  const ledger = [
    { internetMessageId: "<m1@x>", conversationId: "conv-1", ticketId: "t1" },
    { internetMessageId: "<m2@x>", conversationId: "conv-2", ticketId: "t2" },
    { internetMessageId: "<orphan@x>", conversationId: "conv-3", ticketId: null },
  ];
  const refLookup = (ref: string) => (ref === "INC-AAA" ? "t9" : null);

  it("prefers the subject reference token", () => {
    const match = matchThread(
      { subject: "[INC-AAA] Re: help", conversationId: "conv-1", inReplyTo: "<m2@x>" },
      ledger,
      refLookup
    );
    expect(match).toEqual({ ticketId: "t9", via: "subject_reference" });
  });

  it("falls back to In-Reply-To ancestry", () => {
    const match = matchThread(
      { subject: "Re: help", inReplyTo: "<m2@x>", conversationId: "conv-1" },
      ledger,
      refLookup
    );
    expect(match).toEqual({ ticketId: "t2", via: "in_reply_to" });
  });

  it("matches References header entries", () => {
    const match = matchThread(
      { subject: "Re: help", referencesHeader: "<zzz@x> <m1@x>" },
      ledger,
      refLookup
    );
    expect(match).toEqual({ ticketId: "t1", via: "in_reply_to" });
  });

  it("falls back to conversationId", () => {
    const match = matchThread({ subject: "Re: help", conversationId: "conv-2" }, ledger, refLookup);
    expect(match).toEqual({ ticketId: "t2", via: "conversation_id" });
  });

  it("ignores ledger rows without a ticket and returns null when nothing matches", () => {
    expect(matchThread({ subject: "Re: x", conversationId: "conv-3" }, ledger, refLookup)).toBeNull();
    expect(matchThread({ subject: "fresh mail" }, ledger, refLookup)).toBeNull();
  });
});
