const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /check_.*\.spec\.js/,
  testIgnore: /next\//,   // next/ 是新界面移植版契约,由 playwright.next.config.js 单独驱动
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BIDDOG_TEST_URL || 'http://127.0.0.1:18765',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    // 受限环境(无法下载钉定版本浏览器)可用 BIDDOG_CHROMIUM 指向系统 Chromium;
    // 不设置时行为与之前完全一致,CI 仍用 playwright 自装的钉定版本。
    // tauri.localhost 指回本地引擎:IS_WEB 由 hostname 判定,只有走这个主机名才测得到
    // 桌面分支(更新面板、本地安装等)。对其它 spec 无影响。
    launchOptions: Object.assign(
      { args: ['--host-resolver-rules=MAP tauri.localhost 127.0.0.1'] },
      process.env.BIDDOG_CHROMIUM ? { executablePath: process.env.BIDDOG_CHROMIUM } : {},
    ),
  },
  outputDir: 'test-results',
});
