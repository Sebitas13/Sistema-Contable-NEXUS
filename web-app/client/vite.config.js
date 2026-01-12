import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mantenemos tus alias por si los usas en el código
      '@': path.resolve(__dirname, './src'),
    }
  },
  build: {
    // ESTO ES LO QUE SOLUCIONA EL ERROR EN VERCEL
    rollupOptions: {
      external: [
        '/bootstrap/js/bootstrap.bundle.min.js',
        '/bootstrap/css/bootstrap.min.css'
      ]
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  }
})