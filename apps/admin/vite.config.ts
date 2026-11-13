import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxy = { '/api': `http://127.0.0.1:${process.env['API_PORT'] ?? 8787}` };

// Back-office Olympe : application distincte du client joueur, sur son propre port (son propre
// sous-domaine en production). Elle lit et écrit uniquement par l'API de jeu, servie sous le même domaine.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Un seul fichier `.env`, à la racine du dépôt (voir `.env.example`).
  envDir: '../..',
  server: { port: 5174, strictPort: true, proxy: apiProxy },
  preview: { port: 5174, strictPort: true, proxy: apiProxy },
});
