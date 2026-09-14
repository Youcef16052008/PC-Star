# Audit P22 — toutes les pages, tous les boutons

**Date :** 2026-09-14 · **Base :** `bb44ca7` · **Résultat :** bugs A–D puis E–G

Demande : *« analyse le projet ligne par ligne and find bugs by testing all
bouttons and pages »*.

Deux passes complémentaires, parce qu'aucune des deux ne suffit seule :

1. **Passe dynamique** — un harnais jsdom monte l'application réelle, ouvre
   chaque page et clique **chaque bouton non désactivé** en capturant toute
   exception (`console.error`, `window.onerror`, rejets de promesse).
2. **Passe statique** — lecture ligne à ligne des modules de logique, avec une
   sonde runtime pour chaque soupçon.

Le crawl n'a trouvé **aucune** erreur applicative. Les 4 bugs livrés viennent
tous de la passe statique. C'est le résultat le plus important de cet audit :
sur ce projet, cliquer partout ne casse rien — les défauts restants sont dans
des chemins qu'aucun clic ne traverse.

---

## 1. Couverture du crawl

Harnais : `scripts/audit-crawl.mjs` (jsdom + loader JSX esbuild).

```
node --experimental-loader ./scripts/jsx-test-loader.mjs --no-warnings \
     scripts/audit-crawl.mjs fr <page> [libellé]
```

| Page | Boutons | Cliqués | Ignorés | Erreurs (ar / fr / en) |
|---|---|---|---|---|
| `shop` | 501 | 495 | 6 | 0 / 0 / 0 |
| `search` | 82 | 76 | 6 | 0 / 0 / 0 |
| `builder` | 94 | 88 | 6 | 0 / 0 / 0 |
| `about` | 25 | 19 | 6 | 0 / 0 / 0 |
| `orders` | 26 | 20 | 6 | 0 / 0 / 0 |
| `help` | 27 | 21 | 6 | 0 / 0 / 0 |
| `desk` | 37 | 31 | 6 | 0 / 0 / 0 |
| `master` | 477 | 471 | 6 | 0 / 0 / 0 |
| `profile` | 30 | 24 | 6 | 0 / 0 / 0 |
| `warranty` | 26 | 20 | 6 | 0 / 0 / 0 |
| `privacy` | 26 | 20 | 6 | 0 / 0 / 0 |
| `terms` | 26 | 20 | 6 | 0 / 0 / 0 |
| `product` | 43 | 37 | 6 | 0 / 0 / 0 |
| **Total / langue** | **1 420** | **1 342** | 78 | **0** |
| **3 langues** | **4 260** | **4 026** | 234 | **0** |

**39 exécutions** (13 pages × 3 langues), un montage par page, **aucune erreur
applicative**. Les comptes de boutons sont **identiques dans les trois langues**,
ce qui est en soi un contrôle : une interface qui perdrait un bouton en arabe
se verrait ici.

Les 13 rendus conditionnels de `App.jsx` sont couverts. Les 6 boutons ignorés
par page sont les sélecteurs de langue (FR/EN/ع) et de thème (◐☀☾) : les
cliquer change l'état global et fausserait le reste du balayage.

> Les cinq premiers chiffres publiés pour `search`/`builder`/`about`/`orders`/
> `desk` (78/90/21/22/33) provenaient d'une mesure prise sur un **état de store
> différent**. Re-mesurés sur le même store que l'arabe et l'anglais, le
> français donne exactement 82/94/25/26/37. L'écart n'était donc pas lié à la
> langue — d'où l'obligation de comparer des mesures prises dans le même état.

Les 13 rendus conditionnels de `App.jsx` sont couverts. Les 6 boutons ignorés
par page sont les sélecteurs de langue (FR/EN/ع) et de thème (◐☀☾) : les
cliquer change l'état global et fausserait le reste du balayage.

**Trois contraintes de harnais à retenir** (elles ont coûté plusieurs
itérations) :

- **Un montage par processus.** Les bootstraps de session des instances
  précédentes réinitialisaient le token et masquaient les pages réservées au
  maître (`help`, `desk`, `master`, `profile` restaient introuvables).
- **Le bouton « profil » affiche `user.name`, pas `t('navProfile')`** — voir
  bug E ci-dessous.
- Les seules erreurs vues étaient des `Not implemented: navigation to another
  Document` de jsdom sur les boutons OAuth : limitation du harnais, pas un bug.

---

## 2. Bugs A à D corrigés

### A — Le numéro au format international `00` était refusé

**Symptôme utilisateur :** un client dicte son numéro à l'international
(`00 213 550 123 456`, la forme la plus courante) et le formulaire lui répond
« numéro invalide ». Le même numéro écrit `+213 550 123 456` passait.

**Cause :** `normalizePhone()` retirait `213` mais pas le préfixe de sortie
`00`. `src/shopStore.js:27` et `server/index.js:175` dupliquaient exactement la
même logique — donc exactement le même trou.

**Mesuré avant :**

```
« 0550123456 »         → HTTP 201
« 00213550123456 »     → HTTP 400  {"ok":false,"error":"phone"}
« +213 550 123 456 »   → HTTP 201
« 00 213 550 123 456 » → HTTP 400  {"ok":false,"error":"phone"}
```

**Mesuré après :**

```
« 0550123456 »         → HTTP 201  enregistré phone=0550123456 carrier=ooredoo
« 00213550123456 »     → HTTP 201  enregistré phone=0550123456 carrier=ooredoo
« +213 550 123 456 »   → HTTP 201  enregistré phone=0550123456 carrier=ooredoo
« 00 213 550 123 456 » → HTTP 201  enregistré phone=0550123456 carrier=ooredoo
« 055012345 »          → HTTP 400  error=phone        ← toujours refusé
```

**Ce qui a trahi le bug :** `waNumber()` (`src/orderLogic.js:79`), corrigée en
P14, retirait déjà `00`. La validation et la génération du lien WhatsApp
n'étaient donc pas d'accord sur ce qu'est un numéro algérien valide.

**Correctif :** `if (d.startsWith('00')) d = d.slice(2)` avant la gestion du
`213`. Sans risque : un mobile algérien commence par 05/06/07, jamais par `00`.
Côté serveur, `isDzPhone` délègue maintenant à `normalizePhone` — une seule
règle au lieu de deux copies.

### B — Collision de SKU en mode local

**Cause :** `skuSlug()` ne conserve que 8 caractères utiles du nom, et
`addProduct()` ne vérifiait aucune unicité.

**Mesuré avant :** trois produits ajoutés depuis MasterPage (mode hors-ligne)

```
Samsung SSD 870 EVO 500Go  →  PS-SAMSUNGS
Samsung SSD 980 PRO 1To    →  PS-SAMSUNGS
Samsung SSD 860 QVO 2To    →  PS-SAMSUNGS
```

**Après :** `PS-SAMSUNGS`, `PS-SAMSUNGS-2`, `PS-SAMSUNGS-3`. Un SKU saisi à la
main n'est jamais réécrit ni suffixé.

**Portée exacte — corrigée après coup.** J'avais d'abord écrit que « le mode
API n'était pas touché ». C'était vrai pour les SKU **générés** (le serveur
fabrique son propre id `sku-mu0w…`), mais faux pour les SKU **saisis** : c'est
le bug H ci-dessous.

### C — Perte de stock dans `applyStockRestore`

**Cause :** le décrément comptait `Math.max(1, Math.floor(Number(qty) || 1))`,
la restauration `Math.max(0, Math.floor(Number(qty) || 0))`. Une ligne **sans
`qty`** retirait 1 unité et n'en rendait aucune.

**Mesuré avant :** stock 5 → commande → 4 → annulation → **4**.

**Après :** 5 → 4 → **5**. Les deux fonctions partagent désormais `lineQty()`.

**Portée exacte :** `applyStockDecrement` et `applyStockRestore` sont exportées
mais n'ont **aucun appelant** dans `src/` ni `server/` (vérifié par grep — elles
n'apparaissent que dans leur propre définition et leur test). Le défaut était
**latent**, pas actif : le vrai chemin serveur (`placeOrder` → `cancelOrder`
dans `server/catalog.js`) normalise `qty` à `Math.max(1, …)` avant de le
stocker, donc il rend toujours la bonne quantité. Contrôlé en direct :
`ready → picked → cancelled` refusé (`400 {"error":"picked"}`), stock intact.

### D — Branche morte dans `canTransition`

`return to === 'cancelled'` dans une branche où `to === 'cancelled'` avait déjà
renvoyé `true` deux lignes plus haut : la condition ne pouvait rendre que
`false`. Réécrit `return false`, avec le commentaire qui explique pourquoi.

**Portée :** `canTransition` n'est appelée **que par son propre test** (grep :
`src/orderLogic.test.js` uniquement). Le Desk affiche ses boutons de statut par
tests `st === 'new'` etc., pas via cette fonction.

---



---

## 2 bis. Bug H — un SKU déjà pris était accepté (trouvé en re-vérifiant B)

Le correctif B ne couvrait que les SKU **générés**. Un SKU **saisi à la main**
n'était confronté à rien, ni côté client ni côté serveur.

**Mesuré en direct avant correctif :**

```
SKU 100-100000910WOF déjà porté par cpu-7800x3d dans le catalogue
POST /api/master/products  essai 1 → HTTP 201  sku=100-100000910WOF
POST /api/master/products  essai 2 → HTTP 201  sku=100-100000910WOF
catalogue public → 3 produits portant ce SKU
```

Le SKU identifie une référence sur l'étiquette, dans l'export CSV du comptoir
et dans le dossier de photos : un doublon rend la fiche ambiguë.

**Cause :** `server/masterApi.js` faisait `sku: String(body.sku || finalId).trim()`
sans aucun contrôle, et `addProduct()` côté client ne vérifiait que les
collisions entre SKU générés.

**Correctif :** les deux chemins refusent maintenant un SKU déjà porté par le
catalogue de base ou par un produit du master (`400 {"error":"sku_taken"}`), et
`uniqueSku()` évite aussi le catalogue de base. Un message dédié
(`masterSkuTaken`, ajouté dans les 3 langues) remplace le vague « échec de
création » dans MasterPage.

**Mesuré après, en direct :**

```
SKU du catalogue de base : HTTP 400  {"ok":false,"error":"sku_taken"}
SKU libre                : HTTP 201
le même une 2e fois      : HTTP 400  {"ok":false,"error":"sku_taken"}
occurrences du SKU de base dans le catalogue : 1
```

---

## 3. Trois points trouvés, d'abord laissés ouverts, puis corrigés

Signalés dans un premier temps comme des « décisions de design », ils ont
finalement été traités — chacun avait un correctif non ambigu qui ne change
aucune décision produit.

### E — Le bouton profil n'avait pas de nom accessible

`App.jsx` affichait `{user.name}` seul sur le bouton qui ouvre le profil. La
clé `navProfile` existait dans les 3 langues (`'ملفي'` / `'Mon profil'` /
`'My profile'`) sans jamais être rendue — grep : référencée uniquement par le
harnais d'audit. `navAccount` était morte pour la même raison.

Conséquences mesurées : un compte nommé « A » donnait un bouton d'un caractère,
et un lecteur d'écran n'avait aucun moyen de savoir que ce bouton ouvre le
profil.

**Correctif :** le design ne bouge pas (le nom reste affiché), mais le bouton
porte `title={t('navProfile')}` et `aria-label={`${t('navProfile')} — ${user.name}`}`.
L'`aria-label` **contient le texte visible**, comme l'exige WCAG 2.5.3
(« label in name ») — sinon la commande vocale « cliquer sur PC Star Desk »
ne peut pas le cibler. `navProfile` n'est plus une clé morte, et `navAccount`
— morte pour la même raison, sans aucun emplacement où l'afficher — a été
supprimée des 3 blocs.

### F — Du français en dur dans l'interface arabe

`src/data.js` : `{ id: 'maps', label: 'Google Maps', sub: 'Les Castors, Oran' }`.
Le sous-titre du bouton Google Maps restait français en interface arabe et
anglaise. Les autres entrées de `STORE_LINKS` (`Instagram`, `Facebook`,
`WhatsApp`) sont des noms de marque, légitimement non traduits — seule
celle-ci était concernée.

**Correctif :** `subKey: 'storeMapSub'` + rendu `l.subKey ? t(l.subKey) : l.sub`.
La clé est ajoutée dans les 3 langues ; l'arabe reprend la formule déjà
employée partout ailleurs dans le fichier (`storeAbout`, `legalTermsP1`,
`seoDescription`) : **`الماكري لكاستور، وهران`**. Le rendu est vérifié dans le
DOM pour les trois langues, et un test asserts que l'arabe ne contient plus la
chaîne française et contient bien des caractères arabes.

i18n : 481 → **482 clés × 3 langues, symétriques** (0 manquante, 0 en trop)
après ajout de `storeMapSub` et `masterSkuTaken`, et suppression de
`navAccount`.

### G — Deux machines à états divergentes

Le client (`canTransition`, `src/orderLogic.js`) interdisait `preparing → new`
et `ready → preparing`. Le serveur (`ORDER_TRANSITIONS`, `server/catalog.js`)
les autorisait — vérifié en direct : HTTP 200.

Comme `canTransition` n'avait aucun appelant hors tests, rien ne se voyait.
Mais brancher un jour le Desk sur cette fonction aurait masqué des transitions
que le backend accepte.

**Correctif :** la table vit maintenant dans `src/orderLogic.js`
(`export const ORDER_TRANSITIONS`) et `server/catalog.js` l'**importe**. Une
seule définition : la divergence n'est plus possible, y compris à l'avenir.
Un test croise les deux implémentations sur les 6 statuts d'origine × 5 statuts
cibles et échoue à la première divergence.

**Re-vérifié en direct sur le serveur redémarré :**

```
new → preparing : HTTP 200      ready  → picked    : HTTP 200
preparing → new : HTTP 200      picked → cancelled : HTTP 400 {"error":"picked"}
```

---

## 4. Ce qui a été vérifié et trouvé sain

Ces pistes ont été explorées et **réfutées** — notées pour ne pas être
rejouées :

- **Catalogue (223 produits)** : 0 id en double, 0 SKU en double, 0 `related`
  orphelin, 0 auto-référence, 0 nom vide, 0 produit sans photo, 0 `rating` hors
  0–5. Les deux alertes initiales étaient fausses : `desk-info` à 0 DA est un
  service gratuit assumé (`short: "Gratuit · …"`), et `memory` (25 produits)
  est une catégorie légitime de la ligne « RAM & SSD ».
- **Commande d'un produit inexistant** : `priceOf` renvoie `null` → prix 0,
  mais `liveStockOf` renvoie 0 → `409 {"error":"stock"}`. Pas de produit
  gratuit. Aucun endpoint ne permet de poser un stock sur un id arbitraire
  (`PUT /api/master/stock` → 404).
- **Transitions de statut serveur** : `new→preparing→new→ready→picked` testées
  en direct, `picked→cancelled` refusé (`400 {"error":"picked"}`), état
  terminal respecté.
- **i18n** : 0 clé utilisée mais absente (une clé manquante s'afficherait en
  brut). Les clés `compat*` ne sont pas mortes — elles sont rendues par
  `t(w.key, w.vars)` dans `BuilderPage.jsx:405`, que la détection par littéral
  ne voyait pas.
- **`waNumber`** : gère correctement `00`, `213`, `+` et le format local.

---

## 4 bis. Les 4 items « ouverts par conception » d'un audit antérieur

Restés ouverts depuis un audit précédent. Trois sur quatre sont maintenant
traités ; le quatrième était déjà réglé sans que la liste soit à jour.

### Item 1 — Les comptes seedés restaient non salés indéfiniment ✅ corrigé

`verifyPass` savait déjà lire `scrypt$salt$hash` **et** le sha256 non salé de
`hashPassLegacy`, mais rien ne remplaçait ce dernier. Le master et les 3 comptes
démo gardaient donc un `sha256(pcstar:<mot de passe>)` sans sel pour toujours :
un dump de `store.json` — ou d'un backup dans `server/data/backups/` — exposait
des hashes cassables par table précalculée.

**Correctif :** re-salage en scrypt au moment de la connexion réussie, seul
instant où le mot de passe en clair est en main. Invisible pour l'utilisateur.

**Mesuré :**

```
avant connexion  : 64 caractères (sha256 hex nu, donc pas de sel)
après connexion  : scrypt$cd4d73a6dc625e8c$…  (format scrypt$salt$hash)
deux comptes     : sels distincts
2e connexion     : hash inchangé (pas de réécriture inutile)
mauvais mot de passe : 401 {"error":"auth"}
```

### Item 2 — Aucune Content-Security-Policy ✅ corrigé

Aucune CSP n'était posée, ni sur l'application ni sur l'API.

Le frein était le bootstrap de thème : un `<script>` inline dans `index.html`,
donc incompatible avec `script-src 'self'`. Il est sorti dans
`public/theme-boot.js` — un script classique (ni `async` ni `defer`) dans
`<head>` s'exécute toujours avant le premier paint, l'anti-flash est conservé.
**Résultat mesuré : 0 script inline dans `dist/index.html`.**

```
script-src 'self'                      ← sans 'unsafe-inline'
style-src  'self' 'unsafe-inline' https://fonts.googleapis.com
font-src   'self' https://fonts.gstatic.com
img-src    'self' data: blob:
connect-src 'self' ws: wss:            ← WebSocket du Desk
frame-src  https://maps.google.com https://www.google.com
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'
```

`'unsafe-inline'` reste nécessaire pour les **styles** (22 attributs
`style={{…}}` React) — l'essentiel de la protection XSS porte sur les scripts,
et aucun `unsafe-eval` n'est autorisé.

**Choix assumé :** la CSP est dans `vercel.json` (production) et sur `send()`
côté API, **pas** dans `index.html`. En développement Vite injecte un
`<script type="module">` inline pour React Refresh — vérifié sur le front dev —
et une CSP stricte en `<meta>` aurait cassé le HMR.

**Piège évité :** `theme-boot.js` a été ajouté au lookahead du fallback SPA. Un
`||` s'y était glissé au passage, créant une alternative vide qui matcherait
toutes les routes : plus aucune page n'aurait été réécrite vers `index.html`.
Le lookahead est maintenant testé route par route (`/boutique` → SPA,
`/theme-boot.js` et `/api/health` → servis tels quels).

### Item 3 — `TRUST_PROXY` absent sur Vercel ⚪ déjà traité, finding périmé

`server/rateLimit.js:54` :

```js
export function trustProxy() {
  return process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL)
}
```

`clientIp()` lit le **dernier** saut de `x-forwarded-for` (celui que le proxy
ajoute, pas celui que le client écrit). Sur Vercel, `process.env.VERCEL` suffit
— rien à faire. La liste des items ouverts n'était simplement plus à jour.

### Item 4 — Token OAuth en query 🔵 laissé en l'état, risque déjà mitigé

`server/index.js` redirige avec `/?oauth_token=…`. Deux éléments rendent le
risque résiduel faible :

- `safeReturnUrl()` re-valide la cible au moment de la redirection — jamais de
  token envoyé vers une origine tierce ;
- `src/App.jsx:406` **supprime** `oauth_token` et `oauth_provider` de l'URL via
  `history.replaceState` dès la lecture : le token ne reste pas dans la barre
  d'adresse ni dans l'historique de l'onglet.

Le remplacer par un code à usage unique échangerait un risque déjà mitigé contre
un aller-retour réseau supplémentaire et un état serveur à faire expirer. Non
fait : à reprendre si l'app passe en multi-origines.

---

## 5. Portes de validation

| Contrôle | Résultat |
|---|---|
| `npm test` | **296/296** (250 → +15 A–D → +13 E–G → +7 H → +10 items 1–2) |
| `npm run build` | ✓ 111 modules, 424,35 kB / 127,69 kB gzip |
| `npm run smoke` | **SMOKE OK** — health, catalog 222, login, order, me-orders, login-master, oauth-start, front 200, robots |
| Crawl 3 langues | 39 exécutions, 4 026 clics, **0 erreur** |
| `src/p22Audit.test.js` | 33/33 — `POST /api/orders` et `POST /api/master/products` réels, migration scrypt observée dans le store, en-tête CSP lu sur une vraie réponse |
| `src/p22UI.test.js` | 13/13 — `aria-label` du bouton profil, sous-titre Maps traduit en ar/fr/en, table de transitions partagée |

Le test du bug A démarre un **vrai serveur** (`http.createServer(handler)`) et
passe par `server/index.js`. Le test du bug G appelle le **vrai**
`setOrderStatus` de `server/catalog.js` et le compare à `canTransition`. Les
tests E et F montent le **vrai** `App.jsx` en jsdom et naviguent jusqu'à la
page « À propos » — le chemin modifié est bien celui exécuté.

**Piège de harnais à retenir :** `src/App.jsx:59` capture
`const storage = typeof localStorage !== 'undefined' ? localStorage : null` à
l'import du **module**. Les globaux jsdom doivent donc être posés **avant** le
`await import('./App.jsx')` ; un hook `before()` s'exécute trop tard et
`storage` vaut `null` — l'app retombe alors sur l'arabe et ne seed aucun
utilisateur.
