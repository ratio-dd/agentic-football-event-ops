import { expect, test, type APIRequestContext } from "@playwright/test";

type Rgb = [number, number, number];

function parseRgb(value: string): Rgb {
  const match = value.match(/\d+(?:\.\d+)?/g);
  if (!match || match.length < 3) throw new Error(`Expected an RGB color, received ${value}`);
  return [Number(match[0]), Number(match[1]), Number(match[2])];
}

function luminance([red, green, blue]: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: string, background: string) {
  const first = luminance(parseRgb(foreground));
  const second = luminance(parseRgb(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function api(request: APIRequestContext, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const response = await request.fetch(path, {
    method,
    data: body,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
  });
  expect(response.ok(), `${method} ${path}`).toBeTruthy();
  return response.json();
}

test("Staff list rows keep readable colors across normal, selected, full, hover, and focus states", async ({ page, request }) => {
  const stamp = Date.now();
  const staff = await api(request, "/api/ops/session", "POST", { staffPin: "meetup-staff", staffNickname: `颜色验收 ${stamp}` });
  const staffHeaders = { "x-staff-session": staff.staffSession };
  const people = [];
  for (let index = 1; index <= 4; index += 1) {
    people.push((await api(request, "/api/participants", "POST", { nickname: `颜色人员${stamp}-${index}` }, { "x-client-id": `color-contract-${stamp}-${index}` })).participant);
  }
  const fullTeam = (await api(request, "/api/ops/teams", "POST", { memberIds: people.slice(0, 3).map((person: any) => person.id) }, staffHeaders)).team;

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`颜色界面 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();

  const row = page.locator(`[data-person-id="${people[3].id}"]`);
  const rowColors = await row.evaluate((element) => {
    const text = element.querySelector("strong")!;
    const detail = element.querySelector("small")!;
    return {
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(text).color,
      detail: getComputedStyle(detail).color,
    };
  });
  expect(contrast(rowColors.text, rowColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(rowColors.detail, rowColors.background)).toBeGreaterThanOrEqual(4.5);

  await row.click();
  const selectedColors = await row.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element.querySelector("strong")!).color,
    detail: getComputedStyle(element.querySelector("small")!).color,
  }));
  expect(contrast(selectedColors.text, selectedColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(selectedColors.detail, selectedColors.background)).toBeGreaterThanOrEqual(4.5);

  const allFilter = page.getByRole("button", { name: /全部/ }).last();
  await allFilter.hover();
  const hoverColors = await allFilter.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element).color,
  }));
  expect(contrast(hoverColors.text, hoverColors.background)).toBeGreaterThanOrEqual(4.5);
  await allFilter.focus();
  await expect(allFilter).toHaveCSS("outline-color", "rgb(15, 61, 46)");

  await page.getByRole("button", { name: "加入队伍" }).click();
  const fullTeamButton = page.locator(`[data-action="choose-team"][data-team-id="${fullTeam.id}"]`);
  await expect(fullTeamButton).toBeDisabled();
  const disabledColors = await fullTeamButton.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element.querySelector("strong")!).color,
    detail: getComputedStyle(element.querySelector("small")!).color,
    meta: getComputedStyle(element.querySelector("em")!).color,
  }));
  expect(contrast(disabledColors.text, disabledColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(disabledColors.detail, disabledColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(disabledColors.meta, disabledColors.background)).toBeGreaterThanOrEqual(4.5);
  await expect(fullTeamButton).toHaveCSS("outline-style", "none");
});

test("participant ticket labels remain readable on the resource card", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("昵称", { exact: true }).fill(`票根颜色${Date.now()}`);
  await page.getByRole("button", { name: "完成登记" }).click();
  await page.getByRole("button", { name: "创建一个队伍" }).click();
  const label = page.locator(".participant-team-card .ticket-label").first();
  const colors = await label.evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element.parentElement!).backgroundColor,
  }));
  expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
});
