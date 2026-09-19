# PC Star — Bugs trouvés & corrections (audit 10/09/2026)

> **Journal courant, append-only.** Une section par jour de session, la plus récente
> en bas. Ce qui est écrit dans une section est l'état du dépôt **ce jour-là** : on
> ne remonte pas corriger une conclusion d'il y a trois sessions : on ouvre une
> section nouvelle. Les sections les plus récentes portent leur date dans leur titre
> (« LOT P3 — … (audit du 19/09/2026) ») ; celles du haut datent de l'audit du 10/09
> et décrivent 24 bugs (B1–B24) sur un dépôt qui en a vu d'autres depuis.
> Pour l'état d'aujourd'hui : [`../../README.md`](../../README.md).

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
| P7 | (11/09) | P7-1 → P7-18 | 2ᵉ audit complet : bugs identifiés + solutions conçues |
| P8 | (11/09) | P7-1, P7-2, P7-3 | Correction des 3 bugs critiques 🔴 |
| P9 | (11/09) | P7-4 → P7-8 | Correction des 5 bugs opérationnels 🟠 |
| P10 | (11/09) | P7-9 → P7-18 | Correction des 10 derniers 🟡/⚪ (17/18 corrigés, 1 réanalysé) |
| P21 | (14/09) | Boutons du comptoir + nettoyage vitrine | Timeout réseau, `busy` par carte, suppressions demandées |
| P11 | (11/09) | P11-1 → P11-6 | Demandes client (PDP, home, panier, page commandes) |
| P12 | (13/09) | B25 | Base injoignable ⇒ **vitrine sans aucun produit** 🔴 |
| P13 | (13/09) | S1–S4 | **Lot 1 sécurité** : escalade master OAuth, open redirect, tokens persistés, rate-limit contournable 🔴 |
| **P20** | (13/09) | contact | **Le second numéro (06…) ignoré** : un seul bouton WhatsApp sur « À propos » et une seule alerte par commande — désormais deux boutons et les **deux** numéros notifiés (3 alertes au total) 🟠 |
| **P19** | (13/09) | commandes | **Le maître n'était pas averti d'une commande et ne pouvait pas la supprimer** : notification navigateur + WhatsApp Cloud API + WebSocket (repli polling) + `DELETE /api/orders/:code` 🟠 |
| **P18** | (13/09) | uploads | **Écriture hors répertoire d'uploads** via un id produit en traversal (authentifié master) 🔴 |
| **P17** | (13/09) | rapport #1-#7 | **Vérification d'un second rapport d'analyse** : 2 bugs confirmés, 1 piège UX, 2 durcissements, **3 affirmations réfutées par mesure** 🟡 |
| **P16** | (13/09) | #8, #12-#21, #25, #26 | **Lot 4 (durcissement)** : démos ressuscitées, rate-limit effacé, mot de passe modifiable sans l'ancien, reset `client31`, patch produit non validé, statuts de commande, historique écrasé, CORS `*`, store.json versionné 🟠 |
| **P15** | (13/09) | #5, #6, #7 | **Lot 3** : recherches sauvées jamais écrites, vignette effacée du DOM, photos SKU fantômes (3 × 404) 🔴 |
| P14 | (13/09) | #1, #3, #4 | **Lot 2** : inscriptions empoisonnées, WhatsApp du comptoir mort, écran blanc du Builder 🔴 |
| **P23** | (19/09) | rapport n°4 — P0 + P1 | **6 bugs vérifiés puis corrigés** : panne de pool Neon qui tuait le processus 🔴, fuites du 500, URI mal encodée en 500, commande à 0 DA acceptée, dates inexistantes validées par regex, fiches non éditables ni multi-sockets 🟠 |

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
sa solution conçue. Les 3 critiques 🔴 (**P7-1, P7-2, P7-3**) ont été **corrigés
en P8**, les 5 opérationnels 🟠 (**P7-4 → P7-8**) en **P9**, les 10 derniers
🟡/⚪ (**P7-9 → P7-18**) en **P10** — soit **17/18 corrigés** (P7-14a
réanalysé : non-bug, voir la section P10). Les références `fichier:ligne`
pointent le commit `7e9b5e7`.

Priorité : 🔴 = intégrité de données / argent / vie privée · 🟠 = justesse
opérationnelle · 🟡 = robustesse · ⚪ = cosmétique / contrainte documentée.

### 🔴 P7-1. Vue master ignorée par les overrides — affichage obsolète + édition destructrice ✅ corrigé (P8)
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

### 🔴 P7-2. Panier : échec API 429/5xx → repli local silencieux + code de commande en collision ✅ corrigé (P8)
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

### 🔴 P7-3. Formulaire de retrait non réinitialisé au logout (PII entre comptes) ✅ corrigé (P8)
- **Où** : `src/App.jsx:438` (effet `[authId]`).
- **Mécanisme** : `if (!user) return` — à la déconnexion l'effet charge le panier
  guest mais **ne vide pas `pickup`** : nom, téléphone, wilaya du client
  précédent restent pré-remplis pour le suivant sur le même appareil (le panier,
  lui, est bien isolé par compte depuis B15).
- **Solution** : dans le même effet, `if (!user) { setPickup({ name: '', phone: '',
  wilaya: 'Oran', slot: '' }); return }`.

### 🟠 P7-4. Export CSV « aujourd'hui » : date UTC vs date locale (1 h par jour en Oran) ✅ corrigé (P9)
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

### 🟠 P7-5. `GET /api/meta` publique — fuite des produits masqués ✅ corrigé (P9)
- **Où** : `server/index.js:624`.
- **Mécanisme** : pas de contrôle d'auth — tout visiteur récupère la **méta
  complète** : `extraProducts` (fiche entière des produits masqués/ajoutés),
  `productOverrides`, `hiddenProductIds`. La route n'était nécessaire que pour
  les panneaux du shop (`extraPanels`/`hiddenPanelIds`).
- **Solution** : `GET /api/meta` ne renvoie que
  `{ extraPanels, hiddenPanelIds }` (les seuls champs consommés publiquement) ;
  la méta complète reste accessible via une route master dédiée si besoin
  (`/api/master/meta`). Le client (`api.getMeta()`) ne change pas de contrat.

### 🟠 P7-6. Biper du comptoir : un `AudioContext` par commande, jamais fermé ✅ corrigé (P9)
- **Où** : `src/App.jsx:462`.
- **Mécanisme** : `new AudioContext()` à chaque nouvelle commande, jamais
  `close()`d. Chrome plafonne à ~6 contextes actifs par page : après ~6
  commandes, **plus aucun son** (crée en erreur/suspendu) + fuite de mémoire.
- **Solution** : un **contexte unique** créé paresseusement au module (ou ref),
  `ctx.resume()` au premier geste utilisateur (politique autoplay), oscillateur
  recréé à chaque bipe, `close()` au `beforeunload`.

### 🟠 P7-7. Backups de `store.json` non bornés ✅ corrigé (P9)
- **Où** : `server/index.js:693` (setInterval 6 h + backup au startup),
  `server/masterApi.js:208` (`backupStore`), `POST /api/master/backup`.
- **Mécanisme** : `backupStore` copie sans jamais nettoyer : sur une machine
  longue durée (VPS/dev) `server/data/backups/` grossit **indéfiniment**
  (14 fichiers/jour au rythme du timer + manuels). Seul `scripts/backupDb.mjs`
  borne à 14.
- **Solution** : helper partagé `capBackups(dir, keep = 14)` (tri par nom =
  horodatage, suppression des plus anciens) appelé à la fin de `backupStore` —
  le script et le timer passent par le même chemin.

### 🟠 P7-8. `PUT /api/meta` : écrasement total sans validation (pied de fusil) ✅ corrigé (P9)
- **Où** : `server/index.js:628` ; exposé par `src/api.js` (`putMeta`).
- **Mécanisme** : `db.meta = { ...db.meta, ...body.meta }` — un seul corps
  malformé suffit à **écraser `extraProducts` / `productOverrides`** (produits
  custom + overrides perdus). Le UI ne l'utilise plus depuis P6 (panneaux via
  `/api/master/panels`, validé) — la surface d'API reste ouverte.
- **Solution** : supprimer la route et `api.putMeta` (mort), ou la limiter à un
  merge de champs validés façon `PUT /api/master/panels` (types vérifiés,
  slice bornée).

### 🟡 P7-9. Rate-limit : `Map` de buckets sans bornage ✅ corrigé (P10)
- **Où** : `server/rateLimit.js:2`.
- **Mécanisme** : une entrée par IP (`x-forwarded-for`) n'est jamais purgée — sur
  une instance longue durée (déploiement public) la mémoire croît lentement sans
  fin.
- **Solution** : purge opportuniste : au passage d'`rateLimit`, supprimer les
  buckets dont `now - start > windowMs` (ou balayage à chaque appel si
  `buckets.size > 10 000`, éviction du plus ancien).

### 🟡 P7-10. `readBody` sans limite de taille ✅ corrigé (P10)
- **Où** : `server/index.js:60`.
- **Mécanisme** : l'accumulation des chunks est **illimitée** : un corps de 500 Mo
  (6 photos non compressées × 6 uploads, ou simple malveillance) = OOM en local
  (Vercel impose ses propres limites d'entrée).
- **Solution** : stopper à ~15 Mo (≈ 6 photos compressées ~2,5 Mo en base64 +
  marge) et répondre `413 { error: 'too_large' }` ; le client a déjà la
  compression P4 (B10), la limite est large.

### 🟡 P7-11. Catalogue serveur vide → repli statique silencieux ✅ corrigé (P10)
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

### 🟡 P7-12. CSV sans BOM UTF-8 → accents illisibles dans Excel ✅ corrigé (P10)
- **Où** : `server/masterApi.js:178` (`ordersToCsv`), réponse `server/index.js`.
- **Mécanisme** : le CSV UTF-8 n'a pas de BOM : Excel (Windows) interprète en
  ANSI → noms français/arabes en accents **illisibles** sur le comptoir
  (utilitaire n°1 du fichier).
- **Solution** : préfixer `'\uFEFF'` au début du CSV (`ordersToCsv` ou au
  `res.end`) — Excel le reconnaît en UTF-8, les autres lecteurs l'ignorent.

### 🟡 P7-13. `PartThumb` : sonde `.webp` en 404 garanti par photo uploadée ✅ corrigé (P10)
- **Où** : `src/PartThumb.jsx:15-19`.
- **Mécanisme** : chaque vignette tente d'abord la variante `.webp` ; les
  catalogues statiques l'ont, les **uploads du master non** → un 404 systématique
  par photo uploadée (2 requêtes au lieu de 1 par vignette, ×6 photos/produit).
- **Solution** : ne sonder le webp que pour les URLs du catalogue statique
  (pattern `/photos/<base>.jpg` connus) ; ou cache mémoire module
  `Map<url, variant>` peuplé au premier `onerror` — plus de 404 répétés même en
  statique.

### 🟡 P7-14. Recherche : filtre « En stock » inopérant + recherches sauvées perdues ✅ partiel (P10) — voir réanalyse
- **Où** : `src/SearchPage.jsx:17` (inStock), `:33` (saved).
- **Mécanisme** : (a) en mode API le catalogue public **exclut déjà les ruptures**
  → le filtre « En stock » ne fait rien (illusion de fonctionnalité) ; (b) les
  recherches « sauvées » ne vivent que dans le state React → perdues au
  rechargement, contrairement au panier (B15) qui persiste.
- **Solution** : (a) ne rendre le filtre que si le catalogue peut contenir des
  ruptures (mode local), sinon le masquer/désactiver avec un tooltip ; (b)
  persister `saved` dans `localStorage` (`pcstar-saved-searches`) à la manière du
  panier, bornée (10 entrées).

### 🟡 P7-15. Commandes « les miennes » : match par téléphone entre comptes ✅ corrigé (P10)
- **Où** : `server/index.js:259` (`GET /api/me/orders`) + annulation (même
  condition `o.userId === uid || o.phone === phone`).
- **Mécanisme** : deux comptes **différents** partageant un même numéro (famille)
  voient — et **peuvent annuler** — les commandes de l'autre. Le match par
  téléphone est utile pour le guest→compte, mais il ne devrait s'appliquer qu'aux
  commandes **sans compte**.
- **Solution** : `o.userId === uid || (o.userId == null && phone && o.phone === phone)` —
  une commande liée à un autre compte n'apparaît plus qu'au sien.

### ⚪ P7-16. Builder « copier la config » : promesse `clipboard` non gérée ✅ corrigé (P10)
- **Où** : `src/BuilderPage.jsx:349`.
- **Mécanisme** : `navigator.clipboard?.writeText?.(text)` sans `.catch` — dans
  une iframe (preview) sans permission clipboard la promesse **rejette**
  (unhandled rejection, console) alors que le toast « copié » s'affiche quand
  même.
- **Solution** : `writeText(text).catch(() => setToast(t('copyBlocked')))`
  (+ clé i18n) — ou fallback `document.execCommand('copy')` dans une textarea
  éphémère.

### ⚪ P7-17. Radiateur NH-D15 classé « case » → affiché sous « Boîtier & PSU » ✅ corrigé (P10)
- **Où** : `src/data.js:393` (`category: 'case'`).
- **Mécanisme** : le modèle réutilise `case` comme bac « pièces » : le builder le
  sépare proprement (slot dédié via `pick`), mais dans la **boutique** le
  refroidisseur CPU apparaît dans la section Boîtier & PSU (cat_case).
- **Solution** : catégorie `cooling` dédiée (+ clé `cat_cooling` ar/fr/en) et
  `PART_LINES` ajusté ; ou, à minima, renommer la ligne `cat_case` en
  « Boîtier, PSU & Cooling ».

### ⚪ P7-18. `PUT /api/me` : `wilaya` libre, sans whitelist ✅ corrigé (P10)
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

## P8 — Correction des 3 bugs critiques (P7-1, P7-2, P7-3)

Sur demande : correction des 🔴 uniquement (les P7-4→P7-18 restent documentés
avec leur solution, non implémentés).

### P7-1 — `listMasterProducts` merge `productOverrides` (`server/masterApi.js`)
- Pour chaque produit du catalogue de base : `{ ...p, ...(overrides[p.id] || {}),
  stock: liveStockOf(db, p.id), hidden, source }` — la vue master affiche
  désormais **exactement** les valeurs du public (prix, nom, photos…) + les
  flags serveur (`stock` live, `hidden`), jamais l'inverse.
- Le panneau « Éditer les photos » de MasterPage part donc de la bonne liste :
  plus d'écrasement des photos uploadées par les photos de base.
- **Vérifié en live** : `PUT price=99999,name=RYZEN TEST` → public **et** master
  affichent `99999 | RYZEN TEST` (avant : master restait `24500`) ; reset propre.
- Tests : 3 cas dans `src/masterApi.test.js` (prix/nom, photos, et
  stock/hidden non écrasés par l'override).

### P7-2 — Repli local uniquement en offline + code sans collision (`src/App.jsx`, `src/orderLogic.js`)
- Nouveau helper pur `orderApiFailure(r)` (`orderLogic.js`) : classifie l'échec
  `postOrder` en `offline | stock | rate | server`.
- `reserve()` : seul `offline` (backend injoignable) déclenche le repli local.
  - **429** → toast « Trop de commandes — réessayez dans N s » (`retryAfter`
    serveur, clé i18n `orderRateLimit` ar/fr/en) ;
  - **5xx/autre** → toast « Serveur momentanément indisponible » (clé
    `orderServerError`) ;
  - **panier conservé** dans les deux cas (aucune commande fantôme locale).
- Code local : `nextLocalOrderCode(codes)` = **max des codes du jour + 1**
  (jamais `reservations.length + 1`) → plus de collision quand la liste client
  est partielle.
- Tests : 11 cas (`orderApiFailure` ×4, `nextLocalOrderCode` ×4, dont « liste
  partielle »). Contrat 429 vérifié en live : 16ᵉ commande/min →
  `429 {error:'rate', retryAfter:60}`.

### P7-3 — Formulaire de retrait vidé au logout (`src/App.jsx`, `src/orderLogic.js`)
- Nouveau helper pur `pickupForUser(user, prev, defaults)` : `user` absent →
  `defaults` (état vide : nom/tél vides, slot par défaut, wilaya Oran, cash) ;
  compte → reprise nom/tél/wilaya du profil, **slot/payment conservés**.
- `PICKUP_DEFAULTS` unique source (module App.jsx), utilisé à l'init **et** à
  chaque changement de compte (login, logout, switch).
- Tests : 3 cas (reset complet au logout, reprise login + slot conservé,
  téléphone absent conservé).

### Vérification P8
- `npm test` → **89/89** (75 avant + 14 nouveaux).
- `npm run build` → OK (426,60 kB JS / 127,00 kB gzip).
- E2E live : P7-1 démontré ci-dessus ; contrat 429 vérifié (16 requêtes).
- i18n : couverture 0 clé manquante (2 nouvelles clés × 3 langues).

---

## P9 — Correction des 5 bugs opérationnels (P7-4 → P7-8)

### P7-4 — La « journée » du shop = date locale du client, unique référence
- Nouveau helper pur `localDay()` (`src/orderLogic.js`) — date locale
  `YYYY-MM-DD`, jamais UTC.
- `reserve()` (`App.jsx`) envoie `day: localDay()` avec la commande ; la route
  `POST /api/orders` (`server/index.js`) la transmet à `placeOrder` qui la
  **valide** (`/^\d{4}-\d{2}-\d{2}$/`, repli date locale serveur sinon) et :
  - la stocke sur la commande (`order.day`) ;
  - l'intègre au **code** : `makeOrderCode(db, dayStr)` → `PS-<journée>-NNNN`
    (la séquence continue sur cette journée).
- `ordersToCsv` filtre sur `o.day` (repli `o.at` pour les commandes legacy).
- `DeskPage` exporte avec `localDay()` (avant : `toISOString()` = UTC).
- **Vérifié en live** : commande `day: 2027-01-05` → code `PS-20270105-0001`,
  présente dans l'export `?day=2027-01-05`, absente de l'export du jour courant.
- Tests : 5 cas (localDay, placeOrder day valide/invalide, séquence par
  journée, CSV Oran 00h30 vs legacy).

### P7-5 — `GET /api/meta` publique réduite aux panneaux
- La route publique ne renvoie plus que `{ extraPanels, hiddenPanelIds }`
  (les seuls champs consommés par le shop) — plus de fuite des fiches des
  produits masqués (`extraProducts`), ni des `productOverrides`.
- Méta complète : nouvelle route **`GET /api/master/meta`** (master only).
- Tests E2E : publique = 2 clés seulement ; master 403 anonyme / 200 avec
  override visible ; override invisible côté publique.

### P7-6 — Beep comptoir : un seul `AudioContext` partagé
- `deskBeep()` (module App.jsx) : contexte créé une fois à la demande,
  `resume()` si « suspended » (politique autoplay), réutilisé à chaque bipe —
  plus de plafond de ~6 contextes Chrome, plus de fuite.
- (Non unit-testable : dépend `window.AudioContext` ; vérifié par le build +
  la relecture — la logique de limite était purement cumulative avant.)

### P7-7 — Backups bornés à 14, un seul chemin
- `capBackups(dir, keep=14)` (`server/masterApi.js`) : supprime les plus
  anciens (noms `store-<timestamp>` = triable chronologiquement).
- `backupStore` l'appelle **à chaque backup** (timer 6 h, startup, endpoint
  manuel) ; `scripts/backupDb.mjs` passe par le même chemin (plus de logique
  dupliquée).
- Tests : 3 cas (20→5 fichiers, sous la limite = 0 supprimé, 16 backups
  successifs bornés à 14).

### P7-8 — `PUT /api/meta` supprimé
- La route (écrasement `db.meta = {...db.meta, ...body.meta}` sans validation)
  et le client mort `api.putMeta` sont supprimés → **404**.
- Les écritures existent déjà sur des routes validées : panneaux
  (`PUT /api/master/panels`) et produits (`/api/master/products`).
- Test E2E : PUT master **et** anonyme → 404.

### Vérification P9
- `npm test` → **101/101** (89 avant + 12 nouveaux).
- `npm run build` → OK (426,85 kB JS / 127,10 kB gzip).
- E2E live : P7-4 (code daté à la journée + CSV), P7-5 (meta publique
  réduite / master 403+200), P7-8 (404).

---

## P10 — Correction des 10 derniers bugs (P7-9 → P7-18)

### P7-9 — Rate-limit borné en mémoire (`server/rateLimit.js`)
- `sweepExpired()` : balayage des buckets expirés, déclenché **opportuniste-
  ment** quand la Map dépasse 1024 clés (jamais un passage complet gratuit).
- Paramètre `now` injectable (tests déterministes) ; comportement 429
  inchangé.
- Tests : 2 cas (comptage/`retryAfter` + accumulation de 1200 buckets
  expirés → purgés au passage suivant).

### P7-10 — Corps de requête bornés à 15 Mo (`server/index.js`)
- `readBody` : accumulation bornée (`MAX_BODY_BYTES` = 15 Mo ≈ 6 photos
  compressées en base64 + marge) ; au-delà → rejet `BODY_TOO_LARGE` +
  drain (`req.resume()`), catch central → **`413 { error: 'too_large' }`**
  (plus de 500/OOM). Le chemin Vercel (body pré-parsé) reste couvert par
  les limites plateforme.
- Vérifié en live : POST 16 Mo → **413** (test E2E inclus).

### P7-11 — Catalogue serveur vide ≠ offline (`src/App.jsx`)
- Nouvel état `serverCatalogReady` : posé dès que le serveur a **répondu**
  au fetch catalogue (200 **ou** 5xx) — seul l'`offline` le laisse à false.
- `catalog` : `apiOnline && serverCatalogReady` → **le catalogue serveur est
  la vérité, même vide** (boutique vide plutôt que le catalogue statique qui
  réaffichait les produits masqués avec des prix désuets). Phase de chargement
  (pas encore de réponse) → repli statique actuel (pas de flash vide).
- Vérifié par le build + relecture (scénario « tout masquer » = 0 produit).

### P7-12 — BOM UTF-8 sur l'export CSV (`server/index.js`)
- `res.end('\uFEFF' + csv)` — Excel (Windows) reconnaît l'UTF-8, accents FR/AR
  lisibles ; les autres lecteurs ignorent le BOM. `ordersToCsv` reste pur
  (BOM au niveau HTTP, pas dans la fonction testée).
- Vérifié en live : premiers bytes = **`EF BB BF`** + `code,status,`
  (test E2E sur les bytes bruts — `res.text()` du fetch SUPPRIME le BOM).

### P7-13 — Plus de sonde `.webp` sur les uploads (`src/media.js`, `PartThumb.jsx`)
- `photoCandidates()` migré dans `media.js` (pur, testé) : le sibling webp est
  proposé **uniquement** pour le catalogue statique (`/photos/…` hors
  `/uploads/`) — jamais pour `/photos/uploads/…` ni `/api/upload-file`
  (serverless). Une vignette d'upload = 1 requête au lieu de 2.
- Tests : 3 cas (statique → webp+repli ; uploads/serverless → jamais de sonde ;
  déjà-webp/dataURL/vide → src seul).

### P7-14 — Recherches sauvées persistées (+ réanalyse du filtre « En stock »)
- **(b) corrigé** : `loadSavedSearches`/`saveSavedSearches` (`shopStore.js`)
  → `localStorage` (`pcstar-saved-searches`), bornées à **10**, storage cassé
  → `[]` sans exception. SearchPage charge/sauve par ces helpers.
- **(a) réanalysé → NON-BUG** : le filtre « En stock » n'est pas inopérant —
  `liveStock()` soustrait la **quantité déjà au panier**, donc le filtre masque
  les produits intégralement réservés au panier, en mode API comme en local.
  Le catalogue exclut déjà les ruptures (P6), d'où l'impression « ne fait
  rien » quand le panier est vide : comportement cohéret, **aucun changement**.
- Tests : 2 cas (round-trip + bornage 10, storage illisible).

### P7-15 — Commandes « les miennes » : match téléphone limité au guest
- `GET /api/me/orders` et annulation : `o.userId === uid || (o.userId == null
  && phone && o.phone === phone)` — le match par téléphone ne s'applique plus
  qu'aux commandes **guest** (`userId` null) : migration guest→compte
  préservée, mais deux comptes au même numéro ne voient/annulent plus les
  commandes de l'autre.
- Vérifié en live : A commande, B (même numéro) ne voit pas son ordre (liste)
  et son annulation → **404** ; A annule le sien → 200. Test E2E inclus.

### P7-16 — Clipboard géré dans le builder (`src/BuilderPage.jsx`)
- `writeText` promisifié : `.then` → toast « copié », `.catch` → nouveau toast
  « copie bloquée par ce navigateur » (clé `copyBlocked` ar/fr/en) — plus
  d'unhandled rejection en iframe, plus de « copié » mensonger. API absente →
  même toast honnête.
- Vérifié par le build + relecture (comportement dépend du navigateur).

### P7-17 — Catégorie `cooling` dédiée (`src/data.js`, i18n, CSS)
- Les **10 coolers** (1 base + 5 `extraCatalog` + 4 `dzCatalog`) passent en
  `category: 'cooling'` ; `PART_LINES` (ligne shop), `specOf` et
  `checkCompatibility` détectent désormais la catégorie (plus le pattern
  « case + socket array »).
- `CATEGORIES` expose `cooling` (chips shop + formulaire master) ; i18n
  `cat_cooling` × 3 (forcé par le test de couverture) ; `.cat-cooling` +
  `MARK.cooling = 'COOL'` (vignette de repli).
- Vérifié en live : catalogue public = 10 produits `cooling`, NH-D15
  `cooling` (test unitaire inclus : 10 coolers matchés, 0 orphelin).

### P7-18 — `wilaya` bornée dans `PUT /api/me` (`server/index.js`)
- Validation : `trim` + **troncature 32** + appartenance à `WILAYAS_NEAR`
  (liste partagée `src/data.js`, celle du select client) — sinon on garde
  l'existant (sinon `'Oran'`). Plus de chaîne libre en base.
- Vérifié en live : « Mars, la planète » → `Oran` ; `Mostaganem` → conservé.
  Test E2E inclus (invalide/valide/trop long).

### Vérification P10
- `npm test` → **113/113** (101 avant + 12 nouveaux).
- `npm run build` → OK (427,77 kB JS / 127,27 kB gzip).
- E2E live : P7-10 (413), P7-12 (BOM `EF BB BF`), P7-15 (isolement
  inter-comptes), P7-17 (10 produits cooling), P7-18 (wilaya).

---

## P11 — Demandes client (2026-09-11) : image PDP, nettoyage home, commandes

### P11-1 — Image PDP « coincée » (bloc coloré au lieu de la photo)
- Cause : la `<img>` principale du PDP n'avait ni `key` ni `onError`, et la
  classe `photo-skeleton` n'était retirée que si l'événement `load` était
  capturé. Image déjà en cache (URL identique aux vignettes) + nœud DOM
  réutilisé → `load` perdu → skeleton éternel ; URL morte → idem, sans
  repli.
- Fix (`src/ProductPage.jsx` + `App.jsx`) :
  - fond skeleton **permanent** sur le conteneur (il passe derrière l'image,
    plus d'état « coincé » possible) ;
  - `key={product.id + '-' + photoIndex}` sur la `<img>` → nœud neuf à
    chaque produit/photo, événements garantis ;
  - `onError` → repli `PartThumb` (logo/vignette de la pièce, jamais de
    bloc mort) ;
  - `key={selected.id}` sur `<ProductPage>` dans `App.jsx` → état propre à
    chaque produit.
- Vérifié en E2E jsdom live : src = trio SKU exact, thumb 2 → `-2.jpg`,
  `error` synthétique → fallback PartThumb.

### P11-2 — Home : suppression des panneaux « Pièces PC » et « Config PC »
- Les 2 cartes (`pathParts`/`pathBuilder`) sont supprimées de l'accueil ;
  **« Hits DZ » est conservé** (carte pleine largeur `col-12`).
- L'accès au builder reste par le menu et le bouton hero « Config PC »
  (non demandés à la suppression).
- Imports morts retirés (`DEALS`, `GUIDES` de `App.jsx`).

### P11-3 — Home : suppression de « Cette semaine » + produits
- Section `thisWeek` (liste `DEALS`) supprimée de l'accueil. Les produits
  eux-mêmes restent au catalogue ; seule la mise en avant disparaît.

### P11-4 — Home : suppression de « Configs Star » + liste
- Section `starConfigs` (listes `GUIDES`/`DZ_GUIDES`) supprimée de l'accueil.

### P11-5 — Panier : retrait du champ « wilaya »
- Le select `#wilaya` est retiré du formulaire de retrait. La wilaya reste
  transmise à la commande (profil du client, sinon défaut `Oran`) — vérifié
  en E2E (commande guest sauvegardée avec `wilaya: 'Oran'`).
- Le champ wilaya du **profil** est conservé (pré-remplissage, pas demandé).

### P11-6 — Commandes : page unique + bouton menu + bug « introuvable »
- **Bug** : après un succès `POST /api/orders`, `reserve()` ne faisait
  `saveOrders()` que sur le repli hors-ligne → aucune copie locale ; un
  **guest** (sans profil) n'avait nulle part où retrouver sa commande, et un
  client reconnecté ailleurs perdait la vue locale.
- **Fix** (`App.jsx`) : le chemin succès API persiste aussi la copie
  navigateur (dé-dupliquée par code).
- **Nouvelle page « Commandes »** (`src/OrdersPage.jsx`) :
  - client connecté + API : commandes serveur (`/api/orders/mine`, qui
    inclut les commandes guest passées au même téléphone) + copie locale,
    dédoublonnées par code ;
  - guest / hors-ligne : copie locale de l'appareil (note explicative
    affichée) ;
  - annulation des commandes « neuves » (même logique que l'ancienne) ;
  - **bouton « Commandes » dans le menu** (visible par tous) ;
  - redirection vers la boutique au déconnexion si on est sur la page.
- **« Mes commandes » supprimé du profil** (`src/ProfilePage.jsx`) :
  colonne, effet de chargement et prop `onCancelOrder` retirés ; le profil
  garde formulaire + mot de passe + comptes liés.
- i18n : `navOrders`, `ordersPageBody`, `ordersLoading`, `ordersGuestNote`
  × 3 (couverture testée).

### Vérification P11
- `npm test` → **113/113**.
- `npm run build` → OK (426,19 kB JS / 127,27 kB gzip).
- E2E jsdom live (vite + API réelles) : **31/31** — home nettoyé, PDP
  (src SKU / thumb / fallback erreur), panier sans wilaya, commande guest
  → persistée + visible sur la page Commandes, login démo → profil sans
  « Mes commandes », page Commandes connectée.

---

## P12 — B25 : base injoignable ⇒ boutique sans AUCUN produit 🔴

Signalé le 13/09 : « il n'y a plus de produits alors que la base Neon les avait ».

### Symptôme
Le shop affiche **« Aucun produit dans ce filtre »** (0 carte) alors que
`pcstar_state` contient bien les 250 SKU de base + les produits créés par le
master. La pastille d'état reste verte (`● API`) : rien n'indique un problème.

### Cause (chaîne complète, reproduite)
1. `GET /api/catalog` appelait `readDbAsync()` → `readNeonState()`
   (`server/neonStore.js:22`). Base injoignable ⇒ `NeonDbError` ⇒ le `catch`
   global du handler renvoie **500** `{ok:false,error:'server'}`.
2. `GET /api/health` ne touche pas la base ⇒ **200 `ok:true`** ⇒
   `apiOnline = true` côté client.
3. `src/App.jsx` : `if (!cat.offline) setServerCatalogReady(true)` — un 500
   n'est pas « offline » (seule une erreur réseau l'est), donc le front
   déclarait le catalogue **prêt** avec `serverCatalog = []`.
4. `catalog = apiOnline && serverCatalogReady ? serverCatalog : …` ⇒
   **liste vide**. Le repli statique (introduit en P7-11 pour ne pas
   ressusciter les produits masqués) transformait une panne de base en
   vitrine vide.

Ce que P7-11 avait raison de faire (un catalogue vide reçu **est** la vérité :
tout masqué / tout en rupture) et ce qu'il avait tort de faire (un **échec**
n'est pas un catalogue vide) étaient confondus.

### Déclencheurs réels d'une base « injoignable »
- `DATABASE_URL` copiée sur l'endpoint **direct** (`ep-xxx.<region>…`) au lieu
  du **pooler** (`ep-xxx-pooler.<region>…`) : le driver HTTP `neon()` des
  lectures tombe alors que le `Pool` TCP des écritures fonctionne → l'API
  semble marcher (login, commandes) mais le catalogue 500.
- Compute Neon **suspendu** (plan gratuit, idle) : le 1ᵉʳ appel réveille le
  compute et peut dépasser le timeout de la fonction Vercel.
- Branche **d'aperçu de PR supprimée/expirée** (`.github/workflows/neon_workflow.yml`
  les crée avec `expires_at` = +14 jours et les supprime à la fermeture de la
  PR) si cette URL a été collée dans Vercel.
- Projet archivé, mot de passe tourné, IP allowlist.

### Correction
- **`server/db.js`** : `readDbSafe()` — ne lève jamais ; renvoie
  `{ db, ok, driver, error }` avec repli `emptyDb()`. Les **écritures**
  (`updateDbAsync`) restent strictes : jamais de faux succès.
- **`server/index.js`** : `/api/catalog`, `/api/meta`, `/api/stock/:id` et
  `/api/master/products` passent par `readDbSafe()` ⇒ **200** + catalogue de
  base + `degraded: true`. `GET /api/health` annonce `db.driver`/`db.pooler`
  (sans sonde, donc vivant même base morte). Nouveau
  **`GET /api/db/status`** (master) : latence, reachability, compteurs
  (base/publics/extras/masqués/overrides de stock à 0/commandes/users).
- **`src/App.jsx`** : `serverCatalogReady` n'est mis qu'avec une vraie réponse
  (`cat.ok` + tableau). `degraded` ⇒ bandeau d'avertissement + pastille
  `▲ DB` ; `/api/meta` dégradé n'écrase plus le cache local des panneaux.
- **`scripts/neon-doctor.mjs`** (`npm run db:doctor`) : distingue
  « injoignable » de « vide » — endpoint pooler ou direct, lectures HTTP vs
  écritures TCP, tables présentes, `updated_at`, compteurs, verdict
  (produits masqués / stock à 0 / table vide).

### Preuve avant/après (même base morte, bundle React réel exécuté)
| | produits affichés | bandeau | pastille |
|---|---|---|---|
| avant | **0** (« Aucun produit dans ce filtre ») | — | `● API` (vert, faux) |
| après | **257** (249 SKU + 8 hits DZ) | « Base de données injoignable — catalogue de secours… » | `▲ DB` |

### Vérification P12
- `npm test` → **127/127** (avant : 118). Nouveaux : `src/apiDegraded.test.js`
  (7 cas — catalogue dégradé non vide, health vivant, meta/stock tolérants,
  `/api/db/status` 403 sans master, **écritures toujours strictes**,
  `dbUrlDiagnostics` sans fuite du mot de passe) + `GET /api/db/status` en mode
  fichier dans `src/apiServer.test.js`.
- `npm run build` → OK (427,44 kB JS / 127,64 kB gzip).
- `npm run db:doctor` → testé sur les 3 chemins (pas de `DATABASE_URL`,
  endpoint direct, base injoignable) ; le mot de passe n'est jamais imprimé.

---

## P13 — Lot 1 sécurité : S1 → S4 (rapport d'audit du 13/09) 🔴

Quatre trous vérifiés **par attaque réelle** (pas par lecture de code) avant
correction, puis re-vérifiés après.

### S1 (#2) — OAuth démo ⇒ session MASTER
- **Symptôme** : `finishIdentity` (`server/oauth.js`) appariait les identités
  par e-mail. En mode démo (défaut, `OAUTH_DEMO !== '0'`), taper
  `pcstar.info31@gmail.com` dans l'écran de consentement renvoyait une session
  **master** valide.
- **Avant** : `/api/me` avec le token obtenu → `role: "master"`.
- **Correction** : le compte master ne s'ouvre **que** par mot de passe —
  l'e-mail du magasin n'est jamais apparié par OAuth (`master_email`, 403 +
  page HTML lisible puisque le consentement est un formulaire). En démo,
  l'e-mail n'étant vérifié par personne, seuls les comptes `demo: true` (ou un
  lien déjà établi) peuvent être ouverts (`demo_email`) : plus
  d'appropriation d'un compte client réel en tapant son e-mail. En mode réel
  (`OAUTH_DEMO=0`), le fournisseur garantit l'e-mail → appariement normal,
  master toujours exclu.
- **Après** : 403, aucun token émis, aucune session master créée.

### S2 (#9) — Open redirect + fuite du token de session
- **Symptôme** : `/api/oauth/start` (non authentifié) acceptait un `returnUrl`
  arbitraire, recopié tel quel dans le `Location:` final **avec le token** :
  `https://evil.example/steal/?oauth_token=<session valide>`.
- **Correction** : `safeReturnUrl()` (`server/oauth.js`, exportée) n'accepte
  qu'un chemin relatif strict (`/orders`) ou une URL absolue **de la même
  origine** que `FRONT_URL` / `FRONT_ORIGIN` / `OAUTH_REDIRECT_BASE` /
  `VERCEL_URL`. Rejetés : `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`,
  `javascript:`, `data:`, CRLF (injection d'en-tête), > 500 caractères.
  Validé à l'entrée (`startOAuth`) **et** re-validé à la redirection.
- **Après** : le `returnUrl` tiers est stocké `null` et la redirection part
  vers le front.

### S3 (#10) — Tokens de session persistés dans la base et les backups
- **Symptôme** : `db._lastAuth = { token, user }` était écrit à chaque login
  OAuth et jamais retiré → chaque backup horaire de `store.json` contenait un
  credential valide en clair.
- **Correction** : le token est renvoyé par closure (`finishIdentity` retourne
  `{ ok, token, user }`), plus jamais écrit. `stripInternalKeys()`
  (`server/db.js`) retire `_lastAuth` **et** `_err` à chaque lecture et
  réécrit la base : les copies déjà présentes sur disque sont purgées.
- **Effet de bord assumé** : la persistance de `_err` (bug #1 du rapport) est
  neutralisée du même coup — une inscription n'empoisonne plus les suivantes.
  Le nettoyage du handler (variable de closure au lieu de `db._err`) reste au
  lot 2.

### S4 (#11) — Rate-limit contournable par `X-Forwarded-For`
- **Symptôme** : `clientKey` croyait l'en-tête aveuglément. En exposition
  directe, `X-Forwarded-For: 10.0.0.<n>` à chaque essai donnait un budget
  illimité sur `/api/auth/login` (20/min sinon) → brute-force du mot de passe
  master.
- **Correction** : `trustProxy()` ne croit l'en-tête que si `TRUST_PROXY=1` ou
  sur Vercel (`process.env.VERCEL`) ; `clientIp()` prend alors le **dernier**
  saut de la chaîne (celui que le proxy ajoute, pas celui que le client écrit).
  Sinon : adresse socket uniquement.
- **Après** : 25 essais avec XFF tournant → 429 au 20ᵉ (avant : aucun 429).

### Vérification P13
- `src/securityFixes.test.js` — **15 tests** qui rejouent chaque attaque :
  master par Google **et** par Meta, régression du compte démo, conservation du
  login master par mot de passe, 12 cas `safeReturnUrl`, redirection finale,
  compte réel non appropriable en démo, `Location` **relative** (le token ne
  quitte jamais l'origine), `_lastAuth` absent + base historique nettoyée,
  `clientIp` avec/sans proxy, 429 retrouvé, budget préservé derrière proxy
  déclaré.
- `npm test` → **142/142** (avant : 127).
- `npm run build` → OK. `npm run smoke` → OK.
- Rejeu des scripts d'attaque du rapport contre l'API corrigée : rôle master
  `undefined`, `Location` sans `evil.example`, 429 au 20ᵉ essai, base sans
  `_lastAuth` ni `_err`.

### Résiduel assumé (hors lot 1)
Le token OAuth transite toujours par l'URL (`?oauth_token=`) — contrat du
front (`src/App.jsx`). La redirection étant désormais contrainte à la même
origine, il ne part plus vers un tiers, mais un cookie `HttpOnly` /
`SameSite` reste la cible (déjà listé dans `SECURITY-AUDIT.md`).

---

## P14 — Lot 2 : #1 inscriptions, #3 WhatsApp, #4 Builder 🔴

Même méthode que P13 : bug reproduit **avant**, correctif, puis reproduction
rejouée **après** (composants React réels rendus en jsdom, pas des maquettes).

### #1 — `db._err` empoisonnait les inscriptions
- **Symptôme** : `POST /api/auth/register` sur un e-mail existant posait
  `db._err = 'exists'` **sur l'objet base**, donc écrit dans `store.json` et
  jamais retiré. Toute inscription suivante ressortait en **409 « exists »
  alors que l'utilisateur était créé en silence**.
- **Avant** (mesuré) : `409 → 409 → 409`, avec `fresh.user@test.dz` et
  `another.one@test.dz` quand même présents dans la base.
- **Correction** : variable de closure (`let exists = false`) à la place de la
  clé transitoire ; `stripInternalKeys()` (P13-S3) purge en plus les bases déjà
  polluées.
- **Après** : `409 → 201 → 409 → 201`, et `store.json` ne contient plus `_err`.

### #3 — Liens WhatsApp du comptoir tous morts
- **Symptôme** : la base stocke le format local `0[567]XXXXXXXX`
  (`normalizePhone`) mais `waPhoneHref` (local à `DeskPage.jsx`) ne préfixait
  `213` que pour les numéros de **9** chiffres → `wa.me/0550123456`, invalide.
- **Avant** (DeskPage réel rendu en jsdom) : `https://wa.me/0550123456`,
  `https://wa.me/0669174617`.
- **Correction** : conversion partagée et testée **`waNumber()`** dans
  `src/orderLogic.js` (00 / 213 / 0 local / 9 chiffres / espaces / tirets),
  renvoie `''` pour un numéro inexploitable → le Desk n'affiche alors aucun
  bouton plutôt qu'un lien mort.
- **Après** : `https://wa.me/213550123456`, `https://wa.me/213669174617`.

### #4 — Écran blanc du Builder dès qu'un GPU est incompatible
- **Symptôme** : `BuilderPage.jsx:271-272` rendait `{gpuBlocks[0]}` /
  `{gpuNotes[0]}` — des objets `{ key, vars, block }` issus de
  `splitWarnings`. React 19 lève *Objects are not valid as a React child* :
  comme il n'y a pas d'error boundary, **toute la page se vide**.
- **Avant** (BuilderPage réel, Z790 + 7800X3D, onglet GPU) :
  `racineVide: true`, 0 carte, erreur React.
- **Correction** : `t(gpuBlocks[0].key, gpuBlocks[0].vars)` — le motif déjà
  utilisé en sidebar (`BuilderPage.jsx:390-401`).
- **Après** : 20 cartes GPU, 0 erreur React, alerte traduite :
  « AMD Ryzen 7 7800X3D exige AM5. Gigabyte Z790 Gaming X AX est LGA1700. Les
  deux ne fonctionneront pas ensemble. »

### Vérification P14
- Tests ajoutés : `src/DeskPage.test.js` (**6** : table `waNumber` + rendu réel
  du Desk), `src/BuilderPage.test.js` (**2** : récap + liste GPU), 2 cas
  `waNumber` dans `src/orderLogic.test.js` (36 au total) et 1 cas inscription
  dans `src/apiServer.test.js` (23 au total).
- `npm run build` → OK. `npm run smoke` → OK.
- **Preuve de régression** : avec les fichiers ramenés à l'état pré-correctif
  (`git checkout 49255aa -- src/BuilderPage.jsx src/DeskPage.jsx src/orderLogic.js`),
  ces tests **échouent** — `Objects are not valid as a React child (found: object
  with keys {key, vars, block})` pour #4, et `numéro wa.me invalide :
  https://wa.me/0550123456?text=deskWaContact` pour #3 (6 échecs sur 8).
- Avant/après rejoué en direct : registre `409 → 201 → 409 → 201` ; liens
  WhatsApp et page Builder vérifiés sur les **composants réels** rendus en
  jsdom (bundles HEAD vs corrigé).

> **Note (P15)** : pour que `node --test` puisse importer les composants `.jsx`,
> le dépôt a gagné un mini-chargeur : `scripts/jsx-test-loader.mjs` (transforme
> le JSX via esbuild, déjà présent avec Vite, et complète les imports relatifs
> sans extension) enregistré par `scripts/jsx-test-register.mjs`, câblé dans
> `npm test` via `--import`. Sans lui, seuls les modules purs étaient testables.

---

## P15 — Lot 3 : #5 recherches sauvées, #6 vignette, #7 photos fantômes 🔴

Les trois bugs se cumulent sur une même vignette : un produit créé par le master
réclamait 3 fichiers inexistants (#7), la première erreur supprimait l'image du
DOM au lieu de basculer sur le secours (#6) — et la recherche qu'on venait de
sauvegarder n'était de toute façon jamais écrite (#5).

### #5 — `saveSavedSearches` n'écrivait rien

`saveSavedSearches(storage = localStorage, list = [])` était appelé dans
`src/SearchPage.jsx` avec `null` en premier argument : le paramètre par défaut
est écrasé, `storage?.setItem?.(...)` devient un no-op. La lecture, elle,
utilise bien le défaut (`loadSavedSearches()`) — **écrire et lire ne parlaient
pas au même endroit**. Résultat mesuré : 0 clé dans localStorage, la feature
P7-14 (« Recherches sauvées ») n'a jamais fonctionné.

**Correctif** : l'appel passe `undefined` (le défaut s'applique) **et** la
fonction retombe sur `localStorage` quand aucun storage n'est fourni — le même
piège ne peut plus se reproduire silencieusement. Tests : round-trip via le
storage par défaut, `null` explicite, borne à 10.

### #6 — le repli supprimait l'image au lieu de la remplacer

```js
function onPhotoError(e) {
  const img = e.currentTarget
  const fb = img.dataset.fallback
  if (fb && img.getAttribute('src') !== fb) {
    img.closest('picture')?.remove()   // ← supprime le <picture> AVEC l'<img>
    img.src = fb                       // ← s'applique à un nœud détaché du DOM
  }
}
```
`<picture>.remove()` retire aussi l'`<img>` qu'il contient : la mutation
suivante s'applique à un élément hors document. La vignette **disparaît**
(`document.contains(img) === false`) au lieu d'afficher le secours.

**Correctif** : le repli est piloté par l'état React (`useState`), plus par une
mutation du DOM. Chaîne d'essai : sibling `.webp` (via `<picture>`) → `.jpg` →
badge de catégorie (`span.part-mark`, déjà présent dans la CSS mais jamais
atteint). Chaque cran remonte un `<img>` neuf → un vrai nouveau chargement ;
l'ordre est garanti par construction, sans boucle possible.

### #7 — le trio SKU fantôme

`photosForProduct` renvoyait `/photos/sku/{id}-1|2|3.jpg` pour **n'importe
quel** produit, alors que ces fichiers ne sont livrés que pour le catalogue
statique (250 références). Les produits créés par le master ont un id
`sku-<ts36>-<hex>` (`newId('sku')`) → 3 requêtes 404 par vignette, rendues
invisibles par #6.

**Correctif** : `skuPhotoPaths` renvoie `null` pour un id en `sku-…` ; on retombe
sur le **pool de famille** (`/photos/lib/{famille}-N.jpg`, 210 fichiers livrés).
Un test verrouille la garde : aucun id du catalogue ne commence par `sku-`.

### Preuve (composant réel rendu dans jsdom, bundle Vite)

Même produit (`/photos/sku/sku-mabc123-xy-1.jpg`, inexistant), événements
`error` déclenchés à la main :

| étape | avant | après |
|---|---|---|
| initial | `<img>` dans le document | `<picture>` : `<source>` webp + `<img src=…jpg>` |
| erreur 1 | **`document.contains(img) === false`** — plus rien à l'écran | `<img>` toujours là, src `.jpg` |
| erreur 2 | — | badge `ACC` affiché |

### Vérification P15

- `npm test` : **162/162** (P13 : 142 → P14 : +11 → P15 : +6, plus les 3 cas
  des fichiers de couverture i18n). Les 4 tests `photosForProduct` vérifient
  aussi que les fichiers pointés **existent dans le dépôt**
  (`public/photos/...`), pas seulement la forme des chemins.
- **Preuve de régression** : avec `src/productPhotos.js` et `src/shopStore.js`
  ramenés à l'état pré-correctif, les nouveaux tests échouent —
  `trio SKU fantôme : /photos/sku/sku-mabc123-xy-1.jpg, …` pour #7, et
  « appel comme dans SearchPage → persiste vraiment » pour #5.
- `npm run build` : OK. `npm run smoke` : OK.
- Rendu réel du composant dans jsdom (tableau ci-dessus).

### Résiduels connus

- `/photos/lib/{famille}-N.jpg` : si une famille a moins de 3 photos, les chemins
  manquants tombent désormais sur le badge de catégorie (plus d'image cassée) —
  mais l'idéal reste d'uploader les vraies photos du produit.
- Les trios SKU du catalogue sont toujours demandés en webp **puis** jpg ; un
  `srcset`/manifeste par SKU réduirait encore le trafic.

---

## P16 — Lot 4 : durcissement (#8, #12, #13, #14, #16, #18, #19, #20, #25, #26) 🟠

Lot « intégrité des données + surface d'attaque restante ». Chaque correctif est
couvert par `src/hardening.test.js` (23 tests, serveur réel sur port aléatoire +
base temporaire).

### #8 — les comptes de démo ressuscitaient

`readDb()` réinjectait les 3 démos **à chaque lecture** :
`DELETE /api/customers/demo-karim` répondait 200, puis le compte revenait à la
requête suivante. Désormais le seed est posé une fois et marqué
(`meta.demoSeeded = true`) ; seul le **master** reste réinjecté (sinon plus
personne ne peut ouvrir le comptoir).

### #12 — le rate-limit s'effaçait tout seul

`sweepExpired(now, windowMs)` supprimait les buckets selon la fenêtre de
**l'appelant** : un endpoint à 60 s purgeait les buckets de 24 h (backup,
archive). Chaque bucket mémorise sa fenêtre (`b.windowMs`) ; sans marqueur
(bucket d'avant le correctif) on retombe sur celle de l'appelant.

### #13 — changer de mot de passe avec un simple token

`POST /api/me/password` n'exigeait que la session : un token volé (XSS, URL
partagée, `_lastAuth` recopié dans un backup) permettait de verrouiller le
compte. Le mot de passe **actuel** est désormais vérifié (`verifyPass`), sinon
`403 current_password`.

### #14 — reset master sur mot de passe devinable

`String(body.password || 'client31')` : un corps vide remettait le mot de passe
du client à `client31`, sans que le master sache quoi que ce soit. Le mot de
passe doit être fourni explicitement (≥ 6), sinon `400`.

### #16 — `.env` ignoré

Aucun chargeur n'existait (`dotenv` n'est pas installé) : `PORT`,
`DATABASE_URL`, `FRONT_ORIGIN`, `TRUST_PROXY` devaient être exportés à la main.
`server/env.js` (sans dépendance, importé en première ligne de `server/index.js`)
lit `.env` et `.env.local`, **sans jamais écraser** une variable déjà présente —
donc Vercel/CI gardent la priorité, et l'absence de fichier est un no-op.

### #18 — un patch produit invalide partait en vitrine

La branche « override catalogue » recopiait `name/price/brand/category/short/sku/
photos/needs` **tels quels** : `price: "abc"` donnait « NaN DA » en vitrine et
`priceOf` → 0, un `name` de 500 caractères cassait les cartes, `photos: "x"`
cassait `PartThumb`. Tout passe par `sanitizeProductPatch()` (prix fini ≥ 0,
nom ≤ 120, catégorie connue, sku ≤ 40, photos = tableau d'URL) → `400` sinon.
En complément, `money()` n'affiche plus « NaN DA » mais « — DA ».

### #19 — n'importe quelle transition de statut

Seul `cancelled` était gardé : on pouvait remettre une commande **picked**
(retirée, stock consommé) en `new` et la revendre. Les transitions sont
explicites (`ORDER_TRANSITIONS`) ; sinon `{ ok:false, error:'transition' }`.

### #20 — l'historique perdait des commandes en silence

`db.orders = [order, ...db.orders].slice(0, 500)` jetait la plus ancienne sans
log ni retour. On ne retire plus que des commandes **terminées**
(picked/cancelled), les plus anciennes d'abord, et la liste remonte dans
`trimmed` (+ un `console.warn`). S'il ne reste que des commandes actives, la
borne molle est dépassée sans rien perdre ; au-delà du plafond dur
(`MAX_ORDERS_HARD = 2000`) la commande est **refusée** (`orders_full`) plutôt
que d'écraser l'historique.

### #25 — CORS `*` par défaut

`FRONT_ORIGIN` valait `'*'` sans configuration : n'importe quel site pouvait
lire les réponses de l'API. Par défaut **aucun** en-tête CORS n'est émis
(same-origin : proxy Vite en dev, front+API sur le même domaine Vercel) ; en
cross-origin il faut déclarer `FRONT_ORIGIN`/`FRONT_URL` (+ `Vary: Origin`).
Les 429 portent enfin l'en-tête standard `Retry-After`.

### #26 — `store.json` versionné avec les hashes

`server/data/store.json` était **suivi par git** (`.gitignore` contenait
`!server/data/store.json`) et contenait `"passwordHash": "sha256$pcstar:star31"`
pour le master et les 3 démos. Fichier retiré de l'index ; la base est recréée au
démarrage par `ensure()` (master + démos viennent du code).

### Points faibles corrigés au passage

| Site | Avant | Après |
|---|---|---|
| `masterApi.js` `csvEscape` | `[",\n]` — un `\r` sortait de la cellule et décalait toutes les colonnes | `[",\n\r]` |
| `index.js` export CSV | `day` (query) interpolé dans `Content-Disposition` → injection d'en-tête + 500 | validé `^\d{4}-\d{2}-\d{2}$` |
| `index.js` backups | chemin figé `__dirname/data/store.json` → avec `PCSTAR_DATA_DIR` on sauvegardait **un autre fichier** que la base active | `dbPaths()` (route + démarrage + intervalle 6 h) |
| `oauth.js` | identité sans e-mail → utilisateur `email: ''` impossible à reconnecter | `outcome = { ok:false, error:'no_email' }` |
| `shopStore.js` | `wilaya` non bornée (100 000 caractères → base + CSV) | `.slice(0, 40)` |
| `package.json` | `"dev:all": "node server/index.js & vite"` — shell rendu aussitôt, API orpheline au Ctrl-C, sortie illisible | `scripts/dev-all.mjs` (enfants préfixés, le premier qui meurt entraîne l'autre) |

### Vérification P16

- `npm test` : **185/185** (162 → 185 : +23 dans `src/hardening.test.js`).
- **Preuve de régression** : les 8 correctifs remis à leur ancien comportement
  (bucket sans `windowMs`, seed inconditionnel des démos, garde `verifyPass`
  neutralisée, défaut `client31`, `sanitizeProductPatch` court-circuité, garde de
  transition neutralisée, `slice(0, 500)` restauré, `FRONT_ORIGIN` remis à `*`)
  font tomber **10 des 23 tests** — exactement les groupes #12, #8, #13, #14,
  #18, #19, #20, #25. Les deux groupes non revertés (#16, points faibles)
  restent verts. Fichiers restaurés depuis le commit, 23/23 à nouveau.
- `npm run build` : OK. `npm run smoke` : **SMOKE OK** (API 8787 + Vite 5173).
- Dépendances : `jsdom` (tests de composants) et `esbuild` (chargeur JSX) sont
  désormais **déclarés** dans `devDependencies` — ils n'étaient présents que par
  transitif, donc `npm test` cassait sur un clone propre.

### Résiduels connus

- `hashPassLegacy` (SHA-256 sans sel) reste le format des comptes de démo et du
  master d'origine ; `verifyPass` accepte les deux formats et tout changement de
  mot de passe réécrit en `scrypt`. Une migration forcée au premier login reste à
  faire.
- `TRUST_PROXY` doit rester **absent** sur Vercel (auto-détecté) ; derrière un
  proxy custom il faut `TRUST_PROXY=1` **et** un proxy qui réécrit
  `X-Forwarded-For`.
- Le token de session voyage encore dans l'URL après OAuth (same-origin
  uniquement) — voir P13/S2.

---

## P17 — Vérification du second rapport d'analyse (7 affirmations) 🔎

Un second rapport listait 7 bugs « non documentés ». Chacun a été **vérifié par
exécution** avant toute correction : 2 confirmés, 1 piège UX réel, 2 durcissements
utiles, et **3 affirmations réfutées** — dont une qui cachait un vrai bug, mais
pas celui qui était décrit.

| # | Affirmation du rapport | Verdict | Preuve |
|---|---|---|---|
| 1 | `MasterPage.jsx:156` toast `authErrorPassword` sur échec de création | ✅ **confirmé** | la ligne disait bien `t('authErrorPassword')` alors que la voie API (L136) utilise déjà `masterCreateFail` |
| 2 | `shopStore.js` SKU `PS-` si titre vide | ❌ **réfuté** (durci quand même) | `addProduct` fait `const title = String(name\|\|'').trim()` puis `if (!title \|\| …) return { ok:false }` **avant** de construire le SKU → `title` ne peut pas être vide |
| 3 | filtre « En stock » trompeur en mode API | ✅ **confirmé (UX)** | `publicCatalog()` se termine par `.filter((p) => (Number(p.stock) \|\| 0) > 0)` : avec un panier vide le filtre ne change rien |
| 4 | race `meta.hiddenProductIds` après `doToggleHidden` | ❌ **réfuté** | le **seul** lecteur front de `meta.hiddenProductIds` est `MasterPage.jsx:222`, c'est-à-dire la branche **locale**. En mode API la liste vient d'`apiProducts` (`productsShown = apiOnline ? apiProducts : …`) et la vitrine lit le catalogue serveur, déjà filtré |
| 5 | `BuilderPage.jsx:26` trompé par `compat.socket` en tableau | ❌ **réfuté** (garde ajoutée) | mesuré sur le catalogue : **0/14 CPU** et **0/17 cartes mères** ont un socket en tableau ; seuls les 10 ventirads en ont. La ligne compare cpu ↔ carte mère |
| 6 | `buildPowerRecap` surestime (~850 W pour 4070+14700K) | ❌ **chiffre faux**, ✅ **mais vrai bug à côté** | mesuré : cette config donne **700 W** (= le `psuMin` vendeur de la 4070 Super), pas 850. En revanche `p.tdp` **n'existe sur aucun produit** (le TDP vient de `specOf()`) → l'estimation ignorait le CPU : 14700K + Z790 donnait **150 W** au lieu de **275 W** |
| 7 | `pdpWaMsg` arabe sans adresse, incohérent | ❌ **réfuté** | les 3 langues sont identiques : `pdpWaMsg` (fiche produit) ne contient `{address}` **nulle part** (L504 ar, L1008 fr, L1512 en). Le message avec `{address}` est une **autre clé**, `waMessage` (commande/panier, L502/1006/1510) |

### Correctifs appliqués

- **#1** `setToast(t('masterCreateFail'))` à la place de `authErrorPassword`.
- **#6 (le vrai)** `buildPowerRecap` lit désormais `specOf(p).tdp` pour les CPU et
  les GPU (un `compat.tdp` explicite reste prioritaire). Mesuré après :
  14700K + Z790 → **275 W** (avant 150), 14700K + 4070S → 700 W (inchangé,
  le `psuMin` vendeur domine), 7800X3D + 4060 → 550 W.
- **#5 (garde)** `socketsMatch(a, b)` exporté depuis `data.js` et utilisé **aux
  deux endroits** qui comparaient les sockets : `BuilderPage.jsx` (garde rapide)
  et `checkCompatibility` (qui faisait le même `!==` — le rapport ne l'avait pas
  vu). Tolère string/tableau des deux côtés.
- **#2 (durcissement)** `skuSlug()` retire les caractères invisibles (BOM,
  zero-width, espaces insécables) que `trim()` ne retire pas, et retombe sur un
  suffixe horodaté : un SKU ne peut plus dégénérer.
- **#3 (UX)** le filtre « En stock » porte une explication (`inStoreOnlyHint`,
  ar/fr/en) : le catalogue n'affiche déjà que du stock > 0, le filtre masque en
  plus ce que le panier réserve entièrement.

### Vérification P17

- `src/reportP17.test.js` : **9 tests** (rendu réel de `MasterPage` et
  `BuilderPage` en jsdom + logique pure).
- `npm test` : **194/194** (185 → 194).
- `npm run build` : OK.
- **Preuve de régression** : les 5 correctifs remis à leur ancien comportement
  (toast, SKU inline, `!==` aux deux sites, `p.tdp`, clé i18n retirée) font
  tomber **5 des 9 tests**, un par groupe. Restaurés depuis la sauvegarde,
  9/9 à nouveau.

### Résiduel

- Les 9 alimentations du catalogue ont `category: "case"` (il n'existe pas de
  catégorie `psu`/`power`). **Sans effet fonctionnel** : le slot PSU du Builder
  sélectionne par `Boolean(p.compat?.psuWatts)` et le slot Case exige
  `p.compat?.form`, que les alims n'ont pas. Seul effet visible : le badge de
  vignette affiche « CASE » pour une alimentation. Non corrigé — renommer la
  catégorie toucherait filtres, presets et tests pour un gain cosmétique.

---

## P18 — Écriture hors répertoire d'uploads (traversal) 🔴

Trouvé en vérifiant la liste « fichiers non lus » du second rapport
(`server/blobStore.js` y figurait, sans diagnostic).

### Reproduction (avant correctif, sur l'API en marche)

```
PUT /api/master/products/..%2F..%2Fpwnt        → HTTP 404
mais : ./public/pwnt-mu07wjd7-1.png créé      ← HORS de public/photos/uploads
```

`savePhotoDataUrls()` construisait le nom de fichier avec l'id produit pris
**tel quel** dans l'URL décodée :

```js
const name = `${productId}-${Date.now().toString(36)}-${i}.${ext}`
```

et `uploadBlob()` écrivait `path.join(UPLOAD_DIR, name)` sans contrôle. La
route répondait 404 (produit introuvable) **après** avoir écrit le fichier —
donc un fichier `.png/.jpg/.webp` posé n'importe où sous le dépôt, y compris
dans `public/` où il est servi publiquement.

Asymétrie révélatrice : `deleteBlob()` gardait déjà `name.includes('..')` et
`name.includes('/')` ; l'écriture, non. La **lecture** (`GET /api/upload-file`)
était correctement gardée (`path.basename` + contrôle `..`) — seule l'écriture
était exposée.

Portée : nécessite un compte **master** (route authentifiée), et l'extension
reste bornée à jpg/png/webp avec un suffixe horodaté. Ce n'est donc pas une
exécution de code, mais une écriture de fichier image hors du répertoire prévu —
suffisant pour polluer `public/`, saturer un disque, ou déposer un fichier au
nom trompeur.

### Correctif (deux barrières + nettoyage)

1. `safeUploadName()` (`server/blobStore.js`) : `path.basename` puis tout
   caractère hors `[A-Za-z0-9._-]` remplacé par `_` ; refus si vide, `.`, `..`
   ou > 200 caractères.
2. Garde sur le **chemin résolu** : `path.relative(UPLOAD_DIR, file)` ne doit
   jamais commencer par `..` ni être absolu.
3. `savePhotoDataUrls()` assainit l'id produit en amont (`[^A-Za-z0-9_-]`
   retiré) — première barrière, indépendante de la seconde.
4. Au passage : une erreur en cours de boucle laissait les photos déjà envoyées
   **orphelines** (la compensation de la route ne voyait jamais `newPaths`,
   puisque la fonction n'était pas revenue). `savePhotoDataUrls` supprime
   désormais ce qu'elle a écrit avant de re-propager.

### Vérification P18

- `src/uploadSecurity.test.js` : **4 tests** (`safeUploadName` + bout en bout
  avec `PCSTAR_UPLOAD_DIR` temporaire : l'attaque ne crée **aucun** fichier hors
  du répertoire, et un upload légitime fonctionne toujours).
- `npm test` : **198/198** (194 → 198).
- **Rejoué en direct après correctif** : `PUT …/..%2F..%2Fpwnt2` → 404 et le
  fichier atterrit dans `public/photos/uploads/pwnt2-….png` (dans le
  répertoire), plus dans `public/`. Upload légitime : 201,
  `/photos/uploads/sku-….png`.

### Le reste de la liste « non vérifiée » du rapport — mesuré, rien à corriger

| Fichier soupçonné | Vérification exécutée | Résultat |
|---|---|---|
| `i18n.js` (clés manquantes) | comparaison des 3 dictionnaires + croisement avec les 277 clés littéralement appelées dans `src/` | **497 clés × 3 langues, 0 manquante, 0 en trop, 0 clé appelée absente du dico** |
| `data.js` / `dzCatalog.js` / `extraCatalog.js` | 250 produits finaux (141 EXTRA + 89 DZ) passés au crible | **0 id dupliqué, 0 SKU dupliqué, 0 prix non fini, 0 nom manquant, 0 catégorie inconnue, 0 photo vide** |
| `photoCompress.js` | lecture du flux canvas | échec de `getContext`/`loadImage` déjà rattrapé par `.catch(() => raw)` ; image ≤ maxDim non ré-encodée (voulu) |
| `OrdersPage.jsx`, `LegalPage.jsx` | lecture | rien de cassé ; le filtre invité d'`OrdersPage` reste le point #22 « discutable » |

---

## P19 — Le maître n'était pas averti d'une commande, et ne pouvait pas la supprimer 🟠

Demande directe du comptoir, pas un item du rapport : quand un client commande
(une carte graphique ou une configuration complète), le maître doit **la voir
arriver** et **être prévenu** (notification navigateur + WhatsApp) pour pouvoir
rappeler et confirmer. Et il doit pouvoir **supprimer** une commande — ses
propres tests ne doivent pas rester dans l'historique ni dans le CSV.

### Avant

| Manque | Preuve mesurée |
|--------|----------------|
| Aucune notification navigateur | `grep -rn "Notification" src/` → **0 résultat** |
| Aucune notification WhatsApp | `grep -rn "WHATSAPP" server/` → **0 résultat** ; la dépendance `ws` était déclarée dans `package.json` mais **jamais importée** |
| Latence jusqu'à 20 s | `src/App.jsx` : `setInterval(pull, 20000)` |
| Détection par longueur | `next.length > prevOrderCount.current` → une commande arrivée en même temps qu'une suppression **passait inaperçue** |
| Suppression impossible | aucune route `DELETE` ; seul `POST /api/orders/:code/cancel` existait |

### Correctifs

**1. `server/notify.js` (nouveau)** — WhatsApp **Cloud API** officielle.
`formatOrderMessage()` rend un message lisible sur téléphone (code, client,
téléphone, wilaya, créneau, total, articles) terminé par un lien de rappel
`wa.me`. Ce lien passe par `waNumber()` : sans lui on renvoyait le **bug #3 de
P14** (wa.me refuse le `0` local). `sendWhatsApp()` ne lève **jamais** : non
configuré → `{ok:false,skipped:true,error:'not_configured'}`, erreur HTTP de
Meta → `http_401 …`, fetch qui rejette → erreur rapportée sans exception. Une
panne WhatsApp ne peut donc pas faire échouer une commande client.

**2. `server/deskSocket.js` (nouveau)** — WebSocket `/api/desk-stream`.
La vérification du token se fait **avant** l'upgrade : un non-master n'obtient
jamais de socket (403), sans token → 401, tout autre chemin → connexion
détruite. Branché uniquement dans `startLocalServer()`.

**3. `src/deskStream.js` (nouveau)** — le socket, **avec repli automatique sur
le polling**. C'est obligatoire : **les WebSockets n'existent pas sur Vercel
serverless**. Sans `WebSocket`, sans token, sans `location`, ou si le
constructeur lève → polling. À la fermeture du socket, le polling reprend
immédiatement et une reconnexion exponentielle est planifiée (2 s → 30 s). Le
polling reste la source de vérité : le socket ne fait que déclencher un
rafraîchissement immédiat.

**4. Détection par ensemble de codes** — `seenOrderCodes` remplace la
comparaison de longueur : une commande arrivée pendant une suppression est
désormais vue.

**5. `DELETE /api/orders/:code`** (master uniquement) + `deleteOrder()` dans
`server/catalog.js`. Distincte de l'annulation : l'annulation garde la trace
(historique, CSV, statistiques), la suppression retire la ligne. **Le stock est
rendu**, et une commande déjà `cancelled`/`picked` ne le rend **pas deux fois**.

**6. Corbeille sur chaque carte du Desk** (`src/DeskPage.jsx`) avec
confirmation, disponible pour tous les statuts — y compris `picked` et
`cancelled`, que l'annulation ne couvre pas.

### Variables d'environnement

```
WHATSAPP_TOKEN=EAAG…                 # app Business → produit WhatsApp
WHATSAPP_PHONE_NUMBER_ID=109876543210
WHATSAPP_RECIPIENT=213770650387      # défaut : STORE.whatsapp
WHATSAPP_API_VERSION=v21.0           # défaut
```

Sans `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, l'envoi est ignoré
silencieusement : le Desk et la notification navigateur continuent de marcher.

### Vérification exécutée

`src/notifyP19.test.js` — **25 tests** (suite totale **223/223**) :
`deleteOrder` (stock rendu, `not_found`, pas de double rendu), route DELETE
(403 anonyme, 403 non-master, 404 inconnu, 200 + stock), config WhatsApp,
payload Cloud API exact (URL, `Bearer`, `messaging_product`, `to`,
`preview_url`), erreurs Meta et réseau non propagées, contenu du message, lien
`wa.me/213550123456`, registre de clients, **4 scénarios `createDeskStream`**
(pas de WebSocket, pas de token, socket ouvert puis coupé, constructeur qui
lève), notifications navigateur (permission refusée/accordée/API absente), i18n.

`scripts/verify-p19-live.mjs` contre l'API en marche — **12/12** :

```
OK   socket master ouvert + hello {"type":"hello","desk":true,"clients":1}
OK   POST /api/orders 201 PS-20260913-0002
OK   stock réservé 6 → 5
OK   poussée WebSocket order:new reçue pour PS-20260913-0002
OK   DELETE /api/orders/:code 200 {"ok":true,"restocked":true}
OK   poussée WebSocket order:deleted
OK   stock rendu après suppression 5 → 6
OK   commande absente de la liste
OK   DELETE anonyme refusé HTTP 403
OK   socket sans token refusé réponse: 401
OK   socket non-master refusé réponse: 403
```

### Piège rencontré en écrivant les tests

Le premier jet **bloquait le runner indéfiniment** : `location` n'existe pas
sous Node, donc `new WebSocket(...)` levait, l'assertion échouait **avant**
`stream.close()`, et l'intervalle de polling restait vivant. Deux correctifs :
`deskStream.js` traite l'absence de `location` comme un repli polling (au lieu
de lever), et les tests ferment le flux dans un `finally`.

### Limite assumée

Sur **Vercel**, pas de WebSocket : une commande peut mettre jusqu'à 20 s à
apparaître au comptoir. Le WhatsApp, lui, fonctionne partout. Pour du temps
réel en production il faudrait un hébergement longue durée (VPS, Fly.io,
Railway) — documenté dans `docs/DEPLOY-VERCEL.md`.

## P20 — Le second numéro (06…) ignoré : un seul bouton WhatsApp, une seule alerte 🟠

Demande du comptoir : le magasin a **deux** numéros et le second (`0669 17 46 17`)
est tout aussi important que le premier. Il faut donc deux boutons WhatsApp sur
la page « À propos », et une commande doit notifier **les deux** numéros — le
maître reçoit alors **trois** alertes : une dans le navigateur (Desk) et deux
WhatsApp.

### Avant

| Manque | Preuve mesurée |
|--------|----------------|
| Le 06… n'était pas joignable en WhatsApp | `STORE.phone2 = '0669 17 46 17'` existait dans `src/data.js`, mais **aucun** `whatsapp2` ; `STORE.whatsapp` (le 07…) était le seul numéro WhatsApp du dépôt |
| Un seul bouton WhatsApp sur « À propos » | `STORE_LINKS` ne contenait qu'**une** entrée `whatsapp` |
| Une seule alerte WhatsApp par commande | `whatsappConfig()` renvoyait un `recipient` **unique** (`String(env.WHATSAPP_RECIPIENT \|\| STORE.whatsapp)`) |

Le numéro existait donc déjà côté données — il n'était simplement exposé ni en
bouton, ni comme destinataire de notification.

### Correctifs

**1. Source unique des numéros** (`src/data.js`) — `STORE.whatsapp2` +
`STORE_WHATSAPP`, une liste `[{number,label}]` filtrée sur `^\d{8,15}$`. Le
front (boutons) et le serveur (envois) lisent **la même liste** : ajouter un
troisième numéro ne demande qu'une ligne ici.

**2. Deux boutons WhatsApp sur « À propos »** — seconde entrée dans
`STORE_LINKS` (`id: 'whatsapp2'`), chacun sous-titré par son numéro pour qu'ils
soient distinguables, plus la règle `.social-whatsapp2` (même vert). La page
mappe déjà `STORE_LINKS`, donc les deux boutons apparaissent sans changer le JSX.

**3. Envoi aux deux numéros** (`server/notify.js`) — `whatsappRecipients()`
accepte plusieurs numéros (virgule, point-virgule ou espace) et, **sans
variable**, prend les deux numéros du magasin. `sendWhatsApp()` boucle sur la
liste et renvoie `{ok, sent, total, results}`. Les envois sont **indépendants
et séquentiels** : si un numéro échoue (non inscrit sur WhatsApp, quota…),
l'autre part quand même, et la réponse client reste `201`.

**4. Trace honnête** — `[pcstar-notify] WhatsApp envoyé à 2/2 numéro(s)`, et le
log de démarrage affiche les destinataires réels.

### Régression trouvée par les tests en écrivant ce lot

Mon premier `whatsappRecipients()` découpait sur **tous** les espaces
(`/[,;\s]+/`) : un numéro tapé normalement `' 213 550 123 456 '` devenait
quatre jetons de 3 chiffres, **tous rejetés** par la borne de longueur →
`recipient` vide, donc plus aucun envoi. C'est le test P19 « activé dès que le
token et le phone_number_id sont présents » qui l'a attrapé
(`'' !== '213550123456'`). Corrigé : on découpe sur `,`/`;`, on recolle les
chiffres d'un numéro, et ce n'est que si le résultat dépasse 15 chiffres qu'on
le re-découpe sur les espaces (cas « deux numéros séparés par un espace »).

```
défaut (rien)          → ["213770650387","213669174617"]
un numéro espacé       → ["213550123456"]
deux numéros virgule   → ["213770650387","213669174617"]
deux numéros espace    → ["213770650387","213669174617"]
mélange sale + doublon → ["213770650387","213669174617"]
```

### Vérification exécutée

`src/whatsappTwo.test.js` — **14 tests** : cohérence `waNumber(STORE.phone2) ===
STORE.whatsapp2`, les deux numéros au format `wa.me` (jamais de `0` initial),
deux entrées `STORE_LINKS` distinctes aux `href` attendus, `id` uniques (ce sont
des classes CSS), les 5 formes de saisie de `WHATSAPP_RECIPIENT`, **deux appels
HTTP réels** avec `to` = chaque numéro, échec partiel (le second part quand
même, `sent:1/total:2`), non-configuré toujours silencieux, liste invalide →
aucun appel réseau.

Compte des alertes pour une commande : **3** — 1 notification navigateur
(`notifyNewOrder`) + 2 WhatsApp (un par numéro).

## Juges non-bugs (documentés, pas de code)

- **B18** — Mode local : les décrets de stock sont en mémoire (`stockMap`) → perdus au
  rechargement (les réservations locales sont persistées, pas le stock). Contrainte de
  conception du fallback offline, pas un défaut.
- **B22** — Identifiants master/démo présents dans le bundle client et le serveur.
  Conception démo assumée et documentée (`DEPLOY-VERCEL.md`) ; à retirer pour une prod
  réelle.
  → **jugement révisé, et traité** : le maître au **lot 1.1** (`MASTER_EMAIL` /
  `MASTER_PASSWORD`, aucun repli codé en dur, plus de `MASTER` côté client), les
  trois comptes de démonstration au **lot 1.19** (`DEMO_PASSWORD`, comptes
  verrouillés et `401 demo_locked` quand la variable est absente, `passwordPlain`
  retiré du bundle). L'audit A→Z et la vérification du « lot 0 » du 16/09 ont
  montré que « conception démo assumée » ne tenait pas : ces comptes ouvraient de
  **vraies sessions** sur l'API déployée (commandes, profil, historique), et une
  rotation menée sans sortir les valeurs du dépôt ne fait que remplacer un secret
  publié par un autre. Détail : `docs/PLAN-CORRECTIONS.md` §9 « lot 1.19 ».
- **B23** — Historique des commandes plafonné à 500 (`server/catalog.js`). En Vercel
  `/tmp` est éphémère de toute façon (documenté dans `DEPLOY-VERCEL.md`).

## « Invalides » écartés pendant l'audit

- Alerte socket du builder → déjà i18n (`t('toastSocket')`).
- Labels CATEGORIES / PART_LINES → déjà rendus via `t('cat_…')` / `t('line_…')`.
- Stock des produits créés par le master → `createProduct` appelle déjà `setStock`.
- Citation « §7 » de `PROBLEMS-SOLUTIONS.md` → valide (voir B21).

---

## Vérification finale (cumulée, P5)

- `npm test` → **113/113 OK** (node:test — 11 fichiers ; P5 ajoute `uploadFlow.test.js`
  + tests purge B11 + unicité téléphones B19).
- `npm run build` → OK, **419,35 kB JS / 125,14 kB gzip** (code mort retiré), CSS en
  bundle, 0 ref jsdelivr.
- `npm run smoke` (e2e live) → OK.
- Render jsdom ar/fr/en → 0 erreur, 0 résidu anglais.
---

## LOT 1.20 — CI Neon : les scripts de base importaient le compte maître

Chantier **1.B** du plan (`docs/PLAN-CORRECTIONS.md`). Constat **reproduit** sur
la CI du dépôt, et non déduit : job « Create Neon Branch » du workflow
`.github/workflows/neon_workflow.yml`, run du 16/09/2026 15:39:37 UTC, étape
**« Run Neon schema migrations »** (`npm run db:migrate:neon`) en échec :

```
Error: [pcstar] compte maître non configuré — MASTER_EMAIL et MASTER_PASSWORD sont obligatoires.
```

### Mécanisme (et pourquoi il était invisible en local)

`server/db.js` terminait sa déclaration par un **objet résolu au chargement du
module** :

```js
const MASTER = masterAccount()   // ← exige MASTER_EMAIL / MASTER_PASSWORD à l'import
```

Tout importeur du module héritait donc de cette exigence, y compris des scripts
qui n'ont **rien à faire** du compte maître :

| Importeur | Ce qu'il fait | Besoin réel du maître |
|---|---|---|
| `scripts/neon-migrate.mjs` (`db:migrate:neon`, `…:reset`) | crée le schéma, écrit `emptyDb()` | **aucun** |
| `scripts/import-neon.mjs` (`db:import:neon`) | importe un `store.json` | aucun |
| `scripts/neon-doctor.mjs` (`db:doctor`) | diagnostic de connexion/schéma | aucun |
| `scripts/test-neon-concurrency.mjs` (`test:neon:concurrency`) | réserve concurrente, lit/écrit l'état | aucun |

La CI ne pose que `DATABASE_URL` : l'échec était **certain**, pas intermittent.
En local il ne se voyait pas parce que le `.env` du développeur contient
`MASTER_*` — et la documentation elle-même décrit la commande sans ces
variables (`docs/NEON-MIGRATION.md:13`) :

```bash
DATABASE_URL='postgresql://...' npm run db:migrate:neon
```

Coût réel de la panne : les **quatre** étapes de migration/validation du job sont
les étapes d'un **même job**, donc la migration qui échoue rend impossibles
l'étape de concurrence, le `--reset` **et** la suite complète sur une PR. La
protection anti-réservation concurrente (lot 3) n'était jamais vérifiée sur une
branche de PR.

### Correction

`server/db.js` ne résout plus le compte maître au chargement :

- l'objet `const MASTER` est **supprimé** (il n'avait aucun consommateur : seul
  `server/index.js` l'exportait pour `/api/health`, retiré au lot 1.10) ;
- un accesseur paresseux `masterAccountOrNull()` renvoie le compte, ou `null` si
  l'environnement ne le configure pas ;
- `emptyDb()` et `normalizeDb()` passent par cet accesseur : sans configuration
  ils ne sèment pas de maître et ne le synchronisent pas, mais **ne suppriment
  jamais** un maître déjà présent en base (la synchronisation est l'action d'un
  serveur configuré) ;
- `masterAccount()` **lève toujours** sans les variables, et le serveur continue
  de refuser de démarrer (`assertMasterConfigured()` dans `server/index.js`) : le
  verrou du LOT 1.1 n'est pas affaibli, seul le moment de la résolution change.

Corollaire : la CI n'a plus besoin de `MASTER_*` sur ces étapes, et la commande
documentée de `docs/NEON-MIGRATION.md` redevient exacte.

### Verrou de non-régression

`src/lot1BaseScripts.test.js` — 9 tests, dont 4 qui exécutent les scripts réels
(`neon-migrate.mjs` avec et sans `--reset`, `test-neon-concurrency.mjs`,
`neon-doctor.mjs`) en **processus enfant**, avec `MASTER_EMAIL` /
`MASTER_PASSWORD` posés à blanc. Chacun exige que le script démarre et échoue
avec **son** message (`DATABASE_URL is required`, `DATABASE_URL absente`), et
jamais avec celui du compte maître. Les cinq autres verrouillent la mécanique
interne : `masterAccount()` lève encore ; `masterAccountOrNull()` vaut `null`
sans configuration et l'objet avec ; `emptyDb()` ne sème aucun maître sans
configuration ; `normalizeDb()` ne supprime jamais un maître déjà en base ; le
module n'expose plus d'objet `MASTER` et le garde-fou serveur
(`assertMasterConfigured`) demeure.

`src/lot3Server.test.js` (3.17 / B21) vérifiait l'ordre de déclaration
`hashPassLegacy` **avant l'objet `MASTER`** : l'objet n'existant plus, le repère
devient `masterAccount()` — l'invariant réel (« l'empreinte est produite par une
fonction déclarée avant elle », plus de dépendance au hoisting) est conservé.

---

## P23 (19/09/2026) — vérification du rapport d'audit n°4, puis correctifs P0 et P1

Le rapport n°4 a d'abord été **contre-vérifié claim par claim** : verdict et
mesures dans [`VERIFICATION-RAPPORT-AUDIT-4.md`](./VERIFICATION-RAPPORT-AUDIT-4.md)
(27 bugs confirmés à l'identique, 4 sur-évalués, 1 caduc, 4 affirmations hors code
fausses). Les corrections suivent les priorités établies par cette vérification,
et **non** l'ordre du rapport : P0 = B1 seul, P1 = B2+B3, B13, B20, B11, B5.
Un commit par grappe, `npm test` vert à chaque étape.

### P0 / B1 — une panne de connexion Neon tuait le processus (🔴)

Le pool `pg` était créé sans auditeur `'error'`. Une coupure du serveur
intermédiaire WebSocket émet un `error` sur un client **idle** — sans auditeur,
Node lève et le **processus meurt** : tout le site tombe pour une minute de
réseau. Rejoué en direct (faux serveur PG) : `exit 1` avant, processus vivant et
pool reconstruit après.

- auditeur `'error'` journalisé + invalident du pool sur rotation de `DATABASE_URL` ;
- `releaseQuietly()` au `finally` des quatre chemins transactionnels (une
  `release` sur une connexion morte ne doit pas masquer l'erreur d'origine) ;
- diagnostic exposé : `db.pool` dans `/api/db/status` (`created`, `idleErrors`,
  `lastError`, `errorListeners`) — un pool qui n'a plus d'auditeur se voit ;
- verrou : `src/p0NeonPool.test.js` (5 tests, dont l'invariant texte
  « chaque `release` est silencieuse »).

### P1 / B2 — le 500 racontait le serveur (🟠)

Mesuré : une écriture impossible répondait
`{"error":"server","message":"EACCES: permission denied, open '/chemin/absolu/store.json.tmp'"}` —
arborescence offerte à un appelant anonyme, y compris sur les routes publiques.
Le `catch` global de `server/index.js` et le filet de `api/index.js` (Vercel) ne
renvoient plus que `{ ok: false, error: 'server' }` ; le détail part en journal.

`src/deskStatusFail.test.js` **exigeait** le champ `message` : ce test verrouillait
la fuite. Il vérifie maintenant l'absence de détail interne et la journalisation.

### P1 / B3 — une URI mal encodée répondait 500 (🟠)

Dix `decodeURIComponent` à l'air libre dans le `try` géant du handler :
`/api/orders/%E0%A4%A` levait un `URIError` → 500. Ajout de `pathSegment()`
(retourne `null` sur segment indécodable) branché sur ces dix sites **et** sur
les deux routes qui ne décodent pas du tout (`GET /api/stock/:id`,
`DELETE /api/customers/:id` — incohérence relevée au passage : la recherche
portait sur `foo%20bar` là où les autres routes voyaient `foo bar`). Réponse :
**400** `invalid_code` / `invalid_id`, plus un filet `URIError` → 400 `invalid_uri`
pour les décodages hors du handler. L'autorisation garde la priorité (403 avant 400).

### P1 / B13 — une ligne sans prix fabriquait une commande à 0 DA (🟠)

`priceOf()` renvoie `null` pour un id inconnu (déjà refusé en `unknown_product`)
mais **0** pour un produit légitime dont le prix a été saisi en texte ou remis à
zéro ; la normalisation `price == null ? 0 : price` en faisait un article gratuit,
commande acceptée et stock décrémenté. Reproduit : `{items:[{id:'desk-info'}]}` →
201, `total: 0`.

- serveur : toute ligne dont le prix de référence n'est pas un nombre **strictement
  positif** est refusée — `{ ok: false, error: 'unpriced', unpriced: [{id,name}] }`,
  mappée en 400 avec les lignes en cause, même atomicité que les autres refus
  (rien n'est décrémenté) ;
- client : `orderApiFailure` classe `unpriced`, `App.jsx` la traite comme un refus
  définitif (message qui nomme les lignes, retrait du panier, les autres lignes
  restent commandables) ;
- i18n : `orderUnpriced` / `orderUnpricedDetail` en **fr et en** — `i18n.coverage`
  refuse une clé d'un seul côté comme une clé morte.

### P1 / B20 — une regex tenait lieu de validation de date (🟡)

`^\d{4}-\d{2}-\d{2}$`, recopiée **cinq fois**, acceptait `2026-02-31`,
`2026-13-01`, `0000-00-00`. Une journée inexistante entrait dans `order.day`,
dans le code `PS-20260231-0001`, dans le nom de l'export CSV et dans le filtre du
comptoir — commande introuvable dès qu'on changeait de jour. Le rapport imputait
aussi à `nextOrderCode` un `new Date(day).toISOString()` (décalage de fuseau) :
**vérifié faux**, les composants sont passés un par un depuis le lot P9.

`normalizeDay()` (dans `src/orderLogic.js`, seule fonction de validation du
projet) valide la date réelle par aller-retour dans un `Date` ; branchée sur
`day`, `pickupDate`, `setOrderPickupDate`, `nextOrderCode` et l'export CSV. Une
journée fausse à la commande retombe sur la journée locale du client ; un
`pickupDate` faux est refusé (400 `pickup_date`) au lieu de déborder sur le mois
suivant.

### P1 / B11 — la compatibilité refusait les listes qu'elle lit partout ailleurs (🟡)

`normalizeProductCompat()` n'admettait qu'une chaîne exacte :
`{socket:['AM5','LGA1700']}` → `null` → `error: 'compat'` → fiche non enregistrée.
Or les ventirads du catalogue portent déjà `compat.socket` en tableau,
`socketsMatch()` sait les comparer, la recherche et le configurateur filtrent
dessus. Effets mesurés : éditer un ventirad depuis le panneau maître **perdait ses
supports**, un CPU double socket était **impossible à saisir**, et une carte mère
déclarant `memory: ['DDR4','DDR5']` aurait fait **refuser** une barrette DDR4.

- `compatValues()` / `compatIntersects()` / `compatLabel()` dans `src/productMeta.js` :
  chaîne, liste ou chaîne à virgules ; dédupliqué, remis dans l'ordre de la liste
  de référence (un ré-enregistrement ne modifie plus le store), une valeur unique
  reste une **chaîne** (format historique), terme inconnu = refus ;
- `src/data.js` (`caseFitsBoard`, avertissements socket/RAM, détection des
  ventirads) et `src/BuilderPage.jsx` (filtres, purge du panier au changement de
  carte) comparent maintenant par **recoupement**, plus par `===` ;
- `SpecBadges` de la fiche produit rend la liste (`AM4/AM5`) ;
- panneau maître : les trois listes déroulantes uniques deviennent des **cases à
  cocher** (socket, mémoire, format) — sans cela le correctif serveur restait
  inatteignable depuis l'interface.

### P1 / B5 — le maître ne pouvait pas corriger une fiche (🟡)

`masterUpdateProduct()` n'était appelé dans `MasterPage.jsx` qu'avec
`{ photos }` : nom, prix, stock, catégorie, garantie, compatibilité s'écrivaient
uniquement à la **création**. Une fiche au prix erroné ne pouvait donc pas être
corrigée — il fallait la masquer et la recréer, donc changer d'identifiant, donc
perdre photos liées et historique de stock. Le serveur, lui, applique tout
(`sanitizeProductPatch`, `meta.productOverrides` pour les 301 fiches du catalogue
de base) : c'était un trou d'interface.

- mappages extraits dans `src/masterForm.js` (`emptyProductForm`,
  `productFormFromProduct`, `productPayloadFromForm`) : testables hors React, et
  un ré-enregistrement est idempotent (vérifié sur 40 fiches du catalogue) ;
- bouton « Modifier la fiche » par ligne, en-tête du formulaire qui bascule,
  annulation qui réinitialise, mêmes règles d'erreur qu'à la création
  (`sku_taken`, `price`, `compare_at_price`) ;
- prix : `min="1"` sur le champ (le serveur refuse 0 depuis le LOT 1.12 parce
  que ça rend la ligne incommandable — cf. B13) ;
- mode **API uniquement** : le store local n'a pas de fonction de mise à jour, le
  bouton y est désactivé avec une explication (`masterEditApiOnly`) plutôt que
  de promettre un enregistrement qui ne persisterait pas.

### Verrous ajoutés

`src/p1HttpErrors.test.js` (7), `src/p1OrderGuards.test.js` (16),
`src/p1CompatLists.test.js` (17), `src/p1MasterEdit.test.js` (13) — serveur HTTP
réel lancé à chaque grappe, donc 400/403/500 vérifiés sur le chemin complet.
Suite : **915 tests, 0 échec** (`npm run build` préalable : `bundleSecrets` scanne
le bundle).

### Reste ouvert (priorités P2 et P3 du rapport de vérification)

P2 : B6 (table partagée du comptoir, aucun bouton retour), B7 (lien OAuth des
démos), B10, B12 (divergence POST/PUT sur `name`), B28 (rate-limit, dont
`reset-password`). P3 : B4, B8, B9, B15-B19, B21-B27, B30, B32, B33, plus la
documentation du README (nombre de produits, nombre de tests et sa pré-condition
`dist/`, langue arabe retirée) et `npm run test:e2e` qui ne tourne dans aucune CI.

## P24 (19/09/2026) — P2 : le garde-fou qui a manqué, puis B28, B7, B12, B10, B6

Le lot P1 s'est terminé sur un constat désagréable : une `ReferenceError` au rendu
d'une page (un import oublié) a traversé `node --check`, le bundle esbuild et les
917 tests `node:test`. Seul le crawl de la CI l'a vue — et par un marqueur absent,
jamais par une erreur explicite. P2 commence donc par là, puis traite les cinq
items restants à portée de preuve.

### D'abord le trou : `src/moduleWiring.test.js`

Deux vérifications statiques, 0,8 s, sans navigateur :

1. **chaque module de `src/`, `server/`, `api/` doit se charger** — un
   `import { x } from './m'` pour une exportation absente est une erreur de
   liaison ESM, elle crève ici au lieu de vivre jusqu'au rendu ;
2. **aucun nom exporté par un module déjà importé ne peut être appelé dans le
   fichier sans être importé** — le cas exact de `compatLabel` dans
   `src/ProductPage.jsx` : la ligne d'import était restée à deux noms quand
   `productMeta.js` en a pris un troisième. La restriction aux modules déjà
   importés, plus le retrait des commentaires et des liaisons locales (props,
   paramètres, destructuration), donne **zéro faux positif** sur les 90 modules.

Preuve négative : retirer l'import de `compatLabel` fait échouer le test avec le
nom, le fichier et le module d'origine ; le remettre le fait passer. Constat fait
en écrivant le garde-fou : toutes les pages sont **déjà** montées en jsdom dans la
suite, sauf `ErrorBoundary` et `LegalPage` — la couverture de rendu existait,
c'est le chemin non exercé qui était aveugle.

### P2 / B28 — le 429 était neuf réponses différentes, et la route la plus chère n'en avait pas

Compté : 9 blocs `rateLimit`, dont **deux** écrivant leur refus à la main
(`error: 'rate_limited'`, sans `retryAfter` ni en-tête) — or `orderApiFailure`
(`src/orderLogic.js:230`) clé sur le statut 429 mais lit `data.retryAfter` pour
annoncer la durée : ces deux-là disaient « attendez » sans chiffre. Et `POST
/api/master/customers/:id/reset-password` **n'était pas limitée** : chaque appel
coûte deux `hashPassAsync` (scrypt, ~50 ms de CPU) sur le thread partagé avec les
commandes.

- `tooManyRequests(res, rl)` dans `server/index.js` ; les 9 sites y passent,
  `send(res, 429` a disparu du routeur ;
- limite `60 s / 5` sur le reset, posée **avant** `userFromReq` comme sur `/api/me`
  (un flot non authentifié ne doit pas coûter une lecture de base par requête) ;
- `src/p2RateLimits.test.js` (5) : le nombre de `rateLimit(` doit rester égal au
  nombre de réponses du helper — une route ne peut plus se limiter à sa façon ;
  et, serveur live, les cinq premières requêtes atteignent le 403 d'accès, la
  sixième reçoit 429 + `Retry-After` + `retryAfter` au corps.

### P2 / B7 — un compte de démonstration revendiqué par OAuth restait un compte de démonstration

`server/oauth.js` posait `demo: false` à la **création** de l'utilisateur, jamais
dans les deux branches de **rattachement**. Trois conséquences écrites noir sur
blanc dans le code : `normalizeDb` remet l'empreinte sur `DEMO_PASSWORD` à chaque
lecture (le mot de passe partagé est dans le bundle par conception du mode démo) ;
la garde S2 croit le compte encore démonstratif et laisse un callback **non
vérifié** y recoller une identité ; `/api/auth/login` répond `demo_locked` à son
propre titulaire.

`claimDemoAccount(db, user)` applique les deux règles d'un seul endroit, **uniquement
quand l'identité a été vérifiée auprès du fournisseur** (`trusted`) : marqueur retiré,
`passwordHash` à `null` (l'état « aucun mot de passe ne fonctionne », déjà prévu pour
les fixtures verrouillées — le maître peut en poser un), sessions ouvertes avec le mot
de passe partagé coupées. Sous `OAUTH_DEMO=1`, rien n'est touché : les fixtures restent
ouvrables.

`src/p2OAuthClaim.test.js` (6) dont le montage du chemin complet contre un faux fournisseur
Google (`email_verified: true`, `server/oauth.js:440`), la garde de stabilité après un
re-relu de la base, et la preuve que le S2 refuse désormais l'intrus. Neutraliser les
deux appels du helper fait échouer 4 des 6 tests.

### P2 / B12 — une fiche produit a les mêmes bornes à ses trois portes

Nom, marque et raccourci n'étaient bornés qu'à **une** porte, en dur dans
`sanitizeProductPatch` (`> 120`, `slice(0, 60)`, `slice(0, 200)`) : `createProduct`
testait `if (!name)`, `shopStore.addProduct` rien du tout et acceptait `price: 0`.
Fiche au nom de 5 000 caractères créée en 201, puis le **même** produit refusait le
moindre `PUT` en `name_too_long` — la correction passait par une suppression, donc
par la perte de l'historique de stock (le trou que P1/B11 visait).

- `NAME_LIMIT` / `BRAND_LIMIT` / `SHORT_LIMIT` dans `src/productMeta.js`, auprès des
  `MODEL_LIMIT` & co déjà partagés ; les trois portes les lisent ;
- refus (`name_too_long`) pour le champ qui identifie la fiche, troncature pour les
  champs descriptifs ; `brand: ''` au patch reste un **effacement** ;
- `shopStore.addProduct` : `price <= 0` refusé, nom mesuré — le mode local ne peut
  plus produire une fiche que l'API refuserait ;
- `maxLength` sur les trois champs du formulaire maître, comme description (2000)
  et note d'état (500) le faisaient déjà ;
- `src/p2ProductLimits.test.js` (11) : table champ × porte, plus `POST
  /api/master/products` réel (400 sur le nom, 201 et marque relue à 60 caractères).

### P2 / B10 — une fiche sans `compat` faisait tomber le configurateur

Le rapport visait `BuilderPage.jsx:419` et le disait « latent ». Mesuré : le défaut
vivait **neuf fois**, dont huit dans `src/data.js` (`cpu.compat.socket`,
`board.compat.memory`, `gpu.compat.psuMin`, les gardes à moitié écrites
`i.compat && i.compat.memory`) — et `checkCompatibility` est appelé **dans le
rendu** (`BuilderPage.jsx:26`), donc le `TypeError` produit un écran blanc, pas un
message. Les 301 produits du catalogue portent bien un `compat` ; un produit créé en
mode local ou relu d'une sauvegarde ancienne, non.

`?.` aux neuf sites. `src/p2CompatNull.test.js` (6) : matrice des formes réelles de
la donnée (absente, `null`, `{}`, clés à `null`, chaînes vides, liste) croisée CPU ×
carte mère × {barrette, GPU, alimentation, ventirad, boîtier}, plus deux **montages
jsdom** du configurateur. Double preuve négative : inverser seulement `data.js` fait
échouer 4 tests sur 6 ; inverser seulement le site de l'alerte fait échouer les deux
montages avec `TypeError: Cannot read properties of undefined (reading 'socket')`.

### P2 / B6 — la table des statuts ne connaît plus que l'avant, et un écran doit dire ce qu'il voit

`preparing → new` et `ready → preparing` répondaient 200. Aucun bouton du comptoir ne
les propose (`DeskPage.jsx:250-285`) : seul un appelant sans l'état courant les
atteint — un onglet resté ouvert, un ancien client, un script. Un aller-retour ne
touche pas le stock (re-vérifié : `4 = 5 − 1` dans les deux sens), mais la ligne
sort de la file « prêtes à retirer » et le client lit un statut faux.

- les deux arrières sont retirés de la table **unique** (le serveur l'importe, et un
  test de `src/p22UI.test.js` verrouillait le choix inverse : il est réécrit pour
  exiger la fermeture des deux côtés, tout en gardant le contrôle d'accord
  intégral client/serveur) ;
- `setOrderStatus(db, code, status, expected)` : le statut que l'écran **affiche**
  accompagne l'écriture ; désaccord → `stale`, avec l'objet commande au corps pour
  que la carte se recale. La garde court avant l'annulation, que la table ne
  contrôle pas ;
- `PATCH /api/orders/:code` répond **409** `stale` (+ `current`, `order`) — 409 et
  non 400 : la requête est correcte, c'est l'état de l'appelant qui ne l'est pas ;
  absent, le champ laisse le comportement d'avant pour les clients anciens ;
- `api.patchOrder(code, status, expectedStatus)` et `handleOrderStatus` qui lit la
  valeur affichée dans sa propre liste (`reservationsRef`), applique la vérité du
  serveur en cas de 409 et dit `deskStatusStale` (633 × 2 clés, aucune morte).

`src/p2OrderTransitions.test.js` (11) : table, accord client/serveur, garde pure, et
commande **réelle** conduite au comptoir — 200, 409 avec statut courant, 200 après
relecture, puis 400 `transition` sur les deux arrières même à jour. Neutraliser la
garde fait échouer 3 tests sur 11.

### Verrous ajoutés

`src/moduleWiring.test.js` (3), `src/p2RateLimits.test.js` (5),
`src/p2OAuthClaim.test.js` (6), `src/p2ProductLimits.test.js` (11),
`src/p2CompatNull.test.js` (6), `src/p2OrderTransitions.test.js` (11) — 42 tests de
plus. Suite : **959 tests, 0 échec**, `npm run build` préalable (le scan du bundle
lit `dist/`). Crawl : **CRAWL OK — 24 pages, 0 erreur**.

### Reste ouvert (P3)

B4, B8, B9, B15-B19, B21-B27, B30, B32, B33. Côté documentation : README corrigé sur
le nombre de tests, sa pré-condition `dist/`, les deux langues, la table de
statuts, et ajout d'un bloc « État mesuré » ; commentaires « trois langues »
corrigés dans `src/i18n.coverage.test.js` et `src/i18n.js`. Reste à relire les
derniers qui traînent dans les anciens fichiers de test (`clientFixes`, `lot2UI`,
`lot4UI`, `lot5Logic`, `lot3StorageBlocked`, `cyberDesign` — ils décrètent un état
du dépôt qui n'est plus, leurs assertions tournent déjà sur `LANGS`). Et
`npm run test:e2e` (Playwright) ne tourne toujours dans aucune CI.

---

## LOT P3 — « ce que l'écran doit dire » (audit du 19/09/2026, 18 points)

`docs/VERIFICATION-RAPPORT-AUDIT-4.md` §6 : la liste P3 est menée en quatre
grappes, un commit chacune. Le fil du lot n'est pas la donnée (aucune écriture
de commande, de stock ou de meta n'a changé de résultat) mais **ce que l'écran
renvoie quand ça rate** : un code brut, un clic muet, un « … » sans fin, un 400
là où le PUT dit 404.

### G1 — `e0175da` : B8, B9, B21, B17

- **B8** — `401 demo_locked` n'était pas dans `AUTH_ERRORS` (`src/AuthPanel.jsx`) :
  `fail()` fait `t(code)`, l'écran affichait `demo_locked`. Table exportée (elle
  était locale au module, donc un test qui la recopiait ne pouvait rien voir),
  clé `authErrorDemoLocked` dans les deux dictionnaires, et le test vérifie que
  ** chaque** code mappé existe en fr **et** en en, et ne se traduit pas par son
  propre nom. Le serveur est rejoué pour de vrai (compte démo verrouillé, sans
  `DEMO_PASSWORD`) pour prouver que le code est bien celui de la table.
- **B9** — `ProfilePage` rendait le bloc « comptes rattachés » **au maître**, que
  le serveur refuse quatre fois sur quatre ; `link()`/`unlink()` ne disaient
  rien sur un refus. Le bloc est masqué (`role !== 'master'`), les deux actions
  annoncent l'échec (`authOAuthFail`), et le déliaison demande confirmation
  (`oauthUnlinkAsk`) — c'est la seule action du profil qui défait un login.
- **B21** — « Mes commandes » de l'écran de confirmation menait au **profil**,
  d'où « Mes commandes » est sorti depuis le LOT 5.x : le client qui vient de
  réserver tombe sur un écran sans sa commande. CTA → `go('orders')`.
- **B17** — annuler une commande du serveur sans session affichait « Commande
  annulée — stock rétabli » alors que rien n'était annulé. `cancelMyOrder` refuse
  maintenant explicitement (`orderCancelNeedsLogin`) **sans toucher la copie
  locale** : ce qui est réservé hors ligne reste annulable, c'est le serveur qui
  n'a pas de session.

Le correctif a d'abord atterri sur le **mauvais bloc** (l'ancre `{apiOnline &&
mode === 'api' && (` se répète dans le JSX, le remplacements a saisi la carte du
mot de passe) — retiré, reposé sur une ancre unique (`<h2>{t('linkedAccounts')}</h2>`),
revérifié au `grep -n`. Piège consigné : une trame JSX répétée ne se remplace pas
à l'aveugle.

### G2 — `80c3d28` : B14, B19, B22, B24, B25, B26

- **B19** — `setQty` : vouloir monter la quantité d'une ligne déjà en rupture
  faisait `Math.min(0, Math.max(1, qty))` → 1… puis le `.filter(qty > 0)`
  **retranchait la ligne**. Le refus est posé avant l'écriture (`outOfStock`), et
  descendre à zéro reste le seul moyen de retirer une ligne.
- **B14** — le compteur d'essais ratés de `PartThumb` vivait sur l'**installation**,
  pas sur la fiche. Réinitialisation pendante pendant le rendu (`vu` comparé à
  `product?.id`) — pas d'`useEffect` : le badge de catégorie doit être levé **au
  premier rendu** de la nouvelle fiche, pas après un repaint.
- **B22** — `openExternal(url, '_blank', 'noopener')` : le 3ᵉ argument ne borne pas
  seulement `opener`, il fait retourner `null` à `window.open` dans la plupart des
  navigateurs, et le repli naviguait **l'onglet même** vers un lien de paiement.
  `w.opener = null` rend le même service sans l'effet de bord.
- **B24** — `prevOrderCount` : un `useRef` écrit à chaque pull du comptoir, lu
  nulle part (le badge de nouveautés vient de `markDeskOrdersSeen`). Supprimé.
- **B25** — `BRANDS` (67 marques « curatées ») n'était lu par personne : la
  recherche et la boutique déduisent les marques du catalogue. Retiré de
  `src/data.js`, et un helper pur `brandsOnSale` (`src/productMeta.js`) croise
  `BRANDS_DZ_PRIORITY` avec l'inventaire — une marque sans produit en rayon ne
  propose plus de puce qui filtre à vide, les marques hors liste restent
  joignables. Insertion ratée une première fois (le `useMemo` posé **avant**
  `catalog` → TDZ, tout le montage d'`App` tombait : 10 fichiers de test rouges) ;
  déplacé après `catalog`, avec le commentaire qui dit pourquoi.
- **B26** — `deskAudioCtx.resume()` sans `await` ni `catch` : un refus de reprise
  (onglet en arrière-plan) jetait en l'air. Repli silencieux assumé — le bip est
  un confort.

### G3 — `ac94502` : B32, B33 (et B32 rectifié)

**B32 d'abord démêlé** : le rapport parlait d'un `setEditing({kind:'client'…})`
écrit jamais lu (`MasterPage.jsx:193`). Il n'existe pas — `git log -S setEditing`
est vide, y compris à la base auditée. Le trou est ailleurs et il est double :
`buildShopView` n'opposait `hiddenPanelIds` qu'aux panneaux **de base**, et les
`extraPanels` étaient rendus en cartes décoratives, sans ON/OFF ni suppression,
avec un bouton étiqueté « Ajouter le produit ». Un panneau ajouté ne pouvait donc
ni se cacher (le clic n'existait pas, et aurait été sans effet) ni se retirer —
et comme le serveur tronque `extraPanels` à 12, le 13ᵉ était définitivement
inatteignable. `removePanel` rejoint le store, les deux commandes apparaissent
sur chaque carte, `masterAddPanel`/`masterPanelAdded` remplacent les étiquettes
héritées, et le filtre de `buildShopView` porte sur les panneaux **et** leurs
lignes de tri.

**B33** — supprimer un compte était la seule action irréversible du maître sans
confirmation (le produit a `confirmDeleteProduct`, le comptoir a
`confirmDeleteOrder`). Or l'effet est double : sessions purgées, commandes EN
COURS annulées, stock rendu. La question nomme le compte, donc le bouton passe
le client et plus son seul `id`. Deux tests de `src/lot4UI.test.js` répondent
désormais « oui » à `window.confirm` — sans quoi ils validaient le **silence** du
clic, pas le message d'après suppression.

### G4 — B4, B15, B16, B23, B27, B30 + docs périmées

- **B4** — `productsLoading` se déduisait du **résultat** (`apiProducts.length === 0`) :
  un `masterProducts()` qui échoue laisse la liste vide, donc « en cours », donc
  `…` pour le reste de la session, sans message ni retry. Le drapeau qui manque
  s'appelle `productsFetch` (`{loaded, failed}`), l'échec se dit
  (`masterProductsLoadFail`) et se rattrape (`retry`, qui incrémente `apiTick`).
  Le scénario du rapport (rechargement pendant le chargement) était **faux** — le
  `cancelled` y répond déjà ; le mécanisme, lui, était vrai.
- **B15** — le comptoir proposait « code de retrait » sur une ligne `localOnly`
  (réservation née pendant une coupure, jamais reçue par le serveur) :
  `POST /api/orders/:code/claim` → 404 → « opération échouée ». Le bouton n'est
  plus proposé, le badge explique (`ordersLocalOnlyHint`).
- **B16** — `POST /api/master/products/:id/hide` écrasait tout en 400, y compris
  le `not_found` que `updateProduct` renvoie pourtant, alors que le PUT de la même
  fiche répond 404. Deux routes, deux grilles. Alignées, avec le catalogue rejoué
  pour prouver que le 404 ne casse pas le masque/réaffichage normal.
- **B23** — `deleteCustomer(id)` oubliait `encodeURIComponent` (que `deleteOrder`
  a juste au-dessus) : un id de store local avec un point ou un `/` partait sur un
  autre chemin.
- **B27** — `PUT /api/me` stockait `avatar` et `accent` tels quels. Ces deux
  champs ne sont pas du texte libre : ce sont des **clés de vocabulaire** (les
  quatre graines de `server/db.js`), que **rien ne rend** aujourd'hui — donc une
  valeur déconnectée était du poids dans `store.json`, chaque backup et chaque
  export, plus un piège pour le premier rendu qui les interpolerait dans un nom de
  classe. Allowlist + 400 nommé, **validée avant `updateDbAsync`** (un `return`
  dans le callback d'écriture n'aurait pas répondu au client — première version du
  correctif, corrigée dans le même commit).
- **B30** — `scripts/neon-doctor.mjs` écrivait `✗ 0 produit public` puis sortait 0 :
  `npm run db:doctor && vercel deploy` déployait la vitrine vide qu'il venait de
  diagnostiquer. `bad()` lève un drapeau, le script sort 1 — et le cas « `DATABASE_URL`
  absente » (normal en dev) sort toujours 0, vérifié par `spawnSync`.
- Docs : le « 633 clés » du haut de `src/i18n.coverage.test.js` (déjà faux) est
  remplacé par l'énoncé de la parité ; `.env.example` ne dit plus que l'API
  « utilise encore `store.json` » ; `scripts/audit-crawl.mjs` ne recommande plus
  `--experimental-loader ./scripts/jsx-test-loader.mjs` (déprécié par Node) ni la
  langue `ar` ; `scripts/jsdom-crawl.mjs` ne renvoie plus à un `npm run crawl` qui
  n'existe pas ; `docs/RECETTE-RESPONSIVE-DIRECTION-03.md` idem (et « 3 langues » → 2) ;
  chiffres README remis à jour.

**B18 — décision : pas de correctif.** Le rapport demandait de durcir la
`DEMO_PASSWORD` ; le compte de démo est déjà verrouillé sans variable (`null`
hash, `demo_locked`) et c'est précisément ce comportement que B8/G1 rend lisible
à l'écran. Écrire du code pour une protection déjà en place aurait fait bouger
un contrat de sécurité pour rien.

### Verrous ajoutés

`src/p3ClientScreens.test.js` (8), `src/p3ShopSurface.test.js` (9),
`src/p3Panels.test.js` (8), `src/p3ServerHygiene.test.js` (11) — 36 tests de plus,
branchés dans `scripts.test`. Sur les trois points qui se prêtent à la preuve
négative, elle a été jouée : retirer le filtre de `buildShopView` fait tomber
`p3Panels`, retirer la remise à zéro de `PartThumb` fait tomber
`p3ShopSurface`, la garde `expected` de P2 en avait fait de même.

Suite : **995 tests, 0 échec** (`npm run build` préalable — le scan du bundle lit
`dist/`). i18n : 646 clés × 2 langues, parité vérifiée à chaque exécution dans les deux sens,
aucune clé morte.

### Reste ouvert après P3

- **B18** : assumé sans correctif (ci-dessus).
- `npm run test:e2e` (Playwright) ne tourne dans aucune CI. Le README le dit ;
  l'ajouter aux workflows demande la preuve que les navigateurs s'installent dans
  l'image de CI, pas juste une ligne de plus dans un job. **— refermé dans la
  suite du lot : voir « Portes de CI » ci-dessous.**
- Relire les commentaires d'état encore datés dans les anciens fichiers de test
  (`clientFixes`, `lot2UI`, `lot5Logic`, `lot3StorageBlocked`, `cyberDesign`) : ils
  décrètent un dépôt qui n'est plus, mais leurs assertions, elles, tournent sur
  `LANGS`.
- Le plan global (P0 → P3) est épuisé : les 33 points du rapport n°4 sont soit
  corrigés, soit réfutés avec preuve (`docs/VERIFICATION-RAPPORT-AUDIT-4.md`).

### Portes de CI — le smoke Playwright rejoint la branche (suite de P3)

Le dépôt contenait déjà tout sauf le job : `playwright.config.js` (un seul
`webServer`, `scripts/dev-all.mjs`), `e2e/smoke.spec.js` (trois parcours),
`@playwright/test` en devDependency et `npm run test:e2e` au script. Autant dire
que le smoke « la vitrine répond / le client se connecte / la session survit au
rechargement » n'était joué que sur la machine de qui y pensait — et les deux
workflows existants (Neon, crawl jsdom) ne peuvent pas le dire : jsdom ne charge
ni les polices ni le layout, et le crawl se refuse exprès les clics destructeurs.

Nouveau `.github/workflows/e2e-smoke.yml` (à l'état de `ui-audit.yml` : `pull_request`
+ `push` sur `main`, Node 22, `npm ci`, artifact en cas d'échec). Deux décisions
valent d'être écrites :

- `npx playwright install --with-deps chromium` : c'est L'ÉTAPE qui manquait à
  l'ajout d'un job e2e. Sans navigateur, `playwright test` meurt sur
  « Executable doesn't exist » et le job ne dit plus rien de l'application. Un
  seul moteur (Chromium) : le smoke n'a pas besoin de WebKit et Firefox, et
  chaque moteur ajouté est un minuteur de plus sur chaque PR.
- `DEMO_PASSWORD` est posé en fixture, et ce n'est pas un ornement : la 2ᵉ spec
  **se saute** sans la variable (le compte démo est verrouillé à dessein, lot
  1.19) mais la 3ᵉ, elle, ne se saute pas — sans mot de passe elle échouerait sur
  un état voulu. Un workflow qui laisse les deux « passer » (un sauté, un rouge)
  est pire que pas de workflow.

`playwright.config.js` gagne `screenshot: 'only-on-failure'` : l'artefact du
workflow ne contient sinon que le texte de l'assertion, et « le bouton n'est pas
visible » ne se débriefe pas à l'aveugle. Rien de payant quand tout passe.

**Ce qui n'est PAS prouvé ici** : la suite n'a pas pu être jouée dans ce bac à
sable — le téléchargement du navigateur y échoue (`Failed to download Chrome for
Testing`, CDN joignable partiellement), et aucun navigateur n'y est préinstallé.
Le YAML est parse (js-yaml), les chemins et les scripts cités existent, et
`scripts/dev-all.mjs` démarre API + front comme l'attend `webServer` ; l'étape
`install` est la réponse exacte au doute qui faisait tenir ce point ouvert. Le
premier `push` sur la branche le dira, et l'artefact le montrera.

### Balayage des commentaires d'état (suite de P3)

Dernier reste de P3 : les titres de tests qui décrètent un dépôt qui n'est plus.
Quatorze occurrences de « dans les 3 langues » / « les trois langues »
(`clientFixes`, `lot2UI`, `lot4UI`, `lot5Logic`, `lot5UI`, `lot8Claimable`,
`lot8Logic`, `lot8Product`, `notifyP19`, `reportP17`, `aboutWhatsApp`,
`lot3StorageBlocked`, plus `App.jsx:1761` et `scripts/audit-crawl.mjs`) — les
assertions, elles, itéraient déjà sur `LANGS` ou sur `['fr','en']` : **le
mensonge était dans le titre, pas dans le test**. Un titre faux se cite comme une
preuve. Les tournages au passé (« `navProfile` existait dans les 3 langues sans
jamais être rendue ») sont laissés tels quels : ils décrivent l'état d'avant,
qui est exactement ce qu'ils racontent.

Repris aussi : `README.md` — le nombre de clés i18n est mesuré (**646 × 2**) au
lieu du « 633 » publié ; `ui-audit.yml` — « les 26 pages » → 24 ;
`docs/RECETTE-RESPONSIVE-DIRECTION-03.md` — « 13 pages × 3 langues » → × 2.

Portes après ce balayage : suite complète **995/995**, `npm run build` + scan du
bundle propres, `src/i18n.coverage.test.js` vert dans les deux sens.


### Le job e2e, joué pour de vrai : deux défauts du harnais, pas de l'app

Le commit précédent ajoutait `.github/workflows/e2e-smoke.yml` sans avoir pu le
jouer (pas de navigateur dans le bac à sable). Le premier run l'a fait à ma
place, et il a raison — sur les deux specs de connexion :

```
1) e2e/smoke.spec.js:28 › demo customer can open login and authenticate
2) e2e/smoke.spec.js:54 › demo session survives a page reload
   Error: expect(locator).toBeVisible() failed
   Locator: getByRole('button', { name: /Karim B\./i })   → element(s) not found
1 passed
```

La cause n'est ni le serveur, ni la session, ni Playwright : c'est le **sélecteur
du bouton d'envoi**. La spec faisait
`getByRole('button', { name: /connexion|login|دخول/i }).last()`. En anglais,
l'en-tête et le formulaire portent le même texte (« Log in », « Log in »), donc
`.last()` tombe sur le bouton d'envoi. En français, l'en-tête dit « Connexion »
et le formulaire « **Se connecter** » : le motif ne trouve que l'en-tête, le clic
rouvre la boîte de dialogue au lieu de soumettre, aucune session n'apparait, et
l'assertion suivante meurt 5 s plus tard. Le runner a un Chromium `en-US` mais
l'application démarre en `fr` (aucune préférence en mémoire) — le test était donc
**vrai sur une machine, faux sur l'autre**, et il n'avait jamais été joué en CI :
sans `DEMO_PASSWORD`, la 2ᵉ spec se sautait (la 3ᵉ, elle, n'avait même pas de
garde — un job « vert » qui ne testait rien, exactement le piège que ce journal
registre ailleurs).

Corrigé côté spec, pas côté application (`e2e/smoke.spec.js`) :

- la spec **fixe la langue** (`localStorage.pcstar-lang` posé en `addInitScript`,
  avant la navigation) : un test qui cherche un bouton par son libellé ne doit
  pas dépendre du locale du navigateur qui le exécute ;
- les libellés viennent du **dictionnaire** (`dict[LANG].navLogin`,
  `authSubmitLogin`, `authEmail`, `authPassword`) et non d'un regex maison, avec
  `exact: true` ;
- chaque localisateur est **scopé à la boîte de dialogue**
  (`.modal-content` `has: #auth-email`) : « un bouton dans tout le document » est
  déjà le bug ;
- les deux specs de connexion partagent la même garde `besoinDemo()` : soit elles
  tournent, soit elles se sautent, mais jamais l'une sautée et l'autre rouge.

Et trois verrous dans `src/p3ServerHygiene.test.js` : `navLogin !== authSubmitLogin`
en FR mais égaux en EN (si cette parité bouge, la leçon du lot doit être relue),
l'ancre `#auth-email`/`.modal-content` toujours là où la spec la cherche, et
`/connexion|login/` **absent** de la spec — plus le nombre de gardes `DEMO_PASSWORD`.

Le même run a sorti l'autre étape du couple :

```
AUDIT FAILED (1) : ✗ rejection non gérée : performance.getEntriesByType is not a function
```

(et, sur le run d'avant, la même classe de bruit avait tué le crawl à la 16ᵉ
seconde). `window.performance` de jsdom n'expose que `now`, `toJSON`,
`timeOrigin` — vérifié, pas supposé. Le bundle, lui, sonde la Resource Timing API
(react-dom, `typeof performance.getEntriesByType == "function"`, puis lecture des
entrées de ressource pour suivre les `<link>`), et le harnais compte UNE
`unhandledRejection` comme une faute : un trou du **harnais** est imputé à
l'application, d'autant qu'il ne se reproduit qu'à un certain rythme de requêtes
(deux rejouaisons locales — base vide, base pleine — ne le montrent pas).

Le choix était entre amollir le collecteur (le rendre « soft » comme `isSoft()`
l'est pour `alert`/`confirm`) et combler le trou. Le premier est refusé : c'est
précisément le mécanisme qui a laissé passer des clics muets pendant des lots.
Donc `scripts/jsdom-perf-gaps.mjs` — `getEntriesByType`/`getEntriesByName`/
`mark`/`measure` inertes, posés en `beforeParse` des deux portes, avant que le
bundle ne tourne — et un test qui vérifie que le collecteur de rejections n'a
PAS été amolli. Le crawl rejoué localement avec le shim : **24 pages, 0 erreur**.

Comment ces deux messages ont été récupérés alors que la CI est muette ici :
`gh run view --log`, `--log-failed` et `gh run download` passent par
`results-receiver` puis `productionresultssaNN.blob.core.windows.net`, qui
répondent `EOF` depuis ce bac à sable — l'artefact `ui-audit-logs` était bien
produit, et inutilisable. D'où l'étape « queue du journal en annotation » du
commit précédent (`::error::` + le `github` reporter de Playwright) : les
annotations vivent dans l'API Checks, qui répond. **Une porte rouge qui ne dit
pas pourquoi n'est pas une porte** — c'est la deuxième fois du lot que la valeur
ajoutée est dans le rapport d'échec, pas dans le correctif.

Portes : suite **1002 tests, 0 échec** (+7 : quatre verrous sur les leçons de la
spec dans `src/p3ClientScreens.test.js`, trois sur le shim dans
`src/p3ServerHygiene.test.js`), crawl **24 pages / 0 erreur** avec le shim,
`npm run build` propre. L'audit boutons n'a pas été rejoué localement après
le shim (8 min 20 ; les deux étapes CI le font) — le test verrouille l'import et
le placement du shim dans les deux scripts.

### Issue : les trois portes CI sont vertes sur la branche

Run du `70e225c` (PR #9) :

| Porte | Résultat | Durée | Ce qu'elle jouait |
|---|---|---|---|
| `Create Neon Branch` (migrations, verrou de concurrence, backup/restore, **suite complète**) | pass | 2m34s | 1002 tests sur Node 22, base Neon éphémère |
| `Crawl 2×13 pages + clic de tous les boutons` | pass | 8m27s | 24 pages rendues, 0 erreur JS ; puis les boutons de 10 pages × 2 langues et les cinq scénarios « vide → erreur » — **l'étape qui était rouge sur `performance.getEntriesByType` est verte depuis le shim** |
| `Chromium — vitrine, connexion, session au rechargement` | pass | 49s | les trois parcours e2e, y compris la connexion au compte de démonstration et la session après rechargement — **l'étape qui était rouge sur le bouton d'envoi introuvable est verte depuis la spec scopée** |

Le rappel du lot, en une ligne : les deux échecs n'étaient pas dans
l'application, et les 995 tests verts de la veille ne pouvaient pas les voir —
l'un parce que la spec e2e ne s'était jamais jouée sans `DEMO_PASSWORD`,
l'autre parce qu'il n'existe que dans le jsdom d'un runner. Ce qui a rendu les
deux réparables, ce n'est pas un correctif de plus : c'est le fait d'avoir écrit
le journal dans une annotation que l'API Checks pouvait relà.

---

## LOT P3 (suite, 19/09/2026) — deux angles morts assumés : les moteurs du smoke, et les docs qui décrètent un état révolu

Demande explicite : couvrir **ce qui restait non couvert** après la PR #9. Deux
chantiers, et un troisième trouvé en route.

### 1. Le smoke ne regardait qu'un seul moteur

`playwright.config.js` déclarait **un** projet chromium, et `.github/workflows/e2e-smoke.yml`
n'installait que chromium. Le smoke est le seul contrôle du dépôt qui rende
l'application dans un moteur avec mise en page, polices et clavier réels — jsdom n'a
rien de tout ça, et le crawl se refuse exprès les clics destructeurs. Vérifié avant de
toucher : **aucun `src/*.test.js` ne lisait `playwright.config.js`** (`grep playwright
src/*.test.js` → 0), donc aucun verrou à satisfaire ; il a fallu en créer un, sinon la
config et le workflow redivergent — c'est exactement le motif qui avait rendu le job muet.

- Trois projets : `chromium` (`Desktop Chrome`), `webkit` (`Desktop Safari`), `firefox`
  (`Desktop Firefox`). Le parc du magasin est android (Chrome et WebView partagent un
  moteur, donc un seul suffit) ; **iOS ne peut être servi que par WebKit** et Firefox
  Android est Gecko — les deux navigateurs pour lesquels « ça marche sur ma machine »
  ne veut rien dire.
- `npx playwright install --with-deps chromium firefox webkit`, puis
  `--forbid-only` sur la commande du job : un `.only` oublié fait passer le smoke **en
  vert sans rien tester**, et un moteur déclaré mais non installé fait échouer le smoke
  sans jamais dire « le moteur manque ».
- Verrous ajoutés dans `src/p3ServerHygiene.test.js` : la liste des projets de la config
  est exactement celle que le workflow installe (dans les deux sens), chaque projet pointe
  un `devices[...]` connu, `--with-deps` est présent, et le résumé du crawl ne peut plus
  réciter un nombre de pages à la main.
- **Ce que ça ne couvre toujours pas**, écrit dans `README.md` pour que la limite soit
  lue : des desktops émuls, pas les viewport téléphones (c'est la recette responsive),
  et aucune comparaison de captures d'écran.

### 2. Neuf phrases des docs vivaient dans une époque révolue

Règle du dépôt : un **journal daté ne se réécrit pas**. Les journaux d'audit
(`AUDIT-P22`, `AUDIT-REPO`, `PLAN-CORRECTIONS`, `ROADMAP-10`, les `VERIFICATION-RAPPORT-*`,
`SECURITY-AUDIT`…) énoncent tous un état du dépôt dépassé — « 3 langues », « 36 pages
rendues », « 251 SKU », `--experimental-loader`, « 4 026 clics ». Chiffre à leur date,
donc conservé, **plus** une bannière « Journal daté » en tête des **14** journaux (et une
note append-only sur `BUGS-AND-FIXES.md`).

Corrigés, eux, parce qu'on les **exécute** :

| Doc | Ce qu'elle affirmait | Réalité mesurée |
|---|---|---|
| `docs/README.md` | index de 9 docs, « `npm test` # 34 tests », « thème, langues » dans le guide de démo | index des **28** fichiers, classés **datés / vivants**, aucun chiffre recopié |
| `docs/ARCHITECTURE.md` | « 251 SKU de base / 249 publics » ×4, « ☀/☾/◐ », « 34 tests » | 301 produits, 300 exposés ; thème fixé à `light` (`App.jsx:296`), tokens sombres en veille et toujours verrouillés par `cyberDesign.test.js` T2 ; le compte n'est plus écrit ici |
| `docs/GUIDE-DEMO.md` | le vendeur doit montrer « **ع / FR / EN** » et le sélecteur de thème | les deux commandes ont été retirées sur demande du client — la démo n'a plus ces boutons à cocher |
| `docs/GUIDE-DEMO-AR.md` | — | note en tête : le document est en arabe, **la vitrine se sert en FR/EN** |
| `docs/PORTFOLIO.md` | § 4 : « 1800 fichiers photos », « ~12 000 lignes », « **zéro dépendance côté API** », « 113 pass », « ~30 endpoints » | 2 308 fichiers, ~19 000 lignes hors tests, API sans framework avec **deux** dépendances (`ws`, `@neondatabase/serverless`), 1 025 tests, ~40 endpoints ; table des lots marquée « chiffres du jour du lot » |
| `docs/SECURITY-AUDIT.md` | (ligne que j'avais « corrigée » en 301 produits) | **rendue à sa date** (251) — une trace datée se bannière, elle ne s'amende pas |
| `docs/PROMPT-AGENT-DEPLOIEMENT.md` | « 36 pages rendues (3 langues × 13) », « 856 tests » | 24 pages (2 × 12) ; plus aucun nombre de tests dans un prompt d'agent |
| `docs/RECETTE-RESPONSIVE-DIRECTION-03.md` | 5 lignes de checklist **arabe/RTL** à cocher sur un écran, « 13 pages × 2 langues » | lignes arabe repliées dans un `<details>` « sans objet tant que la langue ne revient pas », grille FR/EN en face ; rangée « glyphes de thème ☀ ☾ ◐ » marquée sans objet |
| `README.md` (racine) | « `npm run test:e2e` existe mais ne tourne dans **aucune** CI » | faux depuis la session précédente : le job existe, est vert, et couvre trois moteurs |
| `scripts/jsdom-crawl.mjs` | imprimait « 2 langues × **13** pages » **à côté de** « **24** pages rendues » | le résumé calcule `PAGES.length` : 24 = 12 × 2. Un compteur écrit à la main dans un message de porte est un compteur qui ment à la première page ajoutée ; `ui-audit.yml` (nom du job ×3) suivi |

Un test de structure rend la règle exécutable : **`src/p3DocsAging.test.js`** (6 verrous) —
tout `docs/*.md` est classé (ajouter un doc sans le classer rougit le test), tout journal
porte sa bannière, aucune doc exécutable ne recopie un nombre de tests / une langue
retirée / « 13 pages » / l'ancien invocateur `--experimental-loader`, et `docs/README.md`
cite chaque fichier du dossier.

### 3. Trouvé en route : treize verrous écrits, verts, et jamais joués

En branchant `src/p3DocsAging.test.js` dans `package.json`, l'inventaire a montré
**deux fichiers de test absents de la liste explicite** : `src/lot1BaseScripts.test.js`
et `src/phase5Reliability.test.js`. joués à la main : **13/13 verts**. Ils n'avaient
jamais tourné en CI — même famille de panne que le job e2e muet : la porte existe, le
capteur est bon, rien ne l'appelle. Un verrou de branchement a été ajouté dans
`src/p3ServerHygiene.test.js` (tout `src/*.test.js` du disque est dans `npm test`, et
tout ce que `npm test` liste existe).

### Portes rejouées après ces modifications

| Porte | Résultat | Détail |
|---|---|---|
| `npm test` | **1025 / 1025, 0 échec** (142 s) | 1002 + 6 (`p3DocsAging`) + 13 (les deux orphans) + 4 (`p3ServerHygiene`) |
| `npm run build` → `build:crawl` → `jsdom-crawl` | **CRAWL OK — 24 pages (2 langues × 12), 0 erreur** | résumé désormais calculé |
| `audit-buttons` | **AUDIT OK — 32 vérifications**, 0 erreur JS | 496 s en local (10 pages × 2 langues + 5 scénarios vide→erreur) |
| YAML | les deux workflows parseés (`js-yaml`) | — |

**Ce que le bac à sable ne peut pas prouver** : aucun navigateur n'est installé ici
(`playwright install` échoue sur les paquets système), donc les neuf tests sur trois
moteurs ne sont pas joués localement — c'est le run de la PR qui le dira. Si WebKit ou
Firefox casse, la règle reste la même : on répare le harnais ou l'assertion dépendante
du moteur, **on n'amollit pas la porte** (ne pas retirer un moteur de la config pour
faire passer le vert : ce serait le chemin exact vers la porte muette).

### 4. Dans la foulée, en CI : une porte rouge qui ne dit rien, et un ordre de balisage qui la rendait possible

Les trois premiers lots de cette session poussés, la CI a rendu : **e2e vert sur les
trois moteurs** (chromium + webkit + firefox, 9 tests), **crawl rouge** sur
`✗ fr/orders : jsdomError: Uncaught [TypeError: Cannot read properties of undefined
(reading 'querySelector')]`. Rejoué cinq fois localement (dont deux sous saturation CPU
volontaire, 2 cœurs) : **jamais reproduit**. Trois courses disaient donc : rouge sur
`fd3d221` (qui ne touchait que des documents), vert sur `70e225c`, rouge ici.

Deux choses faites, dans cet ordre :

1. **Le harnais rend sa pile.** Le collecteur ne gardait que `e.message` ; il garde
   maintenant la tête de pile **et** les frames qui touchent `dist-crawl`/`assets/` — une
   ligne, donc lisible dans l'annotation `::error::` du job (le blob store des logs
   Actions est injoignable depuis ce bac à sable, vérifié : `gh api …/jobs/<id>/logs`
   meurt sur le transport, `--log-failed` rend du vide). J'ai par ailleurs écrit, puis
   **effacé**, un motif Popper ajouté à la liste des fautes excusées pour faire passer
   le vert : la ligne qui ferme cette liste dans `scripts/jsdom-crawl.mjs` explique
   maintenant pourquoi elle reste fermée.
2. **Un hazard réel trouvé en cherchant.** `scripts/fix-crawl-html.mjs` retire
   `type="module"` de l'`index.html` du crawl (jsdom n'exécute pas les modules) — donc
   il transformait un script **différé** en script **classique**, laissé dans `<head>`.
   Or `src/main.jsx` fait `createRoot(document.getElementById('root'))`, et `#root` est
   dans le `<body>` : un script classique du `<head>` est, spec HTML, bloquant, donc
   évalué avant que le conteneur existe. Mesuré avec le bundle réel du crawl dans jsdom :

   | position du script | erreurs | contenu rendu dans `#root` |
   |---|---|---|
   | dans `<head>` (avant) | 1 — `Minified React error #299` | 0 caractère |
   | après `<div id="root">`, avec `defer` (après) | 0 | 373 300 caractères |

   Le générateur déplace maintenant le(s) script(s) après le conteneur **et** pose
   `defer` ; `src/p3ServerHygiene.test.js` verrouille les deux (et le refus d'un
   `index.html` inattendu). La prod n'a jamais eu ce problème : son script est un
   module, différé par spéculation de parsing — c'est bien pour ça que le bug ne vivait
   que dans le harnais de la porte. Est-ce *la* cause du rouge `fr/orders` ? Pas prouvé :
   le message n'est pas #299. Ce qui est prouvé, c'est qu'une page rendue par cette porte
   dépendait de la vitesse à laquelle le serveur de preview répond — et qu'une porte dont
   le verdict dépend du cache est une porte qui ment.

Enfin, le **rouge e2e** de la même course (une seule fois, chromium, sur la reprise de
session après rechargement : le nom du compte attendu absent pendant 5 s) est une course
de la spec, pas de l'application : le test attendait un délai, il attend maintenant un
événement — `waitForResponse` sur la réponse de session, puis l'assertion de rendu.
Le verrou `6.9 (Q9)` de `src/lot6Quality.test.js`, qui découpait le fichier sur la
première occurrence du texte `page.reload()`, a été durci au passage : il retirait mal
les commentaires de suite (une phrase qui *nommait* l'appel déplaçait la découpe) ; il
découpe maintenant sur le dernier rechargement du code, commentaires exclus — un
commentaire ne peut plus ni satisfaire ni saboter ce verrou.

Portes rejouées après tout ça : `npm test` **1025 / 1025**, crawl **24 pages, 0 erreur**,
audit boutons en cours, `build:crawl` propre.

> **Note d'interruption (19/09/2026, fin de session).** Les deux derniers commits de
> cette série — `ea178e6` (le smoke attend la réponse de session au lieu d'un délai) et
> `1a07714` (le bundle du crawl est évalué après `#root`, et la porte rend sa pile) —
> sont **locaux** : la connexion GitHub du bac à sable est morte en fin de session
> (`GH_TOKEN` révoqué, `git push` et `gh api` répondent « Bad credentials »), donc ni
> poussés ni relus en CI. Ce qui est vérifié sur le dépôt distant à ce point : les trois
> moteurs e2e **verts** sur `cfb677a` (9 tests, chromium + webkit + firefox), et deux
> rouges ouverts — `UI audit` sur `✗ fr/orders` (le rouge dont parle le § 4 ci-dessus,
> que le remplacement du script après `#root` est censé fermer) et le job Neon sur
> `cfb677a` (le branchement manquant de `p3DocsAging`, corrigé dans `8f64e81`). À faire
> à la reprise : pousser, relire les trois portes en CI, et mettre à jour le corps de
> la PR #9 avec les durées mesurées.

## 19/09/2026 (soir) — LOT P4 : la vitrine du comptoir, deux boutons, le catalogue en pages, la pleine page

> **Note de reprise (même jour).** La « note d'interruption » du lot précédent se ferme
> ici : `ea178e6`, `1a07714` et `01851ff` sont poussés avec `68e2077`, la connexion GitHub
> du bac à sable étant revenue. Les portes locales du lot P4 ont été rejouées sur l'arbre
> complet avant d'être poussées (`npm test` 1057 / 1057, crawl 24 pages 0 erreur, audit boutons
> 32 vérifications 0 erreur) ; la relecture CI est relatée en fin de section.

Le client est revenu avec trois captures d'écran et une phrase qui les résume toutes :
« un pro le fait en grande page ». Cinq points, traités dans l'ordre où ils apparaissent à
l'écran.

**V1 — la tuile qui mentait.** Le hero affichait « 301 références » — un comptage du
catalogue, donc un chiffre de stock interne que personne n'était venu chercher — et
« 0 DA — paiement au retrait », un **zéro écrit en dur** sous un libellé qui prétendait
annoncer un prix. (Le lot P0 avait déjà condamné ce `0 DA` ; il est repassé par une autre
porte, la preuve est qu'il faut verrouiller la *forme* du bloc, pas sa valeur.)

La tuile devient une **vitrine à trois valeurs** :

| Valeur | Qui l'écrit | Où |
| --- | --- | --- |
| `repairsLabel` | le maître | page Admin → Vitrine |
| `repairsDone` | le maître | page Admin → Vitrine |
| `readyTally` | **le serveur** | chaque entrée réelle dans « prêt pour retrait » |

Trois décisions valent d'être écrites, parce qu'elles sont tout le lot :

1. *Le compteur de commandes ne se décrète pas.* `PUT /api/master/vitrine` ignore un
   `readyTally` reçu du corps — le test l'envoie à 500 et vérifie qu'il n'est pas écrit,
   puis qu'il n'apparaît pas à la relecture suivante. Le point est posé par
   `setOrderStatus`, à la transition, et retiré de rien : une annulation ultérieure ne
   rend pas le point (le compteur répond à « combien de fois le comptoir a prévenu un
   client », pas à « combien de cartons attendent maintenant » — choix du client, consigne
   de ce tour).
2. *Une seule échelle pour les deux côtés.* Le bornage vit dans `src/vitrine.js` et
   `server/vitrine.js` le **ré-exporte** au lieu de le redéfinir ; `server/db.js` pareil.
   Un test lit le texte des deux fichiers serveur et échoue dès qu'un `function
   clampVitrine` y réapparaît — parce qu'une règle écrite deux fois finit par avoir deux
   bornes, et que le premier symptôme visible est un formulaire qui réécrit la base à
   chaque sauvegarde (le client voit un nombre qui n'est jamais celui qu'il a tapé).
3. *La projection est une liste blanche.* `GET /api/meta` renvoie `vitrine` et non `meta` :
   demain un champ ajouté au stock du comptoir ne deviendra pas public par accident. Le
   test l'affirme sur la réponse HTTP, pas sur l'intention du code.

Lecture et écriture sont dissymétriques : la lecture est publique (c'est une vitrine),
l'écriture est au rôle maître, client authentifié compris — 403 mesuré sur
`PUT /api/master/vitrine` **et** sur la route des panneaux. Côté base, `normalizeDb`
recalle une vitrine absente : une base créée avant ce lot se lit sans migration, et une
vitrine menteuse (`-5` réparations, étiquette de 900 caractères, clé de stock glissée
dedans) rentre dans ses bornes sans que le compteur déjà en base soit remis à zéro.

**V2 — le mur de puces.** Soixante-sept marques dressées avant le premier produit, ce qui
fait, sur les téléphones du comptoir, une page entière de pouce avant le catalogue. Deux
boutons, chacun ouvrant son panneau, et le bouton **porte la valeur choisie**
(« Marques · Corsair ») pour que le filtre reste lisible une fois refermé. Le panneau est
plafonné à 45 vh et scrolle ; sa recherche ne filtre **que** la liste des marques — si elle
avait filtré aussi le catalogue, fermer le panneau aurait changé des résultats que personne n'avait
demandés. Mesure après correctif : le verrou de rendu vérifie que le panneau est
absent du document tant qu'il est fermé, que « Corsair » réduit 67 lignes à 1, et que le
catalogue suit (une seule marque dans la grille).

**V3 — le faux devis.** Le bloc « configurateur » de la page d'accueil récitait cinq lignes
de composants (Ryzen 5 7600 · 42 000, B650 · AM5 · 28 000, RTX 4060 · 54 000, 16 Go ·
45 000, 650 W 80+ · 48 000) pour un total de « 177 000 DA » et une consommation
« est. 410 W » : des nombres **écrits à la main dans le JSX**, qui ne venaient ni du
catalogue ni d'une configuration, posés à côté de contrôles de compatibilité simulés
(« [OK] Socket AM5 accepté »). Le client voyait un devis qui n'en était pas un, sur une
page dont c'était le seul bloc chiffré. Tout est retiré ; le configurateur reste à un clic
(au passage, la flèche que porte déjà la clé `openBuilder` était doublée à l'écran —
défaut introduit par ce lot, corrigé dans le même commit).

Le catalogue **enchaîne en pages de douze** (`SHOP_PAGE_SIZE`) : la maquette du client
disait dix, douze tient deux par trois sur l'écran du comptoir et ne laisse pas de colonne
orpheline. Le verrou n'est pas le nombre, c'est la coupe : page 1 → 2 → 3, trois captures
du même catalogue qui ne se recoupent pas, « Précédent » qui ramène, et les deux boutons de
bord désactivés aux extrémités.

**V4 — à la page Recherche.** « Usage » et « En magasin seulement » ne filtraient rien,
pour deux raisons différentes : le premier parce qu'un usage ne retire rien que le rayon ne
retire déjà, le second parce qu'il **ne pouvait** rien retirer — le catalogue public ne
contient que du stock (mesure P17 du rapport n°3, qui avait documenté le défaut par un
tooltip). Un filtre qui ne filtre rien est une promesse non tenue ; les deux sont partis,
desktop et offcanvas, et le rayon du catalogue est entré dans le panneau des filtres à la
place. Le verrou du P17 n'a pas été effacé avec le filtre : il est **retourné** et interdit
désormais que la clé revienne sans que personne ne lise l'état du stock.

**V5 — pleine page.** Le menu déroulant empilait six liens de 40 px sous la barre et la
modale de connexion faisait 500 px avec le clavier numérique par-dessus. Le menu devient
une feuille qui couvre la page, avec sa **propre fermeture** — la feuille masque le bouton
☰, donc sans en-tête on serait coincé dedans, ce qui est exactement le genre de détail
à 19 h 40 qu'aucune maquette ne montre ; la connexion prend `modal-fullscreen` (la classe
de Bootstrap, pas un custom) en gardant son formulaire dans une colonne de 520 px, pleine
page ne voulant pas dire texte sur 1 400. Cibles à 44 px, comme le reste du tactile.

**Harnais.** Deux tests étaient cassés par la pagination, et les deux ont été réparés sans
amollir l'attente : `lot3UI` 3.5 (B8) amène maintenant la fiche au stock de 1 par la
recherche de la page — le même chemin que le client, pas un contournement du composant —
et `lot3StorageBlocked` 3.1 mesure la première page *et* la ligne d'annonce (« page 1 sur
N », N ≥ 2), au lieu de compter trente fois plus de cartes qu'une page n'en montre jamais.
S'y ajoute un piège trouvé en écrivant le test du maître : le champ `type="number"` avec
`step="1"` **refuse** 12,7 au navigateur, qui ne soumet pas le formulaire — la borne du
modèle (`Math.floor`) reste vérifiée par l'API, où le client qui contourne le champ
reçoit quand même 342 pour « 342.9 ». Les deux niveaux sont verrouillés, pas seulement
le premier.

**Portes mesurées sur cet arbre.** `npm test` **1057 / 1057** (78 fichiers, 291 suites,
dont 31 tests dans le nouveau `src/p3Vitrine.test.js` : bornage, module serveur, routes
HTTP, rendu client, onglet maître) ; `npm run build` + scan anti-secret sur 9 artefacts,
aucun secret ; `build:crawl` propre (script différé replacé après `#root`) ; crawl jsdom
**24 pages rendues (2 langues × 12), 0 erreur** ; audit boutons **32 vérifications,
0 erreur**, dont 150 boutons cliqués sur `/master` — l'onglet Vitrine est donc ouvert,
saisi et soumis sous jsdom sans exception. Dictionnaire : **13 clés mortes retirées,
22 ajoutées** dans les deux langues, garde de couverture verte (aucune clé lue sans
traduction, aucune traduction sans lecteur).

**Relecture CI, telle qu'elle a été lue (et pas telle qu'elle était espérée).** Sur la série qui précédait ce lot, deux rouges restaient ouverts sur `dfebbac` : `UI audit` sur `✗ fr/orders` (le script du bundle évalué avant `#root`, corrigé dans `1a07714`) et le smoke e2e sur `smoke.spec.js:102` (la reprise de session attendait un délai au lieu de la réponse, corrigé dans `ea178e6`). Relancées sur `b427df4`, qui contient ces deux correctifs et le lot P4 :

| Porte CI | Verdict lu | Détail |
| --- | --- | --- |
| E2E smoke | **succès** (1 m 33 s) | trois moteurs, `--forbid-only` ; le rouge de la reprise de session ne revient pas |
| UI audit — crawl jsdom | **succès** | 24 pages, 0 erreur : `fr/orders` n'est plus jamais blâmé |
| UI audit — audit boutons | **échec** (2 rejets, un par langue) | `performance.getEntriesByType is not a function` |

Le tiers restant mérite son propre paragraphe, parce que sa forme est trompeuse. Le message désignait l'application, le harnais appelait bien son shim, et neuf exécutions locales ne le donnaient pas. En le reproduisant en trente secondes on a trouvé le vrai coupable : **le shim ne vivait que dans le realm principal**. Une iframe a son propre `window.performance`, avec les mêmes méthodes absentes — et la page « à propos » monte sa carte Google Maps *après* le premier rendu, donc après `beforeParse`. Le collecteur de rejections étant branché sur le processus, une promesse laissée par un realm non comblé devient une faute de l'app, et seule une machine assez lente pour que l'ordre des microtâches change le montre. Réparé côté harnais (le shim descend dans les frames, y compris celles qui apparaissent ensuite), sans rien ajouter à la liste des excuses du crawl ni relâcher le collecteur ; deux verrous dans `src/p3ServerHygiene.test.js`, dont celui qui rejoue le message de la CI. Après ça : crawl **24 pages / 0 erreur**, audit **32 vérifications / 0 erreur**, `npm test` **1059 / 1059**.

### Le rouge `fr/orders`, jusqu'au bout (têtes `b427df4` → `349d42b`)

Sur `d6bd55a`, la porte `UI audit` était retombée en panne à l'étape **Crawl** (et l'audit
boutons n'était donc plus jamais atteint) : `✗ fr/orders : jsdomError: Uncaught [TypeError:
Cannot read properties of undefined (reading 'querySelector')]` — un message **sans endroit**.
Le vert de `b427df4` n'avait pas tenu ; le rouge était intermittent, et dix executions locales
ne le donnaient pas.

**Première réparation : rendre la porte parlante.** L'annotation ne citait que
`reportException` et `processTicksAndRejections`, ce qui était suspect : lu dans le code de
jsdom (`runtime-script-errors.js:66`), l'exception de la page est emballée dans
`new Error('Uncaught [...]', { cause })` et seul l'emballage est émis sur le `virtualConsole`.
Autrement dit on lisait la pile du moteur, jamais celle de la page — d'où cinq têtes à
deviner. Le tri vit désormais dans `scripts/jsdom-error-pile.mjs`, partagé par les deux portes
(y compris les rejets non gérés qu'elles ne notaient pas), et ne connaît aucune liste d'excuses :
il ne peut donc pas amollir une porte.

**Ce que la pile a montré.** Le run suivant a rendu
`at getScript (https://maps.googleapis.com/maps/api/js?key=…&callback=onApiLoad:23:35)` —
la faute levait **dans le chargeur de Google Maps**, pas dans le bundle. Le mécanisme complet
tient en trois faits : `useJsApiLoader` (`@react-google-maps/api`) est monté par la carte du
rendez-vous dès que la clé publique est dans le build — donc **sur le runner**, pas chez nous ;
`resources: 'usable'` faisait le crawl chercher et évaluer ce script ; et l'API réelle lève chez
elle dans un DOM qui ne peut pas la représenter. L'intermittence était le réseau du runner ; le
silence local aussi (mesuré : une récupération de script échouée ne produit **aucun**
`jsdomError` dans jsdom 30 — la porte était donc verte pour la mauvaise raison).

**Seconde réparation : un mécanisme, pas un filtre.** `scripts/jsdom-subresources.mjs`
neutralise toute sous-ressource hors de l'origine de la porte **avant la requête**, par
l'intercepteur `resources` de jsdom, avec une réponse inerte du bon type par élément (script
vide, feuille vide, document vide) — exactement ce que verrait un navigateur privé de sortie
Internet : l'élément `load`, l'API n'est jamais appelée, la zone reste en attente. Aucun
message d'erreur n'est apparié, aucune URL n'est énumérée, la liste d'excuses du crawl n'a
pas bougé d'un caractère. Détail d'implémentation qui vaut d'être su : **jsdom 30 n'a plus de
`ResourceLoader`** (le point d'extension classique a disparu ; `require('jsdom')` ne rend que
`JSDOM`, `VirtualConsole`, `CookieJar`, `requestInterceptor`, `toughCookie`) — c'est l'option
`resources: { interceptors: [...] }` qui fait le travail, et subclasser `jsdom.ResourceLoader`
aurait fait planter les deux portes au premier appel.

**Portes mesurées sur cet arbre.** crawl jsdom **24 pages rendues, 0 erreur** avec
l'intercepteur branché ; audit boutons **32 vérifications, 0 erreur**, `fr/orders` et
`en/orders` cliqués (150 boutons chacun) sans exception ; `npm test` **1065 / 1065**, dont
**6 nouveaux verrous** dans `src/p3ServerHygiene.test.js` — la pile de la `cause` conservée et
dédupliquée, les entrées bizarres qui ne cassent pas la porte, la politique d'origine sur dix
cas d'URL, un jsdom vivant qui prouve que le bundle same-origin est toujours évalué pendant
que le tiers est neutralé sans faute, et le câblage des deux portes (un `resources: 'usable'`
nu retrouvé fait rougir le test). **Relu sur la CI (`7acffad`) — les trois portes sont vertes.** `UI audit` **succès en 7 m 29 s**
(l'étape Crawl passe et l'audit boutons est enfin atteint, ce qui prouve que les deux sont
tombés d'accord), `E2E smoke` **succès** (Chromium + WebKit + Firefox), `Create Neon Branch` +
`Setup` **succès**. La panne n'était donc pas la nôtre : elle était dans une porte qui
exécutait du code de Google Maps et dépendait de la sortie Internet du runner. Les cinq têtes
rouges n'avaient rien de mystérieux — elles avaient juste un message qui ne disait pas où, et
le harnais avait raison de nous faire confiance sur la forme : la faute levait bien dans un
`<script>`, simplement pas dans le nôtre.

## 19/09/2026 (fin de soirée) — LOT P5 : relire l'application, pas la porte

Les têtes précédentes avaient fermé la **porte** (le crawl ne dépend plus du réseau du
runner). Cette jambe a repris le chemin inverse : **sonder l'application** — soixante
entrées méchantes contre le serveur local vivant, puis lire chaque réponse au lieu de la
juger. Quatre défauts sont sortis de là. Ce qui compte autant que les quatre : **les
quarante-six autres cas ne sont pas des défauts**, et ils attestent des acquis précédents —
bornes de `placeOrder`, table de transitions (un `new → ready` accepté, un `picked → ready`
refusé puisque `picked` est terminal, compteur `readyTally` pointé une seule fois), panneaux
réfusés sur `id: '__proto__'` comme sur 5 000 entrées, échappement CSV (`'=HYPERLINK(…)'`
reprend une apostrophe, CRLF ne casse plus la ligne), absence totale de `fetch` sortant côté
serveur (donc pas de SSRF par `photos`), `carrier` recalculé depuis le téléphone et non pris
du corps, `slot` validé contre `SLOTS`, nom de commande borné, 403 systématiques sans jeton,
et un 429 à trois commandes depuis la même IP.

### P5-1 — tous les bornages comptaient des unités UTF-16, et coupaient les emoji en deux

**Mesuré** sur la tuile que le maître écrit (`PUT /api/master/vitrine`), libellé « a » + 48 🧰,
soit 49 caractères :

| Observation | Avant | Après |
| --- | --- | --- |
| valeur stockée | 48 unités / 25 caractères, dernier code **U+D83E seul** | 48 caractères / 95 unités, aucune moitié orpheline |
| `GET /api/meta` (public) | renvoyait le U+D83E orphelin → le visiteur voit `?` | texte entier |
| nom de commande de 33 emoji (66 unités) | **400 `name`** | 201, enregistré en 33 caractères |
| nom de produit de 60 emoji (120 unités = la borne) | créé puis tronqué | conservé entier |

Ce n'était pas un détail d'affichage : le demi-caractère était **écrit dans la base**,
resservi à chaque visiteur, et il partait aussi dans l'export CSV et dans le message WhatsApp
au maître. `.length` et `.slice(0, N)` parlent en unités ; un humain compte des caractères —
et le `maxLength` du formulaire, lui, comptait déjà en caractères : les deux côtés
n'avaient pas la même échelle.

Réparé par un module partagé sans effet de bord, `src/textClip.js` (`countChars`, `clipChars`,
`repairPaires`), branché sur `cleanProductText` (donc marque, modèle, description, note d'état,
tags), `normalizeNeeds`, la borne `name_too_long` du serveur, la borne de 64 du nom de
commande et `clampVitrineLabel`. `repairPaires` s'applique aussi **à la lecture**, parce
qu'une base écrite avant le correctif porte encore le demi-caractère : vérifié sur le
`store.json` de la sonde, `orphelines: 0`.

### P5-2 — le compteur de la vitrine dévorait les booléens

`applyVitrineEdit` tenait sur `Number.isFinite(Number(done))`, ce qui valide tout ce que JS
sait convertir. Mesuré, cinq valeurs : `{repairsDone: true}` → **200, enregistré 1** ;
`[12]` → **200, enregistré 12** ; `'1e3'` → **200, enregistré 1000** ; `1e9` (au-dessus du
plafond) → **200, ramené en silence à 9 999 999** ; seul `{}` était refusé. La règle vit
désormais dans `src/vitrine.js` (`formeCompteur`, `estCompteurVitrine`) : un nombre fini ≥ 0,
ou une chaîne de chiffres — rien d'autre. La route **refuse** (400 `vitrine_count`, et le
formulaire a déjà son message `masterVitrineBadCount`), l'affichage **borne** : une base
ancienne ne doit jamais faire planter le hero. `12.9` continue d'arrondir à 12 — contrat déjà
verrouillé côté API, le `step="1"` du champ refusant avant.

### P5-3 — un `upgrade` reçu après la fermeture du socket Desk tuait le serveur

Le handler `upgrade` posé par `attachDeskSocket` lisait la variable de **module** `wss`, que
`closeDeskSocket()` met à `null`. Un `upgrade` arrivant après une fermeture (rechargement à
chaud en dev, démontage gracieux — et le `after()` de la suite de tests, donc ce chemin est
parcouru à chaque execution) levait un `TypeError: Cannot read properties of null (reading
'handleUpgrade')` **synchrone dans un `EventEmitter`** : aucun `try/catch` d'appelant ne
l'attrape, le serveur tombe. Second défaut du même coup d'œil : rappeler `attachDeskSocket`
sur le même serveur empilait un deuxième écouteur, donc `handleUpgrade` deux fois sur la même
socket.

Réparé par un état par attache (`attaches: Map<Server, { wss, onUpgrade, ferme }>`) : garde en
tête du handler, écouteur retiré au démontage, re-attache qui remplace l'ancienne. Verrouillé
en appelant l'écouteur directement sur un serveur nu — un test qui prouverait la panne en la
provoquant tuerait le runner au lieu de le faire rougir.

### P5-4 — le « bornage mémoire » du rate-limit ne bornait rien

P10 (P7-9) balayait les buckets expirés au-delà de 1 024 clés. **Mesuré** avec des clés qui
tournent (un `X-Forwarded-For` qui varie, ou un parc d'IP) : 20 000 clés fraîches dans la même
fenêtre → `buckets.size` = **20 000** (aucun plafond, le balayage ne retire que les expirés)
et **2 069 ms** de CPU pour ces seuls appels — parce que le balayage O(taille) était retenté
**à chaque appel** une fois le seuil dépassé, donc sur toutes les requêtes légitimes qui
suivaient, à ~100 µs par requête. Un frein devenu accélérateur d'enlisement.

Depuis : balayage espacé d'au moins 1 s, et plafond dur de 4 096 buckets avec éviction par la
tête — donc les plus anciennement insérés, dont la fenêtre est la plus avancée ; les clés
récentes (l'attaquant en cours) restent comptées. Mesuré après : **39 ms** pour les mêmes
20 000 appels, taille 4 096, et comptage par clé intact (20 passées sur 30 tentatives,
`retryAfter` entre 1 et 60). Ce que la garde garantit est désormais écrit : la mémoire et le
temps de réponse, pas le comptage de chaque IP — un évincé repart sur une fenêtre neuve.

### Et deux vieilleries du même coup

`maxLength="2000"` et `maxLength="500"` restaient écrits à la main dans le formulaire produit
— les deux derniers du fichier — alors que `DESCRIPTION_LIMIT` et `CONDITION_NOTE_LIMIT`
existent et que `p2ProductLimits` interdit ce motif côté serveur : au prochain bornage, le
champ laisse saisir ce que l'API coupe, sans un mot. Les deux lisent maintenant les
constantes, et un verrou interdit tout `maxLength` littéral dans la page Admin.
Second point : `src/format.js` promettait encore « `دج` en arabe » et `ar-DZ` en exemple de
`localeFor` dans son JSDoc, alors que la table n'a plus d'entrée arabe depuis le LOT 6.x — la
prose qui **raconte** le défaut historique reste, la promesse d'API est alignée.

### Ce qui n'est pas réparé, et pourquoi

`withDbLock` attend le verrou fichier en **bloquant la boucle d'événements** (jusqu'à
`LOCK_TIMEOUT_MS`, 4 s). C'est un risque réel mais non corrigeable ici sans en ouvrir un
autre : la contention suppose deux processus sur le même `PCSTAR_DATA_DIR`, configuration
que le dépôt exclut (le conducteur Neon, lui, verrouille la ligne sans bloquer personne), et
raccourcir l'attente ferait écrire **sans verrou** plus souvent — donc perdre des
réservations de stock, ce qui est le défaut que le verrou a été écrit pour tuer. Noté,
laissé, assumé.

**Seize verrous** portent là-dessus : 4 dans `src/lot2Logic.test.js` (le module de coupe, les
champs produits, les bornes qui refusent en caractères, le grep anti-régression sur les
routes), 6 dans `src/p3Vitrine.test.js` (libellé compté en caractères, réparation à la
lecture, compteurs refusés et admis, code de la route, constantes du formulaire), 3 dans
`src/p2RateLimits.test.js` (plafond, coût amorti, comptage légitime intact), 3 dans
`src/lot3Server.test.js` (re-attache, `upgrade` après démontage, garde dans le code).

**Portes mesurées sur cet arbre.** `npm test` **1081 / 1081** (298 suites) ; `npm run build`
**489,79 kB** (146,84 gzip) avec le scan anti-secret sur 9 artefacts, aucun secret ;
crawl jsdom **24 pages rendues, 0 erreur** avec l'intercepteur de sous-ressources en place ;
audit boutons **32 vérifications, 0 erreur** (150 boutons cliqués par page et par langue,
`/master` compris — donc les deux `textarea` et le champ vitrine modifiés sont bien ouverts,
saisis et soumis sous jsdom).

**Relu sur la CI (`afd85da`) — tout est vert, et les trois portes avec.** `UI audit`
**succès en 7 m 31 s** (les deux étapes, crawl puis audit boutons), `E2E smoke` **succès**
(1 m 27 s, trois moteurs), `Create Neon Branch` + `Setup` **succès**, Vercel **succès**. Deux
heads de suite vertes à cette porte : la déterminité gagnée sur le harnais n'a pas masqué les
défauts de l'application — les quatre ci-dessus ont été trouvés **après**, en sondant le
serveur, et non en attendant qu'une porte rougeoie.
