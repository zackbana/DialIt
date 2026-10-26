import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "tests/browser", workers: 1, timeout: 90000,
  use: { baseURL: "http://127.0.0.1:3100", headless: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined) }, trace: "retain-on-failure" },
  webServer: { command: "NODE_ENV=production npx tsx tests/browser-server.ts", url: "http://127.0.0.1:3100/api/health", timeout: 60000, reuseExistingServer: false },
});
