import { expect, test } from "@playwright/test";

test("平台管理员通过页面创建完整租户并立即访问全部角色入口", async ({ page, request }) => {
  const port = Number(process.env.E2E_PORT || "4173");
  const stamp = Date.now();
  const tenantId = `e2e-city-${stamp}`;
  const tenantHost = `${tenantId}.localhost`;
  const tenantOrigin = `http://${tenantHost}:${port}`;

  await page.goto("/tenants");
  await page.getByLabel("平台管理 PIN").fill("platform-e2e-admin");
  await page.getByRole("button", { name: "进入租户管理" }).click();
  await expect(page.getByRole("heading", { name: "新建活动租户" })).toBeVisible();

  await page.getByLabel("租户标识 tenantId").fill(tenantId);
  await page.getByLabel("租户基础 URL").fill(tenantOrigin);
  await page.getByLabel("地点标签").fill("E2E 新城 MeetUp");
  await page.getByLabel("显示标签").fill("AGENTIC FOOTBALL · E2E 新城");
  await page.getByLabel("页面标题").fill("Agentic Football E2E 新城");
  await page.getByLabel("最大成员数", { exact: true }).fill("4");
  await page.getByLabel("最大队伍数", { exact: true }).fill("48");
  await page.getByLabel("最大组数", { exact: true }).fill("12");
  await page.getByLabel("Staff PIN").fill(`staff-${stamp}`);
  await page.getByLabel("TA PIN").fill(`ta-${stamp}`);
  await page.getByLabel("Admin PIN").fill(`admin-${stamp}`);
  await page.getByLabel("允许参与者页面呼叫 TA").check();
  await page.getByRole("button", { name: "创建租户" }).click();

  await expect(page.getByText("E2E 新城 MeetUp 已创建")).toBeVisible();
  await expect(page.locator("#url-preview")).toContainText(`${tenantOrigin}/ta`);
  await expect(page.locator(".existing-tenants")).toContainText(tenantHost);

  const state = await request.get(`http://127.0.0.1:${port}/api/state`, { headers: { Host: `${tenantHost}:${port}` } });
  expect(state.ok()).toBeTruthy();
  const data = await state.json();
  expect(data.event.tenantId).toBe(tenantId);
  expect(data.event.teamPolicy.maxMembers).toBe(4);
  expect(data.event.teamPolicy.maxTeams).toBe(48);
  expect(data.event.gates.participantHelp).toBe(true);

  for (const path of ["/", "/staff", "/ta", "/admin", "/display"]) {
    const entry = await request.get(`http://127.0.0.1:${port}${path}`, { headers: { Host: `${tenantHost}:${port}` } });
    expect(entry.ok(), `${path} should be available`).toBeTruthy();
  }

  const taLogin = await request.post(`http://127.0.0.1:${port}/api/ops/session`, {
    headers: { Host: `${tenantHost}:${port}` },
    data: { staffPin: `ta-${stamp}`, staffNickname: "E2E TA" },
  });
  expect(taLogin.ok()).toBeTruthy();
});
