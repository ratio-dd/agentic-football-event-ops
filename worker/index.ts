/* The single-document D1 adapter intentionally accepts legacy JSON during migration. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import QRCode from "qrcode";
interface Env { ASSETS: Fetcher; DB: D1Database; STAFF_PINS?: string; ADMIN_PIN?: string; }
type State = Record<string, any>;
type Staff = { id: string; nickname: string };

const EVENT_ID = "beijing-meetup-2026";
// Group count is derived from the actual qualified roster. Groups stay within
// two to four teams and always produce a power-of-two knockout field.
const MAX_TEAMS_PER_GROUP = 4;
const MIN_COMPETITION_TEAMS = 4;
const schema = "CREATE TABLE IF NOT EXISTS event_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)";

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const assetPath = url.pathname === "/display" ? "/display.html" : ["/", "/staff", "/admin"].includes(url.pathname) ? "/index.html" : "";
      const asset = assetPath ? new Request(new URL(assetPath, request.url), request) : request;
      return env.ASSETS.fetch(asset);
    }
    try {
      await env.DB.prepare(schema).run();
      const { pathname } = url;
      if (pathname === "/api/state" && request.method === "GET") return json(await publicView(env, request));
      // This is intentionally temporary for live-event verification. It is
      // read-only and can be closed immediately by an Admin from 活动设置.
      if (pathname === "/api/maintenance/snapshot" && request.method === "GET") { const snapshot = await publicMaintenanceSnapshot(env); return json(snapshot, snapshot.status || 200); }
      if (pathname === "/api/participant/qr" && request.method === "GET") return participantQr(env, request, url);
      if (pathname === "/api/display" && request.method === "GET") return json(await displayView(env));
      if (pathname === "/api/participants" && request.method === "POST") return mutation(env, request, (s) => register(s, request));
      if (pathname === "/api/participants/rebind" && request.method === "POST") return mutation(env, request, (s) => rebind(s, request));
      if (pathname === "/api/teams/self" && request.method === "POST") return mutation(env, request, (s) => createSelfTeam(s, request));
      if (pathname === "/api/teams/self/join" && request.method === "POST") return mutation(env, request, (s) => joinSelfTeam(s, request));
      if (pathname === "/api/feedback" && request.method === "POST") return mutation(env, request, (s) => submitFeedback(s, request));
      if (pathname === "/api/ops/session" && request.method === "POST") return mutation(env, request, (s) => createStaffSession(s, request, env));

      const staff = await staffFor(env, request);
      if (!staff) return json({ error: "需要工作人员 PIN" }, 403);
      if (pathname === "/api/admin/session" && request.method === "POST") return mutation(env, request, (s) => createAdminSession(s, request, staff, env));
      const admin = await adminFor(env, request);
      if (pathname === "/api/ops/state" && request.method === "GET") return json(await staffCurrentView(env));
      if (pathname === "/api/admin/state" && request.method === "GET") return admin ? json(await adminView(env)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/admin/diagnostics" && request.method === "GET") return admin ? json(await adminDiagnostics(env)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/admin/event/archive-reset" && request.method === "POST") return admin ? mutation(env, request, (s) => archiveAndResetEvent(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/event-gates" && request.method === "PUT") return admin ? mutation(env, request, (s) => updateEventGates(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/event-settings" && request.method === "PUT") return admin ? mutation(env, request, (s) => updateEventSettings(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname.startsWith("/api/ops/participants") && request.method === "GET") return json(await participantSearch(env, url.searchParams.get("q") || ""));
      if (pathname === "/api/ops/teams" && request.method === "POST") return mutation(env, request, (s) => makeTeam(s, request, staff));
      if (pathname === "/api/ops/assignments" && request.method === "POST") return mutation(env, request, (s) => dispatchPeople(s, request, staff));
      if (pathname === "/api/ops/allocation/preview" && request.method === "POST") return mutation(env, request, (s) => createAllocationPreview(s, request, staff));
      if (/^\/api\/ops\/allocation\/[^/]+\/publish$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => publishAllocation(s, allocationRunId(pathname), staff));
      if (/^\/api\/ops\/teams\/[^/]+\/split$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => splitManualTeam(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/teams\/[^/]+\/release$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => releaseManualMembers(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/teams\/[^/]+\/members$/.test(pathname) && request.method === "PUT") return mutation(env, request, (s) => updateTeam(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/teams\/[^/]+$/.test(pathname) && request.method === "DELETE") return mutation(env, request, (s) => removeTeam(s, teamId(pathname), staff));
      if (/^\/api\/ops\/teams\/[^/]+\/confirm$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => confirmTeam(s, teamId(pathname), staff));
      if (/^\/api\/ops\/teams\/[^/]+\/status$/.test(pathname) && request.method === "PUT") return mutation(env, request, (s) => updateTeamStatus(s, teamId(pathname), request, staff));
      if (pathname === "/api/ops/codes/import" && request.method === "POST") return admin ? mutation(env, request, (s) => importCodes(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/codes/batch-issue" && request.method === "POST") return admin ? mutation(env, request, (s) => batchIssueCodes(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/event-links" && request.method === "PUT") return admin ? mutation(env, request, (s) => setEventLinks(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/admin/codes/game-portal/backfill" && request.method === "POST") return admin ? mutation(env, request, (s) => backfillGamePortalCodes(s, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (/^\/api\/admin\/teams\/[^/]+\/reclaim-code$/.test(pathname) && request.method === "POST") return admin ? mutation(env, request, (s) => reclaimCode(s, teamId(pathname), admin)) : json({ error: "需要管理后台权限" }, 403);
      if (/^\/api\/ops\/teams\/[^/]+\/issue-code$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => issueCode(s, teamId(pathname), staff));
      if (/^\/api\/ops\/teams\/[^/]+\/issue-game-portal-code$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => issueGamePortalCode(s, teamId(pathname), staff));
      if (/^\/api\/ops\/workshop\/teams\/[^/]+\/note$/.test(pathname) && request.method === "PUT") return mutation(env, request, (s) => setWorkshopNote(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/qualification\/teams\/[^/]+\/confirm$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => qualify(s, teamId(pathname), staff));
      if (/^\/api\/ops\/qualification\/teams\/[^/]+\/revoke$/.test(pathname) && request.method === "POST") return admin ? mutation(env, request, (s) => revokeQualification(s, teamId(pathname), request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/freeze" && request.method === "POST") return admin ? mutation(env, request, (s) => freezeCompetition(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/unfreeze" && request.method === "POST") return admin ? mutation(env, request, (s) => unfreezeCompetition(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/generate" && request.method === "POST") return admin ? mutation(env, request, (s) => generateTournament(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/advance-group-round" && request.method === "POST") return admin ? mutation(env, request, (s) => advanceGroupRound(s, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/advance-knockout-round" && request.method === "POST") return admin ? mutation(env, request, (s) => advanceKnockoutRound(s, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/groups" && request.method === "PUT") return admin ? mutation(env, request, (s) => updateTournamentGroups(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/swap" && request.method === "POST") return admin ? mutation(env, request, (s) => swapTournamentTeams(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/knockout" && request.method === "POST") return admin ? mutation(env, request, (s) => generateKnockout(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (pathname === "/api/ops/competition/void" && request.method === "POST") return admin ? mutation(env, request, (s) => voidTournament(s, request, admin)) : json({ error: "需要管理后台权限" }, 403);
      if (/^\/api\/ops\/matches\/[^/]+\/result$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => recordResult(s, matchId(pathname), request, staff));
      return json({ error: "Not found" }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "服务暂时不可用" }, 500); }
  },
};
export default worker;

async function stateOf(db: D1Database) {
  const row = await db.prepare("SELECT data, version FROM event_state WHERE id = ?").bind(EVENT_ID).first<{ data: string; version: number }>();
  if (row) return { state: normalise(JSON.parse(row.data)), version: row.version };
  const state = initialState();
  await db.prepare("INSERT OR IGNORE INTO event_state (id, data, version, updated_at) VALUES (?, ?, 1, ?)").bind(EVENT_ID, JSON.stringify(state), now()).run();
  return stateOf(db);
}
async function mutation(env: Env, request: Request, action: (s: State) => any): Promise<Response> {
  for (let retry = 0; retry < 40; retry += 1) {
    const { state, version } = await stateOf(env.DB); const result = await action(state);
    if (result?.error) return json(result, result.status || 400);
    const write = await env.DB.prepare("UPDATE event_state SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
      .bind(JSON.stringify(state), version + 1, now(), EVENT_ID, version).run();
    if (write.meta.changes) return json({ ...result, version: version + 1 });
    await new Promise((resolve) => setTimeout(resolve, Math.min(40, 2 + retry * 2) + Math.floor(Math.random() * 8)));
  }
  return json({ error: "现场数据刚刚发生变化，请重试" }, 409);
}

function defaultGates() { return { selfServiceTeam: false, codeIssuance: true, qualification: true, scheduleEditing: true, publicMaintenanceSnapshot: true }; }
const DEMO_WORKSHOP_URL = "https://example.com/agentic-football-workshop";
const GAME_PORTAL_URL = "https://agentic-football.aws.dev/";
function initialState() { return { event: { id: EVENT_ID, name: "Agentic Football 现场运营台", maxWorkshopTeams: 32, workshopUrl: DEMO_WORKSHOP_URL, gamePortalUrl: GAME_PORTAL_URL, gates: defaultGates() }, participants: [], teams: [], allocationRuns: [], manualSplitAudits: [], workshopCodes: [], gamePortalCodes: [], competition: { frozenTeamIds: [], frozenAt: null, frozenBy: null }, staffAccounts: [], staffSessions: [], adminSessions: [], tournament: null, auditLog: [], feedback: [], archives: [] }; }
function normalise(raw: any): State {
  const base = initialState();
  const participants = Array.isArray(raw?.participants) ? raw.participants.map((p: any, index: number) => ({ id: p.id || id(), nickname: p.nickname || `参与者${index + 1}`, clientIds: p.clientIds || (p.clientId ? [p.clientId] : []), codeVisibleClientIds: p.codeVisibleClientIds || (p.clientId ? [p.clientId] : []), staffShortId: p.staffShortId || `P-${String(index + 1).padStart(3, "0")}`, supportProfile: p.supportProfile || { techBackground: p.survey?.role || "unknown", workshopExperience: "unknown" }, teamId: p.teamId || null, allocationSource: p.allocationSource || (p.teamId ? "manual" : "free"), registeredAt: p.registeredAt || p.createdAt || now(), reboundAt: p.reboundAt || null })) : [];
  const workshopCodes = Array.isArray(raw?.workshopCodes) ? raw.workshopCodes.map((c: any) => ({ id: c.id || id(), code: text(c.code, 160), status: c.status === "assigned" ? "assigned" : "available", teamId: c.teamId || null, assignedAt: c.assignedAt || null, assignedBy: c.assignedBy || null })).filter((c: any) => c.code) : [];
  const gamePortalCodes = Array.isArray(raw?.gamePortalCodes) ? raw.gamePortalCodes.map((c: any) => ({ id: c.id || id(), code: text(c.code, 160), status: c.status === "assigned" ? "assigned" : "available", teamId: c.teamId || null, assignedAt: c.assignedAt || null, assignedBy: c.assignedBy || null })).filter((c: any) => c.code) : [];
  // Historical teams predate type/core metadata. Treat them as manual rather
  // than guessing that a real on-site group may safely be rebalanced.
  const teams = Array.isArray(raw?.teams) ? raw.teams.map((t: any) => {
    const memberIds = ids(t.memberIds); const type = t.type === "auto" ? "auto" : "manual";
    const status = t.status === "dissolved" ? "dissolved" : (t.status === "draft" || !t.status ? "ready_code" : t.status);
    return { ...t, type, memberIds, coreMemberIds: type === "manual" ? ids(t.coreMemberIds?.length ? t.coreMemberIds : memberIds) : [], allocatedMemberIds: ids(t.allocatedMemberIds), status, codeIssuedAt: t.codeIssuedAt || (t.workshopCodeId ? workshopCodes.find((c: any) => c.id === t.workshopCodeId)?.assignedAt || t.createdAt || now() : null), codeIssuedBy: t.codeIssuedBy || null, workshopCodeId: t.workshopCodeId || null, gamePortalCodeId: t.gamePortalCodeId || null, dissolvedAt: t.dissolvedAt || null, dissolutionCodeAction: t.dissolutionCodeAction || null };
  }) : [];
  const allocationRuns = Array.isArray(raw?.allocationRuns) ? raw.allocationRuns : [];
  const tournament = normaliseTournament(raw?.tournament);
  const auditLog = (Array.isArray(raw?.auditLog) ? raw.auditLog : []).map((entry: any) =>
    ["staff.session.created", "admin.session.created"].includes(entry?.action)
      ? { ...entry, objectId: entry.staffAccountId || "session" }
      : entry,
  );
  return { ...base, ...raw, event: { ...base.event, ...(raw?.event || {}), gates: { ...defaultGates(), ...(raw?.event?.gates || {}) } }, participants, teams, allocationRuns, manualSplitAudits: Array.isArray(raw?.manualSplitAudits) ? raw.manualSplitAudits : [], workshopCodes, gamePortalCodes, competition: { ...base.competition, ...(raw?.competition || {}) }, staffAccounts: Array.isArray(raw?.staffAccounts) ? raw.staffAccounts : base.staffAccounts, staffSessions: Array.isArray(raw?.staffSessions) ? raw.staffSessions : [], adminSessions: Array.isArray(raw?.adminSessions) ? raw.adminSessions : [], tournament, auditLog, feedback: Array.isArray(raw?.feedback) ? raw.feedback : [], archives: Array.isArray(raw?.archives) ? raw.archives : [] };
}

function normaliseTournament(value: any) {
  if (!value) return null;
  const matches = Array.isArray(value.matches) ? value.matches : [];
  const rounds = matches.map((match: any) => Number(match.round) || 1);
  const totalGroupRounds = Math.max(1, ...rounds);
  const firstIncompleteRound = [...new Set(rounds)].sort((a, b) => a - b).find((round) => matches.some((match: any) => (Number(match.round) || 1) === round && match.status !== "completed"));
  const requestedRound = Number(value.currentGroupRound);
  const currentGroupRound = Math.max(1, Math.min(totalGroupRounds, Number.isInteger(requestedRound) && requestedRound > 0 ? requestedRound : firstIncompleteRound || totalGroupRounds));
  const knockoutMatches = Array.isArray(value.knockoutMatches) ? value.knockoutMatches : [];
  const knockoutRounds = knockoutMatches.map((match: any) => Number(match.round) || 1);
  const totalKnockoutRounds = Math.max(1, Number(value.totalKnockoutRounds) || 0, ...knockoutRounds);
  const requestedKnockoutRound = Number(value.currentKnockoutRound);
  const currentKnockoutRound = Math.max(1, Math.min(totalKnockoutRounds, Number.isInteger(requestedKnockoutRound) && requestedKnockoutRound > 0 ? requestedKnockoutRound : 1));
  return { ...value, matches, currentGroupRound, totalGroupRounds, knockoutMatches, currentKnockoutRound, totalKnockoutRounds };
}

const parsedRequestBodies = new WeakMap<Request, any>();
async function body(request: Request) {
  if (parsedRequestBodies.has(request)) return parsedRequestBodies.get(request);
  let parsed = {};
  try { parsed = await request.json<any>(); } catch { parsed = {}; }
  parsedRequestBodies.set(request, parsed);
  return parsed;
}
function client(request: Request, value?: any) { return text(request.headers.get("x-client-id") || value?.clientId, 100); }
function text(value: unknown, limit = 120) { return String(value ?? "").trim().slice(0, limit); }
function ids(value: any) { return [...new Set(Array.isArray(value) ? value.map((v) => text(v, 80)).filter(Boolean) : [])]; }
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function fail(error: string, status = 400) { return { error, status }; }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
async function participantQr(env: Env, request: Request, url: URL) { const { state } = await stateOf(env.DB); const shortId = text(url.searchParams.get("participant"), 20).toUpperCase(); const participant = state.participants.find((p: any) => p.staffShortId === shortId) || state.participants.find((p: any) => p.clientIds.includes(client(request))); if (!participant) return new Response("Not found", { status: 404 }); const svg = await QRCode.toString(participant.staffShortId, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#075b32", light: "#ffffff" } }); return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } }); }
function audit(s: State, actor: Staff | { id: string; nickname: string }, action: string, objectType: string, objectId: string, reason = "") { s.auditLog.push({ id: id(), staffAccountId: actor.id, staffNickname: actor.nickname, action, objectType, objectId, reason, at: now() }); if (s.auditLog.length > 500) s.auditLog.splice(0, s.auditLog.length - 500); }
function team(s: State, value: string) { return s.teams.find((t: any) => t.id === value); }
function frozenCompetitionTeamIds(s: State) { return new Set([...(s.competition?.frozenTeamIds || []), ...(s.tournament?.frozenTeamIds || [])]); }
function isCompetitionRosterLocked(s: State, value: string) { return frozenCompetitionTeamIds(s).has(value); }
function preventFrozenRosterMutation(s: State, teamIds: string[]) {
  const locked = teamIds.find((teamId) => isCompetitionRosterLocked(s, teamId));
  return locked ? fail("该队已在冻结参赛名单中；请先由 Admin 解除名单冻结或作废赛程", 409) : null;
}
function teamByNumber(s: State, value: string) { return s.teams.find((t: any) => t.teamNumber === normaliseTeamNumber(value)); }
function nextTeamNumber(s: State) { const highest = s.teams.reduce((max: number, t: any) => Math.max(max, Number(String(t.teamNumber || "").replace(/\D/g, "")) || 0), 0); return `T-${String(highest + 1).padStart(3, "0")}`; }
function normaliseTeamNumber(value: unknown) { const numeric = text(value, 20).toUpperCase().replace(/^T[-\s]?/, "").replace(/^0+/, "") || "0"; return `T-${numeric.padStart(3, "0")}`; }
function after(path: string, marker: string) { const parts = path.split("/"); return decodeURIComponent(parts[parts.indexOf(marker) + 1] || ""); }
function teamId(path: string) { return after(path, "teams"); }
function allocationRunId(path: string) { return after(path, "allocation"); }
function matchId(path: string) { return after(path, "matches"); }

async function register(s: State, request: Request) {
  const b = await body(request); const nickname = text(b.nickname, 24); const clientId = client(request, b);
  if (!nickname || !clientId) return fail("请填写昵称后重试");
  const existing = s.participants.find((p: any) => p.clientIds.includes(clientId)); if (existing) return { participant: publicParticipant(existing, clientId) };
  if (s.participants.some((p: any) => p.nickname === nickname)) return fail("昵称已被使用，请换一个", 409);
  const participant = { id: id(), nickname, clientIds: [clientId], codeVisibleClientIds: [clientId], staffShortId: `P-${String(s.participants.length + 1).padStart(3, "0")}`, supportProfile: { techBackground: text(b.supportProfile?.techBackground, 20) || "unknown", workshopExperience: text(b.supportProfile?.workshopExperience, 20) || "unknown" }, teamId: null, allocationSource: "manual", registeredAt: now(), reboundAt: null };
  s.participants.push(participant);
  const t = teamRecord(s, [participant.id], "manual"); s.teams.push(t); participant.teamId = t.id;
  audit(s, { id: "participant", nickname }, "participant.registered", "participant", participant.id);
  audit(s, { id: "system", nickname: "系统" }, "team.registration.created", "team", t.id, "登记后自动创建单人队");
  return { participant: publicParticipant(participant, clientId), team: teamView(s, t, clientId) };
}
async function rebind(s: State, request: Request) {
  const b = await body(request); const nickname = text(b.nickname, 24); const clientId = client(request, b); const participant = s.participants.find((p: any) => p.nickname === nickname);
  if (!participant || !clientId) return fail("未找到该昵称，请确认后重试", 404);
  if (!participant.clientIds.includes(clientId)) participant.clientIds.push(clientId);
  // Nickname recovery is intentionally a low-friction on-site fallback. A
  // returning team member should recover the same resource view immediately.
  if (!participant.codeVisibleClientIds.includes(clientId)) participant.codeVisibleClientIds.push(clientId);
  participant.reboundAt = now();
  audit(s, { id: "participant", nickname }, "participant.rebound", "participant", participant.id); return { participant: publicParticipant(participant, clientId), codeHiddenUntilStaffCheck: false };
}
function teamRecord(s: State, memberIds: string[], type: "manual" | "auto" = "manual") { return { id: id(), teamNumber: nextTeamNumber(s), type, memberIds, coreMemberIds: type === "manual" ? [...memberIds] : [], allocatedMemberIds: [], status: "ready_code", workshopStatus: "not_started", qualificationStatus: "not_qualified", workshopCodeId: null, gamePortalCodeId: null, codeIssuedAt: null, codeIssuedBy: null, createdAt: now() }; }
function participantForClient(s: State, request: Request) { return s.participants.find((p: any) => p.clientIds.includes(client(request))); }
function createSelfTeam(s: State, request: Request) { if (!s.event.gates.selfServiceTeam) return fail("当前未开放自助组队，请向工作人员出示现场编号", 409); const participant = participantForClient(s, request); if (!participant) return fail("请先完成登记", 403); if (participant.teamId) return fail("你已经在一支队伍中", 409); const t = teamRecord(s, [participant.id], "manual"); s.teams.push(t); participant.teamId = t.id; participant.allocationSource = "manual"; audit(s, { id: "participant", nickname: participant.nickname }, "team.self.created", "team", t.id); return { team: t }; }
async function joinSelfTeam(s: State, request: Request) { if (!s.event.gates.selfServiceTeam) return fail("当前未开放自助组队，请向工作人员出示现场编号", 409); const participant = participantForClient(s, request); const b = await body(request); const t = teamByNumber(s, b.teamNumber); if (!participant) return fail("请先完成登记", 403); if (participant.teamId) return fail("你已经在一支队伍中", 409); if (!t || t.type === "auto") return fail("未找到可加入的人工队伍", 404); if (teamHasIssuedCodes(t)) return fail("该队已领取资源，不能再自行加入", 409); t.memberIds.push(participant.id); t.coreMemberIds.push(participant.id); participant.teamId = t.id; participant.allocationSource = "manual"; audit(s, { id: "participant", nickname: participant.nickname }, "team.self.joined", "team", t.id); return { team: t }; }

function configuredAccounts(_s: State, env: Env) { try { const parsed = JSON.parse(env.STAFF_PINS || ""); return Array.isArray(parsed) && parsed.some((a: any) => a?.enabled !== false && text(a?.pin, 120)) ? parsed : []; } catch { return []; } }
async function createStaffSession(s: State, request: Request, env: Env) {
  const b = await body(request); const pin = text(b.staffPin, 120); const nickname = text(b.staffNickname, 24); const accounts = configuredAccounts(s, env); if (!accounts.length) return fail("此环境尚未配置 Staff PIN，无法进入工作台", 503); const account = accounts.find((a: any) => a.enabled !== false && a.pin === pin);
  if (!account || !nickname) return fail("PIN 或工作人员昵称不正确", 403);
  const session = { token: id(), staffAccountId: account.id, nickname, createdAt: now() }; s.staffSessions.push(session); audit(s, { id: account.id, nickname }, "staff.session.created", "staffSession", account.id); return { staffSession: session.token, staff: { id: account.id, nickname } };
}
async function createAdminSession(s: State, request: Request, staff: Staff, env: Env) {
  const pin = text((await body(request)).adminPin, 120);
  if (!env.ADMIN_PIN || pin !== env.ADMIN_PIN) return fail("Admin PIN 不正确", 403);
  const staffSessionToken = text(request.headers.get("x-staff-session"), 100);
  const session = { token: id(), staffSessionToken, staffAccountId: staff.id, nickname: staff.nickname, createdAt: now() };
  s.adminSessions.push(session);
  audit(s, staff, "admin.session.created", "adminSession", staff.id);
  return { adminSession: session.token, admin: { id: staff.id, nickname: staff.nickname } };
}
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
function sessionActive(session: any) { const createdAt = Date.parse(session?.createdAt || ""); return Number.isFinite(createdAt) && Date.now() - createdAt < SESSION_TTL_MS; }
async function staffFor(env: Env, request: Request): Promise<Staff | null> {
  const token = text(request.headers.get("x-staff-session"), 100); if (!token) return null;
  const { state } = await stateOf(env.DB); const session = state.staffSessions.find((x: any) => x.token === token && sessionActive(x)); return session ? { id: session.staffAccountId, nickname: session.nickname } : null;
}
async function adminFor(env: Env, request: Request): Promise<Staff | null> {
  const token = text(request.headers.get("x-admin-session"), 100); const staffToken = text(request.headers.get("x-staff-session"), 100);
  if (!token || !staffToken) return null;
  const { state } = await stateOf(env.DB); const staffSession = state.staffSessions.find((x: any) => x.token === staffToken && sessionActive(x));
  const session = state.adminSessions.find((x: any) => x.token === token && x.staffSessionToken === staffToken && sessionActive(x));
  return staffSession && session ? { id: session.staffAccountId, nickname: session.nickname } : null;
}

async function submitFeedback(s: State, request: Request) {
  const b = await body(request); const note = text(b.note, 800);
  if (!note) return fail("请留下反馈内容");
  const clientId = client(request, b); const participant = s.participants.find((p: any) => p.clientIds.includes(clientId));
  const staffToken = text(request.headers.get("x-staff-session"), 100); const staff = s.staffSessions.find((session: any) => session.token === staffToken);
  const entry = { id: id(), note, page: text(b.page, 120) || "/", actorType: staff ? "staff" : participant ? "participant" : "anonymous", actorLabel: staff?.nickname || participant?.nickname || "匿名访客", clientId: clientId || null, staffAccountId: staff?.staffAccountId || null, createdAt: now() };
  s.feedback.push(entry); if (s.feedback.length > 500) s.feedback.splice(0, s.feedback.length - 500);
  audit(s, staff ? { id: staff.staffAccountId, nickname: staff.nickname } : { id: "feedback", nickname: entry.actorLabel }, "feedback.submitted", "feedback", entry.id, entry.page);
  return { feedback: { id: entry.id, createdAt: entry.createdAt } };
}

function publicParticipant(p: any, clientId: string) { return { id: p.id, nickname: p.nickname, staffShortId: p.staffShortId, teamId: p.teamId, allocationSource: p.allocationSource || (p.teamId ? "manual" : "free"), codeVisible: p.codeVisibleClientIds.includes(clientId), registeredAt: p.registeredAt }; }
function teamHasIssuedCodes(t: any) { return Boolean(t.workshopCodeId || t.gamePortalCodeId || t.codeIssuedAt); }
function codeSummary(s: State) {
  const summarize = (codes: any[]) => ({ total: codes.length, available: codes.filter((c: any) => c.status === "available").length, issued: codes.filter((c: any) => c.status === "assigned").length });
  const workshop = summarize(s.workshopCodes); const gamePortal = summarize(s.gamePortalCodes);
  return { workshop, gamePortal, pairsAvailable: Math.min(workshop.available, gamePortal.available), pairsIssued: Math.min(workshop.issued, gamePortal.issued) };
}
function teamView(s: State, t: any, clientId = "", revealCodes = false) {
  const members = t.memberIds.map((memberId: string) => s.participants.find((p: any) => p.id === memberId)).filter(Boolean).map((p: any) => publicParticipant(p, clientId));
  const current = s.participants.find((p: any) => p.clientIds.includes(clientId)); const currentMember = current && t.memberIds.includes(current.id);
  const showCode = revealCodes || Boolean(currentMember && current.codeVisibleClientIds.includes(clientId));
  const workshopCode = s.workshopCodes.find((c: any) => c.id === t.workshopCodeId);
  const gamePortalCode = s.gamePortalCodes.find((c: any) => c.id === t.gamePortalCodeId);
  return { ...t, members, workshopCode: showCode ? workshopCode?.code || null : null, gamePortalCode: showCode ? gamePortalCode?.code || null : null, teamCode: showCode ? workshopCode?.code || null : null, resourceCodesAssigned: Boolean(t.workshopCodeId), gamePortalCodeAssigned: Boolean(t.gamePortalCodeId), teamCodeAssigned: teamHasIssuedCodes(t) };
}
async function publicView(env: Env, request: Request) { const { state } = await stateOf(env.DB); const clientId = client(request); const participant = state.participants.find((p: any) => p.clientIds.includes(clientId)); const currentTeam = participant?.teamId ? teamView(state, team(state, participant.teamId), clientId) : null; return { event: state.event, currentParticipant: participant ? publicParticipant(participant, clientId) : null, currentTeam, tournament: publicTournament(state, true) }; }
async function staffView(env: Env) { const { state } = await stateOf(env.DB); const active = state.teams.filter((t: any) => t.status !== "dissolved"); const manualTeams = active.filter((t: any) => t.type === "manual"); const automaticTeams = active.filter((t: any) => t.type === "auto"); const freePeople = state.participants.filter((p: any) => !p.teamId && p.allocationSource !== "waitlist"); const waitlist = state.participants.filter((p: any) => p.allocationSource === "waitlist"); const conflicts = allocationValidation(state).conflicts; return { event: state.event, codeSummary: codeSummary(state), competition: state.competition, participants: state.participants.map((p: any) => ({ ...p, clientIds: undefined, codeVisibleClientIds: undefined })), teams: state.teams.map((t: any) => teamView(state, t, "", true)), allocation: { resourceLimit: state.event.maxWorkshopTeams, freePeople: freePeople.map((p: any) => publicParticipant(p, "")), waitlist: waitlist.map((p: any) => ({ ...publicParticipant(p, ""), waitlistReason: p.waitlistReason || "CAPACITY_EXHAUSTED" })), manualTeams: manualTeams.map((t: any) => teamView(state, t, "", true)), automaticTeams: automaticTeams.map((t: any) => teamView(state, t, "", true)), conflicts, lowAttendanceSuggestions: lowAttendanceSuggestions(state), latestPreview: state.allocationRuns.filter((r: any) => r.status === "preview").at(-1) || null, latestPublished: state.allocationRuns.filter((r: any) => r.status === "published").at(-1) || null, runs: state.allocationRuns.slice(-20).reverse(), manualSplitAudits: state.manualSplitAudits.slice(-50).reverse() }, tournament: publicTournament(state), auditLog: state.auditLog.slice(-100).reverse() }; }
async function staffCurrentView(env: Env) { const view = await staffView(env); const { state } = await stateOf(env.DB); return { ...view, tournament: publicTournament(state, true) }; }
async function adminView(env: Env) { const staff = await staffView(env); const { state } = await stateOf(env.DB); const reclaimableTeams = state.teams.filter((team: any) => team.status === "dissolved" && teamHasIssuedCodes(team)).map((team: any) => teamView(state, team, "", true)); const gamePortalBackfillTeams = gamePortalBackfillTargets(state).map((team: any) => teamView(state, team, "", true)); const archives = state.archives.slice().reverse().map((archive: any) => ({ id: archive.id, eventName: archive.eventName, archivedAt: archive.archivedAt, archivedBy: archive.archivedBy, counts: archive.counts })); return { ...staff, feedback: state.feedback.slice(-100).reverse(), reclaimableTeams, gamePortalBackfillTeams, archives }; }
async function adminDiagnostics(env: Env) {
  const { state, version } = await stateOf(env.DB); const active = state.teams.filter((item: any) => item.status !== "dissolved");
  const inspect = (kind: "workshop" | "gamePortal", codes: any[], field: "workshopCodeId" | "gamePortalCodeId") => {
    const byId = new Map(codes.map((code: any) => [code.id, code]));
    const missing = active.filter((item: any) => !item[field]).map((item: any) => item.teamNumber);
    const invalidTeamReference = active.filter((item: any) => item[field] && (byId.get(item[field])?.status !== "assigned" || byId.get(item[field])?.teamId !== item.id)).map((item: any) => item.teamNumber);
    const orphanAssignments = codes.filter((code: any) => code.status === "assigned" && (!team(state, code.teamId || "") || team(state, code.teamId || "")?.status === "dissolved" || team(state, code.teamId || "")?.[field] !== code.id)).length;
    return { kind, total: codes.length, available: codes.filter((code: any) => code.status === "available").length, assigned: codes.filter((code: any) => code.status === "assigned").length, activeTeamsMissingCode: missing, activeTeamsWithInvalidReference: invalidTeamReference, orphanAssignments };
  };
  const workshop = inspect("workshop", state.workshopCodes, "workshopCodeId"); const gamePortal = inspect("gamePortal", state.gamePortalCodes, "gamePortalCodeId");
  const hasIssues = [...workshop.activeTeamsWithInvalidReference, ...gamePortal.activeTeamsWithInvalidReference].length > 0 || workshop.orphanAssignments > 0 || gamePortal.orphanAssignments > 0;
  return { version, generatedAt: now(), participants: state.participants.length, activeTeams: active.length, teamStatusCounts: Object.fromEntries(Object.entries(Object.groupBy(active, (item: any) => item.status)).map(([status, teams]) => [status, (teams as any[]).length])), workshop, gamePortal, tournament: state.tournament ? { status: state.tournament.status, groupCount: state.tournament.groups?.length || 0, groupMatchesCompleted: state.tournament.matches?.filter((match: any) => match.status === "completed").length || 0, groupMatchesTotal: state.tournament.matches?.length || 0 } : null, lastAuditAt: state.auditLog.at(-1)?.at || null, integrity: hasIssues ? "attention" : "ok" };
}
async function publicMaintenanceSnapshot(env: Env) {
  const { state, version } = await stateOf(env.DB);
  if (state.event?.gates?.publicMaintenanceSnapshot === false) return { error: "维护快照已关闭", status: 404 };
  const activeTeams = state.teams.filter((team: any) => team.status !== "dissolved");
  const codeRows = (codes: any[]) => codes.map((item: any) => ({
    code: item.code,
    status: item.status,
    teamNumber: item.teamId ? team(state, item.teamId)?.teamNumber || null : null,
  }));
  const teamRows = activeTeams.map((item: any) => ({
    teamNumber: item.teamNumber,
    status: item.status,
    memberCount: item.memberIds.length,
    workshopCode: item.workshopCodeId ? state.workshopCodes.find((code: any) => code.id === item.workshopCodeId)?.code || null : null,
    gamePortalCode: item.gamePortalCodeId ? state.gamePortalCodes.find((code: any) => code.id === item.gamePortalCodeId)?.code || null : null,
  }));
  return {
    temporary: true,
    generatedAt: now(),
    version,
    teams: teamRows,
    resources: {
      workshop: codeRows(state.workshopCodes),
      gamePortal: codeRows(state.gamePortalCodes),
    },
  };
}
async function displayView(env: Env) { const { state } = await stateOf(env.DB); return { event: state.event, tournament: publicTournament(state, true) }; }
async function participantSearch(env: Env, q: string) { const { state } = await stateOf(env.DB); const key = q.trim().toLowerCase(); const numberKey = key.replace(/^p[-\s]?/, "").replace(/^0+/, ""); const participants = state.participants.filter((p: any) => { const number = p.staffShortId.toLowerCase().replace(/^p-?0*/, ""); return !key || p.nickname.toLowerCase().includes(key) || p.staffShortId.toLowerCase().includes(key) || (Boolean(numberKey) && number.includes(numberKey)); }).sort((a: any, b: any) => Number(b.staffShortId.toLowerCase() === key) - Number(a.staffShortId.toLowerCase() === key) || Number(b.staffShortId.toLowerCase().replace(/^p-?0*/, "") === numberKey) - Number(a.staffShortId.toLowerCase().replace(/^p-?0*/, "") === numberKey)).slice(0, 8).map((p: any) => ({ id: p.id, nickname: p.nickname, staffShortId: p.staffShortId, teamId: p.teamId, supportProfile: p.supportProfile })); return { participants }; }
function publicTournament(s: State, currentGroupRoundOnly = false) {
  if (!s.tournament) return null;
  // A team keeps its event-wide identity through the whole tournament. Group
  // letters describe a group, not a replacement name for the team.
  const label = (teamId: string | null) => teamId ? team(s, teamId)?.teamNumber || "待定" : "待定";
  const tournament = s.tournament;
  return {
    ...tournament,
    groups: tournament.groups.map((group: any) => ({
      ...group,
      standings: standings(s, tournament, group).map((row: any) => ({ ...row, label: label(row.teamId) })),
    })),
    matches: tournament.matches.filter((m: any) => !currentGroupRoundOnly || (Number(m.round) || 1) === tournament.currentGroupRound).map((m: any) => ({ ...m, teamALabel: label(m.teamAId), teamBLabel: label(m.teamBId) })),
    knockoutMatches: (tournament.knockoutMatches || []).filter((m: any) => !currentGroupRoundOnly || (Number(m.round) || 1) === (Number(tournament.currentKnockoutRound) || 1)).map((m: any) => ({ ...m, teamALabel: label(m.teamAId), teamBLabel: label(m.teamBId), winnerLabel: label(m.winnerId) })),
  };
}
function groupFixtures(groups: any[]) {
  const matches: any[] = [];
  groups.forEach((group) => {
    // Circle-method round robin: each group member appears at most once per
    // round. Odd-sized groups receive a rotating bye by pairing with `null`.
    const rotation = [...group.teamIds];
    if (rotation.length % 2 === 1) rotation.push(null);
    for (let round = 1; round < rotation.length; round += 1) {
      for (let index = 0; index < rotation.length / 2; index += 1) {
        const teamAId = rotation[index], teamBId = rotation[rotation.length - 1 - index];
        if (teamAId && teamBId) matches.push({ id: id(), stage: "group", groupId: group.id, round, teamAId, teamBId, status: "ready", scoreA: null, scoreB: null, winnerId: null });
      }
      rotation.splice(1, 0, rotation.pop());
    }
  });
  // Consumers render one event-wide timeline, so keep all group-round one
  // fixtures together before moving to the next round.
  return matches.sort((first, second) => first.round - second.round || first.groupId.localeCompare(second.groupId));
}

function nextPowerOfTwo(value: number) { let result = 1; while (result < value) result *= 2; return result; }
function groupLabel(index: number) { let value = index + 1, label = ""; while (value > 0) { value -= 1; label = String.fromCharCode(65 + (value % 26)) + label; value = Math.floor(value / 26); } return label; }
function groupRoundSummary(tournament: any) {
  const current = Number(tournament.currentGroupRound) || 1;
  const matches = tournament.matches.filter((match: any) => (Number(match.round) || 1) === current);
  return { current, total: Number(tournament.totalGroupRounds) || Math.max(1, ...tournament.matches.map((match: any) => Number(match.round) || 1)), matches, complete: matches.length > 0 && matches.every((match: any) => match.status === "completed") };
}

async function makeTeam(s: State, request: Request, actor: Staff) {
  const b = await body(request); const memberIds = ids(b.memberIds); if (memberIds.length < 1) return fail("队伍至少需要 1 人");
  const members = memberIds.map((memberId) => s.participants.find((p: any) => p.id === memberId)); if (members.some((p) => !p)) return fail("成员不存在", 404);
  const sourceTeams = [...new Set(members.map((p: any) => p.teamId).filter(Boolean))].map((sourceId) => team(s, sourceId)).filter(Boolean);
  const frozen = preventFrozenRosterMutation(s, sourceTeams.map((source: any) => source.id)); if (frozen) return frozen;
  if (sourceTeams.some((source: any) => teamHasIssuedCodes(source))) return fail("已领取资源的队伍请通过调度面板处理成员变更", 409);
  const retained = sourceTeams.find((source: any) => source.status !== "dissolved" && !teamHasIssuedCodes(source)) || null;
  const t = retained || teamRecord(s, []);
  const finalMemberIds = [...new Set([...t.memberIds, ...memberIds])];
  if (!retained) s.teams.push(t);
  sourceTeams.filter((source: any) => source.id !== t.id).forEach((source: any) => { source.memberIds = source.memberIds.filter((memberId: string) => !memberIds.includes(memberId)); });
  sourceTeams.filter((source: any) => source.id !== t.id && source.type === "manual").forEach((source: any) => { source.coreMemberIds = source.coreMemberIds.filter((memberId: string) => !memberIds.includes(memberId)); source.allocatedMemberIds = source.allocatedMemberIds.filter((memberId: string) => !memberIds.includes(memberId)); });
  t.memberIds = finalMemberIds; if (t.type === "manual") { t.coreMemberIds = [...finalMemberIds]; t.allocatedMemberIds = []; } members.forEach((p: any) => { p.teamId = t.id; p.allocationSource = t.type === "manual" ? "manual" : "auto"; });
  sourceTeams.filter((source: any) => source.id !== t.id && !source.memberIds.length).forEach((source: any) => dissolveTeam(s, source, "dissolve", actor));
  audit(s, actor, retained ? "team.members.updated" : "team.created", "team", t.id); return { team: t };
}
function codeDissolutionAction(value: unknown) { return ["keep", "reclaim", "dissolve"].includes(text(value, 20)) ? text(value, 20) : ""; }
function dissolveTeam(s: State, t: any, action: string, actor: Staff) {
  if (t.status === "dissolved") return;
  const hadIssuedCodes = teamHasIssuedCodes(t);
  if (hadIssuedCodes && action === "reclaim") {
    [
      [s.workshopCodes, t.workshopCodeId],
      [s.gamePortalCodes, t.gamePortalCodeId],
    ].forEach(([codes, codeId]: any) => {
      const code = codes.find((item: any) => item.id === codeId);
      if (code) { code.status = "available"; code.teamId = null; code.assignedAt = null; code.assignedBy = null; }
    });
    t.workshopCodeId = null; t.gamePortalCodeId = null; t.codeIssuedAt = null; t.codeIssuedBy = null;
    audit(s, actor, "codes.reclaimed", "team", t.id, "队伍解散时回收两组 Code");
  }
  t.status = "dissolved"; t.dissolvedAt = now(); t.dissolutionCodeAction = action || "dissolve";
  t.workshopStatus = "not_started"; t.qualificationStatus = "not_qualified";
  audit(s, actor, "team.dissolved", "team", t.id, action === "reclaim" ? "两组 Code 已回收" : (hadIssuedCodes ? "Code 保留为已消耗" : "未发放 Code"));
}
function grantCurrentCodeVisibility(t: any, members: any[]) { if (!teamHasIssuedCodes(t)) return; members.forEach((p) => p.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); })); }
function dispatchAssignment(s: State, b: any, actor: Staff) {
  const participantIds = ids(b.participantIds); const targetValue = text(b.targetTeamId, 80); const createTarget = targetValue === "new";
  if (participantIds.length < 1) return fail("请至少选择 1 人");
  const people = participantIds.map((participantId) => s.participants.find((p: any) => p.id === participantId));
  if (people.some((p) => !p)) return fail("存在未找到的人员", 404);
  const target = createTarget ? teamRecord(s, []) : (targetValue ? team(s, targetValue) : null);
  if (targetValue && !target) return fail("目标队伍不存在", 404);
  if (target?.status === "dissolved") return fail("已解散队伍不能再加入成员", 409);
  const selectedIds = new Set(participantIds);
  const retainedTargetIds = target ? target.memberIds.filter((memberId: string) => !selectedIds.has(memberId)) : [];
  const finalTargetIds = target ? [...new Set([...retainedTargetIds, ...participantIds])] : [];

  const sourceTeams = [...new Set(people.map((p: any) => p.teamId).filter((teamId: string | null) => teamId && teamId !== target?.id))].map((sourceId) => team(s, sourceId)).filter(Boolean);
  const frozen = preventFrozenRosterMutation(s, [...sourceTeams.map((source: any) => source.id), ...(target ? [target.id] : [])]); if (frozen) return frozen;
  const actions = b.dissolutionActions && typeof b.dissolutionActions === "object" ? b.dissolutionActions : {};
  const emptySources = sourceTeams.filter((source: any) => source.memberIds.every((memberId: string) => selectedIds.has(memberId)));
  for (const source of emptySources) {
    const action = codeDissolutionAction(actions[source.id]);
    if (teamHasIssuedCodes(source) && action && action !== "keep") return fail("已发放资源的回收只能由 Admin 处理", 403);
    if (!teamHasIssuedCodes(source) && action && action !== "dissolve") return fail(`${source.teamNumber} 未关联 Code，应直接解散`, 409);
  }

  if (createTarget && target) s.teams.push(target);
  sourceTeams.forEach((source: any) => { source.memberIds = source.memberIds.filter((memberId: string) => !selectedIds.has(memberId)); if (source.type === "manual") { source.coreMemberIds = source.coreMemberIds.filter((memberId: string) => !selectedIds.has(memberId)); source.allocatedMemberIds = source.allocatedMemberIds.filter((memberId: string) => !selectedIds.has(memberId)); } });
  if (target) { target.memberIds = finalTargetIds; if (target.type === "manual") { target.coreMemberIds = [...finalTargetIds]; target.allocatedMemberIds = []; } }
  people.forEach((p: any) => { p.teamId = target?.id || null; p.allocationSource = target ? (target.type === "manual" ? "manual" : "auto") : "free"; });
  if (target) grantCurrentCodeVisibility(target, people);
  emptySources.forEach((source: any) => dissolveTeam(s, source, teamHasIssuedCodes(source) ? "keep" : "dissolve", actor));
  audit(s, actor, createTarget ? "team.created" : (target ? "team.members.dispatched" : "team.members.removed"), "team", target?.id || "unassigned", text(b.reason, 120));
  return { team: target || null, affectedTeamIds: [...sourceTeams.map((source: any) => source.id), ...(target ? [target.id] : [])] };
}
async function dispatchPeople(s: State, request: Request, actor: Staff) { return dispatchAssignment(s, await body(request), actor); }
async function updateTeam(s: State, value: string, request: Request, actor: Staff) {
  const t = team(s, value); const b = await body(request); const memberIds = ids(b.memberIds);
  if (!t || t.status === "dissolved") return fail("队伍不存在或已解散", 404);
  if (memberIds.length < 1) return fail("队伍至少需要 1 人");
  const members = memberIds.map((memberId) => s.participants.find((p: any) => p.id === memberId));
  if (members.some((p: any) => !p)) return fail("成员不存在", 404);
  const selectedIds = new Set(memberIds);
  const sourceTeams = [...new Set(members.map((p: any) => p.teamId).filter((teamId: string | null) => teamId && teamId !== t.id))].map((sourceId) => team(s, sourceId)).filter(Boolean);
  const frozen = preventFrozenRosterMutation(s, [t.id, ...sourceTeams.map((source: any) => source.id)]); if (frozen) return frozen;
  if (sourceTeams.some((source: any) => teamHasIssuedCodes(source))) return fail("已领取资源的队伍请通过调度面板处理成员变更", 409);
  s.participants.filter((p: any) => p.teamId === t.id && !selectedIds.has(p.id)).forEach((p: any) => { p.teamId = null; p.allocationSource = "free"; });
  sourceTeams.forEach((source: any) => { source.memberIds = source.memberIds.filter((memberId: string) => !selectedIds.has(memberId)); if (source.type === "manual") { source.coreMemberIds = source.coreMemberIds.filter((memberId: string) => !selectedIds.has(memberId)); source.allocatedMemberIds = source.allocatedMemberIds.filter((memberId: string) => !selectedIds.has(memberId)); } });
  members.forEach((p: any) => { p.teamId = t.id; p.allocationSource = t.type === "manual" ? "manual" : "auto"; }); t.memberIds = memberIds; if (t.type === "manual") { t.coreMemberIds = [...memberIds]; t.allocatedMemberIds = []; } grantCurrentCodeVisibility(t, members);
  sourceTeams.filter((source: any) => !source.memberIds.length).forEach((source: any) => dissolveTeam(s, source, "dissolve", actor));
  audit(s, actor, "team.members.updated", "team", t.id, text(b.reason, 120)); return { team: t };
}

const ALLOCATION_RULE_VERSION = "workshop-allocation-v1";
function activeManualTeams(s: State) { return s.teams.filter((t: any) => t.status !== "dissolved" && t.type !== "auto"); }
function allocationValidation(s: State) {
  const conflicts: any[] = []; const owners = new Map<string, string>(); const manual = activeManualTeams(s);
  if (manual.length > s.event.maxWorkshopTeams) conflicts.push({ code: "MANUAL_TEAM_LIMIT", message: `人工队数量为 ${manual.length}，超过资源上限 ${s.event.maxWorkshopTeams}` });
  manual.forEach((t: any) => {
    const core = ids(t.coreMemberIds?.length ? t.coreMemberIds : t.memberIds);
    if (core.length < 1) conflicts.push({ code: "MANUAL_TEAM_SIZE", teamId: t.id, message: `${t.teamNumber} 至少需要 1 名成员` });
    core.forEach((personId) => {
      if (!s.participants.some((p: any) => p.id === personId)) conflicts.push({ code: "UNKNOWN_MEMBER", teamId: t.id, participantId: personId, message: `${t.teamNumber} 包含不存在的成员` });
      if (owners.has(personId)) conflicts.push({ code: "DUPLICATE_MANUAL_MEMBER", participantId: personId, teamIds: [owners.get(personId), t.id], message: "同一人不能属于两支人工队" });
      else owners.set(personId, t.id);
    });
  });
  return { conflicts, owners, manual };
}
function lowAttendanceSuggestions(s: State) {
  if (s.participants.length >= s.event.maxWorkshopTeams) return [];
  return activeManualTeams(s).filter((t: any) => ids(t.coreMemberIds).length > 1).map((t: any) => ({ teamId: t.id, teamNumber: t.teamNumber, coreMemberIds: ids(t.coreMemberIds), releasableWorkshopSlots: ids(t.coreMemberIds).length - 1, message: `${t.teamNumber} 可在成员确认后拆分或释放成员，最多多启用 ${ids(t.coreMemberIds).length - 1} 个 Workshop 槽位。` }));
}
function seededRandom(seed: string) { let h = 2166136261; for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5; return ((h >>> 0) / 4294967296); }; }
function shuffled<T>(input: T[], random: () => number) { const output = [...input]; for (let i = output.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; } return output; }
function allocationSnapshot(s: State, manual: any[]) { return { participants: s.participants.map((p: any) => ({ id: p.id, nickname: p.nickname, registeredAt: p.registeredAt })).sort((a: any, b: any) => a.id.localeCompare(b.id)), manualTeams: manual.map((t: any) => ({ id: t.id, teamNumber: t.teamNumber, coreMemberIds: ids(t.coreMemberIds) })).sort((a: any, b: any) => a.id.localeCompare(b.id)), ruleVersion: ALLOCATION_RULE_VERSION, resourceLimit: s.event.maxWorkshopTeams }; }
function buildAllocation(s: State, seed: string) {
  const validation = allocationValidation(s); if (validation.conflicts.length) return { conflicts: validation.conflicts };
  const { manual, owners } = validation; const random = seededRandom(seed);
  const manualTeams = manual.map((t: any) => ({ id: t.id, teamNumber: t.teamNumber, type: "manual", coreMemberIds: ids(t.coreMemberIds), allocatedMemberIds: [] as string[], memberIds: ids(t.coreMemberIds), resourceSlot: null, tieBreak: random() }));
  const free = shuffled(s.participants.filter((p: any) => !owners.has(p.id)).map((p: any) => p.id), random);
  const autoTeams: any[] = []; let serial = 1;
  while (free.length && manualTeams.length + autoTeams.length < s.event.maxWorkshopTeams) autoTeams.push({ id: `preview-auto-${serial++}`, type: "auto", teamNumber: `AUTO-${String(autoTeams.length + 1).padStart(2, "0")}`, coreMemberIds: [], allocatedMemberIds: [], memberIds: [free.shift()], resourceSlot: null, tieBreak: random() });
  const fill = (targets: any[], includeManual = false) => {
    while (free.length) {
      const candidates = targets.filter((t: any) => t.memberIds.length < 3);
      if (!candidates.length) break;
      const smallest = Math.min(...candidates.map((t: any) => t.memberIds.length));
      const equal = candidates.filter((t: any) => t.memberIds.length === smallest).sort((a: any, b: any) => a.tieBreak - b.tieBreak || a.id.localeCompare(b.id));
      const target = equal[0]; const personId = free.shift(); target.memberIds.push(personId);
      if (includeManual) target.allocatedMemberIds.push(personId); else target.allocatedMemberIds.push(personId);
    }
  };
  // This is intentionally a strict phase boundary: a manual vacant seat is not
  // a candidate until every automatic team is full or free people are exhausted.
  fill(autoTeams); fill(manualTeams, true);
  const all = [...manualTeams, ...autoTeams]; all.forEach((t, index) => { t.resourceSlot = index + 1; delete t.tieBreak; });
  const waitlist = free.map((participantId) => ({ participantId, reason: manualTeams.length + autoTeams.length >= s.event.maxWorkshopTeams ? "CAPACITY_EXHAUSTED" : "MANUAL_TEAMS_CLOSED" }));
  return { conflicts: [], teams: all, waitlist, snapshot: allocationSnapshot(s, manual), lowAttendanceSuggestions: lowAttendanceSuggestions(s) };
}
async function createAllocationPreview(s: State, request: Request, actor: Staff) {
  const b = await body(request); const seed = text(b.allocationSeed, 120) || id(); const result = buildAllocation(s, seed);
  if (result.conflicts.length) return fail("人工队校验未通过，不能生成分配预览", 409);
  const run = { id: id(), status: "preview", allocationSeed: seed, ruleVersion: ALLOCATION_RULE_VERSION, inputSnapshot: result.snapshot, result: { teams: result.teams, waitlist: result.waitlist }, lowAttendanceSuggestions: result.lowAttendanceSuggestions, executedBy: actor.id, executedAt: now(), publishedAt: null, publishedBy: null };
  s.allocationRuns.push(run); if (s.allocationRuns.length > 100) s.allocationRuns.splice(0, s.allocationRuns.length - 100);
  audit(s, actor, "allocation.preview.created", "allocationRun", run.id, `seed=${seed}`); return { allocationRun: run };
}
function publishedAutoTeams(s: State) { return s.teams.filter((t: any) => t.status !== "dissolved" && t.type === "auto"); }
function publishAllocation(s: State, value: string, actor: Staff) {
  const run = s.allocationRuns.find((r: any) => r.id === value); if (!run || run.status !== "preview") return fail("未找到可发布的分配预览", 404);
  const current = buildAllocation(s, run.allocationSeed); if (current.conflicts.length) return fail("当前人工队存在冲突，不能发布", 409);
  if (JSON.stringify(current.snapshot) !== JSON.stringify(run.inputSnapshot)) return fail("人员或人工队已变化，请重新生成预览后再发布", 409);
  if (publishedAutoTeams(s).some((t: any) => teamHasIssuedCodes(t))) return fail("已有自动队领取资源；请先由 Staff 手动处理，不会静默重排", 409);
  publishedAutoTeams(s).forEach((t: any) => { t.status = "dissolved"; t.dissolvedAt = now(); });
  s.participants.forEach((p: any) => { p.teamId = null; p.allocationSource = "free"; });
  const resultTeams = run.result.teams as any[];
  const manualById = new Map(activeManualTeams(s).map((t: any) => [t.id, t]));
  resultTeams.filter((t) => t.type === "manual").forEach((planned) => { const actual = manualById.get(planned.id); if (!actual) return; actual.memberIds = ids(planned.memberIds); actual.coreMemberIds = ids(planned.coreMemberIds); actual.allocatedMemberIds = ids(planned.allocatedMemberIds); actual.resourceSlot = planned.resourceSlot; actual.memberIds.forEach((personId: string) => { const p = s.participants.find((candidate: any) => candidate.id === personId); if (p) { p.teamId = actual.id; p.allocationSource = actual.coreMemberIds.includes(personId) ? "manual" : "manual_fill"; } }); });
  resultTeams.filter((t) => t.type === "auto").forEach((planned) => { const actual = teamRecord(s, ids(planned.memberIds), "auto"); actual.allocationRunId = run.id; actual.resourceSlot = planned.resourceSlot; actual.allocatedMemberIds = ids(planned.memberIds); s.teams.push(actual); actual.memberIds.forEach((personId: string) => { const p = s.participants.find((candidate: any) => candidate.id === personId); if (p) { p.teamId = actual.id; p.allocationSource = "auto"; } }); });
  run.result.waitlist.forEach((item: any) => { const p = s.participants.find((candidate: any) => candidate.id === item.participantId); if (p) { p.teamId = null; p.allocationSource = "waitlist"; p.waitlistReason = item.reason; } });
  run.status = "published"; run.publishedAt = now(); run.publishedBy = actor.id; audit(s, actor, "allocation.published", "allocationRun", run.id, `seed=${run.allocationSeed}`); return { allocationRun: run };
}
async function splitManualTeam(s: State, value: string, request: Request, actor: Staff) {
  const source = team(s, value); const b = await body(request); const note = text(b.confirmationNote, 300); const groups = Array.isArray(b.groups) ? b.groups.map(ids).filter((group: string[]) => group.length) : [];
  if (!source || source.type !== "manual" || source.status === "dissolved") return fail("只能拆分有效人工队", 409);
  const frozen = preventFrozenRosterMutation(s, [source.id]); if (frozen) return frozen;
  if (!note) return fail("人工拆队必须填写成员确认备注", 400);
  const original = ids(source.coreMemberIds); if (!groups.length || groups.some((group: string[]) => group.length < 1) || ids(groups.flat()).length !== original.length || original.some((personId: string) => !ids(groups.flat()).includes(personId))) return fail("拆分结果必须完整覆盖原人工核心成员，且每队至少 1 人", 409);
  // System additions are not artificial manual core: when a staff-confirmed
  // split replaces the core team they return to the free pool for the next
  // explicit preview instead of being silently lost with the old team.
  source.allocatedMemberIds.filter((personId: string) => !original.includes(personId)).forEach((personId: string) => { const p = s.participants.find((candidate: any) => candidate.id === personId); if (p) { p.teamId = null; p.allocationSource = "free"; } });
  source.memberIds = []; source.coreMemberIds = []; source.allocatedMemberIds = []; source.status = "dissolved"; source.dissolvedAt = now();
  const resultTeams = groups.map((members: string[]) => { const t = teamRecord(s, members, "manual"); s.teams.push(t); members.forEach((personId) => { const p = s.participants.find((candidate: any) => candidate.id === personId); if (p) { p.teamId = t.id; p.allocationSource = "manual"; } }); return t; });
  const entry = { id: id(), originalTeamId: source.id, originalTeamNumber: source.teamNumber, originalMemberIds: original, resultTeamIds: resultTeams.map((t) => t.id), resultTeams: resultTeams.map((t) => ({ id: t.id, teamNumber: t.teamNumber, memberIds: t.memberIds })), confirmationNote: note, staffAccountId: actor.id, staffNickname: actor.nickname, at: now() }; s.manualSplitAudits.push(entry); audit(s, actor, "manual_team.split", "team", source.id, note); return { audit: entry, teams: resultTeams };
}
async function releaseManualMembers(s: State, value: string, request: Request, actor: Staff) {
  const source = team(s, value); const b = await body(request); const memberIds = ids(b.memberIds); const note = text(b.confirmationNote, 300);
  if (!source || source.type !== "manual" || source.status === "dissolved") return fail("只能从有效人工队释放成员", 409);
  const frozen = preventFrozenRosterMutation(s, [source.id]); if (frozen) return frozen;
  if (!note) return fail("释放人工核心成员必须填写成员确认备注", 400);
  if (!memberIds.length || memberIds.some((personId) => !source.coreMemberIds.includes(personId)) || source.coreMemberIds.length - memberIds.length < 1) return fail("只能释放部分人工核心成员，且原队至少保留 1 人", 409);
  source.coreMemberIds = source.coreMemberIds.filter((personId: string) => !memberIds.includes(personId)); source.memberIds = source.memberIds.filter((personId: string) => !memberIds.includes(personId));
  memberIds.forEach((personId) => { const p = s.participants.find((candidate: any) => candidate.id === personId); if (p) { p.teamId = null; p.allocationSource = "free"; } });
  const entry = { id: id(), originalTeamId: source.id, originalTeamNumber: source.teamNumber, releasedMemberIds: memberIds, resultTeamIds: [source.id], confirmationNote: note, staffAccountId: actor.id, staffNickname: actor.nickname, at: now() }; s.manualSplitAudits.push(entry); audit(s, actor, "manual_team.members.released", "team", source.id, note); return { audit: entry, team: source };
}
function removeTeam(s: State, value: string, actor: Staff) { const t = team(s, value); if (!t || t.status === "dissolved") return fail("队伍不存在或已解散", 404); const frozen = preventFrozenRosterMutation(s, [t.id]); if (frozen) return frozen; if (teamHasIssuedCodes(t)) return fail("已关联 Code 的队伍需要在解散弹窗中选择保留或回收", 409); s.participants.filter((p: any) => p.teamId === t.id).forEach((p: any) => { p.teamId = null; p.allocationSource = "free"; }); t.memberIds = []; t.coreMemberIds = []; t.allocatedMemberIds = []; dissolveTeam(s, t, "dissolve", actor); return { removedTeamId: t.id }; }
function confirmTeam(s: State, value: string, actor: Staff) { const t = team(s, value); if (!t) return fail("队伍不存在", 404); if (teamHasIssuedCodes(t)) return { team: t }; t.status = "ready_code"; audit(s, actor, "team.confirmed", "team", t.id); return { team: t }; }
async function updateTeamStatus(s: State, value: string, request: Request, actor: Staff) {
  const t = team(s, value); if (!t || t.status === "dissolved") return fail("队伍不存在或已解散", 404);
  const next = text((await body(request)).status, 40); const allowed = ["ready_code", "issued", "ta_qualified"];
  if (!allowed.includes(next)) return fail("状态无效", 400);
  if (["issued", "ta_qualified"].includes(next) && !t.workshopCodeId) return fail("未发放 Workshop Code 的队伍不能设为 Workshop 中或可参赛", 409);
  if (next === "ta_qualified" && !s.event.gates.qualification) return fail("参赛资格确认已关闭", 409);
  if (next === "ready_code" && t.workshopCodeId) return fail("已发放 Workshop Code 的队伍不能退回待发码状态；请保留资源关系后使用 Workshop 中或可参赛", 409);
  t.status = next;
  if (next === "ta_qualified") { t.qualificationStatus = "ta_qualified"; t.qualifiedAt = t.qualifiedAt || now(); t.workshopStatus = "in_progress"; }
  else { t.qualificationStatus = "not_qualified"; t.qualifiedAt = null; if (next === "issued") t.workshopStatus = "in_progress"; else t.workshopStatus = "not_started"; }
  audit(s, actor, "team.status.updated", "team", t.id, next); return { team: t };
}
async function importCodes(s: State, request: Request, actor: Staff) {
  const b = await body(request);
  const parse = (values: unknown) => (Array.isArray(values) ? values : []).map((value: unknown) => text(value, 160)).filter(Boolean);
  const workshopSubmitted = parse(b.workshopCodes ?? b.codes); const gamePortalSubmitted = parse(b.gamePortalCodes);
  if (!workshopSubmitted.length && !gamePortalSubmitted.length) return fail("请至少导入一类 Code");
  const additions = (submitted: string[], existing: any[]) => {
    const existingValues = new Set(existing.map((item: any) => item.code));
    const unique = [...new Set(submitted)];
    return { submitted: submitted.length, added: unique.filter((code) => !existingValues.has(code)), duplicates: submitted.length - unique.filter((code) => !existingValues.has(code)).length };
  };
  const workshop = additions(workshopSubmitted, s.workshopCodes); const gamePortal = additions(gamePortalSubmitted, s.gamePortalCodes);
  if (s.workshopCodes.length + workshop.added.length > s.event.maxWorkshopTeams) return fail(`Workshop Code 库存上限为 ${s.event.maxWorkshopTeams} 个，本次最多还能新增 ${Math.max(0, s.event.maxWorkshopTeams - s.workshopCodes.length)} 个`);
  const create = (code: string) => ({ id: id(), code, status: "available", teamId: null, assignedAt: null, assignedBy: null });
  s.workshopCodes.push(...workshop.added.map(create));
  s.gamePortalCodes.push(...gamePortal.added.map(create));
  const imported = {
    workshop: { submitted: workshop.submitted, added: workshop.added.length, duplicates: workshop.duplicates },
    gamePortal: { submitted: gamePortal.submitted, added: gamePortal.added.length, duplicates: gamePortal.duplicates },
  };
  audit(s, actor, "codes.imported", "event", s.event.id, `Workshop +${imported.workshop.added} (duplicate ${imported.workshop.duplicates}); Game Portal +${imported.gamePortal.added} (duplicate ${imported.gamePortal.duplicates})`);
  return { imported, codeSummary: codeSummary(s) };
}
async function setEventLinks(s: State, request: Request, actor: Staff) {
  const b = await body(request); const workshopUrl = text(b.workshopUrl, 500); const gamePortalUrl = text(b.gamePortalUrl, 500);
  if (!/^https:\/\//i.test(workshopUrl) || !/^https:\/\//i.test(gamePortalUrl)) return fail("活动链接必须以 https:// 开头");
  s.event.workshopUrl = workshopUrl; s.event.gamePortalUrl = gamePortalUrl;
  audit(s, actor, "event.links.updated", "event", s.event.id);
  return { event: s.event };
}
async function updateEventSettings(s: State, request: Request, actor: Staff) {
  const b = await body(request); const name = text(b.name, 80); const workshopUrl = text(b.workshopUrl, 500); const gamePortalUrl = text(b.gamePortalUrl, 500); const maxWorkshopTeams = Number(b.maxWorkshopTeams);
  if (!name) return fail("请填写活动名称");
  if (!Number.isInteger(maxWorkshopTeams) || maxWorkshopTeams < 4 || maxWorkshopTeams > 256) return fail("Workshop 资源上限必须是 4–256 的整数");
  if (!/^https:\/\//i.test(workshopUrl) || !/^https:\/\//i.test(gamePortalUrl)) return fail("活动链接必须以 https:// 开头");
  const started = s.participants.length > 0 || s.teams.some((t: any) => t.status !== "dissolved") || s.workshopCodes.length > 0 || s.gamePortalCodes.length > 0 || s.allocationRuns.length > 0 || Boolean(s.tournament);
  if (started && maxWorkshopTeams < s.event.maxWorkshopTeams) return fail("活动已有业务数据，Workshop 资源上限只能增加", 409);
  const gates = b.gates; if (!gates || typeof gates !== "object") return fail("现场开关无效");
  const nextGates = defaultGates(); Object.keys(nextGates).forEach((key) => { if (typeof gates[key] === "boolean") nextGates[key] = gates[key]; });
  s.event = { ...s.event, name, maxWorkshopTeams, workshopUrl, gamePortalUrl, gates: nextGates };
  audit(s, actor, "event.settings.updated", "event", s.event.id, `capacity=${maxWorkshopTeams}`);
  return { event: s.event };
}
async function archiveAndResetEvent(s: State, request: Request, actor: Staff) {
  const confirmation = text((await body(request)).confirmation, 80);
  if (confirmation !== s.event.name) return fail(`请输入完整活动名称“${s.event.name}”以确认归档重置`, 409);
  const archivedAt = now();
  const counts = {
    participants: s.participants.length,
    teams: s.teams.length,
    workshopCodes: s.workshopCodes.length,
    gamePortalCodes: s.gamePortalCodes.length,
    feedback: s.feedback.length,
  };
  const archive = {
    id: id(), eventName: s.event.name, archivedAt, archivedBy: actor.nickname, counts,
    snapshot: {
      event: structuredClone(s.event), participants: s.participants, teams: s.teams,
      allocationRuns: s.allocationRuns, manualSplitAudits: s.manualSplitAudits,
      workshopCodes: s.workshopCodes, gamePortalCodes: s.gamePortalCodes,
      competition: s.competition, tournament: s.tournament, auditLog: s.auditLog, feedback: s.feedback,
    },
  };
  s.archives.push(archive);
  s.participants = []; s.teams = []; s.allocationRuns = []; s.manualSplitAudits = [];
  s.workshopCodes = []; s.gamePortalCodes = [];
  s.competition = { frozenTeamIds: [], frozenAt: null, frozenBy: null };
  s.tournament = null; s.auditLog = []; s.feedback = [];
  const currentStaffToken = text(request.headers.get("x-staff-session"), 100);
  const currentAdminToken = text(request.headers.get("x-admin-session"), 100);
  s.staffSessions = s.staffSessions.filter((session: any) => session.token === currentStaffToken);
  s.adminSessions = s.adminSessions.filter((session: any) => session.token === currentAdminToken && session.staffSessionToken === currentStaffToken);
  audit(s, actor, "event.archived_reset", "eventArchive", archive.id, `${counts.participants} participants; ${counts.teams} teams; ${counts.workshopCodes} Workshop codes; ${counts.gamePortalCodes} Game Portal codes`);
  return { archive: { id: archive.id, eventName: archive.eventName, archivedAt, archivedBy: archive.archivedBy, counts }, event: s.event, codeSummary: codeSummary(s) };
}
function assignCodePair(s: State, t: any, workshopCode: any, gamePortalCode: any, actor: Staff, issuedAt = now()) {
  workshopCode.status = "assigned"; workshopCode.teamId = t.id; workshopCode.assignedAt = issuedAt; workshopCode.assignedBy = actor.id;
  gamePortalCode.status = "assigned"; gamePortalCode.teamId = t.id; gamePortalCode.assignedAt = issuedAt; gamePortalCode.assignedBy = actor.id;
  t.workshopCodeId = workshopCode.id; t.gamePortalCodeId = gamePortalCode.id; t.codeIssuedAt = issuedAt; t.codeIssuedBy = actor.id; t.status = "issued";
  t.memberIds.forEach((memberId: string) => { const p = s.participants.find((x: any) => x.id === memberId); p?.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); }); });
}
async function batchIssueCodes(s: State, request: Request, actor: Staff) {
  if (!s.event.gates.codeIssuance) return fail("Code 发放已关闭", 409);
  const teamIds = ids((await body(request)).teamIds); if (!teamIds.length) return fail("请至少选择一支队伍");
  const targets = teamIds.map((teamId) => team(s, teamId));
  if (targets.some((t) => !t || t.status === "dissolved" || teamHasIssuedCodes(t))) return fail("选中的队伍已变化，请刷新后重新选择", 409);
  const workshopCodes = s.workshopCodes.filter((item: any) => item.status === "available"); const gamePortalCodes = s.gamePortalCodes.filter((item: any) => item.status === "available");
  if (workshopCodes.length < targets.length || gamePortalCodes.length < targets.length) return fail(`库存不足：还需 Workshop ${Math.max(0, targets.length - workshopCodes.length)} 个、Game Portal ${Math.max(0, targets.length - gamePortalCodes.length)} 个`, 409);
  const issuedAt = now(); const ordered = [...targets].sort((a: any, b: any) => a.teamNumber.localeCompare(b.teamNumber));
  ordered.forEach((t: any, index: number) => assignCodePair(s, t, workshopCodes[index], gamePortalCodes[index], actor, issuedAt));
  audit(s, actor, "codes.batch.issued", "event", s.event.id, `${ordered.length} teams`);
  return { assigned: ordered.length, teamIds: ordered.map((t: any) => t.id), codeSummary: codeSummary(s) };
}
function issueCode(s: State, value: string, actor: Staff) {
  if (!s.event.gates.codeIssuance) return fail("Code 发放已关闭", 409);
  const t = team(s, value); if (!t) return fail("队伍不存在", 404);
  const workshopCode = s.workshopCodes.find((item: any) => item.status === "available");
  if (!workshopCode) return fail("没有可用的 Workshop Code", 409);
  if (teamHasIssuedCodes(t)) return fail("该队已收到 Code", 409); if (t.status !== "ready_code") return fail("该队当前不能发放 Code", 409);
  const issuedAt = now(); workshopCode.status = "assigned"; workshopCode.teamId = t.id; workshopCode.assignedAt = issuedAt; workshopCode.assignedBy = actor.id;
  t.workshopCodeId = workshopCode.id; t.codeIssuedAt = issuedAt; t.codeIssuedBy = actor.id; t.status = "issued";
  const gamePortalCode = s.gamePortalCodes.find((item: any) => item.status === "available");
  if (gamePortalCode) { gamePortalCode.status = "assigned"; gamePortalCode.teamId = t.id; gamePortalCode.assignedAt = issuedAt; gamePortalCode.assignedBy = actor.id; t.gamePortalCodeId = gamePortalCode.id; }
  t.memberIds.forEach((memberId: string) => { const p = s.participants.find((x: any) => x.id === memberId); p?.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); }); });
  audit(s, actor, "workshop.code.issued", "team", t.id, gamePortalCode ? "Workshop + Game Portal" : "Workshop"); return { team: t };
}
function issueGamePortalCode(s: State, value: string, actor: Staff) {
  if (!s.event.gates.codeIssuance) return fail("Code 发放已关闭", 409);
  const t = team(s, value); if (!t) return fail("队伍不存在", 404);
  if (!t.workshopCodeId) return fail("请先发放 Workshop Code", 409);
  if (t.gamePortalCodeId) return fail("该队已收到 Game Portal Code", 409);
  const code = s.gamePortalCodes.find((item: any) => item.status === "available");
  if (!code) return fail("没有可用的 Game Portal Code", 409);
  const issuedAt = now(); code.status = "assigned"; code.teamId = t.id; code.assignedAt = issuedAt; code.assignedBy = actor.id; t.gamePortalCodeId = code.id;
  t.memberIds.forEach((memberId: string) => { const p = s.participants.find((x: any) => x.id === memberId); p?.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); }); });
  audit(s, actor, "game_portal.code.issued", "team", t.id); return { team: t };
}
function gamePortalBackfillTargets(s: State) {
  return s.teams.filter((t: any) => t.status !== "dissolved" && t.workshopCodeId && !t.gamePortalCodeId)
    .sort((a: any, b: any) => {
      const aAt = s.workshopCodes.find((code: any) => code.id === a.workshopCodeId)?.assignedAt || a.codeIssuedAt || "";
      const bAt = s.workshopCodes.find((code: any) => code.id === b.workshopCodeId)?.assignedAt || b.codeIssuedAt || "";
      return aAt.localeCompare(bAt) || a.teamNumber.localeCompare(b.teamNumber);
    });
}
function backfillGamePortalCodes(s: State, actor: Staff) {
  if (!s.event.gates.codeIssuance) return fail("Code 发放已关闭", 409);
  const targets = gamePortalBackfillTargets(s); const available = s.gamePortalCodes.filter((item: any) => item.status === "available");
  if (!targets.length) return fail("没有需要补发 Game Portal Code 的队伍", 409);
  if (!available.length) return fail("没有可用的 Game Portal Code", 409);
  const issuedAt = now(); const filled = targets.slice(0, available.length);
  filled.forEach((t: any, index: number) => {
    const code = available[index]; code.status = "assigned"; code.teamId = t.id; code.assignedAt = issuedAt; code.assignedBy = actor.id; t.gamePortalCodeId = code.id;
    t.memberIds.forEach((memberId: string) => { const p = s.participants.find((x: any) => x.id === memberId); p?.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); }); });
  });
  audit(s, actor, "game_portal.code.backfilled", "event", s.event.id, `${filled.length}/${targets.length}`);
  return { assigned: filled.length, remaining: targets.length - filled.length, teams: filled.map((t: any) => t.id) };
}
async function setWorkshopNote(s: State, value: string, request: Request, actor: Staff) { const b = await body(request); const t = team(s, value); if (!t || !teamHasIssuedCodes(t)) return fail("未发放 Code 的队伍不能添加 Workshop 备注", 409); t.workshopNote = text(b.note, 120); audit(s, actor, "workshop.note.updated", "team", t.id, t.workshopNote); return { team: t }; }
function qualify(s: State, value: string, actor: Staff) { if (!s.event.gates.qualification) return fail("参赛资格确认已关闭", 409); const t = team(s, value); if (!t) return fail("队伍不存在", 404); if (!teamHasIssuedCodes(t)) return fail("未发放 Code 的队伍不能确认参赛", 409); t.qualificationStatus = "ta_qualified"; t.status = "ta_qualified"; t.qualifiedAt = now(); audit(s, actor, "team.ta.qualified", "team", t.id, "Game Portal practice match checked"); return { team: t }; }
async function updateEventGates(s: State, request: Request, actor: Staff) {
  const b = await body(request); const gates = b.gates; if (!gates || typeof gates !== "object") return fail("现场开关无效");
  const next = defaultGates(); Object.keys(next).forEach((key) => { if (typeof gates[key] === "boolean") next[key] = gates[key]; });
  s.event.gates = next; audit(s, actor, "event.gates.updated", "event", s.event.id, Object.entries(next).filter(([, open]) => !open).map(([key]) => key).join(",") || "all-open"); return { gates: next };
}
function competitionTeams(s: State) { return s.teams.filter((t: any) => t.qualificationStatus === "ta_qualified"); }
async function revokeQualification(s: State, value: string, request: Request, actor: Staff) { if (!s.event.gates.qualification) return fail("参赛资格确认已关闭", 409); const t = team(s, value); if (!t || t.qualificationStatus !== "ta_qualified") return fail("该队当前不在参赛名单中", 409); if (s.tournament) return fail("赛程已生成，请先作废赛程后再撤销资格", 409); t.qualificationStatus = "not_qualified"; t.status = "issued"; t.qualificationNote = text((await body(request)).note, 120); s.competition.frozenTeamIds = s.competition.frozenTeamIds.filter((teamId: string) => teamId !== t.id); audit(s, actor, "team.ta.qualification.revoked", "team", t.id, t.qualificationNote); return { team: t }; }
async function freezeCompetition(s: State, request: Request, actor: Staff) { if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("赛程已生成，不能再修改参赛名单", 409); const b = await body(request); const eligible = competitionTeams(s); const wanted = ids(b.teamIds); const teamIds = wanted.length ? wanted : eligible.map((t: any) => t.id); if (teamIds.length < MIN_COMPETITION_TEAMS || teamIds.length > s.event.maxWorkshopTeams || teamIds.some((teamId) => !eligible.some((t: any) => t.id === teamId))) return fail(`参赛名单必须为 ${MIN_COMPETITION_TEAMS}–${s.event.maxWorkshopTeams} 支已获资格的队伍`, 409); s.competition = { frozenTeamIds: teamIds, frozenTeams: teamIds.map((teamId) => ({ teamId, memberIds: [...(team(s, teamId)?.memberIds || [])] })), frozenAt: now(), frozenBy: actor.id }; audit(s, actor, "competition.roster.frozen", "competition", EVENT_ID, `${teamIds.length} teams`); return { competition: s.competition }; }
async function unfreezeCompetition(s: State, request: Request, actor: Staff) { if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("赛程已生成，不能解除冻结", 409); s.competition = { frozenTeamIds: [], frozenTeams: [], frozenAt: null, frozenBy: null }; audit(s, actor, "competition.roster.unfrozen", "competition", EVENT_ID); return { competition: s.competition }; }
async function generateTournament(s: State, request: Request, actor: Staff) {
  if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("已有赛程，请先作废后重建", 409);
  await body(request); const frozenIds = ids(s.competition.frozenTeamIds); const teams = frozenIds.map((teamId: string) => team(s, teamId)).filter((t: any) => t?.qualificationStatus === "ta_qualified");
  if (teams.length !== frozenIds.length || teams.length < MIN_COMPETITION_TEAMS || teams.length > s.event.maxWorkshopTeams) return fail("冻结名单已变化或参赛队数超出允许范围，请先解除名单冻结后重新确认", 409);
  const frozenSnapshots = Array.isArray(s.competition.frozenTeams) ? s.competition.frozenTeams : [];
  if (frozenSnapshots.length && frozenSnapshots.some((snapshot: any) => ids(snapshot.memberIds).join(",") !== ids(team(s, snapshot.teamId)?.memberIds).join(","))) return fail("冻结名单中的队伍成员已变化，请先解除名单冻结后重新确认", 409);
  const groupCount = nextPowerOfTwo(Math.ceil(teams.length / MAX_TEAMS_PER_GROUP)); const qualifiersPerGroup = 2;
  const groups = Array.from({ length: groupCount }, (_, index) => ({ id: groupLabel(index), teamIds: [] as string[] }));
  teams.forEach((t: any, index: number) => { groups[index % groupCount].teamIds.push(t.id); });
  const matches = groupFixtures(groups);
  const totalGroupRounds = Math.max(1, ...matches.map((match: any) => Number(match.round) || 1));
  s.tournament = { id: id(), status: "group", frozenTeamIds: teams.map((t: any) => t.id), groups, matches, groupCount, qualifiersPerGroup, currentGroupRound: 1, totalGroupRounds, knockoutMatches: [], createdAt: now() }; audit(s, actor, "tournament.generated", "tournament", s.tournament.id, `${teams.length} teams / ${groupCount} groups`); return { tournament: publicTournament(s) };
}
function validateTournamentGroups(tournament: any, rawGroups: unknown) {
  if (!Array.isArray(rawGroups) || rawGroups.length !== tournament.groups.length) return fail("分组数量不正确", 409);
  const expectedGroupIds = tournament.groups.map((group: any) => group.id).sort();
  const groups = rawGroups.map((group: any) => ({ id: text(group?.id, 20), teamIds: ids(group?.teamIds) }));
  if (groups.some((group: any) => !group.id || group.teamIds.length < 2 || group.teamIds.length > MAX_TEAMS_PER_GROUP)) return fail(`每个小组必须有 2–${MAX_TEAMS_PER_GROUP} 支队伍`, 409);
  if (groups.map((group: any) => group.id).sort().join(",") !== expectedGroupIds.join(",")) return fail("小组标识不正确", 409);
  const actualTeamIds = groups.flatMap((group: any) => group.teamIds);
  if (actualTeamIds.length !== new Set(actualTeamIds).size || actualTeamIds.length !== tournament.frozenTeamIds.length || [...actualTeamIds].sort().join(",") !== [...tournament.frozenTeamIds].sort().join(",")) return fail("每支冻结队伍必须恰好分到一个小组", 409);
  return { groups: groups.sort((first: any, second: any) => first.id.localeCompare(second.id)) };
}
async function updateTournamentGroups(s: State, request: Request, actor: Staff) {
  if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409);
  const tournament = s.tournament; if (!tournament || tournament.status !== "group" || tournament.matches.some((match: any) => match.status === "completed")) return fail("已有赛果，不能再调整分组", 409);
  const validated = validateTournamentGroups(tournament, (await body(request)).groups); if (validated.error) return validated;
  tournament.groups = validated.groups; tournament.matches = groupFixtures(tournament.groups); tournament.currentGroupRound = 1; tournament.totalGroupRounds = Math.max(1, ...tournament.matches.map((match: any) => Number(match.round) || 1));
  audit(s, actor, "tournament.groups.updated", "tournament", tournament.id, tournament.groups.map((group: any) => `${group.id}:${group.teamIds.length}`).join(" "));
  return { tournament: publicTournament(s) };
}
async function swapTournamentTeams(s: State, request: Request, actor: Staff) {
  if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409);
  const tournament = s.tournament; if (!tournament || tournament.status !== "group" || tournament.matches.some((m: any) => m.status === "completed")) return fail("已有赛果，不能再调整分组", 409);
  const b = await body(request); const first = text(b.firstTeamId, 80), second = text(b.secondTeamId, 80);
  if (!first || !second || first === second) return fail("请选择两支不同队伍", 400);
  const firstGroup = tournament.groups.find((group: any) => group.teamIds.includes(first)); const secondGroup = tournament.groups.find((group: any) => group.teamIds.includes(second));
  if (!firstGroup || !secondGroup || firstGroup.id === secondGroup.id) return fail("请选择来自不同小组的两支队伍", 409);
  firstGroup.teamIds[firstGroup.teamIds.indexOf(first)] = second; secondGroup.teamIds[secondGroup.teamIds.indexOf(second)] = first;
  tournament.matches = groupFixtures(tournament.groups); tournament.currentGroupRound = 1; tournament.totalGroupRounds = Math.max(1, ...tournament.matches.map((match: any) => Number(match.round) || 1)); audit(s, actor, "tournament.groups.swapped", "tournament", tournament.id, `${firstGroup.id} ↔ ${secondGroup.id}`);
  return { tournament: publicTournament(s) };
}
function standings(s: State, tournament: any, group: any) {
  const rows = group.teamIds.map((teamId: string) => ({ teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 }));
  const byId = new Map(rows.map((row: any) => [row.teamId, row]));
  tournament.matches.filter((m: any) => m.groupId === group.id && m.status === "completed").forEach((m: any) => {
    const a = byId.get(m.teamAId), b = byId.get(m.teamBId);
    if (!a || !b) return;
    a.played += 1; b.played += 1;
    a.goalsFor += m.scoreA; a.goalsAgainst += m.scoreB;
    b.goalsFor += m.scoreB; b.goalsAgainst += m.scoreA;
    if (m.scoreA > m.scoreB) { a.won += 1; a.points += 3; b.lost += 1; }
    else if (m.scoreA < m.scoreB) { b.won += 1; b.points += 3; a.lost += 1; }
    else { a.drawn += 1; b.drawn += 1; a.points += 1; b.points += 1; }
  });
  rows.forEach((row: any) => { row.goalDifference = row.goalsFor - row.goalsAgainst; });
  return rows.sort((a: any, b: any) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || (team(s, a.teamId)?.teamNumber || "").localeCompare(team(s, b.teamId)?.teamNumber || ""));
}
function resolveKnockout(tournament: any) {
  const matches = tournament.knockoutMatches || []; let changed = true;
  while (changed) {
    changed = false;
    matches.forEach((m: any) => {
      const sourceA = m.sourceAId ? matches.find((candidate: any) => candidate.id === m.sourceAId) : null;
      const sourceB = m.sourceBId ? matches.find((candidate: any) => candidate.id === m.sourceBId) : null;
      if (sourceA?.winnerId && m.teamAId !== sourceA.winnerId) { m.teamAId = sourceA.winnerId; changed = true; }
      if (sourceB?.winnerId && m.teamBId !== sourceB.winnerId) { m.teamBId = sourceB.winnerId; changed = true; }
      // A downstream match can receive its two winners at different times.
      // Do not declare a bye until both source matches have resolved.
      const sourcesResolved = (!m.sourceAId || Boolean(sourceA?.winnerId)) && (!m.sourceBId || Boolean(sourceB?.winnerId));
      if (!sourcesResolved || m.winnerId) return;
      if (m.teamAId && m.teamBId && m.status === "pending") { m.status = "ready"; changed = true; }
      if ((m.teamAId || m.teamBId) && !(m.teamAId && m.teamBId)) { m.winnerId = m.teamAId || m.teamBId; m.status = "bye"; changed = true; }
    });
  }
}
async function generateKnockout(s: State, request: Request, actor: Staff) { const tournament = s.tournament; if (!tournament || tournament.status !== "group") return fail("请先生成并完成小组赛", 409); if (tournament.matches.some((m: any) => m.status !== "completed")) return fail("请先录入全部小组赛结果", 409); if (tournament.knockoutMatches?.length) return fail("淘汰赛已生成", 409); const qualified = tournament.groups.flatMap((group: any) => standings(s, tournament, group).slice(0, tournament.qualifiersPerGroup).map((row: any) => row.teamId)); if (qualified.length < 2) return fail("晋级队伍不足", 409); let bracketSize = 1; while (bracketSize < qualified.length) bracketSize *= 2; const seeds = [...qualified, ...Array(Math.max(0, bracketSize - qualified.length)).fill(null)]; const firstRound: any[] = []; for (let index = 0; index < bracketSize / 2; index += 1) firstRound.push({ id: id(), stage: "knockout", round: 1, teamAId: seeds[index], teamBId: seeds[bracketSize - 1 - index], sourceAId: null, sourceBId: null, status: "pending", scoreA: null, scoreB: null, winnerId: null }); tournament.knockoutMatches = firstRound; tournament.status = "knockout"; tournament.currentKnockoutRound = 1; tournament.totalKnockoutRounds = Math.max(1, Math.log2(bracketSize)); resolveKnockout(tournament); audit(s, actor, "tournament.knockout.generated", "tournament", tournament.id, `${qualified.length} teams / round 1 only`); return { tournament: publicTournament(s) }; }
function advanceGroupRound(s: State, actor: Staff) {
  if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409);
  const tournament = s.tournament; if (!tournament || tournament.status !== "group") return fail("当前没有进行中的小组赛", 409);
  const round = groupRoundSummary(tournament);
  if (!round.complete) return fail(`第 ${round.current} 轮仍有未完成比赛，不能进入下一轮`, 409);
  if (round.current >= round.total) return fail("小组赛当前轮已经是最后一轮，请生成淘汰赛", 409);
  tournament.currentGroupRound = round.current + 1;
  audit(s, actor, "tournament.group.round.advanced", "tournament", tournament.id, `${round.current} -> ${tournament.currentGroupRound}`);
  return { tournament: publicTournament(s) };
}
function advanceKnockoutRound(s: State, actor: Staff) {
  if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409);
  const tournament = s.tournament; if (!tournament || tournament.status !== "knockout") return fail("当前没有进行中的淘汰赛", 409);
  const current = Number(tournament.currentKnockoutRound) || 1; const total = Number(tournament.totalKnockoutRounds) || 1;
  const currentMatches = tournament.knockoutMatches.filter((match: any) => (Number(match.round) || 1) === current);
  if (!currentMatches.length || currentMatches.some((match: any) => !match.winnerId)) return fail(`淘汰赛第 ${current} 轮仍有未完成比赛，不能进入下一轮`, 409);
  if (current >= total) return fail("淘汰赛已经完成，没有下一轮", 409);
  const nextRound = current + 1; let nextMatches = tournament.knockoutMatches.filter((match: any) => (Number(match.round) || 1) === nextRound);
  if (!nextMatches.length) {
    nextMatches = [];
    for (let index = 0; index < currentMatches.length; index += 2) nextMatches.push({ id: id(), stage: "knockout", round: nextRound, teamAId: null, teamBId: null, sourceAId: currentMatches[index].id, sourceBId: currentMatches[index + 1]?.id || null, status: "pending", scoreA: null, scoreB: null, winnerId: null });
    tournament.knockoutMatches.push(...nextMatches);
  }
  tournament.currentKnockoutRound = nextRound; resolveKnockout(tournament);
  audit(s, actor, "tournament.knockout.round.advanced", "tournament", tournament.id, `${current} -> ${nextRound}`);
  return { tournament: publicTournament(s) };
}
async function voidTournament(s: State, request: Request, actor: Staff) { if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (!s.tournament) return fail("当前没有赛程", 409); const tournamentId = s.tournament.id; s.tournament = null; s.competition = { frozenTeamIds: [], frozenTeams: [], frozenAt: null, frozenBy: null }; audit(s, actor, "tournament.voided", "tournament", tournamentId, text((await body(request)).reason, 120)); return { voidedTournamentId: tournamentId }; }
async function recordResult(s: State, value: string, request: Request, actor: Staff) { const b = await body(request); const tournament = s.tournament; const m = tournament?.matches.find((x: any) => x.id === value) || tournament?.knockoutMatches?.find((x: any) => x.id === value); const a = Number(b.scoreA), z = Number(b.scoreB); if (!m || !Number.isInteger(a) || !Number.isInteger(z) || a < 0 || z < 0 || !m.teamAId || !m.teamBId) return fail("赛果无效", 400); if (m.stage === "group" && (Number(m.round) || 1) > (Number(tournament.currentGroupRound) || 1)) return fail("该比赛尚未开放，请先由 Admin 结束当前轮次", 409); if (m.stage === "group" && tournament?.knockoutMatches?.length) return fail("淘汰赛已生成，小组赛赛果已锁定；如需更正，请先由 Admin 作废赛程并重新生成", 409); if (m.stage === "knockout" && (Number(m.round) || 1) < (Number(tournament.currentKnockoutRound) || 1)) return fail("该淘汰赛轮次已锁定；如需更正，请由 Admin 作废赛程并重新生成", 409); if (m.stage === "knockout" && (Number(m.round) || 1) > (Number(tournament.currentKnockoutRound) || 1)) return fail("该淘汰赛尚未开放，请先由 Admin 结束当前轮次", 409); if (m.stage === "knockout" && a === z) return fail("淘汰赛必须分出胜负，请重赛后录入", 409); m.scoreA = a; m.scoreB = z; m.status = "completed"; m.winnerId = a > z ? m.teamAId : z > a ? m.teamBId : null; audit(s, actor, "match.result.recorded", "match", m.id, `${a}:${z}`); return { match: m, tournament: publicTournament(s) }; }

function reclaimCode(s: State, value: string, actor: Staff) {
  const t = team(s, value); if (!t || t.status !== "dissolved" || !teamHasIssuedCodes(t)) return fail("没有可回收的已消耗 Code", 409);
  const resources = [[s.workshopCodes, t.workshopCodeId], [s.gamePortalCodes, t.gamePortalCodeId]] as any[];
  if (resources.some(([codes, codeId]) => codeId && (!codes.find((item: any) => item.id === codeId) || codes.find((item: any) => item.id === codeId).status !== "assigned"))) return fail("Code 当前状态无法回收", 409);
  resources.forEach(([codes, codeId]) => { const code = codes.find((item: any) => item.id === codeId); if (code) { code.status = "available"; code.teamId = null; code.assignedAt = null; code.assignedBy = null; } });
  t.workshopCodeId = null; t.gamePortalCodeId = null; t.codeIssuedAt = null; t.codeIssuedBy = null; t.dissolutionCodeAction = "reclaim";
  audit(s, actor, "codes.reclaimed", "team", t.id, "Admin 回收已解散队伍的两组 Code");
  return { team: t };
}
