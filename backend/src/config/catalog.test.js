/**
 * catalog.test.js — Validation d'intégrité du catalogue de configuration.
 *
 * Le catalogue (config/settingsCatalog.js) est la whitelist d'écriture ET le
 * schéma de l'interface de configuration. Une incohérence y est silencieuse en
 * production : un `select` sans options accepterait n'importe quelle valeur, un
 * défaut invalide serait refusé par la validation qui le relit, un groupe
 * orphelin ferait disparaître ses paramètres de la console. Ces tests
 * verrouillent ces cas.
 *
 * Exécution : node src/config/catalog.test.js  (aucune dépendance, aucune base)
 */
const catalog = require('./settingsCatalog');

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` → ${detail}` : ''}`);
  }
}

console.log(`Catalogue : ${catalog.CATALOG.length} paramètres, ${catalog.GROUPS.length} groupes, ${catalog.EDITABLE_KEYS.length} modifiables\n`);

// 1. Clés uniques — une clé en double écraserait silencieusement l'autre
const keys = catalog.CATALOG.map((d) => d.key);
const duplicates = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
check('clés uniques', duplicates.length === 0, duplicates.join(', '));

// 2. Chaque paramètre appartient à un groupe déclaré, sinon il n'est affiché nulle part
const groupNames = new Set(catalog.GROUPS.map((g) => g.name));
const orphans = [...new Set(catalog.CATALOG.filter((d) => !groupNames.has(d.group)).map((d) => d.group))];
check('groupes déclarés', orphans.length === 0, `groupes inconnus : ${orphans.join(', ')}`);

// 3. Chaque groupe contient au moins un paramètre
const emptyGroups = catalog.GROUPS.filter((g) => !catalog.CATALOG.some((d) => d.group === g.name)).map((g) => g.name);
check('aucun groupe vide', emptyGroups.length === 0, emptyGroups.join(', '));

// 4. Types connus
const VALID_TYPES = ['string', 'text', 'number', 'boolean', 'color', 'json', 'select', 'image'];
const badTypes = catalog.CATALOG.filter((d) => !VALID_TYPES.includes(d.type)).map((d) => `${d.key}=${d.type}`);
check('types valides', badTypes.length === 0, badTypes.join(', '));

// 5. Un select sans options accepterait n'importe quelle valeur (coerce ne filtre plus)
const selectsWithoutOptions = catalog.CATALOG.filter((d) => d.type === 'select' && !(d.options || []).length).map((d) => d.key);
check('select avec options', selectsWithoutOptions.length === 0, selectsWithoutOptions.join(', '));

// 6. Le défaut d'un select doit figurer dans ses options
const badSelectDefaults = catalog.CATALOG
  .filter((d) => d.type === 'select' && d.default && !(d.options || []).some((o) => o.value === d.default))
  .map((d) => `${d.key}=${d.default}`);
check('défauts select cohérents', badSelectDefaults.length === 0, badSelectDefaults.join(', '));

// 7. Chaque défaut doit passer la validation qui le relira
const invalidDefaults = [];
for (const definition of catalog.CATALOG) {
  if (definition.default === null || definition.default === undefined) continue;
  try {
    catalog.coerce(definition, definition.default);
  } catch (err) {
    invalidDefaults.push(`${definition.key} : ${err.message}`);
  }
}
check('défauts acceptés par coerce', invalidDefaults.length === 0, invalidDefaults.join(' | '));

// 8. Aller-retour coerce → parseValue : la valeur relue doit être du bon type JS
const roundTripErrors = [];
for (const definition of catalog.CATALOG) {
  if (definition.default === null || definition.default === undefined) continue;
  const stored = catalog.coerce(definition, definition.default);
  const parsed = catalog.parseValue(definition, stored);
  if (definition.type === 'number' && typeof parsed !== 'number') roundTripErrors.push(`${definition.key} → ${typeof parsed}`);
  if (definition.type === 'boolean' && typeof parsed !== 'boolean') roundTripErrors.push(`${definition.key} → ${typeof parsed}`);
  if (definition.type === 'json' && parsed === null) roundTripErrors.push(`${definition.key} → JSON illisible`);
}
check('aller-retour coerce/parseValue', roundTripErrors.length === 0, roundTripErrors.join(', '));

// 9. Les bornes numériques encadrent le défaut
const outOfBounds = catalog.CATALOG
  .filter((d) => d.type === 'number' && d.default != null)
  .filter((d) => (d.min !== undefined && Number(d.default) < d.min) || (d.max !== undefined && Number(d.default) > d.max))
  .map((d) => d.key);
check('défauts numériques dans les bornes', outOfBounds.length === 0, outOfBounds.join(', '));

// 10. Rejet effectif des valeurs invalides — c'est la garantie de sécurité
const colorDef = catalog.BY_KEY.get('primary_color');
let colorRejected = false;
try { catalog.coerce(colorDef, 'javascript:alert(1)'); } catch { colorRejected = true; }
check('couleur invalide rejetée', colorRejected);

const numberDef = catalog.BY_KEY.get('page_size');
let numberRejected = false;
try { catalog.coerce(numberDef, '99999'); } catch { numberRejected = true; }
check('nombre hors bornes rejeté', numberRejected);

const selectDef = catalog.BY_KEY.get('ged_access_role');
let selectRejected = false;
try { catalog.coerce(selectDef, 'root'); } catch { selectRejected = true; }
check('valeur select non autorisée rejetée', selectRejected);

const jsonDef = catalog.BY_KEY.get('document_statuses');
let jsonRejected = false;
try { catalog.coerce(jsonDef, '{ceci nest pas du json'); } catch { jsonRejected = true; }
check('JSON invalide rejeté', jsonRejected);

// 11. Les clés non modifiables sont exclues de la whitelist d'écriture
const readOnly = catalog.CATALOG.filter((d) => d.editable === false).map((d) => d.key);
const leaked = readOnly.filter((k) => catalog.EDITABLE_KEYS.includes(k));
check('clés en lecture seule exclues de EDITABLE_KEYS', leaked.length === 0, leaked.join(', '));

// 12. defaults() n'expose aucune valeur nulle (elles casseraient l'INSERT groupé)
const nullDefaults = Object.entries(catalog.defaults()).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
check('defaults() sans valeur nulle', nullDefaults.length === 0, nullDefaults.join(', '));

console.log(failures === 0 ? '\n✅ Catalogue cohérent.' : `\n❌ ${failures} vérification(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
