/* ============================================================================
   PC-Star — sous-ressources : la porte ne charge que ce qu'elle represente
   ----------------------------------------------------------------------------
   LE PROBLEME QUE CE FICHIER RESOUD. Les deux portes jsdom (`jsdom-crawl.mjs`,
   `audit-buttons.mjs`) declarent `resources: 'usable'` pour que le bundle soit
   reellement evalue. Mais `usable` veut aussi dire « je vais chercher TOUT ce que
   la page reference », y compris les scripts TIERS. Or une porte qui execute le
   code d'un tiers n'est plus une porte : `@react-google-maps/api`
   (`useJsApiLoader` + `unstable_HiddenGoogleApiBeforeFirstPaint`, actif des que
   la cle publique est dans le build — donc sur le runner, pas chez nous) injecte
   `<script src="https://maps.googleapis.com/maps/api/js?...&callback=onApiLoad">`,
   le crawl le telecharge, et l'API reelle leve CHEZ ELLE, dans un DOM qui ne
   peut pas la representer :
     `TypeError: Cannot read properties of undefined (reading 'querySelector')`
     `at getScript (https://maps.googleapis.com/maps/api/js:23:35)`
   Faute authentique, mais de Google — et PILOREE PAR LE RESEAU : elle passait
   sur une tete et echouait sur la suivante, et ne s'est jamais reproduite hors
   ligne (le runner seul a une cle et une sortie Internet).

   LA REPARATION EST UN MECANISME, PAS UNE LISTE DE MESSAGES. La sous-ressource
   distante est neutralisee AVANT la requete, par l'intercepteur `resources` de
   jsdom : on repond une inertie du bon type MIME selon l'element (script vide,
   feuille vide, document vide) au lieu de laisser jsdom evaluer du code tiers.
   L'app voit exactement ce qu'un navigateur hors ligne verrait — son chargeur
   n'est jamais rappele, la zone reste dans son etat d'attente — et jsdom n'emmet
   PAS son diagnostic `Could not load …` (qui, lui, depend du reseau du runner :
   c'est precisement ce qui rendait la porte capricieuse). Rien n'est filtre par
   message, aucune URL n'est enumeree : une origine, et le bon sens.

   Ce que la porte continue de voir : l'app entiere (bundle same-origin, styles,
   shaders, appels `fetch` a l'API locale — un `fetch` applicatif n'est PAS une
   sous-ressource du DOM), ses erreurs de rendu, ses rejets non geres, et la 404
   `GET /photos/...` qu'un verrou exige de garder visible.
   ============================================================================ */

import { requestInterceptor } from 'jsdom'

// 127.0.0.1 / localhost, n'importe quel port : `vite preview` + l'API miroir sont
// l'origine de la porte. `data:` sert a l'audit des URL, `blob:` et `about:blank`
// aux trous de compatibilite du harnais ; tout le reste est un tiers.
const ORIGINE_PORTE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#]|$)/i

/** `true` quand la sous-ressource doit etre neutralisee. Exportee seche pour que
 *  le verrou la teste sans reseau et sans dependre de jsdom. */
export function estSousRessourceDistante(url) {
  const u = String(url ?? '')
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return false // relatif, `/chemin`, `./x`, `#frag` : la page elle-meme
  if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return false
  return !ORIGINE_PORTE.test(u)
}

/** Corps inerte au bon type MIME, pour ne jamais creer de faute *du harnais* en
 *  croyant en supprimer une du tiers. `img` n'est pas charge par jsdom, d'ou le
 *  repli : le 403 suit alors le chemin d'echec deja connu de l'element. */
function reponseInerte(element) {
  const nom = String(element?.localName ?? '').toLowerCase()
  if (nom === 'script') {
    return new Response('/* sous-ressource distante neutralisee par la porte jsdom */', {
      status: 200, headers: { 'content-type': 'text/javascript' }
    })
  }
  if (nom === 'link' || nom === 'style') {
    return new Response('/* idem : la porte ne charge pas les polices ni les CSS tiers */', {
      status: 200, headers: { 'content-type': 'text/css' }
    })
  }
  if (nom === 'iframe' || nom === 'frame') {
    return new Response('<!doctype html><title>neutralise par la porte jsdom</title>', {
      status: 200, headers: { 'content-type': 'text/html' }
    })
  }
  return new Response('', { status: 403, statusText: 'sous-ressource distante neutralisee par la porte' })
}

/** L'option `resources` a passer a `new JSDOM(...)` : `'usable'` conserve (les
 *  sous-ressources sont chargees, User-Agent par defaut), PLUS la neutralisation
 *  des URL distantes. A ne pas retirer pour « accelerer » : sans intercepteur, le
 *  crawl depend a nouveau de la sortie Internet du runner. */
export function ressourcesDeLaPorte() {
  return {
    interceptors: [
      requestInterceptor(async (request, { element } = {}) => {
        if (!estSousRessourceDistante(request.url)) return undefined // passe : bundle, styles, API locale
        return reponseInerte(element)
      })
    ]
  }
}
