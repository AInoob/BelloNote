import { db } from '../lib/db.js'
import { ensureDefaultProject } from '../lib/projects.js'

const TEST_PROJECT_NAME = 'Playwright E2E'

let FORCE_TEST_PROJECT = false

async function ensureProjectByName(name) {
  const existing = await db.get('SELECT id FROM projects WHERE name = $1', [name])
  if (existing?.id) return existing.id
  const created = await db.get('INSERT INTO projects (name) VALUES ($1) RETURNING id', [name])
  return created.id
}

async function ensureProjectForTests(req) {
  const isPlaywrightHeader = Boolean(req.headers['x-playwright-test'] && process.env.NODE_ENV !== 'production')
  const isTestEnv = process.env.NODE_ENV === 'test'
  const dbName = (process.env.PGDATABASE || '').toLowerCase()
  const looksLikePlaywrightDb = dbName.includes('bello_note_test') || dbName.includes('playwright')
  if (isPlaywrightHeader) FORCE_TEST_PROJECT = true
  if (isPlaywrightHeader || isTestEnv || looksLikePlaywrightDb || FORCE_TEST_PROJECT) {
    return ensureProjectByName(TEST_PROJECT_NAME)
  }
  return null
}

export async function resolveProjectId(req) {
  const testProjectId = await ensureProjectForTests(req)
  if (testProjectId) return testProjectId
  return ensureDefaultProject()
}

export async function assertTaskBelongsToProject(taskId, projectId) {
  if (!taskId) return null
  const row = await db.get('SELECT id, project_id FROM tasks WHERE id = $1', [taskId])
  if (!row) return null
  if (row.project_id !== projectId) return null
  return row
}
