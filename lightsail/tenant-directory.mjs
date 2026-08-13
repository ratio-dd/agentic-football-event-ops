import { normaliseEventDefinition } from "../config/event-definition.mjs";
import { normaliseTenantHost } from "../config/tenant-registry.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS tenant_config (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL,
    config TEXT NOT NULL,
    staff_pins TEXT NOT NULL,
    admin_pin TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

function requiredText(value, field, maximum = 120) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${field} 不能为空`);
  if (result.length > maximum) throw new Error(`${field} 最长为 ${maximum} 个字符`);
  return result;
}

function tenantOrigin(value) {
  const raw = requiredText(value, "租户 URL", 500);
  let url;
  try { url = new URL(raw); } catch { throw new Error("租户 URL 必须是完整的 URL"); }
  const host = normaliseTenantHost(url.host);
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  if (!host || !["https:", ...(local ? ["http:"] : [])].includes(url.protocol)) throw new Error("公开租户 URL 必须使用 HTTPS");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("租户 URL 只能包含协议、域名和可选端口");
  return { host, origin: url.origin };
}

function staffAccounts(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("至少配置一个、最多配置 20 个 Staff/TA PIN");
  const ids = new Set();
  return value.map((account, index) => {
    const id = requiredText(account?.id, `Staff/TA ${index + 1} 标识`, 80);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) throw new Error("Staff/TA 标识只能使用小写字母、数字和连字符");
    if (ids.has(id)) throw new Error(`Staff/TA 标识 ${id} 重复`);
    ids.add(id);
    const pin = requiredText(account?.pin, `Staff/TA ${index + 1} PIN`, 120);
    if (pin.length < 6) throw new Error("Staff/TA PIN 至少为 6 个字符");
    return Object.freeze({ id, pin, enabled: true });
  });
}

function tenantRecord({ config, hosts, origin, credentials, createdAt, source }) {
  return Object.freeze({
    tenantId: config.id,
    hosts: Object.freeze(hosts),
    origin,
    config,
    credentials: Object.freeze(credentials),
    createdAt,
    source,
  });
}

function publicTenant(tenant) {
  const origin = tenant.origin || null;
  const path = (value) => origin ? `${origin}${value}` : null;
  return {
    tenantId: tenant.tenantId,
    hosts: tenant.hosts,
    origin,
    source: tenant.source,
    createdAt: tenant.createdAt,
    name: tenant.config.name,
    branding: tenant.config.branding,
    urls: {
      participant: path("/"),
      staff: path("/staff"),
      ta: path("/ta"),
      admin: path("/admin"),
      display: path("/display"),
    },
  };
}

export class TenantDirectory {
  constructor(database, staticRegistry, staticCredentials) {
    this.database = database;
    this.byHost = new Map();
    this.byId = new Map();
    for (const tenant of staticRegistry.tenants) {
      const record = tenantRecord({
        config: tenant.config,
        hosts: [...tenant.hosts],
        origin: null,
        credentials: staticCredentials.credentialsFor(tenant.tenantId),
        createdAt: null,
        source: "file",
      });
      this.add(record);
    }
  }

  async initialize() {
    await this.database.prepare(schema).run();
    const rows = await this.database.prepare("SELECT id, host, origin, config, staff_pins, admin_pin, created_at FROM tenant_config ORDER BY created_at").all();
    for (const row of rows) {
      const config = normaliseEventDefinition(JSON.parse(row.config));
      if (config.id !== row.id) throw new Error(`动态租户 ${row.id} 的配置 id 不一致`);
      const record = tenantRecord({
        config,
        hosts: [normaliseTenantHost(row.host)],
        origin: row.origin,
        credentials: { STAFF_PINS: row.staff_pins, ADMIN_PIN: row.admin_pin },
        createdAt: row.created_at,
        source: "database",
      });
      this.add(record);
    }
    return this;
  }

  add(tenant) {
    if (this.byId.has(tenant.tenantId)) throw new Error(`租户 ${tenant.tenantId} 重复`);
    for (const host of tenant.hosts) {
      if (!host || this.byHost.has(host)) throw new Error(`租户 Host ${host || "(空)"} 重复`);
    }
    this.byId.set(tenant.tenantId, tenant);
    for (const host of tenant.hosts) this.byHost.set(host, tenant);
  }

  tenantForHost(authority) { return this.byHost.get(normaliseTenantHost(authority)) || null; }
  tenantForId(tenantId) { return this.byId.get(String(tenantId ?? "").trim()) || null; }
  list() { return [...this.byId.values()].map(publicTenant); }

  allPins() {
    const pins = [];
    for (const tenant of this.byId.values()) {
      try { pins.push(...JSON.parse(tenant.credentials.STAFF_PINS || "[]").map((account) => String(account?.pin || "")).filter(Boolean)); } catch { /* startup credential validation owns malformed static values */ }
      if (tenant.credentials.ADMIN_PIN) pins.push(tenant.credentials.ADMIN_PIN);
    }
    return new Set(pins);
  }

  async create(input) {
    const config = normaliseEventDefinition(input?.config);
    const { host, origin } = tenantOrigin(input?.origin);
    const accounts = staffAccounts(input?.staffAccounts);
    const adminPin = requiredText(input?.adminPin, "Admin PIN", 120);
    if (adminPin.length < 8) throw new Error("Admin PIN 至少为 8 个字符");
    if (this.byId.has(config.id)) throw new Error(`tenantId ${config.id} 已存在`);
    if (this.byHost.has(host)) throw new Error(`Host ${host} 已绑定其他租户`);

    const newPins = [...accounts.map((account) => account.pin), adminPin];
    if (new Set(newPins).size !== newPins.length) throw new Error("同一租户的 Staff、TA 与 Admin PIN 不能重复");
    const existingPins = this.allPins();
    if (newPins.some((pin) => existingPins.has(pin))) throw new Error("该 PIN 已被其他租户使用");

    const createdAt = new Date().toISOString();
    const staffPins = JSON.stringify(accounts);
    try {
      await this.database.prepare("INSERT INTO tenant_config (id, host, origin, config, staff_pins, admin_pin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(config.id, host, origin, JSON.stringify(config), staffPins, adminPin, createdAt).run();
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error))) throw new Error("tenantId 或 Host 已被其他租户占用");
      throw error;
    }
    const tenant = tenantRecord({ config, hosts: [host], origin, credentials: { STAFF_PINS: staffPins, ADMIN_PIN: adminPin }, createdAt, source: "database" });
    this.add(tenant);
    return publicTenant(tenant);
  }
}
