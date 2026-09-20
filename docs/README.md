# Documentation PC Star — index

Boutique pickup **PC Star Informatique** — El Makari Les Castors, Oran.

## Deux régimes, et c'est la seule règle de ce dossier

Un fichier est soit **vivant** (guide, recette, prompt d'agent, index : il décrit
l'état du dépôt et il est **corrigé** dès qu'il ment), soit **journal daté** (trace
d'un audit ou d'une session : il dit ce qui était vrai **le jour où il a été écrit**
et on ne le réécrit pas — effacer une conclusion fausse plus tard efface aussi la
raison pour laquelle elle était fausse). Chaque journal porte une bannière qui le
rappelle ; `src/p3DocsAging.test.js` vérifie les deux régimes, et qu'un fichier de
`docs/` ajouté sans être classé fait échouer le test.

**Les chiffres du jour ne vivent qu'à un seul endroit** : « État mesuré » dans
[`../README.md`](../README.md). C'est la leçon de ce dossier — un nombre recopié
dans trois fichiers est faux dans deux d'entre eux dès la session suivante :

> Les chiffres périmés qui ont survécu le plus longtemps dans des textes exécutés :
> « 34 tests », « 113 tests », « 251 SKU », « 3 langues », « 13 pages ». Les quatre
> premiers sont partis, le dernier a quitté le résumé de `scripts/jsdom-crawl.mjs`
> qui l'imprimait à côté de son propre décompte (24 = 12 × 2, pas 13).

## Docs vivantes (à jour, exécutables en l'état)

| Doc | À qui ? | Contenu |
|-----|---------|---------|
| [PORTFOLIO.md](PORTFOLIO.md) | Recruteur / client | **Case study** : contexte, contraintes, livrables, chiffres mesurés (§ 4), leçons |
| [PROBLEMS-SOLUTIONS.md](PROBLEMS-SOLUTIONS.md) | Portfolio (doc principale) | **22 problèmes réels → solutions**, fichiers pointés, résultats mesurés |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Dev / relecture code | Schéma front / API / media / Vercel + flux (résa, OAuth, desk) |
| [GUIDE-DEMO.md](GUIDE-DEMO.md) | Démonstration | Comptes démo, parcours master + client, OAuth démo, **ce qui a été retiré** (arabe, thème) |
| [GUIDE-DEMO-FR.md](GUIDE-DEMO-FR.md) | Démo (FR court) | Le même, en six minutes |
| [GUIDE-DEMO-AR.md](GUIDE-DEMO-AR.md) | Démo (عربي) | نفس الدليل بالعربية — le document est en arabe ; **la vitrine, elle, se sert en FR/EN** |
| [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) | Ops / magasin | Déploiement **HTTPS sans VPS**, variables d'env, limites `/tmp` honnêtes |
| [HEBERGEMENT-HTTPS.md](HEBERGEMENT-HTTPS.md) | Ops | Alternative VPS + reverse proxy, durées de session, sauvegardes |
| [NEON-MIGRATION.md](NEON-MIGRATION.md) | Ops | Passer l'état mutable sur Postgres managé (import/export, snapshots bornés) |
| [PROMPT-AGENT-DEPLOIEMENT.md](PROMPT-AGENT-DEPLOIEMENT.md) | Agent / repreneur | Le prompt à donner à un agent pour déployer, avec les portes à faire passer |
| [RECETTE-PHOTOS-MASTER.md](RECETTE-PHOTOS-MASTER.md) | Comptoir | Comment le master charge et valide les photos d'une fiche |
| [RECETTE-RESPONSIVE-DIRECTION-03.md](RECETTE-RESPONSIVE-DIRECTION-03.md) | Intégration | Ce qui est automatisé vs ce qui se coche **sur un vrai écran** |
| [BUGS-AND-FIXES.md](BUGS-AND-FIXES.md) | Historique vivant | Journal **append-only** des sessions : une section par jour, la plus récente en bas |

## Journaux datés (traces — lire avec la date en tête)

| Doc | Date | Ce qu'il relate |
|-----|------|-----------------|
| [AUDIT-P22.md](AUDIT-P22.md) | 14/09 | Audit « toutes les pages, tous les boutons » (1 155 boutons) |
| [AUDIT-BOUTONS-PHOTOS-2026-09-18.md](AUDIT-BOUTONS-PHOTOS-2026-09-18.md) | 18/09 | Porte `audit-buttons`, photos master, gonds de la CI |
| [AUDIT-REPO.md](AUDIT-REPO.md) | 11/09 | Audit ligne par ligne du dépôt (21 fichiers front, API, scripts) |
| [BILAN-SESSION-2026-09-17-CI-NEON.md](BILAN-SESSION-2026-09-17-CI-NEON.md) | 17/09 | Chantier CI Neon (LOT 1.20) : migration, verrou de concurrence |
| [PLAN-CORRECTIONS.md](PLAN-CORRECTIONS.md) | 15/09 | Plan consolidé de tous les bugs connus, de A à Z |
| [PLAN-DESIGN-TERMINAL-CYBER.md](PLAN-DESIGN-TERMINAL-CYBER.md) | 16/09 | Direction 03 « Terminal Cyber », lots L0 → L7 |
| [PLAN-REMEDIATION-AUDIT-2026-09-17.md](PLAN-REMEDIATION-AUDIT-2026-09-17.md) | 17/09 | Remédiation de l'audit : P0 → P3, avec ce qui a été refusé |
| [ROADMAP-10.md](ROADMAP-10.md) | 10/09 | Plan d'amélioration jusqu'à 10/10, et son état final |
| [SECURITY-AUDIT.md](SECURITY-AUDIT.md) | 11/09 | Audit sécurité + limites de validation assumées |
| [VERIFICATION-RAPPORT-AUDIT.md](VERIFICATION-RAPPORT-AUDIT.md) · [-2](VERIFICATION-RAPPORT-AUDIT-2.md) · [-3](VERIFICATION-RAPPORT-AUDIT-3.md) · [-4](VERIFICATION-RAPPORT-AUDIT-4.md) | 15 → 18/09 | Recoupement item par item des rapports d'audit reçus ; le n° 4 porte un addendum du 19/09 |
| [VERIFICATION-RAPPORT-LOT0.md](VERIFICATION-RAPPORT-LOT0.md) | 15/09 | Vérification du « lot 0 » annoncé sur une autre branche |
| [superpowers/specs/2026-09-09-i18n-theme-accounts-design.md](superpowers/specs/2026-09-09-i18n-theme-accounts-design.md) | 09/09 | Spec initiale AR/FR/EN + thème + comptes (l'arabe et le thème sont depuis retirés) |

## Lancer la démo

```bash
npm install
npm run start:api   # API :8787 (comptes, commandes, stock)
npm run dev         # site :5173 (proxy /api)
npm test            # la suite entière (node:test, 77 fichiers)
```

Comptes démo : [GUIDE-DEMO.md](GUIDE-DEMO.md) (bouton « Guide » dans le menu du site, master only).
Contrôles de non-régression : [../README.md](../README.md) § « Contrôles » — c'est là
que les portes de CI sont décrites, pas ici.
