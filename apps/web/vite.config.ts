import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The browser only ever talks to one origin; Vite forwards /api to the backend.
    // Same-origin requests mean the session cookie needs no CORS setup.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
