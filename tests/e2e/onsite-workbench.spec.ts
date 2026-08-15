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

test("参与者恢复状态面板在自动刷新后保持展开", async ({ page }) => {
  await page.goto("/");
  const restorePanel = page.locator(".ticket-details");
  await restorePanel.locator("summary").click();
  await expect(restorePanel).toHaveAttribute("open", "");

  await page.waitForTimeout(5_500);

  await expect(restorePanel).toHaveAttribute("open", "");
  await expect(page.getByLabel("原昵称")).toBeVisible();
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

test("stale Staff and Admin sessions return to the PIN login instead of trapping every page", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("afc-event-ops-staff", "expired-staff-session");
    sessionStorage.setItem("afc-event-ops-admin", "expired-admin-session");
  });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByLabel("工作台 PIN")).toBeVisible();
  await expect(page.locator(".notice")).toContainText("登录状态已失效");
  await expect(page.getByText("需要工作人员 PIN")).toHaveCount(0);
});

test("participant and Staff identify people by nickname without P-number or QR controls", async ({ page, request }) => {
  const stamp = Date.now();
  const clientId = `nickname-only-${stamp}`;
  const response = await request.post("/api/participants", { data: { nickname: `昵称查找${stamp}` }, headers: { "x-client-id": clientId } });
  expect(response.ok()).toBeTruthy();
  const participant = (await response.json()).participant;

  await page.goto(`/?acceptanceClient=${clientId}`);
  await expect(page.getByText("你的昵称", { exact: true })).toBeVisible();
  await expect(page.locator(".person-ticket-number")).toHaveText(participant.nickname);
  await expect(page.getByRole("button", { name: "我的二维码" })).toHaveCount(0);
  await expect(page.getByText(/P-\d{3}/)).toHaveCount(0);

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`昵称验收 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();
  await expect(page.getByRole("button", { name: "扫描参与者二维码" })).toHaveCount(0);
  await expect(page.locator(".scanner")).toHaveCount(0);
  await expect(page.getByText(/P-\d{3}/)).toHaveCount(0);
  await page.getByLabel("查找人员").fill(participant.nickname);
  const row = page.locator(`[data-person-id="${participant.id}"]`);
  await expect(row).toContainText(participant.nickname);
  await row.click();
  await expect(page.getByText("已选择 1 人")).toBeVisible();
});

test("participant registration immediately receives a confirmed solo T-number", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("昵称", { exact: true }).fill(`自动编组体验员${Date.now()}`);
  await page.getByRole("button", { name: "完成登记" }).click();

  await expect(page.getByText("队伍编号", { exact: true })).toBeVisible();
  await expect(page.getByText(/T-\d{3}/)).toBeVisible();
  await expect(page.getByText("✓ 队伍已就绪", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "合并为新队" }).click();
  await expect(page.getByRole("heading", { name: "确认组成新队" })).toBeVisible();
  const confirm = page.getByRole("button", { name: "确认创建队伍" });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page.getByText("人员与队伍关系已更新。")).toBeVisible();
  expect(assignmentRequests).toBe(1);

  const stateResponse = await request.get("/api/ops/state", { headers: { "x-staff-session": stateSession } });
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  const createdTeam = state.teams.find((team: { memberIds: string[] }) => team.memberIds.includes(participant.id));
  expect(createdTeam).toBeTruthy();
  expect(createdTeam.memberIds).toEqual([participant.id]);
});

test("public display is readable without Staff controls", async ({ page }) => {
  await page.goto("/display");
  await expect(page).toHaveTitle("Agentic Football 现场大屏");
  await expect(page.locator("#display-app")).toContainText(/agentic football/i);
  await expect(page.getByText("工作台 PIN")).toHaveCount(0);
});

test("public display switches to a 16-team knockout progression without creating later rounds", async ({ page }, testInfo) => {
  const knockoutMatches = Array.from({ length: 8 }, (_, index) => {
    const teamALabel = `T-${String(index + 1).padStart(3, "0")}`;
    const teamBLabel = `T-${String(16 - index).padStart(3, "0")}`;
    const completed = index < 2;
    return {
      id: `round-1-match-${index + 1}`,
      stage: "knockout",
      round: 1,
      teamALabel,
      teamBLabel,
      status: completed ? "completed" : "ready",
      scoreA: completed ? 2 : null,
      scoreB: completed ? 1 : null,
      winnerLabel: completed ? teamALabel : "待定",
    };
  });
  await page.route("**/api/display", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        event: { name: "Agentic Football 现场运营台" },
        tournament: {
          status: "knockout",
          currentGroupRound: 3,
          totalGroupRounds: 3,
          currentKnockoutRound: 1,
          totalKnockoutRounds: 4,
          groups: [],
          matches: [],
          // Only round one exists in business data. The later cards rendered
          // by the display are presentation placeholders, not match records.
          knockoutMatches,
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/display");
  const bracketButton = page.getByRole("button", { name: "淘汰赛对阵图" });
  await expect(bracketButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".knockout-stage")).toBeVisible();
  const bracket = page.locator(".knockout-bracket-svg");
  await expect(bracket.getByText("1/8 决赛", { exact: true })).toBeVisible();
  await expect(bracket.getByText("1/4 决赛", { exact: true })).toBeVisible();
  await expect(bracket.getByText("半决赛", { exact: true })).toBeVisible();
  await expect(bracket.getByText("冠亚军决赛", { exact: true })).toBeVisible();
  await expect(page.locator(".knockout-champion")).toContainText("冠军");
  await expect(bracket).toContainText("T-001");
  await expect(bracket).toContainText("T-016");
  await expect(page.locator(".knockout-match-card")).toHaveCount(15);
  await expect(page.locator(".knockout-match-card.is-future")).toHaveCount(7);
  await expect(page.getByText("后续轮次由 Admin 手动开放", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("public-display-knockout-bracket.png"), fullPage: false });

  const overviewButton = page.getByRole("button", { name: "现场进程" });
  await overviewButton.click();
  await expect(overviewButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".knockout-stage")).toHaveCount(0);
  await expect(page.getByText("下一场", { exact: true })).toBeVisible();
  await bracketButton.click();
  await expect(page.locator(".knockout-stage")).toBeVisible();
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
  await page.getByRole("button", { name: "合并到已有队伍" }).click();
  await expect(page.locator("#team-picker-search")).toBeVisible();
  await page.locator("#team-picker-search").fill(teamB.teamNumber.replace("T-", ""));
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toBeEnabled();
  await page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`).click();
  await expect(page.getByRole("heading", { name: `确认加入 ${teamB.teamNumber}` })).toBeVisible();
  await page.getByRole("button", { name: "确认加入队伍" }).click();
  await expect(page.getByText("人员与队伍关系已更新。")).toBeVisible();

  const moved = await call("/api/ops/state", "GET", undefined, staffHeaders);
  expect(moved.participants.find((person: { id: string; teamId: string }) => person.id === people[0].id).teamId).toBe(teamB.id);
  expect(moved.teams.find((team: { id: string; status: string }) => team.id === teamA.id).status).toBe("dissolved");

  const teamsTab = page.locator('[data-grouping-tab="teams"]');
  await expect(teamsTab).toHaveCount(1); await teamsTab.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const config = page.locator(`[data-action="open-team-config"][data-team-id="${teamB.id}"]`);
  await expect(config).toHaveCount(1); await config.click();
  await expect(page.getByRole("heading", { name: teamB.teamNumber, exact: true })).toBeVisible();
  await expect(page.locator(`[data-person-id="${people[3].id}"]`)).toBeVisible();
  await expect(page.locator('[data-team-people-filter="unassigned"]')).toBeVisible();
  await expect(page.getByText(/队伍在创建或合并后已自动确认/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("06-team-config-ready-for-code-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "关闭" }).click();
  const peopleTab = page.locator('[data-grouping-tab="people"]');
  await expect(peopleTab).toHaveCount(1); await peopleTab.click();

  await page.getByLabel("查找人员").fill(`调度体验${stamp}-4`);
  await page.locator(`[data-person-id="${people[3].id}"]`).click();
  await page.getByLabel("查找人员").fill(`调度体验${stamp}-5`);
  await page.locator(`[data-person-id="${people[4].id}"]`).click();
  await page.getByRole("button", { name: "合并到已有队伍" }).click();
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toBeEnabled();
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toContainText("合并后 5 人");
  await page.screenshot({ path: testInfo.outputPath("07-team-picker-capacity-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await teamsTab.click();
  await expect(config).toContainText("管理");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("08-person-team-dispatch-mobile.png"), fullPage: true });
});

test("Admin can archive and reset the event with two confirmations", async ({ page, request, browser }) => {
  const stamp = Date.now();
  const clientId = `archive-reset-e2e-${stamp}`;
  const participantResponse = await request.post("/api/participants", {
    data: { nickname: `归档验收${stamp}` },
    headers: { "x-client-id": clientId },
  });
  expect(participantResponse.ok()).toBeTruthy();

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`归档管理员 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByLabel("Admin PIN").fill("meetup-admin");
  await page.getByRole("button", { name: "进入管理后台" }).click();

  const resetButton = page.getByRole("button", { name: "归档并重置当前活动" });
  await expect(resetButton).toBeVisible();
  await resetButton.click();
  await expect(page.getByRole("heading", { name: "确认归档当前活动？" })).toBeVisible();
  await expect(page.getByText("第一步，共两步", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "我已了解，继续二次确认" }).click();
  await expect(page.getByRole("heading", { name: "输入活动名称确认重置" })).toBeVisible();
  await expect(page.getByText("第二步，共两步", { exact: true })).toBeVisible();
  const confirmationDialog = page.getByRole("dialog", { name: "输入活动名称确认重置" });
  const finalReset = confirmationDialog.getByRole("button", { name: "确认归档并重置" });
  await expect(finalReset).toBeEnabled();
  await finalReset.click();
  await expect(confirmationDialog.getByRole("alert")).toContainText("请输入完整活动名称");
  await confirmationDialog.getByLabel("活动名称", { exact: true }).fill("  Agentic Football 现场运营台  ");
  await finalReset.click();

  await expect(page.locator(".notice")).toContainText(/已归档 \d+ 位参与者、\d+ 支队伍，并重置当前活动/);
  await expect(page.getByText("最近归档", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("button", { name: "资源管理" }).click();
  await expect(page.locator(".admin-metrics")).toContainText("总计 0 · 已发 0");
  const participantContext = await browser.newContext();
  const participantPage = await participantContext.newPage();
  await participantPage.goto(`/?acceptanceClient=${clientId}`);
  await expect(participantPage.getByLabel("昵称", { exact: true })).toBeVisible();
  await expect(participantPage.getByText(`归档验收${stamp}`)).toHaveCount(0);
  await participantContext.close();
});
