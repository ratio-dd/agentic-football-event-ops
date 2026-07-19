const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const field = (name, label, options) => `<label>${label}<select name="${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
const teamStatus = (team) => ({ draft: "队伍已创建，等待工作人员确认", ready_code: "队伍已确认，等待领取 Workshop 资源", issued: "已领取 Workshop 资源", ta_qualified: "已确认进入下午比赛" }[team?.status] || "等待工作人员安排");
const QR_OPEN_KEY = "afc-event-ops-qr-open";
const REBIND_OPEN_KEY = "afc-event-ops-rebind-open";
let ticketFrameObserver;

const ticketFrame = () => `<svg class="ticket-frame" aria-hidden="true" preserveAspectRatio="none"><path class="ticket-frame-shape"/></svg>`;

function signed(value) { return Number(value) > 0 ? `+${value}` : String(value ?? 0); }
function competitionForTeam(team, tournament) {
  if (!team || team.qualificationStatus !== "ta_qualified") return "";
  if (!tournament) return "";
  const group = tournament.groups.find((candidate) => candidate.standings.some((row) => row.teamId === team.id));
  const standing = group?.standings.find((row) => row.teamId === team.id);
  const matches = [...tournament.matches, ...(tournament.knockoutMatches || [])].filter((match) => match.teamAId === team.id || match.teamBId === team.id);
  const next = matches.find((match) => match.status === "ready");
  const describe = (match) => {
    const opponent = match.teamAId === team.id ? match.teamBLabel : match.teamALabel;
    const score = match.status === "completed" ? `${match.scoreA} : ${match.scoreB}` : match.status === "bye" ? "轮空晋级" : "待进行";
    const stage = match.stage === "group" ? `${match.groupId} 组 · 第 ${match.round || 1} 轮` : `淘汰赛第 ${match.round} 轮`;
    return `<li><div><small>${e(stage)}</small><strong>对阵 ${e(opponent)}</strong></div><em>${e(score)}</em></li>`;
  };
  return `<section class="participant-ticket participant-schedule"><h2>下午比赛</h2>${standing ? `<div class="participant-standings"><article><span>${e(group.id)} 组</span><strong>积分 ${standing.points}</strong></article><article><span>已赛 ${standing.played}</span><strong>净胜球 ${signed(standing.goalDifference)}</strong></article></div>` : ""}${next ? `<p class="participant-next-match">下一场：${e(next.stage === "group" ? `${next.groupId} 组 · 第 ${next.round || 1} 轮` : `淘汰赛第 ${next.round} 轮`)} 对阵 ${e(next.teamAId === team.id ? next.teamBLabel : next.teamALabel)}</p>` : ""}<h3>我的赛程</h3><ul class="ticket-match-list">${matches.map(describe).join("") || "暂无比赛安排。"}</ul></section>`;
}

function ticketFramePath(width, height) {
  const strokeInset = 2;
  const left = 12;
  const right = Math.max(left + 1, width - 12);
  const top = strokeInset;
  const bottom = Math.max(top + 1, height - strokeInset);
  const corner = Math.min(11, Math.max(6, height / 6));
  const toothDepth = 8;
  const toothHeight = 12;
  const toothPitch = 23;
  const usableTop = top + corner + 3;
  const usableBottom = bottom - corner - 3;
  const count = Math.max(1, Math.floor((usableBottom - usableTop - toothHeight) / toothPitch) + 1);
  const used = toothHeight + (count - 1) * toothPitch;
  const first = usableTop + Math.max(0, (usableBottom - usableTop - used) / 2);
  const starts = Array.from({ length: count }, (_, index) => first + index * toothPitch);
  let d = `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${starts[0]}`;
  starts.forEach((start, index) => {
    const end = start + toothHeight;
    d += ` C ${right - toothDepth} ${start} ${right - toothDepth} ${end} ${right} ${end}`;
    d += ` V ${index === starts.length - 1 ? bottom - corner : starts[index + 1]}`;
  });
  d += ` Q ${right} ${bottom} ${right - corner} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${starts[starts.length - 1] + toothHeight}`;
  [...starts].reverse().forEach((start, index) => {
    d += ` C ${left + toothDepth} ${start + toothHeight} ${left + toothDepth} ${start} ${left} ${start}`;
    d += ` V ${index === starts.length - 1 ? top + corner : starts[starts.length - 2 - index] + toothHeight}`;
  });
  return `${d} Q ${left} ${top} ${left + corner} ${top} Z`;
}

function syncTicketFrames(root) {
  ticketFrameObserver?.disconnect();
  const update = (card) => {
    const svg = card.querySelector(".ticket-frame");
    const path = card.querySelector(".ticket-frame-shape");
    const { width, height } = card.getBoundingClientRect();
    if (!svg || !path || width < 40 || height < 40) return;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    path.setAttribute("d", ticketFramePath(width, height));
  };
  ticketFrameObserver = new ResizeObserver((entries) => entries.forEach((entry) => update(entry.target)));
  root.querySelectorAll(".ticket-stamped").forEach((card) => {
    update(card);
    ticketFrameObserver.observe(card);
  });
}

export function renderParticipant(root, state, api, refresh) {
  const p = state.currentParticipant; const team = state.currentTeam;
  const registration = `<section class="participant-ticket participant-registration"><h1>现场登记</h1><form id="register" class="stack"><label>昵称<input name="nickname" maxlength="24" required placeholder="例如：北极熊前锋"></label>${field("techBackground", "技术背景", [["technical", "偏技术 / 可实操"], ["learning", "正在学习"], ["nontechnical", "非技术背景"]])}${field("workshopExperience", "是否做过 AWS Workshop", [["no", "没有"], ["yes", "做过"]])}<button class="ticket-primary">完成登记 <span aria-hidden="true">→</span></button></form><details class="ticket-details" ${sessionStorage.getItem(REBIND_OPEN_KEY) === "true" ? "open" : ""}><summary>换手机了？恢复我的状态</summary><form id="rebind" class="stack"><label>原昵称<input name="nickname" maxlength="24" required></label><button class="ticket-secondary">恢复绑定</button></form></details></section>`;
  const teamInfo = !team
    ? `<section class="participant-ticket participant-waiting"><span class="waiting-icon" aria-hidden="true">•••</span><h2>等待工作人员安排队伍</h2><p>请向工作人员展示你的现场编号，或报出昵称。</p></section>`
    : `<section class="participant-ticket ticket-stamped participant-team-card">${ticketFrame()}<div class="ticket-surface"><span class="ticket-label">队伍编号</span><strong class="team-ticket-number">${e(team.teamNumber)}</strong><ul class="ticket-member-list">${team.members.map((member) => `<li><span aria-hidden="true">●</span><strong>${e(member.nickname)}</strong><small>${e(member.staffShortId)}</small></li>`).join("")}</ul><p class="team-confirmation">${team.status === "draft" ? "工作人员正在确认队伍。" : "✓ 工作人员已确认队伍"}</p></div></section>${team.workshopCode ? `<section class="participant-ticket participant-code-card code-card"><div class="code-ticket-head"><span>Workshop Code</span><button id="copy-workshop-code" type="button" class="ticket-copy" aria-label="复制 Workshop Code">⧉</button></div><strong class="ticket-code">${e(team.workshopCode)}</strong>${team.gamePortalCode ? `<div class="code-ticket-head code-ticket-secondary"><span>Game Portal Code</span><button id="copy-game-portal-code" type="button" class="ticket-copy" aria-label="复制 Game Portal Code">⧉</button></div><strong class="ticket-code ticket-code-secondary">${e(team.gamePortalCode)}</strong>` : ""}<p>队内自行协商一人使用 AWS 账号注册 Workshop。</p><div class="ticket-resource-actions">${state.event.workshopUrl ? `<a href="${e(state.event.workshopUrl)}" target="_blank" rel="noreferrer">进入 Workshop</a><button id="copy-workshop-link" type="button" class="ticket-icon-action" aria-label="复制 Workshop 链接">⧉</button>` : `<button type="button" class="ticket-resource-disabled" disabled>进入 Workshop</button><small>链接待 Staff 配置</small>`}</div><div class="ticket-resource-actions ticket-portal-actions"><a href="${e(state.event.gamePortalUrl)}" target="_blank" rel="noreferrer">打开 Game Portal</a><button id="copy-portal-link" type="button" class="ticket-icon-action" aria-label="复制 Game Portal 链接">⧉</button></div></section>` : team.teamCodeAssigned ? `<section class="participant-status-strip pending"><span aria-hidden="true">◌</span><p>请向工作人员核验后查看 Code。</p></section>` : ""}${team.workshopCode || team.qualificationStatus === "ta_qualified" ? `<section class="participant-status-strip ${team.qualificationStatus === "ta_qualified" ? "qualified" : "pending"}"><span aria-hidden="true">${team.qualificationStatus === "ta_qualified" ? "✓" : "◌"}</span><div><strong>${team.qualificationStatus === "ta_qualified" ? "已确认参加下午比赛" : "下一步：完成练习赛"}</strong><p>${team.qualificationStatus === "ta_qualified" ? state.tournament ? "赛程已公布，请查看下方我的赛程。" : "赛程将在名单冻结后公布。" : "完成 Workshop 后，在 Game Portal 完成练习赛，再请 TA 确认。"}</p></div></section>` : ""}`;
  const schedule = competitionForTeam(team, state.tournament);
  const showQr = p && sessionStorage.getItem(QR_OPEN_KEY) === p.id;
  const personalQr = p && showQr ? `<div class="participant-qr-overlay"><section id="participant-qr" class="participant-ticket ticket-stamped participant-qr-ticket">${ticketFrame()}<div class="ticket-surface"><div class="qr-ticket-top"><span>我的二维码</span><button data-action="close-qr" type="button" class="ticket-close" aria-label="关闭二维码">×</button></div><div class="qr-ticket-body"><div class="qr-code-stage"><img src="/api/participant/qr?participant=${encodeURIComponent(p.staffShortId)}" width="196" height="196" alt="${e(p.staffShortId)} 的工作人员扫码二维码"></div><p>请让工作人员扫描。</p></div></div></section></div>` : "";
  const profile = p ? `${team ? `<section class="participant-intro"><h1>${teamStatus(team)}</h1></section>` : ""}<section class="participant-ticket ticket-stamped participant-id-ticket">${ticketFrame()}<div class="ticket-surface"><div class="id-ticket-icon" aria-hidden="true">●</div><div><span class="ticket-label">你的现场编号</span><strong class="person-ticket-number">${e(p.staffShortId)}</strong><small>向 Staff 出示此编号。</small></div><button id="toggle-qr" type="button" class="ticket-qr-button">我的二维码</button></div></section>${teamInfo}${schedule}${personalQr}` : registration;
  root.innerHTML = `<div class="mobile-shell participant-experience"><header class="topbar participant-topbar"><a class="participant-brand" href="/" aria-label="Agentic Football 参与者首页"><span aria-hidden="true">⚽</span><strong>Agentic Football</strong><em>北京 MeetUp</em></a><span class="top-actions participant-top-actions"><button type="button" class="text-button" data-feedback>反馈</button><a href="/staff">Staff</a></span></header><p class="notice participant-notice" aria-live="polite"></p><main class="participant-content">${profile}</main></div>`;
  syncTicketFrames(root);
  const notice = root.querySelector(".notice"); const submit = (selector, handler) => root.querySelector(selector)?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.target.querySelector("button"); button.disabled = true; try { await handler(new FormData(event.target)); await refresh(); } catch (error) { notice.textContent = error.message; } finally { button.disabled = false; } });
  root.querySelector("#toggle-qr")?.addEventListener("click", () => { const open = sessionStorage.getItem(QR_OPEN_KEY) === p.id; if (open) sessionStorage.removeItem(QR_OPEN_KEY); else sessionStorage.setItem(QR_OPEN_KEY, p.id); renderParticipant(root, state, api, refresh); });
  root.querySelector("[data-action='close-qr']")?.addEventListener("click", () => { sessionStorage.removeItem(QR_OPEN_KEY); renderParticipant(root, state, api, refresh); });
  root.querySelector("#copy-workshop-link")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(state.event.workshopUrl); notice.textContent = "Workshop 链接已复制。"; } catch { notice.textContent = "无法自动复制，请长按链接后复制。"; } });
  root.querySelector("#copy-portal-link")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(state.event.gamePortalUrl); notice.textContent = "Game Portal 链接已复制。"; } catch { notice.textContent = "无法自动复制，请长按链接后复制。"; } });
  root.querySelector("#copy-workshop-code")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(team.workshopCode); notice.textContent = "Workshop Code 已复制。"; } catch { notice.textContent = "无法自动复制，请长按 Code 后复制。"; } });
  root.querySelector("#copy-game-portal-code")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(team.gamePortalCode); notice.textContent = "Game Portal Code 已复制。"; } catch { notice.textContent = "无法自动复制，请长按 Code 后复制。"; } });
  root.querySelector(".ticket-details")?.addEventListener("toggle", (event) => { sessionStorage.setItem(REBIND_OPEN_KEY, String(event.currentTarget.open)); });
  submit("#register", (form) => api.register({ nickname: form.get("nickname"), supportProfile: { techBackground: form.get("techBackground"), workshopExperience: form.get("workshopExperience") } }));
  submit("#rebind", (form) => api.rebind({ nickname: form.get("nickname") }));
}
