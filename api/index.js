/**
 * Vercel serverless entry — all /api/* hit this function.
 * Local dev: npm run start:api (server/index.js listens on :8787).
 */
import { handler } from '../server/index.js'

export default async function vercelHandler(req, res) {
  try {
    await handler(req, res)
  } catch (err) {
    // LOT P1 (audit 19/09/2026, B2) : le message interne ne sort pas de la
    // fonction. Ce que `server/index.js` applique dans son `catch` global vaut
    // aussi pour ce dernier filet : une erreur `fs`, SQL ou de parsing de l'URL
    // détaillait ici chemins et structure de base à un appelant anonyme. Le
    // détail part dans le journal de la fonction (visibles dans la console
    // Vercel), la réponse ne porte qu'un code.
    console.error('api error', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'server' }))
    }
  }
}

// LOT 8.4 (A4) — plus aucun `export const config` ici.
//
// Ce fichier exportait `config.api.bodyParser.sizeLimit = '10mb'` et
// `config.api.responseLimit = '4mb'`. Or `config.api.*` est une convention **Next.js**
// (`pages/api/*`) : ce dépôt sert ses fonctions via `@vercel/node`
// (voir `vercel.json`), qui **ignore** cet export. La valeur ne relevait donc
// aucune limite — elle donnait seulement l'impression que le corps pouvait
// faire 10 Mo, alors que Vercel refuse au-delà de **4,5 Mo** pour une fonction
// serverless, requête comme réponse, et que cette limite n'est pas relevable
// (Hobby comme Pro). Le commentaire d'origine se contredisait d'ailleurs
// lui-même (« sizeLimit 10 mo … 4 mo reste large »).
//
// Ce qui borne réellement le corps :
//  · la plateforme, à 4,5 Mo — `FUNCTION_PAYLOAD_TOO_LARGE`, avant le handler ;
//  · l'application, à `MAX_BODY_BYTES` (`server/index.js`, 4 Mo sous Vercel),
//    qui répond un 413 JSON avec la borne appliquée ;
//  · le client, qui comprime chaque photo sous un budget d'octets et refuse
//    l'envoi si le corps dépasserait (`src/photoCompress.js`, `MasterPage`).
// Les trois valeurs viennent d'un seul module : `src/limits.js`.
