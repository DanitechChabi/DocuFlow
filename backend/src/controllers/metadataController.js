const metadataService = require('../services/metadataService');

/**
 * metadataController — Contrôleur pour la gestion des schémas de métadonnées et des valeurs.
 */
exports.getSchemas = async (req, res) => {
  try {
    const schemas = await metadataService.getSchemas(req.user.tenant_id);
    res.json(schemas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createSchema = async (req, res) => {
  try {
    const schema = await metadataService.createSchema(req.user.tenant_id, req.body);
    res.status(201).json(schema);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getSchemaById = async (req, res) => {
  try {
    const schema = await metadataService.getSchemaById(req.user.tenant_id, parseInt(req.params.id));
    if (!schema) {
      return res.status(404).json({ error: 'Schéma non trouvé' });
    }
    res.json(schema);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateSchema = async (req, res) => {
  try {
    const schema = await metadataService.updateSchema(
      req.user.tenant_id,
      parseInt(req.params.id),
      req.body
    );
    if (!schema) {
      return res.status(404).json({ error: 'Schéma non trouvé' });
    }
    res.json(schema);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteSchema = async (req, res) => {
  try {
    const success = await metadataService.deleteSchema(req.user.tenant_id, parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: 'Schéma non trouvé' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createField = async (req, res) => {
  try {
    const field = await metadataService.createField(
      req.user.tenant_id,
      parseInt(req.params.schemaId),
      req.body
    );
    res.status(201).json(field);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateField = async (req, res) => {
  try {
    const field = await metadataService.updateField(
      req.user.tenant_id,
      parseInt(req.params.id),
      req.body
    );
    if (!field) {
      return res.status(404).json({ error: 'Champ non trouvé' });
    }
    res.json(field);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteField = async (req, res) => {
  try {
    const success = await metadataService.deleteField(req.user.tenant_id, parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: 'Champ non trouvé' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDocumentMetadata = async (req, res) => {
  try {
    const metadata = await metadataService.getDocumentMetadata(
      req.user.tenant_id,
      parseInt(req.params.documentId)
    );
    res.json(metadata);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setDocumentMetadata = async (req, res) => {
  try {
    const { values } = req.body;
    if (!Array.isArray(values)) {
      return res.status(400).json({ error: 'Le corps de la requête doit contenir un tableau "values"' });
    }
    await metadataService.setDocumentMetadata(
      req.user.tenant_id,
      parseInt(req.params.documentId),
      values
    );
    res.status(200).json({ message: 'Métadonnées mises à jour avec succès' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateMetadataValue = async (req, res) => {
  try {
    const { value } = req.body;
    const updatedValue = await metadataService.updateMetadataValue(
      req.user.tenant_id,
      parseInt(req.params.documentId),
      parseInt(req.params.fieldId),
      value
    );
    res.json(updatedValue);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteMetadataValue = async (req, res) => {
  try {
    const success = await metadataService.deleteMetadataValue(
      req.user.tenant_id,
      parseInt(req.params.documentId),
      parseInt(req.params.fieldId)
    );
    if (!success) {
      return res.status(404).json({ error: 'Valeur de métadonnée non trouvée' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.syncSchema = async (req, res) => {
  try {
    const schemaId = parseInt(req.params.id);
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'Le corps de la requête doit contenir un tableau "fields"' });
    }

    const syncedFields = await metadataService.syncSchemaFields(req.user.tenant_id, schemaId, fields);
    res.json({ message: 'Schéma synchronisé avec succès', fields: syncedFields });
  } catch (error) {
    console.error('[metadata] syncSchema:', error);
    res.status(400).json({ error: error.message });
  }
};
