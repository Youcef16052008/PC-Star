// P4 (B10) — Compression des photos master AVANT envoi au serveur.
//
// Un upload de 6 × 2,5 Mo en base64 ≈ 20 Mo de JSON → 413 sur Vercel
// (bodyParser ~4-10 Mo). Canvas → JPEG ~800 px / q0.8 ≈ 150-300 Ko par
// photo : le corps de requête passe sous ~2 Mo, et la latence baisse aussi.
//
// LOT 8.5 (A5) — la décision de compresser portait sur les **dimensions**,
// jamais sur le poids : `scaleToMaxDim` renvoyait `scale === 1` pour une image
// déjà ≤ 800 px et la fonction retournait alors le dataURL **brut**, sans
// ré-encodage. Un PNG 800×800 de 2 Mo passait donc tel quel (2,7 Mo de
// base64), et six photos de ce type ≈ 12 Mo — très au-delà des 4,5 Mo que
// Vercel accepte pour le corps d'une fonction. La compression est désormais
// pilotée par un **budget d'octets** : on ré-encode aussi à dimensions
// constantes, et on réduit qualité puis dimensions jusqu'à tenir le budget.
//
// Factories injectables (createCanvas / loadImage) : pas de canvas dans
// Node, les tests stubbent l'environnement.

import { COMPRESS_FLOOR, MAX_PHOTO_BYTES } from './limits.js'

export const COMPRESS_DEFAULTS = {
  maxDim: 800,
  quality: 0.8,
  type: 'image/jpeg',
  // LOT 8.5 (A5) : budget par photo, en octets DÉCODÉS (comparable à la limite
  // serveur par blob). 6 × 400 Ko → ~3,2 Mo de base64, sous la garde d'envoi.
  maxBytes: MAX_PHOTO_BYTES
}

/**
 * Poids décodé (octets) d'un dataURL base64 — sans le décoder.
 *
 * `base64` code 3 octets en 4 caractères ; on retire l'en-tête
 * `data:<mime>;base64,` puis on applique le rapport 3/4 (les caractères de
 * rembourrage `=` sont comptés, donc le résultat est un très léger majorant —
 * ce qui est exactement ce qu'on veut pour une garde).
 *
 * @param {string} dataUrl
 * @returns {number} 0 si ce n'est pas un dataURL base64
 */
export function dataUrlBytes(dataUrl) {
  const raw = String(dataUrl || '')
  const comma = raw.indexOf(',')
  if (!raw.startsWith('data:') || comma < 0) return 0
  if (!/^data:[^,]*;base64/i.test(raw.slice(0, comma + 1))) return raw.length - comma - 1
  return Math.ceil((raw.length - comma - 1) * 0.75)
}

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
 * Compresse un dataURL image selon un budget d'octets.
 *
 * Renvoie le dataURL d'origine si :
 *  · ce n'est pas une image (un chemin `/photos/…` déjà hébergé) ;
 *  · l'image est déjà ≤ `maxDim` **et** ≤ `maxBytes` — rien à gagner ;
 *  · le canvas est indisponible ou le décodage échoue (l'upload passe alors
 *    sans compression ; le serveur garde sa limite par photo et la garde
 *    d'envoi de `MasterPage` refuse le corps s'il dépasse le budget).
 *
 * Sinon : ré-encodage aux dimensions cibles, puis **boucle de réduction
 * bornée** (qualité d'abord, dimensions ensuite) tant que le budget n'est pas
 * tenu. Le résultat n'est jamais plus lourd que l'entrée — si le
 * ré-encodage grossissait l'image (cas possible sur de très petites images),
 * l'original est rendu.
 */
export function compressDataUrl(dataUrl, opts = {}, env = {}) {
  const {
    maxDim = COMPRESS_DEFAULTS.maxDim,
    quality = COMPRESS_DEFAULTS.quality,
    type = COMPRESS_DEFAULTS.type,
    maxBytes = COMPRESS_DEFAULTS.maxBytes
  } = opts
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
      const sized = scaleToMaxDim(iw, ih, maxDim)
      const rawBytes = dataUrlBytes(raw)
      // LOT 8.5 (A5) : « déjà à taille » ne suffit plus — il faut aussi que le
      // POIDS tienne le budget. Une image petite en pixels mais lourde (PNG
      // 800×800 non compressé) est ré-encodée à dimensions constantes.
      if (sized.scale === 1 && rawBytes <= maxBytes) return raw

      const encode = (w, h, q) => {
        const canvas = createCanvas(w, h)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        return canvas.toDataURL(type, q)
      }

      let w = sized.w
      let h = sized.h
      let q = quality
      let best = encode(w, h, q)
      // Boucle BORNÉE : on baisse la qualité jusqu'au plancher, puis on réduit
      // les dimensions par pas de 0,8 jusqu'au plancher, et on s'arrête.
      for (let step = 0; step < COMPRESS_FLOOR.steps; step += 1) {
        if (dataUrlBytes(best) <= maxBytes) break
        if (q > COMPRESS_FLOOR.quality) {
          q = Math.max(COMPRESS_FLOOR.quality, Math.round((q - 0.1) * 100) / 100)
        } else if (Math.max(w, h) > COMPRESS_FLOOR.maxDim) {
          w = Math.max(1, Math.round(w * 0.8))
          h = Math.max(1, Math.round(h * 0.8))
        } else {
          break // planchers atteints : on rend le meilleur obtenu
        }
        best = encode(w, h, q)
      }
      // Ré-encodage à dimensions constantes (image déjà ≤ maxDim mais trop
      // lourde) : on ne rend le résultat que s'il est réellement plus léger —
      // sinon l'original part tel quel, la garde d'envoi tranchera.
      // En revanche, si les dimensions ONT été réduites, le résultat est
      // toujours rendu : revenir à l'original rendrait la réduction inutile
      // (et c'est bien la taille de l'image, pas seulement son poids, qui
      // compte pour l'affichage et le stockage).
      if (sized.scale === 1 && dataUrlBytes(best) >= rawBytes) return raw
      return best
    })
    .catch(() => raw)
}
