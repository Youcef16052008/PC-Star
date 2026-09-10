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

## Kept features

- Light / dark / system theme  
- PC builder + compatibility / overheat checks  
- Simple email accounts (customer + master)  
- Multi-device API: desk orders, master add/hide products  
- AR / FR / EN · DZ phones 05/06/07 · catalogue marché algérien  

## Removed

Avatars, accent colors, product compare, 3D orbit, Google/Meta OAuth, SMS demo.

## Deploy (Vercel, HTTPS, no VPS)

See **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**.

```bash
# one-shot CLI (optional)
npx vercel
npx vercel --prod
```

Set env: `FRONT_ORIGIN`, `FRONT_URL`, `OAUTH_REDIRECT_BASE` to your `https://….vercel.app`.
Photos: keep shipping under `public/photos/sku/` — add pro shots later, push, done.
