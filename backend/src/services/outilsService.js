// ============================================================================
// outilsService — les outils de gestion des documents, tirés de la
// configuration réelle de l'organisation.
//
// Un service d'archives se reconnaît à ses outils : une politique de gestion
// des documents, un plan de classement, un tableau de gestion, une charte de
// nommage. Rédigés à part, ils vieillissent dans un tiroir et ne décrivent
// plus ce qui se fait. Ici ils ne sont PAS rédigés : ils sont lus dans la
// configuration — les dossiers du plan, les classes et leurs durées, les
// chartes de nommage, les réglages de sécurité. Ce que le document affirme,
// DocuFlow l'applique ; ce qui manque (pas de responsable désigné, une classe
// sans durée) y apparaît tel quel.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const roleService = require('./roleService');
const settingsService = require('./settingsService');
const campagneService = require('./campagneService');
const { LIBELLES_SORT, LIBELLES_POINT_DEPART } = require('./archivageService');
const { COMMUNICABILITE, AVERTISSEMENT } = require('../config/referentielBenin');
const catalog = require('../config/settingsCatalog');

const TYPES = {
  text: 'Texte', number: 'Nombre', date: 'Date', boolean: 'Oui / Non', select: 'Liste', multiselect: 'Liste à choix multiples',
  user: 'Personne', document: 'Document lié',
};
const DECRET = 'décret n° 2007-532 du 2 novembre 2007 portant attributions, organisation et fonctionnement des Archives Nationales';
const CODE_NUMERIQUE = 'loi n° 2017-20 du 20 avril 2018 portant Code du numérique en République du Bénin';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const texte = (v) => String(v ?? '').trim();

/**
 * Rubrique du plan : « 410 Factures fournisseurs » → code 410, intitulé
 * « Factures fournisseurs ». Un nom sans code reste entier. Fonction pure.
 */
function lireRubrique(nom) {
  const m = /^((?:[0-9]{1,4}(?:[.-][0-9]{1,4})*)|(?:[A-Z]{1,3}[0-9]{1,4}))\s*[-–—:.]?\s+(\S.*)$/.exec(texte(nom));
  return m ? { code: m[1], intitule: m[2].trim() } : { code: null, intitule: texte(nom) };
}

/**
 * Plan de classement à imprimer. Les sous-dossiers d'année (2019, 2020…)
 * qu'une classe crée d'elle-même ne sont pas des rubriques : leurs documents
 * sont comptés dans la rubrique mère, marquée « classée par année ». Les
 * rubriques hors du périmètre de lecture sont comptées, pas nommées.
 * Fonction pure.
 * @param {Array<{id, parent_id, name, nb_documents}>} dossiers
 * @param {Array<{name, dossier_defaut_id}>} classes
 * @param {Set<number>|null} lisibles null : tout est lisible
 */
function construirePlan(dossiers, classes = [], lisibles = null) {
  const enfants = new Map();
  for (const d of dossiers) enfants.set(d.parent_id || 0, [...(enfants.get(d.parent_id || 0) || []), d]);
  const annee = (d) => /^\d{4}$/.test(texte(d.name)) && Boolean(d.parent_id);
  const rubriques = [];
  let masques = 0;
  const descendre = (parentId, profondeur) => {
    const freres = (enfants.get(parentId) || []).slice().sort((a, b) => texte(a.name).localeCompare(texte(b.name), 'fr', { numeric: true }));
    for (const d of freres) {
      if (annee(d)) continue;
      if (lisibles && !lisibles.has(d.id)) { masques += 1; continue; }
      const annees = (enfants.get(d.id) || []).filter(annee);
      rubriques.push({
        id: d.id, ...lireRubrique(d.name), nom: d.name, profondeur,
        nb_documents: (d.nb_documents || 0) + annees.reduce((s, a) => s + (a.nb_documents || 0), 0),
        par_annee: annees.length > 0,
        classes: classes.filter((c) => c.dossier_defaut_id === d.id).map((c) => c.name),
      });
      descendre(d.id, profondeur + 1);
    }
  };
  descendre(0, 0);
  return { rubriques, masques };
}

/**
 * Politique de gestion des documents : ses articles, composés à partir de ce
 * que DocuFlow applique réellement. Fonction pure.
 * @returns {Array<{ titre: string, paragraphes?: string[], etapes?: Array<[string, string]> }>}
 */
function politique(r) {
  const p = r.procedure;
  const autorite = r.organisation.autorite ? `L'autorité d'archives compétente — ${r.organisation.autorite} —` : "L'autorité d'archives compétente";
  const responsable = r.responsable.nom
    ? `Le responsable des archives est ${r.responsable.nom}${r.responsable.acte ? ` (${r.responsable.acte})` : ''}. Il veille à l'application de la présente politique, tient à jour le plan de classement et le tableau de gestion, conduit les campagnes d'archivage et rend compte chaque année de l'état des archives.`
    : "Le responsable des archives reste à désigner. Tant qu'il ne l'est pas, chacun répond de ses propres documents, mais personne n'est chargé de s'assurer que l'ensemble est bien géré.";
  const preuves = [
    `les fichiers sont relus et comparés à leur empreinte tous les ${p.integrite_jours} jours`,
    `le journal d'audit est chaîné${p.scellement ? ' et scellé chaque jour' : ''}`,
    p.horodatage && 'les sceaux et les procès-verbaux sont horodatés par une autorité tierce',
  ].filter(Boolean).join(' ; ');
  const elimination = `Aucune élimination n'a lieu sans bordereau validé par une seconde personne${p.visa_requis ? ", visa de l'autorité d'archives" : ''} et procès-verbal de destruction.`;
  return [
    { titre: 'Objet et champ d\'application', paragraphes: [
      "La présente politique fixe les règles de gestion des documents que l'organisme produit ou reçoit dans l'exercice de ses activités, quels que soient leur date, leur forme et leur support. Elle s'applique à tous les agents, aux stagiaires et aux prestataires qui créent, reçoivent ou consultent ces documents.",
      "Ces documents sont gérés dans DocuFlow, espace commun et unique. Aucun document d'activité n'est conservé durablement sur un poste de travail, dans une messagerie ou sur un support amovible.",
    ] },
    { titre: 'Responsabilités', paragraphes: [
      responsable,
      'Chaque agent répond des documents qu\'il crée ou reçoit : il les verse dans DocuFlow au fil de l\'eau, et au plus tard à la clôture du dossier.',
      `L'administrateur attribue les droits d'accès selon les fonctions (${p.roles.map((x) => x.nom.toLowerCase()).join(', ')}).`,
      `${autorite} vise les éliminations et reçoit les versements d'archives à conserver définitivement (${DECRET}, art. 24 et 44).`,
    ] },
    { titre: 'Le parcours d\'un document', paragraphes: ['Tout document suit les mêmes étapes, quelle que soit sa nature.'], etapes: [
      ['Création ou réception', `Le document est déposé dans DocuFlow. Le courrier est enregistré à l'arrivée et au départ, sous un numéro d'ordre, avec un délai de réponse de ${p.courrier_delai_jours} jours.`],
      ['Enregistrement', "Chaque document reçoit une référence unique. L'empreinte SHA-256 de son fichier est calculée : elle permettra de prouver qu'il n'a pas été modifié."],
      ['Description et classement', `Le document est rattaché à l'une des ${pluriel(r.classes.length, 'classe', 'classes')} de documents, décrit par les propriétés de cette classe, nommé selon la charte de nommage et rangé dans le plan de classement.`],
      ...(p.circuits ? [['Validation', `Les documents qui l'exigent suivent un circuit de validation (${pluriel(p.circuits, 'circuit défini', 'circuits définis')}) : chaque visa est daté et tracé.`]] : []),
      ['Diffusion', `Les documents se consultent dans DocuFlow, selon les droits de chacun. ${p.partage_public ? 'Un document ne sort que par un lien de partage daté' : "Les liens de partage vers l'extérieur sont désactivés"}, et dans le respect des délais de communicabilité (${DECRET.split(' portant')[0]}, art. 32 et 33).`],
      ['Conservation', `Chaque classe porte sa durée de conservation et son sort final : c'est le tableau de gestion. Pour garantir l'intégrité des documents, ${preuves} (${CODE_NUMERIQUE}).`],
      ['Sort final', `À l'échéance, le document est trié : conservé définitivement et versé aux archives par bordereau, ou éliminé. ${elimination}`],
    ] },
    { titre: 'Documents papier', paragraphes: [
      `Les originaux papier sont conditionnés en boîtes décrites — fonds, cote, dates extrêmes — et rangés dans les magasins d'archives${p.boites ? ` (${pluriel(p.boites, 'boîte décrite', 'boîtes décrites')} à ce jour)` : ''}. DocuFlow tient leur emplacement et le nom de la personne qui les a rangés ; le répertoire s'en déduit.`,
      `Un récolement périodique constate que chaque boîte est à sa place. Tout prêt d'un original est enregistré ; un original versé aux archives publiques ne sort pas, seule une copie est communiquée (${DECRET.split(' portant')[0]}, art. 35).`,
    ] },
    { titre: 'Archivage périodique', paragraphes: [
      p.campagne === 'aucune'
        ? "Aucune campagne d'archivage périodique n'est planifiée : l'archivage repose sur l'initiative de chacun."
        : `Une campagne d'archivage a lieu ${p.campagne_libelle.toLowerCase()}. Chaque agent verse alors les documents de ses dossiers clos, et le responsable des archives reçoit le bilan de ce qui reste à décrire, à classer et à trier.`,
    ] },
    { titre: 'Confidentialité et traçabilité', paragraphes: [
      "Les documents confidentiels sont rangés dans des dossiers à accès restreint. Chaque consultation, modification, communication ou élimination est inscrite au journal d'audit, avec son auteur et sa date.",
    ] },
    { titre: 'Formation', paragraphes: [
      'Tout nouvel agent, stagiaire compris, suit la prise en main guidée de DocuFlow avant de traiter des documents. Il prend connaissance de la présente politique, du plan de classement et de la charte de nommage.',
    ] },
    { titre: 'Révision', paragraphes: [
      "La présente politique, le plan de classement et le tableau de gestion sont revus chaque année, et à chaque changement dans l'organisation des services.",
    ] },
  ];
}

/** Tout ce qu'il faut pour éditer les quatre outils. */
async function referentiel(tenantId, user) {
  const [reglages, organisation, schemas, champs, dossiers, exemples, circuits, boites, roles, acces, campagnes] = await Promise.all([
    settingsService.getAll(tenantId),
    db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]),
    db.query(
      `SELECT s.id, s.name, s.code, s.description, s.modele_nom, s.dossier_defaut_id, s.sous_dossier_annee, COALESCE(s.is_default, false) AS commune,
              s.dua_annees, s.dua_point_depart, s.sort_final, s.dua_reference, s.communicabilite,
              (SELECT count(*)::int FROM documents d WHERE d.classe_id = s.id AND d.tenant_id = s.tenant_id AND d.deleted_at IS NULL AND d.elimine_at IS NULL) AS nb_documents
         FROM metadata_schemas s WHERE s.tenant_id = $1 ORDER BY s.code NULLS LAST, s.name`, [tenantId]),
    db.query(
      `SELECT f.schema_id, f.label, f.type, f.required FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
        WHERE s.tenant_id = $1 ORDER BY f.display_order, f.id`, [tenantId]),
    db.query(
      `SELECT f.id, f.parent_id, f.name,
              (SELECT count(*)::int FROM documents d WHERE d.dossier_id = f.id AND d.tenant_id = f.tenant_id AND d.deleted_at IS NULL AND d.elimine_at IS NULL) AS nb_documents
         FROM document_folders f WHERE f.tenant_id = $1`, [tenantId]),
    db.query(
      `SELECT DISTINCT ON (d.classe_id) d.classe_id, d.description, d.dossier_id FROM documents d
        WHERE d.tenant_id = $1 AND d.classe_id IS NOT NULL AND d.deleted_at IS NULL AND d.elimine_at IS NULL AND COALESCE(d.description, '') <> ''
        ORDER BY d.classe_id, d.id DESC`, [tenantId]),
    db.query('SELECT count(*)::int AS n FROM circuit_modeles WHERE tenant_id = $1 AND actif', [tenantId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query("SELECT count(*)::int AS n FROM emplacements WHERE tenant_id = $1 AND type = 'boite'", [tenantId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT r.name, (SELECT count(*)::int FROM users u WHERE u.tenant_id = r.tenant_id AND u.role = r.key AND u.username NOT LIKE 'portail-citoyen-%') AS membres
         FROM roles r WHERE r.tenant_id = $1 AND r.is_active AND r.key <> 'superadmin' ORDER BY r.id`, [tenantId]),
    aclService.dossiersAccessibles(tenantId, user.id),
    campagneService.lister(tenantId).catch(() => []),
  ]);

  const chemins = new Map();
  const parId = new Map(dossiers.rows.map((d) => [d.id, d]));
  const cheminDe = (id) => {
    if (!id || !parId.has(id)) return null;
    if (!chemins.has(id)) {
      const d = parId.get(id);
      const parent = cheminDe(d.parent_id);
      chemins.set(id, parent ? `${parent} / ${d.name}` : d.name);
    }
    return chemins.get(id);
  };
  const lisible = (dossierId) => !dossierId || acces.lisibles.has(dossierId);
  const exemple = new Map(exemples.rows.filter((e) => lisible(e.dossier_id)).map((e) => [e.classe_id, e.description]));
  const proprietes = (schemaId) => champs.rows.filter((f) => f.schema_id === schemaId)
    .map((f) => ({ libelle: f.label, type: TYPES[f.type] || f.type, obligatoire: Boolean(f.required) }));

  const classes = schemas.rows.filter((s) => !s.commune).map((s) => {
    const comm = COMMUNICABILITE[s.communicabilite] || null;
    return {
      id: s.id, code: s.code || null, nom: s.name, description: s.description || null, modele_nom: s.modele_nom || null,
      exemple: exemple.get(s.id) || null, proprietes: proprietes(s.id),
      rangement: s.dossier_defaut_id && lisible(s.dossier_defaut_id) ? { dossier: cheminDe(s.dossier_defaut_id), par_annee: Boolean(s.sous_dossier_annee) } : null,
      conservation: s.dua_annees === null || s.dua_annees === undefined ? null : {
        dua_annees: s.dua_annees, point_depart: s.dua_point_depart, point_depart_libelle: LIBELLES_POINT_DEPART[s.dua_point_depart] || null,
        sort_final: s.sort_final, sort_final_libelle: LIBELLES_SORT[s.sort_final] || null, reference: s.dua_reference || null,
      },
      communicabilite: comm ? { cle: s.communicabilite, libelle: comm.libelle, reference: comm.ref } : null,
      nb_documents: s.nb_documents,
    };
  });
  const commune = schemas.rows.find((s) => s.commune);
  const campagne = catalog.BY_KEY.get('archivage_campagne');
  const periodicite = campagneService.PERIODICITES.includes(reglages.archivage_campagne) ? reglages.archivage_campagne : 'trimestrielle';

  const r = {
    etabli_at: new Date().toISOString(),
    organisation: {
      nom: texte(reglages.legal_entity) || organisation.rows[0]?.name || null, adresse: texte(reglages.legal_address) || null,
      autorite: texte(reglages.archives_autorite) || null,
    },
    responsable: { nom: texte(reglages.archives_responsable) || null, acte: texte(reglages.archives_responsable_acte) || null },
    approbation: texte(reglages.politique_approbation) || null,
    plan: construirePlan(dossiers.rows, schemas.rows, acces.lisibles),
    classes,
    communes: commune ? proprietes(commune.id) : [],
    procedure: {
      visa_requis: reglages.elimination_visa_requis !== false, horodatage: reglages.horodatage_actif === true,
      integrite_jours: Number(reglages.integrite_verification_jours) || 30, scellement: reglages.journal_scellement_auto !== false,
      partage_public: reglages.partage_public_actif !== false, courrier_delai_jours: Number(reglages.courrier_delai_reponse_jours) || 15,
      campagne: periodicite, campagne_libelle: campagne.options.find((o) => o.value === periodicite)?.label || periodicite,
      circuits: circuits.rows[0].n, boites: boites.rows[0].n, roles: roles.rows.map((x) => ({ nom: x.name, membres: x.membres })),
    },
    campagnes,
    avertissement_conservation: AVERTISSEMENT,
    droits: {
      lancer_campagne: await roleService.possede(tenantId, user.role, 'archives.manage'),
      configurer: await roleService.possede(tenantId, user.role, 'settings.manage'),
    },
  };
  // Ce qui manque encore aux outils — dit sans détour, en tête de page.
  r.manques = [
    !r.responsable.nom && { cle: 'responsable', texte: "Aucun responsable des archives n'est désigné." },
    !r.plan.rubriques.length && { cle: 'plan', texte: 'Le plan de classement est vide.' },
    classes.some((c) => !c.conservation) && { cle: 'conservation', texte: `${pluriel(classes.filter((c) => !c.conservation).length, 'classe n\'a', 'classes n\'ont')} pas de durée de conservation.` },
    classes.some((c) => !c.modele_nom) && { cle: 'nommage', texte: `${pluriel(classes.filter((c) => !c.modele_nom).length, 'classe n\'a', 'classes n\'ont')} pas de charte de nommage.` },
    periodicite === 'aucune' && { cle: 'campagne', texte: "Aucune campagne d'archivage périodique n'est planifiée." },
  ].filter(Boolean);
  r.politique = politique(r);
  return r;
}

module.exports = { TYPES, lireRubrique, construirePlan, politique, referentiel };
