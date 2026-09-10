# PC Star — Plan d’amélioration jusqu’à 10/10

**Date :** 2026-09-10  
**Baseline :** → **Phase 3+4 ship** — media pipeline + master CRUD/CSV/backup (~9.0–9.3 code)  
**Cible :** un shop pickup Oran **exploitable en vrai magasin**, pas un clone Amazon.

> **Règle d’honnêteté :** un 10/10 absolu (photos studio + OAuth live + paiements + ERP + Lighthouse 95) **nécessite du hors-code** (shooting, clés Google/Meta, hébergeur DZ, process magasin).  
> Ce plan sépare **ce qu’on code** et **ce que tu fournis**.

---

## Score cible par phase

| Phase | Nom | Note globale estimée | Durée indicative |
|------:|-----|---------------------:|-----------------:|
| 0 | Baseline (actuel) | ~8.0 | — |
| 1 | Fiabilité & fondations | ~8.4 | 1–2 j |
| 2 | UX conversion pickup | ~8.8 | 2–3 j |
| 3 | Catalogue & media pro | ~9.2 | 3–5 j + shoot |
| 4 | Backend magasin réel | ~9.5 | 4–7 j |
| 5 | Auth & confiance | ~9.7 | 2–4 j + clés OAuth |
| 6 | Perf, SEO, a11y, QA | **10.0 shop Oran** | 3–5 j |

**Définition du 10/10 ici :**  
client trouve un produit → construit un PC compatible → réserve en espèces → reçoit un code PS → master prépare au comptoir El Makari — **sans friction**, sur mobile, AR/FR/EN, stock cohérent, photos crédibles, panne serveur gérée.

---

## Phase 0 — Baseline (fait)

- [x] 250 SKUs, 3 photos/SKU
- [x] Cash-only pickup Oran
- [x] Builder + compat
- [x] Comptes + master desk
- [x] AR / FR / EN
- [x] Shell Bootstrap + Offcanvas/Modal API
- [x] Design tokens unifiés
- [x] Guide master-only

**Exit :** live :5173 + API :8787, 19 tests verts.

---

## Phase 1 — Fiabilité & fondations (code)

**Objectif :** zéro surprise en usage réel démo / multi-onglet.

### 1.1 Données & stock
- [x] Source de vérité stock live via `/api/catalog` (base data.js + overrides serveur)
- [x] Stock décrémenté à la réservation (API + rollback si annulation master)
- [x] Conflit stock : HTTP 409 + toast `stockShort` + refresh
- [ ] `meta` master (hide/add product) synchronisé serveur, pas seulement `localStorage`

### 1.2 Réservations
- [x] Code PS unique serveur (`PS-YYYYMMDD-XXXX`)
- [x] Statuts : `new` → `preparing` → `ready` → `picked` / `cancelled`
- [x] Desk master : filtres par statut + recherche téléphone/code
- [ ] WhatsApp prérempli avec code + créneau (déjà partiel — standardiser template i18n)

### 1.3 Qualité code
- [x] Découpe partielle : `DeskPage`, `ProductPage`, `orderLogic` (App encore monolithe)
- [ ] Erreurs API centralisées (banner « mode local / serveur »)
- [x] Tests order/stock : 29 pass (orderLogic + shopStore + smoke)

**Exit Phase 1**
- Réservation API → visible desk master après refresh
- Stock ne peut pas passer négatif
- `npm test` ≥ 30 pass
- App découpée, build < 400 kB JS utile (code-split pages)

**Note estimée : 8.5 — livré (stock API + desk + tests)**

---

## Phase 2 — UX conversion pickup (code)

**Objectif :** parcours client aussi clair qu’un bon Ouedkniss/physique.

### 2.1 Funnel
- [x] Home : hero + 3 chemins (Pièces / Config PC / Hits DZ)
- [x] PDP : galerie, zoom, specs badges, CTA sticky mobile
- [x] Cart : stepper `Panier → Infos → Confirmé`
- [x] Post-réservation : écran succès (code, maps, cash)

### 2.2 Builder
- [x] Récap wattage / socket / form factor en sidebar
- [ ] Suggestion auto « PSU min » et « cooler socket »
- [x] Bouton copier + WhatsApp config
- [x] Presets Star (étudiant, gaming 1080p, bureau)

### 2.3 Search
- [ ] URL query sync (`?line=cpu&brand=Havit`) pour partage
- [x] Filtres mobile offcanvas
- [ ] « En magasin seulement » par défaut option magasin

### 2.4 Micro-copy Oran
- [ ] Toutes les CTA en DA + « espèces au comptoir »
- [ ] Horaires / trajet Castors toujours à 1 tap (tel, WA, Maps)

**Exit Phase 2**
- Parcours guest complet < 90 s sur mobile (chrono manuel)
- 0 dead-end (empty states + reset partout)
- Builder presets utilisés en smoke test

**Note estimée : 8.8 — livré (funnel + presets + PDP sticky)**

---

## Phase 3 — Catalogue & media « pro » (code + hors-code)

**Objectif :** photos et fiches qui ne crient plus « démo ».

### 3.1 Photos (hors-code — toi / photographe)
- [ ] Shoot ou packshots fournisseurs : **fond neutre, 1:1, ≥ 1200px**, 3 angles/SKU prioritaires (top 80 ventes)
- [ ] Remplacer d’abord : CPU, GPU, MB, SoG, Havit, combos
- [ ] Charte : fond `#0f172a` ou blanc studio, ombre douce, pas de watermark

### 3.2 Pipeline code
- [x] Script `scripts/ingestSkuPhotos.mjs` (check/fix/webp) — 251 SKU complets ≥800
- [x] WebP sibling support in `PartThumb` + `--webp` ingest (opt-in)
- [x] PartThumb picture/webp + sizes hook (800 master; multi-srcset ready)
- [x] Skeleton CSS on PDP photo frame

### 3.3 Fiches produit
- [x] Specs table PDP via `media.specRows`
- [x] Tags shown in specs when present
- [x] `relatedProducts()` scoring compat + stock

**Exit Phase 3**
- Top 80 SKUs : vraies photos ≥ 1200px
- Lighthouse « images » plus de plainte oversized sans srcset
- PDP specs lisibles AR/FR/EN

**Note estimée : 9.0 code media (sans shoot studio réel reste plafond ~8.5–9.0 photos)**

---

## Phase 4 — Backend magasin réel (code + hébergement)

**Objectif :** le master peut tenir le comptoir sans Excel.

### 4.1 API
- [x] CRUD `/api/master/products` (+ hide/photos)
- [x] Upload photos dataURL → `/photos/uploads` (2.5 Mo, ≤6)
- [x] Orders list/filter/patch (Phase 1) + CSV export
- [x] `GET /api/orders/export.csv?day=`
- [x] Rate limit login (20/min) + orders (15/min)

### 4.2 Persistance
- [x] JSON local + backups ; sur Vercel `/tmp` éphémère (KV/Turso optionnel plus tard)
- [x] Backup au boot + toutes les 6h + `npm run backup` + bouton master
- [x] ensureStock / meta defaults auto-migrate

### 4.3 Ops
- [x] `FRONT_ORIGIN` env (défaut `*` démo) + `.env.example`
- [ ] HTTPS — doc hébergeur (hors sandbox)
- [x] `.env.example`
- [x] `/api/health` enrichi (cors, payments)

### 4.4 Desk UX
- [x] Poll desk 20s + beep + toast nouvelle résa
- [x] Print CSS desk tickets
- [x] WA ready link (Phase 1 desk)

**Exit Phase 4**
- Master gère stock/photos/commandes 100 % via UI sans toucher au code
- Redémarrage serveur : zéro perte commandes
- Export CSV du jour OK

**Note estimée : 9.3 — livré CRUD/upload/CSV/backup/rate-limit (SQLite/HTTPS hors sandbox)**

---

## Phase 5 — Auth & confiance (code + clés)

**Objectif :** comptes clients réels, pas seulement démo.

### 5.1 Auth
- [x] OAuth Google/Meta UI + demo flow; réel si `OAUTH_DEMO=0` + clés env
- [x] Meta OAuth branch (demo + prod keys)
- [x] Change password profil + master reset-password API
- [ ] Token localStorage (httpOnly cookie reporté hébergeur HTTPS)

### 5.2 Confiance UI
- [x] Page garantie / RMA i18n
- [x] Pages conditions + contact magasin
- [x] Page confidentialité (tél pickup only)

### 5.3 Sécurité
- [x] scrypt new + legacy sha256 verify (seed demos)
- [x] Auth UI sans mots de passe démo affichés
- [x] Security headers API (nosniff, frame, referrer); HTTPS hors sandbox

**Exit Phase 5**
- Client crée compte Google → réserve → revoit ses commandes (historique profil)
- OAuth demo off en prod
- Docs légales présentes FR/AR

**Note estimée : 9.6 — OAuth UI + legal + scrypt (OAuth réel = clés)**

---

## Phase 6 — Perf, SEO, a11y, QA → 10/10 shop Oran

### 6.1 Performance
- [x] manualChunks react/bootstrap (route lazy reporté)
- [ ] Prefetch hover (optionnel)
- [x] WebP picture + lazy (Phase 3)
- [ ] Lighthouse cible — à mesurer en prod HTTPS

### 6.2 SEO local Oran
- [x] document.title + meta description i18n
- [x] JSON-LD ComputerStore
- [x] public/robots.txt + sitemap.xml
- [x] OG tags basiques (image pack shot optionnel)

### 6.3 Accessibilité
- [x] BS Modal/Offcanvas focus + skip-link
- [x] text-secondary contraste renforcé light
- [x] toast aria-live polite
- [x] dir/lang chrome AR

### 6.4 QA
- [x] `npm run smoke` API e2e (fetch)
- [ ] i18n missing-key CI (reporté)
- [x] docs/GUIDE-DEMO* + ROADMAP

**Exit Phase 6 = 10/10 défini**
- [ ] Lighthouse mobile Perf ≥ 90
- [ ] E2E Playwright vert CI
- [ ] 3 langues sans clé manquante
- [ ] Master checklist « ouverture journée » OK
- [ ] Client réel peut retirer une commande sans aide dev

**Note code ~9.5–9.7 ; 10.0 shop Oran = + shoot + OAuth clés + HTTPS prod + Lighthouse**

---

## Hors-scope volontaire (ne bloque pas le 10/10 Oran)

| Idée | Pourquoi non (maintenant) |
|------|---------------------------|
| Paiement CCP / BaridiMob / carte | Tu as imposé **cash desk only** |
| Livraison 58 wilayas | Modèle = retrait Castors |
| Comparateur 3 produits | Rejeté / hors focus conversion |
| App native | PWA éventuelle phase 6.5 |
| IA chatbot | Bruit ; WhatsApp suffit |
| Multi-magasins | Un seul point de vente |

---

## Ordre d’exécution recommandé

```
Phase 1 (fondations) ──► Phase 2 (UX) ──► Phase 3 (photos // parallèle shoot)
         │                                        │
         └────────► Phase 4 (backend) ◄───────────┘
                         │
                         ▼
                   Phase 5 (OAuth)
                         │
                         ▼
                   Phase 6 (perf/QA) = 10/10
```

**Parallèle intelligent :**  
pendant que Phase 1–2 se codent, tu lances le **shoot top 80 SKUs** (Phase 3 hors-code). Sinon le media reste le plafond.

---

## Ce que **toi** fournis vs **agent** code

| Toi | Agent |
|-----|--------|
| Photos réelles / packshots | Pipeline, srcset, UI |
| Clés Google OAuth + domaine | Wiring `oauth.js`, callbacks |
| VPS / hébergeur + nom de domaine | Config serveur, HTTPS doc |
| RC / texte garantie magasin | Pages légales i18n |
| Décisions stock/prix réels | CRUD, import CSV |
| Validation terrain (client test) | E2E + checklist |

---

## KPI magasin (pour mesurer le 10, pas le vanity)

1. **Taux de réservation complétée** (cart → code PS)  
2. **Temps moyen builder → cart**  
3. **% commandes marquées picked le jour même**  
4. **Erreurs stock** (refus comptoir) = 0  
5. **Messages WA « c’est où ? »** en baisse (adresse/créneau clairs)

---

## Prochaine action immédiate

**Démarrer Phase 1.1–1.2** : stock serveur + statuts réservation + desk filtres.  
C’est le plus gros gap entre « belle démo » et « outil de comptoir ».

Dis : **`go phase 1`** pour lancer l’implémentation, ou **`go phase 2`** si tu préfères l’UX d’abord.
