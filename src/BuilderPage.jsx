import { useMemo, useState } from 'react'
import { BUILDER_SLOTS, PRODUCTS, STORE, checkCompatibility, money, specOf, splitWarnings } from './data'
import PartThumb from './PartThumb.jsx'

function stockLabel(n) {
  if (n <= 0) return { text: 'Out of stock', cls: 'stock-out' }
  if (n <= 3) return { text: `${n} left`, cls: 'stock-low' }
  return { text: `${n} in store`, cls: 'stock-ok' }
}

export default function BuilderPage({ build, setBuild, liveStock, onAdd, onOpen, onGoCart, setToast }) {
  const [group, setGroup] = useState('parts')
  const [slotKey, setSlotKey] = useState('motherboard')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('all')

  const board = build.motherboard
  const cpu = build.cpu
  const slot = BUILDER_SLOTS.find((s) => s.key === slotKey) || BUILDER_SLOTS[0]
  const slots = BUILDER_SLOTS.filter((s) => s.group === group)
  const picked = BUILDER_SLOTS.map((s) => build[s.key]).filter(Boolean)
  const warnings = useMemo(() => checkCompatibility(picked), [picked])
  const { blocks, notes } = useMemo(() => splitWarnings(warnings), [warnings])
  const socketOk = !cpu || !board || (cpu.compat?.socket && board.compat?.socket && cpu.compat.socket === board.compat.socket)
  const requiredReady = BUILDER_SLOTS.filter((s) => s.required).every((s) => build[s.key])
  const total = picked.reduce((s, p) => s + p.price, 0)
  const locked = slot.needsBoard && !board
  const heatOk = blocks.length === 0

  const options = useMemo(() => {
    if (locked) return []
    let list = PRODUCTS.filter(slot.pick)
    if (slot.key === 'cpu' && board) list = list.filter((p) => p.compat?.socket === board.compat?.socket)
    if (slot.key === 'ram' && board) list = list.filter((p) => !board.compat?.memory || p.compat?.memory === board.compat.memory)
    if (slot.key === 'cooler' && board) {
      list = list.filter((p) => Array.isArray(p.compat?.socket) && p.compat.socket.includes(board.compat?.socket))
    }
    if (slot.key === 'case' && board) {
      list = list.filter((p) => {
        if (!board.compat?.form) return true
        if (board.compat.form === 'mATX') return true
        return p.compat?.form === 'ATX' || p.compat?.form === board.compat.form
      })
    }
    if (slot.key === 'gpu') {
      list = list.map((p) => {
        const { blocks: gpuBlocks, notes: gpuNotes } = splitWarnings(checkCompatibility([board, cpu, p].filter(Boolean)))
        return { ...p, gpuBlocks, gpuNotes }
      })
    }
    if (brand !== 'all') list = list.filter((p) => p.brand === brand)
    const query = q.trim().toLowerCase()
    if (query) {
      list = list.filter((p) => `${p.name} ${p.sku} ${p.short} ${p.brand}`.toLowerCase().includes(query))
    }
    return list
  }, [slot, board, cpu, locked, brand, q])

  const brands = useMemo(() => {
    const list = PRODUCTS.filter(slot.pick)
    return [...new Set(list.map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
  }, [slot])

  function chooseSlot(key) {
    setSlotKey(key)
    setQ('')
    setBrand('all')
    const next = BUILDER_SLOTS.find((s) => s.key === key)
    if (next) setGroup(next.group)
  }

  function pick(product) {
    setBuild((prev) => {
      const next = { ...prev, [slot.key]: product }
      if (slot.key === 'motherboard') {
        const cpuP = next.cpu
        if (cpuP && product && cpuP.compat?.socket !== product.compat?.socket) next.cpu = null
        const ramP = next.ram
        if (ramP && product && product.compat?.memory && ramP.compat?.memory !== product.compat.memory) next.ram = null
      }
      const gpuP = next.gpu
      if (gpuP && (slot.key === 'motherboard' || slot.key === 'cpu')) {
        const { blocks: gpuBlocks } = splitWarnings(checkCompatibility([next.motherboard, next.cpu, gpuP].filter(Boolean)))
        if (gpuBlocks.length) next.gpu = null
      }
      return next
    })
  }

  function clearSlot(key) {
    setBuild((prev) => ({ ...prev, [key]: null }))
  }

  function addBuild() {
    if (!board) {
      setToast('Pick a motherboard first')
      chooseSlot('motherboard')
      return
    }
    if (!requiredReady) {
      setToast('Motherboard, CPU and RAM are required')
      return
    }
    if (!socketOk) {
      setToast('CPU and motherboard sockets must match')
      return
    }
    if (!heatOk) {
      setToast('This mix can overheat or bottleneck. Fix the red warnings first.')
      return
    }
    const blocked = picked.find((p) => liveStock(p) <= 0)
    if (blocked) {
      setToast(`${blocked.name} is out of stock`)
      return
    }
    picked.forEach(onAdd)
    onGoCart()
  }

  const current = build[slot.key]
  const filled = BUILDER_SLOTS.filter((s) => build[s.key]).length

  return (
    <main className="wrap page">
      <div className="search-hero">
        <div className="crumb">Shop / PC builder</div>
        <h1>Build a PC for pickup</h1>
        <p>
          Motherboard first. CPU, RAM and GPU must match — a too-high-gamme GPU on a weak CPU or board
          will bottleneck or surchauffe. Collect at {STORE.address}.
        </p>
      </div>

      <div className="builder-progress">
        <span>{filled} / {BUILDER_SLOTS.length} chosen</span>
        <div className="builder-bar" aria-hidden>
          <i style={{ width: `${(filled / BUILDER_SLOTS.length) * 100}%` }} />
        </div>
      </div>

      <div className="builder-layout">
        <div>
          <div className="line-tabs">
            <div className="line-group">
              <span>Catalog</span>
              <button type="button" className={`chip ${group === 'parts' ? 'on' : ''}`} onClick={() => { setGroup('parts'); chooseSlot('motherboard') }}>PC parts</button>
              <button type="button" className={`chip ${group === 'accessories' ? 'on' : ''}`} onClick={() => { setGroup('accessories'); chooseSlot('keyboard') }}>Accessories</button>
            </div>
          </div>

          <div className="builder-slot-row">
            {slots.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`builder-tab ${slotKey === s.key ? 'on' : ''} ${build[s.key] ? 'has' : ''} ${s.required ? 'req' : ''}`}
                onClick={() => chooseSlot(s.key)}
              >
                {s.label}
                {build[s.key] ? <b>Picked</b> : s.required ? <em>Need</em> : <em>Optional</em>}
              </button>
            ))}
          </div>

          <div className="builder-tools">
            <input
              className="field"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${slot.label.toLowerCase()} by name, SKU, brand…`}
              aria-label={`Search ${slot.label}`}
              disabled={locked}
            />
            <select className="field brand-field" value={brand} onChange={(e) => setBrand(e.target.value)} disabled={locked} aria-label="Brand">
              <option value="all">All {slot.label} brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {locked ? (
            <p className="empty">Pick a motherboard first. Then {slot.label.toLowerCase()} options follow its socket.</p>
          ) : options.length === 0 ? (
            <p className="empty">No {slot.label.toLowerCase()} match. Try another brand or clear the search.</p>
          ) : (
            <div className="builder-grid">
              {options.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left)
                const on = current && current.id === p.id
                const gpuBlocks = p.gpuBlocks || []
                const gpuNotes = p.gpuNotes || []
                const tooHot = gpuBlocks.length > 0
                const spec = specOf(p)
                return (
                  <article className={`pick-card ${on ? 'on' : ''} ${tooHot ? 'blocked' : ''}`} key={p.id}>
                    <button type="button" className="pick-thumb" onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <PartThumb product={p} />
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </button>
                    <div className="pick-body">
                      <div className="sku">{p.brand}{spec.tdp ? ` · ${spec.tdp}W` : ''}{spec.vrm ? ` · VRM ${spec.vrm}W` : ''}</div>
                      <h3><button type="button" onClick={() => onOpen(p.id)}>{p.name}</button></h3>
                      <p className="short">{p.short}</p>
                      {tooHot && <p className="fit-err">{gpuBlocks[0]}</p>}
                      {!tooHot && gpuNotes[0] && <p className="fit-note">{gpuNotes[0]}</p>}
                      <div className="row">
                        <div className="price">{money(p.price)}</div>
                        <button
                          type="button"
                          className={on ? 'ghost tiny on' : 'add'}
                          disabled={left <= 0 || tooHot}
                          onClick={() => (on ? clearSlot(slot.key) : pick(p))}
                        >
                          {left <= 0 ? 'Sold out' : tooHot ? 'Too high gamme' : on ? 'Selected' : 'Choose'}
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <aside className="callbox build-summary">
          <h2>This build</h2>
          {!board ? (
            <p>Pick a motherboard first. CPU, RAM and GPU then follow socket, VRM and power so the card does not surchauffe.</p>
          ) : (
            <ul className="build-list">
              {BUILDER_SLOTS.map((s) => (
                <li key={s.key} className={build[s.key] ? '' : 'dim'}>
                  <button type="button" className="build-jump" onClick={() => chooseSlot(s.key)}>
                    {s.label}
                  </button>
                  {build[s.key] ? (
                    <span className="build-pick">
                      <strong>{money(build[s.key].price)}</strong>
                      <button type="button" className="remove" onClick={() => clearSlot(s.key)}>×</button>
                    </span>
                  ) : (
                    <em>{s.required ? 'Required' : 'Skip'}</em>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="total">Total {money(total)}</div>
          {!socketOk && cpu && board && (
            <div className="warn danger">
              <h3>Socket mismatch</h3>
              <p>{cpu.name} is {cpu.compat.socket}. {board.name} is {board.compat.socket}.</p>
            </div>
          )}
          {blocks.length > 0 && (
            <div className="warn danger">
              <h3>Will not run / will overheat</h3>
              {blocks.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}
          {socketOk && notes.length > 0 && (
            <div className="warn">
              <h3>Watch this</h3>
              {notes.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}
          <button className="add wide" type="button" disabled={!requiredReady || !socketOk || !heatOk} onClick={addBuild}>
            Add build to cart
          </button>
          <p className="short">Reserve from the cart. Pay in dinars at pickup in Oran.</p>
        </aside>
      </div>
    </main>
  )
}
