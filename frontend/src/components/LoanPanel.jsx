import React, { useState } from 'react';
import { BookOpenCheck, Undo2, AlertTriangle, CheckCircle2, Loader2, Flag } from 'lucide-react';
import { requestService } from '../services/requestService';
import { authService } from '../services/authService';
import { usePermissions } from '../hooks/usePermissions';
import { useSettings } from '../contexts/SettingsContext';
import { toast } from './Toast';
import { ETATS_PRET, dateCourte, dateHeure } from '../utils/demande';

/**
 * LoanPanel — le dossier physique d'une demande (migration 025).
 *
 * Côté archive (requests.process) : remettre le dossier à l'agent, puis
 * enregistrer son retour. Côté agent (auteur de la demande) : voir ce qu'il a
 * en main et jusqu'à quand, signaler une remise qu'il n'a pas reçue,
 * confirmer la réception si l'organisation l'exige.
 *
 * Pas de signature : la remise enregistrée par l'archiviste et notifiée à
 * l'agent vaut accusé de réception tacite ; le journal d'audit fait foi.
 */
const aujourdhuiPlus = (jours) => {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const Badge = ({ etat }) => {
  const e = ETATS_PRET[etat];
  return e ? <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${e.classe}`}>{e.libelle}</span> : null;
};

const LoanPanel = ({ request, loan, requireConfirmation = false, onDone }) => {
  const { can } = usePermissions();
  const settings = useSettings();
  const user = authService.getCurrentUser();
  const archive = can('requests.process');
  const estEmprunteur = loan ? loan.emprunteur_id === user?.id : request.id_user === user?.id;

  const [ouvert, setOuvert] = useState(null); // 'remise' | 'retour' | 'signalement'
  const [dateRetour, setDateRetour] = useState(() => aujourdhuiPlus(Number(settings.loan_default_days) || 7));
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(false);

  const terminale = ['livré', 'rejete', 'annulé'].includes(request.statut);
  if (!loan && (!archive || terminale)) return null;

  const agir = async (fn, succes) => {
    setOccupe(true);
    try {
      const res = await fn();
      toast.success(res?.message || succes);
      if (res?.indexation && res.indexation.ok === false) {
        toast.error(`Dossier remis, mais le scan n'a pas été versé dans la GED : ${res.indexation.message}`);
      }
      setOuvert(null);
      setTexte('');
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    } finally {
      setOccupe(false);
    }
  };

  const champ = 'w-full input-premium';

  return (
    <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <BookOpenCheck size={14} /> Dossier physique
        </h3>
        {loan && <Badge etat={loan.etat} />}
      </div>

      {/* --- Aucun prêt : l'archive peut remettre le dossier --- */}
      {!loan && (
        ouvert === 'remise' ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); agir(() => requestService.remettreDossier(request.id, { date_retour_prevue: dateRetour, observation: texte }), 'Dossier remis'); }}>
            <label className="block text-xs font-bold text-slate-500" htmlFor="pret-retour">À retourner avant le</label>
            <input id="pret-retour" type="date" className={champ} value={dateRetour} min={aujourdhuiPlus(0)} onChange={(e) => setDateRetour(e.target.value)} required />
            <label className="block text-xs font-bold text-slate-500" htmlFor="pret-obs">Observation <span className="font-normal text-slate-400">(facultatif — cote, boîte, état du dossier…)</span></label>
            <input id="pret-obs" className={champ} value={texte} maxLength={1000} onChange={(e) => setTexte(e.target.value)} placeholder="Ex. : boîte 12, rayon B — 45 feuillets" />
            <p className="text-[11px] text-slate-400">
              Vous l'avez numérisé ? Joignez le scan dans « Pièces jointes » avant de remettre : il sera versé dans la GED,
              et la prochaine demande de ce dossier pourra être servie en numérique.
            </p>
            <div className="flex gap-2">
              <button type="submit" disabled={occupe} className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5">
                {occupe ? <Loader2 size={16} className="animate-spin" /> : <BookOpenCheck size={16} />} Remettre à l'agent
              </button>
              <button type="button" onClick={() => setOuvert(null)} className="btn-secondary px-4">Annuler</button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-slate-500">Le dossier est en papier ? Remettez-le à l'agent : la demande passe « Livré » et l'agent est prévenu.</p>
            <button onClick={() => setOuvert('remise')} className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5">
              <BookOpenCheck size={16} /> Remettre le dossier physique
            </button>
          </>
        )
      )}

      {/* --- Prêt en cours ou terminé --- */}
      {loan && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-slate-400">Remis le</dt><dd className="text-slate-700">{dateHeure(loan.remis_at)}</dd></div>
            <div><dt className="text-xs text-slate-400">Par</dt><dd className="text-slate-700">{loan.remis_par_name || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Retour prévu</dt><dd className={loan.etat === 'en_retard' ? 'text-red-600 font-bold' : 'text-slate-700'}>{dateCourte(loan.date_retour_prevue)}</dd></div>
            {loan.retourne_at && <div><dt className="text-xs text-slate-400">Retourné le</dt><dd className="text-slate-700">{dateHeure(loan.retourne_at)}</dd></div>}
          </dl>
          {loan.observation_remise && <p className="text-xs text-slate-500">Remise : {loan.observation_remise}</p>}
          {loan.observation_retour && <p className="text-xs text-slate-500">Retour : {loan.observation_retour}</p>}
          {loan.reception_confirmee_at && (
            <p className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={14} /> Réception confirmée le {dateHeure(loan.reception_confirmee_at)}</p>
          )}
          {loan.signalement && !loan.retourne_at && (
            <p className="text-xs p-2.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 flex gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> Signalé le {dateHeure(loan.signale_at)} : {loan.signalement}
            </p>
          )}

          {/* L'agent : ce qu'il a en main */}
          {estEmprunteur && !loan.retourne_at && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                Ce dossier vous a été remis : merci de le retourner aux archives avant le <b>{dateCourte(loan.date_retour_prevue)}</b>.
              </p>
              {requireConfirmation && !loan.reception_confirmee_at && (
                <button onClick={() => agir(() => requestService.confirmerPret(request.id), 'Réception confirmée')} disabled={occupe}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
                  <CheckCircle2 size={16} /> Confirmer la réception
                </button>
              )}
              {ouvert === 'signalement' ? (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); agir(() => requestService.signalerPret(request.id, texte), 'Signalement transmis'); }}>
                  <textarea className={`${champ} min-h-[4.5rem]`} value={texte} maxLength={1000} required autoFocus
                    onChange={(e) => setTexte(e.target.value)} placeholder="Ex. : je n'ai pas reçu ce dossier." aria-label="Décrivez le problème" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={occupe} className="btn-primary flex-1 py-2">Envoyer aux archives</button>
                    <button type="button" onClick={() => setOuvert(null)} className="btn-secondary px-4">Annuler</button>
                  </div>
                </form>
              ) : !loan.signalement && (
                <button onClick={() => setOuvert('signalement')} className="text-xs font-bold text-slate-500 hover:text-amber-700 flex items-center gap-1">
                  <Flag size={13} /> Un problème avec cette remise ? Signalez-le
                </button>
              )}
            </div>
          )}
          {estEmprunteur && loan.retourne_at && (
            <p className="text-sm text-emerald-700">Retour enregistré : vous êtes déchargé de ce dossier.</p>
          )}

          {/* L'archive : enregistrer le retour — jamais par l'emprunteur lui-même */}
          {archive && !estEmprunteur && !loan.retourne_at && (
            ouvert === 'retour' ? (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); agir(() => requestService.retournerDossier(request.id, { observation: texte }), 'Retour enregistré'); }}>
                <input className={champ} value={texte} maxLength={1000} autoFocus onChange={(e) => setTexte(e.target.value)}
                  placeholder="Facultatif — ex. : rangé dans la boîte 12" aria-label="Observation de retour" />
                <div className="flex gap-2">
                  <button type="submit" disabled={occupe} className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5">
                    {occupe ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />} Enregistrer le retour
                  </button>
                  <button type="button" onClick={() => setOuvert(null)} className="btn-secondary px-4">Annuler</button>
                </div>
              </form>
            ) : (
              <button onClick={() => setOuvert('retour')} className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5">
                <Undo2 size={16} /> Marquer comme retourné
              </button>
            )
          )}
        </>
      )}
    </div>
  );
};

export default LoanPanel;
