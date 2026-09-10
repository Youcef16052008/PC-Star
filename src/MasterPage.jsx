import { useMemo, useState } from 'react'
import { CATEGORIES, money } from './data.js'
import {
  addPanel,
  addProduct,
  deleteCustomer,
  hideProduct,
  togglePanel
} from './shopStore.js'
import PartThumb from './PartThumb.jsx'

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
    short: ''
  })
  const [panelTitle, setPanelTitle] = useState({ ar: '', fr: '', en: '' })
  const [panelCat, setPanelCat] = useState('accessories')

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

  function submitProduct(e) {
    e.preventDefault()
    const res = addProduct(meta, {
      name: form.name,
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      brand: form.brand,
      short: form.short
    })
    if (!res.ok) {
      setToast(t('authErrorPassword'))
      return
    }
    onMeta(res.meta)
    setForm({ name: '', price: '', stock: '1', category: form.category, brand: 'PC Star', short: '' })
    setToast(t('masterAdded'))
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
                      {money(p.price)} · {p.stock} · {t(`cat_${p.category}`) || p.category}
                    </div>
                  </div>
                  <button type="button" className="ghost tiny" onClick={() => doHide(p.id)}>
                    {t('masterHide')}
                  </button>
                </div>
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
                  <strong>
                    <span className={`av av-${c.avatar} accent-${c.accent}`}>{c.name?.slice(0, 2) || 'U'}</span> {c.name}
                  </strong>
                  <button type="button" className="remove" onClick={() => doDeleteCustomer(c.id)}>
                    {t('masterDelete')}
                  </button>
                </header>
                <p className="short">
                  {c.email || '—'} · {c.phone || '—'} · {c.provider}
                  {c.demo ? ' · demo' : ''}
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
