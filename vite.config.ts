import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/rthtrack/' : '/',
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
