import { money, starText, STORE, REVIEWS } from './data.js'
import PartThumb from './PartThumb.jsx'

function stockLabel(n, t) {
  if (n <= 0) return { text: t('outOfStock'), cls: 'stock-out' }
  if (n <= 3) return { text: `${n} ${t('left')}`, cls: 'stock-low' }
  return { text: `${n} ${t('inStore')}`, cls: 'stock-ok' }
}

function Stars({ product }) {
  if (!product || !product.rating) return null
  return (
    <div className="stars" title={`${product.rating} from ${product.reviews} reviews`}>
      <span>{starText(product.rating)}</span>
      <em>{product.rating.toFixed(1)}</em>
      <span className="rev">({product.reviews})</span>
    </div>
  )
}

function SpecBadges({ product, t }) {
  const c = product.compat || {}
  const badges = []
  if (c.socket && !Array.isArray(c.socket)) badges.push({ k: 'socket', v: c.socket })
  if (Array.isArray(c.socket)) badges.push({ k: 'socket', v: c.socket.join('/') })
  if (c.memory) badges.push({ k: 'memory', v: c.memory })
  if (c.form) badges.push({ k: 'form', v: c.form })
  if (c.psuWatts) badges.push({ k: 'psu', v: `${c.psuWatts}W` })
  if (c.psuMin) badges.push({ k: 'psuMin', v: `≥${c.psuMin}W` })
  if (!badges.length) return null
  return (
    <div className="d-flex flex-wrap gap-1 mb-3">
      {badges.map((b) => (
        <span key={b.k + b.v} className="badge text-bg-light border">
          {b.v}
        </span>
      ))}
      <span className="badge text-bg-success-subtle border border-success-subtle text-success-emphasis">{t('payCash')}</span>
    </div>
  )
}

export default function ProductPage({ t, product, photoIndex, setPhotoIndex, left, onBack, onAdd, onOpen, liveStock, onAddRelated, catalog }) {
  const st = stockLabel(left, t)
  const badge = st.cls === 'stock-ok' ? 'text-bg-success' : st.cls === 'stock-low' ? 'text-bg-warning' : 'text-bg-danger'
  const photos = product.photos || []
  const also = (product.related || []).map((id) => catalog.find((p) => p.id === id)).filter(Boolean)

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('continueShopping')}
      </button>
      <div className="row g-4">
        <div className="col-md-6">
          <div className="card border-0 shadow-sm overflow-hidden">
            <div className="ratio ratio-1x1 photo-frame position-relative pdp-zoom">
              {photos.length > 0 ? (
                <img
                  src={photos[photoIndex]}
                  alt={product.name}
                  className="w-100 h-100"
                  style={{ objectFit: 'contain' }}
                  loading="eager"
                  decoding="async"
                  width={800}
                  height={800}
                />
              ) : (
                <PartThumb product={product} eager />
              )}
              <span className={`badge position-absolute top-0 end-0 m-2 ${badge}`}>{st.text}</span>
            </div>
          </div>
          {photos.length > 1 && (
            <div className="d-flex flex-wrap gap-2 mt-2">
              {photos.map((src, i) => (
                <button
                  key={src + i}
                  type="button"
                  className={`btn p-0 border rounded overflow-hidden ${i === photoIndex ? 'border-success border-2' : ''}`}
                  style={{ width: 72, height: 56 }}
                  onClick={() => setPhotoIndex(i)}
                  aria-label={`${product.name} ${i + 1}`}
                >
                  <img src={src} alt="" className="w-100 h-100" style={{ objectFit: 'contain', background: 'var(--photo-bg)' }} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-md-6">
          <div className="small text-secondary mb-1">
            {product.sku} · {product.brand}
          </div>
          <h1 className="h3 mb-2">{product.name}</h1>
          <Stars product={product} />
          <p className="text-secondary">{product.short}</p>
          <div className="fs-4 fw-bold text-success mb-2">{money(product.price)}</div>
          <SpecBadges product={product} t={t} />
          {product.needs && <div className={`alert py-2 ${left <= 0 ? 'alert-danger' : 'alert-secondary'}`}>{product.needs}</div>}

          <div className="d-none d-md-flex flex-wrap gap-2 mt-3">
            <button className="btn btn-success btn-lg" type="button" disabled={left <= 0} onClick={onAdd}>
              {left <= 0 ? t('soldOut') : t('addToCart')}
            </button>
            <a
              className="btn btn-outline-secondary"
              href={`https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(`Salam, I want ${product.name} (${product.sku}) — ${money(product.price)}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('askWhatsapp')}
            </a>
          </div>
          <p className="small text-secondary mt-2 mb-0">{t('pdpCashNote')}</p>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="pdp-sticky-cta d-md-none">
        <div className="d-flex align-items-center gap-2">
          <strong className="text-success">{money(product.price)}</strong>
          <button className="btn btn-success flex-grow-1" type="button" disabled={left <= 0} onClick={onAdd}>
            {left <= 0 ? t('soldOut') : t('addToCart')}
          </button>
        </div>
      </div>

      {(REVIEWS[product.id] || []).length > 0 && (
        <section className="mt-5">
          <h2 className="h5 mb-3">{t('customerReviews')}</h2>
          <div className="row g-3">
            {REVIEWS[product.id].map((r, i) => (
              <div className="col-md-6" key={i}>
                <article className="card h-100 shadow-sm border-0">
                  <div className="card-body">
                    <div className="d-flex flex-wrap gap-2 small mb-2">
                      <span className="text-warning">{starText(r.stars)}</span>
                      <strong>{r.name}</strong>
                      <span className="text-secondary">{r.city}</span>
                    </div>
                    <p className="mb-0 small">{r.text}</p>
                  </div>
                </article>
              </div>
            ))}
          </div>
        </section>
      )}

      {also.length > 0 && (
        <section className="mt-5 mb-5">
          <h2 className="h5 mb-3">{t('alsoBought')}</h2>
          <div className="row g-3">
            {also.map((p) => {
              const l = liveStock(p)
              return (
                <div className="col-6 col-md-3" key={p.id}>
                  <article className="card h-100 shadow-sm product-bs-card">
                    <button type="button" className="btn p-0 border-0" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <div className="ratio ratio-1x1 photo-frame overflow-hidden">
                        <PartThumb product={p} />
                      </div>
                    </button>
                    <div className="card-body d-flex flex-column">
                      <h3 className="h6">
                        <button type="button" className="btn btn-link p-0 text-start text-decoration-none text-body" onClick={() => onOpen(p.id)}>
                          {p.name}
                        </button>
                      </h3>
                      <Stars product={p} />
                      <div className="fw-bold text-success mb-2">{money(p.price)}</div>
                      <button className="btn btn-sm btn-success mt-auto" type="button" disabled={l <= 0} onClick={() => onAddRelated(p)}>
                        {l <= 0 ? t('soldOut') : t('add')}
                      </button>
                    </div>
                  </article>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </main>
  )
}
