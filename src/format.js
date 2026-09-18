/**
 * LOT 8.8 (A8) — formatage des dates et des prix : UNE seule définition,
 * UNE seule règle de locale.
 *
 * Le défaut : la même donnée était rendue différemment selon l'écran.
 *
 *  · `DeskPage.formatAt()` localisait selon la langue de l'interface
 *    (`ar-DZ` / `fr-DZ` / `en-GB`) ;
 *  · `OrdersPage` appelait `new Date(o.at).toLocaleString()` **sans locale** —
 *    donc celle du navigateur (`fr-FR`, `en-US`…). En mode arabe, le comptoir
 *    affichait une date en `ar-DZ` et la page « Commandes » une date française
 *    ou américaine : **deux formats pour la même commande**, à quelques écrans
 *    d'écart ;
 *  · `money()` (`src/data.js`) figeait `toLocaleString('fr-DZ')` quelle que
 *    soit la langue : en mode anglais ou arabe, les prix restaient au format
 *    français alors que les filtres de prix, eux, disent « دج » en arabe
 *    (`price_u15: 'أقل من 15 000 دج'`) ;
 *  · `server/notify.js` recopiait le même `${total.toLocaleString('fr-DZ')} DA`
 *    à la main.
 *
 * Comme pour `stockLabel.js` (lot 6.1), tout est réuni ici : la table des
 * locales n'existe qu'une fois, et un écran ne peut plus mélanger deux
 * conventions.
 *
 * **Décision assumée** : la locale **suit la langue de l'interface**, pour les
 * dates comme pour les prix — et le suffixe monétaire aussi (`DA` en français
 * et en anglais, `دج` en arabe), pour rester cohérent avec les libellés i18n
 * existants. Le **français reste la valeur par défaut** (langue absente ou
 * inconnue) : c'est le format historique du magasin, et les chemins sans
 * interface — WhatsApp au maître, exports CSV, scripts — n'ont pas de langue à
 * choisir. L'incohérence était le défaut, pas le choix : désormais il n'y a
 * qu'un choix, écrit ici.
 */

/** Langue par défaut : français (format historique du magasin). */
export const DEFAULT_LANG = 'fr'

/** Table des locales — la seule du dépôt. */
export const LOCALES = {
  fr: 'fr-DZ',
  en: 'en-GB'
}

/** Suffixe monétaire par langue, aligné sur les libellés i18n. */
export const CURRENCY = {
  fr: 'DA',
  en: 'DA',
}

/**
 * Ramène une entrée de langue à l'identifiant court (`fr`, `en`; un ancien choix `ar` retombe sur le français).
 *
 * Accepte `fr`, `fr-DZ`, `FR`, `undefined` — l'UI passe l'identifiant de
 * `LANGS`, mais un réglage navigateur ou une préférence ancienne peut arriver
 * sous forme longue.
 *
 * @param {string} [lang]
 * @returns {'fr'|'en'} une langue connue, `DEFAULT_LANG` sinon
 */
export function normalizeLang(lang) {
  const short = String(lang || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
  return short === 'en' || short === 'fr' ? short : DEFAULT_LANG
}

/**
 * Locale à utiliser pour une langue.
 *
 * @param {string} [lang]
 * @returns {string} par exemple `ar-DZ`
 */
export function localeFor(lang) {
  return LOCALES[normalizeLang(lang)]
}

/**
 * Suffixe monétaire pour une langue (`DA`, `دج`).
 *
 * @param {string} [lang]
 * @returns {string}
 */
export function currencyFor(lang) {
  return CURRENCY[normalizeLang(lang)]
}

/**
 * Prix lisible.
 *
 * P16 conservé : un prix absent ou cassé (`undefined`, `"abc"` rescapé d'un
 * override) affichait « NaN DA » en vitrine — on rend un tiret plutôt qu'un
 * prix faux.
 *
 * @param {number|string} n
 * @param {string} [lang] langue de l'interface (`fr` par défaut)
 * @returns {string} par exemple `97 000 DA`, `97.000 دج`, `97,000 DA`
 */
export function money(n, lang = DEFAULT_LANG) {
  const v = Number(n)
  if (!Number.isFinite(v)) return `— ${currencyFor(lang)}`
  return `${Math.round(v).toLocaleString(localeFor(lang))} ${currencyFor(lang)}`
}

// LOT 8.9 (A9) : `third(n)` — le « 3 × … » d'un prix — a été supprimé avec les
// clés i18n du paiement en 3 fois (`pay3xBadge`, `or3x`, `pay3xDesk`) : le seul
// mode de paiement est `cash`, codé côté serveur (`payment: 'cash'`), et
// `docs/ROADMAP-10.md` classe le paiement CCP/BaridiMob/carte et le 3× en
// **hors-scope volontaire**. Garder la fonction sans aucune clé ni aucun
// appelant, c'était exactement la fausse promesse que ce lot supprime.

/**
 * Date et heure lisibles, dans la langue de l'interface.
 *
 * Comportement défensif repris de `DeskPage.formatAt()` : valeur absente →
 * chaîne vide ; date invalide → la valeur brute (un horodatage cassé se **voit**
 * au lieu de disparaître) ; locale refusée par le moteur → idem.
 *
 * @param {string|number|Date} value
 * @param {string} [lang]
 * @returns {string}
 */
/**
 * Formate une date SANS heure (`YYYY-MM-DD`) pour la langue — utilisée pour
 * la date de retrait. Le découpage explicite évite le piège de `new
 * Date('YYYY-MM-DD')`, qui part en UTC et décale la date affichée d'un jour.
 */
export function formatDay(day, lang = DEFAULT_LANG) {
  const s = String(day || '')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return s
  const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(local.getTime())
    ? s
    : local.toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatDateTime(value, lang = DEFAULT_LANG) {
  if (value === null || value === undefined || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  try {
    return d.toLocaleString(localeFor(lang))
  } catch {
    return String(value)
  }
}
