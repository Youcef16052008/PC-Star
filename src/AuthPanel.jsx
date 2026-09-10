import { useState } from 'react'
import { isDzPhone, loginEmail, registerEmail } from './shopStore.js'
import * as api from './api.js'

const ERR = {
  email: 'authErrorEmail',
  password: 'authErrorPassword',
  exists: 'authErrorExists',
  auth: 'authErrorAuth',
  phone: 'authErrorPhone'
}

export default function AuthPanel({ t, users, onUsers, onSession, onClose, setToast, apiOnline, onApiUser }) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-label={t('authTitle')} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t('authTitle')}</h2>
          <button type="button" className="ghost tiny" onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </header>
        <p className="short">{t('authSimpleNote')}</p>
        <p className={`api-pill ${apiOnline ? 'on' : 'off'}`}>{apiOnline ? t('backendOnline') : t('backendOffline')}</p>

        <div className="auth-tabs">
          <button type="button" className={`chip ${tab === 'login' ? 'on' : ''}`} onClick={() => { setTab('login'); setError('') }}>
            {t('authLogin')}
          </button>
          <button type="button" className={`chip ${tab === 'register' ? 'on' : ''}`} onClick={() => { setTab('register'); setError('') }}>
            {t('authRegister')}
          </button>
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
            <p className="short">{t('phoneHint')}</p>
            <button className="add wide" type="submit" disabled={busy}>
              {t('authSubmitRegister')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
