import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createApp } from '../server.mjs'

test('independent clients persist pads across restart; conflicts and invalid writes rejected', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rthtrack-test-'))
  let server = createApp({ dataDir })
  const listen = async () => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}` }
  const close = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
  let base = await listen()
  try {
    const token = randomBytes(32).toString('hex')
    const headers = { 'Content-Type':'application/json', 'X-RTHtrack-Profile':token }
    const settings = { districts:['Höxter'], showFlights:true, showPads:true, showOtherHelis:false, notificationsEnabled:true, pads:[{id:'test',name:'Testwiese',category:'Wiese',notes:'Integrationstest',coords:[51.77,9.38],active:true}] }
    assert.equal((await fetch(base + '/api/rthtrack/settings')).status, 401)
    assert.equal((await (await fetch(base + '/api/rthtrack/settings', { headers })).json()).revision, 0)
    const put = (revision, value=settings) => fetch(base + '/api/rthtrack/settings', {method:'PUT',headers,body:JSON.stringify({revision,settings:value})})
    assert.equal((await put(0)).status, 200)
    await close(); server = createApp({ dataDir }); base = await listen()
    const otherClient = await (await fetch(base + '/api/rthtrack/settings', {headers})).json()
    assert.deepEqual(otherClient.settings, settings)
    assert.equal((await put(0)).status, 409)
    assert.equal((await put(1, {...settings,pads:[{...settings.pads[0],coords:[999,9]}]})).status, 422)
    const concurrent = await Promise.all([put(1),put(1)])
    assert.deepEqual(concurrent.map((r)=>r.status).sort(), [200,409])
    assert.equal((await fetch(base + '/server.mjs')).status, 404)
    assert.equal((await fetch(base + '/.env.local')).status, 404)
    const html = await (await fetch(base)).text()
    const js = html.match(/src="([^"]+\.js)"/)[1]
    const bundle = await (await fetch(new URL(js, base))).text()
    assert.ok(bundle.includes('Landeplatz bearbeiten'))
    assert.ok(bundle.includes('api/rthtrack/settings'))
    assert.ok(!bundle.includes('localStorage'))
  } finally { await close() }
})

test('feed rejects outages, deduplicates fresh positions, and caches requests', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rthtrack-feed-test-'))
  let calls=0
  const server = createApp({dataDir,fetchFeed:async()=>{calls++;return {ac:[{hex:'test',lat:51,lon:10,seen_pos:2},{hex:'old',lat:51,lon:10,seen_pos:400}]}}})
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  try {
    const responses=await Promise.all([fetch(base+'/adsb-live'),fetch(base+'/adsb-live')])
    const data=await responses[0].json(); assert.equal(data.ac.length,1); assert.equal(calls,2)
  } finally { server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve)) }
  const failed=createApp({dataDir:await mkdtemp(path.join(tmpdir(),'rthtrack-outage-test-')),fetchFeed:async()=>{throw new Error('offline')}})
  await new Promise((resolve)=>failed.listen(0,'127.0.0.1',resolve))
  try { const response=await fetch(`http://127.0.0.1:${failed.address().port}/adsb-live`); assert.equal(response.status,502); assert.ok(!(await response.json()).ac) }
  finally { failed.closeAllConnections(); await new Promise((resolve)=>failed.close(resolve)) }
})

test('source entry never depends on published bundles', async()=>{
  const source=await readFile('client/index.html','utf8')
  assert.ok(source.includes('/src/main.tsx')); assert.ok(!source.includes('/assets/'))
})
