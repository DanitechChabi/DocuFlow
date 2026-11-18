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
function nomDans(question) {
  const acte = ia.acteDans(question);
  // Les points d'un sigle (« B.T.P ») restent ; ceux de fin de phrase partent.
  let s = String(question || '').replace(/[?!,;:«»"“”()]/g, ' ').replace(/\.(?=\s|$)/g, ' ');
  if (acte) s = s.replace(acte, ' ');
  s = s.replace(/\bactes?\s*(n\s*[°o.]?)?\s*/gi, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
  const mots = s.split(/\s+/).filter(Boolean);
  const gardes = mots.filter((m) => !BRUIT.has(sansAccents(m).replace(/^[ld]'/, '').replace(/'.*$/, '')) && !/^[ld]'$/i.test(m));
  // « l'entreprise Credo » : l' et d' collés au nom.
  const nom = gardes.map((m) => m.replace(/^[ldLD]['’]/, '')).join(' ').trim();
  return nom.length >= 2 ? nom : null;
}

/** L'entreprise visée : lue par le modèle, sinon après « société », sinon ce qui reste. */
async function entrepriseDans(question) {
  const lu = await ia.lireDemande(question, []).catch(() => ({}));
  const nom = lu.entreprise || ia.entrepriseNommee(question) || nomDans(question);
  return { nom, acte: lu.acte || ia.acteDans(question), annee: lu.annee || null };
}

/** L'intention de la question. */
function intention(question, { archive }) {
  const s = plat(question);
  if (/^\s*(bonjour|salut|bonsoir|hello|coucou)\s*$/.test(sansAccents(question).replace(/[^a-z ]/g, ''))) return 'salut';
  if (a(s, 'merci') && s.trim().split(' ').length <= 4) return 'merci';
  if (a(s, /^ (comment|que faire|quoi faire|a quoi sert|c est quoi|qu est ce qu|ou trouver|aide|help|peut on|puis je|est il possible)\b/)) return 'aide';
  if (a(s, 'combien de temps', 'quel delai', 'quelle duree', 'jusqu a quand')) return 'aide';
  if (a(s, 'combien', 'nombre de', 'nombre d', 'statistique', 'statistiques', 'total')) return 'chiffres';
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
    return {
      texte: 'Je n\'ai pas trouvé d\'aide sur ce point. Voici ce que je sais expliquer :',
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
            u.full_name AS chez
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
      : `« **${libelle}** » est aux archives${p.total > 1 ? ` (${pluriel(p.total, 'entrée')})` : ''} :`;
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
  const cible = nomDans(question);
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
  const date = indices?.date || dateDans(question);
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
  return { archive, demandeur, admin, userId: user.id };
}

/** Suggestions d'accueil, selon le rôle. */
function suggestionsAccueil(droits) {
  return droits.archive
    ? ['Qu\'est-ce que j\'ai à traiter ?', 'Quels dossiers sont en retard ?', 'Combien de dossiers entrés ce mois ?', 'Comment utiliser la douchette ?']
    : ['Où en sont mes demandes ?', 'Ai-je des dossiers à rendre ?', 'Comment demander plusieurs dossiers ?', 'Combien de temps puis-je garder un dossier ?'];
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
  let quoi = intention(q, droits);
  // « Où est le plan des armoires ? » : ce n'est pas un dossier, c'est de l'aide.
  if (['ou_est', 'inconnu'].includes(quoi) && !ia.acteDans(q) && sujetDAide(nomDans(q))) quoi = 'aide';
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
      if (redige) return { intention: 'autre', ...redige };
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
    case 'merci': res = { texte: 'Avec plaisir.' }; break;
    case 'aide': res = await repondreAide(tenantId, q, droits); break;
    case 'chiffres': res = await repondreChiffres(tenantId, q, droits); break;
    case 'semaine': res = droits.archive ? await repondreSemaine(tenantId, q, indices) : { texte: 'Les semaines d\'entrée sont tenues par l\'archive. Dites-moi plutôt quel dossier vous cherchez.' }; break;
    case 'retards': res = await repondreRetards(tenantId, droits); break;
    case 'journee': res = await repondreJournee(tenantId); break;
    case 'qui_a': res = await repondreQuiA(tenantId, q, droits, contexte, indices); break;
    case 'mes_demandes': res = await repondreMesDemandes(tenantId, q, droits); break;
    case 'demander':
    case 'ou_est': res = await repondreOuEst(tenantId, q, droits, contexte, indices); break;
    default:
      res = { texte: 'Je n\'ai pas bien compris. Je peux trouver un dossier, suivre vos demandes, compter, ou expliquer l\'application.', suggestions: suggestionsAccueil(droits) };
  }
  return { intention: quoi, ...res, ...(indices ? { compris_par: indices.modele } : {}) };
}

module.exports = { repondre, intention, nomDans, dateDans, periodeDans, suggestionsAccueil, droitsDe, passagesPour, AIDE };
