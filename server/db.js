import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
// LOT 8.2 (A2) : liste des ids connus du catalogue de base — sert à repérer les
// entrées orphelines de `db.stock` / `productOverrides` (voir `purgeOrphanCatalogRefs`).
import { PRODUCTS } from '../src/data.js'
// LOT 8.7 (A7) : écriture atomique **et durable** (fsync avant rename, puis
// fsync du répertoire). Le couple tmp+rename seul ne garantissait que
// l'atomicité : après coupure, `store.json` pouvait être vide ou tronqué.
import { atomicDurableWriteFileSync, durableWriteFileSync } from './durableWrite.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** On Vercel serverless the bundle FS is read-only — persist under /tmp (ephemeral per instance). */
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
const DATA_DIR = process.env.PCSTAR_DATA_DIR
  ? path.resolve(process.env.PCSTAR_DATA_DIR)
  : IS_SERVERLESS
    ? path.join('/tmp', 'pcstar-data')
    : path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'store.json')
const DB_TMP_FILE = path.join(DATA_DIR, 'store.json.tmp')
/**
 * LOT 3.2 (B1) — verrou consultatif inter-processus pour le driver FICHIER.
 *
 * `updateDb` est un read-modify-write : deux processus (deux terminaux
 * `npm run dev:api`, un script `backup` pendant que le serveur tourne, deux
 * workers) pouvaient lire le même état puis écrire chacun le sien — la dernière
 * écriture gagnait et la mutation de l'autre était **perdue** (survente réelle :
 * deux commandes simultanées, une seule en base). Le driver Neon, lui, verrouille
 * déjà la ligne (`SELECT … FOR UPDATE`, server/neonStore.js) : ce verrou ne
 * concerne que le fichier.
 */
const DB_LOCK_FILE = path.join(DATA_DIR, 'store.json.lock')
const MAX_CORRUPT_BACKUPS = 3
/** Attente maximale du verrou avant d'écrire quand même (base dégradée > base bloquée). */
const LOCK_TIMEOUT_MS = 4000
/** Au-delà, un verrou est réputé orphelin (processus tué) et repris. */
const LOCK_STALE_MS = 10000

/**
 * LOT 3.2 (B3) — cache mémoire du driver fichier.
 *
 * Chaque requête relisait et reparsait `store.json` en entier (`readDbAsync`
 * est appelé par tous les handlers) : sur un catalogue de 250 références plus
 * les commandes, c'est plusieurs centaines de Ko parsés par requête, y compris
 * pour `GET /api/health`. Le cache est invalidé par `statSync` (mtime + taille),
 * donc il suit aussi les écritures d'un AUTRE processus.
 */
const cache = { stat: null, db: null, hits: 0, reads: 0, writes: 0 }

/**
 * LOT 3.16 (B19) — dernier état lu avec succès, tous drivers. Sert au repli
 * dégradé : plutôt que de servir le catalogue statique du build sans savoir de
 * quand il date, on peut servir la dernière lecture réussie en disant son âge.
 */
const lastGood = { at: 0, db: null }

/** Normalisation déjà persistée une fois dans ce processus (LOT 3.2 / B2). */
let initialized = false

function hashPass(password) {
  const salt = crypto.randomBytes(8).toString('hex')
  const hash = crypto.scryptSync(String(password), `pcstar:${salt}`, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

/**
 * LOT 1.6 — variante asynchrone de `hashPass`, à utiliser sur TOUTE route
 * HTTP.
 *
 * `scryptSync` bloque le thread principal : mesuré à 30,8–43,0 ms par hash sur
 * cette machine (770 ms pour 25 hashes). Sur `/api/auth/register` — sans
 * authentification et, avant le lot 1.6, sans rate-limit — c'était un vecteur
 * de déni de service à coût nul pour l'attaquant.
 *
 * `hashPass` (synchrone) reste utilisé là où il n'y a pas le choix : le seed du
 * compte maître, évalué au chargement du module.
 */
export function hashPassAsync(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(8).toString('hex')
    crypto.scrypt(String(password), `pcstar:${salt}`, 32, (err, derived) => {
      if (err) return reject(err)
      resolve(`scrypt$${salt}$${derived.toString('hex')}`)
    })
  })
}

function hashPassLegacy(password) {
  return crypto.createHash('sha256').update(`pcstar:${password}`).digest('hex')
}

/**
 * LOT 1.1 — le compte maître n'est plus codé en dur.
 *
 * Avant : l'e-mail et le mot de passe du maître étaient **littéraux** dans ce
 * fichier et dans `src/shopStore.js` — donc présents dans le bundle JS public
 * (retrouvés par `grep` sur `dist/assets/index-*.js`), et `POST /api/auth/login`
 * avec ces valeurs ouvrait une vraie session `role: 'master'`. Les mêmes
 * identifiants étaient en plus publiés dans cinq fichiers de documentation.
 * Les valeurs d'origine ne sont volontairement **pas** répétées ici : elles
 * resteraient lisibles dans le dépôt, donc exploitables.
 *
 * Désormais l'e-mail et le mot de passe viennent de l'environnement
 * (`MASTER_EMAIL` / `MASTER_PASSWORD`) et il n'existe **aucune valeur par
 * défaut** : `masterAccount()` lève si l'une des deux variables manque. Le
 * serveur refuse donc de démarrer — ou l'invocation serverless échoue
 * visiblement — plutôt que de retomber sur un secret connu de tous.
 *
 * L'`id` reste fixe (`master-pcstar`) : il n'est pas secret, et le rendre
 * variable casserait les références existantes en base.
 *
 * Déclaration placée APRÈS `hashPassLegacy` : l'objet `MASTER` est évalué au
 * chargement du module et n'a donc plus à compter sur le hoisting des
 * déclarations de fonction (rapport d'audit, item #55/W).
 */
export function masterAccount() {
  const email = String(process.env.MASTER_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.MASTER_PASSWORD || '')
  // `.trim()` sur le mot de passe : une variable posée à blanc (`MASTER_PASSWORD=`
  // dans un .env, ou des espaces) ne doit PAS passer pour un mot de passe.
  if (!email || !password.trim()) {
    throw new Error(
      '[pcstar] compte maître non configuré — MASTER_EMAIL et MASTER_PASSWORD sont obligatoires.\n' +
        '  · local       : renseignez-les dans .env (voir .env.example)\n' +
        '  · Vercel      : Project → Settings → Environment Variables\n' +
        '  · tests       : chargé automatiquement par scripts/test-env.mjs\n' +
        "Aucune valeur par défaut n'est fournie : un secret codé en dur finirait dans le bundle public."
    )
  }
  return {
    id: 'master-pcstar',
    role: 'master',
    email,
    passwordHash: hashPassLegacy(password),
    name: String(process.env.MASTER_NAME || 'PC Star Desk'),
    phone: String(process.env.MASTER_PHONE || '0770650387'),
    avatar: 'star',
    accent: 'green',
    provider: 'email',
    links: { google: null, meta: null }
  }
}

const MASTER = masterAccount()
// `normalizeDb()` tourne aussi sur les lectures. Un hash scrypt ne doit pas
// monopoliser le CPU à chaque requête : on ne le revérifie que si le secret
// configuré, l'e-mail maître ou le hash persistant a changé. Un redéploiement
// repart avec ce cache vide, donc détecte bien toute rotation d'environnement.
let masterCredentialVerificationKey = null

export function verifyPass(password, stored) {
  if (!stored) return false
  const s = String(stored)
  if (s.startsWith('scrypt$')) {
    const parts = s.split('$')
    const salt = parts[1]
    const hash = parts[2]
    const check = crypto.scryptSync(String(password), `pcstar:${salt}`, 32)
    const expect = Buffer.from(hash, 'hex')
    if (check.length !== expect.length) return false
    return crypto.timingSafeEqual(check, expect)
  }
  // LOT 2 (découverte hors rapports) — cette branche était MORTE, et pire :
  // elle était une porte.
  //
  // Elle comparait la valeur stockée à `sha256$pcstar:<mot de passe EN CLAIR>`,
  // alors qu'une empreinte legacy préfixée vaut `sha256$pcstar:<hex>` (hex =
  // sha256 de `pcstar:<mot de passe>`). Deux conséquences :
  //  · aucun mot de passe réel ne pouvait jamais la satisfaire — les comptes
  //    seedés (maître + démos) sont en fait vérifiés par la dernière branche,
  //    celle qui compare l'hex nu. Vérifié sur la base du commit d'origine
  //    (fdbd778) : rien n'a jamais porté ce préfixe en production ;
  //  · en revanche, `password === <hex>` la satisfaisait : quiconque lisait une
  //    empreinte préfixée (dump de store.json, backup) pouvait se connecter
  //    **avec l'empreinte elle-même** en guise de mot de passe.
  //
  // La comparaison porte désormais sur l'empreinte du mot de passe proposé,
  // préfixée — et reste à temps constant.
  if (s.startsWith('sha256$pcstar:')) {
    const prefixed = Buffer.from(`sha256$pcstar:${hashPassLegacy(password)}`)
    const actual = Buffer.from(s)
    if (actual.length !== prefixed.length) return false
    return crypto.timingSafeEqual(actual, prefixed)
  }
  // LOT 1.14 : comparaison à temps constant. Les deux branches ci-dessus
  // utilisaient déjà `timingSafeEqual` ; celle-ci comparait deux chaînes avec
  // `===` (longueur et préfixe commun observables par le temps). L'empreinte
  // est un sha256 non salé, donc le gain est marginal — mais l'incohérence
  // entre branches d'une même fonction de vérification n'a pas lieu d'être.
  // C'est CETTE branche qui traite les comptes seedés (`demoAccounts()` et
  // `masterAccount` stockent l'hex nu renvoyé par `hashPassLegacy`).
  const legacyActual = Buffer.from(s)
  const legacyExpected = Buffer.from(hashPassLegacy(password))
  if (legacyActual.length !== legacyExpected.length) return false
  return crypto.timingSafeEqual(legacyActual, legacyExpected)
}

/**
 * LOT 1.19 — les comptes de démonstration ne sont plus des identifiants publiés.
 *
 * Avant ce correctif, le seed codait en dur trois mots de passe — l'empreinte
 * `hashPassLegacy` d'une valeur littérale, forme que ce commentaire évite
 * volontairement de reproduire (le scanner du lot 1.2 la signale à juste titre)
 * — qui étaient **aussi** imprimés dans le README, les
 * trois guides de démonstration et le bundle client (`DEMO_CUSTOMERS` dans
 * `src/shopStore.js`). Ce ne sont pas des comptes privilégiés (`role:
 * 'customer'`), mais ce sont de **vraies sessions** sur l'API déployée :
 * commandes, profil, historique. Le lot 1.2 les avait laissés de côté
 * explicitement (« leur retrait relève du lot 1.3 / d'une décision produit ») ;
 * la vérification du « lot 0 » livré le 16/09 (`docs/VERIFICATION-RAPPORT-LOT0.md`)
 * a montré ce que coûte ce statut intermédiaire : une rotation qui remplace un
 * secret publié par un autre secret publié.
 *
 * Règle retenue, la même que pour le compte maître (lot 1.1) :
 *  · le mot de passe vient de l'**environnement** (`DEMO_PASSWORD`), une seule
 *    valeur pour les trois comptes — ce sont des fixtures, pas des personnes ;
 *  · variable **absente** → les comptes sont seedés **verrouillés**
 *    (`passwordHash: null`) : ils restent visibles comme données de
 *    démonstration (le comptoir a des clients à afficher), mais personne ne peut
 *    s'y connecter avec une valeur lue dans le dépôt. Le serveur démarre
 *    normalement : ces comptes sont facultatifs, contrairement au maître.
 *
 * Lue à chaque appel (et non figée au chargement du module) pour deux raisons :
 * `normalizeDb` doit pouvoir aligner une base existante sur l'environnement du
 * processus, et les tests doivent pouvoir basculer l'état verrouillé sans
 * lancer de sous-processus.
 */
export function demoPassword() {
  return String(process.env.DEMO_PASSWORD || '')
}

/** Empreinte des comptes de démonstration, ou `null` quand ils sont verrouillés. */
export function demoPasswordHash() {
  const pw = demoPassword()
  return pw ? hashPassLegacy(pw) : null
}

export function demoAccounts() {
  const passwordHash = demoPasswordHash()
  return [
    {
      id: 'demo-karim',
      role: 'customer',
      email: 'karim.oran@demo.dz',
      passwordHash,
      name: 'Karim B.',
      phone: '0550123456',
      avatar: 'chip',
      accent: 'blue',
      provider: 'email',
      wilaya: 'Oran',
      links: { google: null, meta: null },
      demo: true
    },
    {
      id: 'demo-amina',
      role: 'customer',
      email: 'amina.castors@demo.dz',
      passwordHash,
      name: 'Amina K.',
      phone: '0669174617',
      avatar: 'card',
      accent: 'gold',
      provider: 'email',
      wilaya: 'Oran',
      links: { google: null, meta: null },
      demo: true
    },
    {
      id: 'demo-yacine',
      role: 'customer',
      email: 'yacine.pc@demo.dz',
      passwordHash,
      name: 'Yacine M.',
      phone: '0770650388',
      avatar: 'pad',
      accent: 'red',
      provider: 'email',
      wilaya: 'Mostaganem',
      links: { google: null, meta: null },
      demo: true
    }
  ]
}

export function emptyDb() {
  return {
    users: [MASTER, ...demoAccounts()],
    orders: [],
    stock: {},
    meta: {
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: []
    },
    sessions: {},
    oauthPending: {}
  }
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DB_FILE)) {
    // LOT 8.7 (A7) : même garantie pour la création initiale — un fichier de
    // base vide/tronqué au remontage serait mis en quarantaine au premier
    // démarrage, avant qu'aucun backup n'existe.
    durableWriteFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2))
  }
}

/**
 * LOT 3.2 (B2) — normalisation de l'état, **en mémoire uniquement**.
 *
 * C'était le corps de `readDb()` : structure manquante, synchronisation du
 * maître sur l'environnement, seed des comptes de démonstration, clés internes
 * de transit, sessions et consentements expirés. Il se terminait par
 * `writeDb(db)` — donc **une écriture disque pendant une lecture**, sur
 * n'importe quel GET, dès qu'une session avait expiré ou qu'un `_lastAuth`
 * traînait. Les produits de la normalisation sont désormais :
 *  · appliqués en mémoire à CHAQUE lecture (ce que voit le handler reste juste) ;
 *  · persistés au **démarrage** (`initDb`, une fois par processus) et à chaque
 *    **écriture** (`writeDb`).
 *
 * @returns {boolean} `true` si l'état a changé — donc s'il y a lieu de persister.
 */
export function normalizeDb(db) {
  let changed = false
  // Lire la configuration ici (plutôt que réutiliser seulement la constante de
  // démarrage) garde la fonction déterministe dans les outils de migration et
  // permet de détecter une rotation sans réimporter le module.
  const configuredMaster = masterAccount()
  if (!Array.isArray(db.users)) {
    db.users = [configuredMaster, ...demoAccounts()]
    changed = true
  }
  // LOT 1.1 — le maître suit l'environnement.
  //
  // Avant ce correctif, la réinjection se contentait d'ajouter un maître *s'il
  // n'y en avait aucun*. Sur une base déjà constituée, le compte maître
  // existant — créé à l'époque où ses identifiants étaient codés en dur et
  // livrés dans le bundle public — restait donc **indéfiniment** en place :
  // poser MASTER_EMAIL / MASTER_PASSWORD n'aurait rien changé pour lui.
  //
  // On aligne l'e-mail sur l'environnement et on vérifie que le hash courant
  // accepte encore MASTER_PASSWORD, quel que soit son format. La route login
  // re-sel le hash legacy en scrypt après une connexion réussie ; une rotation
  // de secret reste néanmoins détectable au redéploiement.
  const masterIdx = (db.users || []).findIndex((u) => u && u.role === 'master')
  if (masterIdx < 0) {
    db.users = [configuredMaster, ...(db.users || [])]
    // Réintroduire l'identité maître après une base incomplète ne doit pas
    // ressusciter une ancienne session portant son id fixe.
    if (db.sessions && typeof db.sessions === 'object') {
      for (const [key, session] of Object.entries(db.sessions)) {
        if (session?.userId === configuredMaster.id) delete db.sessions[key]
      }
    }
    changed = true
  } else {
    const cur = db.users[masterIdx]
    const priorMasterId = cur.id
    let revokeMasterSessions = false
    if (cur.id !== configuredMaster.id) {
      cur.id = configuredMaster.id
      revokeMasterSessions = true
      changed = true
    }
    if (cur.email !== configuredMaster.email) {
      cur.email = configuredMaster.email
      revokeMasterSessions = true
      changed = true
    }
    // Le maître est exclusivement un compte à mot de passe. Purger les liens
    // hérités ferme définitivement une ancienne surface OAuth ; `finishIdentity`
    // les refuse également pour les états qui auraient été créés avant ce
    // déploiement.
    if (cur.links?.google || cur.links?.meta) {
      cur.links = { ...cur.links, google: null, meta: null }
      changed = true
    }
    // AUDIT-2026-09-17 / phase 2 : ne pas se fier au préfixe du hash pour
    // décider si le secret maître doit suivre l'environnement. Après le premier
    // login, le hash est correctement migré en scrypt ; l'ancien code cessait
    // alors toute synchronisation, même après une rotation de
    // MASTER_PASSWORD au redéploiement. Le nouveau mot de passe échouait et
    // l'ancien restait valable.
    //
    // Vérifier le secret configuré contre le hash courant couvre les formats
    // legacy et scrypt sans jamais écrire le mot de passe dans la base. En cas
    // d'écart, on repart de l'empreinte du secret configuré ; le prochain login
    // le remigrera en scrypt. Les sessions maître sont aussi révoquées : une
    // rotation ne doit pas laisser un ancien navigateur privilégié ouvert.
    const verificationKey = `${configuredMaster.email}\u0000${configuredMaster.passwordHash}\u0000${String(cur.passwordHash || '')}`
    if (masterCredentialVerificationKey !== verificationKey) {
      if (!verifyPass(String(process.env.MASTER_PASSWORD || ''), cur.passwordHash)) {
        cur.passwordHash = configuredMaster.passwordHash
        revokeMasterSessions = true
        changed = true
      }
      // Le hash peut avoir été remplacé juste au-dessus : mémoriser l'état
      // final, pas seulement celui qui a été lu, pour ne pas revérifier au GET
      // suivant. Une migration scrypt de login modifiera le suffixe et forcera
      // naturellement une nouvelle vérification, une seule fois.
      masterCredentialVerificationKey = `${configuredMaster.email}\u0000${configuredMaster.passwordHash}\u0000${String(cur.passwordHash || '')}`
    }
    if (revokeMasterSessions && db.sessions && typeof db.sessions === 'object') {
      for (const [key, session] of Object.entries(db.sessions)) {
        if (session?.userId === cur.id || session?.userId === priorMasterId) delete db.sessions[key]
      }
    }
  }
  if (!Array.isArray(db.orders)) {
    db.orders = []
    changed = true
  }
  if (!db.stock || typeof db.stock !== 'object') {
    db.stock = {}
    changed = true
  }
  if (!db.meta) {
    db.meta = emptyDb().meta
    changed = true
  }
  // P16 (#8) : les démos sont injectées UNE fois, au premier démarrage, puis
  // marquées. Avant, ce `forEach` tournait à chaque lecture : un
  // `DELETE /api/customers/demo-karim` renvoyait 200 et le compte revenait à la
  // requête suivante (le client croyait la suppression faite). Le maître, lui,
  // reste réinjecté : sans lui, plus personne ne peut se connecter au comptoir.
  const demos = demoAccounts()
  if (db.meta.demoSeeded !== true) {
    demos.forEach((d) => {
      if (!db.users.some((u) => u.id === d.id || u.email === d.email)) db.users.push({ ...d })
    })
    db.meta.demoSeeded = true
    changed = true
  }
  // LOT 1.19 — les comptes de démonstration suivent l'environnement, eux aussi.
  //
  // Le seed ne suffit pas : sur une base **déjà constituée** — le cas réel en
  // production, et le cas de n'importe quelle sauvegarde restaurée — les trois
  // comptes existent avec l'empreinte des mots de passe publiés pendant des mois
  // dans le README, les guides et le bundle client. Retirer les littéraux du
  // code ne changerait alors rien pour eux : c'est exactement le constat du lot
  // 1.1 pour le compte maître (« poser MASTER_EMAIL / MASTER_PASSWORD n'aurait
  // rien changé »), et la raison pour laquelle la vérification du lot 0 rappelle
  // qu'un seed n'est écrit que si la base est absente (`ensure()`).
  //
  // Règle, pour un compte TOUJOURS marqué `demo: true` et reconnu par son id ou
  // son e-mail :
  //  · `DEMO_PASSWORD` posé → l'empreinte suit cette valeur, **sauf si elle la
  //    vérifie déjà** : aucune réécriture, donc pas d'écriture disque en boucle,
  //    et une empreinte déjà migrée en scrypt (P22) n'est pas dégradée ;
  //  · `DEMO_PASSWORD` absent → verrouillage (`passwordHash: null`), idempotent.
  // Un compte qui n'est plus marqué `demo` (revendiqué par OAuth, devenu un vrai
  // client) n'est jamais touché.
  const demoPw = demoPassword()
  for (const d of demos) {
    const u = (db.users || []).find(
      (x) => x && x.demo === true && (x.id === d.id || (d.email && x.email === d.email))
    )
    if (!u) continue
    if (d.passwordHash) {
      if (!verifyPass(demoPw, u.passwordHash)) {
        u.passwordHash = d.passwordHash
        changed = true
      }
    } else if (u.passwordHash !== null) {
      u.passwordHash = null
      changed = true
    }
  }
  if (!db.sessions) {
    db.sessions = {}
    changed = true
  }
  // Durcissement des jetons : les clés antérieures au hachage étaient des JETONS
  // BRUTS (48 hex). `findSession` ne les reconnaît plus — les laisser reviendrait
  // à laisser des jetons utilisables dans le fichier et dans chaque backup. La
  // normalisation les supprime (persistée au démarrage et à chaque écriture) ;
  // les comptes concernés se reconnectent une fois.
  for (const key of Object.keys(db.sessions)) {
    if (!SESSION_KEY_RE.test(String(key))) {
      delete db.sessions[key]
      changed = true
    }
  }
  if (!db.oauthPending) {
    db.oauthPending = {}
    changed = true
  }
  // LOT 4.5 (U11) : plus rien ne CRÉE le statut `pending` (héritage d'une
  // version antérieure), mais `GET /api/orders` le remappait en `new` à
  // l'affichage pendant que `PATCH`/`DELETE` travaillaient sur le statut BRUT :
  // une commande legacy apparaissait comme `new` au comptoir, puis ses
  // transitions étaient évaluées depuis `pending`. Le mensonge d'affichage est
  // supprimé (voir la route) et les lignes legacy sont migrées ici, une fois
  // pour toutes — après quoi `pending` n'existe plus nulle part en base.
  //
  // LOT 4.4 (R20), migration volontairement ABSENTE : marquer rétroactivement
  // `claimable: false` toute commande guest au numéro d'un compte existant
  // masquerait aussi les commandes passées par ce client AVANT son
  // inscription — le cas légitime que la règle à la création préserve. Rien ne
  // permet de les distinguer (les comptes ne portent pas de date de création,
  // et les lignes legacy non plus) : on ne réécrit donc pas l'historique. La
  // règle s'applique à la création (`placeOrder`, route `POST /api/orders`) ;
  // les lignes antérieures au correctif gardent le comportement d'alors.
  if (Array.isArray(db.orders) && db.orders.length) {
    for (const o of db.orders) {
      if (o && o.status === 'pending') {
        o.status = 'new'
        changed = true
      }
    }
  }
  // LOT 8.2 (A2) : entrées orphelines — un id présent dans `db.stock` ou
  // `productOverrides` mais absent du catalogue (produit retiré de `src/data.js`,
  // migration, restauration de sauvegarde). Sans purge, ces clés alimentaient le
  // seul chemin qui permettait encore de commander un produit inconnu : le
  // contrôle de stock les trouvait disponibles et `priceOf` les tarifait 0 DA.
  const orphan = purgeOrphanCatalogRefs(db)
  if (orphan.purged.length) {
    console.warn(
      `[pcstar-db] ${orphan.purged.length} entrée(s) orpheline(s) purgée(s) — id absent du catalogue : ${orphan.purged.join(', ')}`
    )
    changed = true
  }
  // P13 (S3) : clés internes de transit — elles n'ont rien à faire dans la base
  // persistante. `_lastAuth` contenait un TOKEN DE SESSION valide, recopié tel
  // quel dans chaque backup de store.json. `_err` empoisonnait les inscriptions
  // suivantes. Retirées de l'état en mémoire ET avant toute persistance.
  if (stripInternalKeys(db)) changed = true
  // P5 (B11) : bornes de croissance — sessions > 7 j, consentements OAuth
  // abandonnés > 15 min.
  if (purgeExpired(db)) changed = true
  return changed
}

/** Empreinte du fichier : mtime + taille. `null` si absent/illisible. */
function statOf() {
  try {
    const st = fs.statSync(DB_FILE)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
}

function sameStat(a, b) {
  return Boolean(a && b && a.mtimeMs === b.mtimeMs && a.size === b.size)
}

/** Lecture disque réelle : parse + normalisation **en mémoire**. */
function readDbFromDisk() {
  ensure()
  let db
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8')
    db = JSON.parse(raw)
  } catch (err) {
    // Base corrompue (écriture tronquée, disque plein…) : on ne l'écrase PAS
    // silencieusement. On la quarantaine pour diagnostic, on log, et on repart
    // propre. C'est la seule écriture qu'une LECTURE puisse encore provoquer —
    // et elle sauvegarde d'abord l'état illisible.
    const backup = quarantineDb()
    console.error('[pcstar-db] store.json illisible — base réinitialisée.', {
      reason: String(err && err.message ? err.message : err),
      backup: backup || null
    })
    db = emptyDb()
    normalizeDb(db)
    writeDb(db)
    return db
  }
  // P13 (S3) : clés internes de transit présentes SUR DISQUE — `_lastAuth`
  // contient un TOKEN DE SESSION valide, recopié tel quel dans chaque backup.
  //
  // Durcissement des jetons : même traitement pour une clé de session qui n'est
  // pas une empreinte sha256 — c'est un JETON BRUT (état antérieur au
  // durcissement), donc exactement le même risque. Sans purge immédiate, un
  // `npm run backup` pris avant la prochaine écriture recopierait des jetons
  // utilisables (y compris celui du maître).
  const polluted =
    Object.prototype.hasOwnProperty.call(db, '_lastAuth') ||
    Object.prototype.hasOwnProperty.call(db, '_err') ||
    Object.keys(db?.sessions || {}).some((k) => !SESSION_KEY_RE.test(String(k)))
  const changed = normalizeDb(db)
  // LOT 3.2 (B2) : la normalisation courante (seed, synchronisation du maître,
  // sessions expirées) n'est persistée qu'UNE fois par processus — au démarrage
  // (`initDb`) ou, à défaut, au premier accès (Vercel serverless n'a pas de
  // phase de démarrage). Les GET suivants ne touchent plus au disque.
  //
  // Exception assumée : un fichier pollué par une clé interne est purgé SANS
  // attendre. C'est une question de sécurité (un `npm run backup` pris dans
  // l'intervalle recopierait le token), et c'est rare — en régime normal ces
  // clés ne vivent que le temps d'un `updateDb`, qui ne les persiste pas.
  if (polluted || (changed && !initialized)) writeDb(db)
  return db
}

/**
 * LOT 3.2 (B3) — lecture de l'état, avec cache mémoire invalidé par `statSync`.
 *
 * Ne retourne PAS une copie : les handlers qui normalisent en lisant
 * (`ensureStock`, `migrateNeeds`) modifient l'état en mémoire, ce qui est
 * idempotent et sera persisté par la prochaine écriture. Toute mutation à
 * persister passe par `updateDb`/`writeDb`.
 */
export function readDb() {
  const st = statOf()
  if (cache.db && sameStat(cache.stat, st)) {
    cache.hits += 1
    return cache.db
  }
  cache.reads += 1
  const db = readDbFromDisk()
  cache.stat = statOf()
  cache.db = db
  lastGood.at = Date.now()
  lastGood.db = db
  return db
}

/**
 * LOT 3.2 (B2) — à appeler au démarrage du serveur : crée le fichier s'il
 * manque, normalise et **persiste une fois** (seed des démos, synchronisation du
 * maître, purge des sessions expirées, clés internes). Idempotent.
 */
export function initDb() {
  const db = readDbFromDisk()
  initialized = true
  cache.stat = statOf()
  cache.db = db
  lastGood.at = Date.now()
  lastGood.db = db
  return db
}

/** Diagnostics : cache, compteurs de lecture/écriture, dernière lecture réussie. */
export function dbCacheStats() {
  return {
    cached: Boolean(cache.db),
    hits: cache.hits,
    reads: cache.reads,
    writes: cache.writes,
    stat: cache.stat ? { ...cache.stat } : null,
    lastGoodAt: lastGood.at || null
  }
}

/** Vide le cache et l'état d'initialisation — tests et changement de base. */
export function resetDbCache() {
  cache.stat = null
  cache.db = null
  cache.hits = 0
  cache.reads = 0
  cache.writes = 0
  lastGood.at = 0
  lastGood.db = null
  initialized = false
}

/**
 * P13 (S3) : retire les clés de transit posées sur l'objet base par les
 * handlers. @returns {boolean} true si une clé a été retirée.
 */
export function stripInternalKeys(db) {
  let changed = false
  for (const key of ['_lastAuth', '_err']) {
    if (db && Object.prototype.hasOwnProperty.call(db, key)) {
      delete db[key]
      changed = true
    }
  }
  return changed
}

/**
 * LOT 8.2 (A2) — purge des références catalogue orphelines.
 *
 * Une entrée de `db.stock` ou de `db.meta.productOverrides` dont l'id n'existe
 * ni dans le catalogue de base (`PRODUCTS`) ni parmi les produits créés par le
 * maître (`meta.extraProducts`) est morte : aucun écran ne l'affiche, aucune
 * fiche ne la porte. Elle n'est pourtant pas inoffensive — `liveStockOf`
 * renvoyait sa quantité et `placeOrder` acceptait la ligne en la tarifant
 * **0 DA** (`priceOf` → `null`, reproduit à l'audit avec `produit-fantome`).
 *
 * Trois chemins réalistes produisent ces clés : un id renommé/retiré dans
 * `src/data.js` (précédent réel : `cpu-5600` et `mag-ddr4-16`, supprimés au
 * lot P21), une migration partielle, la restauration d'une sauvegarde prise
 * sur une version antérieure du catalogue.
 *
 * Règle de prudence : si `meta.extraProducts` est présent mais illisible
 * (ni tableau ni `null`), on ne purge **rien** — impossible alors de
 * distinguer un orphelin d'un produit maître, et effacer un stock légitime est
 * pire que laisser une clé morte. Le cas est signalé dans la valeur de retour.
 *
 * @returns {{purged: string[], skipped: boolean}} ids retirés, préfixés du champ
 */
export function purgeOrphanCatalogRefs(db) {
  const extras = db?.meta?.extraProducts
  if (extras != null && !Array.isArray(extras)) return { purged: [], skipped: true }
  const known = new Set(PRODUCTS.map((p) => String(p.id)))
  for (const p of extras || []) if (p && p.id != null) known.add(String(p.id))
  const purged = []
  const clean = (obj, field) => {
    for (const key of Object.keys(obj)) {
      if (known.has(String(key))) continue
      delete obj[key]
      purged.push(`${field}:${key}`)
    }
  }
  if (db?.stock && typeof db.stock === 'object' && !Array.isArray(db.stock)) clean(db.stock, 'stock')
  const ov = db?.meta?.productOverrides
  if (ov && typeof ov === 'object' && !Array.isArray(ov)) clean(ov, 'productOverrides')
  return { purged, skipped: false }
}

/** Durées appliquées à la lecture comme à la purge persistée. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PENDING_TTL_MS = 15 * 60 * 1000

/**
 * Une session malformée ou plus vieille que le TTL ne doit jamais authentifier
 * une requête. Cette vérification est volontairement utilisable sans mutation :
 * le chemin Neon peut ainsi refuser un ancien jeton dès sa première lecture,
 * avant que la prochaine écriture ne purge l'entrée JSONB.
 */
export function isSessionExpired(session, now = Date.now()) {
  return !session || !Number.isFinite(session.at) || now - session.at > SESSION_TTL_MS
}

/** Même règle pour un état OAuth abandonné. */
export function isOAuthPendingExpired(pending, now = Date.now()) {
  return !pending || !Number.isFinite(pending.createdAt) || now - pending.createdAt > PENDING_TTL_MS
}

/**
 * P5 (B11) : purge les sessions expirées (> 7 jours) et les entrées
 * `oauthPending` orphelines (consentement abandonné, > 15 min).
 * @returns {boolean} true si quelque chose a été supprimé
 */
export function purgeExpired(db) {
  const now = Date.now()
  let changed = false
  for (const [key, s] of Object.entries(db.sessions || {})) {
    if (isSessionExpired(s, now)) {
      delete db.sessions[key]
      changed = true
    }
  }
  for (const [st, p] of Object.entries(db.oauthPending || {})) {
    if (isOAuthPendingExpired(p, now)) {
      delete db.oauthPending[st]
      changed = true
    }
  }
  return changed
}

/** Déplace un store.json illisible sous .corrupt-<stamp> (garde les MAX derniers). */
function quarantineDb() {
  if (!fs.existsSync(DB_FILE)) return null
  // Horodatage + aléatoire : deux corruptions la même milliseconde ne doivent
  // pas s'écraser l'une l'autre.
  const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const dest = `${DB_FILE}.corrupt-${stamp}`
  try {
    fs.copyFileSync(DB_FILE, dest)
    const stale = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('store.json.corrupt-'))
      .sort()
    while (stale.length > MAX_CORRUPT_BACKUPS) fs.unlinkSync(path.join(DATA_DIR, stale.shift()))
    return dest
  } catch {
    return null
  }
}

export async function readDbAsync() {
  if (!process.env.DATABASE_URL) return readDb()
  const { readNeonState, updateNeonState } = await import('./neonStore.js')
  const db = await readNeonState(emptyDb)
  // Le driver Neon ne passe pas par `readDbFromDisk()`. Si sa lecture révèle
  // une expiration, une rotation maître ou une structure héritée, persister la
  // normalisation tout de suite SOUS le verrou de ligne. Il faut relire dans le
  // verrou (et non écrire `db` tel quel), sinon une mutation concurrente entre
  // SELECT et UPDATE pourrait être écrasée par cette lecture de maintenance.
  if (!normalizeDb(db)) return db
  return updateNeonState((current) => {
    normalizeDb(current)
    return current
  }, emptyDb)
}

/**
 * P12 (B25) : lecture d'état qui n'échoue JAMAIS.
 *
 * Une base distante injoignable (compute Neon suspendu, branche d'aperçu
 * supprimée, `DATABASE_URL` copié sur l'endpoint direct au lieu du `-pooler`,
 * IP allowlist…) faisait remonter une exception jusqu'au handler → 500 sur
 * `/api/catalog` → le front lisait « catalogue vide = vérité » → **boutique
 * sans aucun produit**. Les lectures publiques replient donc sur l'état de
 * base (catalogue statique, aucun override) et signalent `ok: false` pour que
 * l'UI le dise au lieu de le cacher.
 *
 * Les ÉCRITURES restent strictes (`updateDbAsync`) : on ne doit jamais faire
 * croire qu'une commande ou un stock a été enregistré alors que la base était
 * injoignable.
 *
 * @returns {Promise<{db: object, ok: boolean, driver: 'neon'|'file', error: string|null}>}
 */
export async function readDbSafe() {
  const driver = process.env.DATABASE_URL ? 'neon' : 'file'
  try {
    if (driver === 'neon') {
      // Reprend le chemin qui normalise ET persiste l'état expiré sous verrou.
      // Une lecture de secours ne doit pas offrir un cycle de vie moins strict
      // que l'authentification ou le callback OAuth.
      const db = await readDbAsync()
      lastGood.at = Date.now()
      lastGood.db = db
      return { db, ok: true, driver, error: null, asOf: lastGood.at, source: 'db' }
    }
    const db = readDb()
    return { db, ok: true, driver, error: null, asOf: lastGood.at || Date.now(), source: 'db' }
  } catch (error) {
    const message = String((error && error.message) || error)
    // LOT 3.16 (B19) : le repli est désormais DATÉ et SOURCÉ. Avant, une base
    // injoignable servait `emptyDb()` — le catalogue statique du build — sans
    // aucune indication d'âge : l'utilisateur voyait des prix dont personne ne
    // pouvait dire s'ils dataient de cinq secondes ou de trois mois.
    //
    // Deux replis, dans l'ordre :
    //  · `cache` — la dernière lecture réussie de CE processus (`lastGood`),
    //    avec son horodatage : c'est l'état le plus proche de la vérité ;
    //  · `static` — aucune lecture n'a jamais réussi (démarrage base morte) :
    //    catalogue de base du build, `asOf: null` dit « âge inconnu ».
    //
    // Dans les deux cas `ok: false` → les réponses gardent `degraded: true` et
    // les ÉCRITURES restent strictes (`updateDbAsync` lève) : jamais faire
    // croire qu'une commande a été enregistrée.
    const fromCache = Boolean(lastGood.db)
    console.error('[pcstar-db] lecture d\'état échouée — repli.', {
      driver,
      message,
      fallback: fromCache ? 'cache' : 'static',
      asOf: fromCache ? new Date(lastGood.at).toISOString() : null,
      hint: driver === 'neon' ? 'Vérifier DATABASE_URL (endpoint -pooler, branche existante, compute non suspendu).' : null
    })
    const db = fromCache ? { ...lastGood.db } : emptyDb()
    return {
      db,
      ok: false,
      driver,
      error: message,
      asOf: fromCache ? lastGood.at : null,
      source: fromCache ? 'cache' : 'static'
    }
  }
}

/**
 * P12 (B25) : diagnostics lisibles de `DATABASE_URL` — SANS le mot de passe.
 * Sert à `/api/db/status` et à `npm run db:doctor` pour distinguer
 * « base injoignable » de « base vide ».
 */
export function dbUrlDiagnostics(rawUrl = process.env.DATABASE_URL) {
  if (!rawUrl) return { configured: false }
  try {
    const u = new URL(rawUrl)
    const host = u.hostname
    const firstLabel = host.split('.')[0] || ''
    return {
      configured: true,
      host,
      user: u.username || null,
      database: u.pathname.replace(/^\//, '') || null,
      // Le driver HTTP `neon()` ne parle qu'au pooler : `ep-xxx-pooler.<region>…`.
      // L'endpoint direct accepte uniquement le Pool TCP (`updateNeonState`) →
      // les lectures tombent alors que les écritures passent.
      pooler: firstLabel.endsWith('-pooler'),
      // Id d'endpoint sans le suffixe -pooler (ex: ep-cool-meadow-123456).
      endpoint: firstLabel.replace(/-pooler$/, '') || null,
      // ep-xxx-pooler.<region>.aws.neon.tech → « eu-central-1 »
      region: host.split('.')[1] || null,
      sslmode: u.searchParams.get('sslmode') || null
    }
  } catch {
    return { configured: true, parseError: true }
  }
}

export async function updateDbAsync(mutator) {
  if (!process.env.DATABASE_URL) return updateDb(mutator)
  const { updateNeonState } = await import('./neonStore.js')
  // Même invariant que `updateDb()` fichier : le mutateur reçoit toujours un
  // état normalisé. Sous Neon, cette passe s'exécute DANS le verrou de ligne et
  // est donc persistée avec la mutation, y compris les sessions/états OAuth
  // expirés qui auraient survécu à une ancienne version.
  return updateNeonState((db) => {
    normalizeDb(db)
    return mutator(db) || db
  }, emptyDb)
}

/** Dort `ms` sans boucle active (le verrou est tenu quelques millisecondes). */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* dernier recours si Atomics est indisponible */
    }
  }
}

/**
 * LOT 3.2 (B1) — verrou fichier inter-processus autour du read-modify-write.
 *
 * `fs.openSync(…, 'wx')` est atomique : un seul processus obtient le fichier de
 * verrou. Attente bornée (`LOCK_TIMEOUT_MS`) puis écriture sans verrou plutôt
 * que blocage infini — une base dégradée vaut mieux qu'une base figée, et le
 * message est tracé. Un verrou orphelin (processus tué sans `finally`) est
 * repris après `LOCK_STALE_MS`.
 *
 * @param {(locked: boolean) => any} fn exécuté avec le verrou (ou sans, si
 *   l'attente a expiré / le système de fichiers ne le permet pas).
 */
function withDbLock(fn) {
  ensure()
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let locked = false
  for (;;) {
    try {
      const fd = fs.openSync(DB_LOCK_FILE, 'wx')
      try {
        fs.writeSync(fd, `${process.pid}:${Date.now()}`)
      } finally {
        fs.closeSync(fd)
      }
      locked = true
      break
    } catch (err) {
      // Autre chose que « existe déjà » (FS sans création possible, /tmp
      // read-only…) : on écrit sans verrou plutôt que de tout bloquer.
      if (!err || err.code !== 'EEXIST') break
      let stale = false
      try {
        stale = Date.now() - fs.statSync(DB_LOCK_FILE).mtimeMs > LOCK_STALE_MS
      } catch {
        stale = true // le verrou vient de disparaître : on retente tout de suite
      }
      if (stale) {
        try {
          fs.unlinkSync(DB_LOCK_FILE)
        } catch {
          /* un autre processus l'a déjà repris */
        }
        continue
      }
      if (Date.now() >= deadline) break
      sleepSync(10)
    }
  }
  if (!locked) {
    console.error('[pcstar-db] verrou d\'écriture non obtenu — écriture sans verrou.', {
      lockFile: DB_LOCK_FILE,
      timeoutMs: LOCK_TIMEOUT_MS
    })
  }
  try {
    return fn(locked)
  } finally {
    if (locked) {
      try {
        fs.unlinkSync(DB_LOCK_FILE)
      } catch {
        /* déjà repris par un autre processus */
      }
    }
  }
}

/**
 * Écriture atomique **et durable** : tmp → `fsync` → rename (même FS) → `fsync`
 * du répertoire — un crash ne peut pas laisser un store.json tronqué (lot 3.2),
 * et une coupure d'alimentation ne peut plus publier un nom dont les blocs ne
 * sont pas écrits (LOT 8.7 / A7).
 *
 * LOT 3.2 (B2) : l'état persisté est normalisé (structure, purge des entrées
 * expirées, clés internes de transit retirées). C'est le pendant de la
 * normalisation en mémoire de `readDb` : la propreté du disque est garantie au
 * démarrage et à chaque écriture, jamais pendant une lecture.
 *
 * L'objet de l'appelant n'est pas amputé de `_lastAuth` — les handlers le
 * lisent juste après l'écriture (token de la session créée).
 */
export function writeDb(db) {
  ensure()
  const clean = { ...db }
  delete clean._lastAuth
  delete clean._err
  normalizeDb(clean)
  // LOT 8.7 (A7) : durableWriteFileSync(DB_TMP_FILE) → fsync → rename(DB_FILE)
  // → fsync(DATA_DIR). Le fichier publié a ses octets au disque, et l'entrée de
  // répertoire qui le nomme aussi.
  atomicDurableWriteFileSync(DB_FILE, JSON.stringify(clean, null, 2), { tmp: DB_TMP_FILE })
  initialized = true
  cache.writes += 1
  cache.stat = statOf()
  cache.db = clean
  lastGood.at = Date.now()
  lastGood.db = clean
  return clean
}

/**
 * LOT 3.2 (B1) — read-modify-write sous verrou, sur une lecture FRAÎCHE.
 *
 * Avant : `readDb()` (donc, depuis B3, un état potentiellement en cache) puis
 * écriture sans verrou. Deux processus pouvaient lire le même état et écrire
 * chacun le sien : la dernière écriture gagnait, la mutation de l'autre était
 * perdue. Sous Vercel, chaque instance a son propre `/tmp` — le verrou n'y
 * change rien, c'est la divergence entre instances que le lot 4 documente ; ici
 * c'est le multi-process local (deux `npm run dev:api`, un `npm run backup`
 * pendant que le serveur tourne) qui perdait des mutations.
 */
export function updateDb(mutator) {
  return withDbLock(() => {
    const db = readDbFromDisk()
    const next = mutator(db) || db
    writeDb(next)
    return next
  })
}

/** P16 : chemins réels de la base (respecte PCSTAR_DATA_DIR). */
export function dbPaths() {
  return { dbFile: DB_FILE, dataDir: DATA_DIR }
}

export { hashPass, hashPassLegacy, MASTER }

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

export function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * Durcissement demandé hors rapports (15/09) — empreinte d'un jeton de session.
 *
 * `db.sessions` était indexé **par jeton** : les jetons valides, y compris celui
 * du maître, se trouvaient donc en clair dans `store.json` — recopiés tels quels
 * dans chaque backup (`backupStore`, timer 6 h + sauvegardes manuelles) et dans
 * chaque quarantine. Une copie qui fuit (dépôt rendu public, poste partagé,
 * `/tmp` d'une instance Vercel inspecté) donnait des sessions immédiatement
 * utilisables, sans aucun mot de passe à deviner. Ce n'est pas ce que P13/S3
 * visait (la copie `_lastAuth`, elle, a été supprimée au lot 1), mais le risque
 * est le même.
 *
 * Désormais la clé est `sha256(token)` en hex (64 caractères). Le jeton brut
 * n'existe plus que dans la réponse d'authentification et dans le stockage du
 * navigateur. Propriétés conservées :
 *  · recherche O(1) par clé d'objet, sans comparaison de jetons en clair ;
 *  · un jeton est 192 bits aléatoires : son empreinte ne se devine pas et ne se
 *    retourne pas (aucun dictionnaire exploitable, contrairement à un mot de
 *    passe — d'où l'absence de sel, qui rendrait la recherche par clé impossible) ;
 *  · révocation par utilisateur, purge d'expiration et comptage inchangés (ils
 *    parcourent les VALEURS, pas les clés).
 *
 * Conséquence assumée (validée par le commanditaire) : les sessions créées avant
 * ce changement — clés = jetons bruts, 48 hex — ne sont plus reconnues et sont
 * purgées à la normalisation. Tout le monde se reconnecte une fois.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex')
}

/** Une clé de session valide est une empreinte sha256 (64 hex), jamais un jeton. */
const SESSION_KEY_RE = /^[a-f0-9]{64}$/

/**
 * Enregistre une session sous l'empreinte du jeton.
 * @param {object} db état (muté)
 * @param {string} token jeton brut — il n'est PAS stocké
 * @returns {string|null} la clé (empreinte) écrite.
 */
export function putSession(db, token, userId, extra = {}) {
  if (!db || !token) return null
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {}
  const key = hashToken(token)
  db.sessions[key] = { userId, at: Date.now(), ...extra }
  return key
}

/** Crée un jeton, enregistre la session, renvoie le jeton (à retourner au client). */
export function createSession(db, userId, extra = {}) {
  const token = newToken()
  putSession(db, token, userId, extra)
  return token
}

/**
 * Session d'un jeton présenté par un client, ou `null`.
 *
 * AUDIT-2026-09-17 / phase 2 : ne pas déléguer l'expiration à une purge de
 * démarrage. Neon sert l'état JSONB sans passer par le cycle fichier ; sans ce
 * garde, un jeton ancien restait authentifiant indéfiniment. La suppression
 * persistée reste faite par `purgeExpired()` lors de la prochaine écriture.
 */
export function findSession(db, token) {
  if (!db || !token) return null
  const session = db.sessions?.[hashToken(token)] || null
  return isSessionExpired(session) ? null : session
}

/** Déconnexion : retire la session du jeton. @returns {boolean} vrai si retirée. */
export function deleteSession(db, token) {
  if (!db || !token) return false
  const key = hashToken(token)
  if (db.sessions && db.sessions[key]) {
    delete db.sessions[key]
    return true
  }
  return false
}

export function publicUser(u) {
  if (!u) return null
  const { passwordHash, ...rest } = u
  return {
    ...rest,
    links: {
      google: Boolean(u.links?.google),
      meta: Boolean(u.links?.meta),
      googleEmail: u.links?.google?.email || null,
      metaName: u.links?.meta?.name || null
    }
  }
}
