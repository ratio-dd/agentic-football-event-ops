const e = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const members = (team) => `${e(team.teamNumber)} · ${team.members.map((member) => e(member.nickname)).join("、")}`;

export function renderAdmin(root, state, api, controls) {
  if (!controls.hasAdmin) {
    root.innerHTML = `<div class="admin-shell admin-gate"><header class="admin-top"><div><strong>⚽ 管理后台</strong></div></header><section class="admin-empty"><h1>请从 Staff 工作台进入</h1><p>在“更多”中验证 Admin PIN 后进入。</p><button data-action="return-staff">返回 Staff 工作台</button></section></div>`;
    root.querySelector("[data-action='return-staff']")?.addEventListener("click", controls.returnToStaff);
    return;
  }
  const ui = controls.ui; const section = ui.section || "activity";
  const sections = { activity: activityPanel(state), resources: resourcesPanel(state, ui), competition: competitionPanel(state, ui), records: recordsPanel(state) };
  root.innerHTML = `<div class="admin-shell"><header class="admin-top"><div><strong>⚽ 管理后台</strong></div><div class="top-actions"><button class="text-button" data-feedback>反馈</button><button class="text-button" data-action="return-staff">返回 Staff</button></div></header><main><section class="admin-heading"><h1>活动设置与例外处理</h1><p>人员、队伍、发码、练习赛确认与赛果录入在 Staff 工作台完成。</p></section><nav class="admin-nav">${[["activity", "活动设置"], ["resources", "资源管理"], ["competition", "比赛管理"], ["records", "反馈与记录"]].map(([id, label]) => `<button data-admin-section="${id}" class="${section === id ? "active" : ""}">${label}</button>`).join("")}</nav><section class="admin-panel">${sections[section]}</section>${resetPanel(state)}</main><p class="notice" aria-live="polite"></p>${archiveResetModal(state, ui)}</div>`;
  const notice = root.querySelector(".notice"); const action = async (fn, ok, trigger) => {
    if (ui.pending) return; ui.pending = true; const original = trigger?.textContent; if (trigger) { trigger.disabled = true; trigger.textContent = "正在保存…"; }
    try { const result = await fn(); await controls.refresh(); const current = document.querySelector(".notice"); if (current) current.textContent = typeof ok === "function" ? ok(result) : ok; }
    catch (error) { notice.textContent = error.message; window.alert(error.message); }
    finally { ui.pending = false; if (trigger?.isConnected) { trigger.disabled = false; trigger.textContent = original; } }
  };
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.adminSection) { ui.section = button.dataset.adminSection; return renderAdmin(root, state, api, controls); }
    if (button.dataset.action === "return-staff") return controls.returnToStaff();
    if (button.dataset.action === "archive-reset-event") {
      ui.archiveResetStep = 1; return renderAdmin(root, state, api, controls);
    }
    if (button.dataset.action === "archive-reset-close") { ui.archiveResetStep = 0; return renderAdmin(root, state, api, controls); }
    if (button.dataset.action === "archive-reset-continue") { ui.archiveResetStep = 2; return renderAdmin(root, state, api, controls); }
    if (button.dataset.action === "resource-diagnostics") return action(async () => { ui.resourceDiagnostics = await api.diagnostics(); }, "资源状态已核对。", button);
    if (button.dataset.action === "batch-select-all") {
      const inputs = [...root.querySelectorAll("#admin-batch-issue input[name='teamId']")]; const selectAll = !inputs.every((input) => input.checked);
      inputs.forEach((input) => { input.checked = selectAll; }); button.textContent = selectAll ? "取消全选" : "全选"; return;
    }
    if (button.dataset.action === "reclaim-code" && window.confirm("确认回收此已消耗 Code，并重新放回可发放池吗？")) return action(() => api.reclaimCode(button.dataset.teamId), "Code 已回收至可发放池。", button);
    if (button.dataset.action === "revoke-qualification" && window.confirm("确认撤销该队参赛资格吗？")) { const note = window.prompt("撤销原因（可留空）", ""); if (note !== null) return action(() => api.revokeQualification(button.dataset.teamId, note), "已撤销参赛资格。", button); }
    if (button.dataset.action === "unfreeze" && window.confirm("确认解除比赛名单冻结吗？")) return action(() => api.unfreezeCompetition(), "比赛名单已解除冻结。", button);
    if (button.dataset.action === "void-tournament" && window.confirm("确认作废当前赛程并重新开始分组吗？")) { const reason = window.prompt("作废原因（可留空）", ""); if (reason !== null) return action(() => api.voidTournament(reason), "赛程已作废。", button); }
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
  root.querySelector("#admin-event-settings")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); const gates = { selfServiceTeam: form.has("selfServiceTeam"), codeIssuance: form.has("codeIssuance"), qualification: form.has("qualification"), scheduleEditing: form.has("scheduleEditing"), publicMaintenanceSnapshot: form.has("publicMaintenanceSnapshot") }; return action(() => api.updateEventSettings({ name: form.get("name"), maxWorkshopTeams: Number(form.get("maxWorkshopTeams")), workshopUrl: form.get("workshopUrl"), gamePortalUrl: form.get("gamePortalUrl"), gates }), "活动设置已保存。", event.target.querySelector("button")); });
  root.querySelector("#admin-import-codes")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.target); const gamePortalCodes = String(form.get("gamePortalCodes") || "").split(/\r?\n/).map((code) => code.trim()).filter(Boolean); return action(() => api.importResourceCodes({ gamePortalCodes }), (result) => { const gamePortal = result.imported.gamePortal; return `已新增 Game Portal ${gamePortal.added} 个${gamePortal.duplicates ? `；跳过重复 ${gamePortal.duplicates} 个` : ""}。`; }, event.target.querySelector("button")); });
  root.querySelector("#admin-batch-issue")?.addEventListener("submit", (event) => { event.preventDefault(); const teamIds = [...new FormData(event.target).getAll("teamId")]; if (!teamIds.length) { notice.textContent = "请至少选择一支待发放队伍。"; return; } return action(() => api.batchIssueCodes(teamIds), `已向 ${teamIds.length} 支队伍发放 Game Portal Code。`, event.target.querySelector("button[type='submit']")); });
  root.querySelector("#admin-freeze-roster")?.addEventListener("submit", (event) => { event.preventDefault(); const ids = [...new FormData(event.target).getAll("teamId")]; if (ids.length < 4) { notice.textContent = "至少选择 4 支队伍后才能冻结名单。"; return; } return action(async () => { await api.freezeCompetition(ids); ui.competitionNotice = `已冻结 ${ids.length} 支队伍。下一步：自动生成小组赛。`; }, "比赛名单已冻结。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-groups")?.addEventListener("submit", (event) => { event.preventDefault(); return action(async () => { await api.tournament(); ui.competitionNotice = "已按实际队数自动生成分组草稿。确认位置后保存；Staff 再开始录入赛果。"; }, "分组草稿已生成。", event.target.querySelector("button")); });
  root.querySelector("#admin-advance-group-round")?.addEventListener("submit", (event) => { event.preventDefault(); return action(() => api.advanceGroupRound(), "当前轮次已结束，下一轮已开放。", event.target.querySelector("button")); });
  root.querySelector("#admin-advance-knockout-round")?.addEventListener("submit", (event) => { event.preventDefault(); return action(() => api.advanceKnockoutRound(), "当前淘汰赛轮次已结束，下一轮已开放。", event.target.querySelector("button")); });
  root.querySelector("#admin-generate-knockout")?.addEventListener("submit", (event) => { event.preventDefault(); return action(() => api.generateKnockout(), "淘汰赛对阵已生成。", event.target.querySelector("button")); });
  const archiveConfirmation = root.querySelector("#admin-archive-reset-confirm input[name='archiveConfirmation']");
  archiveConfirmation?.addEventListener("input", () => {
    const matches = archiveConfirmation.value.trim() === state.event.name;
    archiveConfirmation.setAttribute("aria-invalid", matches || !archiveConfirmation.value ? "false" : "true");
    const error = root.querySelector(".archive-reset-error"); if (error) error.textContent = archiveConfirmation.value && !matches ? "活动名称尚未完全匹配。" : "";
  });
  root.querySelector("#admin-archive-reset-confirm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const input = event.target.elements.archiveConfirmation; const confirmation = input.value.trim(); const error = event.target.querySelector(".archive-reset-error");
    if (confirmation !== state.event.name) { error.textContent = `请输入完整活动名称“${state.event.name}”。`; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
    if (ui.pending) return; ui.pending = true; const button = event.target.querySelector("button[type='submit']"); const original = button.textContent; button.disabled = true; button.textContent = "正在归档并重置…"; error.textContent = "";
    try {
      const result = await api.archiveAndResetEvent(confirmation); ui.archiveResetStep = 0; await controls.refresh();
      const current = document.querySelector(".notice"); if (current) current.textContent = `已归档 ${result.archive.counts.participants} 位参与者、${result.archive.counts.teams} 支队伍，并重置当前活动。`;
    } catch (failure) { error.textContent = failure.message; }
    finally { ui.pending = false; if (button.isConnected) { button.disabled = false; button.textContent = original; } }
  });
}

function activityPanel(state) {
  const gates = state.event?.gates || {};
  const row = (name, title, hint) => `<label class="admin-check"><input type="checkbox" name="${name}" ${gates[name] !== false ? "checked" : ""}><span><strong>${title}</strong><small>${hint}</small></span></label>`;
  return `<section class="admin-section"><div><h2>活动、容量与阶段开关</h2><p>活动名称和链接同步到现场页面；产生业务数据后，队伍上限只能增加。</p></div><form id="admin-event-settings" class="admin-form"><label>活动名称<input name="name" maxlength="80" required value="${e(state.event.name)}"></label><label>活动队伍上限<input name="maxWorkshopTeams" type="number" min="4" max="256" required value="${state.event.maxWorkshopTeams}"></label><label>Workshop 进入 URL<input name="workshopUrl" type="url" required value="${e(state.event.workshopUrl)}"></label><label>Game Portal 进入 URL<input name="gamePortalUrl" type="url" required value="${e(state.event.gamePortalUrl)}"></label><fieldset><legend>活动阶段</legend>${row("selfServiceTeam", "临时开放自助组队", "默认关闭；仅配合专用入口使用")}${row("codeIssuance", "允许发放 Game Portal Code", "关闭后，Staff 不能向新队伍发放 Game Portal Code")}${row("qualification", "允许确认参赛资格", "关闭后，TA 不能确认新的比赛队伍")}${row("scheduleEditing", "允许赛程编辑", "关闭后，不能冻结、调整或作废赛程")}</fieldset><fieldset><legend>临时维护</legend>${row("publicMaintenanceSnapshot", "公开维护快照", "仅供现场核对；会列出全部队伍与 Game Portal Code，活动结束后请关闭")}</fieldset><button>保存活动设置</button></form></section>`;
}

function resourcesPanel(state, ui) {
  const summary = state.codeSummary || { gamePortal: { total: 0, available: 0, issued: 0 } }; const reclaimable = state.reclaimableTeams || [];
  const unissued = (state.teams || []).filter((team) => team.status !== "dissolved" && !team.gamePortalCodeId);
  const metric = (label, counts) => `<article><span>${label}</span><strong>${counts.available} 可用</strong><small>总计 ${counts.total} · 已发 ${counts.issued}</small></article>`;
  const diagnostics = ui.resourceDiagnostics;
  const diagnosticCard = diagnostics ? `<section class="admin-subsection resource-diagnostics"><h3>当前资源核对</h3><p class="${diagnostics.integrity === "ok" ? "diagnostic-ok" : "diagnostic-attention"}">${diagnostics.integrity === "ok" ? "数据引用一致" : "发现需要处理的数据引用"}</p><dl><div><dt>有效队伍</dt><dd>${diagnostics.activeTeams}</dd></div><div><dt>未领 Game Portal Code</dt><dd>${diagnostics.gamePortal.activeTeamsMissingCode.length}</dd></div><div><dt>异常绑定</dt><dd>${diagnostics.gamePortal.orphanAssignments + diagnostics.gamePortal.activeTeamsWithInvalidReference.length}</dd></div></dl>${diagnostics.gamePortal.activeTeamsMissingCode.length ? `<p class="hint">未领 Game Portal Code：${e(diagnostics.gamePortal.activeTeamsMissingCode.join("、"))}</p>` : ""}</section>` : "";
  const batch = `<section class="admin-subsection"><h3>批量发放 Game Portal Code</h3><p>只列出有效且尚未发放的队伍。库存不足时整批不会执行。</p><form id="admin-batch-issue" class="admin-form"><div><button type="button" class="secondary" data-action="batch-select-all">取消全选</button></div>${unissued.map((team) => `<label class="check-row"><input type="checkbox" name="teamId" value="${e(team.id)}" checked>${members(team)}</label>`).join("") || '<p class="hint">暂无待发放队伍。</p>'}<button type="submit" ${!unissued.length ? "disabled" : ""}>向所选队伍发放 Game Portal Code</button></form></section>`;
  return `<section class="admin-section"><div><h2>Game Portal Code 与回收</h2><p>Workshop 使用活动设置中的统一入口；这里只管理每队独立的 Game Portal Code。</p><button type="button" class="secondary" data-action="resource-diagnostics">只读核对当前资源</button></div>${diagnosticCard}<section class="admin-metrics">${metric("Game Portal Code", summary.gamePortal)}</section><form id="admin-import-codes" class="admin-form"><label>Game Portal Code<textarea name="gamePortalCodes" rows="7" placeholder="每行一个真实 Game Portal Code"></textarea></label><button>导入已填写的 Code</button></form>${batch}<section class="admin-subsection"><h3>待处理的已消耗 Code</h3><div class="admin-list">${reclaimable.map((team) => `<article><div><strong>${members(team)}</strong><small>队伍已解散；已发放的 Game Portal Code 仍保留为已消耗。</small></div><button data-action="reclaim-code" data-team-id="${e(team.id)}" class="secondary">回收 Game Portal Code</button></article>`).join("") || '<p class="hint">暂无待回收 Code。</p>'}</div></section></section>`;
}

function competitionPanel(state, ui) {
  const eligible = state.teams.filter((team) => team.qualificationStatus === "ta_qualified"); const frozen = state.competition?.frozenTeamIds || []; const tournament = state.tournament;
  const progress = ui.competitionNotice ? `<p class="admin-flow-notice" role="status">${e(ui.competitionNotice)}</p>` : "";
  if (!frozen.length && !tournament) return `<section class="admin-section">${progress}<div><h2>冻结参赛名单</h2><p>仅 TA 已确认的队伍可进入比赛；参赛队数支持 4 至资源上限。</p></div><form id="admin-freeze-roster" class="admin-form">${eligible.map((team) => `<label class="check-row"><input type="checkbox" name="teamId" value="${e(team.id)}" checked>${members(team)}</label>`).join("") || '<p class="hint">暂无已确认队伍。</p>'}<button ${eligible.length < 4 ? "disabled" : ""}>冻结名单</button></form>${qualificationExceptions(eligible)}</section>`;
  if (frozen.length && !tournament) {
    return `<section class="admin-section">${progress}<div><h2>已冻结 ${frozen.length} 支队伍</h2><p>系统会按实际队数自动生成 1 / 2 / 4 / 8… 个小组，每组 2–4 队、固定前 2 名晋级。Admin 只需调整队伍位置。</p></div><form id="admin-generate-groups" class="admin-form"><button>自动生成分组草稿</button></form><button data-action="unfreeze" class="secondary">解除名单冻结</button>${qualificationExceptions(eligible)}</section>`;
  }
  const canEditGroups = tournament.status === "group" && !tournament.matches.some((match) => match.status === "completed");
  const board = canEditGroups ? groupBoard(tournament, ui) : "";
  const currentRound = Number(tournament.currentGroupRound) || 1; const totalRounds = Number(tournament.totalGroupRounds) || 1;
  const currentMatches = tournament.matches.filter((match) => (Number(match.round) || 1) === currentRound); const currentComplete = currentMatches.length > 0 && currentMatches.every((match) => match.status === "completed");
  const knockoutRound = Number(tournament.currentKnockoutRound) || 1; const knockoutTotal = Number(tournament.totalKnockoutRounds) || 1;
  const knockoutMatches = (tournament.knockoutMatches || []).filter((match) => (Number(match.round) || 1) === knockoutRound); const knockoutComplete = knockoutMatches.length > 0 && knockoutMatches.every((match) => Boolean(match.winnerId));
  const roundAction = tournament.status === "group" && currentRound < totalRounds
    ? `<form id="admin-advance-group-round" class="admin-form"><p>当前第 ${currentRound} / ${totalRounds} 轮；本轮完成 ${currentMatches.filter((match) => match.status === "completed").length} / ${currentMatches.length} 场。</p><button ${currentComplete ? "" : "disabled"}>本轮结束，进入下一轮</button></form>`
    : tournament.status === "knockout" && knockoutRound < knockoutTotal
      ? `<form id="admin-advance-knockout-round" class="admin-form"><p>淘汰赛第 ${knockoutRound} / ${knockoutTotal} 轮；本轮决出 ${knockoutMatches.filter((match) => Boolean(match.winnerId)).length} / ${knockoutMatches.length} 个胜者。</p><button ${knockoutComplete ? "" : "disabled"}>本轮结束，进入下一轮</button></form>`
      : tournament.status === "knockout" && knockoutComplete ? '<p class="notice">淘汰赛已全部结束。</p>' : "";
  return `<section class="admin-section">${progress}<div><h2>${tournament.status === "knockout" ? `淘汰赛 · 第 ${knockoutRound} / ${knockoutTotal} 轮` : `小组赛 · 第 ${currentRound} / ${totalRounds} 轮`}</h2><p>${canEditGroups ? "确认分组后，保存并开始由 Staff 录入赛果。" : "Staff 仅能看到并录入当前轮；由 Admin 确认本轮结束后开放下一轮。"}</p></div><div class="admin-competition-links"><a href="/staff">打开 Staff 赛果录入</a><a href="/display" target="_blank" rel="noreferrer">打开现场大屏</a></div>${board}${roundAction}${tournament.status === "group" && !tournament.knockoutMatches?.length && currentRound >= totalRounds ? `<form id="admin-generate-knockout" class="admin-form"><button ${tournament.matches.some((match) => match.status !== "completed") ? "disabled" : ""}>生成淘汰赛</button></form>` : ""}<button data-action="void-tournament" class="secondary">作废并重新分组</button>${qualificationExceptions(eligible)}</section>`;
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

function resetPanel(state) {
  const archives = state.archives || [];
  const latest = archives[0];
  const archiveSummary = latest ? `<div class="admin-reset-history"><strong>最近归档</strong><span>${e(latest.eventName)} · ${e(new Date(latest.archivedAt).toLocaleString("zh-CN"))}</span><small>${latest.counts.participants} 位参与者 · ${latest.counts.teams} 支队伍 · Game Portal Code ${latest.counts.gamePortalCodes} 个</small></div>` : '<p class="hint">当前还没有归档记录。</p>';
  return `<section class="admin-reset-zone" aria-labelledby="admin-reset-heading"><div><p class="eyebrow">危险操作</p><h2 id="admin-reset-heading">归档并重置活动</h2><p>先完整归档当前参与者、队伍、Code、比赛、反馈和操作记录，再清空业务数据。活动名称、链接、容量、开关和当前登录状态会保留。</p></div>${archiveSummary}<button type="button" class="danger-button" data-action="archive-reset-event">归档并重置当前活动</button></section>`;
}

function archiveResetModal(state, ui) {
  if (!ui.archiveResetStep) return "";
  if (ui.archiveResetStep === 1) return `<div class="modal-backdrop"><section class="dispatch-modal archive-reset-modal" role="dialog" aria-modal="true" aria-labelledby="archive-reset-title"><div class="modal-header"><div><p class="modal-kicker">第一步，共两步</p><h2 id="archive-reset-title">确认归档当前活动？</h2></div><button type="button" class="text-button" data-action="archive-reset-close">关闭</button></div><div class="archive-reset-impact"><p>继续后还不会立即重置。请先确认本次操作的影响：</p><ul><li>归档 ${state.participants.length} 位参与者和 ${state.teams.length} 支队伍</li><li>归档全部 Workshop、Game Portal Code 和比赛记录</li><li>清空当前业务数据，但保留活动设置和登录状态</li></ul></div><div class="archive-reset-actions"><button type="button" class="secondary" data-action="archive-reset-close">取消</button><button type="button" class="danger-button" data-action="archive-reset-continue">我已了解，继续二次确认</button></div></section></div>`;
  return `<div class="modal-backdrop"><section class="dispatch-modal archive-reset-modal" role="dialog" aria-modal="true" aria-labelledby="archive-reset-confirm-title"><div class="modal-header"><div><p class="modal-kicker">第二步，共两步</p><h2 id="archive-reset-confirm-title">输入活动名称确认重置</h2></div><button type="button" class="text-button" data-action="archive-reset-close">关闭</button></div><form id="admin-archive-reset-confirm"><p>请输入完整活动名称：</p><strong class="archive-reset-event-name">${e(state.event.name)}</strong><label>活动名称<input name="archiveConfirmation" autocomplete="off" aria-invalid="false"></label><p class="archive-reset-error" role="alert"></p><div class="archive-reset-actions"><button type="button" class="secondary" data-action="archive-reset-close">取消</button><button type="submit" class="danger-button">确认归档并重置</button></div></form></section></div>`;
}
