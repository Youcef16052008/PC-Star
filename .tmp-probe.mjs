// Sonde : 60 entrees mechantes contre l'API locale, statut + corps.
const API = process.env.PROBE_API || 'http://127.0.0.1:8787'
const cases = []
const add = (name, method, path, body, headers = {}) => cases.push({ name, method, path, body, headers })

add('sante', 'GET', '/api/health')
add('journee impossible', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', pickupDate: '2026-02-31', items: [{ sku: 'CPU-1', qty: 1 }] })
add('journee future lointaine', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', pickupDate: '9999-12-31', items: [{ sku: 'CPU-1', qty: 1 }] })
add('qty infini', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'CPU-1', qty: 1e309 }] })
add('qty negatif', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'CPU-1', qty: -5 }] })
add('qty chaine', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'CPU-1', qty: '12' }] })
add('items vide', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [] })
add('proto pollution', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'CPU-1', qty: 1 }], __proto__: { polluted: 1 } })
add('notes enormes', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', notes: 'x'.repeat(200000), items: [{ sku: 'CPU-1', qty: 1 }] })
add('nom avec CRLF', 'POST', '/api/orders', { name: 'A\r\nB', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'CPU-1', qty: 1 }] })
add('wilaya inconnue', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Mars', items: [{ sku: 'CPU-1', qty: 1 }] })
add('sku inconnu', 'POST', '/api/orders', { name: 'A', phone: '0550123456', wilaya: 'Oran', items: [{ sku: 'NIMP', qty: 1 }] })
add('statut inconnu', 'PATCH', '/api/orders/PS-20260101-1', { status: 'vole' })
add('code inconnu', 'PATCH', '/api/orders/inexistant', { status: 'ready' })
add('code avec slash', 'PATCH', '/api/orders/..%2F..%2Fetc', { status: 'ready' })
add('recherche regex', 'GET', '/api/catalog?q=%28%29%5B%2B*')
add('recherche vide', 'GET', '/api/catalog?q=')
add('page zero', 'GET', '/api/catalog?page=0')
add('page negative', 'GET', '/api/catalog?page=-3')
add('page infini', 'GET', '/api/catalog?page=1e309')
add('page flottant', 'GET', '/api/catalog?page=2.7')
add('taille zero', 'GET', '/api/catalog?pageSize=0')
add('taille enorme', 'GET', '/api/catalog?pageSize=100000')
add('prix NaN', 'GET', '/api/catalog?minPrice=abc&maxPrice=def')
add('tri inconnu', 'GET', '/api/catalog?sort=potato')
add('marque avec &', 'GET', '/api/catalog?brand=AMD%26Intel')
add('login vide', 'POST', '/api/auth/login', {})
add('login CRLF', 'POST', '/api/auth/login', { email: 'a\r\n@example.com', password: 'x' })
add('meta public', 'GET', '/api/meta')
add('meta projetee', 'GET', '/api/meta', null, {})
add('panneaux sans jeton', 'PUT', '/api/master/panels', { panels: { a: 1 } })
add('vitrine sans jeton', 'PUT', '/api/master/vitrine', { label: 'x' })
add('config carte', 'GET', '/api/map/config')
add('clients sans jeton', 'GET', '/api/customers')
add('csv sans jeton', 'GET', '/api/orders/export.csv')
add('blob inconnu', 'GET', '/photos/../server/index.js')
add('blob encod', 'GET', '/photos/%2e%2e%2fserver%2findex.js')
add('sante', 'GET', '/api/health')

const out = []
for (const c of cases) {
  const t0 = Date.now()
  let line
  try {
    const res = await fetch(API + c.path, {
      method: c.method,
      headers: { 'Content-Type': 'application/json', ...c.headers },
      body: c.body === undefined || c.body === null ? undefined : JSON.stringify(c.body)
    })
    const text = await res.text()
    line = `${res.status} ${String(text).slice(0, 110).replace(/\s+/g, ' ')}`
  } catch (e) {
    line = `THROW ${String(e.message).slice(0, 90)}`
  }
  out.push(`${String(Date.now() - t0).padStart(5)}ms  ${c.name.padEnd(22)} ${c.method} ${c.path.slice(0, 34).padEnd(34)} → ${line}`)
}
console.log(out.join('\n'))
