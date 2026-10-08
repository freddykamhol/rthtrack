import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), { name: 'development-entry', apply: 'serve', transformIndexHtml: { order: 'pre', handler: () => readFileSync('client/index.html', 'utf8') } }],
  base: './',
  server: {
    proxy: {
      '/adsb-live': {
        target: 'https://opendata.adsb.fi',
        changeOrigin: true,
        rewrite: () => '/api/v3/lat/53.18/lon/10.38/dist/250',
      },
    },
  },
})
