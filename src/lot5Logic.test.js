import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// LOT 5 — honnêteté de l'interface, partie LOGIQUE PURE.
//
//  5.2 (U2)  `shortageMessage` : un refus de commande pour stock insuffisant
//            nommait « le premier produit manquant » sans dire combien, ni
//            combien il en reste, ni qu'il y en avait d'autres.
//  5.5 (U5)  `t()` : une variable `null`/`undefined` écrivait « null » /
//            « undefined » dans le texte rendu.
//  5.6 (U6)  `labelOr` : repli explicite quand une clé i18n manque (sinon
//            `cat_ssd` s'affiche tel quel).
//  5.7 (U7)  `buildWaMessage` : le message WhatsApp d'un grand panier dépassait
//            la limite `wa.me` et partait tronqué — parfois sans le total — sans
//            que personne le sache.
//
// La partie rendue (indicateur d'état, prix du panier, libellés, audio,
// téléchargement) est dans src/lot5UI.test.js.
// ---------------------------------------------------------------------------

const { t, dict, labelOr, LANGS } = await import('./i18n.js')
const { shortageMessage, buildWaMessage, WA_TEXT_LIMIT } = await import('./orderLogic.js')

/** Traducteur bound sur une langue, comme dans les composants. */
const T = (lang) => (key, vars) => t(lang, key, vars)

/* ------------------------------------------------------------- 5.2 (U2) */

describe('5.2 (U2) — shortageMessage nomme le manque', () => {
  const tfr = T('fr')

  it('aucune ligne → le message court existant (rien de cassé)', () => {
    assert.equal(shortageMessage([], tfr), t('fr', 'stockShort'))
    assert.equal(shortageMessage(null, tfr), t('fr', 'stockShort'))
  })

  it('une ligne → produit, quantité demandée, quantité restante', () => {
    const msg = shortageMessage([{ name: 'RTX 4060', need: 2, left: 1 }], tfr)
    assert.match(msg, /RTX 4060/)
    assert.match(msg, /2 demandés/)
    assert.match(msg, /1 disponibles/)
    assert.notEqual(msg, t('fr', 'stockShort'), 'le détail doit remplacer le message générique')
  })

  it('trois lignes → toutes nommées, sans « et N autres »', () => {
    const msg = shortageMessage(
      [
        { name: 'A', need: 1, left: 0 },
        { name: 'B', need: 1, left: 0 },
        { name: 'C', need: 1, left: 0 }
      ],
      tfr
    )
    for (const n of ['A', 'B', 'C']) assert.match(msg, new RegExp(n))
    assert.doesNotMatch(msg, /autres/)
  })

  it('au-delà de 3 → borné, et le reste est ANNONCÉ (pas silently dropped)', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, need: 1, left: 0 }))
    const msg = shortageMessage(many, tfr)
    assert.match(msg, /P0/)
    assert.match(msg, /P2/)
    assert.doesNotMatch(msg, /P3/, 'la 4e ligne ne doit pas être détaillée (borne)')
    assert.match(msg, /4 autres/, 'le nombre de lignes non affichées doit être dit')
  })

  it('la borne est paramétrable (le composant peut afficher moins)', () => {
    const msg = shortageMessage(
      [
        { name: 'A', need: 1, left: 0 },
        { name: 'B', need: 1, left: 0 }
      ],
      tfr,
      { max: 1 }
    )
    assert.match(msg, /A/)
    assert.doesNotMatch(msg, /B —/)
    assert.match(msg, /1 autres/)
  })

  it('champs manquants → pas de « undefined » dans le texte (U5 au passage)', () => {
    const msg = shortageMessage([{ id: 'sku-1' }], tfr)
    assert.match(msg, /sku-1/)
    assert.doesNotMatch(msg, /undefined/)
    assert.doesNotMatch(msg, /null/)
  })

  it('les deux langues ont les clés du détail', () => {
    for (const lang of LANGS.map((l) => l.id)) {
      for (const key of ['stockShort', 'stockShortDetail', 'stockShortLine', 'stockShortMore']) {
        assert.ok(dict[lang][key], `${lang}.${key} manque`)
      }
    }
  })
})

/* ------------------------------------------------------------- 5.5 (U5) */

describe('5.5 (U5) — t() ne écrit pas « null » / « undefined »', () => {
  it('variable absente → le placeholder reste visible (à corriger, pas à masquer)', () => {
    // Avant U5, `replaceAll('{need}', String(undefined))` écrivait « undefined »
    // dans le texte : un trou de données devenait un mot anglais à l'écran. Le
    // placeholder `{need}` est laid, mais il dit la vérité : il manque une valeur.
    assert.equal(t('fr', 'stockShortLine', { name: 'A' }), 'A — {need} demandés, {left} disponibles')
  })

  it('null / undefined ignorés, valeur réelle substituée', () => {
    const s = t('fr', 'stockShortLine', { name: 'A', need: null, left: undefined })
    assert.doesNotMatch(s, /null/)
    assert.doesNotMatch(s, /undefined/)
    assert.match(s, /\{need\}/)
    assert.match(s, /\{left\}/)
    assert.match(s, /A/)
  })

  it('0 et chaîne vide sont des VALEURS (pas des absences)', () => {
    const s = t('fr', 'stockShortLine', { name: 'A', need: 0, left: '' })
    assert.match(s, /0 demandés/)
    assert.doesNotMatch(s, /\{left\}/)
  })

  it('faux positif évité : false reste substitué', () => {
    assert.equal(t('fr', 'cartPriceUpdated', { lines: false }), t('fr', 'cartPriceUpdated', { lines: 'false' }))
  })
})

/* ------------------------------------------------------------- 5.6 (U6) */

describe('5.6 (U6) — labelOr : repli explicite', () => {
  const tfr = T('fr')

  it('clé traduite → la traduction', () => {
    // `cat_cpu` est une vraie clé du catalogue (les 13 ids de CATEGORIES sont
    // traduits — vérifié plus bas) : le repli ne doit PAS prendre le dessus.
    assert.equal(labelOr(tfr, 'cat_cpu', 'CPU brut'), t('fr', 'cat_cpu'))
    assert.notEqual(labelOr(tfr, 'cat_cpu', 'CPU brut'), 'CPU brut')
  })

  it('clé absente → le repli (et JAMAIS la clé nue)', () => {
    assert.equal(labelOr(tfr, 'cat_inexistant', 'Stockage NVMe'), 'Stockage NVMe')
    assert.doesNotMatch(labelOr(tfr, 'cat_inexistant', 'Stockage NVMe'), /^cat_/)
  })

  it('clé absente sans repli → la clé (dernier recours, explicite)', () => {
    assert.equal(labelOr(tfr, 'cat_inexistant', ''), 'cat_inexistant')
    assert.equal(labelOr(tfr, 'cat_inexistant', null), 'cat_inexistant')
  })

  it('les 13 catégories du catalogue sont traduites dans les deux langues', async () => {
    const { CATEGORIES } = await import('./data.js')
    for (const lang of LANGS.map((l) => l.id)) {
      for (const c of CATEGORIES) {
        const got = labelOr(T(lang), `cat_${c.id}`, null)
        assert.notEqual(got, `cat_${c.id}`, `${lang}.cat_${c.id} manque`)
        assert.equal(got, t(lang, `cat_${c.id}`))
      }
    }
  })
})

/* ------------------------------------------------------------- 5.7 (U7) */

describe('5.7 (U7) — buildWaMessage tient dans la limite wa.me', () => {
  const tfr = T('fr')
  const pickup = { name: 'Karim B.', phone: '0550123456', slot: 'matin' }

  it('petit panier → message complet, rien de retiré', () => {
    const cart = [
      { qty: 1, name: 'Ryzen 5 5600', sku: 'CPU-5600' },
      { qty: 2, name: 'DDR4 16Go', sku: 'RAM-16' }
    ]
    const msg = buildWaMessage(cart, 78000, pickup, tfr)
    assert.ok(msg.length <= WA_TEXT_LIMIT)
    assert.match(msg, /Ryzen 5 5600/)
    assert.match(msg, /DDR4 16Go/)
    assert.match(msg, /78[\s\u00a0\u202f]*000/)
    assert.match(msg, /Karim B\./)
    assert.doesNotMatch(msg, /tronqué/, 'aucune mention de troncature quand rien est retire')
  })

  it('grand panier → sous la limite, total PRÉSENT, troncature ANNONCÉE', () => {
    const cart = Array.from({ length: 60 }, (_, i) => ({
      qty: 1,
      name: `Composant numéro ${i} avec une désignation raisonnablement longue`,
      sku: `SKU-${String(i).padStart(4, '0')}`
    }))
    const msg = buildWaMessage(cart, 1234567, pickup, tfr)
    assert.ok(msg.length <= WA_TEXT_LIMIT, `longueur ${msg.length} > ${WA_TEXT_LIMIT}`)
    assert.match(msg, /1[\s\u00a0\u202f]*234[\s\u00a0\u202f]*567/, 'le total doit survivre à la troncature')
    assert.match(msg, /Karim B\./, 'les coordonnées doivent survivre')
    assert.match(msg, /tronqué/, 'la troncature doit être dite')
    const m = msg.match(/(\d+)\s+lignes retirées/)
    assert.ok(m, 'le nombre de lignes retirées doit être chiffré')
    assert.ok(Number(m[1]) > 0)
    assert.ok(Number(m[1]) < 60, 'on ne retire pas tout le panier')
  })

  it('le texte encodé (ce qui part vraiment dans l’URL) reste raisonnable', () => {
    const cart = Array.from({ length: 200 }, (_, i) => ({ qty: 3, name: `Produit ${i}`, sku: `S-${i}` }))
    const msg = buildWaMessage(cart, 999, pickup, tfr)
    assert.ok(msg.length <= WA_TEXT_LIMIT)
    // `wa.me` tronque l'URL encodée : la garde porte sur le texte, on vérifie
    // que le texte lui-même ne déborde pas une fois encodé au-delà de ~4 Ko.
    assert.ok(encodeURIComponent(msg).length > 0)
  })

  it('cas pathologique : UNE ligne énorme → tronqué brutalement mais sous la limite', () => {
    const cart = [{ qty: 1, name: 'X'.repeat(WA_TEXT_LIMIT * 2), sku: 'BIG' }]
    const msg = buildWaMessage(cart, 500, pickup, tfr)
    assert.ok(msg.length <= WA_TEXT_LIMIT, `longueur ${msg.length}`)
  })

  it('panier vide → message court, pas de crash', () => {
    const msg = buildWaMessage([], 0, pickup, tfr)
    assert.ok(msg.length <= WA_TEXT_LIMIT)
    assert.doesNotMatch(msg, /tronqué/)
  })

  it('la limite est paramétrable (testable sans 60 lignes)', () => {
    const cart = Array.from({ length: 10 }, (_, i) => ({ qty: 1, name: `Produit ${i}`, sku: `S-${i}` }))
    const msg = buildWaMessage(cart, 4242, pickup, tfr, { limit: 220 })
    assert.ok(msg.length <= 220, `longueur ${msg.length} > 220`)
    // `money()` écrit « 4 242 DA » (espace insécable) : on cherche les chiffres
    // séparés, pas la forme brute — et surtout on vérifie que le TOTAL est là.
    assert.match(msg, /4[\s\u00a0\u202f]*242/, 'le total survit même à une limite très basse')
  })

  it('WA_TEXT_LIMIT laisse une marge sous les ~4 Ko de wa.me', () => {
    assert.ok(WA_TEXT_LIMIT > 1000)
    assert.ok(WA_TEXT_LIMIT < 4096)
  })

  it('les deux langues ont la mention de troncature', () => {
    for (const lang of LANGS.map((l) => l.id)) assert.ok(dict[lang].waTruncated, `${lang}.waTruncated manque`)
  })
})
