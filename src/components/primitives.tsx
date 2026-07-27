"use client";

// =============================================================================
// Reusable overlay + state primitives.
//
// Modal (center dialog) and Drawer (right slide-over) use framer-motion for
// enter/exit, a tokenized scrim with backdrop blur, Escape-to-close, and body
// scroll lock. EmptyState is a consistent, elegant placeholder. All presentational.
// =============================================================================

import { useEffect, useId, useRef, useState } from "react";
import { X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, EASE_OUT } from "@/components/motion";

function useOverlayBehavior(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

const scrimStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  backdropFilter: "var(--backdrop-blur)",
  WebkitBackdropFilter: "var(--backdrop-blur)",
  zIndex: 80,
  display: "flex",
};

export function Modal({
  open,
  onClose,
  children,
  ariaLabel,
  maxWidth = 560,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  maxWidth?: number;
}) {
  useOverlayBehavior(open, onClose);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          style={{ ...scrimStyle, alignItems: "flex-start", justifyContent: "center", padding: "6vh 1rem 1rem", overflowY: "auto" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            style={{
              width: "100%",
              maxWidth,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-xl)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  ariaLabel,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  width?: number;
}) {
  useOverlayBehavior(open, onClose);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          style={{ ...scrimStyle, justifyContent: "flex-end" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={(e) => e.stopPropagation()}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            style={{
              width: "100%",
              maxWidth: width,
              height: "100%",
              background: "var(--surface)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "var(--shadow-lg)",
              overflowY: "auto",
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * In-app replacement for `window.prompt`. The native dialog is unstyled, blocks
 * the whole tab, is suppressed outright in some browsers, and cannot show the
 * context an audited override needs, so anywhere the product asks for a line of
 * text it uses this instead.
 */
export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "Save",
  required = false,
  multiline = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  /** Block confirm until the field has non-whitespace content. */
  required?: boolean;
  multiline?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const fieldId = useId();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const t = setTimeout(() => fieldRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, initialValue]);

  const canSubmit = !busy && (!required || value.trim().length > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm(value.trim());
  }

  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title} maxWidth={480}>
      <form onSubmit={submit} style={{ padding: "1.1rem 1.2rem 1.2rem" }}>
        <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 6 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 750, margin: 0 }}>{title}</h2>
          <CloseButton onClick={onCancel} />
        </div>
        {description ? (
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 12px", lineHeight: 1.5 }}>
            {description}
          </p>
        ) : null}
        <label className="label" htmlFor={fieldId} style={{ display: "block", marginBottom: 6 }}>
          {label}
        </label>
        {multiline ? (
          <textarea
            id={fieldId}
            ref={(el) => {
              fieldRef.current = el;
            }}
            className="input"
            rows={3}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: "100%", resize: "vertical" }}
          />
        ) : (
          <input
            id={fieldId}
            ref={(el) => {
              fieldRef.current = el;
            }}
            className="input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: "100%" }}
          />
        )}
        <div className="flex items-center justify-end" style={{ gap: 8, marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Consistent close button for modals/drawers. */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Close" onClick={onClick}>
      <X size={18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function EmptyState({
  icon: Glyph,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "3rem 1.5rem",
        gap: "0.7rem",
      }}
    >
      {Glyph ? (
        <span
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: "var(--r-xl)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--muted)",
            marginBottom: 2,
          }}
        >
          <Glyph size={24} strokeWidth={1.6} />
        </span>
      ) : null}
      <div style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
        {title}
      </div>
      {description ? (
        <div className="muted" style={{ fontSize: "var(--fs-body)", maxWidth: 390, lineHeight: 1.5 }}>
          {description}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}
