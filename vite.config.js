import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          bootstrap: ['bootstrap']
        }
      }
    },
    chunkSizeWarningLimit: 600
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },

  /*
   * LOT P6 (S6) — `vite preview` n'hérite PAS de `server.proxy`. Sans ce bloc,
   * l'aperçu « production » répondait 404 sur `/api/*` (renvoyé par le fallback
   * SPA) : le compte maître était inaccessible, et tout ce qui dépend du serveur
   * — bureau, catalogue live, commandes — se testait en mode local sans que la
   * page le dise. Le build dédié au crawl (`vite.crawl.config.js`) portait déjà
   * ce bloc et le commentait ainsi ; la parité est ici, au même endroit.
   *
   * `ws: true` : le flux temps réel du bureau (`src/deskStream.js`) monte un
   * WebSocket sur le même préfixe — sans lui, le comptoir retombait silencieusement
   * en polling de 20 s pendant un essai en aperçu.
   */
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
