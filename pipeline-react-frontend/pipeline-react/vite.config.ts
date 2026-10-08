import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const gatewayTarget = process.env.VITE_GATEWAY_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
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
})
