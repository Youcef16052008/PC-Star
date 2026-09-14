import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// P4 (B17) : Bootstrap CSS en bundle local (plus de CDN — site stylé même si
// jsdelivr est bloqué). Doit précéder index.css (override/thème PC Star).
import 'bootstrap/dist/css/bootstrap.min.css'
// L0 (Direction 03 « Terminal Cyber ») : tokens de design dark + light.
// Ordre critique : bootstrap → tokens → index.css (structure) → cyber.css.
import './tokens.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './index.css'
// L1 : habillage Terminal Cyber (typographie, géométrie biseautée).
import './cyber.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
</StrictMode>
)
