import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Bibliothèques stables, chacune dans son fichier. */
const VENDOR_CHUNKS: [string, string[]][] = [
  ['react', ['react', 'react-dom', 'scheduler']],
  ['supabase', ['@supabase']],
  ['router', ['@tanstack']],
  ['i18n', ['i18next', 'react-i18next']],
];

const apiProxy = { '/api': `http://127.0.0.1:${process.env['API_PORT'] ?? 8787}` };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Application installable : manifeste et service worker (Workbox) qui met en cache la coquille.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'OIKOS',
        short_name: 'OIKOS',
        // Texte affiché par le système à l'installation ; le manifeste est statique, donc en français.
        description: 'Jeu de gestion multijoueur dans une Grèce mythologique.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#faf6ef',
        theme_color: '#9a3412',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Toute adresse de l'application rend la coquille ; l'API et Supabase ne sont jamais mis en cache.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // Un seul fichier `.env`, à la racine du dépôt (voir `.env.example`).
  envDir: '../..',
  build: {
    rollupOptions: {
      // Le catalogue de composants n'est servi qu'en développement (`/catalogue.html`).
      input: 'index.html',
      output: {
        // Bibliothèques stables à part : elles restent en cache d'une version du jeu à l'autre.
        manualChunks(id) {
          const vendor = VENDOR_CHUNKS.find(([, packages]) =>
            packages.some((name) => id.includes(`/node_modules/${name}/`)),
          );
          return vendor?.[0];
        },
      },
    },
  },
  // En développement comme en prévisualisation, l'API de jeu est servie sous le même domaine (Caddy en production).
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 5173, strictPort: true, proxy: apiProxy },
});
