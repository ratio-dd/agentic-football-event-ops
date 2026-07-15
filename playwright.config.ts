import { defineConfig } from "@playwright/test";

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = process.env.CI ? {} : { executablePath: localChrome };

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
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    // CI uses Playwright-managed Chromium; the local workflow intentionally
    // keeps using the user's installed Chrome for realistic desktop checks.
    launchOptions,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    env: {
      ...process.env,
      PLAYWRIGHT_E2E: "1",
      STAFF_PINS: JSON.stringify([{ id: "e2e-staff", pin: "meetup-staff", enabled: true }]),
      ADMIN_PIN: "meetup-admin",
    },
    url: "http://localhost:4173/",
    // Reusing a manually started server can accidentally pick up real local
    // workshop state and omit the test-only bindings above.
    reuseExistingServer: false,
    timeout: 30_000,
  },
  outputDir: "output/playwright",
});
