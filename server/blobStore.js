/**
 * Object storage adapter for master-uploaded product photos.
 *
 * Vercel (production) : uploads go to Vercel Blob via BLOB_READ_WRITE_TOKEN.
 *                       Photo URLs are direct CDN links — served without /api.
 * Local / serverless-fallback : writes to the filesystem (public/photos/uploads
 *     localement, /tmp/pcstar-uploads sous Vercel) et servi via /api/upload-file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

export const UPLOAD_DIR = process.env.PCSTAR_UPLOAD_DIR
  ? path.resolve(process.env.PCSTAR_UPLOAD_DIR)
  : IS_SERVERLESS
    ? path.join('/tmp', 'pcstar-uploads')
    : path.join(__dirname, '../public/photos/uploads')

export const MAX_BYTES = 2.5 * 1024 * 1024
export const MAX_PHOTOS = 6
export { IS_SERVERLESS }

export const UPLOAD_PUBLIC_PREFIX = IS_SERVERLESS ? '/api/upload-file' : '/photos/uploads'

const HAS_BLOB_TOKEN = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const BLOB_PREFIX = 'pcstar-uploads/'

let blobLib = null
let blobLoadAttempted = false
async function loadBlob() {
  if (!HAS_BLOB_TOKEN) return null
  if (blobLoadAttempted) return blobLib
  blobLoadAttempted = true
  try {
    blobLib = await import('@vercel/blob')
  } catch {
    blobLib = null
  }
  return blobLib
}

export function hasBlob() {
  return HAS_BLOB_TOKEN
}

export function ensureUploadDir() {
  if (!IS_SERVERLESS) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

/**
 * P18 : nom de fichier d'upload sûr — aucun séparateur, aucun `..`, borné.
 * Retourne null si le nom n'est pas utilisable.
 */
export function safeUploadName(name) {
  const base = path
    .basename(String(name || ''))
    .replace(/[^A-Za-z0-9._-]/g, '_')
  if (!base || base === '.' || base === '..' || base.length > 200) return null
  return base
}

/**
 * Upload a decoded image buffer.
 * @returns {{ url: string, storage: 'blob'|'fs' }}
 */
export async function uploadBlob(name, buffer, contentType = 'image/jpeg') {
  // P18 : `name` est bâti à partir d'un id produit qui vient de l'URL décodée.
  // Sans contrôle, `PUT /api/master/products/..%2F..%2Fpwnt` écrivait
  // `public/pwnt-<ts>-1.png` — HORS du répertoire d'uploads, donc servi
  // publiquement — alors même que la route répondait 404. `deleteBlob` gardait
  // déjà `..` et `/` ; l'écriture, non.
  const safe = safeUploadName(name)
  if (!safe) throw new Error('unsafe upload name')
  const blob = await loadBlob()
  if (blob) {
    const { url } = await blob.put(`${BLOB_PREFIX}${safe}`, buffer, {
      contentType,
      access: 'public'
    })
    return { url, storage: 'blob' }
  }
  // Filesystem fallback (local dev / serverless sans Blob)
  if (IS_SERVERLESS) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  } else {
    ensureUploadDir()
  }
  const file = path.join(UPLOAD_DIR, safe)
  // Double garde : le chemin résolu doit rester DANS UPLOAD_DIR.
  const rel = path.relative(UPLOAD_DIR, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('upload path escape')
  fs.writeFileSync(file, buffer)
  const url = IS_SERVERLESS
    ? `${UPLOAD_PUBLIC_PREFIX}?name=${encodeURIComponent(safe)}`
    : `${UPLOAD_PUBLIC_PREFIX}/${safe}`
  return { url, storage: 'fs' }
}

/** True when a public URL is a Vercel Blob CDN link (deletable via Blob API). */
export function isBlobUrl(url) {
  return HAS_BLOB_TOKEN && /^https?:\/\//.test(String(url || '')) && String(url).includes('vercel-storage.com')
}

/**
 * Resolve a filesystem upload name to its Vercel Blob CDN URL (for the
 * /api/upload-file redirect when a photo was uploaded to Blob, not /tmp).
 * Returns null when Blob is unavailable or the download URL can't be built.
 */
export async function resolveBlobUrl(name) {
  if (!HAS_BLOB_TOKEN || !name) return null
  const blob = await loadBlob()
  if (!blob || typeof blob.getDownloadUrl !== 'function') return null
  try {
    return blob.getDownloadUrl(`${BLOB_PREFIX}${name}`, { access: 'public' })
  } catch {
    return null
  }
}

/**
 * Delete a previously uploaded photo.
 * Supports both Blob CDN URLs and filesystem paths (/api/upload-file?name=…
 * or /photos/uploads/…). Never throws — best effort.
 */
export async function deleteBlob(publicUrl) {
  if (!publicUrl) return false
  const blob = await loadBlob()
  if (blob && isBlobUrl(publicUrl)) {
    try {
      await blob.del(publicUrl)
      return true
    } catch {
      return false
    }
  }
  // Filesystem fallback
  try {
    const raw = String(publicUrl || '')
    const name = raw.includes('name=')
      ? decodeURIComponent(raw.split('name=')[1])
      : raw.split('/').pop()
    if (!name || name.includes('..') || name.includes('/') || name.length > 200) return false
    fs.unlinkSync(path.join(UPLOAD_DIR, name))
    return true
  } catch {
    return false
  }
}
