// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettierPlugin from "eslint-plugin-prettier/recommended";

const baseGlobals = {
  ...globals.browser,
  ...globals.node,
};

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  unicorn.configs.recommended,
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
    languageOptions: {
      globals: baseGlobals,
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
  prettierPlugin,
);
