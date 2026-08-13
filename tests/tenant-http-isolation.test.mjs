import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

async function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer(); probe.once("error", rejectPort);
    probe.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = probe.address(); const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function request(port, host, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = http.request({ hostname: "127.0.0.1", port, path, method, headers: { Host: host, ...headers, ...(body ? { "content-type": "application/json" } : {}) } }, (incoming) => {
      let raw = ""; incoming.on("data", (chunk) => { raw += chunk; });
      incoming.on("end", () => resolveRequest({ status: incoming.statusCode, data: JSON.parse(raw) }));
    });
    outgoing.on("error", rejectRequest); if (body) outgoing.write(JSON.stringify(body)); outgoing.end();
  });
}

async function stop(child) {
  if (child.exitCode !== null) return; child.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("HTTP Host, credentials, sessions, and participant state stay inside one tenant", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "afc-tenant-http-")); const port = await availablePort();
  const child = spawn(process.execPath, ["lightsail/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      EVENT_DB_PATH: join(temporary, "event.db"),
      TENANT_STAFF_PINS: JSON.stringify({ "beijing-meetup-2026": [{ id: "bj-staff", pin: "bj-pin", enabled: true }], "shanghai-meetup-2026": [{ id: "sh-staff", pin: "sh-pin", enabled: true }] }),
      TENANT_ADMIN_PINS: JSON.stringify({ "beijing-meetup-2026": "bj-admin", "shanghai-meetup-2026": "sh-admin" }),
      PLATFORM_ADMIN_PIN: "platform-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`租户测试服务提前退出：${stderr}`);
      try { if ((await request(port, "localhost", "/healthz")).status === 200) { ready = true; break; } } catch { /* still starting */ }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    assert.equal(ready, true, `租户测试服务未能启动：${stderr}`);

    const registered = await request(port, "localhost", "/api/participants", { method: "POST", headers: { "x-client-id": "shared-browser" }, body: { nickname: "北京参与者", supportProfile: {} } });
    assert.equal(registered.status, 200);
    const shanghaiState = await request(port, "shanghai.localhost", "/api/state", { headers: { "x-client-id": "shared-browser" } });
    assert.equal(shanghaiState.status, 200); assert.equal(shanghaiState.data.event.tenantId, "shanghai-meetup-2026"); assert.equal(shanghaiState.data.currentParticipant, null);

    const beijingLogin = await request(port, "localhost", "/api/ops/session", { method: "POST", body: { staffPin: "bj-pin", staffNickname: "北京 TA" } });
    assert.equal(beijingLogin.status, 200);
    const crossSession = await request(port, "shanghai.localhost", "/api/ops/state", { headers: { "x-staff-session": beijingLogin.data.staffSession } });
    assert.equal(crossSession.status, 403);
    const crossCredential = await request(port, "shanghai.localhost", "/api/ops/session", { method: "POST", body: { staffPin: "bj-pin", staffNickname: "越权尝试" } });
    assert.equal(crossCredential.status, 403);
    assert.equal((await request(port, "unknown.localhost", "/api/state")).status, 421);

    assert.equal((await request(port, "localhost", "/api/platform/tenants")).status, 403);
    const platformLogin = await request(port, "localhost", "/api/platform/session", { method: "POST", body: { platformPin: "platform-secret" } });
    assert.equal(platformLogin.status, 200);
    const created = await request(port, "localhost", "/api/platform/tenants", {
      method: "POST", headers: { "x-platform-session": platformLogin.data.platformSession },
      body: {
        origin: `http://hangzhou.localhost:${port}`,
        staffAccounts: [{ id: "hangzhou-staff", pin: "hz-staff" }, { id: "hangzhou-ta", pin: "hz-ta-pin" }],
        adminPin: "hz-admin-pin",
        config: {
          schemaVersion: 1, id: "hangzhou-meetup-2027", name: "杭州活动运营台",
          branding: { brandName: "Agentic Football", locationLabel: "杭州 MeetUp", displayLabel: "AGENTIC FOOTBALL · 杭州 MEETUP", pageTitle: "Agentic Football 杭州 MeetUp" },
          links: { workshopUrl: "https://example.com/workshop", gamePortalUrl: "https://example.com/game" },
          teamPolicy: { minMembers: 1, maxMembers: 4, maxTeams: 48 },
          tournamentPolicy: { maxTeamsPerGroup: 4, maxGroups: 12, defaultQualifiersPerGroup: 2, maxQualifiersPerGroup: 2 },
          defaultGates: { selfServiceTeam: false, participantHelp: true, codeIssuance: true, qualification: true, scheduleEditing: true, publicMaintenanceSnapshot: false },
        },
      },
    });
    assert.equal(created.status, 201); assert.equal(created.data.tenant.urls.ta, `http://hangzhou.localhost:${port}/ta`);
    const dynamicState = await request(port, "hangzhou.localhost", "/api/state");
    assert.equal(dynamicState.status, 200); assert.equal(dynamicState.data.event.tenantId, "hangzhou-meetup-2027"); assert.equal(dynamicState.data.event.teamPolicy.maxTeams, 48);
    assert.equal((await request(port, "hangzhou.localhost", "/api/ops/session", { method: "POST", body: { staffPin: "hz-ta-pin", staffNickname: "杭州 TA" } })).status, 200);
    assert.equal((await request(port, "hangzhou.localhost", "/api/ops/session", { method: "POST", body: { staffPin: "bj-pin", staffNickname: "跨租户" } })).status, 403);
  } finally {
    await stop(child); await rm(temporary, { recursive: true, force: true });
  }
});
