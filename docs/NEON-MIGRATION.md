# Neon Postgres — exploitation et reprise

Neon est le fournisseur de persistance de production. `DATABASE_URL` doit être
la **pooled connection string** (`…-pooler…`) et ne doit jamais être commitée.

## Initialiser une branche

```bash
DATABASE_URL='postgresql://…' npm run db:migrate:neon
```

La migration crée :

- `pcstar_state` : état applicatif JSONB, protégé par verrou de ligne pour les
  mutations;
- `pcstar_archived_orders` : commandes archivées;
- `pcstar_backups` : snapshots transactionnels de `pcstar_state`.

Le serveur et `npm run backup` détectent `DATABASE_URL` : ils créent alors un
snapshot Neon borné aux 30 plus récents, plutôt que de copier le `store.json`
local ou le `/tmp` éphémère de Vercel. Le bouton Master « Sauvegarde » échoue
explicitement si ce snapshot ne peut pas être créé; il ne prétend pas avoir
sauvegardé une base Neon dans un fichier local.

## Import initial depuis un fichier local

Après migration, importer volontairement une copie locale :

```bash
DATABASE_URL='postgresql://…' npm run db:import:neon -- server/data/store.json
```

Le script refuse d'écraser un état existant. Un remplacement exige deux
signaux explicites, après export vérifié :

```bash
DATABASE_URL='postgresql://…' npm run db:import:neon -- server/data/store.json --force --confirm-overwrite
```

## Sauvegarde hors Neon et restauration

Les snapshots `pcstar_backups` permettent le retour arrière opérationnel, mais
ne protègent pas contre la perte du projet Neon entier. Exporter régulièrement
une copie chiffrée vers le coffre ou le stockage de sauvegarde de l'exploitant :

```bash
DATABASE_URL='postgresql://…' npm run db:export:neon -- /safe/backup/pcstar-2026-09-17.json
```

Le fichier est créé en permissions `0600` et n'est jamais écrasé par défaut.
L'export est une forme `store.json` directement réimportable. Il contient des
hashes de mots de passe et d'autres données clients : ne pas le joindre à une
issue, un e-mail non chiffré ou au dépôt.

Pour restaurer un snapshot Neon, relever son UUID dans les logs du bouton
Master ou de `npm run backup`, puis confirmer explicitement :

```bash
DATABASE_URL='postgresql://…' npm run db:restore:neon -- --backup <snapshot-uuid> --confirm-restore
```

La restauration remplace l'état applicatif par le snapshot sous verrou. Elle
est volontairement absente de l'API HTTP : seul un opérateur terminal peut la
confirmer. Tester d'abord la procédure sur une branche Neon, puis exporter la
production avant toute restauration.

## Scripts destructifs et intégration Neon

`db:migrate:neon:reset` ajoute automatiquement `--confirm-reset`, mais appeler
`node scripts/neon-migrate.mjs --reset` sans cette confirmation échoue. Le reset
supprime l'état, les archives et les snapshots; il est réservé aux branches
éphémères.

Les scripts `test:neon:concurrency` et `test:neon:backup` refusent toute base
qui n'a pas l'opt-in `PCSTAR_NEON_TEST_ISOLATED=1`. Cette valeur ne doit être
posée que pour une branche de test temporaire. Ils valident respectivement le
verrou de réservation et un cycle snapshot → mutation → restauration.

`.github/workflows/neon_workflow.yml` crée une branche Neon dédiée à chaque PR,
y exécute migration, concurrence et restauration, puis remet cette branche à
zéro avant la suite unitaire isolée. Ces gates utilisent les secrets
`NEON_API_KEY` et la variable de dépôt `NEON_PROJECT_ID`; une panne Neon fait
échouer la CI. La branche est supprimée à la fermeture de la PR.

### « Create Neon Branch » échoue en quelques secondes

Le journal du job dit seulement que l'action a échoué. Trois causes demandent
trois gestes différents, et rien ne les sépare — d'où un pas de diagnostic posé
**avant** la tentative (`Inventaire des branches Neon`, `continue-on-error` : il
informe, il ne décide pas du vert) qui imprime le code HTTP de l'API Neon et la
liste des branches existantes. Ce pas tourne **avant le checkout** : il n'appelle
donc pas le dépôt, il interroge l'API en shell (`curl` et `jq` sont préinstallés
sur l'image du runner). Le même constat sort en **annotation de check**
(`::notice::` / `::warning::`) : il se lit dans l'onglet Checks du PR, sans ouvrir
le journal du job :

| Ce que le diagnostic montre | Ce qui se passe | Le geste |
| --- | --- | --- |
| HTTP 401 | `NEON_API_KEY` révoquée ou expirée | régénérer la clé côté Neon, la recoller dans le secret de dépôt |
| HTTP 404 | `NEON_PROJECT_ID` ne vise plus le projet | corriger la **variable** de dépôt (pas le secret) |
| HTTP 200 et ~10 branches `preview/*` | plafond de branches du plan | supprimer les `preview/pr-*` dont la PR est fermée |
| réseau injoignable | panne côté Neon | réessayer le job |
| HTTP 422 à l'étape suivante, avec un inventaire à 10 branches | plafond du plan atteint | supprimer les `preview/pr-*` orphelines |

Mesuré sur ce dépôt : l'inventaire annonce **10 branches dont 8 `preview/*`** — le projet est pile
au plafond du plan gratuit (10 branches), et la création échoue en `422` (l'API Neon répond
`BRANCH_LIMIT_EXCEEDED` sous ce code). Une branche de PR est supprimée à la fermeture de la PR :
celles qui restent viennent de PR restées ouvertes, ou d'avant la pose de la date d'expiration.

Le même inventaire se lit depuis un poste, sans passer par la CI :

```bash
NEON_API_KEY='…' NEON_PROJECT_ID='…' npm run db:branches:neon
```

Le script n'écrit rien : ni création, ni suppression. Il faut environ dix
branches de PR pour saturer un plan gratuit ; les branches portent une date
d'expiration, mais une branche créée avant la mise en place de ce réglage n'en a
pas — c'est celle-là qu'il faut supprimer à la main.

## Diagnostiquer « plus de produits »

```bash
DATABASE_URL='postgresql://…' npm run db:doctor
```

Le diagnostic ne montre jamais le mot de passe de la chaîne et vérifie :

1. l'endpoint pooled et la connectivité lecture/écriture;
2. les tables de l'état, des archives et des snapshots;
3. `updated_at`, stock, produits masqués, produits supplémentaires et produits
   effectivement publics;
4. le nombre et la date du dernier snapshot Neon.

Même diagnostic en ligne, sans terminal : `GET /api/db/status` (master
connecté). Une base injoignable ne vide pas la vitrine : l'API sert le catalogue
de base avec `degraded: true` et le site affiche un bandeau. Voir
[BUGS-AND-FIXES.md#p12--b25](./BUGS-AND-FIXES.md).
