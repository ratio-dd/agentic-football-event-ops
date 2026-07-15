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
