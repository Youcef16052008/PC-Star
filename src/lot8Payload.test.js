import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 8.4 (A4) + LOT 8.5 (A5) — ce qui part réellement sur le réseau.
//
//  A4 : les limites annoncées n'étaient pas celles appliquées.
//       · `api/index.js` exportait `config.api.bodyParser.sizeLimit = '10mb'`,
//         une convention **Next.js** ignorée par `@vercel/node` (voir
//         `vercel.json`) : rien n'était relevé, mais le commentaire affirmait
//         que le corps pouvait faire 10 Mo.
//       · `server/index.js` bornait le corps à 15 Mo **y compris sous Vercel**,
//         alors que la plateforme refuse une fonction serverless au-delà de
//         4,5 Mo (requête comme réponse), AVANT d'entrer dans le handler, et
//         sans possibilité de relevage (Hobby comme Pro). Entre 4,5 et 15 Mo,
//         le maître recevait donc une page d'erreur de plateforme
//         (`FUNCTION_PAYLOAD_TOO_LARGE`) au lieu de notre 413 JSON.
//       · les mêmes budgets étaient recopiés à la main dans cinq fichiers.
//
//  A5 : la compression décidait sur les **dimensions**, jamais sur le poids —
//       une image ≤ 800 px repartait telle quelle (le dataURL brut). Un PNG
//       800×800 de 2 Mo → 2,7 Mo de base64 ; six photos de ce type ≈ 12 Mo.
//       Et rien ne bornait le **total** : chaque photo pouvait être acceptable
//       et le corps quand même trop lourd.
//
// Les deux correctifs partagent un seul module de budgets : `src/limits.js`.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

// Les globaux doivent exister AVANT les `await import(...)` : `MasterPage` et
// ses dépendances capturent `localStorage`/`document` à l'import du module.
window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'CustomEvent',
  'FileReader',
  'Blob',
  'getComputedStyle'
]) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MasterPage } = await import('./MasterPage.jsx')
const { dict } = await import('./i18n.js')
const { saveLang } = await import('./prefs.js')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')
const { compressDataUrl, dataUrlBytes, COMPRESS_DEFAULTS, scaleToMaxDim } = await import('./photoCompress.js')
const L = await import('./limits.js')
const blobStore = await import('../server/blobStore.js')
const server = await import('../server/index.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const t = (key, vars) => {
  let s = dict.fr[key] ?? key
  Object.entries(vars || {}).forEach(([k, v]) => {
    s = s.replaceAll(`{${k}}`, String(v))
  })
  return s
}
const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const realFetch = globalThis.fetch

async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(150)
  return {
    host,
    text: () => clean(host),
    byText: (selector, text) => [...host.querySelectorAll(selector)].find((n) => clean(n) === text) || null,
    unmount: async () => {
      root.unmount()
      host.remove()
      await settle(30)
    }
  }
}

before(() => {
  resetSafeStorage(window)
  window.localStorage.clear()
  saveLang(safeStorage, 'fr')
})

after(async () => {
  await settle(60)
  globalThis.fetch = realFetch
  window.fetch = realFetch
})

/* ============================== A4 — budgets ============================== */

describe('8.4 (A4) — un seul module de budgets, et des limites applicables', () => {
  it('la chaîne de budgets tient : 6 photos compressées < garde d’envoi < limite Vercel', () => {
    // Le pire cas réaliste : chaque photo au plafond du budget, gonflée en
    // base64 (4 caractères pour 3 octets) dans le JSON.
    const worstCase = L.MAX_PHOTOS * Math.ceil((L.MAX_PHOTO_BYTES * 4) / 3)
    assert.ok(
      worstCase <= L.MAX_UPLOAD_BODY_BYTES,
      `6 photos au plafond (${worstCase} o) doivent tenir dans la garde d'envoi (${L.MAX_UPLOAD_BODY_BYTES} o)`
    )
    assert.ok(
      L.MAX_UPLOAD_BODY_BYTES < L.VERCEL_MAX_BODY_BYTES,
      `la garde d'envoi (${L.MAX_UPLOAD_BODY_BYTES}) doit rester SOUS la limite plateforme (${L.VERCEL_MAX_BODY_BYTES})`
    )
    // Le serveur ne doit jamais refuser ce que le client vient de produire.
    assert.ok(
      L.MAX_PHOTO_SERVER_BYTES >= L.MAX_PHOTO_BYTES,
      'la borne serveur par photo doit accepter une photo compressée au budget client'
    )
    assert.equal(L.MAX_PHOTOS, blobStore.MAX_PHOTOS, 'le nombre de photos est le même des deux côtés')
  })

  it('blobStore borne les photos avec le module partagé (plus de recopie)', () => {
    assert.equal(blobStore.MAX_BYTES, L.MAX_PHOTO_SERVER_BYTES)
    assert.equal(blobStore.MAX_PHOTOS, L.MAX_PHOTOS)
    const src = readFileSync('server/blobStore.js', 'utf8')
    assert.match(src, /from '\.\.\/src\/limits\.js'/, 'blobStore importe les budgets partagés')
    assert.doesNotMatch(src, /MAX_BYTES = 2\.5 \* 1024 \* 1024/, 'plus de valeur recopiée à la main')
  })

  it('sous Vercel, le corps est borné SOUS la limite plateforme (4,5 Mo) — pas à 15 Mo', () => {
    // `MAX_BODY_BYTES` est évalué à l'import : la branche serverless se teste
    // dans un processus où `VERCEL` est posée (test-env.mjs l'épingle à ''
    // pour que la suite tourne en configuration locale).
    const dir = path.join(os.tmpdir(), `pcstar-a4-${process.pid}`)
    const script = [
      "const s = await import('./server/index.js')",
      "const l = await import('./src/limits.js')",
      'console.log(JSON.stringify({ max: s.MAX_BODY_BYTES, platform: l.VERCEL_MAX_BODY_BYTES, upload: l.MAX_UPLOAD_BODY_BYTES }))'
    ].join(';')
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          VERCEL: '1',
          DATABASE_URL: '',
          BLOB_READ_WRITE_TOKEN: '',
          PCSTAR_TEST_MODE: '1',
          PCSTAR_DATA_DIR: dir,
          MASTER_EMAIL: 'master@test.pcstar.local',
          MASTER_PASSWORD: 'test-master-pw'
        }
      }
    ).trim()
    const got = JSON.parse(out.split('\n').pop())
    assert.equal(got.max, got.upload, 'sous Vercel, la borne du corps = le budget d’envoi partagé')
    assert.equal(got.max, L.MAX_UPLOAD_BODY_BYTES, '4 Mo, pas les 15 Mo inaccessibles')
    assert.ok(got.max < got.platform, 'et strictement sous la limite plateforme')
    // En local (serveur dédié), la borne reste généreuse.
    assert.equal(server.MAX_BODY_BYTES, L.LOCAL_MAX_BODY_BYTES, 'hors serverless : 15 Mo')
  })

  it('le 413 annonce la borne réellement appliquée (et la limite plateforme sous Vercel)', async () => {
    // Corps refusé AVANT lecture complète → `BODY_TOO_LARGE` → 413 JSON.
    const err = await server
      .readBody(fakeReq([Buffer.alloc(server.MAX_BODY_BYTES + 1)]))
      .then(
        () => null,
        (e) => e
      )
    assert.ok(err, 'un corps au-delà de la borne doit être refusé')
    assert.equal(err.code, 'BODY_TOO_LARGE')
    const payload = server.bodyTooLargePayload()
    assert.equal(payload.ok, false)
    assert.equal(payload.error, 'too_large')
    assert.equal(payload.maxBytes, server.MAX_BODY_BYTES, 'la borne appliquée est dite au client')
    assert.equal(payload.platformLimit, null, 'hors serverless, aucune limite plateforme à annoncer')
  })

  it('api/index.js n’exporte plus la config Next.js inerte (10 mo qui ne relevait rien)', () => {
    const src = readFileSync('api/index.js', 'utf8')
    // Le commentaire explique ce qui a été retiré : il cite donc les mots. On
    // ne vérifie l'absence que d'un VRAI export / d'un vrai réglage.
    assert.doesNotMatch(src, /^\s*export const config/m, 'plus de `export const config`')
    assert.doesNotMatch(src, /^\s*(bodyParser|api)\s*:/m, 'plus de bloc `api: { bodyParser: … }`')
    assert.doesNotMatch(src, /sizeLimit\s*:/, 'plus de réglage sizeLimit (convention Next.js, ignorée par @vercel/node)')
    assert.doesNotMatch(src, /responseLimit\s*:/, 'plus de réglage responseLimit')
    // Le commentaire doit dire la VRAIE limite, et que l'application borne aussi.
    assert.match(src, /4,5 Mo/, 'la limite plateforme réelle est documentée')
    assert.match(src, /FUNCTION_PAYLOAD_TOO_LARGE/, "l'erreur plateforme est nommée")
    assert.match(src, /src\/limits\.js/, 'le module de budgets est indiqué comme source')
  })

  it('vercel.json ne prétend relever aucune limite de corps (rien ne serait appliqué)', () => {
    // `/api/(.*)` → `/api` : c'est `api/index.js`, une fonction Node en
    // zero-config (`@vercel/node`), PAS une route `pages/api/*` de Next.js —
    // d'où l'inertie du `config.api.bodyParser` retiré.
    const raw = readFileSync('vercel.json', 'utf8')
    const v = JSON.parse(raw)
    const apiRewrite = (v.rewrites || []).find((r) => r.source === '/api/(.*)')
    assert.ok(apiRewrite, 'la réécriture /api existe')
    assert.equal(apiRewrite.destination, '/api')
    assert.doesNotMatch(raw, /bodyParser|sizeLimit|responseLimit|maxBodySize/,
      'aucun réglage de taille de corps : Vercel ne les lit pas ici')
  })
})

/* ======================= A5 — compression par octets ====================== */

/** Canvas/Image stubbés dont `toDataURL` rend un payload de taille pilotée. */
function fakeEnv({ w = 1600, h = 1200, encode }) {
  const calls = { draw: [], toDataURL: [], canvas: [] }
  return {
    calls,
    env: {
      loadImage: () => Promise.resolve({ naturalWidth: w, naturalHeight: h }),
      createCanvas: (cw, ch) => {
        calls.canvas.push({ w: cw, h: ch })
        return {
          width: cw,
          height: ch,
          getContext: () => ({
            drawImage: (img, x, y, dw, dh) => calls.draw.push({ x, y, w: dw, h: dh })
          }),
          toDataURL: (type, quality) => {
            calls.toDataURL.push({ type, quality })
            return encode({ type, quality, w: cw, h: ch, call: calls.toDataURL.length })
          }
        }
      }
    }
  }
}

/** dataURL de `bytes` octets décodés (base64 → 4 caractères pour 3 octets). */
function dataUrlOfBytes(bytes, mime = 'image/png') {
  const chars = Math.ceil((bytes * 4) / 3)
  return `data:${mime};base64,${'A'.repeat(chars)}`
}

describe('8.5 (A5) — la compression tient un budget d’octets, pas seulement des pixels', () => {
  it('dataUrlBytes compte le poids DÉCODÉ (le base64 ne part pas tel quel sur le disque)', () => {
    assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3, '4 caractères base64 = 3 octets')
    assert.equal(dataUrlBytes(dataUrlOfBytes(999)), 999, 'un multiple de 3 est mesuré exactement')
    // 1000 o → 1334 caractères base64 → 1001 mesurés : majorant d'un octet,
    // assumé (une garde préfère surestimer que laisser passer).
    const measured = dataUrlBytes(dataUrlOfBytes(1000))
    assert.ok(measured >= 1000 && measured <= 1002, `majorant serré, obtenu ${measured}`)
    assert.equal(dataUrlBytes(''), 0, 'chaîne vide → 0')
    assert.equal(dataUrlBytes(null), 0, 'null → 0 (pas de NaN)')
    assert.equal(dataUrlBytes('/photos/sku/x-1.jpg'), 0, 'un chemin hébergé n’est pas un dataURL')
    // Majorant assumé : le rembourrage `=` est compté — pour une garde, mieux
    // vaut surestimer d'un octet que laisser passer un corps trop lourd.
    assert.ok(dataUrlBytes('data:image/png;base64,AA==') >= 1, 'le padding ne fait pas sous-estimer')
  })

  it('image ≤ maxDim mais TROP LOURDE → ré-encodée à dimensions constantes (le cœur de A5)', async () => {
    // Avant : `scale === 1` → return brut, aucun ré-encodage. Un PNG 800×800 de
    // 2 Mo partait tel quel (2,7 Mo de base64).
    const raw = dataUrlOfBytes(3000)
    const { calls, env } = fakeEnv({ w: 800, h: 800, encode: () => `data:image/jpeg;base64,${'B'.repeat(400)}` })
    const out = await compressDataUrl(raw, { maxBytes: 1000 }, env)
    assert.notEqual(out, raw, 'l’image lourde n’est plus renvoyée telle quelle')
    assert.equal(calls.toDataURL.length, 1, 'un seul ré-encodage suffisait ici')
    assert.deepEqual(calls.draw, [{ x: 0, y: 0, w: 800, h: 800 }], 'dimensions inchangées (déjà ≤ maxDim)')
    assert.ok(dataUrlBytes(out) <= 1000, 'le budget est tenu')
  })

  it('tant que le budget n’est pas tenu, la qualité baisse (0.8 → 0.7)', async () => {
    const { calls, env } = fakeEnv({
      w: 1600,
      h: 1200,
      encode: ({ call }) => `data:image/jpeg;base64,${'B'.repeat(call === 1 ? 4000 : 400)}`
    })
    const out = await compressDataUrl(dataUrlOfBytes(9000), { maxBytes: 1000 }, env)
    assert.deepEqual(
      calls.toDataURL.map((c) => c.quality),
      [0.8, 0.7],
      'premier essai à la qualité nominale, puis un pas de réduction'
    )
    assert.deepEqual(calls.draw, [
      { x: 0, y: 0, w: 800, h: 600 },
      { x: 0, y: 0, w: 800, h: 600 }
    ])
    assert.ok(dataUrlBytes(out) <= 1000, 'le résultat tient le budget')
  })

  it('la boucle est BORNÉE : planchers de qualité et de dimensions, jamais de boucle infinie', async () => {
    const { calls, env } = fakeEnv({ w: 4000, h: 3000, encode: () => `data:image/jpeg;base64,${'B'.repeat(40000)}` })
    const out = await compressDataUrl(dataUrlOfBytes(90000), { maxBytes: 1000 }, env)
    assert.ok(out.startsWith('data:image/jpeg'), 'un résultat est quand même rendu (upload possible)')
    assert.ok(
      calls.toDataURL.length <= L.COMPRESS_FLOOR.steps + 1,
      `au plus ${L.COMPRESS_FLOOR.steps + 1} encodages, obtenu ${calls.toDataURL.length}`
    )
    const last = calls.toDataURL[calls.toDataURL.length - 1]
    assert.equal(last.quality, L.COMPRESS_FLOOR.quality, 'la qualité ne descend pas sous le plancher')
    assert.ok(
      calls.toDataURL.every((c) => c.quality >= L.COMPRESS_FLOOR.quality),
      'aucun encodage sous le plancher de qualité'
    )
    const lastDraw = calls.draw[calls.draw.length - 1]
    assert.ok(lastDraw.w >= 1 && lastDraw.h >= 1, 'les dimensions restent ≥ 1 px')
    assert.ok(
      Math.max(lastDraw.w, lastDraw.h) <= COMPRESS_DEFAULTS.maxDim,
      'les dimensions ne remontent jamais au-dessus de la cible'
    )
  })

  it('jamais plus lourd que l’entrée à dimensions constantes (sinon l’original part)', async () => {
    // Cas réel : une toute petite image que le ré-encodage JPEG grossirait.
    const raw = `data:image/jpeg;base64,${'A'.repeat(100)}` // 75 o décodés
    const { calls, env } = fakeEnv({ w: 200, h: 200, encode: () => `data:image/jpeg;base64,${'B'.repeat(1000)}` })
    const out = await compressDataUrl(raw, { maxBytes: 10 }, env)
    assert.equal(out, raw, 'le ré-encodage plus lourd est écarté')
    // La boucle essaie jusqu'au plancher de qualité, puis s'arrête (200 px est
    // déjà sous le plancher de dimensions) — d'où 4 encodages, pas 1.
    assert.deepEqual(
      calls.toDataURL.map((c) => c.quality),
      [0.8, 0.7, 0.6, 0.5],
      'descente jusqu’au plancher, puis abandon'
    )
    assert.equal(calls.draw.length, 4, 'aucun redimensionnement au-delà (déjà sous le plancher)')
  })

  it('en revanche, une image REDIMENSIONNÉE est toujours rendue (la réduction compte aussi)', async () => {
    // 4000×3000 → 800×600 : même si le JPEG produit pèse plus que l'entrée
    // (entrée minuscule en octets, immense en pixels), rendre l'original
    // annulerait toute la réduction.
    const raw = `data:image/png;base64,${'A'.repeat(100)}`
    const { calls, env } = fakeEnv({ w: 4000, h: 3000, encode: () => `data:image/jpeg;base64,${'B'.repeat(1000)}` })
    const out = await compressDataUrl(raw, { maxBytes: 10 }, env)
    assert.notEqual(out, raw, 'le résultat redimensionné est conservé')
    assert.deepEqual(scaleToMaxDim(4000, 3000, 800), { w: 800, h: 600, scale: 0.2 })
    assert.equal(calls.draw[0].w, 800)
  })

  it('le budget par défaut est celui du module partagé (pas une valeur recopiée)', () => {
    assert.equal(COMPRESS_DEFAULTS.maxBytes, L.MAX_PHOTO_BYTES)
    assert.equal(L.COMPRESS_FLOOR.quality, 0.5)
    assert.equal(L.COMPRESS_FLOOR.maxDim, 320)
    const src = readFileSync('src/photoCompress.js', 'utf8')
    assert.match(src, /from '\.\/limits\.js'/, 'photoCompress importe les budgets partagés')
  })
})

/* ======================= A5 — garde d’envoi (total) ======================= */

describe('8.5 (A5) — le TOTAL est borné avant l’envoi', () => {
  it('payloadBytes compte les chaînes base64 (ce qui voyage), pas le poids décodé', () => {
    assert.equal(L.payloadBytes([]), 0)
    assert.equal(L.payloadBytes(null), 0, 'entrée absente → 0 (pas de crash)')
    assert.equal(L.payloadBytes(['data:image/jpeg;base64,AAAA']), 'data:image/jpeg;base64,AAAA'.length)
    assert.equal(
      L.payloadBytes([dataUrlOfBytes(300), dataUrlOfBytes(300)]),
      L.payloadBytes([dataUrlOfBytes(300)]) * 2,
      'le total est bien la somme'
    )
  })

  it('payloadOverBudget : 0 sous le budget, le poids réel au-delà', () => {
    const under = [dataUrlOfBytes(1000)]
    assert.equal(L.payloadOverBudget(under), 0, 'un corps léger passe')
    // Juste sous la borne : toujours 0.
    const edge = ['x'.repeat(L.MAX_UPLOAD_BODY_BYTES)]
    assert.equal(L.payloadOverBudget(edge), 0, 'à la borne exacte, ça passe encore')
    const over = ['x'.repeat(L.MAX_UPLOAD_BODY_BYTES + 1)]
    assert.equal(L.payloadOverBudget(over), L.MAX_UPLOAD_BODY_BYTES + 1, 'au-delà, le poids est rapporté')
  })

  it('six photos au plafond du budget par photo passent la garde (cohérence des deux gardes)', () => {
    const six = Array.from({ length: L.MAX_PHOTOS }, () => dataUrlOfBytes(L.MAX_PHOTO_BYTES, 'image/jpeg'))
    assert.equal(L.payloadOverBudget(six), 0, 'le pire cas nominal doit rester envoyable')
    // Une septième photo du même tonneau ferait sauter le plafond de photos —
    // c'est `MAX_PHOTOS` qui tranche, pas la garde d'octets.
    assert.equal(six.length, L.MAX_PHOTOS)
  })
})

/* =================== A5 — la garde dans l’interface maître ================= */

const HEAVY = 'data:image/jpeg;base64,' + 'A'.repeat(800_000) // ~800 Ko de chaîne
const heavyPhotos = Array.from({ length: 6 }, () => HEAVY)
const lightPhotos = ['data:image/jpeg;base64,' + 'B'.repeat(400)]

let fetchCalls = []
let stubProducts = []

function stubApiFetch() {
  fetchCalls = []
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase()
    const p = String(url).split('?')[0]
    fetchCalls.push({ method, path: p, body: opts.body })
    let body = {}
    if (method === 'GET' && p === '/api/master/products') body = { products: stubProducts }
    if (method === 'POST' && /\/photos$/.test(p)) body = { product: { photos: ['/photos/sku/x-1.jpg'] } }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: { get: () => null }
    }
  }
  window.fetch = globalThis.fetch
}

const masterProps = (over = {}) => ({
  t,
  lang: 'fr',
  user: { id: 'master-pcstar', role: 'master', name: 'PC Star Desk' },
  users: [],
  onUsers() {},
  products: [],
  masterCatalog: [],
  meta: {
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: [],
    productOverrides: {},
    stock: {}
  },
  onMeta() {},
  basePanels: [],
  setToast() {},
  onBack() {},
  apiOnline: true,
  onStockRefresh() {},
  ...over
})

/** Ouvre l'éditeur de photos du produit `id` et clique « Enregistrer ». */
async function savePhotosOf(m) {
  const opener = m.byText('button', t('masterEditPhotos'))
  assert.ok(opener, 'le bouton « Modifier les photos » doit exister')
  await act(async () => {
    opener.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle(60)
  const save = m.byText('button', t('masterSavePhotos'))
  assert.ok(save, 'le bouton d’enregistrement doit exister')
  await act(async () => {
    save.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle(120)
}

describe('8.5 (A5) — MasterPage refuse un corps trop lourd AVANT de l’envoyer', () => {
  it('photos surdimensionnées → aucun appel réseau, et un toast qui dit quoi faire', async () => {
    stubProducts = [{ id: 'p1', name: 'PC lourd', sku: 'PC-LOURD', price: 1000, stock: 1, category: 'pc', brand: 'PC Star', photos: heavyPhotos }]
    stubApiFetch()
    const toasts = []
    const m = await mount(React.createElement(MasterPage, masterProps({ setToast: (msg) => toasts.push(msg) })))

    await savePhotosOf(m)

    const posts = fetchCalls.filter((c) => c.method === 'POST')
    assert.equal(posts.length, 0, 'aucun envoi : la plateforme aurait répondu une page d’erreur, pas notre JSON')
    assert.equal(toasts.length, 1, 'un toast explique le refus')
    const expected = t('masterPhotosTooHeavy', {
      size: L.toMb(L.payloadBytes(heavyPhotos)),
      limit: L.toMb(L.MAX_UPLOAD_BODY_BYTES)
    })
    assert.equal(toasts[0], expected, 'le message cite le poids obtenu et la borne')
    assert.match(toasts[0], /4 Mo/, 'la borne annoncée est le budget d’envoi (4 Mo), pas 10 ni 15')
    await m.unmount()
  })

  it('photos légères → l’envoi part normalement (la garde ne bloque pas le cas légitime)', async () => {
    stubProducts = [{ id: 'p2', name: 'PC léger', sku: 'PC-LEGER', price: 900, stock: 2, category: 'pc', brand: 'PC Star', photos: lightPhotos }]
    stubApiFetch()
    const toasts = []
    const m = await mount(React.createElement(MasterPage, masterProps({ setToast: (msg) => toasts.push(msg) })))

    await savePhotosOf(m)

    const post = fetchCalls.find((c) => c.method === 'POST' && /\/photos$/.test(c.path))
    assert.ok(post, 'l’upload des photos doit partir')
    assert.equal(post.path, '/api/master/products/p2/photos')
    assert.deepEqual(toasts, [t('masterPhotosSaved')], 'le maître est informé du succès')
    await m.unmount()
  })

  it('les deux langues restantes portent aussi le message (pas de clé manquante)', () => {
    for (const lang of ['fr', 'en', 'ar']) {
      assert.ok(dict[lang].masterPhotosTooHeavy, `${lang}.masterPhotosTooHeavy manque`)
      assert.match(dict[lang].masterPhotosTooHeavy, /\{size\}|\{limit\}/, 'le message cite les tailles')
      assert.match(dict[lang].masterPhotoTooBig, /\{mb\}/, 'la limite par photo n’est plus écrite en dur')
      assert.doesNotMatch(dict[lang].masterPhotoTooBig, /2[.,]5/, 'plus de « 2,5 Mo » recopié à la main')
    }
  })
})

/* ------------------------------- utilitaires ------------------------------ */

/** Requête factice qui émet des morceaux de corps puis se termine. */
function fakeReq(chunks) {
  const handlers = {}
  return {
    headers: { 'content-length': String(chunks.reduce((n, c) => n + c.length, 0)) },
    // `readBody` draine le corps après refus (sinon le socket reste bloqué en
    // écriture côté client) — le stub doit donc exposer `resume`.
    resume() {},
    on(ev, fn) {
      handlers[ev] = fn
      if (ev === 'data') {
        setImmediate(() => {
          for (const c of chunks) handlers.data?.(c)
          handlers.end?.()
        })
      }
      return this
    }
  }
}
