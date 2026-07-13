import { renderParticipant } from "./participant.js";
import { renderAdmin } from "./admin.js";

const CLIENT_ID_KEY = "afc-meetup-client-id";
const PARTICIPANT_ID_KEY = "afc-meetup-participant-id";
const ADMIN_TOKEN_KEY = "afc-meetup-admin-token";

const app = document.querySelector("#app");
const url = new URL(window.location.href);
if (url.searchParams.get("admin")) {
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, url.searchParams.get("admin"));
  url.searchParams.delete("admin");
  window.history.replaceState({}, "", url);
}

const context = {
  state: null,
  clientId: getOrCreateId(CLIENT_ID_KEY),
  participantId: window.localStorage.getItem(PARTICIPANT_ID_KEY) || "",
  adminToken: window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || "",
  error: "",
  busy: false
};

const api = {
  getState: () => request("/api/state", { admin: Boolean(context.adminToken) }),
  createParticipant: async (payload) => {
    const result = await request("/api/participants", { method: "POST", body: payload });
    if (result.participant?.id) {
      context.participantId = result.participant.id;
      window.localStorage.setItem(PARTICIPANT_ID_KEY, context.participantId);
    }
    return result;
  },
  createTeam: (payload) => request("/api/teams", { method: "POST", body: payload }),
  joinTeam: (payload) => request("/api/teams/join", { method: "POST", body: payload }),
  adminCheckIn: (teamId) => request(`/api/admin/teams/${teamId}/check-in`, { method: "POST", admin: true }),
  adminSeat: (teamId, seatId) => request(`/api/admin/teams/${teamId}/seat`, { method: "POST", body: { seatId }, admin: true }),
  adminLock: (teamId) => request(`/api/admin/teams/${teamId}/lock`, { method: "POST", admin: true }),
  adminCompetitionApproval: (teamId, approved) =>
    request(`/api/admin/teams/${teamId}/competition-approval`, { method: "POST", body: { approved }, admin: true }),
  generateTournament: (templateId) =>
    request("/api/admin/tournament/generate", { method: "POST", body: { templateId }, admin: true }),
  recordResult: (matchId, homeScore, awayScore) =>
    request(`/api/admin/matches/${matchId}/result`, { method: "POST", body: { homeScore, awayScore }, admin: true })
};

async function refresh({ quiet = false } = {}) {
  context.busy = true;
  render();
  try {
    const result = await api.getState();
    context.state = result;
    context.error = "";
  } catch (error) {
    context.error = error.message || "暂时无法加载活动数据";
  } finally {
    context.busy = false;
    render();
    if (!quiet && context.error) announce(context.error);
  }
}

async function request(path, { method = "GET", body, admin = false } = {}) {
  const headers = { "x-client-id": context.clientId };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (admin) headers["x-admin-token"] = context.adminToken;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试");
  if (data.state) context.state = data.state;
  return data;
}

function render() {
  if (!context.state) {
    app.innerHTML = `<main class="loading-screen"><div class="ball-mark" aria-hidden="true">●</div><p>${context.error || "正在加载北京 MeetUp…"}</p></main>`;
    return;
  }

  const isAdmin = Boolean(context.state.admin);
  const mode = isAdmin ? "admin" : "participant";
  app.className = `app-shell ${mode}-mode`;
  const surface = document.createElement("div");
  surface.className = "app-surface";
  app.replaceChildren(surface);

  const onStateChange = async () => {
    await refresh({ quiet: true });
  };
  const scopedApi = {
    ...api,
    request: (path, options = {}) => request(path, {
      method: options.method || "GET",
      body: options.body,
      admin: path.startsWith("/api/admin/")
    }),
    getState: api.getState,
    refresh: async () => {
      await onStateChange();
      return context.state;
    },
    currentParticipantId: () => context.participantId,
    isBusy: () => context.busy
  };

  if (isAdmin) {
    renderAdmin(surface, context.state, scopedApi, onStateChange);
  } else {
    renderParticipant(surface, context.state, scopedApi, onStateChange);
  }
}

function getOrCreateId(key) {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function announce(message) {
  const element = document.querySelector("[role='status']");
  if (element) element.textContent = message;
}

refresh();
window.setInterval(() => refresh({ quiet: true }), 12_000);
