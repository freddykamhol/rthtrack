import { build } from 'vite'
import { readFile, mkdir, copyFile, cp } from 'node:fs/promises'
import path from 'node:path'

// Always compile the source entry, never the previously published root HTML.
const source = await readFile('client/index.html', 'utf8')
await build({
  plugins: [{ name: 'source-html', enforce: 'pre', transformIndexHtml: { order: 'pre', handler: () => source } }],
})
const html = await readFile('dist/index.html', 'utf8')
const bundle = html.match(/src="([^"]+\.js)"/)?.[1]
if (!bundle) throw new Error('Missing production bundle')
const js = await readFile(path.join('dist', bundle.replace(/^\.\//, '').replace(/^\//, '')), 'utf8')
if (!js.includes('Landeplatz bearbeiten') || !js.includes('api/rthtrack/settings')) throw new Error('Build does not include current app source')
await mkdir('assets', { recursive: true })
await cp('dist/assets', 'assets', { recursive: true })
await copyFile('dist/index.html', 'index.html')
console.log('Published current source to root HTML and assets.')
