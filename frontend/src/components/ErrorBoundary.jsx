import React from 'react';

// ============================================================================
// Écran d'erreur de l'interface.
// - Après une mise à jour, un onglet resté ouvert peut réclamer un morceau de
//   l'ancienne version (« Failed to fetch dynamically imported module ») : on
//   recharge une fois, automatiquement, plutôt que d'afficher une erreur.
// - Sinon : un message simple, une référence à donner à l'administrateur,
//   « Réessayer », « Retour à l'accueil ».
// ============================================================================

const VERSION_OBSOLETE = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically/i;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, ref: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, ref: Math.random().toString(16).slice(2, 8).toUpperCase() };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[interface] Erreur ${this.state.ref || ''} :`, error, errorInfo?.componentStack);
    if (VERSION_OBSOLETE.test(String(error?.message || error))) {
      try {
        if (!sessionStorage.getItem('rechargement-version')) {
          sessionStorage.setItem('rechargement-version', '1');
          window.location.reload();
        }
      } catch { /* sans gravité */ }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const obsolete = VERSION_OBSOLETE.test(String(this.state.error?.message || ''));
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-5">
            <svg width="30" height="30" className="text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{obsolete ? 'Une nouvelle version est disponible' : 'Cet écran n\'a pas pu s\'afficher'}</h1>
          <p className="text-slate-600 mb-2">
            {obsolete
              ? 'L\'application a été mise à jour pendant que cette page était ouverte. Rechargez pour continuer.'
              : 'Rien n\'est perdu : vos données sont enregistrées sur le serveur. Réessayez ; si cela se reproduit, donnez la référence ci-dessous à l\'administrateur.'}
          </p>
          {!obsolete && <p className="text-xs text-slate-400 mb-6">Référence : {this.state.ref}</p>}
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-left text-xs mb-6 p-3 bg-slate-100 rounded overflow-auto text-red-600">{String(this.state.error?.stack || this.state.error)}</pre>
          )}
          <div className="flex flex-wrap justify-center gap-3 mt-4">
            <button type="button" onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-md bg-slate-900 text-white font-semibold">
              {obsolete ? 'Recharger' : 'Réessayer'}
            </button>
            <button type="button" onClick={() => { window.location.href = '/'; }} className="px-5 py-2.5 rounded-md border border-slate-300 bg-white text-slate-800 font-semibold">
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
