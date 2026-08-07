import React, { useState, useEffect } from 'react';
import { Palette, RotateCcw, Check } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { toast } from './Toast';

const THEME_COLORS = [
  { key: 'primary_color', label: 'Couleur principale', desc: 'En-têtes, boutons principaux, texte sombre' },
  { key: 'secondary_color', label: 'Couleur secondaire', desc: 'Liens, accents, notifications' },
  { key: 'accent_color', label: 'Couleur d\'accent', desc: 'Arrière-plans clairs, survol' },
  { key: 'dark_color', label: 'Couleur sombre', desc: 'Barre latérale, en-têtes de section' },
  { key: 'gold_color', label: 'Couleur or', desc: 'Badges premium, highlights' },
];

const DEFAULT_VALUES = {
  primary_color: '#0f172a',
  secondary_color: '#3b82f6',
  accent_color: '#f8fafc',
  dark_color: '#1e293b',
  gold_color: '#d4af37',
};

const PRESETS = [
  {
    name: 'DocuFlow (défaut)',
    colors: { primary_color: '#0f172a', secondary_color: '#3b82f6', accent_color: '#f8fafc', dark_color: '#1e293b', gold_color: '#d4af37' },
  },
  {
    name: 'Émeraude',
    colors: { primary_color: '#064e3b', secondary_color: '#10b981', accent_color: '#ecfdf5', dark_color: '#065f46', gold_color: '#d4af37' },
  },
  {
    name: 'Royal',
    colors: { primary_color: '#1e1b4b', secondary_color: '#6366f1', accent_color: '#eef2ff', dark_color: '#312e81', gold_color: '#f59e0b' },
  },
  {
    name: 'Corail',
    colors: { primary_color: '#7f1d1d', secondary_color: '#ef4444', accent_color: '#fef2f2', dark_color: '#991b1b', gold_color: '#f59e0b' },
  },
  {
    name: 'Sombre',
    colors: { primary_color: '#111827', secondary_color: '#3b82f6', accent_color: '#1f2937', dark_color: '#030712', gold_color: '#fbbf24' },
  },
];

const ColorInput = ({ color, onChange, label }) => (
  <div className="flex items-center gap-3">
    <label className="relative cursor-pointer">
      <input
        type="color"
        value={color}
        onChange={onChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <div
        className="w-12 h-12 rounded-xl border-2 border-white shadow-md hover:scale-110 transition-transform"
        style={{ backgroundColor: color }}
      />
    </label>
    <div className="flex-1">
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      <p className="text-xs text-slate-400 font-mono uppercase">{color}</p>
    </div>
    <input
      type="text"
      value={color}
      onChange={onChange}
      className="w-24 px-2 py-1.5 text-xs font-mono bg-slate-100 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30"
      maxLength={7}
    />
  </div>
);

const ThemeManager = ({ compact = false }) => {
  const settings = useSettings();
  const [colors, setColors] = useState(DEFAULT_VALUES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setColors({
      primary_color: settings.primary_color || DEFAULT_VALUES.primary_color,
      secondary_color: settings.secondary_color || DEFAULT_VALUES.secondary_color,
      accent_color: settings.accent_color || DEFAULT_VALUES.accent_color,
      dark_color: settings.dark_color || DEFAULT_VALUES.dark_color,
      gold_color: settings.gold_color || DEFAULT_VALUES.gold_color,
    });
  }, [settings.primary_color, settings.secondary_color, settings.accent_color, settings.dark_color, settings.gold_color]);

  // Aperçu live — injecte un <style> avec !important pour overrider Tailwind
  useEffect(() => {
    const styleId = 'theme-manager-preview';
    let el = document.getElementById(styleId);
    if (!el) {
      el = document.createElement('style');
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = `
      :root {
        --color-docuflow-primary: ${colors.primary_color} !important;
        --color-docuflow-secondary: ${colors.secondary_color} !important;
        --color-docuflow-accent: ${colors.accent_color} !important;
        --color-docuflow-dark: ${colors.dark_color} !important;
        --color-docuflow-gold: ${colors.gold_color} !important;
      }
    `;
  }, [colors]);

  const handleChange = (key, value) => {
    setColors(prev => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset) => {
    setColors(preset.colors);
  };

  const resetDefaults = () => {
    setColors(DEFAULT_VALUES);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settings.update(colors);
      toast.success('Thème sauvegardé !');
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEME_COLORS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <label className="relative cursor-pointer">
                <input
                  type="color"
                  value={colors[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="w-10 h-10 rounded-lg border-2 border-white shadow-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: colors[key] }}
                />
              </label>
              <div>
                <p className="text-sm font-medium text-slate-700">{label}</p>
                <p className="text-[10px] text-slate-400 font-mono">{colors[key]}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm py-2">
            <Check size={16} />
            {saving ? 'Sauvegarde...' : 'Appliquer'}
          </button>
          <button onClick={resetDefaults} className="btn-secondary flex items-center gap-2 text-sm py-2">
            <RotateCcw size={16} />
            Défaut
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-docuflow-secondary to-purple-600 text-white rounded-2xl shadow-lg">
          <Palette size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Thème & Couleurs</h3>
          <p className="text-sm text-slate-500">Personnalisez l'apparence de votre plateforme</p>
        </div>
      </div>

      {/* Presets */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Préréglages</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const isActive = Object.keys(preset.colors).every(k => preset.colors[k] === colors[k]);
            return (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-docuflow-secondary text-white shadow-md'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-docuflow-secondary/50'
                }`}
              >
                <div className="flex -space-x-1">
                  {Object.values(preset.colors).slice(0, 3).map((c, i) => (
                    <div key={i} className="w-3 h-3 rounded-full border border-white" style={{ backgroundColor: c }} />
                  ))}
                </div>
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Couleurs personnalisées */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Couleurs personnalisées</p>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          {THEME_COLORS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-4">
              <label className="relative cursor-pointer">
                <input
                  type="color"
                  value={colors[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="w-12 h-12 rounded-xl border-2 border-white shadow-md hover:scale-110 transition-transform"
                  style={{ backgroundColor: colors[key] }}
                />
              </label>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="text-xs text-slate-400 truncate">{desc}</p>
              </div>
              <input
                type="text"
                value={colors[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-24 px-2 py-1.5 text-xs font-mono bg-slate-100 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/30"
                maxLength={7}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Aperçu */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Aperçu en temps réel</p>
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: colors.primary_color }}>D</div>
            <div>
              <p className="font-bold" style={{ color: colors.primary_color }}>{settings.site_name || 'DocuFlow'}</p>
              <p className="text-xs" style={{ color: colors.secondary_color }}>Plateforme de gestion documentaire</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-xl text-white text-sm font-bold shadow-md" style={{ backgroundColor: colors.secondary_color }}>
              Action
            </button>
            <button className="px-4 py-2 rounded-xl text-sm font-bold border" style={{ borderColor: colors.primary_color + '30', color: colors.primary_color }}>
              Secondaire
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Check size={18} />
          {saving ? 'Sauvegarde...' : 'Sauvegarder le thème'}
        </button>
        <button onClick={resetDefaults} className="btn-secondary flex items-center gap-2">
          <RotateCcw size={18} />
          Réinitialiser
        </button>
      </div>
    </div>
  );
};

export default ThemeManager;
