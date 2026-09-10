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
    <main className="wrap page">
      <button className="back" type="button" onClick={onBack}>
        {t('backToShop')}
      </button>
      <div className="profile-card callbox">
        <h1>{t('profileTitle')}</h1>
        <p className="short">
          {t('profileRole')}: <strong>{user.role === 'master' ? t('roleMaster') : t('roleCustomer')}</strong>
          {user.email ? ` · ${user.email}` : ''}
        </p>

        <form onSubmit={save} className="auth-form">
          <label htmlFor="pf-name">{t('authName')}</label>
          <input id="pf-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />

          <label htmlFor="pf-phone">{t('phone')}</label>
          <input id="pf-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="05 / 06 / 07…" />
          <p className="short">
            {t('carrierNote')}
            {carrierLabel ? ` · ${carrierLabel}` : ''}
          </p>

          <label htmlFor="pf-wilaya">{t('wilaya')}</label>
          <select id="pf-wilaya" className="field" value={wilaya} onChange={(e) => setWilaya(e.target.value)}>
            {WILAYAS_NEAR.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>

          {err && <p className="form-error">{err}</p>}
          <button className="add wide" type="submit" disabled={busy}>
            {t('profileSave')}
          </button>
        </form>
      </div>
    </main>
  )
}
