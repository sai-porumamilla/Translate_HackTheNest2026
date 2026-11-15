import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Dev: the React app runs on :5173 and forwards /api to FastAPI on :8000,
  // so the browser sees one origin and the session cookie just works.
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    allowedHosts: ['.trycloudflare.com'], // phone testing over HTTPS via `cloudflared tunnel --url http://localhost:5173`
  },
  // Production: `npx vite build` writes straight into frontend/, which FastAPI (and Render) already serve.
  // No Node needed on Render. Rebuild and commit frontend/ whenever web/ changes.
  build: { outDir: '../frontend', emptyOutDir: true },
});
