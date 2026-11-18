// ============================================================================
// docubot.test.js — DocuBot (AFGC) : lecture des questions, sans base.
// Exécution : node src/docubot.test.js
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
process.env.IA_LOCALE = 'non';

const d = require('./services/docubotService');
const archive = { archive: true };
const agent = { archive: false };
const cas = [
  ['Où est le dossier Credo BTP ?', 'ou_est', archive], ['Qui a le dossier Zénith Services ?', 'qui_a', archive],
  ['Où en sont mes demandes ?', 'mes_demandes', agent], ['Quels dossiers sont en retard ?', 'retards', archive],
  ['Ai-je des dossiers à rendre ?', 'retards', agent], ['Combien de dossiers entrés ce mois ?', 'chiffres', archive],
  ['Combien de temps puis-je garder un dossier ?', 'aide', agent], ['Comment demander plusieurs dossiers ?', 'aide', agent],
  ['Semaine du 3 octobre 2025', 'semaine', archive], ['Qu\'est-ce que j\'ai à traiter ?', 'journee', archive],
  ['Bonjour', 'salut', agent], ['Merci', 'merci', agent], ['Je voudrais le dossier de la société Agro Fictive', 'demander', agent],
];
for (const [q, attendu, droits] of cas) ok(d.intention(q, droits) === attendu, `« ${q} » → ${attendu}`);
ok(d.intention('Qu\'est-ce que j\'ai à traiter ?', agent) === 'mes_demandes', 'un agent n\'a pas de « journée » : ses demandes');
ok(d.nomDans('Où est le dossier Credo BTP ?') === 'Credo BTP' && d.nomDans('Où en sont mes demandes ?') === null, 'nom de l\'entreprise extrait ; rien dans une question sans nom');
ok(d.nomDans('Crédo B.T.P ?') === 'Crédo B.T.P', 'les points d\'un sigle restent');
ok(d.nomDans('je voudrais le dossier de l\'entreprise Agro Fictive, acte 2024/12') === 'Agro Fictive', 'l\'acte et les mots de la question retirés');
ok(d.dateDans('semaine du 3 octobre 2025') === '2025-10-03' && d.dateDans('point du 07/10/2025') === '2025-10-07' && d.dateDans('le 1er mars 2026') === '2026-03-01', 'dates écrites');
const jour = new Date('2026-11-17T10:00:00Z');
const sem = d.periodeDans('cette semaine', jour);
ok(sem.du === '2026-11-13' && sem.au === '2026-11-20', 'cette semaine : du vendredi au jeudi');
ok(d.periodeDans('ce mois', jour).du === '2026-11-01' && d.periodeDans('en octobre 2025', jour).libelle === 'en octobre 2025', 'ce mois, un mois nommé');
ok(d.periodeDans('en 2025', jour).au === '2026-01-01' && d.periodeDans('en tout', jour) === null, 'une année ; sinon pas de période');
ok(d.suggestionsAccueil(archive).length === 4 && d.suggestionsAccueil(agent).every((s) => !/traiter|retard/.test(s)), 'suggestions selon le rôle');
// Questions écrites librement : le modèle appris doit en comprendre au moins 90 %.
const appris = require('./services/intentionService');
const debut = Date.now();
appris.pret();
ok(Date.now() - debut < 3000, `apprentissage au démarrage en ${Date.now() - debut} ms`);
const ATTENDU = { ou_est: ['ou_est', 'demander'], salut: ['salut', 'merci'], autre: ['hors_sujet', 'inconnu'] };
const reelles = require('./config/questionsReellesDocubot');
const justes = reelles.filter(([q, i]) => (ATTENDU[i] || [i]).includes(d.comprendre(q, archive))).length;
console.log(`        questions libres comprises : ${justes}/${reelles.length} (${Math.round((100 * justes) / reelles.length)} %)`);
ok(justes / reelles.length >= 0.9, 'au moins 90 % des questions libres comprises');
ok(d.comprendre('quelle est la capitale du Bénin ?', archive) === 'hors_sujet', 'hors sujet reconnu');
ok(d.nomDans('Zinvo Transit a été rapporté ou pas ?') === 'Zinvo Transit' && d.nomDans('tu sais où je peux trouver le dossier de Sonaco ?') === 'Sonaco', 'nom d\'entreprise dans une question libre');
ok(d.nomDans('est-ce que Mme Adjovi a rendu le dossier Gnonlonfoun ?') === 'Gnonlonfoun' && d.nomDans('Retrouve l\'acte 2025/4410 stp') === null, 'le nom après « dossier » ; rien d\'autre qu\'un acte');
ok(d.nomDans('mes demandes sont validées ?', { majuscules: true }) === null, 'suivi des demandes : pas de faux nom');
const routes = require('./routes/iaRoutes');
ok(routes.stack.some((l) => l.route?.path === '/docubot' && l.route.methods.post), 'route déclarée');

console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
process.exit(echecs ? 1 : 0);
