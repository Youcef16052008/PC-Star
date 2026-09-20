import { useEffect, useMemo, useState } from 'react'
// LOT P4 (V4) : `PRODUCT_USES`/`usesOf` ne sortent plus de cette page — le
// filtre « usage » a été retiré sur demande du client (le rayon se choisit dans
// le catalogue, un usage ne filtre rien que le rayon ne filtre déjà).
import { PRICE_PRESETS, PRODUCT_CONDITIONS, SOCKETS, STORE, conditionOf, money, starText } from './data'
import { loadSavedSearches, saveSavedSearches } from './shopStore.js'
import { stockLabel } from './stockLabel.js'
// LOT P6 (S2) : memes pages que la vitrine, meme regle — voir `src/pager.js`.
// LOT P6 (S3) : le client choisit sa taille de page, et le pager comme la feuille
// des marques sont des composants PARTAGES — un exemplaire pour les deux ecrans,
// plus de markup recopie qui diverge au premier correctif.
import { PAGE_TAILLE, pageCourante, pagesPour, tailleSure, tranche } from './pager.js'
import { ChoixTaille, Pager } from './pagerControls.jsx'
import { BrandSheet } from './brandSheet.jsx'
import { useFeuilleFiltre } from './filterSheet.js'
import { filtresRetires, noteRetrait } from './filterDrop.js'
import PartThumb from './PartThumb.jsx'
import { discountPercent, hasSale } from './productMeta.js'

// LOT 6.1 (Q1) : `stockLabel` vient de `src/stockLabel.js` — une seule définition,
// une seule famille de classes (la classe Bootstrap complète, rien à traduire).

const EMPTY = {
  q: '',
  // La recherche ouvre désormais le catalogue entier : aucun rayon (imprimante,
  // occasion, laptop…) n'est caché par le choix CPU historique.
  line: 'all',
  brands: [],
  socket: 'all',
  condition: 'all',
  price: 'any',
  sort: 'featured'
}

const PRICE_KEYS = {
  any: 'price_any',
  u15: 'price_u15',
  '15-30': 'price_15_30',
  '30-50': 'price_30_50',
  '50-100': 'price_50_100',
  '100+': 'price_100p'
}

export default function SearchPage({ t, products, lines, panels, lang, liveStock, onAdd, onOpen }) {
  const [filters, setFilters] = useState(EMPTY)
  const [view, setView] = useState('grid')
  // P10 (P7-14) : recherches sauvées PERSISTÉES (avant : perdues au rechargement)
  const [saved, setSaved] = useState(() => loadSavedSearches())
  const [saveNote, setSaveNote] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  // LOT P6 (S1) — les deux filtres que le client a demandes (marques, catalogue)
  // sont des BOUTONS qui ouvrent leur feuille, au lieu d'un mur de panneaux
  // toujours deploye. `sheet` porte la feuille ouverte ; `groupeOuvert` porte le
  // groupe de rayons deploye dans la feuille « catalogue » (par defaut : celui de
  // la ligne courante, donc les panneaux CPU/GPU n'apparaissent que pour les
  // pieces PC — et a un clic).
  const [sheet, setSheet] = useState(null)
  const [groupeOuvert, setGroupeOuvert] = useState(null)
  // LOT P6 (S2) : la page courante des resultats. La liste est bornee a la lecture
  // (`pageCourante`), donc un filtre qui la reduit pendant qu'on est page 4 ramene
  // page 1 tout seul — mais l'etat se reinitialise quand meme au changement de
  // filtre, pour que le « Suivant » d'apres reparte du haut de la nouvelle liste.
  const [page, setPage] = useState(1)
  // LOT P6 (S3) : douze, vingt-quatre ou quarante-huit fiches par page. Les valeurs
  // possibles et le bornage vivent dans `src/pager.js` — le select ne propose que ce
  // qui existe, et tout le reste (URL bidouillée, onglet restauré) retombe sur douze.
  const [taille, setTaille] = useState(PAGE_TAILLE)
  // LOT P6 (S4) : la mention du filtre retire (une marque qui ne vend rien dans le
  // rayon choisi). Elle vit ici, pas dans une alerte globale : elle regarde CE filtre.
  const [dropNote, setDropNote] = useState('')

  const allLines = lines || []
  const allPanels = panels || []

  // LOT 6.7 (Q7) : la persistance suit l'état au lieu d'être appelée à la main
  // dans le handler — un double-clic écrit donc les DEUX recherches.
  // P15 (#5) : `undefined` en 1ᵉʳ argument (un `null` explicite écrasait le
  // stockage par défaut → la recherche n'était JAMAIS retrouvée au rechargement).
  useEffect(() => {
    saveSavedSearches(undefined, saved)
  }, [saved])

  const labelDeLigne = (id) => {
    const l = allLines.find((x) => x.id === id)
    if (!l || id === EMPTY.line) return t('line_all')
    return t(`line_${l.id}`) !== `line_${l.id}` ? t(`line_${l.id}`) : l.label
  }

  function set(key, value) {
    // LOT P6 (S4) : changer de rayon peut rendre une marque retenue incapable de
    // filtrer quoi que ce soit. On la retire — mais on le DIT : un etat qui change
    // sous les yeux du client sans un mot est un defaut poli, pas une faveur.
    // (La vitrine, elle, gardait la marque et affichait zero fiche : deux ecrans,
    // deux regles pour le meme geste — c'est `src/filterDrop.js` qui tranche.)
    if (key === 'line') {
      const nouvelle = allLines.find((l) => l.id === value)
      const { gardees, retirees } = filtresRetires(filters.brands, (marque) =>
        (products || []).some((p) => nouvelle?.match?.(p) && p.brand === marque))
      setFilters((f) => ({ ...f, line: value, brands: gardees }))
      setDropNote(noteRetrait(t, retirees, labelDeLigne(value)))
      return
    }
    setDropNote('')
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function toggleBrand(brand) {
    setFilters((f) => ({
      ...f,
      brands: f.brands.includes(brand) ? f.brands.filter((b) => b !== brand) : [...f.brands, brand]
    }))
  }

  const line = allLines.find((l) => l.id === filters.line) || allLines[0]
  const lineBrands = useMemo(() => {
    if (!line) return []
    return [...new Set((products || []).filter(line.match).map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
  }, [line, products])
  const preset = PRICE_PRESETS.find((p) => p.id === filters.price) || PRICE_PRESETS[0]
  const showSocket = line && (line.id === 'cpu' || line.id === 'motherboard' || line.id === 'cooler')
  const lineLabel = line ? (t(`line_${line.id}`) !== `line_${line.id}` ? t(`line_${line.id}`) : line.label) : ''
  const conditionLabel = (id) => {
    if (id === 'all') return t('conditionAny')
    const key = PRODUCT_CONDITIONS.find((condition) => condition.id === id)?.labelKey
    return key ? t(key) : id
  }
  const results = useMemo(() => {
    if (!line) return []
    const q = filters.q.trim().toLowerCase()
    let list = (products || []).filter((p) => {
      if (!line.match(p)) return false
      if (filters.brands.length && !filters.brands.includes(p.brand)) return false
      if (filters.condition !== 'all' && conditionOf(p) !== filters.condition) return false
      if (showSocket && filters.socket !== 'all') {
        const sock = p.compat && p.compat.socket
        const ok = Array.isArray(sock) ? sock.includes(filters.socket) : sock === filters.socket
        if (!ok) return false
      }
      if (p.price < preset.min || p.price > preset.max) return false
      if (q) {
        // Les champs enrichis par le maître font partie de l'index : un mot-clé,
        // une référence fabricant ou une caractéristique doit réellement aider
        // le client à retrouver la bonne fiche.
        const details = Array.isArray(p.details) ? p.details.map((d) => `${d?.label || ''} ${d?.value || ''}`).join(' ') : ''
        const hay = `${p.name} ${p.sku} ${p.short} ${p.brand} ${p.model || ''} ${p.barcode || ''} ${p.description || ''} ${p.conditionNote || ''} ${(p.tags || []).join(' ')} ${details}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    if (filters.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
    if (filters.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
    if (filters.sort === 'stock') list = [...list].sort((a, b) => liveStock(b) - liveStock(a))
    if (filters.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (filters.sort === 'rating') list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    return list
  }, [filters, liveStock, preset, line, showSocket, products])

  const pas = tailleSure(taille)
  const pages = pagesPour(results.length, pas)
  const pageSure = pageCourante(page, pages)
  const vus = tranche(results, pageSure, pas)

  function vaEnPage(n) {
    setPage(pageCourante(n, pages))
    // Le client doit rester sur les resultats, pas repartir en haut de la page
    // chercher le champ de recherche — c'est ce que fait la vitrine (LOT P4 V3).
    document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // LOT P6 (S3) : Echap ferme la feuille et rend le focus au bouton qui l'a ouverte.
  // Une seule feuille est ouverte a la fois (`setSheet` le garantit), donc un seul
  // appel du hook — deux appels, c'est deux ecoutes qui se disputent la touche.
  useFeuilleFiltre(sheet !== null, () => setSheet(null))
  // Le tiroir mobile des filtres se ferme a la meme touche — mais seulement quand
  // aucune feuille n'est ouverte : Echap doit fermer une chose a la fois, pas vider
  // d'un coup les deux surfaces que le client avait deployees.
  useFeuilleFiltre(filtersOpen && sheet === null, () => setFiltersOpen(false))

  const activeChips = []
  if (filters.socket !== 'all') activeChips.push({ key: 'socket', label: filters.socket })
  if (filters.condition !== 'all') activeChips.push({ key: 'condition', label: conditionLabel(filters.condition) })
  if (filters.price !== 'any') activeChips.push({ key: 'price', label: t(PRICE_KEYS[filters.price] || 'price_any') })
  filters.brands.forEach((b) => activeChips.push({ key: `brand-${b}`, label: b, brand: b }))

  function clearChip(chip) {
    if (chip.key === 'socket') set('socket', 'all')
    else if (chip.key === 'condition') set('condition', 'all')
    else if (chip.key === 'price') set('price', 'any')
    else if (chip.brand) toggleBrand(chip.brand)
  }

  function saveSearch() {
    // LOT P6 (S3) : le rayon par defaut n'est pas une choice, il n'a rien a faire
    // dans le nom de la recherche enregistree (« Tout le catalogue · 7800x3d »).
    const title = [filters.line !== EMPTY.line ? lineLabel : null, filters.q.trim() || null, filters.socket !== 'all' ? filters.socket : null, ...filters.brands]
      .filter(Boolean)
      .join(' · ') || t('searchFree')
    // P10 (P7-14) : bornée à 10 + persistée (localStorage)
    //
    // LOT 6.7 (Q7) — deux défauts d'un coup, et ils se déclenchent ensemble :
    //
    //  1. `s-${Date.now()}` n'est PAS unique : deux clics dans la même
    //     milliseconde donnaient deux recherches au même id → `key` React
    //     dupliqué (liste mal réconciliée) et toute suppression par id en
    //     emportait une au hasard. `Math.random` n'est pas un identifiant
    //     cryptographique, c'est un anti-collision local : deux suffixes
    //     différents dans la même milliseconde suffisent.
    //  2. `...saved` lisait l'état du rendu en cours : un double-clic batchait
    //     deux appels partant de la MÊME liste, donc la seconde recherche
    //     écrasait la première (une seule des deux était enregistrée).
    //     L'updateur fonctionnel part de l'état précédent réel.
    setSaved((prev) =>
      [
        {
          id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title,
          filters: { ...filters, brands: [...filters.brands] }
        },
        ...(Array.isArray(prev) ? prev : [])
      ].slice(0, 10)
    )
    setSaveNote(t('searchSaved'))
    setTimeout(() => setSaveNote(''), 1600)
  }

  function panelTitle(panel) {
    if (panel.titles) return panel.titles[lang] || panel.titles.en || panel.id
    if (panel.titleKey) return t(panel.titleKey)
    return panel.id
  }

  function ProductCard({ p }) {
    const left = liveStock(p)
    const st = stockLabel(left, t)
    return (
      <div className="card h-100 shadow-sm product-bs-card">
        <button type="button" className="btn p-0 border-0 position-relative" onClick={() => onOpen(p.id)} aria-label={p.name}>
          <div className="ratio ratio-1x1 photo-frame overflow-hidden">
            <PartThumb product={p} />
          </div>
          <span className={`badge position-absolute top-0 end-0 m-2 ${st.cls}`}>{st.text}</span>
          {p.photoMode === 'category' && <span className="badge text-bg-light border position-absolute top-0 start-0 m-2">{t('categoryIllustrationBadge')}</span>}
        </button>
        <div className="card-body d-flex flex-column">
          <div className="small text-secondary">
            {p.sku} · {p.brand}
          </div>
          <div className="d-flex flex-wrap gap-1 mt-1 mb-1">
            <span className="badge text-bg-light border">{conditionLabel(conditionOf(p))}</span>
            {Number(p.warrantyMonths) > 0 && <span className="badge text-bg-light border">{t('warrantyMonths', { n: p.warrantyMonths })}</span>}
          </div>
          <h3 className="h6 card-title">{p.name}</h3>
          {p.rating ? (
            <div className="small mb-1">
              {starText(p.rating)} <span className="text-secondary">({p.reviews})</span>
            </div>
          ) : null}
          <p className="small text-secondary flex-grow-1">{p.short}</p>
          <div className="d-flex justify-content-between align-items-center gap-2 mt-auto">
            <span className="d-flex flex-column">
              <span className="fw-bold text-success">{money(p.price, lang)}</span>
              {hasSale(p) && <small className="text-danger"><del>{money(p.compareAtPrice, lang)}</del> · −{discountPercent(p)}%</small>}
            </span>
            <button type="button" className="btn btn-sm btn-success" disabled={left <= 0} onClick={() => onAdd(p)}>
              {left <= 0 ? t('soldOut') : t('add')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Un changement de filtre remet la page a 1 (voir la note sur l'etat `page`).
  const signature = JSON.stringify([filters.line, filters.brands, filters.condition, filters.price, filters.socket, filters.sort, filters.q])
  useEffect(() => {
    setPage(1)
  }, [signature])

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <div className="mb-4">
        <div className="text-secondary small mb-1">{t('searchCrumb')}</div>
        <h1 className="h3 mb-2">{lineLabel}</h1>
        <p className="text-secondary mb-3">{t('searchOneType', { address: STORE.address })}</p>
        <input
          className="form-control form-control-lg"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder={t('searchSlot', { slot: lineLabel })}
          aria-label={lineLabel}
        />
      </div>

      {/*
        * LOT P6 (S1) — l'ancienne rangee `d-lg-none` dressait TOUS les panneaux
        * (catalogue, machines, imprimantes, pieces PC, peripheriques, reseau,
        * lifestyle, bons plans) avec leurs rayons en pastilles, AVANT les
        * resultats : sur un telephone, une page entiere avant la premiere fiche.
        * La barre ci-dessous reprend le modele de la vitrine (LOT P4 V2) : deux
        * boutons, chacun porte la valeur choisie, et le panneau ne s'etale que
        * sur un clic.
        */}
      <div className="filters-bar mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button
            type="button"
            className={`btn btn-sm ${filters.brands.length ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setSheet(sheet === 'brands' ? null : 'brands')}
            aria-expanded={sheet === 'brands'}
            aria-controls={sheet === 'brands' ? 'search-sheet-brands' : undefined}
          >
            {t('filterBrands')}
            {filters.brands.length ? ` · ${filters.brands.length}` : ''}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filters.line !== EMPTY.line ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setSheet(sheet === 'catalog' ? null : 'catalog')}
            aria-expanded={sheet === 'catalog'}
            aria-controls={sheet === 'catalog' ? 'search-sheet-catalog' : undefined}
          >
            {t('filterCatalog')}
            {/* LOT P6 (S3) : le bouton reporte la valeur CHOISIE, pas la valeur par
                defaut. « Filtrer par catalogue · Tout le catalogue » se lisait comme
                une selection active alors que rien n'etait filtre — et le verrou de
                S1 avait du s'assouplir a la prefixation pour le tolerer. */}
            {filters.line !== EMPTY.line ? ` · ${lineLabel}` : ''}
          </button>
          {/* LOT P6 (S3) : le rayon choisi compte comme un filtre actif. Sans lui, le
              client qui avait picked un GPU ne voyait plus « Tout effacer » dans la
              barre — la vitrine, elle, comptait deja sa categorie. Deux regles, une
              seule vue oubliee. */}
          {(filters.line !== EMPTY.line || filters.brands.length || filters.condition !== 'all' || filters.price !== 'any' || filters.socket !== 'all' || filters.q.trim()) && (
            <button type="button" className="btn btn-sm btn-link" onClick={() => { setFilters({ ...EMPTY }); setDropNote('') }}>
              {t('reset')}
            </button>
          )}
        </div>

        {sheet === 'brands' && (
          <div className="filter-sheet" id="search-sheet-brands" role="group" aria-label={t('filterBrands')} >
            <BrandSheet
              t={t}
              marques={lineBrands}
              montreTout={lineBrands.length > 1}
              estActive={(b) => filters.brands.includes(b)}
              onChoisir={(b) => { toggleBrand(b); setSheet(null) }}
              onTout={() => { setFilters((f) => ({ ...f, brands: [] })); setSheet(null) }}
            />
          </div>
        )}

        {sheet === 'catalog' && (
          <div className="filter-sheet" id="search-sheet-catalog" role="group" aria-label={t('filterCatalog')}>
            <div className="d-flex flex-wrap gap-1 mb-2">
              {allPanels
                .filter((panel) => allLines.some((l) => l.group === panel.id))
                .map((panel) => {
                  const ouvert = (groupeOuvert ?? line?.group) === panel.id
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      className={`btn btn-sm ${ouvert ? 'btn-success' : 'btn-outline-secondary'}`}
                      onClick={() => setGroupeOuvert(ouvert ? '__ferme__' : panel.id)}
                      aria-expanded={ouvert}
                      aria-controls={ouvert ? `search-grid-${panel.id}` : undefined}
                    >
                      {panelTitle(panel)}
                    </button>
                  )
                })}
            </div>
            {allPanels
              .filter((panel) => (groupeOuvert ?? line?.group) === panel.id)
              .map((panel) => (
                <div className="filter-sheet-grid" key={`grid-${panel.id}`} id={`search-grid-${panel.id}`}>
                  {allLines
                    .filter((l) => l.group === panel.id)
                    .map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className={`btn btn-sm ${filters.line === l.id ? 'btn-success' : 'btn-outline-secondary'}`}
                        onClick={() => { set('line', l.id); setSheet(null); setGroupeOuvert(l.group) }}
                      >
                        {t(`line_${l.id}`) !== `line_${l.id}` ? t(`line_${l.id}`) : l.label}
                      </button>
                    ))}
                </div>
              ))}
          </div>
        )}
      </div>

      {dropNote && (
        // `role="status"` : la mention apparait sans que le client aille la chercher,
        // un lecteur d'ecran doit la dire au moment ou le filtre change.
        <p className="small text-warning mb-2" role="status">{dropNote}</p>
      )}

      <div className="d-lg-none mb-3">
        <button type="button" className="btn btn-outline-success w-100" onClick={() => setFiltersOpen(true)}>
          {t('filtersMobile')} · {results.length}
        </button>
      </div>

      <div className="row g-4">
        <aside className="col-lg-3 d-none d-lg-block">
          <div className="card shadow-sm border-0 sticky-lg-top" style={{ top: 88 }}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <strong>
                  {lineLabel} · {t('filters')}
                </strong>
                <button type="button" className="btn btn-sm btn-link" onClick={() => setFilters({ ...EMPTY, line: filters.line })}>
                  {t('reset')}
                </button>
              </div>

              {/* LOT P6 (S1) : le rayon ne se choisit plus ici — la barre de
                  boutons au-dessus des resultats porte « Filtrer par catalogue »,
                  a l'ecran comme sur telephone. Deux surfaces pour la meme regle,
                  c'est deux occasions de desaccord. */}

              <button type="button" className="btn btn-outline-success btn-sm w-100 mb-2" onClick={saveSearch}>
                {t('saveSearch')}
              </button>
              {saveNote && <p className="small text-success">{saveNote}</p>}
              {saved.length > 0 && (
                <div className="d-flex flex-wrap gap-1 mb-3">
                  {saved.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setFilters({ ...s.filters, brands: [...s.filters.brands] })}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}

              {/* LOT P6 (S1) : les marques non plus ne sont pas un etage de plus
                  dans l'aside — elles se choisissent dans la feuille du bouton
                  « Filtrer par marque », la seule surface qui les liste. Une
                  liste de 60 cases a cocher, lisible seulement en scrollant, ne
                  sert personne : le panneau porte un filtre, pas un annuaire. */}

              <fieldset className="mb-3">
                <legend className="form-label fw-semibold small">{t('condition')}</legend>
                <label className="form-check">
                  <input className="form-check-input" type="radio" name="condition" checked={filters.condition === 'all'} onChange={() => set('condition', 'all')} />
                  <span className="form-check-label small">{t('conditionAny')}</span>
                </label>
                {PRODUCT_CONDITIONS.map((condition) => (
                  <label key={condition.id} className="form-check">
                    <input className="form-check-input" type="radio" name="condition" checked={filters.condition === condition.id} onChange={() => set('condition', condition.id)} />
                    <span className="form-check-label small">{t(condition.labelKey)}</span>
                  </label>
                ))}
              </fieldset>

              {showSocket && (
                <fieldset className="mb-3">
                  <legend className="form-label fw-semibold small">{t('socket')}</legend>
                  <label className="form-check">
                    <input className="form-check-input" type="radio" name="sock" checked={filters.socket === 'all'} onChange={() => set('socket', 'all')} />
                    <span className="form-check-label small">{t('any')}</span>
                  </label>
                  {SOCKETS.map((s) => (
                    <label key={s} className="form-check">
                      <input className="form-check-input" type="radio" name="sock" checked={filters.socket === s} onChange={() => set('socket', s)} />
                      <span className="form-check-label small">{s}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              <fieldset className="mb-3">
                <legend className="form-label fw-semibold small">{t('price')}</legend>
                {PRICE_PRESETS.map((p) => (
                  <label key={p.id} className="form-check">
                    <input className="form-check-input" type="radio" name="price" checked={filters.price === p.id} onChange={() => set('price', p.id)} />
                    <span className="form-check-label small">{t(PRICE_KEYS[p.id] || 'price_any')}</span>
                  </label>
                ))}
              </fieldset>

              {/*
                * LOT P4 (V4) : le filtre « En magasin seulement » a été retiré sur
                * demande du client — et le P17 (rapport #3) avait déjà démontré
                * pourquoi il était vide : en mode API, `publicCatalog` ne contient
                * QUE ce qui est en stock, donc le case à cocher ne retirait rien.
                * Un filtre qui ne filtre rien est une promesse non tenue ; le
                * rayon du catalogue, lui, est devenu un vrai filtre (ci-dessus).
                */}
                            </div>
          </div>
        </aside>

        <section className="col-lg-9" id="search-results">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            {/* LOT P6 (S2) : le compte reste celui de la liste ENTIERE, la mention
                de page dit ou on est dedans — comme sur la vitrine. Annoncer le
                nombre de fiches affichees ferait croire que le filtre a perdu des
                resultats. */}
            <span className="fw-semibold">
              {t('results', { n: results.length })}
              {pages > 1 ? t('shopPageOf', { page: pageSure, pages }) : ''}
            </span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <ChoixTaille t={t} taille={taille} onTaille={setTaille} />
              <div className="btn-group btn-group-sm" role="group">
                <button type="button" className={`btn ${view === 'grid' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setView('grid')}>
                  {t('grid')}
                </button>
                <button type="button" className={`btn ${view === 'list' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setView('list')}>
                  {t('list')}
                </button>
              </div>
              <select className="form-select form-select-sm" style={{ width: 'auto' }} value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label={t('sort')}>
                <option value="featured">{t('sortFeatured')}</option>
                <option value="rating">{t('sortRating')}</option>
                <option value="price-asc">{t('sortPriceAsc')}</option>
                <option value="price-desc">{t('sortPriceDesc')}</option>
                <option value="stock">{t('sortStock')}</option>
                <option value="name">{t('sortName')}</option>
              </select>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              {activeChips.map((c) => (
                <button key={c.key} type="button" className="btn btn-sm btn-success" onClick={() => clearChip(c)}>
                  {c.label} ×
                </button>
              ))}
            </div>
          )}

          {results.length === 0 ? (
            <div className="empty-state">
              <strong>{t('noProducts')}</strong>
              <button
                type="button"
                className="btn btn-sm btn-outline-success mt-2"
                onClick={() => setFilters({ ...EMPTY, line: filters.line })}
              >
                {t('reset')}
              </button>
            </div>
          ) : view === 'grid' ? (
            <div className="row g-3">
              {vus.map((p) => (
                <div className="col-6 col-md-4" key={p.id}>
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {vus.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                return (
                  <div className="card shadow-sm" key={p.id}>
                    <div className="card-body d-flex flex-wrap gap-3 align-items-center">
                      <button type="button" className="btn p-0 border-0" style={{ width: 72, height: 72 }} onClick={() => onOpen(p.id)}>
                        <div className="ratio ratio-1x1 photo-frame rounded overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                      </button>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">
                          {p.sku} · {p.brand}
                        </div>
                        <button type="button" className="btn btn-link p-0 text-decoration-none text-body fw-semibold" onClick={() => onOpen(p.id)}>
                          {p.name}
                        </button>
                        <div className="small text-secondary">{p.short}</div>
                        <div className="d-flex flex-wrap gap-1 mt-1">
                          <span className={`badge ${st.cls}`}>{st.text}</span>
                          {p.photoMode === 'category' && <span className="badge text-bg-light border">{t('categoryIllustrationBadge')}</span>}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="fw-bold text-success">{money(p.price, lang)}</div>
                        {hasSale(p) && <small className="d-block text-danger mb-2"><del>{money(p.compareAtPrice, lang)}</del> · −{discountPercent(p)}%</small>}
                        <button type="button" className="btn btn-sm btn-success mt-2" disabled={left <= 0} onClick={() => onAdd(p)}>
                          {left <= 0 ? t('soldOut') : t('add')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* LOT P6 (S3) : le pager est un composant partage, et sa fenetre de
              numeros vient de `fenetrePages` — vingt-huit boutons pour trois cent une
              fiches, ce n'etait pas le mur de pastilles repare, c'etait le meme mur
              numéroté. `Pager` ne se montre que s'il y a de quoi tourner. */}
          <Pager t={t} page={pageSure} pages={pages} onPage={vaEnPage} />

        </section>
      </div>

      {filtersOpen && (
        <>
          <div className="offcanvas-backdrop fade show d-lg-none" onClick={() => setFiltersOpen(false)} />
          <div className="offcanvas offcanvas-start show d-lg-none" tabIndex={-1} style={{ visibility: 'visible' }}>
            <div className="offcanvas-header border-bottom">
              <h2 className="offcanvas-title h5">{t('filters')}</h2>
              <button type="button" className="btn-close" aria-label={t('close')} onClick={() => setFiltersOpen(false)} />
            </div>
            <div className="offcanvas-body">
              <div className="mb-3">
                <label className="form-label small">{t('sort')}</label>
                <select className="form-select" value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
                  <option value="featured">{t('sortFeatured')}</option>
                  <option value="price-asc">{t('sortPriceAsc')}</option>
                  <option value="price-desc">{t('sortPriceDesc')}</option>
                  <option value="rating">{t('sortRating')}</option>
                  <option value="stock">{t('sortStock')}</option>
                  <option value="name">{t('sortName')}</option>
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small">{t('price')}</label>
                <select className="form-select" value={filters.price} onChange={(e) => set('price', e.target.value)}>
                  {Object.keys(PRICE_KEYS).map((id) => (
                    <option key={id} value={id}>{t(PRICE_KEYS[id])}</option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small">{t('condition')}</label>
                <select className="form-select" value={filters.condition} onChange={(e) => set('condition', e.target.value)}>
                  <option value="all">{t('conditionAny')}</option>
                  {PRODUCT_CONDITIONS.map((condition) => <option key={condition.id} value={condition.id}>{t(condition.labelKey)}</option>)}
                </select>
              </div>
              {/* LOT P6 (S2) : les marques ne sont plus une DEUXIEME liste ici —
                  le bouton « Filtrer par marque », visible a tous les gabarits, les
                  porte deja. Deux listes de la meme regle, c'est deux listes qui se
                  contredisent des qu'on en modifie une (le sort de « usage »). */}
              <button type="button" className="btn btn-success w-100" onClick={() => setFiltersOpen(false)}>
                {t('results', { n: results.length })}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
