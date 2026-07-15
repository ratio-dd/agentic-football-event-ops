import { renderParticipant } from "./participant.js";
import { renderStaff } from "./admin.js";

const CLIENT_KEY = "afc-event-ops-client";
const STAFF_KEY = "afc-event-ops-staff";
const app = document.querySelector("#app");
const context = {
  clientId: localStorage.getItem(CLIENT_KEY) || crypto.randomUUID(),
  staffSession: sessionStorage.getItem(STAFF_KEY) || "",
  state: null,
  error: "",
  // Polling keeps the on-site view current. Keep any unfinished input local so
  // a background refresh never sends a staff member or participant back to a
  // form's default option.
  formDraft: new Map(),
  staffUi: { tab: "overview", groupQuery: "", searchResults: [], selectedMemberIds: [], auditFilter: "all" },
};
localStorage.setItem(CLIENT_KEY, context.clientId);

function draftKey(field) {
  const form = field.closest("form")?.id || "surface";
  const identity = field.name || field.id || (field.dataset.member ? `member:${field.value}` : "");
  return identity ? `${location.pathname}|${form}|${identity}` : "";
}
function saveDraft(event) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) || field.type === "file") return;
  const key = draftKey(field); if (!key) return;
  context.formDraft.set(key, field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? { checked: field.checked } : { value: field.value });
}
function restoreDrafts(root) {
  root.querySelectorAll("input, select, textarea").forEach((field) => {
    const draft = context.formDraft.get(draftKey(field)); if (!draft) return;
    if ("checked" in draft && field instanceof HTMLInputElement) field.checked = draft.checked;
    else if ("value" in draft) field.value = draft.value;
  });
}
app.addEventListener("input", saveDraft);
app.addEventListener("change", saveDraft);

async function request(path, { method = "GET", body, staff = false, adminPin = "" } = {}) {
  const headers = { "x-client-id": context.clientId };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (staff && context.staffSession) headers["x-staff-session"] = context.staffSession;
  if (adminPin) headers["x-admin-pin"] = adminPin;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  return data;
}

const api = {
  request,
  register: (payload) => request("/api/participants", { method: "POST", body: payload }),
  rebind: (payload) => request("/api/participants/rebind", { method: "POST", body: payload }),
  createSelfTeam: () => request("/api/teams/self", { method: "POST", body: {} }),
  joinSelfTeam: (teamNumber) => request("/api/teams/self/join", { method: "POST", body: { teamNumber } }),
  staffLogin: (payload) => request("/api/ops/session", { method: "POST", body: payload }),
  searchParticipants: (query) => request(`/api/ops/participants?q=${encodeURIComponent(query)}`, { staff: true }),
  createTeam: (memberIds) => request("/api/ops/teams", { method: "POST", body: { memberIds }, staff: true }),
  dispatchPeople: (participantIds, targetTeamId, dissolutionActions = {}) => request("/api/ops/assignments", { method: "POST", body: { participantIds, targetTeamId, dissolutionActions }, staff: true }),
  updateTeam: (teamId, memberIds) => request(`/api/ops/teams/${teamId}/members`, { method: "PUT", body: { memberIds }, staff: true }),
  removeTeam: (teamId) => request(`/api/ops/teams/${teamId}`, { method: "DELETE", body: {}, staff: true }),
  confirmTeam: (teamId) => request(`/api/ops/teams/${teamId}/confirm`, { method: "POST", body: {}, staff: true }),
  updateEventGates: (gates, adminPin) => request("/api/ops/event-gates", { method: "PUT", body: { gates }, staff: true, adminPin }),
  importWorkshopCodes: (codes) => request("/api/ops/codes/import", { method: "POST", body: { codes }, staff: true }),
  setWorkshopLink: (url) => request("/api/ops/workshop-link", { method: "PUT", body: { url }, staff: true }),
  issueCode: (teamId) => request(`/api/ops/teams/${teamId}/issue-code`, { method: "POST", body: {}, staff: true }),
  workshopStatus: (teamId, status, note = "") => request(`/api/ops/workshop/teams/${teamId}/status`, { method: "PUT", body: { status, note }, staff: true }),
  qualify: (teamId) => request(`/api/ops/qualification/teams/${teamId}/confirm`, { method: "POST", body: {}, staff: true }),
  revokeQualification: (teamId, note, adminPin) => request(`/api/ops/qualification/teams/${teamId}/revoke`, { method: "POST", body: { note }, staff: true, adminPin }),
  freezeCompetition: (teamIds, adminPin) => request("/api/ops/competition/freeze", { method: "POST", body: { teamIds }, staff: true, adminPin }),
  unfreezeCompetition: (adminPin) => request("/api/ops/competition/unfreeze", { method: "POST", body: {}, staff: true, adminPin }),
  tournament: (groupCount, qualifiersPerGroup, adminPin) => request("/api/ops/competition/generate", { method: "POST", body: { groupCount, qualifiersPerGroup }, staff: true, adminPin }),
  swapTournamentTeams: (firstTeamId, secondTeamId, adminPin) => request("/api/ops/competition/swap", { method: "POST", body: { firstTeamId, secondTeamId }, staff: true, adminPin }),
  generateKnockout: (adminPin) => request("/api/ops/competition/knockout", { method: "POST", body: {}, staff: true, adminPin }),
  voidTournament: (reason, adminPin) => request("/api/ops/competition/void", { method: "POST", body: { reason }, staff: true, adminPin }),
  result: (matchId, scoreA, scoreB, adminPin) => request(`/api/ops/matches/${matchId}/result`, { method: "POST", body: { scoreA, scoreB }, staff: true, adminPin }),
};

async function refresh() {
  try {
    context.state = await request(context.staffSession ? "/api/ops/state" : "/api/state", { staff: Boolean(context.staffSession) });
    context.error = "";
  } catch (error) { context.error = error.message || "暂时无法加载活动数据"; }
  render();
}
async function login(payload) { const result = await api.staffLogin(payload); context.staffSession = result.staffSession; sessionStorage.setItem(STAFF_KEY, result.staffSession); await refresh(); }
function render() {
  if (!context.state) { app.innerHTML = `<main class="loading-screen"><p>${context.error || "正在加载 Agentic Football 现场运营台…"}</p></main>`; return; }
  const surface = document.createElement("main"); surface.className = "app-surface"; app.replaceChildren(surface);
  const rerender = async () => refresh();
  if (location.pathname === "/staff" || context.staffSession) renderStaff(surface, context.state, api, { login, refresh: rerender, ui: context.staffUi, logout: () => { sessionStorage.removeItem(STAFF_KEY); context.staffSession = ""; refresh(); } });
  else renderParticipant(surface, context.state, api, rerender);
  restoreDrafts(surface);
}
refresh();
window.setInterval(refresh, 5000);
