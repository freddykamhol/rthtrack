import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../server.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(), 'rthtrack-browser-'))
createApp({ dataDir, fetchFeed: async () => ({ ac: [
  { hex: 'rescue', flight: 'CHX30', r: 'D-TEST', t: 'EC35', category: 'A7', lat: 53, lon: 10, seen_pos: 1 },
  { hex: 'other', flight: 'POLICE', t: 'EC35', category: 'A7', lat: 52, lon: 10, seen_pos: 1 },
] }) }).listen(3107, '127.0.0.1')
