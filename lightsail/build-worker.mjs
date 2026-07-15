import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const output = resolve(here, "runtime", "worker.mjs");

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(root, "worker", "index.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
});
