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

> ✅ **Fait** (15/09/2026) — 3.1 à 3.19 (**B22 était FAUX** dans les rapports :
> rien à corriger, aucun code touché), plus une découverte faite en écrivant les
> tests (le démarrage purgeait le jeton API sur une panne transitoire) et une
> observation non corrigée, à trancher (jetons de session présents dans
> `store.json` et donc dans les backups). Détail, tests et vérification de
> sensibilité (17 mutations) au §9.

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

### 🔎 Lot 8 — Découverte hors rapports, audit A→Z du 16/09/2026 (A1→A10)

Ajouté après l'exécution des lots 1 à 6 : analyse complète du dépôt à la
recherche de défauts que les deux rapports d'origine ne listent pas. Détail,
preuves et reproductions exécutées dans **`docs/VERIFICATION-RAPPORT-AUDIT-3.md`**.
Les deux rapports d'origine restent **non modifiés**.

| # | Correction | Fichiers | Taille | Critère d'acceptation |
|---|---|---|---|---|
| 8.1 ✅ | **A1** 🔴 **LIVRÉ le 16/09/2026** — Refuser une commande sur un produit **masqué** (`hiddenProductIds`) dans `placeOrder`, dans la transaction et avant tout décrément ; `409 unavailable` côté route ; message dédié **et retrait de la ligne du panier** côté client | `server/catalog.js:72-168`, `server/index.js:826-925`, `src/orderLogic.js` (`orderApiFailure`), `src/App.jsx` (`reserve`, `pricedCart`) | M | Masquer un produit puis le commander en anonyme → **409**, stock inchangé, aucune commande créée, aucune notification |
| 8.2 ✅ | **A2** 🔴 **LIVRÉ le 16/09/2026** — Refuser une ligne dont le prix de référence est inconnu (`priceOf` → `null`) au lieu de la tarifer **0 DA** ; purger les entrées orphelines de `db.stock` et `productOverrides` dans `normalizeDb` (journalisées) | `server/catalog.js:58-90`, `server/db.js:271-340` | M | `placeOrder` sur un id inconnu présent dans `db.stock` → refus `unknown_product`, **aucune** commande à 0 DA ; après `writeDb`, la clé orpheline a disparu et les overrides valides sont conservés |
| 8.3 ✅ | **A3** 🟠 **LIVRÉ le 16/09/2026** — Lire le drapeau `claimable` côté client : pas de bouton « Annuler » sur une commande non revendicable, mention explicite, et message d'échec distingué du 404 | `src/OrdersPage.jsx:130-140`, `src/App.jsx` (`cancelMyOrder`), `src/i18n.js` (nouvelle clé × 3) | S | Une commande `claimable: false` s'affiche **sans** bouton d'annulation ; un clic forcé (API directe) renvoie un message qui dit pourquoi |
| 8.4 ✅ | **A4** 🟠 **LIVRÉ le 16/09/2026** — Limite de corps alignée sur la contrainte réelle : nouveau module `src/limits.js` (une seule source), `MAX_BODY_BYTES = IS_SERVERLESS ? 4 Mo : 15 Mo`, `config.api.*` inerte **supprimé** d'`api/index.js` et remplacé par la vérité (4,5 Mo requête **et** réponse, non relevable), 413 qui annonce `maxBytes` + `platformLimit`, limite documentée | `src/limits.js`, `api/index.js`, `server/index.js:142`, `server/blobStore.js:36-37`, `docs/DEPLOY-VERCEL.md` §7 | S | ✅ Vérifié en direct sur un banc `VERCEL=1` : `MAX_BODY_BYTES=4194304`, corps de 4,20 Mo → `413 {"maxBytes":4194304,"platformLimit":4718592}` — le JSON de l'application, jamais la page plateforme |
| 8.5 ✅ | **A5** 🟠 **LIVRÉ le 16/09/2026** — Compression à **budget d'octets** : `dataUrlBytes()` mesure le poids décodé, ré-encodage aussi à `scale === 1`, boucle bornée (qualité 0,8→0,5 puis dimensions ×0,8, plancher 320 px, 12 itérations max), jamais plus lourd que l'entrée à dimensions constantes ; **garde de total** `payloadOverBudget()` avant création ET édition des photos, message `masterPhotosTooHeavy` × 3 langues | `src/limits.js`, `src/photoCompress.js`, `src/MasterPage.jsx:13,193,269`, `src/i18n.js` | M | ✅ 6 photos au plafond client (400 Ko décodés → corps 3,13 Mo) → `200`, 6 stockées ; 7 → écrémées à 6 ; photo de 3 Mo écartée ; corps > 4 Mo → **aucun appel réseau**, toast chiffré |
| 8.6 ✅ | **A6** 🟠 **LIVRÉ le 16/09/2026** — Normaliser les destinataires WhatsApp avec la règle partagée (`waNumber`/`phoneLogic`), rejeter un numéro non normalisable, signaler une configuration invalide **au démarrage** et dans `/api/health` ; exemple de la doc au format international | `server/notify.js:39-57`, `server/index.js` (démarrage + health), `docs/DEPLOY-VERCEL.md` §3 | S | `WHATSAPP_RECIPIENT=0770650387` → destinataire `213770650387` envoyé à Meta ; un numéro invalide est refusé au boot avec un message lisible, pas à la première commande |
| 8.7 ✅ | **A7** 🟡 **LIVRÉ le 16/09/2026** — Durabilité de l'écriture : nouveau module `server/durableWrite.js` (tmp → **fsync du fichier** → rename → **fsync du répertoire**, non bloquant), `fs` injectable pour tester l'**ordre** des appels ; `writeDb()` et `ensure()` câblés, plus aucun `writeFileSync`+`renameSync` à la main | `server/durableWrite.js`, `server/db.js:11,262,846` | S | ✅ Coupure simulée entre écriture et rename : la cible garde son contenu précédent (fs factice **et** fs réel) ; l'ordre open→write→**fsync**→close→rename→fsync(dir) est vérifié par test |
| 8.8 | **A8** 🟡 — Un seul module de formatage date/monnaie, locale dérivée de la langue (ou `fr-DZ` assumé **partout**) ; `OrdersPage` cesse d'ignorer la langue | nouveau `src/format.js`, `src/OrdersPage.jsx:119`, `src/DeskPage.jsx:76`, `src/data.js:66` | S | En mode arabe, la même commande affiche la même date au Desk et dans « Mes commandes » ; la décision (varier ou figer) est écrite dans le code |
| 8.9 | **A9** 🟡 — Supprimer les 62 clés i18n mortes × 3 langues (186 chaînes), sauf décision contraire explicite par groupe ; verrouiller par un test dans `i18n.coverage.test.js` (toute clé doit être référencée, directement ou par préfixe dynamique **déclaré**) | `src/i18n.js`, `src/i18n.coverage.test.js` | M | Le balayage ne remonte plus aucune clé morte ; une clé ajoutée sans usage fait **échouer** la suite |
| 8.10 | **A10** 🟡 — Valider `category` (contre `CATEGORIES`, hors `all`) et `kind` (contre `KINDS`) à la création et au patch produit ; refus `400` explicite plutôt que correction muette | `server/masterApi.js:93-136,200-262` | S | Créer un produit avec `category: "SSD"` → **400** `category` ; un produit master créé via le formulaire apparaît bien dans le filtre de sa catégorie |

**Ordre conseillé :** 8.1 et 8.2 d'abord (argent et intégrité des commandes, même
chemin de code — à livrer ensemble), puis 8.6 (canal d'alerte du maître, échec
silencieux), 8.3, ensuite 8.4 + 8.5 (même sujet : ce qui part vraiment sur
Vercel), puis 8.7 à 8.10.

**Règle inchangée :** chaque correctif est livré **avec son test de régression**,
et la sensibilité du test est vérifiée par neutralisation (le correctif retiré
doit faire rougir le test) — comme pour les lots 1 à 6.

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

### ✅ Fait — lot 3, robustesse & concurrence (15/09/2026)

Ordre suivi : 3.1 → 3.2 → 3.3→3.11 + 3.16 (client, `App.jsx`) → 3.12 → 3.13 →
3.14 → 3.15 → 3.10 → 3.18 → 3.19 → 3.17 (vérifié déjà satisfait). **B22 était
FAUX** dans les deux rapports (voir `VERIFICATION-RAPPORT-AUDIT-2.md`) : rien à
corriger, aucun code touché.

**3.1 (F7 + F8) — un seul stockage sûr : `src/safeStorage.js` (nouveau).**
Tous les accès (`App.jsx`, `prefs.js`, `shopStore.js`, `api.js`) passent
désormais par un wrapper qui ne lève **jamais** et retombe sur un repli mémoire
par clé. Deux pièges traités explicitement : `typeof localStorage !== 'undefined'`
ne protège pas (le getter de `Window` lève `SecurityError`, et `typeof`
l'évalue) ; la résolution reste **paresseuse** (P22) — le stockage réel est
résolu à chaque appel, jamais capturé à l'évaluation du module. Une clé dont
l'écriture persistante échoue est « ombrée » : sa copie mémoire fait foi à la
lecture, sinon un `QuotaExceededError` en cours de session (photos master en
data-URL) laisserait relire la valeur périmée du disque. L'UI le dit
(`storageBlockedNote`, fr/en/ar) : c'est la seule façon honnête d'expliquer un
panier qui ne survit pas au rechargement. Le wrapper maison d'`App.jsx` — ajouté
précisément pour ces iframes, mais **sans** try/catch — est supprimé.

**3.2 (B1 + B2 + B3) — driver fichier de `server/db.js` réécrit.**
(a) `purgeExpired` / `stripInternalKeys` / seed des démos / synchronisation du
maître ne tournent plus à chaque lecture : normalisation **en mémoire** à la
lecture, persistée au démarrage (`initDb()`, appelé par `startLocalServer`) et à
chaque écriture. Un GET n'écrit plus sur le disque. Exception assumée : un
fichier qui contient encore `_lastAuth`/`_err` est purgé **immédiatement** à la
lecture — la propriété de sécurité (aucun token dans les backups) passe avant
l'absence d'écriture. (b) Verrou fichier `store.json.lock` (`openSync('wx')`,
atomique) autour du read-modify-write, attente bornée 4 s, verrou orphelin repris
après 10 s, repli « écriture sans verrou » **tracé** plutôt que blocage ;
`updateDb` relit sous verrou (pas de cache) donc deux processus ne se marchent
plus dessus. (c) Cache mémoire invalidé par `mtimeMs` + `size`, avec compteurs
(`dbCacheStats`). Le driver Neon n'a pas besoin du verrou : `updateNeonState`
verrouille déjà sa ligne.

**3.3 → 3.7 — état React : effets de bord hors des updaters, valeurs à jour.**
`App.jsx` reçoit des **miroirs synchrones** (`cartRef`, `reservationsRef`) et
quatre helpers : `setCart` (calcule `next` hors updater, met à jour état +
miroir, persiste **après**, renvoie `next`), `loadCart` (sans écriture),
`syncReservations` (état + miroir, pour les données d'origine serveur) et
`commitReservations` (état + miroir + copie navigateur, pour les mutations
locales). Tous les sites qui écrivaient dans le stockage **depuis** un updater
ont été convertis : en StrictMode, React rappelle les updaters — une mutation
produisait deux écritures, et la clé de stockage était choisie au moment du
*rappel*, pas de l'appel (B6). Sur ces miroirs s'appuient : le code de
commande locale calculé sur `reservationsRef.current` avant les `await` (B7 —
deux réservations hors-ligne quasi simultanées produisaient le même code) ; la
garde de stock évaluée **dans** la mise à jour, sur `prev` (B8 — double-clic
avec stock 1 = 2 unités au panier, puis 409 `stock` ou survente locale), idem
pour le plafond de `setQty` ; l'annulation d'une commande **serveur** en mode
mixte appelle `refreshStock()` au lieu d'incrémenter `stockMap` (B9 — unités
fantômes à l'affichage, le serveur ayant déjà rendu le stock) ; et une garde de
fraîcheur par numéro de séquence sur `refreshStock` **et** sur le chargement
initial (B10 — trois appels croisés : c'était la réponse la plus lente, donc la
plus ancienne, qui s'appliquait en dernier). `applyCatalog()` est maintenant le
point d'application unique d'une réponse de catalogue, et c'est lui qui marque le
catalogue serveur « prêt » : sans cela, une réponse de démarrage périmée —
jetée par la garde — aurait laissé `serverCatalogReady` à `false` alors que
l'état frais était déjà en mémoire, et la boutique serait retombée sur le
catalogue statique.

**3.8 + 3.9 (B11 + B12 + B13) — sessions mortes : le dire, et ne pas les
provoquer.** `src/api.js` expose `setUnauthorizedHandler` /
`clearUnauthorizedHandler` : tout 401 sur une route authentifiée passe par un
seul point, qui purge le jeton, repasse en mode local, coupe `apiOnline` et
affiche `sessionExpired` — **une seule fois** par session morte (`sessionExpiredNotified`,
réarmé dès qu'une session est appliquée). Les routes `/api/auth/*` sont exclues :
un 401 de `login` est une réponse normale (« identifiants incorrects »), pas une
session expirée ; un échec réseau (statut 0) n'est pas un 401. Le retour OAuth
appelle `applyApiSession()`, à **tentatives bornées** (3, repli 700 ms
progressif) avec message d'échec visible (`authRetryFailed`) : avant, une API
lente au retour OAuth laissait l'utilisateur sur la vitrine, sans retry et sans
aucun message. Le démarrage utilise la même fonction (2 tentatives) et **ne purge
le jeton que sur un refus définitif (401)** — sur un 503, un timeout ou un réseau
coupé, le jeton est conservé : la session est toujours valable côté serveur et le
chargement suivant retentera. C'est le test qui a fait sortir ce cas : la purge
sur panne transitoire déconnectait le maître pour rien.

**3.10 (B14 + B15) — socket Desk : on arrête d'insister, et on compte juste.**
Côté client (`src/deskStream.js`), après **8 échecs consécutifs** d'ouverture
(upgrade refusé, constructeur qui lève, fermeture immédiate) le socket est
abandonné (`socketGaveUp()`, callback `onGiveUp`) et le polling — source de
vérité — continue seul : sur Vercel, où il n'y a pas de WebSocket serverless, on
retentait indéfiniment pour rien. Une ouverture réussie remet le compteur à zéro
(échecs *consécutifs*). Côté serveur, heartbeat `ping`/`pong` toutes les 30 s :
un client qui n'a pas répondu au ping précédent est retiré du registre puis
terminé. Un socket TCP à moitié mort (onglet en veille, coupure sans FIN) reste
`readyState === OPEN` pour toujours : le comptoir se croyait en direct et
`deskClientCount()` comptait des fantômes.

**3.11 (B16) — commandes arrivées pendant l'absence du comptoir.**
`seenOrderCodes` est une ref : elle repart de zéro à chaque chargement, et le
premier pull se contentait de l'initialiser — les résas arrivées pendant la nuit
s'affichaient sans bip ni notification. `prefs.js` persiste désormais
l'horodatage du dernier pull réussi (`pcstar-desk-seen-at`, pris **avant**
l'envoi) ; au premier pull, les commandes plus récentes que cet horodatage sont
annoncées : toast agrégé (`deskNewOrders {n}`, ou `deskNewOrder` pour une seule)
et notifications navigateur **bornées à 3** (`MAX_MISSED_NOTIFY`) — 20 résas
nocturnes ne doivent pas produire 20 notifications. Sans horodatage (tout
premier démarrage), l'initialisation reste silencieuse : annoncer tout
l'historique serait du bruit. Le pull s'arrête net sur 401 (le handler global
prend la main) au lieu de fusionner quoi que ce soit.

**3.12 (B17) — 413 ferme la connexion.** Le corps est refusé **avant** d'avoir
été lu jusqu'au bout ; répondre sur une connexion keep-alive pendant que le
client envoie encore ses octets, c'est prendre le risque que la réponse ne soit
pas lue et que la requête suivante, sur le même socket, commence au milieu d'un
corps abandonné. La réponse porte `Connection: close` et le socket est fermé
(`destroySoon`) dès qu'elle est partie.

**3.13 (B18) — configuration OAuth lue à la demande.** `OAUTH_DEMO` et
`OAUTH_REDIRECT_BASE` étaient évalués une fois, à l'import du module : un test
(ou un rechargement à chaud) qui les posait ensuite continuait de voir les
valeurs du démarrage. `oauthDemo()` / `oauthBase()` remplacent les constantes :
toutes les lectures suivent l'environnement courant.

**3.14 (B4) — plus d'override résiduel.** Masquer puis réafficher un produit du
catalogue laissait `meta.productOverrides[id] = {}` pour toujours : entrée
résiduelle recopiée dans chaque backup et chaque export de meta. La clé est
effacée dès que l'override redevient vide ; un override réel survit à
masquer/réafficher.

**3.15 (B5) — backups uniques.** Le nom ne portait que la seconde courante :
deux backups dans la même seconde (timer 6 h + sauvegarde manuelle) écrivaient le
même fichier, silencieusement, et `capBackups` croyait avoir 14 jeux. Suffixe
aléatoire de 3 octets **après** l'horodatage — le tri alphabétique reste
chronologique et le motif `store-*.json` est inchangé (aligné sur `quarantineDb`).

**3.16 (B19) — repli dégradé daté.** `readDbSafe()` distingue deux replis :
`cache` (dernière lecture réussie de ce processus, avec son horodatage) et
`static` (aucune lecture n'a jamais abouti → catalogue du build, `asOf: null` =
âge inconnu). `/api/catalog` les expose (`db.asOf`, `db.source`) et le bandeau
client affiche l'âge via `Intl.RelativeTimeFormat` dans la langue de l'interface
(`catalogDegradedSince` / `catalogDegradedStatic`, fr/en/ar) — au lieu de laisser
deviner si les prix ont cinq secondes ou trois mois. Les écritures restent
strictes : jamais faire croire qu'une commande a été enregistrée.

**3.17 (B21) — déjà satisfait, vérifié et verrouillé.** `hashPassLegacy`
(`server/db.js`) est déclaré **avant** `const MASTER = masterAccount()` : plus
aucune dépendance au hoisting. Un test assertit désormais l'ordre dans le source
(une réorganisation innocente en apparence ne peut plus réintroduire le piège) et
l'absence du mot de passe en clair dans l'objet maître.

**3.18 (R14) — plus aucun token dans une URL.** (a) Retour OAuth : le serveur
redirige avec `#oauth_token=…` (fragment) au lieu de `?oauth_token=…`. Un
fragment n'est jamais renvoyé au serveur : il ne finit ni dans les journaux
d'accès du front, ni dans le `Referer` des requêtes suivantes, ni dans
l'historique d'un proxy. Le client lit le fragment (l'ancien paramètre en query
reste accepté en repli le temps qu'un retour déjà en vol atterrisse), applique la
session, puis nettoie l'URL par `history.replaceState` **immédiatement**.
(b) WebSocket Desk : l'upgrade est accepté sans token dans l'URL ; le client
s'authentifie par son **premier message** (`{type:'auth',token}`). Tant qu'il
n'est pas authentifié, le socket n'est pas dans le registre de diffusion (il ne
reçoit rien) et il est fermé au bout de 5 s. Codes applicatifs : `4401` premier
message non-authentification, `4403` token invalide ou non-master, `4408` aucune
authentification dans le délai, `4429` trop de sockets en attente (plafond 32,
anti-abus puisque l'upgrade n'est plus filtré). Un front ancien en cache qui
envoie encore `?token=` reste accepté (même vérification master) le temps du
déploiement. Les tests et `scripts/verify-p19-live.mjs` ont été mis à jour : ils
assertaient l'ancien contrat (token en query, refus 401/403 à l'upgrade).

**3.19 (R17) — rate-limit : limite documentée et assumée.** Les compteurs vivent
dans une `Map` en mémoire du process : exacte sur un serveur local, mais sur
Vercel chaque instance (cold start, montée en charge, région) a **ses**
compteurs — un attaquant qui multiplie les instances multiplie son budget. Ce
n'est donc pas une frontière de sécurité sur Vercel, c'est un frein ; la défense
réelle reste un `MASTER_PASSWORD` long + scrypt (+ WAF Vercel). En-tête de
`server/rateLimit.js` et section dédiée dans `docs/DEPLOY-VERCEL.md` §7 (tableau
des cas, et la marche à suivre si le multi-instances devient réel :
`@upstash/ratelimit` ou Vercel KV, contrat `{ ok, retryAfter }` inchangé). La
même section documente l'absence de WebSocket sur Vercel et le repli polling.

**Découverte en écrivant les tests (corrigée, hors rapports).** Le démarrage
purgeait le jeton API dès que `me()` échouait, **y compris sur une panne
transitoire** (503, timeout, réseau coupé) : une API momentanément injoignable
déconnectait le maître et coûtait sa session au client qui venait de revenir
d'OAuth. La purge est maintenant réservée au refus définitif (401). Voir 3.9.

**Observation hors rapports — CORRIGÉE à la demande du commanditaire (15/09/2026).**

*Constat.* Le registre `db.sessions` était indexé **par jeton** : les jetons de
session valides — y compris celui du maître — se trouvaient donc dans
`store.json`, recopiés dans chaque backup (`backupStore`, timer 6 h + `npm run
backup`) et dans chaque quarantine. Un backup qui fuit donnait des sessions
immédiatement utilisables, sans mot de passe à deviner.

*Correction.* La table est désormais indexée par **`sha256(token)`** (hex, 64
caractères) ; le jeton brut n'existe plus que dans la réponse d'authentification
et dans le stockage du navigateur. Cinq fonctions centrales remplacent tout accès
direct (`server/db.js`) : `hashToken`, `putSession`, `createSession`,
`findSession`, `deleteSession`. Sites convertis : login, inscription, OAuth
(`server/oauth.js`), déconnexion, `/api/me`, changement de mot de passe, reset
maître, suppression d'un client (`server/catalog.js`). Les boucles de révocation
(« toutes les sessions SAUF la courante ») comparent des empreintes et ne voient
donc jamais le jeton — y compris le jeton courant, passé sous forme d'empreinte.

*Migration.* `normalizeDb` supprime toute clé de session qui n'est pas une
empreinte (`/^[a-f0-9]{64}$/`) et cette purge est **persistée immédiatement à la
lecture** — même traitement que `_lastAuth` (P13/S3) — pour qu'aucun backup pris
dans l'intervalle ne puisse emporter un jeton utilisable. Les jetons bruts font
48 hex, les empreintes 64 : la distinction est sans ambiguïté. **Conséquence
assumée** : les sessions en cours au moment du déploiement sont invalidées,
chacun se reconnecte une fois (arbitrage du commanditaire).

*Effet.* `store.json`, les backups et les quarantines ne contiennent plus aucun
jeton rejouable ; lire la base ne suffit plus à s'authentifier (présenter
l'empreinte en guise de jeton renvoie 401).

*Deux défauts découverts en testant ce durcissement, corrigés dans le même
mouvement.*

1. **`normalizeDb` renvoyait `changed = true` à chaque lecture.** Le bloc de
   réinjection du maître réassignait son empreinte legacy **à l'identique**
   (`!startsWith('scrypt$')` reste vrai tant que P22 ne l'a pas migrée en
   scrypt). Or ce drapeau pilote la persistance depuis le LOT 3.2 (B2/B3) : un
   faux positif remettait une écriture au démarrage là où rien n'avait changé. La
   condition exige désormais une valeur réellement différente, et l'idempotence
   est vérifiée par test.
2. **`backupStore` pouvait rendre un chemin déjà mort** (reprise du B5, LOT 3.15).
   Le nom de backup ne descendait qu'à la seconde : à horodatage égal, c'est le
   suffixe aléatoire qui décidait de l'« ancienneté » dans le tri alphabétique de
   `capBackups`, et le backup le plus récent pouvait être supprimé par son propre
   bornage — d'où un test intermittent. Corrigé par l'horodatage à la
   **milliseconde** (`slice(0, 23)` ; les noms legacy à la seconde trient toujours
   avant) et par un paramètre `protect` sur `capBackups` : le fichier qu'on vient
   de créer n'est jamais candidat à la suppression.

*Recette.* Nouveau fichier `src/sessionTokens.test.js` (15 tests : unités
`hashToken`/`putSession`/`findSession`/`deleteSession`/`normalizeDb`, puis bout
en bout login, inscription, déconnexion, empreinte rejetée, révocation par
changement de mot de passe, reset maître, suppression de client, migration des
clés legacy) ; contrats existants alignés (`securityFixes.test.js` S3,
`dbIntegrity.test.js` — dont un nouveau cas « clés legacy purgées et persistées
», `lot3Server.test.js` B2/S3) et deux cas ajoutés à `masterApi.test.js` pour le
bornage. **Suite : 486/486**, stable sur deux exécutions complètes ; build Vite
inchangé ; aperçu vivant re-vérifié (12 contrôles : jeton utilisable, aucune clé
brute en base, empreinte rejetée, clé legacy purgée du fichier et absente des
backups, déconnexion effective).

> Chiffre rectifié au lot 4 : `npm test` liste ses fichiers explicitement et
> `src/sessionTokens.test.js` n'y avait pas été ajouté — ces 15 tests étaient
> verts (exécutés fichier par fichier) mais ne tournaient pas dans la suite de
> référence. Liste complétée au lot 4 : **528 tests**. Voir « Découverte de
> processus » plus bas.

**Tests.** Quatre nouveaux fichiers : `src/lot3Client.test.js` (17 — safeStorage
et ses deux pièges, horodatage du pull Desk, handler 401, plafond de
reconnexion), `src/lot3Server.test.js` (25 — écritures concurrentes du driver
fichier, absence d'écriture à la lecture, clés internes, `db.asOf`/`source`,
413 + `Connection: close`, OAuth lu à la demande, override vide, backups uniques,
ordre des déclarations, les 6 cas d'authentification WebSocket, heartbeat et
fantômes), `src/lot3UI.test.js` (15 — bandeau dégradé daté/Statique/absent,
session expirée annoncée une seule fois, résas manquées annoncées ou non,
double-clic avec stock 1, retour OAuth par fragment et par query legacy, retry
borné, échec définitif, réponses de catalogue croisées, écriture unique en
StrictMode) et `src/lot3StorageBlocked.test.js` (1 — sonde d'acceptation de 3.1 :
`localStorage` qui lève sur chaque accès, l'app monte, affiche la boutique, le
dit, et le panier fonctionne en mémoire). Tests existants mis à jour là où ils
assertaient l'ancien contrat : `securityFixes` (fragment), `notifyP19` (URL du
socket sans token + premier message), `apiDegraded` (`db.source`/`asOf`).
Suite complète : **483 tests, 0 échec** ; `npm run build` passe.

Vérification bout-en-bout sur le serveur de prévisualisation (API réelle + front
réel) : catalogue sain → `db.source='db'`, `asOf` horodaté ; corps de 16 Mo →
**413 avec `Connection: close`** ; parcours OAuth démo complet → `Location:
…/#oauth_token=…` (**aucun** token en query) et le jeton du fragment répond 200
sur `/api/me` ; socket Desk → muet fermé **4408** après 5,02 s, premier message
`ping` fermé **4401**, token invalide fermé **4403**, token master → `hello
{authed:true}` et socket conservé ; trois backups déclenchés dans la même seconde
→ trois fichiers distincts (`store-2026-09-15T19-00-49-221e62.json` au démarrage
du serveur).

Sensibilité vérifiée — chaque correctif retiré **un par un**, puis restauré
(17 mutations) : écriture remise dans l'updater (B6) → 1 test rouge ; garde de
stock remise avant l'updater (B8) → 1 ; garde de fraîcheur retirée (B10) → 1 ;
handler 401 rendu inerte (B11) → 2 ; horodatage du Desk ignoré (B16) → 1 ; purge
sur panne transitoire rétablie (B12) → 1 ; âge du repli masqué (B19) → 1 ;
`Connection: close` retiré (B17) → 1 ; `asOf`/`source` retirés (B19 serveur) → 1 ;
override vide conservé (B4) → 2 ; suffixe aléatoire retiré (B5) → 2 ;
configuration OAuth figée à l'import (B18) → 1 ; socket authentifié d'office
(R14) → 5 ; écriture pendant la lecture rétablie (B2) → 1 ; plafond de
reconnexion retiré (B14) → 2 ; token remis dans l'URL du socket (R14) → 1 ;
`try/catch` retiré de `getItem` (F7) → 1. Aucun test du lot n'est vacant.

### ✅ Fait — lot 4, multi-appareil & données (15/09/2026)

Les cinq items du lot 4 (§7) sont corrigés : F14, F15, F16, R20, U11.

**4.1 (F14) — noms de photos uploadées.** `savePhotoDataUrls` construisait le nom
`${id}-${Date.now().toString(36)}-${i}.${ext}` : deux envois du même produit
tombés dans la même milliseconde (double clic sur « enregistrer », deux onglets
master, retry) produisaient le **même** nom. Sur le repli filesystem,
`writeFileSync` écrasait la première photo sans erreur (deux URL de la fiche
pointaient vers un seul fichier) ; sur Vercel Blob, `put` avec
`allowOverwrite: false` **échouait**, donc tout l'enregistrement tombait et la
compensation supprimait les photos déjà envoyées. Un suffixe aléatoire de 6 hex
est ajouté (`…-<ts36>-<6hex>-<i>.ext`) : le nom reste dans la borne de 200
caractères de `safeUploadName` et le motif `store-*`/`sku-*` inchangé. La branche
Blob fixe désormais **explicitement** `addRandomSuffix: false` : tout le contrat
de LOT 1.11 (la base stocke `/api/upload-file?name=<clé>`, puis
`resolveBlobUrl`/`deleteBlob` reconstruisent cette clé) suppose que la clé Blob
est exactement le nom envoyé — si l'option basculait, chaque photo pointerait
vers une clé inexistante.

**4.2 (F15) — plus d'upload éphémère sous Vercel.** Sans
`BLOB_READ_WRITE_TOKEN`, le repli filesystem écrit dans `/tmp/pcstar-uploads` :
la photo « montait » (201, URL en base, aperçu immédiat tant que l'instance
vivait), puis `/api/upload-file` renvoyait 404 au cold start suivant — des URL
mortes en base, sans aucun signal au moment de l'upload. **Arbitrage : refuser
plutôt que fabriquer des photos fantômes.** `uploadBlob` lève
`UPLOAD_STORAGE_UNAVAILABLE` sous serverless sans Blob ; les trois routes photo
passent par un nouveau `savePhotoDataUrlsSafe` qui traduit ce code en
`error: 'upload_storage'` (au lieu de laisser l'exception partir dans le
gestionnaire global et répondre « server »), et `errToast` côté master affiche un
message qui nomme la variable à poser (`masterPhotoNoStorage`, 3 langues). Le
repli filesystem local est inchangé.

**4.3 (F16) — suppression d'un client.** `purgeUser` déliait les commandes
(`userId = null`) sans les annuler : le stock décrémenté par `placeOrder` restait
réservé pour un compte qui n'existe plus, sans trace nulle part (la fiche client
venait de disparaître). Les commandes **en cours** (`new`, `pending`,
`preparing`, `ready`) sont maintenant annulées via `cancelOrder` — qui rend le
stock et garde la trace (`status: 'cancelled'`, `cancelledAt`, nom/télé
snapshotés) ; `picked` (retirée, stock consommé) et `cancelled` (déjà rendue) ne
bougent pas, donc aucun double rendu. La fonction renvoie le détail
(`cancelled`, `releasedLines`, `left`), la route `DELETE /api/customers/:id` le
transmet, et le master voit un toast qui le dit
(`masterCustomerGoneOrders`, 3 langues) au lieu d'un « Client supprimé » muet.

**4.4 (R20) — commande guest au numéro d'un tiers.** `POST /api/orders`
recherchait un compte au numéro saisi… non : il ne cherchait rien, et
`GET /api/me/orders` rattachait par téléphone toute commande guest au titulaire
du numéro. Un inconnu pouvait donc déposer une commande dans l'historique
d'autrui — et le titulaire l'annuler. La commande est maintenant marquée
`claimable: false` **à la création** quand le numéro appartient à un compte
existant et que l'acheteur n'est pas ce compte (guest, ou un autre compte
connecté qui livre à ce numéro) ; `isClaimableGuest` (nouveau prédicat partagé
par la lecture et l'annulation) écarte ces lignes. La commande n'est **pas
refusée** : commander au numéro d'un proche reste légitime, elle est simplement
non revendicable — et le comptoir la voit toujours.
*Migration rétroactive volontairement écartée* : marquer les lignes déjà en base
masquerait aussi les commandes passées par un client **avant** son inscription
(le cas légitime que la règle à la création préserve), et rien ne permet de les
distinguer — les comptes ne portent pas de date de création. On ne réécrit donc
pas l'historique ; les lignes antérieures au correctif gardent le comportement
d'alors.

**4.5 (U11) — commandes legacy `pending`.** Plus rien ne crée ce statut, mais
`GET /api/orders` le remappait en `new` à l'affichage pendant que `PATCH`
(transitions) et `DELETE` lisaient le statut **brut** : le comptoir voyait
« nouvelle » pour une commande dont les transitions étaient évaluées depuis
`pending`. **Arbitrage : migration plutôt qu'affichage distinct.** `normalizeDb`
passe les lignes `pending` en `new` (une fois, persisté à la prochaine écriture —
LOT 3.2/B2 interdit l'écriture à la lecture), et la route sert désormais le
statut réel. Le front garde ses remappings défensifs (`DeskPage`, `OrdersPage`,
`statusLabelKey`) : ils sont inertes tant que la migration tient, et évitent
qu'un statut inattendu ne tombe hors des colonnes du Desk.

**Module partagé.** `server/phone.js` (nouveau) porte `normalizePhone` /
`isDzPhone` côté serveur : `index.js` abandonne ses copies locales (P22 bug A) et
R20 s'appuie sur la même règle que les routes. Le front garde la sienne dans
`src/shopStore.js` — un module serveur n'a pas à tirer le stockage client.

**Découverte de processus — trois fichiers de tests n'étaient pas dans la
suite.** `npm test` liste les fichiers **explicitement** (pas de glob) :
`src/sessionTokens.test.js` (15 tests, durcissement des jetons), puis
`src/lot4Server.test.js` (18) et `src/lot4UI.test.js` (9) n'étaient donc jamais
exécutés par `npm test` — d'où le total « 486 » annoncé au commit précédent, qui
ne les comptait pas. La liste est complétée ; **la suite passe de 486 à 528
tests**. Les tests eux-mêmes étaient verts (exécutés fichier par fichier), mais
une couverture qui ne tourne pas dans la suite de référence ne protège rien :
tout nouveau fichier de test doit être ajouté au script.

**Tests.** `src/lot4Server.test.js` (18 : noms uniques à milliseconde gelée,
formes et bornes des noms, `addRandomSuffix: false`, refus serverless vérifié
dans un **processus fils** avec `VERCEL=1` — rien d'écrit —, repli local
préservé, traduction du refus par les routes, `purgeUser` sur les cinq statuts +
rendu de stock exact + idempotence, bout en bout suppression d'un compte,
les cinq cas R20 — tiers, numéro libre, titulaire, autre compte, numéro du
maître —, migration `pending`, fidélité du statut servi, absence de remapping)
et `src/lot4UI.test.js` (9 : `errToast` — stockage, offline, repli ;
`customerDeletedMessage` — sans commande, avec codes, bornage à 4 ; MasterPage
**réel** dans jsdom : clic sur « Supprimer » → toast de résumé avec le code de
la commande, fiche retirée ; échec → message d'échec, pas de résumé inventé).

Sensibilité vérifiée — chaque correctif retiré **un par un**, puis restauré
(13 mutations, toutes rouges) : suffixe aléatoire retiré (F14) → 2 tests ;
`addRandomSuffix: true` (F14) → 1 ; refus serverless neutralisé (F15) → 1 ;
`upload_storage` requalifié en `server` (F15) → 1 ; message client neutralisé
(F15) → 1 ; annulation des commandes neutralisée (F16) → 2 ; résumé retiré de la
réponse (F16) → 1 ; toast de résumé remplacé par le message muet (F16) → 1 ;
marquage `claimable` retiré (R20) → 2 ; prédicat de lecture neutralisé (R20) →
2 ; détection à la création neutralisée (R20) → 2 ; migration `pending`
neutralisée (U11) → 2 ; remapping d'affichage réintroduit (U11) → 1. Aucun test
du lot n'est vacant.

Aperçu vivant re-vérifié (API + front réels) : deux créations de produit avec
photo lancées ensemble → 2 fichiers distincts, aucun échec ; double envoi sur le
même produit → 200/200 ; suppression d'un client avec une commande `new` →
`cancelled: [{code…}]`, stock rendu (9 → 11), commande conservée en historique
(`userId: null`) ; commande guest au numéro d'un compte → `claimable: false`,
absente de son historique, annulation refusée (404), visible au comptoir ;
numéro libre → commande retrouvée après inscription ; ligne legacy `pending` →
servie `new`, persistée à l'écriture suivante, transition possible ; sessions
toujours indexées par empreinte sha256.

### ✅ Fait — lots 5 et 6, honnêteté de l'UI et qualité du code (16/09/2026)

Commit `eea1853`. Les deux lots sont livrés ensemble : ils se touchent dans les
mêmes fichiers (`App.jsx`, `MasterPage.jsx`, `SearchPage.jsx`, `shopStore.js`,
`prefs.js`), et un correctif de qualité y conditionne souvent un correctif
d'honnêteté — Q1 (une seule `stockLabel`) est ce qui rend U1 possible sans
quatre ternaires, Q6 (un seul prédicat de socket) est ce qui fait que le Builder
n'affiche pas « compatible » tout en masquant les pièces correspondantes.

**Lot 5 — ce que l'écran affirme doit être vrai**

`src/App.jsx` (U1) — l'indicateur d'état de la topbar était **codé en dur** :
point vert + `SYS.ONLINE` en permanence, API morte ou base en repli comprise. La
seule information d'état du site disait donc toujours la même chose, et le
bandeau dégradé (B19) était l'unique indice — une fois descendu dans la page.
`sysState` est maintenant dérivé (`!apiOnline → offline`, `catalogDegraded →
degraded`, sinon `online`), avec trois couleurs (`text-success` / `text-warning`
/ `text-danger`), le curseur clignotant réservé à l'état sain, et une
explication dans la langue de l'utilisateur (`title` + `aria-label`, clés
`sysState_*` × 3 langues). Le libellé terminal reste en anglais : c'est la
charte graphique, et ce qui mentait c'était sa valeur, pas sa langue.

`src/orderLogic.js` (U2) — `shortageMessage()` : un refus pour stock
insuffisant ne nommait qu'un produit, sans quantité demandée ni restante, et
taisait les autres lignes. Le message détaille maintenant jusqu'à 3 lignes
(`{name} — {need} demandés, {left} disponibles`) et annonce `et N autres
lignes`. Les deux sites d'`App.jsx` (réponse serveur et repli local) l'appellent
: avant, le repli hors-ligne disait autre chose que le serveur.

`src/MasterPage.jsx` (U3) — le bouton qui **déclenche** l'enregistrement des
photos disait « Photos enregistrées ». Un libellé d'action se lit comme une
action : `masterSavePhotos` sur le bouton, `masterPhotosSaved` reste le toast de
confirmation.

`src/App.jsx` (U4) — les prix du panier étaient figés à l'ajout (`{...product}`
dans `add()`). Le maître change un prix pendant la visite, le catalogue se
rafraîchit, la vitrine suit — le panier, son total, le récapitulatif de commande
et le message WhatsApp non. Et comme `placeOrder` recalcule les prix côté
serveur, la commande confirmée ne correspondait à rien de ce que l'écran venait
de montrer. `pricedCart` (mémo sur `catalog`) alimente désormais **les quatre**
: affichage, `total`, `items` du payload, `buildWaMessage`. Les écarts sont
recalés dans l'état ET dans le panier persisté, et annoncés
(`cartPriceUpdated`, 2 noms au plus puis `…`) : un prix qui change en silence
sous un total est exactement ce qu'il faut dire. Un produit sorti du catalogue
garde son snapshot (on ne peut pas le repriser).

`src/i18n.js` (U5) — `t()` substituait `String(v)` sans filtre : une variable
`null` ou `undefined` écrivait « null » / « undefined » dans le texte rendu — un
trou de données devenait un mot anglais à l'écran. Les valeurs absentes laissent
le placeholder `{var}` visible (laid, mais vrai : il manque une valeur), tandis
que `0`, `''` et `false` restent des valeurs et sont substituées.

`src/i18n.js` (U6) — `labelOr(t, key, fallback)` : `t(key)` renvoie la clé quand
la traduction manque, et `App.jsx` (vitrine) comme `MasterPage.jsx` (3 sites)
l'affichaient telle quelle — `cat_ssd` à l'écran. Le motif `t(k) !== k ? t(k) :
repli` était déjà recopié à la main dans `BuilderPage`/`SearchPage` ; il est
centralisé et appliqué partout. Aucune des 13 catégories n'a de trou aujourd'hui
(vérifié × 3 langues), mais les catégories maître (`extraProducts`) n'ont aucune
garantie : le repli passe par le libellé brut du catalogue.

`src/orderLogic.js` (U7) — `buildWaMessage()` + `WA_TEXT_LIMIT = 3800` : le
message WhatsApp d'un panier de 40 lignes dépassait la limite pratique de
`wa.me`, qui tronquait **où elle voulait** — généralement au milieu du
récapitulatif, parfois en emportant le total — sans aucun avertissement. Seules
les lignes de panier sont bornées : l'en-tête, l'adresse, les coordonnées et le
total restent intacts, et `waTruncated` dit combien de lignes ont été retirées.
La mention elle-même ne doit jamais pousser le message hors limite (elle ferait
de la place en retirant une ligne de plus, et en dernier recours s'efface) — une
troncature brute mangerait le total, dernière ligne du modèle. `App.jsx`
mémorise le lien (`useMemo` sur `[pricedCart, total, pickup, lang]`) au lieu de
le recomposer à chaque rendu.

`src/PartThumb.jsx` (U8) — l'attribut `sizes="(max-width: 576px) 50vw, 25vw"`
n'est lu par personne sans `srcSet` multi-largeurs, et chaque produit n'a qu'un
fichier par format (uploadé par le maître, ≤ 2,5 Mo, aucune variante générée).
Il annonçait donc une image responsive inexistante et laissait croire à une
optimisation. Retiré ; `width`/`height` restent (ratio réservé, pas de décalage
de mise en page) et le `<picture>` garde son vrai choix — de **format**, webp
puis jpg.

`src/App.jsx` (U9) — `deskBeep()` posait `g.gain.value = 0.04` puis
démarrant/arrêtait l'oscillateur à pleine amplitude : une discontinuité = un
**clic** audible à chaque commande annoncée au comptoir. Le bip censé aider
était le bruit le plus désagréable des deux. Enveloppe désormais : départ à
`0.0001`, attaque exponentielle de 10 ms vers `BEEP_PEAK_GAIN`, retombée
exponentielle vers le silence **avant** l'arrêt, `start`/`stop` calés sur
`currentTime` (pas `Date.now`). L'`AudioContext` unique et partagé (P9) et le
réveil d'un contexte `suspended` sont conservés.

**U10 — décision tranchée, et elle change ce que le code raconte.** La boutique
n'est **pas** conçue pour être encadrée par un tiers : `X-Frame-Options:
SAMEORIGIN` et `frame-ancestors 'self'` (`vercel.json`, `send()`, redirections
OAuth, aperçus d'upload) l'interdisent en production, et c'est voulu — un
magasin encadrable est un magasin clickjackable (une commande validée sous un
calque transparent). Les commentaires de `safeStorage.js`, `api.js`, `prefs.js`,
`shopStore.js`, `App.jsx` et `ContactPicker.jsx` présentaient un « aperçu iframe
tiers » comme un scénario d'usage : cette conception n'existe pas, elle est
retirée des commentaires. **Les en-têtes restent**, et le repli mémoire de
`safeStorage` aussi — le stockage peut être indisponible sans iframe du tout
(Safari ITP, navigation privée, cookies tiers refusés, quota plein, aperçu de
développement), et dans ces cas-là le site doit tourner au lieu de tomber dans
l'ErrorBoundary. La politique, la raison de sécurité et la marche à suivre pour
un assouplissement **délibéré** (une origine explicite en CSP, jamais `*`, plus
une confirmation visible sur les actions sensibles) sont écrites dans
`docs/DEPLOY-VERCEL.md` §« Encadrement (iframe) ».

`src/api.js` (U12) — `URL.revokeObjectURL(url)` appelé dans la foulée de
`a.click()` : le clic ne fait que **demander** le téléchargement, dont la lecture
du blob démarre après. Révoquer immédiatement coupait donc parfois l'export CSV
en plein vol (fichier vide ou téléchargement annulé, de façon intermittente —
plus visible sur les gros exports et les machines lentes). Révocation différée
de `REVOKE_DELAY_MS` (4 s), dans un `try` (une URL déjà libérée ne doit pas faire
échouer l'export).

**Lot 6 — une seule source de vérité par règle**

`src/stockLabel.js` (Q1) — `stockLabel` était dupliqué **quatre fois** avec
**deux conventions** : `App.jsx`/`ProductPage.jsx` renvoyaient `stock-out` /
`stock-low` / `stock-ok` (classes qui n'existent dans aucune feuille de style)
puis les retraduisaient en `text-bg-danger|warning|success` par un ternaire
recopié ; `BuilderPage.jsx`/`SearchPage.jsx` renvoyaient directement
`danger|warning|success`, interpolés en `text-bg-${cls}`. Même rendu final,
quatre sources de vérité : un seuil modifié quelque part (les « 3 dernières
pièces ») ne se voyait pas ailleurs, et une classe inventée passait inaperçue
puisqu'un ternaire la rattrapait. Le module renvoie la classe Bootstrap
**complète** (`STOCK_LOW_THRESHOLD` exporté) : plus aucun appelant n'a rien à
traduire. 5 sites repris — dont un badge `text-bg-${st.cls}` à `SearchPage.jsx`
que le décompte initial (4) avait manqué.

`src/phoneLogic.js` (Q2) — la règle de téléphone (normalisation, opérateur,
validité DZ) était recodée côté client et côté serveur : deux implémentations
d'une même règle métier, avec le risque évident qu'un numéro accepté par l'un
soit refusé par l'autre. `phoneLogic.js` est canonique ; `shopStore.js` et
`server/phone.js` ré-exportent. Piège corrigé au passage : `export { x } from
'./y'` ne crée **aucune liaison locale** — `registerEmail()` appelait
`normalizePhone` et levait `ReferenceError`, donc la création d'un compte e-mail
était cassée par la première version du correctif. D'où `import` **puis**
`export`, et un test qui passe par `registerEmail`/`updateUser` plutôt que par
la seule comparaison des exports.

`src/prefs.js` (Q3 + Q4) — `loadTheme`, `saveTheme`, `resolveTheme` et
`KEY_THEME` supprimés : le thème sombre a été retiré sur demande client
(`App.jsx` : `const theme = 'light'` ; `public/theme-boot.js` : « le site est
définitivement en thème clair »), et rien n'importait ces fonctions hors du
fichier — elles n'étaient ni appelées ni testées, seulement lues par qui
cherchait où se règle le thème. `applyDocumentChrome`, lui, **est** utilisé
(`App.jsx`) et reste. Q4 : il posait `theme-color` à `#f2f5f8` alors
qu'`index.html` et `theme-boot.js` annoncent `#f4f6fb` — la barre du navigateur
changeait de teinte au montage de React. Une constante partagée
(`THEME_COLOR_LIGHT`), et un test qui compare les **trois** sources.

`src/App.jsx` (Q5) — `count` passé au toast « ajouté au panier » sans jamais
être lu (le toast affiche le nom du produit). Retiré ; le badge panier, lui,
affiche toujours le compteur.

`src/BuilderPage.jsx` (Q6) — P17 (comparaison tolérante aux sockets multiples
via `socketsMatch`) n'était appliqué qu'à l'**indicateur** de compatibilité. Les
listes d'options filtraient autrement : `===` pour les CPU, `.includes()` pour
les ventirads (qui rejetait au passage tout ventirad dont `socket` est une
chaîne). Une carte mère multi-socket aurait donc affiché un badge « compatible »
tout en masquant les CPU correspondants dans le sélecteur. Un seul prédicat
désormais, avec la même tolérance que `socketOk` : une donnée de socket absente
ne disqualifie pas (on ne peut pas prouver l'incompatibilité) — le sélecteur
n'est pas plus strict que le contrôle.

`src/SearchPage.jsx` (Q7) — deux défauts qui se déclenchent **ensemble**, sur un
double-clic : `s-${Date.now()}` donnait deux recherches au même `id` (key React
dupliqué → liste mal réconciliée, suppression par id aléatoire), et `...saved`
lisait l'état du rendu en cours → les deux appels partaient de la même liste et
la seconde recherche écrasait la première. Suffixe aléatoire (anti-collision
local, pas un identifiant cryptographique), updateur fonctionnel, et
persistance par effet (`useEffect` sur `saved`) au lieu d'un appel à la main
dans le handler. La borne à 10 (P10) et le stockage par défaut (P15 : `undefined`
et non `null` en premier argument) sont conservés — et testés.

`server/index.js` (Q8) — **trois** écritures des en-têtes CORS :
`Allow-Origin` + `Vary` dans `corsHeaders()`, `Allow-Headers` + `Allow-Methods`
ajoutés **seulement** dans `send()` (donc absents des redirections OAuth et des
aperçus d'upload, qu'un navigateur cross-origin pouvait refuser alors que le
reste de l'API les autorisait), et l'export CSV posant
`'Access-Control-Allow-Origin': FRONT_ORIGIN` à la main — un en-tête **vide**
(invalide) quand aucune origine n'est déclarée. Un seul jeu désormais, dans
`corsHeaders()` (exporté pour être testé), propagé par toutes les routes y
compris la redirection Blob. Le tout reste conditionné à `FRONT_ORIGIN` : sans
origine déclarée, l'API est same-origin et ne pose **zéro** en-tête CORS
(P16 conservé).

`e2e/smoke.spec.js` (Q9) — le test de connexion s'arrêtait à « le corps ne
contient pas de texte d'erreur d'auth » : une assertion **négative**, qui passe
aussi quand la connexion échoue en silence (formulaire refermé, jeton perdu,
session non rechargée). Il vérifie maintenant l'état connecté — bouton profil au
nom du compte démo seedé (`demo-karim`, « Karim B. », `role: 'customer'`),
déconnexion visible, bouton « Connexion » disparu — plus un second test de
survie de la session au rechargement (le chemin cassé par F7/F8 et R20).
`masterSecrets.test.js` autorise explicitement ce fichier : ce sont des
identifiants de **démonstration**, non privilégiés, de même nature que
`scripts/smoke-e2e.mjs` déjà listé — aucun secret maître.

**Tests** — trois fichiers, 75 tests, ajoutés à la liste **explicite** de
`npm test` (le script n'utilise pas de glob : un fichier non listé ne tourne
jamais) : `src/lot5Logic.test.js` (23 — `shortageMessage`, `t()`, `labelOr`,
`buildWaMessage`), `src/lot5UI.test.js` (24 — composants réels rendus dans
jsdom : les 3 états de la topbar avec API stubbée, l'éditeur de photos du
master, le panier recalé + total + toast, `PartThumb`, l'enveloppe du bip sur un
`AudioContext` fictif qui enregistre l'automation de gain, les en-têtes
d'encadrement, la révocation différée avec `setTimeout` capturé),
`src/lot6Quality.test.js` (28 — une seule `stockLabel`, règle de téléphone
identique client/serveur **et** utilisable localement, code mort du thème,
teinte sur 3 sources, toast sans donnée morte, Builder multi-socket rendu,
recherches sauvées à `Date.now` figé, sondes `corsHeaders` en processus enfant
avec et sans origine, smoke e2e). Suite complète : **603/603** (528 avant les
deux lots), build propre.

Vérification **régressive** par neutralisation (chaque correctif est remis en
état cassé, le test doit échouer, puis restauré) : indicateur codé en dur (U1) →
2 ; total sur le panier figé (U4) → 1 ; enveloppe du bip remplacée par
`gain.value` (U9) → 1 ; `sizes` remis (U8) → 1 ; libellé au passé (U3) → 1 ;
révocation synchrone (U12) → 1 ; détail de stock retiré (U2) → 5 ; `null`
réinjecté dans `t()` (U5) → 1 ; garde de longueur retirée (U7) → 2 ; repli
`labelOr` retiré (U6) → 1 ; `stockLabel` redéfini localement (Q1) → 1 ;
ré-export sans liaison locale (Q2) → 1 ; teinte divergente (Q4) → 1 ; code mort
du thème réintroduit (Q3) → 2 ; filtre CPU en `===` (Q6) → 2 ; `id` sans
suffixe (Q7) → 1 ; `Allow-Methods` retiré (Q8) → 1 ; assertions d'état connecté
retirées du smoke (Q9) → 1, et test de rechargement retiré (Q9) → 1. Deux
premiers essais n'étaient **pas** régressifs et ont été durcis : la
neutralisation de U9 (ajouter `gain.value` *avant* l'enveloppe) ne changeait
rien aux évènements enregistrés — le test ne prouvait donc pas l'absence de
saut d'amplitude ; et celle de Q9 passait parce que le nom « Karim B. » restait
présent dans la constante `DEMO` — le test cherche désormais la construction
d'attente **dans chaque bloc** `test(...)`, et après `page.reload()` pour le
second. Les 18 cas échouent maintenant pour la bonne raison.

### ✅ Fait — lot 8.1 + 8.2, les deux bloquants de l'audit A→Z (16/09/2026)

**A1 + A2 livrés ensemble**, comme le conseillait le §7 : les deux défauts se
corrigent au même endroit (`placeOrder`), et les livrer séparément aurait laissé
une fenêtre où l'un des deux chemins restait ouvert.

**Serveur**

- `server/catalog.js` — `placeOrder` refuse désormais **avant tout décrément** :
  - une ligne dont `priceOf()` renvoie `null` (id inconnu du serveur) →
    `{ ok: false, error: 'unknown_product', unknown: [{ id, name }] }` ;
  - une ligne dont l'id figure dans `meta.hiddenProductIds` →
    `{ ok: false, error: 'unavailable', unavailable: [{ id, name }] }`.

  Le refus est **global** : une seule ligne douteuse fait tomber toute la
  commande, par cohérence avec le contrôle de stock existant (aucun commit
  partiel). La branche `if (!line.id)` du contrôle de stock est devenue morte et
  a été retirée — ces lignes sont refusées plus haut.
- `server/db.js` — nouveau `purgeOrphanCatalogRefs(db)`, appelé par
  `normalizeDb()` : supprime de `db.stock` et `meta.productOverrides` les clés
  dont l'id n'existe ni dans `PRODUCTS` ni dans `meta.extraProducts`, avec un
  `console.warn` qui les nomme. C'est la source même du chemin A2 (trois origines
  réalistes : un id retiré de `src/data.js` — précédent réel, `cpu-5600` et
  `mag-ddr4-16` supprimés au lot P21 —, une migration partielle, une sauvegarde
  restaurée).
- `server/index.js` — route `POST /api/orders` : `unavailable` → **409** (conflit
  avec l'état courant du catalogue, comme la rupture) avec les lignes nommées ;
  `unknown_product` → **400** (requête invalide).

**Client**

- `src/orderLogic.js` — `orderApiFailure()` classe `unavailable` et
  `unknown_product` **avant** la rupture (le premier partage son statut 409) ;
  nouveaux `orderBlockedMessage()` (nomme les lignes refusées, borné à 3 puis
  « et N autres », exactement comme `shortageMessage`) et `dropCartLines()`.
- `src/App.jsx` — `reserve()` : message nommé, **retrait des lignes refusées** du
  panier (état et persistance), reste du panier conservé, `refreshStock()` ; si le
  retrait vide le panier, retour à l'étape 0 plutôt qu'un formulaire de retrait
  face à un panier vide.
- `src/i18n.js` — 4 clés × 3 langues (`orderUnavailable`, `orderUnavailableDetail`,
  `orderUnknown`, `orderUnknownDetail`), blocs rééquilibrés (535/535/535).

**Décisions**

1. **`unknown_product` prime sur `unavailable`.** Un id à la fois inconnu et
   masqué est signalé comme inconnu : c'est le fait le plus fort (on ne peut pas
   dire « retiré de la vente » d'une référence qui n'existe pas), et les deux
   issues refusent la commande de toute façon.
2. **Pas de repli hors-ligne sur ces deux refus.** Le repli local reste réservé à
   `offline` (règle P8) : créer une commande locale sur un article retiré de la
   vente ou fantôme aurait reproduit le bug côté client, sans serveur pour le
   rattraper. Le test vérifie explicitement que `pcstar-orders` reste vide.
3. **Purge conservative.** Si `meta.extraProducts` est présent mais illisible (ni
   tableau ni `null`), `purgeOrphanCatalogRefs` ne retire **rien** et le signale
   (`skipped: true`) : impossible alors de distinguer un orphelin d'un produit
   maître, et effacer un stock légitime est pire que laisser une clé morte.
4. **`qty: 0` → 1 n'est pas corrigé** (constat annexe de l'audit A2). C'est la
   règle `lineQty()` partagée avec le client depuis P22 (bug C) : la symétrie
   décrément/restauration en dépend. Commander 0 unité n'a pas de sens métier ;
   le refuser aurait été un changement de comportement sans bénéfice.

**Piège** — `{lines}` placé en **tête** de chaîne i18n : le test d'interface
extrait le préfixe du message pour l'attendre dans le rendu
(`dict.fr.orderUnavailableDetail.split('{lines}')[0]`), comme le fait déjà
`stockShortDetail`. Avec `{lines}` en premier, le préfixe est vide et
l'assertion échoue sur « préfixe introuvable » au lieu de tester le rendu. Les
deux chaînes détaillées portent donc un libellé **avant** la variable — ce qui se
lit d'ailleurs mieux dans un toast.

**Vérification en direct** (serveur d'aperçu relancé sur le code corrigé) :

| Étape | Avant (audit) | Après |
|---|---|---|
| masquer `gpu-4070s`, confirmer son absence du catalogue public (221 produits) | ok | ok |
| `POST /api/orders` **anonyme** sur ce produit | **HTTP 201**, commande créée | **HTTP 409** `unavailable`, ligne nommée |
| `POST /api/orders` sur `produit-fantome` | accepté, **total 0 DA**, stock décrémenté | **HTTP 400** `unknown_product` |
| stock de la référence masquée après refus | décrémenté | **inchangé (3)** |
| commande légitime (`mousepad`) | 201 | **201**, total 7 500 DA recalculé depuis le catalogue |

État de l'aperçu nettoyé ensuite : référence démasquée (222 produits visibles),
commandes de test annulées, stock rendu (`mousepad` 17 → 18).

**Tests** — 33 nouveaux, répartis en trois fichiers : `src/lot8Logic.test.js`
(22, logique pure serveur + client), `src/lot8Server.test.js` (7, routes HTTP
réelles sur une base semée **avant** l'import du handler — seule façon de voir la
purge réellement persistée dans `store.json`), `src/lot8UI.test.js` (4, App réel
dans jsdom : toast nommé, panier purgé, repli hors-ligne muet). Suite complète :
**636 tests, 636 passent** (603 avant), build propre.

**Neutralisations vérifiées régressives (7)** :

| # | Correctif retiré | Tests qui rougissent |
|---|---|---|
| N1 | contrôle des produits masqués dans `placeOrder` | 8 |
| N2 | refus de l'id inconnu (retour à `price: 0`) | 9 |
| N3 | purge des références orphelines | 6 |
| N4 | mapping 409/400 de la route | 3 |
| N5 | classification `unavailable`/`unknown` côté client | 5 |
| N6 | retrait des lignes refusées du panier | 3 |
| N7 | message nommé (remplacé par un message générique) | 2 |

---

### ✅ Fait — lot 8.6, destinataires WhatsApp normalisés (16/09/2026)

**A6** : `whatsappRecipients()` n'appelait jamais `waNumber()` (qui existe
pourtant dans le dépôt depuis P14, pour les liens `wa.me`) — un
`WHATSAPP_RECIPIENT` au format local algérien partait vers Meta tel quel
(`0770650387`) et était **refusé** : aucune alerte de commande, en silence. La
documentation de déploiement entretenait la faute (« sinon le numéro affiché sur
le site est utilisé » — le site affiche le format local `0770 65 03 87`).

**`server/notify.js`**

- Nouveau `normalizeRecipient()` (interne) : `waNumber()` d'abord — il traite
  toutes les écritures algériennes (`0XXXXXXXXX`, `XXXXXXXXX`, `213…`, `00213…`,
  `+213 …`) ; sinon un numéro de 8 à 15 chiffres **ne commençant pas par 0** est
  gardé tel quel (destinataire étranger déjà international — un fournisseur au
  `+33…` reste joignable) ; sinon l'entrée est invalide.
- `resolveRecipients()` remplace le corps de `whatsappRecipients()` et renvoie
  `{ valid, invalid }` : la liste envoyable **et** les entrées écartées. La
  déduplication se fait **après** normalisation — le même numéro écrit au format
  local puis international ne part plus qu'une fois.
- `whatsappRecipients()` garde sa signature et son contrat (tableau de chaînes),
  donc aucun appelant n'est cassé ; nouveau `whatsappRecipientIssues()` exporté ;
  `whatsappConfig()` expose `invalidRecipients`.
- Une entrée **sans aucun chiffre** (mot résiduel, champ vide) est ignorée en
  silence : ce n'est pas un numéro mal écrit, c'est du bruit de saisie.

**`server/index.js`**

- Démarrage : `console.warn` nommant les entrées écartées avec le format attendu,
  et `console.error` si WhatsApp est **configuré mais sans aucun destinataire
  valide** — le cas critique où les jetons sont là et où aucune alerte ne partira.
- `GET /api/health` : bloc `whatsapp: { configured, recipients, invalid }` en
  **compteurs** uniquement. La route est publique et `WHATSAPP_RECIPIENT` peut
  être un numéro privé (les numéros du magasin, eux, sont déjà affichés sur le
  site) : aucun numéro n'est divulgué, un test le vérifie.

**`docs/DEPLOY-VERCEL.md` §3** — tableau des écritures acceptées et de leur
résultat, exemple `whatsapp.invalid`, mention du cas critique
(`configured: true` + `recipients: 0`), et suppression de la formulation ambiguë
qui suggérait le format local.

**Décisions**

1. **L'étranger reste possible.** Se rabattre sur `waNumber()` seul aurait
   interdit tout destinataire non algérien (la fonction renvoie `''` pour un
   `+33…`). La règle à trois étages garde cette souplesse sans rouvrir le bug :
   un numéro qui commence par 0 après retrait du préfixe `00` n'est pas
   international, donc il est écarté (`0123456789` → invalide).
2. **Écarter plutôt que deviner.** Une entrée douteuse n'est jamais envoyée à
   Meta (échec garanti, quota consommé) : elle est retirée et **signalée**. Le
   canal reste actif pour les autres numéros — un envoi partiel vaut mieux
   qu'aucun (règle P20 déjà en place).
3. **Visibilité au démarrage, pas à la première commande.** Une faute de
   configuration n'est pas un incident d'envoi : elle se lit dans les logs de
   boot et dans `/api/health`, donc avant la première commande perdue.

**Vérification en direct** (serveur d'aperçu, code du correctif) :

| `WHATSAPP_RECIPIENT` | Log de démarrage | `/api/health` |
|---|---|---|
| `0770650387, 12` | `configuré → 213770650387` + warn « 1 entrée(s) écartée(s) … → 12 » | `{configured:true, recipients:1, invalid:1}` |
| `12` | `configuré →` (vide) + warn + **error** « AUCUN destinataire valide » | `{configured:true, recipients:0, invalid:1}` |
| (absent) | `configuré → 213770650387, 213669174617` (défaut P20 inchangé) | `{configured:false, recipients:2, invalid:0}` |

**Tests** — 17 nouveaux dans `src/lot8Notify.test.js` : reproduction exacte de
l'audit, toutes les écritures algériennes, étranger conservé, déduplication,
défaut P20 inchangé, entrées invalides écartées **et** signalées, bruit ignoré,
**payload réellement envoyé** (`to` du corps JSON capturé via un faux `fetch`
Meta — 1 envoi, 2 envois, défaut, échec non bloquant), health en compteurs sans
fuite de numéro, et les deux alertes de démarrage. Suite complète :
**653 tests, 653 passent** (636 avant), build propre.

**Neutralisations vérifiées régressives (5)** :

| # | Correctif retiré | Tests qui rougissent |
|---|---|---|
| N8 | normalisation (retour au `replace(/\D/g,'')` brut) | 10 |
| N9 | signalement des entrées invalides | 3 |
| N10 | bloc `whatsapp` de `/api/health` | 1 |
| N11 | alertes de démarrage | 1 |
| N12 | documentation du format attendu | 1 |

---

### ✅ Fait — lot 8.3, le drapeau `claimable` est enfin lu (16/09/2026)

**A3** : depuis le lot 4.4 (R20), une commande guest déposée au numéro d'un
compte existant est marquée `claimable: false` — le serveur l'écarte de
`GET /api/me/orders` et répond **404** à son annulation. Le client recevait le
drapeau (la copie locale est un spread de la réponse serveur), le persistait, puis
l'ignorait : **zéro occurrence de `claimable` dans tout `src/`**. La page
« Commandes » affichait donc un bouton « Annuler » qui échouait à tous les coups,
avec un message générique (« Annulation impossible ») qui ne disait ni pourquoi ni
quoi faire.

**`src/orderLogic.js`** — nouveau `canCancelHere(order)` : **une seule règle**
pour le bouton et pour la garde de `cancelMyOrder` (statut `new`/`pending` **et**
`claimable !== false`). Entrée invalide (`null`, chaîne) → `false` : un
`undefined` qui traîne n'est pas une commande neuve.

**`src/OrdersPage.jsx`** — le bouton passe par `canCancelHere(o)` ; quand
`o.claimable === false`, une mention courte prend sa place
(`orderNotClaimable` — « Passée sans compte — annulation au comptoir
uniquement »). La commande reste **affichée** (elle est réelle, le client l'a
passée depuis cet appareil) : seule l'action impossible disparaît.

**`src/App.jsx`** — `cancelMyOrder()` :
- le **404** (`not_found`) est distingué de la panne : message dédié
  `orderCancelNotMine` (« Cette commande n'est pas rattachée à votre compte :
  annulation impossible ici ») au lieu de `orderCancelFail`. Un 500 reste
  annoncé comme une panne — le distinguo est testé dans les deux sens ;
- la branche locale (hors-ligne / guest) passe par la **même** règle
  `canCancelHere(target)`, avec `orderNotClaimable` pour le cas `claimable:
  false` et `orderOnlyNew` pour le cas statut. Le doublon de contrôle de statut
  écrit à la main a été retiré.

**`src/i18n.js`** — 2 clés × 3 langues, blocs rééquilibrés (537/537/537).

**Décisions**

1. **Cacher le bouton plutôt que le laisser échouer.** Une action promise et
   impossible est le pire des deux mondes : l'utilisateur réessaie. La mention
   dit quoi faire (au comptoir), ce que le message d'échec ne disait pas.
2. **La commande reste visible.** Masquer la ligne entière aurait fait
   disparaître une commande réelle du navigateur de celui qui l'a passée — le
   drapeau `claimable` porte sur la **revendication par un compte**, pas sur
   l'existence de la commande.
3. **Une règle, un endroit.** Le bouton et la garde locale appellent
   `canCancelHere` : si la règle évolue (nouveau statut annulable, autre
   marqueur), les deux chemins suivent. C'est la leçon des lots 5 et 6 appliquée
   d'emblée.

**Vérification en direct** (serveur d'aperçu) :

| Étape | Résultat |
|---|---|
| commande **anonyme** au `0550123456` (numéro du compte `demo-karim`) | `201`, `claimable=false`, `userId=null` |
| `GET /api/me/orders` en tant que karim | **0 commande** — le serveur l'écarte |
| `POST /api/me/orders/:code/cancel` en tant que karim | **404 `not_found`** — l'échec que le bouton promettait |
| annulation par le **maître** (nettoyage) | `200`, stock `mousepad` rendu (18) |

**Tests** — 11 nouveaux dans `src/lot8Claimable.test.js` : matrice de la règle
pure (statuts × `claimable` vrai/faux/absent, entrées invalides), couverture
i18n des 2 clés, **rendu réel d'`OrdersPage`** (bouton absent + mention présente
sur la ligne `claimable:false`, bouton présent sur la ligne normale, absent sur
`preparing`, un seul bouton au total ; même règle pour un visiteur sans compte ;
`claimable:true` explicite ne bloque pas), **App connecté en mode API** (404 →
message dédié et **pas** le générique ; 500 → le générique et pas le dédié), et
contrôle à la source que la garde locale appelle bien la règle partagée.
Suite complète : **664 tests, 664 passent** (653 avant), build propre.

**Neutralisations vérifiées régressives (5)** :

| # | Correctif retiré | Tests qui rougissent |
|---|---|---|
| N13 | `canCancelHere` ignore le drapeau `claimable` | 3 |
| N14 | `OrdersPage` revient au contrôle de statut seul | 2 |
| N15 | mention « au comptoir » retirée | 2 |
| N16 | branche 404 de `cancelMyOrder` retirée | 1 |
| N17 | garde locale `canCancelHere` retirée | 1 |

**⚠ Piège découvert à cette occasion (à retenir pour tous les tests jsdom).**
Les deux premières neutralisations ne faisaient pas « échouer un test » : elles
**faisaient tuer le processus de test par l'OOM killer** (mesuré dans `dmesg` :
3,7 Go de RSS, 16 Go de mémoire virtuelle, sur une machine à 3,9 Go). Cause :
`assert.equal(nœudDOM, null)`. Quand l'assertion **réussit**, rien ne se passe ;
quand elle **échoue**, Node génère le message en inspectant la valeur réelle —
un élément jsdom remonte vers son `document` puis vers `window`, et
`util.inspect` déroule des centaines de mégaoctets de graphe cyclique. Un test
qui échoue doit coûter quelques kilo-octets, pas la machine : écrire
`assert.ok(!nœud, 'message')`.

Corrigé dans `src/lot8Claimable.test.js` (3 assertions) **et dans les fichiers
antérieurs qui portaient la même bombe latente** : `src/clientFixes.test.js`
(3) et `src/lot3UI.test.js` (1). Ces tests passaient, donc le défaut ne se
voyait pas — il serait apparu le jour où l'un d'eux échoue, en transformant un
échec net en mort du runner. Vérification : les 5 neutralisations produisent
désormais des échecs propres (11 tests exécutés à chaque fois, ~4 s au lieu de
16 s puis SIGKILL).

Second piège, plus discret : un fichier de test qui enregistre des `describe`
**avant et après** des `await` de haut niveau perd des suites. Avec
`node:test`, les suites enregistrées pendant l'évaluation du module partent
immédiatement ; celles déclarées après un `await import(...)` peuvent ne jamais
être exécutées (observé : `1..2` au lieu de `1..4`, 6 tests sur 11, sans aucun
message d'erreur). Règle : **tout le setup asynchrone d'abord, tous les
`describe` ensuite** — c'est déjà la disposition de `lot2UI`/`lot5UI`, que ce
fichier ne respectait pas.

---

### ✅ Fait — lots 8.4 + 8.5, ce qui part réellement sur le réseau (16/09/2026)

**A4 et A5 traités ensemble** : les deux décrivent la même chaîne — ce que le
client comprime, ce que le corps pèse, ce que la plateforme accepte — et aucune
des deux ne se corrige proprement sans l'autre. A4 sans A5 annonce une borne que
le client peut encore dépasser ; A5 sans A4 comprime vers une cible contredite
par une configuration inerte.

**Le problème, en une phrase.** Trois valeurs de « taille maximale » circulaient
(10 Mo annoncés dans `api/index.js`, 15 Mo appliqués dans `server/index.js`,
4,5 Mo réellement imposés par Vercel), recopiées à la main dans cinq fichiers, et
la compression des photos ne regardait **que les pixels** : une image déjà
≤ 800 px repartait telle quelle, quel que soit son poids.

#### `src/limits.js` (nouveau) — une seule source pour tous les budgets

| Constante | Valeur | Rôle |
|---|---|---|
| `VERCEL_MAX_BODY_BYTES` | 4,5 Mo | limite **plateforme**, requête et réponse, non relevable |
| `MAX_UPLOAD_BODY_BYTES` | 4 Mo | garde d'envoi client **et** borne du corps sous Vercel |
| `LOCAL_MAX_BODY_BYTES` | 15 Mo | borne du corps sur un serveur dédié (local/VPS) |
| `MAX_PHOTO_BYTES` | 400 Ko | budget **client** par photo (octets décodés) |
| `MAX_PHOTO_SERVER_BYTES` | 2,5 Mo | borne **serveur** par blob (marge de sécurité) |
| `MAX_PHOTOS` | 6 | plafond de photos par produit, des deux côtés |
| `MAX_INPUT_BYTES` | 10 Mo | poids maximal du fichier choisi avant compression |
| `COMPRESS_FLOOR` | q 0,5 / 320 px / 12 pas | planchers de la boucle de réduction |

Plus les fonctions partagées : `toMb()` (messages), `payloadBytes()` et
`payloadOverBudget()` (garde d'envoi). **La chaîne est vérifiée par test** :
6 × 400 Ko → ~3,2 Mo de base64 ≤ 4 Mo de garde < 4,5 Mo de plateforme, et la
borne serveur par photo (2,5 Mo) accepte toujours ce que le client produit
(400 Ko). Sans ce test, rien n'empêcherait de remonter une valeur et de casser
l'alignement.

#### A4 — les limites annoncées sont celles appliquées

**`api/index.js`** : `export const config = { api: { bodyParser: { sizeLimit:
'10mb' }, responseLimit: '4mb' } }` **supprimé**. C'était une convention
**Next.js** (`pages/api/*`) ; ce dépôt sert ses fonctions via `@vercel/node`
(`vercel.json` réécrit `/api/(.*)` → `/api`), qui ignore cet export. Rien
n'était relevé — seul le commentaire affirmait que si, et il se contredisait
lui-même (« sizeLimit 10 mo … 4 mo reste large »). Un commentaire véridique le
remplace : la limite réelle, l'erreur plateforme (`FUNCTION_PAYLOAD_TOO_LARGE`),
et les trois étages qui bornent le corps.

**`server/index.js`** : `MAX_BODY_BYTES` suivait 15 Mo **y compris sous Vercel**,
une valeur inaccessible — entre 4,5 et 15 Mo, la plateforme refuse **avant**
d'entrer dans le handler et renvoie sa page d'erreur, pas notre 413 JSON.
Désormais `IS_SERVERLESS ? MAX_UPLOAD_BODY_BYTES : LOCAL_MAX_BODY_BYTES` : 4 Mo
en production (sous la limite plateforme, donc c'est **l'application** qui
refuse, avec son message), 15 Mo en local où aucun plafond extérieur ne
s'applique. Le 413 annonce `maxBytes` (la borne réellement appliquée) et
`platformLimit` (non `null` sous Vercel) — un `curl` de diagnostic sait quelle
taille viser. `readBody` et `bodyTooLargePayload` sont exportés pour que la
borne se teste **sans pousser 15 Mo dans un socket**.

**`server/blobStore.js`** : `MAX_BYTES = 2.5 * 1024 * 1024` et `MAX_PHOTOS = 6`
étaient recopiés à la main ; les deux viennent du module partagé.

**`docs/DEPLOY-VERCEL.md` §7** : la contrainte de taille de corps rejoint les
« limites honnêtes », à côté du rate-limit par instance et de l'absence de
WebSocket.

#### A5 — la compression tient un budget d'octets, et le total est borné

**`src/photoCompress.js`** — deux changements :

1. `dataUrlBytes()` mesure le poids **décodé** sans décoder (rapport 3/4 sur le
   base64, rembourrage compté → très léger majorant, ce qu'on veut pour une
   garde). La condition de sortie n'est plus « déjà à taille » mais « déjà à
   taille **et** déjà sous le budget » : un PNG 800×800 de 2 Mo est ré-encodé **à
   dimensions constantes** au lieu de repartir tel quel (2,7 Mo de base64).
2. Une **boucle bornée** réduit jusqu'à tenir le budget : qualité par pas de 0,1
   jusqu'au plancher 0,5, puis dimensions ×0,8 jusqu'au plancher 320 px, 12
   itérations maximum. Elle rend toujours quelque chose d'envoyable — jamais de
   boucle infinie sur une image qui ne se laisse pas comprimer.

Le résultat n'est **jamais plus lourd que l'entrée à dimensions constantes** (un
ré-encodage JPEG peut grossir une toute petite image) ; en revanche une image
**redimensionnée** est toujours rendue, même si le JPEG pèse plus que l'original
— revenir à l'original annulerait la réduction, et c'est bien la taille en
pixels qui compte pour l'affichage et le stockage.

**`src/MasterPage.jsx`** — la garde de **total** avant l'envoi, sur les **deux**
chemins qui portent des dataURL (création de produit et édition des photos) :
`payloadOverBudget()` compare la longueur des chaînes (ce qui voyage dans le
JSON) au budget de 4 Mo, et refuse **avant** `fetch` avec
`masterPhotosTooHeavy` — « Photos trop lourdes après compression : 4.6 Mo
(limite 4 Mo). Retirez une photo ou choisissez des images plus légères. » Les
bornes locales (`MAX_INPUT_BYTES`, les `.slice(0, 6)`) viennent du module
partagé, et `masterPhotoTooBig` ne dit plus « 2,5 Mo » en dur : il cite
`{mb}` = 10 Mo, la vraie limite d'entrée.

**`src/i18n.js`** — 1 clé neuve × 3 langues + 1 clé paramétrée, blocs
rééquilibrés (538/538/538).

**Décisions**

1. **4 Mo, pas 4,5 Mo.** La limite plateforme est 4,5 Mo pour le corps **et**
   pour la réponse ; viser exactement 4,5 laisserait l'en-tête JSON, les autres
   champs du produit et l'arrondi base64 décider de l'échec. 4 Mo laisse ~11 %
   de marge et reste au-dessus du pire cas nominal (3,2 Mo).
2. **Refuser côté client plutôt que laisser la plateforme répondre.** Un 413
   applicatif est un JSON que l'App sait traduire ; `FUNCTION_PAYLOAD_TOO_LARGE`
   est une page HTML que `api.req()` ne peut pas parser — le maître aurait vu
   « Action impossible » sans savoir quoi changer. La garde d'envoi donne le
   poids obtenu, la borne, et le geste à faire.
3. **Le serveur écrême, le client explique.** `masterApi.js` tronque à
   `MAX_PHOTOS` et écarte silencieusement un blob > 2,5 Mo (comportement
   antérieur, conservé) : c'est la bonne posture pour un serveur — ne jamais
   planter sur une entrée trop grande. Mais seul le client peut dire **pourquoi**
   une photo manque ; d'où la garde et les messages côté navigateur.
4. **Une boucle bornée, pas une recherche de qualité optimale.** Douze
   itérations suffisent largement (mesuré : 9 sur une image qui ne cède rien) et
   garantissent l'absence de blocage sur un canvas capricieux.
5. **`readBody` exportée.** Tester la borne via HTTP aurait exigé d'envoyer
   15 Mo par test ; exporter la fonction interne permet une vérification exacte
   et instantanée, sans changer le comportement.

**Vérification en direct**

Banc en configuration serverless (`VERCEL=1`, handler monté sur
`http.createServer` — `node server/index.js` n'écoute pas en serverless) :

| Étape | Résultat |
|---|---|
| démarrage | log `MAX_BODY_BYTES=4194304` (4 Mo, pas 15) |
| corps de **4,20 Mo** (sous 4,5 Mo plateforme, au-dessus de la garde) | `413 {"ok":false,"error":"too_large","maxBytes":4194304,"platformLimit":4718592}` — **notre JSON**, pas la page plateforme |

Serveur local (stockage fichier, `MAX_BODY_BYTES` = 15 Mo) :

| Étape | Résultat |
|---|---|
| 6 photos au plafond client (400 Ko décodés chacune → corps **3,13 Mo**) | `200`, **6 photos stockées** |
| 7 photos du même tonneau (corps 3,65 Mo) | `200`, **6 stockées** — écrémé à `MAX_PHOTOS` |
| 1 photo de 3 Mo décodés + 1 photo au budget | `200`, **1 stockée** — la trop grosse écartée par la borne par blob |
| corps de 16 Mo | `413 {"maxBytes":15728640,"platformLimit":null}` — la borne locale est dite, aucune limite plateforme à annoncer |
| restauration des photos d'origine du produit | `200` |

Sur le banc serverless, l'envoi légitime (6 photos au plafond) renvoie `500`
avec « aucun stockage durable en serverless » : c'est la garde **existante** du
lot 4.2 (pas de `BLOB_READ_WRITE_TOKEN` → `/tmp` éphémère), pas une régression —
et le corps, lui, est bien passé sous la borne (pas de 413).

**Neutralisations** (chaque correctif retiré, les tests doivent rougir) :

| # | Correctif retiré | Tests qui rougissent |
|---|---|---|
| N18 | compression revenue aux dimensions seules (`scale === 1` → brut, boucle supprimée) | **4** |
| N19 | `dataUrlBytes` aveugle (renvoie toujours 0) | **5** |
| N20 | garde d'envoi retirée de `MasterPage` | **1** |
| N21 | `payloadOverBudget` ne borne plus rien | **2** |
| N22 | borne du corps de nouveau 15 Mo partout (branche serverless retirée) | **1** |
| N23 | 413 sans dire la borne appliquée | **1** |
| N24 | `config` Next.js inerte remise dans `api/index.js` | **1** |
| N25 | `blobStore` recopie ses bornes à la main (9 Mo / 12 photos) | **2** |
| N26 | chaîne de budgets incohérente (garde d'envoi à 15 Mo) | **3** |

**Tests** : 19 nouveaux (`src/lot8Payload.test.js`) — cohérence de la chaîne de
budgets, bornes `blobStore` partagées, borne du corps en local **et** en
serverless (processus fils avec `VERCEL=1`, la constante étant évaluée à
l'import), 413 et son payload, absence de configuration inerte, `vercel.json`
sans réglage de corps fantôme, `dataUrlBytes`, ré-encodage à dimensions
constantes, descente de qualité, planchers et bornage de la boucle, « jamais
plus lourd » et son contraire (image redimensionnée), budget par défaut partagé,
maths de la garde de total, pire cas nominal envoyable, et **deux rendus réels
de `MasterPage` dans jsdom** (photos surdimensionnées → aucun appel réseau +
toast chiffré ; photos légères → l'envoi part et le succès est annoncé).
Suite : **683/683** (664 avant), build propre.

**Piège rencontré.** La première version de la garde « jamais plus lourd que
l'entrée » s'appliquait aussi aux images **redimensionnées** : le test existant
« 1600×1200 → 800×600 » échouait parce que le stub de canvas renvoie un payload
minuscule, et le garde-fou comparait des poids sans tenir compte du fait que les
dimensions avaient changé. La règle correcte distingue les deux cas
(`sized.scale === 1`), ce qui est aussi la règle **métier** : le poids ne
justifie d'écarter un ré-encodage que si rien d'autre n'a été amélioré.

---

### ✅ Fait — lot 8.7, l'écriture de la base est durable (16/09/2026)

**A7** : `writeDb()` faisait `fs.writeFileSync(DB_TMP_FILE, …)` puis
`fs.renameSync(DB_TMP_FILE, DB_FILE)`. Le couple tmp + rename (lot 3.2 / B2)
garantit l'**atomicité** — un crash ne laisse jamais un `store.json` à moitié
écrit — mais pas la **durabilité** : sans `fsync`, une coupure d'alimentation
peut publier un nom dont les blocs de données ne sont jamais arrivés au disque.
Au remontage, `store.json` est vide ou tronqué → `quarantineCorrupt` l'isole
(`store.json.corrupt-<horodatage>`) et la restauration repart du dernier backup :
**tout ce qui a été écrit depuis est perdu** (commandes, stock, sessions). Le
commentaire d'origine parlait d'atomicité sans jamais mentionner la durabilité.

**`server/durableWrite.js` (nouveau)** — trois fonctions, `fs` **injectable** :

| Fonction | Ce qu'elle fait | Ce qu'elle rend |
|---|---|---|
| `durableWriteFileSync(file, text)` | `open` → `write` → **`fsync`** → `close` (dans un `finally`) | `true` si le fsync a eu lieu |
| `fsyncDirSync(dir)` | fsync de l'**entrée de répertoire** — jamais bloquant | `true`, ou `false` si le FS refuse |
| `atomicDurableWriteFileSync(file, text, {tmp})` | tmp → fsync → `rename` → fsync du répertoire | `{ synced, dirSynced }` |

**`server/db.js`** — `writeDb()` passe par `atomicDurableWriteFileSync(DB_FILE,
json, { tmp: DB_TMP_FILE })`, et la création initiale de la base (`ensure()`) par
`durableWriteFileSync` : un fichier de base vide/tronqué au remontage serait mis
en quarantaine **avant** qu'aucun backup n'existe. Le commentaire de `writeDb`
dit désormais les deux garanties (atomicité **et** durabilité).

**Décisions**

1. **Tester l'ordre, pas l'effet.** La durabilité ne se vérifie pas en débranchant
   la machine : un `fsync` placé **après** le `rename` compile, passe tous les
   tests fonctionnels et ne garantit **rien**. D'où le `fs` injectable et un test
   qui journalise la séquence exacte — la neutralisation N28 (fsync après rename)
   fait rougir **22 tests**, preuve que la propriété est bien celle qui est
   testée.
2. **fsync du répertoire non bloquant.** Windows ne laisse pas ouvrir un
   répertoire en lecture, certains FS réseau renvoient `EINVAL` : un échec là ne
   doit **jamais** faire échouer une écriture de base — l'essentiel (les données)
   est déjà acquis. La fonction rend `false` au lieu de lever, et c'est testé dans
   les deux cas (`EISDIR` à l'ouverture, `EINVAL` au fsync).
3. **`close` dans un `finally`.** Si le `fsync` lève (`EIO` sur un disque
   mourant), le descripteur ne doit pas fuir — l'exception remonte (l'écriture a
   échoué, l'appelant doit le savoir) mais la ressource est libérée. Testé.
4. **Un FS sans `fsyncSync` reste fonctionnel.** Repli dégradé explicite
   (`synced: false`) plutôt que crash : le chemin d'écriture ne doit jamais
   dépendre d'une capacité optionnelle du système.
5. **Contrepartie écrite, pas passée sous silence.** Un appel système de plus par
   écriture (quelques ms), sur un chemin déjà sérialisé par le verrou
   `store.json.lock`. Le module la documente — l'audit reprochait précisément au
   commentaire antérieur de parler d'atomicité sans dire ce qui manquait.

**Portée volontairement limitée à la base.** `server/blobStore.js:134` écrit les
photos uploadées avec un `writeFileSync` simple : ce chemin reste tel quel. Une
photo partiellement écrite est un défaut **cosmétique** et visible (image
cassée), pas une perte d'état silencieux ; sous Vercel ce répertoire est de toute
façon `/tmp` (éphémère) sauf avec `BLOB_READ_WRITE_TOKEN`, où c'est Vercel Blob
qui garantit la durabilité. Payer un fsync par upload n'aurait pas de
contrepartie mesurable.

**Vérification en direct** (serveur d'aperçu, base `.preview-data/`) :

| Étape | Résultat |
|---|---|
| `store.json` avant | 3 859 o, JSON valide, 1 commande |
| `POST /api/orders` (guest, `cpu-7800x3d`, slot `10:30`) | `201`, code `PS-20260916-0002` |
| `store.json` après | 4 380 o (**+521**), JSON valide, commande **au disque**, stock 6 → 5 |
| résidus | **aucun** `store.json.tmp`, **aucun** `store.json.lock` |
| annulation par le maître | `200`, statut `cancelled` au disque, stock **rendu à 6** |
| résidus après annulation | toujours aucun tmp/verrou, JSON valide, 4 backups présents |

**Neutralisations** (chaque correctif retiré → les tests rougissent) :

| # | Correctif retiré | Tests qui rougissent |
|---|---|---|
| N27 | fsync du fichier retiré (écrit sans durabilité) | **4** |
| N28 | fsync **après** le rename (ordre qui ne garantit rien) | **22** |
| N29 | `db.js` revenu à `writeFileSync` + `renameSync` à la main | **1** |
| N30 | fsync de répertoire bloquant (l'exception remonte) | **2** |
| N31 | descripteur non fermé si le fsync échoue (`finally` retiré) | **1** |
| N32 | création initiale de la base revenue à `writeFileSync` | **1** |

**Tests** : 14 nouveaux (`src/lot8Durable.test.js`) — ordre exact des appels,
écriture réelle sur FS, repli sans `fsyncSync`, fermeture du descripteur sur
`EIO`, fsync de répertoire réussi / `EISDIR` / `EINVAL`, ordre fsync-avant-rename
de la fonction atomique, tmp implicite, **coupure simulée** entre écriture et
rename sur fs factice **et** sur fs réel (la cible garde son contenu précédent),
intégration `writeDb()` (store.json valide, aucun `.tmp` résiduel, mémoire et
disque concordent), contrôle à la source de `server/db.js`, et vérification que
le module documente la contrepartie. Suite : **697/697** (683 avant), build
propre.

---

### ⏳ À faire — reste du lot 8 (A8 → A10)

**A1, A2 (les 2 bloquants), A6, A3, A4, A5 et A7 sont livrés** — voir
ci-dessus : les **6 défauts 🔴/🟠** de l'audit A→Z sont corrigés, et le premier
des 4 **mineurs** aussi. Restent **A8** dates localisées à moitié, **A9** 62 clés
i18n mortes, **A10** `category`/`kind` libres à la création. Preuves et
reproductions **exécutées** (A1 sur l'API en direct, A2/A6/A9/A10 par appel direct
du code du dépôt) dans `docs/VERIFICATION-RAPPORT-AUDIT-3.md`. Les deux rapports
d'origine n'ont **pas** été modifiés.

---

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
