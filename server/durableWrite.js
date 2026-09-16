/**
 * LOT 8.7 (A7) — écriture **durable**, pas seulement atomique.
 *
 * Le couple « tmp puis rename » (lot 3.2 / B2) garantit qu'un crash ne laisse
 * jamais un `store.json` à moitié écrit : le rename est atomique sur un même
 * système de fichiers. Mais il ne garantit pas la **durabilité** — sans `fsync`
 * sur le fichier temporaire avant le rename, une coupure d'alimentation peut
 * publier un nom dont les blocs de données ne sont jamais arrivés au disque :
 * au remontage, `store.json` est vide ou tronqué. Le dépôt sait le détecter
 * (`quarantineCorrupt` → `store.json.corrupt-<horodatage>`) et restaurer le
 * dernier backup, donc la conséquence n'est pas un crash mais une **perte de
 * données** : tout ce qui a été écrit depuis le dernier backup disparaît.
 *
 * Deux `fsync` ferment la fenêtre :
 *  1. sur le **fichier** temporaire, avant le rename — les octets sont au
 *     disque quand le nom devient visible ;
 *  2. sur le **répertoire**, après le rename — l'entrée de répertoire elle-même
 *     est durable (sinon un renommage peut être perdu au remontage, et on
 *     revient à l'ancien contenu).
 *
 * Le second est **non bloquant** : certains systèmes ne permettent pas d'ouvrir
 * un répertoire en lecture (Windows) ou refusent le `fsync` dessus (`EINVAL`
 * sur certains FS réseau). Un échec là ne doit jamais faire échouer une
 * écriture de base — l'essentiel (1) est déjà acquis.
 *
 * Contrepartie assumée : un appel système de plus par écriture (quelques
 * millisecondes), sur un chemin déjà sérialisé par le verrou `store.json.lock`.
 *
 * `fs` est **injectable** : la durabilité ne se teste pas en débranchant la
 * machine, mais en vérifiant l'ordre des appels — `fsync` doit précéder
 * `rename`, sinon la garantie ne vaut rien.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Écrit `text` dans `file` puis force les octets au disque.
 *
 * @param {string} file chemin cible (créé ou écrasé)
 * @param {string} text contenu
 * @param {{ fs?: object }} [opts] `fs` injectable (tests)
 * @returns {boolean} `true` si le fsync a bien été appelé
 */
export function durableWriteFileSync(file, text, opts = {}) {
  const f = opts.fs || fs
  const fd = f.openSync(file, 'w')
  let synced = false
  try {
    f.writeSync(fd, text)
    if (typeof f.fsyncSync === 'function') {
      f.fsyncSync(fd)
      synced = true
    }
  } finally {
    f.closeSync(fd)
  }
  return synced
}

/**
 * Rend durable l'entrée de répertoire qui pointe vers `file`.
 *
 * Jamais bloquant : un FS qui refuse le fsync de répertoire ne doit pas faire
 * échouer l'écriture — la donnée, elle, est déjà au disque.
 *
 * @param {string} dir répertoire
 * @param {{ fs?: object }} [opts] `fs` injectable (tests)
 * @returns {boolean} `true` si le répertoire a pu être fsync
 */
export function fsyncDirSync(dir, opts = {}) {
  const f = opts.fs || fs
  try {
    const fd = f.openSync(dir, 'r')
    try {
      if (typeof f.fsyncSync === 'function') f.fsyncSync(fd)
    } finally {
      f.closeSync(fd)
    }
    return true
  } catch {
    // Windows (EISDIR/EPERM), FS réseau (EINVAL)… : non bloquant.
    return false
  }
}

/**
 * Écriture atomique **et** durable : tmp → fsync → rename → fsync du répertoire.
 *
 * @param {string} file chemin final
 * @param {string} text contenu
 * @param {{ tmp?: string, fs?: object }} [opts] `tmp` (défaut `<file>.tmp`), `fs` injectable
 * @returns {{ synced: boolean, dirSynced: boolean }} ce qui a pu être forcé
 */
export function atomicDurableWriteFileSync(file, text, opts = {}) {
  const f = opts.fs || fs
  const tmp = opts.tmp || `${file}.tmp`
  const synced = durableWriteFileSync(tmp, text, { fs: f })
  f.renameSync(tmp, file)
  const dirSynced = fsyncDirSync(path.dirname(file), { fs: f })
  return { synced, dirSynced }
}
