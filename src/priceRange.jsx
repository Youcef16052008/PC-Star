/**
 * LOT P25 (S6) — un seul bloc de prix, deux surfaces.
 *
 * L'aside du bureau et le tiroir mobile portaient DEUX contrôles de prix qui ne
 * se ressemblaient pas : six cases à cocher d'un côté, un `<select>` de six
 * tranches de l'autre. Deux formes pour une même règle, c'est deux occasions de
 * désaccord — et aucune des deux n'acceptait un prix tapé.
 *
 * Le bloc ci-dessous est donc le seul endroit où le prix se saisit : les deux
 * surfaces le rendent avec un `idPrefix` différent (deux `<label for>` ne peuvent
 * pas viser le même champ), et les règles de bornage viennent de
 * `src/priceRange.js` — pas du JSX.
 */
import { money } from './data'
import { currencyFor } from './format.js'
import { PRIX_MAX, PRIX_MIN, bornesPrix, texteBorne, textePrix } from './priceRange.js'

/**
 * @param {object} props
 * @param {(clé: string, var?: object) => string} props.t le traducteur de l'écran
 * @param {string} props.lang la langue en cours (`money` localise les bornes)
 * @param {string} props.min le texte du champ « minimum » (`''` = pas de borne)
 * @param {string} props.max le texte du champ « maximum »
 * @param {(valeur: string) => void} props.onMin
 * @param {(valeur: string) => void} props.onMax
 * @param {string} props.idPrefix préfixe des `id`/`for` (deux blocs = deux préfixes)
 */
export function PriceRange({ t, lang, min, max, onMin, onMax, idPrefix = 'prix' }) {
  const bornes = bornesPrix(min, max)
  const fenetreId = `${idPrefix}-fenetre`

  const champ = (cle, libelle, valeur, onChange) => {
    const id = `${idPrefix}-${cle}`
    return (
      <div className="col">
        <label className="form-label small mb-1" htmlFor={id}>
          {libelle}
        </label>
        <div className="input-group input-group-sm">
          <input
            id={id}
            className="form-control"
            // `type="text"` + `inputMode` : le clavier numérique s'ouvre sur un
            // téléphone, et les flèches d'un `type="number"` (qui acceptent « e »
            // et « - » dans la plupart des navigateurs) ne viennent pas proposer des
            // valeurs impossibles à un filtre borné.
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={valeur}
            onChange={(e) => onChange(textePrix(e.target.value))}
            onBlur={() => onChange(texteBorne(valeur))}
            aria-describedby={fenetreId}
            aria-invalid={bornes.inverse || undefined}
          />
          <span className="input-group-text">{currencyFor(lang)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="price-range">
      <div className="row g-2">
        {champ('min', t('priceMin'), min, onMin)}
        {champ('max', t('priceMax'), max, onMax)}
      </div>
      {/* La fenêtre autorisée est écrite là où on lit les champs : le client qui
          regarde « 100 … 10 000 000 » ne se demande pas pourquoi son « 50 » est
          devenu « 100 » à la sortie du champ. */}
      <p className="small text-secondary mb-0 mt-1" id={fenetreId}>
        {t('priceWindow', { min: money(PRIX_MIN, lang), max: money(PRIX_MAX, lang) })}
      </p>
      {bornes.inverse && (
        <p className="small text-danger mb-0 mt-1" role="alert">
          {t('priceInverted')}
        </p>
      )}
    </div>
  )
}
