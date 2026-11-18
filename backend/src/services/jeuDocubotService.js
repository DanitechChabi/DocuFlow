// ============================================================================
// Jeu d'entraînement de DocuBot (voir scripts/ia-documentaire/generer-jeu.js).
// Exemples « question → lecture attendue » au format prompt/completion de TRL,
// avec exactement les consignes que DocuFlow envoie à Ollama.
// ============================================================================
const { CONSIGNE_ANALYSE, CONSIGNE_REDACTION } = require('./ollamaService');
const CONNAISSANCES = require('../config/connaissancesAfgc');

// Hasard reproductible : le même jeu à chaque exécution.
let graine = 20261118;
const semer = (g) => { graine = g; };
const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
const un = (l) => l[Math.floor(hasard() * l.length)];
const peutEtre = (p) => hasard() < p;

// ---------------------------------------------------------------------------
// Noms inventés : syllabes sans rapport avec une société existante connue.
// ---------------------------------------------------------------------------
const SYL = ['ka', 'lo', 'mé', 'ri', 'do', 'sa', 'vu', 'té', 'ni', 'go', 'ba', 'zé', 'fo', 'li', 'ma', 'ko', 'pé', 'ra', 'yo', 'hou', 'kpo', 'gbé', 'dji', 'nou', 'wa', 'to', 'mi', 'sè'];
const METIER = ['BTP', 'Services', 'Construction', 'Distribution', 'Transit', 'Consulting', 'Agro', 'Industries', 'Travaux Publics', 'Énergie', 'Logistique', 'Commerce', 'Génie Civil', 'Immobilier', 'Informatique'];
const FORME = ['SARL', 'SA', 'SAS', 'SARLU', 'GIE'];
const PREFIXE = ['Société', 'Ets', 'Établissements', 'Entreprise', 'Groupe', 'Cabinet', 'Groupement'];
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function nomInvente() {
  const racine = capital(Array.from({ length: 2 + Math.floor(hasard() * 2) }, () => un(SYL)).join(''));
  const forme = hasard();
  if (forme < 0.25) return `${racine} ${un(METIER)}`;
  if (forme < 0.45) return `${racine} ${un(METIER)} ${un(FORME)}`;
  if (forme < 0.6) return `${racine} et Fils`;
  if (forme < 0.75) return `${un(['Ets', 'Établissements'])} ${racine}`;
  if (forme < 0.85) return `${racine} ${capital(un(SYL) + un(SYL))}`;
  return racine.toUpperCase();
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function uneDate() {
  const an = un([2024, 2025, 2026]);
  const m = Math.floor(hasard() * 12);
  const j = 1 + Math.floor(hasard() * 28);
  const iso = `${an}-${String(m + 1).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  const ecrit = un([`${j} ${MOIS[m]} ${an}`, `${String(j).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${an}`, `${j === 1 ? '1er' : j} ${MOIS[m]} ${an}`]);
  return { iso, ecrit };
}
const unActe = () => un([`${un([2024, 2025, 2026])}/${1 + Math.floor(hasard() * 20000)}`, `${1 + Math.floor(hasard() * 20000)}`]);

// ---------------------------------------------------------------------------
// Modèles de questions, par intention. {E} entreprise, {A} acte, {D} date.
// ---------------------------------------------------------------------------
const MODELES = {
  ou_est: [
    'Où est le dossier {E} ?', 'où se trouve le dossier de {P} {E}', 'Le dossier {E} est-il aux archives ?', 'Dans quelle armoire est rangé {E} ?',
    'Quelle semaine pour le dossier {E} ?', 'tu peux me retrouver {E} ?', 'je cherche le dossier {E}', '{E}', '{E} acte {A}', 'acte {A}',
    'où est l\'acte {A} ?', 'le dossier de {E} a-t-il été entré ?', 'Est-ce que {E} est classé ?', 'à quelle date le point de {E} ?',
    'retrouve moi {E} stp', 'Bonjour, pouvez-vous me dire où est le dossier {E} ?', 'dossier {E} il est où', 'localiser {E}',
    'Le dossier de la {P} {E}, il est rangé où ?', 'je veux savoir si {E} est aux archives', 'où est rangé l\'acte {A} de {E} ?',
    'dans quelle lettre est {E}', 'J\'aurais besoin du dossier {E}, il est où ?', 'est ce que vous avez le dossier {E}',
  ],
  qui_a: [
    'Qui a le dossier {E} ?', 'chez qui est {E} ?', 'Le dossier {E} est-il sorti ?', 'Est-ce que {E} est revenu ?', 'qui détient l\'acte {A} ?',
    '{E} a été rendu ?', 'le dossier de {E} est toujours dehors ?', 'Qui a emprunté {E} ?', 'est-ce que quelqu\'un a le dossier {E}',
    'le dossier {E} est-il rentré aux archives ?', 'qui l\'a pris, le dossier {E} ?', 'quand revient le dossier {E} ?', '{E} est chez qui',
    'Le dossier de la {P} {E} n\'est pas dans l\'armoire, qui l\'a ?', 'qui garde l\'acte {A}', 'à qui on a transmis {E} ?',
  ],
  mes_demandes: [
    'Où en sont mes demandes ?', 'où en est ma demande {E} ?', 'mes demandes', 'quel est le statut de ma demande ?', 'ma demande pour {E} a été traitée ?',
    'Est-ce que l\'archive a reçu ma demande ?', 'suivi de mes dossiers', 'qu\'est devenue ma demande de {E}', 'j\'ai demandé {E} hier, c\'est en cours ?',
    'mes dossiers demandés', 'ma demande est-elle partie ?', 'on a traité ma demande ?', 'état de mes demandes svp',
  ],
  retards: [
    'Quels dossiers sont en retard ?', 'ai-je des dossiers à rendre ?', 'dossiers à récupérer', 'qui n\'a pas rendu son dossier ?', 'les retards',
    'liste des dossiers pas encore rentrés', 'est-ce que je dois rendre un dossier ?', 'quels agents sont en retard', 'dossiers non retournés',
    'qu\'est-ce que je dois rapporter aux archives ?', 'y a-t-il des retards ?', 'dossiers dont la date de retour est passée',
  ],
  journee: [
    'Qu\'est-ce que j\'ai à traiter ?', 'ma journée', 'quoi de neuf aujourd\'hui ?', 'combien de demandes en attente pour moi', 'qu\'est-ce que je dois faire ce matin ?',
    'les demandes à transmettre', 'nouvelles demandes ?', 'le travail du jour', 'quelles demandes sont arrivées ?', 'résumé de la journée',
  ],
  chiffres: [
    'Combien de dossiers entrés ce mois ?', 'combien de dossiers sortis ?', 'nombre de demandes cette semaine', 'combien de dossiers en {M} {Y} ?',
    'combien de dossiers retournés aujourd\'hui', 'combien de demandes en {Y}', 'total des dossiers entrés cette année', 'combien d\'agents ?',
    'statistiques du mois', 'combien de dossiers sont dehors en ce moment ?', 'il y a eu combien de points cette semaine',
  ],
  semaine: [
    'Semaine du {D}', 'les dossiers entrés le {D}', 'point du {D}', 'qu\'est-ce qui est entré la semaine du {D} ?', 'dossiers du {D}',
    'montre-moi la semaine du {D}', 'combien de dossiers le {D}', 'les entrées du {D}',
  ],
  aide: [
    'Comment demander un dossier ?', 'comment faire une demande', 'comment demander plusieurs dossiers ?', 'comment annuler une demande ?',
    'que faire quand on me demande des compléments ?', 'comment rendre un dossier ?', 'combien de temps puis-je garder un dossier ?',
    'c\'est quoi la copie M-Files ?', 'comment marche la douchette ?', 'comment importer les points Excel ?', 'où est le plan des armoires ?',
    'comment changer mon mot de passe ?', 'comment créer un compte pour un collègue ?', 'à quoi sert le motif ?', 'comment on classe les dossiers ?',
    'pourquoi la semaine commence le vendredi ?', 'comment trouver un acte de décembre ?', 'j\'ai oublié mon mot de passe', 'comment supprimer un classeur importé',
    'c\'est quoi une typologie ?', 'qui peut créer des comptes ?', 'comment envoyer une liste de soldes créditeurs',
  ],
  salut: ['Bonjour', 'bonsoir', 'merci', 'merci beaucoup', 'salut DocuBot', 'ok merci', 'bonjour docubot'],
  autre: [
    'Quel temps fait-il à Cotonou ?', 'raconte-moi une blague', 'qui a gagné le match hier ?', 'quel est le cours du dollar ?', 'écris-moi un poème',
    'quelle heure est-il ?', 'tu es qui ?', 'traduis ce texte en anglais', 'combien font 12 fois 8 ?', 'donne-moi une recette de pâte',
  ],
};
// Proportions : les questions de dossiers dominent l'usage réel.
const POIDS = { ou_est: 0.25, qui_a: 0.15, mes_demandes: 0.1, retards: 0.08, journee: 0.06, chiffres: 0.09, semaine: 0.06, aide: 0.13, salut: 0.03, autre: 0.05 };

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Comme on écrit vraiment : sans accents, en minuscules, sans ponctuation, abrégé. */
function bruiter(q) {
  let s = q;
  if (peutEtre(0.25)) s = sansAccents(s);
  if (peutEtre(0.3)) s = s.toLowerCase();
  if (peutEtre(0.2)) s = s.replace(/[?!.]+$/, '');
  if (peutEtre(0.1)) s = s.replace(/s'il vous plaît|svp/gi, 'stp');
  if (peutEtre(0.08)) s = `${un(['Bonjour, ', 'Bonjour DocuBot, ', 'Salut, ', 'Dis-moi, '])}${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  if (peutEtre(0.06)) s = `${s} ${un(['svp', 'merci', 's\'il vous plaît', 'stp'])}`;
  return s.replace(/\s+/g, ' ').trim();
}

function exempleAnalyse(intention, noms) {
  const modele = un(MODELES[intention]);
  const nom = un(noms);
  const prefixe = un(PREFIXE);
  const acte = unActe();
  const date = uneDate();
  const mois = Math.floor(hasard() * 12);
  // Le nom attendu, sans « Société », « Ets »… : comme DocuFlow le cherche.
  let entreprise = modele.includes('{E}') ? nom : null;
  let question = modele.replace('{P} {E}', `${prefixe} ${nom}`).replace('{E}', nom).replace('{A}', acte).replace('{D}', date.ecrit)
    .replace('{M}', MOIS[mois]).replace('{Y}', String(un([2024, 2025, 2026])));
  if (entreprise) entreprise = entreprise.replace(/^(Ets|Établissements)\s+/i, '');
  question = bruiter(question);
  // Le nom tel que la personne l'a écrit (sans accents ou en minuscules si elle l'a fait).
  if (entreprise) {
    const ecrit = new RegExp(sansAccents(entreprise).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(sansAccents(question));
    entreprise = ecrit ? question.substr(ecrit.index, ecrit[0].length) : entreprise;
  }
  const attendu = {
    intention,
    entreprise,
    acte: modele.includes('{A}') ? acte : null,
    date: modele.includes('{D}') ? date.iso : null,
  };
  return {
    prompt: [{ role: 'system', content: CONSIGNE_ANALYSE }, { role: 'user', content: question }],
    completion: [{ role: 'assistant', content: JSON.stringify(attendu) }],
  };
}

// ---------------------------------------------------------------------------
// Rédaction : des réponses fondées sur les passages, et des refus quand ils ne
// couvrent pas la question.
// ---------------------------------------------------------------------------
const REDACTION = [
  { q: ['Pourquoi la semaine commence-t-elle le vendredi ?', 'la semaine de production, c\'est quoi ?', 'c\'est quoi une semaine de production'], p: [1, 0],
    r: 'Aux archives, une semaine de production va du vendredi au jeudi suivant, jours fériés exclus. Avec la date du point, c\'est ce qui permet de retrouver un dossier entré.' },
  { q: ['Comment sont classés les dossiers ?', 'comment on range les dossiers dans une semaine', 'les dossiers sont classés comment ?'], p: [2, 3],
    r: 'Dans chaque semaine, les dossiers sont classés par lettre : la première lettre du nom de l\'entreprise, sans « Société », « Ets » ni « SARL ». Ils sont rangés dans les armoires du couloir des toilettes, selon le plan de l\'onglet « Rangement ».' },
  { q: ['Comment écrire le numéro d\'acte ?', 'le n° d\'acte s\'écrit comment', 'je ne trouve pas un acte de décembre'], p: [8],
    r: 'Écrivez le n° d\'acte avec son année, par exemple 2025/2479. Un acte de décembre est souvent entré en janvier de l\'année suivante : cherchez aussi dans cette année-là.' },
  { q: ['C\'est quoi une typologie ?', 'à quoi sert la typologie', 'pourquoi choisir la typologie ?'], p: [7],
    r: 'La typologie est le type du dossier : attestation, bonne exécution, avance de démarrage, caution douanière, prêt, garantie bancaire… Elle fait partie de l\'intitulé du dossier, et certaines exigent le n° d\'acte, l\'année ou la banque.' },
  { q: ['Mes données sortent-elles de l\'AFGC ?', 'est-ce que DocuBot envoie mes questions sur internet ?', 'c\'est sécurisé ?'], p: [18],
    r: 'Non : l\'application tourne sur le serveur interne de l\'AFGC, et les documents comme les questions posées à DocuBot ne sortent pas du réseau.' },
  { q: ['Comment supprimer un classeur importé par erreur ?', 'j\'ai importé le mauvais fichier excel'], p: [14],
    r: 'Ouvrez « Entrée des dossiers », onglet « Classeurs importés », et supprimez le classeur. Vous pourrez ensuite importer le bon : une ligne déjà importée n\'est jamais ajoutée deux fois.' },
  { q: ['Que montre le tableau de bord ?', 'à quoi sert le tableau de bord'], p: [17],
    r: 'Le tableau de bord de la direction montre les demandes, les sorties, les retards et les entrées des dossiers, par période.' },
  { q: ['Quel est le salaire d\'un archiviste ?', 'combien coûte un classeur ?', 'quels sont les horaires de la cantine ?', 'qui est le directeur général ?'], p: [0, 4],
    r: 'Je n\'ai pas cette information dans les procédures des archives. Pour cette question, adressez-vous directement à l\'archive ou au service concerné.' },
];

function exemplesRedaction() {
  const res = [];
  for (const e of REDACTION) {
    for (const q of e.q) {
      for (let k = 0; k < 3; k += 1) {
        // Les bons passages, plus un ou deux sans rapport, dans le désordre.
        const ids = [...e.p, ...Array.from({ length: 1 + Math.floor(hasard() * 2) }, () => Math.floor(hasard() * CONNAISSANCES.length))];
        const passages = [...new Set(ids)].sort(() => hasard() - 0.5).map((i) => CONNAISSANCES[i]);
        res.push({
          prompt: [
            { role: 'system', content: `${CONSIGNE_REDACTION}\n\nInformations :\n${passages.map((p, i) => `[${i + 1}] ${p}`).join('\n')}` },
            { role: 'user', content: bruiter(q) },
          ],
          completion: [{ role: 'assistant', content: e.r }],
        });
      }
    }
  }
  return res;
}


/**
 * Le jeu complet : { entrainement, test }. `noms` : noms d'entreprise à
 * utiliser (par défaut, inventés). Les noms du test ne servent pas à
 * l'entraînement : on mesure la généralisation, pas la mémoire.
 */
function generer({ nombre = 4000, noms = null } = {}) {
  semer(20261118);
  const liste = noms && noms.length ? noms : Array.from({ length: 1500 }, nomInvente);
  const coupure = Math.floor(liste.length * 0.85);
  const nomsEntr = liste.slice(0, coupure);
  const nomsTest = liste.slice(coupure);
  const tirer = () => {
    let x = hasard();
    for (const [k, p] of Object.entries(POIDS)) { if (x < p) return k; x -= p; }
    return 'ou_est';
  };
  const entrainement = Array.from({ length: nombre }, () => exempleAnalyse(tirer(), nomsEntr));
  const test = Array.from({ length: Math.round(nombre * 0.1) }, () => exempleAnalyse(tirer(), nomsTest));
  const redac = exemplesRedaction();
  entrainement.push(...redac.filter((_, i) => i % 6 !== 0));
  test.push(...redac.filter((_, i) => i % 6 === 0));
  entrainement.sort(() => hasard() - 0.5);
  return { entrainement, test };
}

const enJsonl = (l) => `${l.map((x) => JSON.stringify(x)).join('\n')}\n`;

module.exports = { generer, enJsonl, nomInvente, MODELES };
