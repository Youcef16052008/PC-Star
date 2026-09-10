import { useMemo, useState } from 'react'
import { CATEGORIES, money } from './data.js'
import {
  addPanel,
  addProduct,
  deleteCustomer,
  hideProduct,
  setProductPhotos,
  togglePanel
} from './shopStore.js'
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

export default function MasterPage({
  t,
  lang,
  user,
  users,
  onUsers,
  products,
  meta,
  onMeta,
  basePanels,
  setToast,
  onBack
}) {
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
      <main className="wrap page">
        <p className="empty">{t('masterForbidden')}</p>
        <button className="back" type="button" onClick={onBack}>
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
    <main className="wrap page">
      <button className="back" type="button" onClick={onBack}>
        {t('backToShop')}
      </button>
      <h1 style={{ marginBottom: 12 }}>{t('masterTitle')}</h1>

      <div className="auth-tabs" style={{ marginBottom: 16 }}>
        {['products', 'customers', 'panels'].map((id) => (
          <button key={id} type="button" className={`chip ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {id === 'products' ? t('masterProducts') : id === 'customers' ? t('masterCustomers') : t('masterPanels')}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <div className="master-grid">
          <form className="callbox" onSubmit={submitProduct}>
            <h2>{t('masterAddProduct')}</h2>
            <label>{t('masterName')}</label>
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <label>{t('masterPrice')}</label>
            <input className="field" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            <label>{t('masterStock')}</label>
            <input className="field" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            <label>{t('masterCategory')}</label>
            <select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`cat_${c.id}`)}
                </option>
              ))}
            </select>
            <label>{t('masterBrand')}</label>
            <input className="field" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            <label>{t('masterShort')}</label>
            <input className="field" value={form.short} onChange={(e) => setForm({ ...form, short: e.target.value })} />
            <label>{t('masterPhotos')}</label>
            <input className="field" type="file" accept="image/*" multiple onChange={onFormPhotos} />
            <p className="short">{t('masterPhotosHint')}</p>
            {form.photos.length > 0 && (
              <div className="photo-edit-row">
                {form.photos.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    className="photo-edit-thumb"
                    onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
                    title={t('remove')}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            )}
            <button className="add wide" type="submit">
              {t('masterAddProduct')}
            </button>
          </form>

          <div className="desk-list">
            {products.map((p) => (
              <article className="desk-card master-product" key={p.id}>
                <div className="master-prod-row">
                  <div className="item-thumb">
                    <PartThumb product={p} />
                  </div>
                  <div>
                    <div className="sku">{p.sku}</div>
                    <strong>{p.name}</strong>
                    <div className="short">
                      {money(p.price)} · {p.stock} · {t(`cat_${p.category}`) || p.category} · {(p.photos || []).length} img
                    </div>
                  </div>
                  <div className="master-actions">
                    <button type="button" className="ghost tiny" onClick={() => openEdit(p)}>
                      {t('masterEditPhotos')}
                    </button>
                    <button type="button" className="ghost tiny" onClick={() => doHide(p.id)}>
                      {t('masterHide')}
                    </button>
                  </div>
                </div>
                {editId === p.id && (
                  <div className="photo-editor">
                    <p className="short">{t('masterPhotosHint')}</p>
                    <input className="field" type="file" accept="image/*" multiple onChange={onEditPhotos} />
                    <div className="photo-edit-row">
                      {editPhotos.map((src, i) => (
                        <button
                          key={i}
                          type="button"
                          className="photo-edit-thumb"
                          onClick={() => setEditPhotos((prev) => prev.filter((_, j) => j !== i))}
                          title={t('remove')}
                        >
                          <img src={src} alt="" />
                        </button>
                      ))}
                    </div>
                    <div className="alt-row">
                      <button type="button" className="add" onClick={saveEditPhotos}>
                        {t('masterPhotosSaved')}
                      </button>
                      <button type="button" className="ghost tiny" onClick={() => { setEditId(null); setEditPhotos([]) }}>
                        {t('close')}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div className="desk-list">
          {customers.length === 0 ? (
            <p className="empty">{t('deskEmpty')}</p>
          ) : (
            customers.map((c) => (
              <article className="desk-card" key={c.id}>
                <header>
                  <strong>{c.name}</strong>
                  <button type="button" className="remove" onClick={() => doDeleteCustomer(c.id)}>
                    {t('masterDelete')}
                  </button>
                </header>
                <p className="short">
                  {c.email || '—'} · {c.phone || '—'}
                </p>
              </article>
            ))
          )}
        </div>
      )}

      {tab === 'panels' && (
        <div className="master-grid">
          <form className="callbox" onSubmit={submitPanel}>
            <h2>{t('masterPanels')}</h2>
            <label>AR</label>
            <input className="field" value={panelTitle.ar} onChange={(e) => setPanelTitle({ ...panelTitle, ar: e.target.value })} />
            <label>FR</label>
            <input className="field" value={panelTitle.fr} onChange={(e) => setPanelTitle({ ...panelTitle, fr: e.target.value })} />
            <label>EN</label>
            <input className="field" value={panelTitle.en} onChange={(e) => setPanelTitle({ ...panelTitle, en: e.target.value })} />
            <label>{t('masterCategory')}</label>
            <select className="field" value={panelCat} onChange={(e) => setPanelCat(e.target.value)}>
              {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`cat_${c.id}`)}
                </option>
              ))}
            </select>
            <button className="add wide" type="submit">
              {t('masterAddProduct')}
            </button>
          </form>
          <div className="desk-list">
            {basePanels.map((p) => {
              const on = !hidden.has(p.id)
              const title = p.titles?.[lang] || (p.titleKey ? t(p.titleKey) : p.id)
              return (
                <article className="desk-card" key={p.id}>
                  <header>
                    <strong>{title}</strong>
                    <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => doTogglePanel(p.id, !on)}>
                      {on ? 'ON' : 'OFF'}
                    </button>
                  </header>
                </article>
              )
            })}
            {(meta.extraPanels || []).map((p) => (
              <article className="desk-card" key={p.id}>
                <header>
                  <strong>{p.titles?.[lang] || p.titles?.en || p.id}</strong>
                  <span className="short">{(p.categories || []).join(', ')}</span>
                </header>
              </article>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
