# Vérification du second rapport d'audit — 15/09/2026

> **Journal daté — ses chiffres sont ceux du jour, pas l'état du dépôt.** Ce
> document est une trace : on ne le réécrit pas quand il est contredit plus tard,
> parce qu'effacer une conclusion fausse efface aussi la raison pour laquelle
> elle était fausse.
> Au fil des lots, plusieurs nombres et commandes ci-dessous ont été
> dépassés. L'état mesuré d'aujourd'hui est dans
> [`../README.md`](../README.md) (« État mesuré »), la suite des sessions
> dans [`BUGS-AND-FIXES.md`](BUGS-AND-FIXES.md). Les docs **exécutables** (guides,
> recettes, prompts d'agent, `docs/README.md`) ont, elles, été corrigées — c'est
> `src/p3DocsAging.test.js` qui verrouille les deux régimes.


**Objet :** vérification du rapport « consolidé final » (52 items numérotés +
22 findings lettrés + 3 items d'environnement #53–#55).
**Base :** `fdbd778`, branche `arena/01a0a55c-pc-star`, dépôt non modifié.
**Lecture préalable :** `docs/VERIFICATION-RAPPORT-AUDIT.md` (vérification du
premier rapport, même socle d'items 1–52).

---

## 1. Verdict global

| Verdict | Nombre |
|---|---|
| ✅ Vraie | **63** |
| 🟡 Partielle | **9** |
| ❌ Fausse | **5** |
| **Total** | **77** |

Les items **1 à 52 sont identiques au premier rapport** — mêmes références,
mêmes conclusions. Ils ont déjà été vérifiés un par un dans
`docs/VERIFICATION-RAPPORT-AUDIT.md` ; les verdicts sont reportés en §3 sans
re-test, sauf quand ce second rapport formule l'item **différemment** (cinq cas,
signalés en §2.3).

Les **22 findings lettrés** sont également repris du premier rapport, à trois
exceptions : ce rapport-ci **omet W, Y et Z** (il les remplace par #55 pour W)
et **ajoute P'**, qui n'était qu'une confirmation de #8 dans le premier.

La nouveauté réelle est le bloc **#53–#55** (« bugs d'environnement / CI »).
C'est là que ce rapport diverge le plus de la réalité observable.

---

## 2. Les affirmations propres à ce rapport (#53–#55)

### ❌ #53 — « `npm test` échoue : 55 tests KO sur cette machine »

**Faux dans cet environnement, reproduit à l'inverse.**

```
npm test
# tests 315
# suites 97
# pass 315
# fail 0
```

Les **trois sous-affirmations** sont fausses ici :

| Sous-affirmation | Vérification |
|---|---|
| « `jsdom` absent de `node_modules` alors qu'il est en devDependency » | **Faux.** `node_modules/jsdom/package.json` présent, **jsdom 30.0.1** — conforme à `package.json` (`"jsdom": "^30.0.1"`). |
| « le `.env` local (vraie `DATABASE_URL` Neon) fuit dans les tests serveur » | **Faux.** `ls -la .env` → **aucun `.env` à la racine**. Seul `.env.example` est présent (et `.gitignore:108-110` couvre `**/.env`). Le serveur ne charge d'ailleurs aucun `.env` lui-même : `server/env.js` lit `process.env` au démarrage. |
| « `orderLogic.test.js` isolé passe 42/42 » | **Vrai, mais non discriminant** : la suite entière passe, pas seulement celle-là. Reproduit : `42 tests / 42 pass / 0 fail`. |

Les fichiers de test cités comme échouant (`BuilderPage.test.js`,
`DeskPage.test.js`, `p22UI.test.js`, `p22LazyStorage.test.js`,
`reportP17.test.js`) **passent tous** ici — ils sont d'ailleurs tous listés
dans le script `test` de `package.json`.

### 🟡 #53 (fond) — « la suite ne neutralise pas `DATABASE_URL` » → **VRAI, et reproduit**

C'est le point solide caché sous un symptôme erroné. `src/apiServer.test.js:10`
isole la base fichier :

```js
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-api-'))
process.env.PCSTAR_DATA_DIR = dir
```

…mais **ne touche jamais `DATABASE_URL`**. Or `server/db.js` bifurque sur cette
variable (`updateDbAsync` / `readDbSafe`). J'ai donc injecté une `DATABASE_URL`
Neon injoignable et relancé la suite :

```
DATABASE_URL="postgresql://user:pass@ep-dead-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require" \
  node --import ./scripts/jsx-test-register.mjs --test src/apiServer.test.js

# tests 23 · # pass 6 · # fail 17
NeonDbError: Error connecting to database: TypeError: fetch failed
  [cause]: Error: Client network socket disconnected before secure TLS connection was established
```

**17 échecs** — le rapport annonçait « 17+ tests », ce chiffre est **exact**.
Deux précisions à sa décharge et à sa charge :

- le nombre « 55 tests KO » ne correspond à rien de reproductible ici (17 sur
  `apiServer.test.js`, 0 sur le reste) ;
- le message cité, `Connection terminated unexpectedly`, **n'est pas** celui
  observé — l'erreur réelle est `TypeError: fetch failed` avec cause
  `Client network socket disconnected before secure TLS connection was
  established`. Le rapport cite probablement un cas où l'hôte Neon résolvait
  vraiment.

**Conclusion :** le défaut d'isolation est **réel et doit être corrigé** (un
développeur avec un `.env` Neon mort dans son shell obtient une suite rouge pour
de mauvaises raisons). Le symptôme décrit, lui, appartient à une machine qui
n'est pas celle-ci.

### ❌ #54 — « fichiers indésirables à la racine du dépôt »

**Faux : aucun des 12 fichiers cités n'existe.**

```
absent : clean-a.txt      absent : test-out.txt
absent : clean-b.txt      absent : testrun.txt
absent : dfd.html         absent : tmp-tracked.txt
absent : dokkf.html       absent : range-dump.txt
absent : jdjch.html       absent : range-dump2.txt
absent : qsdzf.html       absent : xhdh.html
```

`git status --short --untracked-files=all` ne remonte qu'**un** fichier non
suivi : `docs/VERIFICATION-RAPPORT-AUDIT.md` (le mien, ajouté cette session).
Les fichiers suivis à la racine sont exactement au nombre de 11, tous légitimes :

```
.env.example  .gitignore  .vercelignore  README.md  index.html
package-lock.json  package.json  playwright.config.js  vercel.json
vite.config.js  vite.crawl.config.js
```

L'inférence « `tmp-tracked.txt` suggère qu'un fichier temp a été commité puis
retiré » est donc sans objet — rien dans l'historique de la branche ne
correspond.

### 🟡 #55 — « `hashPassLegacy('star31')` évalué avant sa déclaration »

**Vrai comme remarque de robustesse, imprécis techniquement.** Identique à
l'item **W** du premier rapport. `server/db.js:22` appelle la fonction dans un
**objet littéral** évalué au chargement du module ; `hashPassLegacy` est une
**déclaration de fonction** (`function hashPassLegacy(…)`, l.37) → hoistée **avec
son corps**, pas seulement « hoisting de déclaration ». Le code est correct
aujourd'hui ; le risque en cas de conversion en `const`/fat-arrow est réel.
Aucun bug actif.

---

## 3. Items 1–52 : verdicts reportés

Vérifiés dans `docs/VERIFICATION-RAPPORT-AUDIT.md` (lecture + 16 reproductions
en exécution). Rappel des seuls verdicts non-« vrais » :

| # | Verdict | Raison |
|---|---|---|
| **11** | ❌ **Faux** | `App.jsx:501-505` : `setToast(t('deskStatusFail')); return false` est exécuté **avant** le repli local (l.510) dès que l'erreur n'est ni `offline`, ni `not_found`, ni `forbidden`. Un 400 `transition` **ne retombe pas** dans le repli. Ce second rapport reprend l'affirmation **sans** la parenthèse auto-contradictoire du premier — il est donc nettement faux, là où le premier se contredisait. |
| **16** | ❌ **Faux** (code mort) | Le champ `count` écrit en `App.jsx:723` n'est **jamais lu** : le rendu (`:1767`) utilise `count`, total recalculé du panier (`:684`). Aucun compteur faux ne peut s'afficher. Le diagnostic (état périmé) est bon, la conséquence est nulle. |
| **22** | 🟡 **Partiel** | Ce rapport a **amélioré** l'item : il abandonne la thèse de l'inversion (fausse — `05→Ooredoo, 06→Mobilis, 07→Djezzy` est l'attribution officielle) et retient la duplication (vraie, vérifiée : fonctions strictement identiques) + la portabilité des numéros (point valide, non géré). |
| **48** | 🟡 **Partiel** | Il persiste à écrire « même `undefined` ». **Faux** : `FRONT_ORIGIN` vaut `''` (`server/index.js:62-67`, triple repli aboutissant à `''`), et Node **omet** un en-tête de valeur vide — vérifié en lançant le serveur sans `FRONT_ORIGIN` : aucun `Access-Control-Allow-Origin` sur la réponse. La seconde moitié (headers CORS posés inconditionnellement par `send()` alors que `corsHeaders()` est conditionnel) est **vraie**. |
| **50** | ❌ **Faux** | `src/notify.js:92` garde `typeof order.total === 'number' ? … : ''` **à la ligne même citée**. Aucune exception possible, donc aucune promesse rejetée. |
| **37** | 🟡 **Partiel** | Ce rapport dit « toujours exporté » (vrai) et **abandonne** le « toujours testé » du premier (faux). Amélioration. Reste vrai : aucun import hors `prefs.js` (seul `loadOrders` est importé, par `OrdersPage.jsx:5`). |
| **43** | ✅ **Vrai**, référence affinée | `index.js l.840` vérifié ligne à ligne : `db.meta.extraPanels = body.extraPanels.slice(0, 12)`. Le client (`MasterPage.jsx:295`) appelle `onMeta(res.meta)` avec le meta **local**, ignorant le `{ ok, meta: out }` renvoyé par le serveur. |
| **14** | 🟡 **Partiel** | `updateDb` (`db.js:330-335`) est bien sans verrou. Sous Vercel, chaque instance a **son propre `/tmp`** : le symptôme n'est pas la survente par écrasement mais la **divergence/perte** entre instances. La survente par course ne vaut que pour deux process partageant le même disque. |
| **O** | ❌ **Faux** tel qu'énoncé | **Reproduit** : compte A (0550111111) commandant au numéro de B (0550222222) **avec Bearer** → `userId` = A, et `GET /api/me/orders` de B renvoie `[]`. `index.js:374-376` ne rattache par téléphone **que** les commandes `userId == null`. Les lignes `389-391` citées en plus concernent l'annulation et appliquent le même filtre. **Variante vraie, plus étroite** : une commande **guest** (sans token) au numéro d'un tiers est bien visible et annulable par lui — reproduit (`PS-20260915-0008`, `name: "Attaquant Anonyme"`, visible par B). |
| **K** | 🟡 **Partiel** | La collision de nom est réelle (`masterApi.js:217`, `addRandomSuffix` défaut `false` dans `@vercel/blob`). Mais « écrasement **silencieux** » n'est vrai que pour le repli **filesystem**. Pour **Blob**, `allowOverwrite` défaut `false` → « *By default an error will be thrown if you try to overwrite a blob* » : le `put` **échoue**, l'exception remonte, la compensation `unlinkUpload` (`:222-227`) annule les photos déjà envoyées. Échec bruyant, pas écrasement. |
| **I** | 🟡 **Partiel** | `api.setToken(tok)` est bien exécuté avant `me()` (`App.jsx:430-433`), sans retry ni message. Mais « session **perdue** » est excessif : le token **reste stocké** (contrairement à l'effet de démarrage, `:413-421`, qui fait `setToken(null)` sur échec) → un rechargement applique la session. |
| **J** | 🟡 **Partiel** | Aucune UI « session expirée » : vrai. « Bearer mort envoyé sur **toutes** les requêtes » : inexact — l'effet de démarrage appelle `api.me()` et purge le token sur échec (`App.jsx:413-421`). |
| **26** | ✅ **Vrai** — mieux formulé que le premier rapport | « `intent:'link'` silencieusement dégradé en login » est **exact** : l'entrée est bien stockée avec `intent: 'link'` et `userId: null` (vérifié en base), mais `finishIdentity` (`oauth.js:149`) exige `pending.intent === 'link' && pending.userId` → la branche login s'applique. Le premier rapport écrivait à tort que l'intent était « converti en login » à l'écriture. Spam de `oauthPending` reproduit : 12 × 200, 12 entrées en base. |
| **P'** | ✅ **Vrai** (doublon de #8) | Confirmation, pas un finding distinct. |

Les 39 autres items (1–10, 12–13, 15, 17–21, 23–25, 27–36, 38–42, 44–47, 49,
51–52) sont **vrais**, références de lignes exactes. Les 16 reproductions en
exécution sont détaillées dans `docs/VERIFICATION-RAPPORT-AUDIT.md` §4 —
notamment :

- **#3** : `password:"star31"` présent dans `dist/assets/index-*.js` **et**
  `POST /api/auth/login` → 200, `role: master` ;
- **#7** : après `DELETE PS-20260915-0002`, réémission de `PS-20260915-0003` →
  deux fois le même code en base ;
- **#2** : 403 `current_password` sans `current`, 200 avec, aucun champ dans
  `ProfilePage.jsx:165,168` ;
- **#23 + L** : `wilaya: "<script>alert(1)</script>"`, `slot: "PAS_UN_SLOT"`,
  `name` de 600 caractères stockés tels quels (201), puis `=HYPERLINK(...)` et
  `+cmd|/C calc` retrouvés dans l'export CSV ;
- **#24** : ancien token toujours valide (200) après changement de mot de passe ;
- **#12** : 25 inscriptions → 25 × 201, 985 ms, aucune limite ;
- **#6** : `<img src=x onerror=alert(1)>` injecté brut dans le consentement ;
- **#8** : `loadLang`, `loadUsers`, `loadMeta` **et le wrapper `App.jsx:76-87`**
  lèvent `SecurityError` ;
- **D''** : `PUT /api/master/products/cpu-7600 {"price":0}` → 200, `price: 0`.

Références nouvelles de ce rapport, vérifiées exactes : `api.js:193`
(`URL.revokeObjectURL(url)`), `index.js:416-417` (`verifyPass(…body.current…)`),
`index.js:82` (`X-Frame-Options`) et `:91` (`frame-ancestors 'self'`),
`index.js:346-357` (`PUT /api/me` valide bien `rawWilaya` contre
`WILAYAS_NEAR` — le contraste de #23 est donc fondé).

---

## 4. Bilan comparé des deux rapports

| | Rapport 1 (« deux passes ») | Rapport 2 (« consolidé final ») |
|---|---|---|
| Items numérotés | 52 | 52 (identiques) |
| Findings lettrés | 22 retenus (A…Z après retraits) | 22 (A…U + P' ; **omet W, Y, Z**) |
| Items environnement | — | **3 nouveaux (#53–#55)** |
| Total affirmations | 74 | **77** |
| Faux | 4 (#11, #16, #22*, #50) + O | 5 (#11, #16, #50, O, **#53**) |
| Partiels | 8 | 9 (#53-fond est vrai, #54 faux, #55 partiel) |

\* le rapport 1 mettait en doute le mapping opérateur ; le rapport 2 a corrigé
de lui-même en ne retenant que la duplication.

**Le rapport 2 est une réécriture plus propre du rapport 1** : il corrige deux
imprécisions de son prédécesseur (#22, #26, #37), affine des références (#43,
#44, #48), et perd trois findings lettrés (W, Y, Z) au passage. En échange il
ajoute un bloc « environnement » dont **deux items sur trois décrivent une
machine qui n'est pas celle-ci** — c'est la seule régression nette.

Rien dans le rapport 2 ne remet en cause les 60 confirmations du rapport 1, ni
les 7 points que **ni l'un ni l'autre** n'avaient vus (liste dans
`docs/VERIFICATION-RAPPORT-AUDIT.md` §6) : amplification CPU de #12
(`scryptSync` ~31–43 ms/hash, mesuré), wrapper `storage` d'`App.jsx` qui lève,
repli OAuth réinjectant `FRONT_URL` non validé dans un `Location` porteur de
token (`index.js:493`), `readDb()` complet à chaque requête, identifiants master
publiés dans la documentation, couplage `#3 + #27`, et remap `pending → new` de
`GET /api/orders`.
