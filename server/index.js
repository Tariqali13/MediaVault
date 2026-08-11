import cors from 'cors'
import express from 'express'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const app = express()
const serverDirectory = dirname(fileURLToPath(import.meta.url))
const storePath = join(serverDirectory, 'data', 'store.json')
const workspaceId = 'northstar-studio'

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

const assetSchema = z.object({ name: z.string().trim().min(1).max(120), type: z.string().trim().min(1).max(12), size: z.string().trim().min(1).max(24), collectionId: z.string().trim().min(1).max(48).optional() })
const collectionSchema = z.object({ name: z.string().trim().min(2).max(60) })

const seedStore = {
  assets: [
    { id: 'asset_001', workspaceId, name: 'Autumn campaign hero', type: 'JPG', size: '8.4 MB', owner: 'Maya Chen', status: 'approved', createdAt: '2026-08-11T10:42:00Z', tags: ['Campaign'], collectionId: 'collection_campaigns' },
    { id: 'asset_002', workspaceId, name: 'Studio product set', type: 'PNG', size: '4.1 MB', owner: 'Samir Khan', status: 'draft', createdAt: '2026-08-11T09:18:00Z', tags: ['Product'], collectionId: 'collection_brand' },
  ],
  collections: [
    { id: 'collection_brand', workspaceId, name: 'Brand essentials', createdAt: '2026-08-01T09:00:00Z' },
    { id: 'collection_campaigns', workspaceId, name: 'Campaigns', createdAt: '2026-08-02T09:00:00Z' },
    { id: 'collection_product', workspaceId, name: 'Product photography', createdAt: '2026-08-03T09:00:00Z' },
  ],
  shares: [],
  auditEvents: [{ id: 'event_seed', action: 'workspace.created', occurredAt: '2026-08-01T09:00:00Z', summary: 'Northstar Studio workspace initialized' }],
}

function readStore() {
  if (!existsSync(storePath)) { mkdirSync(dirname(storePath), { recursive: true }); writeFileSync(storePath, JSON.stringify(seedStore, null, 2)) }
  return JSON.parse(readFileSync(storePath, 'utf8'))
}
function writeStore(store) { writeFileSync(storePath, JSON.stringify(store, null, 2)) }
function event(store, action, summary) { store.auditEvents.unshift({ id: `event_${Date.now()}`, action, summary, occurredAt: new Date().toISOString() }) }
function requireWorkspace(request, response, next) { if (request.header('x-workspace-id') !== workspaceId) return response.status(403).json({ error: 'workspace_access_denied' }); next() }

app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'media-vault-api' }))
app.get('/api/v1/workspace', requireWorkspace, (_request, response) => response.json({ data: { id: workspaceId, name: 'Northstar Studio', role: 'owner', members: 18, storageUsed: 68 } }))
app.get('/api/v1/assets', requireWorkspace, (request, response) => { const query = String(request.query.q ?? '').toLowerCase(); const collectionId = String(request.query.collectionId ?? ''); const data = readStore().assets.filter((asset) => asset.workspaceId === workspaceId && (!query || asset.name.toLowerCase().includes(query)) && (!collectionId || asset.collectionId === collectionId)); response.json({ data, meta: { workspaceId, count: data.length } }) })
app.post('/api/v1/assets', requireWorkspace, (request, response) => { const parsed = assetSchema.safeParse(request.body); if (!parsed.success) return response.status(422).json({ error: 'invalid_asset', issues: parsed.error.flatten() }); const store = readStore(); const asset = { id: `asset_${Date.now()}`, workspaceId, owner: 'Tariq Ali', status: 'processing', createdAt: new Date().toISOString(), tags: [], ...parsed.data }; store.assets.unshift(asset); event(store, 'asset.created', `${asset.name} uploaded`); writeStore(store); response.status(201).json({ data: asset }) })
app.get('/api/v1/collections', requireWorkspace, (_request, response) => response.json({ data: readStore().collections.filter((collection) => collection.workspaceId === workspaceId) }))
app.post('/api/v1/collections', requireWorkspace, (request, response) => { const parsed = collectionSchema.safeParse(request.body); if (!parsed.success) return response.status(422).json({ error: 'invalid_collection', issues: parsed.error.flatten() }); const store = readStore(); const collection = { id: `collection_${Date.now()}`, workspaceId, createdAt: new Date().toISOString(), ...parsed.data }; store.collections.unshift(collection); event(store, 'collection.created', `${collection.name} collection created`); writeStore(store); response.status(201).json({ data: collection }) })
app.post('/api/v1/assets/:assetId/share-links', requireWorkspace, (request, response) => { const store = readStore(); const asset = store.assets.find((item) => item.id === request.params.assetId && item.workspaceId === workspaceId); if (!asset) return response.status(404).json({ error: 'asset_not_found' }); const share = { id: `share_${Date.now()}`, assetId: asset.id, token: Math.random().toString(36).slice(2, 10), createdAt: new Date().toISOString(), expiresAt: null }; store.shares.unshift(share); event(store, 'asset.shared', `Share link created for ${asset.name}`); writeStore(store); response.status(201).json({ data: { ...share, url: `${request.protocol}://${request.get('host')}/shared/${share.token}` } }) })
app.get('/api/v1/audit-events', requireWorkspace, (_request, response) => response.json({ data: readStore().auditEvents.slice(0, 25) }))
app.use((_request, response) => response.status(404).json({ error: 'not_found' }))

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => console.log(`MediaVault API listening on http://localhost:${port}`))
