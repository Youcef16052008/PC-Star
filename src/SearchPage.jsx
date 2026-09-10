import { useMemo, useState } from 'react'
import { PART_LINES, PRICE_PRESETS, PRODUCTS, SOCKETS, STORE, brandsForLine, money, starText, third } from './data'
import PartThumb from './PartThumb.jsx'

function stockLabel(n) {
  if (n <= 0) return { text: 'Out of stock', cls: 'stock-out' }
  if (n <= 3) return { text: `${n} left`, cls: 'stock-low' }
  return { text: `${n} in store`, cls: 'stock-ok' }
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

const LINE_PANELS = [
  { id: 'parts', title: 'PC parts' },
  { id: 'machines', title: 'Laptops & PC pret' },
  { id: 'desk', title: 'USB, consoles & repair' },
  { id: 'accessories', title: 'Accessories' }
]

export default function SearchPage({ liveStock, onAdd, onOpen, compareIds, onToggleCompare }) {
  const [filters, setFilters] = useState(EMPTY)
  const [view, setView] = useState('grid')
  const [saved, setSaved] = useState([])
  const [saveNote, setSaveNote] = useState('')

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

  const line = PART_LINES.find((l) => l.id === filters.line) || PART_LINES[0]
  const lineBrands = brandsForLine(line.id)
  const preset = PRICE_PRESETS.find((p) => p.id === filters.price) || PRICE_PRESETS[0]
  const showSocket = line.id === 'cpu' || line.id === 'motherboard' || line.id === 'cooler'

  const results = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    let list = PRODUCTS.filter((p) => {
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
    if (filters.sort === 'rating') list = [...list].sort((a, b) => b.rating - a.rating)
    return list
  }, [filters, liveStock, preset, line, showSocket])

  const activeChips = []
  if (filters.socket !== 'all') activeChips.push({ key: 'socket', label: filters.socket })
  if (filters.price !== 'any') activeChips.push({ key: 'price', label: preset.label })
  if (filters.inStock) activeChips.push({ key: 'inStock', label: 'In store only' })
  filters.brands.forEach((b) => activeChips.push({ key: `brand-${b}`, label: b, brand: b }))

  function clearChip(chip) {
    if (chip.key === 'socket') set('socket', 'all')
    else if (chip.key === 'price') set('price', 'any')
    else if (chip.key === 'inStock') set('inStock', false)
    else if (chip.brand) toggleBrand(chip.brand)
  }

  function saveSearch() {
    const title = [line.label, filters.q.trim() || null, filters.socket !== 'all' ? filters.socket : null, ...filters.brands].filter(Boolean).join(' · ')
    setSaved((prev) => [{ id: `s-${Date.now()}`, title, filters: { ...filters, brands: [...filters.brands] } }, ...prev].slice(0, 6))
    setSaveNote('Search saved')
    setTimeout(() => setSaveNote(''), 1600)
  }

  function Rating({ product }) {
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
      <button
        type="button"
        className={`ghost tiny ${on ? 'on' : ''}`}
        disabled={full}
        onClick={() => onToggleCompare(product.id)}
      >
        {on ? 'In compare' : full ? 'Compare full' : 'Compare'}
      </button>
    )
  }

  return (
    <main className="wrap page">
      <div className="search-hero">
        <div>
          <div className="crumb">Shop / Search</div>
          <h1>{line.label}</h1>
          <p>One type at a time — parts, laptops, PC pret, USB, consoles, repairs. Brands shown are only for {line.label.toLowerCase()}. Pickup at {STORE.address}.</p>
        </div>
        <div className="search-bar">
          <input
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder={`Search ${line.label.toLowerCase()}…`}
            aria-label={`Search ${line.label}`}
          />
        </div>
      </div>

      <div className="line-tabs" role="tablist" aria-label="Catalog type">
        {LINE_PANELS.map((panel) => (
          <div className="line-group" key={panel.id}>
            <span>{panel.title}</span>
            {PART_LINES.filter((l) => l.group === panel.id).map((l) => (
              <button key={l.id} type="button" className={`chip ${filters.line === l.id ? 'on' : ''}`} onClick={() => set('line', l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="search-layout">
        <aside className="power-filters">
          <div className="filters-head">
            <strong>{line.label} filters</strong>
            <button type="button" onClick={() => setFilters({ ...EMPTY, line: filters.line })}>Reset</button>
          </div>

          <button type="button" className="ghost tiny wide-btn" onClick={saveSearch}>Save this search</button>
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
              <legend>{line.label} brands</legend>
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
              <legend>Socket</legend>
              <label className="check">
                <input type="radio" name="sock" checked={filters.socket === 'all'} onChange={() => set('socket', 'all')} />
                Any
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
            <legend>Price</legend>
            {PRICE_PRESETS.map((p) => (
              <label key={p.id} className="check">
                <input type="radio" name="price" checked={filters.price === p.id} onChange={() => set('price', p.id)} />
                {p.label}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Availability</legend>
            <label className="check">
              <input type="checkbox" checked={filters.inStock} onChange={(e) => set('inStock', e.target.checked)} />
              In store only
            </label>
          </fieldset>
        </aside>

        <section>
          <div className="results-bar">
            <span>{results.length} {line.label.toLowerCase()}{results.length === 1 ? '' : 's'}</span>
            <div className="results-tools">
              <div className="view-toggle" role="group" aria-label="Result layout">
                <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</button>
                <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
              </div>
              <label className="sort">
                Sort
                <select value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
                  <option value="featured">Featured</option>
                  <option value="rating">Best rated</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="stock">Most in store</option>
                  <option value="name">Name</option>
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
            <p className="empty">No {line.label.toLowerCase()} in this filter.</p>
          ) : view === 'grid' ? (
            <div className="grid">
              {results.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left)
                return (
                  <article className="card" key={p.id}>
                    <button className="thumb" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </button>
                    <div className="card-body">
                      <div className="sku">{p.sku} · {p.brand}</div>
                      <h3>{p.name}</h3>
                      <Rating product={p} />
                      <div className="short">{p.short}</div>
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <div className="row">
                        <div className="price">{money(p.price)}</div>
                        <button className="add" disabled={left <= 0} onClick={() => onAdd(p)}>
                          {left <= 0 ? 'Sold out' : 'Add'}
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
                const st = stockLabel(left)
                return (
                  <article className="row-card" key={p.id}>
                    <button className="row-thumb" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                    </button>
                    <div className="row-body">
                      <div className="sku">{p.sku} · {p.brand}</div>
                      <h3><button type="button" onClick={() => onOpen(p.id)}>{p.name}</button></h3>
                      <Rating product={p} />
                      <p>{p.short}</p>
                      {p.price >= 30000 && <div className="pay3x">3x {third(p.price)}</div>}
                      <span className={`inline-stock ${st.cls}`}>{st.text}</span>
                    </div>
                    <div className="row-buy">
                      <div className="price">{money(p.price)}</div>
                      <button className="add" disabled={left <= 0} onClick={() => onAdd(p)}>
                        {left <= 0 ? 'Sold out' : 'Add'}
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
