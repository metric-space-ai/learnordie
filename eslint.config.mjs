import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  },
  globalIgnores([
    ".next/**",
    ".data/**",
    ".playwright-cli/**",
    ".vercel/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "out/**",
    "output/**",
    "test-results/**"
  ])
]);

export default eslintConfig;
