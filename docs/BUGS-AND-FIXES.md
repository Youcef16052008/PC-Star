# PC Star — Bugs trouvés & corrections (audit 10/09/2026)

Audit **ligne par ligne, fichier par fichier** (`src/*`, `server/*`, `api/*`, `scripts/*`,
configs) conduit à **24 bugs** (B1–B24). Tous les bugs de code ont été corrigés en
**5 phases**, chacune = un commit sur la branche `5d6f736` (PR #2), tests verts avant commit.

| Phase | Commit | Bugs | Thème |
|---|---|---|---|
| P1 | `2cda64c` | B1, B3, B13 | Intégrité des données |
| P2 | `a8adb11` | B2, B4, B5, B6, B9, B24 | Cohérence API multi-device |
| P3 | `eece1eb` | B7, B8 | i18n complet (ar/fr/en) |
| P4 | `5d6f736` | B10, B17 | Durcissement Vercel |
| P5 | (cet arbre) | B11, B12, B14, B15, B16, B19, B20, B21 | Mineurs & nettoyage |

L'audit initial et le plan détaillé : [`AUDIT-REPO.md`](./AUDIT-REPO.md).
B18/B22/B23 : jugés **non-bugs** (contraintes de conception démo, documentées).

---

## P1 — Intégrité des données

### B1. Perte totale de la base (silencieuse) 🔴
- **Symptôme** : un crash pendant l'écriture de `store.json` (écriture non atomique)
  tronquait le fichier ; au prochain `readDb()`, la `catch` JSON.parse **écrasait la base
  avec une base vide** — users, commandes, stocks, sessions perdus, sans log ni backup.
- **Fix** (`server/db.js`) :
  1. `writeDb` **atomique** : écriture sur `store.json.tmp` puis `fs.renameSync`
     (renommage atomique sur POSIX) — plus jamais de fichier tronqué.
  2. Récupération **non destructive** : fichier illisible → déplacé en
     `store.json.corrupt-<stamp>` (garde les 3 derniers, pas d'écrasement), log console,
     puis base neuve.
- **Vérif** : tests `dbIntegrity.test.js` (fichier tronqué → quarantainé + base saine ;
  fichier vide ; plafond 3 quarantaines ; roundtrip atomique sans `.tmp` résiduel).
  Preuve live : base tronquée manuellement → service continu + fichier quarantainé.

### B3. Le serveur faisait confiance aux prix du client 🔴
- **Symptôme** : `placeOrder` acceptait `body.total` et `item.price` tels quels →
  un client malveillant (ou trafiqué) pouvait commander à n'importe quel prix.
- **Fix** (`server/catalog.js`) : chaque ligne est **recalculée côté serveur** depuis le
  catalogue (`priceOf(db, id)` — base ou extra produit) ; `total = Σ qty × price`
  recalculé ; `body.total` ignoré. Prix inconnu → refus `stock`.
- **Vérif** : commande avec `total: 1` et prix trafiqués → total recalculé à la bonne
  valeur (test unitaire + preuve live via l'API).

### B13. Suppression client : sessions + commandes orphelines
- **Symptôme** : `DELETE /api/customers/:id` supprimait l'user mais ses tokens de
  session restaient **valides** (accès prolongé), et ses commandes gardaient un
  `userId` orphelin.
- **Fix** (`server/index.js`) : à la suppression, purge de toutes les sessions de cet
  user + `userId: null` dans ses commandes (nom/téléphone déjà snapshotés).
- **Vérif** : token après suppression → 401 (preuve live + test).

---

## P2 — Cohérence API multi-device

### B2. La boutique affichait le catalogue statique en mode API
- **Symptôme** : `App.jsx` utilisait le catalogue `src/data.js` même en mode API →
  produits créés/masqués côté serveur invisibles (et vice versa).
- **Fix** : le **catalogue serveur** (`/api/catalog`, `server/catalog.js`
  `publicCatalog`) est la source de vérité consommée par Boutique/Search/Builder/Master ;
  le catalogue statique reste le fallback **offline uniquement**.
- **Vérif** : test intégration HTTP (création + masquage visible via `/api/catalog`),
  render jsdom (produit serveur affiché, produit masqué absent), mode offline inchangé.

### B24. Le masquage des produits extra (créés par le master) était ignoré
- **Symptôme** : `updateProduct` (branche `extra`) ignorait `patch.hidden` et
  `publicCatalog` ne filtrait pas les extra → impossible de cacher un produit créé.
  *Découvert pendant la validation de B2.*
- **Fix** (`server/masterApi.js` + `server/catalog.js`) : `hidden` écrit dans
  `db.meta.hiddenProductIds` ; `publicCatalog` filtre les extra ; `listMasterProducts`
  retourne le vrai état `hidden`.
- **Vérif** : tests unitaires (hide/unhide extra) + intégration HTTP.

### B4. Aucune gestion d'erreur réseau côté client
- **Symptôme** : `req()` dans `src/api.js` laissait échapper les erreurs de réseau
  (~20 appels) → promesses non gérées, UI gelée/cassée en offline.
- **Fix** : `try/catch` central → `{ ok: false, status: 0, offline: true }` ; flag
  `offline` consommé par le checkout (fallback local), le desk (polling silencieux),
  le logout et l'OAuth.
- **Vérif** : tout le test API passe hors réseau ; pas de console error.

### B5. Toast mensonger « commandes synchronisées »
- **Symptôme** : après un repli local (API échouée), le toast disait
  `ordersSynced` → l'utilisateur pensait que sa commande était au comptoir.
- **Fix** : repli local → toast `ordersLocalOnly` ; `ordersSynced` réservé au vrai
  succès serveur.
- **Vérif** : test de flux (offline → localOnly).

### B6. Échec d'auth serveur → repli sur le login local
- **Symptôme** : en mode API, un 401/429/500 déclenchait le repli sur le store local →
  le login « marchait » en local alors que le serveur avait refusé (comptes divergents).
- **Fix** (`AuthPanel.jsx`) : repli local **uniquement si `r.offline`** (réseau mort) ;
  tout refus serveur affiché (`authErrorAuth`, `authErrorRate` pour le 429 — nouvelle clé).
- **Vérif** : mauvais mot de passe en mode API → erreur, pas de session locale.

### B9. MasterPage en mode API : 3 trous
- **Symptôme** : toasts d'erreur incohérents (`authErrorPassword` pour un échec de
  création) ; `doDeleteCustomer` n'existait qu'en local (l'endpoint serveur existait) ;
  l'UI « panneaux custom » était active en mode API alors que le serveur n'a pas
  d'endpoint panneaux.
- **Fix** (`MasterPage.jsx` + `src/api.js`) : toasts `masterCreateFail`/`masterActionFail` ;
  `api.deleteCustomer(id)` en mode API ; panneaux désactivés + note `panelsLocalOnly`.
- **Vérif** : toasts + suppression client en mode API testés.

---

## P3 — i18n complet (ar/fr/en)

### B7. Avertissements de compatibilité en anglais durci
- **Symptôme** : `checkCompatibility` renvoyait des chaînes anglaises
  (« VRM may run hot… ») mélangées au français/à l'arabe.
- **Fix** : retour `{ key, vars, block }` — **19 clés `compat*`** (ar/fr/en), rendues par
  `t(key, vars)` dans le panier et le builder ; plus aucune chaîne littérale.
- **Vérif** : `compat.i18n.test.js` — 17 avertissements rendus **sans variable résiduelle**
  dans les 3 langues.

### B8. Textes de contenu durcis hors i18n
- **Symptôme** : `STORE.*`, `SHOP_SERVICES.*`, `REVIEWS`, `GUIDES`, `DEALS.notes`,
  `needs` par produit, message WhatsApp, tooltip Stars → anglais durci (AR/FR concernés).
- **Fix** : tout migré en clés i18n (`store*`, `svc*`, `rev*`, `guide*`, `deal*`,
  `needs*`, `waMessage`, `xReviews`) — **89 clés × 3 langues** ; `STORE` garde seulement
  les données brutes (téléphone, adresse, horaires de structure).
- **Vérif** : `i18n.coverage.test.js` — 0 clé manquante sur tout le scan `t('…')`
  statique + dynamique (`cat_*`, `line_*`, `tag_*` inclus) ; render jsdom **ar/fr/en**
  33/33 checks, 0 résidu anglais.

---

## P4 — Durcissement Vercel

### B10. Limites de taille de body sur Vercel (risque prod)
- **Symptôme** : uploads master (photos brutes ~3-4 Mo × 6) dépassaient la limite par
  défaut de Vercel Serverless → 413 en prod alors que ça passait en local.
- **Fix** :
  1. **Compression client** : `src/photoCompress.js` (canvas → JPEG 800 px / q 0.8,
     factories injectables pour tests, passthrough sur erreur) appelé par
     `MasterPage.readFilesAsDataUrls` (création **et** édition) → upload de 6 photos
     ≈ 2 Mo au lieu de ~20 Mo. Limite d'entrée client relevée 2,5 → 10 Mo.
  2. `api/index.js` : `sizeLimit: '10mb'` (aucun endpoint ne renvoie > ~1 Mo).
- **Vérif** : 7 tests unitaires (scale, downscale, passthrough, options, erreurs,
  non-image) ; upload live via l'API (2 photos → 201, fichiers servis).

### B17. Bootstrap CSS en CDN (jsdelivr)
- **Symptôme** : si le CDN est bloqué (prod Algérie / firewall), le site est **sans style**.
- **Fix** : `import 'bootstrap/dist/css/bootstrap.min.css'` dans `main.jsx` (avant
  `index.css`) — le CSS est dans le bundle. `<link>` jsdelivr retiré. Google Fonts reste
  en CDN avec fallback système (toléré par l'audit).
- **Vérif** : 0 référence jsdelivr dans le HTML buildé ; CSS en bundle
  (`dist/assets/index-*.css`).

---

## P5 — Mineurs & nettoyage

### B11. Sessions qui n'expireront jamais
- **Symptôme** : `db.sessions` croissait sans limite (aucune expiration) ;
  `db.oauthPending` gardait les consentements abandonnés pour toujours.
- **Fix** (`server/db.js`) : `purgeExpired(db)` appelé à chaque `readDb()` — sessions
  `at` > 7 j, oauthPending `createdAt` > 15 min, entrées malformées (null / `at` non
  numérique) supprimées ; persistance **seulement si changement** (pas de write inutile).
- **Vérif** : 2 tests (`dbIntegrity.test.js`) : purge directe (TTL + malformées +
  idempotence) et via `readDb()` sur le disque (purge persistée).

### B12. Fichiers photo orphelins `tmp-*`
- **Symptôme** : création de produit avec photos → les photos étaient d'abord
  enregistrées sous l'id `tmp`, puis **ré-enregistrées** sous le vrai id ; les
  fichiers `tmp-*` n'étaient jamais supprimés → fuite disque à chaque création.
- **Fix** (solution « id connu avant ») :
  - `createProduct(db, body, id)` : param `id` optionnel pré-généré + garde de
    collision (`id` déjà utilisé → rejet, pas d'écrasement).
  - Route POST `/api/master/products` (`server/index.js`) : `newId('sku')` généré
    **une fois**, `savePhotoDataUrls(id, …)` écrit **directement sous le vrai id**,
    plus de double-écriture.
  - Échec de création → `unlinkUpload(p)` sur chaque fichier (plus d'orphelins).
  - `UPLOAD_DIR` honore l'env `PCSTAR_UPLOAD_DIR` (tests isolés / déploiements exotiques).
- **Vérif** : `src/uploadFlow.test.js` (7 tests) — id explicite, id auto, collision ;
  bout en bout HTTP : 2 photos → fichiers nommés `<id>-…`, **zéro `tmp-*`**, base
  cohérente ; produit invalide → 400 + **aucun fichier résiduel** ; `unlinkUpload`
  refuse les URLs malformées (pas de `../`).

### B14. Code mort
- **Fix** :
  - `src/icons.jsx` supprimé (jamais importé).
  - `COMPARE_FIELDS` (`data.js`, feature compare retirée) + `photoSkeletonClass`
    (`media.js`) supprimés.
  - `shopStore.js` : `startSms`/`verifySms`/`loginGoogle`/`ACCENTS`/`AVATARS` retirés
    (features absentes de l'UI) ; `updateUser` ne valide plus `avatar`/`accent`
    (jamais rendus par l'UI) ; blocs de tests associés retirés de `shopStore.test.js`
    (tests téléphone/email/master conservés).
  - Variable `left` morte dans `reserve()` (`App.jsx`) retirée.
- **Vérif** : build plus petit (419,7 → 419,35 kB), 0 référence résiduelle (grep).

### B15. Profil : commandes vides en local + formulaire pas re-synchronisé
- **Symptôme** : la carte « Mes commandes » de `ProfilePage` était **toujours vide** en
  mode local (seul le fetch `/api/me/orders` la remplissait) ; le formulaire ne se
  re-synchronisait pas au changement d'utilisateur.
- **Fix** (`ProfilePage.jsx`) :
  - La carte merge `loadOrders()` (localStorage `pcstar-orders`, **filtré
    `userId === user.id`** — les commandes locales stockent déjà `userId`) avec
    l'API (dé-dup par `code`) ; en mode local (ou API refusée) → les locales seules.
  - Le formulaire se re-synchronise (nom/tél/wilaya) **sur `user?.id`** : changement
    de compte = re-synchro ; pendant la saisie = aucune réinitialisation parasite.
- **Vérif** : parcours jsdom profil (commandes locales visibles), test store.

### B16. Flash sombre au premier rendu
- **Symptôme** : `:root` dans `index.css` = thème sombre appliqué avant le JS →
  **flash sombre** pour les utilisateurs en thème clair.
- **Fix** : script **inline** dans `<head>` (`index.html`) qui lit `pcstar-theme`
  (localStorage) + `prefers-color-scheme` et pose `data-theme` + `color-scheme`
  **avant le premier paint** — miroir exact de `resolveTheme()` (pref explicite >
  système > fallback dark).
- **Vérif** : le script est évalué avant toute CSS/JS ; même logique que `resolveTheme`
  (couverture test prefs existante).

### B19. Téléphone master = téléphone démo yacine
- **Symptôme** : le master et le démo `yacine` partageaient `0770650387` → un login
  SMS local sur ce numéro retombait sur le **master** (premier match dans la liste).
- **Fix** : yacine → **`0770650388`** dans les deux sources de vérité
  (`src/shopStore.js` + `server/db.js`) ; le master garde `0770650387`. Les tests de
  chaîne qui usaient ce numéro (carrier djezzy, normalisation) restent valides.
- **Vérif** : nouveau test d'**unicité** des téléphones (seed master+démos : aucun
  doublon, et aucun démo ≠ master ne partage le numéro du master).

### B20. `setQty` borné au stock statique
- **Symptôme** : le max du stepper était `product.stock` (statique du catalogue) ;
  en mode API, si le stock serveur a baissé, le client pouvait mettre plus dans le
  panier que le disponible réel (le serveur bloquait au 409 — gardé — mais UX confuse).
- **Fix** (`App.jsx`) : `max = liveStock(product) + qtyActuelle` — le plafond lit le
  **stock live** (`stockMap`, synchronisé avec l'API) au lieu du `product.stock`.
- **Vérif** : cohérent avec le 409 serveur ; tests panier existants verts.

### B21. Docs datées
- **Fix** :
  - `ARCHITECTURE.md` §2 : la claim « hash fragments (`#search`, `#builder`) pour le
    SEO/sitemap » était **fausse** — le site navigue par état, **0 `location.hash`**
    dans `src/`. Corrigé : navigation par état, pas de hash.
  - `PROBLEMS-SOLUTIONS.md` entrée 20 : la citation « §7 » s'est révélée **valide**
    (DEPLOY-VERCEL.md §7 « Limites honnêtes (sans base cloud) » existe et correspond)
    → laissée telle quelle (seule la claim §2 était obsolète).
- **Vérif** : grep `location.hash` / `#search` / `#builder` dans `src/` → 0 occurrence.

---

## Juges non-bugs (documentés, pas de code)

- **B18** — Mode local : les décrets de stock sont en mémoire (`stockMap`) → perdus au
  rechargement (les réservations locales sont persistées, pas le stock). Contrainte de
  conception du fallback offline, pas un défaut.
- **B22** — Identifiants master/démo présents dans le bundle client et le serveur.
  Conception démo assumée et documentée (`DEPLOY-VERCEL.md`) ; à retirer pour une prod
  réelle.
- **B23** — Historique des commandes plafonné à 500 (`server/catalog.js`). En Vercel
  `/tmp` est éphémère de toute façon (documenté dans `DEPLOY-VERCEL.md`).

## « Invalides » écartés pendant l'audit

- Alerte socket du builder → déjà i18n (`t('toastSocket')`).
- Labels CATEGORIES / PART_LINES → déjà rendus via `t('cat_…')` / `t('line_…')`.
- Stock des produits créés par le master → `createProduct` appelle déjà `setStock`.
- Citation « §7 » de `PROBLEMS-SOLUTIONS.md` → valide (voir B21).

---

## Vérification finale (cumulée, P5)

- `npm test` → **71/71 OK** (node:test — 11 fichiers ; P5 ajoute `uploadFlow.test.js`
  + tests purge B11 + unicité téléphones B19).
- `npm run build` → OK, **419,35 kB JS / 125,14 kB gzip** (code mort retiré), CSS en
  bundle, 0 ref jsdelivr.
- `npm run smoke` (e2e live) → OK.
- Render jsdom ar/fr/en → 0 erreur, 0 résidu anglais.
