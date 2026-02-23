import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const e2eDir = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  testDir: path.join(e2eDir, 'tests'),
  outputDir: path.join(e2eDir, 'test-results'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: path.join(e2eDir, 'playwright-report'), open: 'never' }]]
    : [['html', { outputFolder: path.join(e2eDir, 'playwright-report') }]],
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
