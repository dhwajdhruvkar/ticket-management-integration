// Dialog accessibility rules shared by Modal, Drawer and the Help Center request
// dialog, tested against a small fake DOM (the repository has no jsdom). What a
// fake cannot show - real browser focus rings, screen-reader announcements and
// animation timing - is listed as manual checks in the delivery notes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOverlay, resetOverlays, type DialogLike, type FocusableLike, type KeyLike, type OverlayDom } from "@/lib/overlayBehavior";

class FakeEl implements FocusableLike {
  isConnected = true;
  constructor(readonly name: string, private readonly dom: FakeDom) {}
  focus() { this.dom.active = this; }
}

class FakeDialog implements DialogLike {
  readonly isConnected = true;
  readonly children: FakeEl[];
  constructor(readonly name: string, private readonly dom: FakeDom, buttons: string[]) {
    this.children = buttons.map((b) => new FakeEl(`${name}/${b}`, dom));
  }
  focus() { this.dom.active = this; }
  contains(node: unknown) { return node === this || (this.children as unknown[]).includes(node); }
  tabbables() { return this.children; }
}

class FakeDom implements OverlayDom {
  active: unknown = null;
  overflow = "";
  handlers = new Set<(e: KeyLike) => void>();
  frames: (() => void)[] = [];
  deferred: (() => void)[] = [];
  defer(cb: () => void) { this.deferred.push(cb); }
  flushDeferred() { const d = this.deferred; this.deferred = []; d.forEach((cb) => cb()); }
  activeElement() { return this.active as FocusableLike | null; }
  onKeydown(h: (e: KeyLike) => void) { this.handlers.add(h); return () => void this.handlers.delete(h); }
  bodyOverflow = { get: () => this.overflow, set: (v: string) => { this.overflow = v; } };
  afterMount(cb: () => void) { this.frames.push(cb); return () => { this.frames = this.frames.filter((f) => f !== cb); }; }
  flushFrames() { const f = this.frames; this.frames = []; f.forEach((cb) => cb()); }
  /** Dispatches a key to every listener, like document.dispatchEvent; returns whether default was prevented. */
  press(key: string, shiftKey = false) {
    const event = { key, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const h of [...this.handlers]) h(event);
    return event;
  }
}

let dom: FakeDom;
beforeEach(() => { resetOverlays(); dom = new FakeDom(); });
afterEach(() => resetOverlays());

function open(name: string, buttons = ["first", "middle", "last"], onClose = () => {}) {
  const dialog = new FakeDialog(name, dom, buttons);
  const close = openOverlay(dom, () => dialog, onClose);
  return { dialog, close };
}

describe("focus on open and restore on close", () => {
  it("moves focus into the dialog once it has mounted", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const { dialog } = open("A");
    expect(dom.active).toBe(trigger); // not before the dialog exists
    dom.flushFrames();
    expect(dom.active).toBe(dialog);
  });

  it("leaves focus alone when a child (for example an autofocused field) already has it", () => {
    const { dialog } = open("A");
    dialog.children[1].focus();
    dom.flushFrames();
    expect(dom.active).toBe(dialog.children[1]);
  });

  it("returns focus to the element that opened the dialog when it closes", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const { dialog, close } = open("A");
    dom.flushFrames();
    expect(dom.active).toBe(dialog);
    close();
    dom.flushDeferred();
    expect(dom.active).toBe(trigger);
  });

  it("does not restore focus to an opener that has left the page", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const other = new FakeEl("other", dom);
    const { close } = open("A");
    dom.flushFrames();
    other.focus();
    trigger.isConnected = false;
    close();
    dom.flushDeferred();
    expect(dom.active).toBe(other);
  });

  it("returns focus to an explicitly given opener even when a child (autoFocus) took focus first", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const dialog = new FakeDialog("A", dom, ["first"]);
    dialog.children[0].focus(); // the autofocused field already has focus when the overlay opens
    const close = openOverlay(dom, () => dialog, () => {}, trigger);
    close();
    dom.flushDeferred();
    expect(dom.active).toBe(trigger); // not the field inside the dialog that just closed
  });

  it("an immediate re-open (React dev mode remounting its effect) keeps focus where the new overlay put it", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const dialog = new FakeDialog("A", dom, ["field"]);
    dialog.children[0].focus(); // autoFocus
    const first = openOverlay(dom, () => dialog, () => {}, trigger);
    first(); // simulated unmount
    openOverlay(dom, () => dialog, () => {}, trigger); // simulated remount
    dom.flushDeferred();
    dom.flushFrames();
    expect(dom.active).toBe(dialog.children[0]); // not yanked back to the trigger
  });

  it("closing an inner overlay still returns focus to its opener inside the outer one", () => {
    const outer = open("outer");
    const field = outer.dialog.children[1]; field.focus();
    const inner = open("inner");
    inner.dialog.children[0].focus();
    inner.close();
    dom.flushDeferred();
    expect(dom.active).toBe(field);
  });

  it("closing twice is harmless", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const { close } = open("A");
    close();
    expect(() => close()).not.toThrow();
    expect(dom.overflow).toBe("");
  });
});

describe("Tab and Shift+Tab stay inside the dialog", () => {
  it("wraps from the last control to the first, and from the first to the last", () => {
    const { dialog } = open("A");
    dom.flushFrames();
    dialog.children[2].focus();
    const forward = dom.press("Tab");
    expect(forward.prevented).toBe(true);
    expect(dom.active).toBe(dialog.children[0]);
    const backward = dom.press("Tab", true);
    expect(backward.prevented).toBe(true);
    expect(dom.active).toBe(dialog.children[2]);
  });

  it("lets Tab move normally between controls in the middle", () => {
    const { dialog } = open("A");
    dialog.children[1].focus();
    expect(dom.press("Tab").prevented).toBe(false);
    expect(dom.press("Tab", true).prevented).toBe(false);
  });

  it("pulls focus back in when it is somewhere outside the dialog", () => {
    const { dialog } = open("A");
    new FakeEl("page-link", dom).focus();
    dom.press("Tab");
    expect(dom.active).toBe(dialog.children[0]);
    new FakeEl("page-link", dom).focus();
    dom.press("Tab", true);
    expect(dom.active).toBe(dialog.children[2]);
  });

  it("Shift+Tab from the dialog container itself goes to the last control", () => {
    const { dialog } = open("A");
    dom.flushFrames(); // focus is on the dialog element
    dom.press("Tab", true);
    expect(dom.active).toBe(dialog.children[2]);
  });

  it("keeps focus on the dialog when it has nothing tabbable", () => {
    const { dialog } = open("A", []);
    const e = dom.press("Tab");
    expect(e.prevented).toBe(true);
    expect(dom.active).toBe(dialog);
  });

  it("ignores other keys", () => {
    open("A");
    const e = dom.press("a");
    expect(e.prevented || e.stopped).toBe(false);
  });
});

describe("Escape", () => {
  it("closes the dialog", () => {
    let closed = 0;
    open("A", undefined, () => closed++);
    const e = dom.press("Escape");
    expect(closed).toBe(1);
    expect(e.stopped).toBe(true);
  });

  it("with nested dialogs, only the top-most one closes", () => {
    const closed: string[] = [];
    open("outer", undefined, () => closed.push("outer"));
    open("inner", undefined, () => closed.push("inner"));
    dom.press("Escape");
    expect(closed).toEqual(["inner"]);
  });

  it("after the top one is gone, Escape reaches the one below", () => {
    const closed: string[] = [];
    open("outer", undefined, () => closed.push("outer"));
    const inner = open("inner", undefined, () => closed.push("inner"));
    inner.close();
    dom.press("Escape");
    expect(closed).toEqual(["outer"]);
  });

  it("Tab is trapped in the top-most dialog only", () => {
    const outer = open("outer");
    const inner = open("inner");
    inner.dialog.children[2].focus();
    dom.press("Tab");
    expect(dom.active).toBe(inner.dialog.children[0]);
    expect(outer.dialog.children).not.toContain(dom.active);
  });
});

describe("background scrolling", () => {
  it("is locked while any overlay is open and restored to the original value after the last closes", () => {
    dom.overflow = "auto";
    const a = open("A");
    expect(dom.overflow).toBe("hidden");
    const b = open("B");
    expect(dom.overflow).toBe("hidden");
    b.close();
    expect(dom.overflow).toBe("hidden"); // A is still open
    a.close();
    expect(dom.overflow).toBe("auto");
  });

  it("is restored when the outer overlay unmounts before the inner one (out of order)", () => {
    dom.overflow = "";
    const outer = open("outer");
    const inner = open("inner");
    outer.close();
    expect(dom.overflow).toBe("hidden");
    inner.close();
    expect(dom.overflow).toBe(""); // not stuck on "hidden"
  });

  it("an overlay that unmounts without Escape (for example its page navigated away) releases everything", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const { close } = open("A");
    dom.flushFrames();
    close(); // what the hook's effect cleanup does on unmount
    dom.flushDeferred();
    expect(dom.overflow).toBe("");
    expect(dom.handlers.size).toBe(0);
    expect(dom.active).toBe(trigger);
    expect(dom.press("Escape").stopped).toBe(false); // no stale listener left behind
  });

  it("an overlay closed before it mounted never steals focus afterwards", () => {
    const trigger = new FakeEl("trigger", dom); trigger.focus();
    const { close } = open("A");
    close();
    dom.flushFrames();
    expect(dom.active).toBe(trigger);
  });
});
