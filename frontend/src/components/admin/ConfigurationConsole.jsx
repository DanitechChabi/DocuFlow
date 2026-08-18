import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Save, RotateCcw, Search, Upload, Trash2, Loader2, AlertCircle,
  CheckCircle, PackagePlus, Lock, ChevronDown, Info
} from 'lucide-react';
import { settingsService } from '../../services/settingsService';
import { useSettings } from '../../contexts/SettingsContext';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';

/**
 * ConfigurationConsole — console de configuration complète de l'organisation.
 *
 * L'interface est intégralement construite depuis `GET /settings/configuration` :
 * groupes, libellés, types, options et bornes viennent du catalogue backend
 * (config/settingsCatalog.js). Aucun paramètre n'est donc listé en dur ici —
 * tout réglage ajouté au catalogue apparaît automatiquement dans cette console,
 * avec le bon contrôle de saisie et la bonne validation.
 */

/** Convertit une valeur du formulaire en valeur envoyable au backend. */
const serialize = (setting, value) => {
  if (setting.type === 'json' && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  if (setting.type === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  return String(value);
};

/** Valeur initiale d'un champ, prête pour un input contrôlé (jamais `undefined`). */
const toFormValue = (setting) => {
  const value = setting.value;
  switch (setting.type) {
    case 'boolean':
      return value === true;
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2);
    case 'number':
      return value === null || value === undefined ? '' : String(value);
    default:
      return value === null || value === undefined ? '' : String(value);
  }
};

/** Vérifie côté client ce que le backend refuserait, pour un retour immédiat. */
const localError = (setting, value) => {
  if (setting.type === 'color' && value && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) {
    return 'Couleur hexadécimale attendue (ex. #1e293b)';
  }
  if (setting.type === 'number' && value !== '') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Valeur numérique attendue';
    if (setting.min !== null && n < setting.min) return `Minimum : ${setting.min}`;
    if (setting.max !== null && n > setting.max) return `Maximum : ${setting.max}`;
  }
  if (setting.type === 'json' && value) {
    try {
      JSON.parse(value);
    } catch {
      return 'JSON invalide';
    }
  }
  return null;
};

const FieldLabel = ({ setting }) => (
  <div className="flex items-start gap-2 mb-1.5">
    <label htmlFor={setting.key} className="text-sm font-semibold text-slate-800">
      {setting.label}
    </label>
    {!setting.editable && (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold uppercase"
        title="Déterminé par la configuration du serveur"
      >
        <Lock size={9} /> Serveur
      </span>
    )}
  </div>
);

/** Contrôle de saisie adapté au type déclaré dans le catalogue. */
const SettingField = ({ setting, value, error, onChange, onUploadImage, imageUrl, uploading }) => {
  const disabled = !setting.editable;
  const base =
    'w-full px-3 py-2 text-sm bg-white border rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30 disabled:bg-slate-50 disabled:text-slate-400';
  const border = error ? 'border-red-300' : 'border-slate-200';

  if (setting.type === 'boolean') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={value === true}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          value ? 'bg-docuflow-secondary' : 'bg-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            value ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    );
  }

  if (setting.type === 'select') {
    return (
      <div className="relative">
        <select
          id={setting.key}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} ${border} appearance-none pr-9`}
        >
          {setting.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="absolute right-3 top-2.5 text-slate-400 pointer-events-none" />
      </div>
    );
  }

  if (setting.type === 'color') {
    return (
      <div className="flex items-center gap-2">
        <label className="relative cursor-pointer shrink-0">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <span
            className="block w-9 h-9 rounded-xl border-2 border-white shadow-md"
            style={{ backgroundColor: /^#[0-9a-fA-F]{3,6}$/.test(value) ? value : '#ffffff' }}
          />
        </label>
        <input
          id={setting.key}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          placeholder="#1e293b"
          className={`${base} ${border} font-mono w-28`}
        />
      </div>
    );
  }

  if (setting.type === 'image') {
    return (
      <div className="flex items-center gap-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={setting.label}
            className="w-11 h-11 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
          />
        ) : (
          <span className="w-11 h-11 rounded-xl bg-slate-50 border border-dashed border-slate-300 shrink-0" />
        )}
        <label className="btn-secondary flex items-center gap-2 text-xs py-2 cursor-pointer m-0">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Envoi…' : 'Choisir un fichier'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Réinitialiser permet de re-sélectionner le même fichier ensuite.
              e.target.value = '';
              if (file) onUploadImage(setting.key, file);
            }}
          />
        </label>
      </div>
    );
  }

  if (setting.type === 'text' || setting.type === 'json') {
    return (
      <textarea
        id={setting.key}
        value={value}
        disabled={disabled}
        rows={setting.type === 'json' ? 5 : 3}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${border} resize-y ${setting.type === 'json' ? 'font-mono text-xs' : ''}`}
      />
    );
  }

  if (setting.type === 'number') {
    return (
      <input
        id={setting.key}
        type="number"
        value={value}
        disabled={disabled}
        min={setting.min ?? undefined}
        max={setting.max ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${border} w-36`}
      />
    );
  }

  return (
    <input
      id={setting.key}
      type="text"
      value={value}
      disabled={disabled}
      placeholder={setting.defaultValue || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`${base} ${border}`}
    />
  );
};

const ConfigurationConsole = () => {
  const settingsCtx = useSettings();
  const [groups, setGroups] = useState([]);
  const [values, setValues] = useState({});
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [activeGroup, setActiveGroup] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [provisioning, setProvisioning] = useState(false);
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await settingsService.getConfiguration();
      const nextGroups = data.groups || [];
      setGroups(nextGroups);
      setValues(data.values || {});
      const nextForm = {};
      for (const group of nextGroups) {
        for (const setting of group.settings) nextForm[setting.key] = toFormValue(setting);
      }
      setForm(nextForm);
      setErrors({});
      setActiveGroup((current) =>
        current && nextGroups.some((g) => g.name === current) ? current : nextGroups[0]?.name || null
      );
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Configuration inaccessible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Index des définitions par clé — sert au diff et à la validation.
  const byKey = useMemo(() => {
    const map = new Map();
    for (const group of groups) {
      for (const setting of group.settings) map.set(setting.key, setting);
    }
    return map;
  }, [groups]);

  // Seuls les champs réellement modifiés sont envoyés : le backend rejette la
  // requête entière si une seule valeur est invalide, inutile de lui renvoyer
  // les 50 paramètres inchangés.
  const dirtyKeys = useMemo(
    () =>
      Object.keys(form).filter((key) => {
        const setting = byKey.get(key);
        if (!setting || !setting.editable || setting.type === 'image') return false;
        return serialize(setting, form[key]) !== serialize(setting, toFormValue(setting));
      }),
    [form, byKey]
  );

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    const setting = byKey.get(key);
    if (setting) {
      const message = localError(setting, typeof value === 'string' ? value : String(value ?? ''));
      setErrors((prev) => {
        const next = { ...prev };
        if (message) next[key] = message;
        else delete next[key];
        return next;
      });
    }
  };

  const handleSave = async () => {
    if (!dirtyKeys.length) return;
    const blocking = dirtyKeys.filter((key) => errors[key]);
    if (blocking.length) {
      toast.error(`Corrigez d'abord : ${blocking.map((k) => byKey.get(k)?.label || k).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      const payload = {};
      for (const key of dirtyKeys) payload[key] = serialize(byKey.get(key), form[key]);
      const res = await settingsService.updateSettings(payload);
      toast.success(res.message || 'Configuration enregistrée');
      await load();
      // Le branding et le thème sont appliqués au DOM par le contexte : sans ce
      // rafraîchissement, l'onglet resterait à jour mais pas le reste de l'app.
      await settingsCtx.refresh?.();
    } catch (err) {
      const data = err?.response?.data;
      if (Array.isArray(data?.rejected)) {
        setErrors((prev) => {
          const next = { ...prev };
          for (const r of data.rejected) next[r.key] = r.reason;
          return next;
        });
      }
      toast.error(data?.message || 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadImage = async (key, file) => {
    setUploadingKey(key);
    try {
      const res = await settingsService.uploadLogo(file, key);
      setValues((prev) => ({ ...prev, [key]: res.filename, [`${key}_url`]: res.url }));
      toast.success(res.message || 'Image mise à jour');
      await settingsCtx.refresh?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Erreur lors de l'envoi de l'image");
    } finally {
      setUploadingKey(null);
    }
  };

  const askReset = (group) => {
    setConfirm({
      open: true,
      title: group ? `Réinitialiser « ${group.label} » ?` : 'Réinitialiser toute la configuration ?',
      message: group
        ? `Les ${group.settings.filter((s) => s.editable).length} paramètre(s) de cet onglet reprendront leur valeur d'origine.`
        : 'Tous les paramètres modifiables de votre organisation reprendront leur valeur d’origine. Les utilisateurs, documents et sections ne sont pas touchés.',
      onConfirm: async () => {
        try {
          const res = await settingsService.resetSettings(group?.name || null);
          toast.success(res.message || 'Configuration réinitialisée');
          await load();
          await settingsCtx.refresh?.();
        } catch (err) {
          toast.error(err?.response?.data?.message || 'Erreur lors de la réinitialisation');
        } finally {
          setConfirm((c) => ({ ...c, open: false }));
        }
      },
    });
  };

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      const res = await settingsService.provisionDefaults();
      const done = res.done?.length || 0;
      const failed = res.failed?.length || 0;
      if (failed) {
        toast.error(`${done} élément(s) créé(s), ${failed} en échec : ${res.failed.map((f) => f.step).join(', ')}`);
      } else {
        toast.success(`Provisionnement effectué — ${done} élément(s) vérifié(s) ou créé(s)`);
      }
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Erreur lors du provisionnement');
    } finally {
      setProvisioning(false);
    }
  };

  // Une recherche non vide traverse tous les onglets : chercher « upload » sans
  // savoir dans quel groupe il se trouve doit fonctionner.
  const term = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!term) return groups.filter((g) => g.name === activeGroup);
    return groups
      .map((g) => ({
        ...g,
        settings: g.settings.filter(
          (s) =>
            s.label.toLowerCase().includes(term) ||
            s.key.toLowerCase().includes(term) ||
            (s.description || '').toLowerCase().includes(term)
        ),
      }))
      .filter((g) => g.settings.length > 0);
  }, [groups, activeGroup, term]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm font-medium">Chargement de la configuration…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <AlertCircle size={30} className="text-red-400" />
        <p className="text-sm font-semibold text-slate-700">{loadError}</p>
        <button onClick={load} className="btn-secondary text-sm py-2">Réessayer</button>
      </div>
    );
  }

  const totalEditable = groups.reduce((n, g) => n + g.settings.filter((s) => s.editable).length, 0);

  return (
    <div className="space-y-5">
      {/* En-tête : recherche + actions globales */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Rechercher parmi ${totalEditable} paramètres…`}
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleProvision}
            disabled={provisioning}
            title="Recrée les objets par défaut manquants (dossiers, vues, métadonnées…). Sans effet sur l'existant."
            className="btn-secondary flex items-center gap-2 text-sm py-2.5"
          >
            {provisioning ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
            Compléter l’installation
          </button>
          <button onClick={() => askReset(null)} className="btn-secondary flex items-center gap-2 text-sm py-2.5">
            <Trash2 size={15} />
            Tout réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirtyKeys.length}
            className="btn-primary flex items-center gap-2 text-sm py-2.5"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {dirtyKeys.length ? `Enregistrer (${dirtyKeys.length})` : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Onglets de groupes — masqués pendant une recherche, qui est transverse */}
      {!term && (
        <div className="flex gap-1.5 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 overflow-x-auto scrollbar-none">
          {groups.map((group) => (
            <button
              key={group.name}
              onClick={() => setActiveGroup(group.name)}
              className={`px-4 py-2 rounded-xl font-bold text-xs md:text-sm transition-all whitespace-nowrap ${
                activeGroup === group.name
                  ? 'bg-docuflow-primary text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {group.label}
              <span className="ml-1.5 opacity-60 font-mono text-[10px]">{group.settings.length}</span>
            </button>
          ))}
        </div>
      )}

      {visibleGroups.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-10">Aucun paramètre ne correspond à « {search} ».</p>
      )}

      {visibleGroups.map((group) => (
        <div key={group.name} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
            <div>
              <h3 className="text-sm font-bold text-slate-800">{group.label}</h3>
              {group.description && <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>}
            </div>
            {!term && (
              <button
                onClick={() => askReset(group)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors shrink-0"
              >
                <RotateCcw size={13} />
                Valeurs d’origine
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-50">
            {group.settings.map((setting) => {
              const isDirty = dirtyKeys.includes(setting.key);
              return (
                <div
                  key={setting.key}
                  className={`px-5 py-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-6 transition-colors ${
                    isDirty ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <div className="md:w-2/5 min-w-0">
                    <FieldLabel setting={setting} />
                    {setting.description && (
                      <p className="text-xs text-slate-500 leading-relaxed">{setting.description}</p>
                    )}
                    {errors[setting.key] && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-red-500 mt-1">
                        <AlertCircle size={11} /> {errors[setting.key]}
                      </p>
                    )}
                    {isDirty && !errors[setting.key] && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-amber-600 mt-1">
                        <Info size={11} /> Modifié — non enregistré
                      </p>
                    )}
                  </div>
                  <div className="md:flex-1 min-w-0">
                    <SettingField
                      setting={setting}
                      value={form[setting.key] ?? ''}
                      error={errors[setting.key]}
                      onChange={(v) => handleChange(setting.key, v)}
                      onUploadImage={handleUploadImage}
                      imageUrl={values[`${setting.key}_url`]}
                      uploading={uploadingKey === setting.key}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Barre d'enregistrement flottante — évite de remonter en haut de page */}
      {dirtyKeys.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 bg-docuflow-primary text-white rounded-2xl px-5 py-3 shadow-xl">
          <span className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle size={16} />
            {dirtyKeys.length} modification(s) en attente
          </span>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-docuflow-primary hover:bg-slate-100 transition-colors disabled:opacity-60"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirm.open}
        title={confirm.title}
        message={confirm.message}
        type="danger"
        onConfirm={confirm.onConfirm}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  );
};

export default ConfigurationConsole;
