/**
 * LOT P6 (S3) — les commandes de pagination, un seul exemplaire.
 *
 * La vitrine et la page Recherche dressaient chacune son `<nav className="pager">`
 * à la main : même markup recopié deux fois, donc un jour un seul des deux a le
 * `aria-current`, un seul a ses boutons désactivés aux bords. Pire, le nombre de
 * boutons suivait le nombre de pages — vingt-huit boutons pour trois cent une
 * fiches : le mur de pastilles que le client a signalé n'était pas réparé, il était
 * numéroté.
 *
 * Les deux écrans rendent maintenant `<Pager>`, et la fenêtre de numéros vient de
 * `fenetrePages` (`src/pager.js`). La taille de page se choisit (`<ChoixTaille>`)
 * dans la même règle pour les deux : 12 par défaut, 24, 48 — et une valeur qui
 * n'est pas dedans retombe sur le défaut, y compris venue d'une URL.
 */
import { POINT_DE_SUSPENSION, TAILLES, fenetrePages, pageCourante, tailleSure } from './pager.js'

/**
 * Le pager : précédent / numéros fenêtrés / suivant.
 * Une seule page ne se affiche pas — un pager à un bouton est un bouton de trop.
 */
export function Pager({ t, page, pages, onPage }) {
  if (pages <= 1) return null
  const courant = pageCourante(page, pages)
  const numeros = fenetrePages(courant, pages)
  return (
    <nav className="pager d-flex flex-wrap gap-1 align-items-center mt-4" aria-label={t('pagerLabel')}>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => onPage(courant - 1)}
        disabled={courant <= 1}
      >
        ‹ {t('prevPage')}
      </button>
      {numeros.map((n, i) => (n === POINT_DE_SUSPENSION
        // Le trou n'est pas un bouton : un « … » cliquable promet une page qui
        // n'existe pas. Il est marqué `aria-hidden` — un lecteur d'ecran n'a rien
        // a dire entre « 1 » et « 4 ».
        ? <span key={`trou-${i}`} className="pager-trou" aria-hidden="true">{POINT_DE_SUSPENSION}</span>
        : (
          <button
            key={n}
            type="button"
            className={`btn btn-sm ${n === courant ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={() => onPage(n)}
            aria-current={n === courant ? 'page' : undefined}
          >
            {n}
          </button>
        )))}
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => onPage(courant + 1)}
        disabled={courant >= pages}
      >
        {t('nextPage')} ›
      </button>
    </nav>
  )
}

/**
 * Le choix du nombre de fiches par page. Un `<select>`, pas une saisie libre : les
 * seules valeurs qui existent sont celles de `TAILLES`, et `tailleSure` est la
 * derniere ligne droite entre le monde et la tranche.
 */
export function ChoixTaille({ t, taille, onTaille }) {
  return (
    <label className="pager-taille d-flex align-items-center gap-2">
      <span className="small text-secondary">{t('pageSize')}</span>
      {/* Le select est nomme par le texte du label, pas par un `aria-label` : les
          deux a la fois, un lecteur d'ecran le lit deux fois. */}
      <select
        className="form-select form-select-sm w-auto"
        value={String(tailleSure(taille))}
        onChange={(e) => onTaille(Number(e.target.value))}
      >
        {TAILLES.map((n) => (
          <option key={n} value={String(n)}>{n}</option>
        ))}
      </select>
    </label>
  )
}
