/* The single-document D1 adapter intentionally accepts legacy JSON during migration. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import QRCode from "qrcode";
interface Env { ASSETS: Fetcher; DB: D1Database; STAFF_PINS?: string; ADMIN_PIN?: string; }
type State = Record<string, any>;
type Staff = { id: string; nickname: string };

const EVENT_ID = "beijing-meetup-2026";
const schema = "CREATE TABLE IF NOT EXISTS event_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)";

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const assetPath = url.pathname === "/display" ? "/display.html" : ["/", "/staff"].includes(url.pathname) ? "/index.html" : "";
      const asset = assetPath ? new Request(new URL(assetPath, request.url), request) : request;
      return env.ASSETS.fetch(asset);
    }
    try {
      await env.DB.prepare(schema).run();
      const { pathname } = url;
      if (pathname === "/api/state" && request.method === "GET") return json(await publicView(env, request));
      if (pathname === "/api/participant/qr" && request.method === "GET") return participantQr(env, request, url);
      if (pathname === "/api/display" && request.method === "GET") return json(await displayView(env));
      if (pathname === "/api/participants" && request.method === "POST") return mutation(env, request, (s) => register(s, request));
      if (pathname === "/api/participants/rebind" && request.method === "POST") return mutation(env, request, (s) => rebind(s, request));
      if (pathname === "/api/teams/self" && request.method === "POST") return mutation(env, request, (s) => createSelfTeam(s, request));
      if (pathname === "/api/teams/self/join" && request.method === "POST") return mutation(env, request, (s) => joinSelfTeam(s, request));
      if (pathname === "/api/ops/session" && request.method === "POST") return mutation(env, request, (s) => createStaffSession(s, request, env));

      const staff = await staffFor(env, request);
      if (!staff) return json({ error: "需要工作人员 PIN" }, 403);
      if (pathname === "/api/ops/state" && request.method === "GET") return json(await staffView(env));
      if (pathname === "/api/ops/event-gates" && request.method === "PUT") return mutation(env, request, (s) => updateEventGates(s, request, staff, env));
      if (pathname.startsWith("/api/ops/participants") && request.method === "GET") return json(await participantSearch(env, url.searchParams.get("q") || ""));
      if (pathname === "/api/ops/teams" && request.method === "POST") return mutation(env, request, (s) => makeTeam(s, request, staff));
      if (/^\/api\/ops\/teams\/[^/]+\/members$/.test(pathname) && request.method === "PUT") return mutation(env, request, (s) => updateTeam(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/teams\/[^/]+$/.test(pathname) && request.method === "DELETE") return mutation(env, request, (s) => removeTeam(s, teamId(pathname), staff));
      if (/^\/api\/ops\/teams\/[^/]+\/confirm$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => confirmTeam(s, teamId(pathname), staff));
      if (pathname === "/api/ops/codes/import" && request.method === "POST") return mutation(env, request, (s) => importCodes(s, request, staff));
      if (pathname === "/api/ops/workshop-link" && request.method === "PUT") return mutation(env, request, (s) => setWorkshopLink(s, request, staff));
      if (/^\/api\/ops\/teams\/[^/]+\/issue-code$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => issueCode(s, teamId(pathname), staff));
      if (/^\/api\/ops\/workshop\/teams\/[^/]+\/status$/.test(pathname) && request.method === "PUT") return mutation(env, request, (s) => setWorkshop(s, teamId(pathname), request, staff));
      if (/^\/api\/ops\/qualification\/teams\/[^/]+\/confirm$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => qualify(s, teamId(pathname), staff));
      if (/^\/api\/ops\/qualification\/teams\/[^/]+\/revoke$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => revokeQualification(s, teamId(pathname), request, staff, env));
      if (pathname === "/api/ops/competition/freeze" && request.method === "POST") return mutation(env, request, (s) => freezeCompetition(s, request, staff, env));
      if (pathname === "/api/ops/competition/unfreeze" && request.method === "POST") return mutation(env, request, (s) => unfreezeCompetition(s, request, staff, env));
      if (pathname === "/api/ops/competition/generate" && request.method === "POST") return mutation(env, request, (s) => generateTournament(s, request, staff, env));
      if (pathname === "/api/ops/competition/swap" && request.method === "POST") return mutation(env, request, (s) => swapTournamentTeams(s, request, staff, env));
      if (pathname === "/api/ops/competition/knockout" && request.method === "POST") return mutation(env, request, (s) => generateKnockout(s, request, staff, env));
      if (pathname === "/api/ops/competition/void" && request.method === "POST") return mutation(env, request, (s) => voidTournament(s, request, staff, env));
      if (/^\/api\/ops\/matches\/[^/]+\/result$/.test(pathname) && request.method === "POST") return mutation(env, request, (s) => recordResult(s, matchId(pathname), request, staff, env));
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
  for (let retry = 0; retry < 5; retry += 1) {
    const { state, version } = await stateOf(env.DB); const result = await action(state);
    if (result?.error) return json(result, result.status || 400);
    const write = await env.DB.prepare("UPDATE event_state SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
      .bind(JSON.stringify(state), version + 1, now(), EVENT_ID, version).run();
    if (write.meta.changes) return json({ ...result, version: version + 1 });
  }
  return json({ error: "现场数据刚刚发生变化，请重试" }, 409);
}

function defaultGates() { return { selfServiceTeam: true, codeIssuance: true, qualification: true, scheduleEditing: true }; }
function initialState() { return { event: { id: EVENT_ID, name: "Agentic Football 现场运营台", maxWorkshopTeams: 32, workshopUrl: "", gates: defaultGates() }, participants: [], teams: [], workshopCodes: [], competition: { frozenTeamIds: [], frozenAt: null, frozenBy: null }, staffAccounts: [], staffSessions: [], tournament: null, auditLog: [] }; }
function normalise(raw: any): State {
  const base = initialState();
  const participants = Array.isArray(raw?.participants) ? raw.participants.map((p: any, index: number) => ({ id: p.id || id(), nickname: p.nickname || `参与者${index + 1}`, clientIds: p.clientIds || (p.clientId ? [p.clientId] : []), codeVisibleClientIds: p.codeVisibleClientIds || (p.clientId ? [p.clientId] : []), staffShortId: p.staffShortId || `P-${String(index + 1).padStart(3, "0")}`, supportProfile: p.supportProfile || { techBackground: p.survey?.role || "unknown", workshopExperience: "unknown" }, teamId: p.teamId || null, registeredAt: p.registeredAt || p.createdAt || now(), reboundAt: p.reboundAt || null })) : [];
  const workshopCodes = Array.isArray(raw?.workshopCodes) ? raw.workshopCodes.map((c: any) => ({ id: c.id || id(), code: text(c.code, 160), status: c.status === "assigned" ? "assigned" : "available", teamId: c.teamId || null, assignedAt: c.assignedAt || null, assignedBy: c.assignedBy || null })).filter((c: any) => c.code) : [];
  const teams = Array.isArray(raw?.teams) ? raw.teams.map((t: any, index: number) => ({ ...t, teamNumber: t.teamNumber || `T-${String(index + 1).padStart(3, "0")}`, codeIssuedAt: t.codeIssuedAt || (t.workshopCodeId ? workshopCodes.find((c: any) => c.id === t.workshopCodeId)?.assignedAt || t.createdAt || now() : null), codeIssuedBy: t.codeIssuedBy || null, workshopCodeId: t.workshopCodeId || null })) : [];
  return { ...base, ...raw, event: { ...base.event, ...(raw?.event || {}), gates: { ...defaultGates(), ...(raw?.event?.gates || {}) } }, participants, teams, workshopCodes, competition: { ...base.competition, ...(raw?.competition || {}) }, staffAccounts: Array.isArray(raw?.staffAccounts) ? raw.staffAccounts : base.staffAccounts, staffSessions: Array.isArray(raw?.staffSessions) ? raw.staffSessions : [], auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [] };
}

async function body(request: Request) { try { return await request.json<any>(); } catch { return {}; } }
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
function teamByNumber(s: State, value: string) { return s.teams.find((t: any) => t.teamNumber === normaliseTeamNumber(value)); }
function nextTeamNumber(s: State) { return `T-${String(s.teams.length + 1).padStart(3, "0")}`; }
function normaliseTeamNumber(value: unknown) { const numeric = text(value, 20).toUpperCase().replace(/^T[-\s]?/, "").replace(/^0+/, "") || "0"; return `T-${numeric.padStart(3, "0")}`; }
function after(path: string, marker: string) { const parts = path.split("/"); return decodeURIComponent(parts[parts.indexOf(marker) + 1] || ""); }
function teamId(path: string) { return after(path, "teams"); }
function matchId(path: string) { return after(path, "matches"); }

async function register(s: State, request: Request) {
  const b = await body(request); const nickname = text(b.nickname, 24); const clientId = client(request, b);
  if (!nickname || !clientId) return fail("请填写昵称后重试");
  const existing = s.participants.find((p: any) => p.clientIds.includes(clientId)); if (existing) return { participant: publicParticipant(existing, clientId) };
  if (s.participants.some((p: any) => p.nickname === nickname)) return fail("昵称已被使用，请换一个", 409);
  const participant = { id: id(), nickname, clientIds: [clientId], codeVisibleClientIds: [clientId], staffShortId: `P-${String(s.participants.length + 1).padStart(3, "0")}`, supportProfile: { techBackground: text(b.supportProfile?.techBackground, 20) || "unknown", workshopExperience: text(b.supportProfile?.workshopExperience, 20) || "unknown" }, teamId: null, registeredAt: now(), reboundAt: null };
  s.participants.push(participant); audit(s, { id: "participant", nickname }, "participant.registered", "participant", participant.id); return { participant: publicParticipant(participant, clientId) };
}
async function rebind(s: State, request: Request) {
  const b = await body(request); const nickname = text(b.nickname, 24); const clientId = client(request, b); const participant = s.participants.find((p: any) => p.nickname === nickname);
  if (!participant || !clientId) return fail("未找到该昵称，请确认后重试", 404);
  if (!participant.clientIds.includes(clientId)) participant.clientIds.push(clientId); participant.reboundAt = now();
  audit(s, { id: "participant", nickname }, "participant.rebound", "participant", participant.id); return { participant: publicParticipant(participant, clientId), codeHiddenUntilStaffCheck: true };
}
function teamRecord(s: State, memberIds: string[]) { return { id: id(), teamNumber: nextTeamNumber(s), memberIds, status: "draft", workshopStatus: "not_started", qualificationStatus: "not_qualified", codeIssuedAt: null, codeIssuedBy: null, officialLabel: null, createdAt: now() }; }
function participantForClient(s: State, request: Request) { return s.participants.find((p: any) => p.clientIds.includes(client(request))); }
function createSelfTeam(s: State, request: Request) { if (!s.event.gates.selfServiceTeam) return fail("自助组队已结束，请向工作人员出示现场编号", 409); const participant = participantForClient(s, request); if (!participant) return fail("请先完成登记", 403); if (participant.teamId) return fail("你已经在一支队伍中", 409); const t = teamRecord(s, [participant.id]); s.teams.push(t); participant.teamId = t.id; audit(s, { id: "participant", nickname: participant.nickname }, "team.self.created", "team", t.id); return { team: t }; }
async function joinSelfTeam(s: State, request: Request) { if (!s.event.gates.selfServiceTeam) return fail("自助组队已结束，请向工作人员出示现场编号", 409); const participant = participantForClient(s, request); const b = await body(request); const t = teamByNumber(s, b.teamNumber); if (!participant) return fail("请先完成登记", 403); if (participant.teamId) return fail("你已经在一支队伍中", 409); if (!t) return fail("未找到该队伍编号", 404); if (t.codeIssuedAt || t.status !== "draft") return fail("该队已由工作人员确认，不能再自行加入", 409); if (t.memberIds.length >= 3) return fail("该队已满 3 人", 409); t.memberIds.push(participant.id); participant.teamId = t.id; audit(s, { id: "participant", nickname: participant.nickname }, "team.self.joined", "team", t.id); return { team: t }; }

function configuredAccounts(_s: State, env: Env) { try { const parsed = JSON.parse(env.STAFF_PINS || ""); return Array.isArray(parsed) && parsed.some((a: any) => a?.enabled !== false && text(a?.pin, 120)) ? parsed : []; } catch { return []; } }
async function createStaffSession(s: State, request: Request, env: Env) {
  const b = await body(request); const pin = text(b.staffPin, 120); const nickname = text(b.staffNickname, 24); const accounts = configuredAccounts(s, env); if (!accounts.length) return fail("此环境尚未配置 Staff PIN，无法进入工作台", 503); const account = accounts.find((a: any) => a.enabled !== false && a.pin === pin);
  if (!account || !nickname) return fail("PIN 或工作人员昵称不正确", 403);
  const session = { token: id(), staffAccountId: account.id, nickname, createdAt: now() }; s.staffSessions.push(session); audit(s, { id: account.id, nickname }, "staff.session.created", "staffSession", session.token); return { staffSession: session.token, staff: { id: account.id, nickname } };
}
async function staffFor(env: Env, request: Request): Promise<Staff | null> {
  const token = text(request.headers.get("x-staff-session"), 100); if (!token) return null;
  const { state } = await stateOf(env.DB); const session = state.staffSessions.find((x: any) => x.token === token); return session ? { id: session.staffAccountId, nickname: session.nickname } : null;
}

function publicParticipant(p: any, clientId: string) { return { id: p.id, nickname: p.nickname, staffShortId: p.staffShortId, teamId: p.teamId, codeVisible: p.codeVisibleClientIds.includes(clientId), registeredAt: p.registeredAt }; }
function teamView(s: State, t: any, clientId = "") { const members = t.memberIds.map((memberId: string) => s.participants.find((p: any) => p.id === memberId)).filter(Boolean).map((p: any) => publicParticipant(p, clientId)); const current = s.participants.find((p: any) => p.clientIds.includes(clientId)); const currentMember = current && t.memberIds.includes(current.id); const showCode = Boolean(currentMember && current.codeVisibleClientIds.includes(clientId)); const assignedCode = s.workshopCodes.find((c: any) => c.id === t.workshopCodeId); return { ...t, members, teamCode: showCode ? assignedCode?.code || null : null, teamCodeAssigned: Boolean(t.workshopCodeId) }; }
async function publicView(env: Env, request: Request) { const { state } = await stateOf(env.DB); const clientId = client(request); const participant = state.participants.find((p: any) => p.clientIds.includes(clientId)); const currentTeam = participant?.teamId ? teamView(state, team(state, participant.teamId), clientId) : null; return { event: state.event, currentParticipant: participant ? publicParticipant(participant, clientId) : null, currentTeam, tournament: publicTournament(state) }; }
async function staffView(env: Env) { const { state } = await stateOf(env.DB); const codeSummary = { total: state.workshopCodes.length, available: state.workshopCodes.filter((c: any) => c.status === "available").length, issued: state.workshopCodes.filter((c: any) => c.status === "assigned").length }; return { event: state.event, codeSummary, competition: state.competition, participants: state.participants.map((p: any) => ({ ...p, clientIds: undefined, codeVisibleClientIds: undefined })), teams: state.teams.map((t: any) => teamView(state, t)), tournament: publicTournament(state), auditLog: state.auditLog.slice(-100).reverse() }; }
async function displayView(env: Env) { const { state } = await stateOf(env.DB); return { event: state.event, tournament: publicTournament(state) }; }
async function participantSearch(env: Env, q: string) { const { state } = await stateOf(env.DB); const key = q.trim().toLowerCase(); const numberKey = key.replace(/^p[-\s]?/, "").replace(/^0+/, ""); const participants = state.participants.filter((p: any) => { const number = p.staffShortId.toLowerCase().replace(/^p-?0*/, ""); return !key || p.nickname.toLowerCase().includes(key) || p.staffShortId.toLowerCase().includes(key) || (Boolean(numberKey) && number.includes(numberKey)); }).sort((a: any, b: any) => Number(b.staffShortId.toLowerCase() === key) - Number(a.staffShortId.toLowerCase() === key) || Number(b.staffShortId.toLowerCase().replace(/^p-?0*/, "") === numberKey) - Number(a.staffShortId.toLowerCase().replace(/^p-?0*/, "") === numberKey)).slice(0, 8).map((p: any) => ({ id: p.id, nickname: p.nickname, staffShortId: p.staffShortId, teamId: p.teamId, supportProfile: p.supportProfile })); return { participants }; }
function publicTournament(s: State) { if (!s.tournament) return null; const label = (teamId: string | null) => teamId ? s.teams.find((t: any) => t.id === teamId)?.officialLabel || "待定" : "待定"; const tournament = s.tournament; return { ...tournament, groups: tournament.groups.map((group: any) => ({ ...group, standings: standings(s, tournament, group).map((row: any) => ({ ...row, label: label(row.teamId), goalDifference: row.goalsFor - row.goalsAgainst })) })), matches: tournament.matches.map((m: any) => ({ ...m, teamALabel: label(m.teamAId), teamBLabel: label(m.teamBId) })), knockoutMatches: (tournament.knockoutMatches || []).map((m: any) => ({ ...m, teamALabel: label(m.teamAId), teamBLabel: label(m.teamBId), winnerLabel: label(m.winnerId) })) }; }
function setOfficialLabels(s: State, groups: any[]) { groups.forEach((group) => group.teamIds.forEach((teamId: string, index: number) => { const t = team(s, teamId); if (t) t.officialLabel = `${group.id}${index + 1}`; })); }
function groupFixtures(groups: any[]) { const matches: any[] = []; groups.forEach((group) => { for (let a = 0; a < group.teamIds.length; a += 1) for (let bIndex = a + 1; bIndex < group.teamIds.length; bIndex += 1) matches.push({ id: id(), stage: "group", groupId: group.id, teamAId: group.teamIds[a], teamBId: group.teamIds[bIndex], status: "ready", scoreA: null, scoreB: null, winnerId: null }); }); return matches; }

async function makeTeam(s: State, request: Request, actor: Staff) { const b = await body(request); const memberIds = ids(b.memberIds); if (memberIds.length < 1 || memberIds.length > 3) return fail("每队必须为 1–3 人"); const members = memberIds.map((memberId) => s.participants.find((p: any) => p.id === memberId)); if (members.some((p) => !p || p.teamId)) return fail("成员不存在或已在其他队伍中", 409); const t = teamRecord(s, memberIds); s.teams.push(t); members.forEach((p: any) => { p.teamId = t.id; }); audit(s, actor, "team.created", "team", t.id); return { team: t }; }
async function updateTeam(s: State, value: string, request: Request, actor: Staff) { const t = team(s, value); const b = await body(request); const memberIds = ids(b.memberIds); if (!t) return fail("队伍不存在", 404); if (t.codeIssuedAt) return fail("该队已发放资源，无法更改成员", 409); if (memberIds.length < 1 || memberIds.length > 3) return fail("每队必须为 1–3 人"); const members = memberIds.map((memberId) => s.participants.find((p: any) => p.id === memberId)); if (members.some((p: any) => !p || (p.teamId && p.teamId !== t.id))) return fail("成员不存在或已在其他队伍中", 409); s.participants.filter((p: any) => p.teamId === t.id).forEach((p: any) => { p.teamId = null; }); members.forEach((p: any) => { p.teamId = t.id; }); t.memberIds = memberIds; audit(s, actor, "team.members.updated", "team", t.id, text(b.reason, 120)); return { team: t }; }
function removeTeam(s: State, value: string, actor: Staff) { const t = team(s, value); if (!t) return fail("队伍不存在", 404); if (t.codeIssuedAt) return fail("该队已发放资源，无法解散", 409); s.participants.filter((p: any) => p.teamId === t.id).forEach((p: any) => { p.teamId = null; }); s.teams = s.teams.filter((candidate: any) => candidate.id !== t.id); audit(s, actor, "team.removed", "team", t.id); return { removedTeamId: t.id }; }
function confirmTeam(s: State, value: string, actor: Staff) { const t = team(s, value); if (!t) return fail("队伍不存在", 404); if (t.codeIssuedAt) return { team: t }; t.status = "ready_code"; audit(s, actor, "team.confirmed", "team", t.id); return { team: t }; }
async function importCodes(s: State, request: Request, actor: Staff) {
  const b = await body(request); const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map((value: unknown) => text(value, 160)).filter(Boolean))];
  if (!codes.length) return fail("请至少导入一个官方 Code");
  if (codes.length > s.event.maxWorkshopTeams) return fail(`最多导入 ${s.event.maxWorkshopTeams} 个 Code`);
  if (s.workshopCodes.some((c: any) => c.status === "assigned")) return fail("已有队伍收到 Code，不能替换 Code 列表", 409);
  s.workshopCodes = codes.map((code: string) => ({ id: id(), code, status: "available", teamId: null, assignedAt: null, assignedBy: null }));
  audit(s, actor, "codes.imported", "event", s.event.id, `${codes.length} codes`); return { codeSummary: { total: codes.length, available: codes.length, issued: 0 } };
}
async function setWorkshopLink(s: State, request: Request, actor: Staff) { const value = text((await body(request)).url, 500); if (value && !/^https:\/\//i.test(value)) return fail("Workshop 链接必须以 https:// 开头"); s.event.workshopUrl = value; audit(s, actor, "workshop.link.updated", "event", s.event.id); return { workshopUrl: value }; }
function issueCode(s: State, value: string, actor: Staff) {
  if (!s.event.gates.codeIssuance) return fail("Workshop Code 发放已关闭", 409);
  const t = team(s, value); if (!t) return fail("队伍不存在", 404);
  const code = s.workshopCodes.find((item: any) => item.status === "available");
  if (!code) return fail("没有可用的官方 Code", 409);
  if (t.codeIssuedAt) return fail("该队已收到 Code", 409); if (!['draft', 'ready_code'].includes(t.status)) return fail("该队当前不能发放 Code", 409);
  const issuedAt = now(); code.status = "assigned"; code.teamId = t.id; code.assignedAt = issuedAt; code.assignedBy = actor.id;
  t.workshopCodeId = code.id; t.codeIssuedAt = issuedAt; t.codeIssuedBy = actor.id; t.status = "issued";
  t.memberIds.forEach((memberId: string) => { const p = s.participants.find((x: any) => x.id === memberId); p?.clientIds.forEach((clientId: string) => { if (!p.codeVisibleClientIds.includes(clientId)) p.codeVisibleClientIds.push(clientId); }); });
  audit(s, actor, "code.issued", "team", t.id); return { team: t };
}
async function setWorkshop(s: State, value: string, request: Request, actor: Staff) { const b = await body(request); const t = team(s, value); const status = text(b.status, 30); if (!t || !['in_progress', 'blocked'].includes(status)) return fail("队伍或 Workshop 状态无效", 400); if (!t.codeIssuedAt) return fail("未发放 Code 的队伍不能进入 Workshop 状态", 409); t.workshopStatus = status; t.workshopNote = text(b.note, 120); audit(s, actor, "workshop.status.updated", "team", t.id, t.workshopNote); return { team: t }; }
function qualify(s: State, value: string, actor: Staff) { if (!s.event.gates.qualification) return fail("参赛资格确认已关闭", 409); const t = team(s, value); if (!t) return fail("队伍不存在", 404); if (!t.codeIssuedAt) return fail("未发放 Code 的队伍不能确认参赛", 409); t.qualificationStatus = "ta_qualified"; t.status = "ta_qualified"; t.qualifiedAt = now(); audit(s, actor, "team.ta.qualified", "team", t.id, "Game Portal practice match checked"); return { team: t }; }
function requireAdmin(request: Request, env: Env) { return Boolean(env.ADMIN_PIN && request.headers.get("x-admin-pin") === env.ADMIN_PIN); }
async function updateEventGates(s: State, request: Request, actor: Staff, env: Env) {
  if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403);
  const b = await body(request); const gates = b.gates; if (!gates || typeof gates !== "object") return fail("现场开关无效");
  const next = defaultGates(); Object.keys(next).forEach((key) => { if (typeof gates[key] === "boolean") next[key] = gates[key]; });
  s.event.gates = next; audit(s, actor, "event.gates.updated", "event", s.event.id, Object.entries(next).filter(([, open]) => !open).map(([key]) => key).join(",") || "all-open"); return { gates: next };
}
function competitionTeams(s: State) { return s.teams.filter((t: any) => t.qualificationStatus === "ta_qualified"); }
async function revokeQualification(s: State, value: string, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.qualification) return fail("参赛资格确认已关闭", 409); const t = team(s, value); if (!t || t.qualificationStatus !== "ta_qualified") return fail("该队当前不在参赛名单中", 409); if (s.tournament) return fail("赛程已生成，请先作废赛程后再撤销资格", 409); t.qualificationStatus = "not_qualified"; t.status = "issued"; t.qualificationNote = text((await body(request)).note, 120); s.competition.frozenTeamIds = s.competition.frozenTeamIds.filter((teamId: string) => teamId !== t.id); audit(s, actor, "team.ta.qualification.revoked", "team", t.id, t.qualificationNote); return { team: t }; }
async function freezeCompetition(s: State, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("赛程已生成，不能再修改参赛名单", 409); const b = await body(request); const eligible = competitionTeams(s); const wanted = ids(b.teamIds); const teamIds = wanted.length ? wanted : eligible.map((t: any) => t.id); if (teamIds.length < 2 || teamIds.some((teamId) => !eligible.some((t: any) => t.id === teamId))) return fail("请至少冻结两支已获资格的队伍", 409); s.competition = { frozenTeamIds: teamIds, frozenAt: now(), frozenBy: actor.id }; audit(s, actor, "competition.roster.frozen", "competition", EVENT_ID, `${teamIds.length} teams`); return { competition: s.competition }; }
async function unfreezeCompetition(s: State, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("赛程已生成，不能解除冻结", 409); s.competition = { frozenTeamIds: [], frozenAt: null, frozenBy: null }; audit(s, actor, "competition.roster.unfrozen", "competition", EVENT_ID); return { competition: s.competition }; }
async function generateTournament(s: State, request: Request, actor: Staff, env: Env) {
  if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (s.tournament) return fail("已有赛程，请先作废后重建", 409);
  const b = await body(request); const teams = s.competition.frozenTeamIds.map((teamId: string) => team(s, teamId)).filter((t: any) => t?.qualificationStatus === "ta_qualified");
  if (teams.length < 2) return fail("请先冻结至少两支已确认队伍", 409); const groupCount = Math.max(1, Math.min(8, Number(b.groupCount) || Math.ceil(teams.length / 4))); const qualifiersPerGroup = Math.max(1, Math.min(2, Number(b.qualifiersPerGroup) || 2));
  if (groupCount > teams.length) return fail("小组数不能超过参赛队数"); const groups = Array.from({ length: groupCount }, (_, index) => ({ id: String.fromCharCode(65 + index), teamIds: [] as string[] }));
  teams.forEach((t: any, index: number) => { groups[index % groupCount].teamIds.push(t.id); }); setOfficialLabels(s, groups);
  const matches = groupFixtures(groups);
  s.tournament = { id: id(), status: "group", frozenTeamIds: teams.map((t: any) => t.id), groups, matches, groupCount, qualifiersPerGroup, knockoutMatches: [], createdAt: now() }; audit(s, actor, "tournament.generated", "tournament", s.tournament.id); return { tournament: publicTournament(s) };
}
async function swapTournamentTeams(s: State, request: Request, actor: Staff, env: Env) {
  if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409);
  const tournament = s.tournament; if (!tournament || tournament.status !== "group" || tournament.matches.some((m: any) => m.status === "completed")) return fail("已有赛果，不能再调整分组", 409);
  const b = await body(request); const first = text(b.firstTeamId, 80), second = text(b.secondTeamId, 80);
  if (!first || !second || first === second) return fail("请选择两支不同队伍", 400);
  const firstGroup = tournament.groups.find((group: any) => group.teamIds.includes(first)); const secondGroup = tournament.groups.find((group: any) => group.teamIds.includes(second));
  if (!firstGroup || !secondGroup || firstGroup.id === secondGroup.id) return fail("请选择来自不同小组的两支队伍", 409);
  firstGroup.teamIds[firstGroup.teamIds.indexOf(first)] = second; secondGroup.teamIds[secondGroup.teamIds.indexOf(second)] = first;
  setOfficialLabels(s, tournament.groups); tournament.matches = groupFixtures(tournament.groups); audit(s, actor, "tournament.groups.swapped", "tournament", tournament.id, `${firstGroup.id} ↔ ${secondGroup.id}`);
  return { tournament: publicTournament(s) };
}
function standings(s: State, tournament: any, group: any) { const rows = group.teamIds.map((teamId: string) => ({ teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 })); const byId = new Map(rows.map((row: any) => [row.teamId, row])); tournament.matches.filter((m: any) => m.groupId === group.id && m.status === "completed").forEach((m: any) => { const a = byId.get(m.teamAId), b = byId.get(m.teamBId); if (!a || !b) return; a.played += 1; b.played += 1; a.goalsFor += m.scoreA; a.goalsAgainst += m.scoreB; b.goalsFor += m.scoreB; b.goalsAgainst += m.scoreA; if (m.scoreA > m.scoreB) { a.won += 1; a.points += 3; b.lost += 1; } else if (m.scoreA < m.scoreB) { b.won += 1; b.points += 3; a.lost += 1; } else { a.drawn += 1; b.drawn += 1; a.points += 1; b.points += 1; } }); return rows.sort((a: any, b: any) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || (team(s, a.teamId)?.officialLabel || "").localeCompare(team(s, b.teamId)?.officialLabel || "")); }
function resolveKnockout(tournament: any) { const matches = tournament.knockoutMatches || []; let changed = true; while (changed) { changed = false; matches.forEach((m: any) => { if (m.sourceAId) { const source = matches.find((candidate: any) => candidate.id === m.sourceAId); if (source?.winnerId && m.teamAId !== source.winnerId) { m.teamAId = source.winnerId; changed = true; } } if (m.sourceBId) { const source = matches.find((candidate: any) => candidate.id === m.sourceBId); if (source?.winnerId && m.teamBId !== source.winnerId) { m.teamBId = source.winnerId; changed = true; } } if (!m.winnerId && (m.teamAId || m.teamBId) && !(m.teamAId && m.teamBId)) { m.winnerId = m.teamAId || m.teamBId; m.status = "bye"; changed = true; } if (!m.winnerId && m.teamAId && m.teamBId && m.status === "pending") { m.status = "ready"; changed = true; } }); }
}
async function generateKnockout(s: State, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); const tournament = s.tournament; if (!tournament || tournament.status !== "group") return fail("请先生成并完成小组赛", 409); if (tournament.matches.some((m: any) => m.status !== "completed")) return fail("请先录入全部小组赛结果", 409); if (tournament.knockoutMatches?.length) return fail("淘汰赛已生成", 409); const qualified = tournament.groups.flatMap((group: any) => standings(s, tournament, group).slice(0, tournament.qualifiersPerGroup).map((row: any) => row.teamId)); if (qualified.length < 2) return fail("晋级队伍不足", 409); let bracketSize = 1; while (bracketSize < qualified.length) bracketSize *= 2; const seeds = [...qualified, ...Array(Math.max(0, bracketSize - qualified.length)).fill(null)]; const matches: any[] = []; let previous: any[] = []; for (let index = 0; index < bracketSize / 2; index += 1) previous.push({ id: id(), stage: "knockout", round: 1, teamAId: seeds[index], teamBId: seeds[bracketSize - 1 - index], sourceAId: null, sourceBId: null, status: "pending", scoreA: null, scoreB: null, winnerId: null }); matches.push(...previous); let round = 2; while (previous.length > 1) { const next: any[] = []; for (let index = 0; index < previous.length; index += 2) next.push({ id: id(), stage: "knockout", round, teamAId: null, teamBId: null, sourceAId: previous[index].id, sourceBId: previous[index + 1].id, status: "pending", scoreA: null, scoreB: null, winnerId: null }); matches.push(...next); previous = next; round += 1; } tournament.knockoutMatches = matches; tournament.status = "knockout"; resolveKnockout(tournament); audit(s, actor, "tournament.knockout.generated", "tournament", tournament.id, `${qualified.length} teams`); return { tournament: publicTournament(s) }; }
async function voidTournament(s: State, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); if (!s.event.gates.scheduleEditing) return fail("赛程与名单调整已关闭", 409); if (!s.tournament) return fail("当前没有赛程", 409); const tournamentId = s.tournament.id; s.tournament = null; s.competition = { frozenTeamIds: [], frozenAt: null, frozenBy: null }; s.teams.forEach((t: any) => { t.officialLabel = null; }); audit(s, actor, "tournament.voided", "tournament", tournamentId, text((await body(request)).reason, 120)); return { voidedTournamentId: tournamentId }; }
async function recordResult(s: State, value: string, request: Request, actor: Staff, env: Env) { if (!requireAdmin(request, env)) return fail("需要管理员 PIN", 403); const b = await body(request); const tournament = s.tournament; const m = tournament?.matches.find((x: any) => x.id === value) || tournament?.knockoutMatches?.find((x: any) => x.id === value); const a = Number(b.scoreA), z = Number(b.scoreB); if (!m || !Number.isInteger(a) || !Number.isInteger(z) || a < 0 || z < 0 || !m.teamAId || !m.teamBId) return fail("赛果无效", 400); if (m.stage === "knockout" && a === z) return fail("淘汰赛必须分出胜负，请重赛后录入", 409); m.scoreA = a; m.scoreB = z; m.status = "completed"; m.winnerId = a > z ? m.teamAId : z > a ? m.teamBId : null; if (m.stage === "knockout") resolveKnockout(tournament); audit(s, actor, "match.result.recorded", "match", m.id, `${a}:${z}`); return { match: m, tournament: publicTournament(s) }; }
