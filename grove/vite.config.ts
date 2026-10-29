import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['grove-dota2.onrender.com', '.onrender.com'],
  },
  preview: {
    host: true,
    allowedHosts: ['grove-dota2.onrender.com', '.onrender.com'],
  },
})
