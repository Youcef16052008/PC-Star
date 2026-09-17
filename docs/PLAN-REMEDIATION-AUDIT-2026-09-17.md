# Plan de remédiation — audit du 17 septembre 2026

## Objectif et règle de conduite

Ce plan traite les constats confirmés de l’audit, dans l’ordre du risque réel. Une phase n’est considérée terminée que lorsque :

1. le correctif est appliqué côté serveur et côté client si le flux le requiert ;
2. un test de régression couvre le scénario d’exploitation ou d’échec ;
3. les variables de déploiement, scripts ou documents concernés sont alignés ;
4. les données existantes et le déploiement nécessaire sont explicitement pris en compte.

Les changements sont découpés pour qu’un correctif de sécurité urgent ne soit pas retardé par une migration plus large.

| Phase | Priorité | Périmètre | Critère de sortie |
|---|---:|---|---|
| 1 — Confinement OAuth | P0 | Désactiver réellement le consentement démo quand `OAUTH_DEMO=0`; ne plus rediriger vers une démo lorsqu’un fournisseur réel n’est pas configuré; tests de non-régression. | Un état OAuth de production ne peut jamais être clôturé par `/demo`; un fournisseur non configuré répond proprement sans créer d’état. |
| 2 — OAuth réel et cycle de vie des accès | P1 | Ajouter les callbacks Google/Meta réels, échange de code et validation d’identité; expiration effective des sessions et états OAuth sous Neon; empêcher tout lien OAuth du maître; corriger la rotation maître. | OAuth réel aboutit avec un fournisseur de test; états consommés une seule fois et expirés; rotation maître vérifiée après redémarrage. |
| 3 — Propriété du compte et intégrité des commandes | P1 | Vérifier la possession du téléphone avant la reprise des commandes guest; agrégation des lignes; contrôle de capacité avant décrément; idempotence de réservation; revalidation transactionnelle d’annulation. | Aucun compte ne récupère une commande par simple possession déclarée du numéro; stock et commande restent atomiques dans tous les cas de refus/rejeu. |
| 4 — Catalogue et médias Master | P1/P2 | Corriger le remplacement de galerie, la suppression des anciens fichiers, la résolution Blob et la CSP; valider nombres finis et SKU sur création/patch. | Ajout/retrait de photos ne perd rien et ne laisse pas d’objet géré orphelin; une photo Blob s’affiche sur Vercel; aucune fiche invalide/doublon ne peut être enregistrée. |
| 5 — Fiabilité production et sauvegardes | P1/P2 | Sauvegarde/export Neon durable, CI réellement exécutée contre Neon, scripts non destructifs ou isolés. | Une restauration Neon est testée; la CI échoue si Neon échoue; les scripts de contrôle ne polluent pas une base partagée. |
| 6 — Cohérence produit et interface | P2/P3 | Compatibilité mATX/boîtier, noms/SKU de commandes canonisés, date serveur, contrat des panneaux. | Le configurateur n’offre plus de combinaisons impossibles et les vues/exportations restent cohérents. |
| 7 — Outillage et recette finale | P2/P3 | Éliminer l’injection shell, corriger smoke/crawl/Playwright, exécuter build, tests et E2E avec dépendances installées. | Les scripts documentés existent, sont non destructifs et échouent correctement; build, tests et E2E sont verts. |

## Phase 1 — Confinement OAuth

**Statut : correctif et test de régression ajoutés. La validation HTTP complète est à exécuter dès que les dépendances du dépôt sont installées (`ws` est actuellement absent de l’environnement de travail). La vérification ciblée de la logique OAuth a été exécutée avec succès.**

### Changements prévus

- Considérer le mode démo comme une décision explicite au moment de démarrer un flux OAuth.
- Si `OAUTH_DEMO=0`, refuser un fournisseur dont les identifiants ne sont pas configurés, avant de créer un `state` persistant.
- Protéger à la fois la route HTTP de démonstration et `completeDemo()` afin qu’une future route ne puisse pas rouvrir la vulnérabilité.
- Répondre par 404 sur les routes démo désactivées afin de ne pas laisser un endpoint de connexion exploitable.
- Ajouter une régression qui simule exactement l’ancien scénario : OAuth réel configuré, mode démo désactivé, état produit, puis tentative de clôture par le formulaire démo avec l’e-mail d’un client.

### Action de déploiement requise

- Ne pas passer `OAUTH_DEMO` à `0` avant la phase 2, qui apportera les callbacks réels.
- Si une instance a déjà tourné avec `OAUTH_DEMO=0` avant ce correctif, révoquer ses sessions existantes après le déploiement. Les sessions émises pendant la fenêtre d’exposition ne sont pas distinguables des autres sessions historiques ; le contrôle de TTL Neon est traité en phase 2.

### Limite assumée de la phase

À la clôture de la phase 1, les callbacks Google et Meta réels n’existaient pas encore dans le dépôt. Ils relevaient de la phase 2 : la phase 1 fermait la prise de compte sans prétendre rendre le flux réel fonctionnel.

## Phase 2 — OAuth réel et cycle de vie des accès

**Statut : implémentation et tests unitaires isolés ajoutés. La validation avec des applications Google/Meta de production reste une action de déploiement, car elle exige leurs identifiants et des URI de redirection enregistrées.**

### Changements livrés

- `GET /api/oauth/google/callback` et `GET /api/oauth/meta/callback` échangent le `code` côté serveur avec un délai borné de 10 secondes, puis demandent le profil à l’endpoint officiel. Aucun code, access token ou détail de réponse fournisseur n’est renvoyé au navigateur ou écrit dans les logs applicatifs.
- Google exige `email_verified: true`; Meta exige un e-mail reçu du profil et utilise Graph API `v26.0` (override validé `META_GRAPH_VERSION` pour une future montée de version). Un refus ou une erreur fournisseur consomme aussi le `state`, afin qu’il ne puisse pas être rejoué.
- Le `state` est relu, vérifié contre son fournisseur et supprimé **dans** `updateDbAsync`. Le verrou de ligne Neon rend donc la création de session et la consommation atomiques face à deux callbacks concurrents.
- `findSession()` applique désormais le TTL de sept jours à chaque authentification, indépendamment de la prochaine purge persistée. `normalizeDb()` applique les mêmes TTL lors des lectures/mutations Neon; les scripts d’import et migration normalisent également l’état enregistré.
- Le maître ne peut ni initier ni terminer ni modifier un lien OAuth. Les liens historiques Google/Meta de ce compte sont purgés. Une identité fournisseur déjà associée à un autre utilisateur est refusée.
- La normalisation vérifie désormais le mot de passe maître configuré même lorsque son hash a été migré en scrypt. Une rotation de `MASTER_EMAIL` ou `MASTER_PASSWORD` aligne le compte et révoque exclusivement ses sessions.

### Action de déploiement requise

1. Configurer `OAUTH_DEMO=0`, `OAUTH_REDIRECT_BASE=https://<domaine-api-public>`, et les paires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `META_APP_ID` / `META_APP_SECRET` dans l’environnement serveur — jamais côté Vite/client.
2. Enregistrer exactement les URI suivantes chez les fournisseurs, avec le même domaine et le même schéma HTTPS :
   - `https://<domaine-api-public>/api/oauth/google/callback`
   - `https://<domaine-api-public>/api/oauth/meta/callback`
3. Exécuter un consentement réel par fournisseur après déploiement, puis retirer/révoquer les sessions émises avant le correctif si l’instance a été exposée. La rotation de `MASTER_PASSWORD` révoque automatiquement les sessions maître; la révocation globale des sessions historiques reste une opération d’administration séparée.
