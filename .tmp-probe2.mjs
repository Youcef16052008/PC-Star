const API = 'http://127.0.0.1:8787'
const j = async (method, path, body, token) => {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  })
  const t = await res.text()
  return { s: res.status, b: t.slice(0, 200).replace(/\s+/g, ' '), full: t, h: Object.fromEntries([...res.headers].filter(([k]) => /retry-after|content-disp/i.test(k))) }
}
const login = await j('POST', '/api/auth/login', { email: 'master@test.pcstar.local', password: 'test-master-pw' })
const parsed = JSON.parse(login.full)
const token = parsed.token ?? parsed.data?.token
const T = token || null
const out = []
const show = (n, r) => out.push(`${n.padEnd(40)} → ${r.s} ${r.b}${Object.keys(r.h).length ? ' HDR ' + JSON.stringify(r.h) : ''}`)

show('login master', { s: login.s, b: login.b.slice(0, 60), h: {} })
out.push(`(jeton ${T ? 'obtenu' : 'ABSENT'})`)

// --- vitrine
show('vitrine emoji 48 graphemes', await j('PUT', '/api/master/vitrine', { repairsLabel: '🧰'.repeat(48), repairsDone: 0 }, T))
show('vitrine label 49eme car', await j('PUT', '/api/master/vitrine', { repairsLabel: 'x'.repeat(49), repairsDone: 5 }, T))
show('vitrine count 1e309', await j('PUT', '/api/master/vitrine', { repairsDone: 1e309 }, T))
show('vitrine count -0', await j('PUT', '/api/master/vitrine', { repairsDone: -0 }, T))
show('vitrine count "12abc"', await j('PUT', '/api/master/vitrine', { repairsDone: '12abc' }, T))
show('vitrine count true', await j('PUT', '/api/master/vitrine', { repairsDone: true }, T))
show('vitrine readyTally ecrit', await j('PUT', '/api/master/vitrine', { readyTally: 9999 }, T))
show('vitrine proto', await j('PUT', '/api/master/vitrine', JSON.parse('{"repairsDone":3,"__proto__":{"poison":1}}'), T))
show('meta apres vitrine', await j('GET', '/api/meta'))
show('pollution verifiee', { s: ({}).poison === undefined ? 200 : 999, b: `poison sur Object.prototype = ${({}).poison}`, h: {} })

// --- panneaux
show('panneaux id __proto__', await j('PUT', '/api/master/panels', { extraPanels: [{ id: '__proto__', name: 'p' }] }, T))
show('panneaux 5000 entrees', await j('PUT', '/api/master/panels', { extraPanels: Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}`, name: `n${i}` })) }, T))
show('panneaux ids dupliques', await j('PUT', '/api/master/panels', { extraPanels: [{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }] }, T))
show('panneaux hidden inconnu', await j('PUT', '/api/master/panels', { hiddenPanelIds: ['napane'] }, T))
show('panneaux nom non chaine', await j('PUT', '/api/master/panels', { extraPanels: [{ id: 'x1', name: { toString: 1 } }] }, T))
show('panneaux relus', await j('GET', '/api/meta'))

// --- produits
const produits = await j('GET', '/api/master/products', undefined, T)
show('liste produits maitre', produits)
let id0 = null
try { const o = JSON.parse(produits.full); id0 = (o.products || o.items || o.masterProducts || [])[0]?.id } catch {}
id0 = id0 || 'cpu-7800x3d'
show('edition stock -3', await j('PUT', `/api/master/products/${id0}`, { stock: -3 }, T))
show('edition prix 0', await j('PUT', `/api/master/products/${id0}`, { price: 0 }, T))
show('edition prix 1e999', await j('PUT', `/api/master/products/${id0}`, { price: 1e999 }, T))
show('edition id neuf', await j('PUT', `/api/master/products/${id0}`, { id: 'CPU-2026!/' }, T))
show('creation doublon id', await j('POST', '/api/master/products', { id: id0, name: 'N', price: 1000, stock: 1 }, T))
show('creation nom 200k', await j('POST', '/api/master/products', { id: 'zz-1', name: 'N'.repeat(200000), price: 1000, stock: 1 }, T))
show('creation sockets 10k', await j('POST', '/api/master/products', { id: 'zz-2', name: 'N', price: 1000, sockets: Array(10000).fill('LGA1700') }, T))

// --- commande + stock + transitions
const cat = await j('GET', '/api/catalog')
let prod = null
try { prod = JSON.parse(cat.full).products[0] } catch {}
const q = prod?.stock ?? 1
show(`stock initial ${id0}`, { s: 200, b: `${prod?.id} stock=${q} prix=${prod?.price}`, h: {} })
const commande = { name: "=HYPERLINK(\"=1+1\")\r\nAli", phone: '0550123456', wilaya: 'Oran', items: [{ id: prod.id, qty: 1 }], notes: 'a,b"c\r\n=danger' }
const o1 = await j('POST', '/api/orders', commande)
show('commande valide', o1)
let code = null
try { const o = JSON.parse(o1.full); code = o.order?.code ?? o.code ?? o.idOrder } catch {}
show(`transition new->ready (${code})`, await j('PATCH', `/api/orders/${code}`, { status: 'ready' }, T))
show(`transition new->picked`, await j('PATCH', `/api/orders/${code}`, { status: 'picked' }, T))
show(`transition picked->ready`, await j('PATCH', `/api/orders/${code}`, { status: 'ready' }, T))
show(`meta apres ready`, await j('GET', '/api/meta'))
show(`readyTally ne double pas (re-ready)`, await j('PATCH', `/api/orders/${code}`, { status: 'ready' }, T))
show(`meta apres re-ready`, await j('GET', '/api/meta'))
const csv = await j('GET', '/api/orders/export.csv', undefined, T)
out.push(`CSV export → ${csv.s} | ${csv.b.slice(0, 190)}`)
console.log(out.join('\n'))
