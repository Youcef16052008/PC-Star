import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTS } from './data.js'
import { DZ_EXTRA, DZ_BRANDS } from './dzCatalog.js'
import { isDzPhone, phoneCarrier } from './shopStore.js'

describe('DZ catalog fill', () => {
  it('has a thick catalog with local brands', () => {
    // P21 : 27 références « dz-hit » retirées à la demande du comptoir
    // (250 → 223 au total, 89 → 62 pour DZ_EXTRA).
    assert.ok(PRODUCTS.length >= 200, `expected >=200 products, got ${PRODUCTS.length}`)
    assert.ok(DZ_EXTRA.length >= 50, `expected >=50 DZ skus, got ${DZ_EXTRA.length}`)
    const brands = new Set(PRODUCTS.map((p) => p.brand))
    ;['Spirit of Gamer', 'Havit', 'Twinmos', 'Magma', 'Gamemax', 'Tenda'].forEach((b) => {
      assert.ok(brands.has(b), `missing brand ${b}`)
    })
    assert.ok(DZ_BRANDS.includes('Spirit of Gamer'))
  })

  it('tags budget items — et plus aucun « dz-hit » (P21)', () => {
    const hits = PRODUCTS.filter((p) => (p.tags || []).includes('dz-hit'))
    const budget = PRODUCTS.filter((p) => (p.tags || []).includes('budget'))
    // P21 : la section « الأكثر مبيعاً في الجزائر » et ses produits ont été
    // supprimés — le tag ne doit plus apparaître nulle part dans le catalogue.
    assert.equal(hits.length, 0, `dz-hit encore présent : ${hits.map((p) => p.id).join(', ')}`)
    assert.ok(budget.length >= 15, `seulement ${budget.length} produits « budget »`)
  })
})

describe('api client (B4)', () => {
  it('req : erreur réseau → flag offline, aucune promesse rejetée', async () => {
    // En node, fetch('/api/health') (URL relative) lève une TypeError :
    // req() doit la convertir en { ok:false, offline:true }.
    const { health } = await import('./api.js')
    const h = await health()
    assert.equal(h.ok, false)
    assert.equal(h.offline, true)
  })
})

// ---------------------------------------------------------------------------
// P21 — « je clique, rien ne change » au comptoir.
//
// `req()` n'avait AUCUN délai maximal. Un fetch qui pend (proxy capricieux,
// cold start serverless, réseau mobile) ne résout jamais ; comme le Desk
// partageait un seul état `busy`, une seule requête bloquée désactivait les
// boutons de toutes les commandes jusqu'au rechargement de la page.
// ---------------------------------------------------------------------------
describe('P21 — req() interrompt une requête qui pend', () => {
  it('un délai maximal est défini et positif', async () => {
    const { API_TIMEOUT_MS } = await import('./api.js')
    assert.equal(typeof API_TIMEOUT_MS, 'number')
    assert.ok(API_TIMEOUT_MS > 0 && API_TIMEOUT_MS <= 60000, `délai incohérent : ${API_TIMEOUT_MS}`)
  })

  it('req() arme bien un minuteur au délai annoncé (la ligne qui manquait)', async () => {
    const { API_TIMEOUT_MS } = await import('./api.js')
    const realFetch = globalThis.fetch
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    const armed = []
    const cleared = []
    // On observe le minuteur sans attendre 15 s : c'est exactement la ligne
    // `setTimeout(() => ctrl.abort(), timeoutMs)` ajoutée dans req().
    globalThis.setTimeout = (fn, ms) => { armed.push(ms); return realSetTimeout(() => {}, 1e9) }
    globalThis.clearTimeout = (h) => { cleared.push(h); return realClearTimeout(h) }
    globalThis.fetch = (url, init) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    try {
      const { health } = await import('./api.js')
      const h = await health()
      assert.equal(h.ok, true, 'réponse normale toujours traitée')
      assert.deepEqual(armed, [API_TIMEOUT_MS], `minuteur armé à ${armed.join(',')} ms`)
      assert.equal(cleared.length, 1, 'le minuteur est libéré après la réponse (pas de fuite)')
    } finally {
      globalThis.fetch = realFetch
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    }
  })

  it('fetch reçoit un AbortSignal, et son interruption rend offline (pas de promesse pendue)', async () => {
    const { health } = await import('./api.js')
    const realFetch = globalThis.fetch
    let captured = null
    globalThis.fetch = (url, init) =>
      new Promise((_resolve, reject) => {
        captured = init && init.signal
        // Rejette comme le fait un vrai fetch quand le signal est interrompu.
        captured.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    try {
      const pending = health()
      assert.ok(captured, 'req() transmet bien un AbortSignal à fetch')
      assert.ok(typeof captured.addEventListener === 'function', 'signal exploitable')
      // Sans interruption cette promesse ne se réglerait jamais : c'est
      // exactement le cas qui gelait les boutons du Desk.
      captured.dispatchEvent(new Event('abort'))
      const h = await pending
      assert.equal(h.ok, false, 'requête interrompue → non ok')
      assert.equal(h.offline, true, 'requête interrompue → flag offline, jamais de rejet')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('checkout phone DZ', () => {
  it('only accepts mobilis ooredoo djezzy', () => {
    assert.equal(phoneCarrier('0550123456'), 'ooredoo')
    assert.equal(phoneCarrier('0669174617'), 'mobilis')
    assert.equal(phoneCarrier('0770650387'), 'djezzy')
    assert.equal(isDzPhone('0210000000'), false)
  })
})
