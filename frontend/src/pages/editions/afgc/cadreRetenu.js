// Le motif de demande (consultation, solde créditeur…) retenu sur ce poste :
// une préférence de confort, pas une donnée — en navigation privée, ou si le
// stockage est refusé, on retombe simplement sur le premier cadre proposé.
const CLE = 'docuflow:afgc:cadre';

export const lireCadre = () => {
  try { return localStorage.getItem(CLE) || ''; } catch { return ''; }
};

export const ecrireCadre = (valeur) => {
  try { localStorage.setItem(CLE, valeur); } catch { /* stockage indisponible */ }
};

/**
 * Le motif retenu s'il est toujours proposé, sinon le premier motif habituel
 * du département de l'agent, sinon le premier de la liste.
 */
export const cadreActif = (cadres, habituels = []) => {
  const retenu = lireCadre();
  return cadres.some((c) => c.value === retenu) ? retenu : habituels[0]?.value || cadres[0]?.value || '';
};
