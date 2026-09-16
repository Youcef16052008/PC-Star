import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 8.8 (A8) — dates et prix : UNE règle de locale, dérivée de la langue.
//
// Le défaut : la même donnée était rendue différemment selon l'écran.
//  · `DeskPage.formatAt()` localisait selon la langue (`ar-DZ` / `fr-DZ` /
//    `en-GB`) ;
//  · `OrdersPage` appelait `new Date(o.at).toLocaleString()` **sans locale** →
//    celle du NAVIGATEUR. En mode arabe, le comptoir affichait une date en
//    `ar-DZ` et « Mes commandes » une date `fr-FR`/`en-US` : deux formats pour
//    la même commande, à quelques écrans d'écart ;
//  · `money()` figeait `fr-DZ` quelle que soit la langue, alors que les filtres
//    de prix arabes disent « دج » ;
//  · `src/notify.js` recopiait `${total.toLocaleString('fr-DZ')} DA` à la main.
//
// Comme pour `stockLabel.js` (lot 6.1), tout est réuni dans `src/format.js`.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'CustomEvent',
  'FileReader',
  'getComputedStyle'
]) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: OrdersPage } = await import('./OrdersPage.jsx')
const { default: DeskPage } = await import('./DeskPage.jsx')
const { dict } = await import('./i18n.js')
const { saveLang, saveOrders } = await import('./prefs.js')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')
const F = await import('./format.js')
const dataMod = await import('./data.js')
const { buildWaMessage } = await import('./orderLogic.js')
const { t: translate } = await import('./i18n.js')
const { notifyNewOrder } = await import('./notify.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const t = (key, vars) => {
  let s = dict.fr[key] ?? key
  Object.entries(vars || {}).forEach(([k, v]) => {
    s = s.replaceAll(`{${k}}`, String(v))
  })
  return s
}
const clean = (el) => (typeof el === 'string' ? el : el?.textContent || '').replace(/\s+/g, ' ').trim()

async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(120)
  return {
    host,
    text: () => clean(host),
    unmount: async () => {
      root.unmount()
      host.remove()
      await settle(30)
    }
  }
}

// Un horodatage fixe : la comparaison entre écrans n'a de sens que sur la même
// valeur, et un `Date.now()` rendrait les assertions instables.
const AT = '2026-09-16T10:30:00.000Z'

before(() => {
  resetSafeStorage(window)
  window.localStorage.clear()
  saveLang(safeStorage, 'fr')
  globalThis.fetch = async () => {
    throw new TypeError('offline (test)')
  }
  window.fetch = globalThis.fetch
})

after(async () => {
  await settle(60)
})

/* ------------------------------ format.js ------------------------------- */

describe('8.8 (A8) — une seule table de locales, dérivée de la langue', () => {
  it('normalizeLang ramène toute entrée à une langue connue', () => {
    assert.equal(F.normalizeLang('ar'), 'ar')
    assert.equal(F.normalizeLang('fr'), 'fr')
    assert.equal(F.normalizeLang('en'), 'en')
    assert.equal(F.normalizeLang('fr-DZ'), 'fr', 'une forme longue est acceptée')
    assert.equal(F.normalizeLang('AR'), 'ar', 'la casse ne compte pas')
    assert.equal(F.normalizeLang(' ar '), 'ar', 'les espaces non plus')
    assert.equal(F.normalizeLang(undefined), F.DEFAULT_LANG, 'langue absente → défaut')
    assert.equal(F.normalizeLang('de'), F.DEFAULT_LANG, 'langue non supportée → défaut, pas une locale inventée')
    assert.equal(F.normalizeLang(''), F.DEFAULT_LANG)
  })

  it('localeFor couvre exactement les trois langues de l’interface', () => {
    assert.deepEqual(Object.keys(F.LOCALES).sort(), ['ar', 'en', 'fr'])
    assert.equal(F.localeFor('ar'), 'ar-DZ')
    assert.equal(F.localeFor('fr'), 'fr-DZ')
    assert.equal(F.localeFor('en'), 'en-GB')
    assert.equal(F.localeFor('zh'), 'fr-DZ', 'repli sur le défaut, jamais `undefined`')
  })

  it('le suffixe monétaire suit la langue, comme les libellés i18n existants', () => {
    assert.equal(F.currencyFor('fr'), 'DA')
    assert.equal(F.currencyFor('en'), 'DA')
    assert.equal(F.currencyFor('ar'), 'دج')
    // Cohérence avec le dictionnaire arabe, qui écrit déjà « دج ».
    assert.match(dict.ar.price_u15, /دج/, 'les filtres de prix arabes disent « دج »')
  })
})

describe('8.8 (A8) — money() localise le nombre ET le suffixe', () => {
  it('les trois langues donnent trois rendus distincts', () => {
    const fr = F.money(97000, 'fr')
    const ar = F.money(97000, 'ar')
    const en = F.money(97000, 'en')
    assert.equal(fr.replace(/\s/g, ''), '97000DA')
    assert.equal(ar, '97.000 دج')
    assert.equal(en, '97,000 DA')
    assert.notEqual(fr, ar, 'le mode arabe ne rend plus le format français')
    assert.notEqual(fr, en, 'le mode anglais non plus')
  })

  it('sans langue, le français reste le défaut (huit appelants historiques)', () => {
    assert.equal(F.money(97000), F.money(97000, 'fr'), 'money(n) === money(n, "fr")')
    assert.equal(F.money(1500), '1 500 DA'.replace(' ', /\s/.exec(F.money(1500))[0]), 'groupement français')
  })

  it('P16 conservé : un prix absent ou cassé affiche un tiret, jamais « NaN »', () => {
    for (const bad of [undefined, 'abc', NaN, Infinity * 0]) {
      assert.equal(F.money(bad), '— DA', `money(${String(bad)})`)
      assert.equal(F.money(bad, 'ar'), '— دج', `money(${String(bad)}, ar)`)
    }
    assert.doesNotMatch(F.money(undefined), /NaN/)
    // Un prix valide reste arrondi, comme avant.
    assert.equal(F.money(99.6, 'en').replace(/[^\d]/g, ''), '100')
  })

  it('`null` reste converti en 0 — sémantique ANTÉRIEURE, volontairement inchangée', () => {
    // `Number(null) === 0`, donc `money(null)` rend « 0 DA » depuis P16. A8 ne
    // change que la locale, pas ce qui est considéré comme un prix invalide :
    // le figer ici évite qu'un futur correctif modifie un affichage de prix
    // sans le dire. (Un `null` en base est déjà traité en amont : A2 refuse une
    // ligne dont le prix de référence est inconnu.)
    assert.equal(F.money(null), '0 DA')
    assert.equal(F.money(null, 'ar'), '0 دج')
  })

  it('third() suit la même locale', () => {
    assert.equal(F.third(90000, 'ar'), '30.000 دج')
    assert.equal(F.third(90000), F.money(30000), 'défaut français')
  })

  it('src/data.js ré-exporte la MÊME fonction (pas de seconde définition)', () => {
    assert.equal(dataMod.money, F.money, 'money de data.js === money de format.js')
    assert.equal(dataMod.third, F.third, 'third aussi')
    const src = readFileSync('src/data.js', 'utf8')
    assert.match(src, /export \{ money, third \} from '\.\/format\.js'/, 'ré-export explicite')
    assert.doesNotMatch(src, /toLocaleString/, 'plus de formatage local dans data.js')
  })
})

describe('8.8 (A8) — formatDateTime() est défensif comme l’était DeskPage', () => {
  it('valeur absente → chaîne vide (pas « Invalid Date »)', () => {
    assert.equal(F.formatDateTime(null), '')
    assert.equal(F.formatDateTime(undefined), '')
    assert.equal(F.formatDateTime(''), '')
  })

  it('date invalide → la valeur brute, pour qu’un horodatage cassé se voie', () => {
    assert.equal(F.formatDateTime('pas-une-date', 'fr'), 'pas-une-date')
    assert.equal(F.formatDateTime('pas-une-date', 'ar'), 'pas-une-date')
  })

  it('un objet Date est accepté tel quel', () => {
    const d = new Date(AT)
    assert.equal(F.formatDateTime(d, 'fr'), F.formatDateTime(AT, 'fr'))
  })

  it('la locale suit la langue — et n’est JAMAIS celle du navigateur', () => {
    const browserDefault = new Date(AT).toLocaleString() // ce que faisait OrdersPage
    const ar = F.formatDateTime(AT, 'ar')
    const en = F.formatDateTime(AT, 'en')
    assert.match(ar, /ص|م/, 'le rendu arabe porte son marqueur de période')
    assert.notEqual(ar, browserDefault, 'ar-DZ ≠ locale du navigateur')
    assert.notEqual(en, browserDefault, 'en-GB ≠ en-US (ordre des champs différent)')
    assert.notEqual(ar, en, 'les langues diffèrent entre elles')
  })
})

/* ------------------- les chemins sans écran suivent aussi ---------------- */

describe('8.8 (A8) — messages et notifications suivent la langue', () => {
  it('buildWaMessage : le total du WhatsApp suit la langue du message', () => {
    const cart = [{ qty: 1, name: 'Ryzen 7 7800X3D', sku: '100-100000910WOF' }]
    const pickup = { name: 'Karim', phone: '0550123456', slot: '10:30' }
    // Un traducteur RÉEL (celui de l'app, bound à la langue) : avec `(k) => k`
    // le message se réduirait à la clé `waMessage` et le total n'y apparaîtrait
    // pas — le test passerait à côté de ce qu'il vérifie.
    const ar = buildWaMessage(cart, 97000, pickup, (k, v) => translate('ar', k, v), { lang: 'ar' })
    const fr = buildWaMessage(cart, 97000, pickup, (k, v) => translate('fr', k, v))
    assert.match(ar, /دج/, 'en arabe, le total porte « دج »')
    assert.match(fr, /DA/, 'par défaut, « DA »')
    assert.notEqual(ar, fr, 'les deux langues ne rendent pas le même total')
  })

  it('notifyNewOrder : la notification du comptoir suit la langue', () => {
    const made = []
    const RealNotification = window.Notification
    window.Notification = class {
      static permission = 'granted'
      constructor(title, opts) {
        made.push({ title, body: opts?.body })
        this.close = () => {}
      }
    }
    try {
      const order = { code: 'PS-20260916-0001', name: 'Karim', phone: '0550123456', total: 97000 }
      assert.equal(notifyNewOrder(order, (k) => k, { lang: 'ar' }), true, 'notification émise')
      assert.equal(notifyNewOrder(order, (k) => k, { lang: 'fr' }), true)
      assert.equal(made.length, 2)
      assert.match(made[0].body, /دج/, 'corps arabe : « دج »')
      assert.match(made[1].body, /DA/, 'corps français : « DA »')
      assert.doesNotMatch(made[0].body, /NaN/)
    } finally {
      if (RealNotification) window.Notification = RealNotification
      else delete window.Notification
    }
  })

  it('server/notify.js ne recopie plus le formatage à la main', () => {
    const src = readFileSync('server/notify.js', 'utf8')
    assert.doesNotMatch(src, /toLocaleString\('fr-DZ'\)/, 'plus de recopie inline')
    assert.match(src, /from '\.\.\/src\/data\.js'|from '\.\.\/src\/format\.js'/, 'il passe par le module partagé')
  })
})

/* ------------------------ plus de locale au hasard ----------------------- */

describe('8.8 (A8) — aucune interface ne formate dans son coin', () => {
  it('plus aucun toLocaleString hors de src/format.js dans le code rendu', () => {
    const files = [
      'src/App.jsx',
      'src/OrdersPage.jsx',
      'src/DeskPage.jsx',
      'src/ProductPage.jsx',
      'src/BuilderPage.jsx',
      'src/SearchPage.jsx',
      'src/MasterPage.jsx',
      'src/data.js',
      'src/orderLogic.js',
      'src/notify.js'
    ]
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n')
      assert.doesNotMatch(code, /toLocaleString\(/, `${f} formate encore dans son coin`)
    }
  })

  it('DeskPage n’a plus de formatAt maison : il appelle le module partagé', () => {
    const src = readFileSync('src/DeskPage.jsx', 'utf8')
    assert.match(src, /from '\.\/format\.js'/, 'DeskPage importe formatDateTime')
    assert.match(src, /formatDateTime\(at, lang\)/, 'et lui délègue')
    assert.doesNotMatch(src, /ar-DZ/, 'plus de table de locales recopiée ici')
  })

  it('OrdersPage reçoit la langue (elle ne devine plus celle du navigateur)', () => {
    const src = readFileSync('src/OrdersPage.jsx', 'utf8')
    assert.match(src, /lang/, 'la prop existe')
    assert.match(src, /formatDateTime\(o\.at, lang\)/, 'la date passe par la langue')
    assert.match(src, /money\(o\.total, lang\)/, 'le prix aussi')
    const app = readFileSync('src/App.jsx', 'utf8')
    assert.match(app, /<OrdersPage[\s\S]{0,200}?lang=\{lang\}/, 'App transmet bien `lang` à OrdersPage')
    assert.match(app, /<ProductPage[\s\S]{0,200}?lang=\{lang\}/, '…et à ProductPage')
    assert.match(app, /<BuilderPage[\s\S]{0,200}?lang=\{lang\}/, '…et à BuilderPage')
  })
})

/* --------------------- rendu réel : le défaut de A8 --------------------- */

const orderProps = (over = {}) => ({
  t,
  lang: 'fr',
  user: null,
  apiOnline: false,
  mode: 'local',
  onCancelOrder() {},
  onBack() {},
  ...over
})

const deskProps = (over = {}) => ({
  t,
  lang: 'fr',
  reservations: [],
  onStatus() {},
  onDelete() {},
  setToast() {},
  ...over
})

const ORDER = {
  code: 'PS-20260916-0009',
  name: 'Karim Ben',
  phone: '0550123456',
  at: AT,
  slot: '10:30',
  status: 'new',
  total: 97000,
  items: [{ id: 'cpu-7800x3d', qty: 1, name: 'AMD Ryzen 7 7800X3D', price: 97000 }]
}

describe('8.8 (A8) — rendu réel : une même commande, un même format partout', () => {
  it('OrdersPage en arabe : date ar-DZ et prix en « دج »', async () => {
    window.localStorage.clear()
    saveOrders(safeStorage, [ORDER])
    const m = await mount(React.createElement(OrdersPage, orderProps({ lang: 'ar' })))
    const txt = m.text()
    assert.match(txt, /دج/, 'le prix suit la langue arabe')
    assert.ok(clean(txt).includes(clean(F.formatDateTime(AT, 'ar'))), 'la date est rendue en ar-DZ')
    // Le défaut exact : sans locale, OrdersPage rendait celle du navigateur.
    assert.ok(!clean(txt).includes(clean(new Date(AT).toLocaleString())), 'plus la locale du navigateur')
    await m.unmount()
  })

  it('OrdersPage en français : date fr-DZ et prix en « DA »', async () => {
    window.localStorage.clear()
    saveOrders(safeStorage, [ORDER])
    const m = await mount(React.createElement(OrdersPage, orderProps({ lang: 'fr' })))
    const txt = m.text()
    assert.match(txt, /DA/, 'le prix reste en DA')
    assert.ok(clean(txt).includes(clean(F.formatDateTime(AT, 'fr'))), 'la date est rendue en fr-DZ')
    await m.unmount()
  })

  it('DeskPage et OrdersPage rendent la MÊME date pour la même commande', async () => {
    window.localStorage.clear()
    saveOrders(safeStorage, [ORDER])
    const orders = await mount(React.createElement(OrdersPage, orderProps({ lang: 'ar' })))
    const desk = await mount(React.createElement(DeskPage, deskProps({ lang: 'ar', reservations: [ORDER] })))

    const attendu = clean(F.formatDateTime(AT, 'ar'))
    assert.ok(orders.text().includes(attendu), '« Mes commandes » affiche la date ar-DZ')
    assert.ok(desk.text().includes(attendu), 'le Desk affiche exactement la même chaîne')
    // Et en français aussi : la règle est unique, pas deux règles parallèles.
    await orders.unmount()
    await desk.unmount()

    const ordersFr = await mount(React.createElement(OrdersPage, orderProps({ lang: 'fr' })))
    const deskFr = await mount(React.createElement(DeskPage, deskProps({ lang: 'fr', reservations: [ORDER] })))
    const attenduFr = clean(F.formatDateTime(AT, 'fr'))
    assert.ok(ordersFr.text().includes(attenduFr), 'idem en français (commandes)')
    assert.ok(deskFr.text().includes(attenduFr), 'idem en français (Desk)')
    await ordersFr.unmount()
    await deskFr.unmount()
  })

  it('le prix affiché au Desk et sur « Mes commandes » est identique', async () => {
    window.localStorage.clear()
    saveOrders(safeStorage, [ORDER])
    const orders = await mount(React.createElement(OrdersPage, orderProps({ lang: 'ar' })))
    const desk = await mount(React.createElement(DeskPage, deskProps({ lang: 'ar', reservations: [ORDER] })))
    const prix = clean(F.money(97000, 'ar'))
    assert.ok(orders.text().includes(prix), `« Mes commandes » affiche ${prix}`)
    assert.ok(desk.text().includes(prix), `le Desk affiche ${prix}`)
    await orders.unmount()
    await desk.unmount()
  })
})
