import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = process.env.CI ? {} : { executablePath: localChrome };
const e2ePort = Number(process.env.E2E_PORT || "4173");
const e2eBaseUrl = `http://localhost:${e2ePort}`;
const e2eDatabasePath = process.env.E2E_DB_PATH || join(tmpdir(), `operator-workbench-e2e-${process.pid}-${Date.now()}.db`);
process.env.E2E_ACTIVE_DB_PATH = e2eDatabasePath;

// Playwright's local web-server readiness check must never use a workstation
// proxy for loopback traffic.
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
process.env.NO_PROXY = "localhost,127.0.0.1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // The event workbench is intentionally one shared onsite state machine.
  // Parallel files would otherwise race over the same ephemeral D1 record.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: e2eBaseUrl,
    browserName: "chromium",
    // CI uses Playwright-managed Chromium; the local workflow intentionally
    // keeps using the user's installed Chrome for realistic desktop checks.
    launchOptions,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  webServer: {
    command: "npm run lightsail:start",
    env: {
      ...process.env,
      PORT: String(e2ePort),
      EVENT_DB_PATH: e2eDatabasePath,
      TENANT_ADMIN_PINS: JSON.stringify({ "beijing-meetup-2026": "meetup-admin", "shanghai-meetup-2026": "shanghai-admin" }),
      PLATFORM_ADMIN_PIN: "platform-e2e-admin",
      TENANT_STAFF_PINS: JSON.stringify({
        "beijing-meetup-2026": [{ id: "e2e-beijing-staff", pin: "meetup-staff", enabled: true }],
        "shanghai-meetup-2026": [{ id: "e2e-shanghai-staff", pin: "shanghai-staff", enabled: true }],
      }),
    },
    url: `${e2eBaseUrl}/`,
    // Reusing a manually started server can accidentally pick up real local
    // workshop state and omit the test-only bindings above.
    reuseExistingServer: false,
    timeout: 30_000,
  },
  outputDir: "output/playwright",
});
