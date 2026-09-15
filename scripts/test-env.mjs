/**
 * LOT 7.1 — isolation de la suite de tests vis-à-vis de l'environnement.
 *
 * Constat (vérifié, rapport d'audit item #53) : les tests serveur isolaient la
 * base fichier (`PCSTAR_DATA_DIR`) mais jamais `DATABASE_URL`. Or `server/db.js`
 * bifurque sur cette variable : avec un `.env` local pointant sur une base Neon
 * morte, `src/apiServer.test.js` échouait sur **17 tests** alors que la logique
 * testée était correcte.
 *
 * `server/env.js` charge `.env` / `.env.local` au démarrage, mais **n'écrase
 * jamais** une variable déjà présente dans `process.env`. Ce module exploite
 * cette règle : il pose des valeurs de test AVANT le chargement du `.env`, donc
 * les valeurs du développeur (ou de la CI) ne peuvent plus fuiter dans la suite.
 *
 * Chargé par `node --import ./scripts/test-env.mjs` (voir le script `test` de
 * package.json), donc avant tout fichier de test — y compris ceux qui importent
 * `server/db.js` de manière statique. Idempotent : sans effet si les valeurs
 * attendues sont déjà en place.
 */

/** Identifiants maître de TEST — non secrets, jamais utilisés en production. */
export const TEST_MASTER_EMAIL = 'master@test.pcstar.local'
export const TEST_MASTER_PASSWORD = 'test-master-pw'

/**
 * Pose une valeur — même vide. `server/env.js:loadEnv` n'applique le `.env`
 * que si `process.env[key] === undefined` : une simple **suppression** laisserait
 * donc le `.env` du développeur repasser par-dessus au chargement du serveur.
 * Une chaîne vide est « définie » (le `.env` est ignoré) tout en restant falsy
 * pour les tests du serveur (`process.env.DATABASE_URL ? 'neon' : 'file'`).
 */
function pin(key, value) {
  process.env[key] = value
}

export function setupTestEnv() {
  // 1. Base de données : la suite tourne sur le driver FICHIER. Un test qui a
  //    besoin de simuler Neon (apiDegraded.test.js) pose sa propre valeur
  //    ensuite — et c'est bien une valeur de test, pas un `.env` qui fuit.
  pin('DATABASE_URL', '')

  // 2. Services externes désactivés : pas d'appel réel pendant les tests.
  pin('BLOB_READ_WRITE_TOKEN', '')
  pin('BLOB_STORE_ID', '')
  pin('WHATSAPP_TOKEN', '')
  pin('WHATSAPP_PHONE_NUMBER_ID', '')
  pin('OAUTH_DEMO', '1')

  // 3. Origines : vides, et AUCUNE valeur par défaut. `FRONT_ORIGIN` tombe en
  //    cascade sur `FRONT_URL` puis `VERCEL_URL` (server/index.js:62-67) : en
  //    poser une ici ferait mentir les tests qui vérifient l'absence d'en-tête
  //    CORS (hardening.test.js:246). Chaque test qui a besoin d'une origine la
  //    pose explicitement (securityFixes.test.js:19).
  pin('FRONT_ORIGIN', '')
  pin('FRONT_URL', '')
  pin('OAUTH_REDIRECT_BASE', '')
  pin('VERCEL_URL', '')

  // 4. Compte maître : obligatoire depuis le LOT 1.1 — le serveur refuse de
  //    démarrer sans lui (plus de valeur par défaut codée en dur).
  pin('MASTER_EMAIL', TEST_MASTER_EMAIL)
  pin('MASTER_PASSWORD', TEST_MASTER_PASSWORD)

  // 5. Reverse proxy / plateforme : jamais supposés en test (sinon
  //    `X-Forwarded-For` devient forgeable et le rate-limit contournable, et
  //    `VERCEL` ferait basculer les chemins de données vers `/tmp`).
  pin('TRUST_PROXY', '')
  pin('VERCEL', '')
}

setupTestEnv()
