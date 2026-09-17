# Neon Postgres — étape 1

Neon est le fournisseur retenu pour la persistance de production.

## Préparer Neon

1. Créer un projet Neon.
2. Copier la chaîne pooled `DATABASE_URL` dans l'environnement local uniquement.
3. Ne jamais committer cette valeur.
4. Exécuter :

```bash
DATABASE_URL='postgresql://...' npm run db:migrate:neon
```

La migration crée `pcstar_state`, une ligne JSON versionnée par `updated_at`. Cette forme conserve temporairement le modèle actuel et réduit le risque de migration destructive.

## CI (GitHub Actions) — `.github/workflows/neon_workflow.yml`

Le job « Create Neon Branch » enchaîne, sur la branche d'aperçu créée pour la
PR : **migration**, test de **concurrence**, remise à zéro (`--reset`), puis la
**suite complète** — les quatre avec `DATABASE_URL` seule.

C'est possible parce que `server/db.js` **ne résout plus le compte maître au
chargement** (LOT 1.20) : `masterAccountOrNull()` le résout à la demande, et les
scripts de base (migration, import, diagnostic, concurrence) n'ont donc besoin
d'aucun `MASTER_*` pour travailler sur le schéma et l'état. Avant ce correctif,
la première étape échouait **dès l'import** en `Error: [pcstar] compte maître non
configuré — MASTER_EMAIL et MASTER_PASSWORD sont obligatoires` — avant même son
propre contrôle de `DATABASE_URL` — et les trois étapes suivantes ne
s'exécutaient **jamais** (`needs` ne lie que les jobs ; les étapes d'un même job
s'enchaînent jusqu'à la première qui échoue). La commande documentée ci-dessus,
`DATABASE_URL='…' npm run db:migrate:neon`, était cassée pour la même raison.

Deux conséquences à garder en tête :

1. **Ne pas** ajouter `MASTER_EMAIL` / `MASTER_PASSWORD` aux secrets de ce
   workflow pour « faire passer » la migration : ces étapes n'ouvrent aucune
   session, et poser un secret de production dans la CI d'une PR est exactement
   ce que le lot 0 doit éviter. Un import de `server/db.js` sans configuration
   maître est désormais un cas **supporté**.
2. La dernière étape (`npm test`) fournit elle-même sa configuration maître de
   test via `scripts/test-env.mjs` (posée avant le chargement du `.env`) : la CI
   n'a rien à fournir.

Non-régression : `src/lot1BaseScripts.test.js` — les quatre commandes de scripts
démarrent sans `MASTER_*` et sortent avec **leur** message, jamais avec celui du
compte maître ; `masterAccount()` continue de lever (verrou LOT 1.1).

## Importer les données locales

Après avoir créé la table sur la branche de production, importer une base locale explicitement :

```bash
DATABASE_URL='postgresql://...' npm run db:import:neon -- server/data/store.json
```

Le script refuse d'écraser une base qui contient déjà un état. Pour remplacer volontairement l'état après sauvegarde :

```bash
DATABASE_URL='postgresql://...' npm run db:import:neon -- server/data/store.json --force
```

Ne lance jamais `--force` sur la production sans export préalable.

## Diagnostiquer « plus de produits »

```bash
DATABASE_URL='postgresql://…' npm run db:doctor
```

Le script répond à la seule question qui compte : la base est-elle
**injoignable** ou **vide** ?

1. **Chaîne** : endpoint `-pooler` ou direct (le driver HTTP des lectures ne
   parle qu'au pooler — avec l'endpoint direct, les écritures passent et les
   lectures tombent).
2. **Connectivité** : lectures (HTTP) et écritures (Pool TCP) testées
   séparément, avec latence.
3. **Schéma** : `pcstar_state` / `pcstar_archived_orders` présentes ?
4. **État** : `updated_at`, users, commandes, `extraProducts`,
   `hiddenProductIds`, overrides de stock (dont ceux à 0).
5. **Verdict** : nombre de produits réellement servis au client, et la cause si
   ce nombre est 0 (tout masqué / tout en rupture / table vide).

Même diagnostic en ligne, sans terminal : `GET /api/db/status` (master
connecté). Le mot de passe de la chaîne n'est jamais affiché.

Depuis P12 (B25), une base injoignable ne vide plus la vitrine : l'API sert le
catalogue de base avec `degraded: true` et le site affiche un bandeau
« Base de données injoignable ». Voir
[BUGS-AND-FIXES.md#p12--b25](./BUGS-AND-FIXES.md).

## État exact

Cette étape crée le schéma, mais **ne remplace pas encore** les appels synchrones à `server/db.js`. Le déploiement ne doit donc pas être annoncé comme persistant tant que les étapes suivantes ne sont pas faites :

1. adapter `readDb`/`updateDb` en opérations asynchrones Neon ;
2. transaction `SELECT ... FOR UPDATE` pour stock/commande ;
3. import contrôlé de `store.json` ;
4. tests de concurrence sur Neon ;
5. suppression du chemin `/tmp` en production ;
6. stockage objet séparé pour les photos uploadées.

Cette séparation est volontaire : prétendre que le simple ajout d'une table a rendu l'API durable serait faux.
