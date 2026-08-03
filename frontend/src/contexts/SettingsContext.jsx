import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/settingsService';

const SettingsContext = createContext({ site_name: 'DocuFlow', site_description: '' });

export const useSettings = () => useContext(SettingsContext);

const DEFAULT_TITLE = 'DocuFlow';
const DEFAULT_FAVICON = '/favicon.svg';

// Couleurs thème par défaut
const DEFAULT_THEME = {
  primary_color: '#0f172a',
  secondary_color: '#3b82f6',
  accent_color: '#f8fafc',
  dark_color: '#1e293b',
  gold_color: '#d4af37',
};

const applySiteName = (name) => {
  const title = name || DEFAULT_TITLE;
  document.title = `${title} — Plateforme de gestion documentaire`;
  document.querySelector('meta[name="application-name"]')?.setAttribute('content', title);
};

const applyLogo = (url) => {
  const href = url || DEFAULT_FAVICON;
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(el => {
    el.setAttribute('href', href);
  });
};

/**
 * Applique les couleurs thème comme variables CSS sur :root.
 * Les composants qui utilisent var(--color-afgc-*) seront mis à jour automatiquement.
 */
const applyThemeColors = (themeData) => {
  const root = document.documentElement;
  // Injecter dans un <style> avec !important pour overrider les utilitaires Tailwind compile-time
  const styleId = 'docuflow-theme-dynamic';
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  const primary = themeData.primary_color || DEFAULT_THEME.primary_color;
  const secondary = themeData.secondary_color || DEFAULT_THEME.secondary_color;
  const accent = themeData.accent_color || DEFAULT_THEME.accent_color;
  const dark = themeData.dark_color || DEFAULT_THEME.dark_color;
  const gold = themeData.gold_color || DEFAULT_THEME.gold_color;

  styleEl.textContent = `
    :root {
      --color-afgc-primary: ${primary} !important;
      --color-afgc-secondary: ${secondary} !important;
      --color-afgc-accent: ${accent} !important;
      --color-afgc-dark: ${dark} !important;
      --color-afgc-gold: ${gold} !important;
      --color-primary-color: ${primary} !important;
      --color-secondary-color: ${secondary} !important;
      --color-accent-color: ${accent} !important;
      --color-dark-color: ${dark} !important;
      --color-gold-color: ${gold} !important;
    }
  `;
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    site_name: 'DocuFlow',
    site_description: '',
    site_logo: null,
    site_logo_url: null,
    ...DEFAULT_THEME,
  });
  const [loaded, setLoaded] = useState(false);

  // Applique les paramètres au DOM (titre, favicon, thème) à chaque changement
  useEffect(() => {
    applySiteName(settings.site_name);
    applyLogo(settings.site_logo_url);
    applyThemeColors(settings);
  }, [settings.site_name, settings.site_logo_url, settings.primary_color, settings.secondary_color, settings.accent_color, settings.dark_color, settings.gold_color]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await settingsService.getSettings();
        setSettings(prev => ({ ...prev, ...data }));
      } catch (err) {
        // Fallback silencieux
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await settingsService.getSettings();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      // Silent
    }
  }, []);

  const update = useCallback(async (data) => {
    await settingsService.updateSettings(data);
    await refresh();
  }, [refresh]);

  const uploadLogo = useCallback(async (file) => {
    const res = await settingsService.uploadLogo(file);
    await refresh();
    return res;
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ ...settings, loaded, refresh, update, uploadLogo }}>
      {children}
    </SettingsContext.Provider>
  );
};
