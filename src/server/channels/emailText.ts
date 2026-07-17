// =============================================================================
// Email body extraction utilities (dependency-free).
//
// htmlToText: minimal, safe HTML -> plain text (strips script/style, converts
// breaks/paragraphs/list items to newlines, decodes common entities).
// trimQuotedReply: cuts the quoted history from a reply so only the new
// content is stored on the ticket thread.
// =============================================================================

const BLOCK_BREAK = /<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
};

export function htmlToText(html: string): string {
  let text = html;
  // Drop non-content blocks entirely.
  text = text.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Structure -> newlines.
  text = text.replace(LINE_BREAK, "\n");
  text = text.replace(LIST_ITEM, "\n- ");
  text = text.replace(BLOCK_BREAK, "\n");
  // Remaining tags.
  text = text.replace(/<[^>]+>/g, "");
  // Entities (named + numeric).
  for (const [entity, ch] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(ch);
  }
  text = text.replace(/&#(\d+);/g, (_, code: string) => {
    const n = Number(code);
    return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
  });
  // Whitespace cleanup: collapse runs, trim line ends, cap blank lines.
  text = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

/** Markers that begin quoted history in common mail clients. */
const REPLY_MARKERS: RegExp[] = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^On .{5,120} wrote:\s*$/im,
  /^From:\s.+$\n^Sent:\s.+$/im,
  /^From:\s.+$\n^Date:\s.+$/im,
  /^_{10,}\s*$/m,
  /^>{1}\s?On .+ wrote:/im,
];

/**
 * Trim quoted reply history + trailing signatures. Conservative: only cuts
 * when a known marker is found after some new content; otherwise returns the
 * input unchanged (minus fully-quoted ">" tails).
 */
export function trimQuotedReply(text: string): string {
  let cut = text.length;
  for (const marker of REPLY_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index > 0 && match.index < cut) cut = match.index;
  }
  let result = text.slice(0, cut);

  // Drop a trailing run of ">"-quoted lines (client didn't use a marker).
  const lines = result.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1].trim() === "" || lines[end - 1].trimStart().startsWith(">"))) {
    end--;
  }
  if (end > 0 && end < lines.length) result = lines.slice(0, end).join("\n");

  return result.trim() || text.trim();
}

/** Normalize an RFC 5322 address header value to a bare lowercase address. */
export function bareAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  const addr = (angled ? angled[1] : value).trim().toLowerCase();
  return addr;
}
