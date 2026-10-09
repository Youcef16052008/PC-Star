# Plan de remédiation — audit du 17 septembre 2026

> **Journal daté — ses chiffres sont ceux du jour, pas l'état du dépôt.** Ce
> document est une trace : on ne le réécrit pas quand il est contredit plus tard,
> parce qu'effacer une conclusion fausse efface aussi la raison pour laquelle
> elle était fausse.
> Au fil des lots, plusieurs nombres et commandes ci-dessous ont été
> dépassés. L'état mesuré d'aujourd'hui est dans
> [`../README.md`](../README.md) (« État mesuré »), la suite des sessions
> dans [`BUGS-AND-FIXES.md`](BUGS-AND-FIXES.md). Les docs **exécutables** (guides,
> recettes, prompts d'agent, `docs/README.md`) ont, elles, été corrigées — c'est
> `src/p3DocsAging.test.js` qui verrouille les deux régimes.


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
| 3 — Propriété du compte et intégrité des commandes | P1 | Bloquer la reprise guest jusqu’à une preuve OTP réellement disponible; agrégation des lignes; contrôle de capacité avant décrément; idempotence de réservation; revalidation transactionnelle d’annulation. | Aucun compte ne récupère une commande par simple possession déclarée du numéro; stock et commande restent atomiques dans tous les cas de refus/rejeu. |
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

## Phase 3 — Propriété du compte et intégrité des commandes

**Statut : implémentation et tests unitaires ajoutés. Complément livré : le rattachement inter-appareil existe désormais par UNE preuve réelle — le code de retrait à usage unique émis au comptoir (`POST /api/orders/:code/claim-code`, saisie client `POST /api/me/orders/claim`). Le code est haché en base, dicté une seule fois, consommé dans la mutation de rattachement, et borné par un rate limit ; une commande annulée ou retirée ne peut plus être codée ni rattachée.**

### Changements livrés

- Le numéro communiqué pour le retrait n’est plus jamais utilisé comme preuve de propriété : `GET /api/me/orders` et l’annulation client ne servent que les commandes dont `userId` correspond déjà à la session. Toutes les commandes guest, y compris l’historique normalisé, portent `claimable: false`.
- Aucun service OTP/SMS réellement configuré n’existe dans le projet. Plutôt que de simuler une vérification de téléphone, la récupération inter-appareil d’une commande guest est volontairement indisponible. Elle reste visible dans le stockage local de l’appareil guest avant connexion; un futur rattachement devra exiger une preuve OTP effectivement délivrée.
- Les lignes du même produit sont agrégées avant le contrôle de stock; une quantité totale insuffisante refuse l’intégralité de la réservation sans décrément.
- Une clé d’idempotence opaque est générée par le client pour chaque intention de réservation. Le serveur ne persiste que ses empreintes, renvoie la commande initiale lors d’un retry identique et refuse une réutilisation de clé pour un panier différent.
- La capacité maximale de commandes est vérifiée avant toute mutation de stock. L’annulation client revalide maintenant dans la même transaction la propriété de la commande et son statut `new`/`pending` avant le restock.

### Critère de sortie atteint

Un compte ne récupère ni n’annule une commande guest par simple déclaration de numéro; un retry de réservation ne double pas le stock; une commande refusée parce que l’historique est plein ne change pas le stock.

## Phase 4 — Catalogue et médias Master

**Statut : implémentation et tests unitaires isolés ajoutés. Complément livré : la recette de déploiement médias est documentée ([RECETTE-PHOTOS-MASTER.md](./RECETTE-PHOTOS-MASTER.md)) — scénario upload → affichage → cold start → remplacement → cleanup, et inventaire des 36 visuels de rayon qui habillent les 78 nouvelles références (aucun visuel générique : chaque rayon a sa photo : laser, encre, tickets, scanners, toners, papier, routeurs, onduleurs, laptops gaming/pro, tablettes, vidéoprojecteur, écrans, serveurs, tout-en-un, douchettes, création).**

### Changements livrés

- La galerie reçue par les routes Master est maintenant une liste finale explicite : les chemins conservés sont combinés avec les nouvelles data URLs, puis bornés. Un ancien client qui ne transmet que de nouvelles images conserve la galerie existante au lieu de l’écraser.
- Après une écriture catalogue réussie, les uploads qui ne sont plus référencés — y compris une nouvelle image écartée par la limite de galerie — sont supprimés. Les photos statiques et les URL qui ne sont pas gérées par PC Star ne sont jamais candidates à cette suppression.
- Les photos Vercel Blob restent référencées en base par le chemin relatif du proxy. Après un cold start, le serveur retrouve l’objet par son `pathname` exact avec `blob.list()` et redirige vers son URL publique. La suppression Blob cible le pathname, sans passer une promesse ou un faux lien de téléchargement au SDK.
- Les CSP de l’API et de Vercel autorisent étroitement le CDN public Vercel Blob, nécessaire à la destination de redirection d’une image, sans ouvrir `img-src` à tous les hôtes.
- La création et le patch produit refusent désormais les prix/stocks non finis, les SKU vides ou hors format, et les collisions de SKU lors d’un renommage. Les listes de photos sont dédoublonnées avant persistance.

### Action de déploiement requise

Configurer `BLOB_READ_WRITE_TOKEN` sur Vercel avant de permettre les uploads Master. En environnement serverless sans ce token, le refus explicite `upload_storage` est conservé : aucune URL éphémère de `/tmp` n’est enregistrée. Une recette de déploiement doit charger une photo, redémarrer/froidir la fonction puis vérifier son affichage et sa suppression.

### Critère de sortie atteint côté code

Le remplacement d’une galerie ne laisse pas de fichier local géré orphelin; une résolution Blob ne tente plus de convertir un simple pathname avec `getDownloadUrl`; aucune fiche produit ne peut être enregistrée avec un nombre non fini ou un SKU déjà employé.

## Phase 5 — Fiabilité production et sauvegardes

**Statut : implémentation et gate CI Neon ajoutés. L’exécution de la branche Neon réelle reste conditionnée aux secrets GitHub du projet.**

### Changements livrés

- Une sauvegarde ne copie plus silencieusement `store.json` lorsque `DATABASE_URL` sélectionne Neon : le bouton Master, le démarrage et `npm run backup` créent un snapshot transactionnel dans `pcstar_backups`, borné aux 30 plus récents.
- Une restauration est disponible uniquement par CLI, avec UUID de snapshot et `--confirm-restore`; aucune route HTTP destructrice n’est exposée. `db:export:neon` produit aussi un JSON à permissions `0600`, réimportable et destiné à être stocké hors du projet Neon.
- `db:migrate:neon --reset` et `db:import:neon --force` refusent désormais de s’exécuter sans leur confirmation explicite. Les scripts d’intégration Neon refusent une base non marquée `PCSTAR_NEON_TEST_ISOLATED=1`.
- La CI de PR crée une branche Neon isolée, vérifie migration, concurrence, snapshot puis restauration, et n’exécute les mutations de test qu’avec cet opt-in. La suite unitaire conserve ses fixtures fichier : elle ne prétend plus être une suite Neon.
- `db:doctor` vérifie également la table et l’âge des snapshots.

### Action de déploiement requise

1. Renseigner `NEON_PROJECT_ID` (variable de dépôt) et `NEON_API_KEY` (secret Actions), puis ouvrir une PR pour vérifier le workflow Neon.
2. Configurer `DATABASE_URL` pooled sur Vercel et lancer `npm run db:migrate:neon` avant le déploiement applicatif.
3. Planifier un `db:export:neon` régulier vers un stockage chiffré hors Neon : les snapshots Neon facilitent un rollback, mais ne remplacent pas une sauvegarde indépendante du fournisseur.
4. Répéter sur une branche Neon le scénario de restauration avant de l’utiliser en production.

### Critère de sortie atteint côté code

Le chemin de sauvegarde suit le driver réellement actif; les scripts mutateurs exigent une intention explicite ou une branche de test marquée isolée; le workflow contient un test réel snapshot → mutation → restauration qui fait échouer la CI si Neon échoue.

## Phase 6 — Cohérence produit et interface

**Statut : livré et testé.**

### Changements livrés

- Compatibilité boîtier ↔ carte mère : UNE règle partagée `caseFitsBoard()` (src/data.js) utilisée par le configurateur et les tests — une carte mATX tient partout, une carte ATX exige un boîtier ATX, un boîtier sans format déclaré n'est plus proposé dès qu'une contrainte existe. Le catalogue vend désormais du mATX (carte mère ASRock B450M AM4 + deux boîtiers Havit et Cooler Master) : le filtre n'vide plus le rayon.
- Garde resserrée : `checkCompatibility` ne classe plus comme « boîtier » un produit qui n'est pas de catégorie `case` (un GPU avec `compat.form` ne se comparait plus lui-même comme boîtier).
- Noms et SKU de commandes canonisés : `placeOrder` impose la référence du catalogue serveur (`productRefOf`, même précédence que le prix : override maître > produit maître > base). Le panier ne peut plus injecter un libellé arbitraire dans les commandes, le desk ou l'export CSV ; le texte du client ne survit que dans les messages de refus des ids inconnus.
- Date serveur confirmée : `at` est estampillé ISO par le serveur ; le `day` de retrait reste la journée locale du client (décision P9), validée par format.
- Contrat des panneaux : validation API inchangée et testée (types, dédoublonnage, borne 12 panneaux supplémentaires).

### Tests

`src/phase6Coherence.test.js` (8 tests, ajouté à `npm test`) : règle boîtier/carte dans les deux sens, présence mATX au catalogue, chaque carte ATX garde un boîtier compatible, canonisation client/override/refus, horodatage serveur.

## Phase 7 — Outillage et recette finale

**Statut : livré et exécuté dans l'environnement de travail ; la recette Playwright réelle reste à rejouer là où le CDN des navigateurs est joignable.**

### Changements livrés

- Injection shell éliminée : `scripts/assignSkuPhotos.mjs` n'utilise plus `execSync` avec interpolation (un `$()` dans un nom de fichier s'exécutait malgré `JSON.stringify`) — `execFileSync('convert', [...])`, plus aucun appel shell dans `scripts/`.
- `scripts/smoke-e2e.mjs` : le comptage du catalogue n'est plus figé sur 222/223 ; la borne suit le catalogue réel (`PRODUCTS`, marge 20 % pour un serveur déjà utilisé). Exécution réelle : **SMOKE OK 9/9** (health, catalogue 300/300, inscription, commande, me/orders, login maître, oauth-start, front, robots).
- Crawl : `npm run build:crawl` OK ; recette `scripts/jsdom-crawl.mjs` : **36 pages rendues (3 langues × 13 pages), 0 erreur**.
- `npm test` : 856+ tests verts ; `npm run build` : OK, aucun secret.

### Action restante (environnement)

Le téléchargement du navigateur Playwright est bloqué dans l'environnement de travail (CDN injoignable). Sur un poste ou en CI avec accès réseau : `npx playwright install chromium && npm run test:e2e`. La configuration (`playwright.config.js`) et le scénario (`e2e/smoke.spec.js`) sont en place ; les serveurs sont démarrés par la config.
