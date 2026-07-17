"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Sun, Moon } from "lucide-react";

// =============================================================================
// Theme: light / dark
//
// The theme is rendered server-side from the "helpdesk_theme" cookie on
// <html data-theme="..."> (src/app/layout.tsx), so there is no flash of the
// wrong theme. This module keeps client state in sync and writes the cookie
// when the user toggles. No localStorage involved.
// =============================================================================

export type Theme = "light" | "dark";

const COOKIE_NAME = "helpdesk_theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface ThemeApi {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

function readInitial(): Theme {
  if (typeof document === "undefined") return "light";
  // Trust whatever the server (cookie) or first-visit script set on <html>.
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

function hasCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE_NAME}=`));
}

function writeCookie(theme: Theme) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${theme}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    apply(next);
    writeCookie(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Sync state with the pre-hydration attribute, and follow system changes
  // only while the user has not expressed a preference (no cookie yet).
  useEffect(() => {
    setThemeState(readInitial());
    if (typeof window === "undefined" || hasCookie()) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setTheme]);

  const value = useMemo<ThemeApi>(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() must be used inside <ThemeProvider>");
  }
  return ctx;
}

/**
 * Compact icon button that toggles light/dark. Drop it into any toolbar.
 *
 * Why the `mounted` gate: the actual theme is only known on the client (the
 * inline init script in <head> sets `data-theme` before React hydrates). The
 * server has no way to know which icon to render. To avoid a hydration mismatch
 * we render an invisible placeholder of the same size on the server, then swap
 * to the real button after the first client effect. The placeholder keeps the
 * sidebar layout stable so there's no visible jump.
 */
export function ThemeToggle({
  size = 38,
  title,
}: {
  size?: number;
  title?: string;
}) {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
        }}
      />
    );
  }

  const isDark = theme === "dark";
  const label = title ?? (isDark ? "Switch to light mode" : "Switch to dark mode");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        cursor: "pointer",
        color: "var(--text-secondary)",
        transition: "background var(--dur-2) var(--ease), color var(--dur-2) var(--ease), border-color var(--dur-2) var(--ease)",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--brand-50)";
        e.currentTarget.style.color = "var(--brand-700)";
        e.currentTarget.style.borderColor = "var(--brand-100)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {isDark ? <Sun size={18} strokeWidth={1.9} aria-hidden /> : <Moon size={18} strokeWidth={1.9} aria-hidden />}
    </button>
  );
}
