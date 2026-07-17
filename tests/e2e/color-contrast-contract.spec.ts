import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

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

async function expectReadableText(control: Locator, label: string) {
  const failures = await control.evaluate((element) => {
    const opaqueSurface = (node: Element) => {
      let current: Element | null = node;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        const channels = color.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
        if (channels.length >= 3 && (channels.length < 4 || channels[3] >= 0.98)) return color;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const parse = (value: string) => (value.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const luminance = (value: number[]) => {
      const channel = (component: number) => {
        const normalized = component / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(value[0]) + 0.7152 * channel(value[1]) + 0.0722 * channel(value[2]);
    };
    const ratio = (foreground: string, background: string) => {
      const first = luminance(parse(foreground)); const second = luminance(parse(background));
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const candidates = [element, ...element.querySelectorAll("strong, small, em, span, p, a, label")].filter((node) =>
      [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()),
    );
    return candidates.map((node) => {
      const style = getComputedStyle(node);
      const background = opaqueSurface(node);
      return { text: node.textContent?.trim().slice(0, 48), color: style.color, background, ratio: ratio(style.color, background) };
    }).filter((item) => item.ratio < 4.5);
  });
  expect(failures, `${label} contains low-contrast text`).toEqual([]);
}

async function expectControlStatesReadable(control: Locator, label: string) {
  await expect(control, `${label} should be visible`).toBeVisible();
  await expectReadableText(control, `${label}: default`);
  if (await control.isDisabled()) return;
  await control.hover();
  await expectReadableText(control, `${label}: hover`);
  await control.evaluate((element) => (element as HTMLElement).focus({ focusVisible: true }));
  await expectReadableText(control, `${label}: focus`);
  const focusVisible = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.boxShadow !== "none";
  });
  expect(focusVisible, `${label} needs a visible focus treatment`).toBeTruthy();
  const box = await control.boundingBox();
  if (box) {
    const page = control.page();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expectReadableText(control, `${label}: active`);
    // Release away from the control so this audit never commits an operation.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
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

test("Staff list rows keep readable colors across normal, selected, full, hover, and focus states", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const staff = await api(request, "/api/ops/session", "POST", { staffPin: "meetup-staff", staffNickname: `颜色验收 ${stamp}` });
  const staffHeaders = { "x-staff-session": staff.staffSession };
  const people = [];
  for (let index = 1; index <= 5; index += 1) {
    people.push((await api(request, "/api/participants", "POST", { nickname: `颜色人员${stamp}-${index}` }, { "x-client-id": `color-contract-${stamp}-${index}` })).participant);
  }
  const fullTeam = (await api(request, "/api/ops/teams", "POST", { memberIds: people.slice(0, 3).map((person: any) => person.id) }, staffHeaders)).team;
  await api(request, "/api/ops/teams", "POST", { memberIds: [people[3].id] }, staffHeaders);

  await page.goto("/staff");
  await page.getByLabel("工作台 PIN").fill("meetup-staff");
  await page.getByLabel("显示昵称").fill(`颜色界面 ${stamp}`);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "组队", exact: true }).click();

  const row = page.locator(`[data-person-id="${people[4].id}"]`);
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

  // This is the regression that previously escaped: a selected row remains
  // selected while the pointer is still over it after click.
  await row.hover();
  const selectedHoverColors = await row.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element.querySelector("strong")!).color,
    detail: getComputedStyle(element.querySelector("small")!).color,
  }));
  expect(contrast(selectedHoverColors.text, selectedHoverColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(selectedHoverColors.detail, selectedHoverColors.background)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: testInfo.outputPath("selected-person-hover-mobile.png"), fullPage: false });
  await row.focus();
  await expect(row).toHaveCSS("outline-color", "rgb(15, 61, 46)");

  const allFilter = page.getByRole("button", { name: /全部/ }).last();
  await expectControlStatesReadable(allFilter, "人员筛选");
  await expectControlStatesReadable(page.locator('[data-grouping-tab="people"]'), "人员/队伍切换");
  await expectControlStatesReadable(page.getByRole("button", { name: "下一步：确认新队" }), "编组主操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "加入队伍" }), "编组次操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "清除" }), "编组静默操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "组队", exact: true }), "底部活动 Tab");

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

  const availableTeamButton = page.locator(`[data-action="choose-team"]:not(:disabled)`).first();
  await expectControlStatesReadable(availableTeamButton, "可加入目标队伍");
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page.locator('[data-grouping-tab="teams"]').click();
  const teamCard = page.locator(`[data-action="open-team-config"][data-team-id="${fullTeam.id}"]`);
  await expectControlStatesReadable(teamCard, "队伍看板卡片");
  await teamCard.click();
  await expectControlStatesReadable(page.getByRole("button", { name: "关闭", exact: true }), "队伍弹窗关闭操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "转队" }).first(), "成员转队操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "移出" }).first(), "成员移出操作");
});

test("participant ticket labels remain readable on team and resource cards", async ({ page }) => {
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
  await page.evaluate(() => {
    document.querySelector(".participant-content")?.insertAdjacentHTML("beforeend", `
      <section class="participant-ticket participant-code-card contrast-code-card">
        <div class="code-ticket-head contrast-code-header"><span>Team Code</span><button type="button" class="ticket-copy">⧉</button></div>
      </section>
    `);
  });
  const resourceHeader = page.locator(".contrast-code-header");
  await expect(resourceHeader).toHaveCount(1);
  const resourceHeaderColors = await resourceHeader.evaluate((element) => ({
    foreground: getComputedStyle(element.querySelector("span")!).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  expect(contrast(resourceHeaderColors.foreground, resourceHeaderColors.background)).toBeGreaterThanOrEqual(4.5);
  await expectControlStatesReadable(page.getByRole("button", { name: "我的二维码" }), "参与者二维码操作");
  await expectControlStatesReadable(page.getByRole("button", { name: "反馈" }), "参与者反馈操作");
});

test("semantic palette matrix keeps every reusable control role readable", async ({ page }) => {
  await page.goto("/staff");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <style>
        .state-matrix .modal-backdrop { position: static; display: block; padding: 0; background: transparent; }
        .state-matrix .bottom-tabs { position: static; width: auto; }
      </style>
      <div class="state-matrix staff-shell">
        <header class="staff-top"><div class="top-actions"><button class="text-button" data-state-id="staff-header-text">反馈</button></div></header>
        <main>
          <div class="grouping-tabs"><button class="active" data-state-id="grouping-tab-active">人员</button><button data-state-id="grouping-tab">队伍</button></div>
          <div class="filter-row"><button class="active" data-state-id="filter-active">全部</button><button data-state-id="filter">无队</button></div>
          <button class="dispatch-person-row" data-state-id="person-row"><span><strong>人员行</strong><small>P-001 · 无队</small></span><span class="dispatch-check">选择</span></button>
          <button class="dispatch-person-row is-selected" data-state-id="person-row-selected"><span><strong>已选人员</strong><small>P-002 · T-001</small></span><span class="dispatch-check">已选</span></button>
          <button class="team-board-card" data-state-id="team-row"><span><strong>T-001</strong><small>成员甲</small></span><span><em>2 / 3</em><small>编组中</small></span></button>
          <section class="selection-tray"><div><button data-state-id="tray-primary">确认新队</button><button class="secondary" data-state-id="tray-secondary">加入队伍</button><button class="text-button" data-state-id="tray-quiet">清除</button></div></section>
          <section class="staff-workshop-list"><article><div class="workshop-team-actions"><button class="note-button" data-state-id="workshop-note">备注</button><button class="qualify-button" data-state-id="workshop-qualify">确认可参赛</button></div></article></section>
          <form class="staff-score-form"><button data-state-id="score-save">保存</button></form>
        </main>
        <nav class="bottom-tabs"><button class="active" data-state-id="bottom-tab-active">组队</button><button data-state-id="bottom-tab">Workshop</button></nav>
        <div class="modal-backdrop"><section class="dispatch-modal"><div class="modal-header"><button class="text-button" data-state-id="modal-close">关闭</button></div><section class="team-resource-card"><span class="resource-actions"><button data-state-id="resource-primary">发放 Code</button><button class="secondary" data-state-id="resource-secondary">确认队伍</button></span></section><section class="modal-section"><button data-state-id="modal-primary">加入此队</button></section><div class="team-picker-list"><button data-state-id="picker-available"><span><strong>T-002</strong><small>可加入</small></span><span class="team-picker-meta"><em>2 / 3</em><small>可发放资源</small></span></button><button disabled data-state-id="picker-full"><span><strong>T-003</strong><small>满员</small></span><span class="team-picker-meta"><em>3 / 3</em><small>容量不足</small></span></button></div></section></div>
      </div>
      <div class="state-matrix admin-shell"><header class="admin-top"><div class="top-actions"><button class="text-button" data-state-id="admin-header-text">返回 Staff</button></div></header><main><nav class="admin-nav"><button class="active" data-state-id="admin-nav-active">活动设置</button><button data-state-id="admin-nav">资源管理</button></nav><section class="admin-panel"><form class="admin-form"><button data-state-id="admin-primary">保存设置</button><button disabled data-state-id="admin-disabled">生成赛程</button></form><div class="admin-list"><button class="secondary" data-state-id="admin-secondary">回收 Code</button></div></section></main></div>
      <div class="participant-experience"><header class="participant-topbar"><div class="participant-top-actions"><button class="text-button" data-state-id="participant-header-text">反馈</button></div></header><main><button class="ticket-primary" data-state-id="participant-primary">创建队伍</button><button class="ticket-secondary" data-state-id="participant-secondary">加入队伍</button><button class="ticket-qr-button" data-state-id="participant-qr">我的二维码</button><button class="ticket-primary" disabled data-state-id="participant-disabled">提交中</button></main></div>`;
  });

  const controls = page.locator("[data-state-id]");
  const count = await controls.count();
  expect(count).toBeGreaterThanOrEqual(25);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await expectControlStatesReadable(control, `palette:${await control.getAttribute("data-state-id")}`);
  }
});
