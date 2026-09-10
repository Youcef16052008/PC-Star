import { useEffect, useRef, useState } from 'react'
import { Modal } from 'bootstrap'
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
  const modalElRef = useRef(null)
  const modalRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const el = modalElRef.current
    if (!el) return undefined
    const m = Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true })
    modalRef.current = m
    const onHidden = () => onCloseRef.current?.()
    el.addEventListener('hidden.bs.modal', onHidden)
    m.show()
    return () => {
      el.removeEventListener('hidden.bs.modal', onHidden)
      try {
        m.dispose()
      } catch {
        /* already disposed */
      }
      modalRef.current = null
      // Bootstrap may leave a leftover backdrop if React unmounts mid-animation
      document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove())
      document.body.classList.remove('modal-open')
      document.body.style.removeProperty('overflow')
      document.body.style.removeProperty('padding-right')
    }
  }, [])

  function fail(code) {
    setError(t(ERR[code] || code))
  }

  function succeedLocal(user, nextUsers, msgKey) {
    if (nextUsers) onUsers(nextUsers)
    onSession({ userId: user.id, mode: 'local' })
    setToast(t(msgKey))
    modalRef.current?.hide()
  }

  function succeedApi(user, token, msgKey) {
    api.setToken(token)
    onApiUser?.(user, token)
    setToast(t(msgKey))
    modalRef.current?.hide()
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
    <div className="modal fade" ref={modalElRef} tabIndex={-1} aria-labelledby="authModalLabel" aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content border-0 shadow">
          <div className="modal-header">
            <h2 className="modal-title h5 mb-0" id="authModalLabel">
              {t('authTitle')}
            </h2>
            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label={t('close')} />
          </div>
          <div className="modal-body">
            <p className="small text-secondary">{t('authSimpleNote')}</p>
            <span className={`badge mb-3 ${apiOnline ? 'text-bg-success' : 'text-bg-secondary'}`}>
              {apiOnline ? t('backendOnline') : t('backendOffline')}
            </span>

            <ul className="nav nav-pills mb-3 gap-2">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${tab === 'login' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('login')
                    setError('')
                  }}
                >
                  {t('authLogin')}
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${tab === 'register' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('register')
                    setError('')
                  }}
                >
                  {t('authRegister')}
                </button>
              </li>
            </ul>

            {error && <div className="alert alert-danger py-2">{error}</div>}

            {tab === 'login' && (
              <form onSubmit={submitLogin}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="auth-email">
                    {t('authEmail')}
                  </label>
                  <input
                    id="auth-email"
                    className="form-control"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="auth-pass">
                    {t('authPassword')}
                  </label>
                  <input
                    id="auth-pass"
                    className="form-control"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button className="btn btn-success w-100" type="submit" disabled={busy}>
                  {t('authSubmitLogin')}
                </button>
              </form>
            )}

            {tab === 'register' && (
              <form onSubmit={submitRegister}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="reg-name">
                    {t('authName')}
                  </label>
                  <input id="reg-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="reg-email">
                    {t('authEmail')}
                  </label>
                  <input
                    id="reg-email"
                    className="form-control"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="reg-pass">
                    {t('authPassword')}
                  </label>
                  <input
                    id="reg-pass"
                    className="form-control"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="reg-phone">
                    {t('phone')}
                  </label>
                  <input
                    id="reg-phone"
                    className="form-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="05 / 06 / 07…"
                    inputMode="tel"
                  />
                  <div className="form-text">{t('phoneHint')}</div>
                </div>
                <button className="btn btn-success w-100" type="submit" disabled={busy}>
                  {t('authSubmitRegister')}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
