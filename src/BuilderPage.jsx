import { useMemo, useState } from 'react'
import { BUILDER_SLOTS, STORE, checkCompatibility, money, specOf, splitWarnings } from './data'
import PartThumb from './PartThumb.jsx'

function stockLabel(n, t) {
  if (n <= 0) return { text: t('outOfStock'), cls: 'danger' }
  if (n <= 3) return { text: `${n} ${t('left')}`, cls: 'warning' }
  return { text: `${n} ${t('inStore')}`, cls: 'success' }
}

export default function BuilderPage({ t, products, build, setBuild, liveStock, onAdd, onOpen, onGoCart, setToast }) {
  const catalog = products || []
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
  const slotLabel = t(`line_${slot.key}`) !== `line_${slot.key}` ? t(`line_${slot.key}`) : slot.label

  const options = useMemo(() => {
    if (locked) return []
    let list = catalog.filter(slot.pick)
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
  }, [slot, board, cpu, locked, brand, q, catalog])

  const brands = useMemo(() => {
    const list = catalog.filter(slot.pick)
    return [...new Set(list.map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
  }, [slot, catalog])

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
      setToast(t('toastPickBoard'))
      chooseSlot('motherboard')
      return
    }
    if (!requiredReady) {
      setToast(t('toastNeedCore'))
      return
    }
    if (!socketOk) {
      setToast(t('toastSocket'))
      return
    }
    if (!heatOk) {
      setToast(t('toastHeat'))
      return
    }
    const blocked = picked.find((p) => liveStock(p) <= 0)
    if (blocked) {
      setToast(t('toastOos', { name: blocked.name }))
      return
    }
    picked.forEach(onAdd)
    onGoCart()
  }

  const current = build[slot.key]
  const filled = BUILDER_SLOTS.filter((s) => build[s.key]).length
  const progress = Math.round((filled / BUILDER_SLOTS.length) * 100)

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <div className="mb-3">
        <div className="text-secondary small">{t('builderCrumb')}</div>
        <h1 className="h3">{t('builderTitle')}</h1>
        <p className="text-secondary">{t('builderBody', { address: STORE.address })}</p>
      </div>

      <div className="mb-3">
        <div className="d-flex justify-content-between small mb-1">
          <span>{t('builderChosen', { n: filled, total: BUILDER_SLOTS.length })}</span>
          <span className="text-secondary">{progress}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
          <div className="progress-bar bg-success" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="btn-group mb-3" role="group">
            <button
              type="button"
              className={`btn ${group === 'parts' ? 'btn-success' : 'btn-outline-secondary'}`}
              onClick={() => {
                setGroup('parts')
                chooseSlot('motherboard')
              }}
            >
              {t('catalogParts')}
            </button>
            <button
              type="button"
              className={`btn ${group === 'accessories' ? 'btn-success' : 'btn-outline-secondary'}`}
              onClick={() => {
                setGroup('accessories')
                chooseSlot('keyboard')
              }}
            >
              {t('catalogAcc')}
            </button>
          </div>

          <div className="d-flex flex-wrap gap-2 mb-3">
            {slots.map((s) => {
              const lab = t(`line_${s.key}`) !== `line_${s.key}` ? t(`line_${s.key}`) : s.label
              const has = Boolean(build[s.key])
              const active = slotKey === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-success' : has ? 'btn-outline-success' : 'btn-outline-secondary'}`}
                  onClick={() => chooseSlot(s.key)}
                >
                  {lab}
                  <span className="ms-1 small opacity-75">{has ? t('picked') : s.required ? t('need') : t('optional')}</span>
                </button>
              )
            })}
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-8">
              <input
                className="form-control"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('searchSlot', { slot: slotLabel })}
                aria-label={slotLabel}
                disabled={locked}
              />
            </div>
            <div className="col-md-4">
              <select className="form-select" value={brand} onChange={(e) => setBrand(e.target.value)} disabled={locked} aria-label={t('brands')}>
                <option value="all">{t('allBrands')}</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {locked ? (
            <div className="alert alert-warning">{t('pickBoardFirst')}</div>
          ) : options.length === 0 ? (
            <p className="text-secondary">{t('noProducts')}</p>
          ) : (
            <div className="row g-3">
              {options.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                const on = current && current.id === p.id
                const gpuBlocks = p.gpuBlocks || []
                const gpuNotes = p.gpuNotes || []
                const tooHot = gpuBlocks.length > 0
                const spec = specOf(p)
                return (
                  <div className="col-6 col-md-4" key={p.id}>
                    <div className={`card h-100 shadow-sm product-bs-card ${on ? 'border-success' : ''} ${tooHot ? 'opacity-75' : ''}`}>
                      <button type="button" className="btn p-0 border-0 position-relative" onClick={() => onOpen(p.id)} aria-label={p.name}>
                        <div className="ratio ratio-1x1 photo-frame overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                        <span className={`badge position-absolute top-0 end-0 m-2 text-bg-${st.cls}`}>{st.text}</span>
                      </button>
                      <div className="card-body d-flex flex-column">
                        <div className="small text-secondary">
                          {p.brand}
                          {spec.tdp ? ` · ${spec.tdp}W` : ''}
                          {spec.vrm ? ` · VRM ${spec.vrm}W` : ''}
                        </div>
                        <h3 className="h6">
                          <button type="button" className="btn btn-link p-0 text-start text-decoration-none text-body" onClick={() => onOpen(p.id)}>
                            {p.name}
                          </button>
                        </h3>
                        <p className="small text-secondary flex-grow-1 mb-2">{p.short}</p>
                        {tooHot && <div className="alert alert-danger py-1 px-2 small mb-2">{gpuBlocks[0]}</div>}
                        {!tooHot && gpuNotes[0] && <div className="alert alert-warning py-1 px-2 small mb-2">{gpuNotes[0]}</div>}
                        <div className="d-flex justify-content-between align-items-center gap-2 mt-auto">
                          <span className="fw-bold text-success">{money(p.price)}</span>
                          <button
                            type="button"
                            className={`btn btn-sm ${on ? 'btn-outline-success' : 'btn-success'}`}
                            disabled={left <= 0 || tooHot}
                            onClick={() => (on ? clearSlot(slot.key) : pick(p))}
                          >
                            {left <= 0 ? t('soldOut') : tooHot ? t('tooHighGamme') : on ? t('selected') : t('choose')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <aside className="col-lg-4">
          <div className="card shadow-sm border-0 sticky-lg-top" style={{ top: 88 }}>
            <div className="card-body">
              <h2 className="h5">{t('thisBuild')}</h2>
              {!board ? (
                <p className="text-secondary">{t('pickBoardFirst')}</p>
              ) : (
                <ul className="list-group list-group-flush mb-3">
                  {BUILDER_SLOTS.map((s) => {
                    const lab = t(`line_${s.key}`) !== `line_${s.key}` ? t(`line_${s.key}`) : s.label
                    return (
                      <li key={s.key} className={`list-group-item px-0 d-flex justify-content-between align-items-center ${build[s.key] ? '' : 'text-secondary'}`}>
                        <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => chooseSlot(s.key)}>
                          {lab}
                        </button>
                        {build[s.key] ? (
                          <span className="d-flex align-items-center gap-2">
                            <strong className="text-success">{money(build[s.key].price)}</strong>
                            <button type="button" className="btn-close btn-sm" aria-label={t('remove')} onClick={() => clearSlot(s.key)} />
                          </span>
                        ) : (
                          <em className="small">{s.required ? t('required') : t('skip')}</em>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="fw-semibold">{t('total')}</span>
                <span className="fs-5 fw-bold text-success">{money(total)}</span>
              </div>

              {!socketOk && cpu && board && (
                <div className="alert alert-danger py-2">
                  <strong>{t('socketMismatch')}</strong>
                  <div className="small">
                    {cpu.name} is {cpu.compat.socket}. {board.name} is {board.compat.socket}.
                  </div>
                </div>
              )}
              {blocks.length > 0 && (
                <div className="alert alert-danger py-2">
                  <strong>{t('willNotRun')}</strong>
                  {blocks.map((w) => (
                    <div key={w} className="small">
                      {w}
                    </div>
                  ))}
                </div>
              )}
              {socketOk && notes.length > 0 && (
                <div className="alert alert-warning py-2">
                  <strong>{t('watchThis')}</strong>
                  {notes.map((w) => (
                    <div key={w} className="small">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              <button className="btn btn-success w-100" type="button" disabled={!requiredReady || !socketOk || !heatOk} onClick={addBuild}>
                {t('addBuild')}
              </button>
              <p className="small text-secondary mt-2 mb-0">{t('builderPayNote')}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
