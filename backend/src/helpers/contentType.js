/**
 * En-tête Content-Type d'un fichier servi. Un fichier texte sans charset est
 * lu en Latin-1 par les navigateurs : « Comptabilité » s'affichait
 * « ComptabilitÃ© » dans l'aperçu. Les fichiers texte versés dans DocuFlow
 * sont en UTF-8 (c'est aussi l'encodage de l'extraction de texte).
 */
function typeContenu(mime) {
  const m = mime || 'application/octet-stream';
  return /^text\//.test(m) && !/charset=/i.test(m) ? `${m}; charset=utf-8` : m;
}

module.exports = { typeContenu };
