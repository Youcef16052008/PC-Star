import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/*
 * LOT P3 (docs) — les deux régimes de `docs/`.
 *
 * Ce dépôt contient 28 fichiers de documentation. Une moitié se veut l'état du
 * jour (guides, recettes, prompts d'agent, index), l'autre est la trace datée d'un
 * audit ou d'une session. Confondre les deux coûte exactement ce que ce dépôt a
 * payé : `docs/ARCHITECTURE.md` faisait lancer « 34 tests », `PORTFOLIO.md`
 * annonçait « 113 pass », `PROMPT-AGENT-DEPLOIEMENT.md` « 36 pages rendues
 * (3 langues × 13) » — et `scripts/jsdom-crawl.mjs` imprimait « 2 langues × 13
 * pages » à côté de « 24 pages rendues » parce que son tableau en fait douze.
 *
 * La règle n'est pas « ne jamais se tromper », elle est :
 *   1. une trace datée n'est PAS réécrite — elle porte une bannière ;
 *   2. un doc qu'on EXECUTE doit décrire aujourd'hui, et ne recopie aucun chiffre
 *      qui vit ailleurs (`README.md` § « État mesuré ») ;
 *   3. tout fichier de `docs/` est classé dans l'un des régimes — ajouter un doc
 *      sans le classer fait échouer ce test, sinon le classement pourrit en un lot.
 */

const DOC = 'docs'
const MARKER_DATÉ = '**Journal daté'
const MARKER_COURANT = 'append-only'

const JOURNAUX_DATÉS = [
  'AUDIT-P22.md',
  'AUDIT-REPO.md',
  'AUDIT-BOUTONS-PHOTOS-2026-09-18.md',
  'BILAN-SESSION-2026-09-17-CI-NEON.md',
  'PLAN-CORRECTIONS.md',
  'PLAN-DESIGN-TERMINAL-CYBER.md',
  'PLAN-REMEDIATION-AUDIT-2026-09-17.md',
  'ROADMAP-10.md',
  'SECURITY-AUDIT.md',
  'VERIFICATION-RAPPORT-AUDIT.md',
  'VERIFICATION-RAPPORT-AUDIT-2.md',
  'VERIFICATION-RAPPORT-AUDIT-3.md',
  'VERIFICATION-RAPPORT-AUDIT-4.md',
  'VERIFICATION-RAPPORT-LOT0.md'
]

// Le journal des sessions : append-only, il reçoit une section nouvelle au lieu
// d'être corrigé après coup.
const JOURNAL_COURANT = ['BUGS-AND-FIXES.md']

// Docs vivantes qui se copient/se collent/se jouent : pas de case « à jour » tolérée.
const DOC_EXECUTABLES = [
  'README.md',
  'ARCHITECTURE.md',
  'GUIDE-DEMO.md',
  'GUIDE-DEMO-FR.md',
  'GUIDE-DEMO-AR.md',
  'DEPLOY-VERCEL.md',
  'HEBERGEMENT-HTTPS.md',
  'NEON-MIGRATION.md',
  'PROMPT-AGENT-DEPLOIEMENT.md',
  'RECETTE-PHOTOS-MASTER.md',
  'RECETTE-RESPONSIVE-DIRECTION-03.md'
]

const lire = (f) => fs.readFileSync(path.join(DOC, f), 'utf8')
const tousLesDocs = fs
  .readdirSync(DOC)
  .filter((f) => f.endsWith('.md'))
  .sort()

describe('P3 — docs : deux régimes, un classement obligatoire', () => {
  it('chaque fichier de docs/ est classé (journal daté, journal courant, doc vivante)', () => {
    const classés = [...JOURNAUX_DATÉS, ...JOURNAL_COURANT, ...DOC_EXECUTABLES, 'PORTFOLIO.md', 'PROBLEMS-SOLUTIONS.md'].sort()
    assert.deepEqual(
      classés,
      tousLesDocs,
      'un doc a été ajouté (ou retiré) sans être classé : décide s\x27il est une trace datée ou un texte à jour'
    )
    assert.equal(new Set(classés).size, classés.length, 'un doc est classé deux fois')
  })

  it('les journaux datés portent leur bannière', () => {
    for (const f of JOURNAUX_DATÉS) {
      assert.ok(lire(f).includes(MARKER_DATÉ), `${f} : trace datée sans bannière — ses chiffres seront lus comme l'état du dépôt`)
    }
    assert.ok(lire(JOURNAL_COURANT[0]).includes(MARKER_COURANT), 'le journal des sessions doit dire qu\x27il est append-only')
  })

  it('un doc daté ne porte pas la bannière d\x27un doc à jour dans l\x27autre sens', () => {
    for (const f of DOC_EXECUTABLES) {
      assert.equal(lire(f).includes(MARKER_DATÉ), false, `${f} : un doc exécutable ne doit pas se défausser sur une date`)
    }
  })

  it('les docs exécutables ne recopient ni un nombre de tests, ni une langue retirée, ni un compteur de pages', () => {
    const interdits = [
      [/[^0-9]\d{2,5} tests\b/, "un nombre de tests recopié — il ne vit que dans README.md § « État mesuré »"],
      [/\b\d+ pages rendues \(3/, 'un compte de pages×langues d\x27une autre époque'],
      [/13 pages\b/, "le « 13 pages » qui ne correspond à aucun tableau du dépôt"],
      [/3 langues/, 'la troisième langue n\x27est plus servie'],
      [/251 SKU/, 'le catalogue d\x27hier — mesuré, il fait 301 produits'],
      [/--experimental-loader/, "l\x27ancien invocateur de tests, remplacé par `--import`"]
    ]
    for (const f of DOC_EXECUTABLES) {
      const s = lire(f)
      const lignes = s.split('\n')
      for (const [re, motif] of interdits) {
        for (let i = 0; i < lignes.length; i++) {
          const l = lignes[i]
          if (l.trimStart().startsWith('>')) continue // les encadrés qui expliquent la faute sont la correction, pas la faute
          assert.equal(re.test(l), false, `${f}:${i + 1} — ${motif}\n  ${l.trim().slice(0, 110)}`)
        }
      }
    }
  })

  it("l'index docs/README.md cite chaque fichier du dossier", () => {
    const index = lire('README.md')
    for (const f of tousLesDocs) {
      if (f === 'README.md') continue
      assert.ok(index.includes(`(${f})`), `${f} : écrit mais jamais indexé — personne ne le lira`)
    }
  })

  it('la doc vivante qui parle de langue annonce le régime réel (FR/EN)', () => {
    for (const f of ['GUIDE-DEMO.md', 'ARCHITECTURE.md', 'PROMPT-AGENT-DEPLOIEMENT.md', 'RECETTE-RESPONSIVE-DIRECTION-03.md']) {
      const s = lire(f)
      if (/arabe/i.test(s)) {
        assert.match(s, /retir|supprim|ne se sert|sans objet/i, `${f} : parle d\x27arabe sans dire que la vitrine ne le sert plus`)
      }
    }
  })
})
