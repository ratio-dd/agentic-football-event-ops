import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseEventDefinition } from "./event-definition.mjs";

const defaultConfigPath = fileURLToPath(new URL("./events/afc-beijing-2026.json", import.meta.url));

export async function loadEventConfig(path = defaultConfigPath) {
  const configPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let raw;
  try { raw = JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) { throw new Error(`无法读取活动配置 ${configPath}: ${error instanceof Error ? error.message : "未知错误"}`); }
  return { config: normaliseEventDefinition(raw), configPath };
}
