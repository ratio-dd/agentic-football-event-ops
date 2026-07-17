const root = document.querySelector("#display-app");
const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function matchLine(match) { const score = match.status === "completed" ? `${match.scoreA} : ${match.scoreB}` : "vs"; return `<li><span>${e(match.teamALabel)} <strong>${score}</strong> ${e(match.teamBLabel)}</span><small>${match.status === "completed" ? "已结束" : "待进行"}</small></li>`; }
function standings(group) { return `<section class="display-group"><h2>${e(group.id)} 组积分榜</h2><table><thead><tr><th>队伍</th><th>赛</th><th>净胜球</th><th>分</th></tr></thead><tbody>${group.standings.map((row) => `<tr><td>${e(row.label)}</td><td>${row.played}</td><td>${row.goalDifference}</td><td><strong>${row.points}</strong></td></tr>`).join("")}</tbody></table></section>`; }
function bracket(match) { const score = match.status === "completed" ? `${match.scoreA} : ${match.scoreB}` : match.status === "bye" ? "轮空晋级" : "待进行"; return `<article class="bracket-match"><small>第 ${match.round} 轮</small><strong>${e(match.teamALabel)} <span>${score}</span> ${e(match.teamBLabel)}</strong></article>`; }

function render(data) {
  const tournament = data.tournament;
  if (!tournament) { root.innerHTML = `<section class="display-empty"><p>⚽ Agentic Football</p><h1>${e(data.event?.name || "现场大屏")}</h1><span>比赛名单与赛程将在现场确认后公布</span></section>`; return; }
  const ready = [...tournament.matches, ...(tournament.knockoutMatches || [])].find((match) => match.status === "ready");
  const groupResults = tournament.matches.filter((match) => match.status === "completed");
  root.innerHTML = `<header class="display-header"><div><p>AGENTIC FOOTBALL · 北京 MEETUP</p><h1>${tournament.status === "knockout" ? "淘汰赛" : "小组赛"}</h1></div><span>现场大屏 · 自动更新</span></header><section class="next-match"><p>下一场</p><strong>${ready ? `${e(ready.teamALabel)} <i>vs</i> ${e(ready.teamBLabel)}` : tournament.status === "knockout" ? "等待赛果推进" : "等待下一轮安排"}</strong></section><section class="display-grid">${tournament.groups.map(standings).join("")}</section><section class="display-results"><h2>已录入赛果</h2><ul>${groupResults.map(matchLine).join("") || "<li><span>比赛即将开始</span></li>"}</ul></section>${tournament.knockoutMatches?.length ? `<section class="display-bracket"><h2>淘汰赛对阵</h2><div>${tournament.knockoutMatches.map(bracket).join("")}</div></section>` : ""}`;
}

async function refresh() {
  try { const response = await fetch("/api/display", { cache: "no-store" }); if (!response.ok) throw new Error("display unavailable"); render(await response.json()); }
  catch { root.innerHTML = `<section class="display-empty"><p>⚽ Agentic Football</p><h1>正在连接现场数据</h1><span>请稍后重试</span></section>`; }
}
refresh();
window.setInterval(refresh, 5_000);
