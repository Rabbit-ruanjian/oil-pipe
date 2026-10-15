import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Vite does not automatically expose .env files to the config process.
  // Load the local gateway target here so the dev proxy follows .env.local.
  const env = loadEnv(mode, process.cwd(), '')
  const gatewayTarget = env.VITE_GATEWAY_TARGET || 'http://localhost:8080'

  return {
  plugins: [react()],
  server: {
    port: 7892,
    host: '0.0.0.0',
    proxy: {
      '/auth': {
        target: gatewayTarget,
        changeOrigin: true,
      },
      '/project': {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => `/data${path}`,
      },
      '/pipeline': {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => `/data${path}`,
      },
      '/pump-station': {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => `/data${path}`,
      },
      '/oil-property': {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => `/data${path}`,
      },
      '/knowledge-doc': {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => `/data${path}`,
      },
      '/calculation': {
        target: gatewayTarget,
        changeOrigin: true,
      },
      '/api/v1': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: true,
      },
      '/api/v2': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: true,
      },
    },
  },
  }
})
