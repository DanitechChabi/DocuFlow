// ============================================================================
// portailService — démarches en ligne de l'usager (migration 040).
//
// Le portail citoyen d'une organisation (/portail/<slug>) laisse un usager,
// sans compte, demander un acte (naissance, mariage, décès…) puis suivre sa
// demande avec un code de suivi. Objectif : un seul déplacement — le retrait —
// au lieu des allers-retours pour déposer, relancer et revenir chercher.
//
// La demande entre dans le circuit habituel (requests, « À traiter »,
// recherche automatique dans la GED) au nom d'un compte technique « Portail
// citoyen » qui ne peut pas se connecter. L'identité de l'usager est rangée à
// part (demandes_citoyennes). Le suivi public ne montre aucun nom : le code
// suffit à connaître l'avancement, pas à lire des données personnelles.
// ============================================================================
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const settingsService = require('./settingsService');

const TYPES_ACTE = {
  naissance: 'Acte de naissance', mariage: 'Acte de mariage', deces: 'Acte de décès', autre: 'Autre acte ou document',
};
const LIENS = {
  soi_meme: 'Moi-même', parent: 'Parent (père, mère, enfant)', conjoint: 'Conjoint ou conjointe',
  mandataire: 'Mandataire (avec procuration)', autre: 'Autre',
};
const ORDRE = ['en attente', 'a traiter', 'transmis', 'livré'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I : se dicte au téléphone

function erreur(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/** Code de suivi lisible : DF-XXXX-XXXX (32^8 ≈ 10^12 combinaisons). */
function nouveauCode() {
  const o = crypto.randomBytes(8);
  const c = [...o].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `DF-${c.slice(0, 4)}-${c.slice(4)}`;
}
const normaliserCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^DF/, '');

const texte = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valide une demande déposée sur le portail. Fonction pure. */
function lireDemande(b = {}) {
  const erreurs = [];
  if (texte(b.site_web, 200)) erreurs.push('Demande refusée.'); // champ piège invisible
  const d = {
    type_acte: b.type_acte, lien: b.lien,
    demandeur_nom: texte(b.demandeur_nom, 80), demandeur_prenoms: texte(b.demandeur_prenoms, 120),
    telephone: texte(b.telephone, 30), email: texte(b.email, 160).toLowerCase() || null,
    personne_concernee: texte(b.personne_concernee, 200), lieu_evenement: texte(b.lieu_evenement, 120) || null,
    numero_acte: texte(b.numero_acte, 40) || null, motif: texte(b.motif, 300) || null,
    date_evenement: null, annee_evenement: null,
  };
  if (!TYPES_ACTE[d.type_acte]) erreurs.push('Choisissez le type d\'acte.');
  if (!LIENS[d.lien]) erreurs.push('Indiquez votre lien avec la personne concernée.');
  if (!d.demandeur_nom) erreurs.push('Votre nom est obligatoire.');
  if (!d.demandeur_prenoms) erreurs.push('Vos prénoms sont obligatoires.');
  const chiffres = d.telephone.replace(/\D/g, '');
  if (chiffres.length < 8 || chiffres.length > 15) erreurs.push('Numéro de téléphone invalide.');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) erreurs.push('Adresse e-mail invalide.');
  if (!d.personne_concernee) erreurs.push('Indiquez le nom de la personne concernée par l\'acte.');
  const date = texte(b.date_evenement, 10);
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date) > new Date()) erreurs.push('Date de l\'événement invalide.');
    else { d.date_evenement = date; d.annee_evenement = Number(date.slice(0, 4)); }
  } else if (b.annee_evenement) {
    const a = Number(b.annee_evenement);
    if (!Number.isInteger(a) || a < 1850 || a > new Date().getFullYear()) erreurs.push('Année de l\'événement invalide.');
    else d.annee_evenement = a;
  } else {
    erreurs.push('Indiquez la date ou au moins l\'année de l\'événement.');
  }
  return { erreurs, valeurs: d };
}

/** Ce que l'usager voit de l'avancement. Fonction pure. */
function statutCitoyen({ statut, copies = 0, retire_at: retire, motif_rejet: motifRejet = null }) {
  if (statut === 'annulé') return { cle: 'annulee', libelle: 'Demande annulée', etape: 0 };
  if (statut === 'rejete') return { cle: 'rejetee', libelle: 'Demande non aboutie', etape: 0, motif: motifRejet };
  if (retire || statut === 'livré') return { cle: 'retiree', libelle: 'Acte retiré', etape: 4 };
  if (copies > 0) return { cle: 'prete', libelle: 'Votre acte est prêt : vous pouvez venir le retirer', etape: 3 };
  if (statut === 'a traiter' || statut === 'transmis') return { cle: 'traitement', libelle: 'Recherche de l\'acte en cours', etape: 2 };
  return { cle: 'recue', libelle: 'Demande reçue', etape: 1 };
}

/** Organisation dont le portail est ouvert, ou null. */
async function organisation(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) return null;
  const t = (await db.query("SELECT id, name, slug FROM tenants WHERE lower(slug) = $1 AND status = 'active'", [s])).rows[0];
  if (!t) return null;
  const r = await settingsService.getAll(t.id);
  if (r.portail_citoyen_actif !== true) return null;
  return {
    id: t.id, slug: t.slug, nom: r.legal_entity || r.site_name || t.name, logo: r.site_logo || null,
    message: r.portail_message || null, lieu_retrait: r.portail_lieu_retrait || null,
  };
}

/** Compte technique « Portail citoyen » : propriétaire des demandes déposées en ligne. */
async function compteTechnique(client, tenantId) {
  const username = `portail-citoyen-${tenantId}`;
  const existant = (await client.query('SELECT id FROM users WHERE tenant_id = $1 AND username = $2', [tenantId, username])).rows[0];
  if (existant) return existant.id;
  // Mot de passe aléatoire jamais communiqué : le compte ne peut pas se connecter.
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  return (await client.query(
    `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role)
     VALUES ($1, $2, $3, 'Portail citoyen', $4, 'demandeur')
     ON CONFLICT (tenant_id, username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [tenantId, username, hash, `${username}@portail.invalid`])).rows[0].id;
}

async function personnelATraiter(tenantId) {
  try {
    return (await db.query(
      `SELECT u.id FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role
        WHERE u.tenant_id = $1 AND r.is_active AND ('*' = ANY(r.permissions) OR 'requests.process' = ANY(r.permissions))`, [tenantId])).rows;
  } catch (err) {
    if (err.code !== '42P01') throw err;
    return (await db.query("SELECT id FROM users WHERE tenant_id = $1 AND role IN ('admin', 'superadmin', 'archiviste')", [tenantId])).rows;
  }
}

/** Dépôt d'une demande par un usager. Rend { code_suivi }. */
async function deposer(slug, corps, { ip = null } = {}) {
  const org = await organisation(slug);
  if (!org) throw erreur(404, 'Ce portail n\'est pas ouvert.');
  const { erreurs, valeurs: d } = lireDemande(corps);
  if (erreurs.length) throw erreur(400, erreurs.join(' '));
  const client = await db.pool.connect();
  let requete;
  let code;
  try {
    await client.query('BEGIN');
    const technique = await compteTechnique(client, org.id);
    const description = [
      `${TYPES_ACTE[d.type_acte]} de ${d.personne_concernee}`,
      d.date_evenement ? `du ${d.date_evenement.split('-').reverse().join('/')}` : `de ${d.annee_evenement}`,
      d.lieu_evenement ? `à ${d.lieu_evenement}` : null,
      d.numero_acte ? `(acte n° ${d.numero_acte})` : null,
    ].filter(Boolean).join(' ');
    requete = (await client.query(
      `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_acte, annee, motif, statut, description, beneficiaire)
       VALUES ($1, $2, $3, $4, $5, $6, 'en attente', $7, $8) RETURNING *`,
      [org.id, technique, d.personne_concernee, d.numero_acte, d.annee_evenement,
        d.motif || 'Demande en ligne (portail citoyen)', `${description}. Demandé par ${d.demandeur_prenoms} ${d.demandeur_nom} (${LIENS[d.lien].toLowerCase()}).`,
        `${d.demandeur_prenoms} ${d.demandeur_nom}`])).rows[0];
    await client.query(
      `INSERT INTO request_history (tenant_id, request_id, user_id, action, previous_status, new_status, user_name)
       VALUES ($1, $2, $3, 'Demande déposée sur le portail citoyen', NULL, 'en attente', 'Portail citoyen')`, [org.id, requete.id, technique]);
    for (let essai = 0; ; essai += 1) {
      code = nouveauCode();
      try {
        await client.query('SAVEPOINT code');
        await client.query(
          `INSERT INTO demandes_citoyennes (tenant_id, request_id, code_suivi, type_acte, demandeur_nom, demandeur_prenoms, telephone, email,
             lien, personne_concernee, date_evenement, annee_evenement, lieu_evenement, numero_acte, motif, ip)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [org.id, requete.id, code, d.type_acte, d.demandeur_nom, d.demandeur_prenoms, d.telephone, d.email, d.lien,
            d.personne_concernee, d.date_evenement, d.annee_evenement, d.lieu_evenement, d.numero_acte, d.motif, ip]);
        break;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT code');
        if (err.code !== '23505' || essai >= 4) throw err;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Après coup, jamais bloquant : recherche dans la GED et prévenir le personnel.
  const score = await require('./gedMatchService').noterDemande(org.id, requete).catch(() => null);
  const indice = score !== null && score >= require('./gedMatchService').SEUIL_PROBABLE ? ' L\'acte semble déjà dans la GED.' : '';
  try {
    for (const u of await personnelATraiter(org.id)) {
      await db.query(
        `INSERT INTO notifications (tenant_id, id_user, title, message, type, request_id) VALUES ($1, $2, $3, $4, 'request_created', $5)`,
        [org.id, u.id, 'Demande en ligne reçue', `${TYPES_ACTE[d.type_acte]} de ${d.personne_concernee} (portail citoyen).${indice}`, requete.id]);
    }
  } catch (err) { console.error('[portail] notifications non enregistrées :', err.message); }
  if (d.email) {
    envoyerCourriel(org, d.email, `Votre demande ${code} est enregistrée`,
      `Votre demande d'${TYPES_ACTE[d.type_acte].toLowerCase()} est enregistrée sous le code <b>${code}</b>. Conservez-le : il permet de suivre l'avancement sur le portail.`).catch(() => {});
  }
  return { code_suivi: code, organisation: org.nom };
}

async function envoyerCourriel(org, to, subject, corps) {
  const mail = require('./mailService');
  if (!mail.isConfigured) return;
  await mail.sendMail({ to, subject, tenantId: org.id, html: `<p>${corps}</p><p>${org.nom}</p>` });
}

/** Suivi public par le code : avancement seulement, aucune donnée nominative. */
async function suivre(slug, code) {
  const org = await organisation(slug);
  if (!org) throw erreur(404, 'Ce portail n\'est pas ouvert.');
  const n = normaliserCode(code);
  if (n.length !== 8) return null;
  const c = `DF-${n.slice(0, 4)}-${n.slice(4)}`;
  const row = (await db.query(
    `SELECT dc.code_suivi, dc.type_acte, dc.created_at, dc.retire_at, r.statut,
            (SELECT count(*)::int FROM copies_certifiees cc WHERE cc.tenant_id = r.tenant_id AND cc.request_id = r.id) AS copies,
            (SELECT h.comment FROM request_history h WHERE h.request_id = r.id AND h.new_status = 'rejete' ORDER BY h.id DESC LIMIT 1) AS motif_rejet
       FROM demandes_citoyennes dc JOIN requests r ON r.id = dc.request_id
      WHERE dc.tenant_id = $1 AND dc.code_suivi = $2`, [org.id, c])).rows[0];
  if (!row) return null;
  const s = statutCitoyen(row);
  return {
    code: row.code_suivi, type: TYPES_ACTE[row.type_acte], depose_le: row.created_at, statut: s,
    lieu_retrait: s.cle === 'prete' ? org.lieu_retrait : null,
  };
}

/** Fait avancer une demande jusqu'à `cible` en respectant la machine à états. */
async function avancer(client, tenantId, requestId, cible, user, action) {
  const r = (await client.query('SELECT statut FROM requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [requestId, tenantId])).rows[0];
  if (!r) throw erreur(404, 'Demande introuvable.');
  let i = ORDRE.indexOf(r.statut);
  const fin = ORDRE.indexOf(cible);
  if (i < 0) throw erreur(409, 'Cette demande est close.');
  while (i < fin) {
    const de = ORDRE[i];
    const vers = ORDRE[i + 1];
    await client.query(`UPDATE requests SET statut = $3${vers === 'livré' ? ', date_livraison = now()' : ''} WHERE id = $1 AND tenant_id = $2`, [requestId, tenantId, vers]);
    await client.query(
      `INSERT INTO request_history (tenant_id, request_id, user_id, action, previous_status, new_status, user_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [tenantId, requestId, user?.id || null, action, de, vers, user?.full_name || null]);
    i += 1;
  }
}

/** Demande citoyenne liée à une demande (vue du personnel), ou null. */
async function pourDemande(tenantId, requestId) {
  const dc = (await db.query('SELECT * FROM demandes_citoyennes WHERE tenant_id = $1 AND request_id = $2', [tenantId, Number(requestId)])).rows[0];
  if (!dc) return null;
  const copies = (await db.query(
    `SELECT numero, document_reference, delivre_at, delivre_par_nom FROM copies_certifiees WHERE tenant_id = $1 AND request_id = $2 ORDER BY id`,
    [tenantId, Number(requestId)])).rows;
  const r = (await db.query('SELECT statut FROM requests WHERE id = $1', [dc.request_id])).rows[0];
  return {
    ...dc, ip: undefined, type_libelle: TYPES_ACTE[dc.type_acte], lien_libelle: LIENS[dc.lien], copies,
    statut_citoyen: statutCitoyen({ statut: r?.statut, copies: copies.length, retire_at: dc.retire_at }),
  };
}

/** Appelé après la délivrance d'une copie certifiée liée à une demande. */
async function copieDelivree(tenantId, requestId, copie, user) {
  const dc = (await db.query('SELECT * FROM demandes_citoyennes WHERE tenant_id = $1 AND request_id = $2', [tenantId, Number(requestId)])).rows[0];
  if (!dc) return;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await avancer(client, tenantId, dc.request_id, 'transmis', user, `Copie certifiée ${copie.numero} délivrée : acte prêt au retrait`);
    await client.query('UPDATE demandes_citoyennes SET pret_notifie_at = now() WHERE id = $1', [dc.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status !== 409) throw err;
  } finally { client.release(); }
  if (dc.email) {
    const org = await organisation((await db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])).rows[0]?.slug);
    if (org) {
      envoyerCourriel(org, dc.email, `Votre acte est prêt (${dc.code_suivi})`,
        `Votre ${TYPES_ACTE[dc.type_acte].toLowerCase()} est prêt.${org.lieu_retrait ? ` Lieu de retrait : ${org.lieu_retrait}.` : ''} Présentez votre code ${dc.code_suivi} et une pièce d'identité.`).catch(() => {});
    }
  }
}

/** Le personnel constate le retrait au guichet : la demande est livrée. */
async function marquerRetire(tenantId, requestId, user) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const dc = (await client.query('SELECT * FROM demandes_citoyennes WHERE tenant_id = $1 AND request_id = $2 FOR UPDATE', [tenantId, Number(requestId)])).rows[0];
    if (!dc) throw erreur(404, 'Demande en ligne introuvable.');
    if (dc.retire_at) throw erreur(409, 'Retrait déjà enregistré.');
    const n = (await client.query('SELECT count(*)::int AS n FROM copies_certifiees WHERE tenant_id = $1 AND request_id = $2', [tenantId, dc.request_id])).rows[0].n;
    if (!n) throw erreur(409, 'Aucune copie n\'a encore été délivrée pour cette demande.');
    await avancer(client, tenantId, dc.request_id, 'livré', user, 'Acte retiré au guichet par l\'usager');
    await client.query('UPDATE demandes_citoyennes SET retire_at = now(), retire_par_nom = $2 WHERE id = $1', [dc.id, user?.full_name || null]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  return pourDemande(tenantId, requestId);
}

/** Chiffres du portail pour le dossier et le tableau de bord. */
async function indicateurs(tenantId) {
  const r = (await db.query(
    `SELECT count(*)::int AS demandes,
            count(*) FILTER (WHERE dc.pret_notifie_at IS NOT NULL)::int AS pretes,
            count(*) FILTER (WHERE dc.retire_at IS NOT NULL)::int AS retirees,
            round(avg(EXTRACT(EPOCH FROM (dc.pret_notifie_at - dc.created_at)) / 3600) FILTER (WHERE dc.pret_notifie_at IS NOT NULL)::numeric, 1)::float AS delai_moyen_heures
       FROM demandes_citoyennes dc WHERE dc.tenant_id = $1`, [tenantId])).rows[0];
  const reglages = await settingsService.getAll(tenantId);
  const slug = (await db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])).rows[0]?.slug;
  const base = require('./copieCertifieeService').adressePublique(reglages);
  return { ...r, actif: reglages.portail_citoyen_actif === true, chemin: slug ? `/portail/${slug}` : null, lien: base && slug ? `${base}/portail/${slug}` : null };
}

module.exports = {
  TYPES_ACTE, LIENS, nouveauCode, normaliserCode, lireDemande, statutCitoyen, organisation, deposer, suivre,
  pourDemande, copieDelivree, marquerRetire, indicateurs,
};
