# PC-Star

Boutique pickup **PC Star Informatique** — El Makari Les Castors, Oran.

## Run

```bash
npm install
npm run start:api   # :8787 multi-device orders + auth
npm run dev         # :5173 site (proxies /api)
npm run build       # vite build, then scans dist/ for secrets — fails if any landed there
npm test            # suite complète (node:test) — run `npm run build` first: bundleSecrets scans dist/
npm run check:bundle # re-run only the dist/ secret scan (lot 7.3)
npm run photos:audit # références qui n'ont pas encore leur propre photo
npm run photos:wire  # câble les photos livrées (`/photos/pack/<id>.jpg`) dans le catalogue
npm run master:rotate # new master password, written to .env.local — the value is never printed
```

## État mesuré (23/09/2026)

- `npm test` : **1210 tests, 0 échec** (83 fichiers `src/*.test.js`, tous branchés dans le script — `src/p3ServerHygiene.test.js` le vérifie). Le total peut bouger de ±1 selon le nombre de chunks que `dist/` contient : `src/bundleSecrets.test.js` fabrique un test par artefact scanné, ce n'est pas une régression. La suite scanne le bundle publié
  (`src/bundleSecrets.test.js`) : sans `dist/`, elle échoue en cascade — le build
  est une pré-condition, pas une étape optionnelle.
- `npm run build:crawl && node scripts/jsdom-crawl.mjs` : 24 pages rendues en
  jsdom (2 langues × 12 pages — le résumé du script calcule ce produit, il ne le
  recopie plus : « × 13 pages » a menti pendant des dizaines de sessions), 0 erreur. C'est le seul contrôle qui voit une
  page React casser au rendu (un import manquant passe `node --check`, le bundle
  et tous les tests `node:test`) ; `src/moduleWiring.test.js` en garde une partie
  en secondes.
- Catalogue de base : **305 produits, 771 photos**. i18n : **2 langues**
  (`fr`, `en`) et **662 clés** chacune — la parité est vérifiée à chaque
  exécution par `src/i18n.coverage.test.js`, dans les deux sens (aucune clé appelée sans
  traduction, aucune traduction sans appel).
- Statuts de commande : table **à sens unique** (`new → preparing → ready →
  picked`, annulation libre avant `picked`) ; un écran qui écrit peut passer
  `expectedStatus` pour refuser une écriture obsolète (409 `stale`) au lieu de la
  voir s'appliquer.
- `npm run test:e2e` (Playwright) est **joué en CI** par `.github/workflows/e2e-smoke.yml`
  sur **trois moteurs** : chromium, webkit, firefox — les deux derniers couvrent
  iPhone/iPad (WebKit est le seul moteur que iOS autorise) et Firefox Android, que
  le parc android du magasin ne représente pas. Ni `build:crawl`, ni `jsdom-crawl`,
  ni les tests `node:test` ne le remplacent : aucun autre contrôle du dépôt ne rend
  l'application dans un moteur qui a une mise en page, des polices et un vrai clavier.
  Le job refuse un `.only` oublié (`--forbid-only`) : sans lui, une spec exclusive
  rend le smoke muet sans le faire rouge. Limites assumées : des desktops émuls, pas
  les viewport téléphones (couverts par la recette
  [`docs/RECETTE-RESPONSIVE-DIRECTION-03.md`](docs/RECETTE-RESPONSIVE-DIRECTION-03.md)),
  et le job ne compare pas des captures d'écran.

## Demo accounts (click in Login, or type)

| Role | Email | Password |
|------|-------|----------|
| **Master** (store) | _set via `MASTER_EMAIL` / `MASTER_PASSWORD`_ | _not published_ |
| Customer (demo) | `karim.oran@demo.dz` | _set via `DEMO_PASSWORD`, or locked_ |
| Customer (demo) | `amina.castors@demo.dz` | _set via `DEMO_PASSWORD`, or locked_ |
| Customer (demo) | `yacine.pc@demo.dz` | _set via `DEMO_PASSWORD`, or locked_ |

> **Master account:** no longer published here. It is defined by the
> `MASTER_EMAIL` / `MASTER_PASSWORD` environment variables (see `.env.example`).
> The credentials that used to be printed on this page **and shipped in the
> client bundle** are considered compromised and must be rotated — removing
> them from the repo is not enough.
>
> **Demo customer accounts (lot 1.19):** same rule. Their password comes from
> `DEMO_PASSWORD` — one value for the three fixtures. **Without it the accounts
> are seeded locked** (`passwordHash: null`): they still show up as demo data,
> but `POST /api/auth/login` answers `401 demo_locked`. The three values that
> used to be printed here, in the guides and in the client bundle are considered
> compromised (they opened real API sessions) — never reuse them. In **local
> mode** (no API) the browser accounts open with `DEMO_LOCAL_PASSWORD` from
> `src/shopStore.js`; that value only ever unlocks this browser sandbox.

Full how-to: **[docs/GUIDE-DEMO.md](docs/GUIDE-DEMO.md)** · [FR](docs/GUIDE-DEMO-FR.md) · [AR](docs/GUIDE-DEMO-AR.md)  
Also in the app menu: **Guide**.

## Portfolio & docs

- [docs/README.md](docs/README.md) — **index** de la documentation
- [docs/PORTFOLIO.md](docs/PORTFOLIO.md) — case study (contexte, contraintes, chiffres, leçons)
- [docs/PROBLEMS-SOLUTIONS.md](docs/PROBLEMS-SOLUTIONS.md) — **22 problèmes → solutions** (doc portfolio principale)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — schéma front / API / media / Vercel
- [docs/ROADMAP-10.md](docs/ROADMAP-10.md) — plan P0–P6, état final (~9.5–9.7)
- [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md) — déploiement [Vercel](https://vercel.com) (HTTPS sans VPS)

## Kept features

- Light / dark / system theme  
- PC builder + compatibility / overheat checks  
- Simple email accounts (customer + master)  
- Multi-device API: desk orders, master add/hide products  
- FR / EN · DZ phones 05/06/07 · catalogue marché algérien  

## Removed (volontairement)

Avatars, accent colors, product compare, 3D orbit, SMS demo.

> **OAuth Google/Meta** fonctionne soit en consentement simulé isolé (`OAUTH_DEMO=1`), soit en OAuth réel (`OAUTH_DEMO=0` + clés serveur + URI de callback enregistrées). Voir [docs/GUIDE-DEMO.md](docs/GUIDE-DEMO.md) et le [plan de remédiation](docs/PLAN-REMEDIATION-AUDIT-2026-09-17.md).

## Deploy (Vercel, HTTPS, no VPS)

See **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**.

```bash
# one-shot CLI (optional)
npx vercel
npx vercel --prod
```

Set env: `FRONT_ORIGIN`, `FRONT_URL`, `OAUTH_REDIRECT_BASE` to your `https://….vercel.app`.

> **P13 (S4)** : ne posez **pas** `TRUST_PROXY` sur Vercel (détecté via `VERCEL`).
> Derrière un proxy/nginx custom, mettez `TRUST_PROXY=1` **et** faites-lui réécrire
> `X-Forwarded-For`, sinon le rate-limit de login se partage entre tous les visiteurs.
Photos: keep shipping under `public/photos/sku/` — add pro shots later, push, done.

`DATABASE_URL` (Neon) **must** be the **pooled** string (`ep-…-pooler.…`) — see
[docs/NEON-MIGRATION.md](docs/NEON-MIGRATION.md).

## Derniers correctifs (P0 → P21)

- **P0 → P5 (19–20/09/2026)** — cinq lots trouvés en **utilisant** l'application, chacun avec
  sa mesure avant/après et son verrou : P0 plus aucun secret dans le bundle ni dans git (le
  serveur **refuse de démarrer** sans `MASTER_EMAIL` / `MASTER_PASSWORD`, et
  `scripts/check-bundle.mjs` fait échouer le build si un secret file dans `dist/`) ; P1 → P3
  erreurs HTTP, limites de corps, garde-fous de commande, surfaces boutique et hygiène du
  serveur ; P4 connexion et menu en **pleine page** (sur un téléphone du parc, la fenêtre de
  500 px laissait le clavier manger le formulaire) ; P5 la coupe de texte qui ne sépare plus un
  caractère en deux, et un compteur de rate-limit qui ne vole plus ~100 µs à chaque requête
  légitime. **Relire P5 a rapporté six défauts dans les correctifs de P5 eux-mêmes** — dont un
  refus qui parcourait tout le corps reçu (d'où `excedeChars`, en O(borne), verrouillé sur un
  4 Mio refusé en < 5 ms). Détail complet, mesure par mesure :
  [`docs/BUGS-AND-FIXES.md`](docs/BUGS-AND-FIXES.md).
- **P6 (page Recherche, 20/09/2026)** — la page Recherche dressait **69 rayons** en
  pastilles avant le premier résultat (huit panneaux à plat sur mobile, les mêmes en radios
  dans l'aside du bureau). Le filtre devient ce qu'il doit être : deux boutons —
  « Filtrer par marque », puis « Filtrer par catalogue » — chacun portant la valeur choisie,
  une feuille qui s'ouvre d'un clic et se referme sur le choix, les rayons d'un seul panneau à la
  fois (le groupe de la ligne choisie, posé à plat), et la compatibilité (socket) demandée
  **seulement** aux lignes qui en ont une. L'aside ne duplique plus rien, et le tiroir mobile non
  plus : la liste des marques qui y vivait encore est partie. Les résultats se **paginent** douze
  par douze — la règle est écrite une fois pour la vitrine et la recherche, dans `src/pager.js`.
  Cinquante-cinq verrous montés à l'écran : `src/p6SearchSurface.test.js` (quarante-quatre au
  sortir du lot S5, neuf de plus au lot P25 ci-dessous). Le lot S3 a partagé la
  règle là où elle avait été recopiée : `src/pagerControls.jsx` (pager fenêtré + choix 12/24/48),
  `src/brandSheet.jsx` (la feuille des marques avec son champ, pour les deux écrans),
  `src/filterSheet.js` (Échap). Un pager qui dresse un bouton par page n'a pas réparé le mur de
  pastilles, il l'a numéroté : 28 boutons, puis 5. Enfin, le filtre qu'un choix rend
  impossible est **retiré et annoncé** — la règle est une seule fois dans `src/filterDrop.js`,
  et la phrase que le client lit (`filterDrop`) est la même sur les deux écrans : un état qui
  change sous les yeux sans explication n'est pas une faveur, c'est un défaut poli. Le lot S5
  a traité la taille de page comme ce qu'elle est : une **préférence**, stockée sous sa propre
  clef (`src/pagerStore.js`) et relue par les deux écrans — choisir quarante-huit puis changer
  d'écran ne fait plus retomber le catalogue à douze, et une clef abîmée se lit « douze » au
  lieu de casser le montage. Le lot S6 a generé le menu depuis une liste declaree
  (`MENU_DESTINATIONS`, `HORS_MENU` avec sa raison) : la page « Garantie & RMA » etait
  routée, traduite, titree — et sans un seul lien vers elle ; et le menu ne proposait
  qu'une porte (« Connexion ») pour un compte qui n'existe pas encore. Les deux entrees
  y sont maintenant (`navSignup`), et `?connexion=1` / `?inscription=1` debarquent
  directement sur le formulaire. `npm run preview` proxyse aussi `/api` (comme le build
  du crawl : `vite preview` n'heritait pas de `server.proxy`) — sans lui, l'aperçu ne
  pouvait pas tester le compte maître : tout se croyait hors-ligne.
- **P25 (page Recherche, 21/09/2026)** — trois demandes du client sur ce que la page
  montre avant les fiches. Les **recherches sauvées** sont **retirées** (« sauver la
  sauvegarde n'est pas utile »), avec leurs fonctions de stockage
  (`pcstar-saved-searches`) et leurs trois clés de dictionnaire : une fonctionnalité
  qu'on ne veut plus ne laisse pas ses morceaux derrière elle. Les **marques et les
  rayons se retiennent par plusieurs** (trois, cinq, ou moins, ou plus) : les deux
  feuilles ne se referment plus sur le premier clic, elles portent leur sortie
  (« Voir les N résultats ») et ce compte suit chaque bascule ; chaque rayon retenu a
  sa puce, « Tout le catalogue » **vide** la sélection au lieu de s'y ajouter, et la
  règle qui retire une marque devenue incapable de filtrer juge désormais sur
  l'**ensemble** des rayons retenus. Le **prix se tape au clavier** — 100 DA …
  10 000 000 DA : `src/priceRange.js` porte la règle (chiffres seuls, borne corrigée à
  la sortie du champ, champ vide = pas de borne, `min > max` **annoncé** au lieu
  d'être échangé en silence) et `src/priceRange.jsx` le **seul** bloc de champs, rendu
  par l'aside du bureau **et** par le tiroir mobile. Les six tranches de prix
  (`PRICE_PRESETS`) et le `<select>` du tiroir sont partis avec elles.
  Cinquante-cinq verrous dans `src/p6SearchSurface.test.js`.
- **P28 (relecture du rapport P26/P27, 23/09/2026)** — huit défauts vrais à l'écran
  derrière des portes vertes, un verrou chacun (rouge sur `ece036b`, vert après). La
  **galerie du maître** est servie telle quelle (`photoMode: 'custom'`) : plus de trio
  `/photos/sku/` ajouté derrière sa photo, plus de visuel studio qui la cache, et vider
  la galerie **rend** la fiche du catalogue au lieu du repère de rayon. Le
  **configurateur** : le bouton d'ajout n'est plus `disabled` — son clic dit ce qui
  manque et y mène ; un **combo** boîtier + alimentation remplit les deux emplacements
  et n'est compté qu'une fois ; l'onglet « Accessoires » s'active et porte « Réseau ».
  La **Recherche** : dix références sans rayon en ont un (dont la ligne « Packs &
  combos »), et « Ajouter » ne renvoie plus le focus sur `<body>`. Détail et mesures :
  [`docs/BUGS-AND-FIXES.md`](docs/BUGS-AND-FIXES.md) § LOT P28.

- **Rotation du secret maître** — `npm run master:rotate` (`scripts/rotate-master.mjs`) génère
  un mot de passe de 32 signes, l'écrit dans `.env.local` en `0600`, refuse toute cible que git
  suivrait, et **n'affiche jamais la valeur** : un secret passé à l'écran se retrouve dans
  l'historique du shell, la capture d'écran et le fil de discussion. Recette complète, commandes
  Vercel comprises : [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md) § 8 ter.

- **P21 (boutons du comptoir + nettoyage vitrine)** —
  **Comptoir** : « je clique sur préparer / prêt / remis, rien ne change ».
  `src/api.js` n'avait **aucun délai maximal** sur `fetch` : une requête qui
  pendait (proxy capricieux, cold start serverless, réseau mobile) ne se
  réglait jamais. Comme `src/DeskPage.jsx` partageait **un seul état `busy`**
  pour toutes les commandes et que les cinq boutons testaient sa simple
  présence (`disabled={busy}`), une seule requête bloquée **grisait les boutons
  de toutes les cartes** jusqu'au rechargement de la page — sans aucun message.
  Ajout d'un `AbortController` à 15 s (`API_TIMEOUT_MS`), d'un `busy` **par
  carte** (`disabled={busy === r.code}`) et d'un `catch` qui libère l'état et
  affiche `deskStatusFail` au lieu de remonter un rejet non géré.
  **Vitrine** : suppression, à la demande, de la section
  « الأكثر مبيعاً في الجزائر » **et de ses 27 produits** (catalogue
  250 → 223), du badge d'état « ● API », du libellé « ماركات جزائرية شائعة »,
  des badges « espèces au comptoir » / « garantie 1 an » et du bloc
  « Mode de paiement » du panier. Puis, à la demande, les **quatre derniers
  endroits** où ces phrases subsistaient : la page légale **Garantie**
  (paragraphe d'intro + note « garantie boutique 1 an »), la page légale
  **Confidentialité** (« espèces au comptoir »), la **note de rachat** sur
  « À propos », et les **messages WhatsApp** envoyés aux clients depuis le Desk
  (`deskWaReady` / `deskWaContact`) — plus la meta description SEO. Les 10 clés
  i18n devenues mortes ont été retirées des trois langues
  (502 → 491, toujours symétriques). Les presets du
  Builder qui pointaient vers des références supprimées ont été remappés vers
  des équivalents compatibles et toujours vendus
  (`cpu-5600` → `cpu-5500`, `mag-ddr4-16` → `team-ddr4-16`).

  Trois mécanismes distincts pouvaient produire le symptôme du comptoir ; les
  trois ont été traités :

  1. **Requête qui pend** — aucun délai maximal sur `fetch` (`src/api.js`) +
     un seul état `busy` partagé par toutes les cartes (`src/DeskPage.jsx`) :
     une requête bloquée grisait les cinq boutons de **toutes** les commandes
     jusqu'au rechargement, sans message. → `AbortController` à 15 s
     (`API_TIMEOUT_MS`), `busy` **par carte** (`disabled={busy === r.code}`),
     et un `catch` qui libère l'état et affiche `deskStatusFail`.
  2. **Course avec le polling** — `pull()` envoyait `GET /api/orders` (T0) puis
     appliquait la réponse par `setReservations(next)` (T2) **sans condition**.
     Un clic entre les deux faisait aboutir le `PATCH` (T1), puis la réponse du
     polling — produite avant le `PATCH` — remettait l'ancien statut : le badge
     revenait en arrière, ce qui se lit comme « rien ne change ». Fenêtre
     d'autant plus présente sur Vercel, où le polling de 20 s est le seul
     rafraîchissement (pas de WebSocket en serverless). → nouvelle fonction
     pure `mergeServerOrders()` (`src/orderLogic.js`) : une commande modifiée
     localement après le départ de la requête garde son statut, le serveur
     reste la source de vérité dès qu'il a enregistré le changement.
  3. **Échec d'écriture du store** — mesuré, pas supposé : avec
     `store.json.tmp` rendu inaccessible (`EISDIR`, classe d'échec d'un système
     de fichiers en lecture seule comme Vercel), `PATCH /api/orders/:code`
     renvoie bien **HTTP 500 + JSON `{ok:false,error:'server'}`**, donc le
     client peut afficher `deskStatusFail` au lieu de rester muet. Couvert par
     `src/deskStatusFail.test.js`, car une régression silencieuse (connexion
     pendue au lieu d'une réponse) reproduirait exactement le symptôme.

- **P20 (les deux numéros du magasin)** — le second numéro (`0669 17 46 17`)
  existait dans les données mais n'était exposé **nulle part** en WhatsApp : un
  seul bouton sur « À propos », une seule alerte par commande. Ajout de
  `STORE_WHATSAPP` (source unique partagée par les boutons et le serveur),
  **deux boutons WhatsApp** sur la page « À propos », et notification des
  **deux** numéros à chaque commande — le maître reçoit **3 alertes** : une dans
  le navigateur et deux WhatsApp. Les envois sont indépendants : si un numéro
  échoue, l'autre part quand même et la commande client passe normalement.

- **P19 (commandes : alerte + suppression)** — le maître est maintenant
  **prévenu dès qu'une commande arrive** : poussée temps réel sur le Desk
  (WebSocket `/api/desk-stream`, avec **repli automatique sur le polling** car
  les WebSockets n'existent pas sur Vercel), **notification navigateur**, et
  **message WhatsApp** (Cloud API) avec le client, le téléphone, le total, les
  articles et un lien de rappel. La détection passe par un ensemble de codes :
  avant, une commande arrivée en même temps qu'une suppression passait
  inaperçue. Ajout de `DELETE /api/orders/:code` (master) et d'une **corbeille**
  sur chaque carte du Desk — suppression définitive avec **stock rendu**, et
  sans double rendu sur une commande déjà annulée. Une panne WhatsApp ne fait
  jamais échouer une commande client.

- **P18 (sécurité uploads)** — un id produit en traversal
  (`PUT /api/master/products/..%2F..%2Fpwnt`) écrivait le fichier **hors** de
  `public/photos/uploads` (donc dans `public/`, servi publiquement) alors même
  que la route répondait 404. Deux barrières (`safeUploadName` + garde sur le
  chemin résolu), id produit assaini en amont, et les photos déjà envoyées sont
  nettoyées si l'upload échoue en cours de route

- **P17 (second rapport d'analyse)** — 7 affirmations vérifiées par exécution :
  2 bugs confirmés et corrigés (toast `authErrorPassword` sur un échec de création
  produit, estimation de puissance qui **ignorait le CPU** car `p.tdp` n'existe
  sur aucun produit), 1 piège UX expliqué dans l'interface (filtre « En stock »),
  2 durcissements (SKU, sockets multiples), et **3 affirmations réfutées** par
  mesure (SKU `PS-` impossible, pas de race `hiddenProductIds`, `pdpWaMsg`
  identique dans les 2 langues du dépôt (`fr`, `en` — l'arabe a été retiré depuis))

- **P16 (lot 4 : durcissement)** — un compte de démo supprimé ne revient plus, le
  rate-limit garde sa fenêtre par bucket, changer de mot de passe exige l'ancien,
  le reset master ne pose plus `client31` tout seul, un patch produit invalide
  (`price: "abc"`, nom de 500 caractères) est refusé au lieu de partir en vitrine,
  les transitions de statut sont gardées (`picked` ne revient plus en `new` ;
  depuis P2/B6 la table est à sens unique et `PATCH /api/orders/:code` accepte
  `expectedStatus` — une écriture obsolète répond 409 `stale` au lieu de passer),
  l'historique de commandes ne perd plus rien en silence, l'API ne répond plus en
  `CORS *` par défaut, `.env` est enfin lu, et `server/data/store.json` (qui
  contenait les hashes de mots de passe) n'est plus versionné

- **P15 (lot 3 : #5, #6, #7)** — les recherches sauvées sont **vraiment** persistées
  (l'appel passait `null` comme storage → rien n'était écrit), le repli de vignette ne
  supprime plus l'image du DOM (webp → jpg → badge de catégorie), et les produits créés
  par le master ne réclament plus 3 photos SKU inexistantes (pool de famille à la place)
- **P14 (lot 2 : #1, #3, #4)** — plus aucune clé interne (`_err`/`_lastAuth`) écrite dans
  la base, les liens WhatsApp du comptoir sont au format E.164, et un avertissement de
  compatibilité n'écrase plus l'écran du Builder
- **P13 (lot 1 : S1-S4)** — l'escalade master par OAuth est fermée (403), `returnUrl` est
  validé et le front envoie désormais un chemin **relatif** (open redirect fermé), le
  dernier token n'est plus persisté, et le rate-limit de login n'est plus contournable
  en forgeant `X-Forwarded-For` (en-tête ignoré sans `TRUST_PROXY=1`)
- **P12 (B25)** — une base injoignable ne vide plus la vitrine : catalogue de base en
  mode dégradé + bandeau + `npm run db:doctor`
- **P11 (B13)** — le back est désormais joignable depuis le front (proxy `/api`, CORS
  explicite, health check)

Détails, preuves et résiduels : [docs/BUGS-AND-FIXES.md](docs/BUGS-AND-FIXES.md).

## Pas de produits dans la boutique ?

```bash
DATABASE_URL='postgresql://…' npm run db:doctor   # base injoignable ou vide ?
```

Depuis P12 (B25), une base injoignable ne vide plus la vitrine : l'API sert le
catalogue de base en mode dégradé (bandeau « Base de données injoignable »,
pastille `▲ DB`) et `npm run db:doctor` donne la cause exacte.
Détails : [docs/BUGS-AND-FIXES.md](docs/BUGS-AND-FIXES.md) (P12 — B25).
