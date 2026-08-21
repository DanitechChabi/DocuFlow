import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft, LayoutDashboard, FolderOpen } from 'lucide-react';
import { authService } from '../services/authService';
import Topbar from '../components/Topbar';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Page introuvable.
 *
 * POURQUOI ELLE MANQUAIT ET CE QUE ÇA COÛTAIT
 *
 * App.jsx ne déclarait aucune route `path="*"`. Une URL qui ne correspond à rien
 * — un signet devenu obsolète, un lien tronqué par un client de messagerie, une
 * faute de frappe — ne rendait donc AUCUN élément : l'utilisateur obtenait une
 * page blanche. Pas de message, pas de navigation, pas même la topbar : rien à
 * cliquer pour s'en sortir, à part le bouton Retour du navigateur. Face à un
 * écran blanc, l'interprétation naturelle n'est pas « cette adresse n'existe
 * pas » mais « l'application est en panne » — et c'est ce qui remonte au support.
 *
 * CE QU'ELLE FAIT
 *
 * Elle nomme la cause (l'adresse demandée est affichée : c'est souvent là que
 * l'utilisateur voit sa faute de frappe), et propose des issues réelles plutôt
 * qu'un simple « retour à l'accueil » : le point de départ diffère selon qu'on
 * est connecté ou non.
 *
 * POURQUOI ELLE MONTE LA TOPBAR ELLE-MÊME
 *
 * Elle est déclarée hors du layout applicatif, car une seule route `*` peut
 * servir les deux publics (voir le commentaire dans App.jsx). Un utilisateur
 * connecté doit pourtant retrouver sa navigation : sans elle, se tromper d'URL
 * reviendrait à être expulsé de l'application. On monte donc la topbar seule, et
 * non le layout complet — les panneaux flottants qu'il contient (messagerie,
 * assistant, recherche globale) interrogent l'API en boucle, ce qui n'a aucun
 * sens sur une page qui n'affiche aucune donnée.
 */
const NotFoundPage = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const connecte = Boolean(authService.getCurrentUser());

  // Sans ce titre, l'onglet d'une adresse fausse était strictement identique à
  // celui d'une page valide : en revenant sur une fenêtre laissée ouverte, rien
  // ne signalait que la navigation avait échoué.
  useTitrePage('Page introuvable');

  const contenu = (
    <div className="empty-state max-w-md mx-auto">
      <div className="empty-state-icon">
        <Compass size={24} />
      </div>
      <h2>Cette page n'existe pas</h2>
      <p className="text-sm">
        L'adresse demandée ne correspond à aucune page de l'application. Elle a pu
        être renommée, ou le lien que vous avez suivi est incomplet.
      </p>
      {/* L'adresse est affichée en clair : c'est l'information qui permet à
          l'utilisateur de repérer lui-même une coupure ou une faute de frappe.
          `break-all` évite qu'une URL longue ne déborde du cadre. */}
      <code className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 break-all max-w-full">
        {pathname}
      </code>

      <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
        {/* `-1` et non une route fixe : dans la majorité des cas l'utilisateur
            venait d'une page valide, et y revenir lui rend son contexte de
            travail intact. */}
        <button type="button" onClick={() => navigate(-1)} className="btn btn-secondary">
          <ArrowLeft size={16} /> Page précédente
        </button>
        {connecte ? (
          <>
            <Link to="/dashboard" className="btn btn-primary">
              <LayoutDashboard size={16} /> Tableau de bord
            </Link>
            <Link to="/documents" className="btn btn-secondary">
              <FolderOpen size={16} /> Documents
            </Link>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary">
            Se connecter
          </Link>
        )}
      </div>
    </div>
  );

  if (connecte) {
    return (
      <div className="h-dvh flex flex-col overflow-hidden bg-slate-50">
        <Topbar />
        <main className="flex-1 overflow-y-auto flex items-center justify-center px-4">
          {contenu}
        </main>
      </div>
    );
  }
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-slate-50">
      {contenu}
    </div>
  );
};

export default NotFoundPage;
