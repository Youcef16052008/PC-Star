import { useState } from 'react'
import {
  DEMO_CUSTOMERS,
  MASTER,
  isDzPhone,
  loginEmail,
  loginGoogle,
  normalizePhone,
  phoneCarrier,
  registerEmail,
  startSms,
  verifySms
} from './shopStore.js'
import * as api from './api.js'

const ERR = {
  email: 'authErrorEmail',
  password: 'authErrorPassword',
  exists: 'authErrorExists',
  auth: 'authErrorAuth',
  phone: 'authErrorPhone',
  code: 'authErrorCode'
}

export default function AuthPanel({
  t,
  users,
  onUsers,
  onSession,
  onClose,
  setToast,
  apiOnline,
  onApiUser
}) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [smsPhone, setSmsPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [pending, setPending] = useState(null)
  const [shownCode, setShownCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function fail(code) {
    setError(t(ERR[code] || code))
  }

  function succeedLocal(user, nextUsers, msgKey) {
    if (nextUsers) onUsers(nextUsers)
    onSession({ userId: user.id, mode: 'local' })
    setToast(t(msgKey))
    onClose?.()
  }

  function succeedApi(user, token, msgKey) {
    api.setToken(token)
    onApiUser?.(user, token)
    setToast(t(msgKey))
    onClose?.()
  }

  async function submitLogin(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (apiOnline) {
        const r = await api.login(email, password)
        if (r.ok && r.data?.user) {
          succeedApi(r.data.user, r.data.token, 'authOk')
          return
        }
      }
      const res = loginEmail(users, { email, password })
      if (!res.ok) return fail(res.error || 'auth')
      succeedLocal(res.user, null, 'authOk')
    } finally {
      setBusy(false)
    }
  }

  async function submitRegister(e) {
    e.preventDefault()
    if (phone && !isDzPhone(phone)) return fail('phone')
    setBusy(true)
    setError('')
    try {
      if (apiOnline) {
        const r = await api.register({ email, password, name, phone: phone || undefined })
        if (r.ok && r.data?.user) {
          succeedApi(r.data.user, r.data.token, 'authRegistered')
          return
        }
        if (r.data?.error) return fail(r.data.error)
      }
      const res = registerEmail(users, { email, password, name, phone: phone || undefined })
      if (!res.ok) return fail(res.error)
      succeedLocal(res.user, res.users, 'authRegistered')
    } finally {
      setBusy(false)
    }
  }

  function sendSms(e) {
    e.preventDefault()
    const res = startSms(users, { phone: smsPhone })
    if (!res.ok) return fail(res.error)
    setPending(res.pending)
    setShownCode(res.code)
    setError('')
    setToast(`${t('authCodeShown')} ${res.code}`)
  }

  function checkSms(e) {
    e.preventDefault()
    const res = verifySms(users, { phone: smsPhone, code: smsCode, pending })
    if (!res.ok) return fail(res.error)
    succeedLocal(res.user, res.users, 'authOk')
  }

  function doGoogleLocal() {
    const res = loginGoogle(users)
    succeedLocal(res.user, res.users, 'authOk')
  }

  async function doOAuth(provider) {
    setBusy(true)
    setError('')
    try {
      if (!apiOnline) {
        if (provider === 'google') doGoogleLocal()
        else setError(t('backendOffline'))
        return
      }
      const r = await api.startOAuth(provider, 'login')
      if (!r.ok || !r.data?.authorizeUrl) {
        setError(t('authErrorAuth'))
        return
      }
      window.location.href = r.data.authorizeUrl
    } finally {
      setBusy(false)
    }
  }

  function quickDemo(seed) {
    const res = loginEmail(users, { email: seed.email, password: seed.passwordPlain })
    if (res.ok) succeedLocal(res.user, null, 'authOk')
    else fail('auth')
  }

  function quickMaster() {
    const res = loginEmail(users, { email: MASTER.email, password: MASTER.password })
    if (!res.ok) return fail('auth')
    succeedLocal(res.user, null, 'authOk')
  }

  const carrier = phoneCarrier(smsPhone || phone)
  const carrierLabel =
    carrier === 'mobilis' ? t('carrierMobilis') : carrier === 'ooredoo' ? t('carrierOoredoo') : carrier === 'djezzy' ? t('carrierDjezzy') : null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-label={t('authTitle')} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t('authTitle')}</h2>
          <button type="button" className="ghost tiny" onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </header>
        <p className="short">{t('authDemoNote')}</p>
        <p className={`api-pill ${apiOnline ? 'on' : 'off'}`}>{apiOnline ? t('backendOnline') : t('backendOffline')}</p>

        <div className="auth-tabs">
          {['login', 'register', 'sms'].map((id) => (
            <button
              key={id}
              type="button"
              className={`chip ${tab === id ? 'on' : ''}`}
              onClick={() => {
                setTab(id)
                setError('')
              }}
            >
              {id === 'login' ? t('authLogin') : id === 'register' ? t('authRegister') : t('authSms')}
            </button>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        {tab === 'login' && (
          <form className="auth-form" onSubmit={submitLogin}>
            <label htmlFor="auth-email">{t('authEmail')}</label>
            <input id="auth-email" className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label htmlFor="auth-pass">{t('authPassword')}</label>
            <input id="auth-pass" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="add wide" type="submit" disabled={busy}>
              {t('authSubmitLogin')}
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form className="auth-form" onSubmit={submitRegister}>
            <label htmlFor="reg-name">{t('authName')}</label>
            <input id="reg-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="reg-email">{t('authEmail')}</label>
            <input id="reg-email" className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label htmlFor="reg-pass">{t('authPassword')}</label>
            <input id="reg-pass" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            <label htmlFor="reg-phone">{t('phone')}</label>
            <input id="reg-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05 / 06 / 07…" inputMode="tel" />
            <p className="short">
              {t('phoneHint')}
              {carrierLabel ? ` · ${carrierLabel}` : ''}
            </p>
            <button className="add wide" type="submit" disabled={busy}>
              {t('authSubmitRegister')}
            </button>
          </form>
        )}

        {tab === 'sms' && (
          <div className="auth-form">
            <form onSubmit={sendSms}>
              <label htmlFor="sms-phone">{t('phone')}</label>
              <input id="sms-phone" className="field" value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} placeholder="0669…" inputMode="tel" required />
              <p className="short">
                {t('phoneHint')}
                {carrierLabel ? ` · ${carrierLabel}` : ''}
              </p>
              <button className="add wide" type="submit">
                {t('authSendCode')}
              </button>
            </form>
            {pending && (
              <form onSubmit={checkSms}>
                <label htmlFor="sms-code">{t('authCode')}</label>
                <input id="sms-code" className="field" value={smsCode} onChange={(e) => setSmsCode(e.target.value)} inputMode="numeric" maxLength={6} required />
                {shownCode && (
                  <p className="demo-code">
                    {t('authCodeShown')} <strong>{shownCode}</strong>
                  </p>
                )}
                <button className="add wide" type="submit">
                  {t('authVerify')}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="oauth-row">
          <button type="button" className="oauth-btn google" disabled={busy} onClick={() => doOAuth('google')}>
            {t('loginWithGoogle')}
          </button>
          <button type="button" className="oauth-btn meta" disabled={busy} onClick={() => doOAuth('meta')}>
            {t('loginWithMeta')}
          </button>
        </div>

        <div className="demo-profiles">
          <h3>{t('masterDemoProfiles')}</h3>
          <button type="button" className="demo-chip master" onClick={quickMaster}>
            <span className="av av-star">PS</span>
            <span>
              <strong>{MASTER.name}</strong>
              <em>{MASTER.email}</em>
            </span>
          </button>
          {DEMO_CUSTOMERS.map((d) => (
            <button key={d.id} type="button" className={`demo-chip accent-${d.accent}`} onClick={() => quickDemo(d)}>
              <span className={`av av-${d.avatar}`}>{d.avatar.slice(0, 3).toUpperCase()}</span>
              <span>
                <strong>{d.name}</strong>
                <em>
                  {d.email} · {normalizePhone(d.phone)}
                </em>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
