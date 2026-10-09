import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// Shared development/build configuration.
export default defineConfig({
  plugins: [react(), { name: 'development-entry', apply: 'serve', transformIndexHtml: { order: 'pre', handler: () => readFileSync('client/index.html', 'utf8') } }],
  base: './',
  server: {
    proxy: {
      '/adsb-live': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
