const fs = require('fs')
const path = require('path')

const { test, expect } = require('./test-base')

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

function buildTask({ title, content, status = 'todo', dates = [], children = [] }) {
  return {
    id: null,
    title,
    status,
    content,
    dates,
    children
  }
}

test.describe.configure({ mode: 'serial' })

test('export and import round trip with image assets', async ({ page, request, app }) => {
  await ensureBackendReady(request, app)
  await app.resetOutline([])

  const imagePath = path.join(__dirname, '..', 'assets', 'test-image.png')
  const imageBuffer = fs.readFileSync(imagePath)
  const uploadResponse = await request.post(`${app.apiUrl}/api/upload/image`, {
    headers: { 'x-playwright-test': '1' },
    multipart: {
      image: {
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: imageBuffer
      }
    }
  })
  expect(uploadResponse.ok()).toBeTruthy()
  const uploadJson = await uploadResponse.json()
  expect(uploadJson.id).toBeTruthy()
  expect(uploadJson.url).toMatch(/^\/files\//)

  const imageNode = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Child with image ' },
        {
          type: 'image',
          attrs: {
            src: uploadJson.url,
            'data-file-id': String(uploadJson.id),
            'data-file-path': uploadJson.url,
            alt: 'demo'
          }
        }
      ]
    }
  ]

  const outlinePayload = [
    buildTask({
      title: 'Parent task',
      status: 'in-progress',
      dates: ['2025-01-02'],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent body' }] }],
      children: [
        buildTask({ title: 'Child image note', content: imageNode }),
        buildTask({
          title: 'Sibling referencing same asset',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Duplicate asset ' },
                {
                  type: 'image',
                  attrs: {
                    src: uploadJson.url,
                    'data-file-id': String(uploadJson.id),
                    'data-file-path': uploadJson.url
                  }
                }
              ]
            }
          ]
        })
      ]
    })
  ]

  await app.resetOutline(outlinePayload)

  const exportResponse = await request.get(`${app.apiUrl}/api/export`, {
    headers: { 'x-playwright-test': '1' }
  })
  expect(exportResponse.ok()).toBeTruthy()
  const manifest = await exportResponse.json()
  expect(manifest.assets).toHaveLength(1)
  expect(manifest.entities.notes.length).toBeGreaterThanOrEqual(3)
  const noteWithAsset = manifest.entities.notes.find((note) => /asset:\/\//.test(note.content))
  expect(noteWithAsset).toBeTruthy()

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  const resetResponse = await request.post(`${app.apiUrl}/api/test/reset`, {
    headers: { 'x-playwright-test': '1' }
  })
  expect(resetResponse.ok()).toBeTruthy()

  const importResponse = await request.post(`${app.apiUrl}/api/import`, {
    headers: { 'x-playwright-test': '1' },
    multipart: {
      manifest: {
        name: 'export.json',
        mimeType: 'application/json',
        buffer: manifestBuffer
      }
    }
  })
  const importJson = await importResponse.json()
  expect(importResponse.ok(), `import failed: ${JSON.stringify(importJson)}`).toBeTruthy()
  expect(importJson.ok).toBe(true)
  expect(importJson.notesImported).toBe(manifest.entities.notes.length)
  expect(importJson.assetsProcessed).toBe(1)

  const outlineResponse = await request.get(`${app.apiUrl}/api/outline`, {
    headers: { 'x-playwright-test': '1' }
  })
  expect(outlineResponse.ok()).toBeTruthy()
  const outlineJson = await outlineResponse.json()
  expect(outlineJson.roots).toHaveLength(1)
  const childNodes = outlineJson.roots[0].children
  expect(childNodes).toHaveLength(2)

  const importedContentStr = childNodes[0].content
  const parsedContent = JSON.parse(importedContentStr)
  const imageAttrs = parsedContent[0].content.find((node) => node.type === 'image')?.attrs || {}
  expect(imageAttrs.src).toMatch(/^\/files\//)
  expect(imageAttrs['data-file-id']).toBeDefined()
})

test('import rejects invalid manifest', async ({ request, app }) => {
  await ensureBackendReady(request, app)
  const invalidManifest = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8')
  const importResponse = await request.post(`${app.apiUrl}/api/import`, {
    headers: { 'x-playwright-test': '1' },
    multipart: {
      manifest: {
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer: invalidManifest
      }
    }
  })
  expect(importResponse.status()).toBe(400)
  const body = await importResponse.json()
  expect(body.ok).toBe(false)
  expect(body.error).toContain('Manifest validation failed')
})
