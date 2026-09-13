import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// P18 — écriture hors répertoire d'uploads.
//
// Reproduit en direct avant correctif :
//   PUT /api/master/products/..%2F..%2Fpwnt   →  HTTP 404
//   mais public/pwnt-<ts>-1.png était bien créé, HORS de public/photos/uploads,
//   donc servi publiquement. `deleteBlob` gardait déjà `..` et `/` ;
//   l'écriture (`uploadBlob`) non.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-upload-sec-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const { handler } = await import('../server/index.js')
const { safeUploadName } = await import('../server/blobStore.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

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
  return { status: res.status, data, headers: Object.fromEntries(res.headers) }
}

// PNG 1×1 valide (> 32 octets décodés → accepté par savePhotoDataUrls)
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const uploadDir = path.join(root, 'uploads')
const outsideFiles = () =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)

describe('P18 — safeUploadName', () => {
  it('un nom normal passe, un chemin est réduit à sa base', () => {
    assert.equal(safeUploadName('cpu-1-mu07-1.jpg'), 'cpu-1-mu07-1.jpg')
    assert.equal(safeUploadName('../../pwnt-1.png'), 'pwnt-1.png')
    assert.equal(safeUploadName('a/b.png'), 'b.png')
    // `path` est sensible à la plateforme : sur POSIX `\\` n'est pas un
    // séparateur, donc basename ne coupe pas — mais le caractère est remplacé.
    // Ce qui doit tenir partout : ni `/`, ni `\\`, ni `..` seul.
    const win = safeUploadName('..\\..\\win.png')
    assert.ok(win && !win.includes('/') && !win.includes('\\') && win !== '..', `nom encore dangereux : ${win}`)
  })

  it('les noms inutilisables sont refusés', () => {
    for (const bad of ['', null, undefined, '.', '..', 'a'.repeat(201)]) {
      assert.equal(safeUploadName(bad), null, `${JSON.stringify(bad)} aurait dû être refusé`)
    }
  })
})

describe('P18 — PUT /api/master/products/:id ne peut plus écrire hors uploads', () => {
  it('un id en traversal ne crée aucun fichier hors du répertoire d’uploads', async () => {
    const token = (await call('POST', '/api/auth/login', { body: { email: 'pcstar.info31@gmail.com', password: 'star31' } })).data?.token
    assert.ok(token, 'login master impossible')

    const before = outsideFiles()
    const res = await call('PUT', '/api/master/products/..%2F..%2Fpwnt', { body: { photoDataUrls: [PNG] }, token })
    // Le produit n'existe pas : 404 attendu. Ce qui compte, c'est l'absence de fichier.
    assert.equal(res.status, 404, `statut inattendu : ${res.status}`)

    const after = outsideFiles()
    assert.deepEqual(after, before, `des fichiers sont apparus à la racine : ${after.join(', ')}`)

    // Et rien non plus dans les répertoires voisins.
    const escaped = []
    for (const dir of [root, path.join(root, 'data'), path.dirname(root)]) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.startsWith('pwnt')) escaped.push(path.join(dir, e.name))
      }
    }
    assert.deepEqual(escaped, [], `écriture hors répertoire : ${escaped.join(', ')}`)
  })

  it('un upload légitime continue de fonctionner', async () => {
    const token = (await call('POST', '/api/auth/login', { body: { email: 'pcstar.info31@gmail.com', password: 'star31' } })).data?.token
    const created = await call('POST', '/api/master/products', {
      body: { name: 'Souris test upload', category: 'accessories', brand: 'Test', price: 1900, stock: 2, short: 'test', photoDataUrls: [PNG] },
      token
    })
    assert.equal(created.status, 201, `création refusée : ${JSON.stringify(created.data)}`)
    const photos = created.data.product.photos || []
    assert.equal(photos.length, 1, `photo attendue, reçu ${JSON.stringify(photos)}`)
    assert.ok(
      photos[0].startsWith('/api/upload-file?name=') || photos[0].startsWith('/photos/uploads/'),
      `URL d'upload inattendue : ${photos[0]}`
    )
    // Le fichier est bien DANS le répertoire d'uploads.
    const written = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []
    assert.ok(written.length >= 1, 'aucun fichier dans le répertoire d’uploads')
    assert.ok(written.every((f) => !f.includes('..')), `nom de fichier suspect : ${written.join(', ')}`)
  })
})
