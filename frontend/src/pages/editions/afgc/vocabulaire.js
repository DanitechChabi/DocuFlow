// ============================================================================
// Vocabulaire de l'archive de l'AFGC : un dossier est DEMANDÉ, puis TRANSMIS,
// puis RETOURNÉ. Pas d'étape intermédiaire (« trouvé », « en recherche ») :
// elle encombrait sans rien dire d'utile à l'agent.
// ============================================================================

export const TONS = {
  vert: 'bg-green-50 text-green-700',
  ambre: 'bg-amber-50 text-amber-700',
  rouge: 'bg-red-50 text-red-700',
  gris: 'bg-slate-100 text-slate-500',
  bleu: 'bg-sky-50 text-sky-700',
};

/**
 * État d'une demande seule (ligne de /requests/my-requests ou /requests/all,
 * annotée par le registre des prêts : loan_etat, loan_retour_prevu).
 * @returns {{ cle: 'demande'|'transmis'|'retourne'|'servi'|'annule', texte: string, ton: string }}
 */
export function etatDemande(d) {
  if (d.loan_etat === 'retourne') return { cle: 'retourne', texte: 'Retourné', ton: 'gris' };
  if (d.loan_etat === 'en_retard') return { cle: 'transmis', texte: 'Transmis · retour en retard', ton: 'rouge' };
  if (d.loan_etat === 'signale') return { cle: 'transmis', texte: 'Transmis · signalé', ton: 'ambre' };
  if (d.loan_etat === 'en_cours') return { cle: 'transmis', texte: 'Transmis', ton: 'vert' };
  if (d.statut === 'livré') return { cle: 'servi', texte: 'Copie numérique transmise', ton: 'bleu' };
  if (d.statut === 'annulé') return { cle: 'annule', texte: 'Annulé', ton: 'gris' };
  if (d.statut === 'rejete') return { cle: 'annule', texte: 'Refusé', ton: 'rouge' };
  return { cle: 'demande', texte: 'Demandé', ton: 'ambre' };
}

/** État d'un dossier de liste (détail d'une liste : etat + en_retard). */
export function etatDossierListe(d) {
  if (d.etat === 'retourne') return { cle: 'retourne', texte: 'Retourné', ton: 'gris' };
  if (d.etat === 'transmis') return d.en_retard
    ? { cle: 'transmis', texte: 'Transmis · retour en retard', ton: 'rouge' }
    : { cle: 'transmis', texte: 'Transmis', ton: 'vert' };
  if (d.etat === 'servi') return { cle: 'servi', texte: 'Copie numérique transmise', ton: 'bleu' };
  if (d.etat === 'annule') return { cle: 'annule', texte: 'Annulé', ton: 'gris' };
  return { cle: 'demande', texte: 'Demandé', ton: 'ambre' };
}

/** Comment désigner un dossier : l'entreprise d'abord, sinon la description. */
export function intitule(d) {
  return d.nom_entreprise || d.description || (d.num_dossier ? `Dossier ${d.num_dossier}` : 'Dossier sans intitulé');
}

/** Références lisibles : n° de dossier, n° d'acte, année. */
export function references(d) {
  return [
    d.num_dossier && `Dossier ${d.num_dossier}`,
    d.num_acte && `Acte ${d.num_acte}`,
    d.annee && String(d.annee),
  ].filter(Boolean).join(' · ');
}

/** AAAA-MM-JJ (ou date ISO) → JJ/MM/AAAA. */
export function dateCourte(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s;
}

/** Une saisie libre ressemble-t-elle à une référence (n° de dossier ou d'acte) plutôt qu'à un nom ? */
export function ressembleAReference(texte) {
  const s = String(texte || '').trim();
  return /\d/.test(s) && !/\s/.test(s) && s.length <= 50;
}
