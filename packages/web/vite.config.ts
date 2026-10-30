import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in dev, so the browser never deals with CORS and the
    // front end can ship as static files behind the same edge as the API.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // @flash/shared is TypeScript source linked from the workspace, not a built
  // package -- let Vite compile it instead of pre-bundling it.
  optimizeDeps: { exclude: ['@flash/shared'] },
});
