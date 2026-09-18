# PROMPT — Finaliser la mise en production PC Star (post-audit 2026-09-17)

> Copie ce texte tel quel dans ton agent. Il est autoporteur : l'agent n'a pas
> besoin de l'historique de la session.

---

## Contexte

Dépôt : `Youcef16052008/PC-Star`. La branche `arena/01a0b133-pc-star` porte la
remédiation **complète** de l'audit du 17/09/2026 (phases 1 à 7 du
`docs/PLAN-REMEDIATION-AUDIT-2026-09-17.md`), ouverte dans la **PR #8** vers
`main`. État de référence validé en local :

- `npm test` : 856 tests, 0 échec
- `npm run build` : OK, aucun secret dans le bundle
- `node scripts/smoke-e2e.mjs` : SMOKE OK 9/9 (API + front lancés)
- `node scripts/jsdom-crawl.mjs` : 36 pages rendues (3 langues × 13), 0 erreur
- `node --import ./scripts/test-env.mjs --test src/phase5Reliability.test.js` : 4/4
  (ce fichier n'est volontairement PAS dans la liste `npm test`)

Tout ce qui reste relève du **déploiement et du hors-code** : cela n'a pas pu
être fait dans l'environnement de développement (pas de clés OAuth/Neon/Blob,
CDN des navigateurs Playwright injoignable).

## Ta mission, dans l'ordre

### A. CI et vérifications AVANT fusion de la PR

1. Ajouter sur GitHub : `NEON_API_KEY` (secret Actions) et `NEON_PROJECT_ID`
   (variable de dépôt) pour que le workflow
   `.github/workflows/neon_workflow.yml` exécute réellement, sur la PR :
   migration → test de concurrence → snapshot → restauration sur une branche
   Neon isolée, puis la suite unitaire.
2. Sur une machine où le CDN Playwright est joignable :
   `npx playwright install chromium && npm run test:e2e`
   (la config `playwright.config.js` démarre API et front elle-même).
3. Relire la PR #8, attendre une CI Neon verte, **alors seulement** la fusionner.

### B. Déploiement Vercel

4. Variables Production côté serveur **uniquement** (jamais côté client/Vite) :
   `MASTER_EMAIL`, `MASTER_PASSWORD` (neuf), `DATABASE_URL` (chaîne Neon
   **pooled**), `BLOB_READ_WRITE_TOKEN`, `FRONT_URL`.
5. Avant le premier déploiement applicatif :
   `DATABASE_URL='postgresql://…' npm run db:migrate:neon`
   (crée `pcstar_state`, `pcstar_archived_orders`, `pcstar_backups`).
6. Domaine + HTTPS selon `docs/HEBERGEMENT-HTTPS.md` (Vercel recommandé :
   DNS + certificat automatiques ; vérifier `https://<domaine>/api/health`).

### C. OAuth réel (recette phases 1-2)

7. Enregistrer chez Google et Meta exactement ces URI de redirection :
   `https://<domaine-api>/api/oauth/google/callback`
   `https://<domaine-api>/api/oauth/meta/callback`
8. Variables : `OAUTH_DEMO=0`, `OAUTH_REDIRECT_BASE=https://<domaine-api>`,
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
   `META_APP_ID` / `META_APP_SECRET`.
9. Après déploiement : faire UN consentement réel par fournisseur ; vérifier
   qu'une clôture par le endpoint démo renvoie 404. Si une instance a tourné
   avec `OAUTH_DEMO=0` AVANT ce correctif : révoquer ses sessions existantes.

### D. Médias Master (phase 4)

10. Jouer la recette `docs/RECETTE-PHOTOS-MASTER.md` sur Vercel avec le token
    Blob : upload Master → affichage → redémarrage/cold start (l'image doit
    s'afficher via la résolution `blob.list()`) → remplacement (l'ancien objet
    doit être supprimé du stockage, jamais les visuels statiques `/catalog/`
    et `/photos/`).
11. Remplacer progressivement les illustrations de rayon par les VRAIES photos
    (ROADMAP 3.1, top 80 ventes d'abord) : fichiers `<sku>.jpg` dans
    `public/photos/` puis `npm run photos:check` / `--fix`, ou upload depuis
    l'administration Master. Charte : fond neutre, ≥ 1200 px, 3 angles/SKU,
    sans watermark. Les 27 `public/catalog/*-studio.jpg` restent valables en
    attendant (illustrations honnêtes, badge i18n) et se remplacent sans
    changement de code en gardant les mêmes noms de fichiers.

### E. Sauvegardes (phase 5)

12. Planifier un export régulier chiffré HORS Neon (cron) :
    `DATABASE_URL='…' npm run db:export:neon -- /sauvegardes/pcstar-<date>.json`
    (fichier 0600, jamais écrasé sans `--force --confirm-overwrite`).
13. Répéter une restauration sur une branche Neon AVANT d'en avoir besoin :
    `npm run db:restore:neon -- --backup <uuid> --confirm-restore`.

### F. Mise en exploitation (comptoir)

14. Confirmer/ajuster les prix et stocks des 78 références étendues depuis
    l'administration Master (ce sont des données de démonstration).
15. Former le comptoir au rattachement : commande sans compte → bouton
    « Code retrait » sur le Desk → dicter le code 8 caractères → le client le
    saisit dans « Mes commandes » depuis son compte (usage unique).
16. Après mise en production : rotation de `MASTER_PASSWORD` (les sessions
    maître sont révoquées automatiquement au redéploiement).
17. Mesurer Lighthouse en production (cible Perf mobile ≥ 90) ; ouvrir une
    branche dédiée pour les correctifs éventuels.

## Contraintes non négociables

- Aucune modification directe sur `main` : branche dédiée + PR, avec
  `npm test` et `npm run build` verts avant chaque fusion.
- Aucun secret dans le dépôt (`.env` reste gitignoré) ; ne jamais retirer les
  garde-fous (`--confirm-reset`, `--confirm-restore`, `--confirm-overwrite`,
  `PCSTAR_NEON_TEST_ISOLATED=1`) ni publier d'identifiants.
- Ne pas fusionner la PR #8 tant que la CI Neon et les tests ne sont pas verts.
- Les scripts Neon de test ne doivent cibler qu'une branche marquée isolée,
  jamais la base partagée.
