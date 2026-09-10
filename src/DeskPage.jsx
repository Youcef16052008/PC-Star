import { useMemo, useState } from 'react'
import { money } from './data.js'
import { statusLabelKey } from './orderLogic.js'
import * as api from './api.js'

const FILTERS = ['all', 'new', 'preparing', 'ready', 'picked', 'cancelled']

function badgeClass(status) {
  const s = status === 'pending' ? 'new' : status
  if (s === 'new') return 'text-bg-primary'
  if (s === 'preparing') return 'text-bg-warning'
  if (s === 'ready') return 'text-bg-success'
  if (s === 'picked') return 'text-bg-secondary'
  if (s === 'cancelled') return 'text-bg-danger'
  return 'text-bg-light'
}

export default function DeskPage({ t, lang, reservations, onStatus, setToast }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)

  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    return (reservations || []).filter((r) => {
      const st = r.status === 'pending' ? 'new' : r.status || 'new'
      if (filter !== 'all' && st !== filter) return false
      if (!query) return true
      const hay = `${r.code} ${r.name} ${r.phone} ${r.wilaya || ''}`.toLowerCase()
      return hay.includes(query)
    })
  }, [reservations, filter, q])

  async function changeStatus(code, status) {
    setBusy(code + status)
    try {
      const ok = await onStatus(code, status)
      if (!ok) setToast?.(t('deskStatusFail'))
    } finally {
      setBusy(null)
    }
  }

  function formatAt(at) {
    if (!at) return ''
    try {
      const d = new Date(at)
      if (Number.isNaN(d.getTime())) return String(at)
      return d.toLocaleString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB')
    } catch {
      return String(at)
    }
  }

  function waReady(r) {
    const msg = t('deskWaReady', {
      code: r.code,
      name: r.name,
      slot: r.slot || '',
      total: money(r.total)
    })
    return `https://wa.me/213${String(r.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent(msg)}`
  }

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
        <div>
          <h1 className="h3 mb-1">{t('deskTitle')}</h1>
          <p className="text-secondary mb-0">{t('deskHint')}</p>
        </div>
        <span className="badge text-bg-success">{list.length}/{reservations.length}</span>
      </div>

      <div className="row g-2 mb-3 no-print">
        <div className="col-md-4">
          <input
            className="form-control"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('deskSearch')}
            aria-label={t('deskSearch')}
          />
        </div>
        <div className="col-md-5">
          <div className="d-flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`btn btn-sm ${filter === f ? 'btn-success' : 'btn-outline-secondary'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? t('cat_all') : t(statusLabelKey(f))}
              </button>
            ))}
          </div>
        </div>
        <div className="col-md-3 d-flex flex-wrap gap-1 justify-content-md-end">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={async () => {
              const day = new Date().toISOString().slice(0, 10)
              const r = await api.downloadOrdersCsv(day)
              if (!r.ok) setToast?.(t('deskStatusFail'))
              else setToast?.(t('deskExportOk'))
            }}
          >
            {t('deskExportCsv')}
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>
            {t('deskPrint')}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <strong>{t('deskEmpty')}</strong>
          <p className="mb-0 small">{t('deskHint')}</p>
        </div>
      ) : (
        <div className="row g-3">
          {list.map((r) => {
            const st = r.status === 'pending' ? 'new' : r.status || 'new'
            return (
              <div className="col-md-6 col-xl-4" key={r.code}>
                <article className="card h-100 shadow-sm desk-card border-0 desk-print-card">
                  <div className="card-body d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <span className="badge text-bg-dark font-monospace">{r.code}</span>
                      <span className={`badge ${badgeClass(st)}`}>{t(statusLabelKey(st))}</span>
                    </div>
                    <div className="small text-secondary mb-1">
                      {r.slot || '—'} · {formatAt(r.at)}
                    </div>
                    <h2 className="h6 mb-1">{r.name}</h2>
                    <p className="small text-secondary mb-2">
                      {r.phone}
                      {r.carrier ? ` · ${r.carrier}` : ''}
                      {r.wilaya ? ` · ${r.wilaya}` : ''}
                      {' · '}
                      {t('payCash')}
                    </p>
                    <ul className="list-group list-group-flush mb-3">
                      {(r.items || []).map((i) => (
                        <li className="list-group-item d-flex justify-content-between gap-2 px-0" key={i.id + i.sku}>
                          <span>
                            {i.qty} × {i.name}
                          </span>
                          <span className="small text-secondary text-nowrap">{i.sku}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span className="small text-secondary">{t('dueInStore')}</span>
                      <strong className="text-success fs-5">{money(r.total)}</strong>
                    </div>

                    <div className="d-flex flex-wrap gap-1 mt-auto">
                      {st === 'new' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-warning"
                          disabled={busy}
                          onClick={() => changeStatus(r.code, 'preparing')}
                        >
                          {t('deskStartPrep')}
                        </button>
                      )}
                      {(st === 'new' || st === 'preparing') && (
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          disabled={busy}
                          onClick={() => changeStatus(r.code, 'ready')}
                        >
                          {t('deskMarkReady')}
                        </button>
                      )}
                      {st === 'ready' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-success"
                            disabled={busy}
                            onClick={() => changeStatus(r.code, 'picked')}
                          >
                            {t('deskMarkPicked')}
                          </button>
                          <a className="btn btn-sm btn-outline-success" href={waReady(r)} target="_blank" rel="noreferrer">
                            WhatsApp
                          </a>
                        </>
                      )}
                      {st !== 'cancelled' && st !== 'picked' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          disabled={busy}
                          onClick={() => changeStatus(r.code, 'cancelled')}
                        >
                          {t('deskCancel')}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
