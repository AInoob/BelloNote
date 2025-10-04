
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')
const { Client } = require('pg')
const { test: playwrightBase, expect } = require('@playwright/test')

const CLIENT_PORT_RANGE = { start: 6000, end: 6999 }
const SERVER_PORT_RANGE = { start: 7000, end: 7999 }
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const SERVER_ROOT = path.join(PROJECT_ROOT, 'server')
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client')
const TEMP_ROOT = path.join(PROJECT_ROOT, 'tests', 'temp')
const BASE_CLIENT_DIST = path.join(CLIENT_ROOT, 'dist')
const WORKER_ROOT_PREFIX = '.playwright-data'
const PLACEHOLDER_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yp8N40AAAAASUVORK5CYII=', 'base64')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const TEST_DATABASES = ['bello_note_test_1', 'bello_note_test_2', 'bello_note_test_3', 'bello_note_test_4']
const PG_SSL = (process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined
const BASE_PG_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  ssl: PG_SSL
}
const ADMIN_DATABASE = process.env.PGADMIN_DATABASE || process.env.PGDATABASE_ADMIN || 'postgres'

function assertSafeIdentifier(value, label = 'identifier') {
  if (!/^[A-Za-z0-9_]+$/.test(String(value || ''))) {
    throw new Error(`${label} contains unsupported characters: ${value}`)
  }
}

function pickDatabaseForWorker(workerIndex) {
  return TEST_DATABASES[workerIndex % TEST_DATABASES.length]
}

async function recreateDatabase(dbName) {
  assertSafeIdentifier(dbName, 'database name')
  const adminClient = new Client({ ...BASE_PG_CONFIG, database: ADMIN_DATABASE })
  await adminClient.connect()
  try {
    const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (exists.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${dbName}" WITH ENCODING 'UTF8' TEMPLATE template0`)
    }
  } finally {
    await adminClient.end()
  }

  const dbClient = new Client({ ...BASE_PG_CONFIG, database: dbName })
  await dbClient.connect()
  try {
    try {
      await dbClient.query('DROP SCHEMA public CASCADE')
    } catch (err) {
      if (err.code !== '3F000') throw err
    }
    await dbClient.query('CREATE SCHEMA public')
    await dbClient.query('GRANT ALL ON SCHEMA public TO CURRENT_USER')
    await dbClient.query('GRANT ALL ON SCHEMA public TO public')
  } finally {
    await dbClient.end()
  }
}

function buildServerEnv({ serverPort, databaseName }) {
  const env = {
    ...process.env,
    PORT: String(serverPort),
    NODE_ENV: 'test',
    PGDATABASE: databaseName
  }
  if (BASE_PG_CONFIG.host) env.PGHOST = BASE_PG_CONFIG.host
  if (BASE_PG_CONFIG.port) env.PGPORT = String(BASE_PG_CONFIG.port)
  if (BASE_PG_CONFIG.user) env.PGUSER = BASE_PG_CONFIG.user
  if (BASE_PG_CONFIG.password) env.PGPASSWORD = BASE_PG_CONFIG.password
  if (process.env.PGSSLMODE) env.PGSSLMODE = process.env.PGSSLMODE
  return env
}

const reservedPorts = new Set()
const UNSAFE_PORTS = new Set([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697])
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function sanitizeSegment(segment) {
  return String(segment || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildDataDir(testInfo, baseDir = TEMP_ROOT) {
  const parts = [
    ...testInfo.titlePath,
    `w${testInfo.workerIndex}`,
    `r${testInfo.retry}`,
    `e${testInfo.repeatEachIndex}`
  ]
  const slug = parts.map(sanitizeSegment).filter(Boolean).join('-') || `test-${Date.now()}`
  return path.join(baseDir, slug)
}

function buildWorkerRoot(workerInfo) {
  const suffix = `${workerInfo.workerIndex}-${process.pid}-${Date.now().toString(36)}`
  return path.join(TEMP_ROOT, `${WORKER_ROOT_PREFIX}-${suffix}`)
}

function attachLoggers(proc, label) {
  let buffer = ''
  const makeHandler = (stream) => (chunk) => {
    buffer += `[${label}:${stream}] ${chunk.toString()}`
    if (buffer.length > 8000) buffer = buffer.slice(buffer.length - 8000)
  }
  const stdoutHandler = makeHandler('stdout')
  const stderrHandler = makeHandler('stderr')
  proc.stdout?.on('data', stdoutHandler)
  proc.stderr?.on('data', stderrHandler)
  return {
    getLogs: () => buffer,
    dispose: () => {
      proc.stdout?.off('data', stdoutHandler)
      proc.stderr?.off('data', stderrHandler)
    }
  }
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const finalize = (available) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(available)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finalize(false))
    socket.once('timeout', () => finalize(false))
    socket.once('error', (err) => {
      if (err && (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENOTFOUND')) finalize(true)
      else finalize(false)
    })
    socket.connect(port, '127.0.0.1')
  })
}

async function findAvailablePort(rangeStart, rangeEnd) {
  const total = Math.max(0, rangeEnd - rangeStart + 1)
  if (total <= 0) throw new Error('Invalid port range')
  const offset = Math.floor(Math.random() * total)
  for (let i = 0; i < total; i += 1) {
    const port = rangeStart + ((offset + i) % total)
    if (UNSAFE_PORTS.has(port)) continue
    if (reservedPorts.has(port)) continue
    reservedPorts.add(port)
    let available = false
    try {
      // eslint-disable-next-line no-await-in-loop
      const open = await checkPort(port)
      if (open) {
        available = true
        return port
      }
    } finally {
      if (!available) reservedPorts.delete(port)
    }
  }
  throw new Error(`No available ports in range ${rangeStart}-${rangeEnd}`)
}

function releasePort(port) {
  if (!port) return
  if (!reservedPorts.has(port)) return
  setTimeout(() => reservedPorts.delete(port), 2000)
}

async function resetServerState(apiUrl) {
  if (!apiUrl) throw new Error('resetServerState requires apiUrl')
  const response = await fetch(`${apiUrl}/api/test/reset`, {
    method: 'POST',
    headers: { 'x-playwright-test': '1' }
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to reset server state (${response.status}): ${body}`)
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  const entries = fs.readdirSync(source, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(srcPath, destPath)
    else fs.copyFileSync(srcPath, destPath)
  }
}

function injectRuntimeConfig(distDir, apiUrl) {
  const indexPath = path.join(distDir, 'index.html')
  if (!fs.existsSync(indexPath)) throw new Error(`index.html missing in ${distDir}`)
  const original = fs.readFileSync(indexPath, 'utf8')
  const configScript = `<script>window.__BELLO_RUNTIME_CONFIG__ = ${JSON.stringify({ apiUrl })};</script>`
  const cleaned = original.replace(/\s*<script>window.__BELLO_RUNTIME_CONFIG__.*?<\/script>/s, '')
  if (cleaned.includes('</head>')) {
    const updated = cleaned.replace('</head>', `  ${configScript}\n</head>`)
    fs.writeFileSync(indexPath, updated)
  } else {
    fs.writeFileSync(indexPath, `${configScript}\n${cleaned}`)
  }
}

let clientBuildPromise = null

async function ensureClientBuild() {
  if (fs.existsSync(BASE_CLIENT_DIST)) return
  if (!clientBuildPromise) {
    clientBuildPromise = (async () => {
      let buildLogs = null
      try {
        const buildProc = spawn(NPM_CMD, ['run', 'build'], {
          cwd: CLIENT_ROOT,
          env: process.env,
          stdio: 'pipe'
        })
        await waitForSpawn(buildProc, 'client build (shared)')
        buildLogs = attachLoggers(buildProc, 'client-build-shared')
        const exitCode = await new Promise((res, rej) => {
          buildProc.once('error', rej)
          buildProc.once('exit', res)
        })
        if (exitCode !== 0) {
          const info = buildLogs.getLogs ? `\n${buildLogs.getLogs()}` : ''
          throw new Error(`client build failed (code ${exitCode})${info}`)
        }
      } finally {
        buildLogs?.dispose?.()
      }
    })().catch((err) => {
      clientBuildPromise = null
      throw err
    })
  }
  await clientBuildPromise
}

async function allocatePort({ rangeStart, rangeEnd, preferred }) {
  return findAvailablePort(rangeStart, rangeEnd)
}

async function waitForSpawn(proc, label) {
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(new Error(`${label} failed to start: ${err?.message || err}`))
    proc.once('error', onError)
    proc.once('spawn', () => {
      proc.off('error', onError)
      resolve()
    })
  })
}

async function waitForReady({ url, label, process, timeout = 20000, getLogs, verify }) {
  const deadline = Date.now() + timeout
  const check = verify || (async () => {
    if (!url) throw new Error('waitForReady requires either a url or verify callback')
    const response = await fetch(url, { cache: 'no-store' })
    return response.ok
  })
  let lastError = null
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      const info = getLogs ? `
${getLogs()}` : ''
      throw new Error(`${label} exited before listening (code ${process.exitCode})${info}`)
    }
    try {
      const ready = await check()
      if (ready) return
    } catch (err) {
      lastError = err
    }
    await wait(200)
  }
  const info = getLogs ? `
${getLogs()}` : ''
  const location = url ? ` at ${url}` : ''
  const lastErrText = lastError ? `
Last error: ${lastError?.message || lastError}` : ''
  throw new Error(`${label} did not become ready${location} within ${timeout}ms${info}${lastErrText}`)
}

async function stopProcess(proc, label) {
  if (!proc) return
  if (proc.exitCode !== null) return
  proc.kill('SIGTERM')
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  if (!exited) proc.kill('SIGKILL')
}

const test = playwrightBase.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext()
    try {
      await use(context)
    } finally {
      await context.close()
    }
  },
  appServer: [async ({}, use, workerInfo) => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true })
    const workerRoot = buildWorkerRoot(workerInfo)
    fs.rmSync(workerRoot, { recursive: true, force: true })
    fs.mkdirSync(workerRoot, { recursive: true })

    const dataDir = path.join(workerRoot, 'server-data')
    fs.mkdirSync(dataDir, { recursive: true })

    let serverPort
    let clientPort
    let serverProc
    let clientProc
    let serverLogs
    let clientLogs
    let distDir
    let databaseName

    try {
      serverPort = await allocatePort({
        rangeStart: SERVER_PORT_RANGE.start,
        rangeEnd: SERVER_PORT_RANGE.end,
        preferred: null
      })
      clientPort = await allocatePort({
        rangeStart: CLIENT_PORT_RANGE.start,
        rangeEnd: CLIENT_PORT_RANGE.end,
        preferred: null
      })

      databaseName = pickDatabaseForWorker(workerInfo.workerIndex)
      await recreateDatabase(databaseName)

      const apiUrl = `http://127.0.0.1:${serverPort}`
      const clientUrl = `http://127.0.0.1:${clientPort}`

      const serverEnv = buildServerEnv({ serverPort, databaseName })

      serverProc = spawn(NPM_CMD, ['start'], {
        cwd: SERVER_ROOT,
        env: serverEnv,
        stdio: 'pipe'
      })
      await waitForSpawn(serverProc, 'server')
      serverLogs = attachLoggers(serverProc, 'server')
      await waitForReady({ url: `${apiUrl}/api/health`, label: 'server', process: serverProc, getLogs: serverLogs.getLogs })

      distDir = path.join(workerRoot, 'client-dist')
      await buildClientBundle({ apiUrl, distDir })

      clientProc = spawn(NPM_CMD, ['run', 'preview', '--', '--host=127.0.0.1', `--port=${clientPort}`, `--outDir=${distDir}`], {
        cwd: CLIENT_ROOT,
        env: { ...process.env, VITE_API_URL: apiUrl, NODE_ENV: 'test' },
        stdio: 'pipe'
      })
      await waitForSpawn(clientProc, 'client')
      clientLogs = attachLoggers(clientProc, 'client')
      await waitForReady({
        url: `${clientUrl}/`,
        label: 'client',
        process: clientProc,
        getLogs: clientLogs.getLogs,
        verify: async () => !(await checkPort(clientPort))
      })

      await resetServerState(apiUrl)

      const sharedContext = {
        apiUrl,
        clientUrl,
        clientPort,
        serverPort,
        workerRoot,
        dataDir,
        databaseName,
        async resetState() {
          await resetServerState(apiUrl)
        }
      }

      await use(sharedContext)
    } finally {
      await stopProcess(clientProc, 'client')
      await stopProcess(serverProc, 'server')
      clientLogs?.dispose?.()
      serverLogs?.dispose?.()
      if (clientPort) releasePort(clientPort)
      if (serverPort) releasePort(serverPort)
      if (distDir) fs.rmSync(distDir, { recursive: true, force: true })
      if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
      if (workerRoot) fs.rmSync(workerRoot, { recursive: true, force: true })
    }
  }, { scope: 'worker' }],
  app: async ({ appServer }, use, testInfo) => {
    const testDataDir = buildDataDir(testInfo, appServer.workerRoot)
    fs.rmSync(testDataDir, { recursive: true, force: true })
    fs.mkdirSync(testDataDir, { recursive: true })

    await appServer.resetState()

    const apiUrl = appServer.apiUrl
    const appContext = {
      apiUrl,
      clientUrl: appServer.clientUrl,
      dataDir: testDataDir,
      clientPort: appServer.clientPort,
      serverPort: appServer.serverPort,
      async resetOutline(outline = []) {
        const response = await fetch(`${apiUrl}/api/outline`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-playwright-test': '1' },
          body: JSON.stringify({ outline })
        })
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`Failed to reset outline (${response.status}): ${body}`)
        }
      }
    }

    try {
      await use(appContext)
    } finally {
      fs.rmSync(testDataDir, { recursive: true, force: true })
    }
  },
  page: async ({ context, app }, use) => {
    const page = await context.newPage()
    const consoleMessages = []
    const pageErrors = []

    const consoleListener = (message) => {
      if (message.type() === 'error') {
        consoleMessages.push({
          type: message.type(),
          text: message.text(),
          location: message.location?.url || ''
        })
      }
    }
    const pageErrorListener = (error) => {
      pageErrors.push(error)
    }

    const routeHandler = async (route) => {
      const headers = { ...route.request().headers(), 'x-playwright-test': '1' }
      await route.continue({ headers })
    }

    const placeholderHandler = async (route) => {
      await route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: PLACEHOLDER_PIXEL })
    }

    const originalGoto = page.goto.bind(page)
    page.goto = async (url, options) => {
      if (typeof url === 'string' && url.startsWith('/')) {
        const target = new URL(url, app.clientUrl)
        return originalGoto(target.toString(), options)
      }
      return originalGoto(url, options)
    }

    page.on('console', consoleListener)
    page.on('pageerror', pageErrorListener)
    await page.route('**/api/**', routeHandler)
    await page.route('https://via.placeholder.com/**', placeholderHandler)

    try {
      await use(page)
    } finally {
      page.goto = originalGoto
      await page.unroute('**/api/**', routeHandler)
      await page.unroute('https://via.placeholder.com/**', placeholderHandler)
      page.off('console', consoleListener)
      page.off('pageerror', pageErrorListener)

      if (pageErrors.length || consoleMessages.length) {
        const errorLines = []
        consoleMessages.forEach((msg) => {
          errorLines.push(`[console.${msg.type}] ${msg.text}${msg.location ? ` (${msg.location})` : ''}`)
        })
        pageErrors.forEach((err) => {
          errorLines.push(`[pageerror] ${err.message || err.toString?.() || String(err)}`)
        })
        if (errorLines.length) {
          const message = ['Browser logged errors:', ...errorLines].join('\n')
          throw new Error(message)
        }
      }

      try {
        await page.evaluate(() => {
          try { window.localStorage?.clear?.() } catch {}
          try { window.sessionStorage?.clear?.() } catch {}
        })
      } catch {}

      await page.close()
    }
  }
})

async function buildClientBundle({ apiUrl, distDir }) {
  if (!apiUrl) throw new Error('buildClientBundle requires apiUrl')
  if (!distDir) throw new Error('buildClientBundle requires distDir')

  await ensureClientBuild()
  fs.rmSync(distDir, { recursive: true, force: true })
  copyDirectory(BASE_CLIENT_DIST, distDir)
  injectRuntimeConfig(distDir, apiUrl)
}

async function readOutlineState(page) {
  const snapshot = await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor?.getJSON) return null

    const doc = editor.getJSON()
    if (!doc || !Array.isArray(doc.content)) return []

    const extractText = (node) => {
      if (!node) return ''
      if (node.type === 'text' && typeof node.text === 'string') return node.text
      if (Array.isArray(node.content)) return node.content.map(extractText).join('')
      return ''
    }

    const collectListItems = (listNode) => {
      if (!listNode || listNode.type !== 'bulletList') return []
      const results = []
      const items = Array.isArray(listNode.content) ? listNode.content : []
      for (const item of items) {
        if (!item || item.type !== 'listItem') continue
        const textParts = []
        const nestedChildren = []
        const content = Array.isArray(item.content) ? item.content : []
        for (const child of content) {
          if (child?.type === 'bulletList') {
            nestedChildren.push(collectListItems(child))
          } else {
            textParts.push(extractText(child))
          }
        }
        const flattenedChildren = nestedChildren.length
          ? nestedChildren.reduce((acc, group) => acc.concat(group), [])
          : []
        const rawText = textParts.join('').replace(/\s+/g, ' ').trim()
        const tags = Array.isArray(item?.attrs?.tags)
          ? item.attrs.tags.map(tag => String(tag || '').toLowerCase())
          : []
        const status = item?.attrs?.status ?? ''
        results.push({
          text: rawText,
          status,
          tags,
          children: flattenedChildren
        })
      }
      return results
    }

    const firstList = doc.content.find(node => node?.type === 'bulletList')
    if (!firstList) return []
    return collectListItems(firstList)
  })
  return snapshot
}

async function expectOutlineState(page, expected, { timeout = 5000, message = 'outline state mismatch', includeTags = true } = {}) {
  const normalize = (nodes) => {
    if (!Array.isArray(nodes)) return []
    return nodes.map(node => {
      const normalizedTags = Array.isArray(node?.tags)
        ? node.tags.map(tag => String(tag || '').toLowerCase())
        : []
      const normalized = {
        text: typeof node?.text === 'string' ? node.text : '',
        status: typeof node?.status === 'string' ? node.status : '',
        children: normalize(node?.children || [])
      }
      if (includeTags) normalized.tags = normalizedTags
      return normalized
    })
  }

  const expectedNormalized = normalize(expected)
  await expect.poll(async () => {
    const state = await readOutlineState(page)
    if (state === null) return '__pending__'
    return normalize(state)
  }, { timeout, message }).toEqual(expectedNormalized)
}

const outlineNode = (text, { status = '', tags, children = [] } = {}) => {
  const node = {
    text,
    status,
    children
  }
  if (Array.isArray(tags)) node.tags = tags
  return node
}

module.exports = { test, expect, readOutlineState, expectOutlineState, outlineNode }
