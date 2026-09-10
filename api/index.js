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

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb'
    },
    responseLimit: '4mb'
  }
}
