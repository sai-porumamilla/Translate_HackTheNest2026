import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the React app runs on :5173 and forwards /api to FastAPI on :8000,
// so the browser sees one origin and the session cookie just works.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
