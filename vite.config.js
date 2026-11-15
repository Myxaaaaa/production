import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    // changeOrigin: false — сохраняем исходный Host, иначе CSRF-проверка в server/api.js
    // видит Origin localhost:5173 и Host localhost:3000 и отклоняет вход.
    proxy: { '/api': { target: `http://localhost:${process.env.PORT || 3000}`, changeOrigin: false } },
  },
});
