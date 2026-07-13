const PARTICIPANT_KEY = "afc-meetup-participant-id";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const getStoredParticipantId = () => {
  try {
    return window.localStorage.getItem(PARTICIPANT_KEY);
  } catch {
    return null;
  }
};

const storeParticipantId = (id) => {
  if (!id) return;
  try {
    window.localStorage.setItem(PARTICIPANT_KEY, id);
  } catch {
    // 浏览器禁止本地存储时，当前页面仍可继续使用服务端返回的数据。
  }
};

const memberId = (member) => (typeof member === "object" ? member.id || member.participantId : member);
const memberName = (member, participants) => {
  if (typeof member === "object") return member.nickname || member.name || "现场伙伴";
  return participants.find((participant) => participant.id === member)?.nickname || "现场伙伴";
};

const teamMemberIds = (team) => team.members || team.memberIds || [];

const findMyTeam = (state, participantId) => (state.teams || []).find((team) =>
  teamMemberIds(team).some((member) => memberId(member) === participantId),
);

const findParticipant = (state, participantId) => (state.participants || []).find((participant) => participant.id === participantId);

const formatMatch = (match, teamId, teams) => {
  const findTeamName = (id) => teams.find((team) => team.id === id)?.name || "待定";
  const leftId = match.teamAId || match.homeTeamId || match.home?.id;
  const rightId = match.teamBId || match.awayTeamId || match.away?.id;
  const left = match.homeTeamName || match.home?.name || match.homeTeam?.name || findTeamName(leftId);
  const right = match.awayTeamName || match.away?.name || match.awayTeam?.name || findTeamName(rightId);
  const time = match.startTime || match.time || "时间待管理员公布";
  const score = match.score || (match.scoreA != null && match.scoreB != null
    ? `${match.scoreA} : ${match.scoreB}`
    : match.homeScore != null && match.awayScore != null
    ? `${match.homeScore} : ${match.awayScore}`
    : "结果待确认");
  const ids = [leftId, rightId];
  return ids.includes(teamId) ? `<li><strong>${escapeHtml(left)} vs ${escapeHtml(right)}</strong><span>${escapeHtml(time)} · ${escapeHtml(score)}</span></li>` : "";
};

const participantForm = () => `
  <section class="card participant-intro">
    <p class="eyebrow">北京 MeetUp</p>
    <h1>先留下一个现场昵称</h1>
    <p>不需要手机号、邮箱或密码。以下信息只用于现场组队与管理员协助安排。</p>
    <form id="participant-form" class="stack">
      <label>昵称<input name="nickname" maxlength="24" required placeholder="例如：北极熊前锋" autocomplete="nickname"></label>
      <fieldset>
        <legend>你现在的情况</legend>
        <label>是否已有同行伙伴？
          <select name="hasCompanion" required><option value="no">没有，愿意认识新队友</option><option value="yes">有，准备一起组队</option></select>
        </label>
        <label>是否愿意担任队长？
          <select name="captainWilling"><option value="yes">愿意</option><option value="maybe" selected>可以视情况</option><option value="no">暂不愿意</option></select>
        </label>
        <label>是否带电脑并愿意实操？
          <select name="hasLaptop"><option value="yes" selected>是</option><option value="no">否</option></select>
        </label>
        <label>你更偏好的角色？
          <select name="rolePreference"><option value="hands-on">实操</option><option value="strategy">策略</option><option value="notes">记录 / 复盘</option><option value="unsure" selected>暂不确定</option></select>
        </label>
        <label>是否接受管理员协助拼队和统一换座？
          <select name="adminAssignment"><option value="yes" selected>接受</option><option value="no">希望先自行组队</option></select>
        </label>
      </fieldset>
      <button type="submit">进入组队</button>
    </form>
  </section>`;

const teamChooser = (profile) => `
  <section class="card">
    <p class="eyebrow">你好，${escapeHtml(profile.nickname)}</p>
    <h1>组建你的队伍</h1>
    <p>每队 <strong>1–3 人</strong>。可以自己先成队，也可以让管理员根据问卷协助安排。</p>
    <div class="two-column">
      <form id="create-team-form" class="stack">
        <h2>创建队伍</h2>
        <label>队伍名<input name="teamName" maxlength="32" required placeholder="例如：北门控球组"></label>
        <button type="submit">创建队伍并获取邀请码</button>
      </form>
      <form id="join-team-form" class="stack">
        <h2>加入朋友的队伍</h2>
        <label>邀请码<input name="inviteCode" maxlength="32" required placeholder="输入队长分享的邀请码"></label>
        <button type="submit" class="secondary">加入队伍</button>
      </form>
    </div>
    <p class="hint">还没找到伙伴也没关系：管理员会看到你的拼队意愿，并可在现场协助分配。</p>
  </section>`;

const confirmationText = (team) => {
  if (["waitlist", "waitlisted"].includes(team.status) || team.waitlisted) return "当前为候补队，管理员会按现场名额安排。";
  if (team.checkedIn || team.confirmed || team.locked || ["confirmed", "locked", "active"].includes(team.status)) return "已完成现场确认，请按管理员安排入座。";
  return "请由队长到签到台出示本页的邀请码或队伍二维码，完成现场确认。";
};

const teamPanel = (state, team) => {
  const members = teamMemberIds(team);
  const people = (state.participants || []);
  const invite = team.inviteCode || team.shortCode || "现场生成中";
  const seatObject = (state.seats || state.tables || []).find((item) => item.id === team.seatId);
  const seat = team.seat?.label || team.seatLabel || team.table?.label || seatObject?.label || team.tableNumber
    ? (team.seat?.label || team.seatLabel || team.table?.label || seatObject?.label || `桌号 ${team.tableNumber}`)
    : "管理员将在锁队时统一公布";
  const approved = team.competitionApproved === true || team.competitionStatus === "approved";
  const code = team.teamCode || team.code;
  const matches = (state.matches || state.tournament?.matches || []).map((match) => formatMatch(match, team.id, state.teams || [])).filter(Boolean).join("");
  const tournament = state.tournament
    ? state.tournament.name || state.tournament.templateName || (state.tournament.template === "single-elimination" ? "单败淘汰赛" : "小组赛前二晋级淘汰赛")
    : "赛程将在管理员确认参赛队后公布";
  return `
    <section class="card team-card">
      <p class="eyebrow">我的队伍 · ${escapeHtml(confirmationText(team))}</p>
      <div class="team-hero"><div class="team-crest" aria-hidden="true">⚽</div><div><h1>${escapeHtml(team.name || "未命名队伍")}</h1><p>${members.length} / 3 人 · 现场协作队伍</p></div></div>
      <div class="team-meta">
        <div><span>邀请码</span><strong class="copyable">${escapeHtml(invite)}</strong></div>
        <div><span>队伍人数</span><strong>${members.length} / 3 人</strong></div>
        <div><span>座位</span><strong>${escapeHtml(seat)}</strong></div>
      </div>
      <h2>队友</h2>
      <ul class="member-list">${members.map((member) => `<li>${escapeHtml(memberName(member, people))}</li>`).join("")}</ul>
      <p class="hint">将邀请码分享给队友即可加入；满 3 人后不可再自行加入。草稿队不会占用现场名额。</p>
      ${code ? `<div class="team-code"><span>Team Code</span><strong>${escapeHtml(code)}</strong><p>请妥善保存；如有使用问题，请联系现场工作人员。</p></div>` : ""}
    </section>
    <section class="card">
      <p class="eyebrow">比赛</p>
      <h2>${approved ? "已获管理员确认，可参加比赛" : "尚未获得管理员参赛确认"}</h2>
      <p>${escapeHtml(tournament)}</p>
      ${matches ? `<ul class="match-list">${matches}</ul>` : "<p class=\"hint\">确认后会在这里显示你们的小组、对手、时间和晋级路径。</p>"}
    </section>`;
};

const callApi = async (api, path, body) => {
  const methodMap = {
    "/api/participants": "createParticipant",
    "/api/teams": "createTeam",
    "/api/teams/join": "joinTeam",
  };
  if (typeof api?.[methodMap[path]] === "function") return api[methodMap[path]](body);
  if (typeof api?.request === "function") return api.request(path, { method: "POST", body });
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.message || "操作未完成，请重试或联系现场工作人员。");
  return result;
};

const withSubmit = (root, selector, handler) => {
  const form = root.querySelector(selector);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const original = submit?.textContent;
    try {
      if (submit) {
        submit.disabled = true;
        submit.textContent = "处理中…";
      }
      await handler(new FormData(form));
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作未完成，请联系现场工作人员。";
      const notice = root.querySelector("[data-participant-notice]");
      if (notice) notice.textContent = message;
      else window.alert(message);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = original;
      }
    }
  });
};

/** Render the anonymous, mobile-first participant workflow. */
export function renderParticipant(root, state = {}, api = {}, onStateChange = async () => {}) {
  const participantId = api.currentParticipantId?.() || state.currentParticipantId || getStoredParticipantId();
  const profile = state.currentParticipant?.id === participantId
    ? state.currentParticipant
    : findParticipant(state, participantId);
  const team = profile ? findMyTeam(state, profile.id) : null;

  root.innerHTML = `<div class="participant-shell"><header class="participant-top"><div class="brand"><span class="brand-ball" aria-hidden="true">⚽</span><span>Agentic Football 北京 MeetUp</span></div></header><nav class="participant-nav" aria-label="参与者导航"><span class="active">我的队伍</span><span>赛程</span><span>榜单</span><span>活动信息</span></nav><p class="notice" data-participant-notice aria-live="polite"></p>${
    !profile ? participantForm() : team ? teamPanel(state, team) : teamChooser(profile)
  }</div>`;

  withSubmit(root, "#participant-form", async (form) => {
    const survey = {
      leader: form.get("captainWilling") === "yes",
      hasLaptop: form.get("hasLaptop") === "yes",
      role: form.get("rolePreference"),
      wantsCompetition: true,
      acceptsAssignment: form.get("adminAssignment") === "yes",
    };
    const result = await callApi(api, "/api/participants", { nickname: form.get("nickname").trim(), survey });
    const created = result.participant || result;
    storeParticipantId(created.id);
    await onStateChange({ type: "participant-created", participantId: created.id });
  });

  if (!profile) return;
  withSubmit(root, "#create-team-form", async (form) => {
    await callApi(api, "/api/teams", { name: form.get("teamName").trim(), captainId: profile.id, participantId: profile.id });
    await onStateChange({ type: "team-created", participantId: profile.id });
  });
  withSubmit(root, "#join-team-form", async (form) => {
    await callApi(api, "/api/teams/join", { inviteCode: form.get("inviteCode").trim(), participantId: profile.id });
    await onStateChange({ type: "team-joined", participantId: profile.id });
  });
}
