// ============================================================================
// DocuBot : ce qu'il sait FAIRE, en plus de répondre.
//
//   Actions, proposées en bouton et exécutées seulement au clic, par les
//   routes habituelles de l'API (le serveur y vérifie les droits) :
//     « marque le dossier Kanvô comme retourné »    → enregistrer le retour ;
//     « transmets le dossier Agro Wènou à Nadia »   → remettre à l'agent ;
//     « j'ai rapporté le dossier Horizon Tchala »   → l'annoncer à l'archive ;
//     « annule ma demande Agro Wènou »              → annuler ;
//     « je veux le dossier X pour un remboursement »→ la demande, motif compris.
//   Suite de conversation : « il devait le rendre quand ? », « et son point
//   d'entrée ? » portent sur le dossier dont on parlait.
//   Personnes : « les dossiers chez Romaric Akpovi », « qui a le plus de
//   dossiers en retard ? ».
//   Les demandes en attente, listées avec « Transmettre » en un clic.
//   Les fautes de frappe : « mawuli negosse » → Ets Mawuli Négoce.
//
// Rend une réponse, ou null pour laisser DocuBot répondre comme avant.
// ============================================================================

const db = require('../config/db');
const settingsService = require('./settingsService');
const catalog = require('../config/settingsCatalog');
const { normalizeOptions } = require('../helpers/requestOptions');
const { NOM_SIMPLE, nomSimple } = require('../helpers/nomEntreprise');

// docubotService charge ce module : ses outils sont lus à l'appel.
const bot = () => require('./docubotService')._outils;

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plat = (s) => ` ${sansAccents(s).replace(/[^a-z0-9/]+/g, ' ').trim()} `;
const a = (texte, ...motifs) => motifs.some((m) => (m instanceof RegExp ? m.test(texte) : texte.includes(` ${m} `)));
const pluriel = (n, mot, pl = `${mot}s`) => `${n} ${n > 1 ? pl : mot}`;
const echappe = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------------------------------------------------------------------------
// Mémoires courtes (par organisation) : comptes, dénominations.
// ---------------------------------------------------------------------------

const caches = new Map();
async function enCache(cle, duree, charger) {
  const c = caches.get(cle);
  if (c && Date.now() - c.at < duree) return c.valeur;
  const valeur = await charger();
  caches.set(cle, { at: Date.now(), valeur });
  return valeur;
}

const personnes = (tenantId) => enCache(`p:${tenantId}`, 5 * 60000, async () => (await db.query(
  'SELECT id, full_name, username FROM users WHERE tenant_id = $1 AND desactive_le IS NULL AND full_name IS NOT NULL', [tenantId]
).catch(() => ({ rows: [] }))).rows);

const MOTS_NON_PRENOMS = new Set(['admin', 'administrateur', 'afgc', 'archive', 'archives', 'archiviste', 'agent', 'test', 'essai']);

/** La personne nommée (un compte de l'organisation), ou null. `etendu` : le prénom seul suffit. */
async function personneDans(tenantId, question) {
  const s = plat(question);
  const comptes = await personnes(tenantId);
  // Le nom complet, dans un sens ou dans l'autre (« Akpovi Romaric »).
  const complets = comptes
    .map((u) => ({ u, mots: plat(u.full_name).trim().split(' ').filter((m) => m.length >= 2) }))
    .filter((x) => x.mots.length >= 2)
    .sort((x, y) => y.mots.length - x.mots.length);
  for (const { u, mots } of complets) {
    if (s.includes(` ${mots.join(' ')} `) || s.includes(` ${[...mots].reverse().join(' ')} `)) return { ...u, texte: mots.join(' ') };
  }
  // Un prénom ou un nom seul, après « chez », « à », « de », « pour », « par » — s'il est unique.
  for (const m of s.matchAll(/ (?:chez|a|de|pour|par|agent|madame|monsieur|mme|m) ([a-z]{3,})(?= )/g)) {
    const mot = m[1];
    if (MOTS_NON_PRENOMS.has(mot)) continue;
    const qui = complets.filter((x) => x.mots.includes(mot));
    if (qui.length === 1) return { ...qui[0].u, texte: mot };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Motifs et typologies de l'organisation.
// ---------------------------------------------------------------------------

async function options(tenantId) {
  const reglages = await settingsService.getAll(tenantId).catch(() => ({}));
  const defaut = (cle) => catalog.BY_KEY.get(cle)?.default;
  return {
    motifs: normalizeOptions(reglages.request_motifs, defaut('request_motifs')),
    types: normalizeOptions(reglages.request_document_types, defaut('request_document_types')),
  };
}

/** Le motif nommé dans la question (« pour un remboursement » → Remboursement), ou null. */
async function motifDans(tenantId, question) {
  const s = plat(question);
  const { motifs } = await options(tenantId);
  let meilleur = null;
  for (const m of motifs) {
    const cle = plat(m.value).trim();
    if (!cle) continue;
    const mots = cle.split(' ');
    // Le mot entier, ou sa racine pour un mot long (« rembourser » → Remboursement).
    const trouve = s.includes(` ${cle} `) || (mots.length === 1 && cle.length >= 8 && s.includes(` ${cle.slice(0, 7)}`));
    if (trouve && (!meilleur || cle.length > meilleur.cle.length)) meilleur = { valeur: m.value, cle };
  }
  return meilleur?.valeur || null;
}

// ---------------------------------------------------------------------------
// Fautes de frappe : une clé phonétique française, puis une distance d'édition.
// ---------------------------------------------------------------------------

const FORMES = new Set('sarl sa sas sasu suarl ets etablissement etablissements groupe ste societe entreprise entreprises cie compagnie et de du des la le les l d gie'.split(' '));

function motPhonetique(m) {
  let w = m
    .replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/gu(?=[ei])/g, 'g')
    .replace(/c(?=[eiy])/g, 's').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/q/g, 'k')
    .replace(/x/g, 'ks').replace(/y/g, 'i').replace(/w/g, 'ou').replace(/h/g, '')
    .replace(/eau|au/g, 'o').replace(/ai|ei/g, 'e').replace(/en(?=[^aeiou]|$)/g, 'an')
    .replace(/([a-z])\1+/g, '$1');
  if (w.length > 3) w = w.replace(/(es|e|s|t|d|x)$/, '');
  return w;
}

const clePhonetique = (nom) => sansAccents(nom).replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((m) => m && !FORMES.has(m)).map(motPhonetique).filter(Boolean);

function distance(x, y) {
  if (x === y) return 0;
  const d = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let diag = d[0];
    d[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const haut = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = haut;
    }
  }
  return d[y.length];
}

const denominations = (tenantId) => enCache(`d:${tenantId}`, 10 * 60000, async () => {
  const r = await db.query(
    `SELECT DISTINCT denomination AS nom FROM dossiers_entres WHERE tenant_id = $1 AND denomination IS NOT NULL
     UNION SELECT DISTINCT nom_entreprise FROM requests WHERE tenant_id = $1 AND nom_entreprise IS NOT NULL LIMIT 30000`, [tenantId]
  ).catch(() => ({ rows: [] }));
  return r.rows.map((x) => ({ nom: x.nom, cle: clePhonetique(x.nom) })).filter((x) => x.cle.length);
});

/** Le nom enregistré le plus proche de ce qui a été tapé (une ou deux fautes), s'il n'y en a qu'un. */
async function nomProche(tenantId, tape) {
  const cle = clePhonetique(tape);
  const lu = cle.join(' ');
  if (lu.replace(/ /g, '').length < 4) return null;
  const tolerance = lu.length >= 10 ? 2 : 1;
  let meilleur = null;
  let exaequo = false;
  for (const d of await denominations(tenantId)) {
    // On compare à chaque suite de mots de même longueur (« mawuli negosse » ↔ « Mawuli Négoce »).
    for (let i = 0; i + cle.length <= d.cle.length; i += 1) {
      const e = distance(lu, d.cle.slice(i, i + cle.length).join(' '));
      if (e > tolerance) continue;
      if (!meilleur || e < meilleur.e) { meilleur = { nom: d.nom, e }; exaequo = false; } else if (e === meilleur.e && nomSimple(d.nom) !== nomSimple(meilleur.nom)) exaequo = true;
    }
  }
  return meilleur && !exaequo ? meilleur.nom : null;
}

// ---------------------------------------------------------------------------
// Les données : dossiers sortis et demandes en attente, avec leur n° de demande.
// ---------------------------------------------------------------------------

function filtreNom(alias, nom, params) {
  params.push(`%${echappe(nom)}%`, `%${echappe(nomSimple(nom))}%`);
  const n = params.length;
  return `(${alias}.nom_entreprise ILIKE $${n - 1} OR ${alias}.num_acte ILIKE $${n - 1} OR ${alias}.num_dossier ILIKE $${n - 1}
           OR ${NOM_SIMPLE.replace('lower(denomination)', `lower(${alias}.nom_entreprise)`)} LIKE $${n})`;
}

async function pretsOuverts(tenantId, { nom = null, emprunteur = null, retard = false } = {}) {
  const params = [tenantId];
  const conds = ['l.tenant_id = $1', 'l.retourne_at IS NULL'];
  if (nom) conds.push(filtreNom('q', nom, params));
  if (emprunteur) { params.push(emprunteur); conds.push(`l.emprunteur_id = $${params.length}`); }
  if (retard) conds.push('l.date_retour_prevue < CURRENT_DATE');
  const r = await db.query(
    `SELECT l.request_id, q.nom_entreprise, q.num_acte, q.type_document, to_char(l.remis_at, 'YYYY-MM-DD') AS remis_le,
            to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu, (l.date_retour_prevue < CURRENT_DATE) AS en_retard,
            COALESCE(u.full_name, l.emprunteur_nom) AS chez, l.emprunteur_id AS chez_id, (l.rapporte_annonce_at IS NOT NULL) AS annonce
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE ${conds.join(' AND ')}
      ORDER BY l.date_retour_prevue LIMIT 10`, params);
  return r.rows;
}

async function demandesEnAttente(tenantId, { nom = null, demandeur = null, limite = 8 } = {}) {
  const params = [tenantId];
  const conds = ['q.tenant_id = $1', "q.statut IN ('en attente', 'a traiter')",
    '(q.complement_demande_at IS NULL OR q.complement_fourni_at IS NOT NULL)',
    'NOT EXISTS (SELECT 1 FROM request_loans l WHERE l.request_id = q.id AND l.retourne_at IS NULL)'];
  if (nom) conds.push(filtreNom('q', nom, params));
  if (demandeur) { params.push(demandeur); conds.push(`q.id_user = $${params.length}`); }
  params.push(limite);
  const r = await db.query(
    `SELECT q.id, q.nom_entreprise, q.num_acte, q.type_document, q.motif, q.statut, to_char(q.created_at, 'YYYY-MM-DD') AS le,
            u.full_name AS agent, q.id_user, count(*) OVER ()::int AS total
       FROM requests q LEFT JOIN users u ON u.id = q.id_user
      WHERE ${conds.join(' AND ')}
      ORDER BY q.created_at LIMIT $${params.length}`, params);
  return r.rows;
}

const titreDemande = (d) => [d.nom_entreprise, d.type_document].filter(Boolean).join(' · ') || 'Dossier';
const elementDemande = (d, { avecAgent = true } = {}) => ({
  titre: titreDemande(d),
  lignes: [
    d.num_acte && `Acte ${d.num_acte}`,
    [avecAgent && d.agent && `Demandé par **${d.agent}**`, `le ${bot().jourAff(d.le)}`].filter(Boolean).join(' '),
    d.motif && `Motif : ${d.motif}`,
  ].filter(Boolean),
  ton: 'ambre',
});
const prenom = (nom) => String(nom || '').split(' ')[0];

// ---------------------------------------------------------------------------
// Ce que la question demande de faire.
// ---------------------------------------------------------------------------

/** Le dossier nommé, une fois retirés la personne et le motif ; sinon celui dont on parlait. */
async function dossierVise(tenantId, question, { personne = null, motif = null, contexte = null } = {}) {
  let q = question;
  if (personne) q = q.replace(new RegExp(`\\s(?:à|a|chez|pour|de|par)?\\s*${personne.texte.split(' ').map((m) => `${m}\\S*`).join('\\s+')}`, 'i'), ' ');
  if (personne) for (const m of personne.full_name.split(' ')) q = q.replace(new RegExp(`\\b(?:à|a|chez|pour|par)\\s+${m}\\b`, 'i'), ' ');
  if (motif) q = q.replace(/\s(pour|en vue d['’ ]?(une?)?|motif)\s+(une?\s+|la\s+|le\s+|l['’])?[\p{L}' ]+$/iu, ' ');
  // Les verbes d'action ne sont jamais le nom (« marque kanvo comme retourné »).
  q = q.replace(/(^|\s)(marque[rz]?|enregistre[rz]?|note[rz]?|valide[rz]?|confirme[rz]?|comme|retourn[ée]e?s?|revenue?s?|rentr[ée]e?s?|transmets|transmet(?:tre|tez)?|remets|remet(?:tre|tez)?|envoie[rz]?|envoyer|passe[rz]?|annule[rz]?|supprime[rz]?|retire[rz]?|rapport[ée]e?|ramen[ée]e?|d[ée]pos[ée]e?|j['’]ai|je l['’]ai|ma|mes|la|une)(?=\s|$)/gi, ' ');
  const cible = bot().cibleDans(q);
  if (!cible.nom && !cible.acte && contexte?.entreprise) return { nom: contexte.entreprise, acte: null, annee: null, typologie: null, duContexte: true };
  return cible;
}

/** Le nom tel qu'il est enregistré (« Kanvô » → « Sarl Kanvô BTP »), si on le connaît. */
async function nomEnregistre(tenantId, cible, droits) {
  const connu = await bot().cibleConnue(tenantId, cible, { ...droits, archive: true }).catch(() => null);
  if (connu) return { connu, nom: connu.presence.entrees[0]?.denomination || connu.sorties[0]?.nom_entreprise || connu.demandes[0]?.nom_entreprise || cible.nom };
  if (cible.nom && !cible.acte) {
    const proche = await nomProche(tenantId, cible.nom);
    if (proche) {
      const c2 = await bot().cibleConnue(tenantId, { ...cible, nom: proche }, { ...droits, archive: true }).catch(() => null);
      if (c2) return { connu: c2, nom: proche, corrige: true };
    }
  }
  return { connu: null, nom: cible.nom || cible.acte };
}

const libelleCible = (cible) => [cible.nom, cible.acte && `acte ${cible.acte}`].filter(Boolean).join(', ');

// « marque le dossier Kanvô comme retourné », « Kanvô est revenu », « enregistre le retour de… »
async function enregistrerRetour(ctx) {
  const { tenantId, question, droits, contexte } = ctx;
  const cible = await dossierVise(tenantId, question, { contexte });
  if (!cible.nom && !cible.acte) return { texte: 'Quel dossier est revenu ? Donnez-moi le **nom de l\'entreprise** ou le **n° d\'acte**.' };
  const { nom } = await nomEnregistre(tenantId, cible, droits);
  const prets = await pretsOuverts(tenantId, { nom: cible.acte || nom });
  if (!prets.length) {
    return { texte: `Aucun dossier « **${nom}** » n'est sorti en ce moment : il n'y a pas de retour à enregistrer.`, suggestions: [`Où est le dossier ${nom} ?`], contexte: { entreprise: nom } };
  }
  const j = bot().jourAff;
  return {
    texte: prets.length > 1
      ? `**${pluriel(prets.length, 'dossier sorti', 'dossiers sortis')}** pour « ${nom} ». Choisissez celui qui est revenu :`
      : `Le dossier **${prets[0].nom_entreprise}** est chez **${prets[0].chez || '?'}** depuis le ${j(prets[0].remis_le)}. J'enregistre son retour ?`,
    elements: prets.map((p) => bot().ligneSortie(p, true)),
    actions: prets.slice(0, 4).map((p) => ({
      type: 'appel', methode: 'patch', url: `/requests/${p.request_id}/loan/return`, corps: {},
      libelle: prets.length > 1 ? `Retour : ${p.num_acte ? `acte ${p.num_acte}` : p.type_document || p.nom_entreprise} (${prenom(p.chez)})` : 'Enregistrer le retour',
      succes: `Retour enregistré : **${p.nom_entreprise}**${p.num_acte ? `, acte ${p.num_acte}` : ''} est de nouveau aux archives.`,
    })),
    contexte: { entreprise: nom },
  };
}

// « transmets le dossier Agro Wènou à Nadia »
async function transmettre(ctx) {
  const { tenantId, question, droits, contexte } = ctx;
  const personne = await personneDans(tenantId, question);
  const cible = await dossierVise(tenantId, question, { personne, contexte });
  if (!cible.nom && !cible.acte) return { texte: 'Quel dossier faut-il transmettre ? Donnez-moi le **nom de l\'entreprise** ou le **n° d\'acte**.' };
  const { nom } = await nomEnregistre(tenantId, cible, droits);
  let demandes = await demandesEnAttente(tenantId, { nom: cible.acte || nom });
  const pourElle = personne ? demandes.filter((d) => d.id_user === personne.id) : demandes;
  const dehors = await pretsOuverts(tenantId, { nom: cible.acte || nom });
  if (!demandes.length) {
    const lignes = [`Personne n'a de demande en attente pour « **${nom}** » : un dossier se transmet à partir d'une demande.`];
    if (dehors.length) lignes.push(`Il est d'ailleurs **sorti** chez **${dehors[0].chez || '?'}** (retour prévu le ${bot().jourAff(dehors[0].retour_prevu)}).`);
    return { texte: lignes.join('\n'), actions: [{ type: 'lien', libelle: 'Faire une demande pour un agent', vers: '/demandes/a-traiter' }], contexte: { entreprise: nom } };
  }
  if (personne && !pourElle.length) {
    return {
      texte: `**${personne.full_name}** n'a pas de demande en attente pour « ${nom} ». Les demandes en attente pour ce dossier :`,
      elements: demandes.map((d) => elementDemande(d)),
      actions: demandes.slice(0, 3).map((d) => actionTransmettre(d)),
      contexte: { entreprise: nom },
    };
  }
  demandes = pourElle;
  const lignes = [demandes.length > 1
    ? `**${pluriel(demandes.length, 'demande')} en attente** pour « ${nom} ». À qui le transmettre ?`
    : `**${demandes[0].agent}** a demandé **${demandes[0].nom_entreprise}** le ${bot().jourAff(demandes[0].le)}. Je le lui transmets ?`];
  if (dehors.length) lignes.push(`Attention : un dossier « ${nom} » est déjà **sorti** chez **${dehors[0].chez || '?'}**. Vérifiez qu'il s'agit bien d'un autre exemplaire.`);
  return { texte: lignes.join('\n'), elements: demandes.map((d) => elementDemande(d)), actions: demandes.slice(0, 4).map((d) => actionTransmettre(d)), contexte: { entreprise: nom } };
}

const actionTransmettre = (d) => ({
  type: 'appel', methode: 'post', url: `/requests/${d.id}/loan`, corps: {},
  libelle: `Transmettre à ${d.agent || 'l\'agent'}`,
  succes: `**${d.nom_entreprise}** transmis à **${d.agent || 'l\'agent'}**. Il est maintenant dans les dossiers sortis, avec sa date de retour.`,
});

// « j'ai rapporté le dossier Horizon Tchala »
async function annoncerRetour(ctx) {
  const { tenantId, question, droits, contexte } = ctx;
  const cible = await dossierVise(tenantId, question, { contexte });
  const miens = await pretsOuverts(tenantId, { nom: cible.acte || cible.nom || null, emprunteur: droits.userId });
  if (!miens.length) {
    return cible.nom || cible.acte
      ? { texte: `Vous n'avez pas de dossier « **${libelleCible(cible)}** » en cours : rien à annoncer.`, suggestions: ['Ai-je des dossiers à rendre ?'] }
      : { texte: 'Vous n\'avez aucun dossier à rendre.' };
  }
  const aAnnoncer = miens.filter((p) => !p.annonce);
  if (!aAnnoncer.length) {
    return { texte: `C'est déjà signalé : l'archive sait que vous avez rapporté **${miens[0].nom_entreprise}**. Elle confirmera le retour en le rangeant.`, contexte: { entreprise: miens[0].nom_entreprise } };
  }
  return {
    texte: aAnnoncer.length > 1 && !(cible.nom || cible.acte)
      ? 'Lequel avez-vous rapporté ?'
      : `Je préviens l'archive que vous avez rapporté **${aAnnoncer[0].nom_entreprise}** ? Elle confirmera le retour en le rangeant.`,
    elements: aAnnoncer.map((p) => bot().ligneSortie(p, false)),
    actions: aAnnoncer.slice(0, 4).map((p) => ({
      type: 'appel', methode: 'post', url: `/requests/${p.request_id}/loan/rapporte`, corps: {},
      libelle: aAnnoncer.length > 1 ? `Rapporté : ${p.nom_entreprise}${p.num_acte ? ` (${p.num_acte})` : ''}` : 'Oui, je l\'ai rapporté',
      succes: `C'est noté : l'archive est prévenue que **${p.nom_entreprise}** est rapporté.`,
    })),
    contexte: { entreprise: aAnnoncer[0].nom_entreprise },
  };
}

// « annule ma demande Agro Wènou »
async function annulerDemande(ctx) {
  const { tenantId, question, droits } = ctx;
  const cible = await dossierVise(tenantId, question, { contexte: null });
  const nom = cible.acte || cible.nom || null;
  const miennes = await demandesEnAttente(tenantId, { nom, demandeur: droits.userId });
  if (!miennes.length) {
    return { texte: nom ? `Vous n'avez pas de demande en attente pour « **${libelleCible(cible)}** ».` : 'Vous n\'avez aucune demande en attente.', suggestions: ['Où en sont mes demandes ?'] };
  }
  return {
    texte: miennes.length > 1 ? 'Quelle demande faut-il annuler ?' : `J'annule votre demande **${miennes[0].nom_entreprise}** du ${bot().jourAff(miennes[0].le)} ?`,
    elements: miennes.map((d) => elementDemande(d, { avecAgent: false })),
    actions: miennes.slice(0, 4).map((d) => ({
      type: 'appel', methode: 'patch', url: `/requests/${d.id}/status`, corps: { status: 'annulé' }, danger: true,
      libelle: miennes.length > 1 ? `Annuler : ${d.nom_entreprise}${d.num_acte ? ` (${d.num_acte})` : ''}` : 'Oui, annuler la demande',
      succes: `Demande **${d.nom_entreprise}** annulée.`,
    })),
    contexte: { entreprise: miennes[0].nom_entreprise },
  };
}

// « demande le dossier X », « je veux le dossier X pour un remboursement »
async function demanderDossier(ctx) {
  const { tenantId, question, droits, contexte } = ctx;
  const motif = await motifDans(tenantId, question);
  const cible = await dossierVise(tenantId, question, { motif, contexte });
  if (!cible.nom && !cible.acte) return null;
  const { connu, nom, corrige } = await nomEnregistre(tenantId, cible, droits);
  // Sans dossier connu ni le mot « dossier » ou un n° d'acte : ce n'est pas une demande de dossier.
  if (!connu && !cible.acte && !a(plat(question), /\bdossiers?\b/)) return null;
  const acte = cible.acte || (connu?.presence.entrees.length === 1 ? connu.presence.entrees[0].num_actes : null) || null;
  const lignes = [];
  if (corrige) lignes.push(`Je ne trouve pas « ${cible.nom} » écrit ainsi ; il s'agit sans doute de **${nom}**.`);
  const deja = await demandesEnAttente(tenantId, { nom: cible.acte || nom, demandeur: droits.userId });
  if (deja.length) {
    return { texte: `Vous avez **déjà demandé** ${deja[0].nom_entreprise} le ${bot().jourAff(deja[0].le)} : l'archive va vous le transmettre.`, elements: deja.map((d) => elementDemande(d, { avecAgent: false })), contexte: { entreprise: nom } };
  }
  const chezMoi = await pretsOuverts(tenantId, { nom: cible.acte || nom, emprunteur: droits.userId });
  if (chezMoi.length) return { texte: `Ce dossier est **déjà chez vous** (retour prévu le ${bot().jourAff(chezMoi[0].retour_prevu)}).`, contexte: { entreprise: nom } };
  if (!connu) lignes.push(`Je ne trouve pas « **${nom}** » dans les archives, mais vous pouvez le demander : l'archive le cherchera.`);
  else if (connu.sorties.length) lignes.push(`**${nom}** est **sorti** en ce moment (retour prévu le ${bot().jourAff(connu.sorties[0].retour_prevu)}) : votre demande passera à son retour.`);
  else lignes.push(`**${nom}** est aux archives${connu.presence.total ? '' : ' (pas d\'entrée enregistrée)'}.`);
  const corps = { nom_entreprise: nom };
  if (acte) corps.num_acte = String(acte).split(/[,;]/)[0].trim();
  const motifs = (await options(tenantId)).motifs.map((m) => m.value);
  if (motif) corps.motif = motif;
  lignes.push(motif ? `Je prépare la demande, motif « **${motif}** ».` : `Pour quel motif ? Par défaut : « **${motifs[0] || 'Consultation'}** ».`);
  const res = {
    texte: lignes.join('\n'),
    actions: [
      { type: 'appel', methode: 'post', url: '/requests', corps, libelle: `Envoyer la demande${motif ? '' : ` (${motifs[0] || 'motif par défaut'})`}`, succes: `Demande envoyée : **${nom}**${motif ? `, motif ${motif}` : ''}. L'archive est prévenue.` },
      { type: 'demander', libelle: 'Compléter le formulaire', saisie: [nom, corps.num_acte].filter(Boolean).join(' ') },
    ],
    contexte: { entreprise: nom },
  };
  if (!motif) res.suggestions = motifs.slice(1, 4).map((m) => `Demande le dossier ${nom} pour ${m.toLowerCase()}`);
  return res;
}

// ---------------------------------------------------------------------------
// Questions sur une personne, classement des retards, demandes en attente.
// ---------------------------------------------------------------------------

async function dossiersDe(ctx, personne) {
  const { tenantId, question, droits } = ctx;
  if (!droits.archive && personne.id !== droits.userId) {
    return { texte: 'Seule l\'archive voit les dossiers et les demandes des autres agents. Je peux vous parler des vôtres.', suggestions: ['Ai-je des dossiers à rendre ?', 'Où en sont mes demandes ?'] };
  }
  const s = plat(question);
  const [prets, demandes] = await Promise.all([
    a(s, /\bdemand/) && !a(s, /\bsorti|\bchez\b|\bretard|\bprets?\b/) ? [] : pretsOuverts(tenantId, { emprunteur: personne.id }),
    a(s, /\bchez\b|\bsorti|\bretard|\ba rendre\b/) ? [] : demandesEnAttente(tenantId, { demandeur: personne.id }),
  ]);
  const retards = prets.filter((p) => p.en_retard).length;
  const qui = personne.id === droits.userId ? 'Vous avez' : `**${personne.full_name}** a`;
  if (!prets.length && !demandes.length) return { texte: `${personne.id === droits.userId ? 'Vous n\'avez' : `**${personne.full_name}** n'a`} ni dossier en cours, ni demande en attente.` };
  const lignes = [];
  if (prets.length) lignes.push(`${qui} **${pluriel(prets.length, 'dossier')}** en cours${retards ? `, dont **${retards} en retard**` : ''}.`);
  if (demandes.length) lignes.push(`${prets.length ? 'Et' : qui} **${pluriel(demandes[0].total, 'demande')} en attente**.`);
  return {
    texte: lignes.join('\n'),
    elements: [...prets.map((p) => bot().ligneSortie(p, false)), ...demandes.map((d) => elementDemande(d, { avecAgent: false }))].slice(0, 8),
    actions: droits.archive ? [{ type: 'lien', libelle: 'Dossiers sortis', vers: `/demandes/prets?q=${encodeURIComponent(personne.full_name)}` }] : [],
  };
}

async function classementRetards(ctx) {
  const { tenantId, droits } = ctx;
  if (!droits.archive) return { texte: 'Le suivi des retards de tous les agents est tenu par l\'archive. Je peux vous dire les vôtres.', suggestions: ['Ai-je des dossiers à rendre ?'] };
  const r = await db.query(
    `SELECT COALESCE(u.full_name, l.emprunteur_nom) AS chez, count(*)::int AS n, min(l.date_retour_prevue)::text AS plus_ancien
       FROM request_loans l LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.retourne_at IS NULL AND l.date_retour_prevue < CURRENT_DATE
      GROUP BY 1 ORDER BY n DESC, plus_ancien LIMIT 8`, [tenantId]);
  if (!r.rows.length) return { texte: 'Personne n\'est en retard : tous les dossiers sont rentrés à temps.' };
  const premier = r.rows[0];
  const egalite = r.rows.filter((x) => x.n === premier.n).length > 1;
  return {
    texte: egalite
      ? `Plusieurs agents ont **${pluriel(premier.n, 'dossier')} en retard** :`
      : `C'est **${premier.chez || '?'}**, avec **${pluriel(premier.n, 'dossier')} en retard** :`,
    elements: r.rows.map((x) => ({ titre: x.chez || 'Agent inconnu', lignes: [`${pluriel(x.n, 'dossier')} en retard`, `Le plus ancien attendu le ${bot().jourAff(x.plus_ancien)}`], ton: 'rouge' })),
    actions: [{ type: 'lien', libelle: 'Dossiers sortis', vers: '/demandes/prets' }],
    suggestions: premier.chez ? [`Les dossiers chez ${premier.chez}`] : [],
  };
}

async function listeEnAttente(ctx) {
  const { tenantId } = ctx;
  const d = await demandesEnAttente(tenantId, { limite: 6 });
  if (!d.length) return { texte: 'Aucune demande en attente : tout est transmis.' };
  const total = d[0].total;
  return {
    texte: `**${pluriel(total, 'demande')} en attente**${total > d.length ? ` (les ${d.length} plus anciennes)` : ''} :`,
    elements: d.map((x) => elementDemande(x)),
    actions: [...d.slice(0, 3).map((x) => ({ ...actionTransmettre(x), libelle: `Transmettre ${x.nom_entreprise} à ${prenom(x.agent)}` })), { type: 'lien', libelle: 'À traiter', vers: '/demandes/a-traiter' }],
  };
}

// ---------------------------------------------------------------------------
// La suite de la conversation : « il devait le rendre quand ? », « et son point ? »
// ---------------------------------------------------------------------------

const QUAND_RENDRE = [/\bquand\b.*\b(rendre|rend|revient|revenir|rentre|rentrer|rapporter|retour|ramener)\b/, /\b(rendre|revient|rentre|retour) quand\b/, /\bdate de retour\b/, /\bretour prevu\b/, /\bpour quand\b/];

/** La question parle-t-elle du dossier dont on parlait (sans le nommer) ? */
async function estUneSuite(tenantId, question, contexte, droits) {
  if (!contexte?.entreprise) return false;
  const s = plat(question);
  if (s.trim().split(' ').length > 10 || bot().ia.acteDans(question)) return false;
  if (bot().nomDans(question, { majuscules: true })) return false;
  // Un autre dossier nommé en minuscules (« agro wenou est-il aux archives ») : pas une suite.
  const autre = bot().nomDans(question);
  if (autre && autre.length >= 4 && await bot().cibleConnue(tenantId, { nom: autre }, droits).catch(() => null)) return false;
  // « Combien de dossiers en retard à l'archive ? » : une question générale, pas une suite.
  if (a(s, /\b(combien|nombre|total|quels|quelles|liste|tous|toutes|mes|mon|ma)\b/)) return false;
  return /^ et\b/.test(s) || a(s, /\b(il|elle|le|lui|son|sa|ses|ce dossier|celui ci)\b/);
}

async function dateDeRetour(ctx, cible) {
  const { tenantId, droits } = ctx;
  const nom = cible.acte || cible.nom;
  const prets = await pretsOuverts(tenantId, { nom, emprunteur: droits.archive ? null : droits.userId });
  const j = bot().jourAff;
  if (!prets.length) {
    return { texte: droits.archive ? `« **${cible.nom || nom}** » n'est pas sorti : il n'y a pas de date de retour.` : `Vous n'avez pas le dossier « **${cible.nom || nom}** » : pas de date de retour pour vous.`, contexte: { entreprise: cible.nom || null } };
  }
  const p = prets[0];
  const qui = droits.archive ? `chez **${p.chez || '?'}**` : 'chez **vous**';
  return {
    texte: `**${p.nom_entreprise}** est ${qui} depuis le ${j(p.remis_le)} ; retour prévu le **${j(p.retour_prevu)}**${p.en_retard ? ' : il est **en retard**' : ''}.`,
    elements: prets.length > 1 ? prets.map((x) => bot().ligneSortie(x, droits.archive)) : [],
    actions: droits.archive && p.en_retard ? [{ type: 'appel', methode: 'patch', url: `/requests/${p.request_id}/loan/return`, corps: {}, libelle: 'Il est revenu : enregistrer le retour', succes: `Retour enregistré : **${p.nom_entreprise}**.` }] : [],
    contexte: { entreprise: p.nom_entreprise },
  };
}

async function pointDEntree(ctx, nom) {
  const { tenantId, droits } = ctx;
  const p = await require('./entreeService').presence(tenantId, { nom_entreprise: nom, num_acte: '', annee: '' });
  const j = bot().jourAff;
  if (!p.total) return { texte: `« **${nom}** » n'a pas d'entrée enregistrée aux archives.`, contexte: { entreprise: nom } };
  const e = p.entrees[0];
  const ou = droits.archive ? [e.lettre && `lettre **${e.lettre}**`, e.armoire && `**${e.armoire}**`].filter(Boolean).join(', ') : '';
  return {
    texte: `**${e.denomination}** est entré au point du **${j(e.date_point)}** (semaine du ${j(e.semaine)} au ${j(e.au)})${ou ? ` : ${ou}` : ''}.${p.total > 1 ? ` C'est la plus récente de ses ${p.total} entrées.` : ''}`,
    elements: p.entrees.slice(1, 4).map((x) => ({ titre: x.denomination, lignes: [[x.num_actes && `Acte ${x.num_actes}`, x.type_garantie].filter(Boolean).join(' · '), `Point du **${j(x.date_point)}**`, droits.archive && [x.lettre && `Lettre ${x.lettre}`, x.armoire].filter(Boolean).join(' · ')].filter(Boolean), ton: 'vert' })),
    contexte: { entreprise: e.denomination },
  };
}

async function quiLaDemande(ctx, nom) {
  const { tenantId, droits } = ctx;
  if (!droits.archive) return null;
  const params = [tenantId];
  const r = await db.query(
    `SELECT q.id, q.nom_entreprise, q.num_acte, q.type_document, q.motif, q.statut, to_char(q.created_at, 'YYYY-MM-DD') AS le, u.full_name AS agent
       FROM requests q LEFT JOIN users u ON u.id = q.id_user
      WHERE q.tenant_id = $1 AND ${filtreNom('q', nom, params)}
      ORDER BY q.created_at DESC LIMIT 6`, params);
  if (!r.rows.length) return { texte: `Personne n'a encore demandé « **${nom}** ».`, contexte: { entreprise: nom } };
  const attente = await demandesEnAttente(tenantId, { nom });
  const etat = require('./requestStateMachine').label;
  return {
    texte: `${pluriel(r.rows.length, 'demande')} pour « **${nom}** »${attente.length ? `, dont **${attente.length} en attente**` : ''} :`,
    elements: r.rows.map((d) => ({ ...elementDemande(d), lignes: [...elementDemande(d).lignes, `État : ${etat(d.statut)}`], ton: attente.some((x) => x.id === d.id) ? 'ambre' : 'gris' })),
    actions: attente.slice(0, 3).map((x) => actionTransmettre(x)),
    contexte: { entreprise: nom },
  };
}

// ---------------------------------------------------------------------------
// Le tri : rend une réponse, ou null.
// ---------------------------------------------------------------------------

const VERBE_RETOUR = /\b(marque|marquer|marquez|enregistre|enregistrer|enregistrez|note|noter|notez|valide|valider|confirme|confirmer)\b.*\b(retour|retourne|retournes|rendu|rentre|revenu)\b/;
const EST_REVENU = /\b(est|sont) (bien )?(revenu|revenus|rentre|rentres|retourne|retournes)\b|\ba ete (rendu|rapporte|retourne)\b/;
const VERBE_TRANSMETTRE = /^ (?:(?:transmets|transmettre|transmet|transmettez|remets|remettre|remettez) (?!moi )|(?:donne|donner|donnez|envoie|envoyer|passe|passer) (?!moi |nous |la liste|les chiffres|le nombre)(?=.* a [a-z]))/;
const J_AI_RAPPORTE = /\bj (ai|l ai) (deja )?(rapporte|rendu|ramene|depose|remis|retourne|restitue)\b|\bje (le |l )?(rapporte|rends|ramene|depose)\b/;
const ANNULER = /\b(annule|annuler|annulez|supprime|supprimer|retire|retirer)\b.*\bdemande|\bje n ai plus besoin\b/;
const DEMANDER = /^ (demande|demander|demandez|je veux|je voudrais|j aimerais|il me faut|j ai besoin d?u?|envoie moi|envoyez moi|apporte moi|apportez moi|donne moi|donnez moi|fais une demande|faire une demande|je demande|commande) (?!savoir|voir|connaitre|comprendre|verifier|la liste|les chiffres|le nombre|le statut|l etat|ou en est|mes |ma )/;

async function traiter({ tenantId, question, droits, contexte = {} }) {
  const s = plat(question);
  const ctx = { tenantId, question, droits, contexte };
  if (/^ (est ce qu on peut|peut on|puis je)\b/.test(s) || a(s, /\bcomment\b/)) return null;

  // 1. Actions.
  if (droits.archive && (VERBE_RETOUR.test(s) || (EST_REVENU.test(s) && !/^ (est|quand|qui)\b/.test(s)))) return { intention: 'action_retour', ...(await enregistrerRetour(ctx)) };
  if (droits.archive && VERBE_TRANSMETTRE.test(s)) return { intention: 'action_transmettre', ...(await transmettre(ctx)) };
  if (J_AI_RAPPORTE.test(s)) return { intention: 'action_rapporte', ...(await annoncerRetour(ctx)) };
  if (ANNULER.test(s) && droits.demandeur) return { intention: 'action_annuler', ...(await annulerDemande(ctx)) };
  if (droits.demandeur && DEMANDER.test(s) && !/\bdemandes?\b.*\b(en attente|a traiter)\b/.test(s)) {
    const r = await demanderDossier(ctx);
    if (r) return { intention: 'action_demander', ...r };
  }

  // 2. Personnes et classement.
  if (a(s, /\bqui (a|est|sont) (le plus|la plus)\b/, /\bclassement\b/, /\b(quels?|quel) agents?\b.*\bretard\b/, /\bqui est en retard\b/)) return { intention: 'classement', ...(await classementRetards(ctx)) };
  if (a(s, /\bdossiers?\b/, /\bdemandes?\b/, /\bprets?\b/, /\bchez\b/, /\bqu a\b/, /\ba quoi\b/) && !bot().ia.acteDans(question)) {
    const personne = await personneDans(tenantId, question);
    if (personne && !VERBE_TRANSMETTRE.test(s)) return { intention: 'personne', ...(await dossiersDe(ctx, personne)) };
  }

  // 3. Les demandes en attente (archive).
  if (droits.archive && a(s, /^ (les )?demandes? (en attente|a traiter|a transmettre|non traitees)\b/, /\b(quelles|liste des|montre (moi )?les) demandes\b/)) {
    return { intention: 'en_attente', ...(await listeEnAttente(ctx)) };
  }

  // 4. Quand rendre / revient-il, pour un dossier nommé ou celui dont on parlait.
  const suite = await estUneSuite(tenantId, question, contexte, droits);
  if (a(s, ...QUAND_RENDRE)) {
    const cible = suite ? { nom: contexte.entreprise } : await dossierVise(tenantId, question);
    if (cible.nom || cible.acte) return { intention: 'date_retour', ...(await dateDeRetour(ctx, cible)) };
  }
  // 5. Qui l'a demandé ?
  if (a(s, /\bqui (l a|a|les a) demande/, /\bqui (le|la) demande\b/)) {
    const cible = suite ? { nom: contexte.entreprise } : await dossierVise(tenantId, question);
    if (cible.nom) { const r = await quiLaDemande(ctx, (await nomEnregistre(tenantId, cible, droits)).nom); if (r) return { intention: 'qui_demande', ...r }; }
  }
  // 6. Les autres suites : point d'entrée, ou la fiche du dossier.
  if (suite && !a(s, /\bqui (l a|a|detient)\b/, /\bchez qui\b/)) {
    if (a(s, /\bpoint\b/, /\bentree\b/, /\bentre\b/, /\bsemaine\b/, /\barmoire\b/, /\blettre\b/, /\brange\b/, /\bclasse\b/)) return { intention: 'point', ...(await pointDEntree(ctx, contexte.entreprise)) };
    // « Quelle heure est-il ? » n'est pas une suite : il faut un mot des dossiers.
    if (!a(s, /\b(dossiers?|disponible|dispo|sorti|archives?|actes?|cartons?|numerise|ou|retire|annule|existe|typologie|garantie|caution|demande|libre)\b/)) return null;
    const cible = { nom: contexte.entreprise, acte: null, annee: null, typologie: null };
    const connu = await bot().cibleConnue(tenantId, cible, droits).catch(() => null);
    if (connu) return { intention: 'fiche', ...(await bot().repondreFiche(tenantId, cible, droits, connu)) };
  }
  return null;
}

module.exports = { traiter, motifDans, nomProche, personneDans, clePhonetique, distance, estUneSuite, _caches: caches };
