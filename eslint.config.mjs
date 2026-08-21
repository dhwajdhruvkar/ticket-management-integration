import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".agents/**",
    ".codegraph/**",
    ".cursor/**",
    ".gemini/**",
  ]),
  {
    // The application does not enable React Compiler. These compiler-oriented
    // rules reject established effect-driven data loading and live-ref patterns;
    // the standard Hooks correctness and dependency rules remain enabled.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
