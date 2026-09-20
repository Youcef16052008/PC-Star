/**
 * LOT P5 (relecture) — `scripts/rotate-master.mjs`, la rotation sans fuite.
 *
 * Ce script existe pour une raison précise : le mot de passe maître n'est nulle
 * part dans le dépôt (lot P0), donc on ne peut pas le « donner » — on peut seulement
 * en poser un neuf. Mais un outil de rotation est lui-même une surface par son
 * ergonomie : un script qui affiche le secret pour « aider » le recopie dans
 * l'historique du shell, dans la capture d'écran et dans le fil de discussion. La
 * promesse verrouillée ici est double : **écrire la valeur, ne jamais
 * l'afficher**, et refuser toute cible que git suivrait.
 *
 * Les cas ne sont pas décoratifs, ils sont joués en exécution :
 *  · la valeur écrite survit au PARSEUR DU PROJET (`server/env.js`) — un alphabet
 *    laissé au hasard peut produire une chaîne que `parseEnv` tronque, et le maître
 *    devient injoignable sans que personne ne comprenne pourquoi ;
 *  · `--dry-run` n'écrit rien ;
 *  · une cible non ignorée par git est refusée AVANT écriture (le fichier n'existe
 *    pas après), et `--force` assumé passe ;
 *  · rejouer change la valeur, ne duplique pas la ligne, et ne touche pas à
 *    `MASTER_EMAIL` quand on ne le lui demande pas.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'rotate-master.mjs')

const { genereMotDePasse, eclesEnv } = await import('../scripts/rotate-master.mjs')
const { parseEnv } = await import('../server/env.js')

// Cible jetable : `.gitignore` couvre `.env.*.local`, donc le script l'accepte, et
// rien de ce fichier ne peut atterrir dans un commit.
const CIBLE = `.env.rotate-test-${process.pid}-${Math.floor(Math.random() * 1e6)}.local`
const CHEMIN = path.join(ROOT, CIBLE)
const SUIVI = `.env.rotate-suivi-test.env`
const CHEMIN_SUIVI = path.join(ROOT, SUIVI)
after(() => {
  for (const f of [CHEMIN, CHEMIN_SUIVI]) fs.rmSync(f, { force: true })
})

function joue(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
}

/** La valeur, telle qu'elle est écrite dans le fichier (lecture locale au test). */
function valeurDans(fichier = CHEMIN) {
  return parseEnv(fs.readFileSync(fichier, 'utf8')).MASTER_PASSWORD
}

describe('P5 — le générateur', () => {
  it("tient la longueur demandée, dans l'alphabet sûr, avec les quatre classes", () => {
    const ALPHABET = /^[A-Za-z0-9\-_.,:/+@]+$/
    for (const n of [20, 32, 64, 128]) {
      for (let k = 0; k < 25; k++) {
        const mdp = genereMotDePasse(n)
        assert.equal(mdp.length, n, `longueur demandée ${n}, obtenue ${mdp.length}`)
        assert.match(mdp, ALPHABET, "un signe hors alphabet casserait un .env, un shell ou un collage")
        assert.match(mdp, /[a-z]/, "au moins une minuscule (exigence de complexité des plateformes)")
        assert.match(mdp, /[A-Z]/, "au moins une majuscule")
        assert.match(mdp, /[0-9]/, "au moins un chiffre")
        assert.match(mdp, /[\-_\.,:/+@]/, "au moins un symbole")
        // Les signes qui posent problème dans un fichier `.env`, un shell ou un
        // JSON : guillemets, `$` (interpolation), backslash, `#` (commentaire chez
        // certains parseurs), espace, et les métacaractères de shell.
        for (const interdit of ['"', "'", '`', '\\', '$', '#', ' ', '&', ';', '|', '<', '>', '(', ')']) {
          assert.equal(mdp.includes(interdit), false, `signe ${interdit} présent dans la valeur générée`)
        }
      }
    }
  })

  it("ne renvoie jamais deux fois la même valeur", () => {
    const vues = new Set()
    for (let i = 0; i < 200; i++) vues.add(genereMotDePasse(32))
    assert.equal(vues.size, 200, "un générateur qui se répète ne fait pas une rotation")
  })

  it("eclesEnv remplace en place, préserve le reste et ne duplique jamais la clé", () => {
    const avant = [
      "# compte du poste",
      "MASTER_EMAIL=ancienne@exemple.dz",
      "DATABASE_URL=postgres://h/db",
      "MASTER_PASSWORD=vieux-secret",
      "MASTER_PASSWORD=vieux-secret-bis # doublon hérité"
    ].join("\n")
    const apres = eclesEnv(avant, { MASTER_PASSWORD: "neuf", AUTRE_CLE: "ajoutee" })
    const parsed = parseEnv(apres)
    assert.equal(parsed.MASTER_PASSWORD, "neuf")
    assert.equal(parsed.MASTER_EMAIL, "ancienne@exemple.dz", "une clé qu'on ne demande pas doit rester")
    assert.equal(parsed.DATABASE_URL, "postgres://h/db", "les autres lignes se conservent")
    assert.equal(parsed.AUTRE_CLE, "ajoutee", "une clé absente se pose à la fin")
    assert.equal((apres.match(/^MASTER_PASSWORD=/gm) || []).length, 1, "le doublon hérité doit être replié en une ligne")
    assert.equal(apres.includes("vieux-secret"), false, "l'ancienne valeur ne survit nulle part dans le fichier")
    assert.equal(apres.endsWith("\n"), true, "un fichier .env sans saut de ligne final se parse mal chez certains outils")
  })
})

describe('P5 — la CLI : écrire la valeur, ne jamais la chercher', () => {
  it("écrit 32 signes dans la cible, tels que le parseur du projet les relit", () => {
    const r = joue([`--file=${CIBLE}`, "--length=32"])
    assert.equal(r.status, 0, `le script a échoué : ${r.stderr}`)
    assert.ok(fs.existsSync(CHEMIN), "le fichier cible doit être créé")
    const brut = fs.readFileSync(CHEMIN, "utf8")
    const parsed = parseEnv(brut)
    assert.equal(typeof parsed.MASTER_PASSWORD, "string")
    assert.equal(parsed.MASTER_PASSWORD.length, 32, "la valeur relue par `server/env.js` n'est pas celle écrite")
    assert.equal(parsed.MASTER_PASSWORD, valeurDans(), "la ligne brute et la valeur parsée divergent")
    assert.equal((brut.match(/^MASTER_PASSWORD=/gm) || []).length, 1)
    assert.match(brut, /Ce fichier est ignoré par git/, "un fichier créé de zéro doit dire ce qu'il est")
    // Le script est un outil de poste : les droits suivent, sinon un autre compte
    // du même hôte lit le secret.
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(CHEMIN).mode & 0o777, 0o600, "un fichier de secret doit être en 0600")
    }
    assert.match(r.stdout, /valeur NON affichée/, "le script doit dire qu'il ne montre rien")
  })

  it("ne promeut la valeur nulle part dans sa sortie", () => {
    fs.rmSync(CHEMIN, { force: true })
    const r = joue([`--file=${CIBLE}`, "--length=48"])
    assert.equal(r.status, 0, r.stderr)
    // La valeur comparée est celle que CETTE exécution a écrite : lire le fichier
    // après d'autres exécutions ne vérifierait rien du tout.
    const valeur = valeurDans()
    assert.equal(valeur.length, 48, "le fichier ne porte pas la valeur de cette exécution : le verrou ne regarderait rien")
    const sortie = `${r.stdout}${r.stderr}`
    assert.equal(sortie.includes(valeur), false, "la sortie contient LA valeur générée : historique du shell, capture, chat")
    for (const ligne of sortie.split("\n")) {
      assert.equal(/^\s*(?:export\s+)?MASTER_PASSWORD=/.test(ligne), false, "le script recopie la ligne sensible dans sa sortie")
    }
  })

  it("rejouer fait une autre valeur, et laisse MASTER_EMAIL tranquille", () => {
    const premiere = valeurDans()
    assert.equal(joue([`--file=${CIBLE}`, "--email=Boutique@exemple.dz"]).status, 0)
    const parsed = parseEnv(fs.readFileSync(CHEMIN, "utf8"))
    assert.notEqual(parsed.MASTER_PASSWORD, premiere, "deux exécutions identiques = aucune rotation")
    assert.equal(parsed.MASTER_EMAIL, "boutique@exemple.dz", "l'e-mail doit être normalisé (minuscules), comme à la porte")
    assert.equal(joue([`--file=${CIBLE}`]).status, 0)
    const apres = parseEnv(fs.readFileSync(CHEMIN, "utf8"))
    assert.equal(apres.MASTER_EMAIL, "boutique@exemple.dz", "un e-mail déjà posé ne doit pas disparaître au rejeu")
    assert.notEqual(apres.MASTER_PASSWORD, parsed.MASTER_PASSWORD)
    assert.equal((fs.readFileSync(CHEMIN, "utf8").match(/^MASTER_EMAIL=/gm) || []).length, 1)
  })

  it("refuse le plancher de longueur, un argument inconnu et un e-mail malformé", () => {
    for (const args of [["--length=8"], ["--length=0"], ["--length=256"], ["--length=abc"], ["--taille=32"], ["--email=pas-une-adresse"], ["--email=@x.dz"]]) {
      const r = joue(args)
      assert.notEqual(r.status, 0, `accepté à tort : ${args.join(" ")}`)
      assert.match(r.stderr, /rotate-master/, `le refus ne dit pas d'où il vient : ${args.join(" ")}`)
    }
    // Une cible hors du dépôt est un moyen d'écrire n'importe où.
    const hors = joue(["--file=../outside-rotate.env"])
    assert.notEqual(hors.status, 0, "le script écrit hors du dépôt sur simple demande")
    fs.rmSync(path.join(ROOT, "..", "outside-rotate.env"), { force: true })
  })

  it("refuse une cible que git suivrait, et n'écrit rien avant de refuser", () => {
    fs.rmSync(CHEMIN_SUIVI, { force: true })
    const r = joue([`--file=${SUIVI}`])
    assert.notEqual(r.status, 0, "le script écrit un secret dans un fichier suivi par git")
    assert.equal(fs.existsSync(CHEMIN_SUIVI), false, "le refus arrive APRÈS l'écriture : le fichier est déjà sur le disque")
    assert.match(r.stderr, /ignor/i, "la raison du refus doit dire qu'il faut une cible ignorée par git")
    // Et l'option assumée passe, sinon le verrou est une interdiction inutile.
    assert.equal(joue([`--file=${SUIVI}`, "--force"]).status, 0)
    assert.ok(fs.existsSync(CHEMIN_SUIVI), "--force doit quand même fonctionner : c'est la sortie de secours assumée")
  })

  it("avec --dry-run, le fichier ne bouge pas", () => {
    fs.rmSync(CHEMIN, { force: true })
    assert.equal(joue([`--file=${CIBLE}`, "--dry-run"]).status, 0)
    assert.equal(fs.existsSync(CHEMIN), false, "--dry-run a créé le fichier")
    // Deuxième passage : sur un fichier qui existe déjà, rien ne doit être réécrit.
    assert.equal(joue([`--file=${CIBLE}`]).status, 0)
    const avant = fs.readFileSync(CHEMIN, "utf8")
    assert.equal(joue([`--file=${CIBLE}`, "--dry-run"]).status, 0)
    assert.equal(fs.readFileSync(CHEMIN, "utf8"), avant, "--dry-run a modifié la valeur")
  })

  it("et dans ce dépôt, la cible par défaut EST ignorée par git", () => {
    const r = spawnSync("git", ["check-ignore", "-q", "--", ".env.local"], { cwd: ROOT, encoding: "utf8" })
    if (r.error) return // environnement sans git : le test n'a rien à dire ici
    assert.equal(r.status, 0, "le script pointe par défaut sur un fichier que git suivrait — `.env.local` doit être ignoré")
  })
})

describe('P5 — le script est branché, documenté, et muet sur le secret', () => {
  /*
   * Un outil que `package.json` ne connaît pas et qu'aucun doc ne cite ne sera pas
   * joué le jour où il sert : à ce moment-là on cherche une commande, pas un
   * fichier dans `scripts/`.
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  it("npm run master:rotate existe et pointe sur le script", () => {
    assert.equal(pkg.scripts["master:rotate"], "node scripts/rotate-master.mjs")
  })

  it("docs/DEPLOY-VERCEL.md le cite, avec la suite des commandes", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs", "DEPLOY-VERCEL.md"), "utf8")
    assert.match(doc, /master:rotate/, "la rotation du secret maître n'est documentée nulle part")
    for (const commande of ["vercel env rm", "vercel env add", "vercel --prod"]) {
      assert.ok(doc.includes(commande), `la doc de rotation oublie « ${commande} »`)
    }
    assert.match(doc, /sessions ma[îi]tre/, "la doc doit dire que les sessions ouvertes sont révoquées")
  })

  it("la valeur ne transite jamais par un argument de commande", () => {
    // Un `--password=…` passerait le secret dans `ps`, dans l'historique du shell
    // et dans le journal de CI : le script ne doit offrir aucune telle option.
    const source = fs.readFileSync(SCRIPT, "utf8")
    for (const interdit of ["--password", "--motdepasse", "--pwd", "--print", "--show", "--reveal"]) {
      assert.equal(source.includes(interdit), false, `le script accepte ${interdit} : la valeur passerait par la ligne de commande`)
    }
    assert.equal(/console\.(log|info)\([^)]*(valeur|password|entrees\.MASTER_PASSWORD)/i.test(source), false, "le script affiche la valeur")
    assert.ok(path.isAbsolute(SCRIPT) && fs.existsSync(SCRIPT), "scripts/rotate-master.mjs introuvable")
  })
})
