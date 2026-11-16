import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Eye, EyeOff, AlertCircle, Loader2, UserPlus, Building2, Pencil, LogIn, RotateCcw } from 'lucide-react';
import { authService } from '../../../services/authService';
import { useSettings } from '../../../contexts/SettingsContext';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { edition } from '../../../editions';
import CadreConnexion from './CadreConnexion';
import { champ, etiquette, aide, boutonPrincipal, VERT } from './styleConnexion';
import { sansAccents, decouper, identifiantPropose } from './identite';

// ============================================================================
// Inscription à l'espace de l'AFGC, en deux temps :
//  1. « Vous êtes… » : l'agent choisit son département ; s'il manque, il le
//     crée (si l'administrateur le permet) ;
//  2. apparaissent alors son nom complet, son identifiant (proposé d'après le
//     nom) et son adresse professionnelle Outlook — et son mot de passe.
// Le compte créé, l'agent est connecté et arrive sur « Quel dossier vous
// faut-il ? ».
// ============================================================================

const Pastille = ({ sigle }) => (
  <span className="h-11 min-w-[2.75rem] px-1.5 rounded-xl flex items-center justify-center text-[11px] font-black flex-shrink-0 tracking-tight"
    style={{ background: `${VERT}14`, color: VERT }}>
    {sigle || <Building2 size={18} />}
  </span>
);

const InscriptionAfgc = () => {
  useTitrePage('Créer mon compte');
  const navigate = useNavigate();
  const settings = useSettings();
  const organisation = edition?.organisation;

  const [infos, setInfos] = useState(null);
  const [erreurListe, setErreurListe] = useState(false);
  const [departement, setDepartement] = useState(null);
  const [autre, setAutre] = useState(false);
  const [nomAutre, setNomAutre] = useState('');
  const [form, setForm] = useState({ full_name: '', username: '', email: '', password: '' });
  const [identifiantTouche, setIdentifiantTouche] = useState(false);
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    setErreurListe(false);
    authService.departements(organisation)
      .then((r) => { setInfos(r); if (!r.departements.length && r.creation) setAutre(true); })
      .catch(() => setErreurListe(true));
  }, [organisation]);
  useEffect(() => { charger(); }, [charger]);

  const departements = infos?.departements || [];
  const domaines = infos?.domaines || [];

  const choisir = (d) => { setDepartement(d); setErreur(''); };
  const validerAutre = () => {
    const nom = nomAutre.trim().replace(/\s+/g, ' ');
    if (nom.length < 2) return;
    // Déjà dans la liste, à la casse ou aux accents près : on reprend celui-là.
    const existant = departements.find((d) => sansAccents(d.name).toLowerCase() === sansAccents(nom).toLowerCase());
    choisir(existant ? { name: existant.name } : { name: nom, nouveau: true });
  };

  const changer = (cle) => (e) => {
    const valeur = e.target.value;
    setForm((f) => {
      const suivant = { ...f, [cle]: valeur };
      if (cle === 'full_name' && !identifiantTouche) suivant.username = identifiantPropose(valeur);
      return suivant;
    });
    if (cle === 'username') setIdentifiantTouche(true);
  };

  const domaineSaisi = form.email.includes('@') ? form.email.trim().split('@')[1]?.toLowerCase() : '';
  const domaineRefuse = Boolean(domaines.length && domaineSaisi && !domaines.includes(domaineSaisi));
  const complet = form.full_name.trim() && form.username.trim() && form.email.trim() && form.password && !domaineRefuse;

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
        email: form.email.trim(),
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
    <CadreConnexion>
      <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/70 border border-slate-100 p-6 sm:p-9">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Créer mon compte</h1>
            <p className="text-sm text-slate-500 mt-1">
              Étape {departement ? 2 : 1} sur 2 · {departement ? 'vos informations' : 'votre département'}
            </p>
          </div>
          <div className="flex gap-1.5 mt-3" aria-hidden="true">
            {[1, 2].map((n) => (
              <span key={n} className="h-1.5 w-8 rounded-full transition-colors" style={{ background: n <= (departement ? 2 : 1) ? VERT : '#e2e8f0' }} />
            ))}
          </div>
        </div>

        {erreur && (
          <div role="alert" className="mt-5 p-3.5 rounded-xl bg-red-50 border border-red-100 text-sm font-semibold text-red-700 flex items-start gap-2.5">
            <AlertCircle size={18} className="flex-shrink-0 mt-px" /> {erreur}
          </div>
        )}

        {!departement ? (
          <section className="mt-6">
            <h2 className="text-xl font-black text-slate-900">Vous êtes…</h2>
            <p className="text-sm text-slate-500">Choisissez votre département.</p>

            {erreurListe ? (
              <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
                La liste des départements n'a pas pu être chargée.
                <button type="button" onClick={charger} className="ml-2 font-bold inline-flex items-center gap-1" style={{ color: VERT }}>
                  <RotateCcw size={14} /> Réessayer
                </button>
              </div>
            ) : !infos ? (
              <div className="mt-6 flex justify-center text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
            ) : (
              <div role="group" aria-label="Votre département" className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {departements.map((d) => {
                  const { sigle, intitule } = decouper(d.name);
                  return (
                    <button key={d.id} type="button" onClick={() => choisir({ name: d.name })}
                      className="text-left rounded-2xl border border-slate-200 bg-white px-3.5 py-3 flex items-center gap-3 hover:border-[#2C9C0A] hover:bg-green-50/50 focus:outline-none focus:ring-4 focus:ring-green-100 transition-colors">
                      <Pastille sigle={sigle} />
                      <span className="text-sm font-bold text-slate-800 leading-snug">{intitule}</span>
                    </button>
                  );
                })}

                {infos.creation && (autre ? (
                  <div className="sm:col-span-2 rounded-2xl border-2 border-dashed border-slate-200 p-4">
                    <label htmlFor="nouveau-departement" className={etiquette}>Nom de votre département</label>
                    <div className="flex gap-2">
                      <input id="nouveau-departement" className={champ} value={nomAutre} maxLength={100} autoFocus
                        onChange={(e) => setNomAutre(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validerAutre(); } }}
                        placeholder="ex. DSI — Systèmes d'information" />
                      <button type="button" onClick={validerAutre} disabled={nomAutre.trim().length < 2}
                        className="px-4 rounded-xl text-white font-bold disabled:opacity-50 flex-shrink-0" style={{ background: VERT }}>
                        Continuer
                      </button>
                    </div>
                    <p className={aide}>Il rejoindra la liste des départements de l'AFGC.</p>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAutre(true)}
                    className="sm:col-span-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 hover:border-[#2C9C0A] hover:text-[#2C9C0A] inline-flex items-center justify-center gap-2 transition-colors">
                    <Plus size={16} /> Mon département n'est pas dans la liste
                  </button>
                ))}
                {!infos.creation && !departements.length && (
                  <p className="sm:col-span-2 text-sm text-slate-500">Aucun département n'est encore enregistré : adressez-vous au service des archives.</p>
                )}
              </div>
            )}
            {infos && !infos.creation && departements.length > 0 && (
              <p className={`${aide} mt-3`}>Votre département n'apparaît pas ? Adressez-vous au service des archives.</p>
            )}
          </section>
        ) : (
          <section className="mt-6">
            <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3 bg-green-50/70 border border-green-100">
              <Pastille sigle={decouper(departement.name).sigle} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-green-900/60">Vous êtes du département</div>
                <div className="font-black text-slate-900 leading-snug">
                  {departement.name}
                  {departement.nouveau && <span className="ml-2 align-middle text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">nouveau</span>}
                </div>
              </div>
              <button type="button" onClick={() => { setDepartement(null); setErreur(''); }}
                className="px-2.5 py-1.5 rounded-lg text-sm font-bold text-slate-500 hover:text-slate-800 hover:bg-white inline-flex items-center gap-1.5">
                <Pencil size={14} /> Changer
              </button>
            </div>

            <form onSubmit={envoyer} className="mt-5 space-y-4 animate-fade-in-up">
              <div>
                <label htmlFor="nom-complet" className={etiquette}>Nom complet</label>
                <input id="nom-complet" className={champ} value={form.full_name} onChange={changer('full_name')} required autoFocus
                  autoComplete="name" maxLength={100} placeholder="ex. Éric Kpadonou" />
              </div>
              <div>
                <label htmlFor="identifiant" className={etiquette}>Identifiant</label>
                <input id="identifiant" className={champ} value={form.username} onChange={changer('username')} required
                  autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} placeholder="ex. e.kpadonou" />
                <p className={aide}>Pour vous connecter{identifiantTouche ? '' : ' — proposé d\'après votre nom, modifiable'}.</p>
              </div>
              <div>
                <label htmlFor="adresse" className={etiquette}>Adresse professionnelle Outlook</label>
                <input id="adresse" type="email" className={`${champ} ${domaineRefuse ? 'border-amber-400' : ''}`} value={form.email}
                  onChange={changer('email')} required autoComplete="email" autoCapitalize="none" spellCheck={false}
                  placeholder={domaines.length ? `prenom.nom@${domaines[0]}` : 'prenom.nom@…'} />
                {domaineRefuse ? (
                  <p className="text-xs font-semibold text-amber-700 mt-1.5">Utilisez votre adresse {domaines.map((d) => `@${d}`).join(' ou ')}.</p>
                ) : (
                  <p className={aide}>Vous pourrez aussi vous connecter avec elle.</p>
                )}
              </div>
              <div>
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
              </div>
              <button type="submit" disabled={!complet || envoi} className={boutonPrincipal} style={{ background: VERT }}>
                {envoi ? <Loader2 size={20} className="animate-spin" /> : <UserPlus size={20} />}
                {envoi ? 'Création du compte…' : 'Créer mon compte'}
              </button>
            </form>
          </section>
        )}

        <div className="mt-7 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-500">Déjà inscrit ?</span>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-black hover:underline underline-offset-4" style={{ color: VERT }}>
            <LogIn size={16} /> Se connecter
          </Link>
        </div>
      </div>
    </CadreConnexion>
  );
};

export default InscriptionAfgc;
