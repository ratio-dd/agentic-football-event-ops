/**
 * Public Sites adapter for the Beijing MeetUp MVP.
 *
 * The original local Node server stores an event document on disk.  This
 * Worker keeps the same deliberately small API and stores that document in
 * D1, so every visitor of the shared link sees the same teams and fixtures.
 */

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

type EventState = Record<string, any>;
type MutationResult = { error?: string; status?: number; changed?: boolean; [key: string]: any };

const schemaStatements = [
  "CREATE TABLE IF NOT EXISTS event_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)",
];

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const assetRequest = url.pathname === "/" ? new Request(new URL("/index.html", request.url), request) : request;
      return env.ASSETS.fetch(assetRequest);
    }

    try {
      await ensureSchema(env.DB);
      const path = url.pathname;
      if (path === "/api/state" && request.method === "GET") return respond(await getView(request, env));
      if (path === "/api/participants" && request.method === "POST") return mutateResponse(env, data => createParticipant(data, request));
      if (path === "/api/teams" && request.method === "POST") return mutateResponse(env, data => createTeam(data, request));
      if (path === "/api/teams/join" && request.method === "POST") return mutateResponse(env, data => joinTeam(data, request));
      if (!isAdmin(request, env)) return respond({ error: "需要管理员权限" }, 403);
      if (path === "/api/admin/participants" && request.method === "POST") return mutateResponse(env, data => adminParticipant(data, request));
      if (path === "/api/admin/teams" && request.method === "POST") return mutateResponse(env, data => adminCreateTeam(data, request));
      const teamId = pathPart(path, 4);
      if (/^\/api\/admin\/teams\/[^/]+\/check-in$/.test(path) && request.method === "POST") return mutateResponse(env, data => checkIn(data, teamId));
      if (/^\/api\/admin\/teams\/[^/]+\/seat$/.test(path) && ["PUT", "POST"].includes(request.method)) return mutateResponse(env, data => seatTeam(data, teamId, request));
      if (/^\/api\/admin\/teams\/[^/]+\/lock$/.test(path) && request.method === "POST") return mutateResponse(env, data => lockTeam(data, teamId));
      if (/^\/api\/admin\/teams\/[^/]+\/team-code$/.test(path) && request.method === "POST") return mutateResponse(env, data => issueTeamCode(data, teamId));
      if (/^\/api\/admin\/teams\/[^/]+\/(competition-approval|competition-eligibility)$/.test(path) && ["PUT", "POST"].includes(request.method)) return mutateResponse(env, data => competitionApproval(data, teamId, request));
      if (["/api/admin/tournament/template", "/api/admin/tournament/generate", "/api/admin/tournament"].includes(path) && request.method === "POST") return mutateResponse(env, data => generateTournament(data, request));
      if (path === "/api/admin/tournament" && request.method === "DELETE") return mutateResponse(env, data => { data.tournament = null; audit(data, "tournament.voided", "tournament", "admin"); return { tournament: null }; });
      if (/^\/api\/admin\/matches\/[^/]+\/result$/.test(path) && ["PUT", "POST"].includes(request.method)) return mutateResponse(env, data => recordResult(data, pathPart(path, 4), request));
      return respond({ error: "Not found" }, 404);
    } catch (error) {
      return respond({ error: error instanceof Error ? error.message : "服务暂时不可用" }, 500);
    }
  },
};

export default worker;

async function ensureSchema(db: D1Database) {
  await db.batch(schemaStatements.map(statement => db.prepare(statement)));
}

async function readBody(request: Request) {
  try { return await request.json<any>(); } catch { return {}; }
}

async function getState(db: D1Database): Promise<{ data: EventState; version: number }> {
  const row = await db.prepare("SELECT data, version FROM event_state WHERE id = ?").bind("beijing-meetup-2026").first<{ data: string; version: number }>();
  if (row) return { data: normalise(JSON.parse(row.data)), version: row.version };
  const data = initialState();
  await db.prepare("INSERT OR IGNORE INTO event_state (id, data, version, updated_at) VALUES (?, ?, ?, ?)")
    .bind("beijing-meetup-2026", JSON.stringify(data), 1, now()).run();
  const created = await db.prepare("SELECT data, version FROM event_state WHERE id = ?").bind("beijing-meetup-2026").first<{ data: string; version: number }>();
  return { data: normalise(JSON.parse(created!.data)), version: created!.version };
}

async function getView(request: Request, env: Env) {
  const { data } = await getState(env.DB);
  return view(data, isAdmin(request, env), client(request));
}

async function mutateResponse(env: Env, handler: (data: EventState) => Promise<MutationResult> | MutationResult): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, version } = await getState(env.DB);
    const result = await handler(data);
    if (result.error) return respond({ error: result.error }, result.status || 400);
    if (result.changed !== false) {
      const write = await env.DB.prepare("UPDATE event_state SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
        .bind(JSON.stringify(data), version + 1, now(), "beijing-meetup-2026", version).run();
      if (!write.meta.changes) continue;
    }
    return respond(result, 200);
  }
  return respond({ error: "现场数据刚刚发生变化，请重试" }, 409);
}

async function createParticipant(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request);
  const clientId = client(request, body) || `browser:${uuid()}`;
  const nickname = text(body.nickname, 24);
  if (!nickname) return fail("请填写昵称");
  const existing = data.participants.find((item: any) => item.clientId === clientId);
  if (existing) return { participant: existing, changed: false };
  if (data.participants.some((item: any) => item.nickname === nickname)) return fail("昵称已被使用，请换一个", 409);
  const participant = { id: uuid(), clientId, nickname, survey: cleanSurvey(body.survey || body.questionnaire), teamId: null, createdAt: now() };
  data.participants.push(participant); audit(data, "participant.created", participant.id, "participant");
  return { participant };
}

async function createTeam(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const participantId = text(body.participantId || body.captainId, 80); const name = text(body.name, 32);
  if (!name || !participantId) return fail("请填写队名并使用自己的参与者档案");
  const captain = ownedParticipant(data, participantId, client(request, body));
  if (!captain) return fail("参与者档案不存在或不属于当前浏览器", 403);
  if (captain.teamId) return fail("你已在一支队伍中", 409);
  if (data.teams.some((item: any) => item.name === name && item.status !== "cancelled")) return fail("队名已被使用", 409);
  const team = newTeam(name, captain.id); data.teams.push(team); captain.teamId = team.id; audit(data, "team.created", team.id, "participant", captain.id);
  return { team };
}

async function joinTeam(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const participant = ownedParticipant(data, text(body.participantId, 80), client(request, body));
  const team = data.teams.find((item: any) => item.inviteCode === text(body.inviteCode, 16).toUpperCase());
  if (!participant || !team) return fail("参与者或邀请码不存在", 404);
  if (participant.teamId) return fail("你已在一支队伍中", 409);
  if (team.status !== "draft") return fail("队伍已确认，不能再自助加入", 409);
  if (team.memberIds.length >= 3) return fail("这支队伍已满员", 409);
  team.memberIds.push(participant.id); participant.teamId = team.id; audit(data, "team.member.joined", team.id, "participant", participant.id);
  return { team };
}

async function adminParticipant(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const nickname = text(body.nickname, 24);
  if (!nickname) return fail("请填写昵称"); if (data.participants.some((item: any) => item.nickname === nickname)) return fail("昵称已被使用", 409);
  const participant = { id: uuid(), clientId: `admin:${uuid()}`, nickname, survey: cleanSurvey(body.survey), teamId: null, createdAt: now(), createdBy: "admin" };
  data.participants.push(participant); audit(data, "participant.admin-created", participant.id, "admin"); return { participant };
}

async function adminCreateTeam(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const name = text(body.name, 32); const memberIds = uniqueIds(body.memberIds).slice(0, 3); const captainId = text(body.captainId || memberIds[0], 80);
  if (!name || !memberIds.length || !captainId || !memberIds.includes(captainId)) return fail("队名、队长和至少一名成员是必填项");
  if (data.teams.some((item: any) => item.name === name && item.status !== "cancelled")) return fail("队名已被使用", 409);
  const members = memberIds.map((id: string) => data.participants.find((item: any) => item.id === id));
  if (members.some((item: any) => !item || item.teamId)) return fail("成员不存在或已在其他队伍中", 409);
  const team = newTeam(name, captainId, memberIds); data.teams.push(team); members.forEach((item: any) => { item.teamId = team.id; }); audit(data, "team.admin-created", team.id, "admin"); return { team };
}

function checkIn(data: EventState, teamId: string): MutationResult {
  const team = teamById(data, teamId); if (!team) return fail("队伍不存在", 404);
  if (team.status === "locked") return { team, message: "队伍已锁定", changed: false };
  if (!["draft", "waitlisted", "confirmed"].includes(team.status)) return fail("该队当前不能签到", 409);
  if (team.status === "confirmed") return { team, message: "已完成签到占位", changed: false };
  const confirmed = data.teams.filter((item: any) => ["confirmed", "locked"].includes(item.status)).length;
  team.checkInAt = now();
  if (confirmed < data.event.maxWorkshopTeams) { team.status = "confirmed"; team.waitlistOrder = null; audit(data, "team.checked-in", team.id, "admin"); return { team, message: "已确认占位" }; }
  team.status = "waitlisted"; team.waitlistOrder = nextWaitlistOrder(data); audit(data, "team.waitlisted", team.id, "admin"); return { team, message: "名额已满，已进入候补" };
}

async function seatTeam(data: EventState, teamId: string, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const team = teamById(data, teamId); const table = data.tables.find((item: any) => item.id === text(body.tableId || body.seatId, 80));
  if (!team || !table) return fail("队伍或桌位不存在", 404); if (!["confirmed", "locked"].includes(team.status)) return fail("只有已确认队伍可分配桌位", 409);
  if (table.capacity - tableUsage(data, table.id, team.id) < team.memberIds.length) return fail("桌位容量不足", 409);
  team.tableId = table.id; audit(data, "team.seated", team.id, "admin", table.id); return { team };
}

function lockTeam(data: EventState, teamId: string): MutationResult {
  const team = teamById(data, teamId); if (!team) return fail("队伍不存在", 404); if (team.status === "locked") return { team, message: "队伍已锁定", changed: false };
  if (team.status !== "confirmed") return fail("只有已确认占位的队伍可锁定", 409); if (!team.tableId) return fail("请先分配桌位", 409);
  team.status = "locked"; team.lockedAt = now(); team.teamCode = uuid(); audit(data, "team.locked-and-code-issued", team.id, "admin"); return { team, message: "已锁队并发放 Team Code" };
}

function issueTeamCode(data: EventState, teamId: string): MutationResult {
  const team = teamById(data, teamId); if (!team) return fail("队伍不存在", 404); if (team.status !== "locked") return fail("只有已锁定队伍可发放 Team Code", 409);
  if (!team.teamCode) { team.teamCode = uuid(); audit(data, "team.code-issued", team.id, "admin"); }
  return { team, message: "Team Code 已就绪" };
}

async function competitionApproval(data: EventState, teamId: string, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const approved = Boolean(body.approved ?? body.eligible); const team = teamById(data, teamId);
  if (!team) return fail("队伍不存在", 404); if (approved && team.status !== "locked") return fail("只有已锁定队伍才能由管理员批准参赛", 409);
  if (data.tournament && data.tournament.status !== "draft") return fail("赛程已生成，不能直接修改参赛资格", 409);
  team.competitionApproved = approved; team.competitionApprovedAt = approved ? now() : null; audit(data, approved ? "team.competition-approved" : "team.competition-revoked", team.id, "admin", text(body.reason, 120)); return { team };
}

async function generateTournament(data: EventState, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const template = text(body.template || body.templateId, 40) || "groups-top2-knockout";
  if (data.tournament) return fail("已有赛程；请先作废后再生成", 409);
  const teams = data.teams.filter((item: any) => item.competitionApproved).map((item: any) => item.id);
  if (teams.length < 2) return fail("至少需要两支经管理员批准的参赛队", 409); if (!["groups-top2-knockout", "single-elimination"].includes(template)) return fail("不支持的赛制模板");
  data.tournament = template === "single-elimination" ? buildSingleElimination(teams) : buildGroupKnockout(teams, Number(body.groupSize) || 4, Number(body.qualifiersPerGroup) || 2);
  refreshTournament(data); audit(data, "tournament.generated", data.tournament.id, "admin", template); return { tournament: data.tournament };
}

async function recordResult(data: EventState, matchId: string, request: Request): Promise<MutationResult> {
  const body = await readBody(request); const scoreA = Number(body.scoreA ?? body.homeScore); const scoreB = Number(body.scoreB ?? body.awayScore);
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) return fail("请输入非负整数比分");
  const match = data.tournament?.matches.find((item: any) => item.id === matchId); if (!match) return fail("场次不存在", 404); refreshTournament(data);
  if (match.status !== "ready") return fail("当前场次尚未具备开赛条件", 409); if (match.stage === "knockout" && scoreA === scoreB) return fail("淘汰赛必须录入决胜后的比分", 409);
  Object.assign(match, { scoreA, scoreB, winnerId: scoreA === scoreB ? null : scoreA > scoreB ? match.teamAId : match.teamBId, status: "completed", completedAt: now() }); refreshTournament(data); audit(data, "match.result-recorded", match.id, "admin", `${scoreA}:${scoreB}`); return { match, tournament: data.tournament };
}

function initialState() {
  return normalise({ event: { id: "beijing-meetup-2026", name: "北京 Agentic Football MeetUp", maxWorkshopTeams: 32 }, participants: [], teams: [], tables: Array.from({ length: 16 }, (_, index) => ({ id: `T${index + 1}`, label: `A-${String(index + 1).padStart(2, "0")}`, capacity: 6 })), tournament: null, auditLog: [] });
}
function normalise(data: any) { return { event: { id: "beijing-meetup-2026", name: "北京 Agentic Football MeetUp", maxWorkshopTeams: 32, ...(data.event || {}) }, participants: Array.isArray(data.participants) ? data.participants : [], teams: Array.isArray(data.teams) ? data.teams : [], tables: Array.isArray(data.tables) ? data.tables : [], tournament: data.tournament || null, auditLog: Array.isArray(data.auditLog) ? data.auditLog : [] }; }
function newTeam(name: string, captainId: string, memberIds = [captainId]) { return { id: uuid(), name, captainId, memberIds, inviteCode: invite(), status: "draft", checkInAt: null, waitlistOrder: null, tableId: null, teamCode: null, lockedAt: null, competitionApproved: false, competitionApprovedAt: null, createdAt: now() }; }
function view(data: EventState, admin: boolean, clientId = "") { const current = data.participants.find((item: any) => item.clientId === clientId) || null; const teams = data.teams.map((team: any) => { const ownsTeam = Boolean(current && team.memberIds.includes(current.id)); const table = data.tables.find((item: any) => item.id === team.tableId) || null; return { ...team, members: team.memberIds.map((id: string) => data.participants.find((item: any) => item.id === id)).filter(Boolean).map((participant: any) => ({ ...publicParticipant(participant), isCaptain: participant.id === team.captainId })), table, seat: table, seatId: team.tableId, teamCode: admin || ownsTeam ? team.teamCode : null, checkedIn: ["confirmed", "locked"].includes(team.status), locked: team.status === "locked", competitionEligible: team.competitionApproved }; }); const tables = data.tables.map((table: any) => ({ ...table, used: tableUsage(data, table.id) })); return { config: data.event, event: data.event, participants: admin ? data.participants.map(publicParticipant) : undefined, currentParticipant: current ? publicParticipant(current) : null, teams, tables, seats: tables, tournament: data.tournament, matches: data.tournament?.matches || [], tournamentTemplates: [{ id: "groups-top2-knockout", label: "小组赛前二晋级淘汰赛" }, { id: "single-elimination", label: "单败淘汰赛" }], activity: admin ? data.auditLog.slice(-100).reverse() : [], activityLog: admin ? data.auditLog.slice(-100).reverse() : [], auditLog: admin ? data.auditLog.slice(-100).reverse() : undefined, admin }; }
function buildSingleElimination(teamIds: string[]) { const tournament = blankTournament("single-elimination", teamIds); tournament.matches = buildBracket(teamIds.map(teamId => ({ kind: "seed", teamId })), tournament.id); return tournament; }
function buildGroupKnockout(teamIds: string[], groupSize: number, qualifiersPerGroup: number) { groupSize = clamp(groupSize, 2, 8); qualifiersPerGroup = clamp(qualifiersPerGroup, 1, 2); const tournament = blankTournament("groups-top2-knockout", teamIds); for (let index = 0; index < teamIds.length; index += groupSize) tournament.groups.push({ id: `G${tournament.groups.length + 1}`, name: `第 ${tournament.groups.length + 1} 组`, teamIds: teamIds.slice(index, index + groupSize) }); for (const group of tournament.groups) for (let a = 0; a < group.teamIds.length; a += 1) for (let b = a + 1; b < group.teamIds.length; b += 1) tournament.matches.push(groupMatch(tournament.id, group.id, group.teamIds[a], group.teamIds[b])); const qualifiers = tournament.groups.flatMap((group: any) => Array.from({ length: Math.min(qualifiersPerGroup, group.teamIds.length) }, (_, index) => ({ kind: "qualifier", groupId: group.id, rank: index + 1 }))); tournament.matches.push(...buildBracket(qualifiers, tournament.id)); return tournament; }
function blankTournament(template: string, teamIds: string[]) { return { id: uuid(), template, status: "active", teamIds, groups: [], matches: [], createdAt: now() } as any; }
function groupMatch(tournamentId: string, groupId: string, teamAId: string, teamBId: string) { return { id: uuid(), tournamentId, stage: "group", groupId, round: 1, label: `${groupId} 小组赛`, sources: [{ kind: "seed", teamId: teamAId }, { kind: "seed", teamId: teamBId }], teamAId, teamBId, status: "ready", scoreA: null, scoreB: null, winnerId: null }; }
function buildBracket(sources: any[], tournamentId: string) { const size = nextPowerOfTwo(Math.max(2, sources.length)); let current = [...sources, ...Array.from({ length: size - sources.length }, () => ({ kind: "seed", teamId: null }))]; const all: any[] = []; let round = 1; while (current.length > 1) { const matches: any[] = []; for (let index = 0; index < current.length; index += 2) matches.push({ id: uuid(), tournamentId, stage: "knockout", groupId: null, round, label: bracketLabel(current.length), sources: [current[index], current[index + 1]], teamAId: null, teamBId: null, status: "pending", scoreA: null, scoreB: null, winnerId: null }); all.push(...matches); current = matches.map(match => ({ kind: "match", matchId: match.id })); round += 1; } return all; }
function refreshTournament(data: EventState) { const tournament = data.tournament; if (!tournament) return; let changed = true; let guard = 0; while (changed && guard++ < 32) { changed = false; for (const match of tournament.matches.filter((item: any) => item.stage === "knockout").sort((a: any, b: any) => a.round - b.round)) { if (["completed", "void"].includes(match.status)) continue; const resolved = match.sources.map((source: any) => sourceTeam(tournament, source)); if (resolved.some((item: any) => !item.ready)) continue; const [left, right] = resolved.map((item: any) => item.teamId); if (match.teamAId !== left || match.teamBId !== right) { match.teamAId = left; match.teamBId = right; changed = true; } if (!left && !right) { match.status = "void"; changed = true; } else if ((left && !right) || (!left && right)) { Object.assign(match, { status: "completed", winnerId: left || right, scoreA: null, scoreB: null, autoAdvanced: true }); changed = true; } else if (match.status !== "ready") { match.status = "ready"; changed = true; } } } const final = tournament.matches.filter((item: any) => item.stage === "knockout").sort((a: any, b: any) => b.round - a.round)[0]; if (final?.status === "completed" && final.winnerId) { tournament.status = "completed"; tournament.winnerId = final.winnerId; } }
function sourceTeam(tournament: any, source: any) { if (source.kind === "seed") return { ready: true, teamId: source.teamId || null }; if (source.kind === "match") { const match = tournament.matches.find((item: any) => item.id === source.matchId); return ["completed", "void"].includes(match?.status) ? { ready: true, teamId: match.winnerId || null } : { ready: false, teamId: null }; } if (source.kind === "qualifier") { const matches = tournament.matches.filter((item: any) => item.stage === "group" && item.groupId === source.groupId); return !matches.length || matches.some((item: any) => item.status !== "completed") ? { ready: false, teamId: null } : { ready: true, teamId: groupRanking(tournament, source.groupId)[source.rank - 1] || null }; } return { ready: false, teamId: null }; }
function groupRanking(tournament: any, groupId: string) { const group = tournament.groups.find((item: any) => item.id === groupId); const stats: Record<string, any> = Object.fromEntries(group.teamIds.map((id: string) => [id, { id, points: 0, diff: 0, scored: 0 }])); for (const match of tournament.matches.filter((item: any) => item.stage === "group" && item.groupId === groupId && item.status === "completed")) { stats[match.teamAId].scored += match.scoreA; stats[match.teamAId].diff += match.scoreA - match.scoreB; stats[match.teamBId].scored += match.scoreB; stats[match.teamBId].diff += match.scoreB - match.scoreA; if (match.scoreA > match.scoreB) stats[match.teamAId].points += 3; else if (match.scoreB > match.scoreA) stats[match.teamBId].points += 3; else { stats[match.teamAId].points += 1; stats[match.teamBId].points += 1; } } return Object.values(stats).sort((a: any, b: any) => b.points - a.points || b.diff - a.diff || b.scored - a.scored || a.id.localeCompare(b.id)).map((item: any) => item.id); }
function publicParticipant(item: any) { return { id: item.id, nickname: item.nickname, survey: item.survey, teamId: item.teamId }; }
function teamById(data: EventState, id: string) { return data.teams.find((item: any) => item.id === id); }
function ownedParticipant(data: EventState, participantId: string, clientId: string) { return data.participants.find((item: any) => item.id === participantId && (!clientId || item.clientId === clientId)); }
function tableUsage(data: EventState, tableId: string, ignoreTeamId: string | null = null) { return data.teams.filter((team: any) => team.tableId === tableId && team.id !== ignoreTeamId && ["confirmed", "locked"].includes(team.status)).reduce((sum: number, team: any) => sum + team.memberIds.length, 0); }
function nextWaitlistOrder(data: EventState) { return Math.max(0, ...data.teams.map((team: any) => team.waitlistOrder || 0)) + 1; }
function audit(data: EventState, action: string, objectId: string, actor: string, note = "") { data.auditLog.push({ id: uuid(), action, objectId, actor, note, at: now() }); if (data.auditLog.length > 500) data.auditLog.splice(0, data.auditLog.length - 500); }
function cleanSurvey(value: any) { const input = value && typeof value === "object" ? value : {}; return { leader: Boolean(input.leader), hasLaptop: Boolean(input.hasLaptop), role: text(input.role, 24), wantsCompetition: Boolean(input.wantsCompetition), acceptsAssignment: Boolean(input.acceptsAssignment) }; }
function isAdmin(request: Request, env: Env) { return Boolean(env.ADMIN_TOKEN) && request.headers.get("x-admin-token") === env.ADMIN_TOKEN; }
function client(request: Request, body?: any) { return text(request.headers.get("x-client-id") || body?.clientId, 100); }
function pathPart(pathname: string, index: number) { return decodeURIComponent(pathname.split("/")[index] || ""); }
function invite() { return uuid().replaceAll("-", "").slice(0, 8).toUpperCase(); }
function uuid() { return crypto.randomUUID(); }
function text(value: unknown, length: number) { return String(value ?? "").trim().slice(0, length); }
function uniqueIds(value: unknown) { return [...new Set(Array.isArray(value) ? value.map(item => text(item, 80)).filter(Boolean) : [])]; }
function now() { return new Date().toISOString(); }
function nextPowerOfTwo(value: number) { let result = 1; while (result < value) result *= 2; return result; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.floor(value) : min)); }
function bracketLabel(size: number) { return size === 2 ? "决赛" : size === 4 ? "半决赛" : size === 8 ? "四分之一决赛" : `淘汰赛 ${size} 强`; }
function fail(error: string, status = 400) { return { error, status, changed: false }; }
function respond(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
