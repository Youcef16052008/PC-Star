# Déployer PC Star sur Vercel (HTTPS, sans VPS)

Vercel = **HTTPS automatique** + CDN + serverless. Pas de serveur à gérer.

## 1. Prérequis

- Compte [vercel.com](https://vercel.com) (gratuit Hobby OK)
- Repo GitHub `Youcef16052008/PC-Star` connecté

## 2. Import projet

1. Vercel → **Add New… → Project**
2. Importer le repo GitHub
3. Framework preset : **Vite** (auto)
4. Build Command : `npm run build`
5. Output Directory : `dist`
6. Root Directory : `.` (racine)

## 3. Variables d’environnement

Project → **Settings → Environment Variables** (Production + Preview) :

| Name | Value exemple |
|------|----------------|
| `FRONT_ORIGIN` | `https://TON-PROJET.vercel.app` |
| `FRONT_URL` | `https://TON-PROJET.vercel.app` |
| `OAUTH_REDIRECT_BASE` | `https://TON-PROJET.vercel.app` |
| `OAUTH_DEMO` | `1` |
| `WHATSAPP_TOKEN` | `EAAG…` (optionnel, P19) |
| `WHATSAPP_PHONE_NUMBER_ID` | `109876543210` (optionnel, P19) |
| `WHATSAPP_RECIPIENT` | `213770650387,213669174617` (optionnel, défaut = **les deux** numéros du site ; le format local `0770650387` est accepté et converti) |

`FRONT_URL` / `OAUTH_REDIRECT_BASE` servent aussi de **liste blanche de
redirection OAuth** (P13-S2) : un `returnUrl` d'une autre origine est ignoré.

### Notifications WhatsApp au maître (P19)

Chaque commande déclenche un message WhatsApp au maître (client, téléphone,
total, articles, lien de rappel). Configuration :

1. https://developers.facebook.com → créer une app (type **Business**) ;
2. ajouter le produit **WhatsApp** : l'app de test fournit un token temporaire
   (24 h) et un **Phone number ID** ;
3. en production : numéro vérifié dans le **WhatsApp Business Manager**, puis
   un **System user token** permanent ;
4. renseigner `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (et éventuellement
   `WHATSAPP_RECIPIENT`, sinon **les deux** numéros du magasin — `STORE_WHATSAPP`
   dans `src/data.js` — sont utilisés).

Sans ces variables, **rien ne casse** : l'envoi est ignoré silencieusement
(`not_configured`) et la commande passe normalement. Le maître reste notifié
par le Desk et par la notification navigateur.

**P20 — les deux numéros du magasin.** Le `07…` et le `06…` reçoivent tous les
deux l'alerte : une commande déclenche **trois** notifications pour le maître,
une dans le navigateur (Desk) et deux WhatsApp. Les numéros viennent d'une
source unique, `STORE_WHATSAPP` dans `src/data.js`, partagée par les boutons de
la page « À propos » et par l'envoi serveur — ajouter un troisième numéro ne
demande qu'une ligne là. Les envois sont **indépendants** : si un numéro échoue
(non inscrit sur WhatsApp, quota…), l'autre part quand même, et la réponse
reste `201` pour le client.

**LOT 8.6 (A6) — format des destinataires.** L'API Cloud de Meta exige le format
international **sans « + »** (`213770650387`). Avant ce correctif, la variable
était envoyée telle quelle après suppression des non-chiffres : un numéro saisi
au format local (`0770650387` — celui que le site affiche partout, et que cette
documentation donnait en exemple) était **refusé par Meta**, donc aucune alerte
de commande, en silence. Désormais chaque destinataire est normalisé :

| Saisie | Envoyé à Meta |
|---|---|
| `0770650387` (local) | `213770650387` |
| `+213 770 65 03 87` | `213770650387` |
| `00213770650387` | `213770650387` |
| `770650387` (local sans le 0) | `213770650387` |
| `+33612345678` (étranger) | `33612345678` (gardé tel quel) |
| `0123456789`, `12` | **écarté** — numéro non normalisable |

Un même numéro écrit sous deux formes ne part qu'une fois (déduplication après
normalisation). Une entrée écartée est **signalée au démarrage**
(`[pcstar-notify] WHATSAPP_RECIPIENT : 1 entrée(s) écartée(s)…`) et visible dans
`GET /api/health` (`whatsapp.invalid`, en compteurs — la route est publique, les
numéros n'y sont pas divulgués) :

```json
{ "whatsapp": { "configured": true, "recipients": 2, "invalid": 0 } }
```

`configured: true` avec `recipients: 0` est le cas critique : les jetons sont là,
mais aucune alerte ne partira. Le démarrage le journalise en **erreur**.

> ⚠️ **Les WebSockets ne fonctionnent pas sur Vercel** (serverless). Le socket
> Desk `/api/desk-stream` n'est actif que sur un serveur Node longue durée.
> Sur Vercel, le front retombe **automatiquement** sur le polling toutes les
> 20 s : aucune configuration à faire, mais une commande peut mettre jusqu'à
> 20 s à apparaître au comptoir. Le WhatsApp, lui, fonctionne partout.

`TRUST_PROXY` : **ne pas le définir sur Vercel** — la plateforme est détectée
automatiquement (`process.env.VERCEL`) et `X-Forwarded-For` est alors cru pour
le rate limiting. À définir à `1` uniquement derrière un reverse proxy que vous
maîtrisez (nginx, Caddy) ; jamais en exposition directe, sinon l'en-tête peut
être forgé et le rate-limit contourné.

Après le **premier** deploy, copie l’URL réelle et mets à jour ces 3 variables, puis **Redeploy**.

## 4. Deploy

- Push sur `main` (ou branche liée) → deploy auto
- Ou CLI : `npx vercel --prod`

HTTPS est fourni par Vercel (`*.vercel.app` + domaine custom si tu en ajoutes un).

## 5. Domaine custom (optionnel)

Settings → Domains → ajoute `pcstar.dz` (ou autre) → DNS chez ton registrar → HTTPS Let’s Encrypt auto.

## 6. Ce qui marche sur Vercel Hobby

| Feature | OK ? |
|---------|------|
| Site React (shop, builder, search) | ✅ |
| Photos `/photos/sku/*` (dans le repo) | ✅ |
| API auth, orders, catalog, desk | ✅ serverless |
| HTTPS | ✅ auto |
| OAuth demo | ✅ |
| OAuth Google réel | ✅ si clés + redirect URL Google Console = `https://TON.app/api/oauth/...` |

## 7. Limites honnêtes (sans base cloud)

| Sujet | Réalité Vercel free |
|-------|---------------------|
| `store.json` (users, orders, stock overrides) | Fichier dans **`/tmp`** → **éphémère** (cold start peut reset) |
| Upload master photos | `/tmp` → pas durable (sans `BLOB_READ_WRITE_TOKEN`) |
| **Taille du corps d'une requête/réponse** | **4,5 Mo maximum**, imposé par la plateforme, **non relevable** (Hobby comme Pro) — voir ci-dessous |
| Catalog 250 SKU + photos git | **Persistant** (build static) |

**Pour le magasin Oran au quotidien** : le catalogue + réservation locale/localStorage marchent ; les orders API peuvent se vider après sleep.

### Taille de corps : 4,5 Mo imposés par la plateforme (LOT 8.4 / A4)

Vercel plafonne le corps d'une **fonction serverless** à **4,5 Mo**, en entrée
comme en sortie, et cette limite **ne se relève pas** (ni sur Hobby, ni sur Pro,
ni par une configuration). Au-delà, la plateforme répond elle-même
`FUNCTION_PAYLOAD_TOO_LARGE` — une page d'erreur, **avant** d'entrer dans le
handler : l'application ne peut donc ni répondre son JSON, ni expliquer quoi
changer.

> ⚠️ `config.api.bodyParser.sizeLimit` est une convention **Next.js**
> (`pages/api/*`). Ce projet sert ses fonctions via `@vercel/node` (`vercel.json`
> réécrit `/api/(.*)` → `/api`), qui **ignore** cet export : en écrire un ne
> relève rien. C'est pourquoi `api/index.js` n'en contient plus (LOT 8.4).

**Ce que fait le code pour rester du bon côté de la limite** — toutes les
valeurs viennent d'un seul module, `src/limits.js` :

| Étage | Borne | Effet |
|---|---|---|
| Plateforme | **4,5 Mo** (`VERCEL_MAX_BODY_BYTES`) | refus HTML avant le handler — à ne jamais atteindre |
| Application, sous Vercel | **4 Mo** (`MAX_BODY_BYTES` = `MAX_UPLOAD_BODY_BYTES`) | **413 JSON** `{"error":"too_large","maxBytes":4194304,"platformLimit":4718592}` |
| Application, serveur local | 15 Mo (`LOCAL_MAX_BODY_BYTES`) | 413 JSON, `platformLimit: null` (aucun plafond extérieur) |
| Client, avant l'envoi | 4 Mo (`payloadOverBudget()`) | **aucun appel réseau**, message chiffré au maître |
| Client, par photo | 400 Ko (`MAX_PHOTO_BYTES`) | compression à budget d'octets (qualité puis dimensions) |
| Serveur, par blob | 2,5 Mo (`MAX_PHOTO_SERVER_BYTES`) | photo trop grosse écartée, les autres passent |

Le pire cas nominal tient : **6 photos** au plafond client → ~3,2 Mo de base64 →
sous la garde d'envoi (4 Mo) → sous la limite plateforme (4,5 Mo).

**Si un jour il faut envoyer plus lourd** (galerie, vidéos) : la bonne réponse
n'est pas de relever une limite impossible à relever, mais de faire monter les
octets **hors du corps de la fonction** — `@vercel/blob` en upload direct depuis
le navigateur (`upload()` côté client, puis l'URL seulement dans le JSON), ce que
le dépôt sait déjà faire côté serveur (`BLOB_READ_WRITE_TOKEN`).

### Rate-limit : compteurs **en mémoire**, donc **par instance** (LOT 3.19 / R17)

`server/rateLimit.js` tient ses compteurs dans une `Map` en mémoire du process.
C'est un choix assumé, pas un oubli — mais il faut savoir ce qu'il vaut sur
Vercel :

| Situation | Effet réel |
|-----------|-----------|
| Serveur local (`npm run api`) | Un seul process → la limite est **exacte** (20 tentatives/min par IP sur `/api/auth/login`, etc.) |
| Vercel, trafic normal | Une instance « chaude » sert la plupart des requêtes → la limite tient **en pratique** |
| Vercel, cold start / montée en charge / plusieurs régions | Chaque nouvelle instance repart avec des compteurs **vides** : un attaquant qui provoque des cold starts (ou qui est routé sur plusieurs instances) peut multiplier son budget par le nombre d'instances |
| Vercel, après inactivité | L'instance est recyclée → les compteurs repartent de zéro |

**Conséquence à connaître** : sur Vercel, le rate-limit applicatif est un
**frein**, pas une frontière. La vraie défense contre le brute-force reste :

1. un mot de passe maître long (≥ 20 caractères, `MASTER_PASSWORD`) ;
2. le hachage `scrypt` côté serveur ;
3. les limites **plateforme** de Vercel (WAF / Attack Challenge, plan payant) si
   le magasin est exposé à des attaques répétées.

**Si le multi-instances devient réel** (trafic soutenu, ou exigence de sécurité
formelle) : déplacer les compteurs dans un store partagé —
`@upstash/ratelimit` + Upstash Redis (compatible serverless, quelques lignes
dans `server/rateLimit.js`, le contrat `{ ok, retryAfter }` ne change pas) ou
Vercel KV. Tant que ce n'est pas fait, la limite ci-dessus s'applique et est
**documentée ici volontairement**.

### WebSocket Desk : indisponible sur Vercel (LOT 3.10 / B14)

Les fonctions serverless Vercel ne font pas de WebSocket. `attachDeskSocket()`
n'est appelé **que** par le serveur local ; sur Vercel, le front tente le socket,
échoue, puis **arrête** d'essayer après 8 échecs consécutifs et reste sur le
polling (20 s). Aucune configuration à faire : le Desk fonctionne dans les deux
cas, il est simplement moins « instantané » sur Vercel.

### Encadrement (iframe) : interdit en production, et c'est voulu (LOT 5.10 / U10)

`vercel.json` pose `X-Frame-Options: SAMEORIGIN` **et** `frame-ancestors 'self'`
dans la CSP ; `send()` côté API pose les mêmes en-têtes sur les pages HTML qu'il
sert (refus OAuth, aperçus d'upload). Le site ne peut donc pas être affiché dans
une iframe d'un autre domaine.

**Pourquoi c'est assumé :** une boutique encadrable est une boutique
« clickjackable » — un bouton *Confirmer la commande* ou *Supprimer ce client*
recouvert d'un calque transparent se clique sans que l'utilisateur le voie. Les
commentaires du code parlaient autrefois d'un « aperçu iframe tiers » comme d'un
scénario d'usage : cette conception n'existe pas, elle est retirée des
commentaires (les en-têtes, eux, restent).

Ce qui continue de fonctionner sans toucher aux en-têtes :

- le **même domaine** (front + API derrière le domaine Vercel, ou un
  sous-domaine de la boutique) ;
- l'**aperçu de développement** (Vite ne pose pas ces en-têtes) ;
- le **stockage bloqué** — cookies tiers refusés, navigation privée, quota plein
  — n'a rien à voir avec l'encadrement : `safeStorage` retombe sur un repli
  mémoire et un bandeau le dit (§7 du plan, LOT 3.1).

**Si un jour tu veux vraiment un aperçu encadré** (vitrine intégrée à un site
partenaire, preview d'agence) : ne retire pas `X-Frame-Options` partout. Ajoute
une origine **explicite** — `frame-ancestors 'self' https://partenaire.example`
dans `vercel.json`, et `X-Frame-Options: ALLOW-FROM` ne servant à rien sur les
navigateurs modernes, c'est la CSP qui fait foi — puis vérifie que les actions
sensibles (commande, suppression) demandent une confirmation visible. C'est un
choix de sécurité à trancher délibérément, pas un réglage par défaut.

### Quand tu voudras de la persistance (plus tard, toujours sans VPS)

1. **Vercel KV** ou **Upstash Redis** pour `store.json`  
2. ou **Turso / Neon** (SQLite/Postgres free)  
3. **Vercel Blob** pour photos master upload  

Le code est déjà découpé (`server/db.js`) pour brancher ça sans tout casser.

## 8. Photos pro (toi plus tard)

1. Shoot / packshots ≥ 1200px, 3 angles / SKU  
2. Place dans `public/photos/sku/{id}-1.jpg` … `-3.jpg`  
3. `npm run photos:check` puis commit + push → Vercel rebuild  
4. Pas besoin de VPS — les images partent dans le build static

## 8 bis. Comptes de démonstration (`DEMO_PASSWORD`, lot 1.19)

Les trois comptes clients de démonstration ne portent plus de mot de passe codé
en dur : ils suivent la variable `DEMO_PASSWORD` (une seule valeur pour les
trois — ce sont des fixtures).

| État | Comportement |
|---|---|
| `DEMO_PASSWORD` posé | les trois comptes s'ouvrent avec cette valeur ; une base existante est **alignée au démarrage** (`normalizeDb`), donc les anciennes empreintes publiées cessent de fonctionner |
| variable absente | comptes seedés **verrouillés** (`passwordHash: null`) : visibles comme données de démonstration, `POST /api/auth/login` → `401 demo_locked`. Le serveur démarre normalement |

Un compte de démonstration qui n'est plus marqué `demo: true` (revendiqué par
OAuth, devenu un vrai client) n'est jamais réaligné.

> Les trois mots de passe publiés auparavant dans le README, les guides et le
> bundle client sont **compromis** : ne jamais les reposer comme
> `DEMO_PASSWORD`, ni les réutiliser ailleurs. Ne pas choisir `demo-local` non
> plus (valeur du mode local, présente dans le bundle).

## 9. Checklist post-deploy

- [ ] `https://TON.app` charge le shop  
- [ ] `https://TON.app/api/health` → `{ ok: true }`  
- [ ] Login master avec les valeurs posées dans `MASTER_EMAIL` / `MASTER_PASSWORD`  
- [ ] Comptes de démonstration : soit `DEMO_PASSWORD` posé (et le login client
      fonctionne avec cette valeur), soit **absent** et le login répond
      `401 demo_locked` — les deux états sont voulus (lot 1.19), mais il faut
      savoir lequel on a  
- [ ] Ajout panier + réserve (tél DZ)  
- [ ] Footer garantie / privacy  
- [ ] HTTPS cadenas navigateur  

## 10. Commandes locales (inchangées)

```bash
npm run start:api   # :8787
npx vite --host     # :5173 proxy /api
npm run build
npm run smoke
```

## Statut de validation réel

Les instructions ci-dessus sont une procédure, pas la preuve d'un déploiement réalisé. Aucun domaine Vercel, aucune clé OAuth et aucune base cloud ne sont présents dans ce dépôt. La validation production nécessite un projet Vercel accessible, des variables secrètes et une base managée ; elle ne peut pas être simulée honnêtement dans le dépôt local.
