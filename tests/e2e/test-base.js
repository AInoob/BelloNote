
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')
const { test: playwrightBase, expect } = require('@playwright/test')

const CLIENT_PORT_RANGE = { start: 6000, end: 6999 }
const SERVER_PORT_RANGE = { start: 7000, end: 7999 }
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const SERVER_ROOT = path.join(PROJECT_ROOT, 'server')
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client')
const TEMP_ROOT = path.join(PROJECT_ROOT, 'tests', 'temp')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const reservedPorts = new Set()
const UNSAFE_PORTS = new Set([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697])
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function sanitizeSegment(segment) {
  return String(segment || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildDataDir(testInfo) {
  const parts = [
    ...testInfo.titlePath,
    `w${testInfo.workerIndex}`,
    `r${testInfo.retry}`,
    `e${testInfo.repeatEachIndex}`
  ]
  const slug = parts.map(sanitizeSegment).filter(Boolean).join('-') || `test-${Date.now()}`
  return path.join(TEMP_ROOT, slug)
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
  app: async ({}, use, testInfo) => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true })
    const dataDir = buildDataDir(testInfo)
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.mkdirSync(dataDir, { recursive: true })

    let serverPort
    let clientPort
    let serverProc
    let clientProc
    let serverLogs
    let clientLogs
    let distDir

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

      const apiUrl = `http://127.0.0.1:${serverPort}`
      const clientUrl = `http://127.0.0.1:${clientPort}`

      serverProc = spawn(NPM_CMD, ['start'], {
        cwd: SERVER_ROOT,
        env: { ...process.env, PORT: String(serverPort), DATA_DIR: dataDir },
        stdio: 'pipe'
      })
      await waitForSpawn(serverProc, 'server')
      serverLogs = attachLoggers(serverProc, 'server')
      await waitForReady({ url: `${apiUrl}/api/health`, label: 'server', process: serverProc, getLogs: serverLogs.getLogs })

      distDir = path.join(dataDir, 'client-dist')
      await buildClientBundle({ apiUrl, distDir })

      clientProc = spawn(NPM_CMD, ['run', 'preview', '--', '--host=127.0.0.1', `--port=${clientPort}`, `--outDir=${distDir}`], {
        cwd: CLIENT_ROOT,
        env: { ...process.env, VITE_API_URL: apiUrl },
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

      const appContext = {
        apiUrl,
        clientUrl,
        dataDir,
        clientPort,
        serverPort,
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

      await use(appContext)
    } finally {
      await stopProcess(clientProc, 'client')
      await stopProcess(serverProc, 'server')
      clientLogs?.dispose?.()
      serverLogs?.dispose?.()
      if (clientPort) releasePort(clientPort)
      if (serverPort) releasePort(serverPort)
      if (distDir) fs.rmSync(distDir, { recursive: true, force: true })
      if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
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

    try {
      await use(page)
    } finally {
      page.goto = originalGoto
      await page.unroute('**/api/**', routeHandler)
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

  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(distDir, { recursive: true })

  const buildProc = spawn(NPM_CMD, ['run', 'build', '--', `--outDir=${distDir}`], {
    cwd: CLIENT_ROOT,
    env: { ...process.env, VITE_API_URL: apiUrl },
    stdio: 'pipe'
  })

  await waitForSpawn(buildProc, 'client build')

  const buildLogs = attachLoggers(buildProc, 'client-build')
  try {
    const exitCode = await new Promise((resolve, reject) => {
      buildProc.once('error', reject)
      buildProc.once('exit', resolve)
    })
    if (exitCode !== 0) {
      const info = buildLogs.getLogs ? `\n${buildLogs.getLogs()}` : ''
      throw new Error(`client build failed (code ${exitCode})${info}`)
    }
  } finally {
    buildLogs.dispose?.()
  }
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
