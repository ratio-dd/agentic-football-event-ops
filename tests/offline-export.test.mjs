import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeAssets } from "../lightsail/assets.mjs";
import { SqliteD1 } from "../lightsail/sqlite-d1.mjs";

const root = new URL("../", import.meta.url);
const environment = { STAFF_PINS: JSON.stringify([{ id: "offline-staff", pin: "OFFLINE-STAFF-PIN", enabled: true }]), ADMIN_PIN: "OFFLINE-ADMIN-PIN" };

async function worker() { const url = new URL("../lightsail/runtime/worker.mjs", import.meta.url); url.searchParams.set("test", `${Date.now()}-${Math.random()}`); return (await import(url.href)).default; }
async function call(eventWorker, db, path, { method = "GET", client = "", staff = "", admin = "", body } = {}) {
  const headers = new Headers(); if (client) headers.set("x-client-id", client); if (staff) headers.set("x-staff-session", staff); if (admin) headers.set("x-admin-session", admin); if (body !== undefined) headers.set("content-type", "application/json");
  const response = await eventWorker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { ...environment, DB: db, ASSETS: makeAssets(new URL("public/", root).pathname) });
  const data = await response.json(); assert.equal(response.ok, true, `${method} ${path}: ${data.error || response.status}`); return data;
}
function keys(value) { if (Array.isArray(value)) return value.flatMap(keys); if (!value || typeof value !== "object") return []; return Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]); }

test("offline operations export is a non-overwriting field whitelist", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "afc-offline-export-")); const databasePath = join(temporary, "event.db"); const outputDirectory = join(temporary, "bundle");
  const secrets = ["OFFLINE-WORKSHOP-CANARY", "OFFLINE-PORTAL-CANARY", "OFFLINE-STAFF-PIN", "OFFLINE-ADMIN-PIN", "offline-private-client"];
  try {
    const eventWorker = await worker(); const db = new SqliteD1(databasePath); const participants = [];
    for (let index = 1; index <= 2; index += 1) participants.push((await call(eventWorker, db, "/api/participants", { method: "POST", client: index === 1 ? secrets[4] : `offline-client-${index}`, body: { nickname: `离线成员${index}`, supportProfile: {} } })).participant);
    const login = await call(eventWorker, db, "/api/ops/session", { method: "POST", body: { staffPin: secrets[2], staffNickname: "离线 TA" } });
    const elevated = await call(eventWorker, db, "/api/admin/session", { method: "POST", staff: login.staffSession, body: { adminPin: secrets[3] } }); const teams = [];
    await call(eventWorker, db, "/api/ops/codes/import", { method: "POST", staff: login.staffSession, admin: elevated.adminSession, body: { workshopCodes: [secrets[0], "OFFLINE-WORKSHOP-2"], gamePortalCodes: [secrets[1], "OFFLINE-PORTAL-2"] } });
    for (const participant of participants) {
      const created = await call(eventWorker, db, "/api/ops/teams", { method: "POST", staff: login.staffSession, body: { memberIds: [participant.id] } }); teams.push(created.team);
      await call(eventWorker, db, `/api/ops/teams/${created.team.id}/issue-code`, { method: "POST", staff: login.staffSession, body: {} });
      await call(eventWorker, db, `/api/ops/qualification/teams/${created.team.id}/confirm`, { method: "POST", staff: login.staffSession, body: {} });
    }
    await call(eventWorker, db, "/api/ops/competition/freeze", { method: "POST", staff: login.staffSession, admin: elevated.adminSession, body: { teamIds: teams.map((team) => team.id) } });
    const generated = await call(eventWorker, db, "/api/ops/competition/generate", { method: "POST", staff: login.staffSession, admin: elevated.adminSession, body: { groupCount: 1, qualifiersPerGroup: 1 } });
    await call(eventWorker, db, `/api/ops/matches/${generated.tournament.matches[0].id}/result`, { method: "POST", staff: login.staffSession, body: { scoreA: 2, scoreB: 1 } });
    db.close();

    const exported = spawnSync(process.execPath, ["scripts/export-offline-ops.mjs", "--db", databasePath, "--output-dir", outputDirectory], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.equal(exported.status, 0, exported.stderr);
    const bundle = JSON.parse(await readFile(join(outputDirectory, "offline-ops.json"), "utf8")); const rendered = await readFile(join(outputDirectory, "index.html"), "utf8");
    assert.equal(bundle.redacted, true); assert.equal(bundle.teams.length, 2); assert.equal(bundle.frozenRoster.length, 2); assert.equal(bundle.tournament.matches[0].scoreA, 2); assert.equal(bundle.tournament.matches[0].scoreB, 1);
    assert.equal(bundle.teams[0].members[0].nickname, "离线成员1"); assert.match(rendered, /T-001/); assert.match(rendered, /离线成员1/);
    const forbiddenKeys = keys(bundle).filter((key) => /(code|pin|session|client|token|feedback|audit|note)/i.test(key)); assert.deepEqual(forbiddenKeys, []);
    for (const secret of secrets) { assert.equal(JSON.stringify(bundle).includes(secret), false); assert.equal(rendered.includes(secret), false); }

    const refusedOverwrite = spawnSync(process.execPath, ["scripts/export-offline-ops.mjs", "--db", databasePath, "--output-dir", outputDirectory], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.notEqual(refusedOverwrite.status, 0);

    const legacyDb = new SqliteD1(databasePath); const legacyRow = await legacyDb.prepare("SELECT data, version FROM event_state WHERE id = ?").bind("beijing-meetup-2026").first();
    const legacyState = JSON.parse(legacyRow.data); delete legacyState.workshopCodes; delete legacyState.gamePortalCodes; delete legacyState.competition.frozenTeams;
    await legacyDb.prepare("UPDATE event_state SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify(legacyState), legacyRow.version + 1, new Date().toISOString(), "beijing-meetup-2026", legacyRow.version).run(); legacyDb.close();
    const legacyOutputDirectory = join(temporary, "legacy-bundle");
    const legacyExported = spawnSync(process.execPath, ["scripts/export-offline-ops.mjs", "--db", databasePath, "--output-dir", legacyOutputDirectory], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.equal(legacyExported.status, 0, legacyExported.stderr);
    const legacyBundle = JSON.parse(await readFile(join(legacyOutputDirectory, "offline-ops.json"), "utf8"));
    assert.equal(legacyBundle.counts.workshopResources.total, 0); assert.equal(legacyBundle.counts.gamePortalResources.total, 0); assert.equal(legacyBundle.frozenRoster.length, 2);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
