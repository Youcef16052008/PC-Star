# Handoff — session suivante (PC-Star)
> **Version 3 — 17/09/2026, fin de session.** État final après fusion de la PR #7.
>
> Changements depuis la v2 : la PR #7 est **fusionnée** (lot 1.20 + CI Neon verte +
> Node 22), le journal §9 du lot 1.20 est dans le plan, les trois artefacts de
> diagnostic ont disparu du dépôt, et **le §0.2 est corrigé** : il affirmait un
> espace de travail « en retard sur GitHub » comme un état général — c'était la
> mesure d'**une** instance de sandbox, contredite le jour même par une autre
> instance (HEAD déjà à la pointe de la PR #7, `git fetch` fonctionnel,
> `node_modules` et `dist/` présents). La règle utile subsiste, mais elle est
> désormais : **l'état du snapshot n'est pas prévisible, il se mesure**.
>
> **Convention** : **[vérifié]** = constaté par exécution ou lecture de
> `origin/main` ; **[rapporté]** = déclaration du commanditaire du 17/09 non
> reproductible ici. Ne traiter un `[rapporté]` comme acquis qu'après vérification
> (§6, étape 0).
>
> À lire avec : `docs/BILAN-SESSION-2026-09-17-CI-NEON.md`, `docs/PLAN-CORRECTIONS.md`
> (§7 avancement, §9 journal détaillé — la section « lot 1.20 » est la plus
> récente), `docs/NEON-MIGRATION.md`, `docs/VERIFICATION-RAPPORT-LOT0.md`,
> `docs/DEPLOY-VERCEL.md` §8 et §8 bis.
---
## 0. État final
### 0.1 Livraison
| Élément | État |
|---|---|
| `main` | **[vérifié]** `1d994a2` — `docs(plan 1.20): journal du chantier 1.B en section 9`, après `9b637cf` (merge **PR #7**) |
| **PR #6** (lots 1→8 + 1.19 + 7.3) | **[vérifié]** fusionnée — merge commit `7003976` |
| **PR #7** (lot 1.20 + bilan + Node 22) | **[rapporté]** fusionnée ; **[vérifié]** son contenu est dans `main` |
| Job CI « Create Neon Branch » | **[rapporté] VERT 4/4** (run `35250974397`) : migrations ✓, protection de réservation concurrente ✓ (**première fois jamais exécutée**), reset ✓, **suite complète sous Neon** ✓ |
| Suite de tests | **[rapporté] 816 tests, 0 échec, 0 annulé, 223 suites** ; **[vérifié]** le plan §7 annonce `315 → 325 → 384 → 761 → 791 → 807 → 816` et la suite compte **53 fichiers de tests** ; **[vérifié par exécution en worktree, point 23]** `src/lot1BaseScripts.test.js` **9/9 vert** contre le vrai `server/db.js` de `main` (dont 4 en processus enfant) |
| Verrous secrets | **[vérifié]** `build` = `vite build && node scripts/check-bundle.mjs`, script `check:bundle` présent ; scanner du dépôt et contrôle du bundle en place |
| Workflow Neon | **[vérifié]** `node-version: 22` (jsdom 30, via undici, exige ≥ 22) |
| Artefacts de diagnostic | **[vérifié] absents de `main`** : `check-neon.mjs`, `verify-neon.mjs`, `nvidia_kimi_k3.py`, `PC-Star-main/` ne sont **pas suivis** |
| `PC-Star-main/` sur le poste du commanditaire | **[rapporté]** toujours présent en **non suivi**, suppression impossible IDE ouvert (`Remove-Item … being used by another process`) → §1.E |
| Items de **code** ouverts dans le plan §7 | **[vérifié]** aucun ; restent le lot 0 (exploitant) et les chantiers §1.C/§1.D |
### 0.2 L'état du snapshot **se mesure**, il ne se suppose pas
Mesures contradictoires du 17/09, toutes deux réelles :
| Instance | HEAD | `git fetch` | `node_modules` / `dist` | Contenu |
|---|---|---|---|---|
| A (celle qui a livré le lot 1.20) | `ac9f474` = pointe PR #7 | fonctionnel | présents | à jour |
| B (celle qui a écrit ce document) | `fdbd778` = point de clone | `TLS gnutls_handshake failed`, `gh` → `EOF` | absents | = `main@7003976` + ce document, **sans** le lot 1.20 |
**Ce que B a mesuré et qui reste valable partout** :
```bash
git log -1 --format='%h %s'                       # HEAD réel (peut être le point de clone)
git log --oneline -3 origin/main                  # pointe distante connue localement
git status --porcelain | awk '{print $1}' | sort | uniq -c   # 63 M + 42 ?? = travail fusionné vu comme « non commité »
git add -A && git diff --cached origin/main --stat ; git reset -q   # écart réel arbre ↔ main
grep -c "LOT 1.20" server/db.js                   # marqueur de présence d'un lot
```
**Piège ajouté, mesuré dans B** : l'historique local peut être **peu profond /
greffé**. `git log --oneline -6 origin/main` n'y affichait **qu'un** commit et
`git show --stat 1d994a2` annonçait « 2014 files changed » : seuls les objets de
la pointe sont présents. Conséquence : on peut **lire un fichier à une révision**
(`git show origin/main:chemin/du/fichier` — c'est ainsi que ce document a été
vérifié), mais **pas** inspecter l'historique ni les diffs de commits antérieurs
sans un fetch complet.
**Règle** : la vérité est sur GitHub. Ne jamais conclure « ce n'est pas fait »
parce que l'arbre local ne le montre pas, et ne jamais **réécrire** un correctif
déjà livré. Réciproque vraie aussi : ne pas conclure « c'est à jour » parce que
l'arbre local le montre.
**Dépendance à l'arbre** (point 22) : tout compte publié doit dire sur quel
arbre il a été pris — 144 (worktree propre de `1d994a2`), 145 (+ ce document),
143 (arbre sale du sandbox : 144 − 2 fichiers de `main` absents + 1 document
local). Ne jamais recopier des fichiers à l'unité entre arbres (recopier seul
le `package.json` de `main` — 53 tests — dans un arbre à 52 ferait planter
`npm test` sur fichier manquant) : mesurer l'écart complet
(`git diff --name-only origin/main`), travailler sur l'arbre entier ou sur un
**worktree** de la révision voulue.
**Ce qui n'est PAS un reste à faire** : les 🟡 des tableaux §1 à §6 du plan sont
des **requalifications de bugs signalés** (« réel mais à requalifier »), pas des
chantiers ouverts.
## 1. Chantiers ouverts, dans l'ordre
### 1.A — Post-fusion : vérifier, puis committer ce document
La PR #7 est fusionnée ; il n'y a plus de PR à traiter **[vérifié sur le contenu,
rapporté sur l'acte de fusion]**. Deux gestes utiles en début de session :
```bash
gh pr list --state open                 # aucune PR ouverte attendue
gh run list --limit 5                   # le dernier run Neon doit être vert
npm ci && npm test                      # 816 attendus
```
Puis **committer ce document** : il n'est **pas** dans `main` **[vérifié :
`git cat-file -e origin/main:docs/HANDOFF-SESSION-SUIVANTE.md` → absent]**. Il ne
vit que dans l'espace de travail partagé. Un commit docs autonome suffit ; lancer
`src/masterSecrets.test.js` **avant** de committer (règle §2.4 — ce document est
balayé par le scanner, il n'est pas exempté, et il a déjà rougi une fois en v1).
### 1.B — Lot 0 : rotation réelle des secrets (exploitant, Vercel). PAS du code.
Reporté à la fin **à la demande explicite du commanditaire** (15/09). Le code est
prêt : sans variables, le serveur **refuse de démarrer** (`assertMasterConfigured`)
et **verrouille** les comptes de démonstration (`401 demo_locked`).
1. **Générer** un mot de passe maître fort. Ne jamais réutiliser une valeur déjà
   publiée — la liste est dans `docs/VERIFICATION-RAPPORT-LOT0.md` §5.A/§5.C ;
   **ne pas la recopier ailleurs** (§2, règle 4).
2. Poser dans Vercel : `MASTER_EMAIL`, `MASTER_PASSWORD`, et **au choix**
   `DEMO_PASSWORD` (absente → comptes de démo verrouillés, état voulu).
3. **Redéployer**, puis vérifier `POST /api/auth/login` (200 + jeton) et
   `GET /api/health` (ne renvoie plus l'e-mail du maître — lot 1.10).
4. **Purger les sessions** : un jeton émis avant la rotation reste valide sinon.
   Le lot 1.5 purge lors d'un changement de mot de passe, **pas** lors d'une
   rotation par l'environnement.
5. **Contrôler le journal** (commandes, clients, exports CSV) : usage tiers du
   compte maître. Seconde ligne du lot 0, jamais traitée.
6. Changer le mot de passe de la **boîte réelle** si une valeur publiée y a servi.
7. Se rappeler que **supprimer du code ne purge pas l'historique public**.
**Interdiction liée** : ne pas ajouter `MASTER_*` aux secrets du workflow Neon —
ce serait publier le secret de production dans la CI (limite assumée du lot 1.20).
Contre-exemple à ne pas reproduire : la branche `arena/01a090f7-pc-star`
(`2880c2a`) croyait faire ce lot — aucun fichier de l'application modifié, 19
fichiers posés dans un dossier imbriqué `PC-Star-main/` que ni le build ni les
tests ni Vercel n'exécutent, et **quatre mots de passe republiés en clair**. Sa
fusion ferait passer la suite de ~807 verts à ~372 verts / 42 rouges. Détails :
`docs/VERIFICATION-RAPPORT-LOT0.md`. **Cette branche est conservée comme preuve —
consigne du commanditaire : ne pas la supprimer ni la toucher.**
### 1.C — R17 : la limite de débit vit dans la mémoire du processus
`rateLimit` (`server/index.js`, utilisé par `/api/me/password`, `/api/oauth/start`,
`/api/auth/login`, etc.) compte dans un `Map` **en mémoire du processus**. À
vérifier avant de corriger : sous Vercel (instances multiples et éphémères) la
limite est **par instance**, donc multipliable ; un redéploiement remet les
compteurs à zéro ; rien n'est partagé entre mode local et mode déployé.
Méthode imposée par §2 : mesurer d'abord (comportement observable, nombre
d'instances), écrire le test de régression, puis corriger — et ne pas introduire
de dépendance externe sans la justifier dans le plan. Attention : toute solution
partagée (base, cache) doit passer par les verrous secrets (§5.1/§5.2) — pas
d'URL ni de jeton en dur.
### 1.D — Relecture du §6 du plan (« découvertes hors rapports »)
Relire `docs/PLAN-CORRECTIONS.md` §6 et statuer pour chaque découverte :
**corrigée** (avec le lot et le test), **écartée** (avec la raison), ou **encore
ouverte**. Cette requalification a déjà été faite pour les rapports 1, 2 et pour
l'audit A→Z (rapport 3 → lot 8) ; elle reste à faire pour cette section.
### 1.E — `PC-Star-main/` : suppression à terminer
**[rapporté]** Les trois scripts de diagnostic (`check-neon.mjs`,
`verify-neon.mjs`, `nvidia_kimi_k3.py`) sont **supprimés** — **[vérifié]** aucun
n'est suivi dans `main`. Reste la copie imbriquée du dépôt :
- elle n'a **jamais été committée** **[vérifié : absente de `git ls-tree origin/main`]** ;
- la suppression a échoué IDE ouvert (`Remove-Item … being used by another
  process`) → **fermer l'IDE** puis supprimer, et vérifier :
```powershell
# Windows, IDE fermé
Remove-Item -Recurse -Force .\PC-Star-main\
git status --porcelain          # ne doit plus rien montrer
```
```bash
# Linux / macOS
rm -rf PC-Star-main && git status --porcelain
```
**Pourquoi ce dossier compte** : c'est l'angle mort qui a rendu le scanner aveugle
(§5.1) — 19 fichiers hors de portée d'un parcours à un seul niveau. Le lot 1.19
l'a rendu **visible**, pas inutile : tant qu'il est présent, toute recherche,
tout `grep` et toute revue tombent sur du code mort qui ressemble à du code vivant.
### 1.F — Pour mémoire : le job CI Neon était rouge, il est corrigé
Diagnostic complet dans le plan §9 « lot 1.20 ». En bref : `server/db.js`
résolvait le compte maître **au chargement** (`const MASTER = masterAccount()`),
donc tout importeur héritait de l'exigence `MASTER_EMAIL`/`MASTER_PASSWORD` — y
compris les quatre scripts de base (migration, concurrence, doctor, import) que la
CI lance avec la seule `DATABASE_URL`. L'échec était certain à l'étape 1, et les
trois étapes suivantes ne s'exécutaient **jamais**. Corrigé par
`masterAccountOrNull()` (résolution paresseuse) + Node 22 dans le workflow.
**Première exécution du verrou** (point 23, mesure sandbox) :
`src/lot1BaseScripts.test.js` lancé dans un worktree de `main` contre le vrai
`server/db.js` → **9/9 vert** (dont 4 en processus enfant). Jusqu'ici ce résultat
n'était que **[rapporté]** ; il est désormais **[vérifié]** indépendamment de
toute machine.
Si le job re-rougit : `gh run view --job <ID>` donne l'arborescence des étapes
(fonctionne même quand `--log` renvoie `EOF`) ; code de sortie de
`scripts/neon-migrate.mjs` : `2` = URL absente, `1` = erreur SQL/réseau.
## 2. Règles de la maison (non négociables)
1. **Un test de régression par correctif** : pas de correctif sans test qui
   échoue quand on le retire.
2. **Neutralisation systématique** : retirer temporairement le correctif, compter
   les tests qui rougissent, restaurer, publier le tableau. Numérotation
   **cumulative** ; dernière en date : **N71** (lot 7.3) → la suivante est
   **N72**. Le lot 1.20 n'en a **pas** ajouté, et c'est justifié dans le plan.
   Historique : N1→N47 (lots 1 à 8.9), N48→N57 (8.10), N58→N67 (1.19),
   N68→N71 (7.3).
3. **Journaliser dans `docs/PLAN-CORRECTIONS.md` §9** : section
   `### ✅ Fait — lot X.Y` avec déclencheur, état mesuré avant,
   correctif, vérification chiffrée, tableau de neutralisations
   (ou sa justification), limites assumées.
   Mettre aussi à jour le tableau §7 et la ligne « Suite de tests : … ».
4. **Aucune valeur compromise réimprimée**, nulle part (docs, commentaires, tests).
   Mesuré : la v1 de ce document a fait rougir le scanner pour avoir reproduit la
   forme interdite **en décrivant une règle** — description reformulée plutôt que
   d'ajouter le fichier aux exemptions.
5. **Ne pas modifier** `docs/VERIFICATION-RAPPORT-AUDIT.md` et `-2.md` (consigne
   explicite du commanditaire). `docs/VERIFICATION-RAPPORT-LOT0.md` et
   `docs/BUGS-AND-FIXES.md` **peuvent** être annotés — déjà
   fait pour le §5.B et pour B22.
6. **Français** partout (code, docs, commits). Style :
   `fix(lot X.Y): <ce qui change> — <pourquoi c'était cassé>` + corps long et
   factuel. Modèles récents : le commit du lot 1.20, `18370b7` (1.19 + 7.3),
   `b1e94d5` (8.10).
7. **Branche de session unique** : Arena impose `arena/<id>`. Ne jamais créer ou
   pousser une autre branche, jamais `git clean` / `git reset --hard` sur le
   travail existant.
8. **Ne jamais demander** mot de passe, token, PAT ou code 2FA dans le chat. Sur
   `401 Bad credentials` : faire **reconnecter GitHub dans Arena**, puis réessayer.
   Sur `TLS … handshake failed` ou `EOF` : c'est le **réseau**, pas l'auth —
   prévenir et travailler en local.
9. **Ajouter tout nouveau fichier de tests à la liste explicite** du script `test`
   de `package.json` (pas de glob) — sinon il ne tourne jamais. 53 fichiers
   aujourd'hui.
10. **Jamais `git add -A` dans une instance dont l'arbre n'a pas été confronté
    à `origin/main`** (mesuré : sandbox re-cloné avec arbre en retard de
    49 fichiers et `63 M + 41 ??` — `add -A` + commit + push y produirait un
    commit qui **annule un lot livré** sans conflit ni erreur ; point 20).
    Commiter uniquement les chemins touchés (`git add <chemins>`).
## 3. Pièges d'environnement (tous vécus, avec réparation)
- **Sandbox recréé / re-cloné** (4× en 3 jours) : `git log -1` = point de
  clone, `.git/shallow` greffé, reflog réduit au clone (les **hashes locaux
  ne sont pas des livrables** — point 21) ; `node_modules`, `dist/`, `/tmp`
  absents → `npm ci` **dans le même tour** que la vérification (le dossier
  fond entre deux tours, point 20) ; mesurer (§0.2) ; **jamais** `reset --hard`
  ni `git clean`, jamais `add -A` sans confrontation (§2.10).
- **git borné au cwd** : depuis un sous-dossier (même vide non suivi),
  `git ls-tree -r --name-only HEAD` renvoie **0** comme `ls-files` (point 19).
  Formes indépendantes : `git ls-tree -r --name-only <rév> -- :/`,
  `git ls-files -- :/`, ou `git -C "$(git rev-parse --show-toplevel)" …`.
  Préférer `ls-tree <rév>` (arbre épinglé) à `ls-files` (index local).
- **Snapshot en retard OU en avance** : mesurer avant de conclure (§0.2) ;
  repartir de la pointe distante.
- **Historique peu profond / greffé** : lire les fichiers par
  `git show <ref>:<chemin>` ; ne pas raisonner sur l'historique local.
- **GitHub injoignable ≠ token expiré** : réseau (`handshake failed`, `EOF`) →
  prévenir, travailler en local ; auth (`HTTP 401`) → reconnecter GitHub.
- **Session fermée** (PR fusionnée) : travail local possible ; pour pousser,
  **nouvelle session**.
- **Windows : ESM et chemins nus** : **toujours** `pathToFileURL(chemin)` —
  4 défauts préexistants corrigés par le lot 1.20 (invisible en CI Linux).
- **Node < 22** : la moitié de la suite plante (jsdom 30 via undici exige 22).
- **Push rejeté (non-fast-forward)** : ne pas forcer ; fetch, comparer, puis
  `reset --mixed` sur la pointe si l'arbre local est le bon.
- **Logs d'Actions illisibles** (`EOF`) : `gh run view --job <id>` sans `--log`.
- **`dist/` absent** : 1 test skippé, voulu ; `npm run build` lève le skip.
- **Fichier verrouillé par l'IDE** (Windows) : fermer l'IDE, réessayer (§1.E).
## 4. Commandes (copiables depuis la racine)
```bash
# 0. vérité depuis GitHub (AVANT toute conclusion — §0.2)
git fetch origin
git log --oneline -3 origin/main
git add -A && git diff --cached origin/main --stat ; git reset -q
gh pr list --state open ; gh run list --limit 5
# 1. environnement (Node >= 22)
node -v && npm ci
# 2. vérifications
npm test                # 816 attendu, 223 suites, 0 échec
npm run build           # vite build + contrôle du bundle inclus
npm run check:bundle    # seul : 0 propre, 1 secret publié, 2 dist absent
# 3. un fichier de tests (rapide, pendant le travail)
node --import ./scripts/test-env.mjs --import ./scripts/jsx-test-register.mjs \
  --test --test-concurrency=1 src/masterSecrets.test.js
# 4. lire un fichier à une révision sans l'extraire
git show origin/main:server/db.js | grep -n masterAccountOrNull
# 5. état avant commit
git status --porcelain  # vide attendu ; sinon trancher (§1.E)
```
## 5. Carte des verrous : où toucher, quoi ne pas casser
### 5.1 `src/masterSecrets.test.js` — scanner de secrets du dépôt (13 tests)
- Parcours **récursif** depuis la racine : 144 fichiers balayés dans
  `main@1d994a2`, **145 avec ce document une fois fusionné**, sur 2 014 suivis
  par git — mesuré en exécutant `trackedFiles()` elle-même dans un worktree de
  la révision (fonction non exportée, parcours du système de fichiers) ;
  répartition `src/` 84, `scripts/` 20, `docs/` 17, `server/` 14, autres 9
  (`.js` 89, `.mjs` 19, `.md` 18, `.jsx` 14, `.json` 4 ; point 6/19).
  **143 et 142 ne sont PAS des propriétés d'une révision** : ce sont celles de
  l'arbre partiel de l'instance B (144 − 2 fichiers de `main` absents —
  `src/lot1BaseScripts.test.js`, `docs/BILAN-SESSION-2026-09-17-CI-NEON.md` —
  + 1 document local, puis suppression de la variante). Seuls 144 et 145 sont
  des repères citables.
  (`.js/.jsx/.mjs/.cjs/.json/.md` + `.env.example`), hors `.git`, `node_modules`,
  `dist`, `dist-crawl`, `coverage`, `.preview-data`, `data`, `backups`,
  `package-lock.json`, et hors ce fichier lui-même.
- **5 règles** : objet `MASTER` avec mot de passe ; appel de hachage legacy avec
  un littéral (l'appel, pas la définition) ; clé de type mot de passe suivie
  de `:` et d'un littéral de la forme interdite ; repli littéral sur une variable
  d'environnement sensible ; mot de passe publié dans un tableau Markdown
  (en-tête reconnu seulement si la ligne suivante est un séparateur, sinon
  6 faux positifs mesurés).
- `HISTORIQUE` = 6 documents exemptés (4 rapports + `BUGS-AND-FIXES` +
  `PLAN-CORRECTIONS`), **gardés par un test** : 4 à 8 entrées, `docs/` seulement,
  noms imposés, existence vérifiée, réciproque sur les rapports. **Ne jamais y
  ajouter un document publié** (neutralisation N65).
- **Sondes positives** : le test pose un secret dans `tmp-scanner-probe/…` et
  un tableau publié dans `docs/ZZ-sonde-scanner.md`, vérifie qu'ils sont vus,
  puis les supprime dans un `finally` (chemins dans `.gitignore`).
  **Ne pas ajouter `tmp-scanner-probe` à `SKIP_DIRS`** : le test deviendrait
  vert sans rien prouver.
- Crochet CI : variables d'environnement de test du scanner — testé (N66).
- C'est ce verrou qui rend visible un dossier imbriqué type `PC-Star-main/` (§1.E).
### 5.2 `scripts/check-bundle.mjs` + `src/bundleSecrets.test.js` (16 tests)
- Porte sur **`dist/`** (ce qui est réellement publié), pas sur les fichiers suivis.
- Branché : le build échoue si un secret est publié (codes : 0 propre,
  1 secret, 2 `dist/` absent).
- 5 règles : valeur d'env sensible, valeur interdite, forme minifiée interdite,
  URL de stockage privée, variable d'environnement restée côté client.
- **Exemptions assumées** (en-tête du script) : les e-mails (un identifiant
  n'est pas un secret), les valeurs courtes, le mot de passe de démo locale
  (n'ouvre rien sur un déploiement).
- Les sondes du test sont **assemblées à l'exécution** : en littéral, elles
  font rougir §5.1. Ne pas « simplifier ».
### 5.3 `server/db.js` — compte maître paresseux (lot 1.20), démo et alignement
**[vérifié dans `main`]**
- `masterAccountOrNull()` est le **seul** point du module qui exige
  les variables du compte maître, et il est **paresseux** : il renvoie le compte
  ou `null` sans configuration. L'évaluation au chargement a été **supprimée**
  (aucun consommateur — vérifié par grep au lot 1.20).
- `emptyDb()` / `normalizeDb()` passent par cet accesseur : sans configuration
  elles ne sèment pas de maître et ne le synchronisent pas, mais ne **retirent
  jamais** un maître déjà présent en base.
- `masterAccount()` **lève toujours** sans les variables et le serveur refuse
  toujours de démarrer (`assertMasterConfigured`) : le verrou du lot 1.1 est
  intact, seul le **moment** de la résolution a changé. C'est ce qui permet aux
  quatre scripts de base (migration, concurrence, doctor, import) de s'importer
  sans identifiants — et à la CI Neon de passer.
- **Limite assumée** : un import sur une base neuve **sans** les variables du
  maître produit une base sans maître ; le serveur refusera de démarrer
  dessus (voulu).
- Fonctions mot de passe démo : lues **à chaque appel**. Alignement dans
  `normalizeDb` : ne touche qu'un compte **toujours** marqué démo, reconnu par
  `id` **ou** `email` ; ne réécrit pas si l'empreinte vérifie déjà la valeur
  (idempotence + scrypt de P22 préservé) ; variable absente → `passwordHash: null`.
- La fonction de hachage legacy **n'est pas exportée** : dans les tests, utiliser
  les fonctions de vérification et de hachage asynchrone. Son ordre de
  déclaration est verrouillé par `src/lot3Server.test.js` §3.17 (B21).
### 5.4 `server/index.js`
- `401 demo_locked` quand le compte de démo est semé sans empreinte.
- **`u.demo = false`** dans les deux mutateurs de mot de passe : sans ça,
  l'alignement §5.3 annule silencieusement le changement annoncé 200 (P16).
- Commentaires longs **hors** des mutateurs : le verrou lot 1.6 compare l'ordre
  hachage → mise à jour → retour dans le reste du fichier.
- `rateLimit` : chantier **R17** (§1.C).
### 5.5 `scripts/test-env.mjs` — isolation de la suite (lot 7.1)
Épingle les variables de test du maître et de la démo, vide les variables
de base distante et de stockage externe, pose le mode démo OAuth. Un test qui
a besoin d'une autre valeur doit soit la restaurer dans un `finally`, soit
lancer un **sous-processus**.
### 5.6 Gardes S1/S2 (`server/oauth.js`)
S1 : l'e-mail du maître n'entre **jamais** par OAuth. S2 : en mode démo,
seuls un compte marqué démo ou un lien déjà établi peuvent être ouverts.
Couvertes depuis le lot 1.19 par 4 tests dans `src/lot1DemoSecrets.test.js`.
### 5.7 `.github/workflows/neon_workflow.yml`
Déclenché sur `pull_request` : crée une branche Neon d'aperçu (expiration
14 jours), migre, vérifie la réservation concurrente, réinitialise, puis
**joue toute la suite contre Neon**. **Node 22** **[vérifié]**. La CI ne pose
que `DATABASE_URL` : **ne jamais** y ajouter les variables du maître (§1.B).
### 5.8 Sondes et sous-processus : chemins
Toute sonde qui passe un chemin à `import()` dynamique ou à `--import` **doit**
utiliser `pathToFileURL` (Windows). Un chemin absolu passé en **argument CLI**
est sûr sans conversion. Quatre défauts préexistants ont été corrigés ainsi
par le lot 1.20 — invisibles en CI Linux.
## 6. Checklist de reprise / de fin de lot
**Étape 0 — établir la vérité (toujours, avant d'écrire du code) :**
1. `git fetch origin` ; `git log --oneline -3 origin/main` ;
   `gh pr list --state open`.
2. `git add -A && git diff --cached origin/main --stat ; git reset -q` : écart réel.
3. `node -v` (≥ 22) puis `npm ci && npm test` : **816** attendu. Un compte
   différent = arbre différent de `main` (§0.2).
4. Lire le `BILAN-SESSION-*.md` le plus récent et la dernière section §9 du plan :
   ne jamais redécouvrir ni réécrire un lot livré.
5. `gh run list --limit 5` : le dernier run Neon doit être vert.
**Fin de lot (dans l'ordre) :**
1. Correctif **et** test de régression ; nouveau fichier de tests **ajouté à
   `package.json`** (§2.9).
2. Fichier de test seul, puis **suite complète** (`npm test`).
3. `npm run build` (contrôle du bundle inclus).
4. **Neutralisations** : retirer chaque correctif, compter les rouges, restaurer,
   revérifier le vert. Sinon, le justifier explicitement dans le journal.
5. `docs/PLAN-CORRECTIONS.md` : §7 (avancement + compte de tests) et §9.
   Bilan de session si la séance est longue.
6. Vérifier qu'**aucune valeur** n'a été réimprimée (§2.4) : lancer
   `src/masterSecrets.test.js` **avant** de committer.
7. `git status --porcelain` : aucun fichier non suivi qui devrait être supprimé
   ou outillé (§1.E).
8. Commit (message long en français), push sur la branche de session, commentaire
   de PR, fusion **seulement si** rien n'est manquant.
9. En cas d'échec d'authentification ou de réseau : prévenir, ne jamais demander
   de secret, ne pas forcer un push.
---
## 7. Repères rapides
- Pointe de `main` : `1d994a2` (docs plan 1.20) après `9b637cf` (merge PR #7).
- Merge PR #6 : `7003976` ; dernier commit de travail `18370b7` (lots 1.19 + 7.3).
- Suite de tests : **816** (223 suites) ; 53 fichiers de tests dans `package.json`.
- Run CI Neon vert : `35250974397` — 4/4 étapes **[rapporté]**.
- Dernière neutralisation : **N71** (lot 7.3) ; prochaine : **N72**.
- Node requis : **≥ 22** (jsdom 30 via undici).
- Fichiers ajoutés par 1.19 + 7.3 : `src/lot1DemoSecrets.test.js` (25 tests),
  `src/bundleSecrets.test.js` (16), `scripts/check-bundle.mjs`.
- Fichiers ajoutés par 1.20 : `src/lot1BaseScripts.test.js` (9 tests,
  **9/9 vert en worktree contre le vrai `server/db.js` de `main`** — point 23),
  `docs/BILAN-SESSION-2026-09-17-CI-NEON.md`.
- **Ce document** : `docs/HANDOFF-SESSION-SUIVANTE.md` — **absent de `main`**,
  à committer (§1.A).
- Branche à ne pas toucher : `arena/01a090f7-pc-star` (conservée comme preuve).
> **Addendum — versement de la variante orpheline (sandbox sans réseau,
> instance B, `main@7003976`).** Le commanditaire, injoignable depuis GitHub
> (`TLS handshake failed`, `gh` → `EOF`), n'a pas pu lire `f82dd11` et a produit
> une variante locale (`9cc7c53` puis `bb626f0`, 534 lignes) avec bandeau « ne
> fait pas foi ». Les 18 points ci-dessous, jugés utiles, sont versés ici ;
> la variante est ensuite à supprimer. Chaque point indique sa justification
> et son emplacement.
> 1. **Règle réciproque du §0.2** : ne pas conclure « c'est à jour » parce que
>    l'arbre local le montre — versé au §0.2 (la phrase y figure déjà).
> 2. **Historique peu profond / greffé** : `git log origin/main` n'affiche
>    qu'un commit, `git show --stat` annonce « 2014 files changed » → lire par
>    `git show <ref>:<chemin>` — versé au §0.2 (paragraphe « Piège ajouté »).
> 3. **Réseau ≠ authentification** : TLS/EOF = réseau (prévenir, travailler en
>    local) contre 401 = auth (reconnecter GitHub dans Arena) — versé au §3.
> 4. **`pathToFileURL` sous Windows** : 4 défauts préexistants corrigés par le
>    lot 1.20, invisibles en CI Linux — versé aux §3 et §5.8.
> 5. **Node ≥ 22** (jsdom 30 via undici) — versé aux §3 et §7.
> 6. **Comptage du scanner résolu par la voie forte** : `trackedFiles()`
>    elle-même exécutée dans un worktree de `1d994a2` → **144 balayés**
>    (145 avec ce document), 2 014 suivis — **versé au §5.1**, qui dit
>    désormais « 144 », plus la répartition.
> 7. **N71 dernière neutralisation**, exception 1.20 encadrée — versé au §2.2.
> 8. **Repère B21 recalé sur `masterAccount()`** — versé au §5.3.
> 9. **`u.demo = false` dans les deux mutateurs** — versé au §5.4.
> 10. **Commentaires hors des mutateurs** (verrou lot 1.6) — versé au §5.4.
> 11. **Sondes positives du scanner et exemptions bornées** — versé au §5.1.
> 12. **Exemptions de `check-bundle` et sondes assemblées** — versé au §5.2.
> 13. **Gardes S1/S2** — versé au §5.6.
> 14. **Cadrage R17** — versé au §1.C et §5.4.
> 15. **Interdiction `MASTER_*` dans la CI** — versée aux §1.B et §5.7.
> 16. **Branche-preuve à ne pas toucher** (807 verts → 372/42) — versée aux
>    §1.B et §7.
> 17. **Checklist en deux temps** (étape 0 + fin de lot) — versée au §6.
> 18. **Conventions de commit et de branche** (`main` ne porte que des fusions,
>    CI Neon sur `pull_request` uniquement, PR depuis la branche, jamais de push
>    direct) — versées aux §2.6/§2.7 et rappelées au §8.
> 19. **git borné au cwd** : `ls-tree` comme `ls-files` renvoie 0 depuis un
>    sous-dossier — formes indépendantes (`-- :/`, `git -C <top>`) et préférence
>    `ls-tree <rév>` sur `ls-files` — **versé au §3**.
> 20. **Règle `add -A` interdit sans confrontation** (arbre en retard de
>    49 fichiers, commit qui annulerait le lot 1.20) + `npm ci` dans le même
>    tour — **versée aux §2.10 et §3**.
> 21. **Hash local ≠ livrable** (re-clone : reflog réduit, objets `9cc7c53` /
>    `bb626f0` morts) — **versé au §3** (sandbox re-cloné).
> 22. **Dépendance à l'arbre** : 144 / 145 / 143 mesurés au même instant
>    (le « 146 » de la v2 venait d'une réimplémentation du filtre, pas d'un
>    arbre antérieur) ; ne jamais recopier des fichiers à l'unité —
>    **versé au §0.2** (règle « Dépendance à l'arbre »).
> 23. **Verrou 1.20 exécuté** : `lot1BaseScripts` 9/9 vert en worktree contre
>    le vrai `server/db.js` de `main` — **versé au §0.1, §1.F et §7**.
> 24. **Variante supprimée (`2f59dde`, parent `17e1df5`)** : condition de
>    clôture remplie (six éléments de la checklist + points 22/23 constatés
>    dans `08d0b8a`) ; l'ensemble balayé est passé de 143 à **142** par la
>    suppression elle-même. **Hashes de traçabilité non récupérables, jamais
>    poussés** (`9cc7c53`, `bb626f0`, `efa9eac`, `d20ddcf`, `17e1df5`,
>    `2f59dde`) : un lecteur qui tentera `git show` n'obtiendra rien, nulle
>    part — la traçabilité d'une variante orpheline se fait par son **contenu
>    versé**, pas par un hash (point 21 poussé jusqu'au bout). Copie de
>    sécurité hors dépôt conservée jusqu'à la fusion
>    (`/home/user/HANDOFF-VARIANTE-ORPHELINE-17e1df5.md`, 661 lignes,
>    sha256 `cbe92eb147d115e8…` — hors PC-Star donc ni suivie ni balayée),
>    supprimable à volonté après ; un hash local n'est pas une sauvegarde,
>    **un fichier hors dépôt en est une**.
---
## 8. Ordre de reprise après ce versement (convenu, sandbox sans réseau)
1. `gh pr list --state open` (**re-mesurer**) puis
   `gh pr create --base main --head arena/01a0a55c-pc-star` (1 commit docs,
   sans conflit attendu — la branche a été recréée par le push après suppression
   post-PR #7).
2. `gh pr checks` → le workflow Neon doit rejouer **4/4** ; puis merge.
3. `npm run build` complet : le critère du lot 7.3 exige que le **build échoue**
   si un secret apparaît dans `dist/` — `check:bundle` seul sur un `dist/`
   préexistant n'exerce ni le chaînage ni un bundle construit depuis
   `main@1d994a2` (lot 1.20 limité à `server/db.js`, bundle client attendu
   inchangé — à constater, pas à supposer).
4. §1.E : `PC-Star-main/` = **dossier fantôme vide** (0 objet, mesure locale),
   gêne purement locale (recherches, indexation IDE), `git status` propre ;
   suppression IDE fermé.
5. §1.C **R17** : mesurer → test de régression (**N72**) → correctif justifié.
   Puis §1.D relecture du §6 du plan. Le lot 0 reste **exploitant** (Vercel).
6. Post-fusion : le `main` local portant le commit docs divergera de
   `origin/main` (qui portera le **commit de fusion**) → `git fetch origin`
   puis `git rebase origin/main` sur `main` (le commit fusionné devient vide
   et tombe). **Pas** de `reset --hard` (§2.7). Puis re-mesurer dans l'arbre
   réel : `git diff --name-only origin/main` vide, ensemble balayé **145**,
   scanner **13/13**, et constater
   `git cat-file -e origin/main:docs/HANDOFF-SESSION-SUIVANTE.md` → §1.A clos.
