// P4 (B10) — Compression des photos master AVANT envoi au serveur.
//
// Un upload de 6 × 2,5 Mo en base64 ≈ 20 Mo de JSON → 413 sur Vercel
// (bodyParser ~4-10 Mo). Canvas → JPEG ~800 px / q0.8 ≈ 150-300 Ko par
// photo : le corps de requête passe sous ~2 Mo, et la latence baisse aussi.
//
// Factories injectables (createCanvas / loadImage) : pas de canvas dans
// Node, les tests stubbent l'environnement.

export const COMPRESS_DEFAULTS = { maxDim: 800, quality: 0.8, type: 'image/jpeg' }

// Dimension cible pour l'image (longest side ≤ maxDim). Scale = 1 si déjà assez petit.
export function scaleToMaxDim(w, h, maxDim) {
  const cw = Number(w) || 0
  const ch = Number(h) || 0
  const longest = Math.max(cw, ch)
  if (longest <= maxDim) return { w: cw, h: ch, scale: 1 }
  const scale = maxDim / longest
  return {
    w: Math.max(1, Math.round(cw * scale)),
    h: Math.max(1, Math.round(ch * scale)),
    scale
  }
}

/**
 * Compresse un dataURL image. Renvoie le dataURL d'origine si l'image est
 * déjà ≤ maxDim, si le canvas est indisponible, ou en cas d'erreur
 * (l'upload passe alors sans compression — le serveur garde sa limite
 * MAX_BYTES par photo).
 */
export function compressDataUrl(dataUrl, opts = {}, env = {}) {
  const { maxDim = COMPRESS_DEFAULTS.maxDim, quality = COMPRESS_DEFAULTS.quality, type = COMPRESS_DEFAULTS.type } = opts
  const raw = String(dataUrl || '')
  if (!raw.startsWith('data:image/')) return Promise.resolve(raw)

  const createCanvas =
    env.createCanvas ||
    ((w, h) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    })
  const loadImage =
    env.loadImage ||
    ((src) =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('load failed'))
        img.src = src
      }))

  return loadImage(raw)
    .then((img) => {
      const iw = img.naturalWidth || img.width || 0
      const ih = img.naturalHeight || img.height || 0
      const { w, h, scale } = scaleToMaxDim(iw, ih, maxDim)
      if (scale === 1) return raw // déjà à taille, pas de re-encodage
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      return canvas.toDataURL(type, quality)
    })
    .catch(() => raw)
}
