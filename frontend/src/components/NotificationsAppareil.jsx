import React, { useEffect, useState } from 'react';
import { BellRing, X, Loader2 } from 'lucide-react';
import { toast } from './Toast';
import api from '../services/api';
import { etatNotifications, activerNotifications, desactiverNotifications, rafraichirAbonnement } from '../utils/notificationsAppareil';

// ============================================================================
// Notifications sur cet appareil (058).
//  - <InviteNotifications /> : un bandeau discret, tant que l'appareil n'est
//    pas abonné (masquable, il ne revient pas avant un mois) ;
//  - <ReglageNotifications /> : la ligne du panneau des notifications.
// ============================================================================

const CLE_MASQUE = 'notifications-appareil-masque';
const masqueRecent = () => { try { return Date.now() - Number(localStorage.getItem(CLE_MASQUE) || 0) < 30 * 24 * 3600 * 1000; } catch { return false; } };

function useEtat() {
  const [etat, setEtat] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { etatNotifications().then(setEtat).catch(() => setEtat('impossible')); }, []);
  const activer = async () => {
    setEnvoi(true);
    try {
      setEtat(await activerNotifications());
      await api.post('/push/essai').catch(() => {});
      toast.success('Notifications activées sur cet appareil.');
    } catch (e) {
      setEtat(await etatNotifications().catch(() => 'impossible'));
      toast.error(e.message || 'Activation impossible.');
    } finally { setEnvoi(false); }
  };
  const desactiver = async () => {
    setEnvoi(true);
    try { setEtat(await desactiverNotifications()); toast.success('Notifications désactivées sur cet appareil.'); } finally { setEnvoi(false); }
  };
  return { etat, envoi, activer, desactiver };
}

export const InviteNotifications = () => {
  const { etat, envoi, activer } = useEtat();
  const [masque, setMasque] = useState(masqueRecent);
  // Déjà autorisé : l'abonnement suit le compte connecté.
  useEffect(() => { if (etat === 'actif') rafraichirAbonnement(); }, [etat]);
  if (etat !== 'inactif' || masque) return null;
  const fermer = () => { try { localStorage.setItem(CLE_MASQUE, String(Date.now())); } catch { /* sans gravité */ } setMasque(true); };
  return (
    <div className="mx-4 md:mx-8 mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3 print:hidden">
      <BellRing size={18} className="text-slate-700 shrink-0" />
      <p className="text-sm text-slate-700 flex-1 min-w-52">
        Recevez les actions importantes sur cet ordinateur (demande reçue, dossier transmis, retard), même application fermée.
      </p>
      <button type="button" onClick={activer} disabled={envoi}
        className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
        {envoi && <Loader2 size={14} className="animate-spin" />} Activer
      </button>
      <button type="button" onClick={fermer} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Plus tard"><X size={16} /></button>
    </div>
  );
};

export const ReglageNotifications = () => {
  const { etat, envoi, activer, desactiver } = useEtat();
  if (!etat || etat === 'impossible') return null;
  return (
    <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 text-xs">
      <BellRing size={14} className="text-slate-500" />
      <span className="flex-1 text-slate-600">
        {etat === 'actif' ? 'Notifications sur cet appareil : activées' : etat === 'refuse' ? 'Bloquées par le navigateur (réglages du site)' : 'Notifications sur cet appareil'}
      </span>
      {etat === 'actif' && <button type="button" onClick={desactiver} disabled={envoi} className="font-semibold text-slate-500 hover:text-slate-800">Désactiver</button>}
      {etat === 'inactif' && <button type="button" onClick={activer} disabled={envoi} className="font-semibold text-slate-800 hover:underline">Activer</button>}
    </div>
  );
};
