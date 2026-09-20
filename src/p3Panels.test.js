/**
 * LOT P3 (B32, B33) — les panneaux ajoutés par le maître, et la suppression
 * d'un compte.
 *
 * Le rapport d'audit parlait d'un `setEditing` jamais lu ; il n'existe ni à la
 * base auditée ni aujourd'hui (revérifié : `git log -S setEditing` est vide).
 * Le vrai trou est ailleurs et il est double : `buildShopView` ne filtrait les
 * `hiddenPanelIds` QUE sur les panneaux de base, et les `extraPanels` rendus
 * dans le maître étaient décoratifs — ni ON/OFF, ni suppression, avec un bouton
 * d'ajout étiqueté « Ajouter le produit ». Un panneau ajouté ne pouvait donc
 * ni se cacher ni se retirer, et la troncature serveur à 12 (`putPanels`)
 * rendait le 13ᵉ définitivement inatteignable.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildShopView, removePanel, togglePanel } from './shopStore.js'

const codeDe = (fichier) =>
  fs
    .readFileSync(path.join(process.cwd(), fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

describe('P3/B32 — un panneau ajouté se masque', () => {
  const base = [
    { id: 'best', titleKey: 'panelBest' },
    { id: 'deals', titleKey: 'panelDeals' }
  ]
  const meta = {
    extraPanels: [{ id: 'panel-x', titles: { fr: 'Gamer', en: 'Gamer' }, categories: ['gpu', 'case'] }],
    hiddenPanelIds: [],
    hiddenProductIds: [],
    photoOverrides: {}
  }

  it('visible par défaut, avec ses lignes de tri', () => {
    const vue = buildShopView([], [], base, meta)
    assert.ok(vue.panels.some((p) => p.id === 'panel-x'), 'le panneau ajouté narrive pas dans la vitrine')
    assert.equal(vue.lines.filter((l) => l.group === 'panel-x').length, 2, 'les lignes du panneau ajouté manquent')
  })

  it('OFF le retire des panneaux ET des lignes de tri', () => {
    const cache = togglePanel(meta, 'panel-x', false)
    const vue = buildShopView([], [], base, cache)
    assert.equal(vue.panels.some((p) => p.id === 'panel-x'), false, 'le maître a cliqué OFF, la vitrine affiche encore')
    assert.deepEqual(vue.lines.filter((l) => l.group === 'panel-x'), [], 'les lignes suivent : le rayon filtré reste cliquable')
    assert.equal(vue.panels.length, base.length, 'les panneaux de base sont intacts')
  })

  it('un autre panneau masqué ne masque pas ses voisins', () => {
    const cache = togglePanel(meta, 'deals', false)
    const vue = buildShopView([], [], base, cache)
    assert.equal(vue.panels.some((p) => p.id === 'deals'), false)
    assert.ok(vue.panels.some((p) => p.id === 'panel-x'))
  })
})

describe('P3/B32 — un panneau ajouté se supprime', () => {
  it('removePanel retire la fiche et le masque associé', () => {
    const avecMasque = togglePanel({ ...metaAvecDeux() }, 'panel-a', false)
    const apres = removePanel(avecMasque, 'panel-a')
    assert.deepEqual(apres.extraPanels.map((p) => p.id), ['panel-b'])
    assert.deepEqual(apres.hiddenPanelIds, [], "une id supprimée ne doit pas trainer dans `hiddenPanelIds`")
    const vue = buildShopView([], [], [], apres)
    assert.deepEqual(vue.panels.map((p) => p.id), ['panel-b'])
  })

  it('retirer un panneau inconnu ne casse rien', () => {
    const m = metaAvecDeux()
    assert.deepEqual(removePanel(m, 'panel-z').extraPanels, m.extraPanels)
  })

  it('le maître donne les deux commandes, et l’ajout dit « panneau »', () => {
    const master = codeDe('src/MasterPage.jsx')
    const debut = master.indexOf('(meta.extraPanels || []).map((p) => {')
    assert.ok(debut > 0, 'le bloc des panneaux ajoutés est revenu à sa version décorative')
    const rendu = master.slice(debut, debut + 1600)
    assert.match(rendu, /doTogglePanel\(p\.id, !on\)/, 'pas de ON/OFF sur un panneau ajouté')
    assert.match(rendu, /doDeletePanel\(p\.id\)/, 'pas de suppression sur un panneau ajouté')
    assert.match(master, /\{t\('masterAddPanel'\)\}/, "l'étiquette du formulaire de panneau n'a pas été ajoutée")
    assert.match(master, /setToast\(t\('masterPanelAdded'\)\)/, "l'ajout d'un panneau annonce encore un produit")
    const form = master.slice(master.indexOf('<form className="card shadow-sm border-0" onSubmit={submitPanel}>'), master.indexOf('</form>', master.indexOf('onSubmit={submitPanel}')))
    assert.equal(/masterAddProduct/.test(form), false, 'le bouton du formulaire de panneau est encore étiqueté « Ajouter le produit »')
  })

  function metaAvecDeux() {
    return {
      extraPanels: [
        { id: 'panel-a', titles: { fr: 'A' }, categories: ['gpu'] },
        { id: 'panel-b', titles: { fr: 'B' }, categories: ['ssd'] }
      ],
      hiddenPanelIds: [],
      hiddenProductIds: [],
      photoOverrides: {}
    }
  }
})

describe('P3/B33 — supprimer un compte se confirme', () => {
  it('la garde est posée avant l’appel', () => {
    const master = codeDe('src/MasterPage.jsx')
    const i = master.indexOf('function doDeleteCustomer(')
    assert.ok(i > 0)
    const tete = master.slice(i, i + 900)
    const confirmation = tete.indexOf('window.confirm(')
    const appel = tete.indexOf('api.deleteCustomer(')
    assert.ok(confirmation > 0, 'aucune confirmation avant de supprimer un compte')
    assert.ok(appel > confirmation || appel < 0, 'l’appel part avant la confirmation')
    assert.match(tete, /confirmDeleteCustomer/, 'la confirmation ne nomme pas la clé i18n')
    assert.match(tete, /name: c\.name \|\| c\.email \|\| id/, 'le compte concerné n’est pas nommé dans la question')
  })

  it('le bouton passe le client, pas seulement son identifiant', () => {
    const master = codeDe('src/MasterPage.jsx')
    assert.match(master, /onClick=\{\(\) => doDeleteCustomer\(c\)\}/, 'le clic ne fournit que l’id : rien à nommer dans la question')
    assert.equal(/doDeleteCustomer\(c\.id\)/.test(master), false, 'un appel reste sur lancienne signature')
  })
})
