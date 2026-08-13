const SESSION_KEY = "football-workbench-platform-session";
const root = document.querySelector("#tenant-app");
const state = { session: sessionStorage.getItem(SESSION_KEY) || "", tenants: [], created: null, error: "", loading: false };

async function platformRequest(path, { method = "GET", body } = {}) {
  const headers = {};
  if (state.session) headers["x-platform-session"] = state.session;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function gate() {
  root.innerHTML = `<main class="platform-gate"><section><div class="platform-brand"><span>◒</span><strong>Football Workbench</strong></div><h1>租户开通</h1><p>这是部署级配置入口。它只负责创建活动租户，不会读取任何租户的参与者或现场运营数据。</p>${state.error ? `<div class="platform-error">${escapeHtml(state.error)}</div>` : ""}<form id="platform-login"><label>平台管理 PIN<input name="platformPin" type="password" autocomplete="current-password" required autofocus /></label><button>进入租户管理</button></form></section></main>`;
}

function urlRows(tenant) {
  const paths = [["参与者", "/"], ["Staff", "/staff"], ["TA", "/ta"], ["Admin", "/admin"], ["大屏", "/display"]];
  const origin = tenant?.origin || document.querySelector("#tenant-origin")?.value.replace(/\/$/, "") || "https://event.example.com";
  return paths.map(([label, path]) => `<div class="url-row"><span>${label}<small>${path}</small></span><code>${escapeHtml(`${origin}${path}`)}</code><button type="button" data-copy="${escapeHtml(`${origin}${path}`)}" aria-label="复制 ${label} URL">复制</button></div>`).join("");
}

function tenantRows() {
  if (!state.tenants.length) return `<p class="empty-list">尚未创建租户。</p>`;
  return state.tenants.map((tenant) => `<li><div><strong>${escapeHtml(tenant.branding.locationLabel)}</strong><small>${escapeHtml(tenant.hosts.join(", "))}</small></div><span>${tenant.source === "database" ? "页面创建" : "代码配置"}</span></li>`).join("");
}

function formPage() {
  const preview = state.created;
  root.innerHTML = `
    <header class="platform-header"><a href="/tenants"><span>◒</span><strong>Football Workbench</strong></a><i></i><b>租户开通</b><button id="platform-logout">退出安全会话</button></header>
    <div class="platform-layout">
      <nav class="platform-nav" aria-label="租户管理"><button type="button" data-nav-list>租户列表</button><button class="active" type="button" data-nav-new>新建租户</button></nav>
      <main class="tenant-form-main">
        <div class="title-block"><h1>新建活动租户</h1><p>创建将持久化活动配置与 Host 映射，无需重启即可生效。</p></div>
        ${state.error ? `<div class="platform-error">${escapeHtml(state.error)}</div>` : ""}
        ${preview ? `<div class="platform-success"><strong>${escapeHtml(preview.branding.locationLabel)} 已创建</strong><span>应用已开始接受来自 ${escapeHtml(preview.hosts[0])} 的请求。</span></div>` : ""}
        <form id="tenant-create-form">
          <section><h2>1. 基础信息</h2><div class="fields fields-three"><label>租户标识 tenantId<input name="tenantId" required pattern="[a-z0-9][a-z0-9-]{2,79}" placeholder="beijing-afc-2027" /></label><label>租户基础 URL<input id="tenant-origin" name="origin" type="url" required placeholder="https://event.example.com" /></label><label>活动名称<input name="eventName" required value="Agentic Football 现场运营台" /></label></div></section>
          <section><h2>2. 品牌信息</h2><div class="fields fields-four"><label>品牌名称<input name="brandName" required value="Agentic Football" /></label><label>地点标签<input name="locationLabel" required placeholder="杭州 MeetUp" /></label><label>显示标签<input name="displayLabel" required placeholder="AGENTIC FOOTBALL · 杭州 MEETUP" /></label><label>页面标题<input name="pageTitle" required placeholder="Agentic Football 杭州 MeetUp" /></label></div></section>
          <section><h2>3. 外部链接</h2><div class="fields fields-two"><label>Workshop URL<input name="workshopUrl" type="url" required value="https://example.com/agentic-football-workshop" /></label><label>Game Portal URL<input name="gamePortalUrl" type="url" required value="https://agentic-football.aws.dev/" /></label></div></section>
          <section><h2>4. 队伍策略</h2><div class="fields fields-three"><label>最小成员数<input name="minMembers" type="number" min="1" max="10" required value="1" /></label><label>最大成员数<input name="maxMembers" type="number" min="1" max="10" required value="3" /></label><label>最大队伍数<input name="maxTeams" type="number" min="1" max="256" required value="32" /></label></div></section>
          <section><h2>5. 赛事策略</h2><div class="fields fields-four"><label>每组最大队伍数<input name="maxTeamsPerGroup" type="number" min="2" max="16" required value="4" /></label><label>最大组数<input name="maxGroups" type="number" min="1" max="26" required value="8" /></label><label>默认晋级名额数<input name="defaultQualifiersPerGroup" type="number" min="1" max="16" required value="2" /></label><label>最大晋级名额数<input name="maxQualifiersPerGroup" type="number" min="1" max="16" required value="2" /></label></div></section>
          <section><h2>6. 初始角色与 PIN</h2><div class="fields fields-three"><label>Staff PIN<input name="staffPin" type="password" minlength="6" required autocomplete="new-password" /></label><label>TA PIN<input name="taPin" type="password" minlength="6" required autocomplete="new-password" /></label><label>Admin PIN<input name="adminPin" type="password" minlength="8" required autocomplete="new-password" /></label></div><p class="form-help">PIN 仅用于首次登录验证并保存在服务端租户配置中；不同租户和角色不可复用。</p></section>
          <section><h2>7. 功能开关</h2><div class="switch-grid"><label><input name="selfServiceTeam" type="checkbox" />允许参与者自助组队</label><label><input name="participantHelp" type="checkbox" />允许参与者页面呼叫 TA</label><label><input name="codeIssuance" type="checkbox" checked />允许资源 Code 发放</label><label><input name="qualification" type="checkbox" checked />允许资格确认</label><label><input name="scheduleEditing" type="checkbox" checked />允许赛程编辑</label><label><input name="publicMaintenanceSnapshot" type="checkbox" />允许公开维护快照</label></div></section>
          <div class="form-actions"><button class="primary-action" ${state.loading ? "disabled" : ""}>${state.loading ? "正在创建…" : "创建租户"}</button><button class="secondary-action" type="reset">重置表单</button></div>
        </form>
      </main>
      <aside class="tenant-preview"><section><h2>访问地址预览</h2><p>下面的地址将在租户创建后可用。</p><div id="url-preview">${urlRows(preview)}</div><div class="routing-note">请确保 DNS / Caddy 已将该主机名正确路由到本部署节点，租户创建后应用层会立即接管。</div></section><section class="existing-tenants"><h2>现有租户</h2><ul>${tenantRows()}</ul></section></aside>
    </div>`;
}

async function loadTenants() {
  try { state.tenants = (await platformRequest("/api/platform/tenants")).tenants; state.error = ""; formPage(); }
  catch (error) { state.session = ""; sessionStorage.removeItem(SESSION_KEY); state.error = error.message; gate(); }
}

function formPayload(form) {
  const data = new FormData(form); const integer = (name) => Number(data.get(name)); const checked = (name) => data.get(name) === "on";
  return {
    origin: data.get("origin"),
    staffAccounts: [{ id: "initial-staff", pin: data.get("staffPin") }, { id: "initial-ta", pin: data.get("taPin") }],
    adminPin: data.get("adminPin"),
    config: {
      schemaVersion: 1, id: data.get("tenantId"), name: data.get("eventName"),
      branding: { brandName: data.get("brandName"), locationLabel: data.get("locationLabel"), displayLabel: data.get("displayLabel"), pageTitle: data.get("pageTitle") },
      links: { workshopUrl: data.get("workshopUrl"), gamePortalUrl: data.get("gamePortalUrl") },
      teamPolicy: { minMembers: integer("minMembers"), maxMembers: integer("maxMembers"), maxTeams: integer("maxTeams") },
      tournamentPolicy: { maxTeamsPerGroup: integer("maxTeamsPerGroup"), maxGroups: integer("maxGroups"), defaultQualifiersPerGroup: integer("defaultQualifiersPerGroup"), maxQualifiersPerGroup: integer("maxQualifiersPerGroup") },
      defaultGates: { selfServiceTeam: checked("selfServiceTeam"), participantHelp: checked("participantHelp"), codeIssuance: checked("codeIssuance"), qualification: checked("qualification"), scheduleEditing: checked("scheduleEditing"), publicMaintenanceSnapshot: checked("publicMaintenanceSnapshot") },
    },
  };
}

root.addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.target;
  if (form.id === "platform-login") {
    try { const result = await platformRequest("/api/platform/session", { method: "POST", body: { platformPin: new FormData(form).get("platformPin") } }); state.session = result.platformSession; sessionStorage.setItem(SESSION_KEY, state.session); await loadTenants(); }
    catch (error) { state.error = error.message; gate(); }
    return;
  }
  if (form.id === "tenant-create-form") {
    const payload = formPayload(form); state.loading = true; state.error = ""; formPage();
    try { const result = await platformRequest("/api/platform/tenants", { method: "POST", body: payload }); state.created = result.tenant; state.tenants = (await platformRequest("/api/platform/tenants")).tenants; }
    catch (error) { state.error = error.message; }
    finally { state.loading = false; formPage(); }
  }
});

root.addEventListener("input", (event) => { if (event.target.id === "tenant-origin") document.querySelector("#url-preview").innerHTML = urlRows(state.created); });
root.addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy]"); if (copy) { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "已复制"; }
  if (event.target.closest("#platform-logout")) { state.session = ""; state.created = null; sessionStorage.removeItem(SESSION_KEY); gate(); }
  if (event.target.closest("[data-nav-list]")) document.querySelector(".existing-tenants")?.scrollIntoView({ behavior: "smooth" });
  if (event.target.closest("[data-nav-new]")) document.querySelector(".tenant-form-main")?.scrollIntoView({ behavior: "smooth" });
});

if (state.session) loadTenants(); else gate();
