/**
 * Logo officiel PC Star Informatique (carte de visite du magasin) :
 * étoile rouge + swoosh orbital bleu + wordmark PCSTAR / INFORMATIQUE.
 * Reproduit en SVG vectoriel ; les couleurs passent par les tokens
 * --brand-blue / --brand-red (déclinés dark/light dans tokens.css).
 */
export default function Logo() {
  return (
    <span className="logo-brand d-flex align-items-center gap-2" aria-hidden="true">
      <svg className="logo-svg" viewBox="0 0 48 48" width="34" height="34" focusable="false">
        {/* Swoosh orbital bleu */}
        <path d="M5 40 C 9 21, 25 8, 45 9 C 30 12, 15 23, 11 42 Z" fill="var(--brand-blue)" />
        <path d="M8 43 C 12 28, 24 16, 40 14 C 28 18, 17 28, 14 44 Z" fill="var(--brand-blue)" opacity="0.55" />
        {/* Étoile rouge */}
        <polygon
          points="34,1 36.7,8.3 44.5,8.6 38.4,13.4 40.5,20.9 34,16.6 27.5,20.9 29.6,13.4 23.5,8.6 31.3,8.3"
          fill="var(--brand-red)"
        />
      </svg>
      <span className="logo-word">
        PCSTAR
        <small>INFORMATIQUE</small>
      </span>
    </span>
  )
}
