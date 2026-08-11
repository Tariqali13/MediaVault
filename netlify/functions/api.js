const workspaceId = 'northstar-studio'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

export default async (request) => {
  if (request.headers.get('x-workspace-id') !== workspaceId) return json({ error: 'workspace_access_denied' }, 403)

  const { pathname } = new URL(request.url)
  if (request.method === 'POST' && pathname === '/api/v1/assets') {
    const body = await request.json()
    if (!body.name || !body.type || !body.size) return json({ error: 'invalid_asset' }, 422)
    return json({ data: { id: `asset_${Date.now()}`, workspaceId, owner: 'Tariq Ali', status: 'processing', createdAt: new Date().toISOString(), tags: [], ...body } }, 201)
  }
  if (request.method === 'POST' && pathname === '/api/v1/collections') {
    const { name } = await request.json()
    if (!name || name.trim().length < 2) return json({ error: 'invalid_collection' }, 422)
    return json({ data: { id: `collection_${Date.now()}`, workspaceId, name: name.trim(), createdAt: new Date().toISOString() } }, 201)
  }
  if (request.method === 'POST' && /^\/api\/v1\/assets\/[^/]+\/share-links$/.test(pathname)) {
    const assetId = pathname.split('/')[4]
    const token = Math.random().toString(36).slice(2, 10)
    return json({ data: { id: `share_${Date.now()}`, assetId, token, createdAt: new Date().toISOString(), expiresAt: null, url: `${new URL(request.url).origin}/shared/${token}` } }, 201)
  }
  return json({ error: 'not_found' }, 404)
}

export const config = { path: '/api/*' }
