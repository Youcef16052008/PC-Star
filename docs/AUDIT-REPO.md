# Audit complet du repository PC Star — 10/09/2026

Audit ligne par ligne, fichier par fichier : `src/*` (21 fichiers), `server/*` (7), `api/*` (1),
`scripts/*` (4), config (`index.html`, `vite.config.js`, `vercel.json`, `.gitignore`, `.env.example`,
`.vercelignore`, `package.json`), 5 fichiers de test, 1800 photos (`public/photos`).

**Vérifications exécutées pendant l'audit :**
- `npm test` → **34/34 OK** (node:test)
- `npm run build` → OK (395.9 kB JS / 118 kB gzip)
- `npm run smoke` (e2e live : health, catalogue 250, login, commande PS-20260910-0001, me-orders, master, OAuth, front, robots) → **OK**
- Créé un produit en live via l'API master (`TEST AUDIT`, stock 7) → bien servi par `/api/catalog` (stock correct, route `/api/upload-file` présente)
- i18n : 239 clés statiques + toutes les clés dynamiques (`cat_*`, `line_*`, `tag_*`) → **complètes en ar/fr/en**
- Catalogue : 250 SKUs, aucun `related` orphelin, ids des presets builder existent, 1800 photos présentes
- PartThumb (fallback webp→jpg), placeOrder (réservation atomique + rollback), codes `PS-YYYYMMDD-XXXX`, CSV, backup, rate-limit, OAuth démo → **corrects**

**Invalides (vérifiés, ce ne sont PAS des bugs) :**
- alerte socket du builder → déjà i18n (`t('toastSocket')`)
- labels CATEGORIES / PART_LINES → rendus via `t('cat_…')` / `t('line_…')`
- stock des produits créés par le master → `createProduct` appelle `setStock` (vérifié en live)

---

## 1. Bugs trouvés (cités avec file:line)

### 🔴 Critique

**B1. Perte totale de la base de données (silencieuse)** — `server/db.js:136-139` — ✅ CORRIGÉ (P1)
```js
} catch {
  const db = emptyDb()
  writeDb(db)   // écrase le fichier corrompu
  return db
}
```
Si `store.json` est illisible (JSON tronqué — possible car `writeDb` L143-145 fait un
`fs.writeFileSync` **non atomique** : un crash pendant l'écriture tronque le fichier),
la catch **écrase la base avec une base vide** : tous les utilisateurs inscrits,
commandes, stocks, sessions sont perdus, sans log ni backup. Double mode de défaillance :
écriture non atomique + récupération destructive.

### 🟠 Haute

**B2. En mode API, la boutique affiche le catalogue statique (pas le catalogue serveur)** — `src/App.jsx:166` + `src/App.jsx:270-277` — ✅ CORRIGÉ (P2)
`buildShopView(PRODUCTS, …)` = catalogue statique ; la réponse de `GET /api/catalog`
n'est exploitée que pour `map[pr.id] = pr.stock` (stockMap). Conséquences en production
(Vercel) :
- un produit **masqué par le master reste visible** (et achetables) dans la boutique ;
- un produit **créé par le master n'apparaît jamais** (vérifié en live : `TEST AUDIT` invisible sur le site) ;
- `MasterPage` reçoit aussi `products={catalog}` (`src/App.jsx:1164`) → le master ne voit
  ni ses créations ni ses masquages. La promesse « multi-device : master add/hide » est rompue côté client.

**B3. Le serveur fait confiance au total et aux prix envoyés par le client** — `server/catalog.js:52-80` (`placeOrder`) — ✅ CORRIGÉ (P1)
`price: Math.max(0, Number(i.price) || 0)` et `total: body.total != null ? Number(body.total) : …`.
Rien n'est recalculé depuis le catalogue : un client peut envoyer un total inférieur
(ex: 1 DA) et le desk affichera ce total. (Paiement espèces au comptoir → impact limité
mais réel : le desk est la source de vérité affichée.)

**B24. Le masquage des produits CRÉÉS PAR LE MASTER est ignoré** — `server/masterApi.js:95-110` (`updateProduct`, branche extra) + `server/catalog.js:92-97` (`publicCatalog`) — ✅ CORRIGÉ (P2, découvert pendant sa validation)
Découvert en testant B2 en live : `hideProductMaster(db, extraId, true)` renvoie `ok` mais
le produit reste visible. Triple faille :
- `updateProduct` (branche `extra`) ne gère pas `patch.hidden` (seule la branche catalogue
  alimente `db.meta.hiddenProductIds`) ;
- `publicCatalog` ne filtre PAS les `extraProducts` avec `hiddenProductIds` (même si le
  masquage était enregistré, le produit serait servi) ;
- `listMasterProducts` hardcode `hidden: false` pour les extras → le master ne voit jamais
  l'état réel.
Conséquence : un produit master masqué restait visible (et achetables) sur toutes les
autres sessions. Fix : `patch.hidden` géré dans la branche extra, `publicCatalog` filtre
les extras, `listMasterProducts` rapporte `hidden` réel. (B23 bis : sans B2 — catalogue
statique côté client — ce bug était invisible sur le site.)

### 🟡 Moyenne

**B4. Aucune gestion d'erreur réseau côté client** — `src/api.js:24-44` (`req()`) — ✅ CORRIGÉ (P2)
`fetch` n'est pas enveloppé dans un try/catch : toute erreur réseau (proxy, timeout,
backend en redémarrage) → Promise rejetée **non gérée** aux ~20 appels :
- `src/App.jsx:267-288` (effet initial), `:381` (**polling desk toutes les 20 s** → spam de rejets), `:575` (checkout → pas de fallback local, échec silencieux), `:452` (logout → échec silencieux, resté connecté) ;
- `src/AuthPanel.jsx:77, 94, 115` (login/register/OAuth → échec silencieux) ;
- `src/MasterPage.jsx:76, 125, 128, 148, 198`, `src/DeskPage.jsx:105` (CSV), `src/ProfilePage.jsx:25, 96, 101`.

**B5. Toast mensonger « commandes synchronisées » après échec API** — `src/App.jsx:623` — ✅ CORRIGÉ (P2)
Dans `reserve()`, si `api.postOrder` échoue (5xx, ou 4xx ≠ 409), on bascule en commande
locale puis : `setToast(apiOnline ? t('ordersSynced') : t('ordersLocalOnly'))` → le client
croit que le desk a sa commande alors qu'elle est **locale uniquement**.

**B6. Échec d'auth serveur → repli sur le login local** — `src/AuthPanel.jsx:94-100` (login), `:115-120` (register) — ✅ CORRIGÉ (P2)
En mode API, un 401 (mauvais mot de passe) fait retomber sur `loginEmail(users, …)` avec
les identifiants localStorage : si le même email existe localement avec le bon mot de
passer local, l'utilisateur **passe le contrôle du serveur**. Le repli local ne doit se
faire que sur erreur réseau (offline), jamais sur rejet d'authentification.

**B7. Avertissements de compatibilité en anglais durci (mélangé au français)** — `src/data.js:684-830` (`checkCompatibility`)
Exemples : `“Risk of surchauffe under load.”` (L706), `“too high gamme”`, `“Pick a higher-end board.”`
→ affichés dans le panier (`src/App.jsx:~1210`, alertes danger/warning) et dans le builder,
pour les utilisateurs **AR et FR**. ~15 messages, aucun ne passe par i18n.

**B8. Textes de contenu durcis hors i18n (AR/FR concernés)**
- `src/data.js:11-34` : `STORE` (about/services/buyNote/hours/note/warranty/ready) + `SHOP_SERVICES` → **anglais**, page À-propos (`src/App.jsx:1060-1080`).
- `src/data.js:228-262` : `REVIEWS` → **anglais**, affichées sur la fiche produit (`src/ProductPage.jsx:149`).
- `src/data.js:160-186` : `GUIDES` → **français**, accueil (`src/App.jsx:864-870`).
- `src/data.js:152-159` : `DEALS` (notes) → **français**, accueil (`src/App.jsx:804-812`).
- `needs` : `src/extraCatalog.js:10` (anglais, identique pour les 150+ produits EXTRA), `src/dzCatalog.js:17` (français, identique pour tous les DZ), `src/data.js` PRODUCTS_CORE (anglais, 20 produits) → affichés sur la fiche produit.
- `src/App.jsx:99-105` : `cartMessage` → message WhatsApp **anglais** (`“please prepare this for pickup…”`).
- `src/App.jsx:92` : tooltip Stars `“from X reviews”` → anglais.

**B9. MasterPage en mode API : 3 trous** — `src/MasterPage.jsx` — ✅ CORRIGÉ (P2)
- L82 : toast `t('authErrorPassword')` à l'échec de **création produit** (message sans rapport) ; L150 : `t('masterForbidden')` à l'échec du masquage.
- L161-162 : `doDeleteCustomer` → **local uniquement** (`deleteCustomer(users, …)`), aucun appel serveur — alors que l'endpoint existe (`DELETE /api/customers/:id`, `server/index.js:604`). Le client « supprimé » reste dans l'API (et dans les autres onglets du master).
- L172, L177 : panneaux (`togglePanel`/`addPanel`) → **local uniquement**, aucun endpoint serveur → les panneaux custom sont perdus en mode API (silencieusement).

**B10. Limites de taille de body sur Vercel (risque production)** — `api/index.js:20-23`
`config.api.bodyParser.sizeLimit: '4mb'` : forme héritée, risque d'être ignorée par le
runtime Vercel moderne (défaut ~4,5 MB). Les uploads photos master vont jusqu'à
**6 × 2,5 Mo en base64 ≈ 20 Mo de JSON** (`server/masterApi.js:15-16`) → 413 probable
sur Vercel, alors que ça passe en local (node pur, sans limite). À vérifier/débloquer en prod.

### 🔵 Faible / mineur

- **B11.** Sessions qui n'expireront jamais : `db.sessions` croît sans limite (`server/oauth.js:117`, `server/db.js`) ; `db.oauthPending` orphelin si l'utilisateur abandonne l'écran de consentement (`server/oauth.js:37`, suppression seulement à L118).
- **B12.** Fichiers photo orphelins `tmp-*` : `server/index.js:486-499` — les photos sont d'abord enregistrées sous l'id `tmp`, puis ré-enregistrées sous le vrai id ; les fichiers `tmp-*` ne sont jamais supprimés (fuite disque à chaque création de produit avec photos).
- **B13.** `DELETE /api/customers/:id` (`server/index.js:604-617`) : supprime l'utilisateur sans nettoyer ses sessions (tokens restant valides) ni réinitialiser `userId` dans ses commandes. — ✅ CORRIGÉ (P1)
- **B14.** Code mort : `src/icons.jsx` (jamais importé) ; `COMPARE_FIELDS` (`src/data.js:~840`, feature compare supprimée) ; `photoSkeletonClass` (`src/media.js:70`, non utilisée) ; `startSms`/`verifySms`/`loginGoogle`/`ACCENTS`/`AVATARS` (`src/shopStore.js`, features retirées de l'UI mais encore testées dans `src/shopStore.test.js`) ; variable `left` inutile dans `reserve()` (`src/App.jsx:~590`).
- **B15.** `src/ProfilePage.jsx` : carte « commandes » toujours vide en mode local (seul l'API fetch `/api/me/orders`) ; le formulaire n'est pas re-synchronisé au changement d'utilisateur (masqué par la navigation login→boutique).
- **B16.** `src/index.css:2-24` : `:root` = thème sombre appliqué avant le JS → **flash sombre** au premier rendu pour les utilisateurs en thème clair.
- **B17.** `index.html:22-24` : Bootstrap CSS + Google Fonts servis par CDN (jsdelivr) → site **sans style** si le CDN est bloqué (prod) ; SRI présent mais la dépendance externe reste.
- **B18.** Mode local : les décrets de stock sont en mémoire uniquement (`stockMap`) → perdus au rechargement (les réservations locales sont persistées, pas le stock). Contrainte de conception — à documenter.
- **B19.** Téléphone du master = téléphone du démo yacine (`0770650387`, `src/shopStore.js:2,120`) → un login SMS local sur ce numéro retombe sur le **master** (premier match dans la liste des users).
- **B20.** `src/App.jsx:~545` `setQty` : le max est `product.stock` (statique) ; en mode API si le stock serveur a baissé, le client peut mettre plus dans le panier que le disponible réel (le serveur bloque ensuite au 409 — gardé, mais UX confuse).
- **B21.** Docs datées (PR #2) : `docs/ARCHITECTURE.md` §2 (routage par hash — faux, le site est une SPA à pages d'état) ; `docs/PROBLEMS-SOLUTIONS.md` entrée 20 (citation « §7 »).
- **B22.** (Info) Identifiants master/démo présents dans le bundle client (`src/shopStore.js`) et le serveur — par conception démo, documentés, mais à garder en tête pour la prod réelle.
- **B23.** (Info) `server/catalog.js:~79` : historique des commandes plafonné à 500 (`.slice(0, 500)`) — au-delà, les plus anciennes disparaissent. En Vercel, `/tmp` est éphémère de toute façon (documenté).

---

## 2. Solutions

### B1 — Intégrité de la base
- `writeDb` atomique : écrire dans `store.json.tmp` puis `fs.renameSync` (rename atomique sur le même FS).
- Récupération non destructive dans la catch de `readDb` : copier le fichier corrompu vers
  `store.json.corrupt-<timestamp>` (1 backup max) **avant** de partir sur `emptyDb()` ;
  log `console.error` avec la reason. La base repart propre mais le fichier corrompu reste analysable.
- Test : écrire un JSON tronqué → `readDb()` → assert base vide **et** fichier `.corrupt-*` créé.

### B2 — Catalogue dynamique côté client
- `server/index.js:367-378` : servir `publicCatalog(db)` **tel quel** (déjà l'objet complet
  `{...p, ...overrides, stock}` + extras) au lieu de le remapper en sous-ensemble de 9 champs
  (compat/needs/rating/related manquants aujourd'hui — le builder et la PDP en ont besoin).
- `src/App.jsx` : état `serverCatalog` (array) rempli dans l'effet initial et `refreshStock()` ;
  `const catalog = apiOnline && serverCatalog.length ? serverCatalog.map(ensureProductPhotos) : shopView.products`.
  → Boutique + SearchPage + BuilderPage + MasterPage deviennent tous dynamiques (masquage,
  créations, stock live, overrides de prix master) et MasterPage reçoit le bon `products`.
- Garder le fallback statique si l'API est offline (comportement actuel).

### B24 — Masquage des produits extra (master)
- `server/masterApi.js` `updateProduct` (branche `extra`) : traiter `patch.hidden === true/false`
  en écrivant `db.meta.hiddenProductIds` (comme la branche catalogue).
- `server/catalog.js` `publicCatalog` : `.filter((p) => !hidden.has(p.id))` sur `extraProducts`.
- `server/masterApi.js` `listMasterProducts` : `hidden: hidden.has(p.id)` au lieu de `false`.
- Tests : unitaire (hide/unhide extra → `publicCatalog` + `listMasterProducts`) et
  intégration HTTP (masquage via route → disparaît de `/api/catalog`).

### B3 — Recalcul serveur des prix
- Dans `placeOrder` : pour chaque ligne, `price = priceOf(db, id)` où `priceOf` lit le prix du
  catalogue de base ou de `db.meta.extraProducts` (ids inconnus → refus `stock` comme aujourd'hui,
  car `liveStockOf` = 0) ; `total = Σ qty × price`. Ignorer `body.total`/`i.price`.
- Test : commande avec `total: 1` → assert `order.total` recalculé.

### B4 — Gestion réseau centralisée
- `src/api.js` `req()` : `try { … } catch { return { ok: false, status: 0, offline: true } }`.
  Un seul point de fix protège les ~20 appels ; aucune promesse non gérée.
- `reserve()` : si `r.offline` → fallback local + toast `ordersLocalOnly` (voir B5).
- Desk polling, logout, OAuth callback : deviennent silencieux et sûrs (l'état existant est gardé).

### B5 — Toast honnête
- `src/App.jsx:623` : après un repli local (échec API 5xx/4xx≠409/offline) →
  `setToast(t('ordersLocalOnly'))` (jamais `ordersSynced`). Réserver `ordersSynced` au vrai succès serveur (L582).

### B6 — Pas de repli local sur rejet d'auth
- `src/AuthPanel.jsx` : repli local uniquement si `r.offline` (réseau mort). Si l'API a répondu
  (401/400/429/500) → afficher l'erreur (`fail(r.data?.error || 'auth')`) et **ne pas** essayer
  le store local. Idem pour le register (le 429 `error:'rate'` mérite sa clé i18n `authErrorRate`).

### B7 — i18n des avertissements de compatibilité
- `checkCompatibility` retourne des `{ key, vars }` (ex: `{ key: 'compatVrmHot', vars: { cpu, board, tdp } }`) ;
  le préfixe `BLOCK:` devient `block: true`. `splitWarnings` adapté.
- ~15 nouvelles clés `compat*` dans `src/i18n.js` (ar/fr/en), rendues par `t(key, vars)` dans le panier et le builder.

### B8 — i18n du contenu
- `STORE.*` + `SHOP_SERVICES.*` → clés i18n (`storeAbout`, `storeServices`, `storeBuyNote`, `storeHours`, `storeNote`, `storeWarranty`, `storeReady`, `svc*Title`/`svc*Body`) ; `STORE` garde les données (téléphone, adresse, URLs) hors i18n.
- `needs` : 1 seule clé i18n pour EXTRA (string unique) + 1 pour DZ (string unique) + clés par produit pour les 20 core (`needsCpu7800x3d`…) ou une clé générique `needsAtDesk`.
- `REVIEWS` : soit i18n par produit (clés `revCpu7800x3d1`…), soit suppression (contenu démo) — recommandation : les 8 sets en clés i18n, c'est court.
- `GUIDES` : remplacer par des entrées `{ titleKey, bodyKey }` (modèle de `DZ_GUIDES` déjà en place) — 5 guides.
- `DEALS.notes` → `noteKey` (modèle de `DZ_DEALS`).
- `cartMessage` → clé `waMessage` avec `{slot}`, `{total}`, `{items}` ; titre des Stars → `t('xReviews', {n})`.

### B9 — MasterPage API
- Toasts : `masterCreateFail` / `masterActionFail` (nouvelles clés) au lieu de `authErrorPassword`/`masterForbidden`.
- `doDeleteCustomer` : en mode API → `api.deleteCustomer(id)` (méthode à ajouter dans `src/api.js`, l'endpoint serveur existe déjà) ; toast d'erreur si échec.
- Panneaux : en mode API, désactiver l'UI « panneaux custom » + note (`panelsLocalOnly`) — le serveur n'a pas d'endpoint. (Option phase 2 : ajouter `/api/master/panels` qui persiste `db.meta.extraPanels/hiddenPanelIds`, déjà présents dans le schéma du serveur.)

### B10 — Vercel body limit
- Vérifier en prod (upload d'une photo ~2 Mo). Solutions par ordre de préférence :
  1. compresser côté client avant envoi (canvas → JPEG ~800 px, q0.8 ⇒ ~150-300 Ko/photo) — ça règle aussi la latence ;
  2. et/ou garder `config.api.bodyParser.sizeLimit` (forme encore supportée par le runtime Node de Vercel) avec `sizeLimit: '10mb'` minimum.

### B11 — Expiration
- Dans `readDb()` (ou `updateDb`) : purger `db.sessions` avec `at < now - 7 j` et `db.oauthPending` avec `createdAt < now - 15 min`. Coût nul, borne la croissance.

### B12 — Orphelins `tmp-*`
- `server/index.js:486-499` : `savePhotoDataUrls` retourne les paths ; ajouter l'unlink des fichiers
  `tmp-*` correspondants après le re-save (ou faire écrire directement sous le vrai id en 2 temps avec l'id connu avant `createProduct` — l'id est généré par `newId` dans `createProduct` : le déplacer avant le save photos).

### B13 — Nettoyage suppression client
- Dans `DELETE /api/customers/:id` : supprimer aussi les sessions de cet utilisateur
  (`delete db.sessions[tok]` pour `sessions[tok].userId === id`) et mettre `userId: null`
  dans ses commandes (le nom/téléphone sont déjà snapshotés dans la commande).

### B14 — Code mort
- Supprimer : `src/icons.jsx`, `COMPARE_FIELDS`, `photoSkeletonClass`, `startSms`/`verifySms`/`loginGoogle`/`ACCENTS`/`AVATARS` + les blocs de tests associés (les tests de téléphone/email/master restent), variable `left` dans `reserve()`.

### B15 — Profile local
- Carte commandes en mode local : filtrer `reservations` (localStorage `pcstar-orders`) par `userId === user.id` (les commandes locales stockent déjà `userId`).
- `useEffect([user])` pour re-synchroniser nom/tél/wilaya du formulaire.

### B16 — Flash sombre
- Script inline dans `<head>` d'`index.html` (1 ligne) : lire `pcstar-theme` de localStorage et poser `data-theme` avant le premier paint.

### B17 — Bootstrap local
- `import 'bootstrap/dist/css/bootstrap.min.css'` dans `src/main.jsx` (bundle, plus de CDN) ; les Google Fonts restent en CDN avec fallback système (toléré) ou self-hosting plus tard.

### B19 — Téléphones démo
- Rendre les 4 numéros uniques (ex: yacine → `0770650388` — vérifier les tests qui hardcodent le numéro : `shopStore.test.js` utilise `0770650387` pour le carrier djezzy → garder un numéro qui passe le test ou l'ajuster).

### B20 — `setQty`
- `max = liveStock(product) + qtyActuelle` (borné au stock live, cohérent avec le 409 serveur).

### B21 — Docs
- Corriger `ARCHITECTURE.md` §2 (routage SPA par état, pas de hash) et la citation §7 de `PROBLEMS-SOLUTIONS.md`.

B18/B22/B23 : documentation seule (contraintes de conception démo, pas de code).

---

## 3. Plan de correction

| Phase | Contenu | Bugs | Risque | Vérification |
|---|---|---|---|---|
| **P1 — Intégrité des données** | write atomique + récupération non destructive ; recalcul total/prix serveur ; nettoyage sessions à la suppression client | B1, B3, B13 | faible (serveur) | +2 tests unitaires (fichier corrompu → backup ; total recalculé) ; `npm test` ; smoke e2e |
| **P2 — Cohérence API multi-device** | `req()` try/catch + flag `offline` ; catalogue serveur complet servi + consommé côté client ; toast honnête `ordersLocalOnly` ; pas de repli local sur 401 (+ clé `authErrorRate`) ; MasterPage : toasts corrects, `api.deleteCustomer`, panneaux désactivés en API | B4, B5, B6, B2, B9 | moyen (front) | `npm test` ; smoke e2e ; test manuel multi-onglets : créer/masquer produit (visible sur le site), commande prix trafiqué (total recalculé), login mauvais mdp (pas de repli local) |
| **P3 — i18n complet** | avertissements compat (`compat*`), STORE/services, REVIEWS, GUIDES, DEALS, `needs`, message WhatsApp, tooltip Stars | B7, B8 | faible | script de couverture i18n (0 clé manquante) ; rendu ar/fr/en vérifié visuellement dans le preview |
| **P4 — Durcissement Vercel** | compression client des uploads master (+ `sizeLimit` à confirmer) ; Bootstrap CSS en bundle local | B10, B17 | faible | build + test d'upload dans le preview ; `npm run build` (CSS inclus) |
| **P5 — Mineurs & nettoyage** | expiration sessions/oauthPending ; unlink `tmp-*` ; code mort ; profile local (commandes + resync) ; flash thème ; téléphones démo uniques ; `setQty` borné ; docs | B11, B12, B14, B15, B16, B19, B20, B21 | faible | `npm test` (tests mortels retirés), build, jsdom render, smoke e2e |
| **Régression finale** | `npm test` · `npm run build` · render jsdom 0 erreur · `npm run smoke` · parcours manuel AR/FR/EN (boutique, panier, builder, checkout, desk, master) | — | — | tout vert avant commit + PR |

Ordre justifié : d'abord l'intégrité des données (dommage irréversible), puis la cohérence
multi-device (feature centrale), puis la qualité i18n (visible par l'utilisateur), puis le
durcissement prod, et enfin le polish. Chaque phase = commit séparé sur la branche,
testable indépendamment.

**Statut des corrections :**
- **P1 — Fait** (commit `2cda64c`) : B1, B3, B13. `npm test` 45/45, smoke OK, preuves live
  (total trafiqué recalculé, token post-suppression 401, base tronquée → quarantaine + service continu).
- **P2 — Fait** : B4, B5, B6, B2, B9 + **B24** (découvert pendant la validation de B2).
  `npm test` **53/53**, `npm run build` OK, smoke e2e OK, render jsdom OK (produit serveur
  affiché / produit masqué absent en mode API ; fallback statique intact en offline),
  vérification multi-device live (création visible, masquage disparaît, master voit `hidden:true`).
- **P3 → P5 — À faire** : B7, B8 (i18n) ; B10, B17 (Vercel) ; B11, B12, B14, B15, B16, B19,
  B20, B21 (mineurs & nettoyage).
