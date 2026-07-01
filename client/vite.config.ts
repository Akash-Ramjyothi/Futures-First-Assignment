import { defineConfig } from 'vite'

export default defineConfig({
  base: '/Futures-First-Assignment/',
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
