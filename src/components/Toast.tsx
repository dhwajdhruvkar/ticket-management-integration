"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X, type LucideIcon } from "lucide-react";

// =============================================================================
// Toast notifications
//
// Lightweight, dependency-free. Mount <ToastProvider> once at the root and
// call useToast() anywhere to show a transient message.
//
//   const toast = useToast();
//   toast.success("Reply sent to requester");
//   toast.error("Failed to save article", { description: err.message });
//
// Variants: success | info | warning | error
// Each toast auto-dismisses after `duration` ms (default 4000), but the timer
// pauses while the user hovers over the stack so they can read longer messages.
// =============================================================================

export type ToastVariant = "success" | "info" | "warning" | "error";

interface ToastInput {
  title?: string;
  description?: string;
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, "description">> {
  id: number;
  variant: ToastVariant;
  description?: string;
}

interface ToastApi {
  show: (variant: ToastVariant, message: string | ToastInput) => void;
  success: (message: string | ToastInput) => void;
  info: (message: string | ToastInput) => void;
  warning: (message: string | ToastInput) => void;
  error: (message: string | ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;

const VARIANT_STYLES: Record<
  ToastVariant,
  { bg: string; border: string; accent: string; Icon: LucideIcon; iconBg: string }
> = {
  success: {
    bg: "var(--success-bg)",
    border: "var(--success-border)",
    accent: "var(--success-fg)",
    Icon: CheckCircle2,
    iconBg: "var(--success-solid)",
  },
  info: {
    bg: "var(--info-bg)",
    border: "var(--info-border)",
    accent: "var(--info-fg)",
    Icon: Info,
    iconBg: "var(--info-solid)",
  },
  warning: {
    bg: "var(--warning-bg)",
    border: "var(--warning-border)",
    accent: "var(--warning-fg)",
    Icon: AlertTriangle,
    iconBg: "var(--warning-solid)",
  },
  error: {
    bg: "var(--danger-bg)",
    border: "var(--danger-border)",
    accent: "var(--danger-fg)",
    Icon: XCircle,
    iconBg: "var(--danger-solid)",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const idRef = useRef(0);
  const pausedRef = useRef(false);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, duration: number) => {
      if (pausedRef.current) return; // resume() will reschedule
      const handle = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, handle);
    },
    [dismiss]
  );

  const show = useCallback<ToastApi["show"]>(
    (variant, message) => {
      const input: ToastInput = typeof message === "string" ? { title: message } : message;
      const id = ++idRef.current;
      const item: ToastItem = {
        id,
        variant,
        title: input.title ?? "",
        description: input.description,
        duration: input.duration ?? DEFAULT_DURATION,
      };
      setToasts((prev) => [...prev, item]);
      schedule(id, item.duration);
    },
    [schedule]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show("success", m),
      info: (m) => show("info", m),
      warning: (m) => show("warning", m),
      error: (m) => show("error", m),
      dismiss,
    }),
    [show, dismiss]
  );

  // Pause auto-dismiss while user is hovering the stack
  function pause() {
    pausedRef.current = true;
    timers.current.forEach((handle) => clearTimeout(handle));
    timers.current.clear();
  }
  function resume() {
    pausedRef.current = false;
    setToasts((current) => {
      current.forEach((t) => schedule(t.id, t.duration));
      return current;
    });
  }

  useEffect(() => {
    return () => {
      timers.current.forEach((handle) => clearTimeout(handle));
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        onMouseEnter={pause}
        onMouseLeave={resume}
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9999,
          maxWidth: "min(380px, calc(100vw - 40px))",
          pointerEvents: toasts.length ? "auto" : "none",
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const s = VARIANT_STYLES[toast.variant];
  const Glyph = s.Icon;
  return (
    <div
      role="status"
      className="toast-in"
      style={{
        display: "flex",
        gap: 12,
        padding: "0.85rem 1rem",
        background: "var(--surface)",
        // Per-side values (not the `border` shorthand): mixing it with the
        // accent borderLeft makes React warn on rerender.
        borderTop: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        borderLeft: `3px solid ${s.iconBg}`,
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-lg)",
        alignItems: "flex-start",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--r-pill)",
          background: s.iconBg,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <Glyph size={14} strokeWidth={2.4} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title ? (
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.86rem",
              color: "var(--text)",
              lineHeight: 1.35,
            }}
          >
            {toast.title}
          </div>
        ) : null}
        {toast.description ? (
          <div
            style={{
              fontSize: "0.78rem",
              color: "var(--text-secondary)",
              marginTop: 3,
              lineHeight: 1.45,
              wordBreak: "break-word",
            }}
          >
            {toast.description}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          background: "transparent",
          border: "none",
          color: s.accent,
          opacity: 0.6,
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          padding: 2,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be used inside <ToastProvider>");
  }
  return ctx;
}
