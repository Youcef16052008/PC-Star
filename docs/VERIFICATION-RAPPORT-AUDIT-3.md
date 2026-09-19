# Audit complémentaire — découverte hors rapports (A→Z du dépôt)

> **Journal daté — ses chiffres sont ceux du jour, pas l'état du dépôt.** Ce
> document est une trace : on ne le réécrit pas quand il est contredit plus tard,
> parce qu'effacer une conclusion fausse efface aussi la raison pour laquelle
> elle était fausse.
> Au fil des lots, plusieurs nombres et commandes ci-dessous ont été
> dépassés. L'état mesuré d'aujourd'hui est dans
> [`../../README.md`](../../README.md) (« État mesuré »), la suite des sessions
> dans [`BUGS-AND-FIXES.md`](BUGS-AND-FIXES.md). Les docs **exécutables** (guides,
> recettes, prompts d'agent, `docs/README.md`) ont, elles, été corrigées — c'est
> `src/p3DocsAging.test.js` qui verrouille les deux régimes.


**Date :** 16/09/2026
**Objet :** analyse complète du dépôt **après** l'exécution des lots 1 à 6, à la
recherche de défauts que les deux rapports d'origine ne listent pas.
**Base :** `ebb6c46`, branche `arena/01a0a55c-pc-star`. Dépôt non modifié par
cette analyse (les deux reproductions en direct ont été faites sur une instance
de prévisualisation jetable, puis nettoyées).
**Lecture préalable :** `docs/VERIFICATION-RAPPORT-AUDIT.md`,
`docs/VERIFICATION-RAPPORT-AUDIT-2.md`, `docs/PLAN-CORRECTIONS.md`.

Ce document ne remplace pas les deux rapports : il les **complète**. Les rapports
d'origine ne sont pas modifiés (même règle que pour les lots précédents).

---

## 1. Verdict global

| Sévérité | Nombre | Items | Statut |
|---|---|---|---|
| 🔴 Bloquant (argent / intégrité des commandes) | **2** | A1, A2 | ✅ **corrigés** le 16/09/2026 (lot 8.1 + 8.2) |
| 🟠 Majeur (échec silencieux, production Vercel) | **4** | A3, A4, A5, A6 | ✅ **les quatre corrigés** (lots 8.3, 8.4, 8.5, 8.6) |
| 🟡 Mineur (durabilité, cohérence, hygiène) | **4** | A7, A8, A9, A10 | ✅ **les quatre corrigés** (lots 8.7, 8.8, 8.9, 8.10) |
| **Total** | **10** | | ✅ **10 corrigés sur 10** (A1 → A10) — lot 8 clos |

> **Mise à jour du 16/09/2026.** A1, A2, A6, A3, A4, A5, A7, A8, A9 puis
> **A10** ont été corrigés et livrés sur cette même branche (**158 tests de
> non-régression** au total, suite à **761/761**, reproductions en direct
> rejouées : 409 et 400 à la
> place de 201 pour A1/A2, destinataire `213770650387` à la place de
> `0770650387` pour A6, 404 et bouton retiré pour A3, `413
> {"maxBytes":4194304,"platformLimit":4718592}` sur un banc `VERCEL=1` pour A4,
> 6 photos au plafond acceptées et corps trop lourd refusé avant envoi pour A5,
> commande écrite puis annulée sur disque valide sans `store.json.tmp` résiduel
> pour A7, pour A8 la même commande rendue `16‏/9‏/2026، 10:30:00 ص` /
> `97.000 دج` au Desk **et** dans « Mes commandes », et pour A9 le dictionnaire
> ramené de 538 à **476 clés** par langue avec le bundle passé de 451,02 Ko à
> 442,75 Ko, et pour A10 `POST /api/master/products {category:"SSD"}` → **400
> `{"error":"category"}`** au lieu d'un 201 qui rangeait le produit là où aucun
> filtre ne le montre, `{category:"memory"}` → 201 retrouvé dans le filtre de sa
> catégorie, et `PUT {kind:"machine"}` → **200 réellement appliqué** au lieu
> d'un 200 qui ne changeait rien). Détail des correctifs, décisions et
> neutralisations dans `docs/PLAN-CORRECTIONS.md` §9, sections « ✅ Fait — lot
> 8.1 + 8.2 », « lot 8.6 », « lot 8.3 », « lots 8.4 + 8.5 », « lot 8.7 »,
> « lot 8.8 », « lot 8.9 », « lot 8.10 » et « ✅ Lot 8 clos ». Le corps de ce
> rapport reste **inchangé** : il décrit l'état audité, les statuts sont ajoutés
> en tête de chaque item corrigé.

Les deux items bloquants concernent **le même point d'entrée** —
`placeOrder()` (`server/catalog.js`) et la route `POST /api/orders`
(`server/index.js:826`) — qui valident beaucoup de choses (nom, téléphone,
wilaya, créneau, prix recalculés, stock, rate-limit, revendication R20) mais
**jamais l'existence ni la visibilité du produit commandé**.

Chaque item ci-dessous donne : l'affirmation, la preuve (fichier:ligne), la
**reproduction exécutée** avec sa sortie réelle, la conséquence métier, et la
correction proposée. Le plan de correction par lot est dans
`docs/PLAN-CORRECTIONS.md` §7, **lot 8**.

---

## 2. Items bloquants

### 🔴 A1 — Un produit **masqué** par le maître reste commandable par n'importe qui

> ✅ **CORRIGÉ (16/09/2026, lot 8.1).** `placeOrder()` refuse toute ligne dont
> l'id figure dans `hiddenProductIds` — dans la transaction, avant tout
> décrément — et la route répond **409 `unavailable`** en nommant la ligne. Le
> client retire la ligne du panier et dit pourquoi. Reproduction ci-dessous
> rejouée sur le code corrigé : **409** au lieu de 201, stock inchangé, aucune
> commande créée. Tests : `src/lot8Logic.test.js`, `src/lot8Server.test.js`,
> `src/lot8UI.test.js`.

**Affirmation.** `hiddenProductIds` retire un produit du catalogue public, mais
ni `placeOrder()` ni la route de commande ne le consultent : une commande sur un
produit masqué est **acceptée** (201), son stock est décrémenté, le comptoir est
notifié (Desk + WhatsApp), et la commande part dans l'export CSV.

**Preuve.**

- `server/catalog.js:331` — le filtre `hidden` n'existe que dans
  `publicCatalog()` :
  ```js
  const hidden = new Set(db.meta?.hiddenProductIds || [])
  ```
- `server/catalog.js:72-168` (`placeOrder`) — aucune référence à
  `hiddenProductIds`. La boucle de validation ne teste que `line.id` non vide et
  le stock disponible.
- `server/index.js:826-925` (route `POST /api/orders`) — valide `name`, `phone`,
  `wilaya`, `slot`, `day`, le rate-limit et la revendication (R20). Rien sur la
  visibilité du produit.
- Les identifiants du catalogue de base sont **dans le bundle public**
  (`src/data.js` → `PRODUCTS`, embarqué côté client) : masquer un produit ne
  rend pas son `id` secret.

**Reproduction exécutée** (serveur de prévisualisation réel, API + front) :

```console
# 1. le maître masque un produit
$ curl -X POST /api/master/products/gpu-4070s/hide -d '{"hidden":true}'   [token master]
{"ok":true,"product":{"id":"gpu-4070s","sku":"RTX4070S-12G",…}}

# 2. il a bien disparu du catalogue public
$ curl /api/catalog | jq '[.products[].id] | index("gpu-4070s")'
null            # 221 produits, gpu-4070s absent

# 3. un VISITEUR ANONYME (aucun compte, aucun jeton) le commande
$ curl -X POST /api/orders -d '{"name":"Visiteur Audit","phone":"0550123456",
    "wilaya":"Oran","slot":"10:30","day":"2026-09-16",
    "items":[{"id":"gpu-4070s","qty":1,"price":147000}],"total":147000}'
{"ok":true,"order":{"code":"PS-20260916-0002",…,"total":147000,"status":"new"}}
HTTP 201
```

(L'aperçu a été remis en état ensuite : produit réaffiché, commande de test
annulée, stock rendu à 3.)

**Conséquence métier.** Le maître masque une fiche pour une raison précise —
rupture définitive, prix non prêt, erreur de fiche, produit réservé au comptoir.
Un client qui a encore l'ancienne page ouverte, ou qui connaît l'`id`, commande
quand même : le comptoir reçoit une commande ferme sur un produit qu'il ne vend
plus, avec le stock décrémenté et une notification WhatsApp à la clé. C'est aussi
un vecteur d'abus : on peut vider le stock d'une référence masquée sans jamais
la voir.

**Correction proposée.** Refuser dans `placeOrder()`, **dans la même
transaction** que le contrôle de stock (avant tout décrément) :

```js
const hidden = new Set(db.meta?.hiddenProductIds || [])
for (const line of normalized) {
  if (hidden.has(line.id)) unavailable.push({ id: line.id, name: line.name })
}
if (unavailable.length) return { ok: false, error: 'unavailable', unavailable }
```

Route : répondre `409 { ok:false, error:'unavailable', unavailable }`. Client
(`src/App.jsx`, `reserve()` + `orderApiFailure()` dans `src/orderLogic.js`) :
message dédié — « cet article n'est plus disponible, retirez-le du panier » —
et **retrait de la ligne du panier** plutôt qu'un simple toast, sinon le client
re-soumet la même commande en boucle. Prévoir aussi le cas du panier chargé
avant masquage : `pricedCart` (lot 5.4) sait déjà retrouver un produit dans le
catalogue live ; un produit devenu introuvable ou masqué doit être signalé dans
le panier, pas seulement au moment de commander.

---

### 🔴 A2 — Commande acceptée à **0 DA** sur un identifiant inconnu

> ✅ **CORRIGÉ (16/09/2026, lot 8.2).** Une ligne dont `priceOf()` renvoie
> `null` est refusée (`unknown_product`, **400**) au lieu d'être tarifée 0 DA, et
> `normalizeDb()` purge désormais les entrées orphelines de `db.stock` et
> `productOverrides` qui alimentaient ce chemin (avec journalisation des clés
> retirées). Reproduction rejouée : **400** au lieu d'une commande à 0 DA.

**Affirmation.** Si `db.stock` contient une entrée pour un identifiant qui ne
correspond à **aucun** produit (ni catalogue de base, ni `extraProducts`, ni
`productOverrides`), `placeOrder()` accepte la commande : `priceOf()` renvoie
`null`, la ligne est tarifée **0**, et `liveStockOf()` renvoie le stock de
l'entrée orpheline — donc le contrôle de stock passe.

**Preuve.**

- `server/catalog.js:58-66` — `priceOf()` renvoie `null` pour un id inconnu :
  ```js
  const base = PRODUCTS.find((p) => p.id === productId)
  if (base) return Math.max(0, Number(base.price) || 0)
  return null
  ```
- `server/catalog.js:81-90` — la normalisation transforme ce `null` en **0** au
  lieu de refuser la ligne :
  ```js
  price: price == null ? 0 : price
  ```
- `server/catalog.js:38-46` — `liveStockOf()` lit `db.stock[productId]` **sans
  vérifier que le produit existe** :
  ```js
  if (Object.prototype.hasOwnProperty.call(db.stock, productId)) {
    return Math.max(0, Number(db.stock[productId]) || 0)
  }
  ```
- `server/db.js:271-340` (`normalizeDb`) — ne purge jamais les entrées de
  `db.stock` orphelines. Rien d'autre ne le fait non plus.

**Reproduction exécutée** (appel direct de la fonction de production, base
construite à la main) :

```console
$ node -e "…placeOrder({ stock: { 'produit-fantome': 5 }, orders: [], meta: {} }, …)"
priceOf(phantom)  = null
liveStockOf       = 5
placeOrder        = true | total = 0 | code = PS-20260916-0001
stock après       = 0
```

Une commande **réelle**, avec un code, un statut `new`, cinq articles, un total
de **0 DA** — et le stock fantôme décrémenté. Elle apparaît au Desk, dans
l'export CSV et dans la notification WhatsApp au maître.

**Comment une entrée orpheline arrive en base** (trois chemins réalistes, aucun
ne demande d'accès serveur) :

1. **Renommage d'un `id` dans `src/data.js`.** Le catalogue de base est édité à
   la main. Un `gpu-4070s` devenu `gpu-4070s-12g` au déploiement suivant laisse
   `db.stock['gpu-4070s']` en base — et l'ancien `id` est connu de tous les
   navigateurs qui ont chargé le bundle précédent (il est aussi dans les paniers
   persistés, les recherches sauvées et les commandes historiques).
2. **Produit maître écarté de `extraProducts`.** `migrateNeeds()` et les
   normalisations master réécrivent le tableau ; une base importée
   (`scripts/import-neon.mjs`, `scripts/neon-migrate.mjs`) ou restaurée d'un
   backup peut contenir un stock sans le produit correspondant.
3. **Restauration partielle** : `store.json` remplacé par un backup plus ancien
   que le dernier `writeDb` de stock (le dossier `backups/` et la quarantaine
   `store.json.corrupt-*` existent précisément pour ces cas).

**Conséquence métier.** Une commande à 0 DA est encaissable au comptoir comme
telle : le client présente un code de commande valide, le Desk affiche un total
de 0 DA. Même sans mauvaise foi, c'est une ligne comptable fausse, et le stock
d'un produit inexistant est décrémenté — donc le vrai stock n'est plus suivi.

**Correction proposée.** Deux garde-fous, et non un seul :

1. **Refuser une ligne sans prix de référence** dans `placeOrder()` — remplacer
   `price: price == null ? 0 : price` par un rejet explicite :
   ```js
   if (price == null) unknown.push({ id: line.id, name: line.name })
   …
   if (unknown.length) return { ok: false, error: 'unknown_product', unknown }
   ```
   Route : `400 { error: 'unknown_product' }`. Client : message « article
   introuvable au catalogue » + retrait de la ligne du panier (même mécanique
   qu'A1 — c'est le même chemin de code).
2. **Purger les stocks orphelins** dans `normalizeDb()` : supprimer de `db.stock`
   (et de `meta.productOverrides`) toute clé absente de
   `PRODUCTS ∪ extraProducts`, en ne le faisant qu'une fois par écriture et en
   journalisant les clés retirées — sinon une entrée orpheline reste un piège
   pour le prochain `readDb`. Un test de non-régression doit couvrir le cas
   « override de prix conservé, stock orphelin purgé ».

Les deux sont nécessaires : le garde-fou 1 protège la commande, le 2 protège
tout ce qui lit `db.stock` (Desk, page master, `publicCatalog`).

---

## 3. Items majeurs

### 🟠 A3 — Le drapeau `claimable` est reçu, stocké… et jamais lu

> ✅ **CORRIGÉ (16/09/2026, lot 8.3).** Nouvelle règle unique `canCancelHere()`
> (`src/orderLogic.js`) : `OrdersPage` ne rend plus le bouton « Annuler » sur une
> commande `claimable: false` et affiche une mention « annulation au comptoir » ;
> `cancelMyOrder()` distingue le **404** (`orderCancelNotMine`) de la panne
> (`orderCancelFail`) et sa branche locale applique la même règle. Vérifié en
> direct : commande anonyme au numéro d'un compte → `claimable=false`, absente de
> `GET /api/me/orders`, annulation par le titulaire → **404**.

**Affirmation.** Depuis le lot 4.4 (R20), une commande guest passée au numéro
d'un compte existant est marquée `claimable: false` : le serveur la refuse à
`GET /api/me/orders` et à l'annulation. Le client **reçoit** ce drapeau, le
**persiste** dans sa copie locale, puis l'ignore : la page « Commandes » affiche
un bouton « Annuler » qui échoue toujours, avec un message d'échec générique.

**Preuve.**

- `src/App.jsx`, `reserve()` — la copie locale est un spread de la réponse
  serveur, drapeau compris :
  ```js
  const order = { ...r.data.order, status: r.data.order.status || 'new' }
  commitReservations((prev) => [order, …])
  ```
- `src/OrdersPage.jsx:130-140` — le bouton d'annulation ne dépend **que** du
  statut :
  ```js
  {(o.status === 'new' || o.status === 'pending') && ( <button … onClick={() => doCancel(o.code)} … )}
  ```
- Recherche sur tout `src/` : **zéro occurrence** de `claimable` côté client
  (`grep -rn "claimable" src/*.jsx src/*.js` → vide hors tests).
- `src/App.jsx`, `cancelMyOrder()` — l'échec serveur (404 `not_found` renvoyé
  par R20) tombe dans le message générique :
  ```js
  setToast(t(r?.offline || !r ? 'backendOffline' : 'orderCancelFail'))
  ```

**Reproduction.** Commander sans compte au numéro d'un compte existant (le cas
exact de R20), puis ouvrir « Commandes » sur le même navigateur : la ligne est
là (copie locale), badge « passée sans compte », bouton « Annuler » actif. Un
clic → 404 côté serveur → toast « L'annulation a échoué ». Le bouton reste, le
client réessaie.

**Conséquence.** Échec silencieux répétable : l'interface propose une action que
le serveur refuse par conception, et le message ne dit ni pourquoi ni quoi
faire. C'est exactement la catégorie « honnêteté de l'UI » que le lot 5 traitait
— mais sur un drapeau ajouté au lot 4, après la rédaction du lot 5.

**Correction proposée.** Dans `OrdersPage.jsx`, lire le drapeau : si
`o.claimable === false`, ne pas rendre le bouton d'annulation et afficher une
mention courte (`orderNotClaimable`, nouvelle clé × 3 langues) — « passée sans
compte, à annuler au comptoir ». Dans `cancelMyOrder()`, distinguer le 404
(`not_found`) du 5xx pour ne plus dire « échec » quand la réponse est « cette
commande n'est pas annulable ici ». Un test de régression doit rendre
`OrdersPage` avec une ligne `claimable: false` et vérifier l'**absence** du
bouton.

---

### 🟠 A4 — Sur Vercel, la limite de corps réelle est 4,5 Mo ; le code en annonce 10 Mo et 15 Mo

> ✅ **CORRIGÉ (16/09/2026, lot 8.4).** `api/index.js` n'exporte plus aucune
> `config.api.*` (convention Next.js, ignorée par `@vercel/node`) : un
> commentaire dit la limite réelle — **4,5 Mo**, requête **et** réponse, non
> relevable — et renvoie vers le module de budgets. `server/index.js` borne le
> corps selon l'environnement : `MAX_BODY_BYTES = IS_SERVERLESS ? 4 Mo : 15 Mo`,
> donc **sous** la limite plateforme en production — le refus vient de
> l'application, avec son JSON. Le 413 annonce désormais la borne appliquée
> (`maxBytes`) et la limite plateforme (`platformLimit`, non `null` sous
> Vercel). Toutes les valeurs viennent d'un seul module, `src/limits.js`, et
> `docs/DEPLOY-VERCEL.md` §7 documente la contrainte.
>
> Vérifié en direct sur un banc en configuration serverless (`VERCEL=1`) :
> `MAX_BODY_BYTES=4194304` au démarrage, et un corps de **4,20 Mo** →
> `413 {"ok":false,"error":"too_large","maxBytes":4194304,"platformLimit":4718592}`.

**Affirmation.** `api/index.js` exporte `config.api.bodyParser.sizeLimit:
'10mb'`. Cette configuration est celle des **routes API Next.js** ; sur une
fonction Node Vercel (`@vercel/node`, ce qu'est `api/index.js`) elle n'est pas
appliquée, et la plateforme plafonne de toute façon le corps de requête **et** la
réponse à **4,5 Mo** (`FUNCTION_PAYLOAD_TOO_LARGE`). En face, `server/index.js`
autorise `MAX_BODY_BYTES = 15 * 1024 * 1024`. Résultat : en production le 413
JSON propre de l'application ne peut **jamais** partir — c'est l'erreur HTML de
la plateforme que reçoit le client.

**Preuve.**

- `api/index.js:24-31` :
  ```js
  export const config = { api: { bodyParser: { sizeLimit: '10mb' }, responseLimit: '4mb' } }
  ```
  et le commentaire juste au-dessus : « la limite 4 mo d'origine provoquait des
  413 sur Vercel dès 6 photos. Réponse : aucun endpoint ne dépasse ~1 Mo
  (catalogue ≈ 500 Ko), 4 mo reste large » — le commentaire **contredit** la
  configuration qu'il surmonte (10 Mo posés, « 4 mo reste large » écrit).
- `server/index.js:129` : `const MAX_BODY_BYTES = 15 * 1024 * 1024`, utilisé
  ligne 150 puis ligne 1280 pour le 413 applicatif
  (`send(res, 413, { ok:false, error:'too_large' }, { Connection:'close' })`).
- Limite plateforme : 4,5 Mo pour le corps de requête **et** de réponse d'une
  fonction serverless Vercel, non configurable par `bodyParser` (le
  contournement documenté par Vercel est l'upload direct vers Blob, pas une
  configuration de fonction).

**Conséquence.** Deux effets concrets :

1. Un envoi de photos qui dépasse ~4,5 Mo (voir A5 : c'est atteignable) produit
   une page d'erreur **plateforme**, pas le message « fichier trop lourd » de
   l'application. Le maître voit un échec brut sans savoir quoi réduire.
2. La réponse du catalogue est plafonnée à 4,5 Mo par la plateforme alors que
   `responseLimit: '4mb'` laisse croire à une marge choisie : si `extraProducts`
   grossit (photos en data URL importées par erreur, historique de produits), la
   coupure viendra de la plateforme, sans log applicatif.

**Correction proposée.** Aligner les trois niveaux sur la contrainte réelle et
l'écrire une fois :

- descendre `MAX_BODY_BYTES` à ~4 Mo **en environnement serverless**
  (`process.env.VERCEL`), garder une valeur plus haute en serveur local longue
  durée (le fichier est déjà capable de distinguer les deux — c'est ce que fait
  `IS_SERVERLESS` pour l'upload au lot 4.2) ;
- supprimer `config.api.bodyParser` / `responseLimit` de `api/index.js` ou les
  remplacer par un commentaire qui dit la vérité : la limite est celle de la
  plateforme, 4,5 Mo, et l'application doit rester **sous** cette limite ;
- côté client, borner le payload **avant** l'envoi (voir A5) pour que le 413
  applicatif — ou mieux, un refus client expliqué — soit ce que l'utilisateur
  rencontre ;
- ajouter la limite plateforme dans `docs/DEPLOY-VERCEL.md` §7 (« limites
  honnêtes »), à côté du rate-limit par instance et de l'absence de WebSocket.

---

### 🟠 A5 — La compression des photos est décidée sur les **dimensions**, jamais sur les octets

> ✅ **CORRIGÉ (16/09/2026, lot 8.5).** La compression est pilotée par un
> **budget d'octets** : `dataUrlBytes()` mesure le poids décodé, et une image
> déjà ≤ 800 px mais trop lourde est **ré-encodée à dimensions constantes** au
> lieu de repartir telle quelle. Tant que le budget n'est pas tenu, une boucle
> **bornée** baisse la qualité (0,8 → 0,5) puis les dimensions (×0,8, plancher
> 320 px), au plus 12 itérations. Le budget par défaut (400 Ko) vient de
> `src/limits.js`, comme la borne serveur par blob (2,5 Mo) et le plafond de
> photos (6).
>
> Le **total** est borné avant l'envoi : `payloadOverBudget()` (même module)
> mesure le corps que produiraient les dataURL — ce sont les chaînes base64 qui
> voyagent, pas les octets décodés — et `MasterPage` refuse la création comme
> l'édition de photos au-delà de 4 Mo, avec un message qui cite le poids obtenu,
> la borne et quoi faire (`masterPhotosTooHeavy`, 3 langues). La chaîne tient :
> 6 × 400 Ko → ~3,2 Mo de base64 < 4 Mo < 4,5 Mo (plateforme).
>
> Vérifié en direct : 6 photos au plafond client (corps 3,13 Mo) → `200`, 6
> photos stockées ; 7 photos → écrémées à 6 ; une photo de 3 Mo → écartée,
> l'autre conservée.

**Affirmation.** `compressDataUrl()` renvoie l'image **telle quelle** dès que son
plus grand côté est ≤ 800 px, quelle que soit sa taille en octets. Or le serveur
accepte jusqu'à `MAX_BYTES = 2,5 Mo` **par photo** et `MAX_PHOTOS = 6` — soit un
corps de requête légitime d'environ 15 Mo de base64 (~20 Mo de JSON), très
au-dessus de la limite plateforme (A4). Aucun budget total n'est vérifié côté
client avant l'envoi.

**Preuve.**

- `src/photoCompress.js:60-62` :
  ```js
  const { w, h, scale } = scaleToMaxDim(iw, ih, maxDim)
  if (scale === 1) return raw // déjà à taille, pas de re-encodage
  ```
  Le commentaire d'en-tête annonce pourtant l'objectif en **octets** : « Un
  upload de 6 × 2,5 Mo en base64 ≈ 20 Mo de JSON → 413 sur Vercel … le corps de
  requête passe sous ~2 Mo ».
- `server/blobStore.js:28-29` : `MAX_BYTES = 2.5 * 1024 * 1024`,
  `MAX_PHOTOS = 6` — appliqués **après** réception du corps
  (`server/masterApi.js:286-293`), donc après la coupure plateforme éventuelle.
- `src/MasterPage.jsx:62,162,172` : les photos sont bornées en **nombre**
  (`.slice(0, 6)`), jamais en octets.

**Cas réel.** Une capture d'écran ou un packshot **PNG 800×800** pèse couramment
1 à 3 Mo. `scale === 1` → aucun ré-encodage en JPEG → la photo part à sa taille
d'origine. Six photos de ce type : ~12 Mo de base64. Localement le serveur
répond 413 (`too_large`, message clair) ; sur Vercel la requête est coupée par
la plateforme avant d'atteindre l'application (A4).

**Conséquence.** L'échec d'upload le plus probable en production n'est pas
couvert par la compression censée le prévenir, et il arrive sans message
applicable. Le maître réessaie, obtient le même échec, et peut conclure que
« les photos ne marchent pas sur Vercel ».

**Correction proposée.** Une compression **à budget**, en trois temps :

1. ré-encoder aussi quand `scale === 1` si le data URL dépasse un seuil en
   octets (ex. 350 Ko) — le PNG passe alors en JPEG q0.8, ce qui est déjà le
   comportement pour les grandes images ;
2. boucle de réduction (qualité puis dimensions) tant que le seuil n'est pas
   atteint, avec un nombre d'itérations borné ;
3. **garde de payload total** avant l'envoi dans `MasterPage` : somme des data
   URLs ≤ ~3 Mo, sinon message explicite (« retirez des photos ou réduisez leur
   taille ») au lieu d'un envoi voué à échouer. La constante doit être partagée
   avec le serveur (un seul module, comme `phoneLogic.js` au lot 6.2) et rester
   sous les 4,5 Mo de la plateforme en tenant compte du gonflement base64 (+33 %)
   et du reste du JSON.

---

### 🟠 A6 — Un `WHATSAPP_RECIPIENT` au format local casse **toutes** les notifications, en silence

> ✅ **CORRIGÉ (16/09/2026, lot 8.6).** Chaque destinataire passe par
> `waNumber()` (formats algériens) avec repli sur un numéro international non
> algérien ; une entrée non normalisable est **écartée et signalée** au
> démarrage et dans `GET /api/health` (`whatsapp.invalid`). La reproduction
> ci-dessous renvoie désormais `["213770650387"]`, et le champ `to` du corps
> envoyé à Meta est vérifié par test. `docs/DEPLOY-VERCEL.md` §3 documente les
> écritures acceptées.

**Affirmation.** `whatsappRecipients()` nettoie les séparateurs mais ne convertit
pas un numéro local algérien (`0770650387`) en format international
(`213770650387`), alors que `waNumber()` existe dans le dépôt précisément pour
cela (P14 : « wa.me exige l'international 213XXXXXXXXX — jamais le 0 local »).
L'API WhatsApp Cloud refuse un destinataire au format local : **toutes** les
notifications de commande échouent, et rien ne le dit hors des logs serveur.

**Preuve.**

- `server/notify.js:39-57` — nettoyage par `replace(/\D/g,'')` et borne 8-15
  chiffres ; aucune normalisation d'indicatif.
- `server/notify.js` importe déjà `waNumber` — mais ne l'utilise que pour le
  **lien de rappel** du message (`formatOrderMessage`), pas pour les
  destinataires.
- Le format local est celui que le site affiche partout :
  `src/data.js` → `STORE.phone = '0770 65 03 87'`, alors que
  `STORE.whatsapp = '213770650387'` (international). Le filtre
  `STORE_WHATSAPP` accepte `^\d{8,15}$` — donc **aussi** un numéro local.
- `docs/DEPLOY-VERCEL.md` §3 invite à renseigner `WHATSAPP_RECIPIENT`, « sinon
  le numéro affiché sur le site est utilisé » : le numéro **affiché sur le site**
  est le format local. L'exploitant qui ajoute un troisième numéro recopie
  naturellement ce format.

**Reproduction exécutée** (fonction de production, aucun réseau) :

```console
$ node -e "…whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387' })"
"0770650387"              -> ["0770650387"]      | waNumber aurait donné "213770650387"
"+213770650387"            -> ["213770650387"]    | waNumber aurait donné "213770650387"
"0770 65 03 87, 0669 17 46 17" -> ["0770650387","0669174617"]
défaut (STORE_WHATSAPP)    -> ["213770650387","213669174617"]
```

Les deux derniers cas produisent des destinataires que l'API Meta rejette
(`to` doit être au format international sans `+`). L'envoi échoue,
`sendWhatsApp` renvoie `{ ok:false, sent:0, total:2 }`, la route **répond 201**
au client (volontaire : la notification ne doit jamais bloquer une commande) et
ne laisse qu'un `console.warn` — invisible sur Vercel sans aller chercher les
logs de fonction.

**Conséquence.** Perte totale du canal d'alerte principal du maître (P19/P20),
sans aucun signal côté interface. Le comptoir découvre les commandes en retard,
ou pas. Le défaut est d'autant plus coûteux qu'il est déclenché par une ligne de
configuration **conforme à la documentation**.

**Correction proposée.**

1. Normaliser chaque destinataire avec la règle partagée : passer par
   `waNumber()` (ou `phoneLogic.js`, canonique depuis le lot 6.2) et **rejeter**
   un numéro qui ne se normalise pas, plutôt que de l'envoyer tel quel ;
2. si aucun destinataire valide ne reste après normalisation, traiter le cas
   comme `no_recipient` (déjà géré) et le **journaliser au démarrage** — une
   configuration d'alerte invalide doit se voir au boot, pas à la première
   commande ;
3. exposer l'état dans `/api/health` (champ déjà présent : `whatsapp`) avec la
   liste normalisée, pour que le contrôle post-deploy de
   `docs/DEPLOY-VERCEL.md` §9 le vérifie ;
4. corriger la documentation : donner l'exemple au format international
   (`213770650387`) et dire que le format local est accepté **parce que
   normalisé**, une fois le correctif en place.

---

## 4. Items mineurs

### 🟡 A7 — `writeDb()` renomme sans `fsync` : fenêtre de corruption en cas de coupure

> ✅ **CORRIGÉ (16/09/2026, lot 8.7).** Nouveau module `server/durableWrite.js` :
> tmp → **`fsync` du fichier** → `rename` → **`fsync` du répertoire** (non
> bloquant : `false` si le FS ne le permet pas, jamais d'exception). `writeDb()`
> et la création initiale de la base (`ensure()`) passent par ce chemin — plus
> aucun `writeFileSync` + `renameSync` à la main dans `server/db.js`. Le `fs` est
> **injectable**, donc l'ordre des appels se teste : un `fsync` après le `rename`
> ne garantirait rien, et c'est exactement ce que la neutralisation N28 vérifie
> (22 tests rougissent). Le descripteur est fermé dans un `finally` (pas de fuite
> si le `fsync` lève), et un FS sans `fsyncSync` reste fonctionnel en mode
> dégradé (`synced: false`, dit explicitement).
>
> Vérifié en direct sur le serveur d'aperçu : commande créée (`201`,
> `PS-20260916-0002`) → `store.json` +521 o, JSON valide, commande présente,
> stock 6 → 5, **aucun** `store.json.tmp` ni `store.json.lock` résiduel ;
> annulation par le maître (`200`) → statut `cancelled` au disque, stock rendu à
> 6, toujours aucun résidu.

**Preuve.** `server/db.js:772-786` :

```js
fs.writeFileSync(DB_TMP_FILE, JSON.stringify(clean, null, 2))
fs.renameSync(DB_TMP_FILE, DB_FILE)
```

Le couple tmp + rename est **atomique** (c'était l'objet du lot 3.2), mais il
n'est pas **durable** : sans `fsync` sur le fichier temporaire avant le rename
(ni sur le répertoire après), une coupure d'alimentation peut laisser un
`store.json` renommé dont les blocs de données ne sont pas écrits — fichier vide
ou tronqué au prochain montage. Le dépôt sait déjà le gérer
(`quarantineCorrupt` → `store.json.corrupt-<stamp>`, backups dans
`server/data/backups/`), donc la conséquence est une **perte de données**
potentielle plutôt qu'un crash : la quarantaine isole un fichier vide, la
restauration repart du dernier backup.

**Correction proposée.** Écrire via un descripteur et forcer l'écriture avant le
rename, puis fsync du répertoire :

```js
const fd = fs.openSync(DB_TMP_FILE, 'w')
try { fs.writeSync(fd, json); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
fs.renameSync(DB_TMP_FILE, DB_FILE)
try { const d = fs.openSync(DATA_DIR, 'r'); fs.fsyncSync(d); fs.closeSync(d) } catch { /* non bloquant */ }
```

Coût : un appel système de plus par écriture (quelques ms), sur un chemin déjà
sérialisé par le verrou. À documenter comme contrepartie assumée si le fsync est
jugé trop coûteux — mais alors l'écrire, car le commentaire actuel parle
d'atomicité sans mentionner la durabilité.

### 🟡 A8 — Les dates de « Mes commandes » ignorent la langue choisie

> ✅ **CORRIGÉ (16/09/2026, lot 8.8).** Nouveau module `src/format.js` (sur le
> modèle de `stockLabel.js` au lot 6.1) : **une** table de locales
> (`fr-DZ` / `ar-DZ` / `en-GB`), `localeFor()`, `normalizeLang()`, `money(n,
> lang)`, `third()`, `formatDateTime(value, lang)`. `src/data.js` **ré-exporte**
> `money`/`third` — la même fonction, plus de seconde définition.
>
> **Décision tranchée et écrite dans le code** : la locale **suit la langue de
> l'interface**, pour les dates **et** les prix, suffixe monétaire compris
> (`DA` en français/anglais, `دج` en arabe — les libellés i18n arabes disent
> déjà « دج », `price_u15: 'أقل من 15 000 دج'`). Le français reste la valeur par
> défaut (langue absente/inconnue) : c'est le format historique du magasin, et
> les chemins sans interface (WhatsApp au maître, CSV, scripts) n'ont pas de
> langue à choisir.
>
> `OrdersPage` reçoit désormais `lang` (comme `ProductPage` et `BuilderPage`,
> transmis par `App`) et rend `formatDateTime(o.at, lang)` ; `DeskPage` a perdu
> son `formatAt` maison au profit du module partagé ; `src/notify.js`
> (notification du comptoir) et `buildWaMessage` suivent la langue — plus aucune
> recopie `toLocaleString('fr-DZ')` dans le code rendu.
>
> Rendu réel vérifié dans jsdom : en arabe, la même commande affiche
> `16‏/9‏/2026، 10:30:00 ص` **et** `97.000 دج` au Desk comme dans « Mes
> commandes » ; en français, `16/09/2026 10:30:00` et `97 000 DA` sur les deux
> écrans. Le défaut exact est testé : la chaîne ne contient **plus** le rendu de
> la locale du navigateur (`9/16/2026, 10:30:00 AM`).

**Preuve.** Deux traitements différents pour la même donnée :

- `src/DeskPage.jsx:76` localise selon la langue de l'app :
  ```js
  return d.toLocaleString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB')
  ```
- `src/OrdersPage.jsx:119` ne localise pas :
  ```js
  {o.slot || '—'} · {o.at ? new Date(o.at).toLocaleString() : ''}
  ```

En mode arabe, le Desk affiche des dates en `ar-DZ` et la page « Commandes »
dans la locale du navigateur (souvent `fr-FR` ou `en-US`) — deux formats pour la
même commande, à quelques écrans d'écart. Même famille : `money()`
(`src/data.js:66`) fige `toLocaleString('fr-DZ')` quelle que soit la langue,
donc les prix restent au format français en mode anglais ou arabe.

**Correction proposée.** Un seul module de formatage (comme `stockLabel.js` au
lot 6.1) exportant `formatDateTime(date, lang)` et `money(n, lang)`, avec la
locale dérivée de la langue (`ar-DZ` / `fr-DZ` / `en-GB`), utilisé par DeskPage,
OrdersPage et la vitrine. Décision à trancher explicitement pour `money` : soit
la locale suit la langue, soit elle reste `fr-DZ` **partout** (choix actuel) et
alors DeskPage doit cesser de varier — l'incohérence est le défaut, pas le choix.

### 🟡 A9 — 62 clés de traduction mortes, embarquées dans les trois langues

> ✅ **CORRIGÉ (16/09/2026, lot 8.9).** Les **62 clés** sont supprimées des trois
> langues (188 lignes retirées — 186 chaînes plus une valeur française et une
> anglaise qui couraient sur deux lignes), soit **186 chaînes** et ~5,1 Ko de
> texte : le dictionnaire passe de **538 à 476 clés par langue**, blocs
> rééquilibrés (476/476/476). Aucun groupe n'a été conservé : `docs/ROADMAP-10.md`
> classe le paiement CCP/BaridiMob/carte (« tu as imposé **cash desk only** ») et
> le comparateur (« rejeté / hors focus conversion ») en **hors-scope
> volontaire**, et `docs/GUIDE-DEMO.md` liste sous « Ce qui a été retiré
> (volontairement) » les avatars de profil, le comparateur et le SMS démo — les
> clés décrivaient donc toutes des fonctionnalités **absentes ou refusées**, pas
> des fonctionnalités à venir.
>
> Le pendant code du paiement 3× est parti avec : `third()` (`money/3`, seul
> vestige de l'affichage « 3 × … ») supprimé de `src/format.js` et du ré-export
> `src/data.js`. Les `tags: ['budget'|'combo'|'desk']` du catalogue **restent**
> (données testées par `src/api.smoke.test.js`), mais rien ne les rend : les
> trois clés `tag_*` sont donc supprimées elles aussi.
>
> **Le verrou demandé est en place** : `src/i18n.coverage.test.js` couvre
> désormais le sens **inverse** — toute clé du dictionnaire doit être référencée
> par le corpus (`src/`, `server/`, `api/`, `scripts/`, `e2e/`, `index.html`,
> `vercel.json` ; `i18n.js`, tests, `dist/` et docs exclus) **ou** appartenir à
> une famille dynamique déclarée dont les suffixes proviennent de données
> vivantes (`cat_` ↔ `CATEGORIES`, `line_` ↔ `PART_LINES`, `orderStatus_` ↔
> `ORDER_STATUSES`, `sysState_` ↔ les trois états de `App.jsx`). Trois tests
> supplémentaires vérifient que chaque famille est **réellement construite** par
> le code et qu'elle couvre **exactement** ses données (ni clé en trop, ni clé
> manquante), et un quatrième nomme les groupes retirés pour qu'une réapparition
> soit une régression explicite.
>
> Bundle : `451,02 Ko → 442,75 Ko` (gzip `136,42 → 134,17 Ko`), et `pay3xBadge`,
> `compareTitle`, `authSms`, `themeLight`, `tag_budget`, `dealNoteTwSsd512` n'y
> apparaissent plus — pendant que `orderStatus_new` et `masterPhotosTooHeavy` y
> sont toujours.

**Preuve.** Balayage du corpus (`src/`, `e2e/`, `scripts/`, `index.html`, hors
`i18n.js` et fichiers de test), en excluant les clés construites dynamiquement
(`cat_*` et `line_*` depuis `CATEGORIES`/`PART_LINES`, `sysState_*`,
`orderStatus_*`) : **62 clés** présentes dans `dict.fr`, `dict.en` et `dict.ar`
sans aucune occurrence dans le code — soit **186 chaînes** et ~5,1 Ko de texte
dans le bundle.

Vérification ponctuelle (aucune occurrence hors `i18n.js`) :

```console
$ grep -rn "tag_\|dealNote\|pathParts\|demoHow\|budgetPicks\|notLinked\|pricesInDa" src/*.jsx src/*.js | grep -v i18n.js
(aucune sortie)
```

Répartition :

| Groupe | Clés | Ce que ça raconte |
|---|---|---|
| Authentification SMS | 6 | `authSms`, `authSendCode`, `authVerify`, `authCode`, `authCodeShown`, `authErrorCode` — aucun envoi de code SMS n'existe dans `AuthPanel.jsx` (e-mail + OAuth Google/Meta seulement) |
| Comparateur de produits | 7 | `inCompare`, `compareUpTo`, `addToCompare`, `compareTitle`, `clearAll`, `compareNeed`, `compareN` — aucune fonctionnalité de comparaison |
| Réservation / retrait | 8 | `reservedTitle`, `reservedBody`, `showCode`, `fixMix`, `canStillReserve`, `reserveTitle`, `reserveBody`, `reserveNeedLogin` |
| Paiement | 5 | `pay3xBadge`, `or3x`, `pay3xDesk`, `payCcp`, `payBaridi` — le seul mode de paiement est `cash` (codé côté serveur : `payment: 'cash'`) ; `third()` (`money/3`) existe encore dans `data.js` |
| Thème | 3 | `themeLight`, `themeDark`, `themeSystem` — **rendues mortes par le lot 6.3** : les fonctions ont été supprimées, les clés sont restées |
| Divers | 33 | `advancedSearch`, `thisWeek`, `starConfigs`, `deskLogin`, `authGoogle`, `authDemoNote`, `profileAvatar`, `profileAccent`, `panelsLocalOnly`, `panelsLocalOnlyNote`, `masterDemoProfiles`, `pricesInDa`, `demoHint`, `notLinked`, `budgetPicks`, `combos`, `originDz`, `tag_*` (3), `demoHow*` (3), `path*` (4), `dealNote*` (6) |

**Conséquence.** Poids mort dans le bundle, mais surtout **fausse promesse** :
un traducteur, un relecteur ou un développeur qui ouvre `i18n.js` voit un
comparateur, un paiement 3×/CCP/BaridiMo et une authentification SMS qui
n'existent pas. C'est la même catégorie que le lot 6.3 (code mort du thème),
appliquée au dictionnaire — et le lot 6.3 a laissé ses propres clés derrière lui.

**Correction proposée.** Supprimer les 62 clés × 3 langues, **sauf** décision
contraire explicite pour un groupe (si le paiement CCP/BaridiMo est prévu, la
clé doit rester et être documentée comme « à venir »). Verrouiller par un test :
`src/i18n.coverage.test.js` existe déjà — y ajouter le balayage inverse (toute
clé du dictionnaire doit être référencée, directement ou par un préfixe
dynamique déclaré). Sans ce test, le dictionnaire se re-remplit à chaque
fonctionnalité abandonnée.

### 🟡 A10 — `createProduct` accepte une catégorie et un `kind` libres

> ✅ **CORRIGÉ (16/09/2026, lot 8.10).** `category` est validée contre
> `CATEGORY_IDS` ( = `CATEGORIES` hors `all`) et `kind` contre `KIND_IDS`
> ( = `KINDS` hors `all`), listes posées **une seule fois** dans `src/data.js`
> avec `isKnownCategory()`, `isKnownKind()` et `kindForCategory()`. Refus
> **explicite** comme le demandait la correction proposée : reproduction rejouée
> en direct, `POST /api/master/products {"category":"SSD"}` → **400
> `{"ok":false,"error":"category"}`** et **rien en base** (nombre de produits
> `source: 'extra'` inchangé) ; `{"category":"ssd"}` et `{"category":"all"}`
> → 400 également ; `{"category":"memory"}` → **201**, produit retrouvé dans
> `GET /api/catalog` **et** dans le filtre « memory » (26 produits) **et** dans
> la ligne `ram` de `PART_LINES`.
>
> Deux défauts voisins sont apparus en ouvrant le chantier et sont corrigés du
> même mouvement. (1) `sanitizeProductPatch` validait déjà `category`, mais
> contre `new Set(PRODUCTS.map((p) => p.category))` — un dérivé du catalogue de
> base, pas la liste que le `select` du formulaire propose ; les deux ensembles
> sont identiques aujourd'hui (verrouillé par test) et le patch lit désormais
> `CATEGORIES`. (2) `kind` n'était au patch **ni validé ni appliqué** : absent de
> la liste des champs recopiés par `updateProduct`, donc
> `PUT {"kind":"machine"}` répondait **200 sans rien changer** — même famille que
> le `needs` validé puis jeté du lot 2.6. Il est maintenant validé (`400 kind`
> sur `"bidule"`) **et** appliqué, pour un produit master comme pour un override
> du catalogue, et persisté.
>
> Le serveur posait aussi `kind: 'part'` systématiquement alors que le mode
> local le dérivait de la catégorie et que le catalogue de base classe ses
> réparations en `service` : la règle est partagée (`kindForCategory`), un test
> vérifie la **parité serveur/local sur les 12 catégories** et qu'elle reproduit
> le classement réel du catalogue pour `repair`/`laptop`/`ready`/`accessories`.
> Côté interface, `errToast` mappe les deux refus sur des messages dédiés
> (`masterCategoryInvalid`, `masterKindInvalid`, × 3 langues) — « échec de la
> création » ne disait pas quel champ reprendre.
>
> Tests : `src/lot8Product.test.js` (**37**), suite **761/761** ; dix
> neutralisations N48-N57 vérifiées. **Sept tests existants**
> (`src/p22Audit.test.js`, « P22 bug H ») utilisaient `category: 'ssd'` — l'id
> inexistant que cet item cite nommément — et ont été passés sur un id réel :
> ils portent sur le SKU, pas sur la catégorie. Détail dans
> `docs/PLAN-CORRECTIONS.md` §9, « ✅ Fait — lot 8.10 ».

**Preuve.** `server/masterApi.js:93-136` :

```js
const product = {
  …
  kind: body.kind || 'part',
  category: String(body.category || 'accessories'),
  …
}
```

`category` n'est confrontée ni à `CATEGORIES` (`src/data.js:84`) ni aux
identifiants de `PART_LINES` ; `kind` n'est confronté ni à `KINDS`
(`src/data.js`) ni à une liste fixe. Le nom, le prix, le SKU, `needs`, le nombre
de photos et la longueur des champs texte sont validés (lots 1.9 et 2.6) — ces
deux champs ne le sont pas.

**Conséquence.** Un produit créé avec `category: "SSD"` (majuscules, libellé au
lieu de l'`id`) ou `category: "ssd"` (cet `id` n'existe pas : le catalogue
utilise `memory`) est enregistré, visible dans la page master, mais :

- il n'apparaît dans **aucun** filtre de catégorie de la vitrine ni dans aucune
  ligne de `PART_LINES` (toutes les fonctions `match` testent
  `p.category === 'cpu' | 'memory' | …`) → produit invendable par navigation,
  trouvable seulement par recherche texte ;
- son libellé de catégorie retombe sur l'`id` brut (le repli `labelOr` du lot
  5.6 empêche l'affichage d'une clé `cat_ssd`, mais affiche `ssd`) ;
- le Builder ne le propose jamais (`slot.pick` filtre par catégorie).

**Correction proposée.** Valider contre les listes existantes et **refuser**
(`400 { error: 'category' }`) plutôt que de corriger en silence — un refus dit
au maître quoi saisir, une correction muette produit un produit mal classé.
Liste des catégories acceptées : `CATEGORIES` hors `all`. Pour `kind` :
`['part','accessory','machine','service']` (les `id` de `KINDS`). Le formulaire
master propose déjà des `select` : le serveur doit vérifier ce que le client
prétend avoir sélectionné (même principe que `wilaya`/`slot` au lot 1.9).

---

## 5. Ce qui a été vérifié et n'est **pas** un défaut

Publié pour délimiter la portée de l'audit — ces points ont été contrôlés, ils
tiennent :

| Point contrôlé | Verdict |
|---|---|
| Traversée de chemin sur `GET /api/upload-file` | **Sain** : `path.basename()` + rejet de `..` (`server/index.js:720-721`) |
| Écriture hors répertoire via l'id produit (photos) | **Sain** : id **généré par le serveur** (`newId('sku')`, `server/index.js:991`), et `safeId` ne garde que `[A-Za-z0-9_-]` (`server/masterApi.js:284`, P18) |
| Injection de formule dans l'export CSV | **Sain** : neutralisation `= + - @` (lot 1.8) |
| Contournement du rate-limit par `X-Forwarded-For` | **Sain** : dernier saut seulement derrière proxy de confiance (P13/S4) |
| Authentification du socket Desk | **Saine** : premier message, timeout, borne `MAX_PENDING`, heartbeat, codes de fermeture applicatifs (R14/B15) |
| Fuite de jeton de session sur disque | **Saine** : indexation par `sha256(token)` (durcissement de session) |
| Écouteurs DOM sans nettoyage | **Sains** : les 5 sites (`App.jsx`, `AuthPanel.jsx`, `ContactPicker.jsx`) retirent leurs écouteurs dans le cleanup |
| Atomicité de l'écriture de base | **Atome** (tmp + rename) — la durabilité est l'objet de A7 |
| Codes de commande dupliqués | **Sain** : séquence par max et non par comptage (F3/F4), partagé client/serveur |
| En-têtes CORS divergents | **Sain** depuis le lot 6.8 : un seul jeu, propagé par toutes les routes |
| Encadrement iframe | **Assumé et documenté** depuis le lot 5.10 (en-têtes stricts + `docs/DEPLOY-VERCEL.md`) |
| Clés i18n utilisées mais manquantes | **Aucune** : les 347 clés statiques du code existent dans les 3 langues (A9 porte sur l'inverse — des clés présentes et inutilisées) |

---

## 6. Méthode et limites

**Méthode.** Lecture complète des modules non couverts par les deux rapports
(`api/index.js`, `vercel.json`, `index.html`, `server/notify.js`,
`server/deskSocket.js`, `server/rateLimit.js`, `server/catalog.js`,
`server/masterApi.js`, `src/photoCompress.js`, `src/OrdersPage.jsx`,
`src/ProfilePage.jsx`, `src/AuthPanel.jsx`, `src/ContactPicker.jsx`), balayage
mécanique du reste (i18n : usage des clés dans les deux sens ; écouteurs ;
`toLocale*` ; écritures de fichiers ; garde de taille), et **reproduction
exécutée** pour chaque affirmation qui pouvait l'être : deux reproductions en
direct contre une instance réelle (A1), trois en appel direct des fonctions de
production (A2, A6), les autres par preuve de code avec fichier:ligne.

**Limites assumées.**

- Les tests Playwright (`e2e/smoke.spec.js`) n'ont **pas** pu être exécutés ici :
  le CDN `cdn.playwright.dev` est injoignable depuis cet environnement
  (`ECONNRESET`), donc aucun navigateur n'est installé. Le parcours navigateur
  réel reste à valider chez l'exploitant.
- Le comportement Vercel de A4/A5 est déduit de la limite plateforme documentée
  (4,5 Mo, requête et réponse) et du fait que `config.api.bodyParser` est une
  configuration de routes Next.js ; il n'a pas pu être mesuré sur un déploiement
  réel depuis cet environnement. La reproduction à faire au déploiement est
  donnée dans le lot 8.
- Les bases de données réelles (Neon/Postgres) n'ont pas été exercées : A2 est
  démontré sur le driver fichier et sur la fonction `placeOrder`, qui est
  **partagée** par les deux drivers — le défaut est donc indépendant du driver,
  mais le chemin de purge proposé (`normalizeDb`) doit être vérifié aussi côté
  Neon.
- Aucun test de charge ni d'usage prolongé (fuite mémoire sur plusieurs jours)
  n'a été mené.

**Ce que ce document n'est pas.** Il ne modifie ni les deux rapports d'audit, ni
les lots déjà livrés. Aucun correctif n'est appliqué ici : les solutions sont
proposées, chiffrées en taille dans `docs/PLAN-CORRECTIONS.md` §7 (lot 8), et
chacune devra être livrée **avec son test de régression** — la règle des lots
précédents s'applique telle quelle, y compris la vérification par neutralisation
(le test doit rougir quand le correctif est retiré).
