# Vérification indépendante du rapport d'audit « ligne par ligne » (2026-09-19)

**Date :** 19/09/2026
**Objet :** contre-vérification, item par item, du rapport d'audit fourni
(33 bugs B1→B33 + dérives doc + état git + priorités).
**Base :** `main` @ `4f7134e` (merge PR #8 — la branche auditée
`arena/01a0b133-pc-star` y a été fusionnée ; elle est aujourd'hui **2 commits
derrière**, plus 8 comme l'indiquait le rapport).
**Méthode de contre-vérification :** re-lecture ciblée de chaque ligne citée +
**mesures réelles** : `npm ci` + `npm test` complet, serveur API réel lancé en
isolation (`PCSTAR_DATA_DIR` jetable, `DATABASE_URL` **absente** — jamais la base
de prod), requêtes HTTP brutes sur socket, driver Neon piloté contre un faux
PostgreSQL local, scripts Node ad hoc (intégrité catalogue, i18n, bornes de
validation). Dépôt **non modifié** par cette analyse (tout a été nettoyé ;
`git status` propre).

---

## 0. Le projet en bref (ce que l'audit décrit correctement)

Vitrine + comptoir d'un magasin informatique d'Oran, en **zéro dépendance
applicative** (React 19 + Bootstrap, `node:http` seul côté serveur) :

| Bloc | Fichiers | Rôle |
|---|---|---|
| `src/` | 113 (dont ~55 de tests) | SPA : boutique, fiche produit, configurateur (`BuilderPage`), comptoir (`DeskPage`), panneau master, commandes, profil/OAuth. Logique pure isolée et testée (`orderLogic.js`, `shopStore.js`, `productMeta.js`, `safeStorage.js`, `deskStream.js`). |
| `server/` | 14 | API sans framework : `index.js` (1 640 lignes, **un seul `try` géant par requête**), `db.js` (adaptateur double : fichier JSON **ou** Neon), `catalog.js` (commandes/stock), `masterApi.js` (CRUD + photos), `oauth.js`, `neonStore.js` (verrou ligne `FOR UPDATE`), `rateLimit.js`, `deskSocket.js` (ws). |
| `api/index.js` | 1 | Shim Vercel serverless vers `handler`. |
| `scripts/` | 24 | Migration/import/export/restore Neon, `neon-doctor`, audits jsdom, scan anti-secret du bundle. |
| `docs/` | 27 | Journaux d'audit et plans de correction — le projet est **sur-documenté**, ce qui crée précisément la catégorie « dérives documentation ». |

Échelle mesurée : **301 produits** de base, **767 photos référencées**, **620 clés
i18n × 2 langues**, **857 tests** `node:test`, 2 workflows GitHub (Neon + UI audit).

Le rapport est **globalement fiable** : sur 33 items, 27 sont confirmés à
l'identique (dont les 5 bugs majeurs réellement graves), 4 sont vrais mais
sur-évalués ou mal racontés, 1 est inapplicable à ce dépôt, 1 scénario est faux.
Ses **numéros de ligne** dérivent de 2 à 46 lignes sur `server/index.js`
(version antérieure au merge) et sont **exacts** sur `src/` et les scripts.

---

## 1. Verdict global

| Verdict | Items |
|---|---|
| ✅ **Confirmé, preuve produite** | B1, B2, B3, B5, B6, B7, B8*, B9, B10, B11, B12, B13, B15, B16, B17, B19, B20, B21, B22, B23, B24, B25, B26, B27, B28, B29, B30, B32, B33 |
| 🟠 **Confirmé mais sévérité/scénario à revoir** | B4 (faux scénario), B14 (faux déclencheur), B18 (mitigation déjà en place), B6 (déclencheur réel ≠ « double-clic ») |
| ❌ **Inexact ou non reproductible ici** | §4 « aucun workflow CI pour build/tests » (faux : 2 workflows), §2 B8/§5 « i18n 611 × 3 langues » (faux : **620 × 2**), « 856 tests / 0 fail » (ici **857, 1 échec** hors `dist/`), B31 (sonde e2e absente du dépôt), §3 « `.env` contient une `DATABASE_URL` » (aucun `.env` dans ce clone) |
| 📝 **Non vérifié par moi** | les 5 fichiers de test (~50 % du dépôt) relus seulement par l'exécution de la suite — même limite que le rapport |

\* B8 est vrai (clé absente → texte brut affiché), mais son chiffrage i18n est faux.

---

## 2. Les six « majeurs », rejoués

### B1 — Panne Neon = process tué · ✅ **CONFIRMÉ, reproductible en direct**

`server/neonStore.js:27-31` ne contient toujours aucun gestionnaire d'erreur :

```js
function transactionPool() {
  if (!process.env.DATABASE_URL) return null
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  return pool
}
```

Preuve statique : le pool est le `pg` Pool embarqué par
`@neondatabase/serverless`, dont le `makeIdleListener` attache au client **idle**
un handler qui, sur erreur, fait `pool._remove(client); pool.emit('error', err)`
(`index.mjs`, fonction repérée par extraction du bundle). Un `EventEmitter` qui
émet `'error'` sans auditeur **jette hors de toute promesse**.

Preuve d'exécution (faux PostgreSQL local en WebSocket, handshake OK puis socket
cassée 1,2 s après ; pool construit **comme dans `neonStore.js`**, un
`connect()`/`release()` comme `updateNeonState()`) :

```
[repro] client connecté, rendu au pool (idle) — le faux PG va casser le socket
Error: Connection terminated unexpectedly
    at Sn.<anonymous> (.../node_modules/@neondatabase/serverless/index.mjs:1010:76)
EXIT_CODE=1        ← process mort
```

— trace **identique** (message **et** ligne `index.mjs:1010:76`) à celle du
rapport. Avec `pool.on('error', …)` ajouté :

```
[repro:fixed] erreur de pool ABSORBÉE par le handler : Connection terminated unexpectedly
[repro:fixed] 8 s après la coupure réseau : process ENCORE VIVANT → pas de crash
EXIT_CODE=0
```

Trois précisions : (1) l'exposition est **plus large** que le backup — `updateNeonState()`
utilise le même pool à **chaque écriture** (commande, stock, masquage), donc un client
idle survit entre deux requêtes ; (2) le `try/catch` de `scheduledBackup` (ici
`server/index.js:1581-1588`) est en effet inutile contre ça ; (3) **aucun**
`process.on('uncaughtException')` n'existe dans `server/` (grep : 0 occurrence) —
il n'y a pas de filet.
Seul détail faux : la citation « `playwright.config.js:17` documente le symptôme »
ne correspond plus à l'arbre fusionné (config réécrite en 22 lignes, commentaire
disparu). Le correctif proposé (handler + reconstruction paresseuse) est le bon.

### B2 — Les 500 fuient `err.message` · ✅ **CONFIRMÉ, aggravé par la mesure**

`server/index.js:1521` et `api/index.js:15` (aucun des deux n'a changé) :

```js
return send(res, 500, { ok: false, error: 'server', message: String(err.message || err) })
```

Reproduit live : `{"ok":false,"error":"server","message":"URI malformed"}`, **et** —
en rendant le répertoire de données non inscriptible — une fuite bien moins bénigne :

```
HTTP 500
{"ok":false,"error":"server","message":"EACCES: permission denied, open '/home/user/PC-Star/.audit-data/store.json.tmp'"}
```

Le chemin absolu du serveur est divulgué à un appelant anonyme dès qu'une écriture
échoue. À corriger comme dit (un code, jamais `err.message` ; le détail en log).
Les autres 500 de `index.js` (lignes 1183, 1224, 1308, 1378) sont déjà propres :
seuls les deux `catch` globaux parlent.

### B3 — URI mal encodée → 500 au lieu de 400 · ✅ **CONFIRMÉ**

`decodeURIComponent` présent **10 fois** (lignes 624, 667, 754, 1085, 1118, 1134,
1197, 1235, 1252, 1278 — le rapport en citait 8, son fichier était antérieur de
~46 lignes), toujours à l'intérieur du `try` global → `URIError` → 500. Mesuré :

| Requête | Réponse |
|---|---|
| `PATCH /api/orders/%E0%A4%A` (master authentifié) | **500** `{"error":"server","message":"URI malformed"}` |
| `PATCH /api/orders/PS-NOPE-0001` | 404 `{"error":"not_found"}` |

Nuance ajoutée : le 500 n'est atteignable qu'après les gardes d'autorisation
sans `decode` — une requête **anonyme** sur la même route reçoit 403, donc la
fuite de B2 passe plutôt par les routes publiques/autorisées. L'incohérence
signalée est réelle : `GET /api/stock/:id` (`:928`) et `DELETE /api/customers/:id`
(`:1460`) ne décodent pas.

### B4 — « … » infini du panneau master · 🟠 **MECANISME VRAI, SCÉNARIO FAUX**

`src/MasterPage.jsx:149` est bien `const productsLoading = apiOnline && apiProducts.length === 0`
(ligne citée **exacte**) et `:688` affiche `…` tant que c'est vrai. Mais le scénario
« le master masque tous les produits → l'API renvoie `[]` » est **impossible** :
`listMasterProducts()` (`server/masterApi.js:84-107`) renvoie **les masqués et les
ruptures avec un drapeau `hidden`**. Mesuré en base (masquage des 301 références) :

```
GET /api/master/products renverrait : 301 lignes (masquées incluse)
catalogue PUBLIC renverrait        : 0 produits
```

Le blocage réel a un autre déclencheur, plus étroit mais vrai : la ligne 142 ne
pose l'état que si `r.ok` — **403 (session expirée), 5xx ou erreur réseau laissent
`apiProducts` à `[]` → `…` permanent**, et les produits ne peuvent plus être
réaffichés depuis l'UI sans recharger. Le correctif (flag `loaded` séparé, quel
que soit le résultat) reste le bon ; la sévérité passe de majeur à **mineur**.

### B5 — Pas d'édition prix/stock/nom au panneau master · ✅ **CONFIRMÉ**

Preuves : l'appel sortant unique vers `PUT /api/master/products/:id` est
`src/MasterPage.jsx:321` → `api.masterUpdateProduct(editId, { photos: paths })` ;
`grep masterUpdateProduct src/*.jsx` = **1 seule occurrence non testée**. La ligne
produit (`:709-728`) expose **Photos**, **Masquer/Afficher** et — omission du
rapport — **🗑 supprimer** (désactivé hors extras, `disabled={p.source !== 'extra'}`).
Aucune route d'ajustement de stock n'existe côté UI (`/api/stock/` n'est que GET,
`:928`), le Desk n'a aucun champ stock, et en mode local la seule mutation d'un
produit existant est `setProductPhotos`. Conclusion du rapport tenue : corriger un
prix ou réassortir exige un `curl` → **trou fonctionnel réel, P1**.

### B6 — Transitions arrière autorisées · ✅ **CONFIRMÉ (live), mais déclencheur différent**

`src/orderLogic.js:75-76` (lignes citées exactes) :

```js
preparing: ['new', 'ready', 'picked', 'cancelled'],
ready: ['preparing', 'picked', 'cancelled'],
```

Mesuré contre le serveur (commande créée puis conduite) :

```
200 -> preparing : OK      200 -> new      : OK   ← preparing→new accepté
200 -> ready     : OK      200 -> preparing: OK   ← ready→preparing accepté
stock cpu-7800x3d : 4 (5 - 1, jamais touché par les allers-retours)
```

`picked→new` est bien refusé (400 `transition`), donc la citation du README
(`:182`, « `picked` ne revient plus en `new` ») est exacte et partielle comme dit.
Réserves : `server/catalog.js` applique la table partagée (`setOrderStatus`,
`ORDER_TRANSITIONS[from]`) — ce n'est pas un bug de divergence client/serveur mais
un **choix de la table**. Et `DeskPage` ne propose **aucun** bouton vers l'arrière
(`:259-278` : new/preparing→ready, ready→picked) — le « double-clic au comptoir »
n'est donc pas le vecteur ; le risque réel est un client API ancien/script, ou un
statut renvoyé par un appareil en décalage. À traiter (durcissement + garde
`updatedAt`), pas au titre d'un incident comptoir probable.

---

## 3. Items moyens/mineurs : contrôle point par point

| # | Verdict | Preuve / correction |
|---|---|---|
| B7 | ✅ | `server/oauth.js:352-357` (lines exactes) pose `links`, `name`, `email` — jamais `demo = false` ; seul `:348` (création) le pose. `server/db.js:528-543` aligne ensuite tout compte `demo === true` sur `DEMO_PASSWORD`, et le verrouille (`passwordHash: null`, `:539-541`) si la variable tombe. Le contraste est bien là : `server/index.js:734` et `:775` font `if (u.demo === true) u.demo = false`. |
| B8 | ✅ (chiffrage ✗) | `index.js:524` renvoie `401 demo_locked` ; la table `ERR` de `src/AuthPanel.jsx:6-16` ne l'a pas → `fail()` (`:55-57`) fait `t(code)` → **texte brut à l'écran**. Mais le dictionnaire a **2** langues (`fr`, `en`) et **620** clés chacune (mesuré), pas « 611 × 3 » : l'arabe a été retiré, les commentaires disent encore « en ar, fr et en » (`src/i18n.coverage.test.js:2`) — le rapport a recopié la doc au lieu de mesurer. |
| B9 | ✅ | `src/ProfilePage.jsx:266-281` : bloc rendu sans test de rôle (`apiOnline && mode === 'api'`), donc visible pour le master ; `link()` (`:124-127`) ne fait rien si `!r.ok` ; `unlink()` (`:129-135`) ni toast d'échec ni confirmation. Serveur : 4 refus `master_oauth_forbidden` (`oauth.js:200,289,304,548`). |
| B10 | ✅ | Mesuré : `socketsMatch(undefined,'AM5') === false` (et `('AM5',undefined) === false`). Donc `socketOk` (`BuilderPage.jsx:37`, ligne exacte) est faux pour un CPU sans socket → `addBuild` bloqué (`:120-123`, lignes exactes), alors que les listes d'options tolèrent l'absence (`:49`, `:55` : `!p.compat?.socket ||`). Le bonus est exact : `:419` fait `cpu.compat.socket` **sans `?.`**, dans un bloc rendu précisément quand `!socketOk`. « Latent » vérifié : les 301 produits ont un objet `compat`, les 13 CPU ont un `socket`. **Ajout** : `src/data.js:927` (et `:911`) a le même défault dans `checkCompatibility` (CPU sans `compat`, aucune carte mère) — non listé par le rapport. |
| B11 | ✅ | `normalizeProductCompat({socket:['AM5','LGA1700']})` → **`null`** (mesuré) → `sanitizeProductPatch`/`createProduct` refusent `compat`. Et le catalogue de base contient bien des tableaux : `PRODUCTS.find(p=>p.id==='cooler').compat` = `{"socket":["AM5","LGA1700"]}` (9 produits concernés, pas 1). Le master ne peut pas reproduire une fiche native → **vrai blocage fonctionnel**. |
| B12 | ✅ (live) | `POST /api/master/products` avec `name` de 5000 car. → **201**, 5000 car. stockés ; `brand` 400 → 400 stockés ; `short` 3000 → 3000 stockés. Le **même** `name` en `PUT` → **400 `name_too_long`** (bornes 120/60/200 de `sanitizeProductPatch:284,298,370`). Asymétrie démontrée dans les deux sens. |
| B13 | ✅ (live) | `priceOf` (`server/catalog.js:99-107`) renvoie `Math.max(0, 0)` = **0**, donc `placeOrder` n'active pas la garde `price == null` (`:193`). Commande jouée : `items:[{id:'desk-info',qty:1}]` → `200/201 ok:true`, `price: 0`, **`total: 0`**, statut `new`. Et `createProduct:159` exige `price > 0` : les deux philosophies coexistent, comme dit. |
| B14 | 🟠 | Le mécanisme est là (`PartThumb.jsx:80-82`, lignes exactes : `attempt` jamais réinitialisé), mais le déclencheur avancé est faux : **toutes** les listes clef-fient par identifiant (`key={p.id}` à `App.jsx:1717`, `BuilderPage.jsx:263`, `SearchPage.jsx:423`, `MasterPage.jsx:693`) et `ProductPage` est remonté (`key={selected.id}`, `App.jsx:1882`) → tri/filtre ne réutilise aucune instance pour un autre produit. Ce qui reste : après un échec de chargement, un produit dont le master **remplace les photos** dans le même montage garde le badge catégorie. Décoration, pas P2 ; le `key={src}` proposé est correct. |
| B15 | ✅ | `DeskPage.jsx:319` : `st !== 'cancelled' && st !== 'picked' && r.userId == null` — pas de garde `localOnly`, alors que `:213` sait l'afficher. `issueCode()` (`:62-77`) appelle l'API sans garde `apiOnline`, `mergeServerOrders` (`orderLogic.js:553`) place bien les orphelines locales en tête de liste → 404 → toast `deskClaimFail`. |
| B16 | ✅ (live) | `POST /api/master/products/id-qui-n-existe-pas/hide` → **400** `not_found` ; `PUT` sur le même id → **404** `not_found`. |
| B17 | ✅ | `App.jsx:817-831` : sans session, `commitReservations` annule la copie locale + toast `orderCancelled` ; la commande serveur reste `new`. Ajout : `mergeServerOrders` (`:545`) finit par reprendre le statut serveur → le faux succès est en plus **temporaire** (la commande réapparaît au comptoir *et* chez le client), ce qui est pire que décrit. |
| B18 | 🟠 | Le diagnostic est bon (clé réinitialisée seulement sur changement de panier, `App.jsx:320-322`) mais le rapport omet la mitigation : la branche `fail.kind === 'idempotency'` (`:1323-1327`) **vide déjà la clé** et affiche un toast d'invite. Coût réel = un clic de relance et un message alarmant, pas une impasse. |
| B19 | ✅ | `setQty` (`App.jsx:1161-1174`) : `max = stockMap[id] ?? product.stock` ; à 0, `Math.min(0, Math.max(1, 2)) = 0` → `.filter(i => i.qty > 0)` → **la ligne disparaît sur un clic de « + »**. |
| B20 | ✅ (live) | Le regex est bien le seul contrôle (`catalog.js:236` ; le `index.js:1012` cité valide en fait `wilaya`) : `day:"2026-99-99"` accepté → commande renvoyant `code:"PS-20340607-0001"` avec `day:"2026-99-99"` (roulement `new Date(2026,98,99)` de `orderLogic.js:355`, ligne exacte). Code/journée/CSV incohérents, comme annoncé. |
| B21 | ✅ | `App.jsx:2179` `go('profile')` sous le libellé `viewMyOrders` ; et `ProfilePage.jsx:6-7` dit noir sur blanc « « Mes commandes » est sorti du profil … `src/OrdersPage.jsx` ». Les 286 lignes du fichier ne listent aucune commande (grep `order` : 1 seul commentaire). |
| B22 | ✅ | `App.jsx:243-252` `window.open(href,'_blank')` sans `noopener` ; `ContactPicker.jsx:56-69` assume le compromis par commentaire (le `noopener` renvoie `null` et déclencherait la navigation même-onglet). `target=_blank` a un `noopener` implicite dans les navigateurs modernes, **pas** `window.open` : le constat technique est juste, la charge pratique faible (destinations `wa.me`/réseaux, et les `<a>` portent déjà `rel="noreferrer"`). |
| B23 | ✅ | `src/api.js:179-181` : `` req(`/api/customers/${id}`) `` sans `encodeURIComponent`, contrairement aux 4 fonctions voisines (`masterUpdateProduct`, `masterDeleteProduct`, `masterHideProduct`, `masterPhotos`, qui l'utilisent). |
| B24 | ✅ | `prevOrderCount` : déclaré `:323`, écrit `:972`, **jamais lu** (grep : 2 occurrences). |
| B25 | ✅ | `BRANDS` (`data.js:328`) n'a aucun importateur (grep : seuls `BRANDS_DZ_PRIORITY` et `DZ_BRANDS` vivent ailleurs). Mesuré : 67 marques exportées, 83 marques de catalogue, **18 hors liste** — le chiffre du rapport est exact. |
| B26 | ✅ | `App.jsx:204` `deskAudioCtx.resume()` sans `await`/`catch` dans un `try` synchrone → rejet non traité (bruit de console, pas de crash). |
| B27 | ✅ (aggravé/allégé) | `index.js:598-599` : `u.avatar = body.avatar`, `u.accent = body.accent` sans borne ni whitelist. Mesuré : `PUT /api/me {"avatar":"<img src=x onerror=alert(1)>","accent":"red;\":\""}` → **200**, valeurs relues telles quelles. Allègement : `grep -rn "avatar" src/*.jsx` = 0 rendu (champs jamais affichés) → **pas de XSS**, mais écriture non bornée (jusqu'à la limite de corps) dans `store.json`/Neon pour n'importe quel compte client. |
| B28 | ✅ | Scan de garde : `rateLimit(` n'apparaît que **9 fois** dans `index.js` (lignes 414, 438, 504, 574, 645, 665, 683, 797, 977). Sont effectivement sans limite : `GET /api/me/orders` (`:611`), `GET /api/orders` (`:961` — la limite de `:977` est celle du POST voisin), `GET /api/customers` (`:1453`), `GET /api/master/products` (`:1146`), `GET /api/stock/:id` (`:928`), l'export CSV (`:1384`), `POST /api/master/customers/:id/reset-password` (`:750`, `hashPassAsync` = scrypt à chaque appel, donc **le seul avec coût CPU**), `POST /api/oauth/unlink` (`:854`). Le rapport dit lui-même « à relativiser » : correct, sauf le reset-password, qui mérite une limite pour raison de CPU. |
| B29 | ✅ (live) | `scripts/verify-p19-live.mjs:68` envoie `slot:'14h-16h'` ; rejoué : `400 {"ok":false,"error":"slot"}` (les créneaux sont `10:30 11:30 12:30 14:00 15:00 16:00 17:00 18:00`, `data.js:69-78`). L'étape « POST /api/orders → 201 » échoue, tout ce qui suit cascade (dont `stock réservé` et la poussée `order:new`). |
| B30 | ✅ | `scripts/neon-doctor.mjs:155` : `process.exit(0)` inconditionnel, atteignable après le `bad('0 produit public …')` de la ligne 140. Les seules sorties 1 sont les états *structurels* (`:106`, `:117`). Un `make ci` / script wrapper ne voit donc pas une vitrine vide. |
| B31 | ❌ **non applicable** | `git ls-files e2e` → **`e2e/smoke.spec.js` uniquement** ; aucun `zz-debug-session.spec.js`, tracké ou sur disque. C'était un résidu du poste de l'auditeur (il le dit « untracké ») : à signaler en hygiène d'exécution, pas comme défaut du dépôt. |
| B32 | ✅ | Bouton du formulaire panneau = `t('masterAddProduct')` (`MasterPage.jsx:836`) ; `extraPanels` rendus `:859-868` sans ON/OFF ni suppression, à la différence des panneaux de base (`doTogglePanel`, `:851`, fonction définie `:420`). |
| B33 | ✅ | `doDeleteCustomer` (`:391-408`) appelle `api.deleteCustomer(id)` sans `window.confirm`, alors que la suppression produit en fait un (`:369`) et que le Desk en fait un (`DeskPage.jsx:107`). L'effet est bien irréversible et annule les commandes en cours (`purgeUser`, documenté `:397-401`). |

---

## 4. Ce que le rapport a faux ou manqué

1. **La CI n'est pas absente** (§4). Il y a **deux** workflows sur `pull_request` :
   `ui-audit.yml` qui lance `npm ci` → **`npm run build`** (donc `vite build` +
   `scripts/check-bundle.mjs`, le scan anti-secret du bundle) → `build:crawl` →
   crawl jsdom de 26 pages « 0 erreur JavaScript » → audit de tous les boutons ;
   et `neon_workflow.yml`, qui **exécute la suite complète** (`npm test`, ligne 99)
   sur une branche Neon isolée, après `db:migrate:neon:reset`, et qui joue déjà
   `test:neon:concurrency` et `test:neon:backup`. Affirmation à corriger : *build
   et tests sont gardés en CI*. Le vrai trou, c'est **Playwright** :
   `npm run test:e2e` n'est appelé par aucun workflow (grep dans `.github/`).
2. **`npm test` échoue sur un clone frais** (non mentionné) : `bundleSecrets.test.js:209-219`
   fait `assert.fail('dist/ absent : lancez npm run build avant la suite (hors CI)')`
   quand `dist/` manque. Mesure : **857 tests → 856 pass / 1 fail** (durée 125 s) ;
   après `npm run build`, `node --test src/bundleSecrets.test.js` → **16/16**, donc
   suite **857/857**. Le « 856 tests, 856 pass, 0 fail » du rapport n'est vrai que
   sur un arbre construit, et son total est décalé d'un test par rapport à `main`.
   Conséquence pratique : le README (`:11`, « 807 tests ») est triple-faux — nombre
   et pré-condition non documentée.
3. **i18n : 2 langues, pas 3.** `LANGS`/`dict` = `fr`, `en`, **620** clés chacun,
   symétrie parfaite et 0 clé appelée manquante (le test de couverture passe).
   Sont restés « arabo-centrés » : l'en-tête de `i18n.coverage.test.js:2`, l'usage
   affiché `scripts/audit-crawl.mjs:6` (`[ar|fr|en]`), et le README `:109`
   (« retirées des trois langues (502 → 491) »). Le rapport a repris ces chiffres
   au lieu de les mesurer — alors même qu'il se dit « vérifié par exécution » ;
   c'est le seul endroit où sa méthode annoncée est prise en défaut.
4. **Aucun `.env` dans ce dépôt** : seul `.env.example` existe (et `.gitignore:108`
   couvre bien `**/.env`). La phrase « `.env` contient une `DATABASE_URL` Neon
   réelle » relève du poste de l'auditeur, pas de `main` ; à garder comme
   recommandation d'hygiène, pas comme constat sur le repo.
5. **Sous-évalués** : B13 et B20 touchent l'argent et l'intégrité des données de
   commande et sont **démontrés en direct** (total 0 DA accepté ; code daté 2034
   pour une journée 2026) — ils méritent P1, pas P2. B12 aussi, dont
   l'asymétrie 201/400 est prouvée en une requête.
6. **Sur-évalués** : B4 (scénario impossible), B14 (déclencheur impossible),
   B18 (déjà atténué), B6 (vecteur réel plus restreint que décrit), B1 sur Vercel
   (le rapport le dit lui-même). B2/B3 sont de vrais « quick wins » (≈ 10 lignes)
   plutôt que des P0 de disponibilité.
7. **Ajouts de cet examen** (non listés) : `src/data.js:911` et `:927`
   déréférencent `cpu.compat.socket`/`board.compat.socket` sans `?.` dans
   `checkCompatibility` — le `rams`/`psus`/`coolers` sont filtrés avec garde
   `i.compat &&`, pas les CPU/cartes mères (latent, cf. B10) ; et le reset
   `POST /api/master/customers/:id/reset-password` combine **scrypt non limité +
   absence de rate-limit** (seul item de B28 à coût CPU réel).

---

## 5. Le « vérifié sain » du rapport : contrôlé au hasard, tient

| Affirmation | Contrôle |
|---|---|
| traversée de chemin des uploads corrigée (double barrière) | `grep` : `safeUploadName` = `basename` + filtre `[^A-Za-z0-9._-]` + refus si le nom diffère de l'entrée (`blobStore.js:99-105`, `index.js:867-870`). **Rejoué** : `?name=../../package.json`, `..%2f..%2f`, `%2e%2e%2f…/etc/passwd` → **400** ; `/uploads/../../package.json` → **404** |
| CSV anti-injection + BOM | `ordersToCsv` passe chaque cellule par `csvEscape` (`masterApi.js:579-603`, commentaire LOT 1.8), `'\uFEFF' + csv` à `index.js:1404` |
| pas de contournement d'auth | scan de toutes les routes `/api/master`, `/api/customers`, `/api/db` : **0** sans `userFromReq`/garde `role !== 'master'` dans les 14 lignes ; 20 gardes de rôle pour 5 préfixes `/api/master*` |
| sessions en empreinte + TTL | `hashToken` = sha256 (`db.js:1171-1173`), lookup par empreinte (`:1187`, `:1209`) ; purge dans `normalizeDb` |
| `DATABASE_URL`/pilote Neon | `neonStore.updateNeonState` sous `FOR UPDATE` + `BEGIN/COMMIT/ROLLBACK`, `readNeonState` en lecture, repli `store.json` si URL absente |
| gardes destructrices des scripts | `neon-migrate --reset` exige `--confirm-reset` (`package.json`), import/export/restore séparés, `neon-doctor` en lecture seule |
| intégrité du catalogue | rejouée : 301 produits, 0 doublon d'id, 0 doublon de SKU, **0/767 photo runtime manquante** (`public/`), presets/`related` valides (tests `dbIntegrity`, `catalogExpansion`, `phase4MediaIntegrity` passent) |

---

## 6. Priorités que je recommande (après corrections)

| P | Item | Pourquoi ce rang |
|---|---|---|
| **P0** | B1 `pool.on('error')` + reconstruction paresseuse ; journaliser et marquer la base « dégradée » | Seul défaut capable de **tuer** le serveur ; 5 lignes ; prouvé reproductible |
| **P1** | B13 exclure `price <= 0` du panier ou tarifer `desk-info` ; B20 valider `day` (date réelle, pas seulement regex) ; B2 retirer `message` des 500 ; B3 `400 invalid_code` sur `URIError` | Argent + intégrité des commandes, et fuite de chemin disque ; tous démontrés en direct |
| **P1** | B5 édition prix/stock/nom au panneau master ; B11 sockets multiples acceptés par `normalizeProductCompat` | Deux trous fonctionnels qui obligent à opérer en `curl` |
| **P2** | B6 table de transitions sans retours en arrière (+ `if (updatedAt < X) refus`) ; B7 `demo = false` dans `finishIdentity` ; B12 bornes de création alignées sur le patch ; B10 `socketOk` tolérant + `?.` aux lignes 419/`data.js:911,927` ; B28 rate-limit sur reset-password | Réel, impact contenu |
| **P3** | B4 flag `loaded`, B8 `ERR.demo_locked` + clé i18n, B9 toasts d'échec + masquage master, B15 garde `localOnly`, B16 404, B17 message honnête, B19 plancher à 1, B21 `go('orders')`, B23/B24/B25/B26/B27 (bornes `avatar`/`accent`), B30 `exit(1)`, B32/B33 | Qualité, cohérence, hygiène |
| **P3 doc/CI** | chiffres README (301 produits, 857 tests, pré-condition `npm run build`), commentaires encore « arabe » (`i18n.coverage.test.js:2`, `audit-crawl.mjs:6`, README:109), `.env.example:94-96` (le pilote Neon est complet), `--experimental-loader` → `--import` ; **ajouter `npm run test:e2e` à un workflow** | La CI couvre déjà build+tests+crawl : le manque est l'e2e, pas la CI |

**Verdict sur le rapport :** utile et de bonne tenue — le seul « crash prouvé »
l'est vraiment (trace identique rejouée), 27 items sur 33 tiennent le détail
ligne à ligne, et l'honnêteté sur les limites (« latent », « à relativiser »,
« fichiers de tests non relus ») est justifiée. À reprendre sur quatre points :
le scénario de B4, le « aucun workflow CI » (§4), les chiffres i18n « 611 × 3 »,
et un total d'exécution de tests à recalibrer (857, et 1 échec tant que `dist/`
n'est pas construit).

---

## 7. Application (le plan a été mené, P0 → P3)

Le tableau §6 n'est pas resté une recommandation. Journal détaillé, point par
point et grappe par grappe : **`docs/BUGS-AND-FIXES.md`**, rubriques « LOT P0 »,
« LOT P1 », « LOT P2 », « LOT P3 ».

| Grappe | Commit | Contenu |
|---|---|---|
| P0 | `2c6ea4a` | B1 — pool Neon : `pool.on('error')`, reconstruction paresseuse, base marquée « dégradée » |
| P0 | `2e9cdda` | B2 (chemains dans les 500), B3 (`400 invalid_code` sur `URIError`) |
| P1 | `a51dffd` | B13 (`desk-info` non tarifiable), B20 (`normalizeDay`, date réelle) |
| P1 | `24b6d26` | B11 (édition prix/stock/nom au panneau master), B5 (sockets multiples acceptés) |
| P1 | `042acc7`, `d872c2a` | Docs P23, `compatLabel` |
| P2 | `58bbfe2` → `0c5231a` | garde-fou de câblage, B28, B7, B12, B10, B6 (table de transitions), docs P24 |
| P3 | `e0175da` | B8, B9, B21, B17 — ce que l'écran doit dire |
| P3 | `80c3d28` | B14, B19, B22, B24, B25, B26 — surface de la vitrine |
| P3 | `ac94502` | B32, B33 — panneaux ajoutés, suppression de compte |
| P3 | (G4) | B4, B15, B16, B23, B27, B30 + docs périmées |

**Trois conclusions de ce suivi modifient le rapport, pas le code :**

1. **B32 reposait sur un mécanisme inventé** (un `setEditing` écrit jamais lu, qui
   n'existe ni à la base auditée ni depuis). Le défaut réel est ailleurs, et il
   est plus gênant : le masquage des panneaux ajoutés n'était appliqué **ni au
   panneau ni à ses lignes** dans `buildShopView`, et le maître n'avait aucun
   bouton pour le faire. Corrigé sous la même référence.
2. **B18 ne reçoit pas de correctif, à dessein** : le compte de démonstration est
   déjà verrouillé en l'absence de `DEMO_PASSWORD` (`passwordHash: null`,
   `demo_locked`) — c'est justement ce code que B8 rend lisible à l'écran. Le
   durcir encore aurait fait bouger un contrat de sécurité sans gain mesurable.
3. **B4 et B14 avaient le bon symptôme, mauvais déclencheur** (le rechargement
   pendant le chargement, le webp manquant). Les deux ont été corrigés sur leur
   mécanisme, pas sur le scénario décrit : le premier a désormais un drapeau de
   fin de chargement et un « Réessayer », la seconde repart de zéro quand la
   fiche change.

Portes à la fin du lot : **995 tests, 0 échec** (36 verrous de plus, dont quatre
fichiers nouveaux), parité i18n fr/en vérifiée sans clé morte (646 × 2), crawl
**24 pages / 0 erreur**, audit des boutons sans erreur JS sur base non vide.

Le dernier point ouvert de ma propre liste — `npm run test:e2e` absent de la CI —
est refermé par `.github/workflows/e2e-smoke.yml` (Chromium, identifiants de
fixture dont `DEMO_PASSWORD`, artéfact en cas d'échec). Ce que le bac à sable de
correction n'a pas pu prouver : le navigateur n'y télécharge pas, donc le job
n'a pas été JOUÉ ici — le YAML est parse et tous les chemins qu'il invoque
existent. Le reste des commentaires d'état périmés (quatorze titres de tests qui
disaient « 3 langues » là où les assertions portaient déjà sur `LANGS`) est
repris dans le même mouvement.
