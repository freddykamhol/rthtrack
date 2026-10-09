import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3107', browserName: 'chromium', ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) },
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:3107/api/health', reuseExistingServer: false },
})
