import { describe, expect, it } from "vitest";
import { slackSignature, verifySlackRequest } from "@/server/channels/slack";
import {
  buildStringToSign,
  parseConnectionString,
  signSharedKey,
} from "@/server/storage/azureBlob";

function slackReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/webhooks/slack", { method: "POST", headers });
}

describe("Slack signature verification", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";

  it("accepts a correctly signed request", () => {
    const body = JSON.stringify({ type: "event_callback" });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = slackSignature(secret, ts, body);
    const verdict = verifySlackRequest(
      slackReq({ "x-slack-request-timestamp": ts, "x-slack-signature": sig }),
      body,
      Date.now(),
      secret
    );
    expect(verdict.ok).toBe(true);
  });

  it("rejects tampered bodies and stale timestamps", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = slackSignature(secret, ts, "original");
    expect(
      verifySlackRequest(
        slackReq({ "x-slack-request-timestamp": ts, "x-slack-signature": sig }),
        "tampered",
        Date.now(),
        secret
      ).ok
    ).toBe(false);

    const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
    const staleSig = slackSignature(secret, staleTs, "body");
    expect(
      verifySlackRequest(
        slackReq({ "x-slack-request-timestamp": staleTs, "x-slack-signature": staleSig }),
        "body",
        Date.now(),
        secret
      ).ok
    ).toBe(false);
  });

  it("rejects missing headers when a secret is configured", () => {
    expect(verifySlackRequest(slackReq({}), "{}", Date.now(), secret).ok).toBe(false);
  });
});

describe("Azure Blob SharedKey signing", () => {
  it("parses connection strings", () => {
    const parsed = parseConnectionString(
      "DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=a2V5cGFydA==;EndpointSuffix=core.windows.net"
    );
    expect(parsed).toEqual({
      accountName: "acme",
      accountKey: "a2V5cGFydA==",
      endpointSuffix: "core.windows.net",
      protocol: "https",
    });
    expect(parseConnectionString("garbage")).toBeNull();
  });

  it("canonicalizes x-ms headers sorted and the resource path", () => {
    const sts = buildStringToSign({
      verb: "put",
      contentLength: 11,
      contentType: "application/octet-stream",
      msHeaders: {
        "x-ms-version": "2021-08-06",
        "x-ms-date": "Fri, 03 Jul 2026 10:00:00 GMT",
        "x-ms-blob-type": "BlockBlob",
      },
      accountName: "acme",
      resourcePath: "/attachments/att_123",
    });
    const lines = sts.split("\n");
    expect(lines[0]).toBe("PUT");
    expect(lines[3]).toBe("11");
    expect(lines[5]).toBe("application/octet-stream");
    // Sorted x-ms headers: blob-type < date < version.
    expect(lines[12]).toBe("x-ms-blob-type:BlockBlob");
    expect(lines[13]).toBe("x-ms-date:Fri, 03 Jul 2026 10:00:00 GMT");
    expect(lines[14]).toBe("x-ms-version:2021-08-06");
    expect(lines[15]).toBe("/acme/attachments/att_123");
  });

  it("appends canonicalized query params (container ops)", () => {
    const sts = buildStringToSign({
      verb: "PUT",
      msHeaders: { "x-ms-date": "d", "x-ms-version": "v" },
      accountName: "acme",
      resourcePath: "/attachments",
      query: { restype: "container" },
    });
    expect(sts.endsWith("/acme/attachments\nrestype:container")).toBe(true);
  });

  it("signs deterministically with the base64 account key", () => {
    const sig = signSharedKey("STRING", "a2V5cGFydA==");
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(signSharedKey("STRING", "a2V5cGFydA==")).toBe(sig);
  });
});
