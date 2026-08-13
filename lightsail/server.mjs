import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAssets } from "./assets.mjs";
import { SqliteD1 } from "./sqlite-d1.mjs";
import { loadTenantRegistry } from "../config/tenant-registry.mjs";
import { loadTenantCredentials } from "../config/tenant-credentials.mjs";
import { normaliseTenantHost } from "../config/tenant-registry.mjs";
import { TenantDirectory } from "./tenant-directory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const { default: worker } = await import("./runtime/worker.mjs");
const tenantRegistry = await loadTenantRegistry();
const tenantCredentials = loadTenantCredentials(tenantRegistry);
const port = Number(process.env.PORT || 8787);
const dbPath = process.env.EVENT_DB_PATH || resolve(root, ".local-data", "event.db");
const db = new SqliteD1(dbPath);
const env = {
  ASSETS: makeAssets(resolve(root, "public")),
  DB: db,
};
const tenantDirectory = await new TenantDirectory(db, tenantRegistry, tenantCredentials).initialize();
const platformHosts = new Set(String(process.env.PLATFORM_HOSTS || "localhost,127.0.0.1,::1").split(",").map(normaliseTenantHost).filter(Boolean));
const platformSessions = new Map();
const platformSessionLifetime = 8 * 60 * 60 * 1000;

function sameSecret(first, second) {
  const left = Buffer.from(String(first ?? "")); const right = Buffer.from(String(second ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function platformSession(request) {
  const token = request.headers.get("x-platform-session") || "";
  const expiresAt = platformSessions.get(token) || 0;
  if (expiresAt <= Date.now()) { if (token) platformSessions.delete(token); return false; }
  return true;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
}

async function platformResponse(request, url) {
  if (request.method === "GET" && ["/tenants", "/tenants/", "/tenants.html"].includes(url.pathname)) {
    return env.ASSETS.fetch(new Request(new URL("/tenants.html", url)));
  }
  if (request.method === "GET" && ["/tenant-admin.js", "/tenant-admin.css"].includes(url.pathname)) return env.ASSETS.fetch(request);
  if (request.method === "POST" && url.pathname === "/api/platform/session") {
    if (!process.env.PLATFORM_ADMIN_PIN) return json({ error: "当前部署尚未配置 PLATFORM_ADMIN_PIN" }, 503);
    const body = await request.json().catch(() => ({}));
    if (!sameSecret(body.platformPin, process.env.PLATFORM_ADMIN_PIN)) return json({ error: "平台管理 PIN 不正确" }, 403);
    const token = crypto.randomUUID(); platformSessions.set(token, Date.now() + platformSessionLifetime);
    return json({ platformSession: token, expiresInSeconds: platformSessionLifetime / 1000 });
  }
  if (["/api/platform/tenants"].includes(url.pathname) && !platformSession(request)) return json({ error: "需要平台开通权限" }, 403);
  if (request.method === "GET" && url.pathname === "/api/platform/tenants") return json({ tenants: tenantDirectory.list() });
  if (request.method === "POST" && url.pathname === "/api/platform/tenants") {
    try { return json({ tenant: await tenantDirectory.create(await request.json()) }, 201); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "租户创建失败" }, 400); }
  }
  return json({ error: "Not found" }, 404);
}

async function send(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const protocol = incoming.headers["x-forwarded-proto"] || "http";
    const host = incoming.headers.host || "localhost";
    const method = incoming.method || "GET";
    const url = new URL(incoming.url || "/", `${protocol}://${host}`);
    const request = new Request(url, {
      method,
      headers: incoming.headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : Readable.toWeb(incoming),
      duplex: "half",
    });
    const platformPath = url.pathname === "/tenants" || url.pathname === "/tenants/" || url.pathname === "/tenants.html" || url.pathname.startsWith("/api/platform/") || ["/tenant-admin.js", "/tenant-admin.css"].includes(url.pathname);
    if (platformPath) {
      if (!platformHosts.has(normaliseTenantHost(host))) { await send(outgoing, json({ error: "未识别的平台管理 Host" }, 421)); return; }
      await send(outgoing, await platformResponse(request, url)); return;
    }
    const tenant = tenantDirectory.tenantForHost(host);

    if (!tenant) {
      outgoing.writeHead(421, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ error: "未识别的活动租户" }));
      return;
    }

    // Keep this probe independent from the Worker routing and event state. The
    // lightweight SELECT still proves that the mounted SQLite volume is usable.
    if (method === "GET" && url.pathname === "/healthz") {
      await db.prepare("SELECT 1 AS ok").first();
      outgoing.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      outgoing.end(JSON.stringify({ status: "ok", database: "ok", tenantId: tenant.tenantId, eventId: tenant.config.id, acceptanceRunId: process.env.ACCEPTANCE_RUN_ID || null }));
      return;
    }

    const response = await worker.fetch(request, { ...env, ...tenant.credentials, EVENT_CONFIG: JSON.stringify(tenant.config) });
    await send(outgoing, response);
  } catch {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: "服务暂时不可用" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Agentic Football event ops is listening on :${port} with ${tenantDirectory.list().length} tenants (${tenantRegistry.registryPath})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
