import { STORE } from './data.js'

export default function LegalPage({ t, kind, onBack }) {
  const title =
    kind === 'warranty' ? t('legalWarrantyTitle') : kind === 'privacy' ? t('legalPrivacyTitle') : t('legalTermsTitle')

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <button className="btn btn-outline-secondary btn-sm mb-3" type="button" onClick={onBack}>
        ← {t('backToShop')}
      </button>
      <article className="card shadow-sm border-0">
        <div className="card-body p-4 p-md-5">
          <h1 className="h3 mb-3">{title}</h1>
          {kind === 'warranty' && (
            <>
              <p>{t('legalWarrantyP1')}</p>
              <ul>
                <li>{t('legalWarrantyL1')}</li>
                <li>{t('legalWarrantyL2')}</li>
                <li>{t('legalWarrantyL3')}</li>
              </ul>
              <p className="text-secondary small mb-0">{t('storeWarranty')}</p>
            </>
          )}
          {kind === 'privacy' && (
            <>
              <p>{t('legalPrivacyP1')}</p>
              <ul>
                <li>{t('legalPrivacyL1')}</li>
                <li>{t('legalPrivacyL2')}</li>
                <li>{t('legalPrivacyL3')}</li>
              </ul>
              <p className="text-secondary small">{t('legalPrivacyP2')}</p>
            </>
          )}
          {kind === 'terms' && (
            <>
              <p>{t('legalTermsP1')}</p>
              <ul>
                <li>{t('legalTermsL1')}</li>
                <li>{t('legalTermsL2')}</li>
                <li>{t('legalTermsL3')}</li>
              </ul>
              <p className="mb-1">
                <strong>{STORE.name}</strong> — {STORE.address}
              </p>
              <p className="text-secondary small mb-0">
                {STORE.email} · {STORE.phone}
              </p>
            </>
          )}
        </div>
      </article>
    </main>
  )
}
