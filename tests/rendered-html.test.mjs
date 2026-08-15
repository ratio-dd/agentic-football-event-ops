import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const TEST_ENV = { STAFF_PINS: JSON.stringify([{ id: "test-staff", pin: "test-staff", enabled: true }]), ADMIN_PIN: "test-admin" };
const resourceCodes = (codes) => ({ gamePortalCodes: codes.map((code) => `PORTAL-${code}`) });

class MemoryD1 {
  row = null;
  conflicts = 0;
  prepare(sql) {
    const execute = async (args = []) => {
      if (sql.startsWith("SELECT")) return this.row ? { ...this.row } : null;
      if (sql.startsWith("INSERT")) { if (!this.row) this.row = { data: args[1], version: 1 }; return { meta: { changes: 1 } }; }
      if (sql.startsWith("UPDATE")) {
        if (this.conflicts > 0) { this.conflicts -= 1; return { meta: { changes: 0 } }; }
        if (!this.row || this.row.version !== args[4]) return { meta: { changes: 0 } };
        this.row = { data: args[0], version: args[1] }; return { meta: { changes: 1 } };
      }
      return { meta: { changes: 1 } };
    };
    return { bind: (...args) => ({ first: () => execute(args), run: () => execute(args) }), first: () => execute(), run: () => execute() };
  }
}

test("mutation retries reuse the parsed request body after an optimistic write conflict", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); db.conflicts = 1;
  const registered = await call(worker, db, "/api/participants", { method: "POST", client: "retry-phone", body: { nickname: "并发重试", supportProfile: {} } });
  assert.equal(registered.response.status, 200);
  assert.equal(registered.data.participant.nickname, "并发重试");
  const raw = JSON.parse(db.row.data);
  assert.equal(raw.participants.length, 1);
  assert.equal(raw.participants[0].nickname, "并发重试");
});

test("Staff audit log never exposes Staff or Admin bearer tokens", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "安全审计" } });
  const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const state = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(state.response.status, 200);
  const serializedAudit = JSON.stringify(state.data.auditLog);
  assert.equal(serializedAudit.includes(staff), false);
  assert.equal(serializedAudit.includes(admin), false);
  assert.ok(state.data.auditLog.some((entry) => entry.action === "staff.session.created" && entry.objectId === "test-staff"));
});

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
async function completeGroupRounds(worker, db, staff, admin, tournament, scoreFor = () => [1, 0]) {
  let last; let index = 0;
  for (let round = 1; round <= tournament.totalGroupRounds; round += 1) {
    for (const match of tournament.matches.filter((item) => item.round === round)) {
      const [scoreA, scoreB] = scoreFor(index++, match);
      last = await call(worker, db, `/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA, scoreB } });
      assert.equal(last.response.status, 200);
    }
    if (round < tournament.totalGroupRounds) {
      const advanced = await call(worker, db, "/api/ops/competition/advance-group-round", { method: "POST", staff, admin, body: {} });
      assert.equal(advanced.response.status, 200);
    }
  }
  return last;
}

test("onsite state machine keeps team assignment in the Staff workflow", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /\/api\/participants\/rebind/);
  assert.match(worker, /\/api\/ops\/codes\/import/);
  assert.match(worker, /\/api\/admin\/codes\/game-portal\/backfill/);
  assert.match(worker, /updateTeamStatus\(s, teamId\(pathname\)/);
  assert.match(worker, /function updateTeamStatus/);
  assert.match(worker, /issueCode\(s, teamId\(pathname\)/);
  assert.match(worker, /codeVisibleClientIds/);
  assert.match(worker, /qualificationStatus = "ta_qualified"/);
  assert.match(worker, /api\/admin\/session/);
  assert.match(worker, /需要管理后台权限/);
  assert.match(worker, /此环境尚未配置 Staff PIN/);
  assert.match(worker, /\/api\/teams\/self/);
  assert.match(worker, /selfServiceTeam: false/);
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
  assert.match(participant, /等待工作人员安排队伍/);
  assert.doesNotMatch(participant, /自助组队/);
  assert.doesNotMatch(participant, /创建一个队伍/);
  assert.doesNotMatch(participant, /加入队友的队伍/);
  assert.match(participant, /Game Portal/);
  assert.match(participant, /Workshop 入口/);
  assert.match(participant, /点击或复制 Workshop 链接到浏览器打开，输入邮箱获得一次性验证码进行 Workshop 注册。/);
  assert.doesNotMatch(participant, /所有参与者使用同一个 Workshop 入口。/);
  assert.match(await read("worker/index.ts"), /f858-0a0594-2f/);
  assert.doesNotMatch(participant, /Workshop Code/);
  assert.match(participant, /competitionForTeam/);
  assert.match(participant, /净胜球/);
  assert.doesNotMatch(participant, /officialLabel/);
  assert.doesNotMatch(participant, /邀请码/);
  assert.doesNotMatch(participant, /你的现场编号|我的二维码/);
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
  assert.match(app, /captureInputFocus/);
  assert.match(app, /field\.value/);
  assert.match(staff, /controls\.ui\.tab/);
  assert.match(staff, /selectedPersonIds/);
  assert.match(staff, /grouping-tabs/);
  assert.doesNotMatch(staff, /生成自动分配预览/);
  assert.match(staff, /data-detail-key/);
  assert.match(staff, /team-board-search/);
  assert.match(staff, /Game Portal Code：\$\{team\.gamePortalCode/);
  assert.match(staff, /team-status-override/);
  assert.match(staff, /copy-team-code/);
  assert.doesNotMatch(staff, /data-code-kind="Workshop Team Code"/);
  assert.match(staff, /data-code-kind="Game Portal Code"/);
  assert.match(staff, /competition-group-filter/);
  assert.match(staff, /data-draft-scope="match:/);
  assert.match(staff, /人数没有上限/);
  assert.match(staff, /Admin 可在资源管理中回收/);
  assert.doesNotMatch(staff, /name="codeId"/);
  assert.doesNotMatch(staff, /扫描参与者二维码|人员编号|BarcodeDetector|P-001/);
  const staffCompetition = staff.slice(staff.indexOf("function staffCompetition"), staff.indexOf("function staffScoreForm"));
  assert.match(staffCompetition, /第 \$\{round\} 轮/);
  assert.doesNotMatch(staffCompetition, /积分榜/);
  assert.match(css, /\.bottom-tabs/);
  assert.match(css, /bottom-tabs-four/);
  assert.match(await read("public/admin-panel.js"), /请从 Staff 工作台进入/);
  assert.match(await read("public/admin-panel.js"), /只读核对当前资源/);
  assert.match(await read("public/admin-panel.js"), /拖到满组的一支队伍卡可交换/);
  const adminPanel = await read("public/admin-panel.js");
  assert.match(adminPanel, /本轮结束，进入下一轮/);
  assert.match(adminPanel, /归档并重置当前活动/);
  assert.match(adminPanel, /archiveAndResetEvent/);
  assert.match(adminPanel, /第一步，共两步/);
  assert.match(adminPanel, /第二步，共两步/);
  assert.doesNotMatch(adminPanel.slice(adminPanel.indexOf('button.dataset.action === "archive-reset-event"'), adminPanel.indexOf('button.dataset.action === "resource-diagnostics"')), /window\.prompt|window\.confirm/);
  assert.doesNotMatch(adminPanel, /重新生成下一轮/);
  assert.match(await read("worker/index.ts"), /\/api\/admin\/diagnostics/);
  assert.match(await read("worker/index.ts"), /\/api\/maintenance\/snapshot/);
  assert.match(css, /group-board-lane/);
  assert.match(app, /competition\/swap/);
  assert.match(app, /acceptanceClient/);
  assert.match(app, /127\.0\.0\.1/);
  assert.match(await read("public/display.js"), /下一场/);
});

test("shared deployment fails closed without configured Staff and administrator credentials", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const noStaff = await worker.fetch(new Request("https://feedback.example/api/ops/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffPin: "anything", staffNickname: "测试" }) }), { DB: db, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  assert.equal(noStaff.status, 503);
  const registered = await call(worker, db, "/api/participants", { method: "POST", client: "gate-phone", body: { nickname: "开关测试", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "管理员" } });
  const denied = await call(worker, db, "/api/ops/event-gates", { method: "PUT", staff: login.data.staffSession, body: { gates: { codeIssuance: false } } });
  assert.equal(denied.response.status, 403);
  const admin = await elevate(worker, db, login.data.staffSession);
  const updated = await call(worker, db, "/api/ops/event-gates", { method: "PUT", staff: login.data.staffSession, admin, body: { gates: { codeIssuance: true, qualification: true, scheduleEditing: true } } });
  assert.equal(updated.response.status, 200);
  const hiddenEndpoint = await call(worker, db, "/api/teams/self", { method: "POST", client: "gate-phone", body: {} });
  assert.equal(hiddenEndpoint.response.status, 409);
  assert.equal(registered.response.status, 200);
});

test("admin diagnostics reports resource bindings without exposing code values", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const person = await call(worker, db, "/api/participants", { method: "POST", client: "diagnostic-phone", body: { nickname: "诊断队员", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "诊断 Admin" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const team = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } });
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["DIAG-WORKSHOP"]) });
  const denied = await call(worker, db, "/api/admin/diagnostics", { staff }); assert.equal(denied.response.status, 403);
  const before = await call(worker, db, "/api/admin/diagnostics", { staff, admin });
  assert.equal(before.response.status, 200); assert.equal(before.data.activeTeams, 1); assert.deepEqual(before.data.gamePortal.activeTeamsMissingCode, [team.data.team.teamNumber]); assert.equal(JSON.stringify(before.data).includes("DIAG-WORKSHOP"), false);
  await call(worker, db, `/api/ops/teams/${team.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const after = await call(worker, db, "/api/admin/diagnostics", { staff, admin });
  assert.deepEqual(after.data.gamePortal.activeTeamsMissingCode, []); assert.equal(after.data.gamePortal.assigned, 1); assert.equal(after.data.integrity, "ok");
});

test("temporary public maintenance snapshot can be disabled by an administrator", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const person = await call(worker, db, "/api/participants", { method: "POST", client: "public-maintenance-phone", body: { nickname: "快照队员", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "快照 Admin" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const created = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } });
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["VISIBLE-WORKSHOP"]) });
  await call(worker, db, `/api/ops/teams/${created.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const visible = await call(worker, db, "/api/maintenance/snapshot");
  assert.equal(visible.response.status, 200); assert.equal(visible.data.temporary, true); assert.equal(visible.data.teams[0].gamePortalCode, "PORTAL-VISIBLE-WORKSHOP"); assert.equal("workshopCode" in visible.data.teams[0], false);
  await call(worker, db, "/api/ops/event-gates", { method: "PUT", staff, admin, body: { gates: { publicMaintenanceSnapshot: false } } });
  const closed = await call(worker, db, "/api/maintenance/snapshot");
  assert.equal(closed.response.status, 404);
});

test("registration immediately creates a confirmed solo team", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  for (let index = 1; index <= 40; index += 1) {
    const registered = await call(worker, db, "/api/participants", { method: "POST", client: `auto-team-${index}`, body: { nickname: `自动队${index}`, supportProfile: {} } });
    assert.equal(registered.response.status, 200);
    assert.equal(registered.data.team.status, "ready_code");
    assert.equal(registered.data.team.memberIds.length, 1);
    assert.equal(registered.data.participant.teamId, registered.data.team.id);
    assert.equal(registered.data.participant.allocationSource, "manual");
  }
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "编组 TA" } });
  const state = await call(worker, db, "/api/ops/state", { staff: login.data.staffSession });
  assert.equal(state.data.participants.length, 40);
  assert.equal(state.data.teams.filter((team) => team.status !== "dissolved").length, 40);
  assert.equal(state.data.allocation.freePeople.length, 0);
  assert.equal(state.data.event.maxWorkshopTeams, 32);
});

test("Admin batch issuance is atomic and Staff can see each assigned Game Portal Code", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const registrations = [];
  for (let index = 1; index <= 3; index += 1) registrations.push(await call(worker, db, "/api/participants", { method: "POST", client: `batch-${index}`, body: { nickname: `批量队${index}`, supportProfile: {} } }));
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "批量 Admin" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const teamIds = registrations.map((item) => item.data.team.id);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { gamePortalCodes: ["BG-1", "BG-2"] } });
  const rejected = await call(worker, db, "/api/ops/codes/batch-issue", { method: "POST", staff, admin, body: { teamIds } });
  assert.equal(rejected.response.status, 409); assert.match(rejected.data.error, /库存不足.*Game Portal 1 个/);
  const unchanged = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(unchanged.data.teams.filter((team) => team.gamePortalCodeAssigned).length, 0);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { gamePortalCodes: ["BG-1", "BG-2", "BG-3"] } });
  const issued = await call(worker, db, "/api/ops/codes/batch-issue", { method: "POST", staff, admin, body: { teamIds } });
  assert.equal(issued.response.status, 200); assert.equal(issued.data.assigned, 3);
  const staffView = await call(worker, db, "/api/ops/state", { staff });
  assert.deepEqual(staffView.data.teams.filter((team) => teamIds.includes(team.id)).map((team) => team.gamePortalCode), ["BG-1", "BG-2", "BG-3"]);
  assert.ok(staffView.data.teams.every((team) => !("workshopCode" in team) && !("workshopCodeId" in team)));
});

test("Code imports append unique inventory after issuance and keep summary counts stable", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const registrations = [];
  for (let index = 1; index <= 2; index += 1) registrations.push(await call(worker, db, "/api/participants", { method: "POST", client: `append-${index}`, body: { nickname: `追加队${index}`, supportProfile: {} } }));
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "追加 Admin" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const first = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { gamePortalCodes: ["AG-1", "AG-1", "AG-2"] } });
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.data.imported, { gamePortal: { submitted: 3, added: 2, duplicates: 1 } });
  await call(worker, db, `/api/ops/teams/${registrations[0].data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const appended = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { gamePortalCodes: ["AG-2", "AG-3"] } });
  assert.equal(appended.response.status, 200);
  assert.deepEqual(appended.data.imported, { gamePortal: { submitted: 2, added: 1, duplicates: 1 } });
  assert.deepEqual(appended.data.codeSummary, { gamePortal: { total: 3, available: 2, issued: 1 } });
  const state = await call(worker, db, "/api/ops/state", { staff }); const issuedTeam = state.data.teams.find((team) => team.id === registrations[0].data.team.id);
  assert.equal(issuedTeam.gamePortalCode, "AG-1"); assert.equal("workshopCode" in issuedTeam, false);
});

test("every roster size from 4 through 32 generates balanced dynamic groups", async () => {
  const worker = await eventWorker();
  for (let count = 4; count <= 32; count += 1) {
    const db = new MemoryD1(); const teamIds = [];
    for (let index = 0; index < count; index += 1) {
      const registered = await call(worker, db, "/api/participants", { method: "POST", client: `matrix-${count}-${index}`, body: { nickname: `矩阵${count}-${index}`, supportProfile: {} } });
      teamIds.push(registered.data.team.id);
    }
    const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "矩阵 Admin" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
    const raw = JSON.parse(db.row.data); raw.gamePortalCodes = raw.teams.map((team, index) => ({ id: `matrix-code-${count}-${index}`, code: `MATRIX-${count}-${index}`, status: "assigned", teamId: team.id })); raw.teams.forEach((team, index) => { team.gamePortalCodeId = raw.gamePortalCodes[index].id; team.status = "ta_qualified"; team.qualificationStatus = "ta_qualified"; }); db.row.data = JSON.stringify(raw);
    const frozen = await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds } }); assert.equal(frozen.response.status, 200, `${count} 支应可冻结`);
    const generated = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 99, qualifiersPerGroup: 99 } });
    assert.equal(generated.response.status, 200, `${count} 支应可生成`);
    const tournament = generated.data.tournament; const expectedGroups = count <= 4 ? 1 : count <= 8 ? 2 : count <= 16 ? 4 : 8;
    assert.equal(tournament.groups.length, expectedGroups, `${count} 支小组数`);
    assert.ok(tournament.groups.every((group) => group.teamIds.length >= 2 && group.teamIds.length <= 4), `${count} 支每组应为 2–4 队`);
    assert.ok(Math.max(...tournament.groups.map((group) => group.teamIds.length)) - Math.min(...tournament.groups.map((group) => group.teamIds.length)) <= 1, `${count} 支分组应均衡`);
    assert.equal(tournament.qualifiersPerGroup, 2); assert.equal(tournament.groups.length * tournament.qualifiersPerGroup, expectedGroups * 2);
    const staffRound = await call(worker, db, "/api/ops/state", { staff });
    assert.ok(staffRound.data.tournament.matches.every((match) => match.round === 1), `${count} 支 Staff 只能收到第 1 轮`);
  }
});

test("the shared Workshop URL is immediately available and only Game Portal Code is issued per team", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const first = await call(worker, db, "/api/participants", { method: "POST", client: "single-code-a", body: { nickname: "单码甲", supportProfile: {} } });
  const second = await call(worker, db, "/api/participants", { method: "POST", client: "single-code-b", body: { nickname: "单码乙", supportProfile: {} } });
  const firstPublic = await call(worker, db, "/api/state", { client: "single-code-a" });
  assert.equal(firstPublic.data.event.workshopUrl, "https://catalog.us-east-1.prod.workshops.aws/join?access-code=f858-0a0594-2f");
  assert.equal(firstPublic.data.currentTeam.gamePortalCode, null);
  assert.equal("workshopCode" in firstPublic.data.currentTeam, false);
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "单码 TA" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const rejectedLegacyImport = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { workshopCodes: ["REMOVED-001"] } });
  assert.equal(rejectedLegacyImport.response.status, 400);
  const noInventory = await call(worker, db, `/api/ops/teams/${first.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  assert.equal(noInventory.response.status, 409); assert.match(noInventory.data.error, /Game Portal Code/);
  const imported = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: { gamePortalCodes: ["PORTAL-001", "PORTAL-002"] } });
  assert.equal(imported.response.status, 200);
  const issued = await call(worker, db, `/api/ops/teams/${first.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  assert.equal(issued.response.status, 200);
  const qualifiedManually = await call(worker, db, `/api/ops/teams/${first.data.team.id}/status`, { method: "PUT", staff, body: { status: "ta_qualified" } });
  assert.equal(qualifiedManually.response.status, 200);
  assert.equal(qualifiedManually.data.team.status, "ta_qualified");
  const restoredToWorkshop = await call(worker, db, `/api/ops/teams/${first.data.team.id}/status`, { method: "PUT", staff, body: { status: "issued" } });
  assert.equal(restoredToWorkshop.response.status, 200);
  assert.equal(restoredToWorkshop.data.team.status, "issued");
  const closedRaw = JSON.parse(db.row.data); closedRaw.event.gates.qualification = false; db.row.data = JSON.stringify(closedRaw);
  const blockedQualification = await call(worker, db, `/api/ops/teams/${first.data.team.id}/status`, { method: "PUT", staff, body: { status: "ta_qualified" } });
  assert.equal(blockedQualification.response.status, 409);
  assert.match(blockedQualification.data.error, /参赛资格确认已关闭/);
  const reopenedRaw = JSON.parse(db.row.data); reopenedRaw.event.gates.qualification = true; db.row.data = JSON.stringify(reopenedRaw);
  const cannotReturnToCodeQueue = await call(worker, db, `/api/ops/teams/${first.data.team.id}/status`, { method: "PUT", staff, body: { status: "ready_code" } });
  assert.equal(cannotReturnToCodeQueue.response.status, 409);
  const afterFirst = await call(worker, db, "/api/state", { client: "single-code-a" });
  assert.equal(afterFirst.data.currentTeam.gamePortalCode, "PORTAL-001");
  const issuedSecond = await call(worker, db, `/api/ops/teams/${second.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  assert.equal(issuedSecond.response.status, 200);
  const secondPortalView = await call(worker, db, "/api/state", { client: "single-code-b" });
  assert.equal(secondPortalView.data.currentTeam.gamePortalCode, "PORTAL-002");
  const staffState = await call(worker, db, "/api/ops/state", { staff });
  assert.deepEqual(staffState.data.codeSummary, { gamePortal: { total: 2, available: 0, issued: 2 } });
});

test("legacy Workshop Code inventory is removed while the shared Workshop URL migrates once", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const registered = await call(worker, db, "/api/participants", { method: "POST", client: "legacy-workshop-code", body: { nickname: "旧资源迁移", supportProfile: {} } });
  const raw = JSON.parse(db.row.data);
  delete raw.event.workshopAccessVersion; raw.event.workshopUrl = "https://old.example/workshop";
  raw.workshopCodes = [{ id: "legacy-workshop", code: "REMOVED", status: "assigned", teamId: registered.data.team.id }];
  raw.teams[0].workshopCodeId = "legacy-workshop"; raw.teams[0].status = "ta_qualified"; raw.teams[0].qualificationStatus = "ta_qualified"; raw.teams[0].codeIssuedAt = new Date().toISOString();
  db.row.data = JSON.stringify(raw);

  const migrated = await call(worker, db, "/api/state", { client: "legacy-workshop-code" });
  assert.equal(migrated.data.event.workshopUrl, "https://catalog.us-east-1.prod.workshops.aws/join?access-code=f858-0a0594-2f");
  assert.equal(migrated.data.currentTeam.status, "ready_code");
  assert.equal(migrated.data.currentTeam.qualificationStatus, "not_qualified");
  assert.equal("workshopCodeId" in migrated.data.currentTeam, false);
  await call(worker, db, "/api/feedback", { method: "POST", client: "legacy-workshop-code", body: { note: "persist migration" } });
  const persisted = JSON.parse(db.row.data);
  assert.equal("workshopCodes" in persisted, false);
  assert.equal("workshopCodeId" in persisted.teams[0], false);
});

test("staff can group people, issue an official code, and a rebound browser restores it", async () => {
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
  const imported = await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["OFFICIAL-001", "OFFICIAL-002"]) });
  assert.equal(imported.response.status, 200);
  const workshopLink = await call(worker, db, "/api/ops/event-links", { method: "PUT", staff, admin, body: { workshopUrl: "https://workshop.example/entry", gamePortalUrl: "https://agentic-football.aws.dev/" } });
  assert.equal(workshopLink.response.status, 200);
  const issued = await call(worker, db, `/api/ops/teams/${teamId}/issue-code`, { method: "POST", staff, body: {} });
  assert.equal(issued.response.status, 200);
  const originalView = await call(worker, db, "/api/state", { client: "phone-a" });
  assert.equal(originalView.data.currentTeam.gamePortalCode, "PORTAL-OFFICIAL-001");
  assert.equal("workshopCode" in originalView.data.currentTeam, false);
  assert.equal(originalView.data.event.workshopUrl, "https://workshop.example/entry");
  const third = await call(worker, db, "/api/participants", { method: "POST", client: "phone-c", body: { nickname: "小西", supportProfile: {} } });
  const secondGroup = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [third.data.participant.id] } });
  await call(worker, db, `/api/ops/teams/${secondGroup.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const secondView = await call(worker, db, "/api/state", { client: "phone-c" });
  assert.equal(secondView.data.currentTeam.gamePortalCode, "PORTAL-OFFICIAL-002");
  const staffState = await call(worker, db, "/api/ops/state", { staff });
  assert.deepEqual(staffState.data.codeSummary, { gamePortal: { total: 2, available: 0, issued: 2 } });
  await call(worker, db, "/api/participants/rebind", { method: "POST", client: "new-phone", body: { nickname: "阿北" } });
  const reboundView = await call(worker, db, "/api/state", { client: "new-phone" });
  assert.equal(reboundView.data.currentTeam.gamePortalCode, "PORTAL-OFFICIAL-001");
});

test("Staff assigns teams, while staff search accepts bare participant numbers", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const first = await call(worker, db, "/api/participants", { method: "POST", client: "phone-one", body: { nickname: "自组甲", supportProfile: {} } });
  const second = await call(worker, db, "/api/participants", { method: "POST", client: "phone-two", body: { nickname: "自组乙", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "TA 搜索" } });
  const created = await call(worker, db, "/api/ops/teams", { method: "POST", staff: login.data.staffSession, body: { memberIds: [first.data.participant.id, second.data.participant.id] } });
  assert.equal(created.response.status, 200); assert.equal(created.data.team.teamNumber, "T-001");
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
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["DISPATCH-001", "DISPATCH-002"]) });
  await call(worker, db, `/api/ops/teams/${northTeam.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  await call(worker, db, `/api/ops/teams/${westTeam.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
  const added = await call(worker, db, "/api/ops/assignments", { method: "POST", staff, body: { participantIds: [south.data.participant.id], targetTeamId: northTeam.data.team.id } });
  assert.equal(added.response.status, 200);
  const southView = await call(worker, db, "/api/state", { client: "south-phone" }); assert.equal(southView.data.currentTeam.gamePortalCode, "PORTAL-DISPATCH-001");
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
  assert.equal(state.data.codeSummary.gamePortal.available, 1);
});

test("participant QR endpoint renders the current participant's P-number", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  await call(worker, db, "/api/participants", { method: "POST", client: "qr-phone", body: { nickname: "二维码体验员", supportProfile: {} } });
  const response = await worker.fetch(new Request("http://localhost/api/participant/qr", { headers: { "x-client-id": "qr-phone" } }), { ...TEST_ENV, DB: db, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /image\/svg\+xml/); assert.match(await response.text(), /svg/);
});

test("staff can merge confirmed teams and run a frozen group-to-knockout tournament", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const people = [];
  for (let index = 0; index < 8; index += 1) people.push(await call(worker, db, "/api/participants", { method: "POST", client: `match-phone-${index}`, body: { nickname: `参赛${index}`, supportProfile: {} } }));
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "赛事 TA" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const created = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [people[0].data.participant.id, people[1].data.participant.id] } });
  const edited = await call(worker, db, `/api/ops/teams/${created.data.team.id}/members`, { method: "PUT", staff, body: { memberIds: [people[0].data.participant.id, people[1].data.participant.id] } });
  assert.equal(edited.data.team.memberIds.length, 2);
  const teams = [created.data.team];
  for (const person of people.slice(2)) teams.push((await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } })).data.team);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(teams.map((_, index) => `C${index + 1}`)) });
  for (const item of teams) { await call(worker, db, `/api/ops/teams/${item.id}/issue-code`, { method: "POST", staff, body: {} }); await call(worker, db, `/api/ops/qualification/teams/${item.id}/confirm`, { method: "POST", staff, body: {} }); }
  const frozen = await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((item) => item.id) } });
  assert.equal(frozen.response.status, 200);
  const generated = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 2, qualifiersPerGroup: 1 } });
  assert.equal(generated.response.status, 200); assert.equal(generated.data.tournament.groups.length, 2);
  const firstGroupTeam = generated.data.tournament.groups[0].teamIds[0]; const secondGroupTeam = generated.data.tournament.groups[1].teamIds[0];
  const swapped = await call(worker, db, "/api/ops/competition/swap", { method: "POST", staff, admin, body: { firstTeamId: firstGroupTeam, secondTeamId: secondGroupTeam } });
  assert.equal(swapped.response.status, 200); assert.ok(swapped.data.tournament.groups[0].teamIds.includes(secondGroupTeam));
  const display = await call(worker, db, "/api/display"); assert.equal(display.response.status, 200); assert.equal(display.data.tournament.groups.length, 2);
  const future = swapped.data.tournament.matches.find((match) => match.round > 1);
  const early = await call(worker, db, `/api/ops/matches/${future.id}/result`, { method: "POST", staff, body: { scoreA: 2, scoreB: 1 } });
  assert.equal(early.response.status, 409); assert.match(early.data.error, /尚未开放/);
  await completeGroupRounds(worker, db, staff, admin, swapped.data.tournament, () => [2, 1]);
  const rejectedSwap = await call(worker, db, "/api/ops/competition/swap", { method: "POST", staff, admin, body: { firstTeamId: secondGroupTeam, secondTeamId: firstGroupTeam } });
  assert.equal(rejectedSwap.response.status, 409);
  const knockout = await call(worker, db, "/api/ops/competition/knockout", { method: "POST", staff, admin, body: {} });
  assert.equal(knockout.response.status, 200); assert.equal(knockout.data.tournament.knockoutMatches.filter((match) => match.round === 1).length, 2);
  const lockedGroupResult = await call(worker, db, `/api/ops/matches/${swapped.data.tournament.matches[0].id}/result`, { method: "POST", staff, body: { scoreA: 0, scoreB: 3 } });
  assert.equal(lockedGroupResult.response.status, 409);
  assert.match(lockedGroupResult.data.error, /小组赛赛果已锁定/);
});

test("group standings calculate goal difference and keep T-numbers in every fixture", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const people = [];
  for (let index = 0; index < 4; index += 1) people.push(await call(worker, db, "/api/participants", { method: "POST", client: `goal-phone-${index}`, body: { nickname: `净胜球${index}`, supportProfile: {} } }));
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "积分 TA" } });
  const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const teams = [];
  for (const person of people) teams.push((await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } })).data.team);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["GD-1", "GD-2", "GD-3", "GD-4"]) });
  for (const item of teams) {
    await call(worker, db, `/api/ops/teams/${item.id}/issue-code`, { method: "POST", staff, body: {} });
    await call(worker, db, `/api/ops/qualification/teams/${item.id}/confirm`, { method: "POST", staff, body: {} });
  }
  await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((item) => item.id) } });
  const generated = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 1, qualifiersPerGroup: 1 } });
  assert.equal(generated.response.status, 200); assert.equal(generated.data.tournament.matches.length, 6);
  assert.ok(generated.data.tournament.matches.every((match) => /^T-\d{3}$/.test(match.teamALabel) && /^T-\d{3}$/.test(match.teamBLabel)));
  const result = await completeGroupRounds(worker, db, staff, admin, generated.data.tournament, (_index, match) => match.teamALabel < match.teamBLabel ? [3, 1] : [1, 3]);
  const rows = result.data.tournament.groups[0].standings;
  assert.deepEqual(rows.map((row) => row.points), [9, 6, 3, 0]);
  assert.deepEqual(rows.map((row) => row.goalDifference), [6, 2, -2, -6]);
  const display = await call(worker, db, "/api/display");
  assert.deepEqual(display.data.tournament.groups[0].standings.map((row) => row.label), rows.map((row) => row.label));
});

test("round-robin scheduling gives every team at most one group match per round", async () => {
  const worker = await eventWorker(); const db = new MemoryD1(); const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "赛程 TA" } });
  const staff = login.data.staffSession; const admin = await elevate(worker, db, staff); const teams = [];
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(Array.from({ length: 30 }, (_, index) => `ROUND-${index + 1}`)) });
  for (let index = 1; index <= 30; index += 1) {
    const person = await call(worker, db, "/api/participants", { method: "POST", client: `round-phone-${index}`, body: { nickname: `轮次队${index}`, supportProfile: {} } });
    const team = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } });
    teams.push(team.data.team);
    await call(worker, db, `/api/ops/teams/${team.data.team.id}/issue-code`, { method: "POST", staff, body: {} });
    await call(worker, db, `/api/ops/qualification/teams/${team.data.team.id}/confirm`, { method: "POST", staff, body: {} });
  }
  await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((team) => team.id) } });
  const generated = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 8, qualifiersPerGroup: 2 } });
  assert.equal(generated.response.status, 200);
  const tournament = generated.data.tournament;
  assert.deepEqual(tournament.groups.map((group) => group.teamIds.length), [4, 4, 4, 4, 4, 4, 3, 3]);
  assert.equal(tournament.matches.length, 42);
  assert.deepEqual(tournament.matches.map((match) => match.round), [...tournament.matches.map((match) => match.round)].sort((first, second) => first - second));
  assert.deepEqual([1, 2, 3].map((round) => tournament.matches.filter((match) => match.round === round).length), [14, 14, 14]);
  for (const group of tournament.groups) {
    const groupMatches = tournament.matches.filter((match) => match.groupId === group.id);
    // Odd groups use a rotating bye, so three teams need three rounds rather
    // than two; every team still faces every other team exactly once.
    const expectedRounds = group.teamIds.length % 2 === 0 ? group.teamIds.length - 1 : group.teamIds.length;
    assert.deepEqual([...new Set(groupMatches.map((match) => match.round))], Array.from({ length: expectedRounds }, (_, index) => index + 1));
    assert.equal(groupMatches.length, group.teamIds.length * (group.teamIds.length - 1) / 2);
    for (let round = 1; round <= expectedRounds; round += 1) {
      const matches = groupMatches.filter((match) => match.round === round);
      const seen = matches.flatMap((match) => [match.teamAId, match.teamBId]);
      assert.equal(new Set(seen).size, seen.length, `${group.id} 组第 ${round} 轮不应有重复队伍`);
    }
  }
  const editedGroups = tournament.groups.map((group) => ({ id: group.id, teamIds: [...group.teamIds] }));
  [editedGroups[0].teamIds[0], editedGroups[1].teamIds[0]] = [editedGroups[1].teamIds[0], editedGroups[0].teamIds[0]];
  const edited = await call(worker, db, "/api/ops/competition/groups", { method: "PUT", staff, admin, body: { groups: editedGroups } });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.data.tournament.groups[0].teamIds[0], editedGroups[0].teamIds[0]);
  const invalidGroups = editedGroups.map((group) => ({ id: group.id, teamIds: [...group.teamIds] }));
  invalidGroups[0].teamIds.push(invalidGroups[1].teamIds[0]);
  const rejected = await call(worker, db, "/api/ops/competition/groups", { method: "PUT", staff, admin, body: { groups: invalidGroups } });
  assert.equal(rejected.response.status, 409);
  assert.match(rejected.data.error, /2–4/);
});

test("knockout creates and exposes each next round only after Admin advances it", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "淘汰赛修复 TA" } }); const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(Array.from({ length: 16 }, (_, index) => `KO-${index + 1}`)) });
  const teams = [];
  for (let index = 1; index <= 16; index += 1) {
    const person = await call(worker, db, "/api/participants", { method: "POST", client: `knockout-${index}`, body: { nickname: `淘汰修复${index}`, supportProfile: {} } });
    const team = await call(worker, db, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.data.participant.id] } }); teams.push(team.data.team);
    await call(worker, db, `/api/ops/teams/${team.data.team.id}/issue-code`, { method: "POST", staff, body: {} }); await call(worker, db, `/api/ops/qualification/teams/${team.data.team.id}/confirm`, { method: "POST", staff, body: {} });
  }
  await call(worker, db, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((team) => team.id) } });
  const grouped = await call(worker, db, "/api/ops/competition/generate", { method: "POST", staff, admin, body: {} });
  await completeGroupRounds(worker, db, staff, admin, grouped.data.tournament, () => [1, 0]);
  const knockout = await call(worker, db, "/api/ops/competition/knockout", { method: "POST", staff, admin, body: {} });
  const firstRound = knockout.data.tournament.knockoutMatches.filter((match) => match.round === 1);
  assert.equal(firstRound.length, 4);
  assert.equal(knockout.data.tournament.knockoutMatches.length, 4);
  assert.equal(knockout.data.tournament.currentKnockoutRound, 1);
  assert.equal(knockout.data.tournament.totalKnockoutRounds, 3);

  const tooEarly = await call(worker, db, "/api/ops/competition/advance-knockout-round", { method: "POST", staff, admin, body: {} });
  assert.equal(tooEarly.response.status, 409);
  assert.match(tooEarly.data.error, /仍有未完成比赛/);
  await call(worker, db, `/api/ops/matches/${firstRound[0].id}/result`, { method: "POST", staff, body: { scoreA: 2, scoreB: 0 } });
  const oneWinner = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(oneWinner.data.tournament.knockoutMatches.filter((match) => match.round === 2).length, 0);
  for (const match of firstRound.slice(1)) await call(worker, db, `/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA: 2, scoreB: 0 } });
  const completedRound = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(completedRound.data.tournament.knockoutMatches.filter((match) => match.round === 2).length, 0);

  const denied = await call(worker, db, "/api/ops/competition/advance-knockout-round", { method: "POST", staff, body: {} });
  assert.equal(denied.response.status, 403);
  const second = await call(worker, db, "/api/ops/competition/advance-knockout-round", { method: "POST", staff, admin, body: {} });
  const secondRound = second.data.tournament.knockoutMatches.filter((match) => match.round === 2);
  assert.equal(second.response.status, 200);
  assert.equal(second.data.tournament.currentKnockoutRound, 2);
  assert.equal(secondRound.length, 2);
  assert.equal(secondRound.every((match) => match.status === "ready"), true);
  const lockedPriorRound = await call(worker, db, `/api/ops/matches/${firstRound[0].id}/result`, { method: "POST", staff, body: { scoreA: 0, scoreB: 3 } });
  assert.equal(lockedPriorRound.response.status, 409);
  assert.match(lockedPriorRound.data.error, /轮次已锁定/);
  for (const match of secondRound) await call(worker, db, `/api/ops/matches/${match.id}/result`, { method: "POST", staff, body: { scoreA: 3, scoreB: 1 } });
  const beforeFinal = await call(worker, db, "/api/ops/state", { staff });
  assert.equal(beforeFinal.data.tournament.knockoutMatches.filter((match) => match.round === 3).length, 0);

  const finalRoundResponse = await call(worker, db, "/api/ops/competition/advance-knockout-round", { method: "POST", staff, admin, body: {} });
  const finalRound = finalRoundResponse.data.tournament.knockoutMatches.filter((match) => match.round === 3);
  assert.equal(finalRoundResponse.response.status, 200);
  assert.equal(finalRoundResponse.data.tournament.currentKnockoutRound, 3);
  assert.equal(finalRound.length, 1);
  assert.equal(finalRound[0].status, "ready");
});

test("Admin archive reset requires the event name, preserves only the current sessions and archives all business data", async () => {
  const worker = await eventWorker(); const db = new MemoryD1();
  const participant = await call(worker, db, "/api/participants", { method: "POST", client: "archive-phone", body: { nickname: "归档参与者", supportProfile: {} } });
  const login = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "归档管理员" } });
  const staff = login.data.staffSession; const admin = await elevate(worker, db, staff);
  const otherLogin = await call(worker, db, "/api/ops/session", { method: "POST", body: { staffPin: "test-staff", staffNickname: "旧工作人员" } });
  const otherStaff = otherLogin.data.staffSession; const otherAdmin = await elevate(worker, db, otherStaff);
  await call(worker, db, "/api/ops/codes/import", { method: "POST", staff, admin, body: resourceCodes(["ARCHIVE-1"]) });

  const denied = await call(worker, db, "/api/admin/event/archive-reset", { method: "POST", staff, body: { confirmation: "Agentic Football 现场运营台" } });
  assert.equal(denied.response.status, 403);
  const mismatch = await call(worker, db, "/api/admin/event/archive-reset", { method: "POST", staff, admin, body: { confirmation: "错误名称" } });
  assert.equal(mismatch.response.status, 409);
  assert.match(mismatch.data.error, /请输入完整活动名称/);
  const unchanged = await call(worker, db, "/api/ops/state", { staff });
  assert.ok(unchanged.data.participants.some((item) => item.id === participant.data.participant.id));

  const reset = await call(worker, db, "/api/admin/event/archive-reset", { method: "POST", staff, admin, body: { confirmation: "Agentic Football 现场运营台" } });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.data.archive.counts.participants, 1);
  assert.equal("workshopCodes" in reset.data.archive.counts, false);
  assert.deepEqual(reset.data.codeSummary.gamePortal, { total: 0, available: 0, issued: 0 });

  const after = await call(worker, db, "/api/admin/state", { staff, admin });
  assert.equal(after.response.status, 200);
  const revokedStaff = await call(worker, db, "/api/ops/state", { staff: otherStaff });
  const revokedAdmin = await call(worker, db, "/api/admin/state", { staff: otherStaff, admin: otherAdmin });
  assert.equal(revokedStaff.response.status, 403);
  assert.equal(revokedAdmin.response.status, 403);
  assert.equal(after.data.participants.length, 0);
  assert.equal(after.data.teams.length, 0);
  assert.equal(after.data.archives.length, 1);
  assert.equal(after.data.event.name, "Agentic Football 现场运营台");
  const raw = JSON.parse(db.row.data);
  assert.equal(raw.archives.length, 1);
  assert.equal(raw.archives[0].snapshot.participants[0].nickname, "归档参与者");
  assert.equal("workshopCodes" in raw.archives[0].snapshot, false);
  assert.equal(raw.archives[0].snapshot.gamePortalCodes[0].code, "PORTAL-ARCHIVE-1");
  assert.ok(raw.auditLog.some((item) => item.action === "event.archived_reset"));
});
