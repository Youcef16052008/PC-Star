import { useMemo, useState } from 'react'
import { CATEGORIES, money } from './data.js'
import { addPanel, addProduct, deleteCustomer, hideProduct, setProductPhotos, togglePanel } from './shopStore.js'
import PartThumb from './PartThumb.jsx'

function readFilesAsDataUrls(fileList) {
  const files = [...(fileList || [])].slice(0, 6)
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          if (!file.type.startsWith('image/')) return resolve(null)
          if (file.size > 2.5 * 1024 * 1024) return reject(new Error('big'))
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
    )
  ).then((list) => list.filter(Boolean))
}

export default function MasterPage({ t, lang, user, users, onUsers, products, meta, onMeta, basePanels, setToast, onBack }) {
  const [tab, setTab] = useState('products')
  const [form, setForm] = useState({
    name: '',
    price: '',
    stock: '1',
    category: 'accessories',
    brand: 'PC Star',
    short: '',
    photos: []
  })
  const [panelTitle, setPanelTitle] = useState({ ar: '', fr: '', en: '' })
  const [panelCat, setPanelCat] = useState('accessories')
  const [editId, setEditId] = useState(null)
  const [editPhotos, setEditPhotos] = useState([])

  const customers = useMemo(() => users.filter((u) => u.role !== 'master'), [users])

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
      setForm((f) => ({ ...f, photos: [...f.photos, ...urls].slice(0, 6) }))
    } catch {
      setToast(t('masterPhotoTooBig'))
    }
    e.target.value = ''
  }

  async function onEditPhotos(e) {
    try {
      const urls = await readFilesAsDataUrls(e.target.files)
      setEditPhotos((prev) => [...prev, ...urls].slice(0, 6))
    } catch {
      setToast(t('masterPhotoTooBig'))
    }
    e.target.value = ''
  }

  function submitProduct(e) {
    e.preventDefault()
    const res = addProduct(meta, {
      name: form.name,
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      brand: form.brand,
      short: form.short,
      photos: form.photos
    })
    if (!res.ok) {
      setToast(t('authErrorPassword'))
      return
    }
    onMeta(res.meta)
    setForm({ name: '', price: '', stock: '1', category: form.category, brand: 'PC Star', short: '', photos: [] })
    setToast(t('masterAdded'))
  }

  function openEdit(p) {
    setEditId(p.id)
    setEditPhotos([...(p.photos || [])].slice(0, 6))
  }

  function saveEditPhotos() {
    if (!editId) return
    const res = setProductPhotos(meta, editId, editPhotos)
    if (!res.ok) return
    onMeta(res.meta)
    setEditId(null)
    setEditPhotos([])
    setToast(t('masterPhotosSaved'))
  }

  function doHide(id) {
    onMeta(hideProduct(meta, id))
    setToast(t('masterHidden'))
  }

  function doDeleteCustomer(id) {
    const res = deleteCustomer(users, user, id)
    if (!res.ok) {
      setToast(t(res.error === 'master' ? 'masterCannotDelete' : 'masterForbidden'))
      return
    }
    onUsers(res.users)
    setToast(t('masterCustomerGone'))
  }

  function doTogglePanel(id, on) {
    onMeta(togglePanel(meta, id, on))
  }

  function submitPanel(e) {
    e.preventDefault()
    const res = addPanel(meta, { titles: panelTitle, categories: [panelCat] })
    if (!res.ok) return
    onMeta(res.meta)
    setPanelTitle({ ar: '', fr: '', en: '' })
    setToast(t('masterAdded'))
  }

  const hidden = new Set(meta.hiddenPanelIds || [])

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('backToShop')}
      </button>
      <h1 className="h3 mb-3">{t('masterTitle')}</h1>

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
                        {t(`cat_${c.id}`)}
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
            <div className="d-flex flex-column gap-2">
              {products.map((p) => (
                <div className="card shadow-sm" key={p.id}>
                  <div className="card-body">
                    <div className="d-flex flex-wrap gap-3 align-items-center">
                      <div style={{ width: 56, height: 56 }} className="rounded overflow-hidden bg-body-secondary flex-shrink-0">
                        <PartThumb product={p} />
                      </div>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">{p.sku}</div>
                        <strong>{p.name}</strong>
                        <div className="small text-secondary">
                          {money(p.price)} · {p.stock} · {t(`cat_${p.category}`) || p.category} · {(p.photos || []).length} img
                        </div>
                      </div>
                      <div className="d-flex gap-2">
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => openEdit(p)}>
                          {t('masterEditPhotos')}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => doHide(p.id)}>
                          {t('masterHide')}
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
                            {t('masterPhotosSaved')}
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
                        {t(`cat_${c.id}`)}
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
      )}
    </main>
  )
}
