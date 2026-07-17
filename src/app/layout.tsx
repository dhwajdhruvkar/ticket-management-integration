// =============================================================================
// Root layout — the app shell wrapper for every route.
//
// Loads the Inter font, applies the theme from the persisted cookie (SSR-safe,
// no flash), and wires the global client providers in order: SessionProvider
// (NextAuth) -> ThemeProvider -> PersonaProvider -> ToastProvider -> AppShell
// (nav rail + top bar). Individual pages render inside AppShell's content area.
// =============================================================================

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { auth } from "@/auth";
import AppShell from "@/components/AppShell";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/Theme";
import { PersonaProvider } from "@/components/Persona";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Netlink Support",
  description: "Internal IT and HR support for Netlink Software Group America.",
};

// First-visit only (no theme cookie yet): apply the system preference before
// paint so dark-mode users don't get a white flash. Once the user toggles or
// revisits, the cookie decides server-side and this script is a no-op.
const SYSTEM_THEME_SCRIPT = `
(function(){
  try {
    if (!document.cookie.split("; ").some(function(c){ return c.indexOf("helpdesk_theme=") === 0; })) {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (dark) {
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.style.colorScheme = "dark";
      }
    }
  } catch (_) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const stored = cookieStore.get("helpdesk_theme")?.value;
  const theme = stored === "dark" ? "dark" : "light";

  // Server-hydrate the session so the client SessionProvider doesn't have to
  // fetch /api/auth/session on first paint (that client fetch intermittently
  // failed under dev-server load, surfacing as ClientFetchError).
  const session = await auth();

  return (
    <html
      lang="en"
      data-theme={theme}
      style={{ colorScheme: theme }}
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <SessionProvider session={session} refetchOnWindowFocus={false}>
          <ThemeProvider>
            <PersonaProvider>
              <ToastProvider>
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </PersonaProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
