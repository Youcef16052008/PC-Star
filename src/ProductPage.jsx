import { useState } from 'react'
import { money, starText, STORE, REVIEWS } from './data.js'
import PartThumb from './PartThumb.jsx'
import ContactButton from './ContactPicker.jsx'
import { relatedProducts, specRows } from './media.js'
import { stockLabel } from './stockLabel.js'
import { compatLabel, discountPercent, hasSale } from './productMeta.js'

/**
 * LOT 2.6 (F10) — texte du bloc « besoins » d'une fiche produit.
 *
 * `needs` est désormais un TABLEAU (normalisé côté serveur,
 * `normalizeNeeds`) mais peut encore être une chaîne dans une base antérieure
 * ou créée en mode local. Deux pièges corrigés ici :
 *  · React concatène un tableau de chaînes SANS séparateur (« Socket AM5BIOS à
 *    jour ») — d'où la jointure explicite ;
 *  · `[]` est truthy en JS : la condition d'affichage `product.needs` aurait
 *    dessiné un encart vide pour tout produit sans besoins.
 */
function needsText(needs) {
  if (Array.isArray(needs)) {
    return needs
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .join(' · ')
  }
  return String(needs ?? '').trim()
}

// LOT 6.1 (Q1) : `stockLabel` vient de `src/stockLabel.js` — une seule définition,
// une seule famille de classes (la classe Bootstrap complète, rien à traduire).

function Stars({ product, t }) {
  if (!product || !product.rating) return null
  return (
    <div className="stars" title={`${product.rating} ${t('xReviews', { n: product.reviews })}`}>
      <span>{starText(product.rating)}</span>
      <em>{product.rating.toFixed(1)}</em>
      <span className="rev">({product.reviews})</span>
    </div>
  )
}

function SpecBadges({ product, t }) {
  const c = product.compat || {}
  const badges = []
  // LOT P1 (B11) : socket, memoire et format peuvent etre des listes ; le rendu
  // passe par `compatLabel` au lieu de supposer une chaine.
  if (c.socket) badges.push({ k: 'socket', v: compatLabel(c.socket, '/') })
  if (c.memory) badges.push({ k: 'memory', v: compatLabel(c.memory, '/') })
  if (c.form) badges.push({ k: 'form', v: compatLabel(c.form, '/') })
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
      {/* P21 : badge « espèces au comptoir » retiré de la fiche produit. */}
    </div>
  )
}

export default function ProductPage({ t, lang = 'fr', product, photoIndex, setPhotoIndex, left, onBack, onAdd, onOpen, liveStock, onAddRelated, catalog }) {
  const st = stockLabel(left, t)
  // LOT 6.1 (Q1) : la classe vient complète — plus de ternaire de traduction.
  const badge = st.cls
  const photos = product.photos || []
  const also = relatedProducts(product, catalog, 4)
  const specs = specRows(product, t)
  // P11 : le bloc coloré « coincé » à la place de la photo — l'événement `load`
  // de l'image pouvait être perdu (URL déjà en cache, nœud DOM réutilisé) et la
  // classe skeleton n'était alors jamais retirée. Désormais : le fond skeleton
  // est permanent CONTRE le conteneur (il passe derrière l'image chargée), la
  // <img> porte une `key` (nœud neuf à chaque produit/photo → événements
  // garantis) et `onError` bascule sur le logo de la pièce (PartThumb).
  const [failed, setFailed] = useState({})
  const vues = photos.map((src, i) => ({ src, i })).filter(({ i }) => !failed[i])

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('continueShopping')}
      </button>
      <div className="row g-4">
        <div className="col-md-6">
          <div className="card border-0 shadow-sm overflow-hidden">
            {/* BUGFIX : le badge stock doit rester HORS de .ratio — Bootstrap
                étire tout enfant direct de .ratio en absolute 100×100, ce qui
                transformait le badge opaque en bloc géant cachant la photo. */}
            <div className="position-relative">
              <div className="ratio ratio-1x1 photo-frame pdp-zoom photo-skeleton">
                {photos.length > 0 && failed[photoIndex] ? (
                  <PartThumb product={product} eager />
                ) : photos.length > 0 ? (
                  <img
                    key={product.id + '-' + photoIndex}
                    src={photos[photoIndex]}
                    alt={product.photoMode === 'category' ? t('categoryIllustrationAlt', { name: product.name }) : product.name}
                    className="w-100 h-100"
                    style={{ objectFit: 'contain' }}
                    loading="eager"
                    decoding="async"
                    width={800}
                    height={800}
                    onError={() => setFailed((f) => ({ ...f, [photoIndex]: true }))}
                  />
                ) : (
                  <PartThumb product={product} eager />
                )}
              </div>
              <span className={`badge position-absolute top-0 end-0 m-2 ${badge}`}>{st.text}</span>
            </div>
          </div>
          {product.photoMode === 'category' && (
            <p className="small text-secondary mt-2 mb-0">{t('categoryIllustrationNotice')}</p>
          )}
          {/* P28 : une vignette qui ne charge pas sort de la bande au lieu d'y
              laisser une image cassée — même état `failed` que la grande photo,
              qui retombe déjà sur le repère de la pièce. La bande ne s'affiche
              que s'il reste au moins deux vues à choisir. */}
          {vues.length > 1 && (
            <div className="d-flex flex-wrap gap-2 mt-2">
              {vues.map(({ src, i }) => (
                <button
                  key={src + i}
                  type="button"
                  className={`btn p-0 border rounded overflow-hidden ${i === photoIndex ? 'border-success border-2' : ''}`}
                  style={{ width: 72, height: 56 }}
                  onClick={() => setPhotoIndex(i)}
                  aria-label={`${product.name} ${i + 1}`}
                >
                  <img
                    src={src}
                    alt=""
                    className="w-100 h-100"
                    style={{ objectFit: 'contain', background: 'var(--photo-bg)' }}
                    loading="lazy"
                    onError={() => setFailed((f) => ({ ...f, [i]: true }))}
                  />
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
          <Stars product={product} t={t} />
          <p className="text-secondary">{product.short}</p>
          {product.description && <p className="mb-3 product-description">{product.description}</p>}
          <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
            <div className="fs-4 fw-bold text-success">{money(product.price, lang)}</div>
            {hasSale(product) && (
              <>
                <del className="small text-secondary">{money(product.compareAtPrice, lang)}</del>
                <span className="badge text-bg-danger">−{discountPercent(product)}%</span>
              </>
            )}
          </div>
          <SpecBadges product={product} t={t} />
          {specs.length > 0 && (
            <div className="table-responsive mb-3">
              <table className="table table-sm table-borderless mb-0 spec-table">
                <tbody>
                  {specs.map((r) => (
                    <tr key={r.label}>
                      <th className="text-secondary fw-normal small" style={{ width: '40%' }}>{r.label}</th>
                      <td className="fw-semibold small">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {product.conditionNote && (
            <div className="alert alert-info py-2 small mb-2">
              <strong>{t('masterConditionNote')} : </strong>{product.conditionNote}
            </div>
          )}
          {(product.needsKey || needsText(product.needs)) && (
            <div className={`alert py-2 ${left <= 0 ? 'alert-danger' : 'alert-secondary'}`}>
              {product.needsKey ? t(product.needsKey) : needsText(product.needs)}
            </div>
          )}

          <div className="d-none d-md-flex flex-wrap gap-2 mt-3">
            <button className="btn btn-success btn-lg" type="button" disabled={left <= 0} onClick={onAdd}>
              {left <= 0 ? t('soldOut') : t('addToCart')}
            </button>
            {/* UN bouton WhatsApp → choix du numéro (07 ou 06) */}
            <ContactButton
              label={t('askWhatsapp')}
              btnClass="btn btn-outline-secondary"
              choices={[
                {
                  title: STORE.phone,
                  href: `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(t('pdpWaMsg', { name: product.name, sku: product.sku, price: money(product.price, lang) }))}`,
                  external: true
                },
                {
                  title: STORE.phone2,
                  href: `https://wa.me/${STORE.whatsapp2}?text=${encodeURIComponent(t('pdpWaMsg', { name: product.name, sku: product.sku, price: money(product.price, lang) }))}`,
                  external: true
                }
              ]}
            />
          </div>
          <p className="small text-secondary mt-2 mb-0">{t('pdpCashNote')}</p>
        </div>
      </div>

      {/* Mobile sticky CTA — § 4.2 : présent téléphone ET tablette, masqué
          au bureau (d-lg-none) ; safe-area-inset-bottom dans index.css. */}
      <div className="pdp-sticky-cta d-lg-none">
        <div className="d-flex align-items-center gap-2">
          <strong className="text-success">{money(product.price, lang)}</strong>
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
                    <p className="mb-0 small">{r.textKey ? t(r.textKey) : r.text}</p>
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
                      <Stars product={p} t={t} />
                      <div className="fw-bold text-success mb-2">{money(p.price, lang)}</div>
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
