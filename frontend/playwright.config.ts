import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: process.env.STUDIO_BROWSER_ONLY ? '**/browser.spec.ts' : '**/studio.spec.ts',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.STUDIO_TEST_URL || 'http://127.0.0.1:8000',
    launchOptions: process.env.STUDIO_CHROMIUM_PATH
      ? { executablePath: process.env.STUDIO_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
