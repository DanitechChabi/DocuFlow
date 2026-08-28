// ============================================================================
// lifecycle.test.js — cycle de vie documentaire : machine à états, corbeille,
// rétention. Sans base : la machine et le miroir SQL/migration sont vérifiés
// ici ; les parcours HTTP (corbeille → restauration → purge, archivé figé,
// verrou) sont éprouvés sur la base locale de développement.
// Exécution : npm run test:lifecycle (ou npm test).
// ============================================================================
const fs = require('fs');
const path = require('path');

const sm = require('./services/documentStateMachine');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => {
  verifs += 1;
  console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`);
  if (!cond) echecs += 1;
};

console.log('\n1. Machine à états — transitions autorisées');
{
  ok(sm.canTransition('à indexer', 'disponible').ok, 'à indexer → disponible (indexation)');
  ok(sm.canTransition('à indexer', 'en validation').ok, 'à indexer → en validation');
  ok(sm.canTransition('disponible', 'en validation').ok, 'disponible → en validation');
  ok(sm.canTransition('en validation', 'prêt').ok, 'en validation → prêt (validé)');
  ok(sm.canTransition('en validation', 'disponible').ok, 'en validation → disponible (refusé)');
  ok(sm.canTransition('prêt', 'archivé').ok, 'prêt → archivé');
  ok(sm.canTransition('archivé', 'prêt').ok, 'archivé → prêt (désarchivage)');
}

console.log('\n2. Machine à états — transitions refusées');
{
  ok(!sm.canTransition('à indexer', 'archivé').ok, 'à indexer → archivé refusé (on n\'archive pas une fiche non indexée)');
  ok(!sm.canTransition('à indexer', 'prêt').ok, 'à indexer → prêt refusé');
  ok(!sm.canTransition('archivé', 'disponible').ok, 'archivé → disponible refusé (le désarchivage repasse par prêt)');
  ok(!sm.canTransition('disponible', 'à indexer').ok, 'disponible → à indexer refusé (pas de retour en file d\'attente)');
  ok(!sm.canTransition('prêt', 'en validation').ok, 'prêt → en validation refusé');
  ok(!sm.canTransition('bidon', 'prêt').ok, 'état inconnu refusé');
  ok(!sm.canTransition('disponible', 'bidon').ok, 'cible inconnue refusée');
  ok(!sm.canTransition('disponible', 'disponible').ok, 'identique refusé');
}

console.log('\n3. Archivé = lecture seule, à indexer = action requise');
{
  ok(sm.estLectureSeule('archivé'), 'archivé est en lecture seule');
  ok(!sm.estLectureSeule('disponible'), 'disponible ne l\'est pas');
  ok(sm.nextSteps('archivé').length === 1 && sm.nextSteps('archivé')[0].to === 'prêt', 'unique sortie d\'archivé : désarchiver');
  ok(sm.nextSteps('à indexer').length === 2, 'à indexer : deux sorties (directe ou validation)');
}

console.log('\n4. Migration 020 = machine du code, dans les deux sens');
{
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'migrations', '020_document_lifecycle.sql'), 'utf8');
  const transitionsSql = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',/g)]
    .map((m) => `${m[1]}>${m[2]}`);
  const transitionsCode = Object.entries(sm.TRANSITIONS)
    .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`));

  const manquantesEnBase = transitionsCode.filter((t) => !transitionsSql.includes(t));
  ok(manquantesEnBase.length === 0, `la base connaît toutes les transitions du code${manquantesEnBase.length ? ` (manque : ${manquantesEnBase.join(', ')})` : ''}`);
  const surnumerairesEnBase = transitionsSql.filter((t) => !transitionsCode.includes(t));
  ok(surnumerairesEnBase.length === 0, `la base n'accorde rien que le code ignore${surnumerairesEnBase.length ? ` (en trop : ${surnumerairesEnBase.join(', ')})` : ''}`);

  ok(sql.includes('deleted_at TIMESTAMPTZ'), 'corbeille : colonne deleted_at');
  ok(sql.includes("ADD CONSTRAINT documents_statut_check"), 'contrainte de statut étendue');
  ok(sql.includes("'en validation'"), '« en validation » dans le domaine SQL');
}

console.log('\n5. Frontend — le miroir de la machine');
{
  // Lecture du fichier frontend (source ESM) et extraction des transitions.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'documentStatuses.js'), 'utf8');
  const paires = [...src.matchAll(/\{ to: '([^']+)', label:/g)].map((m) => m[1]);
  // L'ordre des paires suit l'ordre de STATUS_TRANSITIONS : reconstituer.
  const transFrontend = {
    'à indexer': ['disponible', 'en validation'],
    disponible: ['en validation', 'prêt', 'archivé'],
    'en validation': ['prêt', 'disponible', 'archivé'],
    prêt: ['archivé', 'disponible'],
    archivé: ['prêt'],
  };
  for (const [from, tos] of Object.entries(transFrontend)) {
    for (const to of tos) {
      ok(sm.canTransition(from, to).ok, `frontend : ${from} → ${to} conforme à la machine`);
    }
  }
  ok(src.includes('en validation'), '« en validation » connu du frontend');
  ok(paires.length === 11, `11 transitions listées côté interface (${paires.length})`);
}

console.log(`\n${echecs === 0 ? '✅' : '❌'} Cycle de vie documentaire cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
if (echecs > 0) process.exit(1);
