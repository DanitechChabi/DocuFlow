// ============================================================================
// reprise.test.js — reprise du registre papier des sorties (059).
// Exécution : npm run test:reprise (base requise pour la partie 2).
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  console.log('\n1. Route');
  const routes = require('./routes/requestRoutes');
  const i = routes.stack.findIndex((l) => l.route?.path === '/loans/reprise');
  const j = routes.stack.findIndex((l) => l.route?.path === '/:id/loan');
  ok(i >= 0 && i < j, 'route déclarée avant les routes « /:id »');
  if (!avecBase) { console.log('\n2. Sur PostgreSQL — SAUTÉ'); } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const reprise = require('./services/repriseRegistreService');
    const loans = require('./services/loanService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test reprise ${s}`, `test-reprise-${s}`])).rows[0].id;
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id, full_name", [t, `a-${s}`, `a-${s}@exemple.test`])).rows[0];
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'motifs_durees', $2)", [t, JSON.stringify({ Remboursement: 30 })]);
    require('./services/settingsService').invalidate(t);
    const lignes = [
      { date_sortie: '2026-11-12', nom_entreprise: 'Fictive Alpha', num_acte: '3289', annee: 2018, type_document: 'CRG', date_acte: '30/08/2018', motif: 'Remboursement', emprunteur: 'Mme Exemple' },
      { date_sortie: '2026-11-13', nom_entreprise: 'Fictive Beta', num_acte: '03675-03676', annee: 2026, motif: 'Prorogation', emprunteur: 'DE – Département Engagement', retourne: true, date_retour: '2026-11-13' },
      { date_sortie: '2026-11-11', nom_entreprise: 'Fictive Gamma', motif: 'Consultation', retourne: true },
      { date_sortie: 'pas une date', nom_entreprise: 'X' },
      { date_sortie: '2026-11-11' },
    ];
    const r1 = await reprise.importer(t, u, { fichier: 'Registre 0001', lignes });
    ok(r1.ajoutees === 3 && r1.rejetees.length === 2, 'trois sorties reprises, deux lignes invalides écartées');
    ok((await reprise.importer(t, u, { fichier: 'Registre 0001', lignes })).deja === 3, 'réimport : rien en double');
    const reg = await loans.registre(t, {});
    const alpha = reg.find((p) => p.nom_entreprise === 'Fictive Alpha');
    ok(alpha && alpha.emprunteur_name === 'Mme Exemple' && new Date(alpha.remis_at).toISOString().slice(0, 10) === '2026-11-12', 'date de sortie et emprunteur du registre gardés');
    ok(alpha.date_retour_prevue === '2026-12-12' && alpha.retourne_at === null, 'retour prévu selon le motif (30 jours) ; pas encore retourné');
    const beta = reg.find((p) => p.nom_entreprise === 'Fictive Beta');
    ok(beta.retourne_at && beta.etat === 'retourne', 'retour noté : dossier retourné');
    ok(reg.find((p) => p.nom_entreprise === 'Fictive Gamma').retourne_at !== null, 'retour sans date : noté retourné');
    ok((await loans.registre(t, { q: 'Engagement' })).length === 1, 'recherche par le nom de l\'emprunteur du registre');
    ok((await db.query('SELECT count(*)::int n FROM notifications WHERE tenant_id = $1', [t])).rows[0].n === 0, 'aucune notification pour des faits passés');
    // La banque ne concerne que les garanties bancaires ; correction d'une ligne déjà reprise.
    const gb = { date_sortie: '2026-11-11', nom_entreprise: 'Fictive Delta (Banque Fictive Togo)', type_document: 'Prêt', reference: 'Prêt (GB26) 012828.0001', motif: 'Consultation' };
    await reprise.importer(t, u, { lignes: [gb] });
    const avant = (await db.query("SELECT banque, num_dossier FROM requests WHERE tenant_id = $1 AND nom_entreprise LIKE 'Fictive Delta%'", [t])).rows[0];
    ok(avant.banque === null && avant.num_dossier === 'Prêt (GB26) 012828.0001', 'prêt : pas de banque, la référence va au n° de dossier');
    const corr = await reprise.importer(t, u, { lignes: [{ ...gb, correction: { nom_entreprise: 'Fictive Delta', type_document: 'Garantie bancaire', banque: 'Banque Fictive Togo', num_dossier: '012828.0001' } }] });
    const apres = (await db.query("SELECT nom_entreprise, type_document, banque, num_dossier FROM requests WHERE tenant_id = $1 AND nom_entreprise LIKE 'Fictive Delta%'", [t])).rows;
    ok(corr.corrigees === 1 && apres.length === 1 && apres[0].type_document === 'Garantie bancaire' && apres[0].banque === 'Banque Fictive Togo' && apres[0].num_dossier === '012828.0001',
      'correction : garantie bancaire avec sa banque, sans doublon');
    ok((await reprise.importer(t, u, { lignes: [{ ...gb, nom_entreprise: 'Fictive Delta', num_acte: null }] })).deja === 1, 'ligne corrigée : reconnue à la reprise suivante');
    const { banqueAdmise } = require('./helpers/exigencesTypologie');
    ok(banqueAdmise('Garantie bancaire') && !banqueAdmise('Prêt') && !banqueAdmise('Bonne exécution (CBE)') && !banqueAdmise(null), 'banque admise pour une garantie bancaire seulement');
    let refus = null; try { await reprise.importer(t, u, { lignes: [] }); } catch (e) { refus = e.statut; }
    ok(refus === 400, 'rien à reprendre : 400');
    await db.query('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
