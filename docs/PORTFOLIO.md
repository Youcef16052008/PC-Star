# PC Star — Case study (portfolio)

**Boutique pickup informatique — El Makari Les Castors, Oran (Algérie)**
Stack : React 19 · Node 20 (zéro dépendance) · Vite 6 · Bootstrap 5 · Vercel (sans VPS)

---

## 1. Contexte

PC Star Informatique est un commerce physique d'Oran : pièces PC, config sur mesure, accessoires, réparation. Le modèle de vente est **retrait en magasin + espèces** (pas de livraison 58 wilayas, pas de paiement en ligne).

Le point de départ : une **démo monolithe** correcte (~8.0/10) mais pas exploitable en vrai magasin :

- stock dupliqué par navigateur (localStorage) → incohérent entre le téléphone du client et le comptoir ;
- site orienté FR alors que la clientèle est **arabophone** (RTL) ;
- photos génériques répétées → criait « démo » ;
- le master devait ouvrir le code pour ajouter/masquer un produit ;
- aucun HTTPS, aucun plan de déploiement (pas de budget VPS).

## 2. Mission & contraintes

> Transformer la démo en **outil de comptoir + boutique en ligne pickup** exploitable par le magasin, déployable **sans VPS**, en **arabe d'abord**, **cash only**, **mobile first**.

Contraintes assumées (écrites dans le projet) :

| Contrainte | Conséquence sur l'architecture |
|------------|-------------------------------|
| Cash only au comptoir | Aucun paiement en ligne ; code de retrait `PS-YYYYMMDD-XXXX` |
| Pas de VPS (Vercel Hobby) | Catalogue **statique** (repo), API **serverless**, données volatiles dans `/tmp` (limite documentée honnêtement) |
| Clientèle AR d'Oran | `lang="ar" dir="rtl"` par défaut, i18n AR/FR/EN complète |
| Mobile first (clients sur téléphone) | CTA sticky, funnel 3 étapes, builder utilisable en 90 s |
| Master non-technicien au quotidien | 100 % des actions de gestion en UI (CRUD, photos, CSV, backup) |

## 3. Ce qui a été livré (phases P0 → P6)

| Phase | Livré |
|-------|-------|
| **P0** Baseline | 250 SKUs, cash pickup, builder + compat, comptes + desk, AR/FR/EN, shell Bootstrap, tokens design |
| **P1** Fiabilité | Stock live via API (source de vérité unique), décrément atomique + rollback, codes `PS-…`, statuts de commande, filtres desk |
| **P2** UX conversion | Funnel home → PDP → cart 3 étapes → écran succès (code, maps, cash), presets builder, copier/WA config, CTA sticky |
| **P3** Catalogue & media | Pipeline photos (250+ SKU à 3 shots), `<picture>` WebP + lazy + skeleton, specs table i18n, produits liés par scoring compat |
| **P4** Backend magasin | CRUD master produits, upload photos (≤2.5 Mo ×6), CSV export du jour, rate limits, backups (boot/6 h/UI), poll desk 20 s + beep + print |
| **P5** Auth & confiance | OAuth **Google/Meta** (mode démo par défaut, réel avec clés), scrypt + migration legacy, pages légales i18n (garantie/RMA, conditions, confidentialité), sécurité UI |
| **P6** Perf/SEO/a11y/QA | chunks react/bootstrap séparés, JSON-LD ComputerStore, robots + sitemap + OG, skip-link + aria-live, `npm run smoke` e2e, **34 tests** |

Détail par problème résolu : **[PROBLEMS-SOLUTIONS.md](PROBLEMS-SOLUTIONS.md)** (22 entrées).
Schéma complet : **[ARCHITECTURE.md](ARCHITECTURE.md)**.
Plan + scores : **[ROADMAP-10.md](ROADMAP-10.md)**.

## 4. Chiffres

| Indicateur | Valeur |
|------------|--------|
| Produits catalogue | **250 SKUs** (prix DA, specs, compat), 3 langues |
| Photos | **914 fichiers** (`public/photos/` : lib 105 · sku 753 · legacy 56 + uploads) |
| Code | **~9 300 lignes** (front + API), **zéro dépendance côté API** |
| Tests | **34 pass** (`node --test`) + smoke e2e API |
| API | **~30 endpoints** (auth, OAuth, catalog, orders, master, CSV, backup) |
| Langues | ar (défaut, RTL) · fr · en — **1172 lignes** de traductions |
| Déploiement | Vercel : build Vite + API serverless + rewrites + headers, **HTTPS auto, sans VPS** |

## 5. Décisions techniques marquantes

1. **Catalogue statique, état serveur minimal.** Les 250 SKUs vivent dans le repo → persistants sur Vercel sans base. Seule la donnée volatile (orders, stock overrides) passe par `store.json`, isolée dans `server/db.js` pour brancher KV/Turso plus tard sans réécrire.
2. **API `node:http` sans framework.** Déployable partout, lisible d'une traite, zéro supply chain côté serveur ; compatible serverless (`VERCEL_URL`, corps pré-parsés, `/tmp`).
3. **Atomicité de la réservation.** `placeOrder` vérifie toutes les lignes **avant** de décrémenter quoi que ce soit ; sinon HTTP 409 + liste de shortage → le stock ne peut pas passer négatif, même en multi-appareils.
4. **OAuth honnête.** Mode démo par défaut (`OAUTH_DEMO=1`) : consent simulé, enregistre réel, `state` anti-CSRF — et bascule réel avec `OAUTH_DEMO=0` + clés Google/Meta, sans changer une ligne de UI.
5. **Honnêteté documentaire.** Les limites (ephémère `/tmp` sur Vercel Hobby, photos non-studio, Lighthouse à mesurer en prod) sont **écrites dans les docs**, pas cachées — voir [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) §7.

## 6. Limites assumées (et leur plan B)

| Limite | Pourquoi | Plan B (prévu, sans VPS) |
|--------|----------|--------------------------|
| `store.json` éphémère sur Vercel `/tmp` | Hobby sans base cloud | Vercel KV / Turso — branchable via `server/db.js` |
| Photos de type, pas studio | shooting non fait | pipeline prêt : `public/photos/sku/{id}-1…3.jpg` + `photos:check` |
| OAuth démo par défaut | pas de clés fournie | `OAUTH_DEMO=0` + clés → réel immédiatement |
| Lighthouse non mesuré en prod | besoin du domaine HTTPS | à mesurer post-deploy (cible Perf mobile ≥ 90) |

## 7. Leçons

- **Commencer par le modèle métier** (retrait + code + espèces) plutôt que par le « e-commerce classique » : tout le funnel, les statuts et le desk en découlent.
- **Une source de vérité par donnée** : le stock serveur a tué la catégorie « ça marche chez moi, pas au comptoir ».
- **Documenter les limites au même rang que les réussites** : c'est ce qui rend un portfolio crédible.
- **Zéro dépendance API** = le projet démarre partout (`node server/index.js`), même sur un Raspberry Pi du magasin.

## 8. Reprendre le projet

```bash
npm install && npm run start:api & npm run dev   # démo locale
npm test                                         # 34 tests
npx vercel --prod                                # prod (voir DEPLOY-VERCEL.md)
```

Lecture recommandée : [docs/README.md](README.md) (index) → [ARCHITECTURE.md](ARCHITECTURE.md) → [PROBLEMS-SOLUTIONS.md](PROBLEMS-SOLUTIONS.md).
