import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // '/' = stand-alone site. For the single-domain build the root build script passes VITE_BASE=/retail/ or /bullion/.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 3000 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'chart-vendor': ['chart.js'],
          'pdf-vendor': ['jspdf'],
          'xlsx-vendor': ['xlsx'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
