import React, { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Check, X, Loader2, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { authService } from '../services/authService';
import { useTitrePage } from '../hooks/useTitrePage';

// ============================================================================
// Choisir son mot de passe (061) : à la première connexion avec un mot de
// passe provisoire (donné par l'administrateur, ou identique à l'identifiant),
// rien d'autre n'est possible tant qu'il n'est pas remplacé.
// ============================================================================

const simple = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const allerApresConnexion = (navigate, user, motDePasse) => {
  if (user?.mdp_a_changer) { navigate('/mot-de-passe', { replace: true, state: { actuel: motDePasse } }); return; }
  let cible = '/';
  try { cible = sessionStorage.getItem('apres-connexion') || '/'; sessionStorage.removeItem('apres-connexion'); } catch { /* sans gravité */ }
  navigate(cible.startsWith('/') && !cible.startsWith('//') ? cible : '/', { replace: true });
};

const ChoisirMotDePasse = () => {
  useTitrePage('Choisir votre mot de passe');
  const navigate = useNavigate();
  const { state } = useLocation();
  const user = authService.getCurrentUser();
  const [actuel, setActuel] = useState(state?.actuel || '');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const regles = useMemo(() => [
    ['8 caractères au moins', nouveau.length >= 8],
    ['Ni votre identifiant, ni votre nom', !!nouveau && !(user?.username && simple(nouveau).includes(simple(user.username)))
      && !String(user?.full_name || '').split(/\s+/).some((m) => simple(m).length >= 4 && simple(nouveau).includes(simple(m)))],
    ['Différent du mot de passe actuel', !!nouveau && nouveau !== actuel],
    ['Les deux saisies sont identiques', !!nouveau && nouveau === confirmation],
  ], [nouveau, confirmation, actuel, user]);

  if (!user) return <Navigate to="/login" replace />;

  const valider = async (e) => {
    e.preventDefault();
    setErreur('');
    if (!regles.every(([, okRegle]) => okRegle)) { setErreur('Le nouveau mot de passe ne respecte pas encore toutes les règles.'); return; }
    setEnvoi(true);
    try {
      await api.put('/users/profile/password', { current_password: actuel, new_password: nouveau });
      localStorage.setItem('user', JSON.stringify({ ...user, mdp_a_changer: false }));
      authService.signalerSession?.();
      allerApresConnexion(navigate, { mdp_a_changer: false });
    } catch (err) {
      setErreur(err.response?.data?.message || 'Le mot de passe n\'a pas pu être changé. Réessayez.');
    } finally { setEnvoi(false); }
  };

  const champ = 'w-full px-3.5 py-3 rounded-lg border border-slate-300 text-[15px] focus:outline-none focus:border-slate-600';
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <form onSubmit={valider} className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4"><KeyRound size={22} className="text-slate-700" /></div>
        <h1 className="text-2xl font-bold text-slate-900">Choisissez votre mot de passe</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user.full_name ? `${user.full_name.split(' ')[0]}, votre` : 'Votre'} mot de passe actuel est provisoire. Choisissez-en un que vous seul connaissez : il protège les dossiers de vos clients.
        </p>
        {erreur && <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm font-semibold text-red-700 flex gap-2"><AlertCircle size={18} className="shrink-0 mt-px" />{erreur}</div>}
        <div className="mt-5 space-y-4">
          {!state?.actuel && (
            <label className="block text-sm font-semibold text-slate-700">Mot de passe actuel (provisoire)
              <input type="password" value={actuel} onChange={(e) => setActuel(e.target.value)} required autoComplete="current-password" className={`${champ} mt-1`} />
            </label>
          )}
          <label className="block text-sm font-semibold text-slate-700">Nouveau mot de passe
            <div className="relative mt-1">
              <input type={voir ? 'text' : 'password'} value={nouveau} onChange={(e) => setNouveau(e.target.value)} required autoFocus autoComplete="new-password" className={`${champ} pr-11`} />
              <button type="button" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer' : 'Afficher'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500">{voir ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Confirmez-le
            <input type={voir ? 'text' : 'password'} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required autoComplete="new-password" className={`${champ} mt-1`} />
          </label>
        </div>
        <ul className="mt-4 space-y-1">
          {regles.map(([texte, okRegle]) => (
            <li key={texte} className={`text-sm flex items-center gap-2 ${okRegle ? 'text-green-700' : 'text-slate-500'}`}>
              {okRegle ? <Check size={15} /> : <X size={15} />} {texte}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Astuce : une courte phrase est plus facile à retenir et plus sûre, par exemple « Mon-café-de-7h30 ».</p>
        <button type="submit" disabled={envoi} className="mt-6 w-full py-3 rounded-lg bg-slate-900 text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {envoi && <Loader2 size={17} className="animate-spin" />} Enregistrer et continuer
        </button>
        <button type="button" onClick={() => { authService.logout(); navigate('/login', { replace: true }); }} className="mt-3 w-full text-sm text-slate-500 hover:text-slate-800">Me déconnecter</button>
      </form>
    </div>
  );
};

export default ChoisirMotDePasse;
