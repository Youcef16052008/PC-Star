# Plan d'intégration — Direction 03 « Terminal Cyber »

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


> **Statut :** plan validé, non démarré. *(statut à la date du plan : il a depuis été mené lot par lot, L0 → L7 — la suite est dans `BUGS-AND-FIXES.md`)* Rien dans `src/` n'est encore modifié.
> **Référence visuelle :** `design-mockups/03-terminal-cyber.html`
> **Contrainte explicite du client :** le site doit être **responsive téléphone et PC**.
> Ce plan consacre donc une section entière (n° 4) au responsive, et chaque lot
> porte sa propre grille de vérification mobile.

---

## 1. Périmètre — ce qui change, ce qui ne change pas

### Ce qui change (apparence uniquement)

| Couche | Changement |
|---|---|
| Palette | vert `#22c55e` → **cyan `#22d3ee`**, fonds quasi-noirs `#07090c` |
| Typographie | Inter → **Chakra Petch** (titres) + **JetBrains Mono** (données/UI) |
| Géométrie | coins arrondis → **coins biseautés** (`clip-path` polygonal) |
| Texture | filets fins `#1c2733`, métadonnées en majuscules espacées |
| Composants | cartes, boutons, badges, sections, nav, tableaux |

### Ce qui ne change **absolument pas**

- **Aucune logique métier** : `shopStore.js`, `orderLogic.js`, `api.js`, `server/*` intacts.
- **Aucune route ni page** : les 13 pages restent identiques en structure.
- **Les 482 clés i18n × 3 langues** (compte vérifié : `ar` 482, `fr` 482, `en` 482) —
  aucune clé ajoutée, retirée ou renommée.
- **Le DOM** : aucune classe Bootstrap retirée (241 `btn`, 60 `card`, 11 `offcanvas`,
  7 `modal` — les retirer casserait les tests P22 qui cliquent dessus).
- **L'accessibilité existante** : skip-link, `aria-*`, `prefers-reduced-motion`, impression.
- **La CSP** : elle autorise déjà `fonts.googleapis.com` / `fonts.gstatic.com`
  (`vercel.json:53`), donc **aucune modification de CSP n'est nécessaire**.

### Pourquoi c'est un chantier à risque maîtrisé

Mesure faite sur le dépôt : **0 couleur codée en dur dans les 12 fichiers JSX**
(`grep -E "#[0-9a-fA-F]{6}" src/*.jsx` → aucune occurrence) et seulement **22 styles
inline** au total. Tout passe déjà par les variables CSS. **Le re-theming est donc un
travail de CSS, pas de JSX.** C'est la meilleure nouvelle de cet audit.

---

## 2. Constats de départ (mesurés, pas supposés)

| # | Constat | Source | Conséquence sur le plan |
|---|---|---|---|
| 1 | Le site est **RTL par défaut** : `<html lang="ar" dir="rtl">` | `index.html:2` | La maquette a **0 mention** de RTL/arabe. **Lot 6 obligatoire.** |
| 2 | Tokens actuels : 16 variables + 6 ponts `--bs-*` | `src/index.css:1-46` | Mapping direct possible, voir § 3. |
| 3 | Deux thèmes vivants : `data-theme=dark` **et** `light`, commutables | `App.jsx:178-179,662` + `theme-boot.js` | Terminal Cyber est sombre → il faut **aussi** décliner le thème clair. |
| 4 | Bootstrap 5 **en bundle** (pas CDN) | `src/main.jsx:5` | On garde Bootstrap, on l'habille. Ordre d'import critique. |
| 5 | Points de rupture CSS actuels : **575.98px et 768px seulement** | `src/index.css:137,461` | La maquette en utilise **8** (520→1000). **À consolider.** |
| 6 | Nav mobile **déjà fonctionnelle** : `navbar-expand-lg` + toggler + collapse | `App.jsx:909-938` | La maquette n'avait **aucun** menu mobile (`.navlinks{display:none}` à 940px, sans hamburger). On **restyle l'existant**, on n'en construit pas un nouveau. |
| 7 | Panier en `offcanvas-end` piloté par l'API Bootstrap | `App.jsx:1404-1418` | À habiller, pas à remplacer. |
| 8 | `safe-area-inset-bottom` déjà utilisé une fois | `src/index.css:485` | Le précédent existe → le généraliser. |
| 9 | `--blue` vaut `#22c55e` (vert) ; `theme-color` meta = `#16a34a` | `index.css:8`, `index.html:8` | **Décision de marque à trancher** — voir § 8. |
| 10 | `logo.png` : **950×640 px, 36 856 octets**, affiché à 40 px (32 px < 576 px) | `public/logo.png`, `index.css:131-140` | Suffisant pour retina 3×. La maquette propose un **cartouche biseauté `◧`** à la place → à arbitrer. |
| 11 | `@media print` pour les tickets de commande | `src/index.css:528` | Le biseautage et les fonds noirs **cassent l'impression** → garde-fou obligatoire. |
| 12 | 2 blocs `prefers-reduced-motion` existants | `index.css:172,500` | Les nouveaux effets de survol doivent être couverts. |

---

## 3. Architecture CSS cible

### 3.1 Découpage en 3 fichiers (au lieu d'un seul de 561 lignes)

```
src/main.jsx
  ├─ bootstrap/dist/css/bootstrap.min.css   (inchangé — socle)
  ├─ ./tokens.css        ← NOUVEAU : variables seules, 0 règle
  ├─ ./index.css         (existant — structure, layout, a11y, print)
  └─ ./cyber.css         ← NOUVEAU : habillage Terminal Cyber
```

**Règle d'or :** `tokens.css` ne contient **que** des déclarations `--x: valeur;`.
`cyber.css` ne contient **aucune** couleur en dur — uniquement des `var(--…)`.
Ainsi changer de direction graphique plus tard = réécrire `tokens.css` seul.

### 3.2 Mapping des tokens (maquette → site)

| Maquette 03 | Variable du site | Valeur | Statut |
|---|---|---|---|
| `--bg: #07090c` | `--bg` | `#07090c` | remplace |
| `--panel: #0d1116` | `--card` | `#0d1116` | remplace |
| `--panel-2: #111720` | `--soft` | `#111720` | remplace |
| `--text: #dfe7ef` | `--ink` | `#dfe7ef` | remplace |
| `--text-2: #8fa1b3` | `--muted` | `#8fa1b3` | remplace |
| `--muted: #5d6f80` | **`--muted-2`** | `#5d6f80` | **nouveau** |
| `--line: #1c2733` | `--line` | `#1c2733` | remplace |
| `--line-hi: #2a3a4a` | **`--line-hi`** | `#2a3a4a` | **nouveau** |
| `--cyan: #22d3ee` | `--blue` | `#22d3ee` | remplace ⚠ § 8 |
| — | `--blue-2` | `#0ea5c4` | remplace (état survol) |
| — | `--blue-on` | `#04212a` | remplace (texte sur accent) |
| `--amber: #fbbf24` | `--warn` | `#fbbf24` | remplace |
| `--red: #f87171` | `--danger` | `#f87171` | remplace |
| `--cyan-dim: rgba(34,211,238,.1)` | **`--accent-dim`** | idem | **nouveau** |
| `--disp` | **`--font-display`** | `'Chakra Petch', …` | **nouveau** |
| `--mono` | **`--font-mono`** | `'JetBrains Mono', 'Noto Naskh Arabic', …` | **nouveau** |
| `--chamf` | **`--chamf`** | polygon 10 px | **nouveau** |
| `--chamf-sm` | **`--chamf-sm`** | polygon 6 px | **nouveau** |

**Résultat :** 16 variables existantes conservées (mêmes noms → les 561 lignes
d'`index.css` continuent de fonctionner sans réécriture), **5 nouvelles**, **0 supprimée**.

### 3.3 Le thème clair n'est pas oublié

Terminal Cyber est sombre, mais `html[data-theme='light']` est **atteignable**
(`App.jsx:662` + `theme-boot.js`). Trois options, **recommandation : B** :

- **A.** Supprimer le thème clair → il faut retirer le commutateur et 3 clés i18n. **Rejeté** : touche à l'i18n, interdit par le périmètre.
- **B. (recommandé)** Décliner `data-theme='light'` en **« papier technique »** : mêmes polices, mêmes biseautages, mêmes filets, palette inversée (`#f2f5f8` / encre `#0b1220` / accent cyan assombri `#0e7490` pour tenir le contraste). L'identité Terminal Cyber est **géométrique**, pas seulement chromatique — elle survit très bien en clair.
- **C.** Forcer `data-theme='dark'` en dur → le commutateur devient un bouton mort. **Rejeté.**

---

## 4. ⚠ LE PLAN RESPONSIVE — cœur de la demande

### 4.1 Le problème : deux échelles concurrentes

La maquette utilise **8 points de rupture** arbitraires : `520, 560, 700, 720, 860, 900, 940, 1000 px`.
Le site en utilise **2** : `575.98` et `768 px`. Bootstrap en définit **5** : `576, 768, 992, 1200, 1400`.

Reprendre les 8 de la maquette créerait **trois échelles** qui se contredisent → bugs de
mise en page impossibles à diagnostiquer. **Décision : on s'aligne sur Bootstrap.**

| Palier | Largeur | Cible réelle | Ce qui s'y passe |
|---|---|---|---|
| **xs** | `< 576` | téléphone portrait (360–414 px) | 1 colonne, nav repliée, CTA collant |
| **sm** | `576–767` | grand téléphone / petit paysage | 2 colonnes cartes, 4 catégories |
| **md** | `768–991` | tablette | 2–3 colonnes, nav encore repliée (`navbar-expand-lg`) |
| **lg** | `992–1199` | petit portable | nav dépliée, 4 colonnes, split 2 colonnes |
| **xl** | `≥ 1200` | écran de bureau | 4 colonnes, conteneur 1200 px |

**Les 8 valeurs de la maquette y sont absorbées** (520/560 → xs, 700/720 → sm,
860/900/940/1000 → md/lg). Aucun palier orphelin.

### 4.2 Comportement composant par composant

| Composant | Téléphone `< 576` | Tablette `768–991` | Bureau `≥ 1200` |
|---|---|---|---|
| **Barre système** (`.sysbar`) | 1 ligne, défilement horizontal **masqué**, bloc droit caché | 1 ligne complète | 1 ligne complète |
| **Nav** | toggler + collapse (existant), liens empilés pleine largeur | idem (Bootstrap `expand-lg`) | liens horizontaux espacés |
| **Logo** | 32 px de haut (déjà en place) | 40 px | 40 px |
| **Hero** | `min-height: 100dvh` **jamais** `100vh`, titre `clamp(30px, 8vw, 66px)`, colonne unique | colonne unique | 2 colonnes |
| **Lecture système** (`.readout`) | **2 colonnes** | 4 colonnes | 4 colonnes |
| **Catégories** | **2 colonnes** | 3 colonnes | 6 colonnes |
| **Cartes produits** | **1 colonne** | 2 colonnes | 4 colonnes |
| **Configurateur** | empilé, récap **non** collant | empilé | split + récap `position: sticky` |
| **Magasin** (carte + plan) | empilé, plan `height: 260px` | empilé | 1.1fr / 0.9fr |
| **Footer** | 1 colonne | 2 colonnes | 3 colonnes |
| **CTA PDP collant** | présent + `safe-area-inset-bottom` | présent | masqué (`d-lg-none`) |
| **FAB WhatsApp** | réduit (`13px`, 10/14 px de padding — déjà en place) | idem | pleine taille |

### 4.3 Les 6 pièges mobiles spécifiques à ce design — et leur correctif

**① Les boutons sont trop petits pour le doigt.**
La maquette définit `.add { padding: 6px 12px; font-size: 11px; border: 1px }` → hauteur
réelle **27 px** (6×2 + 1×2 + 11×1.2). Le bouton principal `.btn` (padding 9px, 12px)
monte à **34 px**. Les deux sont sous la norme.
La norme tactile est **44 × 44 px** (WCAG 2.5.8 / Apple HIG). Sur un téléphone, un
client rate le bouton « Ajouter ».
**Correctif :** sous `576 px`, tout élément cliquable passe à `min-height: 44px` et
`font-size: 13px` minimum. Une règle globale `.btn, .nav-link, .add, [role="button"]`
dans `cyber.css`, pas 40 règles éparses.

**② iOS zoome dans les champs de saisie.**
Safari iOS déclenche un **zoom forcé** au focus de tout `input` dont le `font-size` est
`< 16px`. La maquette met du 12 px monospace partout → le formulaire de commande
« sauterait » à chaque champ sur iPhone, et le dészoom ne se fait pas tout seul.
**Correctif :** `input, select, textarea { font-size: 16px }` sous `576 px`. La police
monospace reste, seule la taille change. C'est un bug invisible sur PC et insupportable
sur iPhone — d'où sa place ici.

**③ `clip-path` avale l'anneau de focus.**
Un `clip-path` rogne **tout** le rendu de l'élément, y compris `outline` **et**
`box-shadow`. Appliqué tel quel, `.btn:focus-visible` devient **invisible** → le site
devient inutilisable au clavier. C'est le plus gros risque d'accessibilité de ce design.
**Correctif architectural :** on ne biselle **jamais** l'élément interactif lui-même. On
biselle un pseudo-élément de fond `::before` (positionné `inset:0`, `z-index:-1`) et on
laisse la boîte de l'élément intacte. L'anneau de focus s'affiche alors normalement.
Un test automatique vérifiera qu'aucun sélecteur combinant `clip-path` et `:focus`
n'existe.

**④ Le biseautage est disproportionné sur petit écran.**
Un chanfrein de 10 px sur une carte de 100 % de large dans un écran de 360 px mange une
part visible de la surface et fait « jouet ».
**Correctif :** `--chamf` est **redéfini** sous `576 px` à 6 px, et `--chamf-sm` à 4 px.
Une seule variable change, tout le site suit.

**⑤ La barre système déborde horizontalement.**
Contenu réel de la maquette (l. 178) : `● SYS.ONLINE _ · comptoir ouvert · oran`, soit
**40 caractères** en JetBrains Mono 11 px avec `letter-spacing: .07em`.

Largeur nécessaire : `40 × (11 × 0.6) = 264 px` pour les glyphes, `+ 40 × (11 × 0.07) = 31 px`
pour l'espacement, `+ 52 px` de padding `.wrap` → **≈ 347 px**.

Sur un **iPhone SE (320 px)**, il manque donc **~27 px** → la page entière prend un scroll
horizontal parasite. C'est le bug responsive le plus courant et le plus laid : il ne se
voit que sur le plus petit téléphone du parc, et il décale tous les éléments `position: sticky`.

**Correctif :** `overflow-x: auto` + `scrollbar-width: none` + `overscroll-behavior-x: contain`
sur `.wrap`, et `body { overflow-x: hidden }` en filet de sécurité. Le bloc droit
(`.right`, l. 179) est déjà masqué sous 700 px. En arabe la chaîne est plus large encore —
le défilement masqué absorbe les trois langues sans règle par langue.

**⑥ Le chrome fixe écrase l'écran.**
Sur un téléphone en **paysage** (667 × 375 px), la nav collante + le CTA collant + le FAB
peuvent occuper plus de la moitié de la hauteur.
**Correctif :** le hero passe en `100dvh` (et non `100vh`, qui ignore la barre d'URL
mobile) ; sous `576 px` **et** `max-height: 500px`, le hero perd son `min-height`.
On ajoute aussi `scroll-padding-bottom` pour que les ancres ne se cachent pas sous le CTA.

### 4.4 Garde-fous transverses

- **Conteneur fluide :** `.container` Bootstrap plafonne à 1140/1320 px. On garde ce
  comportement — sur un 2560 px, une ligne de texte pleine largeur est illisible.
- **Images :** `max-width: 100%; height: auto` partout, `loading="lazy"` sur les
  vignettes de catalogue (déjà géré par `media.js`).
- **Impression :** `@media print` existant (`index.css:528`) → on y ajoute
  `-webkit-print-color-adjust: auto` et la **suppression du biseautage**
  (`clip-path: none !important`), sinon les tickets de commande sortent avec des coins
  mangés sur fond noir et consomment toute l'encre.
- **Mouvement réduit :** les 2 blocs `prefers-reduced-motion` existants sont étendus à
  toutes les nouvelles transitions (survols, halos, transitions de page).

### 4.5 Comment on **vérifie** le responsive ici (honnêtement)

Cet environnement n'a **pas de navigateur** : Playwright échoue au téléchargement
(`Download failure, code=1`). Je ne peux donc **pas** mesurer un rendu réel. Voici ce
qui est vérifiable par exécution, et ce qui ne l'est pas :

**Vérifiable automatiquement** (nouveau fichier `src/cyberDesign.test.js`) :
1. **Contraste WCAG calculé numériquement** pour chaque paire token/fond
   (`--ink`/`--bg`, `--blue-on`/`--blue`, `--muted`/`--bg`…) → seuil **AA 4.5:1**.
   C'est un vrai calcul (luminance relative), pas une assertion décorative.
2. **Échelle de points de rupture :** le test parse `cyber.css` et échoue si une
   media query utilise une largeur hors `{575.98, 767.98, 991.98, 1199.98, 1399.98}`.
   C'est ce qui empêche le retour des 8 paliers concurrents.
3. **Cibles tactiles :** toute règle sous `max-width: 575.98px` visant un élément
   cliquable doit déclarer `min-height ≥ 44px`.
4. **Aucun `clip-path` sur un sélecteur portant `:focus`.**
5. **Aucune couleur en dur** dans `cyber.css` (tout doit passer par `var(--…)`).
6. **Aucune largeur fixe** supérieure à 100 % sur les cartes et colonnes.
7. **RTL :** présence des miroirs `[dir='rtl']` pour chaque `clip-path` directionnel.

**Non vérifiable ici — à faire par vous sur un vrai appareil :** rendu réel, ressenti
typographique arabe, comportement du scroll, zoom iOS. Je vous fournirai une **grille de
recette manuelle** (11 largeurs × 3 langues) à cocher. C'est une limite assumée, pas un
angle mort passé sous silence.

---

## 5. Le plan RTL / arabe (lot 6) — le plus gros écart avec la maquette

La maquette a été écrite en LTR et ne contient **aucune** règle pour l'arabe. Or le site
s'ouvre **en arabe par défaut**. Cinq problèmes réels :

| # | Problème | Détail technique | Correctif |
|---|---|---|---|
| **R1** | **Biseautage non miroir** | `clip-path: polygon()` est **géométrique** : il ignore totalement `dir="rtl"`. Les chanfreins resteront physiquement en haut-à-gauche / bas-à-droite, donc **à contre-sens** de la lecture arabe. | Doubler chaque polygon sous `[dir='rtl']` avec les coins inversés. |
| **R2** | **`letter-spacing` casse l'arabe** | L'espacement de lettres **rompt la liaison cursiv**e des glyphes arabes dans plusieurs moteurs. Le style « terminal espacé » est destructeur en arabe. | `html[dir='rtl'] { letter-spacing: 0 !important }` sur les titres et libellés. |
| **R3** | **`text-transform: uppercase` est inopérant** | L'arabe n'a pas de casse. Les titres de section auront un aspect différent selon la langue. | Compenser en arabe par un poids plus fort (`font-weight: 700`) plutôt que par la casse. |
| **R4** | **Les polices n'ont pas de glyphes arabes** | Ni Chakra Petch ni JetBrains Mono ne couvrent l'arabe → repli navigateur aléatoire. | Chaîne de repli explicite : `'JetBrains Mono', 'Noto Naskh Arabic', ui-monospace, monospace` — **Noto Naskh Arabic est déjà chargée** (`index.html:19`), rien à ajouter. |
| **R5** | **Le monospace ne l'est pas en arabe** | Noto Naskh Arabic est proportionnelle : les tableaux de specs n'auront pas l'alignement « terminal » en arabe. | Accepté. L'alignement des valeurs passe par `display: grid` (déjà le cas dans `.specrow`), pas par la chasse fixe. |

**Note de périmètre :** aucune de ces corrections n'ajoute de clé i18n. Ce sont
uniquement des règles CSS conditionnelles.

---

## 6. Accessibilité — points non négociables

### 6.1 Contraste : **la maquette 03 échoue au niveau AA** — à corriger en L0

Chaque paire a été **calculée** (luminance relative WCAG, pas une estimation) :

| Paire | Ratio | AA texte (4.5:1) | AA ≥ 18 px (3:1) |
|---|---|---|---|
| `--text` / `--bg` | **15.96:1** | ✅ | ✅ |
| `--text` / `--panel` | **15.16:1** | ✅ | ✅ |
| `--text-2` / `--bg` | **7.52:1** | ✅ | ✅ |
| `--text-2` / `--panel` | **7.14:1** | ✅ | ✅ |
| `--cyan` / `--bg` | **11.03:1** | ✅ | ✅ |
| `--amber` / `--bg` | **11.94:1** | ✅ | ✅ |
| `--red` / `--bg` | **7.21:1** | ✅ | ✅ |
| `--blue-on` / `--cyan` | **9.25:1** | ✅ | ✅ |
| **`--muted` / `--bg`** | **3.85:1** | ❌ **ÉCHEC** | ✅ |
| **`--muted` / `--panel`** | **3.65:1** | ❌ **ÉCHEC** | ✅ |
| **`--muted` / `--panel-2`** | **3.47:1** | ❌ **ÉCHEC** | ✅ |

**Conclusion :** la couleur `--muted: #5d6f80` de la maquette **ne passe pas le niveau AA
pour du texte courant** (il manque 0.65 point). Elle sert pourtant aux mentions légales,
aux métadonnées et aux libellés de formulaire.

**Correctif retenu :** remonter `--muted` à **`#7d8fa1`** (≈ 5.3:1 sur `--bg`), et
réserver la valeur d'origine `#5d6f80` à la nouvelle variable `--muted-2`, utilisable
**uniquement** pour du texte décoratif ≥ 18 px ou des éléments non textuels. Le recalcul
sera ajouté à `src/cyberDesign.test.js` pour qu'aucune régression ne repasse en dessous.

**Cas particulier `--line` (`#1c2733` sur `#07090c` = 1.32:1) :** ce n'est **pas** un
échec — c'est un filet décoratif d'un pixel, pas une frontière de composant. WCAG 1.4.11
n'exige 3:1 que pour les limites **nécessaires à identifier un contrôle**. Ici les
panneaux sont déjà identifiables par leur fond `--panel`, plus clair que `--bg`. En
revanche, les **champs de saisie** ne doivent pas reposer sur `--line` seul : ils
passeront à `--line-hi` (`#2a3a4a`).

### 6.2 Le reste

| Exigence | Cible | Risque introduit par ce design |
|---|---|---|
| Anneau de focus visible | obligatoire | **`clip-path` le rogne** → corrigé par l'architecture `::before` (§ 4.3 ③) |
| Cibles tactiles | **≥ 44 × 44 px** | `.add` = **27 px**, `.btn` = **34 px** dans la maquette → corrigé § 4.3 ① |
| `prefers-reduced-motion` | respecté | nouveaux survols/halos → étendre les 2 blocs existants (`index.css:172,500`) |
| Skip-link | conservé | `index.css:418` — à restyler, pas à retirer |
| Glyphes de thème `◐ ☀ ☾` | sans `aria-label` | **`App.jsx:987-989`** — à corriger pendant le lot 2, puisque la nav est ouverte |
| Impression lisible | `@media print` | `clip-path: none` obligatoire (§ 4.4) |

---

## 7. Performance

**Baselines mesurées dans ce dépôt avant tout changement** (`npm run build`, Vite 6.4.3,
111 modules) :

```
dist/index.html                  1.63 kB │ gzip:   0.73 kB
dist/assets/index-*.css        240.77 kB │ gzip:  33.77 kB   ← Bootstrap + index.css
dist/assets/react-*.js          11.69 kB │ gzip:   4.17 kB
dist/assets/bootstrap-*.js      81.64 kB │ gzip:  24.64 kB
dist/assets/index-*.js         424.53 kB │ gzip: 127.75 kB   ← application
✓ built in 2.39s
```

| Poste | Impact attendu | Contrôle |
|---|---|---|
| **Polices** | + 2 familles Google. JetBrains Mono (latin, 2 graisses) ≈ 40 ko woff2 ; Chakra Petch ≈ 25 ko. Chargées hors bundle, donc **0 impact** sur les chiffres ci-dessus. | `display=swap` (déjà), `preconnect` (déjà, `index.html:17-18`), `unicode-range` pour ne pas charger l'inutile. |
| **Bundle JS** | **0 ko** — aucune logique touchée. | Doit rester **exactement 424,53 kB / 127,75 kB gzip**. Toute dérive = une logique a bougé par erreur. |
| **Bundle CSS** | C'est **ici** que ça pousse : `cyber.css` ≈ +12–18 ko brut. | **Seuil d'alerte : CSS gzip > 40 ko** (baseline 33,77 ko). Au-delà, on dé-duplique avant de continuer. |
| **`backdrop-filter`** | déjà utilisé (`.shop-navbar`) — coût GPU sur mobile bas de gamme. | Ne **pas** l'étendre aux cartes produits (60 cartes = 60 couches de flou). Réservé à la nav et au CTA collant. |
| **`clip-path`** | crée un contexte d'empilement par élément. | Aucune animation sur `clip-path` (non compositable) — animer uniquement `transform`/`opacity`. |
| **Temps de build** | 2,39 s actuellement. | Doit rester < 10 s. |

---

## 8. ⚠ Décisions à trancher avant de coder

Trois arbitrages qui changent le rendu et que je ne prendrai pas seul :

1. **Le vert disparaît-il ?** Terminal Cyber est **cyan**. Or `--blue` vaut `#22c55e`
   (vert), `theme-color` vaut `#16a34a`, et `logo.png` porte l'identité verte.
   - *(a)* cyan pur → cohérent avec la maquette, mais **rupture de marque** ;
   - *(b)* cyan en UI + vert conservé sur le logo et `theme-color` → compromis ;
   - *(c)* garder le vert comme accent unique sur fond charbon → **le plus sobre et le
     plus « pro »**, mais ce n'est plus tout à fait la maquette 03.
2. **Le logo.** `logo.png` (950×640) ou le **cartouche biseauté `◧` + `PC_STAR`** de la
   maquette ? Le second est plus cohérent avec le design et ne pèse rien, mais abandonne
   le logo actuel.
3. **Le thème clair.** Option B du § 3.3 (déclinaison « papier technique ») vous
   convient-elle, ou préférez-vous un site **uniquement sombre** ?

---

## 9. Découpage en lots — chacun avec sa porte de validation

| Lot | Contenu | Fichiers | Porte de validation |
|---|---|---|---|
| **L0** | Socle : `tokens.css` (dark + light), polices, `theme-color`, chaîne de repli arabe | `tokens.css` (nouv.), `main.jsx`, `index.html` | `npm test` **300/300**, `npm run build`, `npm run smoke` |
| **L1** | Typographie & géométrie : `--chamf`, titres Chakra Petch, données monospace, filets, l'architecture `::before` anti-focus-rogé | `cyber.css` (nouv.), `index.css` | idem + `src/cyberDesign.test.js` (contraste, breakpoints, clip-path/focus) |
| **L2** | Barre système + nav + menu mobile + offcanvas panier + `aria-label` des glyphes de thème | `cyber.css`, `App.jsx` (classes seulement) | idem + crawl jsdom des 13 pages × 3 langues, 0 erreur |
| **L3** | Hero + catégories + cartes produits + footer + FAB | `cyber.css`, `index.css` | idem + seuil tactile 44 px vérifié |
| **L4** | Pages intérieures : produit, recherche, configurateur, commandes, profil, mentions | `cyber.css` | idem |
| **L5** | Back-office : master + desk + impression des tickets | `cyber.css` | idem + **`@media print` contrôlé** |
| **L6** | **RTL/arabe** : miroirs `clip-path`, `letter-spacing: 0`, compensation de casse, replis de police | `cyber.css` | idem + crawl **en arabe** + test R1–R5 |
| **L7** | Recette responsive finale : matrice 11 largeurs × 3 langues, `prefers-reduced-motion`, `100dvh`, garde-fous paysage | `cyber.css` | idem + grille de recette livrée |

**Règle de discipline :** un lot = un commit = une porte verte. On ne passe jamais au lot
suivant avec un commit rouge. C'est ce qui a permis de tenir 300/300 sur P22.

---

## 10. Grille de recette responsive (à cocher sur appareils réels)

| Largeur | Appareil type | Points à vérifier |
|---|---|---|
| **320 px** | iPhone SE / petit Android | aucun scroll horizontal, sysbar défilante, 2 catégories/ligne |
| **360 px** | Android courant | boutons « Ajouter » ≥ 44 px, hero lisible |
| **390 px** | iPhone 14/15 | CTA collant + safe-area, pas de chevauchement footer |
| **414 px** | iPhone Plus | 1 colonne cartes, nav repliée |
| **576 px** | seuil xs→sm | bascule 1 → 2 colonnes propre |
| **667 × 375** | **paysage téléphone** | hero pas écrasé, nav + CTA < 50 % de hauteur |
| **768 px** | tablette portrait | 2 colonnes, nav toujours repliée |
| **992 px** | seuil md→lg | nav qui se déplie, 4 colonnes |
| **1200 px** | portable | split configurateur + récap collant |
| **1440 px** | bureau | conteneur plafonné, pas d'étirement |
| **2560 px** | grand écran | longueur de ligne maîtrisée |

× **3 langues** (ar / fr / en) = **33 combinaisons**. En arabe, vérifier en plus :
biseautage miroir, absence de lettres arabes disjointes, tableaux de specs alignés.

---

## 11. Risques et plan de repli

| Risque | Probabilité | Mitigation |
|---|---|---|
| Les tests P22 (4 026 clics) cassent parce qu'une classe a bougé | **moyenne** | Aucune classe Bootstrap retirée. Le crawl jsdom est relancé à **chaque** lot. |
| `clip-path` casse l'impression des tickets | **élevée** si oublié | `clip-path: none !important` dans `@media print`, lot L5. |
| L'arabe rendu avec des glyphes disjoints | **élevée** | `letter-spacing: 0` sur `[dir='rtl']`, lot L6, test dédié. |
| iOS zoom dans les formulaires | **certaine** si oublié | `font-size: 16px` sous 576 px, lot L1, test dédié. |
| Le cyan heurte l'identité verte existante | — | Décision § 8 **avant** de coder. |
| Surcharge GPU sur mobile bas de gamme | faible | `backdrop-filter` limité à 2 éléments (§ 7). |
| **Repli complet** | — | `tokens.css` est un fichier **unique et isolé** : revenir au thème actuel = `git revert` d'un seul fichier. Aucun JSX n'est engagé dans le lot L0. |

---

## 12. Synthèse

- **Surface du chantier :** ~3 fichiers CSS (1 modifié, 2 nouveaux) + touches de classes
  dans `App.jsx`. **Aucune** logique, **aucune** route, **aucune** clé i18n.
- **Point le plus risqué :** l'arabe/RTL (§ 5) — la maquette n'en tient aucun compte alors
  que le site s'ouvre en arabe.
- **Point le plus souvent oublié :** l'iOS zoom et les cibles tactiles (§ 4.3 ① et ②) —
  invisibles sur PC, rédhibitoires sur téléphone.
- **Ce que je ne peux pas faire ici :** voir le rendu. Aucun navigateur disponible. Les
  7 contrôles automatiques du § 4.5 couvrent ce qui est calculable (contraste, paliers,
  tailles tactiles, clip-path/focus, RTL) ; le reste passe par la grille du § 10.

**Prochaine étape :** vos trois arbitrages du § 8, puis j'attaque le lot **L0**.
