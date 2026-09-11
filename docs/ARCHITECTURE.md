# PC Star — Architecture

Vue d'ensemble du système : **front SPA React** / **API Node (serverless-ready)** / **pipeline media** / **hébergement Vercel sans VPS**.

---

## 1. Schéma global

```
                         ┌─────────────────────────────────────────────────────┐
                         │                    NAVIGATEUR (mobile first)         │
                         │  React 19 + Bootstrap 5.3 (CDN) + i18n AR/FR/EN      │
                         │                                                     │
                         │  Pages (state-based, pas de router) :               │
                         │  shop · product · search · builder · about          │
                         │  profile · desk* · master* · help(guide)* · legal   │
                         │  * = master only                                    │
                         │                                                     │
                         │  Fallback local : localStorage (○ local / ● API)    │
                         └───────────────┬──────────────────────┬──────────────┘
                                         │ /api/* (fetch JSON)  │ /photos/*, /assets/*
                    dev : Vite proxy     │  (même origine)      │  (statique)
                    ┌────────────────────┴─────────┐            │
                    │  DEV — vite :5173            │            │
                    │  proxy /api → 127.0.0.1:8787 │            │
                    └────────────────────┬─────────┘            │
                                         │                      │
        PROD : rewrites vercel.json ─────┤                      │
        /api/(.*) → /api   ·  SPA → /index.html                 │
                                         ▼                      ▼
        ┌──────────────────────────────────────────┐   ┌────────────────────────┐
        │  API Node 20 — server/index.js (673 L)   │   │  STATIC (repo → build) │
        │  node:http, zéro framework, serverless-  │   │  dist/ (Vite)          │
        │  ready (VERCEL_URL, req.body préparsé)   │   │  public/photos/        │
        ├──────────────────────────────────────────┤   │  · lib/   105 shots    │
        │ server/catalog.js   stock live, orders   │   │  · sku/   753 shots    │
        │ server/masterApi.js CRUD + CSV + upload  │   │  · legacy 56 + uploads │
        │ server/oauth.js     Google/Meta (démo)   │   │  robots.txt, sitemap   │
        │ server/db.js        store.json + scrypt  │   └────────────────────────┘
        │ server/rateLimit.js 20/min login, 15/min │
        │                ▼                          │
        │  ┌───────────────────────────────┐        │
        │  │ PERSISTENCE                   │        │
        │  │ local  : server/data/store.json│        │
        │  │ vercel : /tmp/pcstar-data/     │        │
        │  │          (éphémère — cold      │        │
        │  │           start peut reset)    │        │
        │  │ backups : au boot + 6 h +      │        │
        │  │          npm run backup + UI   │        │
        │  └───────────────────────────────┘        │
        └──────────────────────────────────────────┘
```

**Principe directeur :** le catalogue est **statique** (250 SKUs dans `src/data.js`, images dans le repo) → persiste sur Vercel sans base. La **donnée volatile** (users, orders, overrides stock, produits ajoutés) vit dans `store.json` → éphémère sur Vercel Hobby, durable en local. Le code est découpé pour brancher KV/Turso/Blob sans réécrire (`server/db.js` isole le fichier).

---

## 2. Frontend (`src/`)

| Fichier | Rôle |
|---------|------|
| `App.jsx` (1369 L) | Shell : nav, thème, langue, session, cart, résa, toast, API vs local |
| `data.js` (866 L) | **Catalogue 250 SKUs** (core + EXTRA + DZ_EXTRA), prix DA, specs, `specOf()` |
| `dzCatalog.js` | Marques marché algérien, guides, deals, wilayas, hints paiement |
| `extraCatalog.js` | SKUs supplémentaires (combos, services) |
| `productPhotos.js` | **3 photos/SKU déterministes** (hash id → rotation d'un pool par famille) |
| `i18n.js` (1172 L) | Traductions **ar (défaut, RTL) / fr / en** + helper `t()` |
| `orderLogic.js` | Validation résa : nom, téléphone DZ **05/06/07**, créneaux |
| `shopStore.js` | État boutique + fallback localStorage (`○ local`) |
| `media.js` | `specRows()` (table PDP), `relatedProducts()` (scoring compat + stock) |
| `BuilderPage.jsx` | Config PC : socket/mémoire/form factor, wattage, alertes surchauffe, presets |
| `SearchPage.jsx` | Filtres ligne/marque/prix, offcanvas mobile, 250 SKUs |
| `ProductPage.jsx` | PDP : galerie, zoom, specs, CTA sticky mobile, photos lazy + skeleton |
| `DeskPage.jsx` | Comptoir : résas, filtres statut, poll 20 s + beep + toast, print CSS, WA |
| `MasterPage.jsx` | Admin : CRUD produits, masquer, photos, clients, backup, CSV |
| `ProfilePage.jsx` | Profil : infos, commandes passées, changement de mot de passe, OAuth unlink |
| `AuthPanel.jsx` | Login/register + **boutons Google/Meta** + comptes démo (1 clic) |
| `LegalPage.jsx` | Garantie/RMA, conditions, confidentialité, contact (i18n) |
| `PartThumb.jsx` | `<picture>` WebP + lazy + sizes pour les vignettes |
| `api.js` | Client fetch : tous les `/api/*`, tokens, `oauthStart` |

**Routage :** navigation par état (`page`) — pas de dépendance router, pas de hash fragments (les ancres profondes sont gérées par le SEO/sitemap au niveau de la page unique).

**Thème :** ☀/☾/◐ (clair/sombre/système) via token CSS + `prefers-color-scheme`.

---

## 3. API (`server/`, port 8787)

Un seul fichier d'entrée `server/index.js` (routeur `node:http`), modules dédiés. **Aucune dépendance** (Node built-ins : `http`, `fs`, `crypto`, `path`).

### Endpoints

| Domaine | Endpoints |
|---------|-----------|
| Santé/config | `GET /api/health` · `GET /api/config` |
| Auth | `POST /api/auth/register` · `POST /api/auth/login` (rate-limit 20/min) · `POST /api/auth/logout` · `GET /api/me` · `PUT /api/me` · `POST /api/me/password` |
| OAuth | `POST /api/oauth/start` · `GET|POST /api/oauth/(google\|meta)/demo` (mode démo) · callbacks prod · `POST /api/oauth/unlink` |
| Catalogue | `GET /api/catalog` (stock live) · `GET /api/stock/:id` |
| Commandes | `GET|POST /api/orders` (rate-limit 15/min) · `PATCH /api/orders/:code` (statut) · `POST /api/orders/:code/cancel` (rollback stock) |
| Master | `GET|POST /api/master/products` · `PUT /api/master/products/:id` · `POST …/:id/hide` · `POST …/:id/photos` (dataURL ≤2.5 Mo, ≤6) |
| Export/ops | `GET /api/orders/export.csv?day=` · `POST /api/master/backup` |
| Clients | `GET /api/customers` · `DELETE /api/customers/:id` · `POST /api/master/customers/:id/reset-password` |
| Meta | `GET|PUT /api/meta` (panels, hidden) |
| Media serverless | `GET /api/upload-file` (serve `/tmp` uploads sur Vercel) |

### Sécurité

- **Mots de passe :** `scrypt` + salt 8 octets, `timingSafeEqual` ; vérification legacy `sha256` pour migration (seeds démo).
- **Rate limit :** buckets mémoire par IP (`server/rateLimit.js`) — login 20/min, orders 15/min.
- **CORS :** `FRONT_ORIGIN` (défaut `*` en démo ; sur Vercel auto depuis `VERCEL_URL`).
- **Headers :** `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`.
- **OAuth :** `state` aléatoire + `oauthPending` (login | link), unlink possible, `OAUTH_DEMO=1` par défaut (consent simulé, enregistre réel) ; réel si `OAUTH_DEMO=0` + clés.
- **Sécurité UI :** mots de passe démo jamais affichés ; page Guide master only.

### Données (`store.json`)

```jsonc
{
  "users":    [...],            // role: master | customer, links {google, meta}
  "sessions": { token: {userId, at} },
  "oauthPending": { state: {...} },
  "stock":    { "sku-…": 12 },  // overrides au-dessus du base (src/data.js)
  "orders":   [ {code "PS-20260910-0001", items, total, status, …} ], // cap 500
  "meta":     { extraProducts, hiddenProductIds, extraPanels, … }
}
```

---

## 4. Media (`public/photos/`)

| Pool | Fichiers | Usage |
|------|---------:|-------|
| `lib/` | 105 | shots famille (cpu-1..3, gpu-local-1..2, kb-1..3, …) — attribués aux 250 SKUs |
| `sku/` | 753 | shots par SKU (`{id}-1…3.jpg`) pour les produits prioritaires |
| legacy racine | 56 | `.jpg`/`.png` historiques (case, chair, cooler, …) |
| `uploads/` | — | photos master upload (dataURL) |

**Pipeline** :

```
scripts/ingestSkuPhotos.mjs   check / --fix / --webp  → 250+ SKU à 3 shots ≥800px
scripts/assignSkuPhotos.mjs   ré-attribution déterministe
src/productPhotos.js          hash(id) → pick3(pool famille) : les SKUs voisins
                              ne partagent PAS la même triple d'images
src/PartThumb.jsx             <picture> + WebP + loading="lazy" + sizes
vercel.json                   /photos/* Cache-Control max-age=86400
```

Ajout de photos pro (futur) : `public/photos/sku/{id}-1.jpg…-3.jpg` → `npm run photos:check` → push → rebuild. Aucune base ni VPS.

---

## 5. Vercel (sans VPS)

`vercel.json` :

```jsonc
{
  "framework": "vite",
  "buildCommand": "npm run build",   // → dist/
  "rewrites": [
    "/api/(*)" → "/api",                          // API serverless (même origine)
    "tout le reste (SPA)" → "/index.html"
  ],
  "headers": [
    "/assets/*"  → immutable 1 an (hash build),
    "/photos/*"  → max-age 86400,
    "/*"         → nosniff + referrer + frame
  ]
}
```

**Env (Settings → Environment Variables) :**

| Var | Rôle |
|-----|------|
| `FRONT_ORIGIN` | CORS (=`https://TON.app`) |
| `FRONT_URL` | liens sortants (WA, OG) |
| `OAUTH_REDIRECT_BASE` | redirect OAuth |
| `OAUTH_DEMO` | `1` par défaut (démo) · `0` + clés = réel |

**Limites honnêtes (Hobby, sans base cloud)** : `store.json` et uploads vivent dans **`/tmp`** → reset possible au cold start. Le **catalogue + photos (statiques) sont persistants**. Échappement prévu : Vercel KV / Turso / Blob — branchable via `server/db.js` sans toucher au reste. Détails : [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).

---

## 6. Flows clés

### 6.1 Réservation (multi-appareils)

```
Client (téléphone)                          Magasin (PC comptoir)
  │  panier → infos (05/06/07)                │
  │  POST /api/orders ───────────────►        │
  │  server : atomic placeOrder               │
  │    (toutes les lignes dispo ? sinon 409)  │
  │    stock -= qty · code PS-YYYYMMDD-XXXX   │
  │  ◄── { ok, order } ──────────────         │
  │  écran succès (code + maps + cash)        │  DeskPage : poll 20 s
  │                                           │  GET /api/orders → nouvelle résa
  │                                           │  beep + toast → statut →
  │  retrait au comptoir, espèces             │  PATCH /api/orders/:code (ready)
  │                                           │  → picked (stock déjà décrémenté)
```

### 6.2 OAuth (mode démo, défaut)

```
UI : bouton « Continuer avec Google/Meta »
  → POST /api/oauth/start {provider, intent}
  → { authorizeUrl: /api/oauth/google/demo?state=… }
  → écran de consent simulé (GET) → POST {identity}
  → server : find-or-create user, links[provider]=identity, session token
  → front : ?oauth_token=… → session active (profil, historique)
Reel : OAUTH_DEMO=0 + GOOGLE_CLIENT_ID/SECRET, META_APP_ID/SECRET
       → authorizeUrl Google/Facebook + callbacks /api/oauth/{p}/callback
```

### 6.3 Desk (tenue de comptoir)

```
DeskPage (master) : poll GET /api/orders 20 s
  diff vs avant → toast + beep
filtres : statut (new/preparing/ready/picked/cancelled), recherche tél/code
actions : PATCH statut · annulation (rollback stock) · WA link pré-rempli (code + créneau)
export : GET /api/orders/export.csv?day= (clôture de journée)
print  : CSS ticket (imprimante comptoir)
```

---

## 7. Développement local

```bash
npm install
npm run start:api    # node server/index.js → :8787
npm run dev          # vite → :5173 (proxy /api)
npm test             # node --test → 34 tests (store, orders, master, auth, crypto, API)
npm run smoke        # scripts/smoke-e2e.mjs : e2e complet de l'API (fetch)
npm run build        # bundle → dist/ (chunks react / bootstrap séparés)
npm run backup       # copie store.json → server/data/backups/
```

En dev, `FRONT_ORIGIN` par défaut = `*` (démo). En prod Vercel : `FRONT_ORIGIN=https://TON.app`.
