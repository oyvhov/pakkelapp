import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: [],
      includeManifestIcons: false,
      manifest: {
        name: 'Pakkelapp',
        short_name: 'Pakkelapp',
        description: 'Gåver for heile familien, til jul og alle andre feiringar',
        lang: 'nn',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#17372f',
        theme_color: '#17372f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: { action: '/del', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Ikona og manifestet skiftar med sesongen og blir henta frå serveren kvar gong.
        globIgnores: ['favicon*.svg', 'icon-*.png', 'apple-touch-icon*.png'],
        manifestTransforms: [async (entries) => ({ manifest: entries.filter((e) => !e.url.endsWith('.webmanifest')) })],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8431', changeOrigin: true } },
  },
});
