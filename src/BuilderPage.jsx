import { useMemo, useState } from 'react'
import { BUILDER_SLOTS, STORE, caseFitsBoard, checkCompatibility, money, socketsMatch, specOf, splitWarnings } from './data'
import { BUILD_PRESETS, applyPreset, buildParts, buildPowerRecap, comboSlots, missingRequired, partsForCompat } from './orderLogic.js'
// LOT P1 (B11) : comparaison des listes de compatibilite (memoire, format) —
// la meme regle que le controle de coherence dans `src/data.js`.
import { compatIntersects, compatLabel } from './productMeta.js'
import { stockLabel } from './stockLabel.js'
import PartThumb from './PartThumb.jsx'
import ContactButton from './ContactPicker.jsx'

// LOT 6.1 (Q1) : `stockLabel` vient de `src/stockLabel.js` — une seule définition,
// une seule famille de classes (la classe Bootstrap complète, rien à traduire).

// P28 (E) : deux onglets, et chaque emplacement appartient à l'un d'eux. « Pièces
// PC » porte le groupe `parts` ; « Accessoires » porte TOUS les autres groupes des
// données (périphériques, réseau). Avant, l'onglet testait `group === 'accessories'`,
// un groupe qui n'existe plus depuis le 18/09 : après un clic, aucun onglet n'était
// actif, et l'emplacement « Réseau » (groupe `networking`) n'apparaissait dans
// aucune barre — seul le récap y menait.
const ongletDe = (s) => (s.group === 'parts' ? 'parts' : 'accessories')
const premierDe = (onglet) => BUILDER_SLOTS.find((s) => ongletDe(s) === onglet)?.key

export default function BuilderPage({ t, lang = 'fr', products, build, setBuild, liveStock, onAdd, onOpen, onGoCart, setToast }) {
  const catalog = products || []
  const [slotKey, setSlotKey] = useState('motherboard')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('all')

  const board = build.motherboard
  const cpu = build.cpu
  const slot = BUILDER_SLOTS.find((s) => s.key === slotKey) || BUILDER_SLOTS[0]
  const onglet = ongletDe(slot)
  const slots = BUILDER_SLOTS.filter((s) => ongletDe(s) === onglet)
  // P28 (D) : les pièces de la config, une fois chacune — un combo posé dans deux
  // emplacements (boîtier + alimentation) est UNE pièce au total et au panier.
  const picked = buildParts(BUILDER_SLOTS, build)
  // … et vues par le contrôle de compatibilité sans le wattage d'un combo qui
  // n'alimente pas la config (une autre alimentation a été choisie à côté).
  const warnings = useMemo(() => checkCompatibility(partsForCompat(BUILDER_SLOTS, build)), [build])
  const { blocks, notes } = useMemo(() => splitWarnings(warnings), [warnings])
  // P17 (rapport #5) : comparaison tolérante aux sockets multiples. Aucun CPU
  // ni carte mère du catalogue n'a de `compat.socket` en tableau aujourd'hui
  // (seuls les ventirads), mais la comparaison `===` aurait silently validé un
  // couple incompatible si ça arrivait.
  //
  // LOT 6.6 (Q6) : P17 n'était appliqué qu'ICI (l'indicateur de compatibilité).
  // Les listes d'options filtraient autrement — `===` pour les CPU,
  // `socket.includes(...)` pour les ventirads — donc une carte mère multi-socket
  // aurait affiché un badge compatible tout en masquant les CPU correspondants
  // dans le sélecteur. Un seul prédicat désormais (`socketsMatch`), et la même
  // tolérance que `socketOk` : une donnée de socket absente ne disqualifie pas
  // (on ne peut pas prouver l'incompatibilité), comme `!cpu || !board || ...`.
  const socketOk = !cpu || !board || socketsMatch(cpu.compat?.socket, board.compat?.socket)
  // P26 : la liste des emplacements requis vit dans les données ; le bouton et
  // le message d'erreur la lisent tous les deux ici (avant, le message recopiait
  // « carte mère, CPU et RAM » et n'a pas suivi quand le client a demandé le
  // boîtier et l'alimentation).
  const missing = missingRequired(BUILDER_SLOTS, build)
  const requiredReady = missing.length === 0
  const total = picked.reduce((s, p) => s + p.price, 0)
  const power = useMemo(() => buildPowerRecap(partsForCompat(BUILDER_SLOTS, build)), [build])
  const locked = slot.needsBoard && !board
  const heatOk = blocks.length === 0
  const pret = requiredReady && socketOk && heatOk
  // Un emplacement se nomme d'une seule façon : sa clé i18n `line_<key>` quand
  // elle existe, sinon le libellé des données. Le même ternaire était recopié
  // trois fois (onglet, barre d'emplacements, récap).
  const labelDuSlot = (s) => {
    const key = `line_${s.key}`
    const label = t(key)
    return label !== key ? label : s.label
  }
  const slotLabel = labelDuSlot(slot)
  /** Le premier emplacement (ordre des données) où une pièce est posée — là où son prix est compté. */
  const premierEmplacement = (p) => BUILDER_SLOTS.find((s) => build[s.key]?.id === p.id)?.key

  const options = useMemo(() => {
    if (locked) return []
    let list = catalog.filter(slot.pick)
    if (slot.key === 'cpu' && board)
      list = list.filter((p) => !p.compat?.socket || !board.compat?.socket || socketsMatch(p.compat.socket, board.compat.socket))
    // LOT P1 (B11) : une carte mere qui accepte plusieurs generations de memoire
      // (liste) ne doit plus exclure la barrette qui en porte une.
      if (slot.key === 'ram' && board) list = list.filter((p) => !board.compat?.memory || compatIntersects(p.compat?.memory, board.compat.memory))
    if (slot.key === 'cooler' && board) {
      // LOT 6.6 (Q6) : `includes` ne tolérait qu'un ventirad multi-socket face à
      // une carte mère mono-socket, et rejetait tout ventirad dont `socket` est
      // une chaîne. `socketsMatch` gère les deux côtés (chaîne ou tableau).
      list = list.filter((p) => !p.compat?.socket || !board.compat?.socket || socketsMatch(p.compat.socket, board.compat.socket))
    }
    if (slot.key === 'case' && board) {
      // Phase 6 : une seule règle boîtier ↔ carte mère, partagée et testée.
      list = list.filter((p) => caseFitsBoard(p, board))
    }
    if (slot.key === 'gpu') {
      list = list.map((p) => {
        const { blocks: gpuBlocks, notes: gpuNotes } = splitWarnings(checkCompatibility([board, cpu, p].filter(Boolean)))
        return { ...p, gpuBlocks, gpuNotes }
      })
    }
    if (brand !== 'all') list = list.filter((p) => p.brand === brand)
    const query = q.trim().toLowerCase()
    if (query) {
      list = list.filter((p) => `${p.name} ${p.sku} ${p.short} ${p.brand}`.toLowerCase().includes(query))
    }
    return list
  }, [slot, board, cpu, locked, brand, q, catalog])

  const brands = useMemo(() => {
    const list = catalog.filter(slot.pick)
    return [...new Set(list.map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
  }, [slot, catalog])

  function chooseSlot(key) {
    setSlotKey(key)
    setQ('')
    setBrand('all')
  }

  /** P28 (D) : les emplacements vides qu'un combo remplit en plus de celui où on le choisit. */
  const aussiRemplis = (product, key, courant) =>
    comboSlots(BUILDER_SLOTS, product, key, { ...courant, [key]: product }).filter(
      (s) => s.key !== 'case' || !courant.motherboard || caseFitsBoard(product, courant.motherboard)
    )

  function pick(product) {
    // P28 (D) : un combo (boîtier + alimentation) remplit aussi les emplacements
    // VIDES auxquels il répond, et le dit. Un emplacement déjà choisi n'est jamais
    // remplacé ; retirer ou remplacer le combo dans un emplacement ne touche pas
    // l'autre — tout reste visible dans le récap, où la seconde ligne dit
    // « compris avec » au lieu de recompter son prix.
    const remplis = aussiRemplis(product, slot.key, build)
    if (remplis.length) setToast(t('builderComboFills', { name: product.name, slots: remplis.map(labelDuSlot).join(', ') }))
    setBuild((prev) => {
      const next = { ...prev, [slot.key]: product }
      for (const s of aussiRemplis(product, slot.key, prev)) next[s.key] = product
      if (slot.key === 'motherboard') {
        const cpuP = next.cpu
        // LOT P1 (B11) : sockets et memoires peuvent etre des listes ; on
        // compare par recoupement, et seulement quand les deux cotes declarent
        // une valeur (un composant sans etiquette n'est pas une incompatibilite).
        if (cpuP && product && cpuP.compat?.socket && product.compat?.socket && !socketsMatch(cpuP.compat.socket, product.compat.socket)) next.cpu = null
        const ramP = next.ram
        if (ramP && product && product.compat?.memory && ramP.compat?.memory && !compatIntersects(ramP.compat.memory, product.compat.memory)) next.ram = null
      }
      const gpuP = next.gpu
      if (gpuP && (slot.key === 'motherboard' || slot.key === 'cpu')) {
        const { blocks: gpuBlocks } = splitWarnings(checkCompatibility([next.motherboard, next.cpu, gpuP].filter(Boolean)))
        if (gpuBlocks.length) next.gpu = null
      }
      return next
    })
  }

  function clearSlot(key) {
    setBuild((prev) => ({ ...prev, [key]: null }))
  }

  // P28 (C) : ces quatre messages étaient inatteignables — le bouton d'ajout était
  // `disabled` dans chacun de ces cas, le clic n'arrivait jamais ici. Le client
  // voyait un bouton grisé sans savoir quoi faire. Le bouton reste cliquable
  // (annoncé `aria-disabled`), et le clic dit ce qui manque puis y mène.
  function addBuild() {
    if (!board) {
      setToast(t('toastPickBoard'))
      chooseSlot('motherboard')
      return
    }
    if (!requiredReady) {
      setToast(t('toastNeedCore', { slots: missing.map(labelDuSlot).join(', ') }))
      chooseSlot(missing[0].key)
      return
    }
    if (!socketOk) {
      setToast(t('toastSocket'))
      return
    }
    if (!heatOk) {
      setToast(t('toastHeat'))
      return
    }
    const blocked = picked.find((p) => liveStock(p) <= 0)
    if (blocked) {
      setToast(t('toastOos', { name: blocked.name }))
      return
    }
    picked.forEach(onAdd)
    onGoCart()
  }

  const current = build[slot.key]
  const filled = BUILDER_SLOTS.filter((s) => build[s.key]).length
  const progress = Math.round((filled / BUILDER_SLOTS.length) * 100)

  return (
    <main id="main-content" className="container page py-4" tabIndex={-1}>
      <div className="mb-3">
        <div className="text-secondary small">{t('builderCrumb')}</div>
        <h1 className="h3">{t('builderTitle')}</h1>
        <p className="text-secondary">{t('builderBody', { address: STORE.address })}</p>
      </div>

      <div className="mb-3">
        <div className="d-flex justify-content-between small mb-1">
          <span>{t('builderChosen', { n: filled, total: BUILDER_SLOTS.length })}</span>
          <span className="text-secondary">{progress}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
          <div className="progress-bar bg-success" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="row g-2 mb-3">
        {BUILD_PRESETS.map((pr) => (
          <div className="col-md-4" key={pr.id}>
            <button
              type="button"
              className="card h-100 border-0 shadow-sm text-start w-100 btn p-0"
              onClick={() => {
                const next = applyPreset(catalog, pr)
                setBuild((prev) => ({ ...prev, ...next }))
                setToast(t('applyPreset') + ' · ' + t(pr.titleKey))
                if (next.motherboard) chooseSlot('cpu')
              }}
            >
              <div className="card-body py-3">
                <div className="fw-semibold text-success">{t(pr.titleKey)}</div>
                <div className="small text-secondary">{t(pr.bodyKey)}</div>
              </div>
            </button>
          </div>
        ))}
      </div>

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="btn-group mb-3" role="group">
            <button
              type="button"
              className={`btn ${onglet === 'parts' ? 'btn-success' : 'btn-outline-secondary'}`}
              aria-pressed={onglet === 'parts'}
              onClick={() => chooseSlot(premierDe('parts'))}
            >
              {t('catalogParts')}
            </button>
            <button
              type="button"
              className={`btn ${onglet === 'accessories' ? 'btn-success' : 'btn-outline-secondary'}`}
              aria-pressed={onglet === 'accessories'}
              onClick={() => chooseSlot(premierDe('accessories'))}
            >
              {t('catalogAcc')}
            </button>
          </div>

          <div className="d-flex flex-wrap gap-2 mb-3">
            {slots.map((s) => {
              const lab = labelDuSlot(s)
              const has = Boolean(build[s.key])
              const active = slotKey === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-success' : has ? 'btn-outline-success' : 'btn-outline-secondary'}`}
                  onClick={() => chooseSlot(s.key)}
                >
                  {lab}
                  <span className="ms-1 small opacity-75">{has ? t('picked') : s.required ? t('need') : t('optional')}</span>
                </button>
              )
            })}
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-8">
              <input
                className="form-control"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('searchSlot', { slot: slotLabel })}
                aria-label={slotLabel}
                disabled={locked}
              />
            </div>
            <div className="col-md-4">
              <select className="form-select" value={brand} onChange={(e) => setBrand(e.target.value)} disabled={locked} aria-label={t('brands')}>
                <option value="all">{t('allBrands')}</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {locked ? (
            <div className="alert alert-warning">{t('pickBoardFirst')}</div>
          ) : options.length === 0 ? (
            <p className="text-secondary">{t('noProducts')}</p>
          ) : (
            <div className="row g-3">
              {options.map((p) => {
                const left = liveStock(p)
                const st = stockLabel(left, t)
                const on = current && current.id === p.id
                const gpuBlocks = p.gpuBlocks || []
                const gpuNotes = p.gpuNotes || []
                const tooHot = gpuBlocks.length > 0
                const spec = specOf(p)
                return (
                  <div className="col-6 col-md-4" key={p.id}>
                    <div className={`card h-100 shadow-sm product-bs-card ${on ? 'border-success' : ''} ${tooHot ? 'opacity-75' : ''}`}>
                      <button type="button" className="btn p-0 border-0 position-relative" onClick={() => onOpen(p.id)} aria-label={p.name}>
                        <div className="ratio ratio-1x1 photo-frame overflow-hidden">
                          <PartThumb product={p} />
                        </div>
                        <span className={`badge position-absolute top-0 end-0 m-2 ${st.cls}`}>{st.text}</span>
                      </button>
                      <div className="card-body d-flex flex-column">
                        <div className="small text-secondary">
                          {p.brand}
                          {spec.tdp ? ` · ${spec.tdp}W` : ''}
                          {spec.vrm ? ` · VRM ${spec.vrm}W` : ''}
                        </div>
                        <h3 className="h6">
                          <button type="button" className="btn btn-link p-0 text-start text-decoration-none text-body" onClick={() => onOpen(p.id)}>
                            {p.name}
                          </button>
                        </h3>
                        <p className="small text-secondary flex-grow-1 mb-2">{p.short}</p>
                        {/* P14 (#4) : `splitWarnings` renvoie des objets
                            { key, vars, block } — les rendre tels quels faisait
                            lever « Objects are not valid as a React child »
                            (écran blanc du Builder). Même motif qu'en sidebar. */}
                        {tooHot && (
                          <div className="alert alert-danger py-1 px-2 small mb-2">
                            {t(gpuBlocks[0].key, gpuBlocks[0].vars)}
                          </div>
                        )}
                        {!tooHot && gpuNotes[0] && (
                          <div className="alert alert-warning py-1 px-2 small mb-2">
                            {t(gpuNotes[0].key, gpuNotes[0].vars)}
                          </div>
                        )}
                        <div className="d-flex justify-content-between align-items-center gap-2 mt-auto">
                          <span className="fw-bold text-success">{money(p.price, lang)}</span>
                          <button
                            type="button"
                            className={`btn btn-sm ${on ? 'btn-outline-success' : 'btn-success'}`}
                            disabled={left <= 0 || tooHot}
                            onClick={() => (on ? clearSlot(slot.key) : pick(p))}
                          >
                            {left <= 0 ? t('soldOut') : tooHot ? t('tooHighGamme') : on ? t('selected') : t('choose')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <aside className="col-lg-4">
          <div className="card shadow-sm border-0 sticky-lg-top" style={{ top: 88 }}>
            <div className="card-body">
              <h2 className="h5">{t('thisBuild')}</h2>
              {!board ? (
                <p className="text-secondary">{t('pickBoardFirst')}</p>
              ) : (
                <ul className="list-group list-group-flush mb-3">
                  {BUILDER_SLOTS.map((s) => {
                    const lab = labelDuSlot(s)
                    return (
                      <li key={s.key} className={`list-group-item px-0 d-flex justify-content-between align-items-center ${build[s.key] ? '' : 'text-secondary'}`}>
                        <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => chooseSlot(s.key)}>
                          {lab}
                        </button>
                        {build[s.key] ? (
                          <span className="d-flex align-items-center gap-2">
                            {/* P28 (D) : un combo déjà compté plus haut n'est pas recompté —
                                la somme des lignes reste égale au total. */}
                            {premierEmplacement(build[s.key]) !== s.key ? (
                              <em className="small">{t('builderComboIncluded', { slot: labelDuSlot(BUILDER_SLOTS.find((x) => x.key === premierEmplacement(build[s.key]))) })}</em>
                            ) : (
                              <strong className="text-success">{money(build[s.key].price, lang)}</strong>
                            )}
                            <button type="button" className="btn-close btn-sm" aria-label={t('remove')} onClick={() => clearSlot(s.key)} />
                          </span>
                        ) : (
                          // P26 : même vocabulaire que la vignette d'emplacement
                          // (« Requis » / « Optionnel ») — « Obligatoire » et
                          // « Passer » disaient la même chose autrement.
                          <em className="small">{s.required ? t('need') : t('optional')}</em>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="fw-semibold">{t('total')}</span>
                <span className="fs-5 fw-bold text-success">{money(total, lang)}</span>
              </div>
              {(power.socket || power.estimateWatts) && (
                <div className="small border rounded p-2 mb-3 bg-body-tertiary">
                  <div className="fw-semibold mb-1">{t('buildPower')}</div>
                  <div className="text-secondary">
                    {power.socket ? `Socket ${power.socket}` : ''}
                    {power.memory ? ` · ${power.memory}` : ''}
                    {power.form ? ` · ${power.form}` : ''}
                  </div>
                  <div className={power.psuOk ? 'text-success' : 'text-danger'}>
                    ~{power.estimateWatts}W
                    {power.psuWatts ? ` · PSU ${power.psuWatts}W` : ''}
                    {' · '}
                    {power.psuOk ? t('buildPsuOk') : t('buildPsuLow', { w: power.psuMinSuggested })}
                  </div>
                </div>
              )}
              <div className="d-flex flex-wrap gap-1 mb-3">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    const lines = picked.map((p) => `- ${p.name} (${money(p.price, lang)})`).join('\n')
                    const text = t('buildCopyMsg', { lines, total: money(total, lang) })
                    // P10 (P7-16) : gestion de l'échec (iframe sans permission
                    // clipboard → la promesse rejetait sans être gérée) + toast
                    // honnête au lieu de « copié » systématique.
                    const p = navigator.clipboard?.writeText?.(text)
                    if (p && typeof p.catch === 'function') {
                      p.then(() => setToast(t('copied'))).catch(() => setToast(t('copyBlocked')))
                    } else {
                      setToast(t('copyBlocked'))
                    }
                  }}
                >
                  {t('copyBuild')}
                </button>
                {/* UN bouton partage → choix du numéro (07 ou 06) */}
                <ContactButton
                  label={t('shareBuild')}
                  btnClass="btn btn-sm btn-outline-success"
                  choices={[
                    {
                      title: STORE.phone,
                      href: `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(
                        t('buildShareMsg', {
                          lines: picked.map((p) => `- ${p.name}`).join('\n'),
                          total: money(total, lang)
                        })
                      )}`,
                      external: true
                    },
                    {
                      title: STORE.phone2,
                      href: `https://wa.me/${STORE.whatsapp2}?text=${encodeURIComponent(
                        t('buildShareMsg', {
                          lines: picked.map((p) => `- ${p.name}`).join('\n'),
                          total: money(total, lang)
                        })
                      )}`,
                      external: true
                    }
                  ]}
                />
              </div>

              {!socketOk && cpu && board && (
                <div className="alert alert-danger py-2">
                  <strong>{t('socketMismatch')}</strong>
                  <div className="small">
                    {/* LOT P2 (B10) : ce bloc se rend précisément quand
                        `socketOk` est faux — donc aussi quand le CPU ne déclare
                        AUCUN socket, le cas où `cpu.compat.socket` jetait. */}
                    {t('compatSocketShort', { cpu: cpu.name, cpuSocket: compatLabel(cpu.compat?.socket), board: board.name, boardSocket: compatLabel(board.compat?.socket) })}
                  </div>
                </div>
              )}
              {blocks.length > 0 && (
                <div className="alert alert-danger py-2">
                  <strong>{t('willNotRun')}</strong>
                  {blocks.map((w, i) => (
                    <div key={`${w.key}-${i}`} className="small">
                      {t(w.key, w.vars)}
                    </div>
                  ))}
                </div>
              )}
              {socketOk && notes.length > 0 && (
                <div className="alert alert-warning py-2">
                  <strong>{t('watchThis')}</strong>
                  {notes.map((w, i) => (
                    <div key={`${w.key}-${i}`} className="small">
                      {t(w.key, w.vars)}
                    </div>
                  ))}
                </div>
              )}

              {/* P28 (C) : jamais `disabled` — un bouton grisé ne dit pas pourquoi. Il
                  s'annonce indisponible (`aria-disabled`, opacité) et son clic
                  explique ; ce qui manque est aussi écrit dessous, sans clic. */}
              <button
                className={`btn btn-success w-100 ${pret ? '' : 'opacity-75'}`}
                type="button"
                aria-disabled={!pret}
                aria-describedby={board && !requiredReady ? 'builder-missing' : undefined}
                onClick={addBuild}
              >
                {t('addBuild')}
              </button>
              {board && !requiredReady && (
                <p id="builder-missing" className="small text-danger mt-2 mb-0">
                  {t('toastNeedCore', { slots: missing.map(labelDuSlot).join(', ') })}
                </p>
              )}
              <p className="small text-secondary mt-2 mb-0">{t('builderPayNote')}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
