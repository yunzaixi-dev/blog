import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT || 45100)
const devPort = Number(process.env.PLAYWRIGHT_DEV_PORT || 45100)
const devPreviewParity = process.env.PLAYWRIGHT_DEV_PREVIEW_PARITY === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: devPreviewParity
    ? [
        {
          command: `node scripts/preview-static.mjs --no-build --port ${port}`,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
          url: `http://127.0.0.1:${port}/zh/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: 'node scripts/dev.mjs',
          env: { DEV_PORT: String(devPort), API_PORT: String(devPort + 1) },
          gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
          url: `http://127.0.0.1:${devPort}/zh/`,
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ]
    : {
        command: `node scripts/preview-static.mjs --no-build --port ${port}`,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
        url: `http://127.0.0.1:${port}/zh/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
