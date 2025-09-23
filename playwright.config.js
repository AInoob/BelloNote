const { defineConfig } = require('@playwright/test')
const path = require('path')
const fs = require('fs')

// Use non-default ports for E2E to avoid clashing with local dev servers
const SERVER_PORT = 5231
const CLIENT_PORT = 5232
const API_URL = `http://127.0.0.1:${SERVER_PORT}`
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`
const DATA_DIR = path.join(__dirname, 'test-data', `.playwright-data-${Date.now()}`)

fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

process.env.PLAYWRIGHT_API_URL = API_URL
process.env.PLAYWRIGHT_ORIGIN = API_URL
process.env.PLAYWRIGHT_CLIENT_URL = CLIENT_URL
process.env.PLAYWRIGHT_DATA_DIR = DATA_DIR

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests/e2e'),
  timeout: 60000,
  expect: {
    timeout: 5000
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: {
      'x-playwright-test': 'true'
    }
  },
  webServer: [
    {
      command: 'npm start',
      cwd: path.join(__dirname, 'server'),
      env: {
        PORT: String(SERVER_PORT),
        DATA_DIR: DATA_DIR
      },
      port: SERVER_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: `npm run preview -- --host=127.0.0.1 --port=${CLIENT_PORT}`,
      cwd: path.join(__dirname, 'client'),
      env: {
        VITE_API_URL: API_URL
      },
      port: CLIENT_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
})
