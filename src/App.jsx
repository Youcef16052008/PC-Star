import { useEffect, useMemo, useState } from 'react'
import {
  CATEGORIES,
  COMPARE_FIELDS,
  DEALS,
  GUIDES,
  PRODUCTS,
  REVIEWS,
  SLOTS,
  SHOP_SERVICES,
  STORE,
  STORE_LINKS,
  checkCompatibility,
  money,
  splitWarnings,
  relatedOf,
  starText,
  third
} from './data'
import SearchPage from './SearchPage.jsx'
import BuilderPage from './BuilderPage.jsx'
import Orbit from './Orbit.jsx'
import PartThumb from './PartThumb.jsx'

function stockLabel(n) {
  if (n <= 0) return { text: 'Out of stock', cls: 'stock-out' }
  if (n <= 3) return { text: `${n} left`, cls: 'stock-low' }
  return { text: `${n} in store`, cls: 'stock-ok' }
}

function cartMessage(cart, total, pickup) {
  const lines = cart.map((i) => `${i.qty} x ${i.name} (${i.sku})`).join('\n')
  const who = pickup.name ? `\nName: ${pickup.name}` : ''
  const tel = pickup.phone ? `\nPhone: ${pickup.phone}` : ''
  const when = pickup.slot ? `\nPickup slot: ${pickup.slot}` : ''
  return `Salam PC Star Informatique, please prepare this for pickup at El Makari Les Castors, Oran:${who}${tel}${when}\n\n${lines}\n\nTotal ${money(total)}`
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

export default function App() {
  const [page, setPage] = useState('shop')
  const [selectedId, setSelectedId] = useState(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [toast, setToast] = useState('')
  const [pickup, setPickup] = useState({ name: '', phone: '', slot: SLOTS[2] })
  const [reservations, setReservations] = useState([])
  const [reserved, setReserved] = useState(null)
  const [compareIds, setCompareIds] = useState([])
  const [build, setBuild] = useState({})

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const selected = PRODUCTS.find((p) => p.id === selectedId)
  const count = cart.reduce((s, i) => s + i.qty, 0)
  const total = cart.reduce((s, i) => s + i.qty * i.price, 0)
  const warnings = useMemo(() => checkCompatibility(cart), [cart])
  const { blocks, notes } = useMemo(() => splitWarnings(warnings), [warnings])
  const compareItems = compareIds.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PRODUCTS.filter((p) => {
      const catOk = category === 'all' || p.category === category
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.short.toLowerCase().includes(q)
      return catOk && qOk
    })
  }, [category, query])

  function liveStock(product) {
    const inCart = cart.find((i) => i.id === product.id)
    return product.stock - (inCart ? inCart.qty : 0)
  }

  function add(product) {
    const left = liveStock(product)
    if (left <= 0) {
      setToast('Out of stock')
      return
    }
    setCart((prev) => {
      const found = prev.find((i) => i.id === product.id)
      if (found) return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
      return [...prev, { ...product, qty: 1 }]
    })
    setToast(`${product.name} added`)
  }

  function setQty(id, qty) {
    const product = PRODUCTS.find((p) => p.id === id)
    const max = product ? product.stock : 1
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: Math.min(max, Math.max(1, qty)) } : i))
        .filter((i) => i.qty > 0)
    )
  }

  function remove(id) {
    setCart((prev) => prev.filter((i) => i.id !== id))
  }

  function openProduct(id) {
    setSelectedId(id)
    setPhotoIndex(0)
    setPage('product')
    window.scrollTo({ top: 0 })
  }

  function go(next) {
    setPage(next)
    window.scrollTo({ top: 0 })
  }

  function toggleCompare(id) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 3) {
        setToast('Compare up to 3 products')
        return prev
      }
      return [...prev, id]
    })
  }

  function reserve(e) {
    e.preventDefault()
    if (!pickup.name.trim() || !pickup.phone.trim() || cart.length === 0) return
    const code = `PS-${String(Date.now()).slice(-6)}`
    const order = {
      code,
      ...pickup,
      items: cart,
      total,
      at: new Date().toLocaleString('fr-DZ')
    }
    setReservations((prev) => [order, ...prev])
    setReserved(order)
    setCart([])
  }

  const msg = cartMessage(cart, total, pickup)
  const waHref = `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(msg)}`

  return (
    <div className="app">
      <header className="wrap nav">
        <button className="logo" onClick={() => go('shop')}>
          PC <span>Star</span>
        </button>
        <nav className="nav-links">
          <button className={page === 'shop' || page === 'product' ? 'on' : ''} onClick={() => go('shop')}>Shop</button>
          <button className={page === 'search' ? 'on' : ''} onClick={() => go('search')}>Search</button>
          <button className={page === 'builder' ? 'on' : ''} onClick={() => go('builder')}>PC builder</button>
          <button className={page === 'about' ? 'on' : ''} onClick={() => go('about')}>About us</button>
          <button className={page === 'desk' ? 'on' : ''} onClick={() => go('desk')}>Desk list</button>
          <button className="cart-btn" onClick={() => go('cart')}>Cart {count}</button>
        </nav>
      </header>

      {page === 'shop' && (
        <main className="wrap page">
          <section className="hero">
            <div>
              <h1>PC, laptop, console — in dinars</h1>
              <p>Parts, laptops, PC pret, USB, manettes. We also repair almost anything PC, laptop or console. Price in DA, pay at the desk in El Makari Les Castors, Oran.</p>
              <div className="trust-row">
                <span className="pickup">{STORE.address}</span>
                <span className="pickup">Pay in 3x from 30 000 DA</span>
                <span className="pickup">1-year shop warranty</span>
                <button className="add" type="button" onClick={() => go('search')}>Advanced search</button>
                <button className="ghost" type="button" onClick={() => go('builder')}>PC builder</button>
              </div>
            </div>
            <div className="hero-orbit">
              <Orbit onOpen={openProduct} />
            </div>
          </section>

          <section className="deals">
            <h2>This week</h2>
            <div className="deal-row">
              {DEALS.map((d) => {
                const p = PRODUCTS.find((x) => x.id === d.id)
                if (!p) return null
                return (
                  <article className="deal-card" key={d.id}>
                    <span className="deal-tag">{d.tag}</span>
                    <button type="button" className="deal-thumb" onClick={() => openProduct(p.id)}>
                      <PartThumb product={p} />
                    </button>
                    <h3><button type="button" onClick={() => openProduct(p.id)}>{p.name}</button></h3>
                    <div className="price">{money(p.price)}</div>
                    <p className="short">{d.note}</p>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="guides">
            <h2>Star configs</h2>
            <div className="guide-row">
              {GUIDES.map((g) => (
                <article className="guide-card" key={g.id}>
                  <h3>{g.title}</h3>
                  <p>{g.body}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="toolbar">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
                {c.label}
              </button>
            ))}
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or SKU…"
              aria-label="Search products"
            />
          </div>

          {list.length === 0 ? (
            <p className="empty">No products in this filter.</p>
          ) : (
            <div className="grid">
              {list.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left)
                const inCmp = compareIds.includes(p.id)
                return (
                  <article className="card" key={p.id}>
                    <button className="thumb" onClick={() => openProduct(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </button>
                    <div className="card-body">
                      <div className="sku">{p.sku}</div>
                      <h3>{p.name}</h3>
                      <Stars product={p} />
                      <div className="short">{p.short}</div>
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <div className="row">
                        <div className="price">{money(p.price)}</div>
                        <button className="add" disabled={left <= 0} onClick={() => add(p)}>
                          {left <= 0 ? 'Sold out' : 'Add'}
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`ghost tiny ${inCmp ? 'on' : ''}`}
                        onClick={() => toggleCompare(p.id)}
                      >
                        {inCmp ? 'In compare' : 'Compare'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </main>
      )}

      {page === 'search' && (
        <SearchPage
          liveStock={liveStock}
          onAdd={add}
          onOpen={openProduct}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
        />
      )}

      {page === 'product' && selected && (
        <ProductPage
          product={selected}
          photoIndex={photoIndex}
          setPhotoIndex={setPhotoIndex}
          left={liveStock(selected)}
          compared={compareIds.includes(selected.id)}
          onToggleCompare={() => toggleCompare(selected.id)}
          onBack={() => go('shop')}
          onAdd={() => add(selected)}
          onOpen={openProduct}
          liveStock={liveStock}
          onAddRelated={add}
        />
      )}

      {page === 'compare' && (
        <ComparePage
          items={compareItems}
          liveStock={liveStock}
          onOpen={openProduct}
          onAdd={add}
          onRemove={toggleCompare}
          onClear={() => setCompareIds([])}
          onBack={() => go('shop')}
        />
      )}

      {page === 'builder' && (
        <BuilderPage
          build={build}
          setBuild={setBuild}
          liveStock={liveStock}
          onAdd={add}
          onOpen={openProduct}
          onGoCart={() => go('cart')}
          setToast={setToast}
        />
      )}

      {page === 'cart' && (
        <main className="wrap page">
          <button className="back" onClick={() => go('shop')}>← Continue shopping</button>
          <h1 style={{ marginBottom: 16 }}>Cart</h1>
          {reserved ? (
            <div className="ok-box">
              <h2>Reserved · {reserved.code}</h2>
              <p>
                {reserved.name}, we are preparing your order for {reserved.slot}.
                Pickup at {STORE.address}. Pay in dinars at the desk.
              </p>
              <p className="short">Show this code at the desk: <strong>{reserved.code}</strong></p>
              <button className="add" onClick={() => { setReserved(null); go('shop') }}>Back to shop</button>
            </div>
          ) : cart.length === 0 ? (
            <p className="empty">Your cart is empty.</p>
          ) : (
            <div className="cart-grid">
              <div className="cart-list">
                {cart.map((i) => (
                  <div className="item" key={i.id}>
                    <div className="item-thumb"><PartThumb product={i} /></div>
                    <div>
                      <div className="sku">{i.sku}</div>
                      <h3>{i.name}</h3>
                      <div className="qty">
                        <button onClick={() => setQty(i.id, i.qty - 1)}>-</button>
                        <span>{i.qty}</span>
                        <button onClick={() => setQty(i.id, i.qty + 1)}>+</button>
                        <button className="remove" onClick={() => remove(i.id)}>Remove</button>
                      </div>
                    </div>
                    <strong>{money(i.qty * i.price)}</strong>
                  </div>
                ))}
              </div>

              <div>
                {blocks.length > 0 && (
                  <div className="warn danger">
                    <h3>Will not run / will overheat</h3>
                    {blocks.map((w) => <p key={w}>{w}</p>)}
                    <p className="short">Fix this mix before you pay. The desk will refuse a high-gamme GPU on a weak CPU or board.</p>
                  </div>
                )}
                {notes.length > 0 && (
                  <div className="warn">
                    <h3>Watch this</h3>
                    {notes.map((w) => <p key={w}>{w}</p>)}
                    <p className="short">You can still reserve. The desk will confirm before you pay.</p>
                  </div>
                )}

                <form className="callbox" onSubmit={reserve}>
                  <h2>Reserve for pickup</h2>
                  <p>We bag it. You collect it at El Makari Les Castors, Oran. Pay in DA at the desk.</p>
                  <div className="total">Total {money(total)}</div>
                  {total >= 30000 && <p className="pay3x">Or 3x {third(total)} at the desk (LICB-style).</p>}
                  <label htmlFor="name">Your name</label>
                  <input id="name" className="field" value={pickup.name} onChange={(e) => setPickup({ ...pickup, name: e.target.value })} required />
                  <label htmlFor="phone">Phone</label>
                  <input id="phone" className="field" value={pickup.phone} onChange={(e) => setPickup({ ...pickup, phone: e.target.value })} required />
                  <label htmlFor="slot">Time slot today</label>
                  <select id="slot" className="field" value={pickup.slot} onChange={(e) => setPickup({ ...pickup, slot: e.target.value })}>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button className="add wide" type="submit">Reserve pickup</button>
                  <div className="alt-row">
                    <a className="ghost" href={waHref} target="_blank" rel="noreferrer">WhatsApp this cart</a>
                    <a className="ghost" href={STORE.phoneHref}>Call {STORE.phone}</a>
                  </div>
                  <p className="short">{STORE.ready}</p>
                </form>
              </div>
            </div>
          )}
        </main>
      )}

      {page === 'about' && (
        <main className="wrap page">
          <div className="store-grid">
            <div className="store">
              <h1>About us</h1>
              <p>{STORE.about}</p>
              <p>{STORE.services}</p>
              <p>{STORE.buyNote}</p>
              <div className="about-panels">
                {SHOP_SERVICES.map((s) => (
                  <article className="about-panel" key={s.id}>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </article>
                ))}
              </div>
              <p><strong>{STORE.address}</strong></p>
              <p>{STORE.hours}</p>
              <p>{STORE.ready}</p>
              <p>{STORE.warranty}</p>
              <p><a href={`mailto:${STORE.email}`}>{STORE.email}</a></p>
              <p>Call <a href={STORE.phoneHref}>{STORE.phone}</a> · <a href={STORE.phone2Href}>{STORE.phone2}</a></p>
              <div className="social-grid">
                {STORE_LINKS.map((l) => (
                  <a
                    key={l.id}
                    className={`social-btn social-${l.id}`}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="social-ico" aria-hidden>
                      {l.id === 'instagram' && (
                        <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor"/></svg>
                      )}
                      {l.id === 'facebook' && (
                        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M14.5 8.5V6.8c0-.7.5-1.1 1.2-1.1H17V3.2h-2.1C12.4 3.2 11 4.7 11 7v1.5H9v2.6h2V21h3.5v-9.9h2.4l.3-2.6h-2.7z"/></svg>
                      )}
                      {l.id === 'whatsapp' && (
                        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3.2A8.7 8.7 0 0 0 4.4 16.4L3.2 21l4.7-1.2A8.8 8.8 0 1 0 12 3.2zm4.9 12.4c-.2.6-1.2 1.1-1.7 1.1-.4 0-.9.2-3-.8-2.5-1.2-4.1-3.9-4.2-4.1-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.6.7 2 .8 2.1.1.2.1.3 0 .5l-.3.5c-.1.2-.3.4-.1.7.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.1.3.1.4.1.6-.1l.8-1.1c.2-.2.3-.2.6-.1l1.7.8c.3.1.4.2.5.3.1.3 0 .9-.2 1.5z"/></svg>
                      )}
                      {l.id === 'maps' && (
                        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3.2c-3.3 0-6 2.5-6 6.1 0 4.5 6 11.5 6 11.5s6-7 6-11.5c0-3.6-2.7-6.1-6-6.1zm0 8.3a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z"/></svg>
                      )}
                    </span>
                    <span>
                      <strong>{l.label}</strong>
                      <em>{l.sub}</em>
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <div className="map-wrap">
              <iframe title="PC Star map" src={STORE.mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              <a className="map-link" href={STORE.mapUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </div>
          </div>
        </main>
      )}

      {page === 'desk' && (
        <main className="wrap page">
          <h1 style={{ marginBottom: 8 }}>Desk list</h1>
          <p className="short" style={{ marginBottom: 18 }}>For the store: reservations to prepare. Newest first.</p>
          {reservations.length === 0 ? (
            <p className="empty">No reservations yet.</p>
          ) : (
            <div className="desk-list">
              {reservations.map((r) => (
                <article className="desk-card" key={r.code}>
                  <header>
                    <strong>{r.code}</strong>
                    <span>{r.slot} · {r.at}</span>
                  </header>
                  <p>{r.name} · {r.phone}</p>
                  <ul>
                    {r.items.map((i) => (
                      <li key={i.id}>{i.qty} × {i.name} <span className="sku">{i.sku}</span></li>
                    ))}
                  </ul>
                  <div className="total">Due in store {money(r.total)}</div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {compareIds.length > 0 && page !== 'compare' && (
        <div className="compare-tray">
          <div className="wrap tray-inner">
            <div className="tray-items">
              {compareItems.map((p) => (
                <button key={p.id} type="button" className="tray-chip" onClick={() => toggleCompare(p.id)}>
                  {p.name} ×
                </button>
              ))}
            </div>
            <div className="tray-actions">
              <button className="add" disabled={compareIds.length < 2} onClick={() => go('compare')}>
                Compare {compareIds.length}
              </button>
              <button className="ghost tiny" onClick={() => setCompareIds([])}>Clear</button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <div className="wrap">{STORE.name} · {STORE.address} · {STORE.phone} · Prices in DA</div>
      </footer>

      <a className="wa-fab" href={`https://wa.me/${STORE.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function ProductPage({ product, photoIndex, setPhotoIndex, left, compared, onToggleCompare, onBack, onAdd, onOpen, liveStock, onAddRelated }) {
  const st = stockLabel(left)
  const photos = product.photos || []
  const also = relatedOf(product)
  return (
    <main className="wrap page">
      <button className="back" onClick={onBack}>← Back to shop</button>
      <div className="pdp">
        <div>
          <div className="pdp-photo">
            {photos.length > 0 ? <img src={photos[photoIndex]} alt={product.name} /> : <PartThumb product={product} />}
            <span className={`badge ${st.cls}`}>{st.text}</span>
          </div>
          {photos.length > 1 && (
            <div className="thumbs">
              {photos.map((src, i) => (
                <button key={src + i} className={i === photoIndex ? 'on' : ''} onClick={() => setPhotoIndex(i)}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pdp-info">
          <div className="sku">{product.sku} · {product.brand}</div>
          <h1>{product.name}</h1>
          <Stars product={product} />
          <div className="short">{product.short}</div>
          <div className="price">{money(product.price)}</div>
          <div className={`need ${left <= 0 ? 'out' : ''}`}>{product.needs}</div>
          {product.price >= 30000 && <p className="pay3x">3x {third(product.price)} at the desk</p>}
          <p className="short">Reserve, collect in Oran, pay in DA. 1-year shop warranty.</p>
          <div className="alt-row">
            <button className="add" disabled={left <= 0} onClick={onAdd}>
              {left <= 0 ? 'Sold out' : 'Add to cart'}
            </button>
            <button type="button" className={`ghost ${compared ? 'on' : ''}`} onClick={onToggleCompare}>
              {compared ? 'In compare' : 'Add to compare'}
            </button>
            <a className="ghost" href={`https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(`Salam, I want ${product.name} (${product.sku}) — ${money(product.price)}`)}`} target="_blank" rel="noreferrer">Ask on WhatsApp</a>
          </div>
        </div>
      </div>

      {(REVIEWS[product.id] || []).length > 0 && (
        <section className="reviews">
          <h2>Customer reviews</h2>
          <div className="review-list">
            {REVIEWS[product.id].map((r, i) => (
              <article className="review" key={i}>
                <div className="stars"><span>{starText(r.stars)}</span><em>{r.name}</em><span className="rev">{r.city}</span></div>
                <p>{r.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {also.length > 0 && (
        <section className="also">
          <h2>People also bought</h2>
          <div className="also-row">
            {also.map((p) => {
              const l = liveStock(p)
              return (
                <article className="also-card" key={p.id}>
                  <button type="button" className="also-thumb" onClick={() => onOpen(p.id)}>
                    <PartThumb product={p} />
                  </button>
                  <h3><button type="button" onClick={() => onOpen(p.id)}>{p.name}</button></h3>
                  <Stars product={p} />
                  <div className="price">{money(p.price)}</div>
                  <button className="add" disabled={l <= 0} onClick={() => onAddRelated(p)}>
                    {l <= 0 ? 'Sold out' : 'Add'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}
    </main>
  )
}

function ComparePage({ items, liveStock, onOpen, onAdd, onRemove, onClear, onBack }) {
  return (
    <main className="wrap page">
      <button className="back" onClick={onBack}>← Back to shop</button>
      <div className="compare-head">
        <h1>Compare</h1>
        <button className="ghost tiny" onClick={onClear} disabled={items.length === 0}>Clear all</button>
      </div>
      {items.length < 2 ? (
        <p className="empty">Pick 2 or 3 products from the shop or search, then compare.</p>
      ) : (
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Spec</th>
                {items.map((p) => (
                  <th key={p.id}>
                    <button type="button" className="cmp-photo" onClick={() => onOpen(p.id)}>
                      <PartThumb product={p} />
                    </button>
                    <button type="button" className="cmp-name" onClick={() => onOpen(p.id)}>{p.name}</button>
                    <div className="price">{money(p.price)}</div>
                    <Stars product={p} />
                    <div className="alt-row">
                      <button className="add" disabled={liveStock(p) <= 0} onClick={() => onAdd(p)}>
                        {liveStock(p) <= 0 ? 'Sold out' : 'Add'}
                      </button>
                      <button className="ghost tiny" onClick={() => onRemove(p.id)}>Remove</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  {items.map((p) => (
                    <td key={p.id}>{f.value(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
