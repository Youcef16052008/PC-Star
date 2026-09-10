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

export default function PartThumb({ product }) {
  const src = product.photos && product.photos[0]
  if (src) return <img src={src} alt="" />
  return <span className={`part-mark cat-${product.category}`}>{MARK[product.category] || 'PC'}</span>
}
