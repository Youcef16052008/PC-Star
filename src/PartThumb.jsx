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


/**
 * If the chosen candidate fails to load (missing .webp sibling, network…),
 * drop the <picture> and retry with the plain image src.
 */
function onPhotoError(e) {
  const img = e.currentTarget
  if (img.dataset.fallbackUsed) return
  img.dataset.fallbackUsed = '1'
  img.closest('picture')?.remove()
  const fb = img.dataset.fallback
  if (fb) img.src = fb
  else img.style.visibility = 'hidden'
}

/**
 * Product thumbnail — contain fit, lazy, optional srcset for /photos/sku.
 */
export default function PartThumb({ product, alt, eager = false, className = '', sizes = '(max-width: 576px) 50vw, 25vw' }) {
  const src = product?.photos && product.photos[0]
  const label = alt ?? product?.name ?? ''
  if (src) {
    const cands = photoCandidates(src)
    if (cands.length > 1) {
      return (
        <picture>
          <source srcSet={cands[0]} type="image/webp" />
          <img
            className={`part-thumb ${className}`.trim()}
            src={cands[1]}
            data-fallback={cands[1]}
            onError={onPhotoError}
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
    return (
      <img
        className={`part-thumb ${className}`.trim()}
        src={src}
        onError={onPhotoError}
        alt={label}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        width={800}
        height={800}
        sizes={sizes}
      />
    )
  }
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
