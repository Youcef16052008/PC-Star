# PC-Star

Boutique pickup **PC Star Informatique** — El Makari Les Castors, Oran.

## Run

```bash
npm install
npm run start:api   # backend :8787 (orders, auth, Google/Meta link)
npm run dev         # frontend :5173 (proxies /api → :8787)
npm test
npm run build
```

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Master | `pcstar.info31@gmail.com` | `star31` |
| Customer | `karim.oran@demo.dz` | `karim31` |
| Customer | `amina.castors@demo.dz` | `amina31` |
| Customer | `yacine.pc@demo.dz` | `yacine31` |

Also: SMS demo (05/06/07), **Google** and **Meta** link (demo consent pages when no OAuth secrets).

## Algeria-focused catalogue

~230+ SKUs including market brands: **Spirit of Gamer**, **Havit**, Gamemax, Raidmax, Twinmos, Magma, Xigmatek, Tenda, 1st Player, DeepCool…  
Prices in DA (indicative, aligned with LICB+ / Campus / Digitec / Hardsoft ranges).  
Checkout: Mobilis / Ooredoo / Djezzy only · wilaya · cash / CCP / BaridiMob / 3x.

## Google & Meta linking

- Profile → Link Google / Link Meta (requires API).
- Demo mode by default (`OAUTH_DEMO` not `0`).
- Production env:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
META_APP_ID=...
META_APP_SECRET=...
OAUTH_REDIRECT_BASE=https://your-api.dz
OAUTH_DEMO=0
FRONT_URL=https://your-shop.dz
```

## Stack

- React + Vite front
- Node HTTP API (`server/`) + JSON file DB (`server/data/`, gitignored)
- AR / FR / EN · light/dark · master desk · local fallback if API down
