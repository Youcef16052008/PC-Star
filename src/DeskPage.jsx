import { useMemo, useState } from 'react'
import { money } from './data.js'
import { formatDateTime } from './format.js'
import { localDay, statusLabelKey, waNumber } from './orderLogic.js'
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

export default function DeskPage({ t, lang, reservations, onStatus, onDelete, setToast }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  // Phase 3 : codes de retrait émis pour les commandes guest, affichés sur la
  // carte le temps d'être dictés au client (jamais renvoyés par l'API ensuite).
  const [claimCodes, setClaimCodes] = useState({})

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
    // P21 : `busy` ne porte plus que le CODE de la commande en cours. Avant il
    // valait `code + status` et les cinq boutons testaient la simple présence
    // d'une valeur (`disabled={busy}`) : une seule requête en attente gelait
    // donc les boutons de TOUTES les cartes, pas seulement celle cliquée.
    setBusy(code)
    try {
      const ok = await onStatus(code, status)
      if (!ok) setToast?.(t('deskStatusFail'))
      else setToast?.(t('deskStatusOk'))
    } catch {
      // P21 : une exception ne doit ni remonter en rejet non géré, ni laisser la
      // carte verrouillée — sans ce catch, `busy` restait pris et les boutons
      // demeuraient grisés sans aucun message pour le maître.
      setToast?.(t('deskStatusFail'))
    } finally {
      // Toujours libéré, même si onStatus lève : sinon la carte reste figée.
      setBusy(null)
    }
  }

  // Phase 3 : le comptoir émet un code de retrait à usage unique pour une
  // commande guest. Le client le saisit depuis son compte pour rattacher la
  // commande — c'est la preuve réelle, remise en main propre.
  async function issueCode(code) {
    setBusy(code)
    try {
      const r = await api.issueClaimCode(code)
      if (!r.ok) {
        setToast?.(t('deskClaimFail'))
        return
      }
      setClaimCodes((prev) => ({ ...prev, [code]: r.data?.claimCode || '' }))
      setToast?.(t('deskClaimOk'))
    } catch {
      setToast?.(t('deskClaimFail'))
    } finally {
      setBusy(null)
    }
  }

  // P19 : suppression définitive — pour les commandes de test du master, qui
  // n'ont pas à rester dans l'historique ni dans le CSV. Le stock est rendu
  // côté serveur. Confirmation obligatoire : l'action est irréversible.
  async function removeOrder(code) {
    if (!window.confirm(t('confirmDeleteOrder'))) return
    setBusy(code)
    try {
      const ok = onDelete ? await onDelete(code) : false
      if (!ok) setToast?.(t('deskDeleteFail'))
    } catch {
      setToast?.(t('deskDeleteFail')) // P21 : même protection que changeStatus
    } finally {
      setBusy(null)
    }
  }

  // LOT 8.8 (A8) : la locale ne se déduit plus ici — `formatDateTime` est la
  // seule définition (voir `src/format.js`), partagée avec `OrdersPage`.
  const formatAt = (at) => formatDateTime(at, lang)

  // P14 (#3) : conversion partagée et testée (`waNumber`, src/orderLogic.js).
  // wa.me exige l'international 213XXXXXXXXX alors que la base stocke le
  // format local 0XXXXXXXXX — l'ancienne version locale ne traitait que les
  // 9 chiffres, donc tous les liens WhatsApp du comptoir étaient morts.
  function waLink(r) {
    const num = waNumber(r.phone)
    if (!num) return null
    const st = r.status === 'pending' ? 'new' : r.status || 'new'
    const msg =
      st === 'ready'
        ? t('deskWaReady', { code: r.code, name: r.name, slot: r.slot || '', total: money(r.total, lang) })
        : t('deskWaContact', { code: r.code, name: r.name, status: t(statusLabelKey(st)), slot: r.slot || '', total: money(r.total, lang) })
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
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
                // P9 (P7-4) : date LOCALE (avant : UTC → les commandes de
                // 00:00–01:00 en Oran n'apparaissaient pas dans « aujourd'hui »)
                const day = localDay(new Date())
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
                      <span className="d-flex gap-1 flex-wrap justify-content-end">
                        {/* LOT 2.3 (F5) : commande créée pendant une coupure
                            réseau, jamais parvenue au serveur. Elle n'est ni
                            dans l'export CSV, ni visible des autres appareils :
                            le maître doit le voir sur la carte, pas le deviner. */}
                        {r.localOnly === true && (
                          <span className="badge text-bg-warning" title={t('ordersLocalOnly')}>
                            {t('ordersLocalOnly')}
                          </span>
                        )}
                        <span className={`badge ${badgeClass(st)}`}>{t(statusLabelKey(st))}</span>
                      </span>
                    </div>
                    <div className="small text-secondary mb-1">
                      {r.slot || '—'} · {formatAt(r.at)}
                    </div>
                    <h2 className="h6 mb-1">{r.name}</h2>
                    <p className="small text-secondary mb-2">
                      {r.phone}
                      {r.carrier ? ` · ${r.carrier}` : ''}
                      {r.wilaya ? ` · ${r.wilaya}` : ''}
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
                      <strong className="text-success fs-5">{money(r.total, lang)}</strong>
                    </div>

                    <div className="d-flex flex-wrap gap-1 mt-auto">
                      {st === 'new' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-warning"
                          disabled={busy === r.code}
                          onClick={() => changeStatus(r.code, 'preparing')}
                        >
                          {t('deskStartPrep')}
                        </button>
                      )}
                      {(st === 'new' || st === 'preparing') && (
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          disabled={busy === r.code}
                          onClick={() => changeStatus(r.code, 'ready')}
                        >
                          {t('deskMarkReady')}
                        </button>
                      )}
                      {st === 'ready' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          disabled={busy === r.code}
                          onClick={() => changeStatus(r.code, 'picked')}
                        >
                          {t('deskMarkPicked')}
                        </button>
                      )}
                      {/* P6 : contact WhatsApp client disponible à tout moment
                          (avant : uniquement au statut « prêt ») */}
                      {st !== 'cancelled' && st !== 'picked' && waLink(r) && (
                        <a className="btn btn-sm btn-outline-success" href={waLink(r)} target="_blank" rel="noreferrer">
                          WhatsApp
                        </a>
                      )}
                      {st !== 'cancelled' && st !== 'picked' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          disabled={busy === r.code}
                          onClick={() => changeStatus(r.code, 'cancelled')}
                        >
                          {t('deskCancel')}
                        </button>
                      )}
                      {st !== 'cancelled' && st !== 'picked' && r.userId == null && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          disabled={busy === r.code}
                          onClick={() => issueCode(r.code)}
                          title={t('deskClaimHint')}
                        >
                          {claimCodes[r.code] ? t('deskClaimAgain') : t('deskClaimCode')}
                        </button>
                      )}
                      {/* P19 : corbeille — suppression définitive, dispo pour
                          tous les statuts (y compris « picked » et
                          « cancelled », que l'annulation ne couvre pas). */}
                      {onDelete && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={busy === r.code}
                          onClick={() => removeOrder(r.code)}
                          title={t('deskDelete')}
                          aria-label={`${t('deskDelete')} ${r.code}`}
                        >
                          🗑 {t('deskDelete')}
                        </button>
                      )}
                    </div>
                    {claimCodes[r.code] && (
                      <div className="small mt-2 border rounded p-2 bg-body-tertiary">
                        <span className="text-secondary">{t('deskClaimReady')} </span>
                        <code className="fw-bold fs-6 user-select-all">{claimCodes[r.code]}</code>
                      </div>
                    )}
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
