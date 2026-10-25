import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // `eslint .` walks the whole checkout, unlike the old `next lint`, so skip
    // build output, dependencies, and sibling git worktrees under .claude/.
    ignores: [
      "**/.next/**",
      "**/out/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      ".claude/**",
      "*.config.js",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
