import http from 'node:http'
import https from 'node:https'
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const root = path.dirname(fileURLToPath(import.meta.url))
const categories = ['Wiese', 'Landeplatz beleuchtet', 'Krankenhaus', 'Feuerwehr', 'Sportplatz', 'Sonstige']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function validate(s) {
  if (!s || !Array.isArray(s.districts) || s.districts.length > 20 || !s.districts.every((d) => typeof d === 'string' && d.length <= 160) || !Array.isArray(s.pads) || s.pads.length > 500) return false
  if (!['showFlights','showPads','showOtherHelis','notificationsEnabled'].every((k) => typeof s[k] === 'boolean')) return false
  return s.pads.every((p) => p && typeof p.id === 'string' && p.id.length < 160 && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 160 && typeof p.notes === 'string' && p.notes.length <= 5000 && categories.includes(p.category) && typeof p.active === 'boolean' && Array.isArray(p.coords) && p.coords.length === 2 && p.coords.every(Number.isFinite) && Math.abs(p.coords[0]) <= 90 && Math.abs(p.coords[1]) <= 180)
}
function upstream(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'RTHtrack/1.0' } }, (res) => {
      let body = ''; res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk; if (body.length > 12000000) req.destroy(new Error('Feed too large')) })
      res.on('end', () => { try { const data = JSON.parse(body); if (res.statusCode !== 200 || !Array.isArray(data.ac)) throw new Error('Invalid upstream'); resolve(data) } catch (e) { reject(e) } })
      res.on('error', reject)
    }); req.setTimeout(12000, () => req.destroy(new Error('Feed timeout'))); req.on('error', reject)
  })
}
export function createApp({ dataDir = process.env.RTHTRACK_DATA_DIR || path.join(root, '..', 'rthtrack-data'), fetchFeed = upstream } = {}) {
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)) }
  async function locked(name, fn) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const lock = path.join(dataDir, name + '.lock')
    let handle
    for (let attempt = 0; attempt < 300; attempt++) {
      try { handle = await open(lock, 'wx', 0o600); break } catch (error) { if (error.code !== 'EEXIST') throw error; await sleep(100) }
    }
    if (!handle) throw new Error('Speicher gesperrt; bitte erneut versuchen')
    try { return await fn() } finally { await handle.close(); await unlink(lock) }
  }
  async function load(file, fallback) { try { return JSON.parse(await readFile(path.join(dataDir, file), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return fallback; throw e } }
  async function save(file, value) { const tmp = path.join(dataDir, randomUUID() + '.tmp'); await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await rename(tmp, path.join(dataDir, file)) }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/api/health') { await mkdir(dataDir, { recursive: true, mode: 0o700 }); return json(res, 200, { ok: true, service: 'rthtrack-node', version: '2026-10-08-source-fix' }) }
      if (url.pathname === '/adsb-live' && req.method === 'GET') {
        const feed = await locked('feed', async () => {
          const cached = await load('feed.json', null)
          if (cached && Date.now() - cached.fetchedAt < 25000) return cached
          const north = await fetchFeed('https://opendata.adsb.fi/api/v3/lat/53/lon/10/dist/250').catch(() => null)
          await sleep(1100)
          const south = await fetchFeed('https://opendata.adsb.fi/api/v3/lat/49/lon/10/dist/250').catch(() => null)
          if (!north && !south) return null
          const unique = new Map()
          for (const ac of [...(north?.ac || []), ...(south?.ac || [])]) if (ac.hex && Number.isFinite(ac.lat) && Number.isFinite(ac.lon) && (ac.seen_pos ?? 9999) <= 120) unique.set(ac.hex, ac)
          const next = { ac: [...unique.values()], fetchedAt: Date.now(), partial: !north || !south, source: 'adsb.fi' }
          await save('feed.json', next); return next
        })
        return json(res, feed ? 200 : 502, feed || { error: 'ADSB.fi momentan nicht erreichbar' })
      }
      if (url.pathname === '/api/rthtrack/settings') {
        const token = req.headers['x-rthtrack-profile'] || ''
        if (!/^[a-f0-9]{64}$/.test(token)) return json(res, 401, { error: 'Privater Profil-Link fehlt' })
        if (!['GET', 'PUT'].includes(req.method)) return json(res, 405, { error: 'Methode nicht erlaubt' })
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Fremder Ursprung' })
        let input
        if (req.method === 'PUT') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 262144) return json(res, 413, { error: 'Zu viele Daten' }) }
          try { input = JSON.parse(body) } catch { return json(res, 400, { error: 'Ungültiges JSON' }) }
          if (!validate(input.settings)) return json(res, 422, { error: 'Ungültige Einstellungen oder Landeplatzdaten' })
        }
        const name = 'profile-' + createHash('sha256').update(token).digest('hex')
        const result = await locked(name, async () => {
          const current = await load(name + '.json', { revision: 0, settings: null })
          if (req.method === 'GET') return [200, current]
          if (input.revision !== current.revision) return [409, { error: 'Auf einem anderen Gerät geändert. Bitte neu laden.' }]
          const next = { revision: current.revision + 1, settings: input.settings }; await save(name + '.json', next); return [200, next]
        })
        return json(res, ...result)
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Methode nicht erlaubt' })
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      // Only public build assets are served, never source/config/profile data.
      if (name !== 'index.html' && name !== 'notification-sw.js' && !/^assets\/[a-zA-Z0-9_.-]+$/.test(name)) return json(res, 404, { error: 'Nicht gefunden' })
      const body = await readFile(path.join(root, name))
      const ext = path.extname(name); const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' }[ext] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime + (['.html','.js','.css'].includes(ext) ? '; charset=utf-8' : ''), 'Cache-Control': ext === '.html' || name === 'notification-sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body)
    } catch (error) { console.error('RTHtrack request:', error.message); if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 503, { error: 'Server-Dienst momentan nicht verfügbar' }); else res.end() }
  })
}
export function startServer() { const server = createApp(); server.listen(process.env.PORT || 3000); return server }
