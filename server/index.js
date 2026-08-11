import cors from 'cors'
import express from 'express'
import { z } from 'zod'

const app = express()
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['JPG', 'PNG', 'MP4', 'PDF', 'ZIP']),
  size: z.string().trim().min(1).max(24),
  collectionId: z.string().trim().min(1).max(48).optional(),
})

const workspaceId = 'northstar-studio'
let assets = [
  { id: 'asset_001', workspaceId, name: 'Autumn campaign hero', type: 'JPG', size: '8.4 MB', owner: 'Maya Chen', status: 'approved', createdAt: '2026-08-11T10:42:00Z', tags: ['Campaign'] },
  { id: 'asset_002', workspaceId, name: 'Studio product set', type: 'PNG', size: '4.1 MB', owner: 'Samir Khan', status: 'draft', createdAt: '2026-08-11T09:18:00Z', tags: ['Product'] },
]
const auditLog = []

function requireWorkspace(request, response, next) {
  if (request.header('x-workspace-id') !== workspaceId) {
    return response.status(403).json({ error: 'workspace_access_denied' })
  }
  next()
}

app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'media-vault-api' }))

app.get('/api/v1/assets', requireWorkspace, (request, response) => {
  const query = String(request.query.q ?? '').toLowerCase()
  const result = query ? assets.filter((asset) => asset.name.toLowerCase().includes(query)) : assets
  response.json({ data: result, meta: { workspaceId, count: result.length } })
})

app.post('/api/v1/assets', requireWorkspace, (request, response) => {
  const parsed = uploadSchema.safeParse(request.body)
  if (!parsed.success) return response.status(422).json({ error: 'invalid_asset', issues: parsed.error.flatten() })
  const asset = { id: `asset_${String(assets.length + 1).padStart(3, '0')}`, workspaceId, owner: 'Tariq Ali', status: 'processing', createdAt: new Date().toISOString(), tags: [], ...parsed.data }
  assets = [asset, ...assets]
  auditLog.unshift({ id: `event_${Date.now()}`, action: 'asset.created', assetId: asset.id, occurredAt: asset.createdAt })
  response.status(201).json({ data: asset })
})

app.get('/api/v1/audit-events', requireWorkspace, (_request, response) => response.json({ data: auditLog }))

app.use((_request, response) => response.status(404).json({ error: 'not_found' }))

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => console.log(`MediaVault API listening on http://localhost:${port}`))
