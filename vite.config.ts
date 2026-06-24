import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appBase = process.env.VITE_APP_BASE ?? '/trimcad1/'

export default defineConfig({
  plugins: [react()],
  base: appBase,
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@tx-code/occt-js'],
  },
  server: {
    open: appBase,
    proxy: {
      '/api': {
        target: process.env.VITE_AI_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
