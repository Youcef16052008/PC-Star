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
 * LOT 5.8 (U8) : plus d'attribut `sizes`.
 *
 * `sizes` ne sert qu'avec un `srcSet` à plusieurs largeurs : il dit au
 * navigateur quelle taille d'image choisir parmi les candidates. Ici chaque
 * produit n'a qu'UN fichier par format (uploadé par le maître, ≤ 2,5 Mo, aucune
 * variante générée) : `sizes="(max-width: 576px) 50vw, 25vw"` était donc lu par
 * personne — un attribut qui annonce une image responsive inexistante, et qui
 * laissait croire à l'optimisation. Les `width`/`height` restent (ratio réservé
 * → pas de décalage de mise en page au chargement), et le `<picture>` garde son
 * vrai choix de format (webp puis jpg).
 *
 * Product thumbnail — contain fit, lazy, format négocié via <picture>.
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
export default function PartThumb({ product, alt, eager = false, className = '' }) {
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
        />
      </picture>
    )
  }
  return img
}
