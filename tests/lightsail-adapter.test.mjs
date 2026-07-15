import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeAssets } from "../lightsail/assets.mjs";
import { SqliteD1 } from "../lightsail/sqlite-d1.mjs";

const root = new URL("../", import.meta.url);
const TEST_ENV = {
  STAFF_PINS: JSON.stringify([{ id: "lightsail-staff", pin: "lightsail-staff", enabled: true }]),
  ADMIN_PIN: "lightsail-admin",
};

async function eventWorker() {
  const url = new URL("../lightsail/runtime/worker.mjs", import.meta.url);
  url.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function call(worker, db, path, { method = "GET", client = "", staff = "", admin = staff ? "lightsail-admin" : "", body } = {}) {
  const headers = new Headers();
  if (client) headers.set("x-client-id", client);
  if (staff) headers.set("x-staff-session", staff);
  if (admin) headers.set("x-admin-pin", admin);
  if (body) headers.set("content-type", "application/json");
  const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), {
    ...TEST_ENV,
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
    const created = await call(worker, firstDatabase, "/api/teams/self", { method: "POST", client: "lightsail-phone", body: {} });
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

test("Lightsail static assets expose the same mobile entry page and reject path traversal", async () => {
  const assets = makeAssets(new URL("public/", root).pathname);
  const home = await assets.fetch(new Request("http://localhost/index.html"));
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Agentic Football/);
  const blocked = await assets.fetch(new Request("http://localhost/%2e%2e%2fpackage.json"));
  assert.equal(blocked.status, 404);
});
