import { describe, expect, it } from "vitest";
import { bareAddress, htmlToText, trimQuotedReply } from "@/server/channels/emailText";

describe("htmlToText", () => {
  it("strips tags and converts structure to newlines", () => {
    const html = "<div><p>Hello <b>world</b></p><ul><li>one</li><li>two</li></ul></div>";
    const text = htmlToText(html);
    expect(text).toContain("Hello world");
    expect(text).toContain("- one");
    expect(text).toContain("- two");
    expect(text).not.toContain("<");
  });

  it("drops script/style and decodes entities", () => {
    const html = "<style>.a{color:red}</style><script>alert(1)</script><p>Fish &amp; chips &lt;3</p>";
    const text = htmlToText(html);
    expect(text).toBe("Fish & chips <3");
  });

  it("converts <br> and collapses blank runs", () => {
    const text = htmlToText("line1<br><br><br>line2");
    expect(text).toBe("line1\n\nline2");
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("<p>&#8364;100</p>")).toBe("€100");
  });
});

describe("trimQuotedReply", () => {
  it("cuts at 'On ... wrote:'", () => {
    const text = "Thanks, that fixed it!\n\nOn Thu, Jul 2, 2026 at 9:00 AM Support <support@x.com> wrote:\n> original message";
    expect(trimQuotedReply(text)).toBe("Thanks, that fixed it!");
  });

  it("cuts at Original Message separators", () => {
    const text = "New content here\n-----Original Message-----\nFrom: someone";
    expect(trimQuotedReply(text)).toBe("New content here");
  });

  it("drops trailing '>' quoted tails", () => {
    const text = "My reply\n\n> quoted line 1\n> quoted line 2";
    expect(trimQuotedReply(text)).toBe("My reply");
  });

  it("returns input unchanged when there is no quoted history", () => {
    expect(trimQuotedReply("Just a plain message")).toBe("Just a plain message");
  });

  it("never returns empty when the mail is only quotes", () => {
    const text = "> only quotes\n> nothing new";
    expect(trimQuotedReply(text).length).toBeGreaterThan(0);
  });
});

describe("bareAddress", () => {
  it("extracts angled addresses and lowercases", () => {
    expect(bareAddress("Dana Lee <Dana.Lee@Netlink.com>")).toBe("dana.lee@netlink.com");
    expect(bareAddress("user@example.com")).toBe("user@example.com");
  });
});
