
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

import './lib/db.js'
import tasksRouter from './routes/tasks.js'
import dayRouter from './routes/day.js'
import uploadRouter from './routes/upload.js'
import outlineRouter from './routes/outline.js'
import historyRouter from './routes/history.js'
import filesRouter from './routes/files.js'
import { ensureUploadDir } from './lib/files.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const require = createRequire(import.meta.url)
const { version: pkgVersion } = require('../package.json')

const app = express()
const PORT = process.env.PORT || 4000
const SERVER_VERSION = pkgVersion || 'dev'
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString()

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
  optionsSuccessStatus: 204
}))
app.options('*', cors())

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

ensureUploadDir()
app.use('/uploads', express.static(path.join(__dirname, './uploads')))
app.use('/files', filesRouter)

app.use('/api', outlineRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/day', dayRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/history', historyRouter)

app.get('/api/health', (req, res) => res.json({ ok: true, version: SERVER_VERSION, buildTime: BUILD_TIME }))

app.listen(PORT, '0.0.0.0', () => console.log(`[server] http://localhost:${PORT} (v${SERVER_VERSION}) build:${BUILD_TIME}`))
