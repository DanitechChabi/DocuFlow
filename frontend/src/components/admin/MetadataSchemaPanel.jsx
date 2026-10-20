import React, { useState, useEffect, useCallback } from 'react';
import { Database, Loader2, PackagePlus } from 'lucide-react';
import { documentService } from '../../services/documentService';
import { settingsService } from '../../services/settingsService';
import { toast } from '../Toast';
import ClassesPanel from './ClassesPanel';

/**
 * MetadataSchemaPanel — chargement, enregistrement et cas « aucun schéma » de
 * l'éditeur de métadonnées.
 *
 * Extrait de CompanyAdminPage pour que la console superadministrateur dispose du
 * même écran : dupliquer ce code aurait dupliqué la subtilité des identifiants
 * temporaires ci-dessous, dont l'oubli détruit les métadonnées des documents.
 */
const MetadataSchemaPanel = () => {
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);

  const fetchSchema = useCallback(async () => {
    setLoading(true);
    try {
      const data = await documentService.getMetadataSchema();
      setSchema(data || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement du schéma');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  // Aucun schéma : les organisations créées avant le provisionnement automatique
  // n'en ont pas. Plutôt qu'un cul-de-sac, on propose de le créer sur place.
  const handleProvision = async () => {
    setProvisioning(true);
    try {
      const res = await settingsService.provisionDefaults();
      const failed = res?.failed || [];
      if (failed.length) {
        toast.error(`Provisionnement incomplet : ${failed.map((f) => f.step).join(', ')}`);
      } else {
        toast.success('Objets par défaut créés');
      }
      await fetchSchema();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du provisionnement');
    } finally {
      setProvisioning(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-3">
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
        <Database size={28} className="mx-auto mb-3 text-slate-300" />
        <h3 className="text-lg font-black text-slate-800 mb-1">Aucun schéma de métadonnées</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-5">
          Cette organisation n'a pas encore de schéma de classification. Le provisionnement crée le
          schéma standard, ses champs, les dossiers et les vues par défaut — sans toucher à
          l'existant.
        </p>
        <button
          onClick={handleProvision}
          disabled={provisioning}
          className="btn-primary inline-flex items-center gap-2"
        >
          {provisioning ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
          {provisioning ? 'Provisionnement…' : 'Provisionner les objets par défaut'}
        </button>
      </div>
    );
  }

  // Classes et propriétés (modèle M-Files) : propriétés communes + classes.
  return <ClassesPanel />;
};

export default MetadataSchemaPanel;
