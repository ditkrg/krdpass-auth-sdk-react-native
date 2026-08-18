import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output, and the native sources ESLint has nothing to say about.
  { ignores: ["build/", "plugin/build/", "android/", "ios/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The package ships CommonJS, so require() is the interop that works, not a mistake.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: { module: "readonly", require: "readonly", process: "readonly" },
    },
  },
);
