import http from 'node:http'

const baseUrl = new URL(process.env.API_URL ?? 'http://localhost:4000')
const request = (path, headers = {}) => new Promise((resolve, reject) => {
  const clientRequest = http.request({ hostname: baseUrl.hostname, port: baseUrl.port, path, headers }, (response) => {
    let body = ''
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body }))
  })
  clientRequest.on('error', reject)
  clientRequest.end()
})

const health = await request('/health')
if (health.status !== 200) throw new Error('Health endpoint is unavailable')

const assets = await request('/api/v1/assets?q=autumn', { 'x-workspace-id': 'northstar-studio' })
if (assets.status !== 200) throw new Error('Asset listing failed')
if (JSON.parse(assets.body).meta.count !== 1) throw new Error('Asset search did not return expected data')

console.log('API smoke checks passed')
