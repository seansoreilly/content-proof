import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig keeps JSX as "preserve" for Next; tests need it compiled. Vite 8
  // transforms with oxc rather than esbuild.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    clearMocks: true,
    unstubEnvs: true,
    // Logic tests run in plain Node; component tests (.test.tsx) get a DOM.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
