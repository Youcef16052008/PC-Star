// Thème appliqué AVANT le premier paint (aucun flash).
// Sorti en fichier externe pour que la CSP puisse imposer
// `script-src 'self'` sans 'unsafe-inline'.
//
// Décision client : le thème sombre a été SUPPRIMÉ — le site est
// définitivement en thème clair (carte de visite : blanc/bleu/rouge).
;(function () {
  try {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.colorScheme = 'light'
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#f4f6fb')
  } catch (e) {}
})()
