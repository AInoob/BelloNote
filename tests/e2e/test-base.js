
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')
const { Client } = require('pg')
const { test: playwrightBase, expect } = require('@playwright/test')

const CLIENT_PORT_RANGE = { start: 5000, end: 5499 }
const SERVER_PORT_RANGE = { start: 5500, end: 5999 }
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const SERVER_ROOT = path.join(PROJECT_ROOT, 'server')
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client')
const TEMP_ROOT = path.join(PROJECT_ROOT, 'tests', 'temp')
const BASE_CLIENT_DIST = path.join(CLIENT_ROOT, 'dist')
const WORKER_ROOT_PREFIX = '.playwright-data'
const PLACEHOLDER_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yp8N40AAAAASUVORK5CYII=', 'base64')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const DB_MODULE_URL = pathToFileURL(path.join(PROJECT_ROOT, 'server', 'src', 'lib', 'db.js')).href
let schemaStatementsPromise = null

async function loadSchemaStatements() {
  if (!schemaStatementsPromise) {
    schemaStatementsPromise = import(DB_MODULE_URL).then((mod) => {
      if (!mod.SCHEMA_STATEMENTS) {
        throw new Error('SCHEMA_STATEMENTS export missing from server/src/lib/db.js')
      }
      return mod.SCHEMA_STATEMENTS
    })
  }
  return schemaStatementsPromise
}

const PW_KEEP_WORKER_ROOT = process.env.PW_KEEP_WORKER_ROOT === '1'

function parsePositiveInt(value) {
  if (!value) return null
  const result = Number.parseInt(String(value), 10)
  if (!Number.isNaN(result) && result > 0) return result
  return null
}

function detectWorkerCount() {
  const envCandidates = [
    process.env.PLAYWRIGHT_WORKERS,
    process.env.PW_WORKER_COUNT,
    process.env.PW_TEST_TOTAL_WORKERS,
    process.env.CI_WORKERS
  ].map(parsePositiveInt)
  for (const value of envCandidates) {
    if (value) return value
  }

  for (const arg of process.argv) {
    if (arg.startsWith('--workers=')) {
      const parsed = parsePositiveInt(arg.split('=')[1])
      if (parsed) return parsed
    }
  }

  const flagIndex = process.argv.indexOf('--workers')
  if (flagIndex !== -1 && flagIndex + 1 < process.argv.length) {
    const parsed = parsePositiveInt(process.argv[flagIndex + 1])
    if (parsed) return parsed
  }

  return parsePositiveInt(process.env.PLAYWRIGHT_DEFAULT_WORKERS) || 4
}

const REQUESTED_WORKER_COUNT = detectWorkerCount()
const TEST_DATABASES = Array.from({ length: REQUESTED_WORKER_COUNT }, (_, index) => `bello_note_test_${index + 1}`)
const PG_SSL = (process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined
const BASE_PG_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  ssl: PG_SSL
}
const ADMIN_DATABASE = process.env.PGADMIN_DATABASE || process.env.PGDATABASE_ADMIN || 'postgres'

async function ensureDatabaseExists(dbName) {
  const adminClient = new Client({ ...BASE_PG_CONFIG, database: ADMIN_DATABASE })
  await adminClient.connect()
  try {
    const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (exists.rowCount === 0) {
      try {
        await adminClient.query(`CREATE DATABASE "${dbName}" WITH ENCODING 'UTF8' TEMPLATE template0`)
      } catch (err) {
        if (err.code !== '42P04') throw err
      }
    }
  } finally {
    await adminClient.end()
  }
}

let ensureAllTestDatabasesPromise = null

function ensureAllTestDatabases() {
  if (!ensureAllTestDatabasesPromise) {
    ensureAllTestDatabasesPromise = (async () => {
      for (const dbName of TEST_DATABASES) {
        await ensureDatabaseExists(dbName)
      }
    })()
  }
  return ensureAllTestDatabasesPromise
}

function assertSafeIdentifier(value, label = 'identifier') {
  if (!/^[A-Za-z0-9_]+$/.test(String(value || ''))) {
    throw new Error(`${label} contains unsupported characters: ${value}`)
  }
}

function pickDatabaseForWorker(workerInfo) {
  if (!TEST_DATABASES.length) throw new Error('TEST_DATABASES is empty')
  const index = workerInfo.workerIndex % TEST_DATABASES.length
  const name = TEST_DATABASES[index]
  if (!name) {
    throw new Error(`No database configured for worker index ${workerInfo.workerIndex}`)
  }
  return name
}

async function recreateDatabase(dbName) {
  assertSafeIdentifier(dbName, 'database name')
  await ensureAllTestDatabases()
  await ensureDatabaseExists(dbName)
  const dbClient = new Client({ ...BASE_PG_CONFIG, database: dbName })
  await dbClient.connect()
  try {
    const schemaStatements = await loadSchemaStatements()
    const { rows: [{ lock_key: lockKey }] } = await dbClient.query('SELECT hashtextextended($1, 0) AS lock_key', [dbName])
    await dbClient.query('SELECT pg_advisory_lock($1)', [lockKey])
    let inTransaction = false
    try {
      await dbClient.query('BEGIN')
      inTransaction = true

      await dbClient.query('CREATE SCHEMA IF NOT EXISTS public')
      await dbClient.query('SET search_path TO public')
      await dbClient.query('GRANT ALL ON SCHEMA public TO CURRENT_USER')
      await dbClient.query('GRANT ALL ON SCHEMA public TO public')

      await dbClient.query('DROP VIEW IF EXISTS work_logs CASCADE')

      const { rows: tables } = await dbClient.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `)
      for (const { tablename } of tables) {
        assertSafeIdentifier(tablename, 'table name')
        await dbClient.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`)
      }

      await dbClient.query('DROP TYPE IF EXISTS work_logs CASCADE')

      for (const statement of schemaStatements) {
        await dbClient.query(statement)
      }

      await dbClient.query(`
        CREATE OR REPLACE VIEW work_logs AS
        SELECT
          t.id::uuid              AS task_id,
          (d.value)::date         AS date
        FROM tasks t
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(t.worked_dates, '[]'::jsonb)) AS d(value);
      `)

      await dbClient.query('INSERT INTO projects (name) VALUES ($1)', ['Playwright E2E'])

      await dbClient.query('COMMIT')
      inTransaction = false
    } catch (err) {
      if (inTransaction) {
        try {
          await dbClient.query('ROLLBACK')
        } catch {}
      }
      throw err
    } finally {
      try {
        await dbClient.query('SELECT pg_advisory_unlock($1)', [lockKey])
      } catch {}
    }
  } finally {
    await dbClient.end()
  }
}

async function dropDatabase(dbName) {
  if (!dbName) return
  // No-op: databases are reset on acquisition.
  return
}

function buildServerEnv({ serverPort, databaseName }) {
  const env = {
    ...process.env,
    PORT: String(serverPort),
    NODE_ENV: 'test'
  }

  delete env.DATABASE_URL
  delete env.DB_NAME

  const host = BASE_PG_CONFIG.host || '127.0.0.1'
  const port = String(BASE_PG_CONFIG.port || 5432)
  const user = BASE_PG_CONFIG.user || 'postgres'
  const password = BASE_PG_CONFIG.password || ''
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
    : `${encodeURIComponent(user)}@`
  env.DATABASE_URL = `postgresql://${auth}${host}:${port}/${databaseName}`

  env.PGDATABASE = databaseName
  env.PGHOST = host
  env.PGPORT = port
  env.PGUSER = user
  if (password) env.PGPASSWORD = BASE_PG_CONFIG.password
  if (process.env.PGSSLMODE) env.PGSSLMODE = process.env.PGSSLMODE

  env.UPLOAD_DIR = path.join(TEMP_ROOT, `uploads-${databaseName}`)

  return env
}

const reservedPorts = new Set()
const UNSAFE_PORTS = new Set([5000, 5060, 5061, 5500, 5566, 5665, 5666, 5667, 5668, 5669, 5697])
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

function attachLoggers(proc, label, logDir = null) {
  let buffer = ''
  let fileStream = null
  if (logDir && fs.existsSync(logDir)) {
    try {
      fileStream = fs.createWriteStream(path.join(logDir, `${label}.log`), { flags: 'a' })
    } catch (err) {
      console.error(`[test-base] failed to open log file for ${label}`, err)
      fileStream = null
    }
  }
  const makeHandler = (stream) => (chunk) => {
    buffer += `[${label}:${stream}] ${chunk.toString()}`
    if (buffer.length > 8000) buffer = buffer.slice(buffer.length - 8000)
    if (fileStream) {
      try {
        fileStream.write(chunk)
      } catch (err) {
        console.error(`[test-base] failed to write ${label} ${stream} logs`, err)
      }
    }
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
      if (fileStream) {
        try { fileStream.end() } catch {}
      }
    }
  }
}

async function canBindPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => {
      tester.close(() => resolve(false))
    })
    tester.once('listening', () => {
      tester.close(() => resolve(true))
    })
    try {
      tester.listen(port, '127.0.0.1')
    } catch (err) {
      resolve(false)
    }
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
      const open = await canBindPort(port)
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
    let uploadDirPath

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

      databaseName = pickDatabaseForWorker(workerInfo)
      await recreateDatabase(databaseName)

      const apiUrl = `http://127.0.0.1:${serverPort}`
      const clientUrl = `http://127.0.0.1:${clientPort}`

      const serverEnv = buildServerEnv({ serverPort, databaseName })
      uploadDirPath = serverEnv.UPLOAD_DIR

      serverProc = spawn(NPM_CMD, ['start'], {
        cwd: SERVER_ROOT,
        env: serverEnv,
        stdio: 'pipe'
      })
      await waitForSpawn(serverProc, 'server')
      serverLogs = attachLoggers(serverProc, 'server', PW_KEEP_WORKER_ROOT ? workerRoot : null)
      await waitForReady({ url: `${apiUrl}/api/health`, label: 'server', process: serverProc, getLogs: serverLogs.getLogs })

      distDir = path.join(workerRoot, 'client-dist')
      await buildClientBundle({ apiUrl, distDir })

      clientProc = spawn(NPM_CMD, ['run', 'preview', '--', '--host=127.0.0.1', `--port=${clientPort}`, `--outDir=${distDir}`], {
        cwd: CLIENT_ROOT,
        env: { ...process.env, VITE_API_URL: apiUrl, NODE_ENV: 'test' },
        stdio: 'pipe'
      })
      await waitForSpawn(clientProc, 'client')
      clientLogs = attachLoggers(clientProc, 'client', PW_KEEP_WORKER_ROOT ? workerRoot : null)
      await waitForReady({
        url: `${clientUrl}/`,
        label: 'client',
        process: clientProc,
        getLogs: clientLogs.getLogs,
        verify: async () => !(await canBindPort(clientPort))
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
      if (distDir && !PW_KEEP_WORKER_ROOT) fs.rmSync(distDir, { recursive: true, force: true })
      if (dataDir && !PW_KEEP_WORKER_ROOT) fs.rmSync(dataDir, { recursive: true, force: true })
      if (workerRoot && !PW_KEEP_WORKER_ROOT) fs.rmSync(workerRoot, { recursive: true, force: true })
      if (uploadDirPath && !PW_KEEP_WORKER_ROOT) fs.rmSync(uploadDirPath, { recursive: true, force: true })
      if (databaseName) {
        await dropDatabase(databaseName)
      }
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
      if (!PW_KEEP_WORKER_ROOT) fs.rmSync(testDataDir, { recursive: true, force: true })
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

function normalizeOutlineNodes(nodes, includeTags = true) {
  if (!Array.isArray(nodes)) return []
  return nodes.map(node => {
    const normalizedTags = Array.isArray(node?.tags)
      ? node.tags.map(tag => String(tag || '').toLowerCase())
      : []
    const normalized = {
      text: typeof node?.text === 'string' ? node.text : '',
      status: typeof node?.status === 'string' ? node.status : '',
      children: normalizeOutlineNodes(node?.children || [], includeTags)
    }
    if (includeTags) normalized.tags = normalizedTags
    return normalized
  })
}

function mapApiOutlineNodes(nodes) {
  if (!Array.isArray(nodes)) return []
  return nodes.map(node => ({
    text: typeof node?.title === 'string' ? node.title : '',
    status: typeof node?.status === 'string' ? node.status : '',
    tags: Array.isArray(node?.tags) ? node.tags : [],
    children: mapApiOutlineNodes(node?.children || [])
  }))
}

async function expectOutlineState(page, expected, { timeout = 5000, message = 'outline state mismatch', includeTags = true } = {}) {
  const expectedNormalized = normalizeOutlineNodes(expected, includeTags)
  await expect.poll(async () => {
    const state = await readOutlineState(page)
    if (state === null) return '__pending__'
    return normalizeOutlineNodes(state, includeTags)
  }, { timeout, message }).toEqual(expectedNormalized)
}

async function expectOutlineApiState(request, app, expected, { timeout = 10000, message = 'api outline state mismatch', includeTags = true } = {}) {
  const expectedNormalized = normalizeOutlineNodes(expected, includeTags)
  await expect.poll(async () => {
    const response = await request.get(`${app.apiUrl}/api/outline`, { headers: { 'x-playwright-test': '1' } })
    if (!response.ok()) return '__pending__'
    const json = await response.json().catch(() => null)
    if (!json || !Array.isArray(json.roots)) return '__pending__'
    return normalizeOutlineNodes(mapApiOutlineNodes(json.roots), includeTags)
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
module.exports = { test, expect, readOutlineState, expectOutlineState, expectOutlineApiState, outlineNode }
