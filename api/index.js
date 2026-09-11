/**
 * Vercel serverless entry — all /api/* hit this function.
 * Local dev: npm run start:api (server/index.js listens on :8787).
 */
import { handler } from '../server/index.js'

export default async function vercelHandler(req, res) {
  try {
    await handler(req, res)
  } catch (err) {
    console.error('api error', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'server', message: String(err?.message || err) }))
    }
  }
}

// P4 (B10) : sizeLimit 10 mo — avec la compression client (6 × ~300 Ko de
// JPEG ≈ 2,5 Mo de JSON), la limite 4 mo d'origine provoquait des 413 sur
// Vercel dès 6 photos. Réponse : aucun endpoint ne dépasse ~1 Mo (catalogue
// ≈ 500 Ko), 4 mo reste large.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    },
    responseLimit: '4mb'
  }
}
