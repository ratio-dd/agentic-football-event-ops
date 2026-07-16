import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const PREFIX = "E2E验收演示";
const ADMIN_PIN = "meetup-admin";

type ApiOptions = { method?: string; staff?: string; body?: unknown; client?: string };
type DemoFixture = { staff: string; qualified: any[]; tournament: any };

async function api(request: APIRequestContext, path: string, { method = "GET", staff = "", body, client = "" }: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (staff) headers["x-staff-session"] = staff;
  if (staff) headers["x-admin-pin"] = ADMIN_PIN;
  if (client) headers["x-client-id"] = client;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await request.fetch(path, { method, headers, data: body });
  expect(response.ok(), `${method} ${path} should succeed`).toBeTruthy();
  return response.json();
}

const order = (teams: any[]) => [...teams].sort((a, b) => a.teamNumber.localeCompare(b.teamNumber, undefined, { numeric: true }));

async function ensureDemoState(request: APIRequestContext): Promise<DemoFixture> {
  const login = await api(request, "/api/ops/session", { method: "POST", body: { staffPin: "meetup-staff", staffNickname: "E2E 场景初始化" } });
  const staff = login.staffSession;
  await api(request, "/api/ops/event-gates", { method: "PUT", staff, body: { gates: { selfServiceTeam: true, codeIssuance: true, qualification: true, scheduleEditing: true } } });
  await api(request, "/api/ops/workshop-link", { method: "PUT", staff, body: { url: "https://workshop.example/e2e-demo" } });
  let state = await api(request, "/api/ops/state", { staff });
  let demoTeams = state.teams.filter((team: any) => team.members.some((member: any) => member.nickname.startsWith(PREFIX)));

  if (!demoTeams.length) {
    expect(state.codeSummary.issued, "场景初始化需要未被占用的本地 Code 库").toBe(0);
    const participants = [];
    for (let index = 1; index <= 12; index += 1) {
      participants.push(await api(request, "/api/participants", {
        method: "POST",
        client: `e2e-demo-phone-${index}`,
        body: { nickname: `${PREFIX}-${String(index).padStart(2, "0")}`, supportProfile: { techBackground: index % 2 ? "technical" : "nontechnical", workshopExperience: "no" } },
      }));
    }
    const people = participants.map((item) => item.participant);
    const teamIds = [];
    for (const person of people.slice(0, 10)) teamIds.push((await api(request, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.id] } })).team.id);
    await api(request, "/api/ops/codes/import", { method: "POST", staff, body: { codes: [...teamIds.map((_, index) => `E2E-DEMO-CODE-${String(index + 1).padStart(2, "0")}`), "E2E-DEMO-SPARE-CODE"] } });
    for (const teamId of teamIds) await api(request, `/api/ops/teams/${teamId}/issue-code`, { method: "POST", staff, body: {} });
    for (const teamId of teamIds.slice(0, 8)) await api(request, `/api/ops/qualification/teams/${teamId}/confirm`, { method: "POST", staff, body: {} });
    await api(request, `/api/ops/workshop/teams/${teamIds[8]}/status`, { method: "PUT", staff, body: { status: "in_progress", note: "正在部署 Agent" } });
    await api(request, `/api/ops/workshop/teams/${teamIds[9]}/status`, { method: "PUT", staff, body: { status: "blocked", note: "等待 TA 协助网络配置" } });
    state = await api(request, "/api/ops/state", { staff });
    demoTeams = state.teams.filter((team: any) => team.members.some((member: any) => member.nickname.startsWith(PREFIX)));
  }

  if (state.tournament) await api(request, "/api/ops/competition/void", { method: "POST", staff, body: { reason: "E2E 场景重置" } });
  const qualified = order(demoTeams).filter((team) => team.qualificationStatus === "ta_qualified").slice(0, 8);
  await api(request, "/api/ops/competition/freeze", { method: "POST", staff, body: { teamIds: qualified.map((team) => team.id) } });
  const tournament = await api(request, "/api/ops/competition/generate", { method: "POST", staff, body: { groupCount: 2, qualifiersPerGroup: 2 } });
  return { staff, qualified, tournament: tournament.tournament };
}

async function staffLogin(page: Page, nickname: string) {
  await page.goto("/staff");
  await page.getByLabel("Staff PIN").fill("meetup-staff");
  await page.getByLabel("你的昵称").fill(nickname);
  await page.getByRole("button", { name: "进入工作台" }).click();
}

test.describe.serial("现场演示数据：前端状态验收", () => {
  let fixture: DemoFixture;

  test.beforeAll(async ({ request }) => { fixture = await ensureDemoState(request); });

  test("赛前可在 Staff 端交换不同小组的两支队伍", async ({ page, request }, testInfo) => {
    await staffLogin(page, "E2E 分组验收");
    await page.getByRole("button", { name: "比赛", exact: true }).click();
    await expect(page.getByRole("heading", { name: "小组赛进行中" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "人工调整分组" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("01-staff-before-swap.png"), fullPage: true });

    const firstTeamId = fixture.tournament.groups[0].teamIds[0];
    const secondTeamId = fixture.tournament.groups[1].teamIds[0];
    await page.getByLabel("第一支队伍").selectOption(firstTeamId);
    await page.getByLabel("第二支队伍").selectOption(secondTeamId);
    await page.locator("#swap-groups input[name=adminPin]").fill(ADMIN_PIN);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "交换两队的小组位置" }).click();
    await expect(page.getByText("分组已调整，赛程已同步更新。")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-staff-after-swap.png"), fullPage: true });

    const updated = await api(request, "/api/ops/state", { staff: fixture.staff });
    expect(updated.tournament.groups[0].teamIds).toContain(secondTeamId);
    expect(updated.tournament.groups[1].teamIds).toContain(firstTeamId);
    fixture.tournament = updated.tournament;
  });

  test("TA 移动端能看到进行中、需协助和已参赛状态", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await staffLogin(page, "E2E TA 验收");
    await page.getByRole("button", { name: "TA", exact: true }).click();
    await page.getByRole("button", { name: "需协助", exact: true }).click();
    await expect(page.getByText("等待 TA 协助网络配置")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("03-ta-mobile-blocked.png"), fullPage: true });
    await page.getByRole("button", { name: "已参赛", exact: true }).click();
    await expect(page.getByText("已确认").first()).toBeVisible();
  });

  test("大屏显示积分榜、赛果与淘汰赛树", async ({ page, request }, testInfo) => {
    const state = await api(request, "/api/ops/state", { staff: fixture.staff });
    for (const [index, match] of state.tournament.matches.entries()) await api(request, `/api/ops/matches/${match.id}/result`, { method: "POST", staff: fixture.staff, body: { scoreA: 2 + (index % 2), scoreB: index % 3 } });
    await api(request, "/api/ops/competition/knockout", { method: "POST", staff: fixture.staff, body: {} });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/display");
    await expect(page).toHaveTitle("Agentic Football 现场大屏");
    await expect(page.getByRole("heading", { name: "淘汰赛", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A 组积分榜" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "淘汰赛对阵" })).toBeVisible();
    await expect(page.getByText("Staff PIN")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("04-display-desktop.png"), fullPage: true });
  });

  test("参赛者移动端能查看 Team Code、Workshop 链接和个人二维码", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("afc-event-ops-client", "e2e-demo-phone-1"));
    await page.goto("/");
    await expect(page.getByText("Team Code", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "进入 Workshop" })).toHaveAttribute("href", "https://workshop.example/e2e-demo");
    await page.getByRole("button", { name: "我的二维码" }).click();
    await expect(page.getByRole("img")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("05-participant-mobile-code-and-qr.png"), fullPage: true });
  });
});
