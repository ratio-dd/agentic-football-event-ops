const root = document.querySelector("#display-app");
const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

let latestData = null;
let selectedView = null;

function matchLine(match) { const score = match.status === "completed" ? `${match.scoreA} : ${match.scoreB}` : "vs"; return `<li><span>${e(match.teamALabel)} <strong>${score}</strong> ${e(match.teamBLabel)}</span><small>${match.stage === "group" ? `${e(match.groupId)} 组 · 第 ${match.round || 1} 轮` : `第 ${match.round} 轮`} · ${match.status === "completed" ? "已结束" : "待进行"}</small></li>`; }
function standings(group) { return `<section class="display-group"><h2>${e(group.id)} 组积分榜</h2><table><thead><tr><th>队伍</th><th>赛</th><th>净胜球</th><th>分</th></tr></thead><tbody>${group.standings.map((row) => `<tr><td>${e(row.label)}</td><td>${row.played}</td><td>${row.goalDifference}</td><td><strong>${row.points}</strong></td></tr>`).join("")}</tbody></table></section>`; }

function knockoutRoundLabel(round, totalRounds) {
  const entrants = 2 ** Math.max(1, totalRounds - round + 1);
  if (entrants === 2) return "冠亚军决赛";
  if (entrants === 4) return "半决赛";
  if (entrants === 8) return "1/4 决赛";
  if (entrants === 16) return "1/8 决赛";
  return `1/${entrants / 2} 决赛`;
}

function viewSwitch(bracketAvailable, activeView) {
  return `<nav class="display-view-switch" aria-label="现场大屏视图"><button type="button" data-display-view="overview" aria-pressed="${activeView === "overview"}">现场进程</button><button type="button" data-display-view="bracket" aria-pressed="${activeView === "bracket"}" ${bracketAvailable ? "" : "disabled"}>淘汰赛对阵图</button></nav>`;
}

function displayHeader(data, tournament, activeView, bracketAvailable) {
  const title = activeView === "bracket" ? "淘汰赛晋级图" : tournament.status === "knockout" ? "淘汰赛" : `小组赛 · 第 ${tournament.currentGroupRound || 1} / ${tournament.totalGroupRounds || 1} 轮`;
  return `<header class="display-header ${activeView === "bracket" ? "display-header-bracket" : ""}"><div><p>${e(data.event?.name || "AGENTIC FOOTBALL")}</p><h1>${title}</h1></div><div class="display-header-actions"><span>现场大屏 · 自动更新</span>${viewSwitch(bracketAvailable, activeView)}</div></header>`;
}

function overview(tournament) {
  const ready = [...tournament.matches, ...(tournament.knockoutMatches || [])].find((match) => match.status === "ready");
  const groupResults = tournament.matches.filter((match) => match.status === "completed");
  return `<section class="next-match"><p>下一场</p><strong>${ready ? `${ready.stage === "group" ? `${e(ready.groupId)} 组 · 第 ${ready.round || 1} 轮 · ` : `${knockoutRoundLabel(ready.round, tournament.totalKnockoutRounds || ready.round)} · `}${e(ready.teamALabel)} <i>vs</i> ${e(ready.teamBLabel)}` : "等待 Admin 开放下一轮"}</strong></section><section class="display-grid">${tournament.groups.map(standings).join("")}</section><section class="display-results"><h2>本轮赛果</h2><ul>${groupResults.map(matchLine).join("") || "<li><span>比赛即将开始</span></li>"}</ul></section>`;
}

function teamCode(label) {
  return label && label !== "待定" ? label : "等待晋级";
}

function knockoutCard(match, x, centerY, cardWidth, cardHeight, current) {
  const top = centerY - cardHeight / 2;
  const rowHeight = cardHeight / 2;
  const teamA = teamCode(match?.teamALabel);
  const teamB = teamCode(match?.teamBLabel);
  const winner = match?.winnerLabel && match.winnerLabel !== "待定" ? match.winnerLabel : "";
  const completed = match?.status === "completed";
  const scoreA = completed ? String(match.scoreA) : match?.status === "bye" && winner === teamA ? "晋级" : "";
  const scoreB = completed ? String(match.scoreB) : match?.status === "bye" && winner === teamB ? "晋级" : "";
  const row = (label, score, offset, isWinner) => `<g class="knockout-team-row ${isWinner ? "is-winner" : ""}">${isWinner ? `<rect class="knockout-winner-fill" x="${x + 2}" y="${top + offset + 2}" width="${cardWidth - 4}" height="${rowHeight - 3}" rx="7"/>` : ""}<circle class="knockout-team-dot" cx="${x + 14}" cy="${top + offset + rowHeight / 2}" r="3"/><text class="knockout-team-code" x="${x + 24}" y="${top + offset + rowHeight / 2 + 5}">${e(label)}</text>${score ? `<text class="knockout-team-score" x="${x + cardWidth - 13}" y="${top + offset + rowHeight / 2 + 5}" text-anchor="end">${e(score)}</text>` : ""}</g>`;
  return `<g class="knockout-match-card ${current ? "is-current" : ""} ${match ? `is-${e(match.status)}` : "is-future"}"><rect class="knockout-card-bg" x="${x}" y="${top}" width="${cardWidth}" height="${cardHeight}" rx="9"/><line class="knockout-card-divider" x1="${x}" x2="${x + cardWidth}" y1="${centerY}" y2="${centerY}"/>${row(teamA, scoreA, 0, winner === teamA)}${row(teamB, scoreB, rowHeight, winner === teamB)}</g>`;
}

function knockoutDiagram(tournament) {
  const matches = tournament.knockoutMatches || [];
  const thirdPlaceMatch = matches.find((match) => match.placement === "third_place");
  const generatedRounds = matches.map((match) => Number(match.round) || 1);
  const totalRounds = Math.max(1, Number(tournament.totalKnockoutRounds) || 0, ...generatedRounds);
  const currentRound = Math.max(1, Number(tournament.currentKnockoutRound) || 1);
  const firstRoundMatches = 2 ** Math.max(0, totalRounds - 1);
  const cardWidth = 190;
  const cardHeight = 54;
  const columnWidth = 230;
  const slotHeight = 68;
  const startX = 18;
  const headingY = 24;
  const firstCenterY = 66 + slotHeight / 2;
  const centers = [];
  const matchesByRound = [];
  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
    const count = Math.max(1, firstRoundMatches / 2 ** roundIndex);
    matchesByRound[roundIndex] = matches.filter((match) => (Number(match.round) || 1) === roundIndex + 1);
    centers[roundIndex] = Array.from({ length: count }, (_, index) => roundIndex === 0 ? firstCenterY + index * slotHeight : (centers[roundIndex - 1][index * 2] + centers[roundIndex - 1][index * 2 + 1]) / 2);
  }
  const boardHeight = firstCenterY + Math.max(0, firstRoundMatches - 1) * slotHeight + cardHeight / 2 + 28;
  const championX = startX + totalRounds * columnWidth;
  const boardWidth = championX + cardWidth + 20;
  const connectors = [];
  for (let roundIndex = 0; roundIndex < totalRounds - 1; roundIndex += 1) {
    const sourceX = startX + roundIndex * columnWidth + cardWidth;
    const targetX = startX + (roundIndex + 1) * columnWidth;
    const middleX = (sourceX + targetX) / 2;
    centers[roundIndex + 1].forEach((targetY, index) => {
      [centers[roundIndex][index * 2], centers[roundIndex][index * 2 + 1]].forEach((sourceY) => connectors.push(`<path class="knockout-connector" d="M ${sourceX} ${sourceY} H ${middleX} V ${targetY} H ${targetX}"/>`));
    });
  }
  const finalCenterY = centers[totalRounds - 1][0];
  const finalRight = startX + (totalRounds - 1) * columnWidth + cardWidth;
  const championLabel = teamCode(matchesByRound[totalRounds - 1][0]?.winnerLabel);
  connectors.push(`<path class="knockout-connector knockout-champion-connector" d="M ${finalRight} ${finalCenterY} H ${championX}"/>`);
  const lanes = centers.map((_, index) => `<g><rect class="knockout-round-lane ${index + 1 === currentRound ? "is-current" : ""}" x="${startX + index * columnWidth - 9}" y="39" width="${cardWidth + 18}" height="${boardHeight - 49}" rx="14"/><text class="knockout-round-title ${index + 1 === currentRound ? "is-current" : ""}" x="${startX + index * columnWidth + cardWidth / 2}" y="${headingY}" text-anchor="middle">${e(knockoutRoundLabel(index + 1, totalRounds))}</text></g>`).join("");
  const cards = centers.flatMap((roundCenters, roundIndex) => roundCenters.map((centerY, index) => knockoutCard(matchesByRound[roundIndex][index], startX + roundIndex * columnWidth, centerY, cardWidth, cardHeight, roundIndex + 1 === currentRound))).join("");
  const championTop = finalCenterY - 27;
  const currentMatches = matchesByRound[currentRound - 1] || [];
  const finished = currentMatches.filter((match) => ["completed", "bye"].includes(match.status)).length;
  const expected = currentMatches.length || centers[currentRound - 1]?.length || 0;
  const currentLabel = currentRound === totalRounds && thirdPlaceMatch ? "冠亚军与三四名决赛" : knockoutRoundLabel(currentRound, totalRounds);
  const thirdPlaceScore = thirdPlaceMatch?.status === "completed" ? `${thirdPlaceMatch.scoreA} : ${thirdPlaceMatch.scoreB}` : "待进行";
  const thirdPlace = thirdPlaceMatch ? `<aside class="knockout-placement-card"><div><span>三四名决赛</span><strong>${e(teamCode(thirdPlaceMatch.teamALabel))} vs ${e(teamCode(thirdPlaceMatch.teamBLabel))}</strong></div><small>${e(thirdPlaceScore)}</small></aside>` : "";
  return `<section class="knockout-stage"><div class="knockout-stage-meta"><div><span>当前轮次</span><strong>${e(currentLabel)}</strong></div><p>${finished} / ${expected} 场已结束 · 后续轮次由 Admin 手动开放</p></div>${thirdPlace}<div class="knockout-bracket-viewport" tabindex="0" aria-label="淘汰赛晋级图，可横向滚动"><svg class="knockout-bracket-svg" viewBox="0 0 ${boardWidth} ${boardHeight}" width="${boardWidth}" height="${boardHeight}" role="img" aria-labelledby="knockout-bracket-title"><title id="knockout-bracket-title">从 ${e(knockoutRoundLabel(1, totalRounds))} 到冠军的淘汰赛晋级图</title>${lanes}<g class="knockout-lines">${connectors.join("")}</g>${cards}<g class="knockout-champion"><text class="knockout-round-title" x="${championX + cardWidth / 2}" y="${headingY}" text-anchor="middle">冠军</text><rect class="knockout-champion-bg" x="${championX}" y="${championTop}" width="${cardWidth}" height="54" rx="12"/><text class="knockout-champion-code" x="${championX + cardWidth / 2}" y="${finalCenterY + 7}" text-anchor="middle">${e(championLabel)}</text></g></svg></div></section>`;
}

function render(data) {
  latestData = data;
  const tournament = data.tournament;
  if (!tournament) { root.innerHTML = `<section class="display-empty"><p>⚽ Agentic Football</p><h1>${e(data.event?.name || "现场大屏")}</h1><span>比赛名单与赛程将在现场确认后公布</span></section>`; return; }
  const bracketAvailable = tournament.status === "knockout" || Boolean(tournament.knockoutMatches?.length);
  const activeView = selectedView === "overview" ? "overview" : selectedView === "bracket" && bracketAvailable ? "bracket" : bracketAvailable ? "bracket" : "overview";
  root.innerHTML = `${displayHeader(data, tournament, activeView, bracketAvailable)}${activeView === "bracket" ? knockoutDiagram(tournament) : overview(tournament)}`;
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-display-view]");
  if (!button || button.disabled || !latestData) return;
  selectedView = button.dataset.displayView;
  render(latestData);
});

async function refresh() {
  try { const response = await fetch("/api/display", { cache: "no-store" }); if (!response.ok) throw new Error("display unavailable"); render(await response.json()); }
  catch { root.innerHTML = `<section class="display-empty"><p>⚽ Agentic Football</p><h1>正在连接现场数据</h1><span>请稍后重试</span></section>`; }
}
refresh();
window.setInterval(refresh, 5_000);
