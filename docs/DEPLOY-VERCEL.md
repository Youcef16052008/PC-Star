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
| `WHATSAPP_RECIPIENT` | `213770650387` (optionnel, défaut = numéro du site) |

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
- [ ] Login master `pcstar.info31@gmail.com` / `star31`  
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
