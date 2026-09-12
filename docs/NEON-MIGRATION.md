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

## État exact

Cette étape crée le schéma, mais **ne remplace pas encore** les appels synchrones à `server/db.js`. Le déploiement ne doit donc pas être annoncé comme persistant tant que les étapes suivantes ne sont pas faites :

1. adapter `readDb`/`updateDb` en opérations asynchrones Neon ;
2. transaction `SELECT ... FOR UPDATE` pour stock/commande ;
3. import contrôlé de `store.json` ;
4. tests de concurrence sur Neon ;
5. suppression du chemin `/tmp` en production ;
6. stockage objet séparé pour les photos uploadées.

Cette séparation est volontaire : prétendre que le simple ajout d'une table a rendu l'API durable serait faux.
