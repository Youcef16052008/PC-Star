# Plan de correction consolidé — tous les bugs, de A à Z

**Date :** 15/09/2026 · **Base :** `fdbd778` · **Branche :** `arena/01a0a55c-pc-star`
**Sources :** rapport d'audit « deux passes », rapport « consolidé final », et
leurs vérifications (`docs/VERIFICATION-RAPPORT-AUDIT.md`,
`docs/VERIFICATION-RAPPORT-AUDIT-2.md`).

Ce document contient :
1. la **liste consolidée et dédupliquée** de tous les bugs (77 affirmations des
   rapports + 8 points trouvés pendant la vérification), avec verdict ;
2. le **plan de correction** par lots ordonnés, avec fichiers touchés et
   critère d'acceptation.

Règle transversale : **chaque correction s'accompagne d'un test de
non-régression.** Les 315 tests actuels passent avec tous ces bugs présents —
la suite est aujourd'hui aveugle à ces chemins (voir §10).

---

## 1. Légende

| Symbole | Sens |
|---|---|
| ✅ | Bug réel, confirmé (lecture ou exécution) |
| 🔬 | Bug réel **reproduit en exécution** |
| 🟡 | Partiel : réel mais à requalifier (portée, symptôme ou mécanisme corrigé) |
| ❌ | Affirmation fausse — **ne pas corriger** (mais voir la note) |
| ⚙️ | Point trouvé pendant la vérification, absent des deux rapports |

---

## 2. Liste consolidée — critique (sécurité & secrets)

| ID | Statut | Bug | Emplacement |
|---|---|---|---|
| **R1** (#3) | 🔬 | Identifiants master en clair dans le bundle public, **et ils ouvrent une session master** | `src/shopStore.js:1-5` ; seed `server/db.js:18-29` ; bundle `dist/assets/index-*.js` |
| **R2** (#6) | 🔬 | Injection HTML du `state` sur la page de consentement OAuth (CSP bloque l'exécution, pas le balisage) | `server/oauth.js:281` ; entrée `server/index.js:468` |
| **R3** (L) | 🔬 | Injection de formule CSV (`=`, `+`, `-`, `@`) dans l'export master | `server/masterApi.js:236-242` (`csvEscape`) |
| **R4** (#12) | 🔬 | `/api/auth/register` sans rate-limit (25 × 201 en 985 ms) ; `/api/me`, `/api/me/password` non limités non plus | `server/index.js:240-281` vs `:284` |
| **R5** ⚙️ | 🔬 | **Amplification CPU de R4** : `scryptSync` synchrone, 30,8–43,0 ms/hash, sur route sans auth ni limite → 770 ms de blocage du thread principal pour 25 inscriptions | `server/db.js:31-35` (`hashPass`) |
| **R6** (#24) | 🔬 | Les sessions survivent au changement de mot de passe **et** au reset master | `server/index.js:419-424`, `:441-448` |
| **R7** (#5) | ✅ | CSP de production bloque les photos Vercel Blob (`*.vercel-storage.com` absent d'`img-src`) alors que les URLs CDN sont stockées telles quelles dans `product.photos` | `vercel.json:53` ; `server/blobStore.js:80-85` ; `server/index.js:759` |
| **R8** (#27) | 🔬 | `/api/health` public divulgue e-mail master, config OAuth, origine CORS, driver DB | `server/index.js:211-231` |
| **R9** (#23) | 🔬 | `wilaya`, `slot`, `name`, `short` non validés à la commande → données arbitraires en base, CSV et WhatsApp | `server/catalog.js:120,123` ; contraste avec `server/index.js:346-357` |
| **R10** (#4) | ✅ | Hash de mot de passe local = FNV-1a 32 bits non salé (pas un KDF) | `src/shopStore.js:13-21` |
| **R11** (D'') | 🔬 | Override `price: 0` accepté (commande à 0 DA) alors que la création exige `> 0` | `server/masterApi.js:107-111` vs `:47-48` ; `server/catalog.js:57-64` |
| **R12** ⚙️ | ✅ | Identifiants master **publiés dans la documentation** | `README.md:19`, `docs/GUIDE-DEMO.md:23`, `docs/GUIDE-DEMO-FR.md:10`, `docs/GUIDE-DEMO-AR.md:10`, `docs/DEPLOY-VERCEL.md:127` |
| **R13** ⚙️ | ✅ | Le repli OAuth réinjecte `FRONT_URL` **non validé** dans un `Location` porteur de token | `server/index.js:493` |
| **R14** (#13) | ✅ | Token de session dans l'URL : retour OAuth `?oauth_token=` et WebSocket `?token=` | `server/index.js:494`, `src/App.jsx:425-443`, `src/deskStream.js:104` |
| **R15** (#25) | ✅ | `verifyPass` branche legacy non timing-safe | `server/db.js:59` |
| **R16** (#26) | 🔬 | `/api/oauth/start` public → `oauthPending` spammable (12 × 200, 12 entrées) ; `intent:'link'` sans token dégradé en login sans erreur | `server/index.js:453-463` ; `server/oauth.js:149` |
| **R17** (#47) | ✅ | Rate-limit en mémoire par instance → quasi décoratif en serverless multi-instances | `server/rateLimit.js:2` |
| **R18** (N) | ✅ | `FRONT_URL` mal configuré casse silencieusement tout retour OAuth légitime, sans log | `server/oauth.js:56-72` |
| **R19** (#52) | ✅ | Dev Vite exposé au réseau local : `host: '0.0.0.0'` + `allowedHosts: true` + proxy `/api` | `vite.config.js:18-20` |
| **R20** (O) | 🟡 | Commande **guest** au téléphone d'un tiers → visible et annulable par ce tiers. **La forme « compte authentifié » est fausse** (reproduit : `userId` attaché, B ne voit rien) | `server/index.js:374-376` |

---

## 3. Liste consolidée — bloquants fonctionnels

| ID | Statut | Bug | Emplacement |
|---|---|---|---|
| **F1** (#1) | ✅ | `go('cart')` mort : `'cart'` absent de `KNOWN_PAGES` → réécrit en `'shop'` **avant** le test ; le bouton « aller au panier » du configurateur envoie sur la boutique | `src/App.jsx:742,758,768` ; `src/BuilderPage.jsx:127` |
| **F2** (#2) | 🔬 | Changement de mot de passe **toujours** 403 : `api.changePassword` n'envoie pas `current`, et aucun champ « mot de passe actuel » dans le formulaire | `src/api.js:213-215`, `src/ProfilePage.jsx:165,168` vs `server/index.js:416-419` |
| **F3** (#7) | 🔬 | Collision de codes de commande après suppression : `sameDay.length + 1` (comptage, pas max) → **deux `PS-20260915-0003` observés en base** | `server/catalog.js:179-181` |
| **F4** (F) | ✅ | Collision client-local vs serveur : `nextLocalOrderCode` (max+1) vs `makeOrderCode` (count+1) | `src/orderLogic.js` vs `server/catalog.js:179-181` |
| **F5** (#10) | ✅ | `mergeServerOrders` efface les commandes locales-only au premier merge réussi | `src/orderLogic.js:302-318`, appelé `src/App.jsx:615` |
| **F6** (#9) | ✅ | `reserved` jamais réinitialisé au logout ni au changement de compte → l'utilisateur suivant voit la confirmation du précédent | `src/App.jsx:211,832,890` vs `logout():672-682`, effet `:567-572` |
| **F7** (#8) | 🔬 | `localStorage` bloqué (iframe tiers) → `SecurityError` non gérée dans les initializers de `useState` → tout le site tombe dans l'ErrorBoundary | `src/prefs.js:5`, `src/shopStore.js:136,214`, `src/App.jsx:190-197` |
| **F8** ⚙️ | 🔬 | **Le wrapper `storage` d'`App.jsx` lève aussi** — ajouté précisément pour les iframes à stockage bloqué, il n'a pas de try/catch. Seuls `loadCartFor` et `setCart` sont protégés | `src/App.jsx:76-87` |
| **F9** (#31) | ✅ | Détection de SKU doublé sur catalogue **filtré** en mode local → un SKU masqué ou en rupture peut être dupliqué | `src/MasterPage.jsx:162` + `src/App.jsx:1517` + `src/shopStore.js:296-300` |
| **F10** (#32) | ✅ | `needs` : string à la création, array exigé au patch → 400 selon le chemin | `server/masterApi.js:77` vs `:125-128` |
| **F11** (#43) | ✅ | `submitPanel` ignore le meta renvoyé par le serveur (qui tronque à 12) → désync | `src/MasterPage.jsx:295` vs `server/index.js:840-844` |
| **F12** (#30) | ✅ | Commandes guest du même appareil invisibles dès qu'on se connecte | `src/OrdersPage.jsx:28` |
| **F13** (#19) | ✅ | `setQty` force `max = 1` si le produit a disparu du catalogue, silencieusement | `src/App.jsx:730` |
| **F14** (K) | 🟡 | Collision de noms de photos à la milliseconde : repli **FS → écrasement silencieux** ; **Blob → `put` échoue** (`allowOverwrite` défaut `false`) et la sauvegarde échoue bruyamment | `server/masterApi.js:217` |
| **F15** (U) | ✅ | Photos FS sous Vercel = `/tmp/pcstar-uploads` éphémère → URLs `/api/upload-file` mortes après cold start, sans distinction côté produit | `server/index.js:513-516` |
| **F16** (M) | ✅ | Suppression d'un client : ses commandes actives ne sont pas annulées → stock réservé orphelin, invisible depuis la fiche client | `server/catalog.js:264-275` |

---

## 4. Liste consolidée — robustesse, concurrence, intégrité

| ID | Statut | Bug | Emplacement |
|---|---|---|---|
| **B1** (#14) | 🟡 | `updateDb` fichier : read-modify-write **sans verrou**. Survente réelle en multi-process local ; sous Vercel le symptôme est la **divergence/perte** entre instances (chacune a son `/tmp`) | `server/db.js:330-335` |
| **B2** (#35) | ✅ | `readDb()` **écrit** pendant une lecture (`purgeExpired`/`stripInternalKeys`/seed → `writeDb`) | `server/db.js:178` |
| **B3** ⚙️ | ✅ | `readDb()` complet (lecture + parse du fichier entier) **à chaque requête**, sans cache | `server/db.js` (`readDbAsync` appelé par tous les handlers) |
| **B4** (#33) | ✅ | Masquer puis réafficher un produit de base laisse `productOverrides[id] = {}` pour toujours | `server/masterApi.js:173-192` |
| **B5** (#34) | ✅ | Backups nommés à la **seconde** → deux backups dans la même seconde s'écrasent. La quarantaine corrompue, elle, utilise ms + aléa (incohérence) | `server/masterApi.js:293-301` vs `server/db.js:223-240` |
| **B6** (#20) | ✅ | Effets de bord **dans** les updaters React (`saveOrders`/`setItem`) → double écriture en StrictMode ; `authIdRef.current` peut changer entre-temps | `src/App.jsx:255-265,516,548,829,889` |
| **B7** (#21) | ✅ | Code de commande local calculé sur un `reservations` périmé (closure après `await`) | `src/App.jsx:882` |
| **B8** (#18) | ✅ | Double-clic sur « Ajouter » → dépassement du stock dans le panier (garde évaluée sur `liveStock` périmé) | `src/App.jsx:712-724` |
| **B9** (C) | ✅ | Annulation en repli local d'une commande **serveur** en mode mixte → `stockMap` gonflé d'unités fantômes (`refreshStock` appelé seulement dans la branche API) | `src/App.jsx:546-558` |
| **B10** (H') | ✅ | `refreshStock()` sans sérialisation ni garde de fraîcheur → une réponse ancienne peut écraser la plus récente | `src/App.jsx:450-464` |
| **B11** (#49) | ✅ | 401 pendant une session Desk → le polling s'arrête en silence pour toujours, sans re-login ni message | `src/App.jsx:591` |
| **B12** (I) | 🟡 | Retour OAuth : si `me()` échoue, aucun retry ni message. **Mais le token reste stocké** → un rechargement applique la session (pas « perdue ») | `src/App.jsx:425-448` |
| **B13** (J) | 🟡 | Aucune UI « session expirée » (TTL serveur 7 j). Le token mort est purgé au démarrage (`:413-421`), donc pas « sur toutes les requêtes » | `src/api.js:6-20`, `src/App.jsx:413-421` |
| **B14** (#28) | ✅ | Reconnexion WebSocket infinie sur Vercel (backoff 30 s, pour toujours), sans détection d'environnement sans WS | `src/deskStream.js:18-19,69-76,160-172` |
| **B15** (E) | ✅ | Pas de heartbeat WS → sockets morts conservés dans `deskClients`, `deskClientCount()` fantôme | `server/notify.js:174-184`, `server/deskSocket.js:30-52` |
| **B16** (#29) | ✅ | `seenOrderCodes` initialisé à `null` → au premier pull après réouverture du Desk, aucune notification pour les commandes déjà présentes (mode polling) | `src/App.jsx:237,597-610` |
| **B17** (G) | ✅ | Réponse 413 sans `Connection: close` → keep-alive sale | `server/index.js:120-132`, `:978-980` |
| **B18** (#46) | ✅ | `DEMO`/`BASE` figés au chargement du module depuis `process.env` → non réinitialisables en test | `server/oauth.js:17-20` |
| **B19** (#15) | 🟡 | Mode dégradé : prix/stock statiques servis sans horodatage ; écart affiché vs facturé jamais signalé. (Le bandeau, lui, est **exact** : en mode dégradé les écritures tombent avec les lectures) | `server/index.js:548-556`, `src/App.jsx:273-279` |
| **B20** (R'') | ✅ | `doTogglePanel` ignore la réponse serveur et force le meta local → désync multi-appareils | `src/MasterPage.jsx:268-282` |
| **B21** (#55/W) | 🟡 | `hashPassLegacy` appelée avant sa déclaration : correct (fonction hoistée **avec son corps**), fragile si refactorée en `const` | `server/db.js:22` vs `:37` |
| **B22** (#11) | ❌ | **Faux** — un 400 `transition` ne retombe **pas** dans le repli local : `setToast` + `return false` en `App.jsx:501-505`, avant le repli (l.510). Ne pas corriger | `src/App.jsx:501-519` |

---

## 5. Liste consolidée — honnêteté de l'UI

| ID | Statut | Bug | Emplacement |
|---|---|---|---|
| **U1** (S) | ✅ | Topbar « SYS.ONLINE » **toujours verte** (point hardcodé), même API down | `src/App.jsx:927` |
| **U2** (B) | ✅ | `shortages` renvoyées par le serveur (409 stock) **jamais affichées** — toast générique `stockShort` ; l'utilisateur doit deviner la ligne | `src/App.jsx:843-846` vs `server/index.js:637` |
| **U3** (#42) | ✅ | Bouton de sauvegarde des photos libellé « Photos enregistrées » **avant** d'enregistrer | `src/MasterPage.jsx:460`, `src/i18n.js:830` |
| **U4** (#17) | ✅ | Prix figés à l'ajout au panier → total local, message WhatsApp et récap faux si le master change un prix pendant la visite | `src/App.jsx:721,685` |
| **U5** (#45) | ✅ | `t()` transforme une variable `undefined` en chaîne littérale `"undefined"` | `src/i18n.js:1555-1562` |
| **U6** (Y) | 🟡 | `t(\`cat_${c.id}\`)` sans le motif de repli utilisé par Builder/Search. **Aucune clé manquante aujourd'hui** (vérifié : 13 catégories × 3 langues = 0 trou) | `src/App.jsx:1109` vs `BuilderPage.jsx:37`, `SearchPage.jsx:63` |
| **U7** (A) | ✅ | Lien WhatsApp du panier sans garde de longueur (`wa.me` tronque vers ~4 Ko) ; recalculé à chaque frappe | `src/App.jsx:898-900` |
| **U8** (#39) | ✅ | `<img width/height 800 sizes=…>` **sans `srcSet`** → `sizes` sans effet, aucune image responsive réelle | `src/PartThumb.jsx` |
| **U9** (Z) | ✅ | `deskBeep` : `gain.value = 0.04` sans enveloppe → clic audio au start/stop | `src/App.jsx` (`deskBeep`) |
| **U10** (T) | ✅ | `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` contredisent la conception « aperçu iframe tiers » documentée dans le code | `vercel.json`, `server/index.js:82,91` vs `src/App.jsx:149-151`, `src/api.js:8` |
| **U11** ⚙️ | ✅ | `GET /api/orders` remappe `pending → new` à l'affichage alors que `PATCH`/`DELETE` travaillent sur le statut brut → commandes legacy invisibles en tant que telles | `server/index.js:596-600` |
| **U12** (#44) | ✅ | `URL.revokeObjectURL(url)` synchrone après `a.click()` → race de téléchargement | `src/api.js:193` |

---

## 6. Liste consolidée — qualité du code & duplication

| ID | Statut | Bug | Emplacement |
|---|---|---|---|
| **Q1** (#38) | ✅ | `stockLabel` dupliqué **4×** avec **2 familles de classes** (`stock-out/low/ok` vs `danger/warning/success`) | `src/App.jsx:143`, `src/BuilderPage.jsx:7`, `src/SearchPage.jsx:6`, `src/ProductPage.jsx:7` |
| **Q2** (#22) | 🟡 | `phoneCarrier` dupliqué 2× (client/serveur), fonctions strictement identiques. **Le mapping 05/06/07 est correct** ; la portabilité des numéros n'est pas gérée | `src/shopStore.js:161-168`, `server/index.js:194-201` |
| **Q3** (#37) | ✅ | `loadTheme`/`resolveTheme`/`saveTheme`/`applyDocumentChrome` = code mort (aucun import hors `prefs.js`), **et non testés** | `src/prefs.js:15-33,50-61` |
| **Q4** (#36) | ✅ | `theme-color` divergent : `#f4f6fb` (`index.html:9`, `theme-boot.js:12`) vs `#f2f5f8` (`prefs.js:60`) — sur du code mort | idem |
| **Q5** (#16) | ❌ | **Faux** — le champ `count` du toast n'est **jamais lu** ; le rendu utilise le total courant du panier. À traiter en **code mort**, pas en bug d'affichage | `src/App.jsx:723` vs `:684,1767` |
| **Q6** (#40) | ✅ | Options CPU filtrées par `socket === socket` alors que `socketsMatch` (tolérant) existe et sert à la validation — le commentaire P17 dit l'inverse de la ligne 42 | `src/BuilderPage.jsx:42` vs `:31`, `src/data.js:684` |
| **Q7** (#41) | ✅ | id de recherche sauvée `s-${Date.now()}` → collision possible | `src/SearchPage.jsx:112` |
| **Q8** (#48) | 🟡 | `send()` pose `Access-Control-Allow-Headers`/`Methods` **inconditionnellement** alors que `corsHeaders()` est conditionnel. La partie « `undefined` dans les headers » est **fausse** : `FRONT_ORIGIN` vaut `''` et Node omet l'en-tête vide | `server/index.js:73-96`, `:891` |
| **Q9** (#51) | ✅ | Assertion e2e quasi vide : `not.toContainText(/auth.*error/i)` ne vérifie pas que la connexion a réussi | `e2e/smoke.spec.js:18` |
| **Q10** (#50) | ❌ | **Faux** — `notify.js:92` garde `typeof order.total === 'number'` à la ligne même citée. Rien à corriger | `src/notify.js:92` |
| **Q11** (#53) | 🟡 | Le symptôme décrit (55 tests KO, `jsdom` absent, `.env` qui fuit) est **faux ici** : 315/315 passent, jsdom 30.0.1 installé, aucun `.env`. **Le fond est vrai et reproduit** : la suite n'isole pas `DATABASE_URL` → 17 échecs sur `apiServer.test.js` avec une Neon injoignable | `src/apiServer.test.js:8-11` |
| **Q12** (#54) | ❌ | **Faux** — aucun des 12 fichiers cités n'existe ; `git status` ne remonte que `docs/VERIFICATION-RAPPORT-AUDIT.md`. Dépôt propre (11 fichiers suivis à la racine, tous légitimes) | racine du dépôt |

---

## 7. Plan de correction

> **ÉTAT D'AVANCEMENT — 15/09/2026**
>
> | Lot | État | Détail |
> |---|---|---|
> | **Lot 0** (rotation des secrets) | ⚠️ **À faire par l'exploitant — reporté à la fin** | À la demande du commanditaire (15/09), ce lot passe **en dernier** : c'est une action sur le déploiement réel, pas du code. Le code ne contient plus les identifiants, mais la production doit poser `MASTER_EMAIL` / `MASTER_PASSWORD` avec un mot de passe **neuf**. Procédure en §9. |
> | **Lot 7.1** (isolation des tests) | ✅ **Fait** | `scripts/test-env.mjs` + `--import` dans le script `test`. Vérifié : la suite passe **avec un `.env` hostile** (Neon morte + `MASTER_*` + `WHATSAPP_TOKEN`), alors qu'elle échouait sur 17 tests avant. |
> | **Lot 1.1** (secrets hors du code) | ✅ **Fait** | `masterAccount()` lit l'environnement et **lève** s'il manque (aucune valeur par défaut) ; plus de `MASTER` côté client ; `/api/health` ne divulgue plus l'e-mail maître ; synchronisation du maître sur les **bases existantes**. |
> | **Lot 1.2** (secrets hors de la doc) | ✅ **Fait** | README, 3 guides de démo, DEPLOY-VERCEL, spec superpowers, 4 scripts de recette. |
> | **Lot 1.10** (R8, `/api/health`) | ✅ **Fait** | Retiré du même mouvement : l'import `MASTER` disparaissait de `server/index.js`, le champ ne pouvait pas rester. |
> | **Lot 1.3→1.9, 1.11→1.15** (reste du lot 1) | ✅ **Fait** | Voir §9 « Reste du lot 1 ». 59 nouveaux tests, vérifiés **régressifs** (les corrections retirées, les tests échouent). |
> | **Lot 7.2/7.3** (tests de non-régression) | 🟡 **Partiel** | `src/masterSecrets.test.js` (8 tests) couvre les lots 1.1/1.2 + la migration de base existante ; `src/serverFixes.test.js` (48) et `src/clientFixes.test.js` (11) couvrent le reste du lot 1. Le contrôle du **bundle** a été mené à la main (`npm run build` puis `grep` : aucun secret, aucune URL `vercel-storage`) mais reste à automatiser. |
> | Lots 2, 3, 4, 5, 6 | ⬜ **À faire** | |
>
> **Suite de tests : 315 → 325 → 384**, tous verts (112 suites).

Sept lots, ordonnés par risque décroissant. Les lots 1 et 2 sont les seuls
**bloquants** ; les lots 3 à 7 peuvent être menés en parallèle ensuite.

Estimations en « unités de changement » (U) : S = < 30 lignes, M = 30–120, L = > 120.

---

### 🚨 Lot 0 — Prérequis non code (à faire AVANT tout déploiement)

| Action | Pourquoi |
|---|---|
| **Changer le mot de passe master réel** et les trois mots de passe démo | Ils sont dans le bundle public **et** dans la documentation depuis des mois (R1, R12). Toute correction de code est inutile tant que le secret exposé reste valide. |
| Vérifier si le compte master a été utilisé par un tiers (journal des commandes/clients) | Le secret est public ; l'accès est complet (commandes, clients, produits, CSV, suppression). |

**Ce lot ne dépend d'aucun autre et ne doit pas attendre le code.**

---

### 🔐 Lot 1 — Secrets & authentification (R1→R13, R15, R16, F2, R6)

> ✅ **Fait** (15/09/2026) — détail au §9. Le lot 0 (rotation des secrets réels
> sur Vercel) reste à faire par l'exploitant, reporté à la fin à la demande.

**Objectif : plus aucun secret dans le code ou le bundle, et une authentification
qui tient.**

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 1.1 | **R1** — Sortir `MASTER` du code. Côté serveur : `MASTER_EMAIL` + `MASTER_PASSWORD` lus depuis l'environnement. **Échec propre si absent** (démarrage refusé avec message explicite), jamais de valeur par défaut codée en dur. Côté client : supprimer l'objet `MASTER` de `shopStore.js` et le compte master local | `server/db.js:18-29`, `server/env.js`, `src/shopStore.js:1-5,71-73`, `.env.example` | M | `grep -r "star31" dist/` → **aucun résultat** ; serveur sans `MASTER_EMAIL` refuse de démarrer avec un message lisible ; login master fonctionne avec les valeurs d'env |
| 1.2 | **R12** — Retirer les identifiants de toute la documentation ; remplacer par « voir variables d'environnement » | `README.md:19`, `docs/GUIDE-DEMO*.md`, `docs/DEPLOY-VERCEL.md:127`, `docs/superpowers/specs/*` | S | `grep -rn "star31\|pcstar.info31" .` hors `node_modules` → 0 |
| 1.3 | **R10** — Assumer le mode local comme **mode démo** : aucun secret réel, comptes non sensibles, et le dire dans l'UI. FNV-1a n'est pas réparable côté navigateur | `src/shopStore.js:13-21`, `src/AuthPanel.jsx` | S | Un avertissement « mode démonstration, aucune donnée sensible » est affiché en mode local |
| 1.4 | **F2** — Champ « mot de passe actuel » dans le profil + paramètre `current` dans l'API client | `src/ProfilePage.jsx:160-170`, `src/api.js:213-215`, `src/i18n.js` (clé `currentPassword` × 3 langues) | S | Changement de mot de passe **réussit depuis l'UI** ; sans `current` → erreur explicite ; test e2e/unitaire couvrant le chemin complet |
| 1.5 | **R6** — Purger `db.sessions` de l'utilisateur dans `POST /api/me/password` **et** dans le reset master (comme le fait déjà `purgeUser`) | `server/index.js:419-424`, `:441-448` | S | Après changement de mot de passe, l'ancien token renvoie **401** (test de non-régression) |
| 1.6 | **R4 + R5** — `rateLimit` sur `/api/auth/register`, `/api/me`, `/api/me/password` ; passer `hashPass` en **asynchrone** (`crypto.scrypt` + `promisify`) hors du thread principal | `server/index.js:240-281,336,406`, `server/db.js:31-35` (et tous les appelants de `hashPass`) | L | 21ᵉ inscription dans la minute → **429** ; mesure : le thread principal ne bloque plus ~30 ms par inscription ; `verifyPass` reste compatible avec les hashes `scrypt$` et `sha256$` existants |
| 1.7 | **R2** — Échapper HTML `state` (et `name`/`email`) dans `demoConsentHtml`, ou mieux : ne pas interpoler le `state` dans la page (le garder côté serveur, lié à la session de consentement) | `server/oauth.js:265-290` | S | `GET /api/oauth/google/demo?state="><img src=x onerror=alert(1)>` ne produit **aucune balise** dans la réponse (test) |
| 1.8 | **R3** — Neutraliser l'injection de formule dans `csvEscape` : préfixer `'` devant toute cellule commençant par `= + - @` (ou tabulation) | `server/masterApi.js:236-242` | S | Export CSV d'une commande nommée `=HYPERLINK(...)` → cellule préfixée, non interprétable par Excel (test) |
| 1.9 | **R9** — Valider `wilaya` (whitelist `WILAYAS_NEAR`), `slot` (whitelist `SLOTS`), borner `name`/`short` en longueur | `server/catalog.js:116-130`, `server/index.js:615-632` | S | Commande avec `wilaya: "<script>"` → stockée comme `Oran` (repli) ou refusée ; `name` > N caractères → 400 |
| 1.10 | **R8** — Retirer `master` et `cors` de `/api/health` ; ne garder que `ok` + `db.driver`/`db.reachable` pour le monitoring | `server/index.js:211-231` | S | Réponse de `/api/health` sans e-mail ni origine |
| 1.11 | **R7** — Deux options : (a) ajouter le domaine Blob à `img-src` dans `vercel.json` + CSP serveur ; (b) **préféré** : ne stocker que des chemins relatifs et servir systématiquement via `/api/upload-file?name=` (le 302 existe déjà) | `vercel.json:53`, `server/index.js:91-93`, `server/masterApi.js:217-220` | M | Une photo uploadée avec `BLOB_READ_WRITE_TOKEN` configuré s'affiche en production |
| 1.12 | **R11** — Aligner la validation : refuser `price <= 0` dans `sanitizeProductPatch` (comme `createProduct`) | `server/masterApi.js:107-111` | S | `PUT /api/master/products/:id {"price":0}` → **400 `price`** |
| 1.13 | **R13** — Faire passer le repli par `safeReturnUrl` ; **R18** — logger un avertissement quand `FRONT_URL`/`FRONT_ORIGIN` est configuré mais invalide | `server/index.js:493`, `server/oauth.js:56-72` | S | `FRONT_URL` sans schéma → log d'avertissement au démarrage, repli sûr ; jamais de token dans un `Location` non validé |
| 1.14 | **R15** — `timingSafeEqual` sur la branche legacy | `server/db.js:59` | S | Plus aucune comparaison `===` de hash |
| 1.15 | **R16** — `rateLimit` sur `/api/oauth/start` ; renvoyer une **erreur explicite** quand `intent:'link'` est demandé sans session | `server/index.js:453-463` | S | 21ᵉ `oauth/start` dans la minute → 429 ; `intent:'link'` sans token → 400 `auth` |

**Ordre interne :** 1.1 → 1.2 → (Lot 0) → 1.4/1.5 → 1.6 → 1.7/1.8/1.9 → le reste.

---

### 🧩 Lot 2 — Bloquants fonctionnels (F1, F3, F4, F5, F6, F9, F10, F11, F12)

> ✅ **Fait** (15/09/2026) — 2.1 à 2.8, plus la découverte hors rapports
> (branche `sha256$pcstar:` de `verifyPass`). Détail et tests au §9.

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 2.1 | **F1** — Traiter `next === 'cart'` **avant** la réécriture `KNOWN_PAGES` (ou y ajouter `'cart'`) | `src/App.jsx:742,757-777` | S | Depuis le configurateur, « Ajouter la config » → **le panier s'ouvre** (test jsdom : clic sur le bouton, assertion sur l'état du panier) |
| 2.2 | **F3 + F4** — `makeOrderCode` basé sur le **max** des séquences du jour, même algorithme que `nextLocalOrderCode`. Idéal : extraire une fonction partagée | `server/catalog.js:170-184` | S | Créer 3 commandes, supprimer la 2ᵉ, en créer une 4ᵉ → **aucun doublon de code** (test) |
| 2.3 | **F5** — `mergeServerOrders` doit **conserver** les commandes locales-only non synchronisées (les réinjecter, marquées `localOnly`) | `src/orderLogic.js:302-318` | M | Une commande créée hors-ligne **survit** au premier merge réussi (test unitaire) |
| 2.4 | **F6** — `setReserved(null)` dans `logout()` et dans l'effet `authId` | `src/App.jsx:567-572`, `:672-682` | S | Après logout, ouvrir le panier ne montre **aucune** confirmation du compte précédent (test) |
| 2.5 | **F9** — Passer le catalogue **complet** au contrôle de SKU en mode local (`masterCatalog` existe déjà), pas le catalogue public filtré | `src/MasterPage.jsx:148-163`, `src/App.jsx:1517` | S | En mode local, créer un produit avec le SKU d'un produit **masqué** → refus `sku_taken` |
| 2.6 | **F10** — Unifier `needs` : accepter string **ou** array au patch, normaliser en array ; migrer les produits créés avec une string | `server/masterApi.js:77,125-128` | S | Éditer `needs` d'un produit créé via `createProduct` → **200**, pas 400 |
| 2.7 | **F11 + B20** — Utiliser la **réponse serveur** comme source de vérité après mutation : `onMeta(r.data.meta)` dans `submitPanel` et `doTogglePanel` | `src/MasterPage.jsx:268-300` | S | Après ajout d'un 13ᵉ panneau, l'état client reflète la troncature serveur |
| 2.8 | **F12** — Afficher aussi les commandes guest de l'appareil pour un utilisateur connecté (union `userId === user.id` **OU** `userId == null`), en les marquant « passées sans compte » | `src/OrdersPage.jsx:28` | S | Après connexion, les commandes guest du même appareil restent visibles |

---

### 🛡️ Lot 3 — Robustesse & concurrence (F7, F8, B1→B19, B21, R14, R17)

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 3.1 | **F7 + F8** — Un **seul** helper de stockage sûr (`safeStorage`) avec try/catch sur `getItem`/`setItem`/`removeItem` + repli mémoire, utilisé partout : wrapper `App.jsx`, `prefs.js`, `shopStore.js`, `api.js` | `src/App.jsx:76-87`, `src/prefs.js`, `src/shopStore.js`, `src/api.js` (nouveau module partagé) | M | Sonde : avec un storage qui lève `SecurityError`, l'app **monte** et fonctionne en mémoire (test jsdom) |
| 3.2 | **B1 + B2 + B3** — Driver fichier : (a) sortir `purgeExpired`/`stripInternalKeys`/seed de `readDb()` (les faire au démarrage + sur écriture) ; (b) file d'écriture sérialisée (promesse chaînée) ou verrou ; (c) cache en mémoire invalidé à l'écriture | `server/db.js:155-200,330-335` | L | Un GET ne provoque **plus** d'écriture disque ; deux `updateDb` concurrents ne perdent pas de mutation (test) |
| 3.3 | **B6** — Sortir les effets de bord des updaters : calculer `next`, puis `setState(next)` **et** persister après | `src/App.jsx:255-265,510-519,546-558,825-835,870-892` | M | En StrictMode, une seule écriture par mutation (test avec double invocation) |
| 3.4 | **B7** — Calculer le code local **avant** les `await`, ou utiliser une ref à jour | `src/App.jsx:870-892` | S | Deux commandes hors-ligne quasi simultanées → codes distincts |
| 3.5 | **B8** — Déplacer le garde de stock **dans** l'updater `setCart` (sur `prev`), pas avant | `src/App.jsx:712-724` | S | Double-clic sur « Ajouter » avec stock 1 → **une** unité dans le panier |
| 3.6 | **B9** — Appeler `refreshStock()` aussi dans le repli local, ou ne jamais incrémenter `stockMap` pour une commande d'origine serveur | `src/App.jsx:546-558` | S | En mode mixte, annuler une commande serveur ne gonfle pas le stock affiché |
| 3.7 | **B10** — Garde de fraîcheur sur `refreshStock` (horodatage de requête, ignorer toute réponse antérieure) | `src/App.jsx:450-464` | S | Trois appels concurrents → seul le plus récent s'applique |
| 3.8 | **B11** — Sur 401 en polling Desk : purger le token, repasser en mode local, **et** prévenir l'utilisateur | `src/App.jsx:585-600` | S | Token expiré pendant une session Desk → message « session expirée », pas de silence |
| 3.9 | **B12 + B13** — Retry borné sur `me()` au retour OAuth + message d'échec visible ; détection d'expiration de session côté client (message dédié) | `src/App.jsx:425-448`, `src/api.js` | M | Retour OAuth avec API lente → la session finit par s'appliquer sans rechargement ; token expiré → message explicite |
| 3.10 | **B14 + B15** — Côté client : détecter l'environnement sans WS (échec d'upgrade répété) et **arrêter** de retenter. Côté serveur : heartbeat `ping`/`pong` + nettoyage des sockets morts | `src/deskStream.js:60-90,160-172`, `server/notify.js:174-184`, `server/deskSocket.js` | M | Sur Vercel, plus de tentative de socket après N échecs ; `deskClientCount()` ne compte plus de fantômes |
| 3.11 | **B16** — Initialiser `seenOrderCodes` au premier pull **sans** notifier, puis notifier — ou notifier les commandes arrivées depuis le dernier horodatage connu | `src/App.jsx:237,597-610` | S | Réouvrir le Desk en polling → les commandes arrivées pendant l'absence sont signalées |
| 3.12 | **B17** — `Connection: close` sur la réponse 413 | `server/index.js:978-980` | S | Réponse 413 porte `Connection: close` |
| 3.13 | **B18** — Rendre `DEMO`/`BASE` calculables à la demande (fonctions) pour permettre les tests | `server/oauth.js:17-20` | S | Un test peut modifier `process.env` et observer le nouveau comportement |
| 3.14 | **B4** — Supprimer `productOverrides[id]` quand l'override devient vide | `server/masterApi.js:173-192` | S | Masquer puis réafficher un produit de base → **aucune** entrée résiduelle |
| 3.15 | **B5** — Ajouter un suffixe aléatoire au nom de backup (aligné sur `quarantineDb`) | `server/masterApi.js:293-301` | S | Deux backups dans la même seconde → deux fichiers distincts |
| 3.16 | **B19** — Horodater le repli dégradé et afficher l'écart de prix le cas échéant | `server/index.js:548-556`, `src/App.jsx:273-279` | M | En mode dégradé, l'utilisateur voit depuis quand les prix datent |
| 3.17 | **B21** — Déplacer la déclaration de `hashPassLegacy` **avant** l'objet `MASTER` (supprime la dépendance au hoisting) | `server/db.js:18-40` | S | Plus aucun appel avant déclaration |
| 3.18 | **R14** — Retour OAuth : passer le token par **fragment** (`#oauth_token=`) ou cookie `HttpOnly` ; WebSocket : authentification par **premier message** plutôt que dans l'URL | `server/index.js:494`, `src/App.jsx:425-448`, `src/deskStream.js:104`, `server/deskSocket.js` | L | Aucun token dans une URL (donc ni historique, ni logs proxy, ni `Referer`) |
| 3.19 | **R17** — Documenter la limite du rate-limit en mémoire ; si le multi-instances est réel, déplacer les compteurs (Upstash/Redis) ou accepter explicitement la limite | `server/rateLimit.js`, `docs/DEPLOY-VERCEL.md` | M | Le comportement en production est documenté et assumé |

---

### 🖥️ Lot 4 — Multi-appareil & données (F14, F15, F16, R20, U11)

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 4.1 | **F14** — Suffixe aléatoire (ou `addRandomSuffix: true`) sur les noms de photos uploadées | `server/masterApi.js:217`, `server/blobStore.js:80-85` | S | Deux uploads du même produit dans la même milliseconde → deux fichiers distincts, aucun échec |
| 4.2 | **F15** — Sous Vercel, **imposer** la voie Blob (refuser l'upload FS avec un message explicite) ou persister les uploads ailleurs que `/tmp` | `server/blobStore.js`, `server/index.js:513-516` | M | Plus aucune URL `/api/upload-file` morte après cold start en production |
| 4.3 | **F16** — À la suppression d'un client, annuler (ou signaler) ses commandes actives ; à défaut, afficher le stock réservé orphelin dans la fiche client | `server/catalog.js:264-275`, `src/MasterPage.jsx` | M | Supprimer un client avec une commande `new` → le stock est rendu **ou** le master est informé |
| 4.4 | **R20** — Empêcher une commande **guest** de se rattacher au téléphone d'un compte existant (refus, ou commande non revendicable) | `server/index.js:374-376`, `server/catalog.js` | M | Une commande guest au numéro d'un compte enregistré n'apparaît **pas** dans les commandes de ce compte |
| 4.5 | **U11** — Décider du sort des commandes legacy `pending` : migration vers `new`, ou affichage distinct au Desk | `server/index.js:596-600`, `src/DeskPage.jsx:26` | S | Le master peut distinguer (ou n'a plus) de commandes `pending` |

---

### 🎨 Lot 5 — Honnêteté de l'UI (U1→U10, U12)

| # | Correction | Fichiers | Taille |
|---|---|---|---|
| 5.1 | **U1** — L'indicateur `SYS.ONLINE` reflète `apiOnline` (couleur + libellé) | `src/App.jsx:927` | S |
| 5.2 | **U2** — Afficher les `shortages` du serveur (quelle ligne manque, quantité disponible) au lieu du toast générique | `src/App.jsx:843-846` | S |
| 5.3 | **U3** — Libellé du bouton : « Enregistrer les photos » (nouvelle clé i18n × 3 langues) | `src/MasterPage.jsx:460`, `src/i18n.js` | S |
| 5.4 | **U4** — Recalculer les prix du panier depuis le catalogue live (ou avertir d'un écart détecté) | `src/App.jsx:685,721` | M |
| 5.5 | **U5** — `t()` : ignorer (ou laisser le placeholder) quand une variable est `undefined`/`null` | `src/i18n.js:1555-1562` | S |
| 5.6 | **U6** — Appliquer le motif de repli `t(k) !== k ? t(k) : label` aux catégories | `src/App.jsx:1109` | S |
| 5.7 | **U7** — Garde de longueur sur le message WhatsApp (troncature propre + avertissement) ; mémoïser le calcul | `src/App.jsx:898-900` | S |
| 5.8 | **U8** — Ajouter un vrai `srcSet` (ou retirer `sizes`) | `src/PartThumb.jsx` | S |
| 5.9 | **U9** — Enveloppe de gain (rampe) sur `deskBeep` | `src/App.jsx` (`deskBeep`) | S |
| 5.10 | **U10** — Trancher : soit assumer l'iframe d'aperçu (relâcher `frame-ancestors` pour les origines d'aperçu), soit retirer les commentaires/workarounds iframe | `vercel.json`, `server/index.js:82,91`, `src/App.jsx:149-151`, `src/api.js:8` | S |
| 5.11 | **U12** — `URL.revokeObjectURL` différé (`setTimeout`) | `src/api.js:193` | S |

---

### 🧹 Lot 6 — Qualité du code (Q1→Q9)

| # | Correction | Fichiers | Taille |
|---|---|---|---|
| 6.1 | **Q1** — Un seul `stockLabel` partagé, une seule famille de classes | nouveau module + `App.jsx:143`, `BuilderPage.jsx:7`, `SearchPage.jsx:6`, `ProductPage.jsx:7` | S |
| 6.2 | **Q2** — Un seul `phoneCarrier` partagé (ou accepter la duplication et la verrouiller par un test d'équivalence) ; documenter la limite « portabilité non gérée » | `src/shopStore.js:161-168`, `server/index.js:194-201` | S |
| 6.3 | **Q3 + Q4 + Q5** — Supprimer le code mort : `loadTheme`/`resolveTheme`/`saveTheme`/`applyDocumentChrome` (et harmoniser `theme-color`), champ `count` du toast | `src/prefs.js:15-33,50-61`, `src/App.jsx:723` | S |
| 6.4 | **Q6** — Utiliser `socketsMatch` pour le filtre d'options CPU | `src/BuilderPage.jsx:42` | S |
| 6.5 | **Q7** — id de recherche sauvée avec suffixe aléatoire | `src/SearchPage.jsx:112` | S |
| 6.6 | **Q8** — Rendre les en-têtes CORS cohérents dans `send()` (tout conditionnel à `FRONT_ORIGIN`) | `server/index.js:73-96,891` | S |
| 6.7 | **Q9** — Assertion e2e réelle : vérifier l'état connecté (nom du compte visible, bouton logout) | `e2e/smoke.spec.js:10-19` | S |

---

### 🧪 Lot 7 — Tests & hygiène (Q11 + couverture)

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 7.1 | **Q11** — Isoler l'environnement dans les tests serveur : `delete process.env.DATABASE_URL` (et `BLOB_READ_WRITE_TOKEN`, `WHATSAPP_TOKEN`) avant d'importer le handler | `src/apiServer.test.js:8-11`, `src/masterApi.test.js`, `src/hardening.test.js`, `src/apiDegraded.test.js` | S | Avec une `DATABASE_URL` Neon morte exportée dans le shell, `npm test` passe **quand même** 315/315 |
| 7.2 | Ajouter un test de non-régression **par correction** des lots 1 à 5 | `src/*.test.js` | L | Chaque bug de ce document a un test qui échoue sans le correctif |
| 7.3 | Test « aucun secret dans le bundle » : après `npm run build`, `grep` sur `dist/` | `scripts/` (nouveau) + `package.json` | S | Le build **échoue** si un mot de passe apparaît dans `dist/` |
| 7.4 | **R19** — Restreindre `allowedHosts` en dev (liste explicite) tout en gardant le preview fonctionnel | `vite.config.js:18-20` | S | Le dev server refuse un `Host` inconnu |

---

## 8. Ce qu'il ne faut PAS corriger

| Item | Pourquoi |
|---|---|
| **#11** (B22) | L'affirmation est fausse : le repli local n'est **pas** atteint sur une erreur `transition`. Le code actuel est correct. |
| **#16** en tant que bug d'affichage (Q5) | Le champ est mort : aucun compteur faux ne s'affiche. À supprimer comme code mort, pas à « corriger ». |
| **#50** (Q10) | La garde `typeof` existe à la ligne citée. Rien à faire. |
| **#54** (Q12) | Aucun des 12 fichiers n'existe ; le dépôt est propre. Rien à nettoyer. |
| **#53** symptôme | `jsdom` est installé, aucun `.env` ne fuit, 315/315 passent. **Seul le fond (7.1) est à corriger.** |
| **O** version « compte authentifié » | Reproduit faux : `userId` est attaché, le tiers ne voit rien. Seule la variante guest (R20) est réelle. |

---

## 9. Ordre d'exécution recommandé

### ✅ Fait — ce qui a été livré (15/09/2026)

**`scripts/test-env.mjs`** (lot 7.1) — pose l'environnement de test **avant** le
chargement de `.env`. Point subtil : `server/env.js` n'applique le `.env` que si
`process.env[key] === undefined`, donc une simple *suppression* ne suffit pas —
les variables sont posées à **chaîne vide** (définies, donc le `.env` est
ignoré ; falsy, donc `process.env.DATABASE_URL ? 'neon' : 'file'` choisit
`file`). Chargé par `node --import ./scripts/test-env.mjs` dans le script
`test`, ce qui couvre aussi les fichiers important `server/db.js` de manière
statique.

**`server/db.js`** (lot 1.1) — `masterAccount()` construit le compte maître
depuis `MASTER_EMAIL` / `MASTER_PASSWORD` et **lève** si l'une manque (y compris
si elle ne contient que des espaces). L'objet `MASTER` est évalué après la
déclaration de `hashPassLegacy`, ce qui supprime au passage la dépendance au
hoisting signalée par l'item #55/W. `readDb()` **synchronise** le maître
existant sur l'environnement (e-mail toujours, hash seulement s'il n'est pas
déjà en scrypt — sinon la migration P22 du login serait défaite à chaque
lecture, avec un `writeDb` à chaque requête).

**`src/shopStore.js`** (lot 1.1) — plus aucun compte maître côté client :
l'export `MASTER`, la fonction `masterUser()` et le seed dans `loadUsers()` sont
supprimés. Conséquence assumée : le mode 100 % local n'a plus de comptoir (les
pages Desk/Master exigent une session maître, qui ne peut venir que du
serveur) — cohérent avec leur conception, elles étaient déjà vides sans API.

**`server/index.js`** (lots 1.1 + 1.10) — `master: MASTER.email` retiré de
`/api/health` ; garde de démarrage `assertMasterConfigured()` avec message
lisible et code de sortie 1.

**`src/masterSecrets.test.js`** (lot 7.2) — 8 tests : absence d'export `MASTER`
côté client, `masterAccount()` lit l'environnement et lève s'il manque, le
serveur refuse de démarrer sans compte maître (processus enfant réel),
scan du dépôt à la recherche d'identifiants codés en dur, `/api/health` ne
divulgue plus l'e-mail, et migration d'une **base existante** compromise. Les
motifs du scan sont assemblés à l'exécution pour ne pas se détecter eux-mêmes.
Test vérifié **régressif** : avec la synchronisation retirée, il échoue.

**Documentation et scripts** (lot 1.2) — `README.md`, `docs/GUIDE-DEMO.md`,
`-FR`, `-AR`, `docs/DEPLOY-VERCEL.md`, la spec `docs/superpowers/`, et les
quatre scripts de recette (`smoke-e2e.mjs`, `audit-crawl.mjs`,
`verify-p19-live.mjs`, `jsdom-crawl.mjs`) qui passent par le nouveau
`scripts/masterEnv.mjs`. `.env.example` documente les deux variables
obligatoires.

### ✅ Fait — reste du lot 1 (15/09/2026)

Ordre suivi : 1.4/1.5 → 1.6 → 1.7/1.8/1.9 → 1.11/1.12/1.13/1.14/1.15/1.18 → 1.3.
Le lot 0 (rotation des secrets réels) est **reporté à la fin** à la demande du
commanditaire : c'est une action d'exploitant sur Vercel, pas du code.

**1.4 — champ « mot de passe actuel » (F2).** Le serveur exigeait `current`
depuis P16 (#13) ; `api.changePassword(password)` n'envoyait que `{ password }`
et `ProfilePage` n'avait aucun champ correspondant → **403 systématique**, la
fonctionnalité était morte pour tous les utilisateurs. Corrigé côté client
uniquement (le serveur était juste) : `changePassword(password, current)`, champ
`#pf-pw-current` avec `<label>` réel et `autoComplete="current-password"`, et les
deux autres champs étiquetés au passage. Les trois clés i18n
(`currentPassword`, `authErrorCurrentPassword`, `passwordRevokedSessions`) sont
ajoutées en **fr / en / ar**. Un 403 `current_password` affiche désormais
« mot de passe actuel incorrect » au lieu de « 6 caractères minimum ».

**1.5 — purge des sessions (R6).** `POST /api/me/password` supprime toutes les
sessions de l'utilisateur **sauf la courante** (`auth.token`, déjà renvoyé par
`userFromReq`) et répond `{ ok, revoked }` ; le reset maître
(`/api/master/customers/:id/reset-password`) les supprime **toutes** — un reset
sert typiquement à reprendre un compte compromis. L'UI affiche le nombre de
sessions révoquées (`role="status"`).

**1.6 — rate-limit + hachage asynchrone (R4/R5).** Limites ajoutées :
`/api/auth/register` 20/10 min, `GET /api/me` 120/min, `PUT /api/me` 30/min,
`/api/me/password` 5/10 min, `/api/oauth/start` 10/min — toutes **avant**
l'authentification, pour couper aussi un flot non authentifié qui coûterait une
lecture de base par requête. `hashPassAsync` (`crypto.scrypt` + callback)
remplace `scryptSync` sur les **quatre** routes qui hachent : inscription,
changement de mot de passe, reset maître, et la migration de hash du login
(P22 item 1) qui appelait `hashPass` **dans le mutateur** — verrou d'écriture
tenu ~35 ms de plus à chaque connexion d'un compte seedé. Le seuil
d'inscription est aligné sur celui du login (20) : 10 pénaliserait les foyers
derrière une seule IP publique, cas courant en Algérie.

**1.7 — échappement HTML du consentement démo (R2).** `demoConsentHtml`
interpolait `state` — query param brut, donc entièrement contrôlé par le
visiteur — dans un attribut. Fonction `esc()` appliquée à **toutes** les
interpolations (`state`, `label`, `name`, `email`, bouton), pour ne plus avoir à
décider lesquelles sont « sûres ». La CSP du serveur bloquait déjà l'exécution du
handler ; elle ne bloquait pas l'injection de balisage (hameçonnage, ajout de
champs, détournement du `form action`).

**1.8 — injection de formule CSV (R3).** `csvEscape` préfixe désormais `'`
devant toute cellule commençant par `= + - @`, tabulation ou retour chariot. Le
quoting existant ne protégeait pas : il entoure la cellule mais **conserve le
`=` initial**, qu'Excel interprète. Effet de bord assumé et documenté : un nom
commençant réellement par `-` s'affichera avec une apostrophe dans certains
tableurs.

**1.9 — validation serveur des commandes (R9).** `POST /api/orders` valide
`name` (non vide, ≤ 64), `wilaya` (whitelist `WILAYAS_NEAR`, repli `Oran` si
absente) et `slot` (whitelist `SLOTS`, vide accepté) ; `POST /api/auth/register`
valide `wilaya` comme le faisait déjà `PUT /api/me` (P10). Le plan ne demandait
la borne de longueur que pour les commandes : elle est posée au même plafond
(64) sur **l'inscription** et sur **`PUT /api/me`**, parce que c'est le même
nom, affiché aux mêmes endroits (comptoir, export CSV, message WhatsApp) — un
`maxlength` client n'est qu'indicatif, un `fetch` direct l'ignore. Le code
d'erreur `name_too_long` est mappé en `authErrorName` dans `AuthPanel` et
`ProfilePage` (fr / en / ar) : sans cela `t()` retombe sur la clé et
l'utilisateur lit le code brut. **Non corrigé,
volontairement :** `carrier`. Le rapport le listait comme libre, mais la route le
**recalcule** déjà côté serveur (`phoneCarrier(body.phone)`) et ignore la valeur
envoyée — le champ client n'atteint jamais la base.

**1.11 — plus d'URL CDN en base (R7, option b).** `uploadBlob` renvoie le chemin
relatif `/api/upload-file?name=…` **même quand le contenu part sur Vercel Blob**
(la route fait déjà un 302 vers `resolveBlobUrl(name)`). Les deux branches
renvoient la même forme d'URL, `img-src 'self'` suffit (un 302 ne fait pas
partie des sources soumises à CSP), et `deleteBlob` résout le chemin relatif en
objet Blob avant le repli filesystem — sinon la compensation d'erreur de
`savePhotoDataUrls` (P18) aurait laissé des objets orphelins. Les URL CDN déjà
stockées restent supprimables.

**1.12 — `price ≤ 0` refusé au patch (R11).** `sanitizeProductPatch` exige
`price > 0`, comme `createProduct` : l'asymétrie permettait de mettre une
référence du catalogue à 0 DA, et `priceOf` recalculait les commandes à 0 sans
avertissement.

**1.13 / 1.18 — repli OAuth validé et journalisé (R13/R18).**
`configuredFrontUrl()` (server/oauth.js) valide `FRONT_URL` → `FRONT_ORIGIN` →
`OAUTH_REDIRECT_BASE` → `VERCEL_URL`, garde **origine + chemin**, et tombe sur
`BASE`. Une valeur malformée est journalisée **une fois** par valeur
(`warnOnce`), avec un message qui relie la cause au symptôme : sans schéma,
`new URL()` levait dans `safeReturnUrl` et **tout** returnUrl légitime était
rejeté en silence. Le `Location` porteur de token ne concatène plus
`process.env.FRONT_URL` brut.

**1.14 — comparaison à temps constant (R15).** La dernière branche de
`verifyPass` (empreinte legacy sha256 non salée) comparait avec `===` ; elle
utilise `timingSafeEqual` comme les deux autres, avec garde de longueur. Gain
marginal (empreinte non salée) mais l'incohérence entre branches d'une même
fonction de vérification n'a pas lieu d'être.

**1.15 — limites et erreurs explicites sur OAuth (R16).** `/api/oauth/start` est
limité (10/min) ; `intent: 'link'` **sans session** renvoie désormais
`400 auth_required` au lieu d'être stocké avec `userId: null` puis de retomber
silencieusement sur la branche login (`finishIdentity` exige `intent === 'link'
&& userId`) — le paramètre du client était ignoré sans erreur.

**1.3 — mode local assumé comme mode démo (R10).** `hashPass` de
`src/shopStore.js` est un FNV-1a 32 bits : non réparable côté navigateur, et
aucun secret ne doit de toute façon vivre dans le bundle. `AuthPanel` affiche en
mode local un encart `role="alert"` qui nomme l'algorithme, dit que les comptes
restent dans le navigateur, et interdit d'y saisir un vrai mot de passe ou une
donnée sensible. Clés `demoModeTitle` / `demoModeNote` en fr / en / ar. Les trois
comptes de démonstration (`karim31`, `amina31`, `yacine31`) sont **conservés** :
`role: 'customer'`, non privilégiés, documentés comme tels — leur suppression
relève d'une décision produit, pas de ce lot.

**Tests** — `src/serverFixes.test.js` (48 tests) et `src/clientFixes.test.js`
(11 tests), ajoutés au script `test` de `package.json`. Les limites de débit étant en mémoire **par processus**, les tests
qui les épuisent tournent contre des serveurs enfants dédiés (base et compteurs
propres) plutôt que contre le handler importé dans le processus du runner.
Sensibilité vérifiée : `===` remis dans `verifyPass`, purge de sessions retirée,
neutralisation CSV supprimée → 5 tests échouent.

**Découvertes hors rapports** (ni corrigées ici, ni perdues — à traiter dans un
lot ultérieur) :

- ✅ **Corrigée au lot 2** (voir ci-dessous) — la branche
  `s.startsWith('sha256$pcstar:')` de `verifyPass` était **morte**, et pire :
  elle comparait la valeur stockée à `sha256$pcstar:<mot de passe EN CLAIR>`,
  alors qu'une empreinte legacy préfixée vaudrait `sha256$pcstar:<hex>`. Aucune
  donnée réelle n'entre dans ce format (vérifié sur la base du commit d'origine
  `fdbd778`). Les comptes seedés sont en fait traités par la **dernière**
  branche (hex nu). L'analyse du lot 1 la disait « inoffensive » : elle était en
  réalité **une porte** — `password === <hex>` la satisfaisait, soit un
  pass-the-hash depuis n'importe quel dump de `store.json` ou backup.
- Les comptes seedés (maître + trois démos) sont donc vérifiés par cette
  dernière branche, celle que 1.14 corrige. Leur connexion par mot de passe est
  maintenant couverte par un test (`src/serverFixes.test.js`), avec contrôle de
  la migration P22 vers scrypt au premier login — c'était le seul appelant
  synchrone restant, il fallait un garde-fou.

### ✅ Fait — lot 2, bloquants fonctionnels (15/09/2026)

Ordre suivi : découverte hors rapports (`verifyPass`) → 2.1 → 2.2 → 2.3 → 2.4 →
2.5 → 2.6 → 2.7 → 2.8.

**Découverte hors rapports — `verifyPass`, branche `sha256$pcstar:`
(`server/db.js`).** Le lot 1 la disait morte et inoffensive ; elle était en fait
**une porte** : la comparaison portait sur `sha256$pcstar:` + le mot de passe **en
clair**, donc `password === <hex>` la satisfaisait — quiconque lisait une
empreinte préfixée (dump de `store.json`, backup) pouvait se connecter **avec
l'empreinte elle-même**. Aucun mot de passe réel ne pouvait en revanche la
satisfaire, d'où l'illusion d'une branche morte. La comparaison porte désormais
sur l'empreinte du mot de passe proposé (`hashPassLegacy(password)` préfixé),
toujours à temps constant, et la branche hex nu — celle qui traite réellement les
comptes seedés — est inchangée.

**2.1 (F1) — `go('cart')`.** La branche `next === 'cart'` est remontée **en tête**
de `go()`, avant la réécriture `if (!KNOWN_PAGES.includes(next)) next = 'shop'`.
`KNOWN_PAGES` reste la liste des pages réelles : le panier est un *offcanvas*, pas
une page. Depuis le configurateur, « Ajouter la config au panier » ouvre
effectivement le panier au lieu de renvoyer sur la boutique.

**2.2 (F3 + F4) — un seul algorithme de code de commande.** Nouvelle fonction
partagée `nextOrderCode(existingCodes, day)` dans `src/orderLogic.js` : séquence =
**max** des codes du jour + 1. `makeOrderCode` (`server/catalog.js`) et
`nextLocalOrderCode` (client, repli hors-ligne) l'appellent tous les deux — le
serveur comptait `sameDay.length + 1`, ce qui produisait un doublon dès qu'une
commande du jour était supprimée (0001/0002/0003, 0002 supprimée → la suivante
recomptait 0003, déjà attribué ; deux `PS-20260915-0003` observés en base pendant
l'audit). Détail de fuseau : les composants de la date sont passés **un par un** à
`new Date(...)` — `new Date('YYYY-MM-DD')` serait interprété en UTC et reculerait
d'un jour avant 1 h à Oran (UTC+1).

**2.3 (F5) — les commandes hors-ligne survivent à la fusion.** Le repli local de
`reserve()` marque la commande `localOnly: true` (jamais le chemin API) ;
`mergeServerOrders` réinjecte les orphelins ainsi marqués **devant** la liste
serveur. Deux garde-fous : une copie locale d'une commande supprimée côté serveur
n'a pas ce marqueur et ne ressuscite donc pas ; en cas de collision de code,
l'objet **serveur** gagne et le marqueur tombe. `handleOrderDelete` a reçu la voie
locale correspondante (sans elle, `DELETE /api/orders/:code` répondrait 404 et la
fusion suivante ferait revenir la commande) — la copie navigateur part avec l'état.
Un badge `ordersLocalOnly` (clé existante, fr/en/ar) signale la commande sur
`DeskPage` et `OrdersPage` : elle n'est ni dans l'export CSV, ni visible des autres
appareils.

**2.4 (F6) — la confirmation d'un compte ne suit pas le suivant.**
`setReserved(null)` ajouté dans `logout()` **et** dans l'effet `authId` (qui
réinitialisait déjà le panier et le formulaire de retrait). Les deux gardes sont
nécessaires : `logout()` n'entraîne pas toujours un changement d'`authId`
observable. Sur un poste partagé, le client suivant voyait « Réservation confirmée ·
Karim B. · 12:30 · 45 000 DA » — la confirmation d'un autre, avec ses données.

**2.5 (F9) — contrôle de SKU sur le catalogue complet.** `MasterPage` construit
`allKnownSkus = [...PRODUCTS, ...masterCatalog, ...products, ...meta.extraProducts]`
et le passe à `addProduct`. Avant, seul `products` — le catalogue **public filtré**
(`stock > 0`, `src/App.jsx:273`) — était examiné : le SKU d'une référence en
rupture **ou masquée** n'était dans aucune liste et la création passait, donnant
deux fiches avec la même référence d'étiquette, le même dossier photo et la même
ligne d'export CSV. Le mode local s'aligne sur la source de vérité du serveur
(`[...PRODUCTS, ...extraProducts]`, `server/masterApi.js`).

**2.6 (F10) — `needs` unifié.** `normalizeNeeds()` (exporté) ramène chaîne **ou**
tableau à un tableau de 12 chaînes au plus ; la découpe d'une chaîne se fait sur
les **retours à la ligne uniquement** — les virgules restent dans le texte
(« Alim 750W, 20 cm » est un seul besoin : les séparer serait une interprétation).
`createProduct` stocke un tableau, `sanitizeProductPatch` accepte les deux formes,
et `migrateNeeds()` normalise la base au premier accès des chemins master (champ
**absent** compris : `[]` plutôt que `undefined`, forme uniforme). Un **second
volet**, découvert par les tests : `updateProduct` n'appliquait `needs` que dans la
branche « override du catalogue de base » — pour un produit **créé** par le maître
(`extraProducts`), le champ était validé puis **silencieusement jeté**, la route
répondant 200 avec un produit inchangé. Corrigé. Côté front, `needsText()`
(`src/ProductPage.jsx`) : un tableau se joint avec ` · ` (React concatène un
tableau de chaînes **sans séparateur**) et `[]` — truthy en JS — n'affiche plus un
encart vide. Au passage, chaque ligne est bornée à 160 caractères
(`MAX_NEED_LINE`) : `needs` était le **seul** champ texte du patch non borné —
`name` ≤ 120, `short` ≤ 200, `brand` ≤ 60, `sku` ≤ 40 — et une ligne de 4 Ko
partait en base puis dans la fiche produit, l'export CSV et le message WhatsApp.

**2.7 (F11 + B20) — la réponse du serveur est la source de vérité.** `submitPanel`
prenait `res.meta`, le meta calculé **localement** par `addPanel` : au 13ᵉ panneau,
le comptoir en affichait 13 alors que la base n'en gardait que 12
(`body.extraPanels.slice(0, 12)`), et le 13ᵉ disparaissait au rechargement suivant
sans aucun message. `doTogglePanel` reconstruisait de même le meta côté client. Les
deux prennent désormais `onMeta({ ...meta, ...(r.data?.meta || {}) })`. La **fusion**
est indispensable (volet B20) : la réponse de `PUT /api/master/panels` ne porte que
`hiddenPanelIds` et `extraPanels` — remplacer le meta entier aurait écrasé
`extraProducts`, `productOverrides` et `photoOverrides` à chaque manipulation de
panneau. Les branches locales (hors API) conservent le calcul local, seul juste dans
ce mode.

**2.8 (F12) — commandes guest de l'appareil.** `OrdersPage` liste pour un compte
connecté l'**union** `o.userId === user.id || o.userId == null`, chaque commande
sans compte étant marquée d'un badge `orderGuestBadge` (clé ajoutée en fr / en / ar).
Avant, les commandes passées en guest depuis cet appareil disparaissaient dès la
connexion — y compris celle qui venait d'être faite, le client se connectant souvent
**après** avoir réservé (le serveur, lui, les rattache déjà par téléphone dans
`/api/me/orders`). Limite assumée et documentée dans le code : sur un appareil
partagé, un compte connecté voit aussi les commandes guest d'un tiers faites sur le
même navigateur — c'est la frontière de confiance du `localStorage`, la même que
celle du serveur qui rattache par numéro saisi ; le badge dit d'où vient la ligne.

**Chargeur de tests — `scripts/jsx-test-loader.mjs`.** Le stub Bootstrap posé au P20
se contentait d'un drapeau interne sans toucher l'élément. Or c'est la classe `show`
posée par `Offcanvas.show()` qui rend le panier visible : sans elle, aucune assertion
DOM sur l'ouverture du panier (2.1, 2.4) n'était possible. Le stub reproduit
désormais ce que l'API réelle fait au DOM — classe `show`, attributs ARIA, événements
`show`/`shown` et `hide`/`hidden` — et tient un registre par élément
(`getOrCreateInstance` ne recrée plus une instance à chaque appel). Restent simulés :
l'animation, le backdrop, le focus-trap et le blocage de scroll — sans effet sur ce
que l'app **décide**. Aucun test existant ne dépendait du comportement inerte.

**Tests** — deux fichiers ajoutés au script `test` de `package.json` :
`src/lot2Logic.test.js` (**27 tests**, logique pure : codes de commande après
suppression / annulation / vue partielle / journée invalide / fuseau, fusion des
commandes locales-only, normalisation et migration de `needs` y compris le patch sur
un produit créé) et `src/lot2UI.test.js` (**13 tests**, composants **réels** rendus
en jsdom : `App` — configurateur → panier, poste partagé Karim → Amina ;
`MasterPage` — SKU en rupture, SKU masqué, SKU libre, 13ᵉ panneau, masque de panneau
avec meta périmé ; `OrdersPage` — union guest, badge, mode sans compte). Suite
complète : **425 tests, 0 échec** ; `npm run build` passe. Vérification bout-en-bout
sur le serveur de prévisualisation : 3 commandes créées (`PS-20260915-0001/0002/0003`),
la 2ᵉ supprimée, la suivante → **`0004`** (avant : `0003`, déjà attribué) ; produit
créé avec `needs` en chaîne puis patché en chaîne, en tableau et en nombre →
**200** à chaque fois, valeur normalisée en tableau ; SKU d'une référence en rupture
du catalogue de base → **400 `sku_taken`** côté serveur comme côté local.

Sensibilité vérifiée — chaque correctif retiré **un par un**, puis restauré :
branche `'cart'` remise après le garde-fou → 1 test échoue ; les deux
`setReserved(null)` retirés → 2 ; `products` passé au lieu de `allKnownSkus` → 2 ;
meta local dans `submitPanel` → 1, dans `doTogglePanel` → 1 ; filtre strict
`userId === user.id` → 2 ; badge guest retiré → 1 ; branche préfixée de `verifyPass`
revenant au mot de passe en clair → 1 (pass-the-hash). Aucun test du lot n'est
vacant.

### ⚠️ Reste à faire par l'exploitant (lot 0 — reporté à la fin, à la demande)

**Rappel du risque tant que ce lot n'est pas fait :** le code est propre, mais
**le secret diffusé reste valide** sur le déploiement réel. Toute personne ayant
lu le bundle ou la documentation d'avant correction peut encore se connecter en
`master` sur la production actuelle. C'est pourquoi ce lot était prévu AVANT le
code ; il est ici reporté à la fin sur instruction explicite du commanditaire,
et reste la **seule** étape qui ne peut pas être faite depuis ce dépôt.

1. Choisir un `MASTER_EMAIL` et un `MASTER_PASSWORD` **neufs et forts**.
   ⚠️ Ne **pas** réutiliser `pcstar.info31@gmail.com` comme `MASTER_EMAIL` :
   c'est l'adresse de contact publique du magasin (`src/data.js:19`, affichée en
   pied de page et présente dans le bundle à ce titre). Un identifiant de
   connexion ne doit pas être une information publique — sinon l'identité du
   compte maître reste devinable, et seul le mot de passe protège l'accès.
2. Poser les deux variables : `.env` local (déjà ignoré de git) **et** Vercel →
   Project → Settings → Environment Variables.
3. Redéployer. Au premier démarrage, `readDb()` aligne le compte maître
   existant : les anciens identifiants cessent de fonctionner, commandes et
   clients sont conservés (vérifié sur une base de test reproduisant l'état
   antérieur).
4. Vérifier : `POST /api/auth/login` avec les anciennes valeurs doit renvoyer
   **401**, avec les nouvelles **200 + `role: 'master'`** ; `GET /api/health` ne
   doit plus contenir de champ `master`.
5. Consulter l'historique (commandes, clients) pour vérifier qu'aucun tiers n'a
   exploité l'accès pendant la période d'exposition.



```
Lot 0  (immédiat, hors code)     → changer les mots de passe exposés
Lot 7.1 (avant tout le reste)    → isoler les tests de l'environnement
Lot 1  (sécurité)                → 1.1 → 1.2 → 1.4/1.5 → 1.6 → 1.7/1.8/1.9 → reste
Lot 2  (fonctionnel bloquant)    → 2.1 → 2.2 → 2.3 → 2.4 → reste
Lot 3  (robustesse)              → 3.1 → 3.2 → 3.3/3.5 → reste
Lot 4  (multi-appareil)
Lot 5  (UI)
Lot 6  (qualité)
Lot 7.2/7.3/7.4 (au fil de l'eau, avec chaque lot)
```

**Pourquoi 7.1 en premier :** tant que la suite dépend de l'environnement du
poste, aucun des autres lots ne peut être validé de façon fiable — c'est exactement
le piège décrit (à tort pour cette machine, mais réellement) par l'item #53.

**Pourquoi le Lot 0 avant le Lot 1 :** corriger le code sans invalider le secret
déjà public laisse la faille ouverte. Le mot de passe `star31` est dans le
bundle **et** dans cinq fichiers de documentation.

---

## 10. Note sur la couverture de tests

Les **315 tests passent** avec l'intégralité de ces bugs présents. Concrètement :

- `src/apiServer.test.js` utilise `pcstar.info31@gmail.com` / `star31` comme
  identifiants de test à 9 endroits (`:69,121,148,183,209,234,263,291,311`) —
  la présence du secret n'est pas testée, elle est **présupposée** ;
- aucun test ne couvre : `go('cart')`, le changement de mot de passe depuis
  l'UI, `makeOrderCode` après suppression, l'échappement du consentement OAuth,
  `csvEscape` sur une formule, la purge de sessions après changement de mot de
  passe, la validation de `wilaya`/`slot`, le stockage bloqué en iframe.

Le lot 1.1 rendra ces 9 tests **rouges** (les identifiants n'existeront plus en
dur) : il faut les réécrire pour créer leur propre compte master via
l'environnement de test. C'est attendu et fait partie de la correction.
