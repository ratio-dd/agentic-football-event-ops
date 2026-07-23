import { renderParticipant } from "./participant.js";
import { renderStaff } from "./admin.js";
import { renderAdmin } from "./admin-panel.js";

const CLIENT_KEY = "afc-event-ops-client";
const STAFF_KEY = "afc-event-ops-staff";
const ADMIN_KEY = "afc-event-ops-admin";
const localAcceptanceClient = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? new URLSearchParams(location.search).get("acceptanceClient") || ""
  : "";
const app = document.querySelector("#app");
const context = {
  clientId: localAcceptanceClient || localStorage.getItem(CLIENT_KEY) || crypto.randomUUID(),
  staffSession: sessionStorage.getItem(STAFF_KEY) || "",
  adminSession: sessionStorage.getItem(ADMIN_KEY) || "",
  state: null,
  error: "",
  // Polling keeps the on-site view current. Keep any unfinished input local so
  // a background refresh never sends a staff member or participant back to a
  // form's default option.
  formDraft: new Map(),
  feedbackOpen: false,
  staffUi: { tab: "overview", groupQuery: "", searchResults: [], selectedMemberIds: [], auditFilter: "all" },
  adminUi: { section: "activity", groupDraft: null, groupDraftTournamentId: "", groupSelectedTeamId: "", groupDragTeamId: "", groupBoardError: "" },
};
localStorage.setItem(CLIENT_KEY, context.clientId);

function draftKey(field) {
  const form = field.closest("form");
  const scope = form?.dataset.draftScope || form?.id || "surface";
  const identity = field.name || field.id || (field.dataset.member ? `member:${field.value}` : "");
  const instance = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? `|${field.value}` : "";
  return identity ? `${location.pathname}|${scope}|${identity}${instance}` : "";
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
function captureInputFocus() {
  const field = document.activeElement;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return null;
  const key = draftKey(field); if (!key) return null;
  return { key, start: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.selectionStart : null, end: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.selectionEnd : null };
}
function restoreInputFocus(root, focus) {
  if (!focus) return;
  const field = [...root.querySelectorAll("input, select, textarea")].find((candidate) => draftKey(candidate) === focus.key);
  if (!field) return;
  field.focus({ preventScroll: true });
  if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && typeof focus.start === "number" && typeof focus.end === "number") field.setSelectionRange(focus.start, focus.end);
}
app.addEventListener("input", saveDraft);
app.addEventListener("change", saveDraft);

async function request(path, { method = "GET", body, staff = false } = {}) {
  const headers = { "x-client-id": context.clientId };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (staff && context.staffSession) headers["x-staff-session"] = context.staffSession;
  if (context.adminSession) headers["x-admin-session"] = context.adminSession;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  return data;
}

const api = {
  request,
  register: (payload) => request("/api/participants", { method: "POST", body: payload }),
  rebind: (payload) => request("/api/participants/rebind", { method: "POST", body: payload }),
  createHelpRequest: (category) => request("/api/participant/help-requests", { method: "POST", body: { category } }),
  createSelfTeam: () => request("/api/teams/self", { method: "POST", body: {} }),
  joinSelfTeam: (teamNumber) => request("/api/teams/self/join", { method: "POST", body: { teamNumber } }),
  submitFeedback: (note) => request("/api/feedback", { method: "POST", body: { note, page: location.pathname }, staff: Boolean(context.staffSession) }),
  staffLogin: (payload) => request("/api/ops/session", { method: "POST", body: payload }),
  adminLogin: (adminPin) => request("/api/admin/session", { method: "POST", body: { adminPin }, staff: true }),
  searchParticipants: (query) => request(`/api/ops/participants?q=${encodeURIComponent(query)}`, { staff: true }),
  createTeam: (memberIds) => request("/api/ops/teams", { method: "POST", body: { memberIds }, staff: true }),
  dispatchPeople: (participantIds, targetTeamId, dissolutionActions = {}) => request("/api/ops/assignments", { method: "POST", body: { participantIds, targetTeamId, dissolutionActions }, staff: true }),
  updateTeam: (teamId, memberIds) => request(`/api/ops/teams/${teamId}/members`, { method: "PUT", body: { memberIds }, staff: true }),
  removeTeam: (teamId) => request(`/api/ops/teams/${teamId}`, { method: "DELETE", body: {}, staff: true }),
  allocationPreview: (allocationSeed = "") => request("/api/ops/allocation/preview", { method: "POST", body: { allocationSeed }, staff: true }),
  publishAllocation: (runId) => request(`/api/ops/allocation/${runId}/publish`, { method: "POST", body: {}, staff: true }),
  splitManualTeam: (teamId, groups, confirmationNote) => request(`/api/ops/teams/${teamId}/split`, { method: "POST", body: { groups, confirmationNote }, staff: true }),
  releaseManualMembers: (teamId, memberIds, confirmationNote) => request(`/api/ops/teams/${teamId}/release`, { method: "POST", body: { memberIds, confirmationNote }, staff: true }),
  confirmTeam: (teamId) => request(`/api/ops/teams/${teamId}/confirm`, { method: "POST", body: {}, staff: true }),
  updateTeamStatus: (teamId, status) => request(`/api/ops/teams/${teamId}/status`, { method: "PUT", body: { status }, staff: true }),
  updateEventGates: (gates) => request("/api/ops/event-gates", { method: "PUT", body: { gates }, staff: true }),
  importResourceCodes: ({ workshopCodes, gamePortalCodes }) => request("/api/ops/codes/import", { method: "POST", body: { workshopCodes, gamePortalCodes }, staff: true }),
  backfillGamePortalCodes: () => request("/api/admin/codes/game-portal/backfill", { method: "POST", body: {}, staff: true }),
  diagnostics: () => request("/api/admin/diagnostics", { staff: true }),
  setEventLinks: (workshopUrl, gamePortalUrl) => request("/api/ops/event-links", { method: "PUT", body: { workshopUrl, gamePortalUrl }, staff: true }),
  reclaimCode: (teamId) => request(`/api/admin/teams/${teamId}/reclaim-code`, { method: "POST", body: {}, staff: true }),
  issueCode: (teamId) => request(`/api/ops/teams/${teamId}/issue-code`, { method: "POST", body: {}, staff: true }),
  issueGamePortalCode: (teamId) => request(`/api/ops/teams/${teamId}/issue-game-portal-code`, { method: "POST", body: {}, staff: true }),
  workshopNote: (teamId, note = "") => request(`/api/ops/workshop/teams/${teamId}/note`, { method: "PUT", body: { note }, staff: true }),
  claimHelpRequest: (requestId) => request(`/api/ops/help-requests/${requestId}/claim`, { method: "POST", body: {}, staff: true }),
  resolveHelpRequest: (requestId) => request(`/api/ops/help-requests/${requestId}/resolve`, { method: "POST", body: {}, staff: true }),
  qualify: (teamId) => request(`/api/ops/qualification/teams/${teamId}/confirm`, { method: "POST", body: {}, staff: true }),
  revokeQualification: (teamId, note) => request(`/api/ops/qualification/teams/${teamId}/revoke`, { method: "POST", body: { note }, staff: true }),
  freezeCompetition: (teamIds) => request("/api/ops/competition/freeze", { method: "POST", body: { teamIds }, staff: true }),
  unfreezeCompetition: () => request("/api/ops/competition/unfreeze", { method: "POST", body: {}, staff: true }),
  tournament: (groupCount, qualifiersPerGroup) => request("/api/ops/competition/generate", { method: "POST", body: { groupCount, qualifiersPerGroup }, staff: true }),
  updateTournamentGroups: (groups) => request("/api/ops/competition/groups", { method: "PUT", body: { groups }, staff: true }),
  swapTournamentTeams: (firstTeamId, secondTeamId) => request("/api/ops/competition/swap", { method: "POST", body: { firstTeamId, secondTeamId }, staff: true }),
  generateKnockout: () => request("/api/ops/competition/knockout", { method: "POST", body: {}, staff: true }),
  rebuildKnockout: () => request("/api/ops/competition/knockout/rebuild", { method: "POST", body: {}, staff: true }),
  voidTournament: (reason) => request("/api/ops/competition/void", { method: "POST", body: { reason }, staff: true }),
  result: (matchId, scoreA, scoreB, correctionReason = "") => request(`/api/ops/matches/${matchId}/result`, { method: "POST", body: { scoreA, scoreB, correctionReason }, staff: true }),
};

async function refresh() {
  if (context.staffUi.scannerOpen) return;
  try {
    const statePath = location.pathname === "/admin" && context.adminSession ? "/api/admin/state" : context.staffSession ? "/api/ops/state" : "/api/state";
    context.state = await request(statePath, { staff: Boolean(context.staffSession) });
    context.error = "";
  } catch (error) { context.error = error.message || "暂时无法加载活动数据"; }
  render();
}
async function login(payload) { const result = await api.staffLogin(payload); context.staffSession = result.staffSession; sessionStorage.setItem(STAFF_KEY, result.staffSession); await refresh(); }
async function loginAdmin(adminPin) { const result = await api.adminLogin(adminPin); context.adminSession = result.adminSession; sessionStorage.setItem(ADMIN_KEY, result.adminSession); history.pushState({}, "", "/admin"); await refresh(); }
function render() {
  if (!context.state) { app.innerHTML = `<main class="loading-screen"><p>${context.error || "正在加载 Agentic Football 现场运营台…"}</p></main>`; return; }
  const focus = captureInputFocus();
  const surface = document.createElement("main"); surface.className = "app-surface"; app.replaceChildren(surface);
  const rerender = async () => refresh();
  const logout = () => { sessionStorage.removeItem(STAFF_KEY); sessionStorage.removeItem(ADMIN_KEY); context.staffSession = ""; context.adminSession = ""; history.pushState({}, "", "/"); refresh(); };
  if (location.pathname === "/admin") renderAdmin(surface, context.state, api, { refresh: rerender, ui: context.adminUi, hasAdmin: Boolean(context.adminSession), returnToStaff: () => { history.pushState({}, "", "/staff"); refresh(); } });
  else if (location.pathname === "/staff" || context.staffSession) renderStaff(surface, context.state, api, { login, adminLogin: loginAdmin, refresh: rerender, ui: context.staffUi, loggedIn: Boolean(context.staffSession), isAdmin: Boolean(context.adminSession), logout });
  else renderParticipant(surface, context.state, api, rerender);
  if (context.feedbackOpen) surface.insertAdjacentHTML("beforeend", feedbackModal());
  restoreDrafts(surface);
  restoreInputFocus(surface, focus);
}
function feedbackModal() { return `<div class="modal-backdrop feedback-backdrop"><section class="dispatch-modal feedback-modal" role="dialog" aria-modal="true" aria-label="提交反馈"><div class="modal-header"><div><h2>反馈</h2></div><button type="button" class="text-button" data-feedback-close>关闭</button></div><form id="feedback-form" class="stack"><label>你的反馈<textarea name="note" rows="4" maxlength="800" required placeholder="问题、建议或现场情况"></textarea></label><button>提交反馈</button></form></section></div>`; }
app.addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; if (button.dataset.feedback !== undefined) { context.feedbackOpen = true; render(); } if (button.dataset.feedbackClose !== undefined) { context.feedbackOpen = false; render(); } });
app.addEventListener("submit", async (event) => { const form = event.target; if (!(form instanceof HTMLFormElement) || form.id !== "feedback-form") return; event.preventDefault(); const button = form.querySelector("button"); if (button) button.disabled = true; try { await api.submitFeedback(new FormData(form).get("note")); context.feedbackOpen = false; await refresh(); } catch (error) { const notice = form.closest(".app-surface")?.querySelector(".notice"); if (notice) notice.textContent = error.message; else window.alert(error.message); } finally { if (button) button.disabled = false; } });
window.addEventListener("popstate", refresh);
refresh();
window.setInterval(refresh, 5000);
