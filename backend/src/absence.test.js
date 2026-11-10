// ============================================================================
// absence.test.js — absence et suppléance (migration 042) : déclaration,
// relais des tâches de validation et du courrier, chaînes et boucles.
// Exécution : npm run test:absence
// ============================================================================
const fs = require('fs');
const path = require('path');
const absence = require('./services/absenceService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
const j = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\nSur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\nSur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const circuits = require('./services/circuitService');
    const courrier = require('./services/courrierService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Absence ${s}`, `absence-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    const u = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [t, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const chef = await u('responsable', 'Chef');
    const adjoint = await u('responsable', 'Adjoint');
    const agent = await u('agent', 'Agent');
    const lecteur = await u('lecteur', 'Lecteur');
    const admin = await u('admin', 'Admin');

    // --- Déclaration --------------------------------------------------------
    ok((await attendreErreur(() => absence.definir(t, chef.id, { du: j(0), au: j(-1), suppleant_id: adjoint.id })))?.status === 400, 'fin avant début : refusé');
    ok((await attendreErreur(() => absence.definir(t, chef.id, { du: j(0), au: j(5), suppleant_id: chef.id })))?.status === 400, 'être son propre suppléant : refusé');
    ok((await attendreErreur(() => absence.definir(t, chef.id, { du: j(0), au: j(5), suppleant_id: 999999999 })))?.status === 400, 'suppléant d\'une autre organisation : refusé');
    const a = await absence.definir(t, chef.id, { du: j(0), au: j(5), suppleant_id: adjoint.id, motif: 'Mission' });
    ok(a.en_cours && a.suppleant_nom === 'Adjoint', 'absence déclarée, en cours');
    ok((await attendreErreur(() => absence.definir(t, adjoint.id, { du: j(2), au: j(3), suppleant_id: chef.id })))?.status === 409, 'suppléance croisée sur la même période : refusée');
    ok((await absence.definir(t, agent.id, { du: j(10), au: j(12), suppleant_id: adjoint.id })).a_venir && (await absence.suppleant(db, t, agent.id)) === null, 'absence à venir : pas encore de relais');
    const r = await absence.suppleant(db, t, chef.id);
    ok(r.id === adjoint.id && r.pour_le_compte_de === 'Chef', 'relais : le suppléant, pour le compte de l\'absent');

    // --- Circuit de validation -------------------------------------------------
    const d = (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by)
       VALUES ($1, $2, 'D', 'A', 'X', 2026, 'disponible', $3) RETURNING id`, [t, `ABS-${s}`, admin.id])).rows[0].id;
    const nom = `abs${s}.txt`;
    fs.writeFileSync(path.join(FILES_DIR, nom), 'Note');
    await addFileToDocument(t, d, admin.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: 'note.txt', mimetype: 'text/plain', size: 4 });
    const modele = await circuits.creerModele(t, { nom: 'Visa du chef', etapes: [{ libelle: 'Visa', type_assignation: 'utilisateur', assigne_user_id: chef.id }] }, admin);
    await circuits.demarrer(t, d, { circuitId: modele.id, user: admin });
    const taches = (await db.query("SELECT assigne_a, pour_le_compte_de FROM circuit_taches WHERE document_id = $1 AND statut = 'à traiter'", [d])).rows;
    ok(taches.length === 1 && taches[0].assigne_a === adjoint.id && taches[0].pour_le_compte_de === 'Chef', 'visa du chef absent : la tâche va à l\'adjoint, pour le compte du chef');
    const tache = (await db.query("SELECT id FROM circuit_taches WHERE document_id = $1 AND statut = 'à traiter'", [d])).rows[0].id;
    await circuits.decider(t, tache, { decision: 'approuver' }, adjoint);
    ok((await db.query('SELECT pour_le_compte_de FROM circuit_visas WHERE document_id = $1', [d])).rows[0]?.pour_le_compte_de === 'Chef', 'le visa porte la mention « pour le compte de »');

    // --- Courrier ---------------------------------------------------------------
    const c = await courrier.enregistrer(admin, { sens: 'arrivee', objet: 'Convocation', correspondant: 'Préfecture', assigne_a: chef.id });
    ok(c.assigne_a === adjoint.id && c.evenements.some((e) => /suppléant de Chef/.test(e.note || '')), 'courrier affecté au chef absent : reçu par l\'adjoint, relais tracé');
    await absence.definir(t, chef.id, { du: j(0), au: j(5), suppleant_id: lecteur.id });
    const c2 = await courrier.enregistrer(admin, { sens: 'arrivee', objet: 'Autre', correspondant: 'Préfecture', assigne_a: chef.id });
    ok(c2.assigne_a === chef.id, 'suppléant sans accès au courrier : l\'agent garde la charge (rien ne se perd)');

    // --- Chaîne et fin -------------------------------------------------------------
    await absence.definir(t, chef.id, { du: j(0), au: j(5), suppleant_id: adjoint.id });
    await absence.definir(t, adjoint.id, { du: j(0), au: j(2), suppleant_id: admin.id });
    ok((await absence.suppleant(db, t, chef.id)).id === admin.id, 'suppléant absent lui aussi : la chaîne est suivie');
    await db.query('UPDATE absences SET du = CURRENT_DATE - 10, au = CURRENT_DATE - 1 WHERE user_id = $1', [chef.id]);
    ok((await absence.suppleant(db, t, chef.id)) === null && (await absence.etat(t, chef.id)) === null, 'absence terminée : plus de relais, plus d\'état');
    ok((await absence.lever(t, adjoint.id)) === null && (await absence.etat(t, adjoint.id)) === null, 'absence levée par anticipation');

    fs.rmSync(path.join(FILES_DIR, nom), { force: true });
    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Absences cohérentes — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
