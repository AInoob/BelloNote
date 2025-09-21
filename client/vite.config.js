
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_TIME__: JSON.stringify(BUILD_TIME)
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/files': 'http://localhost:4000'
    }
  }
})
