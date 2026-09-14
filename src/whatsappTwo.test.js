import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// P20 — Le second numéro du magasin (06…) doit être traité comme le premier :
//   • deux boutons WhatsApp sur la page « À propos » ;
//   • une commande notifie les DEUX numéros, donc le maître reçoit trois
//     alertes : une dans le navigateur (Desk) + deux WhatsApp.
//
// Les numéros viennent d'une source unique (`src/data.js`) partagée par le front
// (boutons) et le serveur (envois) : ajouter un troisième numéro ne demande
// qu'une ligne dans STORE_WHATSAPP.

const { STORE, STORE_WHATSAPP, STORE_LINKS } = await import('./data.js')
const { waNumber } = await import('./orderLogic.js')
const { whatsappConfig, whatsappRecipients, sendWhatsApp } = await import('../server/notify.js')

describe('P20 — les deux numéros du magasin', () => {
  it('STORE expose le second numéro, cohérent avec phone2', () => {
    assert.equal(STORE.whatsapp, '213770650387')
    assert.equal(STORE.whatsapp2, '213669174617')
    // Le numéro WhatsApp doit être la forme internationale du numéro affiché.
    assert.equal(waNumber(STORE.phone), STORE.whatsapp, 'whatsapp ≠ phone')
    assert.equal(waNumber(STORE.phone2), STORE.whatsapp2, 'whatsapp2 ≠ phone2')
  })

  it('STORE_WHATSAPP liste les deux, au format exigé par wa.me', () => {
    assert.equal(STORE_WHATSAPP.length, 2, `attendu 2 numéros, reçu ${STORE_WHATSAPP.length}`)
    for (const n of STORE_WHATSAPP) {
      assert.match(n.number, /^\d{8,15}$/, `numéro invalide : ${n.number}`)
      assert.ok(!n.number.startsWith('0'), `wa.me refuse un 0 initial : ${n.number}`)
      assert.ok(n.label, 'chaque numéro doit avoir un libellé affichable')
    }
    assert.deepEqual(
      STORE_WHATSAPP.map((n) => n.number),
      ['213770650387', '213669174617']
    )
  })

  it('STORE_LINKS propose deux boutons WhatsApp distincts', () => {
    const wa = STORE_LINKS.filter((l) => l.id.startsWith('whatsapp'))
    assert.equal(wa.length, 2, `attendu 2 boutons, reçu ${wa.length}`)
    const hrefs = wa.map((l) => l.href)
    assert.deepEqual(hrefs, ['https://wa.me/213770650387', 'https://wa.me/213669174617'])
    // Les deux doivent être distinguables à l'œil (le sous-titre affiche le numéro).
    assert.notEqual(wa[0].sub, wa[1].sub, 'les deux boutons sont indiscernables')
    assert.ok(wa[0].sub.includes('0770'), `sous-titre 1 inattendu : ${wa[0].sub}`)
    assert.ok(wa[1].sub.includes('0669'), `sous-titre 2 inattendu : ${wa[1].sub}`)
    // Les id servent de classe CSS (`social-${id}`) : ils doivent être uniques.
    assert.equal(new Set(STORE_LINKS.map((l) => l.id)).size, STORE_LINKS.length, 'id dupliqué dans STORE_LINKS')
  })
})

describe('P20 — whatsappRecipients', () => {
  it('sans variable, les DEUX numéros du magasin sont destinataires', () => {
    assert.deepEqual(whatsappRecipients({}), ['213770650387', '213669174617'])
  })

  it('un numéro unique écrit avec des espaces reste un seul numéro', () => {
    // Régression réelle : un premier découpage sur les espaces transformait
    // « 213 550 123 456 » en quatre jetons de 3 chiffres, tous rejetés.
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: ' 213 550 123 456 ' }), ['213550123456'])
  })

  it('plusieurs numéros : virgule, point-virgule ou espace', () => {
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '213770650387,213669174617' }), ['213770650387', '213669174617'])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '213770650387;213669174617' }), ['213770650387', '213669174617'])
    assert.deepEqual(whatsappRecipients({ WHATSAPP_RECIPIENT: '213770650387 213669174617' }), ['213770650387', '213669174617'])
  })

  it('doublons et résidus de saisie sont écartés', () => {
    assert.deepEqual(
      whatsappRecipients({ WHATSAPP_RECIPIENT: ' 213770650387 ; 213669174617, 213770650387, abc , 12 ' }),
      ['213770650387', '213669174617']
    )
  })

  it('whatsappConfig expose recipients ET recipient (premier numéro)', () => {
    const cfg = whatsappConfig({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' })
    assert.deepEqual(cfg.recipients, ['213770650387', '213669174617'])
    assert.equal(cfg.recipient, '213770650387', 'recipient doit rester le premier numéro')
    assert.equal(cfg.enabled, true)
  })
})

describe('P20 — sendWhatsApp notifie les deux numéros', () => {
  it('deux envois réels, un par numéro, avec le bon payload', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }
    }
    const env = { WHATSAPP_TOKEN: 'EAAtok', WHATSAPP_PHONE_NUMBER_ID: '109876543210' }
    const r = await sendWhatsApp('Nouvelle commande PS-1', { env, fetchImpl })

    assert.equal(r.ok, true, `envoi échoué : ${JSON.stringify(r)}`)
    assert.equal(r.sent, 2)
    assert.equal(r.total, 2)
    assert.equal(calls.length, 2, `attendu 2 appels HTTP, reçu ${calls.length}`)
    assert.deepEqual(
      calls.map((c) => c.body.to),
      ['213770650387', '213669174617'],
      'les deux numéros doivent être servis'
    )
    for (const c of calls) {
      assert.equal(c.url, 'https://graph.facebook.com/v21.0/109876543210/messages')
      assert.equal(c.body.messaging_product, 'whatsapp')
      assert.equal(c.body.text.body, 'Nouvelle commande PS-1')
    }
  })

  it('un numéro en échec n’empêche pas l’autre de recevoir le message', async () => {
    const served = []
    const fetchImpl = async (_url, opts) => {
      const to = JSON.parse(opts.body).to
      if (to === '213770650387') return { ok: false, status: 400, json: async () => ({ error: { message: 'numéro non inscrit' } }) }
      served.push(to)
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const env = { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123' }
    const r = await sendWhatsApp('texte', { env, fetchImpl })

    assert.deepEqual(served, ['213669174617'], 'le second numéro doit être servi malgré l’échec du premier')
    assert.equal(r.ok, false, 'un échec partiel doit être signalé')
    assert.equal(r.sent, 1)
    assert.equal(r.total, 2)
    assert.match(String(r.error), /^http_400/, `erreur attendue, reçu ${r.error}`)
  })

  it('non configuré : toujours ignoré silencieusement (jamais bloquant)', async () => {
    const r = await sendWhatsApp('texte', { env: {} })
    assert.deepEqual(r, { ok: false, skipped: true, error: 'not_configured' })
  })

  it('une liste de destinataires vide est refusée sans appel réseau', async () => {
    let called = 0
    const fetchImpl = async () => {
      called += 1
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const r = await sendWhatsApp('texte', {
      env: { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_RECIPIENT: 'abc, 12' },
      fetchImpl
    })
    assert.equal(called, 0, 'aucun appel ne doit partir vers un numéro invalide')
    assert.deepEqual(r, { ok: false, skipped: true, error: 'no_recipient' })
  })

  it('un seul numéro forcé par variable ne notifie que celui-là', async () => {
    const tos = []
    const fetchImpl = async (_url, opts) => {
      tos.push(JSON.parse(opts.body).to)
      return { ok: true, status: 200, json: async () => ({}) }
    }
    await sendWhatsApp('texte', {
      env: { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_RECIPIENT: '213555000111' },
      fetchImpl
    })
    assert.deepEqual(tos, ['213555000111'])
  })
})

describe('P20 — trois alertes pour une commande', () => {
  it('le front a bien un canal navigateur en plus des deux WhatsApp', async () => {
    // Le compte « 3 alertes » = 1 notification navigateur + 2 WhatsApp.
    // On vérifie ici que les deux briques existent et sont câbrées : le module
    // de notification navigateur, et les deux destinataires côté serveur.
    const notify = await import('./notify.js')
    assert.equal(typeof notify.notifyNewOrder, 'function', 'notifyNewOrder manquant (canal navigateur)')
    assert.equal(typeof notify.requestNotificationPermission, 'function')
    assert.equal(whatsappRecipients({}).length, 2, 'canal WhatsApp : 2 numéros attendus')
  })
})
