// Read-only browser smoke test for pull requests and release gates.
const { defineConfig, devices } = require('@playwright/test');
const os = require('os');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'qa-ui-smoke.spec.js',
  // Keep CI artifacts outside the checkout: another local QA session may hold pwout open.
  outputDir: path.join(os.tmpdir(), 'kumin-pharmacy-qa'),
  timeout: 30000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx http-server -p 4180 -c-1 .',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
