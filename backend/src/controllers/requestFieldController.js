/**
 * requestFieldController — API des champs configurables du formulaire de demande.
 *
 * Deux publics, deux périmètres :
 *   * l'ADMINISTRATEUR configure les champs (liste complète, y compris masqués) ;
 *   * le DEMANDEUR lit ceux qu'il doit remplir (visibles seulement).
 *
 * La séparation est ce qui permet à `GET /form` d'être ouvert à tous les rôles :
 * un demandeur a besoin de la structure du formulaire, pas des champs que
 * l'administrateur a retirés.
 */
const requestFieldService = require('../services/requestFieldService');

/**
 * Traduit une erreur du service en réponse HTTP.
 *
 * Les refus de validation et les refus posés par les triggers de la migration
 * 016 sont des erreurs de SAISIE, pas des pannes : les renvoyer en 500 ferait
 * afficher « erreur serveur » là où l'administrateur doit lire ce qui est refusé
 * et pourquoi. `P0001` est le code des RAISE EXCEPTION de plpgsql.
 */
function repondreErreur(res, err, contexte) {
  const estRefusMetier = err.code === 'P0001' || !err.code;
  if (estRefusMetier) {
    return res.status(400).json({ message: err.message });
  }
  // Table absente : la migration 016 n'est pas passée. Le message doit nommer la
  // cause, sinon le symptôme (« erreur serveur ») envoie chercher au mauvais endroit.
  if (err.code === '42P01') {
    return res.status(503).json({
      message: 'Les champs de demande configurables ne sont pas encore installés sur cette base (migration 016).',
    });
  }
  console.error(`[requestField] ${contexte} :`, err.message);
  return res.status(500).json({ message: `Erreur lors de ${contexte}` });
}

/**
 * Champs à afficher dans le formulaire de demande — visibles uniquement.
 *
 * Renvoie `available: false` plutôt qu'une erreur si la migration n'est pas
 * passée : le formulaire retombe alors sur ses champs d'origine et reste
 * utilisable. Un déploiement qui précède sa migration ne doit pas empêcher
 * d'enregistrer une demande.
 */
exports.getFormFields = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    if (!(await requestFieldService.isAvailable())) {
      return res.json({ available: false, fields: [] });
    }
    const fields = await requestFieldService.listFields(tenantId, { visibleOnly: true });
    res.json({ available: true, fields });
  } catch (err) {
    repondreErreur(res, err, 'la lecture des champs du formulaire');
  }
};

/** Toutes les définitions, masquées comprises — vue de l'administrateur. */
exports.getFields = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const fields = await requestFieldService.listFields(tenantId);
    res.json({
      fields,
      // La console a besoin de la liste des types acceptés et des réglages
      // utilisables comme source de choix : les recopier côté frontend les
      // ferait diverger du CHECK de la base au premier ajout de type.
      fieldTypes: requestFieldService.FIELD_TYPES,
      optionSettings: requestFieldService.OPTION_SETTING_KEYS,
    });
  } catch (err) {
    repondreErreur(res, err, 'la lecture des champs de demande');
  }
};

/**
 * Enregistre l'intégralité des champs, dans l'ordre reçu.
 *
 * Synchronisation globale et non modification champ par champ : l'éditeur
 * manipule un tableau réordonnable, et `display_order` n'a de sens que rapporté
 * à l'ensemble. Enregistrer les champs un à un rendrait tout réordonnancement
 * non atomique — un rechargement au milieu montrerait deux champs au même rang.
 */
exports.syncFields = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { fields } = req.body;
  try {
    const result = await requestFieldService.syncFields(tenantId, fields);
    res.json({ message: 'Champs du formulaire enregistrés', fields: result });
  } catch (err) {
    repondreErreur(res, err, "l'enregistrement des champs de demande");
  }
};

/**
 * Réaffiche ou masque un champ.
 *
 * Le masquage se fait aussi en retirant le champ de l'éditeur, mais le
 * RÉAFFICHAGE n'a pas d'équivalent : un champ absent de la liste ne peut pas y
 * être glissé de nouveau. Sans cette route, masquer un champ système serait
 * irréversible depuis l'interface.
 */
exports.setVisibility = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { is_visible } = req.body;
  try {
    const field = await requestFieldService.setVisibility(tenantId, id, is_visible);
    if (!field) return res.status(404).json({ message: 'Champ non trouvé' });
    res.json({ message: field.is_visible ? 'Champ réaffiché' : 'Champ masqué', field });
  } catch (err) {
    repondreErreur(res, err, 'la modification de la visibilité du champ');
  }
};

/**
 * Crée les sept champs d'origine pour une organisation qui n'en a aucun.
 *
 * Cas visé : base restaurée d'une sauvegarde antérieure à la migration 016, ou
 * organisation créée par un chemin qui n'appelle pas `provision_tenant_defaults`.
 * Sans cette issue, l'écran d'administration afficherait une liste vide sans
 * moyen de la remplir, et le formulaire de demande n'aurait plus aucun champ.
 */
exports.provisionDefaults = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const fields = await requestFieldService.provisionDefaults(tenantId);
    res.json({ message: 'Champs par défaut installés', fields });
  } catch (err) {
    repondreErreur(res, err, 'le provisionnement des champs de demande');
  }
};
