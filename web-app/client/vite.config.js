import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // No intentar otros puertos si 5173 está ocupado
    host: true, // Exponer a la red
    open: false, // No abrir automáticamente el navegador
    proxy: {
      // Proxy para las solicitudes a la API
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  }
})