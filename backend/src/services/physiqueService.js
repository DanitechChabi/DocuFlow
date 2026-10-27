// ============================================================================
// physiqueService — archives papier (migration 038) : emplacements et cotes
// topographiques, documents placés, campagnes de récolement.
//
//   EMPLACEMENTS  dépôt → magasin → travée → tablette → boîte ; un niveau
//                 s'inscrit toujours plus bas que son parent. La cote d'un
//                 emplacement est la suite des codes depuis le dépôt
//                 (D1-M2-T03-E4-B0127). Un emplacement ne se supprime que vide.
//   DOCUMENTS     support (numérique, papier, hybride), boîte, cote dans la
//                 boîte ; tout déplacement est journalisé.
//   RÉCOLEMENT    instantané à l'ouverture (boîtes et documents attendus du
//                 périmètre, prêts en cours notés « en prêt »), constats ligne
//                 à ligne, clôture quand tout est constaté : procès-verbal figé
//                 par son empreinte.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const integrite = require('./integriteService');

const TYPES = ['depot', 'magasin', 'travee', 'tablette', 'boite'];
const LIBELLES_TYPE = { depot: 'Dépôt', magasin: 'Magasin', travee: 'Travée', tablette: 'Tablette', boite: 'Boîte' };
const SUPPORTS = ['numerique', 'papier', 'hybride'];
const RESULTATS = ['present', 'absent', 'deplace', 'abime', 'en_pret'];
const LIBELLES_RESULTAT = { present: 'Présent', absent: 'Absent', deplace: 'Déplacé', abime: 'Abîmé', en_pret: 'En prêt' };

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

async function journaliser(run, tenantId, user, action, objectType, objectId, details) {
  const qui = await integrite.identite(user);
  await run.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, qui.id, qui.username, action, objectType, objectId, JSON.stringify(details || {})]);
  return qui;
}

// ---------------------------------------------------------------- emplacements

/** Tous les emplacements de l'organisation, avec leur cote et leur contenu. */
async function lister(tenantId) {
  const { rows } = await db.query(
    `WITH RECURSIVE arbre AS (
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.capacite_ml, e.observations, e.code::text AS cote, 0 AS profondeur
         FROM emplacements e WHERE e.tenant_id = $1 AND e.parent_id IS NULL
       UNION ALL
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.capacite_ml, e.observations, a.cote || '-' || e.code, a.profondeur + 1
         FROM emplacements e JOIN arbre a ON e.parent_id = a.id WHERE e.tenant_id = $1
     )
     SELECT a.*, (SELECT count(*)::int FROM documents d WHERE d.emplacement_id = a.id AND d.tenant_id = $1 AND d.elimine_at IS NULL) AS nb_documents,
            (SELECT count(*)::int FROM emplacements c WHERE c.parent_id = a.id) AS nb_enfants
       FROM arbre a ORDER BY a.cote`, [tenantId]);
  return rows.map((r) => ({ ...r, capacite_ml: r.capacite_ml === null ? null : Number(r.capacite_ml) }));
}

async function charger(run, tenantId, id) {
  const { rows } = await run.query('SELECT * FROM emplacements WHERE id = $1 AND tenant_id = $2', [Number(id), tenantId]);
  if (!rows[0]) throw erreur(404, 'Emplacement introuvable.');
  return rows[0];
}

/** Cote topographique d'un emplacement (codes depuis le dépôt). */
async function coteDe(run, tenantId, id) {
  if (!id) return null;
  const { rows } = await run.query(
    `WITH RECURSIVE montee AS (
       SELECT id, parent_id, code, 0 AS n FROM emplacements WHERE id = $1 AND tenant_id = $2
       UNION ALL
       SELECT e.id, e.parent_id, e.code, m.n + 1 FROM emplacements e JOIN montee m ON e.id = m.parent_id
     ) SELECT string_agg(code, '-' ORDER BY n DESC) AS cote FROM montee`, [Number(id), tenantId]);
  return rows[0]?.cote || null;
}

function validerCode(code) {
  const c = String(code || '').trim();
  if (!c) throw erreur(400, 'Le code est obligatoire (ex. M2, T03, B0127).');
  if (!/^[A-Za-z0-9._/]{1,20}$/.test(c)) throw erreur(400, 'Code : lettres, chiffres, point, barre ou tiret bas, 20 caractères au plus.');
  return c;
}

async function creer(tenantId, corps = {}, user) {
  const type = corps.type;
  if (!TYPES.includes(type)) throw erreur(400, 'Type attendu : dépôt, magasin, travée, tablette ou boîte.');
  const code = validerCode(corps.code);
  const parentId = corps.parent_id ? Number(corps.parent_id) : null;
  if (parentId) {
    const parent = await charger(db, tenantId, parentId);
    if (TYPES.indexOf(type) <= TYPES.indexOf(parent.type)) {
      throw erreur(400, `Une ${LIBELLES_TYPE[type].toLowerCase()} ne se range pas dans un(e) ${LIBELLES_TYPE[parent.type].toLowerCase()}.`);
    }
  } else if (type !== 'depot') {
    throw erreur(400, 'Seul un dépôt se crée à la racine : choisissez son emplacement parent.');
  }
  const capacite = corps.capacite_ml === undefined || corps.capacite_ml === null || corps.capacite_ml === '' ? null : Number(corps.capacite_ml);
  if (capacite !== null && (!Number.isFinite(capacite) || capacite < 0 || capacite > 100000)) throw erreur(400, 'Capacité en mètres linéaires invalide.');
  try {
    const { rows } = await db.query(
      `INSERT INTO emplacements (tenant_id, parent_id, type, code, libelle, capacite_ml, observations)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenantId, parentId, type, code, String(corps.libelle || '').trim().slice(0, 150) || null, capacite,
        String(corps.observations || '').trim().slice(0, 2000) || null]);
    await journaliser(db, tenantId, user, 'EMPLACEMENT_CREE', 'emplacement', rows[0].id, { type, cote: await coteDe(db, tenantId, rows[0].id) });
    return { ...rows[0], cote: await coteDe(db, tenantId, rows[0].id) };
  } catch (err) {
    if (err.code === '23505') throw erreur(409, `Le code « ${code} » existe déjà à cet endroit.`);
    throw err;
  }
}

async function modifier(tenantId, id, corps = {}, user) {
  const e = await charger(db, tenantId, id);
  const code = corps.code === undefined ? e.code : validerCode(corps.code);
  const libelle = corps.libelle === undefined ? e.libelle : (String(corps.libelle || '').trim().slice(0, 150) || null);
  const capacite = corps.capacite_ml === undefined ? e.capacite_ml : (corps.capacite_ml === null || corps.capacite_ml === '' ? null : Number(corps.capacite_ml));
  try {
    const { rows } = await db.query(
      'UPDATE emplacements SET code = $3, libelle = $4, capacite_ml = $5, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [e.id, tenantId, code, libelle, capacite]);
    if (code !== e.code) await journaliser(db, tenantId, user, 'EMPLACEMENT_RECOTE', 'emplacement', e.id, { avant: e.code, apres: code });
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw erreur(409, `Le code « ${code} » existe déjà à cet endroit.`);
    throw err;
  }
}

async function supprimer(tenantId, id, user) {
  const e = await charger(db, tenantId, id);
  const c = await db.query(
    `SELECT (SELECT count(*) FROM emplacements WHERE parent_id = $1)::int AS enfants,
            (SELECT count(*) FROM documents WHERE emplacement_id = $1 AND elimine_at IS NULL)::int AS documents`, [e.id]);
  if (c.rows[0].enfants || c.rows[0].documents) {
    throw erreur(409, `Emplacement non vide (${c.rows[0].enfants} sous-emplacement(s), ${c.rows[0].documents} document(s)) : videz-le d'abord.`);
  }
  const cote = await coteDe(db, tenantId, e.id);
  await db.query('DELETE FROM emplacements WHERE id = $1 AND tenant_id = $2', [e.id, tenantId]);
  await journaliser(db, tenantId, user, 'EMPLACEMENT_SUPPRIME', 'emplacement', e.id, { cote });
  return { supprime: e.id };
}

/** Documents rangés dans un emplacement (bornés au périmètre de l'utilisateur). */
async function contenu(tenantId, id, user) {
  const e = await charger(db, tenantId, id);
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.description, d.nom_entreprise, d.cote_physique, d.support, d.statut, d.dossier_id,
            EXISTS (SELECT 1 FROM request_loans l WHERE l.document_id = d.id AND l.retourne_at IS NULL) AS en_pret
       FROM documents d WHERE d.emplacement_id = $1 AND d.tenant_id = $2 AND d.elimine_at IS NULL AND d.deleted_at IS NULL
      ORDER BY d.cote_physique NULLS LAST, d.id`, [e.id, tenantId]);
  const visibles = rows.filter((r) => r.dossier_id === null || lisibles.has(Number(r.dossier_id)));
  return { emplacement: { ...e, cote: await coteDe(db, tenantId, e.id) }, documents: visibles, masques: rows.length - visibles.length };
}

/**
 * Place un document : support, boîte, cote dans la boîte. L'accès en écriture
 * au document est vérifié par le contrôleur.
 */
async function placer(tenantId, documentId, corps = {}, user) {
  const { rows } = await db.query('SELECT id, support, emplacement_id, cote_physique FROM documents WHERE id = $1 AND tenant_id = $2', [Number(documentId), tenantId]);
  const d = rows[0];
  if (!d) throw erreur(404, 'Document introuvable.');
  const support = corps.support === undefined ? d.support : corps.support;
  if (!SUPPORTS.includes(support)) throw erreur(400, 'Support attendu : numérique, papier ou hybride.');
  let emplacementId = corps.emplacement_id === undefined ? d.emplacement_id : (corps.emplacement_id ? Number(corps.emplacement_id) : null);
  if (emplacementId) {
    const e = await charger(db, tenantId, emplacementId);
    if (!['boite', 'tablette'].includes(e.type)) throw erreur(400, 'Un document se range dans une boîte (ou directement sur une tablette).');
  }
  if (support === 'numerique') emplacementId = null;
  const cote = corps.cote_physique === undefined ? d.cote_physique : (String(corps.cote_physique || '').trim().slice(0, 60) || null);
  await db.query('UPDATE documents SET support = $3, emplacement_id = $4, cote_physique = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
    [d.id, tenantId, support, emplacementId, support === 'numerique' ? null : cote]);
  const avant = d.emplacement_id ? await coteDe(db, tenantId, d.emplacement_id) : null;
  const apres = emplacementId ? await coteDe(db, tenantId, emplacementId) : null;
  if (avant !== apres || d.support !== support || d.cote_physique !== cote) {
    await journaliser(db, tenantId, user, 'DOCUMENT_PLACE', 'document', d.id, { support, avant, apres, cote_physique: cote });
    await require('./documentIndexService').logHistory(tenantId, d.id, user.id,
      apres ? `Rangé en ${apres}${cote ? ` (${cote})` : ''}` : `Support : ${support}`, null, null, avant ? `Auparavant en ${avant}` : null);
  }
  return { support, emplacement_id: emplacementId, cote_topographique: apres, cote_physique: support === 'numerique' ? null : cote };
}

/** Localisation d'un document (fiche). */
async function localisation(tenantId, documentId) {
  const { rows } = await db.query(
    `SELECT d.support, d.emplacement_id, d.cote_physique,
            (SELECT json_build_object('nature', l.nature, 'remis_at', l.remis_at, 'retour_prevu', l.date_retour_prevue, 'emprunteur', u.full_name)
               FROM request_loans l LEFT JOIN users u ON u.id = l.emprunteur_id
              WHERE l.document_id = d.id AND l.retourne_at IS NULL ORDER BY l.remis_at DESC LIMIT 1) AS pret
       FROM documents d WHERE d.id = $1 AND d.tenant_id = $2`, [Number(documentId), tenantId]);
  if (!rows[0]) return null;
  return { ...rows[0], cote_topographique: rows[0].emplacement_id ? await coteDe(db, tenantId, rows[0].emplacement_id) : null };
}

// ------------------------------------------------------------------ récolement

async function chargerRecolement(run, tenantId, id, { verrou = false } = {}) {
  const { rows } = await run.query(`SELECT * FROM recolements WHERE id = $1 AND tenant_id = $2${verrou ? ' FOR UPDATE' : ''}`, [Number(id), tenantId]);
  if (!rows[0]) throw erreur(404, 'Récolement introuvable.');
  return rows[0];
}

/** Ouvre une campagne : instantané des boîtes et des documents attendus du périmètre. */
async function ouvrirRecolement(tenantId, corps = {}, user) {
  const perimetre = await charger(db, tenantId, corps.emplacement_id);
  const intitule = String(corps.intitule || '').trim().slice(0, 200);
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cotePerimetre = await coteDe(client, tenantId, perimetre.id);
    const { rows } = await client.query(
      `INSERT INTO recolements (tenant_id, intitule, emplacement_id, perimetre_libelle, ouvert_par, ouvert_par_nom)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, intitule || `Récolement ${cotePerimetre} — ${new Date().toLocaleDateString('fr-FR')}`, perimetre.id, cotePerimetre, qui.id, qui.nom]);
    const r = rows[0];
    // Contenants du périmètre (lui compris) : chaque boîte est une ligne, puis
    // chacun des documents qu'elle doit contenir.
    const contenants = (await client.query(
      `WITH RECURSIVE sous AS (
         SELECT id, type, code, libelle FROM emplacements WHERE id = $1 AND tenant_id = $2
         UNION ALL SELECT e.id, e.type, e.code, e.libelle FROM emplacements e JOIN sous s ON e.parent_id = s.id WHERE e.tenant_id = $2
       ) SELECT * FROM sous WHERE type IN ('boite', 'tablette') ORDER BY id`, [perimetre.id, tenantId])).rows;
    let ordre = 0;
    for (const c of contenants) {
      const cote = await coteDe(client, tenantId, c.id);
      ordre += 1;
      if (c.type === 'boite') {
        await client.query(
          'INSERT INTO recolement_lignes (recolement_id, emplacement_id, cote, libelle, ordre) VALUES ($1, $2, $3, $4, $5)',
          [r.id, c.id, cote, c.libelle || `Boîte ${c.code}`, ordre]);
      }
      const docs = (await client.query(
        `SELECT d.id, d.reference_mfile, d.description, d.cote_physique,
                EXISTS (SELECT 1 FROM request_loans l WHERE l.document_id = d.id AND l.retourne_at IS NULL) AS en_pret
           FROM documents d WHERE d.emplacement_id = $1 AND d.tenant_id = $2 AND d.elimine_at IS NULL AND d.deleted_at IS NULL
          ORDER BY d.cote_physique NULLS LAST, d.id`, [c.id, tenantId])).rows;
      for (const d of docs) {
        ordre += 1;
        await client.query(
          `INSERT INTO recolement_lignes (recolement_id, emplacement_id, document_id, cote, libelle, resultat, constate_par_nom, constate_at, ordre)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [r.id, c.id, d.id, `${cote}${d.cote_physique ? ` / ${d.cote_physique}` : ''}`, `${d.reference_mfile}${d.description ? ` — ${d.description}` : ''}`.slice(0, 500),
            d.en_pret ? 'en_pret' : null, d.en_pret ? 'Registre des prêts' : null, d.en_pret ? new Date() : null, ordre]);
      }
    }
    await client.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
       VALUES ($1, $2, $3, 'RECOLEMENT_OUVERT', 'recolement', $4, $5)`,
      [tenantId, qui.id, qui.username, r.id, JSON.stringify({ perimetre: cotePerimetre, lignes: ordre })]);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function detailRecolement(tenantId, id) {
  const r = await chargerRecolement(db, tenantId, id);
  const { rows } = await db.query('SELECT * FROM recolement_lignes WHERE recolement_id = $1 ORDER BY ordre, id', [r.id]);
  const compte = (x) => rows.filter((l) => l.resultat === x).length;
  return {
    ...r,
    empreinte: r.empreinte ? String(r.empreinte).trim() : null,
    lignes: rows,
    bilan: {
      total: rows.length, a_constater: rows.filter((l) => !l.resultat).length,
      ...Object.fromEntries(RESULTATS.map((x) => [x, compte(x)])),
    },
  };
}

async function listerRecolements(tenantId) {
  const { rows } = await db.query(
    `SELECT r.*, count(l.id)::int AS lignes, count(l.id) FILTER (WHERE l.resultat IS NULL)::int AS a_constater,
            count(l.id) FILTER (WHERE l.resultat IN ('absent', 'abime', 'deplace'))::int AS anomalies
       FROM recolements r LEFT JOIN recolement_lignes l ON l.recolement_id = r.id
      WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.ouvert_at DESC LIMIT 200`, [tenantId]);
  return rows;
}

/** Constate une ou plusieurs lignes d'un récolement en cours. */
async function constater(tenantId, id, constats = [], user) {
  const liste = Array.isArray(constats) ? constats : [];
  if (!liste.length) throw erreur(400, 'Aucun constat.');
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await chargerRecolement(client, tenantId, id, { verrou: true });
    if (r.statut !== 'en_cours') throw erreur(409, 'Ce récolement est clos.');
    for (const c of liste) {
      if (!RESULTATS.includes(c.resultat)) throw erreur(400, 'Constat attendu : présent, absent, déplacé, abîmé ou en prêt.');
      const obs = String(c.observation || '').trim().slice(0, 1000) || null;
      if (['absent', 'deplace', 'abime'].includes(c.resultat) && !obs && c.resultat !== 'absent') throw erreur(400, 'Décrivez le déplacement ou le dommage constaté.');
      const u = await client.query(
        `UPDATE recolement_lignes SET resultat = $3, observation = $4, constate_par_nom = $5, constate_at = now()
          WHERE id = $1 AND recolement_id = $2`, [Number(c.ligne_id), r.id, c.resultat, obs, qui.nom]);
      if (!u.rowCount) throw erreur(404, 'Ligne de récolement introuvable.');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return detailRecolement(tenantId, id);
}

const corpsRecolement = (r, lignes) => ({
  id: r.id, intitule: r.intitule, perimetre: r.perimetre_libelle, ouvert_par: r.ouvert_par_nom, ouvert_at: new Date(r.ouvert_at).toISOString(),
  clos_par: r.clos_par_nom, clos_at: r.clos_at ? new Date(r.clos_at).toISOString() : null,
  lignes: lignes.map((l) => ({ cote: l.cote, libelle: l.libelle, document_id: l.document_id, resultat: l.resultat, observation: l.observation || null })),
});

/** Clôture : tout doit être constaté ; procès-verbal figé par son empreinte. */
async function clore(tenantId, id, { observations } = {}, user) {
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await chargerRecolement(client, tenantId, id, { verrou: true });
    if (r.statut !== 'en_cours') throw erreur(409, 'Ce récolement est déjà clos.');
    const lignes = (await client.query('SELECT * FROM recolement_lignes WHERE recolement_id = $1 ORDER BY ordre, id', [r.id])).rows;
    const reste = lignes.filter((l) => !l.resultat).length;
    if (reste) throw erreur(409, `${reste} ligne(s) restent à constater.`);
    let fin = (await client.query(
      `UPDATE recolements SET clos_par = $2, clos_par_nom = $3, clos_at = now(), observations = $4 WHERE id = $1 RETURNING *`,
      [r.id, qui.id, qui.nom, String(observations || '').trim().slice(0, 4000) || null])).rows[0];
    const empreinte = integrite.empreinteTampon(Buffer.from(JSON.stringify(corpsRecolement(fin, lignes)), 'utf8'));
    fin = (await client.query("UPDATE recolements SET statut = 'clos', empreinte = $2 WHERE id = $1 RETURNING *", [r.id, empreinte])).rows[0];
    const anomalies = lignes.filter((l) => ['absent', 'deplace', 'abime'].includes(l.resultat)).length;
    await client.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
       VALUES ($1, $2, $3, 'RECOLEMENT_CLOS', 'recolement', $4, $5)`,
      [tenantId, qui.id, qui.username, r.id, JSON.stringify({ perimetre: r.perimetre_libelle, lignes: lignes.length, anomalies, empreinte })]);
    await client.query('COMMIT');
    return fin;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Procès-verbal de récolement, empreinte recalculée et comparée. */
async function procesVerbal(tenantId, id) {
  const d = await detailRecolement(tenantId, id);
  if (d.statut !== 'clos') throw erreur(409, "Le procès-verbal n'existe qu'une fois le récolement clos.");
  const calculee = integrite.empreinteTampon(Buffer.from(JSON.stringify(corpsRecolement(d, d.lignes)), 'utf8'));
  const org = await require('./archivageService').internes.organisationDe(tenantId);
  return { ...d, organisation: org, empreinte_conforme: d.empreinte === calculee };
}

module.exports = {
  TYPES, LIBELLES_TYPE, SUPPORTS, RESULTATS, LIBELLES_RESULTAT,
  lister, creer, modifier, supprimer, contenu, coteDe, placer, localisation,
  ouvrirRecolement, detailRecolement, listerRecolements, constater, clore, procesVerbal, corpsRecolement,
};
