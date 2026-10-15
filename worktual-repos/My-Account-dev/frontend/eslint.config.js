import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  { ignores: ["dist", "coverage"] },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      "react-refresh/only-export-components": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
