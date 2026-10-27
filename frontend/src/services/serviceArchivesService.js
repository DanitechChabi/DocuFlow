import api from './api';

/** Copies certifiées conformes (039) et rapport annuel (art. 31 et 36). */
export const serviceArchivesService = {
  delivrer: async (documentId, corps) => (await api.post(`/documents/${documentId}/copies-certifiees`, corps)).data,
  copiesDocument: async (documentId) => (await api.get(`/documents/${documentId}/copies-certifiees`)).data,
  registre: async (annee) => (await api.get('/archives/copies-certifiees', { params: annee ? { annee } : {} })).data,
  verifier: async (numero, empreinte) => (await api.get(`/archives/copies-certifiees/${encodeURIComponent(numero)}/verification`, { params: empreinte ? { empreinte } : {} })).data,
  rapport: async (annee) => (await api.get(`/archives/rapport-annuel/${annee}`)).data,
  /** Télécharge l'exemplaire du registre (PDF tel que remis). */
  telecharger: async (numero) => {
    const r = await api.get(`/archives/copies-certifiees/${encodeURIComponent(numero)}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${numero}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};

/** SHA-256 d'un fichier choisi par l'utilisateur, calculé dans le navigateur. */
export async function empreinteFichier(fichier) {
  const octets = await fichier.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
