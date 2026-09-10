import { useMemo, useState } from 'react'
import { PRICE_PRESETS, SOCKETS, STORE, money, starText } from './data'
import PartThumb from './PartThumb.jsx'

function stockLabel(n, t) {
  if (n <= 0) return { text: t('outOfStock'), cls: 'danger' }
  if (n <= 3) return { text: `${n} ${t('left')}`, cls: 'warning' }
  return { text: `${n} ${t('inStore')}`, cls: 'success' }
}

const EMPTY = {
  q: '',
  line: 'cpu',
  brands: [],
  socket: 'all',
  price: 'any',
  inStock: false,
  sort: 'featured'
}

const PRICE_KEYS = {
  any: 'price_any',
  u15: 'price_u15',
  '15-30': 'price_15_30',
  '30-50': 'price_30_50',
  '50-100': 'price_50_100',
  '100+': 'price_100p'
}

export default function SearchPage({ t, products, lines, panels, lang, liveStock, onAdd, onOpen }) {
  const [filters, setFilters] = useState(EMPTY)
  const [view, setView] = useState('grid')
  const [saved, setSaved] = useState([])
  const [saveNote, setSaveNote] = useState('')

  const allLines = lines || []
  const allPanels = panels || []

  function set(key, value) {
    setFilters((f) => {
      if (key === 'line') return { ...f, line: value, brands: [] }
      return { ...f, [key]: value }
    })
  }

  function toggleBrand(brand) {
    setFilters((f) => ({
      ...f,
      brands: f.brands.includes(brand) ? f.brands.filter((b) => b !== brand) : [...f.brands, brand]
    }))
  }

  const line = allLines.find((l) => l.id === filters.line) || allLines[0]
  const lineBrands = useMemo(() => {
    if (!line) return []
    return [...new Set((products || []).filter(line.match).map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
  }, [line, products])
  const preset = PRICE_PRESETS.find((p) => p.id === filters.price) || PRICE_PRESETS[0]
  const showSocket = line && (line.id === 'cpu' || line.id === 'motherboard' || line.id === 'cooler')
  const lineLabel = line ? (t(`line_${line.id}`) !== `line_${line.id}` ? t(`line_${line.id}`) : line.label) : ''

  const results = useMemo(() => {
    if (!line) return []
    const q = filters.q.trim().toLowerCase()
    let list = (products || []).filter((p) => {
      if (!line.match(p)) return false
      const left = liveStock(p)
      if (filters.brands.length && !filters.brands.includes(p.brand)) return false
      if (showSocket && filters.socket !== 'all') {
        const sock = p.compat && p.compat.socket
        const ok = Array.isArray(sock) ? sock.includes(filters.socket) : sock === filters.socket
        if (!ok) return false
      }
      if (p.price < preset.min || p.price > preset.max) return false
      if (filters.inStock && left <= 0) return false
      if (q) {
        const hay = `${p.name} ${p.sku} ${p.short} ${p.brand}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    if (filters.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
    if (filters.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
    if (filters.sort === 'stock') list = [...list].sort((a, b) => liveStock(b) - liveStock(a))
    if (filters.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (filters.sort === 'rating') list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    return list
  }, [filters, liveStock, preset, line, showSocket, products])

  const activeChips = []
  if (filters.socket !== 'all') activeChips.push({ key: 'socket', label: filters.socket })
  if (filters.price !== 'any') activeChips.push({ key: 'price', label: t(PRICE_KEYS[filters.price] || 'price_any') })
  if (filters.inStock) activeChips.push({ key: 'inStock', label: t('inStoreOnly') })
  filters.brands.forEach((b) => activeChips.push({ key: `brand-${b}`, label: b, brand: b }))

  function clearChip(chip) {
    if (chip.key === 'socket') set('socket', 'all')
    else if (chip.key === 'price') set('price', 'any')
    else if (chip.key === 'inStock') set('inStock', false)
    else if (chip.brand) toggleBrand(chip.brand)
  }

  function saveSearch() {
    const title = [lineLabel, filters.q.trim() || null, filters.socket !== 'all' ? filters.socket : null, ...filters.brands]
      .filter(Boolean)
      .join(' · ')
    setSaved((prev) => [{ id: `s-${Date.now()}`, title, filters: { ...filters, brands: [...filters.brands] } }, ...prev].slice(0, 6))
    setSaveNote(t('searchSaved'))
    setTimeout(() => setSaveNote(''), 1600)
  }

  function panelTitle(panel) {
    if (panel.titles) return panel.titles[lang] || panel.titles.en || panel.id
    if (panel.titleKey) return t(panel.titleKey)
    return panel.id
  }

  function ProductCard({ p }) {
    const left = liveStock(p)
    const st = stockLabel(left, t)
    return (
      <div className="card h-100 shadow-sm product-bs-card">
        <button type="button" className="btn p-0 border-0 position-relative" onClick={() => onOpen(p.id)} aria-label={p.name}>
          <div className="ratio ratio-1x1 photo-frame overflow-hidden">
            <PartThumb product={p} />
          </div>
          <span className={`badge position-absolute top-0 end-0 m-2 text-bg-${st.cls}`}>{st.text}</span>
        </button>
        <div className="card-body d-flex flex-column">
          <div className="small text-secondary">
            {p.sku} · {p.brand}
          </div>
          <h3 className="h6 card-title">{p.name}</h3>
          {p.rating ? (
            <div className="small mb-1">
              {starText(p.rating)} <span className="text-secondary">({p.reviews})</span>
            </div>
          ) : null}
          <p className="small text-secondary flex-grow-1">{p.short}</p>
          <div className="d-flex justify-content-between align-items-center gap-2 mt-auto">
            <span className="fw-bold text-success">{money(p.price)}</span>
            <button type="button" className="btn btn-sm btn-success" disabled={left <= 0} onClick={() => onAdd(p)}>
              {left <= 0 ? t('soldOut') : t('add')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <div className="mb-4">
        <div className="text-secondary small mb-1">{t('searchCrumb')}</div>
        <h1 className="h3 mb-2">{lineLabel}</h1>
        <p className="text-secondary mb-3">{t('searchOneType', { address: STORE.address })}</p>
        <input
          className="form-control form-control-lg"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder={t('searchSlot', { slot: lineLabel })}
          aria-label={lineLabel}
        />
      </div>

      <div className="mb-4">
        {allPanels.map((panel) => (
          <div key={panel.id} className="mb-2">
            <div className="small fw-semibold text-secondary mb-1">{panelTitle(panel)}</div>
            <div className="d-flex flex-wrap gap-2">
              {allLines
                .filter((l) => l.group === panel.id)
                .map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`btn btn-sm rounded-pill ${filters.line === l.id ? 'btn-success' : 'btn-outline-secondary'}`}
                    onClick={() => set('line', l.id)}
                  >
                    {t(`line_${l.id}`) !== `line_${l.id}` ? t(`line_${l.id}`) : l.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row g-4">
        <aside className="col-lg-3">
          <div className="card shadow-sm border-0 sticky-lg-top" style={{ top: 88 }}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <strong>
                  {lineLabel} · {t('filters')}
                </strong>
                <button type="button" className="btn btn-sm btn-link" onClick={() => setFilters({ ...EMPTY, line: filters.line })}>
                  {t('reset')}
                </button>
              </div>

              <button type="button" className="btn btn-outline-success btn-sm w-100 mb-2" onClick={saveSearch}>
                {t('saveSearch')}
              </button>
              {saveNote && <p className="small text-success">{saveNote}</p>}
              {saved.length > 0 && (
                <div className="d-flex flex-wrap gap-1 mb-3">
                  {saved.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setFilters({ ...s.filters, brands: [...s.filters.brands] })}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}

              {lineBrands.length > 0 && (
                <fieldset className="mb-3">
                  <legend className="form-label fw-semibold small">{t('brands')}</legend>
                  <div className="d-flex flex-column gap-1" style={{ maxHeight: 180, overflow: 'auto' }}>
                    {lineBrands.map((b) => (
                      <label key={b} className="form-check mb-0">
                        <input className="form-check-input" type="checkbox" checked={filters.brands.includes(b)} onChange={() => toggleBrand(b)} />
                        <span className="form-check-label small">{b}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {showSocket && (
                <fieldset className="mb-3">
                  <legend className="form-label fw-semibold small">{t('socket')}</legend>
                  <label className="form-check">
                    <input className="form-check-input" type="radio" name="sock" checked={filters.socket === 'all'} onChange={() => set('socket', 'all')} />
                    <span className="form-check-label small">{t('any')}</span>
                  </label>
                  {SOCKETS.map((s) => (
                    <label key={s} className="form-check">
                      <input className="form-check-input" type="radio" name="sock" checked={filters.socket === s} onChange={() => set('socket', s)} />
                      <span className="form-check-label small">{s}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              <fieldset className="mb-3">
                <legend className="form-label fw-semibold small">{t('price')}</legend>
                {PRICE_PRESETS.map((p) => (
                  <label key={p.id} className="form-check">
                    <input className="form-check-input" type="radio" name="price" checked={filters.price === p.id} onChange={() => set('price', p.id)} />
                    <span className="form-check-label small">{t(PRICE_KEYS[p.id] || 'price_any')}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset>
                <legend className="form-label fw-semibold small">{t('availability')}</legend>
                <label className="form-check">
                  <input className="form-check-input" type="checkbox" checked={filters.inStock} onChange={(e) => set('inStock', e.target.checked)} />
                  <span className="form-check-label small">{t('inStoreOnly')}</span>
                </label>
              </fieldset>
            </div>
          </div>
        </aside>

        <section className="col-lg-9">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <span className="fw-semibold">{t('results', { n: results.length })}</span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <div className="btn-group btn-group-sm" role="group">
                <button type="button" className={`btn ${view === 'grid' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setView('grid')}>
                  {t('grid')}
                </button>
                <button type="button" className={`btn ${view === 'list' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setView('list')}>
                  {t('list')}
                </button>
              </div>
              <select className="form-select form-select-sm" style={{ width: 'auto' }} value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label={t('sort')}>
                <option value="featured">{t('sortFeatured')}</option>
                <option value="rating">{t('sortRating')}</option>
                <option value="price-asc">{t('sortPriceAsc')}</option>
                <option value="price-desc">{t('sortPriceDesc')}</option>
                <option value="stock">{t('sortStock')}</option>
                <option value="name">{t('sortName')}</option>
              </select>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              {activeChips.map((c) => (
                <button key={c.key} type="button" className="btn btn-sm btn-success" onClick={() => clearChip(c)}>
                  {c.label} ×
                </button>
              ))}
            </div>
          )}

          {results.length === 0 ? (
            <div className="empty-state">
              <strong>{t('noProducts')}</strong>
              <button
                type="button"
                className="btn btn-sm btn-outline-success mt-2"
                onClick={() => setFilters({ ...EMPTY, line: filters.line })}
              >
                {t('reset')}
              </button>
            </div>
          ) : view === 'grid' ? (
            <div className="row g-3">
              {results.map((p) => (
                <div className="col-6 col-md-4" key={p.id}>
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {results.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <div className="card shadow-sm" key={p.id}>
                    <div className="card-body d-flex flex-wrap gap-3 align-items-center">
                      <button type="button" className="btn p-0 border-0" style={{ width: 72, height: 72 }} onClick={() => onOpen(p.id)}>
                        <div className="ratio ratio-1x1 photo-frame rounded overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                      </button>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">
                          {p.sku} · {p.brand}
                        </div>
                        <button type="button" className="btn btn-link p-0 text-decoration-none text-body fw-semibold" onClick={() => onOpen(p.id)}>
                          {p.name}
                        </button>
                        <div className="small text-secondary">{p.short}</div>
                        <span className={`badge text-bg-${st.cls}`}>{st.text}</span>
                      </div>
                      <div className="text-end">
                        <div className="fw-bold text-success mb-2">{money(p.price)}</div>
                        <button type="button" className="btn btn-sm btn-success" disabled={left <= 0} onClick={() => onAdd(p)}>
                          {left <= 0 ? t('soldOut') : t('add')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
