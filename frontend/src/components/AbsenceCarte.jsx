import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Palmtree, Loader2 } from 'lucide-react';
import api from '../services/api';
import { toast } from './Toast';

/**
 * Absence et suppléance (migration 042). Pendant l'absence déclarée, les
 * nouvelles tâches de validation et les nouveaux courriers vont au suppléant,
 * « pour le compte de » l'absent.
 *   - mode carte (profil) : déclarer, modifier, lever ;
 *   - mode bandeau (accueil) : rappel discret quand l'absence est en cours.
 */
const fr = (v) => (v ? v.split('-').reverse().join('/') : '');

const AbsenceCarte = ({ bandeau = false }) => {
  const [absence, setAbsence] = useState(undefined);
  const [collegues, setCollegues] = useState([]);
  const [f, setF] = useState({ du: new Date().toISOString().slice(0, 10), au: '', suppleant_id: '', motif: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api.get('/absence').then((r) => {
      setAbsence(r.data.absence);
      if (r.data.absence) setF({ du: r.data.absence.du, au: r.data.absence.au, suppleant_id: r.data.absence.suppleant_id, motif: r.data.absence.motif || '' });
    }).catch(() => setAbsence(null));
    if (!bandeau) api.get('/absence/collegues').then((r) => setCollegues(r.data)).catch(() => {});
  }, [bandeau]);

  if (bandeau) {
    if (!absence?.en_cours) return null;
    return (
      <p className="mt-6 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex flex-wrap items-center gap-2">
        <Palmtree size={16} /> Vous êtes déclaré absent jusqu'au {fr(absence.au)} : vos nouvelles tâches vont à {absence.suppleant_nom}.
        <Link to="/profile" className="font-bold underline ml-auto">Je suis de retour</Link>
      </p>
    );
  }

  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await api.put('/absence', f);
      setAbsence(r.data.absence);
      toast.success('Absence enregistrée');
    } catch (err) { toast.error(err.response?.data?.message || 'Absence non enregistrée'); } finally { setEnvoi(false); }
  };
  const lever = async () => {
    setEnvoi(true);
    try { await api.delete('/absence'); setAbsence(null); toast.success('Absence levée : vous recevez de nouveau vos tâches'); } catch { toast.error('Action impossible'); } finally { setEnvoi(false); }
  };

  return (
    <div className="glass-card-premium p-5 md:p-8 animate-fade-in-up delay-200" id="absence">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><Palmtree size={20} /></div>
        <div>
          <h2 className="text-lg md:text-xl font-bold text-slate-800">Absence et suppléance</h2>
          <p className="text-sm text-slate-500">Congé, mission, formation : vos visas et vos courriers ne restent pas en attente.</p>
        </div>
      </div>
      {absence === undefined ? <Loader2 size={20} className="animate-spin text-slate-400" /> : (
        <form onSubmit={enregistrer} className="grid gap-4 sm:grid-cols-2">
          {absence && (
            <p className={`sm:col-span-2 p-3 rounded-xl text-sm ${absence.en_cours ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-slate-700'}`}>
              {absence.en_cours ? 'Absence en cours' : 'Absence prévue'} du {fr(absence.du)} au {fr(absence.au)}. Suppléant : <b>{absence.suppleant_nom}</b>.
            </p>
          )}
          <label className="block text-xs font-bold text-slate-600">Du<input type="date" required className="input-premium mt-1" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} /></label>
          <label className="block text-xs font-bold text-slate-600">Au (inclus)<input type="date" required min={f.du} className="input-premium mt-1" value={f.au} onChange={(e) => setF({ ...f, au: e.target.value })} /></label>
          <label className="block text-xs font-bold text-slate-600">Suppléant
            <select required className="input-premium mt-1" value={f.suppleant_id} onChange={(e) => setF({ ...f, suppleant_id: e.target.value })}>
              <option value="">Choisir un collègue…</option>
              {collegues.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.section ? ` — ${c.section}` : ''}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">Motif (facultatif)<input className="input-premium mt-1" placeholder="Congé annuel, mission…" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></label>
          <p className="sm:col-span-2 text-xs text-slate-500">Pendant cette période, les nouvelles tâches de validation et les nouveaux courriers qui vous reviennent vont à votre suppléant, « pour votre compte ». Ce qui vous est déjà confié reste chez vous : déléguez-le depuis « Mes tâches » si besoin.</p>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={envoi} className="btn-primary">{absence ? 'Modifier' : "Déclarer l'absence"}</button>
            {absence && <button type="button" disabled={envoi} onClick={lever} className="btn-secondary">{absence.en_cours ? 'Je suis de retour' : "Annuler l'absence"}</button>}
          </div>
        </form>
      )}
    </div>
  );
};

export default AbsenceCarte;
