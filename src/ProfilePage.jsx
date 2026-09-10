import { useState } from 'react'
import { isDzPhone, phoneCarrier, updateUser } from './shopStore.js'
import { WILAYAS_NEAR } from './data.js'
import * as api from './api.js'

export default function ProfilePage({ t, user, users, onUsers, onUser, setToast, onBack, apiOnline, mode }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [wilaya, setWilaya] = useState(user.wilaya || 'Oran')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const carrier = phoneCarrier(phone)
  const carrierLabel =
    carrier === 'mobilis' ? t('carrierMobilis') : carrier === 'ooredoo' ? t('carrierOoredoo') : carrier === 'djezzy' ? t('carrierDjezzy') : null

  async function save(e) {
    e.preventDefault()
    if (phone && !isDzPhone(phone)) {
      setErr(t('phoneInvalid'))
      return
    }
    setBusy(true)
    setErr('')
    try {
      if (apiOnline && mode === 'api') {
        const r = await api.updateMe({ name, phone, wilaya })
        if (!r.ok) {
          setErr(t(r.data?.error === 'phone' ? 'phoneInvalid' : 'authErrorAuth'))
          return
        }
        onUser(r.data.user)
        setToast(t('profileSaved'))
        return
      }
      const res = updateUser(users, user.id, { name, phone, wilaya })
      if (!res.ok) {
        setErr(t('authErrorAuth'))
        return
      }
      onUsers(res.users)
      onUser(res.user)
      setToast(t('profileSaved'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('backToShop')}
      </button>
      <div className="row justify-content-center">
        <div className="col-md-7 col-lg-5">
          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <h1 className="h4 mb-2">{t('profileTitle')}</h1>
              <p className="text-secondary small mb-4">
                {t('profileRole')}: <strong>{user.role === 'master' ? t('roleMaster') : t('roleCustomer')}</strong>
                {user.email ? ` · ${user.email}` : ''}
              </p>

              <form onSubmit={save}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="pf-name">
                    {t('authName')}
                  </label>
                  <input id="pf-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>

                <div className="mb-3">
                  <label className="form-label" htmlFor="pf-phone">
                    {t('phone')}
                  </label>
                  <input id="pf-phone" className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="05 / 06 / 07…" />
                  <div className="form-text">
                    {t('carrierNote')}
                    {carrierLabel ? ` · ${carrierLabel}` : ''}
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label" htmlFor="pf-wilaya">
                    {t('wilaya')}
                  </label>
                  <select id="pf-wilaya" className="form-select" value={wilaya} onChange={(e) => setWilaya(e.target.value)}>
                    {WILAYAS_NEAR.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>

                {err && <div className="alert alert-danger py-2">{err}</div>}
                <button className="btn btn-success w-100" type="submit" disabled={busy}>
                  {t('profileSave')}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
