import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build dédié au crawl jsdom (L2, `npm run build:crawl` puis `npm run crawl`).
 * jsdom n'exécute PAS les <script type="module"> : le bundle est donc émis
 * en IIFE classique, un seul fichier, dans dist-crawl/ (ignoré par git).
 * Ce build ne sert qu'à la porte de validation — la prod reste `npm run build`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-crawl',
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  },
  // NB : `vite preview` n'hérite PAS de server.proxy — sans ce bloc explicite,
  // /api tombe sur le fallback SPA et la session maître du crawl échoue.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  }
})
