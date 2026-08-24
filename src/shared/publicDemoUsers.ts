export type PublicDemoTint =
  | "brand"
  | "info"
  | "warning"
  | "muted"
  | "violet"
  | "success";

export interface PublicDemoUser {
  email: string;
  name: string;
  role: string;
  tint: PublicDemoTint;
}

/**
 * Explicit allowlist for the approved public passwordless demo.
 *
 * Keep this list shared by the UI and the server-side credentials provider so
 * a displayed identity can sign in and an undisplayed database user cannot.
 */
export const PUBLIC_DEMO_USERS: readonly PublicDemoUser[] = [
  { email: "vikram.rao@netlink.com", name: "Vikram Rao", role: "Platform admin", tint: "violet" },
  { email: "priya.sharma@netlink.com", name: "Priya Sharma", role: "Tenant admin", tint: "brand" },
  { email: "meera.nair@netlink.com", name: "Meera Nair", role: "Manager", tint: "warning" },
  { email: "arjun.mehta@netlink.com", name: "Arjun Mehta", role: "Service desk agent", tint: "info" },
  { email: "anita.desai@netlink.com", name: "Anita Desai", role: "HR operations", tint: "success" },
  { email: "dana.lee@netlink.com", name: "Dana Lee", role: "Requester", tint: "muted" },
];

export function isPublicDemoEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return PUBLIC_DEMO_USERS.some((user) => user.email === normalized);
}

export function canUsePasswordlessCredential(
  email: string,
  demoMode: boolean,
  publicDemoAuth: boolean
): boolean {
  return demoMode || (publicDemoAuth && isPublicDemoEmail(email));
}
