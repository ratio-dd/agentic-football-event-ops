import { expect, test } from "@playwright/test";

const port = Number(process.env.E2E_PORT || "4173");
const beijingUrl = `http://localhost:${port}`;
const shanghaiUrl = `http://127.0.0.1:${port}`;
const shanghaiHost = `shanghai.localhost:${port}`;

test("北京和上海租户隔离品牌、参与者数据与 Staff 会话", async ({ page, request }) => {
  const clientId = `tenant-isolation-${Date.now()}`;
  const nickname = `同名参与者-${Date.now()}`;

  const beijingRegistration = await request.post(`${beijingUrl}/api/participants`, {
    data: { nickname },
    headers: { "x-client-id": clientId },
  });
  expect(beijingRegistration.ok()).toBeTruthy();

  const shanghaiBeforeRegistration = await request.get(`${shanghaiUrl}/api/state`, {
    headers: { Host: shanghaiHost, "x-client-id": clientId },
  });
  expect(shanghaiBeforeRegistration.ok()).toBeTruthy();
  const shanghaiBeforeState = await shanghaiBeforeRegistration.json();
  expect(shanghaiBeforeState.event.tenantId).toBe("shanghai-meetup-2026");
  expect(shanghaiBeforeState.event.branding.pageTitle).toBe("Agentic Football 上海 MeetUp");
  expect(shanghaiBeforeState.currentParticipant).toBeNull();

  const shanghaiRegistration = await request.post(`${shanghaiUrl}/api/participants`, {
    data: { nickname },
    headers: { Host: shanghaiHost, "x-client-id": clientId },
  });
  expect(shanghaiRegistration.ok()).toBeTruthy();
  const shanghaiParticipant = (await shanghaiRegistration.json()).participant;
  const beijingParticipant = (await beijingRegistration.json()).participant;
  expect(shanghaiParticipant.id).not.toBe(beijingParticipant.id);

  const shanghaiLogin = await request.post(`${shanghaiUrl}/api/ops/session`, {
    data: { staffPin: "shanghai-staff", staffNickname: "上海 E2E Staff" },
    headers: { Host: shanghaiHost },
  });
  expect(shanghaiLogin.ok()).toBeTruthy();
  const shanghaiSession = (await shanghaiLogin.json()).staffSession;

  const crossTenantState = await request.get(`${beijingUrl}/api/ops/state`, {
    headers: { "x-staff-session": shanghaiSession },
  });
  expect(crossTenantState.status()).toBe(403);

  await page.goto(`${beijingUrl}/display`);
  await expect(page).toHaveTitle("Agentic Football 北京 MeetUp · 现场大屏");
});
