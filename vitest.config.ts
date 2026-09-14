import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Standalone from vite.config.ts on purpose.
 *
 * The app's Vite config loads the TanStack Start, Nitro and router plugins,
 * which spin up an SSR pipeline the tests do not need and which make the suite
 * slow and order-dependent. Engine code is pure TypeScript, so it is tested
 * directly. The only thing that has to match is the `@` path alias.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node by default; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Determinism is a requirement here, not a preference: fixtures must not
    // depend on the wall clock or on test ordering.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/market/**/*.ts"],
      exclude: ["src/lib/market/__fixtures__/**", "src/lib/market/**/*.test.ts"],
    },
  },
});
