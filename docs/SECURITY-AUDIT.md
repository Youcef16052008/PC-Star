# PC Star — audit sécurité et limites de validation

Date : 11 septembre 2026.

## Contrôles exécutés

- `npm test -- --run` : 113 tests passés.
- `npm run build` : build Vite réussi.
- `npm run photos:check` : 251 SKU complets, minimum 800 px.
- `npm run smoke` avec API et frontend actifs : réussi.
- Vérification statique des routes, authentification, headers, uploads, OAuth et entrées utilisateur.

## Résultats

### Corrigé ou couvert par tests

- mots de passe nouveaux avec scrypt et comparaison résistante au timing ;
- limite de taille des requêtes ;
- rate limiting mémoire ;
- contrôle d'accès master/customer ;
- recalcul serveur des prix et du total ;
- contrôle et rollback du stock ;
- écriture atomique et quarantaine du JSON corrompu ;
- headers `nosniff`, `X-Frame-Options` et `Referrer-Policy`.

### Risques restant à traiter avant production

1. La persistance par `store.json` n'est pas durable ni transactionnelle sur Vercel serverless. Elle doit être remplacée par une base managée et un stockage objet pour les photos.
2. Les sessions sont des tokens porteurs stockés côté client. Un cookie `HttpOnly`, `Secure`, `SameSite` est préférable en production.
3. Le mode OAuth réel n'a pas été validé sans clés, domaine HTTPS et callbacks enregistrés auprès de Google/Meta.
4. Le rate limit mémoire ne protège pas globalement plusieurs instances serverless.
5. Aucune analyse SAST/DAST externe ni test de charge n'est une preuve de sécurité complète.
6. Le test navigateur Playwright est fourni dans `e2e/`, mais l'installation du navigateur a échoué dans cet environnement réseau ; il doit être exécuté en CI avec `npx playwright install --with-deps chromium`.

## Conclusion

Ce dépôt ne doit pas être présenté comme audité ou sécurisé pour la production tant que les six risques ci-dessus ne sont pas levés et qu'un déploiement HTTPS réel n'a pas été testé.
