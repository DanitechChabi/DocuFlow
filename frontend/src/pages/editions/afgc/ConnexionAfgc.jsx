import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff, AlertCircle, Loader2, UserPlus } from 'lucide-react';
import { authService } from '../../../services/authService';
import { useSettings } from '../../../contexts/SettingsContext';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { edition } from '../../../editions';
import CadreConnexion from './CadreConnexion';
import { champ, etiquette, boutonPrincipal, VERT } from './styleConnexion';

// ============================================================================
// Connexion à l'espace de l'AFGC : l'identifiant OU l'adresse professionnelle
// (Outlook), le mot de passe, et c'est tout. Première fois : « Créer mon
// compte ».
// ============================================================================

const ConnexionAfgc = () => {
  useTitrePage('Connexion');
  const navigate = useNavigate();
  const settings = useSettings();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const connecter = async (e) => {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      const data = await authService.login(identifiant.trim(), motDePasse, edition?.organisation);
      if (data.token) {
        await settings.refresh();
        navigate('/');
        return;
      }
      setErreur(data.message || 'Identifiant ou mot de passe incorrect.');
    } catch (err) {
      setErreur(err.response?.data?.message || 'Connexion impossible pour le moment. Réessayez dans un instant.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <CadreConnexion>
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/70 border border-slate-100 p-6 sm:p-9">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Connexion</h1>
        <p className="text-sm text-slate-500 mt-1">Accédez aux archives de l'AFGC.</p>

        {erreur && (
          <div role="alert" className="mt-5 p-3.5 rounded-xl bg-red-50 border border-red-100 text-sm font-semibold text-red-700 flex items-start gap-2.5">
            <AlertCircle size={18} className="flex-shrink-0 mt-px" /> {erreur}
          </div>
        )}

        <form onSubmit={connecter} className="mt-6 space-y-5">
          <div>
            <label htmlFor="identifiant" className={etiquette}>Identifiant ou adresse Outlook</label>
            <input id="identifiant" className={champ} value={identifiant} onChange={(e) => setIdentifiant(e.target.value)}
              required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="ex. e.kpadonou" />
          </div>
          <div>
            <label htmlFor="mot-de-passe" className={etiquette}>Mot de passe</label>
            <div className="relative">
              <input id="mot-de-passe" type={voir ? 'text' : 'password'} className={`${champ} pr-12`} value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)} required autoComplete="current-password" />
              <button type="button" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
                {voir ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={envoi} className={boutonPrincipal} style={{ background: VERT }}>
            {envoi ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
            {envoi ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <div className="mt-7 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-500">Première fois ici ?</span>
          <Link to="/register" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-black transition-colors hover:bg-green-50"
            style={{ borderColor: VERT, color: VERT }}>
            <UserPlus size={16} /> Créer mon compte
          </Link>
        </div>
      </div>
    </CadreConnexion>
  );
};

export default ConnexionAfgc;
