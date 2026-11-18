// ============================================================================
// DocuBot (édition AFGC) : répond en langage courant sur les archives.
//
//   « Où est le dossier Credo BTP ? »       → semaine, point, lettre, armoire ;
//   « Qui a le dossier Zénith ? »           → chez qui, retour prévu (archive) ;
//   « Où en est ma demande ? »              → l'état de mes demandes ;
//   « Quels dossiers sont en retard ? »     → à récupérer (archive) / à rendre ;
//   « Combien de dossiers entrés ce mois ? »→ les chiffres ;
//   « Qu'est-ce que j'ai à traiter ? »      → la journée de l'archive ;
//   « Comment demander plusieurs dossiers ?»→ l'aide, avec le lien.
//
// Tout est calculé sur le serveur, à partir des données de l'organisation et
// des droits de la personne : un agent ne voit que ses demandes, et jamais
// qui détient un dossier. Les modèles d'iaService (noms proches, lecture des
// phrases, aide par le sens) affinent les réponses quand ils sont là ; sans
// eux, les règles suffisent.
// ============================================================================

const db = require('../config/db');
const ia = require('./iaService');
const roleService = require('./roleService');
const entreeService = require('./entreeService');
const settingsService = require('./settingsService');
const { NOM_SIMPLE, nomSimple } = require('../helpers/nomEntreprise');
const ollama = require('./ollamaService');
const appris = require('./intentionService');
const apprentissage = require('./apprentissageService');
const agent = require('./docubotAgent');
const CONNAISSANCES = require('../config/connaissancesAfgc');

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plat = (s) => ` ${sansAccents(s).replace(/[^a-z0-9/]+/g, ' ').trim()} `;
const a = (texte, ...motifs) => motifs.some((m) => (m instanceof RegExp ? m.test(texte) : texte.includes(` ${m} `)));

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_AFF = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS_AFF = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const iso = (d) => d.toISOString().slice(0, 10);
const jourAff = (s) => {
  if (!s) return '';
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  return `${JOURS_AFF[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS_AFF[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const pluriel = (n, mot, pl = `${mot}s`) => `${n} ${n > 1 ? pl : mot}`;

// ---------------------------------------------------------------------------
// Lecture de la question
// ---------------------------------------------------------------------------

/** Une date écrite : « 3 octobre 2025 », « 03/10/2025 », « 2025-10-03 ». */
function dateDans(texte, aujourdhui = new Date()) {
  const s = sansAccents(texte);
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(s);
  if (m) {
    const an = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : aujourdhui.getUTCFullYear();
    return `${an}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = new RegExp(`\\b(\\d{1,2}|1er)\\s+(${MOIS.join('|')})(?:\\s+(\\d{4}))?\\b`).exec(s);
  if (m) {
    const an = m[3] ? Number(m[3]) : aujourdhui.getUTCFullYear();
    const j = m[1] === '1er' ? 1 : Number(m[1]);
    return `${an}-${String(MOIS.indexOf(m[2]) + 1).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  }
  return null;
}

/** La période d'une question de chiffres : { du, au, libelle } (au exclu). */
function periodeDans(texte, aujourdhui = new Date()) {
  const s = plat(texte);
  const j = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), aujourdhui.getUTCDate()));
  const plus = (d, n) => new Date(d.getTime() + n * 86400000);
  if (a(s, 'aujourd hui', 'ce jour')) return { du: iso(j), au: iso(plus(j, 1)), libelle: 'aujourd\'hui' };
  if (a(s, 'hier')) return { du: iso(plus(j, -1)), au: iso(j), libelle: 'hier' };
  if (a(s, 'cette semaine', 'la semaine')) {
    // Semaine de production : du vendredi au jeudi.
    const recul = (j.getUTCDay() + 2) % 7;
    const debut = plus(j, -recul);
    return { du: iso(debut), au: iso(plus(debut, 7)), libelle: 'cette semaine (depuis vendredi)' };
  }
  if (a(s, 'ce mois', 'du mois', 'le mois')) {
    const debut = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1));
    return { du: iso(debut), au: iso(new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 1))), libelle: 'ce mois-ci' };
  }
  const mois = MOIS.findIndex((m) => s.includes(` ${m} `));
  const an = /\b((?:19|20)\d{2})\b/.exec(s);
  if (mois >= 0) {
    const y = an ? Number(an[1]) : j.getUTCFullYear();
    return {
      du: iso(new Date(Date.UTC(y, mois, 1))), au: iso(new Date(Date.UTC(y, mois + 1, 1))),
      libelle: `en ${MOIS_LONG[mois]} ${y}`,
    };
  }
  if (an) return { du: `${an[1]}-01-01`, au: `${Number(an[1]) + 1}-01-01`, libelle: `en ${an[1]}` };
  if (a(s, 'cette annee', 'l annee')) return { du: `${j.getUTCFullYear()}-01-01`, au: `${j.getUTCFullYear() + 1}-01-01`, libelle: 'cette année' };
  return null;
}

// Mots des questions, à retirer pour garder le nom de l'entreprise.
const BRUIT = new Set(('ou est se trouve trouve trouver retrouver cherche chercher localiser present presente presents il elle ils est ce que '
  + 'qu quel quelle quels quelles qui a chez detient possede sorti sortie emprunte emprunt le la les l un une des de du d au aux '
  + 'dossier dossiers archive archives entree entrees entre armoire semaine point date lettre dans pour sur en et svp merci stp '
  + 'je voudrais veux vouloir besoin faut il me moi mon ma mes demande demander demandee demandes donne donner trouve '
  + 'bonjour salut bonsoir docubot s il te vous plait peux pouvez pourrais avoir savoir dire connaitre societe entreprise ets etablissements '
  + 'statut etat suivi en cours ou en est rendu revenu retour retourne actuellement maintenant toujours encore deja y avoir est-ce '
  + 'sont ai as avez avons ont j puis peux ce cet cette ces mois annee temps garder combien quand pourquoi comment nos notre votre vos leur leurs').split(' '));

/** Le nom cherché dans la question : ce qui reste une fois les mots de la question retirés. */
// Verbes et mots courants des questions libres : jamais un nom d'entreprise.
const COURANTS = new Set(('tu sais peux pouvez pourriez voudrais veux vouloir faut besoin savoir dire voir vu vérifier verifier montre montrer '
  + 'montre-moi dis-moi donne-moi retrouve retrouver trouve trouver cherche chercher localiser arrive arriver arrivé arrive recu reçu recus '
  + 'range rangé rangee classé classe classer entre entré pris prendre parti partie rapporte rapporté ramene ramené restitue restitué '
  + 'remis rendre rendu revient revenir revenu emprunte emprunté garde garder détient detient possède possede travaille sorti sortie '
  + 'transmis transmise traité traitée traite validé validée validées valide pas ou oui non ete été deja déjà toujours encore '
  + 'actuellement maintenant hier aujourd lundi mardi mercredi jeudi vendredi samedi dimanche quand depuis quelqu quelqu\'un un agent '
  + 'casier rayon armoire semaine point date lettre mme m monsieur madame mr dans chez vous nous moi on c\'est est-ce n\'est '
  + 'disponible disponibles dispo libre libres donne donnez donner apporte apportez envoie envoyez envoyer g jai j\'ai c svp stp '
  + 'mon ma mes ton ta tes son sa ses notre votre leur reçois recois recevoir reçu quand pourquoi encore toujours').split(' '));
const norm = (m) => sansAccents(m).replace(/^[ld]['’]/, '').replace(/['’].*$/, '');
const inutile = (m) => /^[ldLDjJnNsScC]?['’]?$/.test(m) || BRUIT.has(norm(m)) || COURANTS.has(norm(m)) || COURANTS.has(sansAccents(m));

/**
 * Le nom cherché dans la question. Dans l'ordre : les mots en majuscule
 * (« Kalimo SARL », « Zinvo Transit ») — de préférence ceux qui suivent
 * « dossier » —, puis ce qui suit « dossier » ou « société », puis ce qui
 * reste une fois les mots de la question retirés. `majuscules` : seulement
 * le premier cas (le suivi de ses demandes ne cherche pas « lundi »).
 */
function nomDans(question, { majuscules = false } = {}) {
  const acte = ia.acteDans(question);
  // Les points d'un sigle (« B.T.P ») restent ; ceux de fin de phrase partent.
  let s = String(question || '').replace(/[?!,;:«»"“”()]/g, ' ').replace(/\.(?=\s|$)/g, ' ');
  if (acte) s = s.replace(acte, ' ');
  s = s.replace(/\bactes?\s*(n\s*[°o.]?)?\s*/gi, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
  const mots = s.split(/\s+/).filter(Boolean).map((m) => m.replace(/^[ldLD]['’](?=\p{Lu})/u, ''));

  // 1. Les suites de mots en majuscule (« et », « & » permis au milieu).
  const suites = [];
  let suite = null;
  mots.forEach((m, i) => {
    const majuscule = /^[\p{Lu}0-9]/u.test(m) && !inutile(m);
    if (majuscule) {
      if (!suite) suite = { debut: i, mots: [] };
      suite.mots.push(m);
    } else if (suite && ['et', '&'].includes(m.toLowerCase()) && /^\p{Lu}/u.test(mots[i + 1] || '')) {
      suite.mots.push(m);
    } else if (suite) { suites.push(suite); suite = null; }
  });
  if (suite) suites.push(suite);
  if (suites.length) {
    const apresDossier = suites.find((x) => /^(dossier|dossiers|classeur|société|societe|entreprise|ets|établissements|etablissements)$/i.test(mots[x.debut - 1] || '')
      || /^(dossier|société|societe)$/i.test(mots[x.debut - 2] || ''));
    const choisie = apresDossier || suites.sort((x, y) => y.mots.length - x.mots.length)[0];
    const nom = choisie.mots.join(' ');
    if (nom.length >= 2) return nom;
  }
  if (majuscules) return null;

  // 2. Ce qui suit « dossier (de la société) » jusqu'au premier mot de question.
  const i = mots.findIndex((m) => /^(dossier|classeur|société|societe|entreprise)$/i.test(m));
  if (i >= 0) {
    const apres = [];
    for (const m of mots.slice(i + 1)) {
      if (['de', 'du', 'des', 'la', 'le', 'l'].includes(m.toLowerCase()) && !apres.length) continue;
      if (/^(société|societe|ets|entreprise|établissements|etablissements)$/i.test(m) && !apres.length) continue;
      if (inutile(m)) break;
      apres.push(m);
    }
    if (apres.join(' ').length >= 2) return apres.join(' ');
  }

  // 3. Ce qui reste.
  const nom = mots.filter((m) => !inutile(m)).join(' ').trim();
  return nom.length >= 2 ? nom : null;
}

/** L'entreprise visée : lue par le modèle, sinon après « société », sinon ce qui reste. */
async function entrepriseDans(question) {
  const lu = await ia.lireDemande(question, []).catch(() => ({}));
  const nom = lu.entreprise || ia.entrepriseNommee(question) || nomDans(question);
  return { nom, acte: lu.acte || ia.acteDans(question), annee: lu.annee || null };
}

// Confiance minimale pour suivre le modèle appris plutôt que les règles
// (mesurée : 96 % de questions libres comprises, contre 71 % pour les règles).
const SEUIL_APPRIS = 0.6;

/**
 * Règles sûres : des tournures sans ambiguïté, que le modèle appris ne
 * contredit pas. Rend une intention, ou null.
 */
function regleSure(question) {
  const s = plat(question);
  // Plan de classement, calendrier de conservation : durées, sort final, cote, où classer.
  if (a(s, /\bconserv/, 'sort final', /\belimin/, /\bdetrui/, 'plan de classement', 'calendrier', /\bou (classer|ranger)\b/, /\bcote\b/, /\bclasse t on\b/, /\bduree d utilite\b/)
    && !a(s, /\bmon dossier\b/, /\bma demande\b/)) return 'conservation';
  // Un numéro seul : un n° d'acte.
  if (/^\s*(?:acte\s*)?(?:n\s*[°o.]?\s*)?\d{2,6}(?:\s*\/\s*\d{1,6})?\s*\??\s*$/i.test(question)) return 'ou_est';
  if (a(s, 'mes prets', 'mes emprunts', 'chez moi', 'dossiers que j ai', 'j ai combien de dossiers', 'ai je des dossiers', 'dossiers que je dois rendre', 'je dois rendre')) return 'mes_prets';
  if (a(s, /\bsorti?s? aujourd hui\b/, /\bsorti?e?s? ce matin\b/, 'transmis aujourd hui', 'sorties du jour', 'sorties d aujourd hui')) return 'sorties_jour';
  if (a(s, 'dossiers de la semaine', 'entrees de la semaine', 'entres cette semaine', 'dossiers d aujourd hui', 'entres aujourd hui', 'point du jour', 'point d aujourd hui', 'semaine en cours', 'dossiers entres aujourd hui')) return 'semaine';
  if (a(s, 'quand est ce que je recois', 'je recois quand', 'quand je recois', 'quand vais je recevoir', 'toujours rien recu', 'rien recu', 'pas encore recu', 'pas encore donne', 'on m a oublie', 'arrive quand', 'je l aurai quand', 'mon dossier', 'ma demande', 'mes demandes')) return 'mes_demandes';
  return null;
}

/** L'intention de la question. */
function intention(question, { archive }) {
  const s = plat(question);
  const brut = sansAccents(question).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(bonjour|salut|bonsoir|hello|coucou|slt|bjr|bsr|cc|salam|yo|hey|bonjour docubot|salut docubot)( docubot| a vous| a toi| ca va| tout le monde)?$/.test(brut)) return 'salut';
  if (/^(ok|okay|d accord|dac|super|parfait|tres bien|bien recu|compris|cool|top|nickel|merci|merci beaucoup|merci bcp|mrc|thanks)( merci| beaucoup| bcp| docubot)?$/.test(brut)) return 'merci';
  if (/^(aide|help|aidez moi|aide moi|au secours|que sais tu faire|tu sers a quoi|que peux tu faire)$/.test(brut)) return 'aide';
  // Un numéro seul : un n° d'acte.
  if (/^\s*(?:acte\s*)?(?:n\s*[°o.]?\s*)?\d{2,6}(?:\s*\/\s*\d{1,6})?\s*\??\s*$/i.test(question)) return 'ou_est';
  if (a(s, 'merci') && s.trim().split(' ').length <= 4) return 'merci';
  if (a(s, /^ (comment|que faire|quoi faire|a quoi sert|c est quoi|qu est ce qu|ou trouver|aide|help|peut on|puis je|est il possible)\b/)) return 'aide';
  if (a(s, 'combien de temps', 'quel delai', 'quelle duree', 'jusqu a quand')) return 'aide';
  if (a(s, 'combien', 'nombre de', 'nombre d', 'statistique', 'statistiques', 'total', 'stat', 'stats', 'chiffres', 'bilan')) return 'chiffres';
  if (a(s, /\bsemaine du\b/, /\bpoint du\b/, /\bentres? le\b/, /\bentrees? du\b/) && dateDans(question)) return 'semaine';

  if (a(s, 'retard', 'a recuperer', 'pas rendu', 'pas revenu', 'pas encore rendu', 'non rendus', 'a rendre', 'a retourner')) return 'retards';
  if (a(s, 'a traiter', 'ma journee', 'a transmettre', 'nouvelles demandes', 'en attente', 'quoi faire aujourd hui', 'que dois je faire', 'mon travail')) return archive ? 'journee' : 'mes_demandes';
  if (a(s, 'qui a', 'chez qui', 'qui detient', 'qui possede', 'qui l a', 'emprunte par', 'sorti chez', 'est revenu', 'est il revenu', 'est rentre', 'est il rentre', 'a ete rendu', 'est il rendu', 'est il sorti', 'est sorti')) return 'qui_a';
  if (a(s, 'mes demandes', 'ma demande', 'mes dossiers', 'ou en est', 'ou en sont', 'statut', 'suivi', 'mes prets')) return 'mes_demandes';
  if (a(s, 'je voudrais', 'je veux', 'il me faut', 'j ai besoin', 'demander le', 'demande le', 'besoin du', 'besoin de')) return 'demander';
  if (a(s, 'ou est', 'ou se trouve', 'present', 'presente', 'aux archives', 'quelle armoire', 'quelle semaine', 'entre aux', 'est il entre', 'trouver', 'retrouver', 'cherche', 'localiser')) return 'ou_est';
  return 'inconnu';
}

// ---------------------------------------------------------------------------
// L'aide : questions fréquentes, par rôle.
// ---------------------------------------------------------------------------

const AIDE = [
  { cle: 'plusieurs', mots: 'plusieurs dossiers liste excel coller colonne lot solde crediteur',
    texte: 'Collez-les dans la boîte de demande, **un par ligne** (une colonne copiée d\'Excel ou d\'un courriel) : ils partent ensemble. Pour un classeur entier, utilisez « **Demander une liste (Excel)** ».',
    lien: { libelle: 'Demander une liste', vers: '/demandes/nouvelle' } },
  { cle: 'demander', mots: 'demander demande nouvelle obtenir sortir',
    texte: 'Tapez le **nom de l\'entreprise** ou le **n° d\'acte** dans « Quel dossier vous faut-il ? », vérifiez le motif et la typologie, puis **Entrée**. L\'archive est prévenue aussitôt.',
    lien: { libelle: 'Demander un dossier', vers: '/demandes/nouvelle' } },
  { cle: 'annuler', mots: 'annuler supprimer erreur retirer demande',
    texte: 'Juste après l\'envoi, cliquez sur **Annuler**. Plus tard, ouvrez **Mes dossiers** : une demande pas encore transmise peut être annulée.',
    lien: { libelle: 'Mes dossiers', vers: '/demandes/mes-demandes' } },
  { cle: 'complements', mots: 'complement completer informations manquantes renvoyee rejetee refusee',
    texte: 'Quand l\'archive manque d\'informations, la demande revient « **À compléter** » dans Mes dossiers, avec ce qui manque. Complétez-la : elle repart à l\'archive.',
    lien: { libelle: 'Mes dossiers', vers: '/demandes/mes-demandes' } },
  { cle: 'rendre', mots: 'rendre retourner rapporter restituer retour dossier fini termine',
    texte: 'Rapportez le dossier à l\'archive : elle enregistre le retour (douchette ou « Dossiers sortis »). Vous voyez la date de retour prévue dans **Mes dossiers**.',
    archive: 'Dans **Dossiers sortis**, choisissez le dossier puis « Retourné », ou passez son n° d\'acte à la **Douchette**.',
    lien: { libelle: 'Mes dossiers', vers: '/demandes/mes-demandes' }, lienArchive: { libelle: 'Dossiers sortis', vers: '/demandes/prets' } },
  { cle: 'delai', mots: 'delai duree combien de temps garder jours retour prevu pret',
    texte: 'Un dossier se garde **{jours} jours** ; la date de retour prévue s\'affiche dans Mes dossiers, et un rappel part en cas de retard.' },
  { cle: 'mfiles', mots: 'mfiles m files numerise numerique copie scan pdf 2025',
    texte: 'Les dossiers des années numérisées ({annees}) sont dans **M-Files** : l\'archive vous envoie la copie, le papier ne sort pas.' },
  { cle: 'entrees', mots: 'entree des dossiers point semaine vendredi jeudi lettre classement retrouver dossier archive',
    archiveSeul: true,
    texte: '« **Entrée des dossiers** » range les points par semaine de production (du vendredi au jeudi, jours fériés exclus), puis par lettre. L\'onglet « Rechercher » trouve un dossier par nom ou n° d\'acte.',
    lien: { libelle: 'Entrée des dossiers', vers: '/archives/entrees' } },
  { cle: 'importer', mots: 'importer point excel classeur televerser charger fichier',
    archiveSeul: true,
    texte: 'Dans « Entrée des dossiers », cliquez sur **Importer des points (Excel)** : les lignes déjà importées sont ignorées, seules les nouvelles s\'ajoutent.',
    lien: { libelle: 'Entrée des dossiers', vers: '/archives/entrees' } },
  { cle: 'douchette', mots: 'douchette code barre scanner lecteur scan',
    archiveSeul: true,
    texte: 'Ouvrez la **Douchette** et passez le code (ou tapez le n° d\'acte) : le dossier s\'affiche avec « Sortir » ou « Rentrer ».',
    lien: { libelle: 'Douchette', vers: '/archives/douchette' } },
  { cle: 'armoire', mots: 'armoire armoires rangement plan couloir ranger placer',
    archiveSeul: true,
    texte: 'Le plan des armoires est dans « Entrée des dossiers » → **Rangement** : chaque armoire couvre des semaines et des lettres ; la recherche indique l\'armoire du dossier.',
    lien: { libelle: 'Rangement', vers: '/archives/entrees' } },
  { cle: 'transmettre', mots: 'transmettre traiter demande recue servir donner dossier agent',
    archiveSeul: true,
    texte: 'Dans **À traiter**, ouvrez la demande, puis « Transmettre » (le papier) ou « Servi par M-Files » (la copie). Il manque une information ? « Demander des compléments ».',
    lien: { libelle: 'À traiter', vers: '/demandes/a-traiter' } },
  { cle: 'motdepasse', mots: 'mot de passe changer modifier oublie connexion identifiant profil',
    texte: 'Cliquez sur **votre nom**, en bas à gauche, puis « Mot de passe ». Mot de passe oublié : demandez à l\'administrateur de le réinitialiser.' },
  { cle: 'compte', mots: 'compte creer inscription inscrire nouveau agent collegue acces',
    nonAdmin: true,
    texte: 'Un agent crée son compte avec « **Créer un compte** », sur la page de connexion, avec son adresse professionnelle. Sinon, l\'administrateur le crée dans Comptes.' },
  { cle: 'comptes', mots: 'compte creer utilisateur agent nouveau desactiver role archiviste',
    admin: true,
    texte: 'Dans **Comptes** : « Nouvel utilisateur », son rôle (Demandeur, Archiviste…) et son département. Un agent qui part se **désactive** (ses demandes restent).',
    lien: { libelle: 'Comptes', vers: '/admin/comptes' } },
];

let vecteursAide = null;
async function aideParLeSens(question, candidates) {
  if (!ia.actif('recherche')) return null;
  try {
    if (!vecteursAide) {
      const v = await ia.vecteurs(AIDE.map((x) => x.mots));
      if (!v) return null;
      vecteursAide = v;
    }
    const [q] = (await ia.vecteurs([question])) || [];
    if (!q) return null;
    let meilleur = null;
    for (const c of candidates) {
      const v = vecteursAide[AIDE.indexOf(c)];
      let s = 0;
      for (let i = 0; i < v.length; i += 1) s += v[i] * q[i];
      if (!meilleur || s > meilleur.s) meilleur = { c, s };
    }
    return meilleur && meilleur.s >= 0.82 ? meilleur.c : null;
  } catch {
    return null;
  }
}

async function repondreAide(tenantId, question, droits) {
  const candidates = AIDE.filter((x) => (!x.archiveSeul || droits.archive) && (!x.admin || droits.admin) && (!x.nonAdmin || !droits.admin));
  const VIDES = new Set(['comment', 'faire', 'peut', 'puis', 'quoi', 'que', 'est', 'une', 'des', 'les', 'mon', 'mes', 'dossier', 'dossiers', 'utiliser', 'marche', 'fonctionne', 'avec', 'pour', 'dans']);
  const mots = plat(question).trim().split(' ').filter((m) => m.length >= 3 && !VIDES.has(m));
  const score = (x) => mots.filter((m) => ` ${x.mots} `.includes(` ${m} `) || x.mots.split(' ').some((k) => k.length >= 5 && m.startsWith(k.slice(0, 5)))).length;
  const choix = candidates.map((x) => ({ x, n: score(x) })).sort((p, q) => q.n - p.n)[0];
  let entree = choix && choix.n > 0 ? choix.x : null;
  if (!entree) entree = await aideParLeSens(question, candidates);
  if (!entree) {
    const redige = await rediger(tenantId, question, droits);
    if (redige) return redige;
    const general = /^(aide|help|aidez moi|aide moi|au secours|que sais tu faire|tu sers a quoi|que peux tu faire)$/.test(plat(question).trim());
    return {
      texte: general
        ? 'Je peux **trouver un dossier** (nom ou n° d\'acte), dire **s\'il est disponible** ou chez qui, suivre **vos demandes**, signaler **les retards**, donner **des chiffres**, et expliquer l\'application. Par exemple :'
        : 'Je n\'ai pas trouvé d\'aide sur ce point. Voici ce que je sais expliquer :',
      suggestions: candidates.slice(0, 5).map((x) => QUESTION_AIDE[x.cle]).filter(Boolean),
    };
  }
  const reglages = await settingsService.getAll(tenantId).catch(() => ({}));
  const texte = (droits.archive && entree.archive ? entree.archive : entree.texte)
    .replace('{jours}', reglages.loan_default_days || 15)
    .replace('{annees}', reglages.mfiles_annees || 'à régler par l\'administrateur');
  const lien = droits.archive && entree.lienArchive ? entree.lienArchive : entree.lien;
  return { texte, actions: lien ? [{ type: 'lien', ...lien }] : [] };
}

/** Les passages les plus proches de la question (mots en commun), pour la rédaction par Ollama. */
function passagesPour(question, droits, n = 4) {
  const mots = plat(question).trim().split(' ').filter((m) => m.length >= 4);
  const tous = [...CONNAISSANCES, ...AIDE.filter((x) => (!x.archiveSeul || droits.archive)).map((x) => x.texte.replace(/\*\*/g, ''))];
  return tous
    .map((p) => ({ p, n: mots.filter((m) => plat(p).includes(` ${m.slice(0, 6)}`)).length }))
    .filter((x) => x.n > 0).sort((x, y) => y.n - x.n).slice(0, n).map((x) => x.p);
}

/** Réponse rédigée par Ollama à partir des passages ; null s'il n'est pas là. */
async function rediger(tenantId, question, droits) {
  const passages = passagesPour(question, droits);
  if (!passages.length) return null;
  const r = await ollama.rediger(tenantId, question, passages);
  return r ? { texte: r.texte, source: 'ollama' } : null;
}

const VOCABULAIRE_AIDE = new Set(AIDE.flatMap((x) => x.mots.split(' ')).filter((m) => m.length >= 4));
/** Le « nom » n'est-il fait que de mots de l'aide (« plan armoires », « mot passe ») ? */
function sujetDAide(nom) {
  const mots = plat(nom || '').trim().split(' ').filter((m) => m.length >= 3);
  return mots.length > 0 && mots.every((m) => VOCABULAIRE_AIDE.has(m) || ['plan', 'mot', 'passe'].includes(m));
}

const QUESTION_AIDE = {
  demander: 'Comment demander un dossier ?', plusieurs: 'Comment demander plusieurs dossiers ?',
  annuler: 'Comment annuler une demande ?', complements: 'Que faire quand on me demande des compléments ?',
  rendre: 'Comment rendre un dossier ?', delai: 'Combien de temps puis-je garder un dossier ?',
  mfiles: 'C\'est quoi la copie M-Files ?', entrees: 'Comment marche l\'entrée des dossiers ?',
  importer: 'Comment importer les points Excel ?', douchette: 'Comment utiliser la douchette ?',
  armoire: 'Où est le plan des armoires ?', transmettre: 'Comment transmettre une demande ?',
  motdepasse: 'Comment changer mon mot de passe ?', comptes: 'Comment créer un compte ?', compte: 'Comment créer un compte ?',
};

// ---------------------------------------------------------------------------
// Les réponses
// ---------------------------------------------------------------------------

/** Les dossiers sortis (non rentrés) qui correspondent à un nom ; ceux de l'agent seulement s'il n'est pas de l'archive. */
async function sortiesDe(tenantId, nom, { userId = null } = {}) {
  const echappe = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);
  // Par le texte tapé, ou par le nom simplifié (« CREDO BTP SARL » ↔ « Crédo BTP »).
  const params = [tenantId, `%${echappe(nom)}%`, `%${echappe(nomSimple(nom))}%`];
  if (userId) params.push(userId);
  const r = await db.query(
    `SELECT q.nom_entreprise, q.num_acte, q.type_document, to_char(l.remis_at, 'YYYY-MM-DD') AS remis_le,
            to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu, (l.date_retour_prevue < CURRENT_DATE) AS en_retard,
            u.full_name AS chez, l.emprunteur_id AS chez_id
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.retourne_at IS NULL
        AND (q.nom_entreprise ILIKE $2 OR q.num_acte ILIKE $2 OR q.num_dossier ILIKE $2
             OR ${NOM_SIMPLE.replace('lower(denomination)', 'lower(q.nom_entreprise)')} LIKE $3)
        ${userId ? 'AND l.emprunteur_id = $4' : ''}
      ORDER BY l.date_retour_prevue LIMIT 5`,
    params
  );
  return r.rows;
}

const ligneSortie = (p, avecChez) => ({
  titre: [p.nom_entreprise, p.type_document].filter(Boolean).join(' · ') || 'Dossier',
  lignes: [
    p.num_acte && `Acte ${p.num_acte}`,
    avecChez && p.chez && `Chez **${p.chez}** depuis le ${jourAff(p.remis_le)}`,
    p.retour_prevu && `Retour prévu le ${jourAff(p.retour_prevu)}${p.en_retard ? ' : **en retard**' : ''}`,
  ].filter(Boolean),
  ton: p.en_retard ? 'rouge' : 'vert',
});

async function repondreOuEst(tenantId, question, droits, contexte, indices = null) {
  const cible = indices?.entreprise || indices?.acte ? { nom: indices.entreprise, acte: indices.acte, annee: null } : await entrepriseDans(question);
  if (!cible.nom && !cible.acte && contexte?.entreprise) cible.nom = contexte.entreprise;
  if (!cible.nom && !cible.acte) {
    return { texte: 'De quel dossier s\'agit-il ? Donnez-moi le **nom de l\'entreprise** ou le **n° d\'acte**.', suggestions: ['Où est le dossier Credo BTP ?'] };
  }
  const libelle = [cible.nom, cible.acte && `acte ${cible.acte}`].filter(Boolean).join(', ');
  const p = await entreeService.presence(tenantId, { nom_entreprise: cible.nom || '', num_acte: cible.acte || '', annee: cible.annee || '' });
  const elements = p.entrees.map((e) => ({
    titre: e.denomination || 'Dossier',
    lignes: [
      [e.num_actes && `Acte ${e.num_actes}`, e.type_garantie].filter(Boolean).join(' · '),
      `Semaine du ${jourAff(e.semaine)} au ${jourAff(e.au)}`,
      `Point du **${jourAff(e.date_point)}**`,
      droits.archive && [e.lettre && `Lettre **${e.lettre}**`, e.armoire && `**${e.armoire}**`].filter(Boolean).join(' · '),
    ].filter(Boolean),
    ton: e.nom_concorde ? 'vert' : 'ambre',
    note: e.approche ? 'Nom proche : vérifiez qu\'il s\'agit de la même entreprise.' : (!e.nom_concorde ? 'Acte entré sous un autre nom : à vérifier.' : null),
  }));
  const sorties = cible.nom || cible.acte ? await sortiesDe(tenantId, cible.acte || cible.nom, { userId: droits.archive ? null : droits.userId }) : [];
  // « Et qui l'a ? » portera sur le nom trouvé, pas sur celui tapé.
  const res = { contexte: { entreprise: p.entrees[0]?.denomination || cible.nom || null } };
  if (!p.total) {
    res.texte = `Je ne trouve pas « **${libelle}** » dans les entrées des archives.${droits.archive ? ' Vérifiez l\'orthographe, ou cherchez par n° d\'acte.' : ' L\'archive vérifiera si vous le demandez.'}`;
    res.elements = [];
  } else {
    const approche = p.entrees[0]?.approche;
    res.texte = approche
      ? `Je ne trouve pas « ${libelle} » écrit ainsi, mais un **nom proche** :`
      : `« **${libelle}** » est aux archives${p.total > 1 ? ` (${pluriel(p.total, 'entrée')}, toutes années confondues)` : ''} :`;
    // Trois fiches suffisent ; la recherche complète est à un clic.
    res.elements = elements.slice(0, 3);
    if (p.total > res.elements.length) res.texte += approche ? '' : ` voici les ${res.elements.length} plus récentes.`;
  }
  if (sorties.length) {
    res.elements = [...res.elements, ...sorties.map((s) => ({ ...ligneSortie(s, droits.archive), titre: `Sorti actuellement : ${ligneSortie(s).titre}` }))];
  }
  res.actions = [];
  if (droits.demandeur) res.actions.push({ type: 'demander', libelle: 'Demander ce dossier', saisie: [cible.nom, cible.acte].filter(Boolean).join(' ') });
  if (droits.archive) res.actions.push({ type: 'lien', libelle: 'Ouvrir la recherche', vers: `/archives/entrees?q=${encodeURIComponent(cible.acte || cible.nom)}` });
  res.suggestions = droits.archive && cible.nom ? [`Qui a le dossier ${cible.nom} ?`] : [];
  return res;
}

// ---------------------------------------------------------------------------
// La fiche d'un dossier : tout ce qu'on sait de lui, quelle que soit la façon
// de le demander (« Credo BTP », « est-il disponible ? », « donne-moi… »).
// ---------------------------------------------------------------------------

// Mots de typologie : un filtre, jamais une partie du nom (« attestation Credo BTP »).
const MOTS_TYPOLOGIE = /\b(attestations?|cautions?|avances? de d[ée]marrage|avance|d[ée]marrage|bonne ex[ée]cution|ex[ée]cution|soumissions?|retenues? de garantie|retenue|garanties? bancaires?|garanties?|douani[èe]res?|en douane|pr[êe]ts?|march[ée]s?|att|cbe|cad|cd|cs|rg|gb)\b/gi;

/** Ce que la question vise : { nom, acte, annee, typologie } (typologie et année retirées du nom). */
function cibleDans(question) {
  const acte = ia.acteDans(question) || (/^\s*(?:n\s*[°o.]?\s*)?(\d{2,6}(?:\s*\/\s*\d{1,6})?)\s*\??\s*$/i.exec(question)?.[1] || null)
    // « dossier 13692 », « le 13692 svp » : un nombre qui n'est pas une année.
    || ([...String(question).matchAll(/(?<![\d/])(\d{3,7})(?![\d/])/g)].map((m) => m[1]).find((n) => !/^(19|20)\d{2}$/.test(n)) || null);
  const an = /\b((?:19|20)\d{2})\b(?!\s*\/)/.exec(String(question).replace(acte || '§', ' '));
  const types = String(question).match(MOTS_TYPOLOGIE);
  const sansType = String(question).replace(MOTS_TYPOLOGIE, ' ').replace(/\s+de\s+(la\s+|l')?(?=\s|$)/gi, ' ');
  let nom = ia.entrepriseNommee(sansType) || nomDans(sansType);
  if (nom && /^\d+$/.test(nom.replace(/\s/g, ''))) nom = null;
  return { nom: nom && nom.length >= 2 ? nom : null, acte, annee: an ? Number(an[1]) : null, typologie: types ? types.join(' ').toLowerCase() : null };
}

/** Les demandes ouvertes qui concernent ce dossier (toutes pour l'archive, les siennes pour un agent). */
async function demandesDe(tenantId, nom, droits) {
  const params = [tenantId, `%${String(nom).replace(/[\\%_]/g, (c) => `\\${c}`)}%`, `%${nomSimple(nom).replace(/[\\%_]/g, (c) => `\\${c}`)}%`];
  if (!droits.archive) params.push(droits.userId);
  const r = await db.query(
    `SELECT q.nom_entreprise, q.num_acte, q.type_document, q.statut, q.complement_demande_at, q.complement_fourni_at, to_char(q.created_at, 'YYYY-MM-DD') AS le, u.full_name AS agent
       FROM requests q LEFT JOIN users u ON u.id = q.id_user
      WHERE q.tenant_id = $1 AND q.statut = 'en attente'
        AND (q.nom_entreprise ILIKE $2 OR q.num_acte ILIKE $2 OR ${NOM_SIMPLE.replace('lower(denomination)', 'lower(q.nom_entreprise)')} LIKE $3)
        ${droits.archive ? '' : 'AND q.id_user = $4'}
      ORDER BY q.created_at DESC LIMIT 5`,
    params
  );
  return r.rows;
}

/** La cible est-elle connue (entrée, sortie ou demande) ? Rend ce qu'on en sait, ou null. */
async function cibleConnue(tenantId, cible, droits) {
  if (!cible.nom && !cible.acte) return null;
  const presence = await entreeService.presence(tenantId, { nom_entreprise: cible.nom || '', num_acte: cible.acte || '', annee: cible.annee || '' });
  const reference = cible.acte || cible.nom;
  const sorties = await sortiesDe(tenantId, reference, { userId: null });
  const demandes = cible.nom ? await demandesDe(tenantId, cible.nom, { archive: true }) : [];
  if (!presence.total && !sorties.length && !demandes.length && !(presence.cartons || []).length) return null;
  return { presence, sorties, demandes };
}

async function repondreFiche(tenantId, cible, droits, connu) {
  const { presence: p, sorties } = connu;
  const libelle = [cible.nom, cible.acte && `acte ${cible.acte}`].filter(Boolean).join(', ');
  // Typologie demandée : on garde les entrées de ce type s'il y en a.
  const filtrer = (l, champ) => {
    if (!cible.typologie) return l;
    const mots = cible.typologie.split(' ').map((m) => sansAccents(m).slice(0, 5));
    const f = l.filter((x) => mots.some((m) => sansAccents(x[champ] || '').toLowerCase().includes(m)));
    return f.length ? f : l;
  };
  const entrees = filtrer(p.entrees, 'type_garantie');
  const lignes = [];
  const elements = [];
  if (entrees.length) {
    const e = entrees[0];
    lignes.push(e.approche
      ? `Je ne trouve pas « ${libelle} » écrit ainsi, mais un **nom proche** aux archives : **${e.denomination}**.`
      : `**${e.denomination}** est aux archives${p.total > 1 ? ` (${pluriel(p.total, 'entrée')}, toutes années confondues)` : ''}.`);
    for (const x of entrees.slice(0, 3)) {
      elements.push({
        titre: x.denomination || 'Dossier',
        lignes: [
          [x.num_actes && `Acte ${x.num_actes}`, x.type_garantie].filter(Boolean).join(' · '),
          `Semaine du ${jourAff(x.semaine)} au ${jourAff(x.au)}`,
          `Point du **${jourAff(x.date_point)}**`,
          droits.archive && [x.lettre && `Lettre **${x.lettre}**`, x.armoire && `**${x.armoire}**`].filter(Boolean).join(' · '),
        ].filter(Boolean),
        ton: x.nom_concorde ? 'vert' : 'ambre',
        note: x.approche ? 'Nom proche : vérifiez qu\'il s\'agit de la même entreprise.' : (!x.nom_concorde ? 'Acte entré sous un autre nom : à vérifier.' : null),
      });
    }
  } else if (!sorties.length && !connu.demandes.length && !(p.cartons || []).length) {
    lignes.push(`« **${libelle}** » n'est pas dans les entrées des archives.`);
  } else {
    lignes.push(`**${sorties[0]?.nom_entreprise || connu.demandes[0]?.nom_entreprise || libelle}**${droits.archive ? ' (pas d\'entrée enregistrée aux archives)' : ''} :`);
  }
  const chezMoi = sorties.some((x) => x.chez_id === droits.userId);
  // Dossiers non retirés / annulés, ouvertures de compte : en complément des points.
  const cartons = p.cartons || [];
  if (cartons.length) {
    const quoi = (c) => (c.fonds === 'ouverture_compte' ? 'ouverture de compte' : c.statut === 'annule' ? 'dossier annulé' : 'dossier non retiré / annulé');
    lignes.push(`${entrees.length ? 'Aussi aux archives' : `**${cartons[0].denomination}** est aux archives`} : ${cartons.map((c) => [quoi(c), c.annee, droits.archive && c.carton && `carton **${c.carton}**`].filter(Boolean).join(', ')).join(' ; ')}.`);
    for (const c of cartons) {
      elements.push({
        titre: c.denomination || 'Dossier',
        lignes: [
          c.fonds === 'ouverture_compte' ? `Ouverture de compte${droits.archive && c.matricule ? ` · n° ${c.matricule}` : ''}` : [c.num_actes && `Acte ${c.num_actes}`, c.typologie, c.annee].filter(Boolean).join(' · '),
          c.fonds === 'non_retires' ? (c.statut === 'annule' ? 'Dossier annulé' : 'Non retiré / annulé') : null,
          droits.archive && (c.carton ? `**Carton ${String(c.carton).replace(/^Carton /, '')}**` : 'Sans carton'),
        ].filter(Boolean),
        ton: 'gris',
      });
    }
  }
  // Sorti ? Pour un agent : chez lui, ou « sorti » sans dire chez qui.
  if (sorties.length) {
    const miens = sorties.filter((x) => x.chez_id === droits.userId);
    if (droits.archive) {
      lignes.push(`**Sorti en ce moment** : ${sorties.map((x) => `chez **${x.chez || '?'}**, retour prévu le ${jourAff(x.retour_prevu)}${x.en_retard ? ' (**en retard**)' : ''}`).join(' ; ')}.`);
      for (const x of sorties) elements.push({ ...ligneSortie(x, true), titre: `Sorti : ${ligneSortie(x).titre}` });
    } else if (miens.length) {
      lignes.push(`Ce dossier est **chez vous** : retour prévu le ${jourAff(miens[0].retour_prevu)}.`);
    } else {
      lignes.push(`Il est **actuellement sorti** (retour prévu le ${jourAff(sorties[0].retour_prevu)}). Vous pouvez le demander : l'archive vous le transmettra à son retour.`);
    }
  } else if (entrees.length && !entrees[0].approche) {
    lignes.push('Il n\'est pas sorti : **disponible** aux archives.');
  }
  // Déjà demandé ?
  const demandes = droits.archive ? connu.demandes : await demandesDe(tenantId, cible.nom || cible.acte, droits);
  if (demandes.length) {
    lignes.push(droits.archive
      ? `**${pluriel(demandes.length, 'demande')} en attente** pour ce dossier (${demandes.map((d) => d.agent).filter(Boolean).slice(0, 3).join(', ')}).`
      : `Vous l'avez **déjà demandé** le ${jourAff(demandes[0].le)} : l'archive va vous le transmettre.`);
  }
  // Numérisé ?
  const annees = String((await settingsService.getAll(tenantId).catch(() => ({}))).mfiles_annees || '').match(/\d{4}/g) || [];
  const anneeDossier = cible.annee || Number(entrees[0]?.date_point?.slice(0, 4)) || null;
  if (anneeDossier && annees.includes(String(anneeDossier))) lignes.push(`Les dossiers de ${anneeDossier} sont **numérisés** : l'archive peut envoyer la copie M-Files.`);

  const actions = [];
  if (droits.demandeur && !(demandes.length && !droits.archive) && !chezMoi) actions.push({ type: 'demander', libelle: 'Demander ce dossier', saisie: [entrees[0]?.denomination || cible.nom, cible.acte].filter(Boolean).join(' ') });
  if (droits.archive) actions.push({ type: 'lien', libelle: 'Ouvrir la recherche', vers: `/archives/entrees?q=${encodeURIComponent(cible.acte || cible.nom)}` });
  return { texte: lignes.join('\n'), elements: elements.slice(0, 5), actions, contexte: { entreprise: entrees[0]?.denomination || cible.nom || null } };
}

async function repondreQuiA(tenantId, question, droits, contexte, indices = null) {
  const cible = indices?.entreprise || indices?.acte ? { nom: indices.entreprise, acte: indices.acte } : await entrepriseDans(question);
  const nom = cible.acte || cible.nom || contexte?.entreprise;
  if (!droits.archive) {
    const miens = nom ? await sortiesDe(tenantId, nom, { userId: droits.userId }) : [];
    return miens.length
      ? { texte: 'Ce dossier est **chez vous** :', elements: miens.map((p) => ligneSortie(p, false)) }
      : { texte: 'Seule l\'archive sait qui détient un dossier. Si vous en avez besoin, demandez-le : l\'archive vous préviendra.', actions: nom ? [{ type: 'demander', libelle: 'Demander ce dossier', saisie: nom }] : [] };
  }
  if (!nom) return { texte: 'Quel dossier ? Donnez-moi le **nom de l\'entreprise** ou le **n° d\'acte**.' };
  const sorties = await sortiesDe(tenantId, nom);
  if (!sorties.length) {
    return { texte: `Aucun dossier « **${nom}** » n'est sorti en ce moment : il doit être aux archives.`, suggestions: [`Où est le dossier ${nom} ?`], contexte: { entreprise: cible.nom || contexte?.entreprise || null } };
  }
  return { texte: `${pluriel(sorties.length, 'dossier sorti', 'dossiers sortis')} pour « **${nom}** » :`, elements: sorties.map((p) => ligneSortie(p, true)), actions: [{ type: 'lien', libelle: 'Dossiers sortis', vers: '/demandes/prets' }], contexte: { entreprise: cible.nom || contexte?.entreprise || null } };
}

async function repondreRetards(tenantId, droits) {
  const params = [tenantId];
  if (!droits.archive) params.push(droits.userId);
  const r = await db.query(
    `SELECT q.nom_entreprise, q.num_acte, q.type_document, to_char(l.remis_at, 'YYYY-MM-DD') AS remis_le,
            to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu, (l.date_retour_prevue < CURRENT_DATE) AS en_retard,
            u.full_name AS chez, count(*) OVER ()::int AS total
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.retourne_at IS NULL ${droits.archive ? 'AND l.date_retour_prevue < CURRENT_DATE' : 'AND l.emprunteur_id = $2'}
      ORDER BY l.date_retour_prevue LIMIT 8`,
    params
  );
  const total = r.rows[0]?.total || 0;
  if (droits.archive) {
    if (!total) return { texte: 'Aucun dossier en retard. Tout est rentré à temps.' };
    return { texte: `**${pluriel(total, 'dossier')}** à récupérer${total > r.rows.length ? ` (les ${r.rows.length} plus anciens)` : ''} :`, elements: r.rows.map((p) => ligneSortie(p, true)), actions: [{ type: 'lien', libelle: 'Dossiers sortis', vers: '/demandes/prets' }] };
  }
  if (!total) return { texte: 'Vous n\'avez aucun dossier à rendre.' };
  const retards = r.rows.filter((p) => p.en_retard).length;
  return {
    texte: `Vous avez **${pluriel(total, 'dossier')}** à rendre${retards ? `, dont **${retards} en retard**` : ''} :`,
    elements: r.rows.map((p) => ligneSortie(p, false)),
    actions: [{ type: 'lien', libelle: 'Mes dossiers', vers: '/demandes/mes-demandes' }],
  };
}

function etatDemande(d) {
  if (d.retourne) return { texte: 'Retourné', ton: 'gris' };
  if (d.pret_en_cours) return d.en_retard ? { texte: 'Transmis · retour en retard', ton: 'rouge' } : { texte: `Transmis · retour prévu le ${jourAff(d.retour_prevu)}`, ton: 'vert' };
  if (d.statut === 'livré') return { texte: 'Copie numérique transmise', ton: 'bleu' };
  if (d.statut === 'annulé') return { texte: 'Annulé', ton: 'gris' };
  if (d.complement_demande_at && !d.complement_fourni_at) return { texte: 'À compléter', ton: 'rouge' };
  return { texte: 'Demandé · l\'archive va le transmettre', ton: 'ambre' };
}

async function repondreMesDemandes(tenantId, question, droits) {
  const cible = nomDans(question, { majuscules: true })
    || (/\b(?:pour|demande\s+(?:de|du|d'|pour))\s+(?:la\s+|le\s+)?(?:société\s+|ets\s+)?([a-z0-9][\w .&-]{1,60})$/i.exec(question.replace(/[?!.]+\s*$/, ''))?.[1] || null);
  const params = [tenantId, droits.userId];
  let filtre = '';
  if (cible) { params.push(`%${cible.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); filtre = 'AND (q.nom_entreprise ILIKE $3 OR q.num_acte ILIKE $3 OR q.num_dossier ILIKE $3)'; }
  const r = await db.query(
    `SELECT q.id, q.nom_entreprise, q.num_acte, q.type_document, q.statut, q.complement_demande_at, q.complement_fourni_at,
            to_char(q.created_at, 'YYYY-MM-DD') AS demande_le,
            (l.id IS NOT NULL AND l.retourne_at IS NULL) AS pret_en_cours, (l.retourne_at IS NOT NULL) AS retourne,
            to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu, (l.retourne_at IS NULL AND l.date_retour_prevue < CURRENT_DATE) AS en_retard
       FROM requests q
       LEFT JOIN LATERAL (SELECT * FROM request_loans x WHERE x.request_id = q.id ORDER BY x.remis_at DESC LIMIT 1) l ON true
      WHERE q.tenant_id = $1 AND q.id_user = $2 ${filtre}
        AND (q.statut <> 'annulé' OR q.created_at > now() - interval '7 days')
      ORDER BY (l.retourne_at IS NULL AND q.statut <> 'annulé') DESC, q.created_at DESC LIMIT 6`,
    params
  );
  if (!r.rows.length) {
    return cible
      ? { texte: `Vous n'avez pas de demande pour « **${cible}** ».`, actions: [{ type: 'demander', libelle: 'Le demander', saisie: cible }] }
      : { texte: 'Vous n\'avez aucune demande en cours.', actions: [{ type: 'lien', libelle: 'Demander un dossier', vers: '/demandes/nouvelle' }] };
  }
  const aCompleter = r.rows.filter((d) => d.complement_demande_at && !d.complement_fourni_at && d.statut !== 'annulé').length;
  return {
    texte: `${cible ? `Vos demandes pour « **${cible}** »` : 'Vos dernières demandes'} :${aCompleter ? ` **${aCompleter} à compléter**.` : ''}`,
    elements: r.rows.map((d) => {
      const e = etatDemande(d);
      return { titre: [d.nom_entreprise, d.type_document].filter(Boolean).join(' · ') || 'Dossier', lignes: [d.num_acte && `Acte ${d.num_acte}`, `Demandé le ${jourAff(d.demande_le)}`, `**${e.texte}**`].filter(Boolean), ton: e.ton };
    }),
    actions: [{ type: 'lien', libelle: 'Mes dossiers', vers: '/demandes/mes-demandes' }],
  };
}

/** Plan de classement et calendrier de conservation : la rubrique, sa cote, sa règle. */
function repondreConservation(question, droits) {
  const plan = require('./planService');
  const [r, ...autres] = plan.chercher(question);
  if (!r) {
    return {
      texte: 'Je n\'ai pas trouvé ce type de document dans le **plan de classement**. Précisez-le, par exemple « combien de temps conserver les contrats de travail ? » ou « où classer les PV du comité de mise en jeu ? ».',
      actions: droits.archive ? [{ type: 'lien', libelle: 'Plan de classement', vers: '/archives/plan' }] : [],
    };
  }
  const lignes = [`**${r.cote ? `${r.cote} — ` : ''}${r.intitule}** (${r.nom_departement})`];
  if (r.regle) lignes.push(`Conservation : **${r.regle}**.`);
  else lignes.push('Rubrique de regroupement : la durée se lit sur ses sous-rubriques.');
  if (r.consigne) lignes.push(`Classement : ${r.consigne}`);
  if (r.observations) lignes.push(r.observations);
  return {
    texte: lignes.join('\n'),
    elements: autres.filter((x) => x.regle).map((x) => ({ titre: `${x.cote ? `${x.cote} — ` : ''}${x.intitule}`, lignes: [x.nom_departement, x.regle], ton: x.sort === 'C' ? 'vert' : 'gris' })),
    actions: droits.archive ? [{ type: 'lien', libelle: 'Plan de classement', vers: '/archives/plan' }] : [],
  };
}

/** Les dossiers transmis aujourd'hui (archive ; un agent : les siens). */
async function repondreSortiesDuJour(tenantId, droits) {
  const params = [tenantId];
  if (!droits.archive) params.push(droits.userId);
  const r = await db.query(
    `SELECT q.nom_entreprise, q.num_acte, q.type_document, to_char(l.remis_at, 'YYYY-MM-DD') AS remis_le,
            to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu, false AS en_retard, u.full_name AS chez
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.remis_at::date = CURRENT_DATE ${droits.archive ? '' : 'AND l.emprunteur_id = $2'}
      ORDER BY l.remis_at DESC LIMIT 10`, params);
  if (!r.rows.length) return { texte: 'Aucun dossier transmis aujourd\'hui.' };
  return { texte: `**${pluriel(r.rows.length, 'dossier transmis', 'dossiers transmis')}** aujourd'hui :`, elements: r.rows.map((p) => ligneSortie(p, droits.archive)), actions: droits.archive ? [{ type: 'lien', libelle: 'Dossiers sortis', vers: '/demandes/prets' }] : [] };
}

async function compter(tenantId, sql, params) {
  return (await db.query(sql, params)).rows[0]?.n || 0;
}

async function repondreJournee(tenantId) {
  const [attente, completer, retards, sortis] = await Promise.all([
    compter(tenantId, "SELECT count(*)::int AS n FROM requests q WHERE tenant_id = $1 AND statut = 'en attente' AND (complement_demande_at IS NULL OR complement_fourni_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM request_loans l WHERE l.request_id = q.id)", [tenantId]),
    compter(tenantId, "SELECT count(*)::int AS n FROM requests WHERE tenant_id = $1 AND statut = 'en attente' AND complement_demande_at IS NOT NULL AND complement_fourni_at IS NULL", [tenantId]),
    compter(tenantId, 'SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NULL AND date_retour_prevue < CURRENT_DATE', [tenantId]),
    compter(tenantId, 'SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NULL', [tenantId]),
  ]);
  const lignes = [
    `**${attente}** demande${attente > 1 ? 's' : ''} à transmettre`,
    `**${retards}** dossier${retards > 1 ? 's' : ''} en retard, à récupérer`,
    `**${sortis}** dossier${sortis > 1 ? 's' : ''} sorti${sortis > 1 ? 's' : ''} en tout`,
    completer && `**${completer}** demande${completer > 1 ? 's' : ''} en attente de compléments des agents`,
  ].filter(Boolean);
  return {
    texte: `Votre journée :\n${lignes.map((l) => `• ${l}`).join('\n')}`,
    actions: [{ type: 'lien', libelle: 'À traiter', vers: '/demandes/a-traiter' }, retards ? { type: 'lien', libelle: 'Dossiers en retard', vers: '/demandes/prets' } : null].filter(Boolean),
    suggestions: retards ? ['Quels dossiers sont en retard ?'] : [],
  };
}

async function repondreChiffres(tenantId, question, droits) {
  const s = plat(question);
  const periode = periodeDans(question);
  const params = [tenantId];
  const borne = (col) => {
    if (!periode) return '';
    params.push(periode.du, periode.au);
    return ` AND ${col} >= $${params.length - 1}::date AND ${col} < $${params.length}::date`;
  };
  const quand = periode ? ` ${periode.libelle}` : '';
  if (!droits.archive) {
    const reserve = a(s, 'entre', 'entres', 'entree', 'entrees', 'sorti', 'sortis', 'retard', 'agents', 'comptes');
    const n = await compter(tenantId, `SELECT count(*)::int AS n FROM requests WHERE tenant_id = $1 AND id_user = $2 AND statut <> 'annulé'${(() => { params.push(droits.userId); return borne('created_at'); })()}`, params);
    return { texte: `${reserve ? 'Les chiffres des archives sont tenus par l\'archive. ' : ''}Vous avez fait **${pluriel(n, 'demande')}**${quand}.` };
  }
  if (a(s, 'entre', 'entres', 'entree', 'entrees', 'point', 'points', 'classe', 'classes')) {
    const n = await compter(tenantId, `SELECT count(*)::int AS n FROM dossiers_entres WHERE tenant_id = $1${borne('date_point')}`, params);
    return { texte: `**${pluriel(n, 'dossier entré', 'dossiers entrés')}** aux archives${quand || ' en tout'}.`, actions: [{ type: 'lien', libelle: 'Entrée des dossiers', vers: '/archives/entrees' }] };
  }
  if (a(s, 'retard')) {
    const n = await compter(tenantId, 'SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NULL AND date_retour_prevue < CURRENT_DATE', params);
    return { texte: `**${pluriel(n, 'dossier')}** en retard en ce moment.`, suggestions: n ? ['Quels dossiers sont en retard ?'] : [] };
  }
  if (a(s, 'sorti', 'sortis', 'transmis', 'prete', 'pretes', 'prets', 'emprunte', 'empruntes', 'dehors')) {
    if (!periode) {
      const n = await compter(tenantId, 'SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NULL', params);
      return { texte: `**${pluriel(n, 'dossier sorti', 'dossiers sortis')}** en ce moment.`, actions: [{ type: 'lien', libelle: 'Dossiers sortis', vers: '/demandes/prets' }] };
    }
    const n = await compter(tenantId, `SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1${borne('remis_at')}`, params);
    return { texte: `**${pluriel(n, 'dossier transmis', 'dossiers transmis')}**${quand}.` };
  }
  if (a(s, 'retourne', 'retournes', 'rendu', 'rendus', 'rentre', 'rentres')) {
    const n = await compter(tenantId, `SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NOT NULL${borne('retourne_at')}`, params);
    return { texte: `**${pluriel(n, 'dossier retourné', 'dossiers retournés')}**${quand}.` };
  }
  if (a(s, 'agent', 'agents', 'utilisateur', 'utilisateurs', 'compte', 'comptes')) {
    const n = await compter(tenantId, 'SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND desactive_le IS NULL', params);
    return { texte: `**${pluriel(n, 'compte actif', 'comptes actifs')}**.` };
  }
  const n = await compter(tenantId, `SELECT count(*)::int AS n FROM requests WHERE tenant_id = $1 AND statut <> 'annulé'${borne('created_at')}`, params);
  return {
    texte: `**${pluriel(n, 'demande')}**${quand || ' en tout'}.`,
    suggestions: ['Combien de dossiers entrés ce mois ?', 'Combien de dossiers sortis ?'],
  };
}

async function repondreSemaine(tenantId, question, indices = null) {
  // Sans date : la semaine en cours (« les dossiers de la semaine », « d'aujourd'hui »).
  const date = indices?.date || dateDans(question) || new Date().toISOString().slice(0, 10);
  const w = await entreeService.semaine(tenantId, date).catch(() => null);
  if (!w) return { texte: 'Je n\'ai pas compris la date. Écrivez par exemple « semaine du 3 octobre 2025 ».' };
  const n = w.dossiers.length;
  const lettres = [...new Set(w.dossiers.map((d) => d.lettre).filter(Boolean))];
  return {
    texte: `Semaine du **${jourAff(w.semaine)}** au **${jourAff(w.au)}** : **${pluriel(n, 'dossier entré', 'dossiers entrés')}**${lettres.length ? `, lettres ${lettres[0]} à ${lettres[lettres.length - 1]}` : ''}.`,
    actions: [{ type: 'lien', libelle: 'Ouvrir la semaine', vers: `/archives/entrees?semaine=${w.semaine}` }],
  };
}

// ---------------------------------------------------------------------------

async function droitsDe(user) {
  const possede = (p) => roleService.possede(user.tenant_id, user.role, p).catch(() => false);
  const [archive, demandeur, admin] = await Promise.all([possede('requests.process'), possede('requests.create'), possede('users.view')]);
  return { archive, demandeur, admin, userId: user.id, tenantId: user.tenant_id };
}

/** Suggestions d'accueil, selon le rôle. */
function suggestionsAccueil(droits) {
  return droits.archive
    ? ['Qu\'est-ce que j\'ai à traiter ?', 'Quels dossiers sont en retard ?', 'Combien de dossiers entrés ce mois ?', 'Comment utiliser la douchette ?']
    : ['Où en sont mes demandes ?', 'Ai-je des dossiers à rendre ?', 'Comment demander plusieurs dossiers ?', 'Combien de temps puis-je garder un dossier ?'];
}

/**
 * Ce que veut la question, avant Ollama : les règles, corrigées par le
 * modèle appris quand il est sûr de lui. Rend une intention de repondre().
 */
function comprendreDetail(q, droits) {
  const sure = regleSure(q);
  if (sure) return { quoi: sure === 'semaine' && !droits.archive ? 'mes_demandes' : sure, confiance: 1, source: 'regles' };
  let quoi = intention(q, droits);
  let source = 'regles';
  // Le modèle appris (jeu d'exemples + usage de l'organisation) lit les
  // tournures que les règles ne prévoient pas ; on le suit quand il est sûr de lui.
  const lu = appris.predire(q, droits.tenantId ?? null);
  if (lu.confiance >= SEUIL_APPRIS && !(quoi === 'merci' && lu.intention === 'salut') && !(quoi === 'demander' && lu.intention === 'ou_est')) {
    const avant = quoi;
    quoi = lu.intention === 'autre' ? 'hors_sujet' : lu.intention;
    if (quoi === 'journee' && !droits.archive) quoi = 'mes_demandes';
    if (quoi === 'semaine' && !dateDans(q) && !/semaine|aujourd|du jour/i.test(q)) quoi = 'chiffres';
    if (quoi !== avant) source = 'appris';
  }
  // « Où est le plan des armoires ? » : ce n'est pas un dossier, c'est de l'aide.
  if (['ou_est', 'inconnu'].includes(quoi) && !ia.acteDans(q) && sujetDAide(nomDans(q))) quoi = 'aide';
  return { quoi, confiance: Math.round(lu.confiance * 100) / 100, source };
}

/** Ce que veut la question, avant Ollama (voir comprendreDetail). */
const comprendre = (q, droits) => comprendreDetail(q, droits).quoi;

/** Les recherches de DocuBot, offertes comme outils au modèle de langue (docubotAgent). */
function outilsPour(tenantId, droits) {
  const cible = (x) => (/\d+\s*\/\s*\d+|^\d+$/.test(String(x || '').trim()) ? { acte: String(x).trim() } : { entreprise: x || null });
  const reserve = { texte: 'Réservé à l\'archive.' };
  return {
    chercher_dossier: ({ entreprise, acte } = {}) => repondreOuEst(tenantId, '', droits, {}, { entreprise: entreprise || null, acte: acte || null }),
    qui_a_le_dossier: ({ entreprise } = {}) => repondreQuiA(tenantId, '', droits, {}, cible(entreprise)),
    mes_demandes: ({ entreprise } = {}) => repondreMesDemandes(tenantId, entreprise ? `mes demandes pour ${entreprise}` : 'mes demandes', droits),
    retards: () => repondreRetards(tenantId, droits),
    travail_du_jour: () => (droits.archive ? repondreJournee(tenantId) : reserve),
    chiffres: ({ question } = {}) => repondreChiffres(tenantId, question || 'combien de demandes', droits),
    entrees_semaine: ({ date } = {}) => (droits.archive ? repondreSemaine(tenantId, String(date || ''), { date: /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : null }) : reserve),
    aide: ({ question } = {}) => repondreAide(tenantId, question || '', droits),
  };
}

/**
 * Répond à une question. Rend { texte, elements?, actions?, suggestions?, contexte? }.
 * `contexte` : ce dont on parlait (l'entreprise), pour « et qui l'a ? ».
 */
async function repondre(user, question, contexte = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const droits = await droitsDe(user);
  const tenantId = user.tenant_id;
  if (!q) return { texte: 'Posez-moi une question.', suggestions: suggestionsAccueil(droits) };
  const lecture = comprendreDetail(q, droits);
  let quoi = lecture.quoi;
  // Un dossier connu est nommé (« Credo BTP », « 15370 », « attestation Credo BTP 2025 »,
  // « est-il disponible ? ») : sa fiche complète, quelle que soit la tournure.
  const parleDemande = /\b(ma|mes|la|une)\s+demandes?\b|\bdemand[ée]/i.test(q);
  if ((!['salut', 'merci', 'mes_demandes', 'retards', 'journee', 'semaine', 'mes_prets', 'sorties_jour', 'conservation'].includes(quoi)
      || (quoi === 'mes_demandes' && !parleDemande && lecture.source !== 'regles')) && !agent.complexe(q)) {
    const cible = cibleDans(q);
    if (!(quoi === 'chiffres' && /\b(combien|nombre|total|stat)/i.test(q) && !cible.acte)) {
      const connu = await cibleConnue(tenantId, cible, droits).catch(() => null);
      if (connu) {
        const res = await repondreFiche(tenantId, cible, droits, connu);
        const echange = await apprentissage.noter(tenantId, user.id, q, { intention: 'ou_est', confiance: lecture.confiance, source: 'fiche' });
        return { intention: 'fiche', ...res, echange };
      }
    }
  }
  // Question complexe, ou non reconnue : si Ollama est là, DocuBot raisonne
  // en enchaînant ses recherches (docubotAgent).
  if ((agent.complexe(q) || quoi === 'inconnu') && !['salut', 'merci'].includes(quoi) && await ollama.regle(tenantId)) {
    const r = await agent.raisonner(tenantId, q, droits, outilsPour(tenantId, droits));
    if (r) {
      const echange = await apprentissage.noter(tenantId, user.id, q, { intention: quoi, confiance: lecture.confiance, source: 'agent' });
      return { intention: 'raisonnement', ...r, echange };
    }
  }
  // Question non reconnue : le modèle de langue (Ollama), s'il est là, la lit.
  let indices = null;
  if (quoi === 'inconnu') {
    const lu = await ollama.analyser(tenantId, q);
    // Un nom d'entreprise lu, c'est un dossier qu'on cherche, pas de l'aide.
    if (lu && (lu.entreprise || lu.acte) && ['aide', 'autre', 'salut'].includes(lu.intention)) lu.intention = 'ou_est';
    if (lu && lu.intention !== 'autre') {
      indices = lu;
      quoi = lu.intention === 'journee' && !droits.archive ? 'mes_demandes' : lu.intention;
    } else if (lu) {
      const redige = await rediger(tenantId, q, droits);
      if (redige) {
        const echange = await apprentissage.noter(tenantId, user.id, q, { intention: 'hors_sujet', confiance: lecture.confiance, source: 'ollama' });
        return { intention: 'autre', ...redige, echange };
      }
    }
  }
  // Une question sans mot-clé qui contient un nom : on cherche le dossier.
  if (quoi === 'inconnu' && (ia.acteDans(q) || nomDans(q))) quoi = 'ou_est';
  let res;
  switch (quoi) {
    case 'salut': {
      const nom = (await db.query('SELECT full_name FROM users WHERE id = $1', [user.id]).catch(() => ({ rows: [] }))).rows[0]?.full_name;
      res = { texte: `Bonjour${nom ? ` ${String(nom).split(' ')[0]}` : ''} ! Que puis-je faire pour vous ?`, suggestions: suggestionsAccueil(droits) };
      break;
    }
    case 'merci': res = { texte: /^(ok|okay|d.accord|super|parfait|compris|cool|top)/i.test(q) ? 'Très bien. Autre chose ?' : 'Avec plaisir.' }; break;
    case 'hors_sujet': {
      // Hors des archives : Ollama, s'il est là, peut s'appuyer sur les procédures ; sinon on le dit simplement.
      const redige = await rediger(tenantId, q, droits);
      res = redige || { texte: 'Je réponds sur les dossiers et les demandes des archives de l\'AFGC. Cette question sort de mon domaine.', suggestions: suggestionsAccueil(droits) };
      break;
    }
    case 'aide': res = await repondreAide(tenantId, q, droits); break;
    case 'chiffres': res = await repondreChiffres(tenantId, q, droits); break;
    case 'semaine': res = droits.archive ? await repondreSemaine(tenantId, q, indices) : { texte: 'Les semaines d\'entrée sont tenues par l\'archive. Dites-moi plutôt quel dossier vous cherchez.' }; break;
    case 'retards': res = await repondreRetards(tenantId, droits); break;
    // « Mes prêts », « chez moi » : ses propres dossiers, archiviste compris.
    case 'mes_prets': res = await repondreRetards(tenantId, { ...droits, archive: false }); break;
    case 'sorties_jour': res = await repondreSortiesDuJour(tenantId, droits); break;
    case 'conservation': res = repondreConservation(q, droits); break;
    case 'journee': res = await repondreJournee(tenantId); break;
    case 'qui_a': res = await repondreQuiA(tenantId, q, droits, contexte, indices); break;
    case 'mes_demandes': res = await repondreMesDemandes(tenantId, q, droits); break;
    case 'demander':
    case 'ou_est': res = await repondreOuEst(tenantId, q, droits, contexte, indices); break;
    default:
      res = { texte: 'Je n\'ai pas bien compris. Je peux trouver un dossier, suivre vos demandes, compter, ou expliquer l\'application.', suggestions: suggestionsAccueil(droits) };
  }
  const source = indices ? 'ollama' : res.source || lecture.source;
  const echange = await apprentissage.noter(tenantId, user.id, q, { intention: quoi, confiance: lecture.confiance, source });
  return { intention: quoi, ...res, ...(indices ? { compris_par: indices.modele } : {}), echange };
}

module.exports = { repondre, comprendre, comprendreDetail, cibleDans, regleSure, intention, nomDans, dateDans, periodeDans, suggestionsAccueil, droitsDe, passagesPour, AIDE };
