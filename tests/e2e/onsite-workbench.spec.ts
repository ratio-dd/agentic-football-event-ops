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

test("Staff stays on the selected operational tab after polling refresh", async ({ page }) => {
  await page.goto("/staff");
  await page.getByLabel("Staff PIN").fill("meetup-staff");
  await page.getByLabel("你的昵称").fill("E2E TA");
  await page.getByRole("button", { name: "进入工作台" }).click();

  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("heading", { name: "自动取码，逐队发放" })).toBeVisible();

  await page.waitForTimeout(5_500);

  await expect(page.getByRole("button", { name: "Code", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "自动取码，逐队发放" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "下一步一眼可见" })).toHaveCount(0);
});

test("participant can create a nameless team and receive only a team number", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("昵称", { exact: true }).fill(`自组体验员${Date.now()}`);
  await page.getByRole("button", { name: "完成登记" }).click();
  await page.getByRole("button", { name: "创建一个队伍" }).click();

  await expect(page.getByText("队伍编号", { exact: true })).toBeVisible();
  await expect(page.getByText(/T-\d{3}/)).toBeVisible();
  await expect(page.getByText("队长", { exact: true })).toHaveCount(0);
});

test("public display is readable without Staff controls", async ({ page }) => {
  await page.goto("/display");
  await expect(page).toHaveTitle("Agentic Football 现场大屏");
  await expect(page.locator("#display-app")).toContainText(/agentic football/i);
  await expect(page.getByText("Staff PIN")).toHaveCount(0);
});

test("Staff can open the operation record tab without changing session", async ({ page }) => {
  await page.goto("/staff");
  await page.getByLabel("Staff PIN").fill("meetup-staff");
  await page.getByLabel("你的昵称").fill("E2E 记录员");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "现场变更可追溯" })).toBeVisible();
  await expect(page.getByText("E2E 记录员").first()).toBeVisible();
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
  await page.getByLabel("Staff PIN").fill("meetup-staff");
  await page.getByLabel("你的昵称").fill(`界面调度 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();
  await page.getByLabel("查找人员").fill(`调度体验${stamp}-1`);
  await page.locator(`[data-person-id="${people[0].id}"]`).click();
  await page.getByRole("button", { name: "加入队伍" }).click();
  await expect(page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`)).toBeEnabled();
  await page.locator(`[data-action="choose-team"][data-team-id="${teamB.id}"]`).click();
  await expect(page.getByRole("heading", { name: `确认加入 ${teamB.teamNumber}` })).toBeVisible();
  await page.getByRole("button", { name: "确认执行" }).click();
  await expect(page.getByText("人员与队伍关系已更新。")).toBeVisible();

  const moved = await call("/api/ops/state", "GET", undefined, staffHeaders);
  expect(moved.participants.find((person: any) => person.id === people[0].id).teamId).toBe(teamB.id);
  expect(moved.teams.find((team: any) => team.id === teamA.id).status).toBe("dissolved");

  const teamsTab = page.locator('[data-grouping-tab="teams"]');
  await expect(teamsTab).toHaveCount(1); await teamsTab.click();
  const config = page.locator(`[data-action="open-team-config"][data-team-id="${teamB.id}"]`);
  await expect(config).toHaveCount(1); await config.click();
  await expect(page.getByRole("heading", { name: `修改 ${teamB.teamNumber}` })).toBeVisible();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("06-person-team-dispatch-mobile.png"), fullPage: true });
});
