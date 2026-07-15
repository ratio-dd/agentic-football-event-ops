import { defineConfig } from "@playwright/test";

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Playwright's local web-server readiness check must never use a workstation
// proxy for loopback traffic.
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
process.env.NO_PROXY = "localhost,127.0.0.1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    launchOptions: { executablePath: localChrome },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    env: {
      ...process.env,
      STAFF_PINS: JSON.stringify([{ id: "e2e-staff", pin: "meetup-staff", enabled: true }]),
      ADMIN_PIN: "meetup-admin",
    },
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  outputDir: "output/playwright",
});
