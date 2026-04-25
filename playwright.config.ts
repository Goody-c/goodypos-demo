import { defineConfig, devices } from '@playwright/test';

const e2eHost = process.env.E2E_HOST || '127.0.0.1';
const e2ePort = Number(process.env.E2E_PORT || 3201);
const baseURL = process.env.E2E_BASE_URL || `http://${e2eHost}:${e2ePort}`;
const webServerCommand = process.platform === 'win32'
  ? `set PORT=${e2ePort}&& npm run dev:raw`
  : `PORT=${e2ePort} npm run dev:raw`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    navigationTimeout: 30000,
    actionTimeout: 10000,
    // SPA keeps background connections open (SSE); domcontentloaded avoids waiting for them
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile viewports for cross-platform UI validation
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
