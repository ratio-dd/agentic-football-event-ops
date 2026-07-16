import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const TEST_ENV = { STAFF_PINS: JSON.stringify([{ id: "test-staff", pin: "test-staff", enabled: true }]), ADMIN_PIN: "test-admin" };

class MemoryD1 {
  row = null;
  prepare(sql) {
    const execute = async (args = []) => {
      if (sql.startsWith("SELECT")) return this.row ? { ...this.row } : null;
      if (sql.startsWith("INSERT")) { if (!this.row) this.row = { data: args[1], version: 1 }; return { meta: { changes: 1 } }; }
      if (sql.startsWith("UPDATE")) {
        if (!this.row || this.row.version !== args[4]) return { meta: { changes: 0 } };
        this.row = { data: args[0], version: args[1] }; return { meta: { changes: 1 } };
      }
      return { meta: { changes: 1 } };
    };
    return { bind: (...args) => ({ first: () => execute(args), run: () => execute(args) }), first: () => execute(), run: () => execute() };
  }
}

async function eventWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url); url.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}
async function call(worker, db, path, { method = "GET", client = "", staff = "", admin = "", body } = {}) {
  const headers = new Headers(); if (client) headers.set("x-client-id", client); if (staff) headers.set("x-staff-session", staff); if (admin) headers.set("x-admin-session", admin); if (body) headers.set("content-type", "application/json");
  const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), { ...TEST_ENV, DB: db, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  return { response, data: await response.json() };
}
async function elevate(worker, db, staff) {
  const session = await call(worker, db, "/api/admin/session", { method: "POST", staff, body: { adminPin: "test-admin" } });
  assert.equal(session.response.status, 200);
  return session.data.adminSession;
}

test("onsite state machine removes self-service team ownership", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /\/api\/participants\/rebind/);
  assert.match(worker, /\/api\/ops\/codes\/import/);
  assert.match(worker, /issueCode\(s, teamId\(pathname\)/);
  assert.match(worker, /codeVisibleClientIds/);
  assert.match(worker, /qualificationStatus = "ta_qualified"/);
  assert.match(worker, /api\/admin\/session/);
  assert.match(worker, /需要管理后台权限/);
  assert.match(worker, /此环境尚未配置 Staff PIN/);
  assert.doesNotMatch(worker, /function createTeam\(/);
  assert.doesNotMatch(worker, /function joinTeam\(/);
  assert.doesNotMatch(worker, /inviteCode/);
  assert.doesNotMatch(worker, /captainId/);
});

test("mobile participant and staff surfaces match the on-site workflow", async () => {
  const [participant, staff, app, css] = await Promise.all([
    read("public/participant.js"), read("public/admin.js"), read("public/app.js"), read("public/styles.css"),
  ]);
  assert.match(participant, /换手机了？恢复我的状态/);
  assert.match(participant, /自助组队/);
  assert.match(participant, /创建一个队伍/);
  assert.match(participant, /加入队友的队伍/);
  assert.match(participant, /Game Portal/);
  assert.doesNotMatch(participant, /邀请码/);
  assert.match(staff, /现场/);
  assert.match(staff, /组队/);
  assert.match(staff, /Workshop/);
  assert.match(staff, /比赛/);
  assert.match(staff, /更多/);
  assert.match(staff, /人工调整分组/);
  assert.match(staff, /现场开关/);
  assert.match(staff, /bottom-tabs/);
  assert.match(app, /\/staff/);
  assert.match(app, /formDraft/);
  assert.match(app, /restoreDrafts/);
  assert.match(staff, /controls\.ui\.tab/);
  assert.match(staff, /selectedPersonIds/);
  assert.match(staff, /grouping-tabs/);
  assert.match(staff, /容量不足/);
  assert.match(staff, /Admin 可在资源管理中回收/);
  assert.doesNotMatch(staff, /name="codeId"/);
  assert.match(css, /\.bottom-tabs/);
  assert.match(css, /bottom-tabs-four/);
  assert.match(await read("public/admin-panel.js"), /请从 Staff 工作台进入/);
  assert.match(app, /competition\/swap/);
  assert.match(await read("public/display.js"), /下一场/);
});

test("shared deployment fails closed without configured Staff and administrator credentials", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const noStaff = await worker.fetch(new Request("https://feedback.example/api/ops/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffPin: "anything", staffNickname: "测试" }) }), { DB: db, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  assert.equal(noStaff.status, 503);
  const registered = await call(worker, db, "/api/participants", { method: "POST", client: "gate-phone", body: { nickname: "开关测试", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "管理员" } });
  const denied = await call(worker, db, "/api/ops/event-gates", { method: "PUT", staff: login.data.staffSession, body: { gates: { selfServiceTeam: false } } });
  assert.equal(denied.response.status, 403);
  const admin = await elevate(worker, db, login.data.staffSession);
  const updated = await call(worker, db, "/api/ops/event-gates", { method: "PUT", staff: login.data.staffSession, admin, body: { gates: { selfServiceTeam: false, codeIssuance: true, qualification: true, scheduleEditing: true } } });
  assert.equal(updated.response.status, 200);
  const selfTeam = await call(worker, db, "/api/teams/self", { method: "POST", client: "gate-phone", body: {} });
  assert.equal(selfTeam.response.status, 409);
  assert.equal(registered.response.status, 200);
});

test("staff can group people, issue an official code, and a rebound browser cannot read it", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const first = await call(worker, db, "/api/participants", { method: "POST", client: "phone-a", body: { nickname: "阿北", supportProfile: {} } });
  const second = await call(worker, db, "/api/participants", { method: "POST", client: "phone-b", body: { nickname: "小南", supportProfile: {} } });
  assert.equal(first.response.status, 200); assert.equal(second.response.status, 200);
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "TA 王" } });
  const staff = login.data.staffSession; assert.ok(staff);
  const admin = await elevate(worker, db, staff);
  const grouped = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [first.data.participant.id, second.data.participant.id] } });
  const teamId = grouped.data.team.id;
  await call(worker, db, `/api/ops/teams/${teamId}/confirm`, { method: "POST", staff, body: {} });
  const imported = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { codes: ["OFFICIAL-001", "OFFICIAL-002"] } });
  assert.equal(imported.response.status, 200);
  const workshopLink = await call(worker, db, "/api/ops/event-links", { method: "PUT", staff, admin, body: { workshopUrl: "https://workshop.example/entry", gamePortalUrl: "https://agentic-football.aws.dev/" } });
  assert.equal(workshopLink.response.status, 200);
  const issued = await call(worker, db, `/api/ops/teams/${teamId}/issue-code`, { method: "POST", staff, body: {} });
  assert.equal(issued.response.status, 200);
  const originalView = await call(worker, db, "/api/state", { client: "phone-a" });
  assert.equal(originalView.data.currentTeam.teamCode, "OFFICIAL-001");
  assert.equal(originalView.data.event.workshopUrl, "https://workshop.example/entry");
  const third = await call(worker, db, "/api/participants", { method: "POST", client: "phone-c", body: { nickname: "小西", supportProfile: {} } });
  const secondGroup = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [third.data.participant.id] } });
  await call(worker, db, `/api/ops/teams/${secondGroup.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const secondView = await call(worker, db, "/api/state", { client: "phone-c" });
  assert.equal(secondView.data.currentTeam.teamCode, "OFFICIAL-002");
  const staffState = await call(worker, db, "/api/ops/state", { staff });
  assert.deepEqual(staffState.data.codeSummary, { total: 2, available: 0, issued: 2 });
  await call(worker, db, "/api/participants/rebind", { method: "POST", client: "new-phone", body: { nickname: "阿北" } });
  const reboundView = await call(worker, db, "/api/state", { client: "new-phone" });
  assert.equal(reboundView.data.currentTeam.teamCode, null);
});

test("participants can self-organize with a team number, while staff search accepts bare participant numbers", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const first = await call(worker, db, "/api/participants", { method: "POST", client: "phone-one", body: { nickname: "自组甲", supportProfile: {} } });
  await call(worker, db, "/api/participants", { method: "POST", client: "phone-two", body: { nickname: "自组乙", supportProfile: {} } });
  const created = await call(worker, db, "/api/teams/self", { method: "POST", client: "phone-one", body: {} });
  assert.equal(created.response.status, 200); assert.equal(created.data.team.teamNumber, "T-001");
  const joined = await call(worker, db, "/api/teams/self/join", { method: "POST", client: "phone-two", body: { teamNumber: "001" } });
  assert.equal(joined.response.status, 200); assert.equal(joined.data.team.memberIds.length, 2);
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "TA 搜索" } });
  const found = await call(worker, db, "/api/ops/participants?q=001", { staff: login.data.staffSession });
  assert.equal(found.response.status, 200); assert.equal(found.data.participants[0].staffShortId, first.data.participant.staffShortId);
  const firstView = await call(worker, db, "/api/state", { client: "phone-one" });
  assert.equal(firstView.data.currentTeam.teamNumber, "T-001");
});

test("Staff dispatch is atomic: code visibility follows membership and Admin reclaims a dissolved team code", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const north = await call(worker, db, "/api/participants", { method: "POST", client: "north-phone", body: { nickname: "调度北", supportProfile: {} } });
  const south = await call(worker, db, "/api/participants", { method: "POST", client: "south-phone", body: { nickname: "调度南", supportProfile: {} } });
  const west = await call(worker, db, "/api/participants", { method: "POST", client: "west-phone", body: { nickname: "调度西", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "调度 TA" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const northTeam = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [north.data.participant.id] } });
  const westTeam = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [west.data.participant.id] } });
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { codes: ["DISPATCH-001", "DISPATCH-002"] } });
  await call(worker, db, `/api/ops/teams/${northTeam.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  await call(worker, db, `/api/ops/teams/${westTeam.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const added = await call(worker, db, "/api/ops/assignments", { method: "POST", staff, body: { participantIds: [south.data.participant.id], targetTeamId: northTeam.data.team.id } });
  assert.equal(added.response.status, 200);
  const southView = await call(worker, db, "/api/state", { client: "south-phone" }); assert.equal(southView.data.currentTeam.teamCode, "DISPATCH-001");
  const movedOut = await call(worker, db, "/api/ops/assignments", { method: "POST", staff, body: { participantIds: [north.data.participant.id], targetTeamId: "" } });
  assert.equal(movedOut.response.status, 200); const northView = await call(worker, db, "/api/state", { client: "north-phone" }); assert.equal(northView.data.currentTeam, null);
  const dissolved = await call(worker, db, "/api/ops/assignments", { method: "POST", staff, body: { participantIds: [west.data.participant.id], targetTeamId: "" } });
  assert.equal(dissolved.response.status, 200);
  const staffDenied = await call(worker, db, `/api/admin/teams/${westTeam.data.team.id}/reclaim-code`, { method: "POST", staff });
  assert.equal(staffDenied.response.status, 403);
  const reclaimed = await call(worker, db, `/api/admin/teams/${westTeam.data.team.id}/reclaim-code`, { method: "POST", staff, admin });
  assert.equal(reclaimed.response.status, 200);
  const state = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(state.data.teams.find((team) => team.id === westTeam.data.team.id).status, "dissolved");
  assert.equal(state.data.codeSummary.available, 1);
});

test("participant QR endpoint renders the current participant's P-number", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  await call(worker, db, "/api/participants", { method: "POST", client: "qr-phone", body: { nickname: "二维码体验员", supportProfile: {} } });
  const response = await worker.fetch(new Request("http://localhost/api/participant/qr", { headers: { "x-client-id": "qr-phone" } }), { ...TEST_ENV, DB: db, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /image\/svg\+xml/); assert.match(await response.text(), /svg/);
});

test("staff can adjust a draft team and run a frozen group-to-knockout tournament", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const people = [];
  for (let index = 0; index < 4; index += 1) people.push(await call(worker, db, "/api/participants", { method: "POST", client: `match-phone-${index}`, body: { nickname: `参赛${index}`, supportProfile: {} } }));
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "赛事 TA" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const created = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [people[0].data.participant.id] } });
  const edited = await call(worker, db, `/api/ops/teams/${created.data.team.id}/members`, { method: "PUT", staff, body: { memberIds: [people[0].data.participant.id, people[1].data.participant.id] } });
  assert.equal(edited.data.team.memberIds.length, 2);
  const teams = [created.data.team];
  for (const person of people.slice(2)) teams.push((await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } })).data.team);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { codes: ["C1", "C2", "C3"] } });
  for (const item of teams) { await call(worker, db, `/api/ops/teams/${item.id}/issue-code`, { method: "POST", staff, body: {} }); await call(worker, db, `/api/ops/qualification/teams/${item.id}/confirm`, { method: "POST", staff, body: {} }); }
  const frozen = await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((item) => item.id) } });
  assert.equal(frozen.response.status, 200);
  const generated = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 2, qualifiersPerGroup: 1 } });
  assert.equal(generated.response.status, 200); assert.equal(generated.data.tournament.groups.length, 2);
  const firstGroupTeam = generated.data.tournament.groups[0].teamIds[0]; const secondGroupTeam = generated.data.tournament.groups[1].teamIds[0];
  const swapped = await call(worker, db, "/api/ops/competition/swap", { method: "POST", staff, admin, body: { firstTeamId: firstGroupTeam, secondTeamId: secondGroupTeam } });
  assert.equal(swapped.response.status, 200); assert.ok(swapped.data.tournament.groups[0].teamIds.includes(secondGroupTeam));
  const display = await call(worker, db, "/api/display"); assert.equal(display.response.status, 200); assert.equal(display.data.tournament.groups.length, 2);
  for (const match of swapped.data.tournament.matches) await call(worker, db, `/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA: 2, scoreB: 1 } });
  const rejectedSwap = await call(worker, db, "/api/ops/competition/swap", { method: "POST", staff, admin, body: { firstTeamId: secondGroupTeam, secondTeamId: firstGroupTeam } });
  assert.equal(rejectedSwap.response.status, 409);
  const knockout = await call(worker, db, "/api/ops/competition/knockout", { method: "POST", staff, admin, body: {} });
  assert.equal(knockout.response.status, 200); assert.equal(knockout.data.tournament.knockoutMatches.length, 1);
});
