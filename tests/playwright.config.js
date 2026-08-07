const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /check_.*\.spec\.js/,
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
  },
  outputDir: 'test-results',
});
