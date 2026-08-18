import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/settingsService';

const SettingsContext = createContext({ site_name: 'DocuFlow', site_description: '' });

export const useSettings = () => useContext(SettingsContext);

const DEFAULT_TITLE = 'DocuFlow';

// Déclinaisons officielles générées par desktop/scripts/make-brand.js depuis
// assets/brand/docuflow-logo.png. Les tailles déclarées dans index.html sont
// conservées : un favicon 16 px et un favicon 192 px ne sont pas substituables.
const DEFAULT_FAVICONS = {
  '16x16': '/brand/favicon-16.png',
  '32x32': '/brand/favicon-32.png',
  '192x192': '/brand/favicon-192.png',
  '180x180': '/brand/apple-touch-icon.png',
};

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

/**
 * Applique le favicon du tenant, ou rétablit les déclinaisons officielles.
 *
 * Un tenant ne fournit qu'une seule image : elle remplace alors toutes les
 * tailles. Sans réglage, chaque balise retrouve la déclinaison correspondant à
 * son attribut `sizes` — d'où la table DEFAULT_FAVICONS plutôt qu'un seul
 * fichier appliqué partout.
 */
const applyLogo = (url) => {
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => {
    const fallback = DEFAULT_FAVICONS[el.getAttribute('sizes')] || DEFAULT_FAVICONS['32x32'];
    el.setAttribute('href', url || fallback);
  });
};

/**
 * Applique les couleurs thème comme variables CSS sur :root.
 * Les composants qui utilisent var(--color-docuflow-*) seront mis à jour automatiquement.
 */
const applyThemeColors = (themeData) => {
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
      --color-docuflow-primary: ${primary} !important;
      --color-docuflow-secondary: ${secondary} !important;
      --color-docuflow-accent: ${accent} !important;
      --color-docuflow-dark: ${dark} !important;
      --color-docuflow-gold: ${gold} !important;
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

  // Applique les paramètres au DOM (titre, favicon, thème) à chaque changement.
  // Le favicon dédié (site_favicon) prime sur le logo : c'est un réglage distinct
  // du catalogue, sans quoi il resterait sans effet visible.
  useEffect(() => {
    applySiteName(settings.site_name);
    applyLogo(settings.site_favicon_url || settings.site_logo_url);
    applyThemeColors(settings);
  }, [
    settings.site_name,
    settings.site_logo_url,
    settings.site_favicon_url,
    settings.primary_color,
    settings.secondary_color,
    settings.accent_color,
    settings.dark_color,
    settings.gold_color,
  ]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await settingsService.getSettings();
        setSettings(prev => ({ ...prev, ...data }));
      } catch {
        // Réglages indisponibles (hors ligne, backend non démarré) : les valeurs
        // par défaut ci-dessus restent en place, l'application reste utilisable.
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
    } catch {
      // Idem : on conserve les réglages déjà chargés.
    }
  }, []);

  const update = useCallback(async (data) => {
    await settingsService.updateSettings(data);
    await refresh();
  }, [refresh]);

  // `key` permet de téléverser aussi le favicon ou le fond de connexion, qui
  // sont des réglages de type image à part entière.
  const uploadLogo = useCallback(async (file, key = 'site_logo') => {
    const res = await settingsService.uploadLogo(file, key);
    await refresh();
    return res;
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ ...settings, loaded, refresh, update, uploadLogo }}>
      {children}
    </SettingsContext.Provider>
  );
};
