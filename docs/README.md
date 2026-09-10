# Documentation PC Star — index

Boutique pickup **PC Star Informatique** — El Makari Les Castors, Oran.

| Doc | À qui ? | Contenu |
|-----|---------|---------|
| [PORTFOLIO.md](PORTFOLIO.md) | Recruteur / client / portfolio | **Case study** : contexte, contraintes, livrables, chiffres, leçons |
| [PROBLEMS-SOLUTIONS.md](PROBLEMS-SOLUTIONS.md) | Portfolio (doc principale) | **22 problèmes réels → solutions** avec fichiers pointés et résultats mesurés |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Dev / relecture code | Schéma front / API / media / Vercel + flows (résa, OAuth, desk) |
| [ROADMAP-10.md](ROADMAP-10.md) | Suivi projet | Plan d'amélioration P0–P6 — **état final : P0–P6 livrés, score ~9.5–9.7** |
| [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) | Ops / magasin | Déploiement **HTTPS sans VPS** (Vercel), env, limites `/tmp` honnêtes |
| [GUIDE-DEMO.md](GUIDE-DEMO.md) | Démonstration | Comptes démo, parcours master + client, thème, langues, OAuth démo |
| [GUIDE-DEMO-FR.md](GUIDE-DEMO-FR.md) | Démonstration (FR court) | Même guide en version courte |
| [GUIDE-DEMO-AR.md](GUIDE-DEMO-AR.md) | Démonstration (عربي) | نفس الدليل بالعربية |
| [superpowers/specs/2026-09-09-i18n-theme-accounts-design.md](superpowers/specs/2026-09-09-i18n-theme-accounts-design.md) | Historique | Spec initiale AR/FR/EN + thème + comptes (approche A, local-first) |

## L'ordre de lecture recommandé

1. **[PORTFOLIO.md](PORTFOLIO.md)** — le pitch en 5 minutes.
2. **[PROBLEMS-SOLUTIONS.md](PROBLEMS-SOLUTIONS.md)** — la substance technique.
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — pour ouvrir le code sans se perdre.
4. **[ROADMAP-10.md](ROADMAP-10.md)** — comment on est passé de ~8.0 à ~9.5–9.7.
5. **[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)** — pour le déployer ou le reproduire.

## Lancer la démo

```bash
npm install
npm run start:api   # API :8787 (comptes, commandes, stock)
npm run dev         # site :5173 (proxy /api)
npm test            # 34 tests
```

Comptes démo : [GUIDE-DEMO.md](GUIDE-DEMO.md) (bouton « Guide » dans le menu du site, master only).
