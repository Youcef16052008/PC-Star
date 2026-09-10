import { useEffect, useMemo, useState } from 'react'
import {
  BRANDS_DZ_PRIORITY,
  CATEGORIES,
  DEALS,
  GUIDES,
  PART_LINES,
  PRODUCTS,
  REVIEWS,
  SLOTS,
  SHOP_SERVICES,
  STORE,
  STORE_LINKS,
  WILAYAS_NEAR,
  checkCompatibility,
  money,
  splitWarnings,
  starText
} from './data'
import * as api from './api.js'
import SearchPage from './SearchPage.jsx'
import BuilderPage from './BuilderPage.jsx'
import PartThumb from './PartThumb.jsx'
import AuthPanel from './AuthPanel.jsx'
import ProfilePage from './ProfilePage.jsx'
import MasterPage from './MasterPage.jsx'
import { t as translate, LANGS, langMeta } from './i18n.js'
import {
  applyDocumentChrome,
  loadLang,
  loadOrders,
  loadTheme,
  resolveTheme,
  saveLang,
  saveOrders,
  saveTheme
} from './prefs.js'
import {
  buildShopView,
  isDzPhone,
  loadMeta,
  loadSession,
  loadUsers,
  normalizePhone,
  phoneCarrier,
  saveMeta,
  saveSession,
  saveUsers
} from './shopStore.js'

const storage = typeof localStorage !== 'undefined' ? localStorage : null

const BASE_PANELS = [
  { id: 'parts', titleKey: 'panelParts' },
  { id: 'machines', titleKey: 'panelMachines' },
  { id: 'desk', titleKey: 'panelDesk' },
  { id: 'accessories', titleKey: 'panelAccessories' }
]

function stockLabel(n, t) {
  if (n <= 0) return { text: t('outOfStock'), cls: 'stock-out' }
  if (n <= 3) return { text: `${n} ${t('left')}`, cls: 'stock-low' }
  return { text: `${n} ${t('inStore')}`, cls: 'stock-ok' }
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
  const [lang, setLang] = useState(() => loadLang(storage))
  const [themePref, setThemePref] = useState(() => loadTheme(storage))
  const [theme, setTheme] = useState(() => resolveTheme(loadTheme(storage)))
  const [users, setUsers] = useState(() => loadUsers(storage))
  const [session, setSession] = useState(() => loadSession(storage))
  const [meta, setMeta] = useState(() => loadMeta(storage))
  const [page, setPage] = useState('shop')
  const [selectedId, setSelectedId] = useState(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [toast, setToast] = useState('')
  const [pickup, setPickup] = useState({
    name: '',
    phone: '',
    slot: SLOTS[2],
    wilaya: 'Oran',
    payment: 'cash'
  })
  const [phoneErr, setPhoneErr] = useState('')
  const [reservations, setReservations] = useState(() => loadOrders(storage))
  const [reserved, setReserved] = useState(null)
  const [build, setBuild] = useState({})
  const [authOpen, setAuthOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [apiOnline, setApiOnline] = useState(false)
  const [apiUser, setApiUser] = useState(null)
  const [authMode, setAuthMode] = useState('local')
  const [brandFilter, setBrandFilter] = useState(null)

  const t = (key, vars) => translate(lang, key, vars)
  const localUser = useMemo(() => {
    if (!session?.userId) return null
    return users.find((u) => u.id === session.userId) || null
  }, [session, users])
  const user = authMode === 'api' && apiUser ? apiUser : localUser
  const isMaster = user?.role === 'master'

  const shopView = useMemo(() => buildShopView(PRODUCTS, PART_LINES, BASE_PANELS, meta), [meta])
  const catalog = shopView.products

  useEffect(() => {
    const metaL = langMeta(lang)
    applyDocumentChrome({ lang, dir: metaL.dir, theme })
  }, [lang, theme])

  useEffect(() => {
    const apply = () => setTheme(resolveTheme(themePref))
    apply()
    if (themePref !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [themePref])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const h = await api.health()
      if (cancelled) return
      setApiOnline(Boolean(h?.ok))
      const token = api.getToken()
      if (token) {
        const me = await api.me()
        if (me.ok && me.data?.user) {
          setApiUser(me.data.user)
          setAuthMode('api')
        } else {
          api.setToken(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (user?.name && !pickup.name) setPickup((p) => ({ ...p, name: user.name }))
    if (user?.phone && !pickup.phone) setPickup((p) => ({ ...p, phone: user.phone }))
    if (user?.wilaya) setPickup((p) => ({ ...p, wilaya: user.wilaya }))
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isMaster || !apiOnline || authMode !== 'api') return undefined
    let cancelled = false
    ;(async () => {
      const r = await api.listOrders()
      if (!cancelled && r.ok && Array.isArray(r.data?.orders)) {
        setReservations(r.data.orders)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isMaster, apiOnline, authMode, page])

  function persistUsers(next) {
    setUsers(next)
    saveUsers(storage, next)
  }

  function persistSession(next) {
    setSession(next)
    saveSession(storage, next)
    if (next) {
      setAuthMode('local')
      setApiUser(null)
    }
  }

  function onApiUser(u) {
    setApiUser(u)
    setAuthMode('api')
    setSession(null)
    saveSession(storage, null)
  }

  function persistMeta(next) {
    setMeta(next)
    saveMeta(storage, next)
  }

  function changeLang(id) {
    setLang(id)
    saveLang(storage, id)
  }

  function changeTheme(id) {
    setThemePref(id)
    saveTheme(storage, id)
  }

  async function logout() {
    if (authMode === 'api') await api.logout()
    setApiUser(null)
    setAuthMode('local')
    persistSession(null)
    setToast(t('navLogout'))
    if (page === 'desk' || page === 'master' || page === 'profile' || page === 'help') {
      setPage('shop')
      window.scrollTo({ top: 0 })
    }
  }

  const selected = catalog.find((p) => p.id === selectedId)
  const count = cart.reduce((s, i) => s + i.qty, 0)
  const total = cart.reduce((s, i) => s + i.qty * i.price, 0)
  const warnings = useMemo(() => checkCompatibility(cart), [cart])
  const { blocks, notes } = useMemo(() => splitWarnings(warnings), [warnings])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((p) => {
      const catOk = category === 'all' || p.category === category
      const brandOk = !brandFilter || p.brand === brandFilter
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.short || '').toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      return catOk && brandOk && qOk
    })
  }, [category, query, catalog, brandFilter])

  const dzHits = useMemo(() => catalog.filter((p) => (p.tags || []).includes('dz-hit')).slice(0, 8), [catalog])

  function liveStock(product) {
    const inCart = cart.find((i) => i.id === product.id)
    return product.stock - (inCart ? inCart.qty : 0)
  }

  function add(product) {
    const left = liveStock(product)
    if (left <= 0) {
      setToast(t('outOfStock'))
      return
    }
    setCart((prev) => {
      const found = prev.find((i) => i.id === product.id)
      if (found) return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
      return [...prev, { ...product, qty: 1 }]
    })
    setToast(`${product.name} ${t('added')}`)
    setCartOpen(true)
  }

  function setQty(id, qty) {
    const product = catalog.find((p) => p.id === id)
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
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  function go(next) {
    if ((next === 'desk' || next === 'master' || next === 'help') && !isMaster) {
      setToast(t(next === 'help' ? 'masterOnlyGuide' : next === 'desk' ? 'masterOnlyDesk' : 'masterForbidden'))
      setAuthOpen(true)
      return
    }
    if (next === 'profile' && !user) {
      setAuthOpen(true)
      return
    }
    if (next === 'cart') {
      setCartOpen(true)
      setNavOpen(false)
      return
    }
    setPage(next)
    setNavOpen(false)
    setCartOpen(false)
    window.scrollTo({ top: 0 })
  }

  async function reserve(e) {
    e.preventDefault()
    if (!pickup.name.trim() || cart.length === 0) return
    if (!isDzPhone(pickup.phone)) {
      setPhoneErr(t('phoneInvalid'))
      return
    }
    setPhoneErr('')
    const base = {
      name: pickup.name.trim(),
      phone: normalizePhone(pickup.phone),
      carrier: phoneCarrier(pickup.phone),
      wilaya: pickup.wilaya,
      payment: 'cash',
      slot: pickup.slot,
      items: cart.map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        qty: i.qty,
        price: i.price
      })),
      total,
      userId: user?.id || null
    }

    if (apiOnline) {
      const r = await api.postOrder(base)
      if (r.ok && r.data?.order) {
        const order = {
          ...r.data.order,
          at: new Date(r.data.order.at || Date.now()).toLocaleString(
            lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB'
          )
        }
        setReservations((prev) => [order, ...prev])
        setReserved(order)
        setCart([])
        setToast(t('ordersSynced'))
        return
      }
    }

    const order = {
      code: `PS-${String(Date.now()).slice(-6)}`,
      ...base,
      at: new Date().toLocaleString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB')
    }
    const next = [order, ...reservations]
    setReservations(next)
    saveOrders(storage, next)
    setReserved(order)
    setCart([])
    setToast(apiOnline ? t('ordersSynced') : t('ordersLocalOnly'))
  }

  const msg = cartMessage(cart, total, pickup)
  const waHref = `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(msg)}`
  const carrier = phoneCarrier(pickup.phone)

  return (
    <div className={`app theme-${theme}`}>
      <div className="topbar text-white small py-2">
        <div className="container d-flex flex-wrap justify-content-between gap-2">
          <span>{STORE.address}</span>
          <span>
            <a className="link-light text-decoration-none fw-semibold" href={STORE.phoneHref}>
              {STORE.phone}
            </a>
            {' · '}
            {t('payCash')}
          </span>
        </div>
      </div>

      <nav className="navbar navbar-expand-lg sticky-top border-bottom shop-navbar">
        <div className="container">
          <button type="button" className="navbar-brand btn btn-link text-decoration-none p-0 logo" onClick={() => go('shop')}>
            PC <span>Star</span>
          </button>
          <div className="d-flex align-items-center gap-2 order-lg-last ms-auto ms-lg-0">
            <button type="button" className="btn btn-success position-relative" onClick={() => setCartOpen(true)}>
              {t('navCart')}
              {count > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{count}</span>
              )}
            </button>
            <button
              className="navbar-toggler"
              type="button"
              aria-label={t('navMenu')}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
            >
              <span className="navbar-toggler-icon" />
            </button>
          </div>
          <div className={`collapse navbar-collapse ${navOpen ? 'show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-lg-0 align-items-lg-center gap-lg-1">
              {[
                ['shop', t('navShop'), page === 'shop' || page === 'product'],
                ['search', t('navSearch'), page === 'search'],
                ['builder', t('navBuilder'), page === 'builder'],
                ['about', t('navAbout'), page === 'about']
              ].map(([id, label, on]) => (
                <li className="nav-item" key={id}>
                  <button type="button" className={`nav-link btn btn-link ${on ? 'active fw-semibold' : ''}`} onClick={() => go(id)}>
                    {label}
                  </button>
                </li>
              ))}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'help' ? 'active fw-semibold' : ''}`} onClick={() => go('help')}>
                    {t('navHelp')}
                  </button>
                </li>
              )}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'desk' ? 'active fw-semibold' : ''}`} onClick={() => go('desk')}>
                    {t('navDesk')}
                  </button>
                </li>
              )}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'master' ? 'active fw-semibold' : ''}`} onClick={() => go('master')}>
                    {t('navMaster')}
                  </button>
                </li>
              )}
            </ul>
            <div className="d-flex flex-wrap align-items-center gap-2 py-2 py-lg-0">
              <div className="btn-group btn-group-sm" role="group" aria-label={t('lang')}>
                {LANGS.map((l) => (
                  <button key={l.id} type="button" className={`btn ${lang === l.id ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => changeLang(l.id)}>
                    {l.short}
                  </button>
                ))}
              </div>
              <div className="btn-group btn-group-sm" role="group" aria-label="theme">
                {[
                  ['system', '◐'],
                  ['light', '☀'],
                  ['dark', '☾']
                ].map(([id, mark]) => (
                  <button key={id} type="button" className={`btn ${themePref === id ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => changeTheme(id)}>
                    {mark}
                  </button>
                ))}
              </div>
              {user ? (
                <>
                  <button type="button" className={`btn btn-sm ${page === 'profile' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => go('profile')}>
                    {user.name}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={logout}>
                    {t('navLogout')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-sm btn-outline-success" onClick={() => { setAuthOpen(true); setNavOpen(false) }}>
                  {t('navLogin')}
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {page === 'shop' && (
        <main className="container page py-4">
          <section className="hero hero-simple p-4 p-md-5 mb-4 rounded-4 border">
            <h1 className="display-5 fw-bold mb-2">{t('heroTitle')}</h1>
            <p className="lead text-secondary mb-3">{t('heroBody')}</p>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <span className="badge text-bg-light border">{STORE.address}</span>
              <span className="badge text-bg-success-subtle border border-success-subtle text-success-emphasis">{t('payCash')}</span>
              <span className="badge text-bg-light border">{t('warrantyBadge')}</span>
            </div>
            <div className="d-flex flex-wrap gap-2 mt-3">
              <button className="btn btn-success" type="button" onClick={() => go('search')}>{t('advancedSearch')}</button>
              <button className="btn btn-outline-secondary" type="button" onClick={() => go('builder')}>{t('pcBuilder')}</button>
              {isMaster && (
                <button className="btn btn-outline-secondary" type="button" onClick={() => go('help')}>{t('navHelp')}</button>
              )}
            </div>
          </section>

          <section className="mb-4">
            <h2 className="h4 mb-3">{t('thisWeek')}</h2>
            <div className="row g-3">
              {DEALS.map((d) => {
                const p = catalog.find((x) => x.id === d.id)
                if (!p) return null
                return (
                  <div className="col-12 col-sm-6 col-lg-3" key={d.id}>
                    <div className="card h-100 shadow-sm product-bs-card">
                      <span className="badge text-bg-danger position-absolute m-2 z-1">{d.tag}</span>
                      <button type="button" className="btn p-0 border-0 bg-transparent" onClick={() => openProduct(p.id)}>
                        <div className="ratio ratio-1x1 bg-body-secondary rounded-top overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                      </button>
                      <div className="card-body">
                        <h3 className="h6 card-title">
                          <button type="button" className="btn btn-link p-0 text-start text-decoration-none text-body" onClick={() => openProduct(p.id)}>
                            {p.name}
                          </button>
                        </h3>
                        <div className="fw-bold text-success">{money(p.price)}</div>
                        <p className="card-text small text-secondary mb-0">{d.note}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {dzHits.length > 0 && (
            <section className="mb-4">
              <h2 className="h4 mb-3">{t('dzHits')}</h2>
              <div className="row g-3">
                {dzHits.map((p) => (
                  <div className="col-6 col-md-4 col-lg-3" key={p.id}>
                    <div className="card h-100 shadow-sm product-bs-card">
                      <span className="badge text-bg-success position-absolute m-2 z-1">{t('tag_dz-hit')}</span>
                      <button type="button" className="btn p-0 border-0" onClick={() => openProduct(p.id)}>
                        <div className="ratio ratio-1x1 bg-body-secondary overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                      </button>
                      <div className="card-body p-3">
                        <div className="small text-secondary">{p.brand}</div>
                        <h3 className="h6">
                          <button type="button" className="btn btn-link p-0 text-start text-decoration-none text-body" onClick={() => openProduct(p.id)}>
                            {p.name}
                          </button>
                        </h3>
                        <div className="fw-bold text-success">{money(p.price)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mb-4">
            <h2 className="h4 mb-3">{t('starConfigs')}</h2>
            <div className="row g-3">
              {GUIDES.map((g) => (
                <div className="col-md-6 col-lg-4" key={g.id}>
                  <div className="card h-100 border-0 shadow-sm">
                    <div className="card-body">
                      <h3 className="h6 card-title">{g.title}</h3>
                      <p className="card-text small text-secondary mb-0">{g.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <span className="small fw-semibold text-secondary">{t('dzBrands')}</span>
            <button type="button" className={`btn btn-sm ${!brandFilter ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setBrandFilter(null)}>
              {t('cat_all')}
            </button>
            {BRANDS_DZ_PRIORITY.map((b) => (
              <button key={b} type="button" className={`btn btn-sm ${brandFilter === b ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setBrandFilter(brandFilter === b ? null : b)}>
                {b}
              </button>
            ))}
          </div>

          <div className="d-flex flex-wrap gap-2 align-items-center mb-4">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={`btn btn-sm rounded-pill ${category === c.id ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setCategory(c.id)}>
                {t(`cat_${c.id}`)}
              </button>
            ))}
            <input
              className="form-control form-control-sm ms-lg-auto"
              style={{ maxWidth: 280 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('navSearch')}
            />
          </div>

          {list.length === 0 ? (
            <p className="text-secondary">{t('noProducts')}</p>
          ) : (
            <div className="row g-3">
              {list.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <div className="col-6 col-md-4 col-xl-3" key={p.id}>
                    <div className="card h-100 shadow-sm product-bs-card">
                      <button className="btn p-0 border-0 position-relative" type="button" onClick={() => openProduct(p.id)} aria-label={p.name}>
                        <div className="ratio ratio-1x1 bg-body-secondary overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                        <span className={`badge position-absolute top-0 end-0 m-2 ${st.cls === 'stock-ok' ? 'text-bg-success' : st.cls === 'stock-low' ? 'text-bg-warning' : 'text-bg-danger'}`}>
                          {st.text}
                        </span>
                      </button>
                      <div className="card-body d-flex flex-column">
                        <div className="small text-secondary">{p.sku}</div>
                        <h3 className="h6 card-title">{p.name}</h3>
                        <Stars product={p} />
                        <div className="small text-secondary mb-2">{p.short}</div>
                        {(p.tags || []).length > 0 && (
                          <div className="d-flex flex-wrap gap-1 mb-2">
                            {(p.tags || []).slice(0, 2).map((tag) => (
                              <span className="badge text-bg-light border" key={tag}>
                                {t(`tag_${tag}`) !== `tag_${tag}` ? t(`tag_${tag}`) : tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-auto d-flex justify-content-between align-items-center gap-2">
                          <div className="fw-bold text-success">{money(p.price)}</div>
                          <button className="btn btn-sm btn-success" type="button" disabled={left <= 0} onClick={() => add(p)}>
                            {left <= 0 ? t('soldOut') : t('add')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      )}

      {page === 'search' && (
        <SearchPage t={t} products={catalog} lines={shopView.lines} panels={shopView.panels} lang={lang} liveStock={liveStock} onAdd={add} onOpen={openProduct} />
      )}

      {page === 'product' && selected && (
        <ProductPage
          t={t}
          product={selected}
          photoIndex={photoIndex}
          setPhotoIndex={setPhotoIndex}
          left={liveStock(selected)}
          onBack={() => go('shop')}
          onAdd={() => add(selected)}
          onOpen={openProduct}
          liveStock={liveStock}
          onAddRelated={add}
          catalog={catalog}
        />
      )}

      {page === 'builder' && (
        <BuilderPage
          t={t}
          products={catalog}
          build={build}
          setBuild={setBuild}
          liveStock={liveStock}
          onAdd={add}
          onOpen={openProduct}
          onGoCart={() => go('cart')}
          setToast={setToast}
        />
      )}

      {page === 'about' && (
        <main className="container page py-4">
          <div className="store-grid">
            <div className="store">
              <h1>{t('aboutTitle')}</h1>
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
              <p>
                <strong>{STORE.address}</strong>
              </p>
              <p>{STORE.hours}</p>
              <p>{STORE.ready}</p>
              <p>{STORE.warranty}</p>
              <p>
                <a href={`mailto:${STORE.email}`}>{STORE.email}</a>
              </p>
              <p>
                {t('call')} <a href={STORE.phoneHref}>{STORE.phone}</a> · <a href={STORE.phone2Href}>{STORE.phone2}</a>
              </p>
              <div className="social-grid">
                {STORE_LINKS.map((l) => (
                  <a key={l.id} className={`social-btn social-${l.id}`} href={l.href} target="_blank" rel="noreferrer">
                    <strong>{l.label}</strong>
                    <em style={{ display: 'block', fontStyle: 'normal', opacity: 0.9, fontSize: 12 }}>{l.sub}</em>
                  </a>
                ))}
              </div>
            </div>
            <div className="map-wrap">
              <iframe title="PC Star map" src={STORE.mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              <a className="map-link" href={STORE.mapUrl} target="_blank" rel="noreferrer">
                Google Maps
              </a>
            </div>
          </div>
        </main>
      )}

      {page === 'help' && isMaster && (
        <main className="container page py-4">
          <div className="alert alert-warning border-0 shadow-sm" role="status">
            {t('masterOnlyGuideNote')}
          </div>
          <h1 className="h3 mb-3">{t('helpTitle')}</h1>
          <div className="row g-3">
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">1. {t('authTitle')}</h2>
                  <p>{t('authSimpleNote')}</p>
                  <p className="small text-secondary">{t('helpNoPublicDemo')}</p>
                  <button type="button" className="btn btn-success" onClick={() => setAuthOpen(true)}>
                    {t('navLogin')}
                  </button>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">2. {t('roleMaster')}</h2>
                  <ol className="mb-2 ps-3">
                    <li>{t('navLogin')} → master</li>
                    <li>
                      {t('navMaster')} → {t('masterAddProduct')} / {t('masterHide')}
                    </li>
                    <li>
                      {t('navDesk')} → {t('deskHint')}
                    </li>
                  </ol>
                  <p className="small text-secondary mb-0">
                    API multi-device: <code>npm run start:api</code> + <code>npm run dev</code>
                  </p>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">3. {t('roleCustomer')}</h2>
                  <ol className="mb-0 ps-3">
                    <li>
                      {t('navShop')} / {t('navSearch')} / {t('navBuilder')}
                    </li>
                    <li>
                      {t('navCart')} → tél 05/06/07 → {t('reservePickup')}
                    </li>
                    <li>Code PS-xxxxxx au comptoir Oran</li>
                  </ol>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">4. {t('navBuilder')}</h2>
                  <p>{t('builderBody', { address: STORE.address })}</p>
                  <p className="small text-secondary">
                    {t('willNotRun')} · {t('watchThis')}
                  </p>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => go('builder')}>
                    {t('pcBuilder')}
                  </button>
                </div>
              </article>
            </div>
          </div>
        </main>
      )}

      {page === 'desk' && isMaster && (
        <main className="container page py-4">
          <h1 style={{ marginBottom: 8 }}>{t('deskTitle')}</h1>
          <p className="short" style={{ marginBottom: 18 }}>
            {t('deskHint')}
          </p>
          {reservations.length === 0 ? (
            <p className="empty">{t('deskEmpty')}</p>
          ) : (
            <div className="desk-list">
              {reservations.map((r) => (
                <article className="desk-card" key={r.code}>
                  <header>
                    <strong>{r.code}</strong>
                    <span>
                      {r.slot} · {r.at}
                    </span>
                  </header>
                  <p>
                    {r.name} · {r.phone}
                    {r.carrier ? ` · ${r.carrier}` : ''}
                    {r.wilaya ? ` · ${r.wilaya}` : ''}
                    {r.payment ? ` · ${r.payment}` : ''}
                  </p>
                  <ul>
                    {r.items.map((i) => (
                      <li key={i.id}>
                        {i.qty} × {i.name} <span className="sku">{i.sku}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="total">
                    {t('dueInStore')} {money(r.total)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {page === 'profile' && user && (
        <ProfilePage
          t={t}
          user={user}
          users={users}
          onUsers={persistUsers}
          onUser={(u) => {
            if (authMode === 'api') setApiUser(u)
            else persistSession({ userId: u.id })
          }}
          setToast={setToast}
          onBack={() => go('shop')}
          apiOnline={apiOnline}
          mode={authMode}
        />
      )}

      {page === 'master' && (
        <MasterPage
          t={t}
          lang={lang}
          user={user}
          users={users}
          onUsers={persistUsers}
          products={catalog}
          meta={meta}
          onMeta={persistMeta}
          basePanels={BASE_PANELS}
          setToast={setToast}
          onBack={() => go('shop')}
        />
      )}

            <footer className="site-footer">
        <div className="container d-flex flex-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>PC Star Informatique</strong>
            <div className="short">{STORE.address}</div>
            <div className="short">{t('payCash')} · {t('warrantyBadge')} · {t('pricesInDa')}</div>
          </div>
          <div className="alt-row" style={{ gap: 10 }}>
            <a className="ghost" href={STORE.phoneHref}>{t('call')} {STORE.phone}</a>
            <a className="ghost" href={`https://wa.me/${STORE.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <button type="button" className="ghost" onClick={() => go('about')}>{t('navAbout')}</button>
          </div>
        </div>
      </footer>

      <a className="wa-fab" href={`https://wa.me/${STORE.whatsapp}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>

      {/* Cart offcanvas */}
      <div
        className={`offcanvas offcanvas-end ${cartOpen ? 'show' : ''}`}
        tabIndex={-1}
        style={{ visibility: cartOpen ? 'visible' : 'hidden' }}
        aria-labelledby="cartOffcanvasLabel"
      >
        <div className="offcanvas-header border-bottom">
          <h2 className="offcanvas-title h5 mb-0" id="cartOffcanvasLabel">
            {t('cartTitle')} {count > 0 ? `(${count})` : ''}
          </h2>
          <button type="button" className="btn-close" aria-label={t('close')} onClick={() => setCartOpen(false)} />
        </div>
        <div className="offcanvas-body d-flex flex-column">
          {reserved ? (
            <div className="alert alert-success">
              <h3 className="h6">{t('reservedTitle', { code: reserved.code })}</h3>
              <p className="mb-2">
                {t('reservedBody', { name: reserved.name, slot: reserved.slot, address: STORE.address })}
              </p>
              <p className="small mb-3">
                {t('showCode')} <strong>{reserved.code}</strong>
              </p>
              <button
                className="btn btn-success"
                type="button"
                onClick={() => {
                  setReserved(null)
                  setCartOpen(false)
                  go('shop')
                }}
              >
                {t('backToShop')}
              </button>
            </div>
          ) : cart.length === 0 ? (
            <p className="text-secondary">{t('cartEmpty')}</p>
          ) : (
            <>
              <div className="list-group list-group-flush mb-3 flex-grow-1 overflow-auto">
                {cart.map((i) => (
                  <div className="list-group-item px-0" key={i.id}>
                    <div className="d-flex gap-3">
                      <div style={{ width: 64, height: 64 }} className="rounded overflow-hidden bg-body-secondary flex-shrink-0">
                        <PartThumb product={i} />
                      </div>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">{i.sku}</div>
                        <div className="fw-semibold">{i.name}</div>
                        <div className="d-flex align-items-center gap-2 mt-1">
                          <div className="btn-group btn-group-sm">
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setQty(i.id, i.qty - 1)}>-</button>
                            <span className="btn btn-outline-secondary disabled">{i.qty}</span>
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setQty(i.id, i.qty + 1)}>+</button>
                          </div>
                          <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => remove(i.id)}>
                            {t('remove')}
                          </button>
                          <strong className="ms-auto">{money(i.qty * i.price)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {blocks.length > 0 && (
                <div className="alert alert-danger py-2">
                  <strong>{t('willNotRun')}</strong>
                  {blocks.map((w) => (
                    <div key={w} className="small">{w}</div>
                  ))}
                </div>
              )}
              {notes.length > 0 && (
                <div className="alert alert-warning py-2">
                  <strong>{t('watchThis')}</strong>
                  {notes.map((w) => (
                    <div key={w} className="small">{w}</div>
                  ))}
                </div>
              )}

              <form onSubmit={reserve} className="border-top pt-3 mt-auto">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="fw-semibold">{t('total')}</span>
                  <span className="fs-5 fw-bold text-success">{money(total)}</span>
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="name">{t('yourName')}</label>
                  <input id="name" className="form-control" value={pickup.name} onChange={(e) => setPickup({ ...pickup, name: e.target.value })} required />
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="phone">{t('phone')}</label>
                  <input
                    id="phone"
                    className={`form-control ${phoneErr ? 'is-invalid' : ''}`}
                    value={pickup.phone}
                    onChange={(e) => {
                      setPickup({ ...pickup, phone: e.target.value })
                      setPhoneErr('')
                    }}
                    required
                    inputMode="tel"
                    placeholder="05xx / 06xx / 07xx"
                  />
                  {phoneErr && <div className="invalid-feedback d-block">{phoneErr}</div>}
                  <div className="form-text">
                    {t('carrierNote')}
                    {carrier === 'mobilis' && ` · ${t('carrierMobilis')}`}
                    {carrier === 'ooredoo' && ` · ${t('carrierOoredoo')}`}
                    {carrier === 'djezzy' && ` · ${t('carrierDjezzy')}`}
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="wilaya">{t('wilaya')}</label>
                  <select id="wilaya" className="form-select" value={pickup.wilaya} onChange={(e) => setPickup({ ...pickup, wilaya: e.target.value })}>
                    {WILAYAS_NEAR.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">{t('paymentMethod')}</label>
                  <div className="form-control bg-success-subtle border-success-subtle fw-semibold">{t('payCash')}</div>
                </div>
                <div className="mb-3">
                  <label className="form-label small mb-1" htmlFor="slot">{t('timeSlot')}</label>
                  <select id="slot" className="form-select" value={pickup.slot} onChange={(e) => setPickup({ ...pickup, slot: e.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-success w-100 mb-2" type="submit">{t('reservePickup')}</button>
                <div className="d-grid gap-2">
                  <a className="btn btn-outline-secondary btn-sm" href={waHref} target="_blank" rel="noreferrer">{t('whatsappCart')}</a>
                  <a className="btn btn-outline-secondary btn-sm" href={STORE.phoneHref}>{t('call')} {STORE.phone}</a>
                </div>
                <p className="small text-secondary mt-2 mb-0">{STORE.ready}</p>
              </form>
            </>
          )}
        </div>
      </div>
      {cartOpen && <div className="offcanvas-backdrop fade show" onClick={() => setCartOpen(false)} />}

      {toast && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1100 }}>
          <div className="toast show align-items-center text-bg-success border-0" role="status">
            <div className="d-flex">
              <div className="toast-body">{toast}</div>
              <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={() => setToast('')} aria-label={t('close')} />
            </div>
          </div>
        </div>
      )}


      {authOpen && (
        <AuthPanel
          t={t}
          users={users}
          onUsers={persistUsers}
          onSession={persistSession}
          onClose={() => setAuthOpen(false)}
          setToast={setToast}
          apiOnline={apiOnline}
          onApiUser={onApiUser}
        />
      )}
      <div className={`api-status ${apiOnline ? 'on' : ''}`} title={apiOnline ? t('backendOnline') : t('backendOffline')}>
        {apiOnline ? '● API' : '○ local'}
      </div>
    </div>
  )
}

function ProductPage({ t, product, photoIndex, setPhotoIndex, left, onBack, onAdd, onOpen, liveStock, onAddRelated, catalog }) {
  const st = stockLabel(left, t)
  const photos = product.photos || []
  const also = (product.related || []).map((id) => catalog.find((p) => p.id === id)).filter(Boolean)
  return (
    <main className="container page py-4">
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('continueShopping')}
      </button>
      <div className="row g-4 pdp">
        <div className="col-md-6">
          <div className="pdp-photo position-relative rounded overflow-hidden border bg-body-secondary">
            {photos.length > 0 ? <img src={photos[photoIndex]} alt={product.name} className="w-100" /> : <PartThumb product={product} />}
            <span className={`badge position-absolute top-0 end-0 m-2 ${st.cls === 'stock-ok' ? 'text-bg-success' : st.cls === 'stock-low' ? 'text-bg-warning' : 'text-bg-danger'}`}>{st.text}</span>
          </div>
          {photos.length > 1 && (
            <div className="thumbs">
              {photos.map((src, i) => (
                <button key={src + i} type="button" className={i === photoIndex ? 'on' : ''} onClick={() => setPhotoIndex(i)}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-md-6 pdp-info">
          <div className="sku">
            {product.sku} · {product.brand}
          </div>
          <h1>{product.name}</h1>
          <Stars product={product} />
          <div className="short">{product.short}</div>
          <div className="price">{money(product.price)}</div>
          <div className={`need ${left <= 0 ? 'out' : ''}`}>{product.needs}</div>
          <div className="alt-row">
            <button className="btn btn-success" type="button" disabled={left <= 0} onClick={onAdd}>
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
        </div>
      </div>

      {(REVIEWS[product.id] || []).length > 0 && (
        <section className="reviews">
          <h2>{t('customerReviews')}</h2>
          <div className="review-list">
            {REVIEWS[product.id].map((r, i) => (
              <article className="review" key={i}>
                <div className="stars">
                  <span>{starText(r.stars)}</span>
                  <em>{r.name}</em>
                  <span className="rev">{r.city}</span>
                </div>
                <p>{r.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {also.length > 0 && (
        <section className="also">
          <h2>{t('alsoBought')}</h2>
          <div className="also-row">
            {also.map((p) => {
              const l = liveStock(p)
              return (
                <article className="also-card" key={p.id}>
                  <button type="button" className="also-thumb" onClick={() => onOpen(p.id)}>
                    <PartThumb product={p} />
                  </button>
                  <h3>
                    <button type="button" onClick={() => onOpen(p.id)}>
                      {p.name}
                    </button>
                  </h3>
                  <Stars product={p} />
                  <div className="price">{money(p.price)}</div>
                  <button className="add" type="button" disabled={l <= 0} onClick={() => onAddRelated(p)}>
                    {l <= 0 ? t('soldOut') : t('add')}
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
