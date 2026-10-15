// ============================================================================
// fileTicket — autorisation de courte durée pour les URL de fichiers.
//
// `<img src>` et `<a href>` ne peuvent pas porter d'en-tête Authorization :
// le navigateur les requête lui-même, sans passer par notre client HTTP. Le
// ticket est donc la SEULE donnée d'autorisation portée par ces URL — jamais
// le jeton de session (qui, lui, vit jusqu'à 365 jours selon le réglage de
// l'organisation et n'a rien à faire dans un journal serveur ou un historique
// de navigateur).
//
// Il reste volontairement étroit : signé avec le même secret que la session
// (JWT_SECRET, aucun secret supplémentaire à provisionner), valide 5 minutes,
// et scellé sur UN fichier précis (`kind` + `fileId`) — un ticket minté pour
// un fichier ne vaut pas pour un autre si l'appelant change le paramètre
// d'URL. La route qui le consomme revérifie quand même les droits en direct
// (ACL / appartenance) : le ticket prouve qui demande, pas qu'il a toujours
// le droit.
// ============================================================================
const jwt = require('jsonwebtoken');

const TICKET_TTL = '5m';
const TICKET_TYPE = 'file_ticket';

function mintFileTicket({ uid, tenantId, kind, fileId }) {
  return jwt.sign(
    { typ: TICKET_TYPE, uid, tenantId, kind, fileId },
    process.env.JWT_SECRET,
    { expiresIn: TICKET_TTL }
  );
}

/**
 * @returns {object|null} les revendications du ticket si valide ET conforme
 *   au couple (kind, fileId) attendu par la route appelée, sinon null.
 */
function verifyFileTicket(ticket, { kind, fileId }) {
  if (!ticket) return null;
  let decoded;
  try {
    decoded = jwt.verify(ticket, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (decoded.typ !== TICKET_TYPE) return null;
  if (decoded.kind !== kind) return null;
  if (String(decoded.fileId) !== String(fileId)) return null;
  return decoded;
}

module.exports = { mintFileTicket, verifyFileTicket };
