/**
 * LOT 3.1 (F7 + F8) — UN seul accès au stockage navigateur, qui ne lève
 * **jamais**, avec repli mémoire.
 *
 * Le problème, reproduit à l'audit :
 *
 *  · **F7** — dans une iframe tierce (aperçu intégré, réseau social, certains
 *    navigateurs en « blocage des cookies tiers »), `localStorage` lève un
 *    `SecurityError`. L'appel était fait dans les **initializers de `useState`**
 *    (`loadLang()`, `loadMeta()`, `loadSession()`, `loadUsers()`), donc pendant
 *    le rendu : tout le site tombait dans l'ErrorBoundary. Le magasin était
 *    injoignable depuis l'aperçu même qui le documente (`src/api.js:8`,
 *    « some embedded iframes block third-party localStorage »).
 *  · **F8** — le wrapper `storage` d'`App.jsx` avait été ajouté *précisément*
 *    pour ces iframes… sans `try/catch`. Il levait donc comme le reste. Seuls
 *    `loadCartFor` et `setCart` étaient protégés.
 *
 * Deux pièges que ce module traite et que les correctifs partiels rataient :
 *
 *  1. `typeof localStorage !== 'undefined'` **ne protège pas**. `localStorage`
 *     est un accesseur de `Window` dont le getter lève `SecurityError` quand le
 *     stockage est bloqué : `typeof` l'évalue, donc lève. La lecture de la
 *     référence globale est elle-même dans un `try`.
 *  2. La résolution reste **paresseuse** (P22, piège 2) : le stockage réel est
 *     résolu à chaque appel, jamais capturé à l'évaluation du module. Un
 *     harnais de test — ou un worker — qui pose `localStorage` après les
 *     imports est suivi, comme avant.
 *
 * Repli : une `Map` **par wrapper**. Elle suit chaque écriture ; une clé dont
 * l'écriture persistante a échoué est « ombrée » et sa copie mémoire fait foi à
 * la lecture (sinon un `QuotaExceededError` en cours de session laisserait lire
 * la valeur périmée du disque). Panier, langue, session et jeton API continuent
 * donc de fonctionner — pour la durée de la page, ce que l'UI dit explicitement
 * (`storageMode()`).
 */

/** Résout le stockage réel à l'appel. `typeof` ne protège pas du getter qui lève. */
function resolveGlobal() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Cache des wrappers créés pour un stockage explicite (tests, memory storage). */
const wrappers = new WeakMap()

/**
 * Crée un objet de type `Storage` — les trois méthodes utilisées par l'app —
 * qui ne lève jamais et retombe sur son propre repli mémoire.
 *
 * @param {Storage|{getItem:Function}|null|undefined} [explicit] stockage à
 *   envelopper.Absent → `localStorage`, résolu **à chaque appel**.
 */
export function createSafeStorage(explicit) {
  const memory = new Map()
  const shadowed = new Set()
  const state = { blocked: false, error: null }

  const live = () => (explicit || resolveGlobal())

  const wrapper = {
    getItem(key) {
      const k = String(key)
      if (shadowed.has(k)) return memory.has(k) ? memory.get(k) : null
      const store = live()
      if (!store) return memory.has(k) ? memory.get(k) : null
      try {
        const v = store.getItem(k)
        if (v != null) return String(v)
        return memory.has(k) ? memory.get(k) : null
      } catch (err) {
        state.blocked = true
        state.error = err
        return memory.has(k) ? memory.get(k) : null
      }
    },

    /** @returns {boolean} `true` si l'écriture persistante a réussi. */
    setItem(key, value) {
      const k = String(key)
      const v = String(value)
      memory.set(k, v)
      const store = live()
      if (!store) return false
      try {
        store.setItem(k, v)
        shadowed.delete(k)
        return true
      } catch (err) {
        // `SecurityError` (accès bloqué) comme `QuotaExceededError` (photos en
        // data-URL du master) : même traitement, la page continue en mémoire.
        state.blocked = true
        state.error = err
        shadowed.add(k)
        return false
      }
    },

    /** @returns {boolean} `true` si la suppression persistante a réussi. */
    removeItem(key) {
      const k = String(key)
      memory.delete(k)
      shadowed.delete(k)
      const store = live()
      if (!store) return false
      try {
        store.removeItem(k)
        return true
      } catch (err) {
        state.blocked = true
        state.error = err
        return false
      }
    },

    /** Ce wrapper écrit-il vraiment sur le disque du navigateur ? */
    get persistent() {
      return !state.blocked && Boolean(live())
    },

    /** `true` dès qu'un accès au stockage réel a levé. */
    get blocked() {
      return state.blocked
    },

    /** Dernière erreur de stockage (diagnostic, jamais affichée telle quelle). */
    get error() {
      return state.error
    },

    /** Vide le repli mémoire — tests. */
    clearMemory() {
      memory.clear()
      shadowed.clear()
      state.blocked = false
      state.error = null
    }
  }

  return wrapper
}

/** Le wrapper par défaut — résout `localStorage` à chaque appel. */
export const safeStorage = createSafeStorage()

/**
 * Ramène n'importe quel stockage fourni (y compris `null`, un `localStorage`
 * brut ou un memory storage de test) à un wrapper qui ne lève jamais.
 * `safeStorage` est renvoyé tel quel : c'est l'instance partagée par l'app,
 * donc celle dont le repli mémoire est commun à tous les modules.
 */
export function asSafeStorage(storage) {
  if (storage == null || storage === safeStorage) return safeStorage
  if (storage && typeof storage.getItem === 'function' && storage.persistent !== undefined) return storage
  if (typeof storage !== 'object') return safeStorage
  const cached = wrappers.get(storage)
  if (cached) return cached
  const created = createSafeStorage(storage)
  wrappers.set(storage, created)
  return created
}

/**
 * `'persistent'` : le stockage réel répond.
 * `'memory'` : absent, ou bloqué — les données vivent le temps de la page.
 */
export function storageMode(storage = safeStorage) {
  return asSafeStorage(storage).persistent ? 'persistent' : 'memory'
}

/** L'UI peut le dire à l'utilisateur (panier non conservé au rechargement). */
export function isStorageBlocked(storage = safeStorage) {
  return asSafeStorage(storage).blocked === true
}

/** Réinitialise le repli du wrapper par défaut — tests qui remontent l'app. */
export function resetSafeStorage() {
  safeStorage.clearMemory()
}
