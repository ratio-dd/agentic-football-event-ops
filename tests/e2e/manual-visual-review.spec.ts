import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const enabled = process.env.CAPTURE_VISUAL_REVIEW === "1";
const ADMIN_PIN = "meetup-admin";

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

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
      message: `截图 ${name} 前不应出现横向溢出`,
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test.describe("人工视觉审核画廊（仅 CAPTURE_VISUAL_REVIEW=1）", () => {
  test.skip(!enabled, "这是按需生成的审核画廊，不进入常规 CI。");

  test("覆盖参与者、现场运营与大屏的全部主要页面状态", async ({ page, request }, testInfo) => {
    const stamp = Date.now();
    const participantName = `画廊参与者${stamp}`;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await capture(page, testInfo, "01-participant-registration");
    await page.getByLabel("昵称", { exact: true }).fill(participantName);
    await page.getByRole("button", { name: "完成登记" }).click();
    await expect(page.getByRole("heading", { name: "等待工作人员安排队伍" })).toBeVisible();
    await capture(page, testInfo, "02-participant-waiting-team");

    const staffLogin = await api(request, "/api/ops/session", { method: "POST", body: { staffPin: "meetup-staff", staffNickname: `画廊初始化${stamp}` } });
    const staff = staffLogin.staffSession;
    const elevated = await api(request, "/api/admin/session", { method: "POST", staff, body: { adminPin: ADMIN_PIN } });
    const admin = elevated.adminSession;
    const stateAfterRegistration = await api(request, "/api/ops/state", { staff });
    const registeredParticipant = stateAfterRegistration.participants.find((person: { nickname?: string }) => person.nickname === participantName);
    const assigned = await api(request, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [registeredParticipant.id] } });
    const selfTeam = assigned.team;
    await page.reload();
    await expect(page.getByText("队伍编号", { exact: true })).toBeVisible();
    await capture(page, testInfo, "03-participant-staff-assigned-team");
    const workshopCodes = Array.from({ length: 12 }, (_, index) => `VISUAL-WORKSHOP-${stamp}-${index + 1}`);
    await api(request, "/api/ops/codes/import", { method: "POST", staff, admin, body: { workshopCodes, gamePortalCodes: workshopCodes.map((code) => `VISUAL-PORTAL-${code}`) } });
    await api(request, `/api/ops/teams/${selfTeam.id}/issue-code`, { method: "POST", staff, body: {} });
    await page.goto("/");
    await page.getByRole("button", { name: "我的二维码" }).click();
    await expect(page.getByText("Workshop Code", { exact: true })).toBeVisible();
    await capture(page, testInfo, "04-participant-code-and-qr");
    await api(request, `/api/ops/qualification/teams/${selfTeam.id}/confirm`, { method: "POST", staff, body: {} });
    await page.reload();
    await expect(page.getByText("已确认参加下午比赛", { exact: true })).toBeVisible();
    await capture(page, testInfo, "04a-participant-qualified");

    const people: Array<{ id: string; staffShortId: string }> = [];
    for (let index = 1; index <= 5; index += 1) {
      const created = await api(request, "/api/participants", { method: "POST", client: `visual-review-${stamp}-${index}`, body: { nickname: `画廊人员${stamp}-${index}` } });
      people.push(created.participant);
    }
    const teams: Array<{ id: string; teamNumber: string }> = [];
    for (const person of people.slice(0, 4)) {
      teams.push((await api(request, "/api/ops/teams", { method: "POST", staff, body: { memberIds: [person.id] } })).team);
    }
    for (const team of teams) await api(request, `/api/ops/teams/${team.id}/issue-code`, { method: "POST", staff, body: {} });
    for (const team of teams) await api(request, `/api/ops/qualification/teams/${team.id}/confirm`, { method: "POST", staff, body: {} });
    await api(request, "/api/ops/competition/freeze", { method: "POST", staff, admin, body: { teamIds: teams.map((team) => team.id) } });
    await api(request, "/api/ops/competition/generate", { method: "POST", staff, admin, body: { groupCount: 2, qualifiersPerGroup: 1 } });

    await page.addInitScript((shortId) => {
      let hasScanned = false;
      class MockBarcodeDetector {
        async detect() {
          if (!hasScanned) { hasScanned = true; return [{ rawValue: shortId }]; }
          return [];
        }
      }
      Object.defineProperty(window, "BarcodeDetector", { configurable: true, value: MockBarcodeDetector });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => new MediaStream() } });
    }, people[4].staffShortId);

    await page.goto("/staff");
    await capture(page, testInfo, "05-staff-login");
    await page.getByLabel("工作台 PIN").fill("meetup-staff");
    await page.getByLabel("显示昵称").fill(`画廊审核${stamp}`);
    await page.getByRole("button", { name: "进入工作台" }).click();
    await expect(page.locator(".metric-grid")).toBeVisible();
    await capture(page, testInfo, "06-staff-overview");

    await page.getByRole("button", { name: "组队", exact: true }).click();
    await capture(page, testInfo, "07-staff-people-board");
    await page.getByRole("button", { name: "扫描参与者二维码" }).click();
    await expect(page.getByText("扫描结果", { exact: true })).toBeVisible();
    await capture(page, testInfo, "07a-staff-qr-scan-result");
    await page.getByRole("button", { name: "选中并调度" }).click();
    await capture(page, testInfo, "08-staff-people-selected");
    await page.getByRole("button", { name: "下一步：确认新队" }).click();
    await expect(page.getByRole("heading", { name: "确认组成新队" })).toBeVisible();
    await capture(page, testInfo, "09-staff-assignment-confirm");
    await page.getByRole("button", { name: "取消" }).click();

    await page.locator('[data-grouping-tab="teams"]').click();
    await capture(page, testInfo, "10-staff-team-board");
    await page.locator(`[data-action="open-team-config"][data-team-id="${teams[0].id}"]`).click();
    await expect(page.getByRole("heading", { name: teams[0].teamNumber, exact: true })).toBeVisible();
    await capture(page, testInfo, "11-staff-team-config");
    await page.getByRole("button", { name: "关闭", exact: true }).click();

    await page.getByRole("button", { name: "Workshop", exact: true }).click();
    await capture(page, testInfo, "12-staff-workshop");
    await page.getByRole("button", { name: "比赛", exact: true }).click();
    await expect(page.getByRole("heading", { name: "小组赛赛果录入" })).toBeVisible();
    await capture(page, testInfo, "14-staff-competition");
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByLabel("Admin PIN").fill(ADMIN_PIN);
    await page.getByRole("button", { name: "进入管理后台" }).click();
    await capture(page, testInfo, "15-admin-activity");

    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, testInfo, "15a-admin-desktop");
    await page.goto("/display");
    await expect(page.getByRole("heading", { name: "A 组积分榜" })).toBeVisible();
    await capture(page, testInfo, "16-public-display");
  });
});
