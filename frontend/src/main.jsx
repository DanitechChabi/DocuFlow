import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Application installable (PWA) : le service worker n'est actif qu'en ligne,
// sur le site compilé (ni en développement, ni dans l'application de bureau).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// Une page chargée sans erreur : le prochain « nouvelle version » pourra recharger à nouveau.
window.addEventListener('load', () => { setTimeout(() => { try { sessionStorage.removeItem('rechargement-version'); } catch { /* sans gravité */ } }, 10000); });
