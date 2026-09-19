const API = 'http://127.0.0.1:8787'
const login = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'master@test.pcstar.local', password: 'test-master-pw' }) })).json()
const T = login.token
const put = async (body) => {
  const r = await fetch(API + '/api/master/vitrine', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify(body) })
  return { s: r.status, t: await r.text() }
}
// 1) label : 1 caractere BMP puis 48 emoji = 97 unites UTF-16, 49 points de code
const label = 'a' + '🧰'.repeat(48)
const r1 = await put({ repairsLabel: label })
const stocke = JSON.parse(r1.t).vitrine?.repairsLabel ?? ''
const units = stocke.length, points = [...stocke].length
const dernier = stocke.charCodeAt(stocke.length - 1)
const loneSurrogate = dernier >= 0xd800 && dernier <= 0xdbff
console.log('LABEL 49 points de code →', r1.s, { units, points, loneSurrogate, fin: stocke.slice(-2) })
// relus cote public (le GET /api/meta projette)
const meta = await (await fetch(API + '/api/meta')).json()
const publicLabel = meta.vitrine.repairsLabel
console.log('relu public → units', publicLabel.length, 'points', [...publicLabel].length, 'dernier code', publicLabel.charCodeAt(publicLabel.length - 1).toString(16))
// 2) ce que le navigateur rend : un caractere de remplacement ?
const rendu = publicLabel.endsWith('\uD83D\uFE70'.charAt(0))
console.log('Le dernier caractere est une moitie de paire :', rendu)
// 3) bornage par points de code attendu : 48 points de code
console.log('attendu si compte en points de code :', 'a' + '🧰'.repeat(47) === publicLabel)
// 4) booleen / tableau acceptes comme compteur
for (const v of [true, [12], '12', ' 12 ', 12.9, {}, '1e3']) {
  const r = await put({ repairsDone: v })
  const obtenu = (() => { try { return JSON.parse(r.t).vitrine?.repairsDone ?? JSON.parse(r.t).error } catch { return '?' } })()
  console.log(`repairsDone ${JSON.stringify(v)} → ${r.s} ${obtenu}`)
}
// 5) nom de produit : 61 emoji = 122 unites > NAME_LIMIT(120) refuse, 59 emoji passe puis tronque
const NAME_LIMIT = 120
for (const n of [60, 61]) {
  const r = await fetch(API + '/api/master/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify({ name: '🧰'.repeat(n), price: 1000 }) })
  const t = await r.text()
  const nom = (() => { try { return JSON.parse(t).product?.name } catch { return t.slice(0, 40) } })()
  console.log(`nom ${n} emoji (${n * 2} unites) → ${r.status} rendu=${typeof nom === 'string' ? JSON.stringify({ units: nom.length, points: [...nom].length }) : nom}`)
}
// 6) description: tranche en milieu de paire ?
const r6 = await fetch(API + '/api/master/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify({ name: 'sonde', price: 1000, description: 'a' + '🧰'.repeat(500) }) })
const d = JSON.parse(await r6.text()).product?.description ?? ''
const dc = d.charCodeAt(d.length - 1)
console.log('description → units', d.length, 'point coupe seul ?', dc >= 0xd800 && dc <= 0xdbff)
process.exit(0)
