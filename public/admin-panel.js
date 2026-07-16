const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const members = (team) => `${e(team.teamNumber)} · ${team.members.map((member) => `${e(member.nickname)} · ${e(member.staffShortId)}`).join("、")}`;

export function renderAdmin(root, state, api, controls) {
  if (!controls.hasAdmin) {
    root.innerHTML = `<div class="admin-shell admin-gate"><header class="admin-top"><div><strong>⚽ 管理后台</strong><small>Agentic Football 现场例外处理</small></div></header><section class="admin-empty"><p class="eyebrow">Admin</p><h1>请从 Staff 工作台进入</h1><p>管理后台必须由已登录的 Staff 在“更多”中验证 Admin PIN 后进入。</p><button data-action="return-staff">返回 Staff 工作台</button></section></div>`;
    root.querySelector("[data-action='return-staff']")?.addEventListener("click", controls.returnToStaff);
    return;
  }
  const ui = controls.ui; const section = ui.section || "activity";
  const sections = { activity: activityPanel(state), resources: resourcesPanel(state), competition: competitionPanel(state), records: recordsPanel(state) };
  root.innerHTML = `<div class="admin-shell"><header class="admin-top"><div><strong>⚽ 管理后台</strong><small>高影响操作与现场例外</small></div><div class="top-actions"><button class="text-button" data-feedback>反馈</button><button class="text-button" data-action="return-staff">返回 Staff</button></div></header><main><section class="admin-heading"><p class="eyebrow">Admin</p><h1>活动设置与例外处理</h1><p>人员、队伍、发码、练习赛确认与赛果录入在 Staff 工作台完成。</p></section><nav class="admin-nav">${[["activity", "活动设置"], ["resources", "资源管理"], ["competition", "比赛管理"], ["records", "反馈与记录"]].map(([id, label]) => `<button data-admin-section="${id}" class="${section === id ? "active" : ""}">${label}</button>`).join("")}</nav><section class="admin-panel">${sections[section]}</section></main><p class="notice" aria-live="polite"></p></div>`;
  const notice = root.querySelector(".notice"); const action = async (fn, ok, trigger) => {
    if (ui.pending) return; ui.pending = true; const original = trigger?.textContent; if (trigger) { trigger.disabled = true; trigger.textContent = "正在保存…"; }
    try { await fn(); await controls.refresh(); const current = document.querySelector(".notice"); if (current) current.textContent = ok; }
    catch (error) { notice.textContent = error.message; }
    finally { ui.pending = false; if (trigger?.isConnected) { trigger.disabled = false; trigger.textContent = original; } }
  };
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.adminSection) { ui.section = button.dataset.adminSection; return renderAdmin(root, state, api, controls); }
    if (button.dataset.action === "return-staff") return controls.returnToStaff();
    if (button.dataset.action === "reclaim-code" && window.confirm("确认回收此已消耗 Code，并重新放回可发放池吗？")) return action(() => api.reclaimCode(button.dataset.teamId), "Code 已回收至可发放池。", button);
    if (button.dataset.action === "revoke-qualification" && window.confirm("确认撤销该队参赛资格吗？")) { const note = window.prompt("撤销原因（可留空）", ""); if (note !== null) return action(() => api.revokeQualification(button.dataset.teamId, note), "已撤销参赛资格。", button); }
    if (button.dataset.action === "unfreeze" && window.confirm("确认解除比赛名单冻结吗？")) return action(() => api.unfreezeCompetition(), "比赛名单已解除冻结。", button);
    if (button.dataset.action === "void-tournament" && window.confirm("确认作废当前赛程并重新开始分组吗？")) { const reason = window.prompt("作废原因（可留空）", ""); if (reason !== null) return action(() => api.voidTournament(reason), "赛程已作废。", button); }
  });
  root.querySelector("#admin-event-settings")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); const gates = { selfServiceTeam: form.has("selfServiceTeam"), codeIssuance: form.has("codeIssuance"), qualification: form.has("qualification"), scheduleEditing: form.has("scheduleEditing") }; return action(async () => { await api.setEventLinks(form.get("workshopUrl"), form.get("gamePortalUrl")); await api.updateEventGates(gates); }, "活动设置已保存。", event.target.querySelector("button")); });
  root.querySelector("#admin-import-codes")?.addEventListener("submit", (event) => { event.preventDefault(); const codes = String(new FormData(event.target).get("codes") || "").split(/\r?\n/).map((code) => code.trim()).filter(Boolean); return action(() => api.importWorkshopCodes(codes), `已导入 ${codes.length} 个官方 Code。`, event.target.querySelector("button")); });
  root.querySelector("#admin-freeze-roster")?.addEventListener("submit", (event) => { event.preventDefault(); const ids = [...new FormData(event.target).getAll("teamId")]; if (!window.confirm(`确认冻结 ${ids.length} 支参赛队伍吗？`)) return; return action(() => api.freezeCompetition(ids), "比赛名单已冻结。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-groups")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); return action(() => api.tournament(Number(form.get("groupCount")), Number(form.get("qualifiersPerGroup"))), "小组赛赛程已生成。", event.target.querySelector("button")); });
  root.querySelector("#admin-swap-groups")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); if (!window.confirm("确认交换两队的小组位置吗？")) return; return action(() => api.swapTournamentTeams(form.get("firstTeamId"), form.get("secondTeamId")), "分组已调整。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-knockout")?.addEventListener("submit", (event) => { event.preventDefault(); return action(() => api.generateKnockout(), "淘汰赛对阵已生成。", event.target.querySelector("button")); });
}

function activityPanel(state) {
  const gates = state.event?.gates || {};
  const row = (name, title, hint) => `<label class="admin-check"><input type="checkbox" name="${name}" ${gates[name] !== false ? "checked" : ""}><span><strong>${title}</strong><small>${hint}</small></span></label>`;
  return `<section class="admin-section"><div><p class="eyebrow">活动设置</p><h2>链接与阶段开关</h2><p>链接会同步到已领 Code 的参赛者页面；关闭入口后，Staff 无法执行对应阶段动作。</p></div><form id="admin-event-settings" class="admin-form"><label>Workshop 链接<input name="workshopUrl" type="url" required value="${e(state.event.workshopUrl)}"></label><label>Game Portal 链接<input name="gamePortalUrl" type="url" required value="${e(state.event.gamePortalUrl)}"></label><fieldset><legend>活动阶段</legend>${row("selfServiceTeam", "允许自助组队", "关闭后，参赛者只能找 Staff 编组")}${row("codeIssuance", "允许发放 Code", "关闭后，Staff 不能向新队伍发放资源")}${row("qualification", "允许确认参赛资格", "关闭后，TA 不能确认新的比赛队伍")}${row("scheduleEditing", "允许赛程编辑", "关闭后，不能冻结、调整或作废赛程")}</fieldset><button>保存活动设置</button></form></section>`;
}

function resourcesPanel(state) {
  const summary = state.codeSummary || { total: 0, available: 0, issued: 0 }; const reclaimable = state.reclaimableTeams || [];
  return `<section class="admin-section"><div><p class="eyebrow">资源管理</p><h2>官方 Code 与回收</h2><p>Staff 只会自动发放下一个可用 Code；导入与回收由 Admin 处理。</p></div><section class="admin-metrics"><article><span>已导入</span><strong>${summary.total}</strong></article><article><span>可发放</span><strong>${summary.available}</strong></article><article><span>已消耗</span><strong>${summary.issued}</strong></article></section><form id="admin-import-codes" class="admin-form"><label>导入官方 Code<textarea name="codes" rows="5" placeholder="每行一个真实 Team Code"></textarea></label><button ${summary.issued ? "disabled" : ""}>批量导入</button></form><section class="admin-subsection"><h3>待处理的已消耗 Code</h3><div class="admin-list">${reclaimable.map((team) => `<article><div><strong>${members(team)}</strong><small>队伍已解散；当前 Code 仍保留为已消耗。</small></div><button data-action="reclaim-code" data-team-id="${e(team.id)}" class="secondary">回收 Code</button></article>`).join("") || '<p class="hint">暂无待回收 Code。</p>'}</div></section></section>`;
}

function competitionPanel(state) {
  const eligible = state.teams.filter((team) => team.qualificationStatus === "ta_qualified"); const frozen = state.competition?.frozenTeamIds || []; const tournament = state.tournament;
  if (!frozen.length && !tournament) return `<section class="admin-section"><div><p class="eyebrow">比赛管理</p><h2>冻结参赛名单</h2><p>仅 TA 已确认的队伍可进入比赛。</p></div><form id="admin-freeze-roster" class="admin-form">${eligible.map((team) => `<label class="check-row"><input type="checkbox" name="teamId" value="${e(team.id)}" checked>${members(team)}</label>`).join("") || '<p class="hint">暂无已确认队伍。</p>'}<button ${eligible.length < 2 ? "disabled" : ""}>冻结名单</button></form>${qualificationExceptions(eligible)}</section>`;
  if (frozen.length && !tournament) return `<section class="admin-section"><div><p class="eyebrow">比赛管理</p><h2>已冻结 ${frozen.length} 支队伍</h2><p>配置小组数量和晋级名额后生成赛程。</p></div><form id="admin-generate-groups" class="admin-form"><label>小组数量<input name="groupCount" type="number" min="1" max="8" value="${Math.ceil(frozen.length / 4)}"></label><label>每组晋级<select name="qualifiersPerGroup"><option value="2">前 2 名</option><option value="1">前 1 名</option></select></label><button>生成小组赛</button></form><button data-action="unfreeze" class="secondary">解除名单冻结</button>${qualificationExceptions(eligible)}</section>`;
  const teams = tournament.groups.flatMap((group) => group.standings.map((row) => ({ ...row, group: group.id }))); const first = teams[0]?.teamId; const second = teams.find((row) => row.group !== teams[0]?.group)?.teamId;
  return `<section class="admin-section"><div><p class="eyebrow">比赛管理</p><h2>${tournament.status === "knockout" ? "淘汰赛已生成" : "小组赛已生成"}</h2><p>Staff 在现场工作台录入赛果；这里只处理赛制级别的例外。</p></div>${tournament.status === "group" && !tournament.matches.some((match) => match.status === "completed") ? `<form id="admin-swap-groups" class="admin-form"><h3>调整未开赛分组</h3><label>第一支队伍<select name="firstTeamId">${teamOptions(teams, first)}</select></label><label>第二支队伍<select name="secondTeamId">${teamOptions(teams, second)}</select></label><button>交换两队位置</button></form>` : ""}${tournament.status === "group" && !tournament.knockoutMatches?.length ? `<form id="admin-generate-knockout" class="admin-form"><button ${tournament.matches.some((match) => match.status !== "completed") ? "disabled" : ""}>生成淘汰赛</button></form>` : ""}<button data-action="void-tournament" class="secondary">作废并重新分组</button>${qualificationExceptions(eligible)}</section>`;
}

function qualificationExceptions(teams) { return `<section class="admin-subsection"><h3>撤销参赛资格</h3><div class="admin-list">${teams.map((team) => `<article><div><strong>${members(team)}</strong><small>仅处理误确认或现场例外。</small></div><button data-action="revoke-qualification" data-team-id="${e(team.id)}" class="secondary">撤销</button></article>`).join("") || '<p class="hint">暂无可处理队伍。</p>'}</div></section>`; }
function teamOptions(teams, selected) { return teams.map((team) => `<option value="${e(team.teamId)}" ${team.teamId === selected ? "selected" : ""}>${e(team.group)} 组 · ${e(team.label)}</option>`).join(""); }

function recordsPanel(state) {
  const feedback = state.feedback || []; const log = state.auditLog || [];
  return `<section class="admin-section"><div><p class="eyebrow">反馈与记录</p><h2>反馈收件箱</h2><p>仅 Admin 可见。</p></div><section class="admin-subsection"><h3>参赛者与 Staff 反馈</h3><div class="admin-list">${feedback.map((item) => `<article><div><strong>${e(item.actorLabel)} · ${e(item.page)}</strong><small>${e(new Date(item.createdAt).toLocaleString("zh-CN"))}</small><p>${e(item.note)}</p></div></article>`).join("") || '<p class="hint">暂无反馈。</p>'}</div></section><section class="admin-subsection"><h3>最近操作记录</h3><div class="admin-list">${log.map((item) => `<article><div><strong>${e(item.action)}</strong><small>${e(item.staffNickname)} · ${e(new Date(item.at).toLocaleString("zh-CN"))}${item.reason ? ` · ${e(item.reason)}` : ""}</small></div></article>`).join("") || '<p class="hint">暂无操作记录。</p>'}</div></section></section>`;
}
