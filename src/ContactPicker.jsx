import { useEffect, useRef, useState } from 'react'

/**
 * Bouton de contact « UN bouton → choix du numéro ».
 * Demande client : l'ancien bouton WhatsApp/appel unique ouvre un petit menu
 * proposant les DEUX numéros du magasin (07… et 06…), au lieu de doubler les
 * boutons partout (jugé non professionnel).
 *
 * Props :
 *  - label     : libellé du bouton principal (ex. « WhatsApp », « Appeler »)
 *  - btnClass  : classes Bootstrap du bouton principal
 *  - choices   : [{ title, sub, href, external }]
 *  - dropUp    : ouvre le menu vers le haut (FAB)
 *  - block     : bouton pleine largeur (offcanvas)
 *  - wrapClass : classes du wrapper (ex. « wa-fab-wrap » pour le FAB)
 */
export default function ContactButton({ label, btnClass = 'btn btn-sm btn-outline-secondary', choices, dropUp = false, block = false, wrapClass = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`contact-pick ${block ? 'contact-pick-block' : ''} ${dropUp ? 'drop-up' : ''} ${wrapClass}`.trim()} ref={ref}>
      <button type="button" className={btnClass} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="contact-pick-menu" role="menu">
          {choices.map((c) => (
            <a
              key={c.href}
              role="menuitem"
              href={c.href}
              target={c.external ? '_blank' : undefined}
              rel={c.external ? 'noreferrer' : undefined}
              onClick={(e) => {
                setOpen(false)
                // Le lien choisi DOIT s'ouvrir (demande client). Dans certains
                // environnements (aperçus iframe, bloqueurs), target=_blank
                // seul ne suffit pas : on réessaie via window.open — SANS
                // paramètre « features » (avec noopener la spec impose un
                // retour null, ce qui déclenchait une navigation même
                // onglet à tort) — et seulement si c'est vraiment bloqué,
                // on navigue dans l'onglet courant.
                if (c.external && typeof window !== 'undefined') {
                  e.preventDefault()
                  let w = null
                  try {
                    w = window.open(c.href, '_blank')
                  } catch {
                    w = null
                  }
                  if (!w) window.location.href = c.href
                }
              }}
            >
              <strong className="d-block small" dir="ltr">{c.title}</strong>
              <span className="num d-block small text-secondary" dir="ltr">
                {c.sub}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
