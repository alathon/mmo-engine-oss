// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

const baseGlobals = {
  ...globals.browser,
  ...globals.node,
};

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.pnpm/**",
      "**/vite.config.ts",
      "**/vitest.config.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    languageOptions: {
      globals: baseGlobals,
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
);
