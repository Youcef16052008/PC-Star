#!/usr/bin/env node
/**
 * LOT P5 (relecture) — rotation du mot de passe maître SANS jamais afficher la valeur.
 *
 * Pourquoi ce script existe. Demander « donne-moi le mot de passe maître » est une
 * impasse saine dans ce dépôt : aucune valeur n'y est stockée (le lot P0 a voulu que
 * `server/db.js` refuse de démarrer sans `MASTER_EMAIL` / `MASTER_PASSWORD`, sans
 * aucun défaut codé en dur, et que `npm run build` échoue si un secret file dans le
 * bundle — `scripts/check-bundle.mjs`). Ce qu'on peut faire, en revanche, c'est en
 * **poser un neuf**, et c'est même la bonne manœuvre quand un secret a pu être vu.
 * Ce script fait cette moitié du travail :
 *
 *   1. il génère un mot de passe fort (32 signes par défaut), pris dans un alphabet
 *      choisi pour survivre à un fichier `.env`, à une ligne de shell et à un collage
 *      dans le tableau de bord Vercel — ni guillemet, ni `$`, ni backslash, ni `#`,
 *      ni espace, ni `=` en tête ;
 *   2. il l'écrit dans `.env.local` (le seul fichier du dépôt que git ignore pour ce
 *      couple), en mode 0600, en préservant les autres clés et les commentaires du
 *      fichier ;
 *   3. il affiche ce qu'il reste à jouer sur Vercel — et **jamais la valeur** : un
 *      secret qui passe à l'écran passe aussi dans l'historique du shell, dans la
 *      capture d'écran et dans le fil de discussion.
 *
 * Usage :
 *   npm run master:rotate                                  # 32 signes, .env.local
 *   npm run master:rotate -- --email=boutique@exemple.dz    # change aussi l'e-mail
 *   npm run master:rotate -- --length=48                    # plus long
 *   npm run master:rotate -- --dry-run                      # vérifie sans écrire
 *
 * Sorties : 0 = écrit (ou vérifié, avec --dry-run) ; 1 = refus, avec la raison.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Plancher documenté dans `docs/DEPLOY-VERCEL.md` §7 (le rate-limit de l'app n'est
 *  qu'un frein derrière Vercel : la frontière, c'est la longueur du secret). */
const LONGUEUR_MIN = 20
const LONGUEUR_DEFAUT = 32
const LONGUEUR_MAX = 128

/**
 * Quatre classes, séparées pour qu'un mot de passe généré passe les exigences de
 * complexité d'une plateforme tierce sans qu'on ait à le re-taper. Le `#` est exclu
 * (il ouvre un commentaire dans certains parseurs), comme `$`, le backtick,
 * l'accent circonflexe et les guillemets (interpolation ou fin de ligne dans un
 * shell), le backslash (échappement), et l'espace (les parseurs `.env` tronquent).
 */
const CLASSES = {
  minuscules: 'abcdefghijklmnopqrstuvwxyz',
  majuscules: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  chiffres: '0123456789',
  symboles: '-_.,:/+@'
}
const ALPHABET = Object.values(CLASSES).join('')

/** Un signe au hasard, sans biais (rejet implicite via `randomInt`). */
const tire = (alphabet) => alphabet[randomInt(alphabet.length)]

/** Mot de passe de `n` signes, avec au moins un signe de chaque classe. */
export function genereMotDePasse(n) {
  const classes = Object.values(CLASSES)
  const signes = classes.map(tire)
  while (signes.length < n) signes.push(tire(ALPHABET))
  // Melange de Fisher-Yates (tirage sans remise) : sinon les quatre premiers
  // signes seraient toujours une minuscule, une majuscule, un chiffre, un symbole.
  for (let i = signes.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[signes[i], signes[j]] = [signes[j], signes[i]]
  }
  return signes.slice(0, n).join('')
}

/**
 * Remplace (ou ajoute) des clés dans le contenu d'un fichier `.env`, sans rien
 * toucher d'autre. Les doublons hérités sont supprimés : deux lignes
 * `MASTER_PASSWORD=` dans un même fichier, c'est la seconde qui gagne chez
 * certains parseurs et la première chez d'autres — un secret posé deux fois est un
 * secret dont on ne sait plus lequel est en service.
 */
export function eclesEnv(contenu, entries) {
  const lines = String(contenu ?? '').split(/\r?\n/)
  const vues = new Set()
  const sortie = []
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && Object.prototype.hasOwnProperty.call(entries, m[1])) {
      if (vues.has(m[1])) continue // doublon : on le retire
      vues.add(m[1])
      sortie.push(`${m[1]}=${entries[m[1]]}`)
      continue
    }
    sortie.push(line)
  }
  // Une clé absente du fichier se pose a la fin (les lignes remplacees restent a
  // leur place, la leur, pour que le diff du poste reste lisible).
  const corps = sortie.join('\n').replace(/\n+$/, '')
  const manquantes = Object.entries(entries).filter(([cle]) => !vues.has(cle))
  if (!manquantes.length) return `${corps}\n`
  const queue = manquantes.map(([cle, valeur]) => `${cle}=${valeur}`).join('\n')
  return corps ? `${corps}\n${queue}\n` : `${queue}\n`
}

/** Le fichier doit etre ignore par git : poser un secret dans un fichier suivi,
 *  c'est le publier a la prochaine `git add -A`. `--force` assumé passe outre. */
function estIgnoreParGit(fichier) {
  const r = spawnSync('git', ['check-ignore', '-q', '--', fichier], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { ignore: false, raison: `git indisponible (${r.error.code || r.error.message})` }
  if (r.status === 0) return { ignore: true }
  if (r.status === 128) return { ignore: false, raison: 'ce répertoire n’est pas un dépôt git' }
  return { ignore: false, raison: 'le fichier serait suivi par git' }
}

function litArguments(argv) {
  const opts = { length: LONGUEUR_DEFAUT, file: '.env.local', email: null, dryRun: false, force: false }
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--force') opts.force = true
    else if (a.startsWith('--length=')) opts.length = Number(a.slice(9))
    else if (a.startsWith('--file=')) opts.file = a.slice(7)
    else if (a.startsWith('--email=')) opts.email = a.slice(8).trim().toLowerCase()
    else {
      process.stderr.write(`[rotate-master] argument inconnu : ${a}\n  · attendu : --email=… --length=… --file=… --dry-run --force\n`)
      process.exit(1)
    }
  }
  return opts
}

export function main(argv = process.argv.slice(2)) {
  const opts = litArguments(argv)

  // 1. la longueur, d'abord : c'est le seul parametre qui change reellement la
  //    resistance du compte, et le plancher est documente — un script qui
  //    accepterait --length=6 fabriquerait le defaut qu'il est cense reparer.
  if (!Number.isInteger(opts.length) || opts.length < LONGUEUR_MIN || opts.length > LONGUEUR_MAX) {
    process.stderr.write(
      `[rotate-master] --length invalide (${opts.length}) : un entier entre ${LONGUEUR_MIN} et ${LONGUEUR_MAX}.` +
        ` Le plancher de ${LONGUEUR_MIN} vient de docs/DEPLOY-VERCEL.md §7 (le rate-limit de l'app n'est qu'un frein sur Vercel).\n`
    )
    process.exit(1)
  }

  // 2. l'e-mail n'est pas un secret, mais il doit être valide : c'est la clé de
  //    recherche du compte, une adresse malformée posée en environnement ferme
  //    l'accès au maître sans le dire (le login ne trouve personne).
  const entrees = { MASTER_PASSWORD: genereMotDePasse(opts.length) }
  if (opts.email != null) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email) || opts.email.length > 254) {
      process.stderr.write('[rotate-master] --email invalide (forme `a@b.c`, 254 signes maximum, comme à l’inscription).\n')
      process.exit(1)
    }
    entrees.MASTER_EMAIL = opts.email
  }

  // 3. cible : un chemin relatif au dépôt, jamais un fichier suivi par git.
  const cible = path.resolve(ROOT, opts.file)
  if (!cible.startsWith(ROOT + path.sep)) {
    process.stderr.write(`[rotate-master] refusé : ${opts.file} sort du dépôt.\n`)
    process.exit(1)
  }
  if (!opts.dryRun && !opts.force) {
    const statut = estIgnoreParGit(path.relative(ROOT, cible))
    if (!statut.ignore) {
      process.stderr.write(
        `[rotate-master] refusé : ${opts.file} n’est pas ignoré par git (${statut.raison}).\n` +
          '  · un secret écrit dans un fichier suivi part dans le prochain commit — donc dans le dépôt, donc au monde ;\n' +
          '  · utilise `.env.local` (ignorée), ou ajoute la ligne à .gitignore, puis rejoue avec --force si tu assumes.\n'
      )
      process.exit(1)
    }
  }

  const avant = fs.existsSync(cible) ? fs.readFileSync(cible, 'utf8') : ''
  const apres = avant
    ? eclesEnv(avant, entrees)
    : `# Compte maître local — généré par scripts/rotate-master.mjs.\n` +
      `# Ce fichier est ignoré par git : c'est le seul endroit du dépôt où ce couple a sa place.\n` +
      eclesEnv('', entrees)

  if (opts.dryRun) {
    process.stdout.write(
      `[rotate-master] --dry-run : rien n'est écrit.\n` +
        `  · cible : ${path.relative(ROOT, cible)} (${avant ? 'existe' : 'serait créé'})\n` +
        `  · clés qui changeraient : ${Object.keys(entrees).join(', ')}\n` +
        `  · longueur du mot de passe : ${opts.length} signes, valeur non affichée\n`
    )
    return 0
  }

  fs.writeFileSync(cible, apres, { encoding: 'utf8', mode: 0o600 })
  // `mode` ne s'applique qu'à la création ; un fichier déjà présent garde ses
  // permissions, y compris 0644 — donc le resserrer explicitement.
  fs.chmodSync(cible, 0o600)

  const ligneEmail = entrees.MASTER_EMAIL ?? 'inchangé (c’est la valeur posée côté Vercel qui reste la bonne)'
  process.stdout.write(
    [
      `[rotate-master] ${path.relative(ROOT, cible)} écrit en 0600 — MASTER_PASSWORD régénéré (${opts.length} signes), valeur NON affichée.`,
      `  · MASTER_EMAIL : ${ligneEmail}`,
      '  · pourquoi rien ne s’affiche : un secret passé à l’écran se retrouve dans l’historique du shell,',
      '    la capture d’écran et le fil de discussion. Le relire se fait ici :',
      `      cut -d= -f2- <<<"$(grep '^MASTER_PASSWORD=' ${opts.file})"`,
      '    ou, sans le toucher, directement dans le presse-papiers :',
      `      grep '^MASTER_PASSWORD=' ${opts.file} | cut -d= -f2- | tr -d '\\n' | pbcopy        # macOS`,
      `      grep '^MASTER_PASSWORD=' ${opts.file} | cut -d= -f2- | tr -d '\\n' | wl-copy      # Linux (Wayland)`,
      '  · le poser en production (puis coller la valeur au prompt, marquée « Sensitive ») :',
      '      vercel env rm  MASTER_PASSWORD production',
      '      vercel env add MASTER_PASSWORD production',
      '      vercel --prod',
      '  · le serveur suit tout seul : `server/db.js` compare le secret configuré à l’empreinte en base',
      '    au premier appel, remplace l’empreinte et RÉVOQUE les sessions maître ouvertes. Rien à faire',
      '    en SQL, et aucun mot de passe n’est jamais écrit dans la base.',
      ''
    ].join('\n')
  )
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
