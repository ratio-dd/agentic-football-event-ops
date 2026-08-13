import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([".git/**", "node_modules/**", "output/**", "lightsail/runtime/**", "docs/**"]),
]);
