// P4 — photoCompress : scaleToMaxDim + compressDataUrl avec canvas stubbé.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scaleToMaxDim, compressDataUrl, COMPRESS_DEFAULTS } from './photoCompress.js'

test('scaleToMaxDim : redimensionne le longest side, garde les ratios', () => {
  assert.deepEqual(scaleToMaxDim(1600, 1200, 800), { w: 800, h: 600, scale: 0.5 })
  assert.deepEqual(scaleToMaxDim(300, 1600, 800), { w: 150, h: 800, scale: 0.5 })
  assert.deepEqual(scaleToMaxDim(800, 600, 800), { w: 800, h: 600, scale: 1 })
  assert.deepEqual(scaleToMaxDim(100, 10, 800), { w: 100, h: 10, scale: 1 })
  // arrondi + borne 1 px
  assert.deepEqual(scaleToMaxDim(1, 900, 800), { w: 1, h: 800, scale: 800 / 900 })
})

function fakeEnv({ w, h } = { w: 1600, h: 1200 }) {
  const calls = { draw: [], toDataURL: null }
  return {
    calls,
    env: {
      loadImage: () => Promise.resolve({ naturalWidth: w, naturalHeight: h }),
      createCanvas: (cw, ch) => ({
        width: cw,
        height: ch,
        getContext: () => ({
          drawImage: (img, x, y, dw, dh) => calls.draw.push({ x, y, w: dw, h: dh })
        }),
        toDataURL: (type, quality) => {
          calls.toDataURL = { type, quality }
          return 'data:image/jpeg;base64,COMPRESSED'
        }
      })
    }
  }
}

test('compressDataUrl : downscale 1600×1200 → 800×600 JPEG q0.8', async () => {
  const { calls, env } = fakeEnv()
  const out = await compressDataUrl('data:image/png;base64,BIG', {}, env)
  assert.equal(out, 'data:image/jpeg;base64,COMPRESSED')
  assert.deepEqual(calls.draw, [{ x: 0, y: 0, w: 800, h: 600 }])
  assert.deepEqual(calls.toDataURL, { type: 'image/jpeg', quality: 0.8 })
})

test('compressDataUrl : image déjà ≤ maxDim → passthrough (pas de re-encodage)', async () => {
  const { calls, env } = fakeEnv({ w: 700, h: 500 })
  const out = await compressDataUrl('data:image/jpeg;base64,SMALL', {}, env)
  assert.equal(out, 'data:image/jpeg;base64,SMALL')
  assert.equal(calls.toDataURL, null)
  assert.equal(calls.draw.length, 0)
})

test('compressDataUrl : options custom respectées', async () => {
  const { calls, env } = fakeEnv({ w: 2000, h: 2000 })
  await compressDataUrl('data:image/png;base64,BIG', { maxDim: 400, quality: 0.6 }, env)
  assert.deepEqual(calls.draw, [{ x: 0, y: 0, w: 400, h: 400 }])
  assert.deepEqual(calls.toDataURL, { type: 'image/jpeg', quality: 0.6 })
})

test('compressDataUrl : échec de décodage → dataURL d’origine (upload sans compression)', async () => {
  const env = {
    loadImage: () => Promise.reject(new Error('boom')),
    createCanvas: () => {
      throw new Error('should not be called')
    }
  }
  const out = await compressDataUrl('data:image/webp;base64,XXX', {}, env)
  assert.equal(out, 'data:image/webp;base64,XXX')
})

test('compressDataUrl : non-image (chemin /photos/…) → passthrough immédiat', async () => {
  const env = {
    loadImage: () => {
      throw new Error('should not be called')
    }
  }
  const out = await compressDataUrl('/photos/uploads/abc-1.jpg', {}, env)
  assert.equal(out, '/photos/uploads/abc-1.jpg')
})

test('COMPRESS_DEFAULTS : 800 px / 0.8 / jpeg', () => {
  assert.equal(COMPRESS_DEFAULTS.maxDim, 800)
  assert.equal(COMPRESS_DEFAULTS.quality, 0.8)
  assert.equal(COMPRESS_DEFAULTS.type, 'image/jpeg')
})
