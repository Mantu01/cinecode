import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import { plugin as noCommentsPlugin } from "./rules/no-comments.js";
import { plugin as noMathRandomPlugin } from "./rules/no-math-random.js";

export const config = [
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/.turbo/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      turbo: turboPlugin,
      "@repo/no-comments": noCommentsPlugin,
      "@repo/no-math-random": noMathRandomPlugin,
    },
    rules: {
      "@repo/no-comments/no-comments": "error",
      "@repo/no-math-random/no-math-random": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
];
