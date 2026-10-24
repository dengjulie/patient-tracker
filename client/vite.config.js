import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to Express, so the browser sees one origin and the
    // session cookie works without CORS.
    proxy: { '/api': 'http://localhost:3001' },
  },
})
