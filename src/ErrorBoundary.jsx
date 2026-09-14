import { Component } from 'react'

/**
 * Filet de sécurité anti « page blanche » : toute erreur de rendu attrapée
 * ici affiche un panneau lisible + bouton rechargement au lieu d'un écran
 * vide (ou de l'overlay Vite « null » en dev).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // En dev, l'erreur complète reste visible dans la console.
    console.error('ErrorBoundary', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div className="empty-state" style={{ maxWidth: 480 }}>
            <strong>خطأ · Erreur · Error</strong>
            <p className="small mb-3">
              quelque chose s'est mal affiché. Rechargez la page — le panier et les commandes sont conservés.
            </p>
            <button className="btn btn-success" type="button" onClick={() => window.location.reload()}>
              ⟳ Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
