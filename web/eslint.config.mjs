import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "**/bin/**",
      "**/obj/**",
      "**/_framework/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}", "*.mjs", "toolchain/**/wwwroot/*.mjs"],
    ignores: ["eslint.config.mjs"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["toolchain/**/*.mjs"],
    languageOptions: { globals: globals.worker },
  },
  {
    files: [
      "tests/**/*.mjs",
      "toolchain/**/verify-parity.mjs",
      "eslint.config.mjs",
      "vite.config.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
