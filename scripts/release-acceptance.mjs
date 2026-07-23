import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const staffPin = "release-acceptance-staff";
const adminPin = "release-acceptance-admin";
const staffPins = JSON.stringify([{ id: "release-acceptance-staff", pin: staffPin, enabled: true }]);
const cases = [{ teamCount: 24, groupCount: 6 }, { teamCount: 32, groupCount: 8 }];

function buildWorker() {
  const result = spawnSync(process.execPath, ["lightsail/build-worker.mjs"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Lightsail Worker 构建失败：${(result.stderr || result.stdout || "unknown error").trim()}`);
}

async function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = probe.address(); const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

async function waitForHealth(baseUrl, acceptanceRunId, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("隔离 Lightsail 服务在健康检查前退出");
    try {
      const response = await fetch(`${baseUrl}/healthz`); const health = await response.json().catch(() => ({}));
      if (response.ok && health.acceptanceRunId === acceptanceRunId) return;
      if (response.ok) throw new Error("随机端口返回了其他服务，拒绝复用历史环境");
    } catch (error) {
      if (error instanceof Error && error.message.includes("拒绝复用")) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error("隔离 Lightsail 服务未能通过健康检查");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function isolatedServer(teamCount, action) {
  const directory = await mkdtemp(join(tmpdir(), `afc-release-${teamCount}-`));
  const databasePath = join(directory, "event.db"); const port = await availablePort(); const acceptanceRunId = randomUUID();
  const child = spawn(process.execPath, ["lightsail/server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), EVENT_DB_PATH: databasePath, STAFF_PINS: staffPins, ADMIN_PIN: adminPin, ACCEPTANCE_RUN_ID: acceptanceRunId },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-4_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, acceptanceRunId, child);
    return await action({ baseUrl, databasePath, port });
  } catch (error) {
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join(" | ");
    throw new Error(`${error instanceof Error ? error.message : "隔离验收失败"}${detail ? `；服务日志：${detail}` : ""}`);
  } finally {
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
}

function client(baseUrl) {
  async function request(path, { method = "GET", body, participant = "", staff = "", admin = "", allowError = false } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (participant) headers["x-client-id"] = participant;
    if (staff) headers["x-staff-session"] = staff;
    if (admin) headers["x-admin-session"] = admin;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !allowError) throw new Error(`${method} ${path} 返回 ${response.status}：${data.error || "unknown error"}`);
    return { status: response.status, data };
  }
  return request;
}

function assertNoSecrets(label, payload, secrets) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, `${label} 不应包含测试 Code/PIN`);
}

async function completeTournament({ teamCount, groupCount }, environment) {
  const api = client(environment.baseUrl);
  const loggedIn = await api("/api/ops/session", { method: "POST", body: { staffPin, staffNickname: `Release TA ${teamCount}` } });
  const staff = loggedIn.data.staffSession;
  const elevated = await api("/api/admin/session", { method: "POST", staff, body: { adminPin } });
  const admin = elevated.data.adminSession;
  const workshopCodes = Array.from({ length: teamCount }, (_, index) => `RELEASE-${teamCount}-WORKSHOP-${String(index + 1).padStart(2, "0")}`);
  const gamePortalCodes = workshopCodes.map((code) => `RELEASE-${teamCount}-PORTAL-${code}`);
  const secrets = [...workshopCodes, ...gamePortalCodes, staffPin, adminPin];
  await api("/api/ops/codes/import", { method: "POST", staff, admin, body: { workshopCodes, gamePortalCodes } });

  const teams = []; const participantClients = [];
  for (let index = 1; index <= teamCount; index += 1) {
    const participantClient = `release-${teamCount}-participant-${index}`; participantClients.push(participantClient);
    const registered = await api("/api/participants", { method: "POST", participant: participantClient, body: { nickname: `Release ${teamCount} 队 ${String(index).padStart(2, "0")}`, supportProfile: { techBackground: "technical", workshopExperience: "no" } } });
    const created = await api("/api/ops/teams", { method: "POST", staff, body: { memberIds: [registered.data.participant.id] } });
    teams.push(created.data.team);
    await api(`/api/ops/teams/${created.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
    await api(`/api/ops/qualification/teams/${created.data.team.id}/confirm`, { method: "POST", staff, body: {} });
  }

  const participantState = await api("/api/state", { participant: participantClients[0] });
  assert.equal(participantState.data.currentTeam.workshopCode, workshopCodes[0]);
  assert.equal(participantState.data.currentTeam.gamePortalCode, gamePortalCodes[0]);
  const staffState = await api("/api/ops/state", { staff });
  assert.equal(staffState.data.teams.length, teamCount);
  assert.equal(staffState.data.teams[0].workshopCode, workshopCodes[0]);
  const anonymousState = await api("/api/state"); const displayBefore = await api("/api/display"); const maintenance = await api("/api/maintenance/snapshot", { allowError: true });
  assert.equal(maintenance.status, 404);
  assertNoSecrets("anonymous state", anonymousState.data, secrets); assertNoSecrets("display", displayBefore.data, secrets); assertNoSecrets("maintenance", maintenance.data, secrets);

  await api("/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((team) => team.id) } });
  const generated = await api("/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount, qualifiersPerGroup: 2 } });
  const groupTournament = generated.data.tournament; const expectedGroupMatches = groupCount * 6;
  assert.equal(groupTournament.groups.length, groupCount); assert.equal(groupTournament.groups.every((group) => group.teamIds.length === 4), true);
  assert.equal(groupTournament.matches.length, expectedGroupMatches);
  const appearances = new Map(teams.map((team) => [team.id, 0]));
  for (const match of groupTournament.matches) { appearances.set(match.teamAId, appearances.get(match.teamAId) + 1); appearances.set(match.teamBId, appearances.get(match.teamBId) + 1); }
  assert.equal([...appearances.values()].every((count) => count === 3), true);
  for (const [index, match] of groupTournament.matches.entries()) await api(`/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA: 2 + (index % 2), scoreB: index % 2 } });

  const knockout = await api("/api/ops/competition/knockout", { method: "POST", staff, admin, body: {} });
  assert.equal(knockout.data.tournament.knockoutMatches.length, 15);
  let playedKnockoutMatches = 0;
  for (let guard = 0; guard < 10; guard += 1) {
    const current = await api("/api/ops/state", { staff }); const ready = current.data.tournament.knockoutMatches.filter((match) => match.status === "ready");
    if (!ready.length) break;
    for (const [index, match] of ready.entries()) {
      await api(`/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA: index % 2 ? 1 : 2, scoreB: 0 } });
      playedKnockoutMatches += 1;
    }
  }

  const completed = (await api("/api/ops/state", { staff })).data.tournament;
  const finalRound = Math.max(...completed.knockoutMatches.map((match) => match.round)); const finals = completed.knockoutMatches.filter((match) => match.round === finalRound);
  assert.equal(finals.length, 1); const [final] = finals;
  assert.equal(final.status, "completed"); assert.ok(final.winnerId); assert.equal([final.teamAId, final.teamBId].includes(final.winnerId), true);
  assert.equal(completed.knockoutMatches.every((match) => ["completed", "bye"].includes(match.status) && match.winnerId), true);
  for (const match of completed.knockoutMatches.filter((candidate) => candidate.sourceAId || candidate.sourceBId)) {
    const sourceA = completed.knockoutMatches.find((candidate) => candidate.id === match.sourceAId); const sourceB = completed.knockoutMatches.find((candidate) => candidate.id === match.sourceBId);
    if (sourceA) assert.equal(match.teamAId, sourceA.winnerId);
    if (sourceB) assert.equal(match.teamBId, sourceB.winnerId);
  }
  const champion = staffState.data.teams.find((team) => team.id === final.winnerId)?.teamNumber || completed.knockoutMatches.find((match) => match.id === final.id)?.winnerLabel;
  assert.match(champion, /^T-\d{3}$/);
  const displayAfter = await api("/api/display"); assertNoSecrets("completed display", displayAfter.data, secrets);

  return {
    teamCount,
    groupCount,
    groupSizes: completed.groups.map((group) => group.teamIds.length),
    groupMatchCount: completed.matches.length,
    groupMatchesPerTeam: 3,
    knockoutMatchCount: completed.knockoutMatches.length,
    knockoutPlayedCount: playedKnockoutMatches,
    knockoutByeCount: completed.knockoutMatches.filter((match) => match.status === "bye").length,
    championTeamNumber: champion,
    publicSecretsRedacted: true,
    isolatedPort: environment.port,
    database: "temporary-sqlite",
  };
}

try {
  buildWorker();
  const scenarios = [];
  for (const item of cases) scenarios.push(await isolatedServer(item.teamCount, (environment) => completeTournament(item, environment)));
  const report = { schemaVersion: 1, result: "passed", generatedAt: new Date().toISOString(), environment: { server: "lightsail/server.mjs", database: "fresh temporary SQLite per scenario", realDataTouched: false }, scenarios };
  assertNoSecrets("release acceptance report", report, [staffPin, adminPin, "RELEASE-24-WORKSHOP", "RELEASE-32-WORKSHOP"]);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ schemaVersion: 1, result: "failed", error: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
}
