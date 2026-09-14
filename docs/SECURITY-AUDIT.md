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

## Addendum P13 (13/09/2026) — lot 1 sécurité corrigé

Quatre vulnérabilités du rapport d'audit du 13/09 ont été **reproduites par
attaque réelle** puis corrigées (détail : `BUGS-AND-FIXES.md`, section P13) :

| Réf | Vulnérabilité | État |
|---|---|---|
| S1 | Consentement OAuth démo → session **master** (appariement par e-mail) | ✅ corrigé : master = mot de passe uniquement ; en démo, seuls les comptes démo s'ouvrent |
| S2 | Open redirect + exfiltration du token via `returnUrl` | ✅ corrigé : `safeReturnUrl()` (relatif strict ou même origine), validé 2× |
| S3 | Token de session persisté dans `store.json` puis dans chaque backup | ✅ corrigé : renvoyé par closure + `stripInternalKeys()` purge l'existant |
| S4 | `X-Forwarded-For` forgé → rate-limit illimité | ✅ corrigé : en-tête cru uniquement derrière proxy déclaré (`TRUST_PROXY=1` / Vercel), dernier saut |

Couverture : `src/securityFixes.test.js` (15 tests d'attaque), `npm test`
**142/142**.

**Ces correctifs ne changent pas la conclusion ci-dessous** : les six risques
de production listés plus haut restent ouverts, et 26 points du même rapport
(escalade comprise non, mais corruption `db._err`, WhatsApp du comptoir, crash
du builder, vignettes, validation des overrides produit, CORS `*`, `store.json`
tracké avec hash de mot de passe…) sont toujours à traiter.

## Conclusion

Ce dépôt ne doit pas être présenté comme audité ou sécurisé pour la production tant que les six risques ci-dessus ne sont pas levés et qu'un déploiement HTTPS réel n'a pas été testé.
