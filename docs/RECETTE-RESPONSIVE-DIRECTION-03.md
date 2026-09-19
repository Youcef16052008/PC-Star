# Grille de recette — Direction 03 « Terminal Cyber » (lots L0→L7)

> **À quoi sert cette grille.** L'environnement d'intégration n'a pas de
> navigateur : tout ce qui est **calculable** a été automatisé
> (`src/cyberDesign.test.js` : contraste AA, breakpoints Bootstrap, cibles
> tactiles ≥ 44 px, clip-path/focus, couleurs en dur, RTL, impression, zoom
> iOS — 15 tests) et le rendu DOM des **13 pages × 2 langues** est vérifié
> sans erreur par `node scripts/jsdom-crawl.mjs` (après `npm run build:crawl`).
> Ce qui reste **non automatisable** — le
> rendu réel, le ressenti typographique, le comportement de scroll — se
> coche ici, sur appareils réels. Une case cochée = vérifié sur un vrai
> écran.

## Comment tester vite

```bash
npm ci && npm run build && npm run preview   # front sur http://localhost:4173
node server/index.js                          # API sur :8787 (dans un 2e terminal)
npm test && npm run build:crawl && node scripts/jsdom-crawl.mjs && npm run smoke
```

Outils recommandés : DevTools (mode appareil + « Network throttling » pour
les polices), un iPhone réel (zoom Safari), un Android bas de gamme
(performance `backdrop-filter`), impression PDF puis papier pour les tickets.

---

## 1. Matrice des 11 largeurs (§ 10) — à cocher

Pour chaque largeur, ouvrir la page d'accueil **puis** naviguer (magasin,
une fiche produit, panier, configurateur).

| # | Largeur | Appareil type | Points à vérifier | ar ✅ | fr ✅ | en ✅ |
|---|---|---|---|---|---|---|
| 1 | **320 px** | iPhone SE / petit Android | aucun scroll horizontal ; barre système sur 1 ligne (bloc droit masqué) ; filtres qui défilent proprement ; cartes produit sur 1 colonne | ☐ | ☐ | ☐ |
| 2 | **360 px** | Android courant | boutons « Ajouter » / filtres ≥ 44 px sous le doigt ; hero lisible ; biseaux discrets (6 px) | ☐ | ☐ | ☐ |
| 3 | **390 px** | iPhone 14/15 | CTA collant PDP + safe-area (rien sous la barre home) ; pas de chevauchement footer/CTA | ☐ | ☐ | ☐ |
| 4 | **414 px** | iPhone Plus | 1 colonne cartes ; nav repliée ; offcanvas panier ≤ 92vw | ☐ | ☐ | ☐ |
| 5 | **576 px** | seuil xs→sm | bascule propre des largeurs ; chanfreins qui passent 6→10 px sans à-coup | ☐ | ☐ | ☐ |
| 6 | **667 × 375** | **téléphone paysage** | hero pas écrasé ; nav + topbar + CTA < 50 % de la hauteur ; rien de coupé | ☐ | ☐ | ☐ |
| 7 | **768 px** | tablette portrait | CTA PDP toujours présent (d-lg-none) ; 2 colonnes cartes ; nav repliée | ☐ | ☐ | ☐ |
| 8 | **992 px** | seuil md→lg | nav qui se déplie ; récap configurateur qui devient collant ; CTA PDP disparaît | ☐ | ☐ | ☐ |
| 9 | **1200 px** | portable | configurateur en split + récap sticky ; conteneur qui plafonne | ☐ | ☐ | ☐ |
| 10 | **1440 px** | bureau | pas d'étirement des lignes ; hero aligné | ☐ | ☐ | ☐ |
| 11 | **2560 px** | grand écran | longueur de ligne maîtrisée ; tout reste au centre | ☐ | ☐ | ☐ |

## 2. Vérifications spécifiques par langue

| Vérification | ar ✅ | fr ✅ | en ✅ |
|---|---|---|---|
| Direction RTL/LTR correcte dès le chargement | ☐ | ☐ | ☐ |
| **arabe : lettres liées** (aucune lettre disjointe — letter-spacing 0) | ☐ | ☐ | ☐ |
| **arabe : biseaux cohérents** (symétriques, pas de coin « à contre-sens ») | ☐ | ☐ | ☐ |
| **arabe : pas de casse** → les méta (badges, topbar) restent lisibles via le poids 700 | ☐ | ☐ | ☐ |
| **arabe : tableaux de specs alignés** malgré police proportionnelle | ☐ | ☐ | ☐ |
| Barre système sans débordement (adresse complète visible ou wrappée) | ☐ | ☐ | ☐ |
| Titres Chakra Petch / repli Noto Naskh Arabic rendu correct | ☐ | ☐ | ☐ |

## 3. Thèmes & accessibilité

| Vérification | Résultat |
|---|---|
| Bascule sombre ⇄ clair ⇄ système : palette cohérente partout, aucun « flash » au chargement | ☐ |
| Thème clair « papier technique » : accent cyan #0e7490, textes lisibles, biseaux identiques | ☐ |
| Navigation clavier (Tab) : anneau de focus **visible** sur TOUS les boutons biseautés | ☐ |
| Skip-link : apparaît au premier Tab, atteint le contenu, miroir à droite en arabe | ☐ |
| `prefers-reduced-motion` activé : aucune transition (survols, offcanvas, collapse) | ☐ |
| Boutons des glyphes de thème ◐ ☀ ☾ : annonce « Système / Clair / Sombre » au lecteur d'écran | ☐ |

## 4. Mobile-only (à faire sur un vrai téléphone)

| Vérification | Résultat |
|---|---|
| **iPhone : pas de zoom** au focus des champs du formulaire de commande (§ 4.3 ②) | ☐ |
| Défilement horizontal de la barre système invisible (scrollbar masquée) | ☐ |
| CTA collant PDP : le bouton n'est jamais masqué par le clavier ouvert | ☐ |
| FAB WhatsApp : taille réduite mais ≥ 44 px de zone tactile | ☐ |
| Pas de lag au survol/scroll sur Android bas de gamme (backdrop-filter limité nav+CTA) | ☐ |

## 5. Impression (lot L5)

| Vérification | Résultat |
|---|---|
| Ticket comptoir (desk → imprimer) : **blanc, sans biseaux, sans fond sombre** | ☐ |
| Aperçu avant impression d'une fiche produit : lisible, chrome masqué | ☐ |
| Consommation d'encre : aucun aplat noir imprimé | ☐ |

---

## Ce qui est déjà vérifié automatiquement (ne pas re-tester)

| Contrôle | Où |
|---|---|
| Contraste WCAG AA des 14 paires × 2 thèmes (calcul de luminance réel) | `cyberDesign.test.js` T2 |
| Breakpoints = échelle Bootstrap uniquement | T3 |
| Cibles tactiles ≥ 44 px sous 576 px | T4 |
| Jamais de clip-path sur un sélecteur :focus | T5 |
| Aucune couleur en dur dans cyber.css (hors impression) | T6 |
| Pas de largeur fixe sur cartes/colonnes | T7 |
| Biseaux = polygones symétriques (RTL-safe) | T8 + T12 |
| Champs ≥ 16 px sous 576 px (anti-zoom iOS) | T10 |
| Impression : clip-path none + couches retirées + fond blanc | T11 |
| letter-spacing 0 en RTL, casse compensée, repli Noto Naskh Arabic | T13-T15 |
| Rendu DOM des 13 pages × 2 langues, 0 erreur JS | `npm run build:crawl && node scripts/jsdom-crawl.mjs` |

**Décisions client actées pendant l'intégration** (§ 8 du plan) :
1. Accent **cyan** (option a) — le vert historique ne subsiste que dans
   `logo.png` et les couleurs de marque WhatsApp/réseaux.
2. **logo.png conservé** (le cartouche `◧` de la maquette n'a pas été
   retenu — rupture d'identité évitée).
3. Thème clair conservé, décliné en **« papier technique »** (option B).
