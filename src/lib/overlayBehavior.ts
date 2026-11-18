// Behaviour shared by every Modal and Drawer, kept free of React and of the
// real DOM so it is unit-tested with a small fake (tests/overlayBehavior.test.ts):
//   - Escape closes only the top-most open overlay;
//   - the page behind does not scroll while any overlay is open, and scrolling
//     is restored exactly once, when the last one closes (in any order);
//   - focus moves into the dialog on open unless a child already took it;
//   - Tab and Shift+Tab stay inside the dialog;
//   - focus returns to the element that opened the overlay when it closes.

export interface FocusableLike { focus(options?: { preventScroll?: boolean }): void; isConnected?: boolean }
export interface DialogLike extends FocusableLike {
  contains(node: unknown): boolean;
  /** Tabbable descendants in DOM order (visible, enabled). */
  tabbables(): FocusableLike[];
}
export interface KeyLike { key: string; shiftKey?: boolean; preventDefault(): void; stopPropagation(): void }
export interface OverlayDom {
  activeElement(): FocusableLike | null;
  onKeydown(handler: (event: KeyLike) => void): () => void;
  bodyOverflow: { get(): string; set(value: string): void };
  /** Runs `callback` once the dialog is mounted; returns a canceller. */
  afterMount(callback: () => void): () => void;
  /** Runs `callback` shortly after the current task (a microtask in the browser). */
  defer(callback: () => void): void;
}

const stack: symbol[] = [];
let savedOverflow = "";
let opened = 0; // counts every open, so a close can tell whether another overlay opened right after it

/** Test seam: forget any overlays left open by a previous test. */
export function resetOverlays(): void {
  stack.length = 0;
}

/**
 * Opens an overlay; the returned function closes it (idempotent). `getDialog` is read lazily because the element mounts after this call.
 * `opener` is the element to give focus back to; pass it when a child may already have taken focus (autoFocus) by the time this runs.
 */
export function openOverlay(dom: OverlayDom, getDialog: () => DialogLike | null, onClose: () => void, opener?: FocusableLike | null): () => void {
  const me = Symbol("overlay");
  opened += 1;
  if (stack.length === 0) {
    savedOverflow = dom.bodyOverflow.get(); // taken when the FIRST overlay opens, so out-of-order closing cannot leave the page locked
    dom.bodyOverflow.set("hidden");
  }
  stack.push(me);
  const returnTo = opener !== undefined ? opener : dom.activeElement();

  const offKey = dom.onKeydown((event) => {
    if (stack[stack.length - 1] !== me) return; // an overlay above this one owns the keyboard
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = getDialog();
    if (!dialog) return;
    const items = dialog.tabbables();
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = dom.activeElement();
    const outside = !dialog.contains(active);
    if (event.shiftKey && (active === first || active === dialog || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  });

  const cancelMount = dom.afterMount(() => {
    const dialog = getDialog();
    if (dialog && !dialog.contains(dom.activeElement())) dialog.focus({ preventScroll: true });
  });

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    cancelMount();
    offKey();
    const at = stack.indexOf(me);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0) dom.bodyOverflow.set(savedOverflow);
    // Focus goes back after the current task. If another overlay opened in between (React dev mode unmounts and
    // remounts an effect immediately), it owns focus now and the restore is skipped.
    const openedAtClose = opened;
    dom.defer(() => {
      if (opened === openedAtClose && returnTo && returnTo.isConnected !== false) returnTo.focus({ preventScroll: true });
    });
  };
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The real document, for the React hook. */
export function browserOverlayDom(): OverlayDom {
  return {
    activeElement: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    onKeydown(handler) {
      const listener = (e: KeyboardEvent) => handler(e);
      document.addEventListener("keydown", listener);
      return () => document.removeEventListener("keydown", listener);
    },
    bodyOverflow: { get: () => document.body.style.overflow, set: (v) => { document.body.style.overflow = v; } },
    defer: (callback) => queueMicrotask(callback),
    afterMount(callback) {
      const raf = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(raf);
    },
  };
}

export function elementDialog(el: HTMLElement): DialogLike {
  return {
    focus: (o) => el.focus(o),
    contains: (node) => node instanceof Node && el.contains(node),
    tabbables: () => Array.from(el.querySelectorAll<HTMLElement>(TABBABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement),
  };
}
