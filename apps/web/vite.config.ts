import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // API_URL lets a second copy of the app point at a different backend
  // (e.g. `API_URL=http://localhost:8899 vite --port 5199`). Normally unset.
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // The browser only ever talks to one origin; Vite forwards /api to the backend.
      // Same-origin requests mean the session cookie needs no CORS setup.
      proxy: { '/api': env.API_URL || 'http://localhost:8787' },
    },
  };
});
