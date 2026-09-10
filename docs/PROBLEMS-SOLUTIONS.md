# PC Star — 22 problèmes → solutions

Doc principale du portfolio. Chaque entrée : **le problème réel** rencontré sur le projet, **la solution livrée**, **où elle vit dans le code**, et **le résultat mesurable**. Toutes les entrées sont vérifiables dans le repo (fichiers + tests + démo).

Légende des domaines : **D** données & multi-appareils · **S** sécurité & auth · **U** UX & conversion · **M** media & catalogue · **O** ops & déploiement · **Q** qualité & découverte.

---

## Domaine D — Données & multi-appareils

### 1. Stock incohérent entre appareils *(D)*

**Problème.** Le stock vivait dans le `localStorage` de chaque navigateur : le client voyait « en stock » sur son téléphone alors que le comptoir venait de vendre la pièce. Impossible d'exploiter le site sur 2 écrans (client + master) en même temps.

**Solution.** L'API est devenue la **source de vérité unique** : stock de base dans le catalogue (`src/data.js`) + overrides serveur dans `store.json`, exposés par `GET /api/catalog`. Le front affiche le stock live et le décrément se fait **côté serveur**.

**Code.** `server/catalog.js` (`baseCatalog`, `liveStockOf`, `ensureStock`) · `server/db.js` · `src/App.jsx` (`stockMap`).

**Résultat.** Client réserve sur son téléphone → le comptoir voit le stock décrémenté immédiatement, sans F5.

### 2. Double réservation / stock négatif *(D)*

**Problème.** Deux résas simultanées sur la dernière unité : la première gagnait, la deuxième décrémenteait en dessous de zéro.

**Solution.** `placeOrder` **atomique all-or-nothing** : vérification de toutes les lignes d'abord, décrément ensuite. Si une ligne manque → HTTP **409** avec la liste des shortages (`{id, need, left}`), le front affiche un toast `stockShort` et rafraîchit. L'annulation master **rollback** le stock.

**Code.** `server/catalog.js` (`placeOrder`, `cancelOrder`) · tests `src/orderLogic.test.js`, `src/shopStore.test.js`.

**Résultat.** Le stock **ne peut pas passer sous zéro**, même en concurrence. Couvert par tests.

### 3. Commandes perdues au redémarrage de l'API *(D)*

**Problème.** L'API tournait en mémoire : un `Ctrl+C` (ou un reboot du PC du magasin) = commandes du jour disparues.

**Solution.** Persistance JSON (`store.json`) + **backup automatique** au boot, toutes les **6 h**, via `npm run backup`, et bouton « Backup » dans l'UI master (copie horodatée dans `server/data/backups/`). Cap de 500 commandes (rotation).

**Code.** `server/db.js` (`readDb`/`updateDb`) · `server/index.js` (`setInterval` 6 h, `/api/master/backup`) · `scripts/backupDb.mjs`.

**Résultat.** Redémarrage = zéro perte de commandes ; historique récupérable même si le fichier principal est corrompu.

### 4. Le master touchait au code pour gérer le catalogue *(D)*

**Problème.** Ajouter un produit, masquer un SKU hors stock, corriger un prix ou une photo = ouvrir l'éditeur de code du dev.

**Solution.** **CRUD master complet** : liste (catalogue + extras + cachés), création, mise à jour (prix/stock/nom/photos), masquer/afficher, upload de photos (dataURL ≤ 2.5 Mo, ≤ 6), gestion des clients (reset mot de passe, suppression). 100 % en UI.

**Code.** `server/masterApi.js` (`createProduct`, `updateProduct`, `hideProductMaster`, `savePhotoDataUrls`) · `server/index.js` (routes `/api/master/products/*`) · `src/MasterPage.jsx` (445 L).

**Résultat.** Le master tient son catalogue **sans écrire une ligne de code**.

### 5. Inventaire et clôture de journée manuels *(D)*

**Problème.** À la fermeture, le master reconstituait les ventes dans un carnet/Excel.

**Solution.** **Export CSV du jour** : `GET /api/orders/export.csv?day=` → lignes commande (code, date, nom, tél, items, total, statut), directement ouvrable dans Excel. Bouton dans l'UI master.

**Code.** `server/masterApi.js` (`ordersToCsv`) · `src/MasterPage.jsx`.

**Résultat.** Clôture de journée en 1 clic, exportable et archivable.

### 6. Le comptoir devait faire F5 pour voir les nouvelles résas *(D)*

**Problème.** Le desk ne se rafraîchissait qu'à la main → résa oubliée = client mécontent au comptoir.

**Solution.** **Polling 20 s** sur `GET /api/orders` + **beep** + **toast** à la détection d'une nouvelle réservation (comparaison du compte), filtres par statut + recherche téléphone/code, lien WhatsApp pré-rempli (code + créneau), **CSS d'impression** pour le ticket comptoir.

**Code.** `src/DeskPage.jsx` (217 L) · `src/i18n.js` (templates WA/statuts).

**Résultat.** Nouvelle résa signalée en ≤ 20 s, ticket imprimable, statut poussé en 1 clic (`new → preparing → ready → picked`).

---

## Domaine S — Sécurité & auth

### 7. Mots de passe démo affichés dans l'UI de login *(S)*

**Problème.** Le panel de connexion affichait les 4 comptes démo **avec leurs mots de passe** — utilisable en démo, inacceptable tel quel en prod.

**Solution.** Comptes démo en **lignes cliquables** (connexion 1 clic, sans taper) mais **mots de passe jamais rendus** dans l'UI ; création de compte réelle ; la page **Guide** (qui documente les comptes) n'est accessible **qu'au master**.

**Code.** `src/AuthPanel.jsx` (282 L) · `src/App.jsx` (guard master pour `help`/`desk`/`master`) · `server/db.js` (seeds démo).

**Résultat.** Démo en 3 clics, zéro credential leak en interface.

### 8. Hachage des mots de passe trop faible (sha256 simple) *(S)*

**Problème.** Les seeds initiaux hachaient en `sha256` sans salt → lentement cassable, pas de protection contre les rainbow tables.

**Solution.** Migration vers **scrypt + salt aléatoire 8 octets** avec comparaison **`timingSafeEqual`** ; la vérification legacy `sha256` reste supportée pour valider les anciens seeds (compat), les nouveaux comptes/changes passent en scrypt.

**Code.** `server/db.js` (`hashPass`, `hashPassLegacy`, `verifyPass`) · tests `src/authCrypto.test.js`.

**Résultat.** Nouveaux mots de passe à l'état de l'art ; anciens comptes toujours connectables ; coverage testée.

### 9. Aucune protection brute-force sur login et orders *(S)*

**Problème.** Login et `POST /api/orders` ouverts → tentative de force brute et spam de commandes possibles.

**Solution.** **Rate limit en mémoire par IP + bucket** : login **20/min**, commandes **15/min** ; réponse 429 avec `retry-after`. Clé = IP (via `x-forwarded-for`, indispensable derrière le proxy Vercel).

**Code.** `server/rateLimit.js` (`rateLimit`, `clientKey`) · `server/index.js` (l. 203, 404).

**Résultat.** Brute-force et flood bloqués ; comportement documenté côté client (message + retry).

### 10. OAuth Google/Meta impossible sans clés (et sans env) *(S)*

**Problème.** Un shop Oran n'a pas de Google Cloud Console ni d'app Meta. Sans clé, l'OAuth = bouton mort ; avec clé, le flow demandait un callback HTTPS.

**Solution.** **Mode démo par défaut** (`OAUTH_DEMO=1`) : écran de **consent simulé** par l'API, mais qui crée de **vrais** liens `user.links[provider]` + vraie session. **Bascula réel** avec `OAUTH_DEMO=0` + `GOOGLE_CLIENT_ID/SECRET`, `META_APP_ID/SECRET` — sans toucher à l'UI (boutons Google/Meta dans le login, unlink dans le profil).

**Code.** `server/oauth.js` (192 L) · `server/index.js` (`/api/oauth/start`, `/demo`, `/unlink`, callbacks) · `src/AuthPanel.jsx`, `src/ProfilePage.jsx`.

**Résultat.** Démo OAuth fonctionnelle **immédiatement** ; passage réel = config env uniquement.

### 11. Flow OAuth sans protection CSRF/state *(S)*

**Problème.** Tout flow OAuth sans `state` est vulnérable au CSRF de login (l'attaquant injecte *son* compte).

**Solution.** `state` aléatoire (crypto) généré au `start`, stocké dans `oauthPending` avec `intent` (`login` | `link`), `userId`, `returnUrl`, horodatage ; validé et **supprimé** au retour. `OAUTH_REDIRECT_BASE` dérivée de `VERCEL_URL` sur Vercel.

**Code.** `server/oauth.js` (`startOAuth`, `completeDemo`, `finishIdentity`) · `.env.example`.

**Résultat.** Flow conforme (state + redirect dédié), lien déconnectable depuis le profil.

---

## Domaine U — UX & conversion (Oran)

### 12. Un panier générique, inadapté au retrait cash au comptoir *(U)*

**Problème.** Le parcours « add to cart → checkout paiement en ligne » ne correspondait pas au magasin : ici on réserve, on montre un code, on paie **en DA au comptoir**.

**Solution.** Funnel **Pickup-first** : stepper 3 étapes **Panier → Infos → Confirmé**, validation du téléphone algérien **05/06/07** (Ooredoo/Mobilis/Djezzy), créneaux de retrait, **code `PS-YYYYMMDD-XXXX`** unique par jour côté serveur, écran succès (code, adresse Maps El Makari Les Castors, rappel espèces).

**Code.** `src/App.jsx` (cartStep, écran `reserved`) · `src/orderLogic.js` (147 L, validé par tests) · `server/catalog.js` (`makeOrderCode`).

**Résultat.** Parcours client lisible en AR/FR/EN, zéro friction de paiement (il n'y en a pas), code exploitable au comptoir.

### 13. Le builder pouvait produire des configs incompatibles ou surchauffantes *(U)*

**Problème.** L'utilisateur choisissait CPU + GPU + alim incohérents (socket, TDP, wattage) et venait se faire expliquer au comptoir pourquoi ça ne marcherait pas.

**Solution.** **Checks de compatibilité temps réel** dans le builder (socket CPU/MB, type mémoire, form factor, TDP vs refroidissement) avec alertes lues dans les 3 langues, **récap wattage/socket/form factor** en sidebar, presets (étudiant, gaming 1080p, bureau), **copier la config + lien WhatsApp**.

**Code.** `src/BuilderPage.jsx` (408 L) · `src/data.js` (`compat`, `specOf`) · `src/i18n.js` (messages d'alerte).

**Résultat.** La config qui arrive au comptoir est **déjà vérifiée** ; le builder devient un pré-qualificatif, pas une source de disputes.

### 14. Un monolithe `App.jsx` devenu ingérable *(U)*

**Problème.** Tout dans un fichier (UI + logique orders + store + auth) → les phases P1–P6 devenaient des patches sur un monstre, tests impossibles par morceau.

**Solution.** **Découpage en pages et modules** : `DeskPage`, `MasterPage`, `ProductPage`, `BuilderPage`, `SearchPage`, `ProfilePage`, `LegalPage` + modules purs `orderLogic`, `media`, `shopStore`, `productPhotos` (testables sans DOM).

**Code.** `src/` (16 fichiers, ~9 300 L au total) · 5 fichiers de tests.

**Résultat.** Chaque surface a son fichier et ses tests ; les itérations P2–P6 se sont faites sans régression visible (34 tests verts).

### 15. Site 100 % FR pour une clientèle arabophone *(U)*

**Problème.** Oran parle arabe (souvent darja écritée) : un site FR-only = la moitié de la conversion perdue.

**Solution.** **i18n AR/FR/EN complète** (1172 lignes de traductions), **arabe par défaut avec `dir="rtl"`** et `lang`/`dir` synchronisés sur le document, produits/catalogue traduits où pertinent, thème clair/sombre/système, typographie Noto Naskh Arabic.

**Code.** `src/i18n.js` · `index.html` (`lang="ar" dir="rtl"`) · `src/prefs.js` (persistance choix).

**Résultat.** Site nativement arabe (pas de traduction rétro), commutable en 1 tap, RTL correct partout (nav, PDP, desk).

---

## Domaine M — Media & catalogue

### 16. Photos génériques répétées → le site criait « démo » *(M)*

**Problème.** Quelques images recyclées sur 250 produits : les 3 voisins d'une grille affichaient la même photo.

**Solution.** **Pipeline d'ingestion** (`ingestSkuPhotos` : check / `--fix` / `--webp`, ≥ 800px) + **attribution déterministe** : hash de l'id produit → `pick3()` sur un pool de 105 shots par famille (cpu, gpu, mb, …) avec rotation → **250+ SKU à 3 photos**, les SKUs voisins ne partagent pas la même triple. Pool `sku/` (753 fichiers) pour les produits prioritaires à photo dédiée.

**Code.** `scripts/ingestSkuPhotos.mjs`, `scripts/assignSkuPhotos.mjs` · `src/productPhotos.js` · `public/photos/{lib,sku}`.

**Résultat.** 914 photos servies, zéro doublon visible en grille ; ajouter une vraie photo = déposer `{id}-1.jpg` + push (rebuild Vercel).

### 17. Images lourdes / layout shift sur mobile *(M)*

**Problème.** Grilles et PDP lentes sur 4G algérienne : images non optimisées, pas de lazy, « flash » blanc avant chargement.

**Solution.** `<picture>` avec **WebP** (généré en opt-in par l'ingest) + `loading="lazy"` + `sizes` dans `PartThumb` ; **skeleton CSS** sur le frame photo PDP pendant le chargement ; `vercel.json` : `/assets/*` immutable (hash de build), `/photos/*` cache 24 h.

**Code.** `src/PartThumb.jsx` (77 L) · `src/ProductPage.jsx` · `vercel.json` (headers).

**Résultat.** Navigation grille/PDP nette sur mobile ; images mises en cache CDN, payload réduit (WebP).

### 18. Fiches produit illisibles (specs éparpillées, pas de contexte) *(M)*

**Problème.** Les specs (socket, TDP, RAM, PSU min) existaient en données mais étaient invisibles ou incohérentes sur la fiche.

**Solution.** `specRows()` → **table de specs i18n** sur le PDP (socket, mémoire, form factor, TDP, VRM, PSU min, PCIe, tags) + **`relatedProducts()`** par scoring (même socket +5, même mémoire +4, même form +2, en stock +2, tag dz-hit +1) pour suggérer les pièces compatibles.

**Code.** `src/media.js` (72 L) · `src/ProductPage.jsx`.

**Résultat.** Fiche lisible dans les 3 langues ; le client (ou le vendeur par téléphone) voit la compatibilité sans deviner.

---

## Domaine O — Ops & déploiement (sans VPS)

### 19. HTTPS + déploiement sans budget VPS *(O)*

**Problème.** Le site devait être en HTTPS (confiance, OAuth) mais pas de VPS à payer/gérer pour un commerce d'Oran.

**Solution.** **Vercel** : build Vite (`dist/`) + API Node en **serverless function** (même origine via rewrites `/api/(*) → /api`), SPA fallback, **HTTPS automatique** `*.vercel.app`, domaine custom optionnel (Let's Encrypt auto). Un `vercel.json` suffit.

**Code.** `vercel.json` · `server/index.js` (compat serverless : `VERCEL_URL`, corps pré-parsés) · [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).

**Résultat.** Prod en `https://…vercel.app` en ~2 min de config, zéro serveur à maintenir, push = deploy.

### 20. Serverless Vercel = filesystem en lecture seule + cold starts *(O)*

**Problème.** Sur Vercel, on ne peut pas écrire dans le bundle et chaque instance démarre « froide » : un `store.json` classique = données perdues.

**Solution.** **Détection d'environnement** (`IS_SERVERLESS` via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME`) : données dans **`/tmp/pcstar-data`**, uploads dans `/tmp/pcstar-uploads` servis par `GET /api/upload-file`. **Limite documentée honnêtement** (ephémère, reset possible) + **plan d'échappement** sans VPS : Vercel KV / Turso / Blob, branchables via `server/db.js` sans toucher au reste.

**Code.** `server/db.js` (`DATA_DIR`) · `server/masterApi.js` (`UPLOAD_DIR`, `UPLOAD_PUBLIC_PREFIX`) · [DEPLOY-VERCEL.md §7](DEPLOY-VERCEL.md).

**Résultat.** Le site **tourne** sur Vercel Hobby dès aujourd'hui ; la limite est connue, mesurée et couverte par un plan — pas une surprise.

### 21. CORS cassé entre domaine front et API *(O)*

**Problème.** `Access-Control-Allow-Origin: *` OK en démo locale, mais inopérant dès que tokens/cookies et domaine prod entrent en jeu ; chaque environnement cassait l'autre.

**Solution.** **`FRONT_ORIGIN` par environnement** : défaut `*` (démo) ; sur Vercel **auto-déduite de `VERCEL_URL`** (`https://${VERCEL_URL}`) ; `FRONT_URL`/`OAUTH_REDIRECT_BASE` pour les liens sortants. Documenté dans `.env.example` (bloc local / bloc Vercel).

**Code.** `server/index.js` (ligne `FRONT_ORIGIN`) · `.env.example`.

**Résultat.** Dev, preview et prod fonctionnent **sans recoller de headers** ; le switch d'environnement = 3 variables.

---

## Domaine Q — Qualité & découverte

### 22. Zéro QA automatisée et zéro visibilité locale *(Q)*

**Problème.** Sans tests, chaque phase risquait de casser la précédente ; sans SEO local, aucun client d'Oran ne trouvait le site.

**Solution.** Côté QA : **34 tests** `node --test` (orders/stock, master API, auth/crypto, API smoke, shop store) + **`npm run smoke`** = e2e complet de l'API en `fetch` (résa → stock → annulation → rollback). Côté découverte : **JSON-LD `ComputerStore`**, `robots.txt`, `sitemap.xml` (5 URLs), meta description/OG i18n, `theme-color`, accessibilité (skip-link, `aria-live` sur les toasts, focus management Bootstrap, contraste light renforcé, chrome `dir/lang` AR).

**Code.** `src/*.test.js` (5 fichiers) · `scripts/smoke-e2e.mjs` · `public/{robots.txt,sitemap.xml}` · `index.html` · `src/App.jsx` (skip-link, JSON-LD).

**Résultat.** `npm test` = filet de sécurité à chaque commit ; le site est indexable et structuré pour « boutique PC Oran ».

---

## Synthèse

| Domaine | Problèmes | Levier principal |
|---------|:---------:|------------------|
| D — Données | 1–6 | Source de vérité serveur + atomicité + ops (CSV/backup/poll) |
| S — Sécurité | 7–11 | scrypt, rate limit, OAuth stateful (démo → réel) |
| U — UX | 12–15 | Pickup-first + AR-first + découpage |
| M — Media | 16–18 | Pipeline photos + déterminisme + specs lisibles |
| O — Ops | 19–21 | Vercel sans VPS + honnêteté `/tmp` + env par contexte |
| Q — Qualité | 22 | Tests + e2e + SEO local + a11y |

**Fil rouge :** chaque problème a reçu une solution **vérifiable dans le code** (fichier cité, test, ou commande) et une **limite assumée documentée** si elle restait (KV/Turso, shoot studio, clés OAuth, Lighthouse prod).
