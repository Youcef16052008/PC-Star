import { useEffect, useState } from 'react'
import { isDzPhone, phoneCarrier, updateUser } from './shopStore.js'
import { WILAYAS_NEAR } from './data.js'
import * as api from './api.js'

// P11 : « Mes commandes » est sorti du profil — les commandes vivent dans la
// page unique « Commandes » (bouton du menu, src/OrdersPage.jsx).
export default function ProfilePage({ t, user, users, onUsers, onUser, setToast, onBack, apiOnline, mode }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [wilaya, setWilaya] = useState(user.wilaya || 'Oran')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')

  const carrier = phoneCarrier(phone)
  const carrierLabel =
    carrier === 'mobilis' ? t('carrierMobilis') : carrier === 'ooredoo' ? t('carrierOoredoo') : carrier === 'djezzy' ? t('carrierDjezzy') : null

  // P5 (B15) : resynchronise le formulaire quand on passe à un autre compte.
  useEffect(() => {
    setName(user.name || '')
    setPhone(user.phone || '')
    setWilaya(user.wilaya || 'Oran')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

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

  async function savePassword(e) {
    e.preventDefault()
    if (pw.length < 6) {
      setErr(t('authErrorPassword'))
      return
    }
    if (pw !== pw2) {
      setErr(t('passwordMismatch'))
      return
    }
    setBusy(true)
    setErr('')
    try {
      if (apiOnline && mode === 'api') {
        const r = await api.changePassword(pw)
        if (!r.ok) {
          setErr(t('authErrorPassword'))
          return
        }
        setPw('')
        setPw2('')
        setToast(t('passwordChanged'))
        return
      }
      setErr(t('backendOffline'))
    } finally {
      setBusy(false)
    }
  }

  async function link(provider) {
    const r = await api.oauthStart(provider, { intent: 'link', returnUrl: window.location.origin + '/' })
    if (r.ok && r.data?.authorizeUrl) window.location.href = r.data.authorizeUrl
  }

  async function unlink(provider) {
    const r = await api.oauthUnlink(provider)
    if (r.ok && r.data?.user) {
      onUser(r.data.user)
      setToast(t('profileSaved'))
    }
  }

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('backToShop')}
      </button>
      <div className="row g-4 justify-content-center">
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

          {apiOnline && mode === 'api' && (
            <div className="card shadow-sm border-0 mt-3">
              <div className="card-body p-4">
                <h2 className="h6">{t('passwordChange')}</h2>
                <form onSubmit={savePassword} className="row g-2">
                  <div className="col-12">
                    <input className="form-control" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('authPassword')} minLength={6} />
                  </div>
                  <div className="col-12">
                    <input className="form-control" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t('passwordConfirm')} minLength={6} />
                  </div>
                  <div className="col-12">
                    <button className="btn btn-outline-success w-100" type="submit" disabled={busy}>
                      {t('passwordChange')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {apiOnline && mode === 'api' && (
            <div className="card shadow-sm border-0 mt-3">
              <div className="card-body p-4">
                <h2 className="h6 mb-3">{t('linkedAccounts')}</h2>
                <div className="d-flex flex-wrap gap-2">
                  <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => (user.links?.google ? unlink('google') : link('google'))}>
                    {user.links?.google ? t('unlinkGoogle') : t('linkGoogle')}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => (user.links?.meta ? unlink('meta') : link('meta'))}>
                    {user.links?.meta ? t('unlinkMeta') : t('linkMeta')}
                  </button>
                </div>
                <p className="small text-secondary mt-2 mb-0">{t('oauthNote')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
