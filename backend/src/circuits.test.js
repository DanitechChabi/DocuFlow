// ============================================================================
// circuits.test.js — circuits de validation (migration 034).
// 1. SANS BASE : validation des modèles, issue d'une étape, échéances.
// 2. AVEC BASE : destinataires (utilisateur, rôle, groupe), progression
//    séquentielle, règles « un » / « tous », refus, visa portant l'empreinte
//    de la version, seuls les destinataires décident, délégation, démarrage
//    automatique, statut tenu par le circuit, nouvelle version, rappels (une
//    fois), isolement.
// Exécution : npm run test:circuits
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-circuits-'));
const { FILES_DIR } = require('./config/paths');
const circuits = require('./services/circuitService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const refus = (corps) => { try { circuits.validerModele(corps); return null; } catch (err) { return err; } };
  ok(refus({ nom: 'X', etapes: [] })?.status === 400, 'circuit sans étape : refusé');
  ok(refus({ nom: 'X', etapes: [{ libelle: 'A', type_assignation: 'utilisateur' }] })?.status === 400, 'étape sans destinataire : refusée');
  ok(refus({ nom: 'X', demarrage_auto: true, etapes: [{ libelle: 'A', type_assignation: 'role', assigne_role: 'admin' }] })?.status === 400,
    'démarrage automatique hors circuit par défaut d\'une classe : refusé');
  const m = circuits.validerModele({ nom: ' Visa ', etapes: [{ libelle: 'Chef', type_assignation: 'role', assigne_role: 'admin', delai_jours: 0 }] });
  ok(m.nom === 'Visa' && m.etapes[0].action === 'visa' && m.etapes[0].regle === 'un' && m.etapes[0].delai_jours === null, 'valeurs par défaut : visa, règle « un », délai 0 = sans échéance');
  const t = (statut) => ({ statut });
  ok(circuits.issueEtape({ action: 'visa', regle: 'un' }, [t('approuvée'), t('à traiter')]) === 'terminée'
    && circuits.issueEtape({ action: 'visa', regle: 'tous' }, [t('approuvée'), t('à traiter')]) === 'en cours'
    && circuits.issueEtape({ action: 'visa', regle: 'tous' }, [t('approuvée'), t('refusée')]) === 'refusée',
  'issue d\'une étape : « un », « tous », un refus suffit');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const aclService = require('./services/aclService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t1 = await tenant('Circ');
    const t2 = await tenant('Ailleurs');
    await roleService.provisionRoles(t1);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username",
      [tid, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t1, 'archiviste', 'Archi');
    const agent = await utilisateur(t1, 'agent', 'Agent');
    const resp1 = await utilisateur(t1, 'responsable', 'RespUn');
    const resp2 = await utilisateur(t1, 'responsable', 'RespDeux');
    const admin = await utilisateur(t1, 'admin', 'Directeur');
    const autre = await utilisateur(t2, 'admin', 'Autre');
    const groupe = (await db.query("INSERT INTO groups (tenant_id, name) VALUES ($1, 'Comptabilité') RETURNING id", [t1])).rows[0].id;
    await db.query('INSERT INTO user_group_memberships (user_id, group_id) VALUES ($1, $2)', [agent.id, groupe]);
    const classe = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Facture fournisseur', FALSE) RETURNING id", [t1])).rows[0].id;
    let n = 0;
    const nouveauDocument = async (statut = 'disponible', classeId = null) => {
      const id = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, classe_id)
         VALUES ($1, $2, 'D', 'A', 'BÂTIR PLUS', 2026, $3, $4, $5) RETURNING id`, [t1, `V-${s}-${++n}`, statut, archi.id, classeId])).rows[0].id;
      const nom = `v${s}-${n}.txt`;
      fs.writeFileSync(path.join(FILES_DIR, nom), `Facture ${n}`);
      await addFileToDocument(t1, id, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `facture-${n}.txt`, mimetype: 'text/plain', size: 10 });
      return id;
    };
    const statut = async (id) => (await db.query('SELECT statut FROM documents WHERE id = $1', [id])).rows[0].statut;
    const tachesOuvertes = async (id) => (await db.query("SELECT * FROM circuit_taches WHERE document_id = $1 AND statut = 'à traiter' ORDER BY id", [id])).rows;

    const modele = await circuits.creerModele(t1, {
      nom: 'Visa des factures', classe_id: classe, par_defaut: true, demarrage_auto: false,
      etapes: [
        { libelle: 'Contrôle comptable', type_assignation: 'groupe', assigne_groupe_id: groupe, delai_jours: 2 },
        { libelle: 'Visa des responsables', type_assignation: 'role', assigne_role: 'responsable', regle: 'tous', delai_jours: 3 },
        { libelle: 'Information du directeur', type_assignation: 'utilisateur', assigne_user_id: admin.id, action: 'information' },
      ],
    }, admin);
    ok(modele.id && modele.etapes.length === 3, 'modèle créé avec trois étapes (groupe, rôle, utilisateur)');

    // --- Parcours complet -------------------------------------------------
    const d1 = await nouveauDocument();
    await circuits.demarrer(t1, d1, { circuitId: modele.id, user: archi });
    ok(await statut(d1) === 'en validation', 'démarrage : le document passe « en validation »');
    let ouvertes = await tachesOuvertes(d1);
    ok(ouvertes.length === 1 && ouvertes[0].assigne_a === agent.id, 'étape 1 : une tâche pour le membre du groupe');
    ok((await attendreErreur(() => circuits.demarrer(t1, d1, { circuitId: modele.id, user: archi })))?.status === 409, 'second circuit sur le même document : refusé');
    ok((await attendreErreur(() => circuits.decider(t1, ouvertes[0].id, { decision: 'approuver' }, resp1)))?.status === 403, 'un non-destinataire ne peut pas décider');
    ok((await circuits.compteTaches(t1, agent.id)).total === 1, 'compteur « Mes tâches » : 1');
    await circuits.decider(t1, ouvertes[0].id, { decision: 'approuver', commentaire: 'Montants vérifiés' }, agent);
    ouvertes = await tachesOuvertes(d1);
    ok(ouvertes.length === 2 && new Set(ouvertes.map((x) => x.assigne_a)).has(resp1.id) && new Set(ouvertes.map((x) => x.assigne_a)).has(resp2.id),
      'étape 2 (règle « tous ») : une tâche par responsable');
    await circuits.decider(t1, ouvertes.find((x) => x.assigne_a === resp1.id).id, { decision: 'approuver' }, resp1);
    ok((await tachesOuvertes(d1)).length === 1 && await statut(d1) === 'en validation', 'règle « tous » : l\'étape attend le second visa');
    // Délégation du second responsable à l'administrateur.
    const t2Resp = (await tachesOuvertes(d1))[0];
    await circuits.deleguer(t1, t2Resp.id, { utilisateur_id: admin.id, commentaire: 'En congé' }, resp2);
    const deleguee = (await tachesOuvertes(d1))[0];
    ok(deleguee.assigne_a === admin.id, 'délégation : la tâche passe au délégataire');
    await circuits.decider(t1, deleguee.id, { decision: 'approuver' }, admin);
    ouvertes = await tachesOuvertes(d1);
    ok(ouvertes.length === 1 && ouvertes[0].action === 'information', 'étape 3 : tâche d\'information');
    ok((await attendreErreur(() => circuits.decider(t1, ouvertes[0].id, { decision: 'approuver' }, admin)))?.status === 400, 'étape d\'information : pas de visa, prise de connaissance');
    await circuits.decider(t1, ouvertes[0].id, { decision: 'prendre_connaissance' }, admin);
    ok(await statut(d1) === 'prêt', 'dernière étape close : document « prêt »');
    const visas = (await db.query('SELECT v.*, f.empreinte_sha256 AS fichier_empreinte FROM circuit_visas v JOIN document_files f ON f.document_id = v.document_id AND f.version = v.document_version WHERE v.document_id = $1', [d1])).rows;
    ok(visas.length === 4 && visas.every((v) => v.empreinte_sha256 && v.empreinte_sha256.trim() === v.fichier_empreinte.trim()),
      'chaque visa porte l\'empreinte SHA-256 de la version visée');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND object_id = $2 AND action = 'VISA_APPROUVE'", [t1, d1])).rows[0].n === 3,
      'visas inscrits au journal chaîné');
    const etat = await circuits.etatDocument(t1, d1, archi);
    ok(etat.historique.length === 1 && etat.historique[0].statut !== 'en cours' && etat.instance === null, 'fiche : circuit terminé dans l\'historique');

    // --- Refus ---------------------------------------------------------------
    const d2 = await nouveauDocument();
    await circuits.demarrer(t1, d2, { circuitId: modele.id, user: archi });
    const tache = (await tachesOuvertes(d2))[0];
    ok((await attendreErreur(() => circuits.decider(t1, tache.id, { decision: 'refuser' }, agent)))?.code === 'MOTIF_REQUIS', 'refus sans motif : refusé');
    await circuits.decider(t1, tache.id, { decision: 'refuser', commentaire: 'Montant HT erroné' }, agent);
    ok(await statut(d2) === 'disponible' && (await tachesOuvertes(d2)).length === 0, 'refus : document « disponible », circuit clos');
    ok((await db.query('SELECT 1 FROM notifications WHERE id_user = $1 AND document_id = $2', [archi.id, d2])).rowCount > 0, 'le lanceur est prévenu du refus');

    // --- Démarrage automatique ----------------------------------------------
    await circuits.modifierModele(t1, modele.id, { ...modele, demarrage_auto: true, etapes: modele.etapes }, admin);
    const d3 = await nouveauDocument('disponible', classe);
    await circuits.demarrageAutomatique(t1, d3, archi);
    ok(await statut(d3) === 'en validation', 'classe à démarrage automatique : circuit lancé de lui-même');
    const d4 = await nouveauDocument('à indexer', classe);
    await circuits.demarrageAutomatique(t1, d4, archi);
    ok(await statut(d4) === 'à indexer', 'document encore « à indexer » : pas de démarrage');

    // --- Nouvelle version pendant le circuit --------------------------------
    const nom = `v${s}-nv.txt`;
    fs.writeFileSync(path.join(FILES_DIR, nom), 'Facture corrigée');
    const tD3 = (await tachesOuvertes(d3))[0];
    await circuits.decider(t1, tD3.id, { decision: 'approuver' }, agent);
    await addFileToDocument(t1, d3, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: 'facture-v2.txt', mimetype: 'text/plain', size: 16 });
    await circuits.surNouvelleVersion(t1, d3, archi);
    const etat3 = await circuits.etatDocument(t1, d3, archi);
    ok(etat3.instance && etat3.instance.visas_anterieurs, 'nouvelle version : la fiche signale que les visas portent sur la version précédente');

    // --- Rappels ------------------------------------------------------------
    await db.query("UPDATE circuit_taches SET echeance_at = now() - interval '2 days' WHERE document_id = $1 AND statut = 'à traiter'", [d3]);
    const r1 = await circuits.relancerTachesEnRetard({ tenantId: t1 });
    const r2 = await circuits.relancerTachesEnRetard({ tenantId: t1 });
    ok(r1 >= 1 && r2 === 0, 'tâche en retard : rappelée une fois, pas deux le même jour');
    ok((await circuits.mesTaches(t1, resp1)).some((x) => x.document_id === d3 && x.en_retard), '« Mes tâches » : retard signalé');

    // --- Annulation, isolement ---------------------------------------------
    ok((await attendreErreur(() => circuits.annuler(t1, d3, { motif: 'x' }, agent)))?.status === 403, 'annuler : réservé au lanceur ou à un gestionnaire');
    await circuits.annuler(t1, d3, { motif: 'Dossier retiré' }, archi);
    ok(await statut(d3) === 'disponible', 'annulation : document « disponible »');
    ok((await circuits.mesTaches(t2, autre)).length === 0 && (await circuits.listerModeles(t2)).length === 0, 'autre organisation : rien de visible');
    void aclService;

    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL docuflow.audit_override = 'on'");
      await c.query("SET LOCAL docuflow.gel_override = 'on'");
      await c.query('DELETE FROM tenants WHERE id = ANY($1)', [[t1, t2]]);
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { c.release(); }
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Circuits cohérents — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
