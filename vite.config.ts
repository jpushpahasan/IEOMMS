import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5180, proxy: { '/api': { target: 'http://localhost:4100', changeOrigin: false } } }, // keep Host so the API's same-origin check passes
});
