/**
 * LOT P1 (audit 19/09/2026, B5) — le formulaire « produit » du panneau maître,
 * hors React.
 *
 * Ces trois fonctions vivaient dans `MasterPage.jsx`. Le mappage
 * produit → champs, puis champs → corps de requête, est exactement l'endroit où
 * l'audit avait trouvé un trou : le panneau ne proposait de modifier QUE les
 * photos (`masterUpdateProduct(id, { photos })`), alors que le serveur sait
 * appliquer nom, prix, stock, catégorie, garanties, compatibilité… Une fiche au
 * prix erroné ne pouvait donc pas être corrigée — il fallait la masquer et la
 * recréer, donc perdre son historique de stock. Extraire le mappage permet de le
 * tester sans navigateur, comme le reste de la logique partagée du projet.
 */
import { compatValues } from './productMeta.js'

/** Formulaire vide, tel que la création le présente. */
export function emptyProductForm(category = 'accessories') {
  return {
    name: '', price: '', stock: '1', category, brand: 'PC Star', short: '', sku: '',
    model: '', barcode: '', compareAtPrice: '', lowStockAt: '2',
    description: '', condition: 'new', conditionNote: '', uses: ['office'],
    warrantyMonths: '12', tagsText: '', details: [{ label: '', value: '' }],
    // LOT P1 (B11) : socket, mémoire et format sont des LISTES. Le catalogue
    // les stocke déjà ainsi (les ventirads portent plusieurs supports) et le
    // configurateur sait les comparer ; le formulaire maître refusait seulement
    // de les écrire.
    compat: { socket: [], memory: [], form: [], psuWatts: '', psuMin: '' }, photos: []
  }
}

const num = (value) => (Number.isFinite(Number(value)) ? String(value) : '')

/**
 * Une fiche du catalogue (produit de base, produit créé, override serveur) devient
 * un formulaire rempli.
 *
 * - les nombres sont rendus en **chaîne** : le formulaire est contrôlé et `''`
 *   doit rester distinct de `0` (un prix absent se refuse, un prix à 0 DA aussi) ;
 * - les listes de compatibilité passent par `compatValues`, donc une fiche déjà
 *   enregistrée avec plusieurs supports se représente avec ses cases cochées —
 *   et se ré-enregistre sans les perdre ;
 * - `photos` reste vide : les visuels ont leur propre panneau d'édition, et
 *   renvoyer les chemins existants à chaque sauvegarde les ferait repasser par
 *   le contrôle d'upload.
 */
export function productFormFromProduct(product) {
  const p = product || {}
  const details = Array.isArray(p.details) && p.details.length
    ? p.details.map((d) => ({ label: String(d?.label || ''), value: String(d?.value || '') }))
    : [{ label: '', value: '' }]
  return {
    name: String(p.name || ''),
    price: Number(p.price) > 0 ? String(p.price) : '',
    stock: Number.isFinite(Number(p.stock)) ? String(Math.max(0, Math.floor(Number(p.stock)))) : '0',
    category: p.category || 'accessories',
    brand: String(p.brand || ''),
    short: String(p.short || ''),
    sku: String(p.sku || ''),
    model: String(p.model || ''),
    barcode: String(p.barcode || ''),
    compareAtPrice: Number(p.compareAtPrice) > 0 ? String(p.compareAtPrice) : '',
    lowStockAt: num(p.lowStockAt),
    description: String(p.description || ''),
    condition: p.condition || 'new',
    conditionNote: String(p.conditionNote || ''),
    uses: Array.isArray(p.uses) ? [...p.uses] : [],
    warrantyMonths: num(p.warrantyMonths),
    tagsText: (Array.isArray(p.tags) ? p.tags : []).join(', '),
    details,
    compat: {
      socket: compatValues(p.compat?.socket),
      memory: compatValues(p.compat?.memory),
      form: compatValues(p.compat?.form),
      psuWatts: num(p.compat?.psuWatts),
      psuMin: num(p.compat?.psuMin)
    },
    photos: []
  }
}

/**
 * Corps envoyé au serveur (création comme modification — `PUT
 * /api/master/products/:id` applique les mêmes règles que `POST`, à l'exception
 * des photos, portées par leur propre route).
 */
export function productPayloadFromForm(form) {
  const f = form || {}
  const compat = {
    ...(f.compat || {}),
    // Un champ vide n'est pas une valeur : il ne doit pas devenir `socket: ''`,
    // que le serveur refuserait (`compat`) alors que le maître n'a rien coché.
    socket: compatValues(f.compat?.socket),
    memory: compatValues(f.compat?.memory),
    form: compatValues(f.compat?.form)
  }
  return {
    name: f.name, price: Number(f.price), stock: Number(f.stock),
    category: f.category, brand: f.brand, short: f.short, sku: f.sku || undefined,
    model: f.model, barcode: f.barcode, description: f.description,
    condition: f.condition, conditionNote: f.conditionNote, uses: f.uses,
    warrantyMonths: Number(f.warrantyMonths), compareAtPrice: f.compareAtPrice,
    lowStockAt: f.lowStockAt, tags: String(f.tagsText ?? '').split(','), details: f.details,
    compat
  }
}
