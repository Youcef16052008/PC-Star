const API = 'http://127.0.0.1:8787'
const login = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'master@test.pcstar.local', password: 'test-master-pw' }) })).json()
const T = login.token
const EMOJI = '\u{1F9F0}'
const put = async (body) => {
  const r = await fetch(API + '/api/master/vitrine', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify(body) })
  const t = await r.text()
  let o = null; try { o = JSON.parse(t) } catch {}
  return { s: r.status, o, t }
}
const ligne = (nom, r) => {
  const v = r.o?.vitrine
  const l = v?.repairsLabel
  const units = l == null ? null : l.length
  const pts = l == null ? null : [...l].length
  const d = l ? l.charCodeAt(l.length - 1) : 0
  const orphelin = (d >= 0xd800 && d <= 0xdbff) || (d >= 0xdc00 && d <= 0xdfff)
  return `${nom.padEnd(34)} → ${r.s} ${r.s === 200 ? `label=${pts} pts / ${units} unites, derniere moitie de paire: ${orphelin}, valeur=${JSON.stringify(r.o.vitrine?.repairsDone)}` : JSON.stringify(r.o)}`
}
console.log(ligne('libelle « a » + 48 emoji (49 car.)', await put({ repairsLabel: 'a' + EMOJI.repeat(48), repairsDone: 7 })))
console.log(ligne('libelle 60 emoji (borne 48)', await put({ repairsLabel: EMOJI.repeat(60) })))
console.log(ligne('libelle avec moitie de paire deja la', await put({ repairsLabel: JSON.parse('"x\\ud83e"') })))
console.log(ligne('compteur true', await put({ repairsDone: true })))
console.log(ligne('compteur [12]', await put({ repairsDone: [12] })))
console.log(ligne("compteur '1e3'", await put({ repairsDone: '1e3' })))
console.log(ligne('compteur 1e9 (au-dessus plafond)', await put({ repairsDone: 1e9 })))
console.log(ligne("compteur '12'", await put({ repairsDone: '12' })))
console.log(ligne('compteur 12.9', await put({ repairsDone: 12.9 })))
console.log(ligne('compteur -5', await put({ repairsDone: -5 })))
// relire cote public : ce que voit un visiteur
const meta = await (await fetch(API + '/api/meta')).json()
const pub = meta.vitrine.repairsLabel
const du = pub.charCodeAt(pub.length - 1)
console.log('GET /api/meta (public) →', JSON.stringify({ label: pub, points: [...pub].length, moitieDePaireFin: (du >= 0xd800 && du <= 0xdbff) || (du >= 0xdc00 && du <= 0xdfff), repairsDone: meta.vitrine.repairsDone }))
// et le fichier de base, tel qu'il est ecrit sur disque
const fs = await import('node:fs')
const brut = fs.readFileSync('/tmp/pcstar-sonde-p5/store.json', 'utf8')
const dansBase = JSON.parse(brut).meta.vitrine.repairsLabel
console.log('store.json →', JSON.stringify({ repairsLabel: dansBase, points: [...dansBase].length }))
// commande : un nom de 33 emoji doit passer (66 unites > 64 avant le correctif)
const cat = await (await fetch(API + '/api/catalog')).json()
const p = cat.products.find(x => (x.stock ?? 0) > 2)
const com = await fetch(API + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: EMOJI.repeat(33), phone: '0550123456', wilaya: 'Oran', items: [{ id: p.id, qty: 1 }] }) })
const comu = await com.json()
console.log('commande, nom 33 emoji →', com.status, JSON.stringify({ nom: comu.order?.name?.length ? [...comu.order.name].length : null, code: comu.order?.code ?? comu.error }))
// produit : 60 emoji dans le nom = 120 unites = 60 caracteres -> accepte entier
const prod = await fetch(API + '/api/master/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify({ name: EMOJI.repeat(60), price: 1000, brand: EMOJI.repeat(80) }) })
const pr = await prod.json()
console.log('produit nom 60 emoji, marque 80 →', prod.status, JSON.stringify({ nomPts: [...(pr.product?.name ?? '')].length, marquePts: [...(pr.product?.brand ?? '')].length, marqueOrpheline: (pr.product?.brand ?? '').charCodeAt(([...(pr.product?.brand ?? '')].length) - 1) }))
