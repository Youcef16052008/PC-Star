import { useState } from 'react'
import { photoCandidates } from './media.js'

const MARK = {
  cpu: 'CPU',
  gpu: 'GPU',
  motherboard: 'MB',
  memory: 'RAM',
  case: 'CASE',
  cooling: 'COOL',
  accessories: 'ACC',
  laptop: 'LAP',
  ready: 'PC',
  usb: 'USB',
  console: 'PAD',
  repair: 'FIX'
}

/** Badge de catégorie — repli quand aucune photo ne charge (P15 #6/#7). */
function CategoryMark({ product, label }) {
  return (
    <span
      className={`part-mark cat-${product?.category || 'accessories'}`}
      aria-hidden={!label}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
    >
      {MARK[product?.category] || 'PC'}
    </span>
  )
}

/**
 * Product thumbnail — contain fit, lazy, optional srcset for /photos/sku.
 *
 * P15 (#6) : le repli sur erreur est piloté par l'état React, plus par une
 * mutation du DOM. Avant : `img.closest('picture').remove()` supprimait le
 * `<picture>` **avec l'`<img>` qu'il contient**, puis `img.src = fb`
 * s'appliquait à un nœud détaché du document → la vignette disparaissait au
 * lieu de tomber sur le src de secours.
 *
 * Ordre d'essai : candidats de `photoCandidates` (webp puis jpg), puis badge de
 * catégorie. Combiné à P15 (#7), un produit dont les fichiers n'existent pas
 * affiche un badge lisible au lieu d'une image cassée/invisible.
 */
export default function PartThumb({ product, alt, eager = false, className = '', sizes = '(max-width: 576px) 50vw, 25vw' }) {
  const label = alt ?? product?.name ?? ''
  const src = product?.photos && product.photos[0]
  const cands = src ? photoCandidates(src) : []
  const [attempt, setAttempt] = useState(0)

  if (!cands.length || attempt >= cands.length) return <CategoryMark product={product} label={label} />

  const current = cands[Math.min(attempt, cands.length - 1)]
  // Passer au candidat suivant remonte un <img> neuf → nouveau chargement.
  const onError = () => setAttempt((n) => n + 1)

  const img = (
    <img
      className={`part-thumb ${className}`.trim()}
      src={current}
      onError={onError}
      alt={label}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={800}
      height={800}
      sizes={sizes}
    />
  )

  // Le <picture> ne sert qu'au premier cran : le sibling .webp en <source>, le
  // .jpg en src de l'<img> (le navigateur qui ne sait pas décoder le webp — ou
  // dont le webp est absent — charge directement le jpg).
  if (attempt === 0 && cands.length > 1) {
    return (
      <picture>
        <source srcSet={cands[0]} type="image/webp" />
        <img
          className={`part-thumb ${className}`.trim()}
          src={cands[cands.length - 1]}
          onError={onError}
          alt={label}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          width={800}
          height={800}
          sizes={sizes}
        />
      </picture>
    )
  }
  return img
}
