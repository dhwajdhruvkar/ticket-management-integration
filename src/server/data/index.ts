// =============================================================================
// Store factory.
//
// Returns a singleton DataStore based on DATA_DRIVER. The Prisma module is only
// imported when actually selected, so the in-memory demo never loads the Prisma
// client. Cached on globalThis to survive Next.js hot reloads in dev.
// =============================================================================

import { config } from "../config";
import { MemoryStore } from "./memoryStore";
import type { DataStore } from "./store";

async function build(): Promise<DataStore> {
  if (config.dataDriver === "prisma") {
    const { PrismaStore } = await import("./prismaStore");
    const store = new PrismaStore();
    await store.ready();
    return store;
  }
  const store = new MemoryStore();
  await store.ready();
  return store;
}

const g = globalThis as unknown as { __netlinkStore?: Promise<DataStore> };

/** Get the initialized data store (singleton). */
export function getStore(): Promise<DataStore> {
  return (g.__netlinkStore ??= build());
}

/**
 * Tenant for background jobs and inbound channels that have no request
 * context (mail polling, Teams bot, schedulers). Auth-free by design.
 */
export async function defaultTenantId(): Promise<string> {
  const store = await getStore();
  const tenants = await store.tenants.list();
  return tenants[0]?.id ?? "tenant_netlink";
}
