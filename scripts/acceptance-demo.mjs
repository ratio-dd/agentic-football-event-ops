import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scenario = readArg("--scenario", "journey");
const port = Number(readArg("--port", "4310"));
const base = `http://127.0.0.1:${port}`;
const staffPin = "acceptance-staff";
const adminPin = "acceptance-admin";
const staffPins = JSON.stringify([{ id: "acceptance-staff", pin: staffPin, enabled: true }]);
const acceptanceRunId = randomUUID();
let server;

const stop = () => { if (server && !server.killed) server.kill("SIGTERM"); };
async function shutdown() {
  stop();
  if (server && server.exitCode === null) await new Promise((resolveStopped) => server.once("exit", resolveStopped));
  process.exit(0);
}
async function start() {
  if (!Object.hasOwn(scenarios, scenario)) {
    console.error(`未知验收场景：${scenario}\n可用场景：${Object.keys(scenarios).join("、")}`);
    process.exit(1);
  }
  await assertPortAvailable();
  const build = spawnSync(process.execPath, ["lightsail/build-worker.mjs"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status || 1);
  const databaseDirectory = await mkdtemp(join(tmpdir(), `afc-acceptance-${scenario}-`));
  server = spawn(process.execPath, ["lightsail/server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), EVENT_DB_PATH: join(databaseDirectory, "event.db"), STAFF_PINS: staffPins, ADMIN_PIN: adminPin, ACCEPTANCE_RUN_ID: acceptanceRunId },
    stdio: "inherit",
  });
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  await waitForHealth();
  const fixture = await scenarios[scenario](await login());
  console.log("\nAFC 本地验收环境已就绪（完全独立于线上和常用本地数据库）");
  console.log(`场景：${scenario}`);
  console.log(`参与者入口：${base}/`);
  console.log(`Staff 入口：${base}/staff`);
  console.log(`Admin 入口：先从 Staff 的“更多”进入；本地 Staff PIN：${staffPin}；Admin PIN：${adminPin}`);
  for (const [label, client] of Object.entries(fixture.participantLinks || {})) console.log(`${label}：${base}/?acceptanceClient=${encodeURIComponent(client)}`);
  console.log("按 Ctrl+C 结束；临时数据库位于系统临时目录，绝不会写入线上或日常本地数据。\n");
  await new Promise((resolveStopped) => server.once("exit", resolveStopped));
}

function readArg(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] || fallback : fallback; }
async function assertPortAvailable() {
  await new Promise((resolveAvailable, rejectUnavailable) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if ((error).code === "EADDRINUSE") {
        rejectUnavailable(new Error(`端口 ${port} 已被占用；请换一个 --port，避免验收脚本误连到旧的本地服务。`));
      } else rejectUnavailable(error);
    });
    probe.listen({ host: "0.0.0.0", port, exclusive: true }, () => probe.close(resolveAvailable));
  });
}
async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      const health = await response.json().catch(() => ({}));
      if (response.ok && health.acceptanceRunId === acceptanceRunId) return;
      if (response.ok) throw new Error(`端口 ${port} 返回了另一套服务；请换一个 --port，避免验收使用历史数据。`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("另一套服务")) throw error;
      // The child server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  stop();
  throw new Error("本地验收服务器未能启动");
}
async function api(path, { method = "GET", body, client = "", staff = "", admin = "" } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (client) headers["x-client-id"] = client;
  if (staff) headers["x-staff-session"] = staff;
  if (admin) headers["x-admin-session"] = admin;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}：${data.error || response.status}`);
  return data;
}
async function login() {
  const staff = await api("/api/ops/session", { method: "POST", body: { staffPin, staffNickname: "验收 TA" } });
  const admin = await api("/api/admin/session", { method: "POST", staff: staff.staffSession, body: { adminPin } });
  return { staff: staff.staffSession, admin: admin.adminSession };
}
async function register(name, client) {
  return (await api("/api/participants", { method: "POST", client, body: { nickname: name, supportProfile: { techBackground: "technical", workshopExperience: "no" } } })).participant;
}
async function makeTeam(sessions, people) { return (await api("/api/ops/teams", { method: "POST", staff: sessions.staff, body: { memberIds: people.map((person) => person.id) } })).team; }
async function importCodes(sessions, count = 32) {
  const workshopCodes = Array.from({ length: count }, (_, index) => `ACCEPT-WORKSHOP-${scenario.toUpperCase()}-${String(index + 1).padStart(2, "0")}`);
  await api("/api/ops/codes/import", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: { workshopCodes, gamePortalCodes: workshopCodes.map((code) => `ACCEPT-PORTAL-${code}`) } });
  await api("/api/ops/event-links", { method: "PUT", staff: sessions.staff, admin: sessions.admin, body: { workshopUrl: "https://example.com/acceptance-workshop", gamePortalUrl: "https://agentic-football.aws.dev/" } });
}
async function issue(sessions, team) { await api(`/api/ops/teams/${team.id}/issue-code`, { method: "POST", staff: sessions.staff, body: {} }); }
async function qualify(sessions, team) { await api(`/api/ops/qualification/teams/${team.id}/confirm`, { method: "POST", staff: sessions.staff, body: {} }); }
async function qualifiedTeams(sessions, prefix, count) {
  await importCodes(sessions, Math.max(8, count));
  const teams = [];
  for (let index = 1; index <= count; index += 1) {
    const person = await register(`${prefix}-${String(index).padStart(2, "0")}`, `acceptance-${scenario}-${index}`);
    const team = await makeTeam(sessions, [person]);
    await issue(sessions, team);
    await qualify(sessions, team);
    teams.push(team);
  }
  return teams;
}

const scenarios = {
  async journey(sessions) {
    await importCodes(sessions);
    const resource = await register("验收-已领资源", "acceptance-resource");
    const workshop = await register("验收-Workshop中", "acceptance-workshop");
    const qualified = await register("验收-已可参赛", "acceptance-qualified");
    const familiarA = await register("验收-熟人甲", "acceptance-familiar-a");
    const familiarB = await register("验收-熟人乙", "acceptance-familiar-b");
    const fullPeople = await Promise.all(["甲", "乙", "丙"].map((name, index) => register(`验收-满队-${name}`, `acceptance-full-${index + 1}`)));
    const freePeople = [];
    for (let index = 1; index <= 5; index += 1) freePeople.push(await register(`验收-无队-${String(index).padStart(2, "0")}`, `acceptance-free-${index}`));
    const resourceTeam = await makeTeam(sessions, [resource]);
    const workshopTeam = await makeTeam(sessions, [workshop]);
    const qualifiedTeam = await makeTeam(sessions, [qualified]);
    await makeTeam(sessions, [familiarA, familiarB]);
    await makeTeam(sessions, fullPeople);
    await issue(sessions, resourceTeam);
    await issue(sessions, workshopTeam);
    await api(`/api/ops/workshop/teams/${workshopTeam.id}/note`, { method: "PUT", staff: sessions.staff, body: { note: "练习赛已完成，等待 TA 核验" } });
    await issue(sessions, qualifiedTeam);
    await qualify(sessions, qualifiedTeam);
    return { participantLinks: { "参与者：已领资源": "acceptance-resource", "参与者：Workshop 中": "acceptance-workshop", "参与者：已可参赛": "acceptance-qualified" } };
  },
  async allocation(sessions) {
    const manualNames = [["验收-熟人队1-甲", "验收-熟人队1-乙"], ["验收-熟人队2-甲", "验收-熟人队2-乙"], ["验收-熟人队3-甲", "验收-熟人队3-乙", "验收-熟人队3-丙"], ["验收-人工单人队"]];
    let client = 1;
    for (const names of manualNames) {
      const people = [];
      for (const name of names) people.push(await register(name, `acceptance-manual-${client++}`));
      await makeTeam(sessions, people);
    }
    for (let index = 1; index <= 36; index += 1) await register(`验收-自由池-${String(index).padStart(2, "0")}`, `acceptance-free-pool-${index}`);
    return { participantLinks: {} };
  },
  async "tournament-group"(sessions) {
    const teams = await qualifiedTeams(sessions, "验收小组赛", 8);
    await api("/api/ops/competition/freeze", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: { teamIds: teams.map((team) => team.id) } });
    await api("/api/ops/competition/generate", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: { groupCount: 2, qualifiersPerGroup: 2 } });
    return { participantLinks: { "参与者：T-001 赛程": "acceptance-tournament-group-1" } };
  },
  async "tournament-30"(sessions) {
    await qualifiedTeams(sessions, "验收30队", 30);
    return { participantLinks: { "参与者：T-001 赛程": "acceptance-tournament-30-1", "参与者：T-004 赛程": "acceptance-tournament-30-4", "参与者：T-030 赛程": "acceptance-tournament-30-30" } };
  },
  async "tournament-knockout"(sessions) {
    const teams = await qualifiedTeams(sessions, "验收淘汰赛", 8);
    await api("/api/ops/competition/freeze", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: { teamIds: teams.map((team) => team.id) } });
    const tournament = await api("/api/ops/competition/generate", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: { groupCount: 2, qualifiersPerGroup: 2 } });
    for (const [index, match] of tournament.tournament.matches.entries()) await api(`/api/ops/matches/${match.id}/result`, { method: "POST", staff: sessions.staff, body: { scoreA: index % 3 === 0 ? 1 : 2, scoreB: index % 3 === 0 ? 1 : 0 } });
    await api("/api/ops/competition/knockout", { method: "POST", staff: sessions.staff, admin: sessions.admin, body: {} });
    return { participantLinks: { "参与者：T-001 淘汰赛": "acceptance-tournament-knockout-1" } };
  },
  async admin(sessions) {
    await importCodes(sessions);
    const reclaimPerson = await register("验收-待回收Code", "acceptance-reclaim");
    const revokePerson = await register("验收-待撤销资格", "acceptance-revoke");
    const reclaimTeam = await makeTeam(sessions, [reclaimPerson]);
    const revokeTeam = await makeTeam(sessions, [revokePerson]);
    await issue(sessions, reclaimTeam);
    await issue(sessions, revokeTeam);
    await qualify(sessions, revokeTeam);
    await api("/api/ops/assignments", { method: "POST", staff: sessions.staff, body: { participantIds: [reclaimPerson.id], targetTeamId: "" } });
    await api("/api/feedback", { method: "POST", client: "acceptance-revoke", body: { note: "验收反馈：参与者可见", page: "/" } });
    await api("/api/feedback", { method: "POST", staff: sessions.staff, body: { note: "验收反馈：工作人员可见", page: "/staff" } });
    return { participantLinks: { "参与者：待撤销资格": "acceptance-revoke" } };
  },
};

try {
  await start();
} catch (error) {
  stop();
  throw error;
}
