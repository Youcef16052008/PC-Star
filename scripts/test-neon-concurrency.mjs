#!/usr/bin/env node
import assert from 'node:assert/strict'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
// Ce test écrit réellement une réservation. Une branche Neon de PR est sûre;
// une DATABASE_URL de production ne l'est pas, même si le finally tente de
// restaurer le stock. L'opt-in protège les copier-coller hors CI.
if (process.env.PCSTAR_NEON_TEST_ISOLATED !== '1') {
  console.error('Refusing to mutate a shared Neon database. Set PCSTAR_NEON_TEST_ISOLATED=1 on an ephemeral branch only.')
  process.exit(2)
}

const { readDbAsync, updateDbAsync } = await import('../server/db.js')
const { placeOrder } = await import('../server/catalog.js')
const productId = 'mousepad'
let hadStock = false
let originalStock
const createdCodes = new Set()

await updateDbAsync((db) => {
  db.stock ||= {}
  hadStock = Object.prototype.hasOwnProperty.call(db.stock, productId)
  originalStock = db.stock[productId]
  db.stock[productId] = 1
  return db
})

const body = (email) => ({
  name: email,
  email,
  phone: '0550123456',
  wilaya: 'Oran',
  slot: '16:00',
  day: '2099-01-01',
  items: [{ id: productId, qty: 1, price: 1 }]
})

let results
try {
  results = await Promise.all(
    ['concurrency-a@test.invalid', 'concurrency-b@test.invalid'].map(async (email) => {
      let result
      await updateDbAsync((db) => {
        result = placeOrder(db, body(email), { userId: email })
        return db
      })
      if (result?.order?.code) createdCodes.add(result.order.code)
      return result
    })
  )

  console.log('Concurrent reservation results:', JSON.stringify(results))
  const accepted = results.filter((r) => r?.ok).length
  assert.equal(accepted, 1, JSON.stringify(results))
  const finalDb = await readDbAsync()
  assert.equal(finalDb.stock[productId], 0)
  console.log('NEON CONCURRENCY OK: exactly one reservation accepted; stock=0')
} finally {
  // Ne retire que nos commandes (codes réellement retournés), jamais une
  // éventuelle commande légitime planifiée au même jour. Le garde ci-dessus
  // reste indispensable : restaurer une valeur de stock pourrait sinon écraser
  // une écriture concurrente sur une base partagée.
  await updateDbAsync((db) => {
    db.stock ||= {}
    if (hadStock) db.stock[productId] = originalStock
    else delete db.stock[productId]
    if (Array.isArray(db.orders) && createdCodes.size) {
      db.orders = db.orders.filter((order) => !createdCodes.has(order?.code))
    }
    return db
  }).catch(() => {})
}
