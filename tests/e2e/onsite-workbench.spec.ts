import { expect, test } from "@playwright/test";

test("参与者问卷在自动刷新后保留尚未提交的选择", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("昵称", { exact: true }).fill("刷新测试员");
  await page.getByLabel("技术背景").selectOption("nontechnical");
  await page.getByLabel("是否做过 AWS Workshop").selectOption("yes");

  // The product polls every five seconds. Verify a complete DOM rebuild does
  // not silently return a participant to the default survey choices.
  await page.waitForTimeout(5_500);

  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("刷新测试员");
  await expect(page.getByLabel("技术背景")).toHaveValue("nontechnical");
  await expect(page.getByLabel("是否做过 AWS Workshop")).toHaveValue("yes");
});

test("Staff stays on the selected daily-work tab after polling refresh", async ({ page }) => {
  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill("E2E TA");
  await page.getByRole("button", { name: "进入工作台" }).click();

  await page.getByRole("button", { name: "Workshop", exact: true }).click();
  await expect(page.getByRole("heading", { name: /待 TA 确认/ })).toBeVisible();

  await page.waitForTimeout(5_500);

  await expect(page.getByRole("button", { name: "Workshop", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: /待 TA 确认/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "下一步一眼可见" })).toHaveCount(0);
});

test("Staff sees an actionable QR result and can return to manual search", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const response = await request.post("/api/participants", { data: { nickname: `扫码结果${stamp}` }, headers: { "x-client-id": `qr-result-${stamp}` } });
  expect(response.ok()).toBeTruthy();
  const participant = (await response.json()).participant;
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
  }, participant.staffShortId);

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`扫码验收 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();
  await page.getByRole("button", { name: "扫描参与者二维码" }).click();

  await expect(page.getByText("扫描结果", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: participant.nickname })).toBeVisible();
  await expect(page.locator(".scan-result")).toContainText(participant.staffShortId);
  await expect(page.getByRole("button", { name: "选中并调度" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("09-qr-result-mobile.png"), fullPage: false });

  await page.getByRole("button", { name: "选中并调度" }).click();
  await expect(page.getByText("已选择 1 / 3 人")).toBeVisible();
  await page.getByRole("button", { name: "重新扫码" }).click();
  await expect(page.getByRole("button", { name: "关闭扫描" })).toBeVisible();
  await page.getByRole("button", { name: "关闭扫描" }).click();
  await expect(page.locator(".scanner video")).toHaveCount(0);
  await expect(page.getByLabel("查找人员")).toBeVisible();
});

test("participant registration waits for Staff allocation without a T-number", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("昵称", { exact: true }).fill(`自动编组体验员${Date.now()}`);
  await page.getByRole("button", { name: "完成登记" }).click();

  await expect(page.getByRole("heading", { name: "等待工作人员安排队伍" })).toBeVisible();
  await expect(page.getByText("队伍编号", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/T-\d{3}/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /创建一个队伍|加入队伍/ })).toHaveCount(0);
  await expect(page.getByText("队长", { exact: true })).toHaveCount(0);
});

test("Staff creates a new team with one final confirmation and immediate pending feedback", async ({ page, request }) => {
  const stamp = Date.now();
  const participantResponse = await request.post("/api/participants", { data: { nickname: `新队确认${stamp}` }, headers: { "x-client-id": `new-team-confirm-${stamp}` } });
  expect(participantResponse.ok()).toBeTruthy();
  const participant = (await participantResponse.json()).participant;
  const stateSessionResponse = await request.post("/api/ops/session", { data: { staffPin: "meetup-staff", staffNickname: `新队断言 ${stamp}` } });
  expect(stateSessionResponse.ok()).toBeTruthy();
  const stateSession = (await stateSessionResponse.json()).staffSession;
  let assignmentRequests = 0;
  await page.route("**/api/ops/assignments", async (route) => {
    assignmentRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`新队流程 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();
  await page.getByLabel("查找人员").fill(`新队确认${stamp}`);
  await page.locator(`[data-person-id="${participant.id}"]`).click();
  await page.getByRole("button", { name: "下一步：确认新队" }).click();
  await expect(page.getByRole("heading", { name: "确认组成新队" })).toBeVisible();
  const confirm = page.getByRole("button", { name: "确认创建队伍" });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page.getByText("人员与队伍关系已更新。")).toBeVisible();
  expect(assignmentRequests).toBe(1);

  const stateResponse = await request.get("/api/ops/state", { headers: { "x-staff-session": stateSession } });
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  const createdTeam = state.teams.find((team: any) => team.memberIds.includes(participant.id));
  expect(createdTeam).toBeTruthy();
  expect(createdTeam.memberIds).toEqual([participant.id]);
});

test("public display is readable without Staff controls", async ({ page }) => {
  await page.goto("/display");
  await expect(page).toHaveTitle("Agentic Football 现场大屏");
  await expect(page.locator("#display-app")).toContainText(/agentic football/i);
  await expect(page.getByText("工作台 PIN")).toHaveCount(0);
});

test("Staff can elevate to Admin from the More menu without a second Staff login", async ({ page }) => {
  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill("E2E 管理员");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(page.getByRole("heading", { name: "进入管理后台" })).toBeVisible();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "活动设置与例外处理" })).toBeVisible();
  await page.getByRole("button", { name: "返回 Staff" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.locator(".metric-grid")).toBeVisible();
});

test("Staff can move people from either board and sees capacity before a batch dispatch", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const call = async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const response = await request.fetch(path, { method, data: body, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } });
    expect(response.ok(), `${method} ${path}`).toBeTruthy(); return response.json();
  };
  const staff = await call("/api/ops/session", "POST", { staffPin: "meetup-staff", staffNickname: `调度 E2E ${stamp}` });
  const staffHeaders = { "x-staff-session": staff.staffSession };
  const people = [];
  for (let index = 1; index <= 5; index += 1) people.push((await call("/api/participants", "POST", { nickname: `调度体验${stamp}-${index}` }, { "x-client-id": `dispatch-e2e-${stamp}-${index}` })).participant);
  const teamA = (await call("/api/ops/teams", "POST", { memberIds: [people[0].id] }, staffHeaders)).team;
  const teamB = (await call("/api/ops/teams", "POST", { memberIds: [people[1].id, people[2].id] }, staffHeaders)).team;

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`界面调度 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();
  await page.getByLabel("查找人员").fill(`调度体验${stamp}-1`);
  await page.locator(`[data-person-id="${people[0].id}"]`).click();
  await page.getByRole("button", { name: "加入队伍" }).click();
  await expect(page.locator("#team-picker-search")).toBeVisible();
  await page.locator("#team-picker-search").fill(teamB.teamNumber.replace("T-", ""));
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toBeEnabled();
  await page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`).click();
  await expect(page.getByRole("heading", { name: `确认加入 ${teamB.teamNumber}` })).toBeVisible();
  await page.getByRole("button", { name: "确认加入队伍" }).click();
  await expect(page.getByText("人员与队伍关系已更新。")).toBeVisible();

  const moved = await call("/api/ops/state", "GET", undefined, staffHeaders);
  expect(moved.participants.find((person: any) => person.id === people[0].id).teamId).toBe(teamB.id);
  expect(moved.teams.find((team: any) => team.id === teamA.id).status).toBe("dissolved");

  const teamsTab = page.locator('[data-grouping-tab="teams"]');
  await expect(teamsTab).toHaveCount(1); await teamsTab.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const config = page.locator(`[data-action="open-team-config"][data-team-id="${teamB.id}"]`);
  await expect(config).toHaveCount(1); await config.click();
  await expect(page.getByRole("heading", { name: teamB.teamNumber, exact: true })).toBeVisible();
  await expect(page.locator(`[data-person-id="${people[3].id}"]`)).toBeVisible();
  await expect(page.locator('[data-team-people-filter="unassigned"]')).toBeVisible();
  await page.locator(`[data-action="confirm-team"][data-team-id="${teamB.id}"]`).click();
  await expect(page.getByText("队伍已确认，可以发放 Code。")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("06-team-config-ready-for-code-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "关闭" }).click();
  const peopleTab = page.locator('[data-grouping-tab="people"]');
  await expect(peopleTab).toHaveCount(1); await peopleTab.click();

  await page.getByLabel("查找人员").fill(`调度体验${stamp}-4`);
  await page.locator(`[data-person-id="${people[3].id}"]`).click();
  await page.getByLabel("查找人员").fill(`调度体验${stamp}-5`);
  await page.locator(`[data-person-id="${people[4].id}"]`).click();
  await page.getByRole("button", { name: "加入队伍" }).click();
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toBeDisabled();
  await expect(page.getByText("容量不足").last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("07-team-picker-capacity-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await teamsTab.click();
  await expect(config).toContainText("管理");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("08-person-team-dispatch-mobile.png"), fullPage: true });
});
