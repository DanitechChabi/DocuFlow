// ============================================================================
// dossierSurveille.test.js — le dossier de dépôt du poste, sans Electron.
// Exécution : node desktop/dossierSurveille.test.js
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DossierSurveille, ignore, SOUS_DOSSIER_IMPORTES, SOUS_DOSSIER_REFUSES } = require('./dossierSurveille');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-depot-'));
const d = new DossierSurveille({ dossier: racine });
const signales = [];
d.on('pret', (f) => signales.push(f.nom));

console.log('\n1. Détection');
fs.writeFileSync(path.join(racine, 'scan-001.pdf'), '%PDF-1.4 partiel');
d.passe();
ok(signales.length === 0, 'fichier vu une seule fois : pas encore signalé (le scanner écrit peut-être encore)');
fs.appendFileSync(path.join(racine, 'scan-001.pdf'), ' suite');
d.passe();
ok(signales.length === 0, 'fichier qui grossit : toujours en attente');
d.passe();
ok(signales.join() === 'scan-001.pdf', 'taille stable sur deux passes : signalé');
d.passe();
ok(signales.length === 1, 'signalé une seule fois');

for (const n of ['~$brouillon.docx', 'photo.jpg.part', '.cache.pdf', 'Thumbs.db', 'desktop.ini', 'notes.exe', 'vide.pdf']) {
  fs.writeFileSync(path.join(racine, n), n === 'vide.pdf' ? '' : 'x');
}
fs.mkdirSync(path.join(racine, 'sous-dossier'));
fs.writeFileSync(path.join(racine, 'sous-dossier', 'ailleurs.pdf'), 'x');
d.passe(); d.passe();
ok(signales.length === 1, 'temporaires, cachés, système, types inconnus, fichiers vides et sous-dossiers ignorés');
ok(ignore('~$Contrat.docx') && ignore('scan.tmp') && !ignore('Scan 2024.pdf'), 'règles d\'exclusion');

console.log('\n2. Lecture gardée (canal IPC)');
const chemin = path.join(racine, 'scan-001.pdf');
ok(d.lire(chemin).donnees.toString().startsWith('%PDF'), 'un fichier signalé se lit');
let refuse = false;
try { d.lire(path.join(racine, 'sous-dossier', 'ailleurs.pdf')); } catch { refuse = true; }
ok(refuse, 'un fichier non signalé est refusé');
refuse = false;
try { d.lire(path.join(racine, 'sous-dossier', '..', '..', 'etc', 'passwd')); } catch { refuse = true; }
ok(refuse, 'un chemin hors du dossier est refusé');

console.log('\n3. Rangement');
const range = d.confirmer(chemin, { ok: true });
ok(range && range.includes(SOUS_DOSSIER_IMPORTES) && fs.existsSync(range) && !fs.existsSync(chemin), 'versé : rangé dans « _Importés DocuFlow/<date> », rien de supprimé');
ok(d.etat().importesAujourdhui === 1 && d.etat().dernierImport.nom === 'scan-001.pdf', 'compteur et dernier import');

fs.writeFileSync(chemin, '%PDF-1.4 second scan au même nom');
d.passe(); d.passe();
const range2 = d.confirmer(chemin, { ok: true });
ok(path.basename(range2) === 'scan-001 (2).pdf', 'même nom le même jour : « scan-001 (2).pdf », rien d\'écrasé');

const mauvais = path.join(racine, 'illisible.pdf');
fs.writeFileSync(mauvais, 'pas un PDF');
for (let essai = 1; essai <= 3; essai += 1) {
  d.passe(); d.passe();
  const r = d.confirmer(mauvais, { ok: false, raison: 'Type de fichier refusé par l\'organisation' });
  if (essai < 3) ok(r === null && fs.existsSync(mauvais), `refus n° ${essai} : laissé en place pour un nouvel essai`);
  else ok(r && r.includes(SOUS_DOSSIER_REFUSES) && fs.readFileSync(`${r}.raison.txt`, 'utf8').includes('Type de fichier refusé'), 'troisième refus : rangé dans « _Non importés » avec la raison');
}
ok(d.etat().erreurs[0].message.includes('Type de fichier refusé'), 'dernières erreurs exposées à l\'interface');

const coupure = path.join(racine, 'coupure.pdf');
fs.writeFileSync(coupure, '%PDF-1.4');
for (let i = 0; i < 5; i += 1) { d.passe(); d.passe(); d.confirmer(coupure, { ok: false, raison: 'Serveur injoignable', transitoire: true }); }
ok(fs.existsSync(coupure), 'pannes passagères répétées : le fichier reste en place, réessayé');
d.passe(); d.passe();
ok(d.confirmer(coupure, { ok: true }).includes(SOUS_DOSSIER_IMPORTES), 'puis versé normalement quand le serveur revient');

console.log('\n4. Dossier introuvable');
const perdu = new DossierSurveille({ dossier: path.join(racine, 'nexiste-pas') });
perdu.passe();
ok(/introuvable/.test(perdu.etat().erreurs[0]?.message || ''), 'erreur lisible, pas de plantage');

fs.rmSync(racine, { recursive: true, force: true });
console.log(`\n${echecs === 0 ? '✅' : '❌'} Dossier surveillé cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
process.exit(echecs ? 1 : 0);
