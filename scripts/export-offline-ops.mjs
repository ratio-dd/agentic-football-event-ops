import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] || "" : ""; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function teamNumber(state, teamId) { return state.teams.find((team) => team.id === teamId)?.teamNumber || "待定"; }
function memberView(state, memberId) { const participant = state.participants.find((item) => item.id === memberId); return participant ? { nickname: participant.nickname, staffShortId: participant.staffShortId } : { nickname: "未知成员", staffShortId: "" }; }

function standings(state, tournament, group) {
  const rows = group.teamIds.map((teamId) => ({ teamId, teamNumber: teamNumber(state, teamId), played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 }));
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));
  for (const match of (tournament.matches || []).filter((item) => item.groupId === group.id && item.status === "completed")) {
    const first = byTeam.get(match.teamAId); const second = byTeam.get(match.teamBId); if (!first || !second) continue;
    first.played += 1; second.played += 1; first.goalsFor += match.scoreA; first.goalsAgainst += match.scoreB; second.goalsFor += match.scoreB; second.goalsAgainst += match.scoreA;
    if (match.scoreA > match.scoreB) { first.won += 1; first.points += 3; second.lost += 1; }
    else if (match.scoreA < match.scoreB) { second.won += 1; second.points += 3; first.lost += 1; }
    else { first.drawn += 1; second.drawn += 1; first.points += 1; second.points += 1; }
  }
  rows.forEach((row) => { row.goalDifference = row.goalsFor - row.goalsAgainst; });
  return rows.sort((first, second) => second.points - first.points || second.goalDifference - first.goalDifference || second.goalsFor - first.goalsFor || first.teamNumber.localeCompare(second.teamNumber)).map((row) => ({ teamNumber: row.teamNumber, played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, goalDifference: row.goalDifference, points: row.points }));
}

function matchView(state, match) {
  return { stage: match.stage, group: match.groupId || null, round: match.round || 1, teamA: teamNumber(state, match.teamAId), teamB: teamNumber(state, match.teamBId), status: match.status, scoreA: match.scoreA, scoreB: match.scoreB, winner: match.winnerId ? teamNumber(state, match.winnerId) : null };
}

function buildPackage(state, version) {
  const safeState = {
    ...state,
    participants: Array.isArray(state.participants) ? state.participants : [],
    teams: Array.isArray(state.teams) ? state.teams : [],
    workshopCodes: Array.isArray(state.workshopCodes) ? state.workshopCodes : [],
    gamePortalCodes: Array.isArray(state.gamePortalCodes) ? state.gamePortalCodes : [],
  };
  const activeTeams = safeState.teams.filter((team) => team.status !== "dissolved"); const tournament = safeState.tournament;
  const frozenIds = [...new Set([...(safeState.competition?.frozenTeamIds || []), ...(tournament?.frozenTeamIds || [])])];
  const frozenSnapshots = Array.isArray(safeState.competition?.frozenTeams) && safeState.competition.frozenTeams.length
    ? safeState.competition.frozenTeams
    : frozenIds.map((teamId) => ({ teamId, memberIds: safeState.teams.find((team) => team.id === teamId)?.memberIds || [] }));
  const knockout = tournament?.knockoutMatches || []; const finalRound = knockout.length ? Math.max(...knockout.map((match) => match.round)) : null; const final = finalRound ? knockout.find((match) => match.round === finalRound) : null;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceVersion: version,
    purpose: "offline-onsite-operations",
    redacted: true,
    event: { id: safeState.event.id, name: safeState.event.name },
    counts: { participants: safeState.participants.length, activeTeams: activeTeams.length, qualifiedTeams: activeTeams.filter((team) => team.qualificationStatus === "ta_qualified").length, workshopResources: { total: safeState.workshopCodes.length, assigned: safeState.workshopCodes.filter((item) => item.status === "assigned").length }, gamePortalResources: { total: safeState.gamePortalCodes.length, assigned: safeState.gamePortalCodes.filter((item) => item.status === "assigned").length } },
    teams: activeTeams.map((team) => ({ teamNumber: team.teamNumber, status: team.status, qualificationStatus: team.qualificationStatus || "not_qualified", members: (team.memberIds || []).map((memberId) => memberView(safeState, memberId)) })),
    frozenRoster: frozenSnapshots.map((snapshot) => ({ teamNumber: teamNumber(safeState, snapshot.teamId), members: (snapshot.memberIds || []).map((memberId) => memberView(safeState, memberId)) })),
    tournament: tournament ? { status: tournament.status, groups: tournament.groups.map((group) => ({ group: group.id, teams: group.teamIds.map((teamId) => teamNumber(safeState, teamId)), standings: standings(safeState, tournament, group) })), matches: [...(tournament.matches || []), ...knockout].map((match) => matchView(safeState, match)), championTeamNumber: final?.winnerId ? teamNumber(safeState, final.winnerId) : null } : null,
  };
}

function assertRedacted(value, path = "root") {
  const forbidden = /(code|pin|session|client|token|feedback|audit|note)/i;
  if (Array.isArray(value)) return value.forEach((item, index) => assertRedacted(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`离线包出现禁止字段：${path}.${key}`);
    assertRedacted(item, `${path}.${key}`);
  }
}

function html(bundle) {
  const metrics = `<div class="metrics"><article><span>参与者</span><strong>${bundle.counts.participants}</strong></article><article><span>有效队伍</span><strong>${bundle.counts.activeTeams}</strong></article><article><span>可参赛</span><strong>${bundle.counts.qualifiedTeams}</strong></article><article><span>赛程状态</span><strong>${escapeHtml(bundle.tournament?.status || "未生成")}</strong></article></div>`;
  const teams = bundle.teams.map((team) => `<tr><td>${escapeHtml(team.teamNumber)}</td><td>${escapeHtml(team.status)}</td><td>${escapeHtml(team.qualificationStatus)}</td><td>${team.members.map((member) => `${escapeHtml(member.nickname)} ${escapeHtml(member.staffShortId)}`).join("、")}</td></tr>`).join("");
  const groups = (bundle.tournament?.groups || []).map((group) => `<section><h2>${escapeHtml(group.group)} 组</h2><table><thead><tr><th>队伍</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>净胜球</th><th>分</th></tr></thead><tbody>${group.standings.map((row) => `<tr><td>${escapeHtml(row.teamNumber)}</td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goalDifference}</td><td>${row.points}</td></tr>`).join("")}</tbody></table></section>`).join("");
  const matches = (bundle.tournament?.matches || []).map((match) => `<tr><td>${escapeHtml(match.stage === "group" ? `${match.group} 组` : `淘汰赛 R${match.round}`)}</td><td>${escapeHtml(match.teamA)}</td><td>${match.scoreA ?? "-"} : ${match.scoreB ?? "-"}</td><td>${escapeHtml(match.teamB)}</td><td>${escapeHtml(match.status)}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(bundle.event.name)} · 离线运营包</title><style>body{font-family:system-ui,sans-serif;max-width:1180px;margin:auto;padding:24px;color:#173326}h1,h2{color:#075b32}.warning{padding:12px;border-left:4px solid #a56a00;background:#fff8e8}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metrics article{padding:14px;border:1px solid #ccdcd2;border-radius:8px}.metrics span{display:block;color:#68746d}.metrics strong{font-size:24px}table{width:100%;border-collapse:collapse;margin:12px 0 28px}th,td{padding:8px;border-bottom:1px solid #dce5df;text-align:left}@media(max-width:720px){body{padding:14px}.metrics{grid-template-columns:repeat(2,1fr)}table{font-size:12px}}</style></head><body><h1>${escapeHtml(bundle.event.name)} · 离线运营包</h1><p class="warning">只读脱敏快照：用于断网时查看队伍、名单、赛程和比分；不能用于恢复数据库，也不包含 Code、PIN 或会话。</p><p>导出时间：${escapeHtml(bundle.exportedAt)} · 数据版本：${bundle.sourceVersion}${bundle.tournament?.championTeamNumber ? ` · 冠军：${escapeHtml(bundle.tournament.championTeamNumber)}` : ""}</p>${metrics}<h2>有效队伍</h2><table><thead><tr><th>队号</th><th>状态</th><th>资格</th><th>成员显示名</th></tr></thead><tbody>${teams}</tbody></table>${groups}<h2>赛程与比分</h2><table><thead><tr><th>阶段</th><th>队伍 A</th><th>比分</th><th>队伍 B</th><th>状态</th></tr></thead><tbody>${matches}</tbody></table></body></html>`;
}

async function main() {
  const databasePath = resolve(argument("--db")); const outputDirectory = resolve(argument("--output-dir"));
  if (!argument("--db") || !argument("--output-dir")) throw new Error("必须显式提供 --db 和 --output-dir");
  await access(databasePath);
  await access(dirname(outputDirectory));
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let row;
  try { row = database.prepare("SELECT data, version FROM event_state WHERE id = ?").get("beijing-meetup-2026"); } finally { database.close(); }
  if (!row) throw new Error("数据库中没有 Agentic Football 活动状态");
  const bundle = buildPackage(JSON.parse(row.data), Number(row.version)); assertRedacted(bundle);
  await mkdir(outputDirectory);
  const jsonPath = join(outputDirectory, "offline-ops.json"); const htmlPath = join(outputDirectory, "index.html");
  await Promise.all([writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", flag: "wx" }), writeFile(htmlPath, html(bundle), { encoding: "utf8", flag: "wx" })]);
  console.log(JSON.stringify({ result: "written", redacted: true, files: [jsonPath, htmlPath] }));
}

try { await main(); } catch (error) { console.error(JSON.stringify({ result: "failed", error: error instanceof Error ? error.message : "unknown error" })); process.exitCode = 1; }
