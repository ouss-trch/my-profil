import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.ERP_PORT || 3600}`;

const demo = process.env.VITE_DEMO === '1';

export default defineConfig({
  plugins: [react()],
  // نسخة العرض: مسارات نسبية حتى تعمل من أي رابط مستضاف
  base: demo ? './' : '/',
  server: {
    port: 5173,
    proxy: { '/api': api, '/uploads': api, '/go': api },
  },
  build: {
    outDir: demo ? 'dist-demo' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
