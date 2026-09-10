import { useState } from 'react'
import { ACCENTS, AVATARS, isDzPhone, phoneCarrier, updateUser } from './shopStore.js'

export default function ProfilePage({ t, user, users, onUsers, onUser, setToast, onBack }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [avatar, setAvatar] = useState(user.avatar || 'chip')
  const [accent, setAccent] = useState(user.accent || 'green')
  const [err, setErr] = useState('')

  const carrier = phoneCarrier(phone)
  const carrierLabel =
    carrier === 'mobilis' ? t('carrierMobilis') : carrier === 'ooredoo' ? t('carrierOoredoo') : carrier === 'djezzy' ? t('carrierDjezzy') : null

  function save(e) {
    e.preventDefault()
    if (phone && !isDzPhone(phone)) {
      setErr(t('phoneInvalid'))
      return
    }
    const res = updateUser(users, user.id, { name, phone, avatar, accent })
    if (!res.ok) {
      setErr(t('authErrorAuth'))
      return
    }
    onUsers(res.users)
    onUser(res.user)
    setErr('')
    setToast(t('profileSaved'))
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
            {t('phoneHint')}
            {carrierLabel ? ` · ${carrierLabel}` : ''}
          </p>

          <fieldset className="avatar-field">
            <legend>{t('profileAvatar')}</legend>
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`av-pick ${avatar === a.id ? 'on' : ''}`}
                  onClick={() => setAvatar(a.id)}
                  aria-label={a.label}
                >
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

          {err && <p className="form-error">{err}</p>}
          <button className="add wide" type="submit">
            {t('profileSave')}
          </button>
        </form>
      </div>
    </main>
  )
}
