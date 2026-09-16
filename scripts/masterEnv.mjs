/**
 * LOT 1.2 — identifiants maître pour les scripts qui parlent à une API réelle
 * (`npm run smoke`, crawl d'audit, vérification live).
 *
 * Ces scripts s'authentifiaient auparavant avec un couple e-mail / mot de passe
 * **codé en dur**, le même que celui qui était livré dans le bundle public. Ils
 * le lisent désormais dans l'environnement, comme le serveur.
 *
 * Usage :
 *   MASTER_EMAIL=… MASTER_PASSWORD=… npm run smoke
 * ou via un `.env` à la racine (chargé par `server/env.js`).
 */
import { loadEnv } from '../server/env.js'

// `.env` / `.env.local` si présents — sans jamais écraser de vraies variables.
loadEnv()

/**
 * @returns {{email: string, password: string}}
 * Termine le process avec un message lisible si les variables manquent : un
 * script de recette qui échoue au login sans dire pourquoi fait perdre du temps.
 */
export function masterCredentials(scriptName = 'script') {
  const email = String(process.env.MASTER_EMAIL || '').trim()
  const password = String(process.env.MASTER_PASSWORD || '')
  if (!email || !password) {
    console.error(
      `\n[${scriptName}] MASTER_EMAIL et MASTER_PASSWORD sont obligatoires.\n` +
        '  · posés dans l’environnement, ou dans un .env à la racine du dépôt\n' +
        '  · ce sont les mêmes valeurs que celles du serveur (server/db.js)\n' +
        '  · aucun identifiant n’est codé en dur dans ce dépôt\n'
    )
    process.exit(1)
  }
  return { email, password }
}

/**
 * LOT 1.19 — identifiants d'un compte de démonstration, pour les mêmes scripts.
 *
 * Contrairement au maître, ces comptes sont **facultatifs** : sans
 * `DEMO_PASSWORD`, le serveur les seed verrouillés (`passwordHash: null`) et un
 * login répond 401 `demo_locked`. La recette doit alors créer son propre compte
 * jetable plutôt que d'échouer — d'où un `null` au lieu d'une sortie brutale.
 *
 * @returns {{email: string, password: string} | null} `null` si la variable est
 * absente (comptes verrouillés) — l'appelant bascule sur un compte jetable.
 */
export function demoCredentials(scriptName = 'script', email = 'karim.oran@demo.dz') {
  const password = String(process.env.DEMO_PASSWORD || '')
  if (!password) {
    console.log(
      `[${scriptName}] DEMO_PASSWORD absent : les comptes de démonstration sont verrouillés\n` +
        '  · état voulu (lot 1.19) — aucune valeur publiée ne doit ouvrir de session\n' +
        '  · la recette crée donc son propre client jetable via /api/auth/register\n'
    )
    return null
  }
  return { email, password }
}

export default masterCredentials
