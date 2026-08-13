import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEventConfig } from "./load-event-config.mjs";

const defaultRegistryPath = fileURLToPath(new URL("./tenants.json", import.meta.url));

export function normaliseTenantHost(authority) {
  const value = String(authority ?? "").trim().toLowerCase();
  if (!value || value.includes(",") || value.includes("/") || value.includes("@")) return "";
  try {
    const urlAuthority = value.includes(":") && !value.startsWith("[") && value.split(":").length > 2 ? `[${value}]` : value;
    const hostname = new URL(`http://${urlAuthority}`).hostname.toLowerCase().replace(/\.$/, "");
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  } catch { return ""; }
}

export async function loadTenantRegistry(path = process.env.TENANT_REGISTRY_PATH) {
  const registryPath = path ? (isAbsolute(path) ? path : resolve(process.cwd(), path)) : defaultRegistryPath;
  let input;
  try { input = JSON.parse(await readFile(registryPath, "utf8")); }
  catch (error) { throw new Error(`无法读取租户注册表 ${registryPath}: ${error instanceof Error ? error.message : "未知错误"}`); }
  if (input?.schemaVersion !== 1 || !Array.isArray(input.tenants) || !input.tenants.length) throw new Error("租户注册表必须使用 schemaVersion 1 并至少配置一个 tenant");

  const tenants = []; const byHost = new Map(); const byId = new Map();
  for (const [index, entry] of input.tenants.entries()) {
    if (!Array.isArray(entry?.hosts) || !entry.hosts.length) throw new Error(`租户注册表 tenants[${index}].hosts 不能为空`);
    const configPath = isAbsolute(entry.eventConfig) ? entry.eventConfig : resolve(dirname(registryPath), String(entry.eventConfig || ""));
    const { config } = await loadEventConfig(configPath);
    if (byId.has(config.id)) throw new Error(`租户注册表重复配置 tenant ${config.id}`);
    const hosts = [...new Set(entry.hosts.map(normaliseTenantHost))];
    if (hosts.some((host) => !host)) throw new Error(`租户注册表 tenants[${index}] 包含无效 host`);
    const tenant = Object.freeze({ tenantId: config.id, hosts: Object.freeze(hosts), config, configPath });
    for (const host of hosts) {
      if (byHost.has(host)) throw new Error(`租户注册表 host ${host} 被重复配置`);
      byHost.set(host, tenant);
    }
    byId.set(tenant.tenantId, tenant); tenants.push(tenant);
  }

  return Object.freeze({
    registryPath,
    tenants: Object.freeze(tenants),
    tenantForHost(authority) { return byHost.get(normaliseTenantHost(authority)) || null; },
    tenantForId(tenantId) { return byId.get(String(tenantId ?? "").trim()) || null; },
  });
}
