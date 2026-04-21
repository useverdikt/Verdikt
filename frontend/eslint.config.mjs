import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: { react: { version: "detect" } },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      // App code uses intentional setState in effects for URL↔UI sync; compiler rules are noisy without migration.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**"] }
];
