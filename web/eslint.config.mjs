import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "toolchain/**/dist/**",
      "toolchain/**/.build/**",
      "toolchain/program-rewrite-spike/deps/**",
      "toolchain/asset-generation-spike/public/generated/**",
      "toolchain/asset-generation-spike/public/vendor/**",
      "toolchain/spirv-cross-spike/wwwroot/spirv-cross.mjs",
      "vendor/spark-md5-3.0.2/spark-md5.mjs",
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
      "toolchain/**/capture-browser.mjs",
      "toolchain/**/browser-smoke.mjs",
      "toolchain/**/*.test.mjs",
      "toolchain/**/test.mjs",
      "toolchain/**/test/**/*.mjs",
      "toolchain/**/scripts/**/*.mjs",
      "toolchain/**/prepare-*.mjs",
      "toolchain/**/build-*.mjs",
      "toolchain/**/native-*.mjs",
      "eslint.config.mjs",
      "vite.config.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // This Node harness also runs callbacks in the browser via page.evaluate.
    files: ["toolchain/asset-generation-spike/test/browser.mjs"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
