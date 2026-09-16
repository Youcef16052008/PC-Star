/**
 * P19 — Notifications navigateur du comptoir (PC Star).
 *
 * Une commande doit être vue même si l'onglet Desk n'est pas au premier plan :
 * `alert()` ne suffit pas (il bloque et passe inaperçu), et le bip seul ne dit
 * rien. On utilise donc l'API Notification, **avec demande explicite de
 * permission** — jamais de notification sans l'accord du master.
 *
 * Tout est défensif : l'API est absente sur iOS Safari, peut être refusée, et
 * le contexte peut ne pas être sécurisé. Dans tous ces cas on ne fait rien et
 * on retourne `false`, sans jamais lever d'exception.
 */

import { money } from './format.js'

/** Peut-on au moins *demander* la permission ? */
export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * État de la permission : 'granted' | 'denied' | 'default' | 'unsupported'.
 */
export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return window.Notification.permission || 'default'
  } catch {
    return 'unsupported'
  }
}

/**
 * Demande la permission. Retourne le nouvel état.
 * Les navigateurs n'autorisent qu'un appel par geste utilisateur : si la
 * permission est déjà tranchée, on la renvoie telle quelle sans re-demander.
 */
export async function requestNotificationPermission() {
  const state = notificationPermission()
  if (state !== 'default') return state
  try {
    const res = await window.Notification.requestPermission()
    return res || notificationPermission()
  } catch {
    // Safari < 16 n'accepte pas la promesse : retombée sur le callback.
    try {
      return await new Promise((resolve) => {
        window.Notification.requestPermission((r) => resolve(r || notificationPermission()))
      })
    } catch {
      return 'denied'
    }
  }
}

/**
 * Affiche une notification. Silencieux et sûr : retourne false si impossible.
 * @returns {boolean} true si la notification a été créée
 */
export function showNotification({ title, body, tag, icon }) {
  if (notificationPermission() !== 'granted') return false
  try {
    // `tag` remplace la notification précédente du même type : dix commandes
    // d'affilée ne produisent pas dix fenêtres empilées.
    const n = new window.Notification(title, { body: body || '', tag: tag || 'pcstar-order', icon: icon || undefined })
    // Clic ⇒ ramener l'onglet au premier plan (utile quand le Desk tourne en
    // arrière-plan sur un second écran).
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      try {
        n.close()
      } catch {
        /* ignore */
      }
    }
    return true
  } catch {
    // Certaines plateformes exigent un Service Worker ; sans lui on abandonne
    // plutôt que de casser le Desk.
    return false
  }
}

/**
 * Notification de nouvelle commande, formatée à partir de l'objet commande.
 *
 * LOT 8.8 (A8) : le total passe par le module de formatage partagé — il était
 * recopié à la main (`toLocaleString('fr-DZ')` + ` DA`), donc figé au format
 * français même quand le comptoir est en arabe ou en anglais, alors que le
 * titre de la notification, lui, suit la langue via `t`.
 *
 * @param {object} order
 * @param {(key: string, vars?: object) => string} [t] traducteur bound
 * @param {{ lang?: string }} [opts] langue de l'interface (défaut : français)
 */
export function notifyNewOrder(order, t, { lang = 'fr' } = {}) {
  if (!order) return false
  const label = t || ((k) => k)
  const total = typeof order.total === 'number' ? money(order.total, lang) : ''
  const body = [order.name, order.phone, total].filter(Boolean).join(' · ')
  return showNotification({
    title: `${label('deskNotifyTitle')} ${order.code || ''}`.trim(),
    body,
    tag: `pcstar-order-${order.code || 'new'}`,
  })
}
