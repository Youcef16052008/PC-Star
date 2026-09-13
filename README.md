# PC-Star

Boutique pickup **PC Star Informatique** — El Makari Les Castors, Oran.

## Run

```bash
npm install
npm run start:api   # :8787 multi-device orders + auth
npm run dev         # :5173 site (proxies /api)
npm test
npm run build
```

## Demo accounts (click in Login, or type)

| Role | Email | Password |
|------|-------|----------|
| **Master** (store) | `pcstar.info31@gmail.com` | `star31` |
| Customer | `karim.oran@demo.dz` | `karim31` |
| Customer | `amina.castors@demo.dz` | `amina31` |
| Customer | `yacine.pc@demo.dz` | `yacine31` |

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
- AR / FR / EN · DZ phones 05/06/07 · catalogue marché algérien  

## Removed (volontairement)

Avatars, accent colors, product compare, 3D orbit, SMS demo.

> **OAuth Google/Meta est LIVRÉ** (mode démo par défaut, réel avec clés) — voir [docs/GUIDE-DEMO.md](docs/GUIDE-DEMO.md) et `server/oauth.js`.

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

## Derniers correctifs (P11 → P19)

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
  identique dans les 3 langues)

- **P16 (lot 4 : durcissement)** — un compte de démo supprimé ne revient plus, le
  rate-limit garde sa fenêtre par bucket, changer de mot de passe exige l'ancien,
  le reset master ne pose plus `client31` tout seul, un patch produit invalide
  (`price: "abc"`, nom de 500 caractères) est refusé au lieu de partir en vitrine,
  les transitions de statut sont gardées (`picked` ne revient plus en `new`),
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
