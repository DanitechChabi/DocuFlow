/**
 * DocumentAssemblyService — Assemblage automatique de documents M-Files
 * Génère des documents à partir de modèles de texte/HTML et de variables de métadonnées.
 */

function assembleDocumentTemplate(templateContent, metadata = {}) {
  let assembled = templateContent;
  for (const [key, value] of Object.entries(metadata)) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    assembled = assembled.replace(placeholder, value !== undefined && value !== null ? String(value) : '');
  }
  return assembled;
}

const DEFAULT_TEMPLATES = [
  {
    id: 'contrat_standard',
    name: 'Contrat de prestation standard',
    category: 'Juridique',
    content: `CONTRAT DE PRESTATION DE SERVICE

Entre les soussignés :
- {{nom_entreprise}}, sise au siège social représenté par son représentant légal.
- Et le Client.

Objet du dossier : {{num_dossier}}
Numéro d'acte : {{num_acte}}
Année d'exercice : {{annee}}

Fait le {{date_document}} à {{lieu}}.
Signatures.`
  },
  {
    id: 'pv_reception',
    name: 'Procès-Verbal de Réception / Livraison',
    category: 'Operations',
    content: `PROCÈS-VERBAL DE RÉCEPTION

Entreprise : {{nom_entreprise}}
Référence Dossier : {{num_dossier}}
Acte N° : {{num_acte}}
Description : {{description}}

Le présent procès-verbal atteste de la conformité des pièces livrées et validées.`
  }
];

module.exports = {
  assembleDocumentTemplate,
  DEFAULT_TEMPLATES
};
