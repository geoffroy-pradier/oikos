import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Un seul fichier `.env`, à la racine du dépôt (voir `.env.example`).
  envDir: '../..',
  server: {
    port: 5173,
    strictPort: true,
    // En développement, l'API de jeu est servie sous le même domaine, comme en production (Caddy).
    proxy: { '/api': `http://127.0.0.1:${process.env['API_PORT'] ?? 8787}` },
  },
});
