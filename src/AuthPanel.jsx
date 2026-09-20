import { useEffect, useRef, useState } from 'react'
import { Modal } from 'bootstrap'
import { isDzPhone, loginEmail, registerEmail } from './shopStore.js'
import * as api from './api.js'

/**
 * Table des codes d'erreur serveur vers clés i18n. Exportée (LOT P3, B8) pour
 * que `src/p3ClientScreens.test.js` vérifie la complétude de la table au lieu
 * de la re-déclarer : B8 était précisément un TROU de cette table
 * (`demo_locked` absent, donc la clé brute à l'écran), et une copie dans le
 * test n'aurait rien vu.
 */
export const AUTH_ERRORS = {
  email: 'authErrorEmail',
  password: 'authErrorPassword',
  // LOT 1.9 : sans cette entrée, `fail(code)` affichait la clé brute
  // (« name_too_long ») — `t()` retombe sur la clé quand elle est inconnue.
  name_too_long: 'authErrorName',
  exists: 'authErrorExists',
  auth: 'authErrorAuth',
  phone: 'authErrorPhone',
  rate: 'authErrorRate',
  // LOT P3 (B8) : `POST /api/auth/login` répond `401 demo_locked` quand le
  // compte de démonstration existe mais n'a **aucun** mot de passe (aucun
  // `DEMO_PASSWORD` posé, `server/index.js:555`). Sans entrée ici, `fail(code)`
  // faisait `t('demo_locked')` : la CLÉ BRUTE à l'écran, en français comme en
  // anglais — exactement le défaut que le LOT 1.9 avait corrigé pour
  // `name_too_long`.
  demo_locked: 'authErrorDemoLocked'
}

/**
 * LOT P6 (S6) — `tabInitial` : le menu ouvre la porte du bon cote. « Se connecter »
 * et « Créer un compte » sont deux intentions differentes ; les confondre en un seul
 * bouton, c'est envoyer le nouveau client remplir un formulaire de connexion avant
 * de comprendre qu'il doit d'abord s'inscrire.
 *
 * @param {'login'|'register'} [props.tabInitial]
 */
export default function AuthPanel({ t, users, onUsers, onSession, onClose, setToast, apiOnline, onApiUser, tabInitial = 'login' }) {
  const [tab, setTab] = useState(tabInitial === 'register' ? 'register' : 'login')
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
    setError(t(AUTH_ERRORS[code] || code))
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

  async function startOAuth(provider) {
    setBusy(true)
    setError('')
    try {
      if (!apiOnline) {
        setError(t('backendOffline'))
        return
      }
      // P13 (S2) : returnUrl RELATIF. Le serveur refuse toute origine tierce ;
      // un chemin relatif garantit que le token ne quitte jamais l'origine du
      // navigateur (dev, preview proxifiée et Vercel : même origine).
      const r = await api.oauthStart(provider, { intent: 'login', returnUrl: '/' })
      if (!r.ok || !r.data?.authorizeUrl) {
        setError(t('authErrorAuth'))
        return
      }
      window.location.href = r.data.authorizeUrl
    } finally {
      setBusy(false)
    }
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
        // Le serveur a répondu (mauvais identifiants, rate limit…) : on ne
        // retombe PAS sur le store local — sinon un mdp refusé par l'API
        // pourrait passer s'il existe localement.
        if (!r.offline) return fail(r.data?.error || 'auth')
      }
      // Mode local, ou réseau mort → repli local.
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
        if (!r.offline) return fail(r.data?.error || 'auth')
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
      {/*
        * LOT P4 (V5) — la connexion prend toute la page. Une fenetre de 500 px
        * sur un telephone d'occasion (le parc du comptoir), c'est le clavier
        * numerique qui mangeait le formulaire : on se connectait a moitie, puis
        * on refermait pour relire ce qu'on avait tape. `modal-fullscreen` est la
        * classe de Bootstrap, pas une invention locale ; le corps reste dans une
        * colonne lisible (`.auth-sheet-body`) pour que le texte ne s'etale pas
        * sur 1 400 px sur l'ecran du comptoir.
        */}
      <div className="modal-dialog modal-dialog-centered modal-fullscreen">
        <div className="modal-content border-0 shadow">
          <div className="modal-header">
            <h2 className="modal-title h5 mb-0" id="authModalLabel">
              {t('authTitle')}
            </h2>
            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label={t('close')} />
          </div>
          <div className="modal-body">
            <div className="auth-sheet-body">
            <p className="small text-secondary">{t('authSimpleNote')}</p>
            <span className={`badge mb-3 ${apiOnline ? 'text-bg-success' : 'text-bg-secondary'}`}>
              {apiOnline ? t('backendOnline') : t('backendOffline')}
            </span>

            {/* LOT 1.3 — le mode local ASSUMÉ comme mode démonstration.
                `hashPass` de `src/shopStore.js` est un FNV-1a 32 bits : il
                n'est pas réparable côté navigateur (pas de scrypt/bcrypt dans
                le web sans API asynchrone lourde, et surtout AUCUN secret ne
                doit vivre dans le bundle). Le rapport était exact : la seule
                réponse honnête est de (a) ne stocker là aucun compte sensible
                et (b) LE DIRE. Un badge « Mode local (sans serveur) » ne le
                disait pas — un visiteur pouvait y créer un compte avec son vrai
                mot de passe et croire qu'il était protégé. */}
            {!apiOnline && (
              <div className="alert alert-warning py-2 small" role="alert">
                <strong className="d-block mb-1">{t('demoModeTitle')}</strong>
                {t('demoModeNote')}
              </div>
            )}

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

            {apiOnline && (
              <div className="d-grid gap-2 mb-3">
                <button type="button" className="btn btn-outline-dark" disabled={busy} onClick={() => startOAuth('google')}>
                  {t('loginWithGoogle')}
                </button>
                <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => startOAuth('meta')}>
                  {t('loginWithMeta')}
                </button>
                <div className="form-text">{t('oauthNote')}</div>
              </div>
            )}

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
    </div>
  )
}
