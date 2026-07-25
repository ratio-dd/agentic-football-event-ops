import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type ApiOptions = { method?: string; staff?: string; admin?: string; body?: unknown; client?: string };

async function api(request: APIRequestContext, path: string, { method = "GET", staff = "", admin = "", body, client = "" }: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (staff) headers["x-staff-session"] = staff;
  if (admin) headers["x-admin-session"] = admin;
  if (client) headers["x-client-id"] = client;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await request.fetch(path, { method, headers, data: body });
  expect(response.ok(), `${method} ${path}`).toBeTruthy();
  return response.json();
}

async function staffSession(request: APIRequestContext, nickname: string) {
  return api(request, "/api/ops/session", { method: "POST", body: { staffPin: "meetup-staff", staffNickname: nickname } });
}
async function adminSession(request: APIRequestContext, staff: string) {
  return api(request, "/api/admin/session", { method: "POST", staff, body: { adminPin: "meetup-admin" } });
}
async function staffLogin(page: Page, nickname: string) {
  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(nickname);
  await page.getByRole("button", { name: "进入工作台" }).click();
}

test("Staff 在 Workshop 页确认练习赛，参与者看到资源与比赛入口", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const client = `e2e-resource-${stamp}`;
  const participant = await api(request, "/api/participants", { method: "POST", client, body: { nickname: `资源参赛者${stamp}`, supportProfile: {} } });
  const login = await staffSession(request, `资源 TA ${stamp}`); const admin = await adminSession(request, login.staffSession);
  const team = await api(request, "/api/ops/teams", { method: "POST", staff: login.staffSession, body: { memberIds: [participant.participant.id] } });
  const workshopCodes = Array.from({ length: 5 }, (_, index) => `E2E-WORKSHOP-${stamp}-${index + 1}`);
  await api(request, "/api/ops/codes/import", { method: "POST", staff: login.staffSession, admin: admin.adminSession, body: { workshopCodes, gamePortalCodes: workshopCodes.map((code) => `E2E-PORTAL-${code}`) } });
  await api(request, "/api/ops/event-links", { method: "PUT", staff: login.staffSession, admin: admin.adminSession, body: { workshopUrl: "https://example.com/workshop-e2e", gamePortalUrl: "https://agentic-football.aws.dev/" } });
  await api(request, `/api/ops/teams/${team.team.id}/issue-code`, { method: "POST", staff: login.staffSession, body: {} });

  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, `界面 TA ${stamp}`);
  await page.getByRole("button", { name: "Workshop", exact: true }).click();
  await expect(page.getByRole("heading", { name: /待 TA 确认/ })).toBeVisible();
  await expect(page.getByText(`Workshop Code：${workshopCodes[0]}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Game Portal Code：E2E-PORTAL-${workshopCodes[0]}`, { exact: true })).toBeVisible();
  await expect(page.locator(`[data-action="qualify"][data-team-id="${team.team.id}"]`)).toHaveClass(/qualify-button/);
  await expect(page.locator(`[data-action="workshop-note"][data-team-id="${team.team.id}"]`)).toHaveClass(/note-button/);
  await page.screenshot({ path: testInfo.outputPath("staff-workshop-pending.png"), fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`[data-action="qualify"][data-team-id="${team.team.id}"]`).click();
  await expect(page.getByText("该队已确认可参赛。")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("staff-workshop-qualified.png"), fullPage: true });

  await page.evaluate(() => sessionStorage.clear());
  await page.addInitScript((id) => localStorage.setItem("afc-event-ops-client", id), client);
  await page.goto("/");
  await expect(page.locator(".code-card")).toContainText("Workshop Code");
  await expect(page.getByRole("link", { name: "进入 Workshop" })).toHaveAttribute("href", "https://example.com/workshop-e2e");
  await expect(page.getByRole("link", { name: "打开 Game Portal" })).toHaveAttribute("href", "https://agentic-football.aws.dev/");
  await expect(page.getByText("已确认参加下午比赛", { exact: true })).toBeVisible();
  await expect(page.getByText("赛程将在名单冻结后公布。", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("participant-resource-links.png"), fullPage: true });
});

test("Admin 可按需开启参与者求助，关闭后隐藏入口但不遗失存量请求", async ({ page }) => {
  const stamp = Date.now(); const client = `e2e-help-${stamp}`; const nickname = `求助参与者${stamp}`; const staffNickname = `求助 TA ${stamp}`;
  await page.goto(`/?acceptanceClient=${client}`);
  await page.getByRole("textbox", { name: "昵称", exact: true }).fill(nickname);
  await page.getByRole("button", { name: /完成登记/ }).click();
  await expect(page.getByRole("heading", { name: "需要现场协助？" })).toHaveCount(0);

  await staffLogin(page, `${staffNickname} 开关`);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  const helpToggle = page.locator('input[name="participantHelp"]');
  await expect(helpToggle).not.toBeChecked();
  await helpToggle.check();
  await page.getByRole("button", { name: "保存活动设置" }).click();
  await expect(page.getByText("活动设置已保存。")).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`/?acceptanceClient=${client}`);
  await expect(page.getByRole("heading", { name: "需要现场协助？" })).toBeVisible();
  await page.getByLabel("求助类型").selectOption("game_portal");
  await page.getByRole("button", { name: "呼叫 TA" }).click();
  await expect(page.getByRole("heading", { name: "求助处理中" })).toBeVisible();
  await expect(page.getByText("已通知 Staff / TA，请留意现场呼叫")).toBeVisible();

  await staffLogin(page, staffNickname);
  await page.getByRole("button", { name: "Workshop", exact: true }).click();
  const requestCard = page.locator("[data-help-request-id]", { hasText: nickname });
  await expect(requestCard).toContainText("Game Portal 连接或练习赛");
  await requestCard.getByRole("button", { name: "接单" }).click();
  await expect(page.locator("[data-help-request-id]", { hasText: nickname })).toContainText(`${staffNickname} 正在处理`);
  await page.locator("[data-help-request-id]", { hasText: nickname }).getByRole("button", { name: "标记已解决" }).click();
  await expect(page.locator("[data-help-request-id]", { hasText: nickname })).toHaveCount(0);

  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.locator('input[name="participantHelp"]').uncheck();
  await page.getByRole("button", { name: "保存活动设置" }).click();
  await expect(page.getByText("活动设置已保存。")).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`/?acceptanceClient=${client}`);
  await expect(page.getByText("最近一次求助已解决：Game Portal 连接或练习赛")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "呼叫 TA" })).toHaveCount(0);
});

test("Admin 冻结并生成赛程，Staff 录入赛果，参与者看到自己的积分和赛程", async ({ page, request }) => {
  const stamp = Date.now(); const login = await staffSession(request, `Admin 边界 ${stamp}`);
  const people = [];
  for (let index = 1; index <= 2; index += 1) people.push(await api(request, "/api/participants", { method: "POST", client: `e2e-admin-${stamp}-${index}`, body: { nickname: `Admin边界${stamp}-${index}`, supportProfile: {} } }));
  const teams = [];
  for (const person of people) teams.push(await api(request, "/api/ops/teams", { method: "POST", staff: login.staffSession, body: { memberIds: [person.participant.id] } }));
  for (const item of teams) {
    await api(request, `/api/ops/teams/${item.team.id}/issue-code`, { method: "POST", staff: login.staffSession, body: {} });
    await api(request, `/api/ops/qualification/teams/${item.team.id}/confirm`, { method: "POST", staff: login.staffSession, body: {} });
  }
  const denied = await request.post("/api/ops/competition/freeze", { headers: { "x-staff-session": login.staffSession }, data: { teamIds: teams.map((item) => item.team.id) } });
  expect(denied.status()).toBe(403);
  await staffLogin(page, `赛事 Admin ${stamp}`);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.getByRole("button", { name: "比赛管理" }).click();
  await expect(page.getByRole("button", { name: "冻结名单" })).toBeVisible();
  const selectedCount = await page.locator('#admin-freeze-roster input[name="teamId"]:checked').count();
  await page.getByRole("button", { name: "冻结名单" }).click();
  await expect(page.getByRole("heading", { name: `已冻结 ${selectedCount} 支队伍` })).toBeVisible();
  await expect(page.locator(".admin-flow-notice")).toContainText("下一步：设置小组数量并生成小组赛");
  await page.getByRole("button", { name: "生成分组草稿" }).click();
  await expect(page.getByRole("heading", { name: "小组赛" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开 Staff 赛果录入" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开现场大屏" })).toBeVisible();

  const state = await api(request, "/api/ops/state", { staff: login.staffSession });
  const targetTeam = state.teams.find((team: { memberIds: string[]; id: string }) => team.memberIds.includes(people[0].participant.id));
  const match = state.tournament.matches.find((candidate: { teamAId: string; teamBId: string }) => candidate.teamAId === targetTeam.id || candidate.teamBId === targetTeam.id);
  const result = match.teamAId === targetTeam.id ? { scoreA: 2, scoreB: 0 } : { scoreA: 0, scoreB: 2 };
  await api(request, `/api/ops/matches/${match.id}/result`, { method: "POST", staff: login.staffSession, body: result });
  await page.evaluate(() => sessionStorage.clear());
  await page.addInitScript((client) => localStorage.setItem("afc-event-ops-client", client), `e2e-admin-${stamp}-1`);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "下午比赛", exact: true })).toBeVisible();
  await expect(page.getByText("积分 3", { exact: true })).toBeVisible();
  await expect(page.getByText("净胜球 +2", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的赛程" })).toBeVisible();
  await expect(page.getByText(`${result.scoreA} : ${result.scoreB}`, { exact: true })).toBeVisible();
});

test("Admin feedback inbox only appears after elevated session", async ({ page, request }) => {
  await api(request, "/api/feedback", { method: "POST", body: { note: "E2E feedback", page: "/", actorType: "participant", actorLabel: "匿名参与者" } });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "请从 Staff 工作台进入" })).toBeVisible();
  await staffLogin(page, "反馈管理员");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.getByRole("button", { name: "反馈与记录" }).click();
  await expect(page.getByText("E2E feedback")).toBeVisible();
  await expect(page.getByText("匿名访客").first()).toBeVisible();
});
