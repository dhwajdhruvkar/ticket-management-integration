"use client";

import { createContext, useContext } from "react";

export type RailMode = "full" | "collapsed" | "drawer";

export interface ShellApi {
  railMode: RailMode;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell() must be used inside <AppShell>");
  return ctx;
}
