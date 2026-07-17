// Next.js instrumentation hook — runs once on server startup.
// Starts the background job scheduler in the Node.js runtime only.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/server/jobs/scheduler");
    startScheduler();
  }
}
