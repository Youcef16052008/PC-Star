# Vérification du rapport d'audit « 2 passes » — 15/09/2026

**Objet :** vérification item par item du rapport d'audit en deux passes
(52 affirmations numérotées #1–#52 + 21 findings lettrés retenus A–Z).
**Base :** `fdbd778` (branche `arena/01a0a55c-pc-star`), dépôt non modifié.
**Méthode :** lecture ligne à ligne du code cité **+ reproduction en exécution**
chaque fois que c'était possible (suite de tests, build de production, instance
API réelle interrogée en curl, sondes Node ciblées, lecture de la base produite).

Aucun fichier applicatif n'a été modifié pendant cette vérification. Les données
de test ont été écrites dans `/tmp/pcstar-data` (`PCSTAR_DATA_DIR`), jamais dans
le dépôt.

---

## 0. Environnement de vérification

| Vérification | Résultat |
|---|---|
| `npm test` | **315 pass / 0 fail** (97 suites, 123 tests, ~22 s) |
| `npm run build` | OK — `dist/assets/index-*.js` 432,79 kB (130,11 kB gzip) |
| Instance API réelle | `node server/index.js` sur `0.0.0.0:8787`, data isolée dans `/tmp/pcstar-data` |
| Sondes Node | `scryptSync`, `loadLang`/`loadUsers`/`loadMeta` avec storage levant, clés i18n `cat_*` |

**Fait structurant :** les 315 tests passent alors que 60 affirmations sont
confirmées, dont 16 reproduites en exécution. Aucun de ces chemins n'est donc
couvert par la suite existante.

---

## 1. Verdict global

Sur **73 affirmations** (52 numérotées + 21 lettrées retenues par le rapport
lui-même) :

| Verdict | Nombre | Dont reproduites en exécution |
|---|---|---|
| ✅ Vraie | **60** | 16 |
| 🟡 Partielle / à requalifier | **8** | 2 |
| ❌ Fausse | **5** | 2 |
| ⚪ Non concluante | **0** | — |

Le rapport est **globalement fiable et d'une précision remarquable** : les
références `file:line` sont exactes dans la quasi-totalité des cas, et les
items que l'auteur a lui-même retirés en cours de route (D, H, P, Q, R, V, X)
l'ont été à bon escient.

Les 26 items lettrés A–Z comprennent 5 retraits explicites de l'auteur
(D → D' → D'', H → H', P → P', Q → Q', R → R' → R'') et V et X retirés.
Le décompte retenu ici est celui des **21 findings lettrés effectivement
affirmés** (A, B, C, D'', E, F, G, H', I, J, K, L, M, N, O, R'', S, T, U, W, Y, Z
moins les doublons de reformulation), cohérent avec les 73 annoncés.

---

## 2. Les 5 affirmations FAUSSES

### ❌ #11 — « le repli local du master s'applique sans validation de transition »

**Faux, et le rapport se contredit dans sa propre parenthèse.**

`src/App.jsx:501-505` :

```js
const err = r.data?.error
if (!r.offline && err !== 'not_found' && err !== 'forbidden') {
  setToast(t('deskStatusFail'))
  return false          // ← retour AVANT le repli local
}
```

Une erreur `transition` (400) entre dans cette branche : `return false` est
exécuté **avant** le repli local de la ligne 510. Le repli n'est atteint que
pour `offline`, `not_found` et `forbidden`. La parenthèse du rapport
(« l.502 : seuls `not_found`/`forbidden`/offline court-circuitent le repli »)
décrit exactement l'inverse de sa propre conclusion.

### ❌ #16 — « le toast compte à partir d'un état périmé »

**Le diagnostic est bon, la conséquence est nulle : le champ est mort.**

`src/App.jsx:723` écrit bien `count: (cart.find(...)?.qty || 0) + 1` depuis le
`cart` du rendu courant — valeur effectivement périmée. Mais **ce champ n'est
jamais lu** : le rendu (`src/App.jsx:1767`) affiche
`t('itemsInCart', { n: count })` où `count` est le total recalculé du panier
(`src/App.jsx:684`). Aucun compteur faux ne peut s'afficher. À reclasser en
code mort (famille de #37).

### ❌ #22 — « mapping 05/06/07 : inversion à vérifier »

**Le mapping est correct ; seule la duplication est un vrai point.**

`05 → ooredoo`, `06 → mobilis`, `07 → djezzy` (`src/shopStore.js:161-168` et
`server/index.js:194-201`) correspond à l'attribution officielle des préfixes
mobiles algériens. Le sous-point « dupliqué 2×, divergent un jour » est en
revanche **vrai et vérifié** : les deux fonctions sont strictement identiques,
l'une côté client, l'autre côté serveur.

### ❌ #50 — « `order.total.toLocaleString` throwerait si `total` est une string »

**Faux : la garde existe, à la ligne même citée.**

`src/notify.js:92` :

```js
const total = typeof order.total === 'number' ? `${order.total.toLocaleString('fr-DZ')} DA` : ''
```

Le `typeof` précède l'appel. Aucune exception n'est possible, et le raisonnement
« pas de try/catch → promesse rejetée non gérée » ne s'applique pas.

### ❌ O — « un compte peut commander au téléphone d'un tiers, et cette commande devient visible/annulable par le vrai détenteur du numéro »

**Faux tel qu'énoncé — reproduit en exécution.**

| Test | Résultat |
|---|---|
| Compte A (0550111111) poste une commande au téléphone de B (0550222222), **avec Bearer** | HTTP 201, `userId` = id de A |
| B lit `GET /api/me/orders` | `[]` — **B ne voit rien** |

`server/index.js:374-376` ne rattache par téléphone **que** les commandes dont
`userId == null`. Une commande passée avec un token est attachée à son auteur et
n'est donc pas visible par le détenteur du numéro.

**Variante vraie, plus étroite :** une commande **guest** (sans token) portant le
numéro d'un tiers *est* visible et annulable par ce tiers. Reproduit :

```
POST /api/orders  (sans Authorization)  phone=0550222222, name="Attaquant Anonyme"
→ 201, code PS-20260915-0008, userId: null
GET /api/me/orders (compte B, 0550222222)
→ [('PS-20260915-0008', 'Attaquant Anonyme', None)]
```

L'impact réel est donc : pollution de la liste « Mes commandes » d'un tiers et
annulation possible d'une commande qu'il n'a pas passée — pas une prise de
contrôle de compte.

---

## 3. Les 8 affirmations PARTIELLES (à requalifier)

| # | Ce qui est vrai | Ce qui doit être corrigé |
|---|---|---|
| **#14** | `updateDb` (`server/db.js:330-335`) fait read-modify-write **sans verrou** ; le driver Neon, lui, est protégé. | Sous Vercel, chaque instance a **son propre `/tmp`** : deux invocations concourantes ne partagent pas le même `store.json`. Le symptôme n'est pas la survente par écrasement mais la **divergence/perte** entre instances. La survente par course ne s'applique qu'à deux process partageant le même disque (multi-process local). |
| **#37** | `loadTheme`/`resolveTheme`/`saveTheme`/`applyDocumentChrome` sont bien du code mort : **aucun import hors `prefs.js`** (seul `loadOrders` est importé, par `OrdersPage.jsx:5`). | « mais toujours exporté/**testé** » est inexact : `grep` sur `src/*.test.js` ne renvoie **aucune** occurrence de ces symboles. Ils ne sont pas testés. |
| **#48** | `send()` pose bien `Access-Control-Allow-Headers` et `Access-Control-Allow-Methods` **inconditionnellement**, alors que `corsHeaders()` (`server/index.js:69-71`) est conditionnel à `FRONT_ORIGIN`. Incohérence réelle. | « `undefined` dans les headers » : la route CSV (`server/index.js:891`) écrit `'Access-Control-Allow-Origin': FRONT_ORIGIN` en dur, mais `FRONT_ORIGIN` vaut `''` (chaîne vide, `server/index.js:62-67`), **jamais `undefined`** — et Node **omet** un en-tête de valeur vide. Vérifié avec `FRONT_ORIGIN=` non défini : aucun `Access-Control-Allow-Origin` sur la réponse. |
| **I** | `src/App.jsx:425-448` : `api.setToken(tok)` est exécuté **avant** `api.me()` ; si `me()` échoue, aucun `setApiUser`, aucun retry, aucun message, et l'URL est nettoyée. | « la session OAuth est **perdue** » est excessif : le token **reste stocké** (contrairement à l'effet de démarrage, `src/App.jsx:413-421`, qui fait `api.setToken(null)` en cas d'échec). Un rechargement de la page applique donc la session. À requalifier en « session non appliquée sans rechargement, aucun retour utilisateur ». |
| **J** | Aucune UI « session expirée » ; le TTL serveur est de 7 jours. | « **toutes** les requêtes envoient un Bearer mort » est inexact : l'effet de démarrage (`src/App.jsx:413-421`) appelle `api.me()` et fait `api.setToken(null)` sur échec. Le token mort est purgé au prochain chargement. Reste vrai : pendant la session en cours, aucun message n'explique la déconnexion. |
| **K** | `server/masterApi.js:217` : `${safeId}-${Date.now().toString(36)}-${i}.${ext}` → collision de nom possible à la milliseconde ; `@vercel/blob` n'ajoute **pas** de suffixe aléatoire par défaut (`addRandomSuffix` défaut `false`, vérifié dans `node_modules/@vercel/blob/dist/index.d.ts:459`). | « la seconde **écrase** la première → photo remplacée **sans erreur** » n'est vrai que pour le repli **filesystem** (`fs.writeFileSync` écrase). Pour **Blob**, `allowOverwrite` vaut `false` par défaut : « *By default an error will be thrown if you try to overwrite a blob* » (`index.d.ts:460`). Le `put` **échoue**, l'exception remonte, et la compensation `unlinkUpload` (`masterApi.js:222-227`) annule les photos déjà envoyées → la sauvegarde échoue **bruyamment**. |
| **W** | Remarque de robustesse légitime. | Imprécision technique : `server/db.js:22` utilise `MASTER` comme **objet littéral** évalué au chargement du module, et `hashPassLegacy` est une **déclaration de fonction** → hoistée **avec sa valeur**, pas seulement « hoisting de déclaration ». Le code est correct aujourd'hui ; le risque en cas de conversion en `const`/fat-arrow est réel. |
| **Y** | `src/App.jsx:1109` appelle `t(\`cat_${c.id}\`)` **sans** le motif de repli utilisé par `BuilderPage.jsx:37,201,319` et `SearchPage.jsx:63,189` (`t(k) !== k ? t(k) : label`). Incohérence de style réelle. | Aucune clé n'est actuellement manquante : vérifié par exécution sur les 13 `CATEGORIES` × 3 langues → **0 clé `cat_*` manquante**. Le libellé brut `cat_xxx` ne peut apparaître que si une catégorie est ajoutée sans i18n. |

---

## 4. Reproductions en exécution (16 items)

Ces affirmations ne sont pas seulement lues dans le code : elles ont été
**rejouées** contre une instance réelle du serveur.

### 🔴 #3 — Identifiants master dans le bundle public, et ils fonctionnent

`npm run build` puis `grep` sur le bundle produit :

```
dist/assets/index-D_CiU6m5.js:  pcstar.info31@gmail.com"
dist/assets/index-D_CiU6m5.js:  password:"star31"
```

Source : `src/shopStore.js:1-5` — `MASTER = { email, password: 'star31', … }`,
**en clair, côté client**. Les comptes démo suivent (`shopStore.js:96,108,120` :
`passwordPlain: 'karim31' / 'amina31' / 'yacine31'`), et `server/db.js:18-29`
seed le master avec `hashPassLegacy('star31')` (sha256 non salé).

Et ces identifiants **ouvrent une session master réelle** :

```
POST /api/auth/login {"email":"pcstar.info31@gmail.com","password":"star31"}
→ HTTP 200 · role: master · token émis
```

Accès complet confirmé : commandes, clients, produits, export CSV, suppression.
À noter : ces identifiants sont **aussi publiés dans la documentation**
(`README.md:19`, `docs/GUIDE-DEMO*.md`, `docs/DEPLOY-VERCEL.md:127`).

### 🔴 #2 — Changement de mot de passe : fonctionnalité morte

```
POST /api/me/password {"password":"nouveau123"}
→ HTTP 403 {"ok":false,"error":"current_password"}
POST /api/me/password {"password":"nouveau123","current":"star31"}
→ HTTP 200 {"ok":true}
```

Le serveur exige `body.current` (`server/index.js:417-419`, fix P16 #13). Or
`src/api.js:213-215` n'envoie que `{ password }`, et `src/ProfilePage.jsx:165,168`
ne propose que deux champs (`pw`, `pw2`) — **aucun champ « mot de passe
actuel »**. Tout utilisateur reçoit donc 403 à chaque tentative. Les comptes
OAuth (`passwordHash: ''`) ne peuvent de toute façon pas passer `verifyPass`.

Précision : la route est `POST /api/me/password` — un `PUT` ou un `PATCH`
renvoie 404.

### 🔴 #7 — Collision de codes de commande après suppression

`server/catalog.js:179-181` : `seq = sameDay.length + 1` (**comptage**, pas max).

```
Commandes créées          : PS-20260915-0001, -0002, -0003
DELETE /api/orders/PS-20260915-0002  → 200 {"ok":true,"restocked":true}
Nouvelle commande         : PS-20260915-0003   ← code déjà utilisé
Base après                : ['PS-20260915-0003', 'PS-20260915-0003', 'PS-20260915-0001']
DOUBLON                   : True
```

Deux commandes distinctes partagent la même clé. `deleteOrder`
(`server/catalog.js:218-234`) retire l'entrée de `db.orders`, donc le compteur
redescend. Ironie confirmée : le client a corrigé exactement ce bug en local —
`nextLocalOrderCode` (`src/orderLogic.js`) est basé sur le **max** — mais la
logique serveur n'a pas été alignée.

### 🔴 #6 — Injection HTML sur la page de consentement OAuth

```
GET /api/oauth/google/demo?state="><img src=x onerror=alert(1)>
```

Réponse servie (ligne 17) :

```html
<input type="hidden" name="state" value=""><img src=x onerror=alert(1)>"/>
```

Le `state` brut sort du query param (`server/index.js:468`) et est interpolé
sans échappement dans `demoConsentHtml` (`server/oauth.js:281`). La nuance du
rapport est **exacte** : la CSP du serveur (`server/index.js:91-93`,
`script-src 'self'`) bloque l'exécution du handler inline — vérifiée présente
sur la réponse — mais le balisage est injecté (hameçonnage, détournement du
`form action` possible). Aucun échappement HTML nulle part dans ce template.

### 🔴 #12 — `/api/auth/register` sans rate-limit (+ amplification CPU non signalée par le rapport)

```
25 inscriptions consécutives : 25 × HTTP 201, 0 erreur, 985 ms
```

`server/index.js:240-281` n'appelle **jamais** `rateLimit`, alors que
`/api/auth/login` est limité à 20/min (`:284`) et `/api/orders` à 15/min
(`:604`). Énumération d'e-mails (409 `exists`) et remplissage de base illimités.

**Point que le rapport n'a pas vu :** chaque inscription appelle `hashPass` →
`crypto.scryptSync` **synchrone** (`server/db.js:31-35`) dans le thread
principal. Mesuré :

```
1 hash  = 43,0 ms      (30,8–43,0 ms/hash sur 25 itérations)
25 hash = 769,6 ms     de blocage du thread principal
```

Combiné à l'absence de rate-limit **et** d'authentification, c'est un vecteur
de déni de service à coût nul : ~30 ms de blocage par requête, sans limite.
Les 985 ms mesurés pour 25 inscriptions sont cohérents (≈ 770 ms de scrypt +
I/O).

### 🔴 #23 — `wilaya`, `slot`, `name` non validés (reproduit avec stockage réel)

```
POST /api/orders
  name   = 600 × "A"
  wilaya = "<script>alert(1)</script>"
  slot   = "PAS_UN_SLOT"
→ HTTP 201, et en base :
  wilaya stockée : '<script>alert(1)</script>'
  slot stocké    : 'PAS_UN_SLOT'
  longueur name  : 600
```

`server/catalog.js:120,123` : `wilaya: body.wilaya || 'Oran'` et
`slot: body.slot || ''` — aucune whitelist, contrairement à `PUT /api/me` qui
valide contre `WILAYAS_NEAR`. Ces valeurs ressortent dans le CSV master et dans
les notifications WhatsApp. Combiné à **L**, c'est le chemin d'entrée de
l'injection CSV.

### 🔴 L — Injection de formule CSV (reproduit)

```
POST /api/orders name='=HYPERLINK("http://evil.dz";"cliquez")'  → 201
POST /api/orders name='+cmd|/C calc'                             → 201

GET /api/orders/export.csv (master) :
PS-20260915-0006,new,…,+cmd|/C calc,0550000000,…
PS-20260915-0005,new,…,"=HYPERLINK(""http://evil.dz"";""cliquez"")",…
```

`csvEscape` (`server/masterApi.js:236-242`) quote les cellules contenant
`" , \n \r` — ce qui **préserve le `=` initial** : Excel interprète la cellule
comme une formule. Le `+cmd|…` n'est même pas quoté. Tous les champs sont
contrôlés par le client (voir #23). Aucune neutralisation `=/+/-/@`.

### 🟠 #24 — Les sessions survivent au changement de mot de passe (reproduit)

```
POST /api/auth/register  victime@test.dz / abcdef     → 201, token T1
GET  /api/me             (Bearer T1)                  → 200
POST /api/me/password    {password:xyz789,current:abcdef} → 200
GET  /api/me             (Bearer T1 — ANCIEN mot de passe) → 200   ← toujours valide
```

`server/index.js:419-424` ne modifie que `passwordHash` ; aucune purge de
`db.sessions`. Idem pour le reset master (`:441-448`). Un token volé reste
utilisable après que la victime a changé son mot de passe — ce qui annule
l'intérêt du changement de mot de passe comme réaction à une compromission.
Contraste : `purgeUser` (`server/catalog.js:264-275`), lui, **purge bien** les
sessions.

### 🟠 #8 — `localStorage` bloqué → exception non gérée (reproduit par sonde)

Sonde Node avec un storage dont `getItem`/`setItem` lèvent une `SecurityError`
(comportement réel d'un iframe tiers à stockage bloqué) :

```
loadLang        : LÈVE SecurityError → Access is denied for this document.
loadUsers       : LÈVE SecurityError
loadMeta        : LÈVE SecurityError
wrapper App.jsx : LÈVE SecurityError
```

Le chaînage optionnel ne protège pas contre un `throw` **de la méthode**.
`loadLang(storage)` est appelé dans l'initializer de `useState`
(`src/App.jsx:190`) → l'app entière tombe dans l'ErrorBoundary.

**Au-delà du rapport :** le wrapper `storage` de `src/App.jsx:76-87` — ajouté
précisément pour les iframes à stockage bloqué, d'après son commentaire —
**n'a pas de try/catch non plus** et lève. Seuls `loadCartFor`
(`src/App.jsx:92-101`) et `setCart` (`src/App.jsx:257-262`) sont protégés. Les
modules qui utilisent `localStorage` brut en paramètre par défaut
(`src/prefs.js:5,16,35`, `src/api.js:12,16`) sont exposés aussi.

### 🟠 #27 — `/api/health` divulgue la configuration (reproduit)

```json
{ "oauth": { "demo": true, "googleConfigured": false, "metaConfigured": false,
             "redirectBase": "http://127.0.0.1:8787" },
  "master": "pcstar.info31@gmail.com",
  "cors": "http://127.0.0.1:5173",
  "payments": ["cash"],
  "db": { "driver": "file", "configured": false, "pooler": null } }
```

Public, sans authentification (`server/index.js:211-231`). L'e-mail master est
livré — ce qui, combiné à #3, donne l'identifiant **et** le mot de passe sans
même ouvrir le bundle.

### 🟠 #26 — `/api/oauth/start` public et spammable (reproduit)

```
12 × POST /api/oauth/start (sans authentification) → 12 × HTTP 200
oauthPending en base : 12 entrées
```

Purgées après 15 min (`server/db.js`), mais le remplissage est illimité.

Sur `intent: 'link'` sans token, **nuance** : l'entrée est stockée avec
`intent: 'link'` et `userId: null` (vérifié en base) — le paramètre n'est donc
pas « converti en login » à l'écriture comme l'affirme le rapport
(`server/index.js:457-458` ne convertit que `userId`). L'**effet** est bien
celui décrit : `finishIdentity` (`server/oauth.js:149`) exige
`pending.intent === 'link' && pending.userId`, donc sans token le flux retombe
dans la branche login. Aucune erreur n'est remontée au client.

### 🟠 D'' — Override `price: 0` accepté (reproduit)

```
PUT /api/master/products/cpu-7600  {"price":0}
→ HTTP 200, product.price: 0
```

`sanitizeProductPatch` (`server/masterApi.js:107-111`) refuse
`!Number.isFinite(price) || price < 0` — **0 passe**. Alors que `createProduct`
(`:47-48`) exige `price > 0`. `priceOf` (`server/catalog.js:57-64`) renvoie
`Math.max(0, …)` → une commande à 0 DA est calculée et acceptée, et `money(0)`
(`src/data.js:61-67`) affiche « 0 DA » (pas le tiret de secours, réservé aux
valeurs non finies). Asymétrie de validation réelle entre création et édition.

### 🟡 #48 — En-têtes CORS (reproduit, conclusion corrigée)

Avec `FRONT_ORIGIN` non défini :

```
GET /api/health → HTTP 200
  Access-Control-Allow-Headers: Content-Type, Authorization
  Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
  (aucun Access-Control-Allow-Origin)
```

La seconde moitié de l'affirmation est **vraie** : `send()` pose ces deux
en-têtes inconditionnellement alors que `corsHeaders()` est conditionnel.
La première moitié est **fausse** : pas d'`undefined` — `FRONT_ORIGIN` vaut `''`
et Node omet l'en-tête vide.

### 🟡 O — Usurpation de téléphone (reproduit, voir §2)

Deux tests contradictoires avec l'affirmation : commande authentifiée au
téléphone d'un tiers → **invisible** pour ce tiers ; commande **guest** au
téléphone d'un tiers → **visible et annulable** par ce tiers.

### 🟡 #5 — CSP bloque les photos Vercel Blob (confirmé par lecture du chemin complet)

Non reproductible en local (pas de `BLOB_READ_WRITE_TOKEN`), mais le chemin est
vérifié de bout en bout :

1. `savePhotoDataUrls` (`server/masterApi.js:217-220`) → `uploadBlob` renvoie
   `{ url }` = **URL Blob CDN** (`server/blobStore.js:80-85`, `*.vercel-storage.com`) ;
2. `server/index.js:759` : `body.photos = [...(body.photos || []), ...newPaths]` —
   les URLs CDN sont stockées **telles quelles** dans `product.photos`
   (aucune réécriture en `/api/upload-file?name=`) ;
3. `sanitizeProductPatch` (`server/masterApi.js:118-124`) accepte
   `/^https?:\/\//` → l'URL CDN passe ;
4. le client rend `<img src={photo}>` sur cette URL ;
5. `vercel.json:53` : `img-src 'self' data: blob:` — **`*.vercel-storage.com`
   n'y est pas**.

Bloqué en production. Le 302 de `/api/upload-file` (`server/index.js:530-534`)
ne sauve pas le cas : il n'est emprunté que si le FS rate, et les CSP ne
s'appliquent pas aux redirections — mais ici l'URL CDN est **directe** dans le
`src`, donc le redirect n'est jamais traversé.

---

## 5. Confirmations par lecture de code (44 items)

Références vérifiées, exactes :

| # | Référence vérifiée | Constat |
|---|---|---|
| 1 | `App.jsx:742,758,768` + `BuilderPage.jsx:127` + `App.jsx:1320` | `KNOWN_PAGES` sans `'cart'` → `next` réécrit en `'shop'` **avant** le test `next === 'cart'`. Branche morte. |
| 4 | `shopStore.js:13-21` | FNV-1a 32 bits, non salé, présenté comme hash de mot de passe. |
| 9 | `App.jsx:211,832,890` vs `logout():672-682` et effet `authId`:567-572 | `setReserved` jamais réinitialisé au logout ni au changement de compte. |
| 10 | `orderLogic.js:302-318` | `mergeServerOrders` retourne `server.map(…)` → les commandes locales-only disparaissent de l'état. |
| 13 | `App.jsx:428`, `index.js:494`, `deskStream.js:104` | `?oauth_token=` et `?token=` (WebSocket) dans l'URL. |
| 15 | `index.js:548-556` + `App.jsx:273-279` | Repli dégradé sur prix/stock statiques, sans horodatage ni signalement d'écart. |
| 17 | `App.jsx:721` (`{ ...product, qty: 1 }`) + `total:685` | Prix figé à l'ajout ; le total local est calculé sur cette copie. |
| 18 | `App.jsx:712-713` vs `718-723` | `liveStock` lit le `cart` du rendu ; deux `add()` consécutifs passent le même garde. |
| 19 | `App.jsx:730` | Produit introuvable → `max = 1`, quantité bloquée silencieusement. |
| 20 | `App.jsx:255-265,516,548,829,889` | `saveOrders`/`storage.setItem` **dans** les updaters ; `setReserved` dans l'updater de checkout (`:890`). |
| 21 | `App.jsx:882` | `nextLocalOrderCode(reservations.map(…))` après plusieurs `await` → closure périmée. |
| 22 | `shopStore.js:161-168` ≡ `index.js:194-201` | Duplication exacte (mapping, lui, correct — voir §2). |
| 25 | `db.js:59` | `return s === hashPassLegacy(password)` — non timing-safe, alors que les deux autres branches utilisent `timingSafeEqual`. |
| 28 | `deskStream.js:18-19,69-76,160-172` | `RECONNECT_MAX_MS = 30000` ; `onclose` → `startPolling()` + `scheduleReconnect()`, sans détection d'environnement sans WS. |
| 29 | `App.jsx:237` (`useRef(null)`), `597-610` | Premier pull : `known` nul → aucune notification pour les commandes déjà présentes. |
| 30 | `OrdersPage.jsx:28` | `user ? filter(userId === user.id) : filter(userId == null)` — les commandes guest du même appareil disparaissent à la connexion. |
| 31 | `MasterPage.jsx:162` + `App.jsx:1517` + `shopStore.js:296-300` | Le contrôle de SKU reçoit `products` = `catalog` (filtré) ; `buildShopView` exclut les masqués, et `catalog` exclut en plus les ruptures en mode local. |
| 32 | `masterApi.js:125-128` vs `:77` | `needs` : `Array.isArray` exigé en patch, `String(…).trim()` en création. |
| 33 | `masterApi.js:173-192` | `productOverrides[id] = next` est écrit **après** le retrait de `hiddenProductIds` → `{}` persistant. |
| 34 | `masterApi.js:293-301` vs `db.js:223-240` | Backup : stamp à la **seconde**, sans aléa. Quarantaine corrompue : ms **+ 3 octets aléatoires**. Incohérence confirmée. |
| 35 | `db.js:178` | `if (purgeExpired(db) \|\| stripped \|\| seeded) writeDb(db)` — écriture **pendant** `readDb()`. |
| 36 | `index.html:9` `#f4f6fb` · `theme-boot.js:12` `#f4f6fb` · `prefs.js:60` `#f2f5f8` | Divergence confirmée (sur du code mort, voir #37). |
| 38 | `App.jsx:143`, `BuilderPage.jsx:7`, `SearchPage.jsx:6`, `ProductPage.jsx:7` | 4 copies ; **2 familles de classes** (`stock-out/stock-low/stock-ok` vs `danger/warning/success`). |
| 39 | `PartThumb.jsx` | `<img width={800} height={800} sizes={sizes}>` **sans `srcSet`** ; seul le `<source type="image/webp">` porte un `srcSet` (1 candidat, sans descripteur). `sizes` sans effet. |
| 40 | `BuilderPage.jsx:42` vs `:31` + `data.js:684` | Options : `p.compat?.socket === board.compat?.socket`. Validation : `socketsMatch(…)`. Incohérence confirmée, et le commentaire P17 (`:27-30`) dit exactement l'inverse de la ligne 42. |
| 41 | `SearchPage.jsx:112` | `id: \`s-${Date.now()}\``. |
| 42 | `MasterPage.jsx:460` + `i18n.js:830` | Bouton **avant** enregistrement libellé `masterPhotosSaved` = « Photos enregistrées ». |
| 43 | `MasterPage.jsx:286-299` vs `index.js` (route panels) | Le serveur tronque `body.extraPanels.slice(0, 12)` et répond `{ ok, meta: out }` ; le client appelle `onMeta(res.meta)` — le **meta local**, pas celui du serveur. Désync si > 12 panneaux. |
| 44 | `api.js:176-195` | `a.click()` puis `URL.revokeObjectURL(url)` synchrone. |
| 45 | `i18n.js:1555-1562` | `s.replaceAll(\`{${k}}\`, String(v))` → `String(undefined)` = `"undefined"`. Mécanisme fragile (les appels cités sont, eux, protégés). |
| 46 | `oauth.js:17-20` | `DEMO` et `BASE` évalués **au chargement du module** depuis `process.env`. |
| 47 | `rateLimit.js:2` | `const buckets = new Map()` au niveau module → par instance. Sur Vercel multi-instances, le 20/min du login est largement contournable. |
| 49 | `App.jsx:591` | `if (cancelled \|\| !r.ok \|\| …) return` — un 401 arrête le pull silencieusement, sans re-login ni message, l'intervalle continuant de tourner. |
| 51 | `e2e/smoke.spec.js:18` | `expect(page.locator('body')).not.toContainText(/auth.*error/i)` — assertion quasi vide ; rien ne vérifie que la connexion a réussi. |
| 52 | `vite.config.js:18-20` | `host: '0.0.0.0'` + `allowedHosts: true` + proxy `/api` → dev exposé au réseau local, protection Host désactivée. |
| A | `App.jsx:898-900` | `msg`/`waHref`/`waHref2` recalculés à chaque rendu ; `encodeURIComponent` sans garde de longueur (limite pratique `wa.me` ~4 Ko). |
| B | `App.jsx:818-869` | Chemin API : aucun contrôle de stock local avant POST. Échec `stock` → `setToast(t('stockShort'))` : les `shortages` renvoyés par le serveur (`index.js:637`) sont **jetés**. Repli local : le garde `raw < line.qty` fait `return` sans dire quelle ligne ni restaurer le formulaire. |
| C | `App.jsx:546-558` | `refreshStock()` n'est appelé **que** dans la branche API. En mode mixte (serveur en ligne, `authMode !== 'api'`), l'annulation locale incrémente `stockMap` pour une commande venue du serveur → unités fantômes. |
| E | `notify.js:174-184` + `deskSocket.js:30-52` | `addDeskClient` n'installe que `close`/`error` ; aucun `ping`/heartbeat serveur. `deskClientCount()` peut compter des sockets morts. |
| F | `orderLogic.js` (max+1) vs `catalog.js:179-181` (count+1) | Deux algorithmes différents pour le même format de code → collision client-local/serveur possible. |
| G | `index.js:120-132` + `:978-980` | Après `BODY_TOO_LARGE` : `reject` puis `req.resume()`, réponse 413 **sans `Connection: close`**. `req.on('error', reject)` (`:157`) peut rejeter une promesse déjà rejetée (no-op). |
| H' | `App.jsx:450-464` | `refreshStock()` sans garde de fraîcheur ni sérialisation ; trois appelants possibles quasi simultanés → une réponse antérieure peut gagner. |
| M | `catalog.js:264-275` | `purgeUser` met `o.userId = null` mais **n'annule pas** les commandes actives : le stock reste réservé pour un client supprimé. |
| N | `oauth.js:56-72` | `allowed` inclut `process.env.FRONT_URL`/`FRONT_ORIGIN` bruts ; un `FRONT_URL` sans schéma fait `throw` dans `new URL(origin)` → `catch` → `false`, silencieusement, sans log. |
| R'' | `MasterPage.jsx:268-282` | `current` calculé depuis le `meta` **local** ; après succès, `onMeta({ ...meta, hiddenPanelIds: [...current] })` — le `meta` renvoyé par le serveur est ignoré. |
| S | `App.jsx:927` | `<span className="text-success">●</span> SYS.ONLINE` **hardcodé**, indépendant de `apiOnline`. `SKU {catalog.length}` (`:934`) porte sur le catalogue filtré (ruptures exclues en mode local). |
| T | `vercel.json` (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) vs `App.jsx:149-151`, `api.js:8` | Le code prévoit explicitement l'aperçu en iframe tiers (« some embedded iframes block third-party localStorage », « aperçus iframe ») ; les en-têtes l'interdisent. Deux intentions contradictoires. |
| U | `index.js:513-516` | Sous Vercel : `path.join('/tmp', 'pcstar-uploads')` — éphémère par instance. Les URLs `/api/upload-file?name=…` meurent au cold start ; rien ne distingue ce cas d'un Blob manquant côté produit. |
| Z | `App.jsx` `deskBeep` | `g.gain.value = 0.04` puis `o.start()` / `o.stop(+0.12)` sans rampe → clic audio. |

---

## 6. Ce que le rapport n'a pas vu

Points relevés pendant la vérification, absents du rapport :

1. **Amplification CPU de #12** — `scryptSync` synchrone, ~31–43 ms par hash,
   sur une route sans rate-limit **et** sans authentification (mesuré : 770 ms
   de blocage pour 25 inscriptions). C'est ce qui transforme #12 d'un problème
   de spam en problème de disponibilité.
2. **Le wrapper `storage` d'`App.jsx:76-87` lève aussi** — ajouté précisément
   pour les iframes à stockage bloqué (d'après son commentaire), il n'a pas de
   try/catch. #8 est donc plus étendu que décrit : la protection supposée n'en
   est pas une.
3. **Identifiants master publiés dans la documentation** — `README.md:19`,
   `docs/GUIDE-DEMO.md:23`, `docs/GUIDE-DEMO-FR.md:10`, `docs/GUIDE-DEMO-AR.md:10`,
   `docs/DEPLOY-VERCEL.md:127`. Même sans lire le bundle, la doc donne l'accès
   master. À traiter avec #3.
4. **`/api/health` livre l'e-mail master** — couplé à #3, l'identifiant et le
   mot de passe sont obtenus sans aucun outil (#27 le mentionne, mais pas le
   couplage).
5. **Le repli OAuth réinjecte `FRONT_URL` non validé dans le `Location`** —
   `server/index.js:493` : `safeReturnUrl(done.returnUrl) || process.env.FRONT_URL || 'http://127.0.0.1:5173'`.
   `safeReturnUrl` valide soigneusement le `returnUrl` **client**, mais le repli
   `process.env.FRONT_URL` est concaténé **sans repasser par `safeReturnUrl`** :
   une variable d'environnement mal configurée (ou sans schéma) produit un
   `Location` non validé portant un token de session. Complément direct de N.
6. **`readDb()` complet à chaque requête** — chaque handler appelle
   `readDbAsync()`/`updateDbAsync()`, et `readDb()` (`server/db.js`) relit et
   reparse le fichier entier, avec purge + `writeDb` éventuels (#35). Aucun
   cache en mémoire : le coût croît linéairement avec la taille de `store.json`.
7. **`GET /api/orders` remappe `pending → new` mais `PATCH`/`DELETE` travaillent
   sur le statut brut** — `server/index.js:596-600`. Le rapport avait ouvert ce
   chantier (item D) puis l'a retiré en concluant à une « incohérence bénigne ».
   Elle l'est pour les transitions (`pending` est bien dans la table), mais le
   remap d'affichage masque au master l'existence de commandes legacy
   `pending` — utile à savoir avant toute migration de données.

### Correction d'un point de la passe précédente

Une vérification antérieure affirmait que le bandeau dégradé « ment » en
annonçant « les commandes ne seront pas enregistrées » alors que seule la
lecture serait tombée. **C'est inexact.** Le texte
(`i18n.js:283-284` (ar), `:799-800` (fr), `:1314-1315` (en), vérifié par exécution) est :

> « Base de données injoignable — catalogue de secours affiché (prix et stock
> d'origine). Les commandes ne seront pas enregistrées. »

Or le mode dégradé n'est déclenché que si `readDbSafe()` lève, c'est-à-dire si
le driver **Neon** est injoignable (`server/db.js`). Dans ce cas
`updateDbAsync` → `updateNeonState` échoue **aussi** : les écritures tombent
avec les lectures. Le bandeau est donc **exact**. Et en mode fichier,
`readDbSafe` ne tombe pas en mode dégradé — il sert la base locale. Le client,
lui, ne tente l'envoi que `if (apiOnline)` (`App.jsx:818`). Aucune contradiction
à signaler ici.

---

## 7. Priorités de correction

Reprises du rapport, corrigées de cette vérification.

### Bloquant sécurité

| # | Point | Correction suggérée |
|---|---|---|
| **#3** | Identifiants master en clair dans le bundle **et** dans la doc | Sortir `MASTER` de `src/shopStore.js` ; charger côté serveur depuis l'environnement (`MASTER_EMAIL`/`MASTER_PASSWORD`), **échec propre si absent** (pas de valeur par défaut codée en dur) ; retirer les identifiants de `README.md`/`GUIDE-DEMO*`/`DEPLOY-VERCEL.md` ; réinitialiser le mot de passe réel |
| **#6** | Injection HTML sur le consentement OAuth | Échapper `state` (et `name`/`email`) dans `demoConsentHtml`, ou mieux : ne pas interpoler — renvoyer le `state` via un champ signé côté serveur |
| **L** | Injection de formule CSV | Préfixer `'` (ou tab) devant toute cellule commençant par `= + - @` dans `csvEscape` |
| **#12** | `register` sans rate-limit + `scryptSync` bloquant | `rateLimit` sur `/api/auth/register`, `/api/me`, `/api/me/password` ; passer le hashing en asynchrone (`scrypt` callback / `promisify`) hors du thread principal |
| **#24** | Sessions survivent au changement de mot de passe | Purger `db.sessions` de l'utilisateur dans `POST /api/me/password` et dans le reset master (comme le fait déjà `purgeUser`) |
| **#5** | CSP bloque les photos Blob | Ajouter le domaine Blob à `img-src` dans `vercel.json`, **ou** servir systématiquement via `/api/upload-file?name=` (302 déjà en place) et ne stocker que des chemins relatifs |
| **#4** | FNV-1a 32 bits comme hash de mot de passe | Le mode local ne peut pas faire de KDF sérieux côté navigateur : assumer le mode démo (comptes non sensibles, aucun secret réel) ou supprimer le mode local |
| **#27** | `/api/health` divulgue master/OAuth/CORS/driver | Retirer `master` et `cors` ; garder `ok`/`db.driver` pour le monitoring |

### Bloquant fonctionnel

| # | Point | Correction suggérée |
|---|---|---|
| **#1** | `go('cart')` mort | Ajouter `'cart'` à `KNOWN_PAGES`, **ou** traiter `next === 'cart'` **avant** la réécriture |
| **#2** | Changement de mot de passe toujours 403 | Champ « mot de passe actuel » dans `ProfilePage`, paramètre `current` dans `api.changePassword` |
| **#7** | Collision de codes après suppression | `makeOrderCode` basé sur le **max** des séquences du jour (aligné sur `nextLocalOrderCode`), pas sur le comptage — corrige aussi **F** |
| **#23** | `wilaya`/`slot`/`name` non validés | Whitelist `WILAYAS_NEAR` et `SLOTS`, longueur max sur `name`/`short` |

### Robustesse

| # | Point |
|---|---|
| **#8** | try/catch autour de **tous** les accès storage, y compris le wrapper `App.jsx:76-87` et les paramètres par défaut de `prefs.js`/`api.js` ; repli mémoire |
| **#9** | `setReserved(null)` dans `logout()` et dans l'effet `authId` |
| **#10** | `mergeServerOrders` doit conserver les commandes locales-only non synchronisées |
| **#14 / #35** | Verrou ou écriture sérialisée sur le driver fichier ; sortir `purgeExpired`/`writeDb` de `readDb()` |
| **#2 / #32 / #43 / R''** | Utiliser la réponse **serveur** comme source de vérité après mutation (meta, panneaux, `needs`) |

### Qualité / divergence

#16 (champ `count` mort), #37 (code mort thème, non testé), #38 (`stockLabel` ×4),
#22 (`phoneCarrier` ×2), #39 (`sizes` sans `srcSet`), #40 (`===` vs `socketsMatch`),
#36 (`theme-color` divergent), #42 (libellé du bouton photos), #Y (motif de repli
`cat_`), #Z (clic audio).

---

## 8. Note sur la couverture de tests

Les **315 tests passent** avec l'intégralité de ces bugs présents. Concrètement :

- `src/apiServer.test.js` utilise `pcstar.info31@gmail.com` / `star31` comme
  identifiants de test (`:69,121,148,183,209,234,263,291,311`) — la présence du
  secret dans le bundle n'est donc pas testée, elle est **présupposée** ;
- aucun test ne couvre `go('cart')`, `POST /api/me/password` depuis l'UI,
  `makeOrderCode` après suppression, l'échappement du consentement OAuth,
  `csvEscape` sur une formule, la purge de sessions après changement de mot de
  passe, ni la validation de `wilaya`/`slot`.

Toute correction de ces items devrait s'accompagner d'un test de non-régression
correspondant — c'est la condition pour que la suite redevienne un signal.
