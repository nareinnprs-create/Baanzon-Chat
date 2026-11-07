import { defineConfig, devices } from '@playwright/test';

/**
 * Base URL of the app under test. Defaults to the local stub server started below;
 * set E2E_BASE_URL to point the same specs at a deployed preview instead, in which
 * case no local server is started and the app's own backend answers the API calls.
 */
const externalBaseURL = process.env.E2E_BASE_URL?.trim() ?? '';
const baseURL = externalBaseURL || 'http://127.0.0.1:3080';
const externalServer = externalBaseURL !== '';

const reporters = process.env.CI
  ? ([
      ['github'],
      ['list'],
      ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ] as const)
  : ([['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] as const);

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [...reporters],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'en-US',
    // The SPA ships a service worker; a stale cache would make reruns lie.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalServer
    ? undefined
    : {
        command: 'node server.mjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 60_000,
      },
});
