import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// ---------------------------------------------------------------------------
// LOT 8.6 (A6) — destinataires WhatsApp jamais normalisés.
//
// L'API Cloud de Meta exige l'international sans « + » (`213770650387`).
// `whatsappRecipients()` se contentait d'un `replace(/\D/g, '')` : un numéro
// saisi au format local algérien (`0770650387` — celui que le site affiche
// partout, et que docs/DEPLOY-VERCEL.md donnait en exemple) partait tel quel et
// était refusé par Meta. Conséquence : AUCUNE alerte de commande, en silence,
// jusqu'à ce que le maître ouvre les logs.
//
// Vérifié à l'audit :
//   whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387' }) → ['0770650387']   ✗
//   waNumber('0770650387')                                 → '213770650387'   ✓
// (`waNumber` existait déjà dans le dépôt, pour les liens wa.me — P14.)
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot8-wa-'))
process.env.PCSTAR_DATA_DIR = dir

const { whatsappRecipients, whatsappRecipientIssues, whatsappConfig, sendWhatsApp, formatOrderMessage } =
  await import('../server/notify.js')
const { waNumber } = await import('./orderLogic.js')
const { STORE, STORE_WHATSAPP } = await import('./data.js')

after(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Capture les appels Meta au lieu de les envoyer. */
function fakeMeta(behavior = { ok: true, status: 200 }) {
  const calls = []
  const fetchImpl = async (url, opts = {}) => {
    let body = null
    try {
      body = JSON.parse(opts.body || 'null')
    } catch {
      body = null
    }
    calls.push({ url: String(url), body })
    return { ok: behavior.ok, status: behavior.status, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }
  }
  return { calls, fetchImpl }
}

const TOKENS = { WHATSAPP_TOKEN: 'EAAG-test', WHATSAPP_PHONE_NUMBER_ID: '109876543210' }

/* ------------------------------------------------------- normalisation */

describe('LOT 8.6 (A6) — le format local algérien est normalisé pour Meta', () => {
  it('reproduction de l’audit : `0770650387` → `213770650387`', () => {
    // AVANT le correctif : ['0770650387'] — refusé par Meta.
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387' }), ['213770650387'])
    // Le numéro affiché sur le site (STORE.phone, format local espacé) aussi.
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: STORE.phone }), [waNumber('0770650387')])
  })

  it('toutes les écritures algériennes convergent vers le même destinataire', () => {
    const shapes = ['0770650387', '770650387', '213770650387', '+213770650387', '00213770650387', '+213 770 65 03 87', '0770-65-03-87']
    for (const raw of shapes) {
      assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: raw }), ['213770650387'], `écriture : ${raw}`)
    }
  })

  it('plusieurs destinataires au format local (le second cas de l’audit)', () => {
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387 0669174617' }), [
      '213770650387',
      '213669174617'
    ])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387,0669174617' }), [
      '213770650387',
      '213669174617'
    ])
  })

  it('le même numéro écrit sous deux formes ne part qu’une fois', () => {
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387,213770650387,+213 770 65 03 87' }), [
      '213770650387'
    ])
  })

  it('un destinataire étranger déjà international est conservé (pas de repli forcé sur l’Algérie)', () => {
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '+33612345678' }), ['33612345678'])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0033612345678' }), ['33612345678'])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387,+33612345678' }), [
      '213770650387',
      '33612345678'
    ])
  })

  it('défaut inchangé : les DEUX numéros du magasin (P20), déjà internationaux', () => {
    const got = whatsappRecipients({})
    assert.deepEqual(got, ['213770650387', '213669174617'])
    assert.deepEqual(got, STORE_WHATSAPP.map((n) => n.number), 'source unique STORE_WHATSAPP')
    // La normalisation est idempotente sur un numéro déjà au bon format.
    for (const n of got) assert.equal(waNumber(n), n)
  })
})

/* --------------------------------------------------- entrées invalides */

describe('LOT 8.6 (A6) — une entrée non normalisable est écartée ET signalée', () => {
  it('numéro trop court / commençant par 0 après le préfixe 00 → écarté', () => {
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '12' }), [])
    assert.deepEqual(whatsappRecipientIssues({ WHATSAPP_RECIPIENT: '12' }), [{ raw: '12', digits: '12' }])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '0123456789' }), [])
    assert.equal(whatsappRecipientIssues({ WHATSAPP_RECIPIENT: '0123456789' }).length, 1)
  })

  it('une entrée valide à côté d’une invalide : la valide part, l’invalide est nommée', () => {
    const cfg = whatsappConfig({ ...TOKENS, WHATSAPP_RECIPIENT: '12,0770650387' })
    assert.deepEqual(cfg.recipients, ['213770650387'])
    assert.deepEqual(cfg.invalidRecipients, [{ raw: '12', digits: '12' }])
    assert.equal(cfg.enabled, true)
  })

  it('du bruit sans chiffres n’est pas signalé comme numéro invalide', () => {
    const cfg = whatsappConfig({ ...TOKENS, WHATSAPP_RECIPIENT: ' 213770650387 ; abc , , 213669174617 ' })
    assert.deepEqual(cfg.recipients, ['213770650387', '213669174617'])
    assert.deepEqual(cfg.invalidRecipients, [], 'un mot résiduel n’est pas une faute de numéro')
  })

  it('toutes les entrées invalides → 0 destinataire, et l’envoi est ignoré (pas d’appel Meta)', async () => {
    const cfg = whatsappConfig({ ...TOKENS, WHATSAPP_RECIPIENT: '12' })
    assert.deepEqual(cfg.recipients, [])
    assert.equal(cfg.invalidRecipients.length, 1)
    const { calls, fetchImpl } = fakeMeta()
    const r = await sendWhatsApp('test', { env: { ...TOKENS, WHATSAPP_RECIPIENT: '12' }, fetchImpl })
    assert.equal(r.skipped, true)
    assert.equal(r.error, 'no_recipient')
    assert.equal(calls.length, 0, 'aucun appel vers Meta')
  })
})

/* ------------------------------------------------- payload réellement envoyé */

describe('LOT 8.6 (A6) — le champ `to` envoyé à Meta est au format international', () => {
  const order = {
    code: 'PS-20260916-0009',
    name: 'Karim B.',
    phone: '0550123456',
    wilaya: 'Oran',
    total: 7500,
    items: [{ id: 'mousepad', sku: 'G640', name: 'Tapis G640', qty: 1, price: 7500 }]
  }

  it('WHATSAPP_RECIPIENT au format local → `to` normalisé (le cœur du bug)', async () => {
    const { calls, fetchImpl } = fakeMeta()
    const env = { ...TOKENS, WHATSAPP_RECIPIENT: '0770650387' }
    const r = await sendWhatsApp(formatOrderMessage(order), { env, fetchImpl })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.sent, 1)
    assert.equal(calls.length, 1)
    // AVANT le correctif : to === '0770650387' → Meta répond une erreur
    // `invalid recipient` et l'alerte est perdue.
    assert.equal(calls[0].body.to, '213770650387')
    assert.equal(calls[0].body.messaging_product, 'whatsapp')
    assert.match(calls[0].url, /\/109876543210\/messages$/)
  })

  it('les deux numéros du magasin au format local → deux envois, deux `to` normalisés', async () => {
    const { calls, fetchImpl } = fakeMeta()
    const env = { ...TOKENS, WHATSAPP_RECIPIENT: '0770650387;0669174617' }
    const r = await sendWhatsApp(formatOrderMessage(order), { env, fetchImpl })
    assert.equal(r.sent, 2, JSON.stringify(r))
    assert.equal(r.total, 2)
    assert.deepEqual(calls.map((c) => c.body.to), ['213770650387', '213669174617'])
  })

  it('défaut (aucune variable) → les deux numéros de STORE_WHATSAPP, inchangés', async () => {
    const { calls, fetchImpl } = fakeMeta()
    const r = await sendWhatsApp(formatOrderMessage(order), { env: { ...TOKENS }, fetchImpl })
    assert.equal(r.sent, 2)
    assert.deepEqual(calls.map((c) => c.body.to), STORE_WHATSAPP.map((n) => n.number))
  })

  it('un échec Meta reste non bloquant et remonte le premier échec (P20)', async () => {
    const { calls, fetchImpl } = fakeMeta({ ok: false, status: 400 })
    const r = await sendWhatsApp(formatOrderMessage(order), { env: { ...TOKENS, WHATSAPP_RECIPIENT: '0770650387' }, fetchImpl })
    assert.equal(r.ok, false)
    assert.equal(r.sent, 0)
    assert.match(String(r.error), /^http_400/)
    assert.equal(calls[0].body.to, '213770650387', 'le numéro envoyé était bien normalisé')
  })
})

/* ------------------------------------------- visibilité de la configuration */

describe('LOT 8.6 (A6) — une mauvaise configuration se voit sans attendre une commande', () => {
  let server
  let base

  before(async () => {
    const { handler } = await import('../server/index.js')
    server = http.createServer(handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(
    () =>
      new Promise((resolve) => {
        server.close(resolve)
      })
  )

  it('GET /api/health expose l’état du canal en COMPTEURS (route publique)', async () => {
    const res = await fetch(`${base}/api/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.whatsapp, 'bloc whatsapp présent')
    assert.deepEqual(Object.keys(body.whatsapp).sort(), ['configured', 'invalid', 'recipients'])
    assert.equal(typeof body.whatsapp.recipients, 'number')
    assert.equal(typeof body.whatsapp.invalid, 'number')
    assert.equal(typeof body.whatsapp.configured, 'boolean')
    // Aucun numéro divulgué : la route est publique et WHATSAPP_RECIPIENT peut
    // être un numéro privé (celui du magasin, lui, est déjà sur le site).
    const raw = JSON.stringify(body)
    for (const n of STORE_WHATSAPP.map((x) => x.number)) assert.ok(!raw.includes(n), `${n} ne doit pas fuir`)
    assert.equal(body.whatsapp.recipients, 2, 'les deux numéros par défaut sont comptés')
    assert.equal(body.whatsapp.invalid, 0)
  })

  it('le démarrage journalise les entrées écartées et l’absence de destinataire', () => {
    // `startLocalServer` n'est pas exporté (il ouvre un port et un socket) : on
    // vérifie à la source que les deux alertes existent bien dans le callback
    // d'écoute, et qu'elles portent sur ce qu'elles annoncent.
    const src = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
    const listenBlock = src.slice(src.indexOf('server.listen(PORT'))
    assert.ok(listenBlock.includes('invalidRecipients.length'), 'les entrées écartées sont journalisées au démarrage')
    assert.ok(/console\.warn\([\s\S]{0,400}WHATSAPP_RECIPIENT/.test(listenBlock), 'warn nommé sur WHATSAPP_RECIPIENT')
    assert.ok(
      /wa\.enabled && !wa\.recipients\.length/.test(listenBlock) && /console\.error\(/.test(listenBlock),
      'configuré sans destinataire valide → erreur au démarrage'
    )
  })

  it('docs/DEPLOY-VERCEL.md documente le format attendu et la normalisation', () => {
    const doc = fs.readFileSync(new URL('../docs/DEPLOY-VERCEL.md', import.meta.url), 'utf8')
    assert.ok(doc.includes('LOT 8.6 (A6)'), 'section dédiée présente')
    assert.ok(doc.includes('0770650387') && doc.includes('213770650387'), 'les deux formats sont montrés')
    assert.ok(doc.includes('whatsapp.invalid') || doc.includes('"invalid"'), 'le signalement health est documenté')
    // La phrase qui induisait la faute (« le numéro affiché sur le site est
    // utilisé » — le site affiche le format local) a été remplacée.
    assert.ok(!doc.includes('sinon le numéro affiché sur le site est utilisé'), 'formulation ambiguë retirée')
  })
})
