import { useEffect, useMemo, useState } from 'react'
import {
  BRANDS_DZ_PRIORITY,
  CATEGORIES,
  DEALS,
  GUIDES,
  PART_LINES,
  PAYMENT_HINTS,
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
  starText,
  third
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
    if (next === 'desk' && !isMaster) {
      setToast(t('masterOnlyDesk'))
      setAuthOpen(true)
      return
    }
    if (next === 'master' && !isMaster) {
      setToast(t('masterForbidden'))
      setAuthOpen(true)
      return
    }
    if (next === 'profile' && !user) {
      setAuthOpen(true)
      return
    }
    setPage(next)
    setNavOpen(false)
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
      payment: pickup.payment,
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
      <header className="wrap nav">
        <button className="logo" type="button" onClick={() => go('shop')}>
          PC <span>Star</span>
        </button>

        <nav className={`nav-links ${navOpen ? 'open' : ''}`}>
          <button type="button" className={page === 'shop' || page === 'product' ? 'on' : ''} onClick={() => go('shop')}>
            {t('navShop')}
          </button>
          <button type="button" className={page === 'search' ? 'on' : ''} onClick={() => go('search')}>
            {t('navSearch')}
          </button>
          <button type="button" className={page === 'builder' ? 'on' : ''} onClick={() => go('builder')}>
            {t('navBuilder')}
          </button>
          <button type="button" className={page === 'about' ? 'on' : ''} onClick={() => go('about')}>
            {t('navAbout')}
          </button>
          <button type="button" className={page === 'help' ? 'on' : ''} onClick={() => go('help')}>
            {t('navHelp')}
          </button>
          {isMaster && (
            <button type="button" className={page === 'desk' ? 'on' : ''} onClick={() => go('desk')}>
              {t('navDesk')}
            </button>
          )}
          {isMaster && (
            <button type="button" className={page === 'master' ? 'on' : ''} onClick={() => go('master')}>
              {t('navMaster')}
            </button>
          )}
          <button type="button" className="cart-btn" onClick={() => go('cart')}>
            {t('navCart')} {count}
          </button>
          {user ? (
            <>
              <button type="button" className={`account-btn ${page === 'profile' ? 'on' : ''}`} onClick={() => go('profile')}>
                <span>{user.name}</span>
              </button>
              <button type="button" className="ghost tiny" onClick={logout}>
                {t('navLogout')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost tiny"
              onClick={() => {
                setAuthOpen(true)
                setNavOpen(false)
              }}
            >
              {t('navLogin')}
            </button>
          )}
        </nav>

        <div className="nav-tools">
          <div className="lang-switch" role="group" aria-label={t('lang')}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" className={lang === l.id ? 'on' : ''} onClick={() => changeLang(l.id)}>
                {l.short}
              </button>
            ))}
          </div>
          <div className="theme-switch" role="group" aria-label="theme">
            {[
              ['system', t('themeSystem')],
              ['light', t('themeLight')],
              ['dark', t('themeDark')]
            ].map(([id, label]) => (
              <button key={id} type="button" className={themePref === id ? 'on' : ''} onClick={() => changeTheme(id)} title={label}>
                {id === 'light' ? '☀' : id === 'dark' ? '☾' : '◐'}
              </button>
            ))}
          </div>
          <button type="button" className="nav-burger" aria-label={t('navMenu')} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
            ☰
          </button>
        </div>
      </header>

      {page === 'shop' && (
        <main className="wrap page">
          <section className="hero hero-simple">
            <div>
              <h1>{t('heroTitle')}</h1>
              <p>{t('heroBody')}</p>
              <div className="trust-row">
                <span className="pickup">{STORE.address}</span>
                <span className="pickup">{t('pay3xBadge')}</span>
                <span className="pickup">{t('warrantyBadge')}</span>
                <button className="add" type="button" onClick={() => go('search')}>
                  {t('advancedSearch')}
                </button>
                <button className="ghost" type="button" onClick={() => go('builder')}>
                  {t('pcBuilder')}
                </button>
                <button className="ghost" type="button" onClick={() => go('help')}>
                  {t('navHelp')}
                </button>
              </div>
            </div>
          </section>

          <section className="deals">
            <h2>{t('thisWeek')}</h2>
            <div className="deal-row deal-row-wide">
              {DEALS.map((d) => {
                const p = catalog.find((x) => x.id === d.id)
                if (!p) return null
                return (
                  <article className="deal-card" key={d.id}>
                    <span className="deal-tag">{d.tag}</span>
                    <button type="button" className="deal-thumb" onClick={() => openProduct(p.id)}>
                      <PartThumb product={p} />
                    </button>
                    <h3>
                      <button type="button" onClick={() => openProduct(p.id)}>
                        {p.name}
                      </button>
                    </h3>
                    <div className="price">{money(p.price)}</div>
                    <p className="short">{d.note}</p>
                  </article>
                )
              })}
            </div>
          </section>

          {dzHits.length > 0 && (
            <section className="deals">
              <h2>{t('dzHits')}</h2>
              <div className="deal-row deal-row-wide">
                {dzHits.map((p) => (
                  <article className="deal-card" key={p.id}>
                    <span className="deal-tag dz">{t('tag_dz-hit')}</span>
                    <button type="button" className="deal-thumb" onClick={() => openProduct(p.id)}>
                      <PartThumb product={p} />
                    </button>
                    <h3>
                      <button type="button" onClick={() => openProduct(p.id)}>
                        {p.name}
                      </button>
                    </h3>
                    <div className="sku">{p.brand}</div>
                    <div className="price">{money(p.price)}</div>
                    <p className="short">{p.short}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="guides">
            <h2>{t('starConfigs')}</h2>
            <div className="guide-row guide-row-wide">
              {GUIDES.map((g) => (
                <article className="guide-card" key={g.id}>
                  <h3>{g.title}</h3>
                  <p>{g.body}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="brand-strip">
            <span className="brand-label">{t('dzBrands')}</span>
            <button type="button" className={`chip ${!brandFilter ? 'on' : ''}`} onClick={() => setBrandFilter(null)}>
              {t('cat_all')}
            </button>
            {BRANDS_DZ_PRIORITY.map((b) => (
              <button key={b} type="button" className={`chip ${brandFilter === b ? 'on' : ''}`} onClick={() => setBrandFilter(brandFilter === b ? null : b)}>
                {b}
              </button>
            ))}
          </div>

          <div className="toolbar">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
                {t(`cat_${c.id}`)}
              </button>
            ))}
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('navSearch')}
            />
          </div>

          {list.length === 0 ? (
            <p className="empty">{t('noProducts')}</p>
          ) : (
            <div className="grid">
              {list.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <article className="card" key={p.id}>
                    <button className="thumb" type="button" onClick={() => openProduct(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </button>
                    <div className="card-body">
                      <div className="sku">{p.sku}</div>
                      <h3>{p.name}</h3>
                      <Stars product={p} />
                      <div className="short">{p.short}</div>
                      {(p.tags || []).length > 0 && (
                        <div className="tag-row">
                          {(p.tags || []).slice(0, 2).map((tag) => (
                            <span className={`mini-tag tag-${tag}`} key={tag}>
                              {t(`tag_${tag}`) !== `tag_${tag}` ? t(`tag_${tag}`) : tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <div className="row">
                        <div className="price">{money(p.price)}</div>
                        <button className="add" type="button" disabled={left <= 0} onClick={() => add(p)}>
                          {left <= 0 ? t('soldOut') : t('add')}
                        </button>
                      </div>
                    </div>
                  </article>
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

      {page === 'cart' && (
        <main className="wrap page">
          <button className="back" type="button" onClick={() => go('shop')}>
            {t('continueShopping')}
          </button>
          <h1 style={{ marginBottom: 16 }}>{t('cartTitle')}</h1>
          {reserved ? (
            <div className="ok-box">
              <h2>{t('reservedTitle', { code: reserved.code })}</h2>
              <p>
                {t('reservedBody', {
                  name: reserved.name,
                  slot: reserved.slot,
                  address: STORE.address
                })}
              </p>
              <p className="short">
                {t('showCode')} <strong>{reserved.code}</strong>
              </p>
              <button
                className="add"
                type="button"
                onClick={() => {
                  setReserved(null)
                  go('shop')
                }}
              >
                {t('backToShop')}
              </button>
            </div>
          ) : cart.length === 0 ? (
            <p className="empty">{t('cartEmpty')}</p>
          ) : (
            <div className="cart-grid">
              <div className="cart-list">
                {cart.map((i) => (
                  <div className="item" key={i.id}>
                    <div className="item-thumb">
                      <PartThumb product={i} />
                    </div>
                    <div>
                      <div className="sku">{i.sku}</div>
                      <h3>{i.name}</h3>
                      <div className="qty">
                        <button type="button" onClick={() => setQty(i.id, i.qty - 1)}>
                          -
                        </button>
                        <span>{i.qty}</span>
                        <button type="button" onClick={() => setQty(i.id, i.qty + 1)}>
                          +
                        </button>
                        <button className="remove" type="button" onClick={() => remove(i.id)}>
                          {t('remove')}
                        </button>
                      </div>
                    </div>
                    <strong>{money(i.qty * i.price)}</strong>
                  </div>
                ))}
              </div>

              <div>
                {blocks.length > 0 && (
                  <div className="warn danger">
                    <h3>{t('willNotRun')}</h3>
                    {blocks.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                    <p className="short">{t('fixMix')}</p>
                  </div>
                )}
                {notes.length > 0 && (
                  <div className="warn">
                    <h3>{t('watchThis')}</h3>
                    {notes.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                    <p className="short">{t('canStillReserve')}</p>
                  </div>
                )}

                <form className="callbox" onSubmit={reserve}>
                  <h2>{t('reserveTitle')}</h2>
                  <p>{t('reserveBody')}</p>
                  <div className="total">
                    {t('total')} {money(total)}
                  </div>
                  {total >= 30000 && <p className="pay3x">{t('or3x', { amount: third(total) })}</p>}
                  <label htmlFor="name">{t('yourName')}</label>
                  <input id="name" className="field" value={pickup.name} onChange={(e) => setPickup({ ...pickup, name: e.target.value })} required />
                  <label htmlFor="phone">{t('phone')}</label>
                  <input
                    id="phone"
                    className="field"
                    value={pickup.phone}
                    onChange={(e) => {
                      setPickup({ ...pickup, phone: e.target.value })
                      setPhoneErr('')
                    }}
                    required
                    inputMode="tel"
                    placeholder="05xx / 06xx / 07xx"
                    aria-invalid={!!phoneErr}
                  />
                  <p className="short">
                    {t('carrierNote')}
                    {carrier === 'mobilis' && ` · ${t('carrierMobilis')}`}
                    {carrier === 'ooredoo' && ` · ${t('carrierOoredoo')}`}
                    {carrier === 'djezzy' && ` · ${t('carrierDjezzy')}`}
                  </p>
                  {phoneErr && <p className="form-error">{phoneErr}</p>}
                  <label htmlFor="wilaya">{t('wilaya')}</label>
                  <select id="wilaya" className="field" value={pickup.wilaya} onChange={(e) => setPickup({ ...pickup, wilaya: e.target.value })}>
                    {WILAYAS_NEAR.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="pay">{t('paymentMethod')}</label>
                  <select id="pay" className="field" value={pickup.payment} onChange={(e) => setPickup({ ...pickup, payment: e.target.value })}>
                    {PAYMENT_HINTS.map((h) => (
                      <option key={h.id} value={h.id}>
                        {t(h.key)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="slot">{t('timeSlot')}</label>
                  <select id="slot" className="field" value={pickup.slot} onChange={(e) => setPickup({ ...pickup, slot: e.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button className="add wide" type="submit">
                    {t('reservePickup')}
                  </button>
                  <div className="alt-row">
                    <a className="ghost" href={waHref} target="_blank" rel="noreferrer">
                      {t('whatsappCart')}
                    </a>
                    <a className="ghost" href={STORE.phoneHref}>
                      {t('call')} {STORE.phone}
                    </a>
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

      {page === 'help' && (
        <main className="wrap page">
          <h1 style={{ marginBottom: 12 }}>{t('helpTitle')}</h1>
          <div className="help-grid">
            <article className="callbox">
              <h2>1. {t('demoHowTitle')}</h2>
              <p>{t('demoHowBody')}</p>
              <ul className="help-list">
                <li>
                  <strong>{t('roleMaster')}</strong>
                  <code>pcstar.info31@gmail.com</code> / <code>star31</code>
                </li>
                <li>
                  <strong>Karim</strong>
                  <code>karim.oran@demo.dz</code> / <code>karim31</code>
                </li>
                <li>
                  <strong>Amina</strong>
                  <code>amina.castors@demo.dz</code> / <code>amina31</code>
                </li>
                <li>
                  <strong>Yacine</strong>
                  <code>yacine.pc@demo.dz</code> / <code>yacine31</code>
                </li>
              </ul>
              <button type="button" className="add" onClick={() => setAuthOpen(true)}>
                {t('navLogin')}
              </button>
              <p className="short" style={{ marginTop: 10 }}>
                {t('demoClickHint')}
              </p>
            </article>
            <article className="callbox">
              <h2>2. {t('roleMaster')}</h2>
              <ol className="help-list numbered">
                <li>{t('navLogin')} → master</li>
                <li>
                  {t('navMaster')} → {t('masterAddProduct')} / {t('masterHide')}
                </li>
                <li>
                  {t('navDesk')} → {t('deskHint')}
                </li>
              </ol>
              <p className="short">API multi-device: <code>npm run start:api</code> + <code>npm run dev</code></p>
            </article>
            <article className="callbox">
              <h2>3. {t('roleCustomer')}</h2>
              <ol className="help-list numbered">
                <li>
                  {t('navShop')} / {t('navSearch')} / {t('navBuilder')}
                </li>
                <li>
                  {t('navCart')} → tél 05/06/07 → {t('reservePickup')}
                </li>
                <li>Code PS-xxxxxx au comptoir Oran</li>
              </ol>
            </article>
            <article className="callbox">
              <h2>4. {t('navBuilder')}</h2>
              <p>{t('builderBody', { address: STORE.address })}</p>
              <p className="short">{t('willNotRun')} · {t('watchThis')}</p>
              <button type="button" className="ghost" onClick={() => go('builder')}>
                {t('pcBuilder')}
              </button>
            </article>
          </div>
        </main>
      )}

      {page === 'desk' && isMaster && (
        <main className="wrap page">
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

      <footer className="footer">
        <div className="wrap">
          {STORE.name} · {STORE.address} · {STORE.phone} · {t('pricesInDa')}
        </div>
      </footer>

      <a className="wa-fab" href={`https://wa.me/${STORE.whatsapp}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
      {toast && <div className="toast">{toast}</div>}

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
    <main className="wrap page">
      <button className="back" type="button" onClick={onBack}>
        {t('continueShopping')}
      </button>
      <div className="pdp">
        <div>
          <div className="pdp-photo">
            {photos.length > 0 ? <img src={photos[photoIndex]} alt={product.name} /> : <PartThumb product={product} />}
            <span className={`badge ${st.cls}`}>{st.text}</span>
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
        <div className="pdp-info">
          <div className="sku">
            {product.sku} · {product.brand}
          </div>
          <h1>{product.name}</h1>
          <Stars product={product} />
          <div className="short">{product.short}</div>
          <div className="price">{money(product.price)}</div>
          <div className={`need ${left <= 0 ? 'out' : ''}`}>{product.needs}</div>
          {product.price >= 30000 && <p className="pay3x">3x {third(product.price)}</p>}
          <div className="alt-row">
            <button className="add" type="button" disabled={left <= 0} onClick={onAdd}>
              {left <= 0 ? t('soldOut') : t('addToCart')}
            </button>
            <a
              className="ghost"
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
