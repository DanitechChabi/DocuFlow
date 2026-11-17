import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Loader2, UserPlus, LogIn, RotateCcw } from 'lucide-react';
import { authService } from '../../../services/authService';
import { useSettings } from '../../../contexts/SettingsContext';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { edition } from '../../../editions';
import CadreConnexion from './CadreConnexion';
import ChoixDepartement from './ChoixDepartement';
import { champ, etiquette, aide, boutonPrincipal, VERT } from './styleConnexion';
import { identifiantPropose } from './identite';

// ============================================================================
// Inscription à l'espace de l'AFGC :
//  1. « Vous êtes… » : l'agent choisit son département dans le menu déroulant
//     (ou le crée s'il manque, si l'administrateur le permet) ;
//  2. apparaissent alors, en cascade, son nom complet, son identifiant (proposé
//     d'après le nom), son adresse professionnelle Outlook et son mot de passe.
// Le compte créé, l'agent est connecté et arrive sur « Quel dossier vous
// faut-il ? ».
// ============================================================================

/** Un champ qui apparaît en cascade après le choix du département. */
const Apparait = ({ rang, children }) => (
  <div className="animate-fade-in-up" style={{ animationDelay: `${rang * 70}ms` }}>{children}</div>
);

const InscriptionAfgc = () => {
  useTitrePage('Créer mon compte');
  const navigate = useNavigate();
  const settings = useSettings();
  const organisation = edition?.organisation;

  const [infos, setInfos] = useState(null);
  const [erreurListe, setErreurListe] = useState(false);
  const [departement, setDepartement] = useState(null);
  const [form, setForm] = useState({ full_name: '', username: '', email: '', password: '' });
  const [identifiantTouche, setIdentifiantTouche] = useState(false);
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    setErreurListe(false);
    authService.departements(organisation).then(setInfos).catch(() => setErreurListe(true));
  }, [organisation]);
  useEffect(() => { charger(); }, [charger]);

  const domaines = infos?.domaines || [];

  const changer = (cle) => (e) => {
    const valeur = e.target.value;
    setForm((f) => {
      const suivant = { ...f, [cle]: valeur };
      if (cle === 'full_name' && !identifiantTouche) suivant.username = identifiantPropose(valeur);
      return suivant;
    });
    if (cle === 'username') setIdentifiantTouche(true);
  };

  // Un seul domaine admis (l'AFGC : @afgcsa.com) : l'agent ne tape que le début
  // de son adresse, la fin est déjà écrite. Plusieurs domaines : l'adresse
  // entière, contrôlée.
  const domaineUnique = domaines.length === 1 ? domaines[0] : null;
  const changerAdresse = (e) => {
    const debut = e.target.value.split('@')[0].replace(/\s+/g, '');
    setForm((f) => ({ ...f, email: debut }));
  };
  const adresse = domaineUnique ? (form.email ? `${form.email}@${domaineUnique}` : '') : form.email.trim();
  const domaineSaisi = !domaineUnique && adresse.includes('@') ? adresse.split('@')[1]?.toLowerCase() : '';
  const domaineRefuse = Boolean(domaines.length && domaineSaisi && !domaines.includes(domaineSaisi));
  const complet = departement && form.full_name.trim() && form.username.trim() && adresse && form.password && !domaineRefuse;

  const envoyer = async (e) => {
    e.preventDefault();
    if (!complet || envoi) return;
    setErreur('');
    setEnvoi(true);
    const identifiant = form.username.trim();
    try {
      await authService.register({
        full_name: form.full_name.trim().replace(/\s+/g, ' '),
        username: identifiant,
        email: adresse,
        password: form.password,
        section: departement.name,
        nouveau_departement: Boolean(departement.nouveau),
        tenant_slug: organisation,
      });
    } catch (err) {
      setErreur(err.response?.data?.message || 'L\'inscription n\'a pas abouti. Réessayez dans un instant.');
      setEnvoi(false);
      return;
    }
    // Compte créé : on entre directement.
    try {
      const data = await authService.login(identifiant, form.password, organisation);
      if (data.token) {
        await settings.refresh();
        navigate('/');
        return;
      }
    } catch { /* la connexion se refera depuis la page de connexion */ }
    navigate('/login');
  };

  return (
    <CadreConnexion enHaut>
      <div className="bg-white rounded-xl shadow-xl/70 border border-slate-100 p-6 sm:p-9">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Créer mon compte</h1>
            <p className="text-sm text-slate-500 mt-1">
              Étape {departement ? 2 : 1} sur 2 · {departement ? 'vos informations' : 'votre département'}
            </p>
          </div>
          <div className="flex gap-1.5 mt-3" aria-hidden="true">
            <span className="h-1.5 w-8 rounded-full" style={{ background: VERT }} />
            <span className="h-1.5 w-8 rounded-full bg-slate-200 overflow-hidden">
              <span className="block h-full rounded-full transition-transform duration-500 ease-[cubic-bezier(0.2,0,0,1)] origin-left"
                style={{ background: VERT, transform: `scaleX(${departement ? 1 : 0})` }} />
            </span>
          </div>
        </div>

        {erreur && (
          <div role="alert" className="mt-5 p-3.5 rounded-xl bg-red-50 border border-red-100 text-sm font-semibold text-red-700 flex items-start gap-2.5 animate-fade-in-down">
            <AlertCircle size={18} className="flex-shrink-0 mt-px" /> {erreur}
          </div>
        )}

        <section className="mt-6">
          <h2 className="text-xl font-bold text-slate-900 mb-3">Vous êtes…</h2>
          {erreurListe ? (
            <div className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">
              La liste des départements n'a pas pu être chargée.
              <button type="button" onClick={charger} className="ml-2 font-bold inline-flex items-center gap-1" style={{ color: VERT }}>
                <RotateCcw size={14} /> Réessayer
              </button>
            </div>
          ) : !infos ? (
            <div className="h-[70px] rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <>
              <ChoixDepartement departements={infos.departements} creation={infos.creation} valeur={departement}
                onChange={(d) => { setDepartement(d); setErreur(''); }} />
              {!departement && !infos.creation && (
                <p className={aide}>Votre département n'apparaît pas ? Adressez-vous au service des archives.</p>
              )}
            </>
          )}
        </section>

        {departement && (
          <form onSubmit={envoyer} className="mt-6 space-y-4">
            <Apparait rang={0}>
              <label htmlFor="nom-complet" className={etiquette}>Nom complet</label>
              <input id="nom-complet" className={champ} value={form.full_name} onChange={changer('full_name')} required autoFocus
                autoComplete="name" maxLength={100} placeholder="ex. Éric Kpadonou" />
            </Apparait>
            <Apparait rang={1}>
              <label htmlFor="identifiant" className={etiquette}>Identifiant</label>
              <input id="identifiant" className={champ} value={form.username} onChange={changer('username')} required
                autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} placeholder="ex. e.kpadonou" />
              <p className={aide}>Pour vous connecter{identifiantTouche ? '' : ' — proposé d\'après votre nom, modifiable'}.</p>
            </Apparait>
            <Apparait rang={2}>
              <label htmlFor="adresse" className={etiquette}>Adresse professionnelle Outlook</label>
              {domaineUnique ? (
                <div className="flex items-stretch rounded-xl border border-slate-200 bg-white overflow-hidden transition-shadow focus-within:border-[#2C9C0A] focus-within:ring-4 focus-within:ring-green-100">
                  <input id="adresse" className="flex-1 min-w-0 px-4 py-3 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    value={form.email} onChange={changerAdresse} required autoComplete="email" autoCapitalize="none" spellCheck={false}
                    placeholder="prenom.nom" aria-describedby="fin-adresse" />
                  <span id="fin-adresse" className="px-3.5 flex items-center text-slate-500 font-semibold bg-slate-50 border-l border-slate-200 select-none">@{domaineUnique}</span>
                </div>
              ) : (
                <input id="adresse" type="email" className={`${champ} ${domaineRefuse ? 'border-amber-400' : ''}`} value={form.email}
                  onChange={changer('email')} required autoComplete="email" autoCapitalize="none" spellCheck={false}
                  placeholder={domaines.length ? `prenom.nom@${domaines[0]}` : 'prenom.nom@…'} />
              )}
              {domaineRefuse ? (
                <p className="text-xs font-semibold text-amber-700 mt-1.5">Utilisez votre adresse {domaines.map((d) => `@${d}`).join(' ou ')}.</p>
              ) : (
                <p className={aide}>Vous pourrez aussi vous connecter avec elle.</p>
              )}
            </Apparait>
            <Apparait rang={3}>
              <label htmlFor="mot-de-passe" className={etiquette}>Mot de passe</label>
              <div className="relative">
                <input id="mot-de-passe" type={voir ? 'text' : 'password'} className={`${champ} pr-12`} value={form.password}
                  onChange={changer('password')} required autoComplete="new-password" />
                <button type="button" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
                  {voir ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className={aide}>8 caractères au moins.</p>
            </Apparait>
            <Apparait rang={4}>
              <button type="submit" disabled={!complet || envoi} className={boutonPrincipal} style={{ background: VERT }}>
                {envoi ? <Loader2 size={20} className="animate-spin" /> : <UserPlus size={20} />}
                {envoi ? 'Création du compte…' : 'Créer mon compte'}
              </button>
            </Apparait>
          </form>
        )}

        <div className="mt-7 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-500">Déjà inscrit ?</span>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-bold hover:underline underline-offset-4" style={{ color: VERT }}>
            <LogIn size={16} /> Se connecter
          </Link>
        </div>
      </div>
    </CadreConnexion>
  );
};

export default InscriptionAfgc;
