# Hébergement HTTPS — options pour PC Star Oran

Case « HTTPS — doc hébergeur » de la ROADMAP (phase 4.3). Le projet est conçu
pour **Vercel sans VPS** (API serverless + front statique), mais deux chemins
sont documentés. Dans tous les cas : le site sert le front en HTTPS, l'API est
appelée depuis le front via la même origine ou un domaine API dédié, et
`FRONT_URL` (API) doit être l'URL HTTPS réelle du front.

## Option A — Vercel (recommandée, zéro VPS)

1. Importer le dépôt dans Vercel ; le build `vite build` et la fonction
   `api/index.js` (wrapper de `server/index.js`) sont détectés.
2. Configurer les variables Production listées dans `.env.example` :
   `MASTER_EMAIL` / `MASTER_PASSWORD` (obligatoires), `DATABASE_URL` (Neon
   **pooled**), `BLOB_READ_WRITE_TOKEN`, `FRONT_URL`, `OAUTH_DEMO=0` et les
   paires Google/Meta quand la phase 2 du plan d'audit est mise en prod.
3. Domaine : acheter `pcstar-oran.dz` (ou `.com`) chez un registrar, ajouter le
   domaine dans Vercel → Settings → Domains, pointer les DNS (A 76.76.21.21 ou
   CNAME `cname.vercel-dns.com`). Le certificat TLS est émis et renouvelé
   automatiquement par Vercel (Let's Encrypt géré).
4. Callbacks OAuth à enregistrer chez Google/Meta avec CE domaine :
   `https://<domaine>/api/oauth/google/callback` et
   `https://<domaine>/api/oauth/meta/callback`.
5. Vérifier `https://<domaine>/api/health` puis passer un test complet :
   recherche → builder → réservation → code PS au comptoir.

## Option B — VPS/hébergeur classique (o2switch, Hostinger, contabo…)

1. Node 20+, `npm ci`, `npm run build`, l'API derrière un reverse proxy Nginx
   ou Caddy avec `proxy_pass http://127.0.0.1:8787` (le serveur écoute sur le
   port défini par `PORT`, 8787 par défaut).
2. TLS : `certbot --nginx -d <domaine>` (Let's Encrypt, renouvellement auto)
   ou Caddy qui gère HTTPS nativement.
3. Persistance : `store.json` survit au redémarrage (contrairement à `/tmp`
   Vercel) ; Neon reste possible/recommandé via `DATABASE_URL`.
4. Service : `systemd` (Restart=always) ou `pm2 start server/index.js --name
   pcstar-api`. Front statique servi par Nginx depuis `dist/`.

## Contrôles post-mise en ligne

- [ ] `curl -I https://<domaine>` → 200 + `Strict-Transport-Security` si activé
- [ ] `https://<domaine>/api/health` → `{ ok: true }`
- [ ] Aucun appel `http://` dans le front (contenu mixte bloqué par les
      navigateurs) — tous les chemins sont relatifs par conception
- [ ] Sauvegardes : `npm run backup` planifié (cron) ou snapshot Neon vérifié
- [ ] Rotation `MASTER_PASSWORD` après la mise en production
