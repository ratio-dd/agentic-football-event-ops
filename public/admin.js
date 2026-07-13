/**
 * Desktop admin workspace for the Beijing MeetUp MVP.
 *
 * The server remains the source of truth.  Every mutation in this module is
 * deliberately sent to the API, then the surrounding app is asked to refresh
 * its state before the next render.
 */

const ACTIONS = {
  checkIn: (teamId) => `/api/admin/teams/${encodeURIComponent(teamId)}/check-in`,
  seat: (teamId) => `/api/admin/teams/${encodeURIComponent(teamId)}/seat`,
  lock: (teamId) => `/api/admin/teams/${encodeURIComponent(teamId)}/lock`,
  eligibility: (teamId) => `/api/admin/teams/${encodeURIComponent(teamId)}/competition-approval`,
  generateTournament: '/api/admin/tournament/generate',
  result: (matchId) => `/api/admin/matches/${encodeURIComponent(matchId)}/result`,
};

const statusLabels = {
  draft: '草稿',
  waitlist: '候补',
  waitlisted: '候补',
  checked_in: '已签到',
  confirmed: '已确认',
  locked: '已锁队',
  cancelled: '已取消',
  workshop: 'Workshop 中',
  workshop_complete: 'Workshop 完成',
};

function text(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function count(value) {
  return Array.isArray(value) ? value.length : Number(value || 0);
}

function teamMembers(team) {
  return Array.isArray(team.members) ? team.members : [];
}

function teamName(team = {}) {
  return team.name || team.teamName || `队伍 ${String(team.id || '').slice(0, 6)}`;
}

function leaderName(team) {
  return team.leaderName || team.captainName || team.leader?.nickname || teamMembers(team).find((member) => member.isCaptain || member.isLeader || member.id === team.captainId)?.nickname || '未指定';
}

function seatLabel(team) {
  const seat = team.seat || team.seatAssignment || {};
  return team.tableLabel || seat.label || seat.tableName || seat.table?.label || seat.table?.name || team.table?.label || team.table?.name || team.tableName || team.seatId || '未分配';
}

function isCheckedIn(team) {
  return Boolean(team.checkedIn || team.checkedInAt || ['checked_in', 'confirmed', 'locked', 'workshop', 'workshop_complete'].includes(team.status));
}

function isLocked(team) {
  return Boolean(team.locked || team.lockedAt || ['locked', 'workshop', 'workshop_complete'].includes(team.status));
}

function eligible(team) {
  return Boolean(team.competitionApproved ?? team.competitionEligible ?? team.eligibleForCompetition ?? team.competition?.eligible);
}

function matchesFrom(state) {
  const tournament = state.tournament || {};
  return tournament.matches || state.matches || tournament.fixtures || [];
}

function tablesFrom(state) {
  return state.tables || state.seatTables || state.seating?.tables || [];
}

function templatesFrom(state) {
  const configured = state.tournamentTemplates || state.tournament?.templates;
  return Array.isArray(configured) && configured.length ? configured : [
    { id: 'groups-top2-knockout', name: '小组赛前二晋级淘汰赛' },
    { id: 'single-elimination', name: '单败淘汰赛' },
  ];
}

function logFrom(state) {
  return state.activityLog || state.auditLog || state.activities || [];
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }).format(date);
}

function errorMessage(error) {
  return error?.message || error?.error || '操作失败，请检查网络或当前队伍状态。';
}

async function adminCall(api, operation, args, method, path, body) {
  if (typeof api?.[operation] === 'function') return api[operation](...args);
  return request(api, method, path, body);
}

async function request(api, method, path, body) {
  // Keep the same small client shape used by participant.js: request(path,
  // { method, body }).  app.js owns auth/header injection in normal use.
  if (typeof api?.request === 'function') return api.request(path, { method, body });
  if (typeof api?.[method.toLowerCase()] === 'function') return api[method.toLowerCase()](path, body);
  if (typeof api === 'function') return api({ method, path, body });
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': 'meetup-admin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.message || '操作失败，请检查网络或当前队伍状态。');
  return result;
}

async function refresh(api, onStateChange) {
  let nextState;
  if (typeof api?.refresh === 'function') nextState = await api.refresh();
  else if (typeof api?.getState === 'function') nextState = await api.getState();
  else if (typeof api?.request === 'function') nextState = await api.request('/api/state', { method: 'GET' });
  else nextState = await request(null, 'GET', '/api/state');
  if (typeof onStateChange === 'function') onStateChange(nextState);
  return nextState;
}

function summary(state, teams) {
  const max = state.event?.maxWorkshopTeams || state.maxWorkshopTeams || 32;
  const checkedIn = teams.filter(isCheckedIn).length;
  const locked = teams.filter(isLocked).length;
  const waitlist = teams.filter((team) => team.status === 'waitlist' || team.status === 'waitlisted' || team.waitlisted).length;
  const eligibleTeams = teams.filter(eligible).length;
  const capacity = tablesFrom(state).reduce((total, table) => total + Number(table.capacity ?? table.totalCapacity ?? 0), 0);
  const usedSeats = tablesFrom(state).reduce((total, table) => total + Number(table.used ?? table.usedCapacity ?? table.occupiedSeats ?? 0), 0);
  const items = [
    ['签到占位', `${checkedIn} / ${max}`],
    ['已锁队', locked],
    ['候补', waitlist],
    ['比赛候选', eligibleTeams],
    ['桌位余量', capacity ? Math.max(0, capacity - usedSeats) : '待配置'],
  ];
  return `<section class="admin-summary" aria-label="活动总览">${items.map(([label, value]) => `<article class="admin-metric"><span>${text(label)}</span><strong>${text(value)}</strong></article>`).join('')}</section>`;
}

function teamTable(teams, selectedId) {
  const rows = teams.map((team) => {
    const size = team.memberCount ?? count(teamMembers(team));
    return `<tr data-team-row="${text(team.id)}" class="${team.id === selectedId ? 'is-selected' : ''}">
      <td><button type="button" class="link-button" data-action="select-team" data-team-id="${text(team.id)}">${text(teamName(team))}</button><small>${text(team.id || '')}</small></td>
      <td>${text(leaderName(team))}<br><small>${text(size)} 人</small></td>
      <td>${text(statusLabels[team.status] || team.status || '草稿')}</td>
      <td>${isCheckedIn(team) ? '已签到' : '未签到'}</td>
      <td>${text(seatLabel(team))}</td>
      <td>${eligible(team) ? '<span class="pill pill-positive">已确认</span>' : '<span class="pill">未确认</span>'}</td>
    </tr>`;
  }).join('');
  return `<section class="admin-panel admin-team-list"><div class="panel-heading"><div><p class="eyebrow">现场运营</p><h2>队伍与名额</h2></div><span>${teams.length} 支队伍</span></div>
    <div class="table-scroll"><table><thead><tr><th>队伍</th><th>队长 / 人数</th><th>状态</th><th>签到</th><th>桌位</th><th>比赛资格</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">暂时没有队伍</td></tr>'}</tbody></table></div></section>`;
}

function inspector(team, tables) {
  if (!team) return `<aside class="admin-panel admin-inspector"><p class="eyebrow">队伍检查器</p><h2>选择一支队伍</h2><p class="muted">从左侧队伍列表选择后，可完成签到、配桌、锁队、发放 Team Code 与比赛资格确认。</p></aside>`;
  const members = teamMembers(team).map((member) => `<li>${text(member.nickname || member.name || member.id)}${member.isCaptain || member.isLeader ? ' <span class="pill">队长</span>' : ''}</li>`).join('') || `<li class="muted">成员信息待补充</li>`;
  const tableOptions = tables.map((table) => {
    const label = table.label || table.name || table.id;
    const remaining = table.remaining ?? table.availableSeats ?? Math.max(0, Number(table.capacity ?? 0) - Number(table.used ?? table.occupiedSeats ?? 0));
    const current = table.id === (team.seat?.tableId || team.seatAssignment?.tableId || team.tableId);
    return `<option value="${text(table.id)}" ${current ? 'selected' : ''}>${text(label)}（余 ${text(remaining)}）</option>`;
  }).join('');
  const code = team.teamCode || team.code?.value;
  return `<aside class="admin-panel admin-inspector" data-selected-team="${text(team.id)}">
    <div class="panel-heading"><div><p class="eyebrow">队伍检查器</p><h2>${text(teamName(team))}</h2></div><span class="pill">${text(statusLabels[team.status] || team.status || '草稿')}</span></div>
    <dl class="team-facts"><div><dt>队长</dt><dd>${text(leaderName(team))}</dd></div><div><dt>成员</dt><dd><ul>${members}</ul></dd></div><div><dt>签到 / 桌位</dt><dd>${isCheckedIn(team) ? '已签到' : '未签到'} · ${text(seatLabel(team))}</dd></div><div><dt>Team Code</dt><dd>${code ? `<code>${text(code)}</code>` : '尚未发放'}</dd></div></dl>
    <div class="admin-actions">
      <button type="button" data-action="check-in" data-team-id="${text(team.id)}" ${isCheckedIn(team) ? 'disabled' : ''}>确认签到并占位</button>
      <form data-form="seat" data-team-id="${text(team.id)}"><label>分配桌位<select name="tableId" ${isLocked(team) ? 'disabled' : ''}><option value="">请选择桌位</option>${tableOptions}</select></label><button type="submit" ${isLocked(team) ? 'disabled' : ''}>保存配桌</button></form>
      <button type="button" data-action="lock-team" data-team-id="${text(team.id)}" ${isLocked(team) ? 'disabled' : ''}>锁队并发放 Team Code</button>
      <hr>
      <p class="helper">仅在该队已实际完成 workshop 基础部署、并由管理员二次人工确认后，授予比赛资格。这里不采集或展示 workshop 注册进度、账号或凭据。</p>
      <button type="button" data-action="toggle-eligibility" data-team-id="${text(team.id)}" data-eligible="${eligible(team) ? 'false' : 'true'}">${eligible(team) ? '撤销比赛资格' : '人工确认比赛资格'}</button>
    </div>
  </aside>`;
}

function tournament(state) {
  const tournamentState = state.tournament || {};
  const templates = templatesFrom(state);
  const selected = tournamentState.templateId || state.selectedTemplateId || '';
  const templateOptions = templates.map((template) => `<option value="${text(template.id)}" ${template.id === selected ? 'selected' : ''}>${text(template.name || template.label || template.id)}${template.teamRange ? ` · ${text(template.teamRange)}` : ''}</option>`).join('');
  const teamById = new Map((state.teams || []).map((team) => [team.id, team]));
  const matchRows = matchesFrom(state).map((match) => {
    const home = match.homeTeamName || match.homeTeam?.name || match.home?.name || (match.teamAId ? teamName(teamById.get(match.teamAId)) : '待定');
    const away = match.awayTeamName || match.awayTeam?.name || match.away?.name || (match.teamBId ? teamName(teamById.get(match.teamBId)) : '待定');
    const homeScore = match.homeScore ?? match.scoreA ?? match.score?.home ?? '';
    const awayScore = match.awayScore ?? match.scoreB ?? match.score?.away ?? '';
    const confirmed = ['confirmed', 'completed'].includes(match.status) || ['confirmed', 'completed'].includes(match.resultStatus);
    const ready = !match.status || match.status === 'ready';
    return `<tr><td>${text(match.label || match.round || match.stage || '—')}<br><small>${text(match.group || match.groupId || '')}</small></td><td>${text(home)} <b>vs</b> ${text(away)}</td><td>${formatTime(match.scheduledAt || match.startTime || match.time)}</td><td><form class="score-form" data-form="result" data-match-id="${text(match.id)}"><input aria-label="${text(home)} 得分" name="homeScore" type="number" min="0" value="${text(homeScore)}" required><span>:</span><input aria-label="${text(away)} 得分" name="awayScore" type="number" min="0" value="${text(awayScore)}" required><button type="submit" ${confirmed || !ready ? 'disabled' : ''}>${confirmed ? '已确认' : ready ? '确认赛果' : '等待上轮'}</button></form></td></tr>`;
  }).join('');
  return `<section class="admin-panel admin-tournament"><div class="panel-heading"><div><p class="eyebrow">赛事控制台</p><h2>实际达标队伍赛程</h2></div><span>${matchesFrom(state).length} 场</span></div>
    <p class="helper">仅已由管理员人工确认比赛资格的队伍会进入赛程候选池。选择模板并生成后，不会静默重排既有赛程。</p>
    <form class="tournament-controls" data-form="tournament"><label>赛制模板<select name="templateId"><option value="">请选择模板</option>${templateOptions}</select></label><button type="submit" ${matchesFrom(state).length ? 'disabled' : ''}>按此模板生成赛程</button></form>
    <div class="table-scroll"><table><thead><tr><th>轮次</th><th>对阵</th><th>时间</th><th>赛果</th></tr></thead><tbody>${matchRows || '<tr><td colspan="4" class="empty">尚未生成赛程</td></tr>'}</tbody></table></div>
  </section>`;
}

function activityLog(state) {
  const entries = logFrom(state).slice(0, 12).map((entry) => `<li><time>${formatTime(entry.createdAt || entry.at || entry.time)}</time><div><strong>${text(entry.actionLabel || entry.action || '管理员操作')}</strong><p>${text(entry.summary || entry.message || entry.reason || entry.note || '')}</p><small>${text(entry.actorName || entry.actor || '管理员')}</small></div></li>`).join('');
  return `<section class="admin-panel admin-activity"><div class="panel-heading"><div><p class="eyebrow">审计记录</p><h2>最近操作</h2></div></div><ol>${entries || '<li class="empty">暂无操作记录</li>'}</ol></section>`;
}

/**
 * Render the administrator workspace.
 * @param {HTMLElement} root
 * @param {object} state Current server state.
 * @param {object|Function} api API client supplied by app.js.
 * @param {(nextState?: object) => void} onStateChange asks app.js to refresh/re-render.
 */
export function renderAdmin(root, state = {}, api, onStateChange) {
  const teams = state.teams || [];
  const tables = tablesFrom(state);
  const selectedId = root.dataset.selectedTeamId || teams[0]?.id || '';
  const selectedTeam = teams.find((team) => String(team.id) === String(selectedId)) || teams[0];

  root.innerHTML = `<div class="admin-shell"><aside class="admin-nav" aria-label="管理导航"><div class="admin-nav-brand"><span aria-hidden="true">⚽</span><strong>Agentic Football</strong></div><a href="#overview">活动总览</a><a class="active" href="#teams">队伍管理</a><a href="#teams">签到与名额</a><a href="#teams">配桌与换座</a><a href="#teams">Team Code</a><a href="#tournament">比赛与赛程</a><a href="#activity">操作记录</a></aside><main class="admin-workspace"><header class="admin-header" id="overview"><div><p class="eyebrow">北京 MeetUp · 管理后台</p><h1>${text(state.event?.name || '组队、Workshop 与赛事运营')}</h1><p>现场签到、锁队、配桌和赛程管理。Team Code 仅作为队长自行注册 workshop 的区分码，系统不代办注册或保留凭据。</p></div><button type="button" data-action="refresh">刷新数据</button></header>
    <p class="admin-notice" aria-live="polite" hidden></p>
    ${summary(state, teams)}
    <section class="admin-operations-grid" id="teams">${teamTable(teams, selectedTeam?.id)}${inspector(selectedTeam, tables)}</section>
    <div id="tournament">${tournament(state)}</div>
    <div id="activity">${activityLog(state)}</div>
  </main></div>`;

  const notice = root.querySelector('.admin-notice');
  const showNotice = (message, kind = 'success') => {
    notice.textContent = message;
    notice.hidden = false;
    notice.dataset.kind = kind;
  };
  const mutate = async (call, message) => {
    root.setAttribute('aria-busy', 'true');
    try {
      await call();
      const nextState = await refresh(api, onStateChange);
      showNotice(message);
      return nextState;
    } catch (error) {
      showNotice(errorMessage(error), 'error');
      return undefined;
    } finally {
      root.removeAttribute('aria-busy');
    }
  };

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const { action, teamId } = button.dataset;
    if (action === 'select-team') {
      root.dataset.selectedTeamId = teamId;
      renderAdmin(root, state, api, onStateChange);
      return;
    }
    if (action === 'refresh') {
      await refresh(api, onStateChange);
      showNotice('已请求最新活动数据。');
      return;
    }
    if (action === 'check-in') await mutate(() => adminCall(api, 'adminCheckIn', [teamId], 'POST', ACTIONS.checkIn(teamId), {}), '已确认签到；系统已按当前名额规则处理占位或候补。');
    if (action === 'lock-team') await mutate(() => adminCall(api, 'adminLock', [teamId], 'POST', ACTIONS.lock(teamId), {}), '队伍已锁定，Team Code 已发放。');
    if (action === 'toggle-eligibility') {
      const shouldApprove = button.dataset.eligible === 'true';
      const confirmation = shouldApprove
        ? '请确认：该队已经实际完成 workshop 基础部署，管理员现在进行二次人工确认并授予比赛资格。'
        : '请确认：撤销该队的比赛资格。已生成赛程不会被静默重排。';
      if (window.confirm(confirmation)) await mutate(() => adminCall(api, 'adminCompetitionApproval', [teamId, shouldApprove], 'POST', ACTIONS.eligibility(teamId), { approved: shouldApprove }), shouldApprove ? '已人工确认比赛资格。' : '已撤销比赛资格。');
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'seat') {
      const tableId = data.get('tableId');
      if (!tableId) return showNotice('请先选择桌位。', 'error');
      await mutate(() => adminCall(api, 'adminSeat', [form.dataset.teamId, tableId], 'POST', ACTIONS.seat(form.dataset.teamId), { seatId: tableId }), '桌位已分配。');
    }
    if (form.dataset.form === 'tournament') {
      const templateId = data.get('templateId');
      if (!templateId) return showNotice('请选择赛制模板。', 'error');
      if (window.confirm('将以当前已人工确认比赛资格的队伍生成赛程，确认继续？')) await mutate(() => adminCall(api, 'generateTournament', [templateId], 'POST', ACTIONS.generateTournament, { templateId }), '赛程已生成。');
    }
    if (form.dataset.form === 'result') {
      const homeScore = Number(data.get('homeScore'));
      const awayScore = Number(data.get('awayScore'));
      if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) return showNotice('请填写有效的非负整数赛果。', 'error');
      if (window.confirm('确认赛果后，系统可能推进下一轮对阵。确认继续？')) await mutate(() => adminCall(api, 'recordResult', [form.dataset.matchId, homeScore, awayScore], 'POST', ACTIONS.result(form.dataset.matchId), { homeScore, awayScore }), '赛果已确认，并已请求更新晋级对阵。');
    }
  });
}
