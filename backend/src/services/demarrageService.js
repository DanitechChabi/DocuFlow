// ============================================================================
// demarrageService — assistant de démarrage de l'administrateur.
//
// Les étapes ne se cochent pas à la main : chacune est CONSTATÉE sur les
// données de l'organisation (une classe existe, une durée est posée…). La
// liste suit l'ordre dans lequel un service d'archives béninois se met en
// place : identité, autorité d'archives (décret n° 2007-532, art. 24 et 44),
// plan de classement, durées de conservation (art. 38-46), équipe, magasins,
// sauvegarde et horodatage (Code du numérique, art. 299-303), premier document.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const sauvegardeService = require('./sauvegardeService');

const compter = async (sql, params) => {
  try { return (await db.query(sql, params)).rows[0].n; } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return 0; // migration absente
    throw err;
  }
};

/** Ordre et textes des étapes. Fonction pure, testable sans base. */
function construire(f) {
  return [
    { cle: 'identite', titre: "Donner l'identité de l'organisation", fait: f.identite,
      explication: 'Nom et logo apparaissent sur les écrans, les bordereaux et les procès-verbaux.',
      lien: '/admin-portal?onglet=branding', action: 'Configurer' },
    { cle: 'autorite', titre: "Indiquer l'autorité d'archives compétente", fait: f.autorite,
      explication: "Elle vise les éliminations et reçoit les versements : DAN ou Direction des Archives Départementales (décret n° 2007-532, art. 24 et 44).",
      lien: '/admin-portal?onglet=configuration', action: 'Renseigner' },
    { cle: 'plan', titre: 'Installer le plan de classement', fait: f.classes > 0,
      explication: 'Les classes de documents (actes de naissance, délibérations, marchés…) structurent le classement et l\'indexation.',
      lien: '/documents/classes', action: 'Installer un modèle', detail: f.classes ? `${f.classes} classe(s)` : null },
    { cle: 'conservation', titre: 'Appliquer les durées de conservation béninoises', fait: f.classes > 0 && f.sansDua === 0,
      explication: 'Chaque classe reçoit sa durée d\'utilité administrative et son sort final ; à valider avec l\'autorité d\'archives (art. 40).',
      lien: '/documents/classes', action: 'Appliquer le référentiel', detail: f.classes && f.sansDua ? `${f.sansDua} classe(s) sans durée` : null },
    { cle: 'equipe', titre: 'Inviter l\'équipe', fait: f.utilisateurs > 1,
      explication: 'Un archiviste au moins : la validation d\'une élimination demande une seconde personne.',
      lien: '/admin-portal?onglet=users', action: 'Ajouter des utilisateurs', detail: `${f.utilisateurs} compte(s)` },
    { cle: 'magasins', titre: 'Décrire les magasins d\'archives papier', fait: f.emplacements > 0, facultatif: true,
      explication: 'Dépôts, travées, tablettes et boîtes donnent à chaque dossier papier sa cote et permettent le récolement.',
      lien: '/documents/magasins', action: 'Créer un dépôt' },
    ...(f.sauvegardeDisponible ? [{ cle: 'sauvegarde', titre: 'Activer la sauvegarde automatique', fait: f.sauvegardeActive,
      explication: 'Copie quotidienne de la base et des fichiers sur un disque externe ou un partage réseau.',
      lien: '/admin-portal?onglet=sauvegarde', action: 'Configurer' }] : []),
    { cle: 'horodatage', titre: 'Activer l\'horodatage par un tiers', fait: f.horodatage, facultatif: true,
      explication: 'Une autorité RFC 3161 date les sceaux et les procès-verbaux (Code du numérique, art. 299-300).',
      lien: '/admin-portal?onglet=configuration', action: 'Activer' },
    { cle: 'document', titre: 'Enregistrer un premier document', fait: f.documents > 0,
      explication: 'Numérisez ou déposez un acte : il est indexé, empreinté et rangé dans sa classe.',
      lien: '/documents/liste', action: 'Ajouter un document' },
  ];
}

async function etat(tenantId) {
  const reglages = await settingsService.getAll(tenantId);
  const [classes, sansDua, utilisateurs, emplacements, documents] = await Promise.all([
    compter('SELECT count(*)::int AS n FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE', [tenantId]),
    compter('SELECT count(*)::int AS n FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE AND dua_annees IS NULL', [tenantId]),
    compter('SELECT count(*)::int AS n FROM users WHERE tenant_id = $1', [tenantId]),
    compter('SELECT count(*)::int AS n FROM emplacements WHERE tenant_id = $1', [tenantId]),
    compter('SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId]),
  ]);
  const sauvegarde = sauvegardeService.etat();
  const etapes = construire({
    identite: Boolean(reglages.site_logo) || (reglages.site_name && reglages.site_name !== 'DocuFlow'),
    autorite: Boolean(String(reglages.archives_autorite || '').trim()),
    classes, sansDua, utilisateurs, emplacements, documents,
    sauvegardeDisponible: sauvegarde.disponible, sauvegardeActive: Boolean(sauvegarde.actif && sauvegarde.dossier),
    horodatage: reglages.horodatage_actif === true,
  });
  const obligatoires = etapes.filter((e) => !e.facultatif);
  return {
    etapes,
    faites: etapes.filter((e) => e.fait).length,
    total: etapes.length,
    termine: obligatoires.every((e) => e.fait),
  };
}

module.exports = { construire, etat };
