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
