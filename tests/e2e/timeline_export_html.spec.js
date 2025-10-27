const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')

const { test, expect } = require('./test-base')

const PROJECT_ROOT = path.join(__dirname, '..', '..')
const IMAGE_PATH = path.join(__dirname, '..', 'assets', 'test-image.png')

async function ensureBackendReady(request, app) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${app.apiUrl}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function uploadTestImage(request, app) {
  const buffer = fs.readFileSync(IMAGE_PATH)
  const response = await request.post(`${app.apiUrl}/api/upload/image`, {
    headers: { 'x-playwright-test': '1' },
    multipart: {
      image: {
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer
      }
    }
  })
  expect(response.ok()).toBeTruthy()
  const json = await response.json()
  expect(json.id).toBeTruthy()
  expect(json.url).toMatch(/^\/files\//)
  return json
}

function buildDatabaseUrl(app) {
  const pg = app.pgConfig || {}
  const host = pg.host || '127.0.0.1'
  const port = pg.port || 5432
  const user = pg.user || 'postgres'
  const password = pg.password || ''
  const encodedUser = encodeURIComponent(user)
  const auth = password ? `${encodedUser}:${encodeURIComponent(password)}@` : `${encodedUser}@`
  return `postgresql://${auth}${host}:${port}/${app.databaseName}`
}

function formatExportDate(dateStr) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  return formatter.format(new Date(`${dateStr}T00:00:00Z`))
}

async function runExportCommand({ app, outPath, from, to, extraArgs = [] }) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: buildDatabaseUrl(app),
    PGDATABASE: app.databaseName,
    PGHOST: app.pgConfig?.host || '127.0.0.1',
    PGPORT: String(app.pgConfig?.port || 5432),
    PGUSER: app.pgConfig?.user || 'postgres'
  }
  if (app.pgConfig?.password) env.PGPASSWORD = app.pgConfig.password
  if (process.env.PGSSLMODE) env.PGSSLMODE = process.env.PGSSLMODE
  const uploadDir = path.join(PROJECT_ROOT, 'tests', 'temp', `uploads-${app.databaseName}`)
  env.UPLOAD_DIR = uploadDir

  const args = ['--prefix', 'server', 'run', 'export:timeline', '--', '--out', outPath]
  if (from) args.push('--from', from)
  if (to) args.push('--to', to)
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs)

  await fsp.mkdir(path.dirname(outPath), { recursive: true })

  await new Promise((resolve, reject) => {
    const proc = spawn('npm', args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.once('error', reject)
    proc.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`export command failed (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}

test.describe.configure({ mode: 'serial' })

test('exports timeline HTML with embedded assets', async ({ page, request, app }) => {
  expect(app.databaseName).toBeTruthy()
  await ensureBackendReady(request, app)
  await app.resetOutline([])
  await page.goto('/')

  const uploadInfo = await uploadTestImage(request, app)

  const codeBlock = {
    type: 'codeBlock',
    content: [
      { type: 'text', text: 'const status = "done";\nconsole.log(status);' }
    ]
  }

  const imageContent = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Diagram ' },
        {
          type: 'image',
          attrs: {
            src: uploadInfo.url,
            'data-file-id': String(uploadInfo.id),
            'data-file-path': uploadInfo.url,
            alt: 'demo diagram'
          }
        }
      ]
    }
  ]

  const outline = [
    {
      id: null,
      title: 'Release planning',
      status: 'in-progress',
      dates: ['2025-01-03'],
      tags: ['project'],
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Kickoff checklist' }] },
        codeBlock
      ],
      children: [
        {
          id: null,
          title: 'UI polish',
          status: 'todo',
          dates: ['2025-01-04'],
          tags: ['keep'],
          content: imageContent
        },
        {
          id: null,
          title: 'Publish notes #skip',
          status: 'done',
          dates: ['2025-01-03'],
          tags: ['skip'],
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Snapshot ' },
                {
                  type: 'image',
                  attrs: {
                    src: uploadInfo.url,
                    'data-file-id': String(uploadInfo.id),
                    'data-file-path': uploadInfo.url,
                    alt: 'legacy reuse'
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]

  await app.resetOutline(outline)

  const outPath = path.join(app.dataDir, 'timeline-export.html')
  const from = '2025-01-03'
  const to = '2025-01-04'

  await runExportCommand({ app, outPath, from, to })

  const html = await fsp.readFile(outPath, 'utf8')
  expect(html).toContain('<!DOCTYPE html>')
  expect(html).toContain('Timeline Export')
  expect(html).toContain('class="day-tree"')
  expect(html).toContain('class="node-header"')
  expect(html).toContain('--bg: #ffffff;')
  expect(html).toContain('Release planning')
  expect(html).toContain('in-progress')
  expect(html).toContain('Publish notes #skip')
  expect(html).toContain('UI polish')
  expect(html).toContain('done')

  const formattedFrom = formatExportDate(from)
  const formattedTo = formatExportDate(to)
  expect(html).toContain(formattedFrom)
  expect(html).toContain(formattedTo)

  expect(html).toContain('<pre><code>')
  expect(html).toMatch(/const status = &quot;done&quot;/)

  const dataImages = html.match(/<img\s+src="data:image\/png;base64,[^"]+"/g) || []
  expect(dataImages.length).toBeGreaterThanOrEqual(2)

  expect(html).not.toContain(uploadInfo.url)

  const filteredPath = path.join(app.dataDir, 'timeline-export-exclude.html')
  await runExportCommand({ app, outPath: filteredPath, from, to, extraArgs: ['--exclude-tag', 'skip'] })
  const filteredHtml = await fsp.readFile(filteredPath, 'utf8')
  expect(filteredHtml).not.toContain('Publish notes #skip')
  expect(filteredHtml).not.toContain('#skip')
  expect(filteredHtml).toContain('Tags exclude skip')
  expect(filteredHtml).toContain('UI polish')
})
