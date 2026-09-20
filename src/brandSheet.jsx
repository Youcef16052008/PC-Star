/**
 * LOT P6 (S3) — la feuille des marques, un seul exemplaire.
 *
 * Mesuré sur la page rendue : la feuille de la vitrine portait un champ « Chercher
 * une marque » (`brandSearchPh`) et posait ses boutons dans `.filter-sheet-grid`
 * (44 px de cible tactile, la règle de `src/index.css`) ; celle de la page Recherche
 * alignait **quatre-vingt-quatre boutons** en `.d-flex flex-wrap`, sans champ. Le
 * mur de pastilles que le client a signalé revivait donc à un clic de là — et sur un
 * téléphone d'occasion, faire défiler quatre-vingt-quatre noms pour trouver « WD »
 * n'est pas un filtre.
 *
 * Deux listes d'une même règle, ça a déjà tué le filtre « usage » (P17) : une face
 * branchée, l'autre non, et rien qui rougit. Le composant est donc unique, et les
 * deux écrans ne fournissent que leurs décisions (ce qui est actif, ce qu'on choisit).
 */
import { useMemo, useState } from 'react'

/**
 * @param {object} props
 * @param {(clé: string, var?: object) => string} props.t le traducteur de l'écran
 * @param {string[]} props.marques la liste déjà réduite au rayon / à la catégorie choisie
 * @param {(marque: string) => boolean} props.estActive une marque est-elle retenue
 * @param {(marque: string) => void} props.onChoisir le clic sur une marque
 * @param {() => void} props.onTout le clic sur « Tout »
 * @param {boolean} props.montreTout « Tout » ne se propose que s'il y a de quoi choisir
 */
export function BrandSheet({ t, marques, estActive, onChoisir, onTout, montreTout = true }) {
  // La recherche est l'état de la FEUILLE, pas de l'écran : elle ne filtre rien du
  // tout, elle ne fait que raccourcir la liste des noms à cliquer. La garder ici,
  // c'est deux écrans qui n'ont plus à penser à la réinitialiser.
  const [recherche, setRecherche] = useState('')
  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return q ? (marques || []).filter((b) => String(b).toLowerCase().includes(q)) : (marques || [])
  }, [marques, recherche])
  const aucune = !(marques || []).length
  return (
    <>
      <input
        className="form-control form-control-sm mb-2"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder={t('brandSearchPh')}
        aria-label={t('brandSearchPh')}
      />
      <div className="filter-sheet-grid">
        {montreTout && !aucune && (
          <button
            type="button"
            className={`btn btn-sm ${marques.filter((b) => estActive(b)).length ? 'btn-outline-secondary' : 'btn-success'}`}
            onClick={onTout}
          >
            {t('cat_all')}
          </button>
        )}
        {filtrees.map((b) => (
          <button
            key={b}
            type="button"
            className={`btn btn-sm ${estActive(b) ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={() => onChoisir(b)}
          >
            {b}
          </button>
        ))}
      </div>
      {filtrees.length === 0 && <p className="small text-secondary mb-0">{t('noBrands')}</p>}
    </>
  )
}
