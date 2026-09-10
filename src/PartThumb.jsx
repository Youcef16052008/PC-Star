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

/**
 * Product thumbnail — object-fit contain so product shots aren't cropped.
 * loading=lazy by default (eager for above-the-fold via prop).
 */
export default function PartThumb({ product, alt, eager = false, className = '' }) {
  const src = product?.photos && product.photos[0]
  const label = alt ?? product?.name ?? ''
  if (src) {
    return (
      <img
        className={`part-thumb ${className}`.trim()}
        src={src}
        alt={label}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        width={800}
        height={800}
      />
    )
  }
  return (
    <span className={`part-mark cat-${product?.category || 'accessories'}`} aria-hidden={!label} role={label ? 'img' : undefined} aria-label={label || undefined}>
      {MARK[product?.category] || 'PC'}
    </span>
  )
}
