import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/*` import alias from tsconfig.json, for components under test.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          environment: "node",
          // Client tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
          include: ["tests/**/*.test.{ts,tsx}"],
          // Real-browser tests run under vitest.browser.config.mts (`npm run test:browser`).
          exclude: ["tests/browser/**", "tests/server/**", "**/node_modules/**"],
        },
      },
      {
        // Server code on Postgres: PGlite with the Drizzle migrations (tests/server/setup.ts).
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/server/**/*.test.ts"],
          setupFiles: ["tests/server/setup.ts"],
        },
      },
    ],
  },
});
