import { defineConfig } from "vitest/config";

// Standalone config (not the app's vite.config.ts) so the unit suite runs without the
// Vue/Tailwind plugins: the modules under test (codec, generator, CPU DEs) are pure TS.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
