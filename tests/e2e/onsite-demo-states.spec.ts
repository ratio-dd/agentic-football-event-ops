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
  await expect(page.getByText("已确认参加比赛", { exact: true })).toBeVisible();
  await expect(page.getByText("赛程将在名单冻结后公布。", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("participant-resource-links.png"), fullPage: true });
});

test("Admin 冻结并生成赛程，Staff 录入赛果，参与者看到自己的积分和赛程", async ({ page, request }) => {
  const stamp = Date.now(); const login = await staffSession(request, `Admin 边界 ${stamp}`);
  const people = [];
  for (let index = 1; index <= 4; index += 1) people.push(await api(request, "/api/participants", { method: "POST", client: `e2e-admin-${stamp}-${index}`, body: { nickname: `Admin边界${stamp}-${index}`, supportProfile: {} } }));
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
  await expect(page.locator(".admin-flow-notice")).toContainText("下一步：自动生成小组赛");
  await page.getByRole("button", { name: "自动生成分组草稿" }).click();
  await expect(page.getByRole("heading", { name: /小组赛/ })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "比赛", exact: true })).toBeVisible();
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

test("Admin 追加导入 Code、库存统计与全选切换保持一致", async ({ page, request }) => {
  const stamp = Date.now(); let adminStateRequests = 0; const acceptanceTeamIds: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/admin/state") adminStateRequests += 1; });
  for (let index = 1; index <= 2; index += 1) { const registered = await api(request, "/api/participants", { method: "POST", client: `admin-code-ui-${stamp}-${index}`, body: { nickname: `Code界面${stamp}-${index}`, supportProfile: {} } }); acceptanceTeamIds.push(registered.team.id); }
  const baselineLogin = await staffSession(request, `Code 基线 ${stamp}`); const baselineAdmin = await adminSession(request, baselineLogin.staffSession);
  const baseline = await api(request, "/api/admin/state", { staff: baselineLogin.staffSession, admin: baselineAdmin.adminSession });
  const beforeWorkshop = baseline.codeSummary.workshop; const beforePortal = baseline.codeSummary.gamePortal;
  const unissuedCount = baseline.teams.filter((team: { status: string; workshopCodeId?: string; gamePortalCodeId?: string }) => team.status !== "dissolved" && !team.workshopCodeId && !team.gamePortalCodeId).length;
  await staffLogin(page, `Code Admin ${stamp}`);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.getByRole("button", { name: "资源管理" }).click();

  const workshopMetric = page.locator(".admin-metrics article").filter({ hasText: "Workshop 可用" });
  const portalMetric = page.locator(".admin-metrics article").filter({ hasText: "Game Portal 可用" });
  await page.getByLabel("Workshop Code").fill(`UI-W-${stamp}-1\nUI-W-${stamp}-1\nUI-W-${stamp}-2`);
  await page.getByLabel("Game Portal Code").fill(`UI-G-${stamp}-1\nUI-G-${stamp}-1\nUI-G-${stamp}-2`);
  await page.getByRole("button", { name: "导入已填写的 Code" }).click();
  await expect(page.locator(".notice")).toContainText("已新增 Workshop 2 个、Game Portal 2 个；跳过重复 2 个。");
  await expect(workshopMetric).toContainText(`${beforeWorkshop.available + 2} 可用`); await expect(workshopMetric).toContainText(`总计 ${beforeWorkshop.total + 2} · 已发 ${beforeWorkshop.issued}`);
  await expect(portalMetric).toContainText(`${beforePortal.available + 2} 可用`); await expect(portalMetric).toContainText(`总计 ${beforePortal.total + 2} · 已发 ${beforePortal.issued}`);

  const teamChecks = page.locator('#admin-batch-issue input[name="teamId"]');
  const checkedTeams = page.locator('#admin-batch-issue input[name="teamId"]:checked');
  await expect(teamChecks).toHaveCount(unissuedCount); await expect(checkedTeams).toHaveCount(unissuedCount);
  await page.getByRole("button", { name: "取消全选" }).click();
  await expect(checkedTeams).toHaveCount(0);
  const requestsBeforeWait = adminStateRequests; await page.waitForTimeout(5_500);
  expect(adminStateRequests).toBe(requestsBeforeWait); await expect(checkedTeams).toHaveCount(0);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await expect(checkedTeams).toHaveCount(unissuedCount);
  await page.route("**/api/ops/codes/batch-issue", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "库存不足：还需 Workshop 1 个、Game Portal 1 个" }) }), { times: 1 });
  const shortageDialog = page.waitForEvent("dialog");
  await page.getByRole("button", { name: "向所选队伍发放 Workshop + Game Portal Code" }).click();
  const dialog = await shortageDialog; expect(dialog.type()).toBe("alert"); expect(dialog.message()).toBe("库存不足：还需 Workshop 1 个、Game Portal 1 个"); await dialog.accept();
  await expect(page.locator(".notice")).toContainText("库存不足：还需 Workshop 1 个、Game Portal 1 个");
  await page.getByRole("button", { name: "取消全选" }).click();
  for (const teamId of acceptanceTeamIds) await page.locator(`#admin-batch-issue input[name="teamId"][value="${teamId}"]`).check();
  await expect(checkedTeams).toHaveCount(acceptanceTeamIds.length);
  await page.getByRole("button", { name: "向所选队伍发放 Workshop + Game Portal Code" }).click();
  await expect(workshopMetric).toContainText(`${beforeWorkshop.available} 可用`); await expect(workshopMetric).toContainText(`总计 ${beforeWorkshop.total + 2} · 已发 ${beforeWorkshop.issued + 2}`);
  await expect(portalMetric).toContainText(`${beforePortal.available} 可用`); await expect(portalMetric).toContainText(`总计 ${beforePortal.total + 2} · 已发 ${beforePortal.issued + 2}`);

  await page.getByLabel("Workshop Code").fill(`UI-W-${stamp}-3`);
  await page.getByLabel("Game Portal Code").fill(`UI-G-${stamp}-3`);
  await page.getByRole("button", { name: "导入已填写的 Code" }).click();
  await expect(page.locator(".notice")).toContainText("已新增 Workshop 1 个、Game Portal 1 个。");
  await expect(workshopMetric).toContainText(`${beforeWorkshop.available + 1} 可用`); await expect(workshopMetric).toContainText(`总计 ${beforeWorkshop.total + 3} · 已发 ${beforeWorkshop.issued + 2}`);
  await expect(portalMetric).toContainText(`${beforePortal.available + 1} 可用`); await expect(portalMetric).toContainText(`总计 ${beforePortal.total + 3} · 已发 ${beforePortal.issued + 2}`);
});
