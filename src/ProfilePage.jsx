import { useState } from 'react'
import { ACCENTS, AVATARS, isDzPhone, phoneCarrier, updateUser } from './shopStore.js'
import { WILAYAS_NEAR } from './data.js'
import * as api from './api.js'

export default function ProfilePage({ t, user, users, onUsers, onUser, setToast, onBack, apiOnline, mode }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [avatar, setAvatar] = useState(user.avatar || 'chip')
  const [accent, setAccent] = useState(user.accent || 'green')
  const [wilaya, setWilaya] = useState(user.wilaya || 'Oran')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const carrier = phoneCarrier(phone)
  const carrierLabel =
    carrier === 'mobilis' ? t('carrierMobilis') : carrier === 'ooredoo' ? t('carrierOoredoo') : carrier === 'djezzy' ? t('carrierDjezzy') : null

  const links = user.links || {}

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
        const r = await api.updateMe({ name, phone, avatar, accent, wilaya })
        if (!r.ok) {
          setErr(t(r.data?.error === 'phone' ? 'phoneInvalid' : 'authErrorAuth'))
          return
        }
        onUser(r.data.user)
        setToast(t('profileSaved'))
        return
      }
      const res = updateUser(users, user.id, { name, phone, avatar, accent, wilaya })
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

  async function linkProvider(provider) {
    if (!apiOnline) {
      setToast(t('backendOffline'))
      return
    }
    const r = await api.startOAuth(provider, 'link')
    if (r.ok && r.data?.authorizeUrl) {
      window.location.href = r.data.authorizeUrl
    } else {
      setToast(t('authErrorAuth'))
    }
  }

  async function unlink(provider) {
    if (!apiOnline || mode !== 'api') {
      setToast(t('backendOffline'))
      return
    }
    const r = await api.unlinkOAuth(provider)
    if (r.ok) {
      onUser(r.data.user)
      setToast(t('profileSaved'))
    }
  }

  return (
    <main className="wrap page">
      <button className="back" type="button" onClick={onBack}>
        {t('backToShop')}
      </button>
      <div className="profile-card callbox">
        <div className="profile-head">
          <span className={`av large av-${avatar} accent-${accent}`}>{AVATARS.find((a) => a.id === avatar)?.mark || 'PS'}</span>
          <div>
            <h1>{t('profileTitle')}</h1>
            <p className="short">
              {t('profileRole')}: <strong>{user.role === 'master' ? t('roleMaster') : t('roleCustomer')}</strong>
              {user.email ? ` · ${user.email}` : ''}
            </p>
          </div>
        </div>

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

          <fieldset className="avatar-field">
            <legend>{t('profileAvatar')}</legend>
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <button key={a.id} type="button" className={`av-pick ${avatar === a.id ? 'on' : ''}`} onClick={() => setAvatar(a.id)} aria-label={a.label}>
                  <span className={`av av-${a.id}`}>{a.mark}</span>
                  <em>{a.label}</em>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="avatar-field">
            <legend>{t('profileAccent')}</legend>
            <div className="accent-grid">
              {ACCENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`accent-pick ${accent === c.id ? 'on' : ''}`}
                  style={{ '--swatch': c.hex }}
                  onClick={() => setAccent(c.id)}
                  aria-label={c.id}
                />
              ))}
            </div>
          </fieldset>

          <div className="oauth-link-box">
            <h3>{t('oauthNote')}</h3>
            <div className="oauth-link-row">
              <div className={`link-status ${links.google ? 'on' : ''}`}>
                <strong>Google</strong>
                <em>{links.google ? `${t('linked')}${links.googleEmail ? ` · ${links.googleEmail}` : ''}` : t('notLinked')}</em>
                {links.google ? (
                  <button type="button" className="ghost tiny" onClick={() => unlink('google')}>
                    {t('unlinkGoogle')}
                  </button>
                ) : (
                  <button type="button" className="oauth-btn google tiny" onClick={() => linkProvider('google')}>
                    {t('linkGoogle')}
                  </button>
                )}
              </div>
              <div className={`link-status ${links.meta ? 'on' : ''}`}>
                <strong>Meta</strong>
                <em>{links.meta ? `${t('linked')}${links.metaName ? ` · ${links.metaName}` : ''}` : t('notLinked')}</em>
                {links.meta ? (
                  <button type="button" className="ghost tiny" onClick={() => unlink('meta')}>
                    {t('unlinkMeta')}
                  </button>
                ) : (
                  <button type="button" className="oauth-btn meta tiny" onClick={() => linkProvider('meta')}>
                    {t('linkMeta')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {err && <p className="form-error">{err}</p>}
          <button className="add wide" type="submit" disabled={busy}>
            {t('profileSave')}
          </button>
        </form>
      </div>
    </main>
  )
}
