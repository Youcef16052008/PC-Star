# PC Star — Bugs trouvés & corrections (audit 10/09/2026)

Audit **ligne par ligne, fichier par fichier** (`src/*`, `server/*`, `api/*`, `scripts/*`,
configs) conduit à **24 bugs** (B1–B24). Tous les bugs de code ont été corrigés en
**5 phases**, chacune = un commit sur la branche `5d6f736` (PR #2), tests verts avant
commit. Une **6e phase (P6)** a traité les 7 bugs reportés en conditions réelles le
11/09 (C1–C7) + les fuites i18n trouvées au passage.

| Phase | Commit | Bugs | Thème |
|---|---|---|---|
| P1 | `2cda64c` | B1, B3, B13 | Intégrité des données |
| P2 | `a8adb11` | B2, B4, B5, B6, B9, B24 | Cohérence API multi-device |
| P3 | `eece1eb` | B7, B8 | i18n complet (ar/fr/en) |
| P4 | `5d6f736` | B10, B17 | Durcissement Vercel |
| P5 | `823df13` | B11, B12, B14, B15, B16, B19, B20, B21 | Mineurs & nettoyage |
| P6 | (11/09) | C1–C7 | Bugs terrain & gestion des commandes |
| P7 | (11/09) | P7-1 → P7-18 | 2ᵉ audit complet : bugs identifiés + solutions conçues (**non implémentés**) |

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

## P6 — Bugs terrain & gestion des commandes (report utilisateur, 11/09)

Sept comportements signalés en conditions réelles. Analyse ligne par ligne, corrections
ciblées, chaque flux re-vérifié **en live** (API réelle) et en E2E jsdom (Vite + API).

### C1. « Masquer un produit » → Échec, et produit disparu de la vue master 🔴
- **Diagnostic** : le hide serveur fonctionnait (vérifié live, produit extra ET
  catalogue), MAIS la liste master de `MasterPage` était le **catalogue public**
  (filtré) : après masquage, le produit **disparaissait définitivement** de la vue —
  impossible de le réafficher. Et quand l'API est momentanément injoignable, le toast
  disait « Action échouée » sans distinguer offline / refus serveur.
- **Fix** :
  - `MasterPage` (mode API) charge `/api/master/products` (`listMasterProducts`) :
    **tous** les produits, masqués et rupture inclus, avec le drapeau `hidden`.
  - Bouton **Masquer ↔ Afficher** (toggle) — le produit masqué reste visible
    (opacité réduite + badge) et se réaffiche d'un clic.
  - Toasts honnêtes : `offline` → « backend hors ligne », sinon l'erreur action.
- **Vérif** : E2E jsdom mode API réel — masquer → toast « Produit masqué » → produit
  toujours visible avec « Afficher » → réaffichage « Produit de nouveau visible » ;
  curl live sur produit extra ET catalogue ; tests HTTP existants (B24) toujours verts.

### C2. Panneaux : « sauvegardés en local uniquement (indisponible avec le serveur) »
- **Diagnostic** : en mode API, les toggles/panneaux custom n'écrivaient que le
  localStorage local — invisibles sur les autres appareils (le schéma serveur
  `db.meta.extraPanels/hiddenPanelIds` existait déjà mais aucun endpoint).
- **Fix** :
  - Serveur : `PUT /api/master/panels` (master only, validation de shape, borné 12
    panneaux) — n'écrit que `extraPanels` + `hiddenPanelIds` (ne peut pas écraser les
    clés produit du meta).
  - `App` : au démarrage (mode API), `GET /api/meta` → les clés panneaux serveur sont
    mergées dans le meta local → le shop est **cohérent multi-appareils**.
  - `MasterPage` : toggle + création de panneau passent par `PUT /api/master/panels`
    (repli local si offline) ; l'alerte « local uniquement » est retirée.
- **Vérif** : 3 tests HTTP (403 non-master, 400 shape invalide, persistance lisible via
  `/api/meta` + non-écrasement du meta produit) ; E2E jsdom : toggle sans alerte.

### C3. Bouton WhatsApp « ne marche pas » / contact
- **Diagnostic** : les liens `wa.me` étaient au bon format international, MAIS le
  bouton WhatsApp du **desk n'existait qu'au statut « prêt »** — sur une commande
  « neuve »/« préparation » il n'y avait aucun bouton (d'où « ne marche pas »).
- **Fix** :
  - `DeskPage` : bouton WhatsApp **sur tous les statuts actifs** (neuve, préparation,
    prêt) ; message adapté au statut (`deskWaReady` / `deskWaContact` nouveau).
  - Normalisation robuste du numéro (`0X…`, `+213…`, `213…`, 9 chiffres) — plus
    jamais d'URL `wa.me` invalide.
  - Liens footer/panier/PDP/builder inchangés (déjà valides) — le `target="_blank"`
    peut être bloqué dans certains iframes de preview : dans un navigateur normal il
    ouvre WhatsApp directement.
- **Vérif** : E2E + curl : URL générée valide pour chaque format de téléphone.

### C4. Config PC confirmée → « disparaît » du panier, impossible de la revoir
- **Diagnostic** : le flux builder → panier est **correct** (reproduit jsdom : les
  pièces atterrissent bien au panier). Le vrai problème : après **confirmation**
  (réservation), le panier est vidé (normal) mais il n'y avait **aucun endroit** pour
  retrouver, annuler ou suivre sa commande (hors compte connecté, profil).
- **Fix** :
  - Écran de confirmation : bouton **« Voir mes commandes »** → profil (section
    commandes).
  - `ProfilePage` : bouton **Annuler** sur chaque commande « neuve » (stock rétabli) —
    API : nouveau `POST /api/me/orders/:code/cancel` (sa commande uniquement, état
    `new`/`pending` seulement → 404 sinon, 409 si déjà en préparation) ; local :
    statut + rétablissement du stock local.
  - Modifier = annuler + re-commander (comportement honnête, pas de mutation partielle
    d'une réservation).
- **Vérif** : 2 tests HTTP (annulation propre + restock, refus autrui/preparing) ;
  curl live : stock 10 → 9 → annulation → 10.

### C5. Desk : « préparé / prêt au retrait / annuler » → « Mise à jour impossible »
- **Diagnostic** : les endpoints `PATCH /api/orders/:code` et
  `POST /api/orders/:code/cancel` fonctionnaient (vérifiés live) ; l'échec venait du
  même motif que C1 — API momentanément injoignable sans message distinct.
- **Fix** : toasts d'erreur distincts (offline vs refus) sur tout le desk et la vue
  master ; re-vérification live des 3 transitions (preparing → ready → cancelled) +
  restock.
- **Vérif** : curl live complet ; E2E.

### C6. Rupture (stock 0) → invisible au client, visible au master
- **Diagnostic** : les produits à stock 0 restaient affichés (bouton « Rupture »
  désactivé) — l'utilisateur veut qu'ils **disparaissent** de la boutique.
- **Fix** :
  - Serveur : `publicCatalog` **filtre le stock live = 0** (`listMasterProducts` et le
    desk ne sont pas affectés — le master les voit toujours).
  - Client (mode local) : même filtre sur le catalogue client (stock live local).
  - `MasterPage` : vue complète non filtrée (prop `masterCatalog`) + vue API complète.
  - Garde-fou PDP : si le produit sort du catalogue pendant la visite, la dernière
    référence est conservée (page pas vidée).
- **Vérif** : `speakers` (stock 0 de base) absente du public, présente côté master
  (curl + jsdom) ; test HTTP : produit créé stock 1 → visible, stock 0 → invisible
  (public) mais toujours en vue master. Smoke : catalogue 249 (250 − speakers).

### C7. Numéro de produit (SKU) à la création
- **Fix** : champ **« Numéro produit / SKU »** (optionnel) dans le formulaire de
  création master — API (`createProduct` déjà prêt : `body.sku`) ET local
  (`addProduct` accepte désormais `sku`, sinon SKU généré `PS-…`).
- **Vérif** : curl live (création `HDMI-15M` → SKU conservé) ; test unitaire local.

### Fuites i18n corrigées au passage
- `ProductPage` : message WhatsApp durci en anglais → `t('pdpWaMsg', …)`.
- `BuilderPage` : textes « Copier la config » / « Partager » (clipboard + wa.me)
  → `t('buildCopyMsg')` / `t('buildShareMsg')`.
- **14 nouvelles clés × ar/fr/en** (masquer/afficher, SKU, annulation, WhatsApp desk,
  voir mes commandes, messages builder/PDP) — test de couverture i18n : 0 clé manquante.

### Vérification finale P6
- `npm test` → **75/75** (4 nouveaux : rupture, auto-annulation, panneaux, SKU).
- `npm run build` → OK (425,31 kB JS / 126,62 kB gzip).
- `npm run smoke` (live) → OK, catalogue 249.
- E2E jsdom **mode API réel** (Vite live + API live) : login master → 254 produits en
  vue master (masqués/rupture inclus) → masquer/réafficher → panneaux synchronisés
  sans alerte ; builder → panier régression (6 pièces) ; boutique offline : rupture
  masquée.

## P7 — 2ᵉ audit (11/09/2026) : bugs identifiés, solutions conçues

Nouveau passage **ligne par ligne, fichier par fichier** (`src/*`, `server/*`,
configs, scripts) après la P6. **18 bugs** identifiés et hiérarchisés, chacun avec
sa solution conçue — **aucun n'est implémenté** (sur demande : trouver les bugs
+ leurs solutions, pas les corriger). Les références `fichier:ligne` pointent le
commit `7e9b5e7`.

Priorité : 🔴 = intégrité de données / argent / vie privée · 🟠 = justesse
opérationnelle · 🟡 = robustesse · ⚪ = cosmétique / contrainte documentée.

### 🔴 P7-1. Vue master ignorée par les overrides — affichage obsolète + édition destructrice
- **Où** : `server/masterApi.js:28` (`listMasterProducts`).
- **Mécanisme** : la liste master ne merge pas `db.meta.productOverrides` sur les
  produits du catalogue de base. Après `PUT /api/master/products/:id` (prix, nom,
  stock, photos), le **catalogue public applique l'override** mais la liste master
  continue d'afficher la valeur de base. **Reproduit en live** : `PUT price=99999`
  → public = 99999, master = 24500. Conséquence grave : le panneau « Éditer les
  photos » (`src/MasterPage.jsx:164`) charge `p.photos` de cette liste **obsolète**
  ; si le master retire une photo et sauvegarde, `updateProduct({photos})`
  **remplace les photos uploadées par les photos de base moins une** → perte des
  photos que voient les clients.
- **Solution** : dans `listMasterProducts`, pour chaque produit de base :
  `const ov = db.meta.productOverrides?.[p.id] || {}` puis
  `{ ...p, ...ov, stock: liveStockOf(db, p.id), hidden, source: 'catalog' }`
  (idempotent, aligne la vue master sur le public + flags). Test de régression :
  `PUT` prix/override → `GET /api/master/products` renvoie la valeur override ;
  le panneau photos master doit afficher les photos uploadées.

### 🔴 P7-2. Panier : échec API 429/5xx → repli local silencieux + code de commande en collision
- **Où** : `src/App.jsx:626` (`reserve()`), repli local ~L663-690.
- **Mécanisme** : après `api.postOrder`, seuls `r.ok` et `409/stock` traitent ;
  un **429** (rate-limit : 15 cmd/min par IP — partagé entre l'iframe de preview,
  le navigateur du user et le comptoir en local !) ou un **5xx** tombe dans le
  repli local : la commande est créée **uniquement dans le navigateur** —
  invisible au shop, jamais préparée. Pire, le code local
  `makeOrderCode(new Date(), reservations.length + 1)` (L690) recalcule la
  séquence depuis la liste **client** : un client en API mode a `reservations`
  vide → code `PS-<jour>-0001`, **identique au 1ᵉʳ code du jour côté serveur**
  → annulation/`PATCH` par code pourrait viser la mauvaise commande.
- **Solution** : (1) ne replier sur le local **que si `r.offline === true`** ;
  sinon toast explicite et garder le panier : 429 → « Trop de commandes,
  réessayez dans N s » (`r.data.retryAfter`), 5xx → « Serveur momentanément
  indisponible » ; (2) code local in-collidable : préfixe `PSL-<jour>-<seq>`
  ou dériver la séquence du max des codes du jour déjà présents (client +
  serveur), jamais `length + 1`.

### 🔴 P7-3. Formulaire de retrait non réinitialisé au logout (PII entre comptes)
- **Où** : `src/App.jsx:438` (effet `[authId]`).
- **Mécanisme** : `if (!user) return` — à la déconnexion l'effet charge le panier
  guest mais **ne vide pas `pickup`** : nom, téléphone, wilaya du client
  précédent restent pré-remplis pour le suivant sur le même appareil (le panier,
  lui, est bien isolé par compte depuis B15).
- **Solution** : dans le même effet, `if (!user) { setPickup({ name: '', phone: '',
  wilaya: 'Oran', slot: '' }); return }`.

### 🟠 P7-4. Export CSV « aujourd'hui » : date UTC vs date locale (1 h par jour en Oran)
- **Où** : `src/DeskPage.jsx:115` vs `server/catalog.js` (`makeOrderCode`).
- **Mécanisme** : le client envoie `day = new Date().toISOString().slice(0,10)`
  (**UTC**), alors que le code de commande est daté à la date **locale du
  serveur**. Depuis Oran (UTC+1), entre **00:00 et 01:00** la « journée » UTC ne
  correspond pas à la journée locale : les commandes de cette heure portent le
  code du jour précédent et **disparaissent de l'export « aujourd'hui »**.
- **Solution** : source de vérité unique — à la création, stocker le champ
  `order.day` (= date intégrée au code) et filtrer le CSV dessus
  (`ordersToCsv` compare `o.day`) ; le client envoie `day=today` et le serveur
  résout « today » dans **sa** locale (ou rien = export complet). Filtre client
  et code partagent alors la même date par construction.

### 🟠 P7-5. `GET /api/meta` publique — fuite des produits masqués
- **Où** : `server/index.js:624`.
- **Mécanisme** : pas de contrôle d'auth — tout visiteur récupère la **méta
  complète** : `extraProducts` (fiche entière des produits masqués/ajoutés),
  `productOverrides`, `hiddenProductIds`. La route n'était nécessaire que pour
  les panneaux du shop (`extraPanels`/`hiddenPanelIds`).
- **Solution** : `GET /api/meta` ne renvoie que
  `{ extraPanels, hiddenPanelIds }` (les seuls champs consommés publiquement) ;
  la méta complète reste accessible via une route master dédiée si besoin
  (`/api/master/meta`). Le client (`api.getMeta()`) ne change pas de contrat.

### 🟠 P7-6. Biper du comptoir : un `AudioContext` par commande, jamais fermé
- **Où** : `src/App.jsx:462`.
- **Mécanisme** : `new AudioContext()` à chaque nouvelle commande, jamais
  `close()`d. Chrome plafonne à ~6 contextes actifs par page : après ~6
  commandes, **plus aucun son** (crée en erreur/suspendu) + fuite de mémoire.
- **Solution** : un **contexte unique** créé paresseusement au module (ou ref),
  `ctx.resume()` au premier geste utilisateur (politique autoplay), oscillateur
  recréé à chaque bipe, `close()` au `beforeunload`.

### 🟠 P7-7. Backups de `store.json` non bornés
- **Où** : `server/index.js:693` (setInterval 6 h + backup au startup),
  `server/masterApi.js:208` (`backupStore`), `POST /api/master/backup`.
- **Mécanisme** : `backupStore` copie sans jamais nettoyer : sur une machine
  longue durée (VPS/dev) `server/data/backups/` grossit **indéfiniment**
  (14 fichiers/jour au rythme du timer + manuels). Seul `scripts/backupDb.mjs`
  borne à 14.
- **Solution** : helper partagé `capBackups(dir, keep = 14)` (tri par nom =
  horodatage, suppression des plus anciens) appelé à la fin de `backupStore` —
  le script et le timer passent par le même chemin.

### 🟠 P7-8. `PUT /api/meta` : écrasement total sans validation (pied de fusil)
- **Où** : `server/index.js:628` ; exposé par `src/api.js` (`putMeta`).
- **Mécanisme** : `db.meta = { ...db.meta, ...body.meta }` — un seul corps
  malformé suffit à **écraser `extraProducts` / `productOverrides`** (produits
  custom + overrides perdus). Le UI ne l'utilise plus depuis P6 (panneaux via
  `/api/master/panels`, validé) — la surface d'API reste ouverte.
- **Solution** : supprimer la route et `api.putMeta` (mort), ou la limiter à un
  merge de champs validés façon `PUT /api/master/panels` (types vérifiés,
  slice bornée).

### 🟡 P7-9. Rate-limit : `Map` de buckets sans bornage
- **Où** : `server/rateLimit.js:2`.
- **Mécanisme** : une entrée par IP (`x-forwarded-for`) n'est jamais purgée — sur
  une instance longue durée (déploiement public) la mémoire croît lentement sans
  fin.
- **Solution** : purge opportuniste : au passage d'`rateLimit`, supprimer les
  buckets dont `now - start > windowMs` (ou balayage à chaque appel si
  `buckets.size > 10 000`, éviction du plus ancien).

### 🟡 P7-10. `readBody` sans limite de taille
- **Où** : `server/index.js:60`.
- **Mécanisme** : l'accumulation des chunks est **illimitée** : un corps de 500 Mo
  (6 photos non compressées × 6 uploads, ou simple malveillance) = OOM en local
  (Vercel impose ses propres limites d'entrée).
- **Solution** : stopper à ~15 Mo (≈ 6 photos compressées ~2,5 Mo en base64 +
  marge) et répondre `413 { error: 'too_large' }` ; le client a déjà la
  compression P4 (B10), la limite est large.

### 🟡 P7-11. Catalogue serveur vide → repli statique silencieux
- **Où** : `src/App.jsx:180` (`catalog = useMemo(...)`).
- **Mécanisme** : `apiOnline && serverCatalog.length` — si l'API répond mais que
  **tout est masqué ou en rupture** (0 produit), le shop bascule **silencieusement**
  sur le catalogue statique de 249 pièces : le client voit des produits que le
  master a masqués, avec des **prix qui peuvent différer** des overrides serveur
  (l'affiché ≠ le facturé par `placeOrder`).
- **Solution** : distinguer « API morte » (`r.offline` → repli statique actuel)
  de « API OK mais 0 produit » (afficher un état vide « Catalogue en
  préparation » avec le logo, comme le fait déjà MasterPage avec
  `productsLoading`) — le repli ne se déclenche que sur offline.

### 🟡 P7-12. CSV sans BOM UTF-8 → accents illisibles dans Excel
- **Où** : `server/masterApi.js:178` (`ordersToCsv`), réponse `server/index.js`.
- **Mécanisme** : le CSV UTF-8 n'a pas de BOM : Excel (Windows) interprète en
  ANSI → noms français/arabes en accents **illisibles** sur le comptoir
  (utilitaire n°1 du fichier).
- **Solution** : préfixer `'\uFEFF'` au début du CSV (`ordersToCsv` ou au
  `res.end`) — Excel le reconnaît en UTF-8, les autres lecteurs l'ignorent.

### 🟡 P7-13. `PartThumb` : sonde `.webp` en 404 garanti par photo uploadée
- **Où** : `src/PartThumb.jsx:15-19`.
- **Mécanisme** : chaque vignette tente d'abord la variante `.webp` ; les
  catalogues statiques l'ont, les **uploads du master non** → un 404 systématique
  par photo uploadée (2 requêtes au lieu de 1 par vignette, ×6 photos/produit).
- **Solution** : ne sonder le webp que pour les URLs du catalogue statique
  (pattern `/photos/<base>.jpg` connus) ; ou cache mémoire module
  `Map<url, variant>` peuplé au premier `onerror` — plus de 404 répétés même en
  statique.

### 🟡 P7-14. Recherche : filtre « En stock » inopérant + recherches sauvées perdues
- **Où** : `src/SearchPage.jsx:17` (inStock), `:33` (saved).
- **Mécanisme** : (a) en mode API le catalogue public **exclut déjà les ruptures**
  → le filtre « En stock » ne fait rien (illusion de fonctionnalité) ; (b) les
  recherches « sauvées » ne vivent que dans le state React → perdues au
  rechargement, contrairement au panier (B15) qui persiste.
- **Solution** : (a) ne rendre le filtre que si le catalogue peut contenir des
  ruptures (mode local), sinon le masquer/désactiver avec un tooltip ; (b)
  persister `saved` dans `localStorage` (`pcstar-saved-searches`) à la manière du
  panier, bornée (10 entrées).

### 🟡 P7-15. Commandes « les miennes » : match par téléphone entre comptes
- **Où** : `server/index.js:259` (`GET /api/me/orders`) + annulation (même
  condition `o.userId === uid || o.phone === phone`).
- **Mécanisme** : deux comptes **différents** partageant un même numéro (famille)
  voient — et **peuvent annuler** — les commandes de l'autre. Le match par
  téléphone est utile pour le guest→compte, mais il ne devrait s'appliquer qu'aux
  commandes **sans compte**.
- **Solution** : `o.userId === uid || (o.userId == null && phone && o.phone === phone)` —
  une commande liée à un autre compte n'apparaît plus qu'au sien.

### ⚪ P7-16. Builder « copier la config » : promesse `clipboard` non gérée
- **Où** : `src/BuilderPage.jsx:349`.
- **Mécanisme** : `navigator.clipboard?.writeText?.(text)` sans `.catch` — dans
  une iframe (preview) sans permission clipboard la promesse **rejette**
  (unhandled rejection, console) alors que le toast « copié » s'affiche quand
  même.
- **Solution** : `writeText(text).catch(() => setToast(t('copyBlocked')))`
  (+ clé i18n) — ou fallback `document.execCommand('copy')` dans une textarea
  éphémère.

### ⚪ P7-17. Radiateur NH-D15 classé « case » → affiché sous « Boîtier & PSU »
- **Où** : `src/data.js:393` (`category: 'case'`).
- **Mécanisme** : le modèle réutilise `case` comme bac « pièces » : le builder le
  sépare proprement (slot dédié via `pick`), mais dans la **boutique** le
  refroidisseur CPU apparaît dans la section Boîtier & PSU (cat_case).
- **Solution** : catégorie `cooling` dédiée (+ clé `cat_cooling` ar/fr/en) et
  `PART_LINES` ajusté ; ou, à minima, renommer la ligne `cat_case` en
  « Boîtier, PSU & Cooling ».

### ⚪ P7-18. `PUT /api/me` : `wilaya` libre, sans whitelist
- **Où** : `server/index.js:251`.
- **Mécanisme** : le client restreint via le select `WILAYAS_NEAR`, l'API accepte
  **n'importe quelle chaîne** → une valeur arbitraire (ou une chaîne longue)
  sature les listes de livraison/CSV.
- **Solution** : valider côté serveur : `wilaya` ∈ liste connue (partagée
  `src/data.js` → import serveur déjà en place via `PRODUCTS`) sinon défaut
  `'Oran'`, et tronquer à 32 caractères.

### Contrainte documentée (pas de bug)
- **Uploads Vercel éphémères** (`masterApi.js`, `/tmp` par instance) : déjà
  annoté dans le code et `DEPLOY-VERCEL.md` ; la solution durable = stockage
  Blob/Postgres. À traiter au moment du vrai déploiement, pas dans ce repo.

**Méthode P7** : re-lecture intégrale de 27 fichiers (`src/App.jsx` 1560 l.,
`server/index.js` 714 l., `masterApi.js`, `catalog.js`, `db.js`, `oauth.js`,
`rateLimit.js`, `api.js`, `shopStore.js`, `data.js`, `orderLogic.js`, les 5 pages,
`i18n.js`, `prefs.js`, `photoCompress.js`, configs) + reproducteurs live sur
l'API (P7-1 démontré en conditions réelles). Les points jugés sains au passage :
`writeDb` atomique, `newId`/`newToken`, `publicUser`, `purgeUser` (commandes
conservées `userId=null`), `updateProduct` (merge, pas écrasement),
`savePhotoDataUrls`/`unlinkUpload` (bornés, anti-traversal), `hashPass` scrypt +
legacy, `canTransition`, `checkCompatibility`, `photoCompress`, `.gitignore`
(`server/data/` hors git), sitemap/robots.

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
