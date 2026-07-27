"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import IconRail from "./IconRail";
import TopBar from "./TopBar";

// =============================================================================
// AppShell — responsive workspace chrome.
//
//   >= 1280px  full navigation rail (labels)
//   768-1280px icon-only rail with tooltips
//   <  768px   rail hidden; hamburger in the TopBar opens a slide-in drawer
// =============================================================================

type RailMode = "full" | "collapsed" | "drawer";

interface ShellApi {
  railMode: RailMode;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell() must be used inside <AppShell>");
  return ctx;
}

function currentMode(): RailMode {
  if (typeof window === "undefined") return "full";
  if (window.innerWidth < 768) return "drawer";
  if (window.innerWidth < 1280) return "collapsed";
  return "full";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [railMode, setRailMode] = useState<RailMode>("full");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      const mode = currentMode();
      setRailMode(mode);
      if (mode !== "drawer") setDrawerOpen(false);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Close the drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Sign-in and the public policy pages stand alone — no workspace chrome, and
  // no nav rail for a visitor who has not signed in yet.
  if (pathname.startsWith("/signin") || pathname.startsWith("/legal")) {
    return <main style={{ height: "100vh", overflow: "auto" }}>{children}</main>;
  }

  const api: ShellApi = {
    railMode,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  };

  return (
    <ShellContext.Provider value={api}>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {railMode !== "drawer" ? (
          <IconRail collapsed={railMode === "collapsed"} />
        ) : drawerOpen ? (
          <>
            <div
              className="overlay-in"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
              style={{
                position: "fixed",
                inset: 0,
                background: "var(--scrim)",
                backdropFilter: "var(--backdrop-blur)",
                WebkitBackdropFilter: "var(--backdrop-blur)",
                zIndex: 60,
              }}
            />
            <div
              className="drawer-in"
              style={{ position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 61, display: "flex" }}
            >
              <IconRail collapsed={false} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </>
        ) : null}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <TopBar />
          <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
