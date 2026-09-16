import { useEffect, useMemo, useState } from 'react'
// LOT 2.5 (F9) : `PRODUCTS` est le catalogue de base COMPLET — non filtré par
// stock ni par masquage. C'est la seule source qui contient les SKU des
// références en rupture ou masquées.
import { CATEGORIES, PRODUCTS, money } from './data.js'
import { addPanel, addProduct, deleteCustomer, hideProduct, setProductPhotos, togglePanel } from './shopStore.js'
import PartThumb from './PartThumb.jsx'
import * as api from './api.js'
import { compressDataUrl } from './photoCompress.js'
// LOT 8.4 (A4) + LOT 8.5 (A5) : les budgets d'octets viennent du module
// partagé — les mêmes valeurs bornent la compression client, cette garde
// d'envoi, la borne du corps côté serveur et le refus par photo.
import { MAX_INPUT_BYTES, MAX_PHOTOS, MAX_UPLOAD_BODY_BYTES, payloadOverBudget, toMb } from './limits.js'
import { labelOr } from './i18n.js'

/**
 * Traduit une réponse d'API en message utilisateur.
 * Exportée pour test : c'est elle qui nomme le refus de stockage (LOT 4.2/F15)
 * au lieu d'un « échec » générique qui faisait réessayer en boucle.
 */
export function errToast(setToast, t, r, fallbackKey) {
  // P6 : message d'erreur honnête — offline ≠ refus serveur.
  if (r?.offline || !r) {
    setToast(t('backendOffline'))
    return
  }
  // LOT 4.2 (F15) : le serveur refuse l'upload quand il n'a aucun stockage
  // durable (Vercel sans `BLOB_READ_WRITE_TOKEN` : les fichiers iraient dans
  // `/tmp` et mourraient au cold start, laissant des URL de photos mortes en
  // base). Le message générique « échec » faisait réessayer en boucle ;
  // celui-ci nomme la cause et la variable à poser.
  if (r?.data?.error === 'upload_storage') {
    setToast(t('masterPhotoNoStorage'))
    return
  }
  // LOT 8.10 (A10) : le serveur refuse désormais une `category` ou un `kind`
  // hors liste (`CATEGORIES` / `KINDS`, hors `all`). Un refus qui dit quoi
  // saisir vaut mieux que « échec de la création » : sans message dédié, le
  // maître ne sait pas quel champ reprendre.
  if (r?.data?.error === 'category') {
    setToast(t('masterCategoryInvalid'))
    return
  }
  if (r?.data?.error === 'kind') {
    setToast(t('masterKindInvalid'))
    return
  }
  setToast(t(fallbackKey))
}

/**
 * LOT 4.3 (F16) — message de suppression d'un compte client.
 *
 * Le serveur annule les commandes EN COURS du compte (le stock réservé est
 * rendu) et renvoie le détail. Le message le dit : avant, un « Client supprimé »
 * muet laissait le master croire que rien d'autre ne s'était passé, alors que
 * des pièces venaient de revenir au stock — et que la trace restait au
 * comptoir (commandes `cancelled`). Les codes sont bornés à 4 pour ne pas
 * noyer le toast.
 */
export function customerDeletedMessage(t, data) {
  const cancelled = Array.isArray(data?.cancelled) ? data.cancelled : []
  if (!cancelled.length) return t('masterCustomerGone')
  const codes = cancelled
    .map((c) => c?.code)
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
  return t('masterCustomerGoneOrders', { n: cancelled.length, codes })
}

// P4 (B10) : compression canvas avant envoi (800 px / JPEG q0.8) → le body
// d'upload passe de ~20 Mo max à ~2 Mo (Vercel 413 évité, latence réduite).
// Limite d'entrée relevée à 10 Mo : la sortie compressée reste bien plus petite.
// LOT 8.5 (A5) : la compression est désormais aussi pilotée par un budget
// d'octets (voir src/photoCompress.js), donc une image petite en pixels mais
// lourde est ré-encodée au lieu de partir telle quelle.

function readFilesAsDataUrls(fileList) {
  const files = [...(fileList || [])].slice(0, MAX_PHOTOS)
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          if (!file.type.startsWith('image/')) return resolve(null)
          if (file.size > MAX_INPUT_BYTES) return reject(new Error('big'))
          const reader = new FileReader()
          reader.onload = () => resolve(compressDataUrl(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
    )
  ).then((list) => list.filter(Boolean))
}

// LOT 8.5 (A5) : la garde d'envoi vit dans `src/limits.js`, à côté des budgets
// qu'elle applique (`payloadOverBudget`) — la même fonction est testable hors
// React, et client comme documentation parlent d'une seule borne.

export default function MasterPage({ t, lang, user, users, onUsers, products, masterCatalog, meta, onMeta, basePanels, setToast, onBack, apiOnline, onStockRefresh }) {
  const [tab, setTab] = useState('products')
  const [form, setForm] = useState({
    name: '',
    price: '',
    stock: '1',
    category: 'accessories',
    brand: 'PC Star',
    short: '',
    sku: '',
    photos: []
  })
  const [panelTitle, setPanelTitle] = useState({ ar: '', fr: '', en: '' })
  const [panelCat, setPanelCat] = useState('accessories')
  const [editId, setEditId] = useState(null)
  const [editPhotos, setEditPhotos] = useState([])
  const [apiCustomers, setApiCustomers] = useState([])
  const [apiProducts, setApiProducts] = useState([])
  const [apiTick, setApiTick] = useState(0)

  // Mode API : la liste des clients vient du serveur (les clients créés via
  // l'API n'existent pas dans le store local).
  useEffect(() => {
    if (!apiOnline) return undefined
    let cancelled = false
    api.listCustomers().then((r) => {
      if (!cancelled && r.ok && Array.isArray(r.data?.customers)) setApiCustomers(r.data.customers)
    })
    return () => {
      cancelled = true
    }
  }, [apiOnline])

  // P6 : la vue master API = /api/master/products — TOUS les produits
  // (masqués et rupture inclus, avec le drapeau `hidden`), contrairement au
  // catalogue public filtré. Re-chargée après chaque mutation (apiTick).
  useEffect(() => {
    if (!apiOnline) return undefined
    let cancelled = false
    api.masterProducts().then((r) => {
      if (!cancelled && r.ok && Array.isArray(r.data?.products)) setApiProducts(r.data.products)
    })
    return () => {
      cancelled = true
    }
  }, [apiOnline, apiTick])

  const productsLoading = apiOnline && apiProducts.length === 0
  const productsShown = apiOnline ? apiProducts : (masterCatalog || products || [])

  // LOT 2.5 (F9) : liste de référence pour le contrôle de SKU en mode local.
  //
  // `addProduct` recevait `products`, c'est-à-dire le catalogue PUBLIC filtré :
  // `shopView.products` privé des références en rupture (`stock > 0`,
  // src/App.jsx). Un SKU appartenant à une référence masquée OU en rupture
  // n'était donc dans aucune des listes examinées, et la création passait —
  // deux fiches portant la même référence d'étiquette, le même dossier photo et
  // la même ligne d'export CSV. Côté API le serveur compare déjà à
  // `[...PRODUCTS, ...extraProducts]` (server/masterApi.js) : le mode local
  // s'aligne sur cette source de vérité.
  const allKnownSkus = useMemo(
    () => [...PRODUCTS, ...(masterCatalog || []), ...(products || []), ...(meta.extraProducts || [])],
    [masterCatalog, products, meta]
  )

  const customers = useMemo(
    () => (apiOnline ? apiCustomers : users.filter((u) => u.role !== 'master')),
    [apiOnline, apiCustomers, users]
  )

  if (!user || user.role !== 'master') {
    return (
      <main id="main-content" className="container page py-4" tabIndex={-1}>
        <div className="alert alert-danger">{t('masterForbidden')}</div>
        <button className="btn btn-outline-secondary" type="button" onClick={onBack}>
          {t('backToShop')}
        </button>
      </main>
    )
  }

  async function onFormPhotos(e) {
    try {
      const urls = await readFilesAsDataUrls(e.target.files)
      setForm((f) => ({ ...f, photos: [...f.photos, ...urls].slice(0, MAX_PHOTOS) }))
    } catch {
      setToast(t('masterPhotoTooBig', { mb: toMb(MAX_INPUT_BYTES) }))
    }
    e.target.value = ''
  }

  async function onEditPhotos(e) {
    try {
      const urls = await readFilesAsDataUrls(e.target.files)
      setEditPhotos((prev) => [...prev, ...urls].slice(0, MAX_PHOTOS))
    } catch {
      setToast(t('masterPhotoTooBig', { mb: toMb(MAX_INPUT_BYTES) }))
    }
    e.target.value = ''
  }

  async function submitProduct(e) {
    e.preventDefault()
    if (apiOnline) {
      // LOT 8.5 (A5) : refus AVANT l'envoi si le corps dépasserait le budget.
      const over = payloadOverBudget(form.photos)
      if (over) {
        setToast(t('masterPhotosTooHeavy', { size: toMb(over), limit: toMb(MAX_UPLOAD_BODY_BYTES) }))
        return
      }
      const r = await api.masterCreateProduct({
        name: form.name,
        price: Number(form.price),
        stock: Number(form.stock),
        category: form.category,
        brand: form.brand,
        short: form.short,
        sku: form.sku || undefined,
        photoDataUrls: form.photos
      })
      if (!r.ok) {
        // P22 (bug H) : le serveur répond `sku_taken` quand le SKU saisi existe
        // déjà — un message dédié plutôt que « échec de création ».
        if (r.data?.error === 'sku_taken') setToast(t('masterSkuTaken'))
        else errToast(setToast, t, r, 'masterCreateFail')
        return
      }
      setForm({ name: '', price: '', stock: '1', category: form.category, brand: 'PC Star', short: '', sku: '', photos: [] })
      setToast(t('masterAdded'))
      setApiTick((x) => x + 1)
      onStockRefresh?.()
      return
    }
    const res = addProduct(
      meta,
      {
        name: form.name,
        price: Number(form.price),
        stock: Number(form.stock),
        category: form.category,
        brand: form.brand,
        short: form.short,
        sku: form.sku || undefined,
        photos: form.photos
      },
      // P22 (bug H) : le catalogue de base compte aussi — un SKU saisi ne doit
      // pas doubler une référence existante.
      // LOT 2.5 (F9) : catalogue COMPLET (base non filtrée + master + extra),
      // pas la liste publique amputée des ruptures et des masquées.
      allKnownSkus
    )
    if (!res.ok) {
      if (res.error === 'sku_taken') {
        setToast(t('masterSkuTaken'))
        return
      }
      // LOT 8.10 (A10) : le mode local valide la catégorie avec la même liste
      // que l'API — même message dédié, pour que les deux chemins disent la
      // même chose.
      if (res.error === 'category') {
        setToast(t('masterCategoryInvalid'))
        return
      }
      // P17 (rapport #1) : copier-coller de la page de connexion — un master en
      // mode local voyait « 6 caractères minimum » quand la création du produit
      // échouait (nom vide, prix invalide). Le mode API disait déjà juste.
      setToast(t('masterCreateFail'))
      return
    }
    onMeta(res.meta)
    setForm({ name: '', price: '', stock: '1', category: form.category, brand: 'PC Star', short: '', sku: '', photos: [] })
    setToast(t('masterAdded'))
  }

  function openEdit(p) {
    setEditId(p.id)
    setEditPhotos([...(p.photos || [])].slice(0, MAX_PHOTOS))
  }

  async function saveEditPhotos() {
    if (!editId) return
    if (apiOnline) {
      // split data urls vs paths
      const dataUrls = editPhotos.filter((x) => String(x).startsWith('data:'))
      const paths = editPhotos.filter((x) => !String(x).startsWith('data:'))
      let photos = paths
      if (dataUrls.length) {
        // LOT 8.5 (A5) : même garde que la création.
        const over = payloadOverBudget(dataUrls)
        if (over) {
          setToast(t('masterPhotosTooHeavy', { size: toMb(over), limit: toMb(MAX_UPLOAD_BODY_BYTES) }))
          return
        }
        const up = await api.masterPhotos(editId, dataUrls)
        if (!up.ok) {
          errToast(setToast, t, up, 'masterActionFail')
          return
        }
        if (up.data?.product?.photos) photos = up.data.product.photos
      } else {
        const r = await api.masterUpdateProduct(editId, { photos: paths })
        if (!r.ok) {
          errToast(setToast, t, r, 'masterActionFail')
          return
        }
        photos = r.data?.product?.photos || paths
      }
      setEditId(null)
      setEditPhotos([])
      setToast(t('masterPhotosSaved'))
      setApiTick((x) => x + 1)
      onStockRefresh?.()
      return
    }
    const res = setProductPhotos(meta, editId, editPhotos)
    if (!res.ok) return
    onMeta(res.meta)
    setEditId(null)
    setEditPhotos([])
    setToast(t('masterPhotosSaved'))
  }

  // P6 : masquer ↔ afficher (toggle). En mode API, le produit masqué reste
  // visible dans cette liste (fournie par /api/master/products) — on peut
  // donc le réafficher, au lieu de disparaître définitivement de la vue.
  async function doToggleHidden(id, isHidden) {
    if (apiOnline) {
      const r = await api.masterHideProduct(id, !isHidden)
      if (!r.ok) {
        errToast(setToast, t, r, 'masterActionFail')
        return
      }
      setToast(isHidden ? t('masterShown') : t('masterHidden'))
      setApiTick((x) => x + 1)
      onStockRefresh?.()
      return
    }
    const next = isHidden
      ? { ...meta, hiddenProductIds: (meta.hiddenProductIds || []).filter((x) => x !== id) }
      : hideProduct(meta, id)
    onMeta(next)
    setToast(isHidden ? t('masterShown') : t('masterHidden'))
  }

  function doDeleteCustomer(id) {
    if (apiOnline) {
      // Suppression côté serveur (sessions purgées, commandes détachées).
      api.deleteCustomer(id).then((r) => {
        if (r.ok) {
          setApiCustomers((prev) => prev.filter((c) => c.id !== id))
          // LOT 4.3 (F16) : le serveur annule les commandes EN COURS du compte
          // (le stock réservé est rendu) et renvoie le détail. Le master voit
          // ainsi ce que la suppression a entraîné — avant, un `{ok:true}` muet
          // laissait des pièces réservées pour un compte qui n'existe plus,
          // sans aucune trace à l'écran.
          setToast(customerDeletedMessage(t, r.data))
        } else {
          errToast(setToast, t, r, 'masterActionFail')
        }
      })
      return
    }
    const res = deleteCustomer(users, user, id)
    if (!res.ok) {
      setToast(t(res.error === 'master' ? 'masterCannotDelete' : 'masterForbidden'))
      return
    }
    onUsers(res.users)
    setToast(t('masterCustomerGone'))
  }

  // P6 : panneaux synchronisés avec le serveur (/api/master/panels) —
  // visibles sur tous les appareils, plus seulement en local.
  async function doTogglePanel(id, on) {
    if (apiOnline) {
      const current = new Set(meta.hiddenPanelIds || [])
      if (on) current.delete(id)
      else current.add(id)
      const r = await api.putPanels({ hiddenPanelIds: [...current] })
      if (!r.ok) {
        errToast(setToast, t, r, 'masterActionFail')
        return
      }
      // LOT 2.7 (F11 + B20) : la RÉPONSE DU SERVEUR est la source de vérité,
      // pas le calcul local. Le serveur déduplique (`new Set(...)`) et tronque
      // `extraPanels` à 12 : un état client reconstruit à partir de `meta`
      // divergeait donc silencieusement de la base, jusqu'au prochain
      // rechargement. La réponse ne porte que les deux champs de panneaux —
      // d'où la fusion, qui préserve `extraProducts`, `productOverrides`, etc.
      onMeta({ ...meta, ...(r.data?.meta || {}) })
      return
    }
    onMeta(togglePanel(meta, id, on))
  }

  async function submitPanel(e) {
    e.preventDefault()
    const res = addPanel(meta, { titles: panelTitle, categories: [panelCat] })
    if (!res.ok) return
    if (apiOnline) {
      const r = await api.putPanels({ extraPanels: [...(meta.extraPanels || []), res.panel] })
      if (!r.ok) {
        errToast(setToast, t, r, 'masterActionFail')
        return
      }
      // LOT 2.7 (F11 + B20) : `res.meta` est le meta calculé LOCALEMENT par
      // `addPanel`, qui ne connaît pas la troncature serveur
      // (`body.extraPanels.slice(0, 12)`, server/index.js). Reproduit à
      // l'audit : au 13ᵉ panneau, le comptoir en affichait 13 alors que la base
      // n'en gardait que 12 — le 13ᵉ disparaissait au rechargement suivant, sans
      // aucun message. On prend la réponse du serveur.
      onMeta({ ...meta, ...(r.data?.meta || {}) })
    } else {
      onMeta(res.meta)
    }
    setPanelTitle({ ar: '', fr: '', en: '' })
    setToast(t('masterAdded'))
  }

  const hidden = new Set(meta.hiddenPanelIds || [])

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('backToShop')}
      </button>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h3 mb-0">{t('masterTitle')}</h1>
        {apiOnline && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={async () => {
              const r = await api.masterBackup()
              setToast(r.ok ? t('masterBackupOk') : t('deskStatusFail'))
            }}
          >
            {t('masterBackup')}
          </button>
        )}
      </div>

      <ul className="nav nav-pills gap-2 mb-4">
        {['products', 'customers', 'panels'].map((id) => (
          <li className="nav-item" key={id}>
            <button type="button" className={`nav-link ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {id === 'products' ? t('masterProducts') : id === 'customers' ? t('masterCustomers') : t('masterPanels')}
            </button>
          </li>
        ))}
      </ul>

      {tab === 'products' && (
        <div className="row g-4">
          <div className="col-lg-4">
            <form className="card shadow-sm border-0" onSubmit={submitProduct}>
              <div className="card-body">
                <h2 className="h5 mb-3">{t('masterAddProduct')}</h2>
                <div className="mb-2">
                  <label className="form-label small">{t('masterName')}</label>
                  <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="mb-2">
                  <label className="form-label small">{t('masterSku')}</label>
                  <input className="form-control" value={form.sku} placeholder={t('masterSkuPh')} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label small">{t('masterPrice')}</label>
                    <input className="form-control" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
                  </div>
                  <div className="col-6">
                    <label className="form-label small">{t('masterStock')}</label>
                    <input className="form-control" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label small">{t('masterCategory')}</label>
                  <select className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                      <option key={c.id} value={c.id}>
                        {labelOr(t, `cat_${c.id}`, c.label || c.id)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label small">{t('masterBrand')}</label>
                  <input className="form-control" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small">{t('masterShort')}</label>
                  <input className="form-control" value={form.short} onChange={(e) => setForm({ ...form, short: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small">{t('masterPhotos')}</label>
                  <input className="form-control" type="file" accept="image/*" multiple onChange={onFormPhotos} />
                  <div className="form-text">{t('masterPhotosHint')}</div>
                </div>
                {form.photos.length > 0 && (
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    {form.photos.map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        className="btn p-0 border rounded overflow-hidden"
                        style={{ width: 56, height: 56 }}
                        onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
                        title={t('remove')}
                      >
                        <img src={src} alt="" className="w-100 h-100" style={{ objectFit: 'cover' }} />
                      </button>
                    ))}
                  </div>
                )}
                <button className="btn btn-success w-100" type="submit">
                  {t('masterAddProduct')}
                </button>
              </div>
            </form>
          </div>

          <div className="col-lg-8">
            {productsLoading ? (
              <p className="text-secondary">…</p>
            ) : (
            <div className="d-flex flex-column gap-2">
              {productsShown.map((p) => (
                <div className={`card shadow-sm ${p.hidden ? 'opacity-75' : ''}`} key={p.id}>
                  <div className="card-body">
                    <div className="d-flex flex-wrap gap-3 align-items-center">
                      <div style={{ width: 56, height: 56 }} className="rounded overflow-hidden bg-body-secondary flex-shrink-0">
                        <PartThumb product={p} />
                      </div>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">
                          {p.sku}
                          {p.hidden ? ` · ${t('masterHiddenBadge')}` : ''}
                        </div>
                        <strong>{p.name}</strong>
                        <div className="small text-secondary">
                          {money(p.price, lang)} · {p.stock} · {labelOr(t, `cat_${p.category}`, p.category)} · {(p.photos || []).length} img
                        </div>
                      </div>
                      <div className="d-flex gap-2">
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => openEdit(p)}>
                          {t('masterEditPhotos')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${p.hidden ? 'btn-outline-success' : 'btn-outline-danger'}`}
                          onClick={() => doToggleHidden(p.id, Boolean(p.hidden))}
                        >
                          {p.hidden ? t('masterShow') : t('masterHide')}
                        </button>
                      </div>
                    </div>
                    {editId === p.id && (
                      <div className="border-top mt-3 pt-3">
                        <p className="small text-secondary">{t('masterPhotosHint')}</p>
                        <input className="form-control form-control-sm mb-2" type="file" accept="image/*" multiple onChange={onEditPhotos} />
                        <div className="d-flex flex-wrap gap-2 mb-2">
                          {editPhotos.map((src, i) => (
                            <button
                              key={i}
                              type="button"
                              className="btn p-0 border rounded overflow-hidden"
                              style={{ width: 56, height: 56 }}
                              onClick={() => setEditPhotos((prev) => prev.filter((_, j) => j !== i))}
                              title={t('remove')}
                            >
                              <img src={src} alt="" className="w-100 h-100" style={{ objectFit: 'cover' }} />
                            </button>
                          ))}
                        </div>
                        <div className="d-flex gap-2">
                          <button type="button" className="btn btn-sm btn-success" onClick={saveEditPhotos}>
                            {/* LOT 5.3 (U3) : le bouton disait « Photos
                                enregistrées » — au passé, AVANT d'enregistrer.
                                Un libellé d'action se lit comme une action ;
                                « Photos enregistrées » reste le toast de
                                confirmation (`saveEditPhotos`). */}
                            {t('masterSavePhotos')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => {
                              setEditId(null)
                              setEditPhotos([])
                            }}
                          >
                            {t('close')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div className="row g-3">
          {customers.length === 0 ? (
            <p className="text-secondary">{t('deskEmpty')}</p>
          ) : (
            customers.map((c) => (
              <div className="col-md-6 col-lg-4" key={c.id}>
                <div className="card h-100 shadow-sm">
                  <div className="card-body d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <strong>{c.name}</strong>
                      <div className="small text-secondary">
                        {c.email || '—'} · {c.phone || '—'}
                      </div>
                    </div>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => doDeleteCustomer(c.id)}>
                      {t('masterDelete')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'panels' && (
        <>
        <div className="row g-4">
          <div className="col-lg-4">
            <form className="card shadow-sm border-0" onSubmit={submitPanel}>
              <div className="card-body">
                <h2 className="h5 mb-3">{t('masterPanels')}</h2>
                <div className="mb-2">
                  <label className="form-label small">AR</label>
                  <input className="form-control" value={panelTitle.ar} onChange={(e) => setPanelTitle({ ...panelTitle, ar: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small">FR</label>
                  <input className="form-control" value={panelTitle.fr} onChange={(e) => setPanelTitle({ ...panelTitle, fr: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small">EN</label>
                  <input className="form-control" value={panelTitle.en} onChange={(e) => setPanelTitle({ ...panelTitle, en: e.target.value })} />
                </div>
                <div className="mb-3">
                  <label className="form-label small">{t('masterCategory')}</label>
                  <select className="form-select" value={panelCat} onChange={(e) => setPanelCat(e.target.value)}>
                    {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                      <option key={c.id} value={c.id}>
                        {labelOr(t, `cat_${c.id}`, c.label || c.id)}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-success w-100" type="submit">
                  {t('masterAddProduct')}
                </button>
              </div>
            </form>
          </div>
          <div className="col-lg-8">
            <div className="row g-2">
              {basePanels.map((p) => {
                const on = !hidden.has(p.id)
                const title = p.titles?.[lang] || (p.titleKey ? t(p.titleKey) : p.id)
                return (
                  <div className="col-md-6" key={p.id}>
                    <div className="card shadow-sm">
                      <div className="card-body d-flex justify-content-between align-items-center">
                        <strong>{title}</strong>
                        <button type="button" className={`btn btn-sm ${on ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => doTogglePanel(p.id, !on)}>
                          {on ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
              {(meta.extraPanels || []).map((p) => (
                <div className="col-md-6" key={p.id}>
                  <div className="card shadow-sm">
                    <div className="card-body">
                      <strong>{p.titles?.[lang] || p.titles?.en || p.id}</strong>
                      <div className="small text-secondary">{(p.categories || []).join(', ')}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        </>
      )}
    </main>
  )
}
