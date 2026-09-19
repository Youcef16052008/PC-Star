# Bilan de session — chantier CI Neon (LOT 1.20)

> **Journal daté — ses chiffres sont ceux du jour, pas l'état du dépôt.** Ce
> document est une trace : on ne le réécrit pas quand il est contredit plus tard,
> parce qu'effacer une conclusion fausse efface aussi la raison pour laquelle
> elle était fausse.
> Au fil des lots, plusieurs nombres et commandes ci-dessous ont été
> dépassés. L'état mesuré d'aujourd'hui est dans
> [`../../README.md`](../../README.md) (« État mesuré »), la suite des sessions
> dans [`BUGS-AND-FIXES.md`](BUGS-AND-FIXES.md). Les docs **exécutables** (guides,
> recettes, prompts d'agent, `docs/README.md`) ont, elles, été corrigées — c'est
> `src/p3DocsAging.test.js` qui verrouille les deux régimes.


**Date :** 17/09/2026 · **Base :** `18370b7` · **Livrable :** `a2bd958`
**Branche :** `arena/01a0a55c-pc-star` · **Chantier :** 1.B du plan
(`docs/PLAN-CORRECTIONS.md`) — l'étape CI « Run Neon schema migrations »
échouait sur chaque PR.

Ce document est le point d'entrée pour tout agent (ou humain) qui reprend le
dépôt après cette session : ce qui a changé, pourquoi, comment c'est validé,
et ce qu'il reste à faire.

---

## 1. Le défaut corrigé (et pourquoi il était bloquant)

`server/db.js` résolvait le compte maître **au chargement du module** :

```js
const MASTER = masterAccount()   // exigeait MASTER_EMAIL / MASTER_PASSWORD à l'import
```

Tout importeur héritait de cette exigence — y compris les quatre scripts de
base qui n'ont rien à faire des identifiants :

| Script (npm) | Rôle réel | Besoin du maître |
|---|---|---|
| `db:migrate:neon`, `…:reset` | crée le schéma, écrit `emptyDb()` | aucun |
| `test:neon:concurrency` | réservation concurrente, lit/écrit l'état | aucun |
| `db:doctor` | diagnostic connexion/schéma | aucun |
| `db:import:neon` | importe un `store.json` | aucun |

La CI ne pose que `DATABASE_URL` : l'échec de l'étape « Run Neon schema
migrations » était **certain**, et — les quatre étapes étant séquentielles dans
le même job — la concurrence, le `--reset` et la suite complète ne s'exécutaient
**jamais** sur une branche de PR.

## 2. La correction

`server/db.js` ne résout plus rien au chargement :

- l'objet `const MASTER` est supprimé (aucun consommateur — vérifié par grep
  sur l'ensemble du dépôt) ;
- `masterAccountOrNull()` renvoie le compte, ou `null` sans configuration ;
- `emptyDb()` / `normalizeDb()` passent par cet accesseur : sans configuration,
  elles ne sèment pas de maître et ne le synchronisent pas, mais **ne retirent
  jamais** un maître déjà présent en base ;
- `masterAccount()` **lève toujours** sans les variables, et le serveur refuse
  toujours de démarrer sans elles (`assertMasterConfigured`) — le verrou du
  LOT 1.1 est intact, seul le moment de la résolution a changé.

## 3. Fichiers modifiés (commit `a2bd958`)

| Fichier | Changement |
|---|---|
| `server/db.js` | résolution paresseuse (voir §2) |
| `src/lot1BaseScripts.test.js` | **nouveau** — 9 tests de non-régression |
| `src/lot3Server.test.js` | 3.17 (B21) : le repère d'ordre n'est plus l'objet `MASTER` mais `masterAccount()` |
| `src/masterSecrets.test.js` | sonde ESM : chemin Windows nu → `pathToFileURL` (défaut préexistant) |
| `src/serverFixes.test.js` | idem : serveur enfant + 2 sondes OAuth |
| `src/lot4Server.test.js` | idem : sonde upload F15 |
| `src/lot6Quality.test.js` | idem : 2 sondes CORS + `--import` en URL `file://` |
| `package.json` | `src/lot1BaseScripts.test.js` ajouté au script `test` |
| `docs/BUGS-AND-FIXES.md` | entrée LOT 1.20 complète (mécanisme, correction, verrous) |
| `docs/PLAN-CORRECTIONS.md` | ligne LOT 1.20 au tableau d'état ; compteur de tests 807 → 816 |
| `docs/NEON-MIGRATION.md` | note : les commandes ne réclament plus `MASTER_*` |
| `.github/workflows/neon_workflow.yml` | commentaire : ces étapes n'ont pas besoin de `MASTER_*` |

## 4. Validation (mesurée, pas supposée)

1. **Sondes réelles** sans `MASTER_*` : `db:migrate:neon` et `…:reset` →
   sortie 2 avec `DATABASE_URL is required` ; `db:doctor` → sortie 0 avec
   `DATABASE_URL absente` ; `test:neon:concurrency` → sortie 2. Aucune ne
   mentionne le compte maître.
2. **Suite complète** (`npm test`) : **816 tests, 0 échec, 0 annulé**
   (1 skip volontaire préexistant) — 807 avant + 9.
3. **Baseline** : le commit livré `18370b7` cloné proprement échouait
   davantage (3 échecs + 49 annulations) — la preuve que les défauts Windows
   des sondes étaient préexistants et non causés par le lot.
4. **Clone neuf du commit final** (après `npm ci`) : 22/22 sur
   `lot1BaseScripts` + `masterSecrets`.

## 5. Pièges Windows à connaître (corrigés au §3)

Sur Windows, le loader ESM **refuse** les chemins absolus nus (`C:\…`) —
erreur `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`. Deux formes
étaient touchées dans les fichiers de tests :

1. `await import(${JSON.stringify(chemin)})` dans une sonde `-e` —
   utiliser `pathToFileURL(chemin)` (déjà corrigé partout) ;
2. `--import <chemin absolu>` passé en argument d'un processus enfant —
   passer aussi une URL `file://`.

Conséquence pratique : toute nouvelle sonde enfant doit convertir ses chemins
avec `pathToFileURL` (de `node:url`). Sous Linux (CI) les deux formes passent,
ce qui est pourquoi ces défauts étaient invisibles sur GitHub Actions.

Autre subtilité : un fichier `.jsx` ne se charge que via
`scripts/jsx-test-register.mjs` — le script `test` l'importe déjà ; un
processus enfant qui doit en importer doit le passer aussi en `--import`.

---

## 6. Layout du dépôt sur cette machine (à ne pas réinventer)

- Le dépôt git est à la racine `C:\Users\pc\Desktop\PC Star` ; l'arbre **suivi**
  y est la source de vérité (c'est ce que clone la CI).
- `PC-Star-main/` (dossier imbriqué, non suivi) est la **copie de travail de
  l'IDE** — le même contenu, plus les dépendances installées. Il ne faut
  **jamais** le committer : c'est exactement l'anti-pattern du contre-exemple
  `arena/01a090f7-pc-star` (dossier imbriqué que ni le build, ni les tests, ni
  Vercel n'exécutent). À l'issue d'une session, synchroniser les fichiers
  modifiés de la copie vers l'arbre suivi (copie simple), puis committer.
- Un `docs/GUIDE-COMPTES*.md` au contenu compromis (copies du contre-exemple)
  a été déplacé hors du dépôt vers
  `C:\Users\pc\Desktop\quarantaine-contre-exemple\` — ne pas le ramener.

## 7. Ce qu'il reste à faire

1. **Pousser** `git push origin arena/01a0a55c-pc-star` — fait le 17/09 (voir
   la note de fin) : la CI Neon de la PR ouverte rejoue les quatre étapes, qui
   doivent maintenant passer.
2. **LOT 0 — rotation des secrets** (à faire par l'exploitant, toujours
   ouvert) : les quatre identifiants publiés par le contre-exemple restent
   compromis. Poser `MASTER_EMAIL` / `MASTER_PASSWORD` **neufs** en production
   (Vercel) ; procédure au §9 du plan.
3. Fichiers non suivis restés à la racine du dépôt, hors périmètre applicatif
   (à archiver ou supprimer à la main) : `check-neon.mjs` et `verify-neon.mjs`
   (sondes de diagnostic redondantes avec `npm run db:doctor`) et
   `nvidia_kimi_k3.py` (sans rapport avec PC-Star).
4. Une fois la PR fusionnée : archiver la copie imbriquée `PC-Star-main/` pour
   éviter la divergence des deux copies.
5. Prochains chantiers du plan (après CI verte) : R17 (rate-limit en mémoire),
   et la relecture du § « Découvertes hors rapports » du plan.

## 7 bis. Hors dépôt (artefacts de session, non commités volontairement)

- `%TEMP%\` : clones de vérification et répertoires de tests — purgés.
- `C:\Users\pc\Desktop\quarantaine-contre-exemple\` : les trois guides au
  contenu compromis (à conserver jusqu'à la fin du LOT 0, puis à détruire).

## 8. Conventions à respecter dans ce dépôt (rappels utiles)

- Tout correctif s'accompagne d'un **test de non-régression**, ajouté au
  script `test` de `package.json` (la liste des fichiers y est **explicite**) ;
  `--test-concurrency=1`.
- Le scanner `src/masterSecrets.test.js` parcourt **tout le dépôt,
  récursivement** (js/jsx/mjs/cjs/json/md) : jamais de littéral de mot de
  passe, jamais de tableau de documentation avec une colonne « mot de passe »
  remplie d'une valeur, jamais la forme d'appel de `hashPassLegacy` suivie
  d'une chaîne entre guillemets, même en commentaire. La liste `HISTORIQUE`
  (documents qui citent l'historique des secrets) est **fermée et nominative**
  — un nouveau document ne peut pas s'y ajouter sans passer par un test.
- Les scripts et tests lisent la configuration par **fonctions** (à la
  demande), jamais par constantes figées à l'import : c'est ce qui a permis ce
  lot et c'est la convention à conserver (`masterAccountOrNull`,
  `demoAccounts`, `configuredFrontUrl`…).

## 9. Commandes de reproduction

```bash
# Sondes sans identifiants (le comportement corrigé) :
env -u MASTER_EMAIL -u MASTER_PASSWORD node scripts/neon-migrate.mjs
#   → « DATABASE_URL is required » (exit 2), pas d'erreur compte maître

# Suite complète :
npm ci && npm test            # 816 tests, 0 échec

# Verrou du lot seul :
node --import ./scripts/test-env.mjs --test --test-concurrency=1 \
  src/lot1BaseScripts.test.js
```

---

*Livré le 17/09/2026. Validation complète : §4 ; détail du correctif :
`docs/BUGS-AND-FIXES.md` § LOT 1.20 ; état d'avancement global :
`docs/PLAN-CORRECTIONS.md` § 7.*
