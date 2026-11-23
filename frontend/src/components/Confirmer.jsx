import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

// ============================================================================
// confirmer() : la boîte de confirmation de l'application, appelée comme
// window.confirm mais attendue (await) :
//   if (!(await confirmer('Supprimer ce lien ?'))) return;
//   await confirmer({ titre, message, libelle: 'Supprimer', type: 'danger' })
// <ConfirmerHote /> est monté une fois (App).
// ============================================================================
let ouvrir = null;

export function confirmer(options) {
  const o = typeof options === 'string' ? { message: options } : (options || {});
  // Sans hôte monté (test, écran isolé) : la fenêtre du navigateur.
  if (!ouvrir) return Promise.resolve(window.confirm(o.message || o.titre || 'Confirmer ?'));
  return new Promise((resoudre) => ouvrir({ ...o, resoudre }));
}

/** Devine le ton d'une confirmation d'après ses mots (supprimer, révoquer… = danger). */
const tonDe = (texte) => (/supprim|révoqu|élimin|vider|effac|perdu/i.test(texte) ? 'danger' : 'info');

export const ConfirmerHote = () => {
  const [demande, setDemande] = useState(null);
  useEffect(() => { ouvrir = setDemande; return () => { ouvrir = null; }; }, []);
  if (!demande) return null;
  const fermer = (reponse) => { demande.resoudre(reponse); setDemande(null); };
  const message = demande.message || '';
  // Le titre : la première phrase (« Supprimer ce lien ? »), le reste en détail.
  const [premiere, ...reste] = message.split(/(?<=[?.])\s+/);
  return (
    <ConfirmDialog
      isOpen
      title={demande.titre || premiere}
      message={demande.titre ? message : reste.join(' ')}
      confirmLabel={demande.libelle || /^(Supprimer|Révoquer|Vider|Exécuter|Transmettre|Restaurer|Archiver|Éliminer)\b/.exec(premiere)?.[1] || 'Confirmer'}
      type={demande.type || tonDe(message)}
      onConfirm={() => fermer(true)}
      onClose={() => fermer(false)}
    />
  );
};
