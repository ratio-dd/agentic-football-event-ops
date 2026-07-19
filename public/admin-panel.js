const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const members = (team) => `${e(team.teamNumber)} · ${team.members.map((member) => `${e(member.nickname)} · ${e(member.staffShortId)}`).join("、")}`;

export function renderAdmin(root, state, api, controls) {
  if (!controls.hasAdmin) {
    root.innerHTML = `<div class="admin-shell admin-gate"><header class="admin-top"><div><strong>⚽ 管理后台</strong></div></header><section class="admin-empty"><h1>请从 Staff 工作台进入</h1><p>在“更多”中验证 Admin PIN 后进入。</p><button data-action="return-staff">返回 Staff 工作台</button></section></div>`;
    root.querySelector("[data-action='return-staff']")?.addEventListener("click", controls.returnToStaff);
    return;
  }
  const ui = controls.ui; const section = ui.section || "activity";
  const sections = { activity: activityPanel(state), resources: resourcesPanel(state, ui), competition: competitionPanel(state, ui), records: recordsPanel(state) };
  root.innerHTML = `<div class="admin-shell"><header class="admin-top"><div><strong>⚽ 管理后台</strong></div><div class="top-actions"><button class="text-button" data-feedback>反馈</button><button class="text-button" data-action="return-staff">返回 Staff</button></div></header><main><section class="admin-heading"><h1>活动设置与例外处理</h1><p>人员、队伍、发码、练习赛确认与赛果录入在 Staff 工作台完成。</p></section><nav class="admin-nav">${[["activity", "活动设置"], ["resources", "资源管理"], ["competition", "比赛管理"], ["records", "反馈与记录"]].map(([id, label]) => `<button data-admin-section="${id}" class="${section === id ? "active" : ""}">${label}</button>`).join("")}</nav><section class="admin-panel">${sections[section]}</section></main><p class="notice" aria-live="polite"></p></div>`;
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
    if (button.dataset.action === "resource-diagnostics") return action(async () => { ui.resourceDiagnostics = await api.diagnostics(); }, "资源状态已核对。", button);
    if (button.dataset.action === "reclaim-code" && window.confirm("确认回收此已消耗 Code，并重新放回可发放池吗？")) return action(() => api.reclaimCode(button.dataset.teamId), "Code 已回收至可发放池。", button);
    if (button.dataset.action === "backfill-game-portal-codes" && window.confirm(`确认按原 Workshop Code 发放顺序，为前 ${Math.min((state.gamePortalBackfillTeams || []).length, state.codeSummary?.gamePortal?.available || 0)} 支旧队补发 Game Portal Code 吗？`)) return action(async () => { const result = await api.backfillGamePortalCodes(); return result; }, "已为旧队补发 Game Portal Code。", button);
    if (button.dataset.action === "revoke-qualification" && window.confirm("确认撤销该队参赛资格吗？")) { const note = window.prompt("撤销原因（可留空）", ""); if (note !== null) return action(() => api.revokeQualification(button.dataset.teamId, note), "已撤销参赛资格。", button); }
    if (button.dataset.action === "unfreeze" && window.confirm("确认解除比赛名单冻结吗？")) return action(() => api.unfreezeCompetition(), "比赛名单已解除冻结。", button);
    if (button.dataset.action === "void-tournament" && window.confirm("确认作废当前赛程并重新开始分组吗？")) { const reason = window.prompt("作废原因（可留空）", ""); if (reason !== null) return action(() => api.voidTournament(reason), "赛程已作废。", button); }
    if (button.dataset.action === "rebuild-knockout" && window.confirm("确认保留当前轮次赛果，并重新生成后续淘汰赛吗？")) return action(() => api.rebuildKnockout(), "后续淘汰赛已按当前胜者重建。", button);
    if (button.dataset.action === "group-reset") { resetGroupDraft(ui, state.tournament); return renderAdmin(root, state, api, controls); }
    if (button.dataset.groupTeam) { ui.groupSelectedTeamId = ui.groupSelectedTeamId === button.dataset.groupTeam ? "" : button.dataset.groupTeam; ui.groupBoardError = ""; return renderAdmin(root, state, api, controls); }
    if (button.dataset.groupMoveTarget) {
      const moved = moveTeamInDraft(ui, button.dataset.groupMoveTarget, ui.groupSelectedTeamId);
      if (!moved) return renderAdmin(root, state, api, controls);
      ui.groupSelectedTeamId = ""; return renderAdmin(root, state, api, controls);
    }
    if (button.dataset.action === "group-save") {
      const draft = ui.groupDraft || [];
      return action(async () => { await api.updateTournamentGroups(draft); ui.groupDraft = null; ui.groupDraftTournamentId = ""; ui.groupSelectedTeamId = ""; ui.groupBoardError = ""; }, "分组已保存，未开始的小组赛赛程已重排。", button);
    }
  });
  root.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-group-team]"); if (!card) return;
    ui.groupDragTeamId = card.dataset.groupTeam; ui.groupSelectedTeamId = card.dataset.groupTeam;
    event.dataTransfer?.setData("text/plain", card.dataset.groupTeam);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  root.addEventListener("dragover", (event) => {
    const lane = event.target.closest("[data-group-drop]"); if (!lane) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; lane.classList.add("is-drag-over");
  });
  root.addEventListener("dragleave", (event) => event.target.closest("[data-group-drop]")?.classList.remove("is-drag-over"));
  root.addEventListener("dragend", () => { ui.groupDragTeamId = ""; root.querySelectorAll(".is-drag-over").forEach((lane) => lane.classList.remove("is-drag-over")); });
  root.addEventListener("drop", (event) => {
    const lane = event.target.closest("[data-group-drop]"); if (!lane) return;
    event.preventDefault(); const participant = event.dataTransfer?.getData("text/plain") || ui.groupDragTeamId || ui.groupSelectedTeamId;
    const targetCard = event.target.closest("[data-group-team]");
    lane.classList.remove("is-drag-over"); if (!moveTeamInDraft(ui, lane.dataset.groupDrop, participant, targetCard?.dataset.groupTeam || "")) return renderAdmin(root, state, api, controls);
    ui.groupSelectedTeamId = ""; ui.groupDragTeamId = ""; renderAdmin(root, state, api, controls);
  });
  root.querySelector("#admin-event-settings")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); const gates = { selfServiceTeam: form.has("selfServiceTeam"), codeIssuance: form.has("codeIssuance"), qualification: form.has("qualification"), scheduleEditing: form.has("scheduleEditing"), publicMaintenanceSnapshot: form.has("publicMaintenanceSnapshot") }; return action(async () => { await api.setEventLinks(form.get("workshopUrl"), form.get("gamePortalUrl")); await api.updateEventGates(gates); }, "活动设置已保存。", event.target.querySelector("button")); });
  root.querySelector("#admin-import-codes")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); const parse = (name) => String(form.get(name) || "").split(/\r?\n/).map((code) => code.trim()).filter(Boolean); const workshopCodes = parse("workshopCodes"), gamePortalCodes = parse("gamePortalCodes"); return action(() => api.importResourceCodes({ workshopCodes, gamePortalCodes }), `已导入 Workshop ${workshopCodes.length} 个、Game Portal ${gamePortalCodes.length} 个 Code。`, event.target.querySelector("button")); });
  root.querySelector("#admin-freeze-roster")?.addEventListener("submit", (event) => { event.preventDefault(); const ids = [...new FormData(event.target).getAll("teamId")]; if (ids.length < 2) { notice.textContent = "至少选择 2 支队伍后才能冻结名单。"; return; } return action(async () => { await api.freezeCompetition(ids); ui.competitionNotice = `已冻结 ${ids.length} 支队伍。下一步：设置小组数量并生成小组赛。`; }, "比赛名单已冻结。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-groups")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); return action(async () => { await api.tournament(Number(form.get("groupCount")), Number(form.get("qualifiersPerGroup"))); ui.competitionNotice = "已生成分组草稿。确认无误后保存；Staff 再开始录入赛果。"; }, "分组草稿已生成。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-knockout")?.addEventListener("submit", (event) => { event.preventDefault(); return action(() => api.generateKnockout(), "淘汰赛对阵已生成。", event.target.querySelector("button")); });
}

function activityPanel(state) {
  const gates = state.event?.gates || {};
  const row = (name, title, hint) => `<label class="admin-check"><input type="checkbox" name="${name}" ${gates[name] !== false ? "checked" : ""}><span><strong>${title}</strong><small>${hint}</small></span></label>`;
  return `<section class="admin-section"><div><h2>链接与阶段开关</h2><p>链接会同步到已领 Code 的参赛者页面；关闭入口后，Staff 无法执行对应阶段动作。</p></div><form id="admin-event-settings" class="admin-form"><label>Workshop 链接<input name="workshopUrl" type="url" required value="${e(state.event.workshopUrl)}"></label><label>Game Portal 链接<input name="gamePortalUrl" type="url" required value="${e(state.event.gamePortalUrl)}"></label><fieldset><legend>活动阶段</legend>${row("selfServiceTeam", "临时开放自助组队", "默认关闭；仅配合专用入口使用")}${row("codeIssuance", "允许发放 Code", "关闭后，Staff 不能向新队伍发放资源")}${row("qualification", "允许确认参赛资格", "关闭后，TA 不能确认新的比赛队伍")}${row("scheduleEditing", "允许赛程编辑", "关闭后，不能冻结、调整或作废赛程")}</fieldset><fieldset><legend>临时维护</legend>${row("publicMaintenanceSnapshot", "公开维护快照", "仅供现场核对；会列出全部队伍与原始 Code，活动结束后请关闭")}</fieldset><button>保存活动设置</button></form></section>`;
}

function resourcesPanel(state, ui) {
  const summary = state.codeSummary || { workshop: { total: 0, available: 0, issued: 0 }, gamePortal: { total: 0, available: 0, issued: 0 }, pairsAvailable: 0, pairsIssued: 0 }; const reclaimable = state.reclaimableTeams || []; const backfill = state.gamePortalBackfillTeams || []; const canBackfill = backfill.length && summary.gamePortal.available;
  const metric = (label, counts) => `<article><span>${label}</span><strong>${counts.available} / ${counts.total}</strong><small>已发 ${counts.issued}</small></article>`;
  const diagnostics = ui.resourceDiagnostics;
  const diagnosticCard = diagnostics ? `<section class="admin-subsection resource-diagnostics"><h3>当前资源核对</h3><p class="${diagnostics.integrity === "ok" ? "diagnostic-ok" : "diagnostic-attention"}">${diagnostics.integrity === "ok" ? "数据引用一致" : "发现需要处理的数据引用"}</p><dl><div><dt>有效队伍</dt><dd>${diagnostics.activeTeams}</dd></div><div><dt>未领 Workshop</dt><dd>${diagnostics.workshop.activeTeamsMissingCode.length}</dd></div><div><dt>未领 Game Portal</dt><dd>${diagnostics.gamePortal.activeTeamsMissingCode.length}</dd></div><div><dt>异常绑定</dt><dd>${diagnostics.workshop.orphanAssignments + diagnostics.gamePortal.orphanAssignments + diagnostics.workshop.activeTeamsWithInvalidReference.length + diagnostics.gamePortal.activeTeamsWithInvalidReference.length}</dd></div></dl>${diagnostics.workshop.activeTeamsMissingCode.length ? `<p class="hint">未领 Workshop：${e(diagnostics.workshop.activeTeamsMissingCode.join("、"))}</p>` : ""}${diagnostics.gamePortal.activeTeamsMissingCode.length ? `<p class="hint">未领 Game Portal：${e(diagnostics.gamePortal.activeTeamsMissingCode.join("、"))}</p>` : ""}</section>` : "";
  return `<section class="admin-section"><div><h2>官方 Code 与回收</h2><p>导入只创建可用资源；发放后才会与队伍绑定。</p><button type="button" class="secondary" data-action="resource-diagnostics">只读核对当前资源</button></div>${diagnosticCard}<section class="admin-metrics">${metric("Workshop 可用", summary.workshop)}${metric("Game Portal 可用", summary.gamePortal)}<article><span>可发放 Workshop</span><strong>${summary.workshop.available}</strong><small>不受 Game Portal Code 影响</small></article></section><form id="admin-import-codes" class="admin-form"><label>Workshop Code<textarea name="workshopCodes" rows="5" placeholder="每行一个真实 Workshop Code"></textarea></label><label>Game Portal Code（可稍后导入）<textarea name="gamePortalCodes" rows="5" placeholder="每行一个真实 Game Portal Code"></textarea></label><button>导入已填写的 Code</button></form><section class="admin-subsection"><h3>补发旧队的 Game Portal Code</h3><p>${backfill.length ? `有 ${backfill.length} 支有效队伍已领 Workshop Code、尚未领 Game Portal Code。将按原 Workshop Code 发放顺序补发。` : "没有需要补发的旧队。"}</p>${backfill.length ? `<p class="hint">本次可补发 ${Math.min(backfill.length, summary.gamePortal.available)} 支；剩余 ${Math.max(0, backfill.length - summary.gamePortal.available)} 支会保留在待补发列表。</p><button data-action="backfill-game-portal-codes" ${canBackfill ? "" : "disabled"}>批量补发 Game Portal Code</button>` : ""}</section><section class="admin-subsection"><h3>待处理的已消耗 Code</h3><div class="admin-list">${reclaimable.map((team) => `<article><div><strong>${members(team)}</strong><small>队伍已解散；已发放 Code 仍保留为已消耗。</small></div><button data-action="reclaim-code" data-team-id="${e(team.id)}" class="secondary">回收 Code</button></article>`).join("") || '<p class="hint">暂无待回收 Code。</p>'}</div></section></section>`;
}

function competitionPanel(state, ui) {
  const eligible = state.teams.filter((team) => team.qualificationStatus === "ta_qualified"); const frozen = state.competition?.frozenTeamIds || []; const tournament = state.tournament;
  const progress = ui.competitionNotice ? `<p class="admin-flow-notice" role="status">${e(ui.competitionNotice)}</p>` : "";
  if (!frozen.length && !tournament) return `<section class="admin-section">${progress}<div><h2>冻结参赛名单</h2><p>仅 TA 已确认的队伍可进入比赛。冻结后，可在这里生成小组赛。</p></div><form id="admin-freeze-roster" class="admin-form">${eligible.map((team) => `<label class="check-row"><input type="checkbox" name="teamId" value="${e(team.id)}" checked>${members(team)}</label>`).join("") || '<p class="hint">暂无已确认队伍。</p>'}<button ${eligible.length < 2 ? "disabled" : ""}>冻结名单</button></form>${qualificationExceptions(eligible)}</section>`;
  if (frozen.length && !tournament) {
    const minimumGroups = Math.ceil(frozen.length / 4); const defaultGroups = Math.min(8, Math.ceil(frozen.length / 4));
    return `<section class="admin-section">${progress}<div><h2>已冻结 ${frozen.length} 支队伍</h2><p>每组最多 4 队。32 队时固定为 8 组，每队踢 3 场，前 2 名晋级。</p></div><form id="admin-generate-groups" class="admin-form"><label>小组数量<input name="groupCount" type="number" min="${minimumGroups}" max="${Math.min(8, frozen.length)}" value="${defaultGroups}"></label><label>每组晋级<select name="qualifiersPerGroup"><option value="2">前 2 名</option><option value="1">前 1 名</option></select></label><button>生成分组草稿</button></form><button data-action="unfreeze" class="secondary">解除名单冻结</button>${qualificationExceptions(eligible)}</section>`;
  }
  const canEditGroups = tournament.status === "group" && !tournament.matches.some((match) => match.status === "completed");
  const board = canEditGroups ? groupBoard(tournament, ui) : "";
  const hasBrokenFutureRound = tournament.status === "knockout" && tournament.knockoutMatches?.some((match) => match.round > 1 && match.status === "bye" && match.teamAId && match.teamBId);
  const repair = hasBrokenFutureRound ? `<section class="admin-subsection"><h3>修复下一轮</h3><p>保留已完成的当前轮次赛果，按胜者重新生成后续淘汰赛。</p><button type="button" data-action="rebuild-knockout">重新生成下一轮</button></section>` : "";
  return `<section class="admin-section">${progress}<div><h2>${tournament.status === "knockout" ? "淘汰赛已生成" : "小组赛"}</h2><p>${canEditGroups ? "确认分组后，保存并开始由 Staff 录入赛果。" : "Staff 录入赛果；这里可生成淘汰赛或作废赛程。"}</p></div><div class="admin-competition-links"><a href="/staff">打开 Staff 赛果录入</a><a href="/display" target="_blank" rel="noreferrer">打开现场大屏</a></div>${board}${repair}${tournament.status === "group" && !tournament.knockoutMatches?.length ? `<form id="admin-generate-knockout" class="admin-form"><button ${tournament.matches.some((match) => match.status !== "completed") ? "disabled" : ""}>生成淘汰赛</button></form>` : ""}<button data-action="void-tournament" class="secondary">作废并重新分组</button>${qualificationExceptions(eligible)}</section>`;
}

function cloneGroups(groups) { return groups.map((group) => ({ id: group.id, teamIds: [...group.teamIds] })); }
function resetGroupDraft(ui, tournament) { if (!tournament) return; ui.groupDraft = cloneGroups(tournament.groups); ui.groupDraftTournamentId = tournament.id; ui.groupSelectedTeamId = ""; ui.groupDragTeamId = ""; ui.groupBoardError = ""; }
function draftFor(ui, tournament) { if (ui.groupDraftTournamentId !== tournament.id || !Array.isArray(ui.groupDraft)) resetGroupDraft(ui, tournament); return ui.groupDraft; }
function sameGroups(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
function teamNumber(tournament, teamId) {
  const row = tournament.groups.flatMap((group) => group.standings || []).find((standing) => standing.teamId === teamId);
  return row?.label || "队伍";
}
function moveTeamInDraft(ui, targetGroupId, teamId, swapWithId = "") {
  if (!teamId || !ui.groupDraft) return false;
  const source = ui.groupDraft.find((group) => group.teamIds.includes(teamId)); const target = ui.groupDraft.find((group) => group.id === targetGroupId);
  if (!source || !target || source.id === target.id) return false;
  if (target.teamIds.length >= 4) {
    if (!swapWithId || !target.teamIds.includes(swapWithId) || swapWithId === teamId) { ui.groupBoardError = `${target.id} 组已满；请拖到该组的一支队伍卡上以交换。`; return false; }
    const sourceIndex = source.teamIds.indexOf(teamId); const targetIndex = target.teamIds.indexOf(swapWithId);
    source.teamIds[sourceIndex] = swapWithId; target.teamIds[targetIndex] = teamId; ui.groupBoardError = ""; return true;
  }
  if (source.teamIds.length <= 1) { ui.groupBoardError = `${source.id} 组至少保留 1 队。`; return false; }
  source.teamIds = source.teamIds.filter((id) => id !== teamId); target.teamIds = [...target.teamIds, teamId]; ui.groupBoardError = ""; return true;
}
function groupBoard(tournament, ui) {
  const draft = draftFor(ui, tournament); const changed = !sameGroups(draft, tournament.groups);
  const selected = ui.groupSelectedTeamId; const selectedLabel = selected ? teamNumber(tournament, selected) : "";
  const lane = (group) => `<section class="group-board-lane" data-group-drop="${e(group.id)}"><header><strong>${e(group.id)} 组</strong><span>${group.teamIds.length} / 4</span></header><div class="group-board-cards">${group.teamIds.map((teamId) => `<button type="button" draggable="true" data-group-team="${e(teamId)}" class="group-team-card ${selected === teamId ? "selected" : ""}" aria-pressed="${selected === teamId}"><strong>${e(teamNumber(tournament, teamId))}</strong><small>拖动或点选</small></button>`).join("")}</div>${selected && !group.teamIds.includes(selected) && group.teamIds.length < 4 ? `<button type="button" class="group-board-move" data-group-move-target="${e(group.id)}">将 ${e(selectedLabel)} 移到此组</button>` : ""}</section>`;
  return `<section class="group-board"><div class="group-board-heading"><div><h3>分组编排</h3><p>拖到空位可移动；拖到满组的一支队伍卡可交换。每组最多 4 队。</p></div><div class="group-board-actions"><span class="${changed ? "dirty" : ""}">${changed ? "未保存" : "已保存"}</span><button type="button" class="secondary" data-action="group-reset" ${changed ? "" : "disabled"}>恢复已保存分组</button><button type="button" data-action="group-save" ${changed ? "" : "disabled"}>保存分组并重排赛程</button></div></div>${ui.groupBoardError ? `<p class="group-board-error" role="status">${e(ui.groupBoardError)}</p>` : ""}<div class="group-board-scroll"><div class="group-board-lanes">${draft.map(lane).join("")}</div></div></section>`;
}

function qualificationExceptions(teams) { return `<section class="admin-subsection"><h3>撤销参赛资格</h3><div class="admin-list">${teams.map((team) => `<article><div><strong>${members(team)}</strong><small>仅处理误确认或现场例外。</small></div><button data-action="revoke-qualification" data-team-id="${e(team.id)}" class="secondary">撤销</button></article>`).join("") || '<p class="hint">暂无可处理队伍。</p>'}</div></section>`; }

function recordsPanel(state) {
  const feedback = state.feedback || []; const log = state.auditLog || [];
  return `<section class="admin-section"><div><h2>反馈收件箱</h2><p>仅 Admin 可见。</p></div><section class="admin-subsection"><h3>参赛者与 Staff 反馈</h3><div class="admin-list">${feedback.map((item) => `<article><div><strong>${e(item.actorLabel)} · ${e(item.page)}</strong><small>${e(new Date(item.createdAt).toLocaleString("zh-CN"))}</small><p>${e(item.note)}</p></div></article>`).join("") || '<p class="hint">暂无反馈。</p>'}</div></section><section class="admin-subsection"><h3>最近操作记录</h3><div class="admin-list">${log.map((item) => `<article><div><strong>${e(item.action)}</strong><small>${e(item.staffNickname)} · ${e(new Date(item.at).toLocaleString("zh-CN"))}${item.reason ? ` · ${e(item.reason)}` : ""}</small></div></article>`).join("") || '<p class="hint">暂无操作记录。</p>'}</div></section></section>`;
}
