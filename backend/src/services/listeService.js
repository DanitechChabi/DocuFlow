// ============================================================================
// listeService — demandes groupées en listes, et cadre des sorties (047).
//
// Pendant certaines périodes (soldes créditeurs, passage du commissaire aux
// comptes, commission bancaire…), un service ne demande pas ses dossiers un
// par un : il envoie un classeur Excel de listes (« Liste 1 » … « Liste n »).
// Une LISTE réunit des demandes déposées d'un coup, avec un même cadre
// (requests.motif) et un même emprunteur.
//
//   creer          — dépose une liste (les lignes sont lues dans le classeur
//                    côté navigateur, puis contrôlées ici une à une)
//   lister         — les listes et leur avancement (à transmettre, transmis,
//                    retournés, en retard)
//   detail         — une liste et chacun de ses dossiers
//   transmettre    — l'archiviste transmet tout ou partie de la liste
//   retourner      — l'archiviste note le retour de tout ou partie
//   dossiersConnus — suggestions pour la demande en un clic
//
// Chaque dossier garde sa demande, son historique et sa ligne d'audit, comme
// une demande déposée seule : la recherche par entreprise, par cadre ou par
// liste les retrouve tous. Seules les NOTIFICATIONS sont regroupées — un avis
// pour la liste, pas quarante.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const roleService = require('./roleService');
const loanService = require('./loanService');
const catalog = require('../config/settingsCatalog');
const { normalizeOptions, allowedValues } = require('../helpers/requestOptions');
const { lireSaisie, aujourdhui, libelleDemande } = require('../helpers/requestInput');
const exigencesTypologie = require('../helpers/exigencesTypologie');
const mailService = require('./mailService');

const LIMITE_LIGNES = 2000;

function erreur(statut, message, code, details) {
  const e = new Error(message);
  e.statut = statut;
  if (code) e.code = code;
  if (details) e.details = details;
  return e;
}

const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Motif LIKE : les caractères % et _ tapés sont cherchés tels quels. */
const motifRecherche = (q) => `%${String(q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const fallback = (cle) => catalog.BY_KEY.get(cle)?.default;

/** Cadres admis : la liste des motifs de demande de l'organisation. */
async function cadresAdmis(tenantId) {
  const settings = await settingsService.getAll(tenantId);
  return normalizeOptions(settings.request_motifs, fallback('request_motifs'));
}

/** Types de dossier admis (attestation, bonne exécution…) : réglables par organisation. */
async function typesAdmis(tenantId) {
  const settings = await settingsService.getAll(tenantId);
  return normalizeOptions(settings.request_document_types, fallback('request_document_types'));
}

/** Priorité donnée aux demandes déposées sans en choisir : celle réglée par l'organisation. */
async function prioriteParDefaut(tenantId) {
  const settings = await settingsService.getAll(tenantId);
  const priorites = allowedValues(normalizeOptions(settings.request_priorities, fallback('request_priorities'), { withTone: true }));
  return (priorites.includes(settings.request_default_priority) ? settings.request_default_priority : priorites[0]) || null;
}

async function peutTraiter(tenantId, user) {
  return roleService.possede(tenantId, user.role, 'requests.process');
}

/**
 * Lit les lignes d'une liste. Fonction pure : chaque ligne passe par la même
 * règle de recevabilité qu'une demande seule (lireSaisie) — une description
 * ou au moins une référence.
 * @returns {{ valeurs: object[], erreurs: {ligne: number, message: string}[] }}
 */
function lireLignes(lignes, { types = null, exigences = null } = {}) {
  const valeurs = [];
  const erreurs = [];
  (Array.isArray(lignes) ? lignes : []).forEach((brute, i) => {
    const l = brute && typeof brute === 'object' ? brute : {};
    const { values, errors } = lireSaisie({
      nom_entreprise: l.nom_entreprise,
      num_dossier: l.num_dossier,
      num_acte: l.num_acte,
      banque: l.banque,
      montant: l.montant,
      annee: l.annee,
      description: l.description,
    });
    // Typologie : facultative ; si elle est donnée, elle doit être proposée.
    const type = texte(l.type_document, 100);
    if (type && types && !types.includes(type)) errors.push(`Typologie inconnue : « ${type} ».`);
    else if (!errors.length) {
      const manque = exigencesTypologie.manque(values, type, exigences);
      if (manque) errors.push(manque);
    }
    if (errors.length) erreurs.push({ ligne: i + 1, message: errors.join(' ') });
    else valeurs.push({ ...values, type_document: type });
  });
  return { valeurs, erreurs };
}

/** Avancement d'un dossier de liste, dans les mots de l'archive. Fonction pure. */
function etatDossier(r) {
  if (r.retourne_at) return 'retourne';
  if (r.remis_at) return 'transmis';
  if (r.statut === 'annulé' || r.statut === 'rejete') return 'annule';
  // Renvoyé au demandeur, faute d'informations suffisantes (051).
  if (r.statut === 'a completer') return 'a_completer';
  // Servi autrement (copie numérique tirée de la GED) : rien ne sort du magasin.
  if (r.statut === 'livré') return 'servi';
  return 'demande';
}

async function processeurs(tenantId) {
  try {
    const r = await db.query(
      `SELECT u.id FROM users u
         JOIN roles ro ON ro.tenant_id = u.tenant_id AND ro.key = u.role
        WHERE u.tenant_id = $1 AND ro.is_active
          AND ('*' = ANY(ro.permissions) OR 'requests.process' = ANY(ro.permissions))`,
      [tenantId]
    );
    return r.rows.map((x) => x.id);
  } catch (err) {
    if (err.code !== '42P01') throw err;
    const r = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND role IN ('admin', 'superadmin', 'archiviste')", [tenantId]);
    return r.rows.map((x) => x.id);
  }
}

/** La liste, si l'utilisateur peut la voir (sinon 404 : on ne révèle pas son existence). */
async function lireListe(tenantId, listeId, user) {
  const id = Number(listeId);
  if (!Number.isInteger(id) || id <= 0) throw erreur(400, 'Identifiant de liste invalide.');
  const r = await db.query(
    `SELECT l.*, u.full_name AS demandeur_name, c.full_name AS cree_par_name
       FROM request_lots l
       LEFT JOIN users u ON u.id = l.demandeur_id
       LEFT JOIN users c ON c.id = l.cree_par
      WHERE l.id = $1 AND l.tenant_id = $2`,
    [id, tenantId]
  );
  const liste = r.rows[0];
  if (!liste) throw erreur(404, 'Liste introuvable.');
  if (liste.demandeur_id !== user.id && liste.cree_par !== user.id && !(await peutTraiter(tenantId, user))) {
    throw erreur(404, 'Liste introuvable.');
  }
  return liste;
}

/**
 * Dépose une liste : une demande par ligne, toutes dans la même transaction.
 * @param {object} corps { libelle, cadre, fichier?, lignes[], demandeur_id? }
 */
async function creer(tenantId, user, { libelle, cadre, fichier, lignes, demandeur_id: demandeurId } = {}) {
  const nom = texte(libelle, 120);
  if (!nom) throw erreur(400, 'Donnez un nom à la liste (ex. « Liste 3 »).');
  const cadres = await cadresAdmis(tenantId);
  const leCadre = texte(cadre, 100);
  if (!leCadre || !allowedValues(cadres).includes(leCadre)) {
    throw erreur(400, `Motif non proposé : « ${leCadre || ''} ». Choisissez parmi : ${cadres.map((c) => c.label).join(', ')}.`);
  }
  if (!Array.isArray(lignes) || !lignes.length) throw erreur(400, 'La liste ne contient aucun dossier.');
  if (lignes.length > LIMITE_LIGNES) throw erreur(400, `Une liste compte au plus ${LIMITE_LIGNES} dossiers : scindez le classeur.`);
  const { valeurs, erreurs } = lireLignes(lignes, {
    types: allowedValues(await typesAdmis(tenantId)),
    exigences: await exigencesTypologie.exigencesDe(tenantId),
  });
  if (erreurs.length) {
    throw erreur(422, `${erreurs.length} ligne${erreurs.length > 1 ? 's' : ''} à corriger avant l'envoi.`, 'LIGNES_INVALIDES', erreurs.slice(0, 50));
  }

  // Pour qui les dossiers sortent : le déposant, ou — si l'archive saisit la
  // liste reçue d'un service — l'agent désigné, de la même organisation.
  let emprunteur = user.id;
  if (demandeurId && Number(demandeurId) !== user.id) {
    if (!(await peutTraiter(tenantId, user))) throw erreur(403, 'Seule l\'archive dépose une liste au nom d\'un autre agent.');
    const u = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [Number(demandeurId), tenantId]);
    if (!u.rows[0]) throw erreur(404, 'Agent introuvable.');
    emprunteur = u.rows[0].id;
  }

  const priorite = await prioriteParDefaut(tenantId);

  const liste = await loanService.enTransaction(async (client) => {
    const l = (await client.query(
      `INSERT INTO request_lots (tenant_id, libelle, cadre, fichier, demandeur_id, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, nom, leCadre, texte(fichier, 255), emprunteur, user.id]
    )).rows[0];
    const col = (cle) => valeurs.map((v) => v[cle]);
    const ids = (await client.query(
      `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_dossier, num_acte, annee, motif, priorite, statut, description, lot_id, type_document, banque, montant)
       SELECT $1, $2, x.n, x.d, x.a, x.y, $3, $4, 'en attente', x.descr, $5, x.t, x.b, x.m
         FROM unnest($6::text[], $7::text[], $8::text[], $9::int[], $10::text[], $11::text[], $12::text[], $13::numeric[]) AS x(n, d, a, y, descr, t, b, m)
       RETURNING id`,
      [tenantId, emprunteur, leCadre, priorite, l.id,
        col('nom_entreprise'), col('num_dossier'), col('num_acte'), col('annee'), col('description'), col('type_document'),
        col('banque'), col('montant')]
    )).rows.map((x) => x.id);
    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, user_name, tenant_id)
       SELECT rid, $2, $3, NULL, 'en attente', $4, $5 FROM unnest($1::int[]) AS rid`,
      [ids, user.id, `Création de la demande (liste « ${nom} »)`.slice(0, 100), user.full_name || null, tenantId]
    );
    await client.query(
      'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A déposé la liste « ${nom} » (${leCadre}) : ${ids.length} dossier${ids.length > 1 ? 's' : ''}`, tenantId]
    );
    return l;
  });

  // Un seul avis à l'archive pour toute la liste (cloche et courriel).
  const archive = (await processeurs(tenantId)).filter((uid) => uid !== user.id);
  for (const uid of archive) {
    await loanService.notifier(db, tenantId, uid, 'Nouvelle liste de dossiers',
      `${nom} — ${leCadre} : ${valeurs.length} dossier${valeurs.length > 1 ? 's' : ''} demandé${valeurs.length > 1 ? 's' : ''}.`,
      'request_created', null);
  }
  const complete = await detail(tenantId, liste.id, user);
  mailService.notifierComptes(tenantId, archive, 'nouvelle_liste', complete, { demandeur: complete.demandeur_name || user.full_name || null });
  return complete;
}

/** Les listes visibles, avec leur avancement. */
async function lister(tenantId, user, { cadre, q } = {}) {
  const conds = ['l.tenant_id = $1'];
  const params = [tenantId];
  if (!(await peutTraiter(tenantId, user))) {
    params.push(user.id);
    conds.push(`(l.demandeur_id = $${params.length} OR l.cree_par = $${params.length})`);
  }
  if (texte(cadre, 100)) {
    params.push(texte(cadre, 100));
    conds.push(`l.cadre = $${params.length}`);
  }
  if (texte(q, 100)) {
    params.push(motifRecherche(q));
    const p = `$${params.length}`;
    conds.push(`(l.libelle ILIKE ${p} OR l.fichier ILIKE ${p} OR EXISTS (
      SELECT 1 FROM requests r2 WHERE r2.lot_id = l.id
         AND (r2.nom_entreprise ILIKE ${p} OR r2.num_dossier ILIKE ${p} OR r2.num_acte ILIKE ${p})))`);
  }
  const r = await db.query(
    `SELECT l.id, l.libelle, l.cadre, l.fichier, l.created_at, l.demandeur_id, u.full_name AS demandeur_name,
            count(r.id)::int AS total,
            count(r.id) FILTER (WHERE p.id IS NULL AND r.statut NOT IN ('rejete', 'annulé', 'livré', 'a completer'))::int AS a_transmettre,
            count(r.id) FILTER (WHERE r.statut = 'a completer')::int AS a_completer,
            count(r.id) FILTER (WHERE p.id IS NOT NULL AND p.retourne_at IS NULL)::int AS transmis,
            count(r.id) FILTER (WHERE p.retourne_at IS NOT NULL)::int AS retournes,
            count(r.id) FILTER (WHERE p.id IS NOT NULL AND p.retourne_at IS NULL AND p.date_retour_prevue < CURRENT_DATE)::int AS en_retard
       FROM request_lots l
       LEFT JOIN requests r ON r.lot_id = l.id AND r.tenant_id = l.tenant_id
       LEFT JOIN request_loans p ON p.request_id = r.id
       LEFT JOIN users u ON u.id = l.demandeur_id
      WHERE ${conds.join(' AND ')}
      GROUP BY l.id, u.full_name
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 200`,
    params
  );
  return r.rows;
}

/** Une liste et ses dossiers. */
async function detail(tenantId, listeId, user) {
  const liste = await lireListe(tenantId, listeId, user);
  const r = await db.query(
    `SELECT r.id, r.nom_entreprise, r.num_dossier, r.num_acte, r.annee, r.description, r.type_document, r.banque, r.montant, r.statut, r.created_at,
            r.complement_message, r.complement_champs, r.complement_demande_at, r.complement_fourni_at, r.complement_reponse,
            p.remis_at, to_char(p.date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue, p.retourne_at, p.signale_at
       FROM requests r
       LEFT JOIN request_loans p ON p.request_id = r.id
      WHERE r.lot_id = $1 AND r.tenant_id = $2
      ORDER BY r.id`,
    [liste.id, tenantId]
  );
  const jour = aujourdhui();
  const dossiers = r.rows.map((x) => ({
    ...x,
    etat: etatDossier(x),
    en_retard: Boolean(x.remis_at && !x.retourne_at && x.date_retour_prevue && x.date_retour_prevue < jour),
  }));
  return { ...liste, dossiers };
}

/** Identifiants de la liste encore concernés par un geste (tous, ou ceux cochés). */
function filtrerIds(dossiers, ids, garde) {
  const voulus = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  return dossiers.filter((d) => garde(d) && (!voulus || voulus.has(d.id))).map((d) => d.id);
}

/** Regroupe des éléments par agent : Map(id → éléments). */
function parAgent(elements, cle) {
  const m = new Map();
  for (const e of elements) {
    const k = cle(e);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return m;
}

async function avisGroupe(tenantId, demandes, titre, message, type) {
  const parEmprunteur = new Map();
  for (const d of demandes) parEmprunteur.set(d.id_user, (parEmprunteur.get(d.id_user) || 0) + 1);
  for (const [uid, n] of parEmprunteur) {
    await loanService.notifier(db, tenantId, uid, titre, message(n), type, null);
  }
}

/**
 * Transmet tout ou partie de la liste : un prêt par dossier, dans UNE
 * transaction (tout ou rien), puis un avis par emprunteur.
 */
async function transmettre(tenantId, listeId, user, { ids, date_retour_prevue } = {}) {
  const liste = await detail(tenantId, listeId, user);
  const cibles = filtrerIds(liste.dossiers, ids, (d) => d.etat === 'demande');
  if (!cibles.length) throw erreur(409, 'Aucun dossier de cette sélection n\'est à transmettre.', 'RIEN_A_TRANSMETTRE');
  const faits = await loanService.enTransaction(async (client) => {
    const res = [];
    for (const id of cibles) {
      res.push(await loanService.remettre(tenantId, id, user,
        { date_retour_prevue, observation: `Liste « ${liste.libelle} »` },
        { client, avecNotification: false, avecSuites: false }));
    }
    return res;
  });
  const retour = faits[0]?.pret?.date_retour_prevue;
  const date = retour ? (retour instanceof Date ? aujourdhui(retour) : String(retour).slice(0, 10)).split('-').reverse().join('/') : null;
  await avisGroupe(tenantId, faits.map((f) => f.request), 'Dossiers transmis',
    (n) => `Liste « ${liste.libelle} » : ${n} dossier${n > 1 ? 's' : ''} transmis${date ? `, retour prévu le ${date}` : ''}.`,
    'loan_handover');
  // Un courriel par agent, avec SES dossiers et la date de retour.
  const retourIso = retour ? (retour instanceof Date ? aujourdhui(retour) : String(retour).slice(0, 10)) : null;
  for (const [uid, dossiers] of parAgent(faits.map((f) => f.request), (r) => r.id_user)) {
    mailService.notifierComptes(tenantId, [uid], 'liste_transmise', { libelle: liste.libelle, dossiers }, { dateRetour: retourIso, par: user.full_name || null });
  }
  return { transmis: faits.length, liste: await detail(tenantId, listeId, user) };
}

/** Note le retour de tout ou partie de la liste. */
async function retourner(tenantId, listeId, user, { ids, observation } = {}) {
  const liste = await detail(tenantId, listeId, user);
  const cibles = filtrerIds(liste.dossiers, ids, (d) => d.etat === 'transmis');
  if (!cibles.length) throw erreur(409, 'Aucun dossier de cette sélection n\'est sorti.', 'RIEN_A_RETOURNER');
  const faits = await loanService.enTransaction(async (client) => {
    const res = [];
    for (const id of cibles) {
      res.push(await loanService.retourner(tenantId, id, user, { observation },
        { client, avecNotification: false, avecSuites: false }));
    }
    return res;
  });
  await avisGroupe(tenantId, faits.map((f) => ({ id_user: f.pret.emprunteur_id })), 'Retour enregistré',
    (n) => `Liste « ${liste.libelle} » : retour de ${n} dossier${n > 1 ? 's' : ''} enregistré, vous en êtes déchargé.`,
    'loan_returned');
  // Un courriel de décharge par agent : la preuve de restitution.
  const parId = new Map(liste.dossiers.map((d) => [d.id, d]));
  for (const [uid, dossiers] of parAgent(faits.map((f) => ({ ...parId.get(f.pret.request_id), id_user: f.pret.emprunteur_id })), (r) => r.id_user)) {
    mailService.notifierComptes(tenantId, [uid], 'liste_retournee', { libelle: liste.libelle, dossiers }, { par: user.full_name || null });
  }
  return { retournes: faits.length, liste: await detail(tenantId, listeId, user) };
}

/**
 * Dossiers déjà demandés qui correspondent à la saisie, pour demander en un
 * clic. Un agent ne voit que ses propres demandes (règle de visibilité des
 * demandes) ; l'archive voit celles de toute l'organisation. Chaque dossier
 * dit s'il est actuellement sorti, et jusqu'à quand — sans dire chez qui.
 */
async function dossiersConnus(tenantId, user, q) {
  const saisie = texte(q, 100);
  if (!saisie || saisie.length < 2) return [];
  const params = [tenantId, motifRecherche(saisie)];
  let portee = '';
  if (!(await peutTraiter(tenantId, user))) {
    params.push(user.id);
    portee = `AND id_user = $${params.length}`;
  }
  const r = await db.query(
    `WITH s AS (
       SELECT nom_entreprise, num_dossier, num_acte, annee, type_document, max(created_at) AS derniere, count(*)::int AS fois
         FROM requests
        WHERE tenant_id = $1 ${portee}
          AND (nom_entreprise ILIKE $2 OR num_dossier ILIKE $2 OR num_acte ILIKE $2)
        GROUP BY nom_entreprise, num_dossier, num_acte, annee, type_document
        ORDER BY max(created_at) DESC
        LIMIT 8
     )
     SELECT s.nom_entreprise, s.num_dossier, s.num_acte, s.annee, s.type_document, s.fois,
            (SELECT to_char(p.date_retour_prevue, 'YYYY-MM-DD')
               FROM requests r2 JOIN request_loans p ON p.request_id = r2.id
              WHERE r2.tenant_id = $1 AND p.retourne_at IS NULL
                AND ((s.num_dossier IS NOT NULL AND r2.num_dossier = s.num_dossier)
                  OR (s.num_dossier IS NULL AND r2.nom_entreprise IS NOT DISTINCT FROM s.nom_entreprise
                      AND r2.num_acte IS NOT DISTINCT FROM s.num_acte))
              ORDER BY p.remis_at DESC LIMIT 1) AS sorti_jusqu_au
       FROM s
      ORDER BY s.derniere DESC`,
    params
  );
  return r.rows;
}

/**
 * L'archive précise (ou corrige) la typologie d'une demande arrivée sans
 * elle : c'est en sortant le dossier qu'on la voit. La typologie fait partie
 * de l'intitulé du dossier. Vide : la typologie est retirée.
 * @returns {Promise<{ id: number, type_document: string|null }>}
 */
async function fixerTypologie(tenantId, user, requestId, type) {
  const id = Number(requestId);
  if (!Number.isInteger(id) || id <= 0) throw erreur(400, 'Demande invalide.');
  const valeur = texte(type, 100);
  if (valeur && !allowedValues(await typesAdmis(tenantId)).includes(valeur)) {
    throw erreur(400, `Typologie inconnue : « ${valeur} ».`);
  }
  return loanService.enTransaction(async (client) => {
    const r = (await client.query(
      'SELECT id, statut, type_document, nom_entreprise, description, num_dossier FROM requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [id, tenantId]
    )).rows[0];
    if (!r) throw erreur(404, 'Demande introuvable.');
    if ((r.type_document || null) === valeur) return { id, type_document: valeur };
    await client.query('UPDATE requests SET type_document = $1 WHERE id = $2 AND tenant_id = $3', [valeur, id, tenantId]);
    const action = valeur ? `Typologie : ${valeur}` : 'Typologie retirée';
    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [id, user.id, action.slice(0, 100), r.statut, r.type_document ? `Auparavant : ${r.type_document}` : null, user.full_name || null, tenantId]
    );
    await client.query(
      'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
      [user.id, `A précisé la typologie du dossier « ${libelleDemande({ ...r, type_document: null })} » : ${valeur || 'aucune'}`.slice(0, 500), id, tenantId]
    );
    return { id, type_document: valeur };
  });
}

/**
 * Supprime une liste et ses demandes (un classeur ancien, envoyé deux fois
 * ou par erreur). Son auteur ou l'archive. Refusé tant qu'un de ses dossiers
 * est sorti et pas encore retourné : il faut d'abord noter son retour, sinon
 * le dossier disparaîtrait du registre alors qu'il est dehors. Journalisé.
 */
async function supprimer(tenantId, listeId, user) {
  const liste = await lireListe(tenantId, listeId, user);
  const archive = await peutTraiter(tenantId, user);
  if (!archive && liste.demandeur_id !== user.id && liste.cree_par !== user.id) throw erreur(404, 'Liste introuvable.');
  return loanService.enTransaction(async (client) => {
    const dehors = await client.query(
      `SELECT count(*)::int AS n FROM requests r JOIN request_loans p ON p.request_id = r.id
        WHERE r.lot_id = $1 AND r.tenant_id = $2 AND p.retourne_at IS NULL`,
      [liste.id, tenantId]
    );
    if (dehors.rows[0].n) {
      const n = dehors.rows[0].n;
      throw erreur(409, `${n} dossier${n > 1 ? 's' : ''} de cette liste ${n > 1 ? 'sont' : 'est'} encore sorti${n > 1 ? 's' : ''} : notez d'abord ${n > 1 ? 'leur' : 'son'} retour.`, 'DOSSIERS_SORTIS');
    }
    const ids = (await client.query('SELECT id FROM requests WHERE lot_id = $1 AND tenant_id = $2', [liste.id, tenantId])).rows.map((x) => x.id);
    if (ids.length) {
      // L'historique d'état n'a pas de suppression en cascade (003).
      await client.query('DELETE FROM request_history WHERE request_id = ANY($1::int[])', [ids]);
      await client.query('DELETE FROM requests WHERE id = ANY($1::int[]) AND tenant_id = $2', [ids, tenantId]);
    }
    await client.query('DELETE FROM request_lots WHERE id = $1 AND tenant_id = $2', [liste.id, tenantId]);
    await client.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A supprimé la liste « ${liste.libelle} »${liste.fichier ? ` (${liste.fichier})` : ''} — ${ids.length} dossier${ids.length > 1 ? 's' : ''}`.slice(0, 500), tenantId]);
    return { supprimes: ids.length };
  });
}

module.exports = {
  supprimer,
  LIMITE_LIGNES, lireLignes, etatDossier,
  cadresAdmis, typesAdmis, prioriteParDefaut, creer, lister, detail, transmettre, retourner, dossiersConnus,
  fixerTypologie, processeurs,
};
