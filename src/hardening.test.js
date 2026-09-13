import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// P16 — lot 4 : durcissement (#8, #12, #13, #14, #16, #18, #19, #20, #25) +
// les points faibles (csvEscape \r, money(), backup sur le vrai répertoire).
// Base temporaire isolée, posée AVANT l'import des modules serveur.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-hardening-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.FRONT_ORIGIN
delete process.env.VERCEL_URL

const { handler } = await import('../server/index.js')
const { readDbAsync } = await import('../server/db.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')
const { setOrderStatus, placeOrder, MAX_ORDERS, MAX_ORDERS_HARD } = await import('../server/catalog.js')
const { sanitizeProductPatch, ordersToCsv } = await import('../server/masterApi.js')
const { parseEnv, loadEnv } = await import('../server/env.js')
const { money } = await import('./data.js')

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

// Le rate-limit de login saute à ~20 essais par clé : on repart de zéro.
beforeEach(() => __rateLimitInternals.buckets.clear())

async function call(method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  // `res.headers` de fetch est un objet Headers : on le matérialise.
  return { status: res.status, data, headers: Object.fromEntries(res.headers) }
}

const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).data?.token

describe('P16 (#12) — chaque bucket garde sa propre fenêtre', () => {
  it('un balayage à 60 s ne supprime pas un bucket de 24 h', () => {
    const { buckets, sweepExpired } = __rateLimitInternals
    const now = Date.now()
    buckets.clear()
    buckets.set('login:x', { start: now - 120_000, count: 5, windowMs: 60_000 }) // expiré
    buckets.set('backup:y', { start: now - 120_000, count: 2, windowMs: 86_400_000 }) // encore valable
    sweepExpired(now, 60_000)
    assert.equal(buckets.has('login:x'), false, 'le bucket de 60 s aurait dû être purgé')
    assert.equal(buckets.has('backup:y'), true, 'le bucket de 24 h a été purgé par un appelant à 60 s')
    buckets.clear()
  })

  it('sans windowMs mémorisé, on retombe sur celui de l’appelant', () => {
    const { buckets, sweepExpired } = __rateLimitInternals
    const now = Date.now()
    buckets.clear()
    buckets.set('legacy', { start: now - 5_000, count: 1 }) // bucket d’avant le correctif
    sweepExpired(now, 1_000)
    assert.equal(buckets.has('legacy'), false)
    buckets.clear()
  })
})

describe('P16 (#8) — un compte de démo supprimé ne revient pas', () => {
  it('DELETE /api/customers/demo-karim puis relecture : toujours absent', async () => {
    const master = await login('pcstar.info31@gmail.com', 'star31')
    assert.ok(master, 'login master impossible')

    const del = await call('DELETE', '/api/customers/demo-karim', { token: master })
    assert.equal(del.status, 200, `suppression refusée : ${JSON.stringify(del.data)}`)

    // readDbAsync est LA fonction utilisée par toutes les routes : avant, elle
    // réinjectait les 3 démos à chaque lecture.
    const db = await readDbAsync()
    assert.equal(
      db.users.some((u) => u.id === 'demo-karim' || u.email === 'karim.oran@demo.dz'),
      false,
      'le compte de démo est revenu après suppression'
    )
    // Le master, lui, doit rester (sinon plus personne au comptoir).
    assert.ok(db.users.some((u) => u.role === 'master'), 'le master a disparu')
    assert.equal(db.meta.demoSeeded, true, 'le marqueur de seed n’a pas été posé')
  })
})

describe('P16 (#13) — changer de mot de passe exige le mot de passe actuel', () => {
  it('token seul → 403 ; avec le mot de passe actuel → 200', async () => {
    const token = await login('amina.castors@demo.dz', 'amina31')
    assert.ok(token, 'login cliente impossible')

    const blind = await call('POST', '/api/me/password', { body: { password: 'nouveau1' }, token })
    assert.equal(blind.status, 403, `un token seul a suffi : ${JSON.stringify(blind.data)}`)
    assert.equal(blind.data?.error, 'current_password')

    const wrong = await call('POST', '/api/me/password', { body: { password: 'nouveau1', current: 'paslebon' }, token })
    assert.equal(wrong.status, 403)

    const good = await call('POST', '/api/me/password', { body: { password: 'nouveau1', current: 'amina31' }, token })
    assert.equal(good.status, 200, `changement légitime refusé : ${JSON.stringify(good.data)}`)
    assert.ok(await login('amina.castors@demo.dz', 'nouveau1'), 'le nouveau mot de passe ne fonctionne pas')
  })
})

describe('P16 (#14) — reset master sans mot de passe devinable', () => {
  it('corps vide → 400 (plus de `client31` par défaut)', async () => {
    const master = await login('pcstar.info31@gmail.com', 'star31')
    const empty = await call('POST', '/api/master/customers/demo-yacine/reset-password', { body: {}, token: master })
    assert.equal(empty.status, 400, `un corps vide a été accepté : ${JSON.stringify(empty.data)}`)

    // Et l'ancien mot de passe doit toujours fonctionner.
    assert.ok(await login('yacine.pc@demo.dz', 'yacine31'), 'le mot de passe du client a changé tout seul')

    const ok = await call('POST', '/api/master/customers/demo-yacine/reset-password', { body: { password: 'tmp-2026' }, token: master })
    assert.equal(ok.status, 200)
    assert.ok(await login('yacine.pc@demo.dz', 'tmp-2026'), 'le reset explicite n’a pas pris')
  })
})

describe('P16 (#18) — un patch produit invalide est refusé, pas servi', () => {
  it('sanitizeProductPatch : prix, nom, catégorie, sku, photos', () => {
    assert.deepEqual(sanitizeProductPatch({ price: 'abc' }), { ok: false, error: 'price' })
    assert.deepEqual(sanitizeProductPatch({ price: -5 }), { ok: false, error: 'price' })
    assert.deepEqual(sanitizeProductPatch({ price: '4900' }), { ok: true, patch: { price: 4900 } })
    assert.deepEqual(sanitizeProductPatch({ name: 'x'.repeat(121) }), { ok: false, error: 'name_too_long' })
    assert.deepEqual(sanitizeProductPatch({ name: '  ' }), { ok: false, error: 'name' })
    assert.deepEqual(sanitizeProductPatch({ category: 'licorne' }), { ok: false, error: 'category' })
    assert.equal(sanitizeProductPatch({ category: 'cpu' }).ok, true)
    assert.deepEqual(sanitizeProductPatch({ photos: 'pas-un-tableau' }), { ok: false, error: 'photos' })
    assert.deepEqual(sanitizeProductPatch({ sku: 'a'.repeat(41) }), { ok: false, error: 'sku' })
  })

  it('PUT price:"abc" → 400 et le catalogue public ne sert jamais "abc"', async () => {
    const master = await login('pcstar.info31@gmail.com', 'star31')
    const bad = await call('PUT', '/api/master/products/cpu-7800x3d', { body: { price: 'abc' }, token: master })
    assert.equal(bad.status, 400, `prix invalide accepté : ${JSON.stringify(bad.data)}`)
    assert.equal(bad.data?.error, 'price')

    const cat = await call('GET', '/api/catalog')
    const cpu = cat.data.products.find((p) => p.id === 'cpu-7800x3d')
    assert.equal(typeof cpu.price, 'number', `prix non numérique servi : ${JSON.stringify(cpu.price)}`)
    assert.ok(Number.isFinite(cpu.price) && cpu.price > 0)

    const good = await call('PUT', '/api/master/products/cpu-7800x3d', { body: { price: '98500' }, token: master })
    assert.equal(good.status, 200)
    assert.equal(good.data.product.price, 98500)
  })
})

describe('P16 (#19) — transitions de statut gardées', () => {
  const db = () => ({ users: [], orders: [], stock: {}, meta: {} })

  it('picked ne revient ni en new ni en preparing', () => {
    const d = db()
    d.orders = [{ code: 'C1', status: 'picked', items: [] }]
    assert.deepEqual(setOrderStatus(d, 'C1', 'new'), { ok: false, error: 'transition', from: 'picked', to: 'new' })
    assert.equal(setOrderStatus(d, 'C1', 'preparing').ok, false)
  })

  it('cancelled ne ressuscite pas', () => {
    const d = db()
    d.orders = [{ code: 'C2', status: 'cancelled', items: [] }]
    assert.equal(setOrderStatus(d, 'C2', 'new').error, 'cancelled')
  })

  it('le flux normal passe : new → preparing → ready → picked', () => {
    const d = db()
    d.orders = [{ code: 'C3', status: 'new', items: [] }]
    for (const s of ['preparing', 'ready', 'picked']) {
      assert.equal(setOrderStatus(d, 'C3', s).ok, true, `transition vers ${s} refusée`)
    }
    assert.equal(d.orders[0].status, 'picked')
  })

  it('un statut inconnu est refusé', () => {
    const d = db()
    d.orders = [{ code: 'C4', status: 'new', items: [] }]
    assert.equal(setOrderStatus(d, 'C4', 'shipped').error, 'status')
  })
})

describe('P16 (#20) — la borne d’historique ne jette plus de commande active', () => {
  const line = { id: 'cpu-7800x3d', qty: 1, price: 1, name: 'CPU' }
  const mk = (n, statusAt = () => 'new') =>
    Array.from({ length: n }, (_, i) => ({
      code: `OLD-${i}`,
      status: statusAt(i),
      items: [line],
      day: '2026-09-13',
      name: 'Client',
      phone: '0550123456'
    }))
  const fresh = { users: [], orders: [], stock: {}, meta: {} }
  const add = (db) => placeOrder(db, { items: [{ id: 'cpu-7800x3d', qty: 1 }], name: 'Nouveau', phone: '0550123456' }, { userId: null })

  it('une seule commande terminée est retirée — jamais une active', () => {
    const db = fresh
    db.orders = mk(MAX_ORDERS, (i) => (i === 400 ? 'picked' : 'new'))
    const res = add(db)
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.equal(db.orders.length, MAX_ORDERS, 'la borne n’est pas respectée')
    assert.deepEqual(res.trimmed, ['OLD-400'], `retraits inattendus : ${res.trimmed}`)
    assert.equal(db.orders[0].name, 'Nouveau', 'la nouvelle commande n’est pas en tête')
    assert.ok(db.orders.every((o) => o.status !== 'picked'), 'une commande picked a survécu')
    assert.ok(db.orders.some((o) => o.code === 'OLD-0'), 'OLD-0 (active) a été jetée')
  })

  it('si rien n’est terminé, on ne perd rien : la borne molle est dépassée', () => {
    const db = fresh
    db.orders = mk(MAX_ORDERS)
    const res = add(db)
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.deepEqual(res.trimmed, [])
    assert.equal(db.orders.length, MAX_ORDERS + 1, 'une commande active a été jetée en silence')
  })

  it('au-delà du plafond dur, la commande est refusée au lieu d’écraser l’historique', () => {
    const db = fresh
    db.orders = mk(MAX_ORDERS_HARD)
    const res = add(db)
    assert.deepEqual(res, { ok: false, error: 'orders_full' }, JSON.stringify(res))
    assert.equal(db.orders.length, MAX_ORDERS_HARD, 'l’historique a été modifié par une commande refusée')
  })
})

describe('P16 (#25) — plus de CORS * par défaut', () => {
  it('sans FRONT_ORIGIN déclaré, aucun en-tête CORS n’est émis', async () => {
    const res = await call('GET', '/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers['access-control-allow-origin'], undefined, 'l’API répond encore en CORS *')
  })

  it('les autres en-têtes de sécurité restent présents', async () => {
    const res = await call('GET', '/api/health')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN')
  })

  it('un 429 porte l’en-tête Retry-After', async () => {
    // 21 logins ratés d’affilée : le bucket login est à 20/minute.
    let last = null
    for (let i = 0; i < 21; i += 1) {
      last = await call('POST', '/api/auth/login', { body: { email: 'nobody@x.dz', password: 'x' } })
    }
    assert.equal(last.status, 429, `attendu 429, reçu ${last.status}`)
    assert.ok(Number(last.headers['retry-after']) >= 1, `Retry-After absent : ${last.headers['retry-after']}`)
  })
})

describe('P16 (#16) — chargeur .env sans dépendance', () => {
  it('parse : commentaires, export, guillemets, lignes cassées', () => {
    const parsed = parseEnv(['# commentaire', 'FOO=bar', '  export BAZ="quoted value"  ', "QUX='single'", 'MALFORMED', '=novalue', 'NUM=42'].join('\n'))
    assert.deepEqual(parsed, { FOO: 'bar', BAZ: 'quoted value', QUX: 'single', NUM: '42' })
  })

  it('loadEnv ne touche pas une variable déjà présente', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-env-'))
    fs.writeFileSync(path.join(tmp, '.env'), 'PCSTAR_TEST_NEW=oui\nPCSTAR_TEST_SET=du-fichier\n')
    process.env.PCSTAR_TEST_SET = 'de-lenvironnement'
    try {
      const { loaded, applied } = loadEnv(tmp)
      assert.deepEqual(loaded, ['.env'])
      assert.deepEqual(applied, ['PCSTAR_TEST_NEW'])
      assert.equal(process.env.PCSTAR_TEST_NEW, 'oui')
      assert.equal(process.env.PCSTAR_TEST_SET, 'de-lenvironnement', 'le fichier a écrasé l’environnement')
    } finally {
      delete process.env.PCSTAR_TEST_NEW
      delete process.env.PCSTAR_TEST_SET
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('fichier absent → no-op (cas Vercel)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-env-empty-'))
    try {
      assert.deepEqual(loadEnv(tmp), { loaded: [], applied: [] })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('P16 — points faibles corrigés', () => {
  it('csvEscape : un \\r dans une cellule est encadré de guillemets', () => {
    const csv = ordersToCsv([{ code: 'C\r9', day: '2026-09-13', name: 'A\rB', phone: '0550123456', total: 100, items: [], status: 'new', wilaya: 'Oran' }])
    const lines = String(csv).split('\n')
    assert.ok(lines.length >= 2, 'CSV vide')
    // La ligne de données doit rester UNE seule ligne malgré les \r.
    const dataLine = lines.find((l) => l.includes('C'))
    assert.ok(dataLine.includes('"C\r9"'), `\\r non échappé : ${JSON.stringify(dataLine)}`)
    assert.ok(dataLine.includes('"A\rB"'), `\\r non échappé dans le nom : ${JSON.stringify(dataLine)}`)
  })

  it('money() : plus de « NaN DA »', () => {
    assert.match(money(97000), /^97[\s\u00a0\u202f]?000 DA$/, `format inattendu : ${money(97000)}`)
    assert.equal(money(undefined), '— DA')
    assert.equal(money('abc'), '— DA')
    assert.equal(money(NaN), '— DA')
  })

  it('store.json n’est plus versionné (les hashes ne sont plus dans git)', () => {
    const gi = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    assert.ok(!gi.includes('!server/data/store.json'), '.gitignore re-versionne encore store.json')
    assert.ok(gi.includes('server/data/'), 'le répertoire de données n’est plus ignoré')
  })
})
