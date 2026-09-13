/**
 * P16 (#21) — lance l'API et Vite ensemble, proprement.
 *
 * `"dev:all": "node server/index.js & vite"` posait trois problèmes :
 *  - le `&` renvoie immédiatement le shell : `npm run dev:all` « réussit » même
 *    si l'API meurt au démarrage ;
 *  - Ctrl-C ne tuait pas le process API (orphelin qui garde le port 8787) ;
 *  - la sortie des deux process s'entrelaçait sans préfixe.
 *
 * Ici : les deux sont des enfants, leur sortie est préfixée, et le premier qui
 * meurt entraîne l'autre (avec le bon code de sortie).
 */
import { spawn } from 'node:child_process'

const TARGETS = [
  { name: 'api', color: '\x1b[36m', cmd: process.execPath, args: ['server/index.js'] },
  { name: 'web', color: '\x1b[35m', cmd: 'npx', args: ['vite'] }
]

const kids = []
let shuttingDown = false

function prefix(name, color) {
  return (chunk) => {
    const text = String(chunk).replace(/\n$/, '')
    for (const line of text.split('\n')) process.stdout.write(`${color}[${name}]\x1b[0m ${line}\n`)
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const k of kids) {
    try {
      k.kill('SIGTERM')
    } catch {
      /* déjà mort */
    }
  }
  setTimeout(() => process.exit(code), 300).unref?.()
}

for (const t of TARGETS) {
  const kid = spawn(t.cmd, t.args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  kid.stdout.on('data', prefix(t.name, t.color))
  kid.stderr.on('data', prefix(t.name, t.color))
  kid.on('error', (err) => {
    process.stdout.write(`${t.color}[${t.name}]\x1b[0m impossible de démarrer : ${err.message}\n`)
    shutdown(1)
  })
  kid.on('exit', (code, signal) => {
    process.stdout.write(`${t.color}[${t.name}]\x1b[0m terminé (code=${code} signal=${signal})\n`)
    shutdown(typeof code === 'number' && code !== 0 ? code : 0)
  })
  kids.push(kid)
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0))
