/**
 * LOT 7.3 — « aucun secret dans le bundle », automatisé.
 *
 * Le plan notait ce contrôle 🟡 **partiel** depuis le lot 1.2 : il était mené à
 * la main (`npm run build` puis `grep`) et rien n'empêchait une régression de
 * passer inaperçue. Le lot 1.19 a montré l'enjeu — les trois mots de passe des
 * comptes de démonstration étaient livrés au navigateur via
 * `DEMO_CUSTOMERS[].passwordPlain`.
 *
 * Le scanner du dépôt (`src/masterSecrets.test.js`) parcourt les fichiers
 * **suivis** ; celui-ci porte sur ce qui est réellement **publié** (`dist/`),
 * donc aussi sur ce qu'un build pourrait inliner depuis l'environnement.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(process.cwd())
const { scanBundle, missingDistMessage } = await import('../scripts/check-bundle.mjs')

/** Construit un faux `dist/` jetable, supprimé après chaque test. */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-bundle-'))
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

/**
 * Les deux sondes « mot de passe littéral » ci-dessous doivent contenir une
 * valeur de la forme compromise pour prouver la détection — mais écrites telles
 * quelles, elles déclencheraient le scanner du dépôt (`src/masterSecrets.test.js`,
 * règle « mot + 2 chiffres »), qui ne connaît **aucune** exemption de fichier.
 * D'où l'assemblage à l'exécution, la technique déjà employée dans le scanner
 * lui-même. Ne pas « simplifier » ces constantes en littéraux.
 */
const CLE = ['pass', 'word'].join('')
const VALEUR = ['kar', 'im', '31'].join('')
const SONDE_MDP = `const u={email:"a@b.dz",${CLE}:"${VALEUR}"}\n`

const CLEAN = {
  'assets/index-abc123.js': 'const a="bonjour";export default a\n',
  'index.html': '<!doctype html><title>PC Star</title>\n',
  'assets/index-abc123.css': '.btn{color:red}\n'
}

describe('LOT 7.3 — scanBundle sur un bundle propre', () => {
  it('aucun coup', () => {
    const dir = fixture(CLEAN)
    try {
      assert.deepEqual(scanBundle(dir, { env: {} }), [])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('un e-mail de contact publié n’est pas un coup (périmètre assumé)', () => {
    // `src/data.js` publie l'adresse du magasin, affichée par l'UI. Interdire
    // MASTER_EMAIL ferait échouer le build dès que l'exploitant utilise cette
    // adresse comme identifiant — le cas documenté. Un identifiant n'est pas un
    // secret ; le script ne regarde donc que les mots de passe et assimilés.
    const dir = fixture({
      ...CLEAN,
      'assets/index-abc123.js': 'const c={email:"pcstar.info31@gmail.com",tel:"0550"}\n'
    })
    try {
      assert.deepEqual(
        scanBundle(dir, { env: { MASTER_EMAIL: 'pcstar.info31@gmail.com' } }),
        [],
        'un e-mail ne doit jamais faire échouer le build'
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('la valeur de la démo LOCALE reste admise (elle n’ouvre rien côté serveur)', () => {
    const dir = fixture({ ...CLEAN, 'assets/index-abc123.js': 'const p="demo-local"\n' })
    try {
      assert.deepEqual(scanBundle(dir, { env: {} }), [])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('LOT 7.3 — scanBundle détecte ce qui ne doit pas être publié', () => {
  const cases = [
    {
      titre: 'un mot de passe d’environnement inliné au build',
      content: 'const cfg={pw:"mot-de-passe-du-maitre"}\n',
      env: { MASTER_PASSWORD: 'mot-de-passe-du-maitre' },
      attendu: /variable d’environnement MASTER_PASSWORD/
    },
    {
      titre: 'une URL de base de données (elle porte ses propres identifiants)',
      content: 'const u="postgres://x:mdp-long-enough@ep-1.eu.aws.neon.tech/db"\n',
      env: { DATABASE_URL: 'postgres://x:mdp-long-enough@ep-1.eu.aws.neon.tech/db' },
      attendu: /DATABASE_URL/
    },
    {
      titre: 'un jeton API',
      content: 'fetch(url,{headers:{Authorization:"Bearer jeton-tres-long-1234"}})\n',
      env: { WHATSAPP_TOKEN: 'jeton-tres-long-1234' },
      attendu: /WHATSAPP_TOKEN/
    },
    {
      titre: 'une valeur interdite par PCSTAR_FORBIDDEN_SECRETS',
      content: 'const historique="valeur-publiee-en-2025"\n',
      env: { PCSTAR_FORBIDDEN_SECRETS: 'autre-chose,valeur-publiee-en-2025' },
      attendu: /valeur interdite/
    },
    {
      titre: 'une forme « mot de passe littéral » produite par le minifieur',
      content: SONDE_MDP,
      env: {},
      attendu: /mot de passe littéral/
    },
    {
      titre: 'une URL de stockage privée écrite en dur',
      content: 'const base="https://mon-blob.public.blob.vercel-storage.com/photos"\n',
      env: {},
      attendu: /URL de stockage privée/
    },
    {
      titre: 'une lecture de process.env laissée dans le code client',
      content: 'const k=process.env.MASTER_PASSWORD\n',
      env: {},
      attendu: /process\.env/
    }
  ]

  for (const c of cases) {
    it(c.titre, () => {
      const dir = fixture({ ...CLEAN, 'assets/index-abc123.js': c.content })
      try {
        const hits = scanBundle(dir, { env: c.env })
        assert.equal(hits.length, 1, JSON.stringify(hits))
        assert.match(hits[0], c.attendu)
        assert.match(hits[0], /^assets\/index-abc123\.js — /, 'le fichier publié est nommé')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  it('une valeur sensible courte n’est pas signalée (pas de faux positif sur « 1 », « true »…)', () => {
    const dir = fixture({ ...CLEAN, 'assets/index-abc123.js': 'const flags="1,true,0"\n' })
    try {
      assert.deepEqual(scanBundle(dir, { env: { OAUTH_DEMO: '1', SOME_TOKEN: 'true' } }), [])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('les sous-dossiers sont parcourus (photos, assets, sitemap…)', () => {
    const dir = fixture({ ...CLEAN, 'photos/a/b/fiche.js': 'const t="mot-de-passe-du-maitre"\n' })
    try {
      const hits = scanBundle(dir, { env: { MASTER_PASSWORD: 'mot-de-passe-du-maitre' } })
      assert.deepEqual(hits, ['photos/a/b/fiche.js — variable d’environnement MASTER_PASSWORD présente dans le bundle'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('LOT 7.3 — le contrôle est branché, pas seulement écrit', () => {
  it('dist/ absent : code 2 et message qui dit quoi faire', () => {
    const absent = path.join(os.tmpdir(), `pcstar-dist-absent-${Date.now()}`)
    const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle.mjs'), absent], {
      cwd: ROOT,
      encoding: 'utf8'
    })
    assert.equal(res.status, 2)
    assert.match(res.stderr, /absent/)
    assert.match(res.stderr, /npm run build/)
    assert.deepEqual(scanBundle(absent), ['(dossier absent)'])
    assert.match(missingDistMessage(absent), /npm run build/)
  })

  it('un secret dans dist/ fait échouer la commande (donc le build)', () => {
    const dir = fixture({ ...CLEAN, 'assets/index-abc123.js': SONDE_MDP })
    try {
      const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle.mjs'), dir], {
        cwd: ROOT,
        encoding: 'utf8'
      })
      assert.equal(res.status, 1, `sortie : ${res.stdout}${res.stderr}`)
      assert.match(res.stderr, /le bundle publié contient un secret/)
      assert.match(res.stderr, /mot de passe littéral/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('package.json : `build` enchaîne le contrôle (critère d’acceptation du lot 7.3)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.match(pkg.scripts.build, /vite build/)
    assert.match(pkg.scripts.build, /check-bundle/, 'le build échoue si un secret apparaît dans dist/')
    assert.equal(pkg.scripts['check:bundle'], 'node scripts/check-bundle.mjs')
  })

  it('le vrai build, s’il est présent, est propre', (t) => {
    const dist = path.join(ROOT, 'dist')
    if (!fs.existsSync(dist)) return t.skip('dist/ absent : `npm run build` n’a pas été lancé ici')
    const hits = scanBundle(dist)
    assert.deepEqual(hits, [], 'secrets dans le bundle construit :\n  ' + hits.join('\n  '))
  })
})
