// ============================================================================
// demarrage.test.js — assistant de démarrage de l'administrateur.
// Étapes constatées sur les données, ordre béninois, étapes facultatives.
// Exécution : npm run test:demarrage
// ============================================================================
const demarrage = require('./services/demarrageService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

(async () => {
  console.log('\n1. Sans base');
  const vide = demarrage.construire({ classes: 0, sansDua: 0, utilisateurs: 1, emplacements: 0, documents: 0, sauvegardeDisponible: false });
  ok(vide.map((e) => e.cle).join('>') === 'identite>autorite>plan>conservation>equipe>magasins>horodatage>document', 'ordre : identité, autorité, plan, durées, équipe, magasins, horodatage, document');
  ok(vide.every((e) => !e.fait), 'organisation neuve : rien n\'est fait');
  ok(!vide.find((e) => e.cle === 'conservation').fait, 'pas de classe : les durées ne sont pas « faites »');
  const avecSauvegarde = demarrage.construire({ classes: 3, sansDua: 1, utilisateurs: 2, sauvegardeDisponible: true, sauvegardeActive: false });
  ok(avecSauvegarde.some((e) => e.cle === 'sauvegarde'), 'poste avec pg_dump : étape sauvegarde proposée');
  ok(!avecSauvegarde.find((e) => e.cle === 'conservation').fait && avecSauvegarde.find((e) => e.cle === 'conservation').detail === '1 classe(s) sans durée', 'une classe sans durée : étape ouverte, détail donné');
  ok(vide.filter((e) => e.facultatif).map((e) => e.cle).join() === 'magasins,horodatage', 'magasins et horodatage facultatifs');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Demarrage ${s}`, `demarrage-${s}`])).rows[0].id;
    await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Admin', $3, 'admin')", [t, `adm${s}`, `adm${s}@exemple.test`]);
    let e = await demarrage.etat(t);
    ok(!e.termine && e.etapes.find((x) => x.cle === 'autorite').fait, 'autorité par défaut (DAN) : étape constatée');
    ok(!e.etapes.find((x) => x.cle === 'plan').fait && !e.etapes.find((x) => x.cle === 'equipe').fait, 'sans classe ni collègue : étapes ouvertes');
    await db.query("INSERT INTO metadata_schemas (tenant_id, name, dua_annees, sort_final) VALUES ($1, 'Actes de naissance', 100, 'conservation')", [t]);
    await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archi', $3, 'archiviste')", [t, `arc${s}`, `arc${s}@exemple.test`]);
    e = await demarrage.etat(t);
    ok(e.etapes.find((x) => x.cle === 'plan').fait && e.etapes.find((x) => x.cle === 'conservation').fait, 'classe avec durée : plan et durées constatés');
    ok(e.etapes.find((x) => x.cle === 'equipe').fait, 'deux comptes : équipe constatée');
    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Assistant de démarrage cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
