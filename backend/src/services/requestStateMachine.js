/**
 * Machine à états des demandes — source de vérité unique du cycle de vie.
 * Cycle : en attente → à traiter → transmis → livré
 * États terminaux : rejete, annulé
 *
 * Chaque transition est horodatée dans la table `request_history` (voir migration 003),
 * ce qui permet le SLA et le reporting.
 */

const STATUSES = [
  { key: 'en attente', label: 'En attente', step: 1 },
  { key: 'a traiter',  label: 'À traiter',  step: 2 },
  { key: 'transmis',   label: 'Transmis',   step: 3 },
  { key: 'livré',      label: 'Livré',      step: 4 },
  { key: 'rejete',     label: 'Rejeté',     step: 99 },
  { key: 'annulé',     label: 'Annulé',     step: 99 },
];

// Transitions autorisées : état courant → liste des états suivants possibles
const TRANSITIONS = {
  'en attente': ['a traiter', 'rejete', 'annulé'],
  'a traiter':  ['transmis', 'rejete', 'annulé'],
  'transmis':   ['livré', 'rejete', 'annulé'],
  'livré':      [],
  'rejete':     [],
  'annulé':     [],
};

const TERMINAL = new Set(['livré', 'rejete', 'annulé']);
const STAFF_ROLES = new Set(['archiviste', 'admin', 'superadmin']);

const isValidStatus = (status) => STATUSES.some((s) => s.key === status);
const isTerminal = (status) => TERMINAL.has(status);
const isStaffRole = (role) => STAFF_ROLES.has(role);
const label = (status) => (STATUSES.find((s) => s.key === status) || {}).label || status;

/**
 * Vérifie qu'une transition est autorisée (état + rôle).
 * @param {Object} p - { from, to, role, isOwner }
 * @returns {{ ok: boolean, reason?: string }}
 */
function canTransition({ from, to, role, isOwner }) {
  if (!isValidStatus(to)) {
    return { ok: false, reason: `Statut inconnu : « ${to} »` };
  }
  if (from === to) {
    return { ok: false, reason: 'La demande est déjà dans ce statut.' };
  }
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Transition non autorisée : « ${label(from)} » → « ${label(to)} ». Étapes possibles : ${allowed.map(label).join(', ') || 'aucune (état final)'}.`,
    };
  }
  if (role === 'demandeur') {
    if (to !== 'annulé') {
      return { ok: false, reason: 'Le demandeur ne peut qu\'annuler sa propre demande.' };
    }
    if (!isOwner) {
      return { ok: false, reason: 'Vous ne pouvez annuler que vos propres demandes.' };
    }
  }
  return { ok: true };
}

/**
 * Étapes suivantes autorisées pour un rôle donné (pour alimenter l'interface).
 * @returns {Array<{ key: string, label: string }>}
 */
function nextSteps(from, role, isOwner) {
  if (isTerminal(from)) return [];
  return (TRANSITIONS[from] || [])
    .map((key) => ({ key, label: label(key) }))
    .filter((step) => canTransition({ from, to: step.key, role, isOwner }).ok);
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  TERMINAL,
  STAFF_ROLES,
  isValidStatus,
  isTerminal,
  isStaffRole,
  label,
  canTransition,
  nextSteps,
};
