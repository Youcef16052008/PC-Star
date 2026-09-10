import { useMemo, useState } from 'react'
import { PRICE_PRESETS, SOCKETS, STORE, money, starText, third } from './data'
import PartThumb from './PartThumb.jsx'

function stockLabel(n, t) {
  if (n <= 0) return { text: t('outOfStock'), cls: 'stock-out' }
  if (n <= 3) return { text: `${n} ${t('left')}`, cls: 'stock-low' }
  return { text: `${n} ${t('inStore')}`, cls: 'stock-ok' }
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

export default function SearchPage({ t, products, lines, panels, lang, liveStock, onAdd, onOpen, compareIds, onToggleCompare }) {
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
  const lineLabel = line ? t(`line_${line.id}`) !== `line_${line.id}` ? t(`line_${line.id}`) : line.label : ''

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

  function Rating({ product }) {
    if (!product.rating) return null
    return (
      <div className="stars" title={`${product.rating} from ${product.reviews} reviews`}>
        <span>{starText(product.rating)}</span>
        <em>{product.rating.toFixed(1)}</em>
        <span className="rev">({product.reviews})</span>
      </div>
    )
  }

  function CompareToggle({ product }) {
    const on = compareIds.includes(product.id)
    const full = !on && compareIds.length >= 3
    return (
      <button type="button" className={`ghost tiny ${on ? 'on' : ''}`} disabled={full} onClick={() => onToggleCompare(product.id)}>
        {on ? t('inCompare') : full ? t('compareUpTo') : t('compare')}
      </button>
    )
  }

  function panelTitle(panel) {
    if (panel.titles) return panel.titles[lang] || panel.titles.en || panel.id
    if (panel.titleKey) return t(panel.titleKey)
    return panel.id
  }

  return (
    <main className="wrap page">
      <div className="search-hero">
        <div>
          <div className="crumb">{t('searchCrumb')}</div>
          <h1>{lineLabel}</h1>
          <p>{t('searchOneType', { address: STORE.address })}</p>
        </div>
        <div className="search-bar">
          <input
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder={t('searchSlot', { slot: lineLabel })}
            aria-label={lineLabel}
          />
        </div>
      </div>

      <div className="line-tabs" role="tablist" aria-label="Catalog type">
        {allPanels.map((panel) => (
          <div className="line-group" key={panel.id}>
            <span>{panelTitle(panel)}</span>
            {allLines
              .filter((l) => l.group === panel.id)
              .map((l) => (
                <button key={l.id} type="button" className={`chip ${filters.line === l.id ? 'on' : ''}`} onClick={() => set('line', l.id)}>
                  {t(`line_${l.id}`) !== `line_${l.id}` ? t(`line_${l.id}`) : l.label}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="search-layout">
        <aside className="power-filters">
          <div className="filters-head">
            <strong>
              {lineLabel} · {t('filters')}
            </strong>
            <button type="button" onClick={() => setFilters({ ...EMPTY, line: filters.line })}>
              {t('reset')}
            </button>
          </div>

          <button type="button" className="ghost tiny wide-btn" onClick={saveSearch}>
            {t('saveSearch')}
          </button>
          {saveNote && <p className="short">{saveNote}</p>}
          {saved.length > 0 && (
            <div className="saved-list">
              {saved.map((s) => (
                <button key={s.id} type="button" className="chip" onClick={() => setFilters({ ...s.filters, brands: [...s.filters.brands] })}>
                  {s.title}
                </button>
              ))}
            </div>
          )}

          {lineBrands.length > 0 && (
            <fieldset>
              <legend>{t('brands')}</legend>
              {lineBrands.map((b) => (
                <label key={b} className="check">
                  <input type="checkbox" checked={filters.brands.includes(b)} onChange={() => toggleBrand(b)} />
                  {b}
                </label>
              ))}
            </fieldset>
          )}

          {showSocket && (
            <fieldset>
              <legend>{t('socket')}</legend>
              <label className="check">
                <input type="radio" name="sock" checked={filters.socket === 'all'} onChange={() => set('socket', 'all')} />
                {t('any')}
              </label>
              {SOCKETS.map((s) => (
                <label key={s} className="check">
                  <input type="radio" name="sock" checked={filters.socket === s} onChange={() => set('socket', s)} />
                  {s}
                </label>
              ))}
            </fieldset>
          )}

          <fieldset>
            <legend>{t('price')}</legend>
            {PRICE_PRESETS.map((p) => (
              <label key={p.id} className="check">
                <input type="radio" name="price" checked={filters.price === p.id} onChange={() => set('price', p.id)} />
                {t(PRICE_KEYS[p.id] || 'price_any')}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>{t('availability')}</legend>
            <label className="check">
              <input type="checkbox" checked={filters.inStock} onChange={(e) => set('inStock', e.target.checked)} />
              {t('inStoreOnly')}
            </label>
          </fieldset>
        </aside>

        <section>
          <div className="results-bar">
            <span>{t('results', { n: results.length })}</span>
            <div className="results-tools">
              <div className="view-toggle" role="group" aria-label="Result layout">
                <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>
                  {t('grid')}
                </button>
                <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
                  {t('list')}
                </button>
              </div>
              <label className="sort">
                {t('sort')}
                <select value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
                  <option value="featured">{t('sortFeatured')}</option>
                  <option value="rating">{t('sortRating')}</option>
                  <option value="price-asc">{t('sortPriceAsc')}</option>
                  <option value="price-desc">{t('sortPriceDesc')}</option>
                  <option value="stock">{t('sortStock')}</option>
                  <option value="name">{t('sortName')}</option>
                </select>
              </label>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="active-chips">
              {activeChips.map((c) => (
                <button key={c.key} type="button" className="chip on" onClick={() => clearChip(c)}>
                  {c.label} ×
                </button>
              ))}
            </div>
          )}

          {results.length === 0 ? (
            <p className="empty">{t('noProducts')}</p>
          ) : view === 'grid' ? (
            <div className="grid">
              {results.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <article className="card" key={p.id}>
                    <button className="thumb" type="button" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </button>
                    <div className="card-body">
                      <div className="sku">
                        {p.sku} · {p.brand}
                      </div>
                      <h3>{p.name}</h3>
                      <Rating product={p} />
                      <div className="short">{p.short}</div>
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <div className="row">
                        <div className="price">{money(p.price)}</div>
                        <button className="add" type="button" disabled={left <= 0} onClick={() => onAdd(p)}>
                          {left <= 0 ? t('soldOut') : t('add')}
                        </button>
                      </div>
                      <CompareToggle product={p} />
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="list-results">
              {results.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <article className="row-card" key={p.id}>
                    <button className="row-thumb" type="button" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                    </button>
                    <div className="row-body">
                      <div className="sku">
                        {p.sku} · {p.brand}
                      </div>
                      <h3>
                        <button type="button" onClick={() => onOpen(p.id)}>
                          {p.name}
                        </button>
                      </h3>
                      <Rating product={p} />
                      <p>{p.short}</p>
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <span className={`inline-stock ${st.cls}`}>{st.text}</span>
                    </div>
                    <div className="row-buy">
                      <div className="price">{money(p.price)}</div>
                      <button className="add" type="button" disabled={left <= 0} onClick={() => onAdd(p)}>
                        {left <= 0 ? t('soldOut') : t('add')}
                      </button>
                      <CompareToggle product={p} />
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
