import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// LOT 8.7 (A7) — l'écriture de la base est DURABLE, pas seulement atomique.
//
// Avant : `fs.writeFileSync(DB_TMP_FILE, …)` puis `fs.renameSync(DB_TMP_FILE,
// DB_FILE)`. Le couple tmp + rename (lot 3.2 / B2) garantit qu'un crash ne
// laisse jamais un `store.json` à moitié écrit, mais **aucun fsync** n'était
// appelé : après une coupure d'alimentation, le nom peut être publié alors que
// les blocs de données ne sont jamais arrivés au disque. Au remontage,
// `store.json` est vide ou tronqué → `quarantineCorrupt` l'isole, et la
// restauration repart du dernier backup : tout ce qui a été écrit depuis est
// **perdu** (commandes, stock, sessions).
//
// La durabilité ne se teste pas en débranchant la machine : elle se teste sur
// **l'ordre des appels** — un fsync après le rename ne garantit rien. D'où le
// `fs` injectable de `server/durableWrite.js`.
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-a7-'))
process.env.PCSTAR_DATA_DIR = dir

const { durableWriteFileSync, fsyncDirSync, atomicDurableWriteFileSync } = await import('../server/durableWrite.js')
const db = await import('../server/db.js')

/** `fs` factice qui journalise l'ordre des appels. */
function fakeFs(over = {}) {
  const log = []
  const base = {
    openSync: (f, mode) => {
      log.push(`open:${path.basename(f)}:${mode}`)
      return 7
    },
    writeSync: (fd, text) => {
      log.push(`write:${fd}:${text.length}`)
      return text.length
    },
    fsyncSync: (fd) => {
      log.push(`fsync:${fd}`)
    },
    closeSync: (fd) => {
      log.push(`close:${fd}`)
    },
    renameSync: (from, to) => {
      log.push(`rename:${path.basename(from)}→${path.basename(to)}`)
    },
    ...over
  }
  return { fs: base, log }
}

describe('8.7 (A7) — durableWriteFileSync : les octets au disque avant de publier le nom', () => {
  it('ordre réel : open → write → fsync → close (le fsync n’est pas décoratif)', () => {
    const { fs: f, log } = fakeFs()
    const synced = durableWriteFileSync('/x/store.json.tmp', '{"a":1}', { fs: f })
    assert.equal(synced, true, 'le fsync a bien eu lieu')
    assert.deepEqual(log, ['open:store.json.tmp:w', 'write:7:7', 'fsync:7', 'close:7'])
    assert.ok(log.indexOf('fsync:7') < log.indexOf('close:7'), 'fsync avant la fermeture du descripteur')
  })

  it('écrit réellement le contenu (fs réel, dans un répertoire temporaire)', () => {
    const file = path.join(dir, 'durable.txt')
    const synced = durableWriteFileSync(file, 'bonjour durable')
    assert.equal(synced, true, 'le FS du bac à sable accepte fsync')
    assert.equal(readFileSync(file, 'utf8'), 'bonjour durable')
  })

  it('un FS sans fsyncSync reste fonctionnel (repli dégradé, jamais de crash)', () => {
    const { fs: f, log } = fakeFs()
    delete f.fsyncSync
    const synced = durableWriteFileSync('/x/store.json.tmp', '{}', { fs: f })
    assert.equal(synced, false, 'rien n’a pu être forcé — c’est dit, pas deviné')
    assert.ok(log.includes('write:7:2'), 'l’écriture a quand même eu lieu')
  })

  it('le descripteur est fermé même si le fsync échoue (pas de fuite)', () => {
    const { fs: f, log } = fakeFs({
      fsyncSync() {
        const err = new Error('EIO')
        err.code = 'EIO'
        throw err
      }
    })
    assert.throws(() => durableWriteFileSync('/x/store.json.tmp', '{}', { fs: f }), /EIO/)
    assert.ok(log.includes('close:7'), 'close dans un `finally` : le descripteur ne fuit pas')
  })
})

describe('8.7 (A7) — fsyncDirSync : l’entrée de répertoire est durable, sans jamais bloquer', () => {
  it('réussit sur un répertoire ouvrable en lecture', () => {
    const { fs: f, log } = fakeFs()
    assert.equal(fsyncDirSync('/x/data', { fs: f }), true)
    assert.deepEqual(log, ['open:data:r', 'fsync:7', 'close:7'], 'ouvert en LECTURE, comme un répertoire')
  })

  it('échoue SILENCIEUSEMENT là où le FS ne le permet pas (Windows, FS réseau)', () => {
    const { fs: f } = fakeFs({
      openSync() {
        const err = new Error('EISDIR: illegal operation on a directory')
        err.code = 'EISDIR'
        throw err
      }
    })
    assert.equal(fsyncDirSync('/x/data', { fs: f }), false, 'renvoie false au lieu de lever')
  })

  it('fsync de répertoire refusé (EINVAL) → false, pas d’exception', () => {
    const { fs: f } = fakeFs({
      fsyncSync() {
        const err = new Error('EINVAL: invalid argument')
        err.code = 'EINVAL'
        throw err
      }
    })
    assert.equal(fsyncDirSync('/x/data', { fs: f }), false)
  })
})

describe('8.7 (A7) — atomicDurableWriteFileSync : fsync AVANT rename', () => {
  it('l’ordre est celui qui garantit la durabilité', () => {
    const { fs: f, log } = fakeFs()
    const out = atomicDurableWriteFileSync('/x/data/store.json', '{"users":[]}', {
      tmp: '/x/data/store.json.tmp',
      fs: f
    })
    assert.deepEqual(out, { synced: true, dirSynced: true })
    assert.deepEqual(log, [
      'open:store.json.tmp:w',
      'write:7:12',
      'fsync:7', // ← données au disque
      'close:7',
      'rename:store.json.tmp→store.json', // ← publication du nom
      'open:data:r',
      'fsync:7', // ← entrée de répertoire durable
      'close:7'
    ])
    const fsyncAvant = log.indexOf('fsync:7')
    const rename = log.indexOf('rename:store.json.tmp→store.json')
    assert.ok(fsyncAvant < rename, 'un fsync APRÈS le rename ne garantirait rien')
  })

  it('le tmp par défaut est `<file>.tmp`', () => {
    const { fs: f, log } = fakeFs()
    atomicDurableWriteFileSync('/x/data/store.json', '{}', { fs: f })
    assert.ok(log[0] === 'open:store.json.tmp:w', `tmp implicite, obtenu ${log[0]}`)
  })

  it('coupure simulée entre écriture et rename : la cible garde son contenu précédent', () => {
    // Le scénario A7 : si le rename n'a pas lieu (panique, coupure), le fichier
    // publié ne doit JAMAIS être vide ou tronqué.
    const target = path.join(dir, 'store.json')
    fs.writeFileSync(target, '{"orders":["avant"]}')
    const { fs: f } = fakeFs({
      renameSync() {
        const err = new Error('coupure simulée avant publication')
        err.code = 'EIO'
        throw err
      }
    })
    assert.throws(
      () => atomicDurableWriteFileSync(target, '{"orders":["apres"]}', { tmp: `${target}.tmp`, fs: f }),
      /coupure simulée/
    )
    assert.equal(readFileSync(target, 'utf8'), '{"orders":["avant"]}', 'la cible n’a pas été touchée')
  })

  it('même scénario sur FS réel : le contenu précédent survit', () => {
    const target = path.join(dir, 'reel.json')
    fs.writeFileSync(target, '{"v":1}')
    assert.throws(() => {
      // Rendre le rename impossible en verrouillant le tmp… plus simple : on
      // passe un tmp dans un répertoire inexistant → rename EBADF/ENOENT.
      atomicDurableWriteFileSync(target, '{"v":2}', { tmp: path.join(dir, 'absent', 'x.tmp') })
    })
    assert.equal(readFileSync(target, 'utf8'), '{"v":1}', 'aucune écriture partielle publiée')
  })
})

describe('8.7 (A7) — la base passe bien par le chemin durable', () => {
  it('writeDb() écrit un store.json valide, sans .tmp résiduel', () => {
    const data = db.readDb()
    data.orders.push({ code: 'PS-A7-0001', status: 'new' })
    db.writeDb(data)
    const onDisk = path.join(dir, 'store.json')
    assert.equal(fs.existsSync(path.join(dir, 'store.json.tmp')), false, 'pas de tmp résiduel')
    const parsed = JSON.parse(readFileSync(onDisk, 'utf8'))
    assert.ok(parsed.orders.some((o) => o.code === 'PS-A7-0001'), 'la commande est bien au disque')
    assert.equal(db.readDb().orders.length, parsed.orders.length, 'mémoire et disque concordent')
  })

  it('db.js ne fait plus de writeFileSync + renameSync à la main', () => {
    const src = readFileSync('server/db.js', 'utf8')
    assert.doesNotMatch(src, /fs\.writeFileSync\(DB_TMP_FILE/, 'plus d’écriture directe du tmp')
    assert.doesNotMatch(src, /fs\.renameSync\(DB_TMP_FILE/, 'plus de rename direct')
    assert.match(src, /atomicDurableWriteFileSync\(DB_FILE/, 'writeDb passe par le chemin durable')
    assert.match(src, /durableWriteFileSync\(DB_FILE/, 'la création initiale aussi')
    assert.match(src, /from '\.\/durableWrite\.js'/, 'le module est importé')
  })

  it('le module documente la contrepartie (coût) et le caractère non bloquant du fsync de répertoire', () => {
    const src = readFileSync('server/durableWrite.js', 'utf8')
    assert.match(src, /Contrepartie assumée/, 'le coût est écrit, pas passé sous silence')
    assert.match(src, /non bloquant/i, 'le fsync de répertoire est annoncé comme non bloquant')
    assert.match(src, /fsync/, 'le mécanisme est nommé')
  })
})
