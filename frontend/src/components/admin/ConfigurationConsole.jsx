import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Save, RotateCcw, Search, Upload, Trash2, Loader2, AlertCircle,
  CheckCircle, PackagePlus, Lock, ChevronDown, Info,
  Plus, ArrowUp, ArrowDown, AlertTriangle
} from 'lucide-react';
import { settingsService } from '../../services/settingsService';
import { useSettings } from '../../contexts/SettingsContext';
import { normalizeOptions, toneClass, TONES, DEFAULT_TONE } from '../../utils/requestOptions';
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
 *
 * Le catalogue distingue le TYPE DE STOCKAGE (`type`) du CONTRÔLE DE SAISIE
 * (`editor`). Les listes de choix du formulaire de demande sont stockées en JSON
 * mais ne doivent pas être saisies comme du JSON : c'est `editor: 'optionlist'`
 * qui aiguille vers l'éditeur dédié.
 */

/** Convertit une valeur du formulaire en valeur envoyable au backend. */
const serialize = (setting, value) => {
  // Les listes de choix sont manipulées comme des tableaux d'objets dans le
  // formulaire. La projection est explicite — et non un JSON.stringify direct —
  // pour deux raisons : elle fixe l'ordre des clés, et elle écarte les champs
  // parasites. Sans cela le diff de modifications se déclencherait sur une
  // simple différence de sérialisation, et l'admin verrait « 3 modifications en
  // attente » sans avoir rien touché.
  if (setting.editor === 'optionlist') {
    const list = Array.isArray(value) ? value : [];
    return JSON.stringify(
      list.map((entry) => {
        const out = {
          value: String(entry.value ?? '').trim(),
          label: String(entry.label ?? '').trim(),
        };
        if (setting.withTone) out.tone = entry.tone || DEFAULT_TONE;
        return out;
      })
    );
  }
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
  // Normaliser dès le chargement met la liste sous forme canonique
  // ([{ value, label }]), quelle que soit l'écriture présente en base — une
  // liste saisie autrefois à la main peut n'être qu'un tableau de chaînes.
  // L'éditeur n'a ainsi qu'une seule forme à gérer.
  if (setting.editor === 'optionlist') {
    return normalizeOptions(value, [], { withTone: setting.withTone });
  }
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
  // Les listes de choix sont vérifiées ici PLUS strictement que côté serveur, et
  // c'est délibéré : normalizeOptions écarte silencieusement une entrée sans
  // libellé et ne garde que la première de deux entrées homonymes. Envoyer une
  // liste bancale au serveur ferait donc disparaître des lignes sans un mot
  // d'explication. Bloquer l'enregistrement en nommant le problème vaut mieux
  // qu'une suppression muette.
  if (setting.editor === 'optionlist') {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) return 'Au moins un choix est nécessaire, sinon le formulaire devient inutilisable.';
    if (list.some((e) => !String(e.label ?? '').trim())) return 'Un choix est sans libellé.';
    if (list.some((e) => !String(e.value ?? '').trim())) return 'Un choix est sans valeur enregistrée.';
    const values = list.map((e) => String(e.value).trim());
    const duplicate = values.find((v, i) => values.indexOf(v) !== i);
    if (duplicate) return `Deux choix portent la valeur « ${duplicate} » : le second serait ignoré.`;
    return null;
  }
  if (setting.type === 'color' && value && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) {
    return 'Couleur hexadécimale attendue (ex. #1e293b)';
  }
  if (setting.type === 'number' && value !== '') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Valeur numérique attendue';
    if (setting.min !== null && n < setting.min) return `Minimum : ${setting.min}`;
    if (setting.max !== null && n > setting.max) return `Maximum : ${setting.max}`;
  }
  if (setting.type === 'json' && typeof value === 'string' && value) {
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

/**
 * OptionListField — éditeur de liste de choix (ajout, suppression, ordre).
 *
 * CE QU'IL REMPLACE
 *
 * Ces listes (types de document, motifs, priorités) étaient déjà stockées par
 * organisation, mais la console les présentait comme n'importe quel réglage JSON :
 * une zone de texte où l'administrateur devait écrire à la main
 *   [{"value":"PV d'Assemblée","label":"PV d'Assemblée"}]
 * Ajouter un motif supposait donc de connaître la syntaxe JSON, de deviner la
 * forme attendue, et de ne pas se tromper sur les apostrophes — celle de
 * « PV d'Assemblée » invalide la chaîne si les guillemets sont mal choisis. En
 * pratique le paramètre était inutilisable : la fonctionnalité existait sans
 * être accessible.
 *
 * POURQUOI `value` EST SÉPARÉE DU LIBELLÉ
 *
 * `value` est ce qui part en base et ce qui se trouve dans les demandes DÉJÀ
 * enregistrées ; `label` est ce que lit l'utilisateur. Les confondre a une
 * conséquence concrète : corriger une faute de frappe dans un libellé
 * réécrirait la valeur, et les demandes existantes porteraient alors un type
 * qui n'est plus dans la liste — invisible au filtrage. Le libellé est donc
 * modifiable librement, tandis que la valeur n'est proposée qu'à la création
 * (dérivée du libellé) puis repliée derrière « Valeur enregistrée ».
 */
const OptionListField = ({ setting, value, tones, error, onChange }) => {
  const disabled = !setting.editable;
  const list = Array.isArray(value) ? value : [];
  const [nouveau, setNouveau] = useState('');
  // Les valeurs techniques restent masquées par défaut : elles n'intéressent que
  // le cas de reprise (aligner un libellé sur des demandes déjà en base) et
  // doubleraient la hauteur du champ pour tout le monde.
  const [montrerValeurs, setMontrerValeurs] = useState(false);

  const modifier = (index, champ, valeur) => {
    const suivant = list.map((entry, i) => (i === index ? { ...entry, [champ]: valeur } : entry));
    onChange(suivant);
  };

  const supprimer = (index) => onChange(list.filter((_, i) => i !== index));

  const deplacer = (index, delta) => {
    const cible = index + delta;
    if (cible < 0 || cible >= list.length) return;
    const suivant = [...list];
    [suivant[index], suivant[cible]] = [suivant[cible], suivant[index]];
    onChange(suivant);
  };

  const ajouter = () => {
    const label = nouveau.trim();
    if (!label) return;
    // La valeur est dérivée du libellé : c'est la forme abrégée que
    // normalizeOptions accepte depuis toujours, et celle que produit une saisie
    // manuelle. L'administrateur peut ensuite l'ajuster via « Valeurs
    // enregistrées » si la liste doit coller à des demandes existantes.
    const entree = { value: label, label };
    if (setting.withTone) entree.tone = DEFAULT_TONE;
    onChange([...list, entree]);
    setNouveau('');
  };

  const champ =
    'px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30 disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="space-y-2">
      {/* Une liste vide n'affiche par nature aucune ligne : sans ce mot, le champ
          ressemblerait à un chargement inachevé. Gardé silencieux quand l'erreur
          bloquante est déjà affichée en regard du libellé, pour ne pas dire deux
          fois la même chose. */}
      {list.length === 0 && !error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          <AlertTriangle size={12} className="shrink-0" />
          Liste vide — le formulaire de demande serait inutilisable.
        </p>
      )}

      {list.map((entry, index) => (
        <div key={`${index}-${entry.value}`} className="flex items-start gap-1.5">
          {/* Poignées d'ordre : l'ordre des entrées est celui de la liste
              déroulante du formulaire, et le premier choix des priorités sert de
              repli quand la priorité par défaut n'existe plus. */}
          <div className="flex flex-col shrink-0 pt-0.5">
            <button
              type="button"
              disabled={disabled || index === 0}
              onClick={() => deplacer(index, -1)}
              title="Monter"
              className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              disabled={disabled || index === list.length - 1}
              onClick={() => deplacer(index, 1)}
              title="Descendre"
              className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
            >
              <ArrowDown size={12} />
            </button>
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={entry.label ?? ''}
                disabled={disabled}
                onChange={(e) => modifier(index, 'label', e.target.value)}
                placeholder="Libellé affiché"
                className={`${champ} flex-1 min-w-0`}
              />
              {setting.withTone && (
                <div className="relative shrink-0">
                  <select
                    value={entry.tone || DEFAULT_TONE}
                    disabled={disabled}
                    onChange={(e) => modifier(index, 'tone', e.target.value)}
                    title="Couleur de la pastille de priorité"
                    className={`${champ} appearance-none pr-7 w-32`}
                  >
                    {tones.map((tone) => (
                      <option key={tone} value={tone}>{tone}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
                </div>
              )}
              {/* Aperçu de la pastille telle qu'elle apparaîtra dans les listes
                  de demandes : le nom d'un ton ne dit pas sa couleur. */}
              {setting.withTone && (
                <span
                  className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-bold uppercase ${toneClass(entry.tone)}`}
                >
                  {entry.label || '—'}
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => supprimer(index)}
                title="Supprimer ce choix"
                className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {montrerValeurs && (
              <input
                type="text"
                value={entry.value ?? ''}
                disabled={disabled}
                onChange={(e) => modifier(index, 'value', e.target.value)}
                placeholder="Valeur enregistrée"
                className={`${champ} font-mono text-xs w-full`}
              />
            )}
          </div>
        </div>
      ))}

      {/* Ajout — un seul champ, validable à la touche Entrée : ajouter six motifs
          d'affilée ne doit pas demander six allers-retours à la souris. */}
      <div className="flex items-center gap-1.5 pt-1">
        <input
          type="text"
          value={nouveau}
          disabled={disabled}
          onChange={(e) => setNouveau(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // preventDefault garde l'ajout inoffensif si cette console venait à
            // être imbriquée dans un <form> : Entrée y déclencherait une
            // soumission, et le choix saisi serait perdu.
            e.preventDefault();
            ajouter();
          }}
          placeholder="Ajouter un choix…"
          className={`${champ} flex-1 min-w-0`}
        />
        <button
          type="button"
          disabled={disabled || !nouveau.trim()}
          onClick={ajouter}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-40"
        >
          <Plus size={13} /> Ajouter
        </button>
      </div>

      <button
        type="button"
        onClick={() => setMontrerValeurs((v) => !v)}
        className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
      >
        {montrerValeurs ? 'Masquer les valeurs enregistrées' : 'Afficher les valeurs enregistrées'}
      </button>
      {montrerValeurs && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          La valeur enregistrée est celle inscrite dans les demandes. La modifier
          n’altère pas les demandes déjà créées : elles conserveront l’ancienne
          valeur, qui n’apparaîtra plus dans les filtres.
        </p>
      )}
    </div>
  );
};

/**
 * DerivedSelectField — réglage dont les choix viennent d'une autre liste.
 *
 * `request_default_priority` nomme une valeur de `request_priorities`. Tant que
 * cette liste s'éditait à la main, l'incohérence était théorique ; elle est
 * devenue banale dès qu'un niveau se supprime d'un clic. Le formulaire de demande
 * retombe alors sur le premier niveau — silencieusement, si bien que le réglage
 * paraît ignoré.
 *
 * Les choix sont lus dans le FORMULAIRE et non dans les valeurs enregistrées :
 * un niveau qu'on vient d'ajouter doit être sélectionnable comme défaut avant
 * d'enregistrer, sinon il faut enregistrer deux fois pour un seul changement.
 */
const DerivedSelectField = ({ setting, value, error, sourceList, onChange }) => {
  const disabled = !setting.editable;
  const base =
    'w-full px-3 py-2 text-sm bg-white border rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30 disabled:bg-slate-50 disabled:text-slate-400';
  const border = error ? 'border-red-300' : 'border-slate-200';

  const choix = (sourceList || []).filter((e) => String(e.value ?? '').trim());
  // Une valeur héritée qui ne figure plus dans la liste doit rester VISIBLE :
  // la remplacer d'office par le premier choix masquerait le problème et
  // enregistrerait une modification que l'administrateur n'a pas demandée. Un
  // <select> sans option correspondante n'afficherait rien du tout.
  const orpheline = value && !choix.some((e) => e.value === value);

  return (
    <div className="relative">
      <select
        id={setting.key}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${border} appearance-none pr-9`}
      >
        {orpheline && <option value={value}>{value} (n’existe plus)</option>}
        {choix.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label || entry.value}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-2.5 text-slate-400 pointer-events-none" />
    </div>
  );
};

/** Contrôle de saisie adapté au type déclaré dans le catalogue. */
const SettingField = ({ setting, value, error, tones, sourceList, onChange, onUploadImage, imageUrl, uploading }) => {
  const disabled = !setting.editable;
  const base =
    'w-full px-3 py-2 text-sm bg-white border rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30 disabled:bg-slate-50 disabled:text-slate-400';
  const border = error ? 'border-red-300' : 'border-slate-200';

  // Testé avant `type` : une liste de choix est stockée en JSON, mais l'éditeur
  // dédié doit primer sur la zone de texte JSON.
  if (setting.editor === 'optionlist') {
    return <OptionListField setting={setting} value={value} tones={tones} error={error} onChange={onChange} />;
  }

  if (setting.optionsFrom) {
    return (
      <DerivedSelectField
        setting={setting}
        value={value}
        error={error}
        sourceList={sourceList}
        onChange={onChange}
      />
    );
  }

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
  // Tons de priorité admis par le serveur. Livrés par la réponse plutôt que lus
  // dans utils/requestOptions : si un ton était ajouté côté serveur sans que ce
  // fichier suive, le sélecteur proposerait un choix que coerce() remplacerait
  // silencieusement par le ton par défaut. Le repli local couvre le cas d'un
  // backend antérieur à ce champ.
  const [tones, setTones] = useState(TONES);
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
      if (Array.isArray(data.tones) && data.tones.length) setTones(data.tones);
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
      // La valeur est passée telle quelle : la convertir en chaîne écraserait un
      // tableau de choix en « [object Object],[object Object] », que localError
      // ne saurait plus vérifier. C'est à lui de traiter chaque forme.
      const message = localError(setting, value);
      setErrors((prev) => {
        const next = { ...prev };
        if (message) next[key] = message;
        else delete next[key];
        return next;
      });
    }
  };

  // Incohérences ENTRE deux réglages — hors de portée de localError, qui ne voit
  // qu'une clé à la fois.
  //
  // Supprimer le niveau « normale » de la liste des priorités invalide
  // `request_default_priority`, un champ que l'administrateur n'a PAS touché :
  // aucun handleChange ne se déclenche pour lui, donc rien ne le signalerait
  // avant le 400 du serveur (checkCrossKeys, settingsController.js). Le calcul
  // est dérivé du formulaire plutôt que stocké dans `errors` — une incohérence
  // apparaît et disparaît au fil des modifications de l'autre champ, et un état
  // séparé se désynchroniserait de la liste vivante.
  const crossErrors = useMemo(() => {
    const out = {};
    for (const setting of byKey.values()) {
      if (!setting.optionsFrom) continue;
      const wanted = String(form[setting.key] ?? '').trim();
      if (!wanted) continue;
      const source = byKey.get(setting.optionsFrom);
      const list = form[setting.optionsFrom];
      if (!source || !Array.isArray(list)) continue;
      if (!list.some((e) => String(e?.value ?? '').trim() === wanted)) {
        out[setting.key] =
          `« ${wanted} » ne figure plus dans « ${source.label} » : choisissez un niveau existant.`;
      }
    }
    return out;
  }, [form, byKey]);

  // Les deux sources sont fusionnées à l'affichage comme à l'enregistrement. Un
  // message venu du serveur (errors) l'emporte : il porte le refus réellement
  // opposé à la dernière tentative.
  const fieldError = (key) => errors[key] || crossErrors[key] || null;

  const handleSave = async () => {
    if (!dirtyKeys.length) return;
    const blocking = dirtyKeys.filter((key) => errors[key]);
    if (blocking.length) {
      toast.error(`Corrigez d'abord : ${blocking.map((k) => byKey.get(k)?.label || k).join(', ')}`);
      return;
    }

    // Une incohérence de paire porte souvent sur un champ NON modifié (la liste
    // a changé, pas le défaut), donc elle ne peut pas être cherchée parmi
    // `dirtyKeys`. Le filtre reproduit celui du serveur : seule une paire dont
    // un côté est modifié est opposée à l'enregistrement. Une incohérence déjà
    // présente en base reste visible à l'écran sans bloquer une modification
    // sans rapport — que le serveur accepterait de son côté.
    const croisees = Object.keys(crossErrors).filter((key) => {
      const setting = byKey.get(key);
      return dirtyKeys.includes(key) || dirtyKeys.includes(setting?.optionsFrom);
    });
    if (croisees.length) {
      toast.error(croisees.map((k) => crossErrors[k]).join(' '));
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
                    {fieldError(setting.key) && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-red-500 mt-1">
                        <AlertCircle size={11} /> {fieldError(setting.key)}
                      </p>
                    )}
                    {isDirty && !fieldError(setting.key) && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-amber-600 mt-1">
                        <Info size={11} /> Modifié — non enregistré
                      </p>
                    )}
                  </div>
                  <div className="md:flex-1 min-w-0">
                    <SettingField
                      setting={setting}
                      value={form[setting.key] ?? ''}
                      error={fieldError(setting.key)}
                      tones={tones}
                      sourceList={setting.optionsFrom ? form[setting.optionsFrom] : undefined}
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
