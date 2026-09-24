import { describe, expect, it, vi } from "vitest";
import { PrismaStore } from "@/server/data/prismaStore";

describe("PrismaStore transactions", () => {
  it("allows enough time for Neon wake-up and short Vercel pool queues", async () => {
    const client: Record<string, unknown> = {};
    const transaction = vi.fn(
      async (
        work: (tx: Record<string, unknown>) => Promise<unknown>,
        options: { maxWait: number; timeout: number }
      ) => {
        void options;
        return work(client);
      }
    );
    client.$transaction = transaction;

    const store = new PrismaStore(client);
    await expect(store.transaction(async (tx) => tx.driver)).resolves.toBe("prisma");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    });
  });
});
