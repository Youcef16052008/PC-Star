// P5 (B16) : thème appliqué AVANT le premier paint (aucun flash blanc/sombre).
// Miroir de resolveTheme() (src/prefs.js) : pref explicite > système > dark.
//
// P22 (item 2) — ce bootstrap était un <script> inline dans index.html. Sorti
// dans son propre fichier pour que la Content-Security-Policy puisse imposer
// `script-src 'self'` sans recourir à 'unsafe-inline', qui annulerait
// l'essentiel de la protection XSS. Un script classique (ni async ni defer)
// dans <head> s'exécute toujours avant le premier paint : le comportement
// anti-flash est conservé.
;(function () {
  try {
    var pref = localStorage.getItem('pcstar-theme')
    var theme
    if (pref === 'light' || pref === 'dark') theme = pref
    else if (window.matchMedia) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    else theme = 'dark'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  } catch (e) {}
})()
