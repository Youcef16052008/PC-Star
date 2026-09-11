import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Répertoire temporaire isolé — ne touche JAMAIS server/data/store.json (base de dev).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-dbtest-'))
process.env.PCSTAR_DATA_DIR = dir
const dbFile = path.join(dir, 'store.json')

const db = await import('../server/db.js')

describe('intégrité de la base (B1)', () => {
  it('writeDb: écriture atomique (pas de .tmp résiduel) + roundtrip', () => {
    const data = db.readDb()
    data.orders.push({ code: 'PS-TEST-0001', status: 'new' })
    db.writeDb(data)
    assert.equal(fs.existsSync(path.join(dir, 'store.json.tmp')), false)
    const back = db.readDb()
    assert.equal(back.orders.length, 1)
    assert.equal(back.orders[0].code, 'PS-TEST-0001')
  })

  it('fichier corrompu (JSON tronqué) → base neuve + fichier quarantainé, pas écrasé', () => {
    fs.writeFileSync(dbFile, '{"users": [ tronqu')
    const data = db.readDb()
    assert.ok(Array.isArray(data.users))
    assert.ok(data.users.some((u) => u.role === 'master'))
    assert.equal(data.orders.length, 0)
    const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith('store.json.corrupt-'))
    assert.equal(quarantined.length, 1)
    assert.match(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), /tronqu/)
  })

  it('fichier vide → base neuve + quarantaine', () => {
    fs.writeFileSync(dbFile, '')
    const data = db.readDb()
    assert.ok(data.users.some((u) => u.role === 'master'))
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('store.json.corrupt-')).length, 2)
  })

  it('la quarantaine garde au plus 3 anciens fichiers', () => {
    for (let i = 0; i < 4; i += 1) {
      fs.writeFileSync(dbFile, 'xxx')
      db.readDb()
    }
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('store.json.corrupt-')).length, 3)
  })

  it('base valide : aucune quarantaine supplémentaire', () => {
    const before = fs.readdirSync(dir).filter((f) => f.startsWith('store.json.corrupt-')).length
    db.readDb()
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('store.json.corrupt-')).length, before)
  })
})

// P5 (B11) : bornes de croissance — la base ne gonfle plus à l'infini.
describe('purge des entrées expirées (B11)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const MIN = 60 * 1000

  it('sessions > 7 j purgées, récentes conservées, entrées malformées supprimées', () => {
    const now = Date.now()
    const d = {
      sessions: {
        old: { userId: 'u1', at: now - 8 * DAY },
        fresh: { userId: 'u2', at: now - 1 * DAY },
        brokenAt: { userId: 'u3', at: 'hier' },
        nullEntry: null
      },
      oauthPending: {
        s1: { createdAt: now - 2 * DAY },
        s2: { createdAt: now - 20 * MIN },
        s3: { createdAt: now - 2 * MIN },
        broken: { createdAt: undefined }
      }
    }
    assert.equal(db.purgeExpired(d), true)
    assert.deepEqual(Object.keys(d.sessions), ['fresh'])
    assert.deepEqual(Object.keys(d.oauthPending), ['s3'])
    // idempotent : 2e passe → plus aucun changement
    assert.equal(db.purgeExpired(d), false)
  })

  it('readDb purge une base sur le disque et persiste le résultat', () => {
    const now = Date.now()
    fs.writeFileSync(
      dbFile,
      JSON.stringify({
        users: db.readDb().users,
        orders: [],
        stock: {},
        meta: {},
        sessions: { old: { userId: 'u1', at: now - 8 * DAY }, fresh: { userId: 'u2', at: now } },
        oauthPending: { old: { createdAt: now - 16 * MIN } }
      })
    )
    const d = db.readDb()
    assert.deepEqual(Object.keys(d.sessions), ['fresh'])
    assert.deepEqual(Object.keys(d.oauthPending), [])
    // persisté : le prochain readDb (sans purge) voit la même chose
    assert.deepEqual(Object.keys(db.readDb().sessions), ['fresh'])
  })
})
