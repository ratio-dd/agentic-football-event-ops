import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeAssets } from "../lightsail/assets.mjs";
import { SqliteD1 } from "../lightsail/sqlite-d1.mjs";
import { loadTenantRegistry } from "../config/tenant-registry.mjs";
import { loadTenantCredentials } from "../config/tenant-credentials.mjs";
import { TenantDirectory } from "../lightsail/tenant-directory.mjs";

const root = new URL("../", import.meta.url);
const TEST_ENV = {
  EVENT_CONFIG: await readFile(new URL("../config/events/afc-beijing-2026.json", import.meta.url), "utf8"),
  STAFF_PINS: JSON.stringify([{ id: "lightsail-staff", pin: "lightsail-staff", enabled: true }]),
  ADMIN_PIN: "lightsail-admin",
};

async function eventWorker() {
  const url = new URL("../lightsail/runtime/worker.mjs", import.meta.url);
  url.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function call(worker, db, path, { method = "GET", client = "", staff = "", admin = staff ? "lightsail-admin" : "", body, eventConfig } = {}) {
  const headers = new Headers();
  if (client) headers.set("x-client-id", client);
  if (staff) headers.set("x-staff-session", staff);
  if (admin) headers.set("x-admin-pin", admin);
  if (body) headers.set("content-type", "application/json");
  const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), {
    ...TEST_ENV,
    EVENT_CONFIG: eventConfig ? JSON.stringify(eventConfig) : TEST_ENV.EVENT_CONFIG,
    DB: db,
    ASSETS: makeAssets(new URL("public/", root).pathname),
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

test("Lightsail SQLite adapter keeps participant and staff state in one durable database", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agentic-football-lightsail-"));
  const databasePath = join(temporary, "event.db");
  try {
    const worker = await eventWorker();
    const firstDatabase = new SqliteD1(databasePath);
    const registered = await call(worker, firstDatabase, "/api/participants", {
      method: "POST", client: "lightsail-phone", body: { nickname: "SQLite 参赛者", supportProfile: {} },
    });
    assert.equal(registered.response.status, 200);

    const login = await call(worker, firstDatabase, "/api/ops/session", {
      method: "POST", body: { staffPin: "lightsail-staff", staffNickname: "SQLite TA" },
    });
    assert.equal(login.response.status, 200);
    const created = await call(worker, firstDatabase, "/api/ops/teams", { method: "POST", staff: login.data.staffSession, body: { memberIds: [registered.data.participant.id] } });
    assert.equal(created.response.status, 200);
    firstDatabase.close();

    const secondDatabase = new SqliteD1(databasePath);
    const restored = await call(worker, secondDatabase, "/api/state", { client: "lightsail-phone" });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.data.currentParticipant.nickname, "SQLite 参赛者");
    assert.equal(restored.data.currentTeam.teamNumber, "T-001");
    const staffState = await call(worker, secondDatabase, "/api/ops/state", { staff: login.data.staffSession });
    assert.equal(staffState.response.status, 200);
    assert.equal(staffState.data.teams.length, 1);
    secondDatabase.close();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("one SQLite database isolates AFC cities by configured event id", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agentic-football-cities-"));
  const databasePath = join(temporary, "event.db");
  try {
    const worker = await eventWorker(); const db = new SqliteD1(databasePath);
    const beijing = JSON.parse(await readFile(new URL("../config/events/afc-beijing-2026.json", import.meta.url), "utf8"));
    const shanghai = JSON.parse(await readFile(new URL("../config/events/afc-city.example.json", import.meta.url), "utf8"));
    await call(worker, db, "/api/participants", { method: "POST", client: "shared-phone", eventConfig: beijing, body: { nickname: "北京参与者", supportProfile: {} } });
    const beijingLogin = await call(worker, db, "/api/ops/session", { method: "POST", eventConfig: beijing, body: { staffPin: "lightsail-staff", staffNickname: "北京 TA" } });

    const newCity = await call(worker, db, "/api/state", { client: "shared-phone", eventConfig: shanghai });
    assert.equal(newCity.data.event.id, "shanghai-meetup-2026");
    assert.equal(newCity.data.event.branding.locationLabel, "上海 MeetUp");
    assert.equal(newCity.data.currentParticipant, null);
    const crossTenantSession = await call(worker, db, "/api/ops/state", { staff: beijingLogin.data.staffSession, eventConfig: shanghai });
    assert.equal(crossTenantSession.response.status, 403);
    await call(worker, db, "/api/participants", { method: "POST", client: "shared-phone", eventConfig: shanghai, body: { nickname: "上海参与者", supportProfile: {} } });

    const restoredBeijing = await call(worker, db, "/api/state", { client: "shared-phone", eventConfig: beijing });
    assert.equal(restoredBeijing.data.event.id, "beijing-meetup-2026");
    assert.equal(restoredBeijing.data.currentParticipant.nickname, "北京参与者");
    db.close();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("tenant registry resolves exact hosts and fails closed for unknown hosts", async () => {
  const registry = await loadTenantRegistry(new URL("../config/tenants.json", import.meta.url).pathname);
  assert.equal(registry.tenantForHost("LOCALHOST:8787").tenantId, "beijing-meetup-2026");
  assert.equal(registry.tenantForHost("shanghai.localhost").tenantId, "shanghai-meetup-2026");
  assert.equal(registry.tenantForHost("unknown.localhost"), null);
  assert.equal(registry.tenantForHost("localhost,evil.example"), null);
  assert.equal(registry.tenantForId("shanghai-meetup-2026").config.branding.locationLabel, "上海 MeetUp");
  const credentials = loadTenantCredentials(registry, {
    TENANT_STAFF_PINS: JSON.stringify({ "beijing-meetup-2026": [{ id: "beijing-staff", pin: "beijing-only" }], "shanghai-meetup-2026": [{ id: "shanghai-staff", pin: "shanghai-only" }] }),
    TENANT_ADMIN_PINS: JSON.stringify({ "beijing-meetup-2026": "beijing-admin", "shanghai-meetup-2026": "shanghai-admin" }),
  });
  assert.match(credentials.credentialsFor("beijing-meetup-2026").STAFF_PINS, /beijing-only/);
  assert.doesNotMatch(credentials.credentialsFor("beijing-meetup-2026").STAFF_PINS, /shanghai-only/);
  assert.equal(credentials.credentialsFor("shanghai-meetup-2026").ADMIN_PIN, "shanghai-admin");
  assert.throws(() => loadTenantCredentials(registry, {
    TENANT_STAFF_PINS: JSON.stringify({ "beijing-meetup-2026": [{ pin: "reused" }], "shanghai-meetup-2026": [{ pin: "reused" }] }),
  }), /不能复用同一个 Staff PIN/);
});

test("dynamic tenant directory persists every configurable event field and credentials", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "afc-tenant-directory-")); const databasePath = join(temporary, "event.db");
  try {
    const registry = await loadTenantRegistry(new URL("../config/tenants.json", import.meta.url).pathname);
    const staticCredentials = loadTenantCredentials(registry, {});
    const database = new SqliteD1(databasePath);
    const directory = await new TenantDirectory(database, registry, staticCredentials).initialize();
    const tenant = await directory.create({
      origin: "http://hangzhou.localhost:8787",
      staffAccounts: [{ id: "initial-staff", pin: "hangzhou-staff" }, { id: "initial-ta", pin: "hangzhou-ta" }],
      adminPin: "hangzhou-admin",
      config: {
        schemaVersion: 1, id: "hangzhou-meetup-2027", name: "杭州活动运营台",
        branding: { brandName: "Football Lab", locationLabel: "杭州 MeetUp", displayLabel: "FOOTBALL LAB · 杭州", pageTitle: "Football Lab 杭州" },
        links: { workshopUrl: "https://workshop.example.com/hangzhou", gamePortalUrl: "https://game.example.com/hangzhou" },
        teamPolicy: { minMembers: 2, maxMembers: 5, maxTeams: 40 },
        tournamentPolicy: { maxTeamsPerGroup: 5, maxGroups: 8, defaultQualifiersPerGroup: 2, maxQualifiersPerGroup: 3 },
        defaultGates: { selfServiceTeam: true, participantHelp: true, codeIssuance: false, qualification: true, scheduleEditing: false, publicMaintenanceSnapshot: true },
      },
    });
    assert.equal(tenant.urls.ta, "http://hangzhou.localhost:8787/ta");
    assert.equal(directory.tenantForHost("hangzhou.localhost:9999").config.teamPolicy.maxMembers, 5);
    database.close();

    const restoredDatabase = new SqliteD1(databasePath);
    const restored = await new TenantDirectory(restoredDatabase, registry, staticCredentials).initialize();
    const restoredTenant = restored.tenantForId("hangzhou-meetup-2027");
    assert.equal(restoredTenant.config.branding.brandName, "Football Lab");
    assert.equal(restoredTenant.config.defaultGates.publicMaintenanceSnapshot, true);
    assert.match(restoredTenant.credentials.STAFF_PINS, /hangzhou-ta/);
    assert.equal(restoredTenant.credentials.ADMIN_PIN, "hangzhou-admin");
    await assert.rejects(() => restored.create({ origin: "http://hangzhou.localhost", config: restoredTenant.config, staffAccounts: [{ id: "duplicate", pin: "another-pin" }], adminPin: "another-admin" }), /已存在|已绑定/);
    restoredDatabase.close();
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Lightsail static assets expose the same mobile entry page and reject path traversal", async () => {
  const assets = makeAssets(new URL("public/", root).pathname);
  const home = await assets.fetch(new Request("http://localhost/index.html"));
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Agentic Football/);
  const blocked = await assets.fetch(new Request("http://localhost/%2e%2e%2fpackage.json"));
  assert.equal(blocked.status, 404);
});
