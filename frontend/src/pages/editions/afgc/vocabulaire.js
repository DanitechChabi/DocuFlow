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

/** Références lisibles : type, n° de dossier, n° d'acte, année. */
export function references(d) {
  return [
    d.type_document,
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

/**
 * Plusieurs dossiers collés d'un coup (une colonne copiée dans Excel ou dans
 * un e-mail) : une ligne par dossier. Dans une ligne copiée d'un tableur, les
 * cellules sont séparées par des tabulations : le premier texte est
 * l'entreprise, les références (chiffres, sans espace) le n° de dossier puis
 * le n° d'acte, un nombre de quatre chiffres l'année. Une ligne de titres en
 * tête est ignorée.
 */
export function analyserCollage(texte, types = []) {
  const lignes = String(texte || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lignes.length > 1 && !/\d/.test(lignes[0]) && /raison|entreprise|soci[eé]t[eé]|client|dossier|n°|acte|type/i.test(lignes[0])) lignes.shift();
  return lignes.map((ligne) => {
    const d = { nom_entreprise: '', num_dossier: '', num_acte: '', annee: '', type_document: '' };
    for (const c of ligne.split('\t').map((x) => x.trim()).filter(Boolean)) {
      const typeSeul = typeDeCellule(c, types);
      if (typeSeul && !d.type_document) { d.type_document = typeSeul; continue; }
      if (!d.annee && /^(19|20)\d{2}$/.test(c)) { d.annee = c; continue; }
      const det = detecterType(c, types);
      if (det.acte) {
        if (!d.num_acte) d.num_acte = c;
        if (!d.type_document) d.type_document = det.type;
      } else if (ressembleAReference(det.reste)) {
        if (!d.num_dossier) d.num_dossier = det.reste;
        else if (!d.num_acte) d.num_acte = det.reste;
      } else if (!d.nom_entreprise) {
        d.nom_entreprise = det.reste;
        if (det.type && !d.type_document) d.type_document = det.type;
      }
    }
    return d;
  }).filter((d) => d.nom_entreprise || d.num_dossier || d.num_acte);
}

// ----------------------------------------------------------------------------
// Types de dossier (attestation, bonne exécution (CBE), caution douanière
// (CD)…) : la liste est réglée pour l'organisation ; le sigle entre
// parenthèses sert à reconnaître le type dans une saisie.
// ----------------------------------------------------------------------------

const sansAccents = (s) => String(s || '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** « Bonne exécution (CBE) » → « CBE ». */
export const sigleDuType = (libelle) => (/\(([A-Za-z]{2,6})\)\s*$/.exec(String(libelle || '')) || [])[1] || null;

/**
 * Devine le type de dossier dans une saisie, sans rien imposer :
 *  - un n° d'acte qui commence par un sigle (« CBE-2025-0147 ») ;
 *  - un sigle en tête ou en fin (« CBE Agro Fictive du Zou ») ;
 *  - le nom du type en tête ou en fin (« Attestation Agro Fictive du Zou »).
 * @param {string} saisie
 * @param {{value: string, label: string}[]} types
 * @returns {{ type: string, reste: string, acte: boolean }} `reste` : la saisie
 *   sans le mot du type ; `acte` : la saisie est un n° d'acte.
 */
export function detecterType(saisie, types) {
  const brut = sansAccents(String(saisie || '').trim()) === String(saisie || '').trim() ? String(saisie || '').trim() : String(saisie || '').trim().normalize('NFC');
  if (!brut || !Array.isArray(types) || !types.length) return { type: '', reste: brut, acte: false };
  const plat = sansAccents(brut).toLowerCase();
  for (const t of types) {
    const sigle = sigleDuType(t.label)?.toLowerCase();
    if (sigle && new RegExp(`^${sigle}[-/ ]?\\d`).test(plat) && !/\s/.test(plat)) return { type: t.value, reste: brut, acte: true };
  }
  for (const t of types) {
    const sigle = sigleDuType(t.label)?.toLowerCase();
    const nom = sansAccents(String(t.label).replace(/\s*\([^)]*\)\s*$/, '')).toLowerCase().trim();
    const essais = [sigle && `${sigle}`, nom.length >= 3 && echapper(nom)].filter(Boolean);
    for (const motif of essais) {
      const m = new RegExp(`^${motif}(?:\\s*[:–-]\\s*|\\s+)|(?:\\s*[:–-]\\s*|\\s+)${motif}$`).exec(plat);
      if (m) {
        const reste = (brut.slice(0, m.index) + brut.slice(m.index + m[0].length)).trim();
        if (reste) return { type: t.value, reste, acte: false };
      }
    }
  }
  return { type: '', reste: brut, acte: false };
}

/** Le type reconnu dans une cellule (« CBE », « Bonne exécution »…), ou ''. */
export function typeDeCellule(valeur, types) {
  const v = sansAccents(String(valeur ?? '').trim()).toLowerCase();
  if (!v || !Array.isArray(types)) return '';
  const t = types.find((x) => {
    const sigle = sigleDuType(x.label)?.toLowerCase();
    const nom = sansAccents(String(x.label).replace(/\s*\([^)]*\)\s*$/, '')).toLowerCase().trim();
    return v === sansAccents(x.value).toLowerCase() || v === nom || (sigle && v === sigle);
  });
  return t ? t.value : '';
}
