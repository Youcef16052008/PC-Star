/**
 * LOT P2 (audit 19/09/2026, B28) — les limites de débit du serveur.
 *
 * Le rapport #4 comptait « 5 routes limitées » ; mesuré : **neuf** blocs
 * `rateLimit` en 2026-09, dont deux écrivaient leur 429 à la main avec un code
 * d'erreur différent (`rate_limited`, sans `retryAfter`), et la route la plus
 * coûteuse en CPU n'en avait **aucune**. Ce fichier verrouille les trois
 * propriétés qui comptent : une route chère est bornée, un refus dit quand
 * réessayer, et ces deux règles ne peuvent plus se diverger route par route.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const SRC = fs.readFileSync(path.join(process.cwd(), 'server/index.js'), 'utf8')
/** Le texte réellement exécuté, commentaires retirés (voir `src/moduleWiring.test.js`). */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

describe('P2/B28 — le 429 est une réponse, pas neuf', () => {
  it('toute route limitée passe par tooManyRequests', () => {
    const limites = (CODE.match(/const rl = rateLimit\(\{/g) || []).length
    const reponses = (CODE.match(/if \(!rl\.ok\) return tooManyRequests\(res, rl\)/g) || []).length
    assert.ok(limites >= 10, `${limites} appels à rateLimit — le fichier a-t-il été amputé ?`)
    assert.equal(reponses, limites, 'une limite qui répond 429 à la main, hors du helper')
  })

  it('plus aucun 429 écrit à la main dans le routeur', () => {
    assert.equal(/send\(res, 429/.test(CODE), false, 'un 429 recopié : Retry-After peut manquer')
    assert.equal(CODE.includes("'rate_limited'"), false, 'deux vocabulaires d’erreur de débit')
  })

  it('le helper porte le corps et l’en-tête attendus par le client', () => {
    const corps = SRC.match(/function tooManyRequests\(res, rl\) \{[\s\S]*?\n\}/)[0]
    assert.ok(/error: 'rate'/.test(corps), 'le client lit error === "rate"')
    assert.ok(/retryAfter: rl\.retryAfter/.test(corps), 'orderApiFailure lit data.retryAfter')
    assert.ok(/'Retry-After': String\(Math\.max\(1, rl\.retryAfter \|\| 1\)\)/.test(corps), 'en-tête standard')
  })
})

describe('P2/B28 — la route qui dépense du CPU est bornée', () => {
  it('reset-password est limitée avant toute authentification', () => {
    const i = CODE.indexOf("pathname.endsWith('/reset-password')")
    assert.ok(i > 0, 'route reset-password introuvable')
    const debut = CODE.slice(i, i + 700)
    const jRl = debut.indexOf('rateLimit({')
    const jAuth = debut.indexOf('await userFromReq(req)')
    assert.ok(jRl > 0, 'aucun rateLimit sur la route qui hache deux mots de passe')
    assert.ok(jAuth > 0 && jRl < jAuth, 'la limite doit précéder la lecture de session')
    const fenetre = debut.slice(jRl, debut.indexOf(')', jRl))
    assert.match(fenetre, /windowMs: 60_000, max: 5/)
  })

  it('en direct : cinq requêtes passent, la sixième est un 429 chiffré', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-b28-'))
    process.env.PCSTAR_DATA_DIR = dir
    const { handler } = await import(`../server/index.js?b28=${Date.now()}`)
    const server = http.createServer(handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const statuts = []
      let dernier = null
      for (let n = 0; n < 6; n++) {
        const res = await fetch(`${base}/api/master/customers/nope/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'abc123' })
        })
        statuts.push(res.status)
        dernier = res
      }
      // Les cinq premières atteignent le contrôle d'accès (403 : aucune
      // session) — la limite ne mord pas sur l'usage normal.
      assert.deepEqual(statuts.slice(0, 5), [403, 403, 403, 403, 403], `statuts reçus : ${statuts.join(', ')}`)
      assert.equal(statuts[5], 429, 'la sixième requête n’a pas été refusée')
      const data = await dernier.json()
      assert.equal(data.error, 'rate')
      assert.ok(Number(dernier.headers.get('Retry-After')) >= 1, 'Retry-After absent')
      assert.ok(data.retryAfter >= 1, 'retryAfter absent du corps : le client ne peut rien annoncer')
      assert.equal('message' in data, false, 'le 429 ne doit rien expliquer d’autre')
    } finally {
      await new Promise((resolve) => server.close(resolve))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
