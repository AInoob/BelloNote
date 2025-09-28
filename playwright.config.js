
const { defineConfig } = require('@playwright/test')
const path = require('path')

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests/e2e'),
  timeout: 60000,
  expect: {
    timeout: 5000
  },
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  use: {
    baseURL: 'http://127.0.0.1',
    headless: true,
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: {
      'x-playwright-test': 'true'
    }
  }
})
