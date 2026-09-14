# Audit P22 — toutes les pages, tous les boutons

**Date :** 2026-09-14 · **Base :** `bb44ca7` · **Résultat :** `3ed8ae2`

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

| Page | Boutons | Cliqués | Ignorés | Erreurs |
|---|---|---|---|---|
| `shop` | 501 | 495 | 6 | 0 |
| `search` | 78 | 72 | 6 | 0 |
| `builder` | 90 | 84 | 6 | 0 |
| `about` | 21 | 15 | 6 | 0 |
| `orders` | 22 | 16 | 6 | 0 |
| `help` | 27 | 21 | 6 | 0 |
| `desk` | 33 | 27 | 6 | 0 |
| `master` | 477 | 471 | 6 | 0 |
| `profile` | 30 | 24 | 6 | 0 |
| `warranty` | 26 | 20 | 6 | 0 |
| `privacy` | 26 | 20 | 6 | 0 |
| `terms` | 26 | 20 | 6 | 0 |
| `product` | 43 | 37 | 6 | 0 |
| **Total** | **1 400** | **1 322** | 78 | **0** |

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

## 2. Bugs corrigés (commit `3ed8ae2`)

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

**Portée exacte :** le mode API n'était **pas** touché — `POST
/api/master/products` génère son propre identifiant (`sku-mu0w…`). Vérifié en
direct : trois créations ont donné trois ids distincts. Le défaut était donc
limité au mode hors-ligne de MasterPage.

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

## 3. Ce qui a été vérifié et trouvé sain

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

## 4. Trouvé mais non corrigé (à trancher)

### E — `navProfile` est une clé morte, et le bouton profil n'a pas de libellé stable

`App.jsx:969` affiche `{user.name}` sur le bouton qui ouvre la page profil. La
clé `navProfile` existe dans les 3 langues (`'ملفي'` / `'Mon profil'` /
`'My profile'`) et n'est **jamais** rendue — grep : référencée uniquement par
le harnais d'audit.

Conséquences concrètes : le libellé du bouton dépend du nom saisi par
l'utilisateur (un compte nommé « A » donne un bouton d'un caractère), et un
lecteur d'écran n'a aucun moyen de savoir que ce bouton ouvre le profil.
`navAccount` est morte pour la même raison.

Non corrigé : choisir entre « afficher `t('navProfile')` » et « garder le nom
mais ajouter `title`/`aria-label` » est une décision de design, pas un défaut
technique.

### F — `STORE_LINKS` contient du français en dur

`src/data.js:57` : `{ id: 'maps', label: 'Google Maps', sub: 'Les Castors, Oran' }`.
Le `sub` reste français en interface arabe et anglaise. Les autres entrées
(`Instagram`, `Facebook`, `WhatsApp`) sont des noms de marque, légitimement non
traduits — seule celle-ci est concernée.

### G — Deux machines à états divergentes

Le client (`canTransition`, `src/orderLogic.js`) interdit `preparing → new` et
`ready → preparing`. Le serveur (`ORDER_TRANSITIONS`, `server/catalog.js:205`)
les autorise — vérifié en direct : `preparing → new` renvoie 200.

Comme `canTransition` est du code mort (voir D), aucune interface ne propose
aujourd'hui ces retours en arrière. Mais si elle était un jour branchée sur le
Desk, elle masquerait des transitions que le backend accepte. À aligner au
moment de brancher.

---

## 5. Portes de validation

| Contrôle | Résultat |
|---|---|
| `npm test` | **265/265** (250 + 15 nouveaux) |
| `npm run build` | ✓ 111 modules, 423,59 kB / 127,44 kB gzip |
| `npm run smoke` | **SMOKE OK** — health, catalog 222, login, order, me-orders, login-master, oauth-start, front 200, robots |
| `src/p22Audit.test.js` | 15/15, dont `POST /api/orders` réel sur les trois écritures internationales |

Le test du bug A démarre un **vrai serveur** (`http.createServer(handler)`) et
passe par `server/index.js` — le chemin modifié est bien celui exécuté.
