import { useEffect, useState } from 'react'
import { money } from './data.js'
// LOT 8.8 (A8) : le formatage de la date passe par le module partagé — avant,
// `new Date(o.at).toLocaleString()` ignorait la langue choisie et rendait la
// locale du NAVIGATEUR : en mode arabe, le comptoir affichait `ar-DZ` et cette
// page `fr-FR`, deux formats pour la même commande.
import { formatDateTime } from './format.js'
import * as api from './api.js'
import { canCancelHere, statusLabelKey } from './orderLogic.js'
import { loadOrders } from './prefs.js'

/**
 * P11 : page unique « Commandes » (remplace « Mes commandes » dans le profil).
 *
 * Sources croisées, dédoublonnées par code :
 *  - client connecté + backend en ligne : commandes serveur (`/api/orders/mine`,
 *    qui inclut aussi les commandes guest passées au même téléphone) + copie
 *    locale du navigateur ;
 *  - sinon (hors-ligne, mode local, ou guest) : copie locale du navigateur —
 *    les commandes réussies via l'API sont maintenant aussi persistées localement
 *    à la création (reserve → saveOrders), un guest retrouve donc les siennes
 *    depuis cet appareil.
 *
 * LOT 2.8 (F12) : les commandes **guest de cet appareil** restent visibles après
 * connexion, marquées « passées sans compte ».
 */
export default function OrdersPage({ t, lang = 'fr', user, apiOnline, mode, onCancelOrder, onBack }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancelTick, setCancelTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const all = loadOrders()
    // LOT 2.8 (F12) : avant, un compte connecté ne voyait QUE `userId ===
    // user.id`. Les commandes passées en guest depuis cet appareil
    // (`userId == null`) disparaissaient donc à la connexion — y compris celle
    // qui venait d'être faite, puisque le client se connectait souvent APRÈS
    // avoir réservé (le serveur, lui, les rattache déjà par téléphone dans
    // `/api/me/orders`). Union des deux, chacune marquée dans l'UI.
    //
    // Limite assumée : sur un appareil partagé, un compte connecté voit aussi
    // les commandes guest d'un tiers faites sur le même navigateur. C'est la
    // frontière de confiance du `localStorage` — la même que celle du serveur,
    // qui rattache par numéro de téléphone saisi. Le marquage explicite
    // (« passée sans compte ») dit d'où vient la ligne.
    const local = user
      ? all.filter((o) => o.userId === user.id || o.userId == null)
      : all.filter((o) => o.userId == null)
    ;(async () => {
      if (!(user && apiOnline && mode === 'api')) {
        if (!cancelled) {
          setOrders(local)
          setLoading(false)
        }
        return
      }
      const r = await api.myOrders()
      if (cancelled) return
      if (r.ok && Array.isArray(r.data?.orders)) {
        const seen = new Set(r.data.orders.map((o) => o.code))
        setOrders([...r.data.orders, ...local.filter((o) => !seen.has(o.code))])
      } else {
        setOrders(local)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiOnline, mode, user?.id, cancelTick])

  async function doCancel(code) {
    const ok = await onCancelOrder?.(code)
    if (ok) setCancelTick((x) => x + 1)
  }

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('continueShopping')}
      </button>
      <div className="row g-4">
        <div className="col-12 col-lg-10 col-xl-8 mx-auto">
          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <h1 className="h4 mb-1">{t('navOrders')}</h1>
              <p className="small text-secondary mb-3">{t('ordersPageBody')}</p>
              {!user && <p className="small text-secondary">{t('ordersGuestNote')}</p>}
              {loading ? (
                <div className="empty-state py-4 text-center">
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                  {t('ordersLoading')}
                </div>
              ) : orders.length === 0 ? (
                <div className="empty-state py-4">
                  <strong>{t('myOrdersEmpty')}</strong>
                  <p className="small mb-0">{t('myOrdersEmptyBody')}</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {orders.map((o) => (
                    <article key={o.code} className="border rounded p-3">
                      <div className="d-flex justify-content-between gap-2 flex-wrap">
                        <span className="font-monospace fw-semibold">{o.code}</span>
                        <span className="d-flex gap-1 flex-wrap">
                          {/* LOT 2.8 (F12) : distingue les commandes rattachées au
                              compte de celles passées sans compte depuis cet
                              appareil (ou rattachées par téléphone côté serveur). */}
                          {user && o.userId == null && (
                            <span className="badge text-bg-light border">{t('orderGuestBadge')}</span>
                          )}
                          {/* LOT 2.3 (F5) : commande créée hors-ligne, jamais
                              parvenue au serveur — conservée par la fusion. */}
                          {o.localOnly === true && (
                            <span className="badge text-bg-warning">{t('ordersLocalOnly')}</span>
                          )}
                          <span className="badge text-bg-secondary">{t(statusLabelKey(o.status === 'pending' ? 'new' : o.status || 'new'))}</span>
                        </span>
                      </div>
                      <div className="small text-secondary mt-1">
                        {o.slot || '—'} · {formatDateTime(o.at, lang)}
                      </div>
                      <ul className="small mb-1 mt-2">
                        {(o.items || []).map((i) => (
                          <li key={i.id}>
                            {i.qty} × {i.name}
                          </li>
                        ))}
                      </ul>
                      <div className="d-flex justify-content-between align-items-center">
                        <div className="fw-semibold text-success">{money(o.total, lang)}</div>
                        {/* LOT 8.3 (A3) : annulation possible tant que la commande
                            est « neuve » ET revendicable (`canCancelHere`).
                            Avant, seul le statut comptait : une commande
                            `claimable: false` (guest déposée au numéro d'un
                            compte, lot 4.4 / R20) affichait un bouton que le
                            serveur refusait toujours en 404 — une action
                            promise et impossible, avec un message d'échec qui ne
                            disait ni pourquoi ni quoi faire. */}
                        {canCancelHere(o) && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => doCancel(o.code)}
                            title={t('orderOnlyNew')}
                          >
                            {t('orderCancel')}
                          </button>
                        )}
                        {o.claimable === false && (
                          <span className="small text-secondary text-end" title={t('orderNotClaimable')}>
                            {t('orderNotClaimable')}
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
