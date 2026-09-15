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
| `WHATSAPP_RECIPIENT` | `213770650387,213669174617` (optionnel, défaut = **les deux** numéros du site) |

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
   `WHATSAPP_RECIPIENT`, sinon le numéro affiché sur le site est utilisé).

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
| Upload master photos | `/tmp` → pas durable |
| Catalog 250 SKU + photos git | **Persistant** (build static) |

**Pour le magasin Oran au quotidien** : le catalogue + réservation locale/localStorage marchent ; les orders API peuvent se vider après sleep.

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

## 9. Checklist post-deploy

- [ ] `https://TON.app` charge le shop  
- [ ] `https://TON.app/api/health` → `{ ok: true }`  
- [ ] Login master avec les valeurs posées dans `MASTER_EMAIL` / `MASTER_PASSWORD`  
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
