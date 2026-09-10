import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// P4 (B17) : Bootstrap CSS en bundle local (plus de CDN — site stylé même si
// jsdelivr est bloqué). Doit précéder index.css (override/thème PC Star).
import 'bootstrap/dist/css/bootstrap.min.css'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
