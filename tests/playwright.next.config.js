// 新界面(app-next/dist)的浏览器契约:与 playwright.config.js 同一engine驱动方式,
// 只是 BID_WEB_DIR 指到构建产物。语义断言与经典 spec 保持一字不动(见 next/ 头注)。
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './next',
  testMatch: /check_.*\.spec\.js/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report-next', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BIDDOG_TEST_URL || 'http://127.0.0.1:18765',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    launchOptions: Object.assign(
      { args: ['--host-resolver-rules=MAP tauri.localhost 127.0.0.1'] },
      process.env.BIDDOG_CHROMIUM ? { executablePath: process.env.BIDDOG_CHROMIUM } : {},
    ),
  },
  outputDir: 'test-results-next',
});
