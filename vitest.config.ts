import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Isolated data dir + in-memory driver so tests never touch real data.
    env: { DATA_DRIVER: "memory", DATA_DIR: ".data-test" },
  },
});
