// ============================================================================
// onboarding.test.js — progression de la prise en main (migration 026).
// Sans base : validation des actions et normalisation. Avec base (DB_HOST ou
// DATABASE_URL) : enregistrement réel sur un utilisateur jetable.
// Exécution : npm run test:onboarding
// ============================================================================
const svc = require('./services/onboardingService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const refuse = (fn, nom) => { try { fn(); ok(false, nom); } catch (e) { ok(e.statut === 400, nom); } };

(async () => {
  console.log('\n1. Validation (sans base)');
  ok(svc.lireAction({ visite: 'demandes', action: 'vue' }).cle === 'demandes', 'visite connue : admise');
  refuse(() => svc.lireAction({ visite: 'admin', action: 'vue' }), 'visite inconnue : 400');
  refuse(() => svc.lireAction({ visite: 'demandes', action: 'supprimer' }), 'action inconnue : 400');
  ok(svc.lireAction({ conseil: 'recherche' }).type === 'conseil', 'conseil : admis');
  refuse(() => svc.lireAction({ conseil: 'Recherche Globale!' }), 'identifiant de conseil invalide : 400');
  refuse(() => svc.lireAction({ conseil: 'x'.repeat(41) }), 'identifiant trop long : 400');
  refuse(() => svc.lireAction({}), 'rien à enregistrer : 400');
  const n = svc.normaliser({ tours: { demandes: 'x', pirate: 'y' }, conseils: ['ok', 3, 'Mauvais!'], autre: 1 });
  ok(JSON.stringify(n) === JSON.stringify({ tours: { demandes: 'x' }, conseils: ['ok'] }), 'normalisation : clés et valeurs inconnues écartées');
  ok(JSON.stringify(svc.normaliser(null)) === JSON.stringify({ tours: {}, conseils: [] }), 'normalisation : valeur absente');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Enregistrement sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Enregistrement sur PostgreSQL');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test onboarding ${s}`, `test-onb-${s}`])).rows[0].id;
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'U', $3, 'agent') RETURNING id", [t, `u${s}`, `u${s}@exemple.test`])).rows[0].id;
    ok(JSON.stringify(await svc.lire(t, u)) === JSON.stringify({ tours: {}, conseils: [] }), 'nouvel utilisateur : rien de vu');
    let o = await svc.enregistrer(t, u, { visite: 'demandes', action: 'vue' });
    ok(Boolean(o.tours.demandes), 'visite marquée vue');
    o = await svc.enregistrer(t, u, { visite: 'accueil', action: 'vue' });
    ok(Boolean(o.tours.demandes && o.tours.accueil), 'deux visites cumulées');
    o = await svc.enregistrer(t, u, { visite: 'demandes', action: 'revoir' });
    ok(!o.tours.demandes && o.tours.accueil, 'revoir : la visite redevient à voir, les autres restent');
    await svc.enregistrer(t, u, { conseil: 'recherche' });
    o = await svc.enregistrer(t, u, { conseil: 'recherche' });
    ok(JSON.stringify(o.conseils) === JSON.stringify(['recherche']), 'conseil : pas de doublon');
    let refusAutre = false;
    try { await svc.enregistrer(t + 99999, u, { conseil: 'x' }); } catch (e) { refusAutre = e.statut === 404; }
    ok(refusAutre, 'autre organisation : 404 (chacun n\'écrit que la sienne)');
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Prise en main cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
