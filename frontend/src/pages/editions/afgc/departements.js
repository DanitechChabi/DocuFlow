import { edition } from '../../../editions';

// ============================================================================
// Départements de l'AFGC et motifs habituels de leurs demandes : le
// Commercial (DC) demande surtout des consultations, prorogations,
// actualisations et renouvellements ; l'Engagement (DE), des restitutions de
// provision, soldes créditeurs et levées d'engagement. Ces motifs sont
// proposés en premier ; les autres restent à un clic.
// ============================================================================

/** Forme comparable d'un libellé : sans accents ni casse, chaque mot sans marque du pluriel. */
export const plat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((m) => (m.length > 2 ? m.replace(/[sx]$/, '') : m)).join(' ');

/**
 * Le département d'une section : « DE — Engagement », « DE », « Engagements »
 * ou « Direction commerciale » désignent tous un département de l'édition.
 * @returns {{ sigle: string, nom: string, motifs: string[] } | null}
 */
export function departementDe(section) {
  const s = plat(section);
  if (!s) return null;
  const premier = s.split(' ')[0];
  return (edition?.departements || []).find((d) => premier === plat(d.sigle) || s.includes(plat(d.nom))) || null;
}

/** Les motifs habituels d'une section, parmi ceux que l'organisation propose, dans leur ordre. */
export function motifsHabituels(section, cadres) {
  const d = departementDe(section);
  if (!d?.motifs?.length) return [];
  return d.motifs
    .map((m) => cadres.find((c) => plat(c.value) === plat(m) || plat(c.label) === plat(m)))
    .filter((c, i, tous) => c && tous.indexOf(c) === i);
}

const SANS = 'Sans département';

/** Les agents rangés par section, pour un choix groupé (« Qui demande ? »). */
export function parDepartement(agents) {
  const groupes = new Map();
  for (const a of agents) {
    const cle = (a.section || '').trim() || SANS;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(a);
  }
  return [...groupes.entries()].sort(([a], [b]) => (a === SANS) - (b === SANS) || a.localeCompare(b, 'fr'));
}
