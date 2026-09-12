#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readDbAsync, updateDbAsync } from '../server/db.js'
import { placeOrder } from '../server/catalog.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const productId = 'mousepad'
await updateDbAsync((db) => {
  db.stock[productId] = 1
  db.orders = []
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

const results = await Promise.all(
  ['concurrency-a@test.invalid', 'concurrency-b@test.invalid'].map(async (email) => {
    let result
    await updateDbAsync((db) => {
      result = placeOrder(db, body(email), { userId: email })
      return db
    })
    return result
  })
)

assert.equal(results.filter((r) => r?.ok).length, 1, JSON.stringify(results))
const finalDb = await readDbAsync()
assert.equal(finalDb.stock[productId], 0)
console.log('NEON CONCURRENCY OK: exactly one reservation accepted; stock=0')
