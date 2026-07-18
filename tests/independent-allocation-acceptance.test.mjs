import assert from "node:assert/strict";
import test from "node:test";

// This file is intentionally independent from the implementation test suite.
// It exercises the built Worker through its HTTP surface and uses new data for
// every scenario described in workshop-team-allocation-acceptance-v1.md.
const root = new URL("../", import.meta.url);
const ENV = { STAFF_PINS: JSON.stringify([{ id: "acceptance-staff", pin: "acceptance-staff", enabled: true }]), ADMIN_PIN: "acceptance-admin" };

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

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("acceptance", `${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}
async function call(w, db, path, { method = "GET", client = "", staff = "", body } = {}) {
  const headers = new Headers();
  if (client) headers.set("x-client-id", client);
  if (staff) headers.set("x-staff-session", staff);
  if (body) headers.set("content-type", "application/json");
  const response = await w.fetch(new Request(`http://acceptance.local${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), { ...ENV, DB: db, ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } });
  return { response, data: await response.json() };
}
async function fixture() {
  const w = await worker(); const db = new MemoryD1();
  const login = await call(w, db, "/api/ops/session", { method: "POST", body: { staffPin: "acceptance-staff", staffNickname: "独立验收 Staff" } });
  assert.equal(login.response.status, 200);
  return { w, db, staff: login.data.staffSession };
}
async function person(f, label, n) {
  const result = await call(f.w, f.db, "/api/participants", { method: "POST", client: `acceptance-${label}-${n}`, body: { nickname: `${label}-${n}`, supportProfile: {} } });
  assert.equal(result.response.status, 200, `register ${label}-${n}`);
  return result.data.participant;
}
// Mutations are intentionally serialized: the real Worker uses optimistic D1
// state versions, so concurrent HTTP writes model a conflict rather than a
// batch-registration operation.
async function people(f, label, count) { const result = []; for (let i = 1; i <= count; i += 1) result.push(await person(f, label, i)); return result; }
async function manual(f, members) {
  const result = await call(f.w, f.db, "/api/ops/teams", { method: "POST", staff: f.staff, body: { memberIds: members.map((p) => p.id) } });
  assert.equal(result.response.status, 200);
  return result.data.team;
}
async function preview(f, seed) {
  const result = await call(f.w, f.db, "/api/ops/allocation/preview", { method: "POST", staff: f.staff, body: { allocationSeed: seed } });
  assert.equal(result.response.status, 200, result.data.error);
  return result.data.allocationRun;
}
async function publish(f, run) {
  const result = await call(f.w, f.db, `/api/ops/allocation/${run.id}/publish`, { method: "POST", staff: f.staff, body: {} });
  assert.equal(result.response.status, 200, result.data.error);
  return result.data.allocationRun;
}
async function state(f) { return (await call(f.w, f.db, "/api/ops/state", { staff: f.staff })).data; }
const active = (teams) => teams.filter((team) => team.status !== "dissolved");
const allocations = (run) => ({ manual: run.result.teams.filter((t) => t.type === "manual"), auto: run.result.teams.filter((t) => t.type === "auto") });

test("AC-01 自由登记不会自动生成单人正式队", async () => {
  const f = await fixture(); const p = await person(f, "AC01", 1);
  const s = await state(f);
  assert.equal(p.teamId, null); assert.equal(p.allocationSource, "free");
  assert.equal(s.teams.length, 0); assert.deepEqual(s.allocation.freePeople.map((x) => x.id), [p.id]);
});

test("AC-02 人工核心在自动分配后保留", async () => {
  const f = await fixture(); const [a, b] = await people(f, "AC02-core", 2); const team = await manual(f, [a, b]); await people(f, "AC02-free", 31);
  const run = await preview(f, "ac02-seed"); const planned = allocations(run).manual.find((t) => t.id === team.id);
  assert.deepEqual(planned.coreMemberIds.sort(), [a.id, b.id].sort()); assert.ok(planned.memberIds.includes(a.id) && planned.memberIds.includes(b.id));
  await publish(f, run); const published = (await state(f)).teams.find((t) => t.id === team.id);
  assert.deepEqual(published.coreMemberIds.sort(), [a.id, b.id].sort()); assert.ok(published.memberIds.includes(a.id) && published.memberIds.includes(b.id));
});

test("AC-03 17 支人工队时优先补足 32 槽", async () => {
  const f = await fixture();
  for (const p of await people(f, "AC03-core", 17)) await manual(f, [p]);
  await people(f, "AC03-free", 20); const run = await preview(f, "ac03-seed"); const { manual: m, auto } = allocations(run);
  assert.equal(m.length, 17); assert.equal(auto.length, 15); assert.deepEqual(auto.reduce((count, t) => { count[t.memberIds.length] = (count[t.memberIds.length] || 0) + 1; return count; }, {}), { 1: 10, 2: 5 });
  assert.ok(m.every((t) => t.memberIds.length === 1 && t.allocatedMemberIds.length === 0));
});

test("AC-04 自动队先填满，再补人工队", async () => {
  const f = await fixture();
  for (let i = 0; i < 30; i += 1) await manual(f, await people(f, `AC04-core-${i}`, 2));
  await people(f, "AC04-free", 10); const run = await preview(f, "ac04-seed"); const { manual: m, auto } = allocations(run);
  assert.equal(auto.length, 2); assert.ok(auto.every((t) => t.memberIds.length === 3));
  assert.equal(m.filter((t) => t.memberIds.length === 3 && t.allocatedMemberIds.length === 1).length, 4);
  assert.equal(m.filter((t) => t.memberIds.length === 2).length, 26);
});

test("AC-05 自动队满员后人工队最终补位", async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i += 1) await manual(f, await people(f, `AC05-core-${i}`, 2));
  await people(f, "AC05-free", 70); const run = await preview(f, "ac05-seed"); const { manual: m, auto } = allocations(run);
  assert.equal(run.result.teams.length, 32); assert.equal(auto.length, 22); assert.ok(auto.every((t) => t.memberIds.length === 3));
  assert.equal(m.filter((t) => t.memberIds.length === 3).length, 4); assert.equal(run.result.waitlist.length, 0);
});

test("AC-06 低人数只建议协商，不会自动拆队", async () => {
  const f = await fixture(); const manualTeams = [];
  for (let i = 0; i < 10; i += 1) manualTeams.push(await manual(f, await people(f, `AC06-core-${i}`, 2)));
  const run = await preview(f, "ac06-seed"); const s = await state(f);
  assert.equal(run.result.teams.length, 10); assert.equal(run.lowAttendanceSuggestions.length, 10); assert.ok(run.lowAttendanceSuggestions.every((x) => x.releasableWorkshopSlots === 1));
  assert.equal(s.allocation.manualSplitAudits.length, 0); assert.ok(manualTeams.every((t) => s.teams.find((x) => x.id === t.id).memberIds.length === 2));
});

test("AC-07 明确拆队产生审计，其他人工队不变", async () => {
  const f = await fixture(); const teams = [];
  for (let i = 0; i < 10; i += 1) teams.push(await manual(f, await people(f, `AC07-core-${i}`, 2)));
  const original = teams[0]; const untouched = teams[1]; await preview(f, "ac07-before");
  const split = await call(f.w, f.db, `/api/ops/teams/${original.id}/split`, { method: "POST", staff: f.staff, body: { groups: original.memberIds.map((id) => [id]), confirmationNote: "成员已现场确认拆队" } });
  assert.equal(split.response.status, 200); assert.equal(split.data.audit.originalTeamId, original.id); assert.equal(split.data.audit.resultTeams.length, 2); assert.equal(split.data.audit.confirmationNote, "成员已现场确认拆队");
  const run = await preview(f, "ac07-after"); await publish(f, run); const s = await state(f);
  assert.equal(s.teams.find((t) => t.id === untouched.id).memberIds.length, 2); assert.equal(s.allocation.manualSplitAudits.length, 1);
});

test("AC-08 非法人工队拒绝且不发布部分结果", async () => {
  const four = await fixture(); const fourPeople = await people(four, "AC08-four", 4);
  const tooLarge = await call(four.w, four.db, "/api/ops/teams", { method: "POST", staff: four.staff, body: { memberIds: fourPeople.map((p) => p.id) } });
  assert.equal(tooLarge.response.status, 400); assert.match(tooLarge.data.error, /1–3/);
  const tooMany = await fixture(); for (const p of await people(tooMany, "AC08-33", 33)) await manual(tooMany, [p]);
  const rejected = await call(tooMany.w, tooMany.db, "/api/ops/allocation/preview", { method: "POST", staff: tooMany.staff, body: { allocationSeed: "ac08-limit" } });
  assert.equal(rejected.response.status, 409); assert.match(rejected.data.error, /人工队校验/); assert.equal((await state(tooMany)).allocation.runs.length, 0);
  // Duplicate ownership cannot be created through the public editing API; seed a
  // corrupted historical record to verify the Worker rejects rather than fixes it.
  const duplicate = await fixture(); const [a, b] = await people(duplicate, "AC08-duplicate", 2); const first = await manual(duplicate, [a]);
  const raw = JSON.parse(duplicate.db.row.data); raw.teams.push({ id: "legacy-duplicate", teamNumber: "T-legacy", type: "manual", memberIds: [a.id, b.id], coreMemberIds: [a.id, b.id], allocatedMemberIds: [], status: "draft" }); duplicate.db.row.data = JSON.stringify(raw);
  const duplicateRejected = await call(duplicate.w, duplicate.db, "/api/ops/allocation/preview", { method: "POST", staff: duplicate.staff, body: { allocationSeed: "ac08-duplicate" } });
  assert.equal(duplicateRejected.response.status, 409); assert.match(duplicateRejected.data.error, /人工队校验/); assert.ok(first.id);
});

test("AC-09 96 满载、97 候补且不重排", async () => {
  const f = await fixture(); await people(f, "AC09", 97); const run = await preview(f, "ac09-seed"); await publish(f, run); const s = await state(f);
  const assigned = active(s.teams); assert.equal(assigned.length, 32); assert.ok(assigned.every((t) => t.type === "auto" && t.memberIds.length === 3));
  assert.equal(s.allocation.waitlist.length, 1); assert.equal(s.allocation.waitlist[0].allocationSource, "waitlist"); assert.equal(s.allocation.waitlist[0].waitlistReason, "CAPACITY_EXHAUSTED");
});

test("AC-10 同输入同 seed 可重放，改 seed 仍符合约束", async () => {
  const f = await fixture(); await people(f, "AC10", 40); const first = await preview(f, "ac10-same"); const second = await preview(f, "ac10-same"); const changed = await preview(f, "ac10-other");
  assert.deepEqual(first.result, second.result); assert.equal(changed.result.teams.length, 32); assert.ok(changed.result.teams.every((t) => t.memberIds.length >= 1 && t.memberIds.length <= 3));
});

test("AC-11 系统补入人工队的成员可释放且有审计", async () => {
  const f = await fixture(); const core = await people(f, "AC11-core", 2); const team = await manual(f, core); await people(f, "AC11-free", 94);
  const run = await preview(f, "ac11-seed"); await publish(f, run); const before = (await state(f)).teams.find((t) => t.id === team.id); const added = before.allocatedMemberIds[0];
  assert.ok(added); const released = await call(f.w, f.db, "/api/ops/assignments", { method: "POST", staff: f.staff, body: { participantIds: [added], targetTeamId: "", reason: "独立验收：调度系统补入成员" } });
  assert.equal(released.response.status, 200); const after = await state(f); const changed = after.teams.find((t) => t.id === team.id);
  assert.deepEqual(changed.coreMemberIds.sort(), core.map((p) => p.id).sort()); assert.ok(!changed.memberIds.includes(added)); assert.equal(after.participants.find((p) => p.id === added).allocationSource, "free"); assert.ok(after.auditLog.some((entry) => entry.action === "team.members.removed"));
});

test("AC-12 发布后新增人员不会静默重排", async () => {
  const f = await fixture(); await people(f, "AC12", 3); const first = await preview(f, "ac12-v1"); await publish(f, first); const before = active((await state(f)).teams).map((t) => ({ id: t.id, memberIds: t.memberIds }));
  const newcomer = await person(f, "AC12-new", 1); const after = await state(f);
  assert.deepEqual(active(after.teams).map((t) => ({ id: t.id, memberIds: t.memberIds })), before); assert.ok(after.allocation.freePeople.some((p) => p.id === newcomer.id)); assert.equal(after.allocation.latestPublished.id, first.id);
});

test("AC-13 显式重算保留旧 run，并用新快照发布", async () => {
  const f = await fixture(); const core = await people(f, "AC13-core", 2); const team = await manual(f, core); await people(f, "AC13-free", 2);
  const first = await preview(f, "ac13-v1"); await publish(f, first); await person(f, "AC13-new", 1);
  const second = await preview(f, "ac13-v2"); await publish(f, second); const s = await state(f);
  assert.notEqual(second.id, first.id); assert.notEqual(second.allocationSeed, first.allocationSeed); assert.notDeepEqual(second.inputSnapshot, first.inputSnapshot);
  assert.equal(s.allocation.runs.filter((r) => r.status === "published").length, 2); assert.deepEqual(s.teams.find((t) => t.id === team.id).coreMemberIds.sort(), core.map((p) => p.id).sort());
});
