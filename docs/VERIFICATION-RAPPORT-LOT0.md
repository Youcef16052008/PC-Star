# Rapport de vérification — le « lot 0 » annoncé sur `arena/01a090f7-pc-star`

**Objet.** Vérifier, commande par commande, le rapport d'exécution du lot 0
(« changement des comptes / mots de passe ») annoncé sur la branche
`arena/01a090f7-pc-star`, commit `2880c2a256b6c7e3ce4f816de6447f931514f400`
(16/09/2026 08:52, auteur `Youcef16052008 <youcef@example.com>`).

**Méthode.** Inspection **en lecture seule** depuis la branche
`arena/01a0a55c-pc-star` (PR #6) : `git fetch`, `git show`, `git diff`,
`git grep`, `git ls-tree`. Aucun changement de branche, aucun fichier de la
branche lot 0 modifié. Trois expériences ont été menées dans l'arbre de travail
(dossier imbriqué posé, docs posées à la racine, 19 fichiers posés à la racine)
et **toutes restaurées** : `git status --porcelain` vide après chacune, HEAD
inchangé (`3a4b070`).

---

## Verdict

> **Le lot 0 n'est pas réalisé. Le commit `2880c2a` ne modifie aucun fichier de
> l'application : il ajoute 19 fichiers dans un dossier imbriqué `PC-Star-main/`
> qui n'est ni construit, ni testé, ni déployé. Sur cette branche comme sur
> `main`, le mot de passe compromis `star31` est toujours le seed du compte
> maître. En revanche, quatre NOUVEAUX mots de passe — dont celui du compte
> admin — sont maintenant publiés en clair dans un dépôt public.**
>
> Le travail est donc **nul pour la sécurité** (le secret exposé reste valide) et
> **négatif** (quatre secrets de plus sont exposés). Il ne faut pas le fusionner.

Trois faits suffisent à établir le verdict :

```
$ git show --stat --format="" 2880c2a -- . ':(exclude)PC-Star-main'
(vide)                                    ← aucun fichier de l'application touché

$ git show origin/arena/01a090f7-pc-star:server/db.js | grep -n "hashPassLegacy('"
22:  passwordHash: hashPassLegacy('star31'),        ← le secret compromis, intact
67:    passwordHash: hashPassLegacy('karim31'),
81:    passwordHash: hashPassLegacy('amina31'),
95:    passwordHash: hashPassLegacy('yacine31'),

$ gh repo view --json isPrivate
{"isPrivate":false}                       ← dépôt public
```

---

## 1. Vérification, affirmation par affirmation

| # | Annonce du rapport | Verdict | Preuve |
|---|---|---|---|
| 1 | Branche `arena/01a090f7-pc-star`, commit `2880c2a` | ✅ **Vrai** | `git ls-remote --heads origin` → `2880c2a2…  refs/heads/arena/01a090f7-pc-star` |
| 2 | « 19 fichiers modifiés, 3972 lignes ajoutées » | ⚠️ **Chiffres vrais, mot faux** | `git show --stat 2880c2a` → `19 files changed, 3972 insertions(+)`, **0 deletion**. Ce sont 19 fichiers **ajoutés** (pas modifiés), tous sous le préfixe `PC-Star-main/` |
| 3 | `server/db.js` : nouveaux hashes pour les 4 comptes | ⚠️ **Vrai dans une copie morte** | Les 4 `hashPassLegacy('…')` sont dans `PC-Star-main/server/db.js`. Le `server/db.js` **racine** de la même branche garde `star31` / `karim31` / `amina31` / `yacine31` (voir verdict) |
| 4 | `src/shopStore.js` : constantes `MASTER` et `CUSTOMERS` mises à jour | ❌ **Régression** | La copie réintroduit `export const MASTER = { … password: 'Czyx8f9g2jK3mWZ5R2Tn' }` en **ligne 3** — précisément l'objet que le lot 1.1 a supprimé du code client parce que Vite le livrait dans le bundle public |
| 5 | `README.md` : tableau des nouveaux mots de passe | ❌ **Publication de secret** | `PC-Star-main/README.md:19` → `| **Admin (magasin)** | pcstar.info31@gmail.com | Czyx8f9g2jK3mWZ5R2Tn |` dans un dépôt **public**, face à une boîte e-mail **réelle** |
| 6 | `docs/GUIDE-COMPTES.md`, `-FR`, `-AR` créés | ✅ **Vrai** (dans le dossier imbriqué) | `git ls-tree -r origin/arena/01a090f7-pc-star -- PC-Star-main` → les 3 fichiers, 4 occurrences de secret chacun |
| 7 | « Les anciens guides `GUIDE-DEMO*.md` existent toujours » | ⚠️ **Vrai, et incomplet** | Ils existent **mais ont été réécrits** avec les nouveaux mots de passe (+4/−4 chacun vs `main`) : trois fichiers de plus qui publient des secrets. Les guides **racine** de la branche, eux, contiennent encore `star31` (2 occurrences dans `docs/GUIDE-DEMO.md`) |
| 8 | « 14 fichiers de test mis à jour » | ❌ **Faux** | Le commit contient **8** fichiers `*.test.js` + `e2e/smoke.spec.js` + `scripts/smoke-e2e.mjs` = **10**, tous dans le dossier imbriqué. `src/shopStore.test.js` est annoncé mais **absent** du commit. Et **aucun** test réel n'est mis à jour : `npm test` liste explicitement 48 fichiers **racine** |
| 9 | Les 4 mots de passe correspondent aux hashes annoncés | ✅ **Vrai** | `hashPassLegacy` est déterministe : `sha256('pcstar:' + motDePasse)`. Recalculé : admin `6e3876fc…`, karim `fada3b8f…`, amina `64b0fcec…`, yacine `af757c27…`. La cohérence est **automatique** puisque le hash est calculé au chargement du module à partir du mot de passe en clair présent juste au-dessus |
| 10 | Objectif du lot 0 : le secret exposé n'est plus valide | ❌ **Non atteint** | Rien n'a changé dans l'application (point 3) **et** les quatre nouveaux secrets sont publiés (points 4-7). Un attaquant qui lit le dépôt dispose toujours de `star31` sur `main`, et de `Czyx8f9g2jK3mWZ5R2Tn` sur cette branche |

**Note technique (non annoncée).** Les hashes du seed passent par
`hashPassLegacy` = `crypto.createHash('sha256').update('pcstar:' + password)` :
**sans sel, un seul tour**. Le re-sel scrypt n'existe que dans `hashPass`, et la
migration P22 ne re-sel qu'au premier accès réussi. Un seed « rotaté » reste donc
un hash legacy — mais avec le mot de passe en clair publié à côté, la question du
hash est secondaire.

---

## 2. Les cinq problèmes bloquants

### P1 — Les 19 fichiers sont dans un dossier que rien n'exécute

`git ls-tree -r origin/arena/01a090f7-pc-star -- PC-Star-main` renvoie
**exactement 19 fichiers** : ce n'est pas un second checkout du projet, c'est un
extraît partiel (vraisemblablement un ZIP `PC-Star-main`) posé dans le dépôt.

Rien ne l'atteint :

- `npm test` liste **explicitement** 48 fichiers `src/*.test.js` racine — les
  8 copies imbriquées ne sont jamais exécutées ;
- `vite build` part de `index.html` → `src/main.jsx` racine — les copies
  imbriquées ne sont jamais bundlées ;
- `vercel.json` monte `api/` racine ; `server/index.js` importe `./db.js`
  racine.

Le rapport décrit donc des effets (comptes rotatés, tests à jour, docs publiées)
qui **n'existent dans aucun environnement** : ni en local, ni en préproduction,
ni sur Vercel.

### P2 — Quatre secrets neufs publiés en clair dans un dépôt public

`git grep -c -I "star31\|pcstar\.info31" origin/arena/01a090f7-pc-star` →
**32 fichiers**. La paire *e-mail réel + mot de passe admin* apparaît notamment
dans :

```
PC-Star-main/README.md:19
PC-Star-main/docs/GUIDE-COMPTES.md:19      (+ -FR:10, -AR:10)
PC-Star-main/docs/GUIDE-DEMO.md:23         (+ -FR:10, -AR:10)
PC-Star-main/scripts/smoke-e2e.mjs:60
PC-Star-main/server/db.js:21
PC-Star-main/src/apiServer.test.js:69,121,148 …
PC-Star-main/src/shopStore.js:3            ← bundle client
```

C'est **exactement** le défaut que le lot 0 devait fermer (rapport 1 : R1
« secret maître dans le bundle », R12 « identifiants dans la documentation »).
Remplacer `star31` par `Czyx8f9g2jK3mWZ5R2Tn` **en le publiant au même endroit**
ne rotate rien : le nouveau secret est compromis à la naissance. La mention
« ⚠️ Change passwords before production! » du message de commit reconnaît le
problème sans le résoudre — et le dépôt, lui, est déjà public.

Deux aggravations :

1. `src/shopStore.js` est un module **client** : ce mot de passe serait livré
   dans `dist/assets/index-*.js` à chaque visiteur du site déployé.
2. L'identifiant est une **boîte réelle** (`pcstar.info31@gmail.com`). Si ce mot
   de passe est réutilisé ailleurs (messagerie, hébergeur), l'exposition dépasse
   le cadre de l'application.

### P3 — La branche n'a aucun ancêtre commun avec `main`

```
$ git merge-base origin/main origin/arena/01a090f7-pc-star
(vide)
$ git merge-base --is-ancestor b3bb620 origin/main && echo OUI || echo NON
NON
$ git rev-list --count origin/main
1                      ← main = un seul commit racine, fdbd778
```

Le parent de `2880c2a` est `b3bb620` (13/09/2026), tête de la **PR #3 déjà
fusionnée**. Depuis, `main` a été réécrit en un commit unique `fdbd778`
(PR #5). Les deux histoires sont **disjointes** :

- `git merge` refuserait (« refusing to merge unrelated histories ») ;
- une PR depuis cette branche afficherait **922 fichiers changés, 984 insertions,
  14 235 suppressions** — tout le travail postérieur (lots 1 à 6, durcissement
  des sessions, lots 8.1-8.9, `design-mockups`, `vite.crawl.config.js`…)
  apparaîtrait comme **supprimé** ;
- la PR #3 étant fermée, `2880c2a` n'est porté par **aucune** PR : il n'est
  visible nulle part en revue.

À noter : les 19 copies imbriquées, elles, sont bien à jour par rapport à
`main` (diffs de 1 à 17 lignes, uniquement les identifiants). La périmption est
dans la **branche**, pas dans les copies — signe que le dossier a été extrait
depuis `main` récent puis posé dans une vieille branche.

### P4 — Fusionner casserait la suite : mesure

Expérience : les 19 fichiers posés **à la racine** de la branche PR #6
(état « comme si fusionné »), suite complète lancée, puis arbre restauré.

| État | Tests exécutés | Verts | Rouges | Annulés |
|---|---|---|---|---|
| PR #6 telle quelle (`3a4b070`) | **724** | **724** | 0 | 0 |
| + les 19 fichiers à la racine | 417 | 372 | **42** | **3** |

**307 tests ne sont même pas exécutés** (suites interrompues à l'import). Sur un
sous-ensemble ciblé (`masterSecrets`, `dbIntegrity`, `serverFixes`,
`lot3Server`) : **13 échecs sur 18**, dont nommément :

```
not ok - LOT 1.1 — le compte maître vient de l’environnement
not ok - LOT 1.2 — aucun identifiant maître dans le dépôt
not ok - intégrité de la base (B1)
not ok - purge des entrées expirées (B11)
not ok - src/lot3Server.test.js     (suite entière)
not ok - src/serverFixes.test.js    (suite entière)
```

Les deux verrous de sécurité livrés au lot 1 passent au rouge. À l'échelle des
fichiers, l'écart avec PR #6 est massif :

| Fichier | Leur copie vs PR #6 |
|---|---|
| `server/db.js` | **+75 / −688** — supprime `masterAccount()` (env obligatoire, échec propre si absent), l'alignement du maître sur l'env, l'écriture durable (lot 8.7), le diagnostic Neon |
| `src/shopStore.js` | **+78 / −78** — réintroduit le `MASTER` client en clair (lot 1.1) |
| `README.md` | +12 / −16 |

### P5 — Même appliqué à la racine, ça ne rotaterait rien sur le déploiement réel

Le seed n'est écrit **que si la base est absente** :

```js
// server/db.js:256-262 (PR #6)
function ensure() {
  …
  if (!fs.existsSync(DB_FILE)) {
    durableWriteFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2))
```

Sur une instance déjà constituée (`server/data/store.json` existant, ou Neon),
les utilisateurs en place **gardent leur ancien hash** : changer `emptyDb()` ne
change aucun compte réel. C'est précisément ce que le lot 1.1 a traité pour le
maître, et le commentaire du code le dit :

```js
// server/db.js:288-300 (PR #6)
// Avant ce correctif, la réinjection se contentait d'ajouter un maître *s'il
// n'y en avait aucun*. Sur une base déjà constituée, le compte maître existant
// — créé à l'époque où ses identifiants étaient codés en dur et livrés dans le
// bundle public — restait donc **indéfiniment** en place : poser MASTER_EMAIL /
// MASTER_PASSWORD n'aurait rien changé pour lui.
```

Or le plan classe le lot 0 dans les **« Prérequis non code »** :

> ### 🚨 Lot 0 — Prérequis non code (à faire AVANT tout déploiement)
> | Action | Pourquoi |
> |---|---|
> | **Changer le mot de passe master réel** et les trois mots de passe démo | Ils sont dans le bundle public **et** dans la documentation depuis des mois (R1, R12). Toute correction de code est inutile tant que le secret exposé reste valide. |
> | Vérifier si le compte master a été utilisé par un tiers (journal des commandes/clients) | Le secret est public ; l'accès est complet (commandes, clients, produits, CSV, suppression). |

Et §9 du plan : *« Le lot 0 (rotation des secrets réels) est reporté à la fin à
la demande du commanditaire : c'est une **action d'exploitant sur Vercel**, pas
du code. »* Le commit vérifié est du code — dans un dossier mort — qui publie de
nouveaux secrets. Il ne touche ni l'instance déployée, ni la base existante, ni
le journal d'audit.

---

## 3. Effet de bord non annoncé : la suppression de `demo: true`

Le rapport annonce « Removed demo: true concept ». Ce drapeau n'est pas
décoratif, il porte une garde de sécurité :

```js
// server/oauth.js:255-258
// S2 : en démo, pas d'appropriation d'un compte réel par simple e-mail.
if (!trusted && byEmail && !byLink && byEmail.demo !== true) {
  outcome = { ok: false, error: 'demo_email' }
  return db
}
```

Retirer `demo: true` des trois comptes clients les fait passer pour des comptes
**réels** : en mode non fiable (OAuth sans clés fournisseur), une identité OAuth
portant `karim.oran@demo.dz` serait désormais **refusée** (`demo_email`) au lieu
de se rattacher au compte. Aucun test ne couvre cette garde :

```
$ grep -rn "demo_email" --include='*.js' --include='*.jsx' --include='*.mjs' .
./server/index.js:711        (mise en forme du message d'erreur)
./server/oauth.js:257        (la garde elle-même)
```

La régression serait donc **silencieuse**. Toute suppression de `demo: true`
doit être précédée d'un test sur S2.

---

## 4. Deux angles morts du verrou lot 1.2 — démontrés

Le scanner `src/masterSecrets.test.js` (lot 1.2) est aujourd'hui **aveugle** à
deux des formes prises par ce commit. Mesures :

| Expérience | Résultat du scanner |
|---|---|
| Les 19 fichiers posés dans `PC-Star-main/` (secrets en clair inclus) | **8/8 verts** — le dossier n'est pas vu |
| Leur `README.md` + `docs/GUIDE-COMPTES.md` posés à la racine (table admin/e-mail/mot de passe en clair) | **8/8 verts** — la forme « tableau Markdown » ne correspond à aucune règle |

Cause : `sourceFiles()` ne parcourt **que le premier niveau** de
`src server scripts api e2e` (`entry.isFile()`, aucune récursion) et, pour la
documentation, une **liste fixe de 7 fichiers** où `GUIDE-COMPTES*.md`
n'existe pas. Les règles, elles, ciblent des **formes de code**
(`MASTER = {…password`, `hashPassLegacy('…')`, `password: 'mot12'`) — pas des
**valeurs d'identifiants** publiées en prose.

Conséquence : le verrou qui est censé empêcher ce commit de passer… ne le voit
pas. À corriger avec le lot 1.3 (parcours récursif, docs découvertes par glob,
règle sur la valeur `PCSTAR_FORBIDDEN_SECRET` déjà prévue mais non alimentée).

---

## 5. Ce qu'il faut faire pour vraiment clore le lot 0

### A. Immédiat — exploitant (Vercel), sans code

1. **Générer** un mot de passe maître fort (gestionnaire de mots de passe).
   **Ne jamais utiliser** `Czyx8f9g2jK3mWZ5R2Tn` : il est publié.
2. Poser `MASTER_EMAIL` + `MASTER_PASSWORD` dans les variables d'environnement
   Vercel. Sur PR #6, le serveur **refuse de démarrer** sans elles (lot 1.1,
   `masterAccount()` lève avec un message explicite) : c'est le comportement
   voulu, pas un bug.
3. Redéployer, puis vérifier `POST /api/auth/login` avec les valeurs d'env, et
   `GET /api/health` (il ne renvoie plus l'e-mail du maître — lot 1.10).
4. **Purger les sessions** existantes : un jeton émis avant la rotation reste
   valide sinon (le lot 1.5 purge déjà les sessions d'un utilisateur lors d'un
   changement de mot de passe ; pour une rotation par l'env, faire la purge
   explicitement).
5. **Vérifier le journal** (commandes, clients, exports CSV) pour détecter un
   usage tiers du compte maître — seconde ligne du lot 0 dans le plan, jamais
   traitée par le commit vérifié.
6. Changer aussi le mot de passe de la **boîte réelle** `pcstar.info31@gmail.com`
   si `Czyx8f9g2jK3mWZ5R2Tn` (ou `star31`) y a jamais servi.
7. Traiter les trois comptes de démonstration comme **non sensibles** (lot 1.3) :
   leur valeur n'est pas un secret à protéger, c'est un compte à ne pas rendre
   sensible.

### B. Code — sur PR #6, si vous le souhaitez (lot 1.3 + verrou)

- sortir les trois comptes démo du seed codé en dur (`env` ou génération au
  premier démarrage) et retirer `karim31` / `amina31` / `yacine31` des **7
  fichiers racine** qui les contiennent encore : `server/db.js`,
  `scripts/smoke-e2e.mjs`, `e2e/smoke.spec.js`, `src/hardening.test.js`,
  `src/lot2UI.test.js`, `src/p22Audit.test.js`, `src/serverFixes.test.js` ;
- élargir le scanner lot 1.2 : parcours **récursif**, documentation découverte
  par glob (toute `docs/*.md` + `README.md`), et une règle « valeur publiée »
  alimentée par `PCSTAR_FORBIDDEN_SECRET` ;
- ajouter un test sur la garde S2 (`demo_email`) **avant** toute suppression de
  `demo: true` ;
- afficher dans l'UI l'avertissement « mode démonstration, aucune donnée
  sensible » (critère d'acceptation du lot 1.3).

### C. À ne pas faire

- **Ne pas fusionner** `2880c2a` (P3, P4) ; ne pas conserver le dossier
  `PC-Star-main/` dans le dépôt.
- **Ne pas réutiliser** les quatre mots de passe publiés, en production ni
  ailleurs. Supprimer la branche ne purge pas l'historique public : les valeurs
  restent lisibles dans les objets déjà publiés — d'où l'étape A.6.

---

## 6. Annexe — commandes reproductibles

```bash
# Récupérer la branche lot 0 en lecture seule (sans changer de branche)
git fetch origin 'refs/heads/arena/*:refs/remotes/origin/arena/*'

# 1. Existence / identité du commit
git ls-remote --heads origin
git log -1 --format="%H%n%an <%ae>%n%ad%n%s" origin/arena/01a090f7-pc-star

# 2. Périmètre réel du commit (le filtre exclut le dossier imbriqué)
git show --stat --format="" 2880c2a
git show --stat --format="" 2880c2a -- . ':(exclude)PC-Star-main'   # → vide
git ls-tree -r --name-only origin/arena/01a090f7-pc-star -- PC-Star-main | wc -l  # → 19

# 3. État réel des seeds (racine) sur les trois branches
git show origin/main:server/db.js                        | grep -n "hashPassLegacy('"
git show origin/arena/01a090f7-pc-star:server/db.js      | grep -n "hashPassLegacy('"
grep -n "hashPassLegacy('" server/db.js                  # PR #6 : maître absent

# 4. Exposition
gh repo view --json isPrivate
git grep -n -I "star31\|pcstar\.info31" origin/arena/01a090f7-pc-star

# 5. Cohérence hashes / mots de passe annoncés
node -e "const c=require('crypto');const h=p=>c.createHash('sha256').update('pcstar:'+p).digest('hex');\
for(const p of ['Czyx8f9g2jK3mWZ5R2Tn','Qw3nt9zKp7mL2jX8vNb','Yx4nBst8mP3kL7jR2vWz','Wz6kLm9pN3tQ8jX2cYvB'])\
console.log(h(p).slice(0,16))"

# 6. Parenté des histoires
git merge-base origin/main origin/arena/01a090f7-pc-star            # → vide
git log -1 --format=%P 2880c2a                                      # → b3bb620 (PR #3)
git rev-list --count origin/main                                    # → 1

# 7. Impact mesuré (expérience restaurée aussitôt)
for f in $(git ls-tree -r --name-only origin/arena/01a090f7-pc-star -- PC-Star-main); do
  git show "origin/arena/01a090f7-pc-star:$f" > "${f#PC-Star-main/}"
done
npm test                       # → 417 exécutés, 372 verts, 42 rouges, 3 annulés
git checkout -- . && rm -f docs/GUIDE-COMPTES*.md && git status --porcelain   # → vide

# 8. Angles morts du verrou lot 1.2
node --import ./scripts/test-env.mjs --test src/masterSecrets.test.js  # → 8/8 verts
```

---

*Vérification menée le 16/09/2026 sur `arena/01a0a55c-pc-star` (HEAD `3a4b070`),
suite de référence 724/724. Les rapports d'audit 1, 2 et 3 n'ont pas été
modifiés.*
