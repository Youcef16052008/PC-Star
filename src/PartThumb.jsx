const MARK = {
  cpu: 'CPU',
  gpu: 'GPU',
  motherboard: 'MB',
  memory: 'RAM',
  case: 'CASE',
  accessories: 'ACC',
  laptop: 'LAP',
  ready: 'PC',
  usb: 'USB',
  console: 'PAD',
  repair: 'FIX'
}

/** Prefer webp sibling when browser supports it via <picture>. */
function photoCandidates(src) {
  if (!src) return []
  const webp = src.replace(/\.(jpe?g|png)$/i, '.webp')
  if (webp !== src) return [webp, src]
  return [src]
}

/**
 * Product thumbnail — contain fit, lazy, optional srcset for /photos/sku.
 */
export default function PartThumb({ product, alt, eager = false, className = '', sizes = '(max-width: 576px) 50vw, 25vw' }) {
  const src = product?.photos && product.photos[0]
  const label = alt ?? product?.name ?? ''
  if (src) {
    const isSku = /\/photos\/sku\//.test(src)
    const srcSet = isSku
      ? undefined // single 800 master for now; path ready for 400/800/1200 later
      : undefined
    const cands = photoCandidates(src)
    if (cands.length > 1) {
      return (
        <picture>
          <source srcSet={cands[0]} type="image/webp" />
          <img
            className={`part-thumb ${className}`.trim()}
            src={cands[1]}
            alt={label}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            width={800}
            height={800}
            sizes={sizes}
            srcSet={srcSet}
          />
        </picture>
      )
    }
    return (
      <img
        className={`part-thumb ${className}`.trim()}
        src={src}
        alt={label}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        width={800}
        height={800}
        sizes={sizes}
        srcSet={srcSet}
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
